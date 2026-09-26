// db.js - Gestión de Base de Datos Local con IndexedDB e integración con Firebase

const DB_NAME = 'ControlAutomovilismoDB';
// V11: bump de seguridad. En V10 la base pudo abrirse con una build que no materializó el
// store 'tiposMovimiento'; como ya se estaba en la versión objetivo, onupgradeneeded no se
// volvía a disparar y el store faltaba físicamente (NotFoundError en db.transaction). Al subir
// a V11 el navegador se ve OBLIGADO a ejecutar la migración y a crear la tabla faltante.
// V12: agrega el store 'configuracionGlobal' (documento único de ajustes de la app, p.ej. el
// enlace CSV de Google Sheets del módulo Calendario). La creación con .contains() es idempotente.
const DB_VERSION = 12;

let dbInstance = null;

// ==================== CACHÉ EN MEMORIA ====================
// Evita leer IndexedDB/Firebase en cada cambio de vista.
// Se invalida solo cuando se escriben/eliminan datos.
const _cache = {};

// Rastrea qué colecciones ya se intentaron leer desde la nube (Firestore)
// para evitar lecturas repetidas innecesarias cuando ambas fuentes están vacías.
const _cloudChecked = {};

// FASE 6: estado de caché COMPARTIDO con src/services/persistenceService.js
// (mismo objeto en ambos lados → la cache nunca se desincroniza).
if (typeof window !== 'undefined') {
    window.__CDA_DB_STATE__ = { _cache, _cloudChecked };
}

// ==================== INTEGRACIÓN CON FIREBASE ====================
let dbFirebase = null;
let useFirebase = false;

// ============================================================
// CONFIGURACIÓN DE FIREBASE (FASE 3 - centralizada).
// El objeto hardcodeado DEFAULT_FIREBASE_CONFIG fue ELIMINADO.
// La nueva fuente de verdad es el módulo ES `src/services/firebaseConfig.js`,
// que lee las variables de entorno (.env) vía import.meta.env.VITE_FIREBASE_*.
// `main.js` (módulo ES) lo inyecta como `window.__CDA_FIREBASE_CONFIG__`
// ANTES de DOMContentLoaded, es decir, antes de que db.js arranque Firebase,
// para que `obtenerConfigFirebase()` siempre tenga una base disponible.
// ============================================================

// AUTH_DOMAIN CANONICO de Firebase.
// Ya NO se reemplaza por el hostname del hosting: Firebase Auth rechaza la
// configuracion con `auth/invalid-api-key` cuando authDomain no coincide con un
// dominio autorizado en la consola del proyecto. El hostname del sitio
// (p.ej. nicofern-01.github.io) debe estar REGISTRADO como dominio autorizado
// en Firebase Console, pero no sustituye al authDomain canonico.
const AUTH_DOMAIN_CANONICO = 'controlcda-e5f97.firebaseapp.com';

// Limpia una config de Firebase cacheada en localStorage que este corrupta o
// que contenga un authDomain invalido (p.ej. el hostname de GitHub Pages).
// Sin esto, el error `auth/invalid-api-key` persistiria entre recargas aunque el
// codigo ya este corregido, obligando al usuario a limpiar la cache a mano.
function sanearConfigFirebaseLocal() {
    const CLAVE = 'firebase_config';
    try {
        const crudo = localStorage.getItem(CLAVE);
        if (!crudo) return;

        let config = null;
        try {
            config = JSON.parse(crudo);
        } catch (e) {
            console.warn('[firebase] Config cacheada ilegible; se descarta.');
            localStorage.removeItem(CLAVE);
            return;
        }

        if (!config || typeof config !== 'object' || !config.apiKey || !config.projectId) {
            console.warn('[firebase] Config cacheada incompleta; se descarta.');
            localStorage.removeItem(CLAVE);
            return;
        }

        if (config.authDomain && config.authDomain !== AUTH_DOMAIN_CANONICO) {
            console.warn('[firebase] authDomain cacheado invalido ("' + config.authDomain +
                '"); se descarta para forzar el canonico.');
            localStorage.removeItem(CLAVE);
        }
    } catch (e) {
        console.warn('[firebase] No se pudo sanear la config local:', e);
    }
}

// Obtiene la configuración completa de Firebase.
// El authDomain SIEMPRE es el canonico de Firebase: nunca el hostname del hosting.
function obtenerConfigFirebase() {
    sanearConfigFirebaseLocal();

    const configStr = localStorage.getItem('firebase_config');
    let config;
    
    if (configStr) {
        try {
            config = JSON.parse(configStr);
        } catch (err) {
            console.warn('Configuración Firebase inválida en localStorage, usando configuración por defecto.', err);
            config = { ...(typeof window !== 'undefined' && window.__CDA_FIREBASE_CONFIG__) || {} };
        }
    } else {
        config = { ...(typeof window !== 'undefined' && window.__CDA_FIREBASE_CONFIG__) || {} };
    }
    
    // authDomain canonico: se impone sobre cualquier valor previo o dinamico.
    // Si viene el hostname de GitHub Pages (config vieja o cacheada), se corrige.
    if (!config.authDomain || config.authDomain.includes('github.io')) {
        config.authDomain = AUTH_DOMAIN_CANONICO;
    }

    // Diagnostico explicito: un `auth/invalid-api-key` se debe casi siempre a una
    // configuracion incompleta o a un authDomain que no es el canonico.
    if (!config.apiKey) {
        console.error('[firebase] ERROR: falta apiKey en la configuracion. ' +
            'Verificar window.__CDA_FIREBASE_CONFIG__ (src/main.js) y el bundle publicado.');
    } else {
        console.info('[firebase] Config activa | projectId: ' + (config.projectId || '?') +
            ' | authDomain: ' + config.authDomain +
            ' | origen: ' + (config.authDomain === AUTH_DOMAIN_CANONICO ? 'canonico' : 'PERSONALIZADO') +
            ' | apiKey: ' + String(config.apiKey).slice(0, 6) + '...' +
            ' | host: ' + (typeof window !== 'undefined' ? window.location.hostname : '?'));
    }

    // Guardar la configuración ajustada para futuras cargas
    localStorage.setItem('firebase_config', JSON.stringify(config));

    return config;
}

// Variables de módulos de Firebase
let initializeApp, initializeFirestore, getFirestore, collection, doc, setDoc, getDocs, getDoc, deleteDoc, writeBatch, query, where, enableIndexedDbPersistence;
let getStorage, refStorage, uploadBytes, getDownloadURL, deleteObject;
let storageFirebase = null;

// Variables de módulo de Firebase Auth
let getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut, createUserWithEmailAndPassword;
let deleteApp = null;
let authFirebase = null;
let firebaseConfigActiva = null;

// ==================== ALTA DE USUARIOS SIN ROBAR LA SESIÓN ====================
// `createUserWithEmailAndPassword()`sobre el Auth principal INICIA SESIÓN con
// la cuenta recien creada, expulsando al administrador que esta operando. Eso
// rompe a continuacion: el setDoc del perfil se ejecuta con los permisos del
// usuario nuevo (que no es admin) y las reglas de Firestore lo rechazan.
//
// Solucion: crear la cuenta en una APP SECUNDARIA de Firebase (mismo proyecto,
// instancia de Auth independiente). La sesion principal del admin nunca se toca.
const APP_SECUNDARIA_NOMBRE = 'cda-alta-usuarios';
let authSecundario = null;

async function crearUsuarioEnAppSecundaria(email, password) {
    if (!initializeApp || !getAuth || !createUserWithEmailAndPassword) {
        throw new Error('El SDK de Firebase Auth no esta disponible.');
    }
    if (!authSecundario) {
        const app = initializeApp(firebaseConfigActiva, APP_SECUNDARIA_NOMBRE);
        authSecundario = getAuth(app);
    }
    return createUserWithEmailAndPassword(authSecundario, email, password);
}

// ==================== CREDENCIALES POR DEFECTO DEL ADMIN ====================
// Fuente única de verdad del usuario administrador inicial. Se crea de forma
// silenciosa (sin alert) cuando el store `usuarios` está vacío, con credenciales
// fijas y predecibles de desarrollo. Coincide con el harness E2E (tests/app.spec.js).
const ADMIN_POR_DEFECTO = Object.freeze({
    username: 'admin',
    password: 'Admin123!'
});

// ==================== HASH DE CONTRASEÑAS SEGURO (Web Crypto API) ====================
// Usa SHA-256 con salt aleatorio. No almacena la contraseña en texto plano.
async function hashPassword(password) {
    const encoder = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
    
    // Combinar salt + password
    const data = encoder.encode(saltHex + password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    return `sha256$${saltHex}$${hashHex}`;
}

// Verificar contraseña contra un hash almacenado
async function verificarPassword(password, storedHash) {
    if (!storedHash) return false;
    
    // Soporte para hashes antiguos (formato 'hash_...') - migración
    if (storedHash.startsWith('hash_')) {
        // Hash antiguo no seguro - comparar y marcar para migración
        const oldHash = hashPasswordLegacy(password);
        return oldHash === storedHash;
    }
    
    // Formato nuevo: sha256$salt$hash
    const parts = storedHash.split('$');
    if (parts.length !== 3 || parts[0] !== 'sha256') return false;
    
    const saltHex = parts[1];
    const expectedHash = parts[2];
    
    const encoder = new TextEncoder();
    const data = encoder.encode(saltHex + password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    return hashHex === expectedHash;
}

// Hash legacy (solo para migración de datos existentes)
function hashPasswordLegacy(password) {
    let hash = 0;
    for (let i = 0; i < password.length; i++) {
        const char = password.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return 'hash_' + Math.abs(hash).toString(16) + '_' + password.length;
}

async function inicializarFirebase() {
    // Cargar configuración dinámicamente (ajusta authDomain según entorno)
    const config = obtenerConfigFirebase();

    try {
        // Cargamos módulos oficiales de Firebase v10 desde gstatic CDN para ES Modules
        const appMod = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js');
        const fsMod = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js');
        const storageMod = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js');
        const authMod = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js');

        initializeApp = appMod.initializeApp;
        initializeFirestore = fsMod.initializeFirestore;
        getFirestore = fsMod.getFirestore;
        collection = fsMod.collection;
        doc = fsMod.doc;
        setDoc = fsMod.setDoc;
        getDocs = fsMod.getDocs;
        getDoc = fsMod.getDoc;
        deleteDoc = fsMod.deleteDoc;
        writeBatch = fsMod.writeBatch;
        query = fsMod.query;
        where = fsMod.where;
        enableIndexedDbPersistence = fsMod.enableIndexedDbPersistence;
        getStorage = storageMod.getStorage;
        refStorage = storageMod.ref;
        uploadBytes = storageMod.uploadBytes;
        getDownloadURL = storageMod.getDownloadURL;
        deleteObject = storageMod.deleteObject;

        // Asignar funciones de Firebase Auth
        getAuth = authMod.getAuth;
        signInWithEmailAndPassword = authMod.signInWithEmailAndPassword;
        onAuthStateChanged = authMod.onAuthStateChanged;
        signOut = authMod.signOut;
        createUserWithEmailAndPassword = authMod.createUserWithEmailAndPassword;

        const app = initializeApp(config);
        firebaseConfigActiva = config;
        storageFirebase = getStorage(app);
        authFirebase = getAuth(app);
        if (initializeFirestore) {
            dbFirebase = initializeFirestore(app, {
                experimentalAutoDetectLongPolling: true // Crucial para saltarse bloqueos de red en hosting públicos como GitHub Pages.
            });
            console.log('Firestore inicializado con experimentalAutoDetectLongPolling.');
        } else {
            dbFirebase = getFirestore(app);
        }

        if (!dbFirebase) {
            throw new Error('No se pudo inicializar Firestore.');
        }

        // HABILITAR PERSISTENCIA LOCAL EN EL NAVEGADOR (WEB PERSISTENCE / IndexedDB)
        // Garantiza que los datos consultados en Firestore se guarden en el caché del navegador
        // y se rendericen de inmediato sin quedarse congelados en la carga.
        if (typeof enableIndexedDbPersistence === 'function') {
            try {
                await enableIndexedDbPersistence(dbFirebase);
                console.log('Persistencia local IndexedDB habilitada correctamente.');
            } catch (persistErr) {
                if (persistErr.code === 'failed-precondition') {
                    console.warn('Persistencia IndexedDB no habilitada: múltiples pestañas abiertas en el mismo navegador.');
                } else if (persistErr.code === 'unimplemented') {
                    console.warn('Persistencia IndexedDB no soportada por este navegador.');
                } else {
                    console.warn('Error al habilitar persistencia IndexedDB:', persistErr);
                }
            }
        }

        useFirebase = true;
        console.log('Sincronización con Firebase Firestore activa.');

        // Exponer authFirebase globalmente para que app.js pueda usarlo
        if (typeof window !== 'undefined') {
            window.authFirebase = authFirebase;
            window.signInWithEmailAndPassword = signInWithEmailAndPassword;
            window.onAuthStateChanged = onAuthStateChanged;
            window.signOut = signOut;

            // FASE 5: bridge Firestore (Runtime) para el dominio de autenticación.
            // authService (ES module) no puede leer los `let` de db.js; se los
            // exponemos aquí de forma aditiva y aislada en un namespace.
            window.__CDA_FIREBASE_RUNTIME__ = {
                dbFirebase,
                collection,
                doc,
                setDoc,
                getDocs,
                getDoc,
                deleteDoc,
                query,
                where,
                writeBatch,
                // MIGRACIÓN A FIREBASE AUTHENTICATION: authService.js (ES module)
                // no puede leer los `let` de db.js, así que el SDK de Auth
                // se expone aquí dentro del mismo bridge aditivo.
                auth: authFirebase,
                getAuth,
                signInWithEmailAndPassword,
                onAuthStateChanged,
                signOut,
                createUserWithEmailAndPassword,
                // Alta de cuentas en una app secundaria: NO cierra la sesion del
                // administrador que esta creando al usuario.
                crearUsuarioEnAppSecundaria,
                get useFirebase() { return useFirebase; }
            };
        }

        try {
            await sincronizarLocalAFirebase();
        } catch (syncErr) {
            console.warn('Sincronización inicial con Firebase no completada:', syncErr);
        }

        return true;
    } catch (e) {
        console.error('Error al inicializar Firebase:', e);
        useFirebase = false;
        return false;
    }
}


// ==================== SANEO DE CONFIGURACIÓN FIREBASE ====================
// Al cargar la página, descartar cualquier config de Firebase cacheada que
// tenga un authDomain invalido (p.ej. el hostname de GitHub Pages).
// Antes este bloque REESCRIBIA el authDomain con el hostname en cada carga,
// lo que hacia que Firebase Auth fallara con auth/invalid-api-key de forma
// permanente. Ahora solo sanea: la fuente de verdad es AUTH_DOMAIN_CANONICO.
(function sanearConfigFirebaseAlCargar() {
    try {
        const configStr = localStorage.getItem('firebase_config');
        if (!configStr) return;

        let config = null;
        try {
            config = JSON.parse(configStr);
        } catch (e) {
            console.warn('[firebase] Config cacheada ilegible al cargar; se descarta.');
            localStorage.removeItem('firebase_config');
            return;
        }

        if (config && config.authDomain && config.authDomain !== AUTH_DOMAIN_CANONICO) {
            console.warn('[firebase] authDomain cacheado invalido ("' + config.authDomain +
                '"); se descarta al cargar para usar el canonico.');
            localStorage.removeItem('firebase_config');
        }
    } catch (e) {
        console.warn('Error al sanear la configuracion Firebase:', e);
    }
})();

// Limpiar toda la caché al cargar la página para evitar datos obsoletos
limpiarCacheCompleto();

function invalidarCache(storeName) {
    delete _cache[storeName];
    delete _cloudChecked[storeName];
}

function limpiarCacheCompleto() {
    Object.keys(_cache).forEach(k => delete _cache[k]);
    Object.keys(_cloudChecked).forEach(k => delete _cloudChecked[k]);
}

function openDB() {
    return new Promise((resolve, reject) => {
        if (dbInstance) {
            return resolve(dbInstance);
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            // Tabla de Categorías
            if (!db.objectStoreNames.contains('categorias')) {
                db.createObjectStore('categorias', { keyPath: 'id', autoIncrement: true });
            }

            // Tabla de Circuitos
            if (!db.objectStoreNames.contains('circuitos')) {
                db.createObjectStore('circuitos', { keyPath: 'id', autoIncrement: true });
            }

            // Tabla de Staff
            if (!db.objectStoreNames.contains('staff')) {
                db.createObjectStore('staff', { keyPath: 'id', autoIncrement: true });
            }

            // Tabla de Competencias (Calendario)
            if (!db.objectStoreNames.contains('competencias')) {
                db.createObjectStore('competencias', { keyPath: 'id', autoIncrement: true });
            }

            // Tabla de Gastos
            if (!db.objectStoreNames.contains('gastos')) {
                db.createObjectStore('gastos', { keyPath: 'id', autoIncrement: true });
            }

            // Tabla de Conceptos de Gastos
            if (!db.objectStoreNames.contains('conceptos')) {
                db.createObjectStore('conceptos', { keyPath: 'id', autoIncrement: true });
            }

            // Tabla de Usuarios
            if (!db.objectStoreNames.contains('usuarios')) {
                const usuariosStore = db.createObjectStore('usuarios', { keyPath: 'id', autoIncrement: true });
                usuariosStore.createIndex('username', 'username', { unique: true });
            }

            // Tabla de Rendiciones (Carga Detallada)
            if (!db.objectStoreNames.contains('rendiciones')) {
                db.createObjectStore('rendiciones', { keyPath: 'id', autoIncrement: true });
            }

            // Tabla de Detalle de Gastos (Carga Detallada)
            if (!db.objectStoreNames.contains('detalleGastos')) {
                db.createObjectStore('detalleGastos', { keyPath: 'id', autoIncrement: true });
            }

            // Tabla de Adjuntos (Carga Detallada)
            if (!db.objectStoreNames.contains('adjuntos')) {
                db.createObjectStore('adjuntos', { keyPath: 'id', autoIncrement: true });
            }

            // Tabla de Proveedores (Carga Detallada)
            if (!db.objectStoreNames.contains('proveedores')) {
                db.createObjectStore('proveedores', { keyPath: 'id', autoIncrement: true });
            }

            // Tabla de Campeonatos (Carga Detallada)
            if (!db.objectStoreNames.contains('campeonatos')) {
                db.createObjectStore('campeonatos', { keyPath: 'id', autoIncrement: true });
            }

            // ==================== NUEVAS TABLAS DE INVENTARIO (DB_VERSION 5) ====================
            
            // Categorías de inventario (Indumentaria, Banderas, etc.)
            if (!db.objectStoreNames.contains('categoriasInventario')) {
                db.createObjectStore('categoriasInventario', { keyPath: 'id', autoIncrement: true });
            }

            // Subcategorías de inventario
            if (!db.objectStoreNames.contains('subcategoriasInventario')) {
                db.createObjectStore('subcategoriasInventario', { keyPath: 'id', autoIncrement: true });
            }

            // Talles (administrables)
            if (!db.objectStoreNames.contains('talles')) {
                db.createObjectStore('talles', { keyPath: 'id', autoIncrement: true });
            }

            // Artículos del inventario
            if (!db.objectStoreNames.contains('articulos')) {
                db.createObjectStore('articulos', { keyPath: 'id', autoIncrement: true });
            }

            // Stock por talle (solo indumentaria)
            if (!db.objectStoreNames.contains('articuloTalles')) {
                db.createObjectStore('articuloTalles', { keyPath: 'id', autoIncrement: true });
            }

            // Movimientos de inventario
            if (!db.objectStoreNames.contains('movimientosInventario')) {
                db.createObjectStore('movimientosInventario', { keyPath: 'id', autoIncrement: true });
            }

            // Entregas de indumentaria
            if (!db.objectStoreNames.contains('entregasInventario')) {
                db.createObjectStore('entregasInventario', { keyPath: 'id', autoIncrement: true });
            }

            // Detalle de entregas
            if (!db.objectStoreNames.contains('detalleEntregas')) {
                db.createObjectStore('detalleEntregas', { keyPath: 'id', autoIncrement: true });
            }

            // Imágenes de artículos
            if (!db.objectStoreNames.contains('imagenesArticulo')) {
                db.createObjectStore('imagenesArticulo', { keyPath: 'id', autoIncrement: true });
            }

            // Personal por competencia (costos laborales)
            if (!db.objectStoreNames.contains('personalCompetencia')) {
                db.createObjectStore('personalCompetencia', { keyPath: 'id', autoIncrement: true });
            }

            // Tabla de Alojamientos
            if (!db.objectStoreNames.contains('alojamientos')) {
                db.createObjectStore('alojamientos', { keyPath: 'id', autoIncrement: true });
            }

            // ============ NUEVO EN DB_VERSION 9: CATÁLOGO DE UBICACIONES FÍSICAS ============
            // Ubicaciones canónicas (Depósito Central, Camión, Carrera, etc.). Reemplaza la
            // lista de sectores que históricamente vivía en localStorage ('cda_sectores').
            // Se referencia desde 'articulos.ubicaciones[].ubicacionId'.
            if (!db.objectStoreNames.contains('ubicacionesInventario')) {
                const ubicacionesStore = db.createObjectStore('ubicacionesInventario', { keyPath: 'id', autoIncrement: true });
                ubicacionesStore.createIndex('nombre', 'nombre', { unique: true });
            }

            // ============ NUEVO EN DB_VERSION 10: CATÁLOGO DE TIPOS DE MOVIMIENTO ============
            // Tipos canónicos + personalizados. Cada uno define su 'naturaleza' (semántica
            // canónica de stock) para que ajustarStockV9 nunca reciba tipos desconocidos.
            if (!db.objectStoreNames.contains('tiposMovimiento')) {
                const tiposStore = db.createObjectStore('tiposMovimiento', { keyPath: 'id', autoIncrement: true });
                tiposStore.createIndex('valor', 'valor', { unique: true });
            }

            // ============ NUEVO EN DB_VERSION 12: CONFIGURACIÓN GLOBAL DE LA APP ============
            // Documento único (id fijo 1) de ajustes de la aplicación, p.ej. el enlace CSV de
            // Google Sheets del módulo Calendario. El guard .contains() lo hace idempotente para
            // bases ya abiertas en V11 (el bump de versión dispara la migración).
            if (!db.objectStoreNames.contains('configuracionGlobal')) {
                db.createObjectStore('configuracionGlobal', { keyPath: 'id', autoIncrement: true });
            }

            // ============ DB_VERSION 11: REPARACIÓN DEFINITIVA DE ESQUEMAS INCONSISTENTES ============
            // MOTIVO DEL BUMP: en V10 la base pudo abrirse bajo una build que no materializó
            // 'tiposMovimiento'. Como ya se estaba en la versión objetivo, el evento
            // onupgradeneeded NO volvía a dispararse jamás y el store faltaba físicamente →
            // NotFoundError en db.transaction([...]) que congelaba la UI. Al subir a V11 el
            // navegador ejecuta OBLIGATORIAMENTE esta actualización (oldVersion 10 < 11) y el
            // guard con .contains() garantiza la creación física del store y su índice.
            if (event.oldVersion < 11) {
                if (!db.objectStoreNames.contains('tiposMovimiento')) {
                    try {
                        const tiposStoreV11 = db.createObjectStore('tiposMovimiento', { keyPath: 'id', autoIncrement: true });
                        tiposStoreV11.createIndex('valor', 'valor', { unique: true });
                    } catch (storeErrV11) {
                        // Si la creación fallara, la garantía la da el bloque V10 de arriba y el
                        // control defensivo de transacciones (no congelar la app). Log limpio.
                        console.warn('[db] V11: no se pudo crear el store tiposMovimiento:', storeErrV11?.message || storeErrV11);
                    }
                }
            }
        };

        request.onsuccess = (event) => {
            dbInstance = event.target.result;
            resolve(dbInstance);
        };

        request.onerror = (event) => {
            const error = event?.target?.error;
            const message = error?.message || event?.target?.errorCode || 'Error desconocido';
            reject(`Error al abrir la base de datos: ${message}`);
        };
    });
}

// Inicializar base de datos con datos por defecto si están vacías
async function inicializarDatosPorDefecto() {
    const db = await openDB();

    // Comprobar si hay categorías
    const categorias = await getTodos('categorias');
    if (categorias.length === 0) {
        const categoriasIniciales = [
            { nombre: 'TC2000', descripcion: 'La máxima expresión tecnológica de autos de turismo.', activo: true },
            { nombre: 'Top Race V6', descripcion: 'Autos de alta potencia con carrocerías siluetas.', activo: true },
            { nombre: 'Top Race Series', descripcion: 'Categoría escuela y antesala del TRV6.', activo: true },
            { nombre: 'Fórmula Nacional', descripcion: 'Histórico semillero oficial de monoplazas.', activo: true },
            { nombre: 'Fiat Competizione', descripcion: 'Monomarca nacional', activo: true },
            { nombre: 'Argentino de Karting', descripcion: 'Rotax y Iame series', activo: true }
        ];
        for (const cat of categoriasIniciales) {
            await guardar('categorias', cat);
        }
    }

    // Comprobar si hay circuitos
    const circuitos = await getTodos('circuitos');
    if (circuitos.length === 0) {
        const circuitosIniciales = [
            { nombre: 'Autódromo Oscar y Juan Gálvez', ubicacion: 'Ciudad de Buenos Aires' },
            { nombre: 'Autódromo Oscar Cabalén', ubicacion: 'Alta Gracia, Córdoba' },
            { nombre: 'Autódromo Ciudad de Rosario', ubicacion: 'Rosario, Santa Fe' },
            { nombre: 'Circuito San Juan Villicum', ubicacion: 'San Juan' },
            { nombre: 'Autódromo Ciudad de Paraná', ubicacion: 'Paraná, Entre Ríos' },
            { nombre: 'Autódromo Parque Ciudad de Río Cuarto', ubicacion: 'Río Cuarto, Córdoba' },
            { nombre: 'Autódromo Ezequiel Crisol', ubicacion: 'Bahía Blanca, Buenos Aires' },
            { nombre: 'Autódromo Ciudad de Concordia', ubicacion: 'Concordia, Entre Ríos' },
            { nombre: 'Autódromo San Nicolás Ciudad', ubicacion: 'San Nicolás, Buenos Aires' },
            { nombre: 'Autódromo Provincia de La Pampa', ubicacion: 'Toay, La Pampa' }
        ];
        for (const circ of circuitosIniciales) {
            await guardar('circuitos', circ);
        }
    }


    // Comprobar si hay conceptos - crear por defecto
    const conceptos = await getTodos('conceptos');
    if (conceptos.length === 0) {
        const conceptosIniciales = [
            { nombre: 'Otros' },
            { nombre: 'Ambulancia / Seguro Médico' },
            { nombre: 'Banderilleros / Personal de Pista' },
            { nombre: 'Trofeos y Premiaciones' },
            { nombre: 'Viáticos / Alojamiento / Comida' },
            { nombre: 'Publicidad / Prensa' },
            { nombre: 'Servicio de Limpieza / Seguridad' },
            { nombre: 'Alquiler de Circuito' },
            { nombre: 'Administrativos / Papelería' }
        ];
        for (const conc of conceptosIniciales) {
            await guardar('conceptos', conc);
        }
    }
    // Comprobar si hay usuarios - crear admin por defecto si no existe ninguno.
    // Silencioso y determinista: credenciales fijas de desarrollo (admin / Admin123!),
    // unificadas con el harness E2E de Playwright (tests/app.spec.js). Sin alert().
    const usuarios = await getTodos('usuarios');
    if (usuarios.length === 0) {
        const passwordHash = await hashPassword(ADMIN_POR_DEFECTO.password);
        await guardar('usuarios', {
            username: ADMIN_POR_DEFECTO.username,
            passwordHash,
            nombre: 'Administrador',
            rol: 'admin', // 'admin' | 'editor' | 'viewer'
            activo: true,
            requiereCambioPassword: true
        });
        console.info('[db] Usuario admin por defecto creado (admin / Admin123!). Cambie la contraseña desde Configuración > Usuarios.');
    }

    // ==================== DATOS POR DEFECTO DE INVENTARIO ====================
    
    // Talles por defecto
    const talles = await getTodos('talles');
    if (talles.length === 0) {
        const tallesIniciales = [
            { nombre: 'XXXS', descripcion: 'Extra Extra Extra Small' },
            { nombre: 'XXS', descripcion: 'Extra Extra Small' },
            { nombre: 'XS', descripcion: 'Extra Small' },
            { nombre: 'S', descripcion: 'Small' },
            { nombre: 'M', descripcion: 'Medium' },
            { nombre: 'L', descripcion: 'Large' },
            { nombre: 'XL', descripcion: 'Extra Large' },
            { nombre: 'XXL', descripcion: 'Extra Extra Large' },
            { nombre: 'XXXL', descripcion: 'Extra Extra Extra Large' },
            { nombre: '40', descripcion: 'Talle 40' },
            { nombre: '42', descripcion: 'Talle 42' },
            { nombre: '44', descripcion: 'Talle 44' },
            { nombre: '46', descripcion: 'Talle 46' },
            { nombre: '48', descripcion: 'Talle 48' },
            { nombre: '50', descripcion: 'Talle 50' },
            { nombre: '52', descripcion: 'Talle 52' },
            { nombre: '54', descripcion: 'Talle 54' },
            { nombre: '56', descripcion: 'Talle 56' },
            { nombre: '58', descripcion: 'Talle 58' },
            { nombre: '60', descripcion: 'Talle 60' },
            { nombre: 'Único', descripcion: 'Talle único' },
            { nombre: 'Sin Talle', descripcion: 'Sin talle asignado' }
        ];
        for (const t of tallesIniciales) {
            await guardar('talles', t);
        }
    }

    // Categorías de inventario por defecto
    const catInv = await getTodos('categoriasInventario');
    if (catInv.length === 0) {
        const categoriasInventario = [
            { nombre: 'Indumentaria', descripcion: 'Prendas y uniformes', activo: true, controlaTalles: true, tipoBien: 'bien_uso' },
            { nombre: 'Banderas', descripcion: 'Banderas y banderines', activo: true, controlaTalles: false, tipoBien: 'bien_uso' },
            { nombre: 'Equipamiento', descripcion: 'Equipamiento general', activo: true, controlaTalles: false, tipoBien: 'bien_uso' },
            { nombre: 'Herramientas', descripcion: 'Herramientas manuales y eléctricas', activo: true, controlaTalles: false, tipoBien: 'bien_uso' },
            { nombre: 'Papelería', descripcion: 'Papelería e impresos', activo: true, controlaTalles: false, tipoBien: 'consumible' },
            { nombre: 'Electrónica', descripcion: 'Dispositivos electrónicos', activo: true, controlaTalles: false, tipoBien: 'bien_uso' },
            { nombre: 'Comunicación', descripcion: 'Equipos de comunicación', activo: true, controlaTalles: false, tipoBien: 'bien_uso' },
            { nombre: 'Mobiliario', descripcion: 'Muebles y mobiliario', activo: true, controlaTalles: false, tipoBien: 'bien_uso' },
            { nombre: 'Consumibles', descripcion: 'Materiales consumibles', activo: true, controlaTalles: false, tipoBien: 'consumible' },
            { nombre: 'Repuestos', descripcion: 'Repuestos y recambios', activo: true, controlaTalles: false, tipoBien: 'consumible' },
            { nombre: 'Material Deportivo', descripcion: 'Material deportivo y pista', activo: true, controlaTalles: false, tipoBien: 'bien_uso' },
            { nombre: 'Seguridad', descripcion: 'Elementos de seguridad', activo: true, controlaTalles: false, tipoBien: 'bien_uso' },
            { nombre: 'Otros', descripcion: 'Otros artículos', activo: true, controlaTalles: false, tipoBien: 'consumible' }
        ];
        for (const c of categoriasInventario) {
            await guardar('categoriasInventario', c);
        }
    }
}

// ==================== MIGRACIÓN DEL ESQUEMA A DB_VERSION 9 ====================
// FASE 1 del refactoring de inventario (stock por ubicación):
//  1) Crea y siembra el catálogo 'ubicacionesInventario' (normaliza los sectores
//     que históricamente vivían en localStorage bajo 'cda_sectores').
//  2) Desagrega el stock de 'articulos' en 'articulos.ubicaciones[]' (fuente de
//     verdad por ubicación), manteniendo 'stockUnico' y 'articuloTalles[].stock'
//     como totales derivados para no romper las lecturas existentes.
//  3) Normaliza 'movimientosInventario' hacia los tipos semánticos canónicos
//     (ingreso, consumo, transferencia_interna, devolucion, baja) y registra
//     'ubicacionOrigen' / 'ubicacionDestino' como snapshots históricos.
// Idempotente: protegida con flag en localStorage ('cda_migracion_v9_ok') y con
// marcas por registro ('migradoV9'). Al re-guardar cada documento, la sincronización
// con Firestore (guardar -> setDoc) propaga los cambios automáticamente a la nube.
const DB_MIGRACION_V9_FLAG = 'cda_migracion_v9_ok';

// Nombres históricos con distinta grafía que representan la misma ubicación física.
const ALIASES_UBICACION = {
    'Depósito': 'Depósito Central',
    'Deposito': 'Depósito Central',
    'Oficina': 'Oficinas'
};

// Ubicaciones que se trasladan físicamente (camión, autódromo, stand).
const UBICACIONES_MOVILES = ['Camión', 'Carrera', 'Stand / Box'];

// Categorías canónicas que siempre deben existir en el catálogo (orden de prioridad).
const UBICACIONES_DEFAULT_ORDER = ['Depósito Central', 'Taller', 'Oficinas', 'Carrera', 'Stand / Box', 'Otro', 'Producción', 'Paddock', 'Camión'];

// Normaliza un nombre de ubicación aplicando el mapa de alias y limpieza básica.
function normalizarNombreUbicacionV9(nombre) {
    const limpio = String(nombre || '').trim().replace(/\s+/g, ' ');
    if (!limpio) return null;
    for (const alias of Object.keys(ALIASES_UBICACION)) {
        if (alias.toLowerCase() === limpio.toLowerCase()) {
            return ALIASES_UBICACION[alias];
        }
    }
    return limpio;
}

// Clasifica una ubicación como fija (depósito/taller/oficina) o móvil (camión/carrera/stand).
function inferirTipoUbicacionV9(nombre) {
    return UBICACIONES_MOVILES.includes(nombre) ? 'movil' : 'fija';
}

// Mapeo de tipos de movimiento legacy -> canónicos (Fase 1).
// Idempotente: los tipos que ya son canónicos se conservan tal cual.
function mapearTipoMovimientoV9(tipoLegacy, tipoBien) {
    const tipo = String(tipoLegacy || '').toLowerCase();
    const esBienUso = tipoBien === 'bien_uso';
    switch (tipo) {
        case 'ingreso':
        case 'compra':
        case 'reposicion':
        case 'inventario':
            return { tipoMovimiento: 'ingreso', esIngreso: true };
        case 'devolucion':
            return { tipoMovimiento: 'devolucion', esIngreso: true };
        case 'transferencia':
        case 'egreso':
        case 'entrega':
            return esBienUso
                ? { tipoMovimiento: 'transferencia_interna', esIngreso: false }
                : { tipoMovimiento: 'consumo', esIngreso: false };
        case 'transferencia_interna':
            return { tipoMovimiento: 'transferencia_interna', esIngreso: false };
        case 'consumo':
            return { tipoMovimiento: 'consumo', esIngreso: false };
        case 'baja':
            return { tipoMovimiento: 'baja', esIngreso: false };
        case 'perdida':
        case 'rotura':
            return { tipoMovimiento: 'baja', esIngreso: false };
        case 'ajuste':
            // Sin signo no puede inferirse si suma o resta: se conserva como legacy de transición.
            return { tipoMovimiento: 'ajuste', esIngreso: false };
        default:
            console.warn(`Migración V9: tipo de movimiento '${tipoLegacy}' sin mapeo canónico, se conserva.`);
            return { tipoMovimiento: tipoLegacy || 'consumo', esIngreso: false };
    }
}

// ============ MIGRACIÓN V10: SEED DEL CATÁLOGO DE TIPOS DE MOVIMIENTO ============
// Seed IDEMPOTENTE de los 6 tipos canónicos con su 'naturaleza' (semántica de stock que
// heredan). Los tipos personalizados que cree el Admin se agregan al mismo store y nunca
// llegan crudos a ajustarStockV9: siempre se resuelve su naturaleza canónica primero.
const SEED_TIPOS_MOVIMIENTO_V10 = [
    { valor: 'ingreso', label: 'Ingreso', naturaleza: 'ingreso' },
    { valor: 'consumo', label: 'Consumo / Salida', naturaleza: 'consumo' },
    { valor: 'transferencia_interna', label: 'Transferencia interna', naturaleza: 'transferencia_interna' },
    { valor: 'devolucion', label: 'Devolución', naturaleza: 'devolucion' },
    { valor: 'baja', label: 'Baja', naturaleza: 'baja' },
    { valor: 'ajuste', label: 'Ajuste', naturaleza: 'ajuste' }
];

async function migrarTiposMovimientoV10() {
    try {
        const existentes = await getTodos('tiposMovimiento', { soloLocal: true });
        const valoresExistentes = new Set((existentes || []).map(t => String(t.valor)));
        let agregados = 0;
        for (const seed of SEED_TIPOS_MOVIMIENTO_V10) {
            if (valoresExistentes.has(seed.valor)) continue;
            await guardar('tiposMovimiento', { ...seed, activo: true });
            agregados++;
        }
        invalidarCache('tiposMovimiento');
        if (agregados > 0) {
            console.log(`Migración V10 OK: catálogo de tipos de movimiento sembrado (${agregados} agregados, ${SEED_TIPOS_MOVIMIENTO_V10.length} canónicos garantizados).`);
        }
    } catch (e) {
        console.warn('Migración V10 no pudo completarse (se reintentará en el próximo arranque):', e);
    }
}

// Migración idempotente: se ejecuta una sola vez tras abrir la base de datos.
async function migrarInventarioV9() {
    try {
        if (localStorage.getItem(DB_MIGRACION_V9_FLAG) === '1') return;
    } catch (e) { /* localStorage no disponible: se reintenta en cada arranque */ }

    console.group('Migración V9 (inventario por ubicación)');
    try {
        await openDB();

        // 1) Reunir todos los nombres de ubicación existentes para sembrar el catálogo.
        const [articulos, articuloTalles, movimientos] = await Promise.all([
            getTodos('articulos', { soloLocal: true }),
            getTodos('articuloTalles', { soloLocal: true }),
            getTodos('movimientosInventario', { soloLocal: true })
        ]);

        const nombresCandidatos = new Set(UBICACIONES_DEFAULT_ORDER);
        try {
            const rawSectores = localStorage.getItem('cda_sectores');
            if (rawSectores) {
                const arr = JSON.parse(rawSectores);
                if (Array.isArray(arr)) {
                    arr.forEach(n => {
                        const limpio = String(n).trim();
                        if (limpio) nombresCandidatos.add(limpio);
                    });
                }
            }
        } catch (e) { /* se usan solo los valores por defecto */ }

        articulos.forEach(a => { if (a && a.sector) nombresCandidatos.add(String(a.sector).trim()); });
        movimientos.forEach(m => {
            if (m && m.sector) nombresCandidatos.add(String(m.sector).trim());
            if (m && m.sectorDestino) nombresCandidatos.add(String(m.sectorDestino).trim());
        });

        // 2) Sembrar el catálogo 'ubicacionesInventario' (mapa nombre canónico -> id).
        const catalogoExistente = await getTodos('ubicacionesInventario', { soloLocal: true });
        const mapaNombreAI = {};
        catalogoExistente.forEach(u => {
            if (u && u.nombre) mapaNombreAI[String(u.nombre).trim()] = Number(u.id);
        });

        const nombresNormalizados = [...nombresCandidatos]
            .map(normalizarNombreUbicacionV9)
            .filter((n, i, arr) => n && arr.findIndex(x => x.toLowerCase() === n.toLowerCase()) === i)
            .sort((a, b) => {
                const ia = UBICACIONES_DEFAULT_ORDER.indexOf(a) === -1 ? Infinity : UBICACIONES_DEFAULT_ORDER.indexOf(a);
                const ib = UBICACIONES_DEFAULT_ORDER.indexOf(b) === -1 ? Infinity : UBICACIONES_DEFAULT_ORDER.indexOf(b);
                return ia - ib;
            });

        let ubicacionesCreadas = 0;
        for (const nombre of nombresNormalizados) {
            if (!mapaNombreAI[nombre]) {
                const u = { nombre, tipo: inferirTipoUbicacionV9(nombre), activo: true };
                await guardar('ubicacionesInventario', u);
                mapaNombreAI[nombre] = Number(u.id);
                ubicacionesCreadas++;
            }
        }
        // Garantía: 'Depósito Central' siempre existe como ubicación canónica.
        if (!mapaNombreAI['Depósito Central']) {
            const u = { nombre: 'Depósito Central', tipo: 'fija', activo: true };
            await guardar('ubicacionesInventario', u);
            mapaNombreAI['Depósito Central'] = Number(u.id);
            ubicacionesCreadas++;
        }

    // 3) Backfill de 'articulos.ubicaciones[]' + recalculo de totales derivados.
        let articulosMigrados = 0;
        let filasCreadas = 0;
        let tallesRecalculados = 0;
        const baseIdFila = Date.now();

        for (const art of articulos) {
            if (!art || typeof art !== 'object') continue;
            if (Array.isArray(art.ubicaciones) && art.ubicaciones.length > 0) continue; // ya migrado

            const sectorNombre = normalizarNombreUbicacionV9(art.sector) || 'Depósito Central';
            const ubicacionId = mapaNombreAI[sectorNombre];
            if (!ubicacionId) {
                console.warn(`Migración V9: artículo ${art.id} sin ubicación válida; se omite.`);
                continue;
            }

            const filas = [];
            const rowsDeTalle = art.controlaTalles
                ? articuloTalles.filter(t => Number(t.articuloId) === Number(art.id))
                : [];

            if (art.controlaTalles) {
                rowsDeTalle.forEach((row, idx) => {
                    filas.push({
                        id: baseIdFila + idx,
                        ubicacionId,
                        talleId: Number(row.talleId),
                        cantidad: Number(row.stock || 0)
                    });
                });
                if (rowsDeTalle.length === 0) {
                    filas.push({ id: baseIdFila, ubicacionId, talleId: null, cantidad: 0 });
                }
            } else {
                filas.push({ id: baseIdFila, ubicacionId, talleId: null, cantidad: Number(art.stockUnico || 0) });
            }

            art.ubicaciones = filas;
            filasCreadas += filas.length;
            articulosMigrados++;

            // Recalcular totales agregados desde la nueva fuente (retro-compatibilidad exacta).
            if (art.controlaTalles) {
                for (const row of rowsDeTalle) {
                    const nuevoStock = filas
                        .filter(f => Number(f.talleId) === Number(row.talleId))
                        .reduce((s, f) => s + Number(f.cantidad || 0), 0);
                    if (Number(row.stock || 0) !== nuevoStock) {
                        row.stock = nuevoStock;
                        await guardar('articuloTalles', row);
                        tallesRecalculados++;
                    }
                }
            } else {
                art.stockUnico = filas.reduce((s, f) => s + Number(f.cantidad || 0), 0);
            }

            await guardar('articulos', art);
        }

        // 4) Normalización semántica del histórico de movimientos.
        let movimientosMigrados = 0;
        for (const mov of movimientos) {
            if (!mov || typeof mov !== 'object') continue;
            if (mov.migradoV9 === true) continue; // ya migrado

            let art = null;
            if (mov.articuloId) {
                art = await obtenerPorId('articulos', Number(mov.articuloId));
            }
            const tipoBien = mov.tipoBien || (art && art.tipoBien) || 'consumible';

            const mapeo = mapearTipoMovimientoV9(mov.tipoMovimiento, tipoBien);
            mov.tipoMovimiento = mapeo.tipoMovimiento;
            mov.esIngreso = mapeo.esIngreso;
            if (!mov.tipoBien) mov.tipoBien = tipoBien;

            mov.ubicacionOrigen = normalizarNombreUbicacionV9(mov.sector) || normalizarNombreUbicacionV9(art && art.sector) || 'Depósito Central';
            if (mov.sectorDestino) {
                mov.ubicacionDestino = normalizarNombreUbicacionV9(mov.sectorDestino);
            } else if (mov.tipoMovimiento === 'devolucion') {
                // Las devoluciones retornan a la ubicación base del artículo (o al depósito).
                mov.ubicacionDestino = normalizarNombreUbicacionV9(art && art.sector) || 'Depósito Central';
            }

            mov.migradoV9 = true;
            await guardar('movimientosInventario', mov);
            movimientosMigrados++;
        }

        try {
            localStorage.setItem(DB_MIGRACION_V9_FLAG, '1');
        } catch (e) { /* ignorar */ }

        if (ubicacionesCreadas > 0 || articulosMigrados > 0 || movimientosMigrados > 0) {
            ['ubicacionesInventario', 'articulos', 'articuloTalles', 'movimientosInventario'].forEach(invalidarCache);
        }

        console.log(`Migración V9 OK → ${ubicacionesCreadas} ubicaciones, ${articulosMigrados} artículos (${filasCreadas} filas), ${tallesRecalculados} talles recalculados, ${movimientosMigrados} movimientos normalizados.`);
    } catch (err) {
        // No se marca el flag: la migración se reintentará en el próximo arranque.
        console.error('Migración V9 no completada:', err);
    } finally {
        console.groupEnd();
    }
}

// ==================== FASE 2: CAPA DE ESCRITURA DE STOCK (helpers unificados) ====================
// Todo ajuste de existencias debe pasar por 'ajustarStockV9()'. Estos helpers centralizan
// la mutación del array embebido 'articulos.ubicaciones[]' y recalculan los totales
// derivados ('stockUnico' y 'articuloTalles[].stock') en una sola secuencia.

let seqFilaV9 = 0;

// Devuelve el stock de un artículo en una ubicación concreta (lectura, sin mutar).
function obtenerStockUbicacionV9(art, talleId, ubicacionId) {
    if (!art || !Array.isArray(art.ubicaciones)) return 0;
    const talle = talleId ? Number(talleId) : null;
    return art.ubicaciones
        .filter(f => Number(f.ubicacionId) === Number(ubicacionId) && String(f.talleId || '') === String(talle || ''))
        .reduce((s, f) => s + Number(f.cantidad || 0), 0);
}

// Resuelve (o crea si falta) una ubicación del catálogo a partir de un id o un nombre.
// Devuelve siempre el id numérico de la ubicación en 'ubicacionesInventario'.
async function resolverUbicacionV9(nombreOId) {
    const catalogo = await getTodos('ubicacionesInventario', { soloLocal: true });
    const esNumero = (typeof nombreOId === 'number') ||
        (typeof nombreOId === 'string' && /^\d+$/.test(String(nombreOId).trim()));
    if (esNumero) {
        const id = Number(nombreOId);
        const existente = catalogo.find(u => Number(u.id) === id);
        if (existente) return id;
        throw new Error(`Ubicación con id ${id} no existe en el catálogo.`);
    }
    const nombre = normalizarNombreUbicacionV9(nombreOId);
    if (!nombre) throw new Error('Ubicación inválida: ' + nombreOId);
    const existente = catalogo.find(u => String(u.nombre).toLowerCase() === nombre.toLowerCase());
    if (existente) return Number(existente.id);
    const nueva = { nombre, tipo: inferirTipoUbicacionV9(nombre), activo: true };
    await guardar('ubicacionesInventario', nueva);
    invalidarCache('ubicacionesInventario');
    return Number(nueva.id);
}
// FASE 2: AJUSTE ATÓMICO DE STOCK. Firma: ajustarStockV9(articuloId, talleId, opciones).
// ingreso/devolucion: +cant en destino | consumo/baja: -cant en origen | transferencia: -origen +destino | ajuste: signo.
async function ajustarStockV9(articuloId, talleId, opciones) {
    const { tipoMovimiento, cantidad, ubicacionOrigenId, ubicacionDestinoId, permitirNegativo } = opciones || {};
    const tipo = String(tipoMovimiento || '').toLowerCase();
    if (!['ingreso', 'consumo', 'transferencia_interna', 'devolucion', 'baja', 'ajuste'].includes(tipo)) {
        throw new Error(`Tipo de movimiento inválido para ajuste de stock: '${tipoMovimiento}'.`);
    }
    const cant = Number(cantidad);
    if (!Number.isFinite(cant) || cant === 0) throw new Error('Cantidad inválida para el ajuste de stock.');
    const idArt = Number(articuloId);
    if (!Number.isFinite(idArt)) throw new Error('Artículo inválido.');
    const art = await obtenerPorId('articulos', idArt);
    if (!art) throw new Error(`Artículo ${idArt} no encontrado.`);
    const talle = talleId ? Number(talleId) : null;
    if (art.controlaTalles && !talle) throw new Error('Para artículos que controlan talles debe indicarse el talle.');
    const esIngreso = tipo === 'ingreso' || tipo === 'devolucion';
    const esEgreso = tipo === 'consumo' || tipo === 'baja';
    // Resolver ubicaciones (id o nombre; crea el catálogo si faltan)
    let idOrigen = null, idDestino = null;
    if (tipo === 'ajuste') {
        idDestino = ubicacionDestinoId != null ? await resolverUbicacionV9(ubicacionDestinoId)
            : (ubicacionOrigenId != null ? await resolverUbicacionV9(ubicacionOrigenId) : await resolverUbicacionV9('Depósito Central'));
        idOrigen = ubicacionOrigenId != null ? await resolverUbicacionV9(ubicacionOrigenId) : idDestino;
    } else if (esIngreso) {
        idDestino = ubicacionDestinoId != null ? await resolverUbicacionV9(ubicacionDestinoId) : await resolverUbicacionV9('Depósito Central');
    } else if (esEgreso) {
        idOrigen = ubicacionOrigenId != null ? await resolverUbicacionV9(ubicacionOrigenId) : await resolverUbicacionV9('Depósito Central');
    } else {
        idOrigen = await resolverUbicacionV9(ubicacionOrigenId != null ? ubicacionOrigenId : 'Depósito Central');
        idDestino = await resolverUbicacionV9(ubicacionDestinoId != null ? ubicacionDestinoId : 'Depósito Central');
        if (idOrigen === idDestino) throw new Error('La transferencia debe usar ubicaciones de origen y destino distintas.');
    }
    // Backfill de articulos.ubicaciones[] si el documento es legacy (pre-migración)
    if (!Array.isArray(art.ubicaciones) || art.ubicaciones.length === 0) {
        const locBase = await resolverUbicacionV9(art.sector || 'Depósito Central');
        art.ubicaciones = [];
        if (art.controlaTalles) {
            const tallesArt = await getTodos('articuloTalles');
            const filasT = tallesArt.filter(t => Number(t.articuloId) === idArt);
            filasT.forEach((f, i) => art.ubicaciones.push({ id: Date.now() + i, ubicacionId: locBase, talleId: Number(f.talleId), cantidad: Number(f.stock || 0) }));
            if (filasT.length === 0) art.ubicaciones.push({ id: Date.now(), ubicacionId: locBase, talleId: null, cantidad: 0 });
        } else {
            art.ubicaciones.push({ id: Date.now(), ubicacionId: locBase, talleId: null, cantidad: Number(art.stockUnico || 0) });
        }
    }
    // Clave por (ubicacion, talle) → deltas en seco (dry-run)
    const talleFilas = art.controlaTalles ? talle : null;
    const claveUbi = (idUbi) => `${Number(idUbi)}|${talleFilas ? Number(talleFilas) : 'null'}`;
    const deltas = {};
    const addDelta = (idUbi, delta) => { const k = claveUbi(idUbi); deltas[k] = (deltas[k] || 0) + delta; };
    if (tipo === 'ajuste') { if (cant < 0) addDelta(idOrigen, cant); else addDelta(idDestino, cant); }
    else if (esIngreso) addDelta(idDestino, cant);
    else if (esEgreso) addDelta(idOrigen, -cant);
    else { addDelta(idOrigen, -cant); addDelta(idDestino, cant); }
    // Validación anti-negativos ANTES de mutar (se puede saltear con permitirNegativo:
    // excepción reservada al Administrador desde la botonera de Impacto en Stock).
    const catalogo = await getTodos('ubicacionesInventario', { soloLocal: true });
    const nombreDe = (idUbi) => { const u = catalogo.find(x => Number(x.id) === Number(idUbi)); return u ? u.nombre : String(idUbi); };
    if (!permitirNegativo) {
        for (const k of Object.keys(deltas)) {
            const idUbi = Number(k.split('|')[0]);
            const fila = art.ubicaciones.find(f => claveUbi(f.ubicacionId) === k);
            const disponible = fila ? Number(fila.cantidad || 0) : 0;
            if (disponible + deltas[k] < 0) {
                throw new Error(`Stock insuficiente en "${nombreDe(idUbi)}": disponible ${disponible}, solicitado ${Math.abs(deltas[k])}.`);
            }
        }
    }
    // Aplicar mutación (una sola escritura del documento + Firestore)
    for (const k of Object.keys(deltas)) {
        let fila = art.ubicaciones.find(f => claveUbi(f.ubicacionId) === k);
        if (!fila) {
            fila = { id: Date.now() + (++seqFilaV9), ubicacionId: Number(k.split('|')[0]), talleId: talleFilas, cantidad: 0 };
            art.ubicaciones.push(fila);
        }
        fila.cantidad = Number(fila.cantidad || 0) + deltas[k];
    }
    // Recalculos derivados (regla de oro) y persistencia
    if (art.controlaTalles) {
        const stockTalle = art.ubicaciones.filter(f => Number(f.talleId) === talle).reduce((s, f) => s + Number(f.cantidad || 0), 0);
        const tallesArt = await getTodos('articuloTalles');
        const talleArt = tallesArt.find(t => Number(t.articuloId) === idArt && Number(t.talleId) === talle);
        if (talleArt) { talleArt.stock = stockTalle; await guardar('articuloTalles', talleArt); }
        else await guardar('articuloTalles', { articuloId: idArt, talleId: talle, stock: stockTalle });
    }
    // Invariante: stockUnico = SUMA DE TODAS las ubicaciones, incluidos los Bienes de Uso
    // asignados a Camión/Carrera/etc. Una 'transferencia_interna' NO debe reducirlo: solo
    // mueve unidades (resta en origen y suma en destino, neto cero sobre el total).
    art.stockUnico = art.ubicaciones.reduce((s, f) => s + Number(f.cantidad || 0), 0);
    await guardar('articulos', art);
    invalidarCache('articulos');
    invalidarCache('articuloTalles');
    return { ok: true, tipoAplicado: tipo, cantidad: Math.abs(cant), stockNuevo: art.stockUnico };
}

// Helper genérico para limpiar valores no soportados por Firebase como undefined
function limpiarObjetoParaFirebase(value) {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (Array.isArray(value)) {
        return value.map(limpiarObjetoParaFirebase);
    }
    if (typeof value === 'object') {
        const result = {};
        for (const [key, item] of Object.entries(value)) {
            if (item === undefined) continue;
            const cleaned = limpiarObjetoParaFirebase(item);
            if (cleaned !== undefined) {
                result[key] = cleaned;
            }
        }
        return result;
    }
    return value;
}

// ============================================================
// CONTROL DEFENSIVO DE TRANSACCIONES (V11)
// ============================================================
// Si un object store falta físicamente en IndexedDB (esquema inconsistente tras una migración
// a medio camino), db.transaction([storeName], ...) lanza "NotFoundError" NO capturado que
// congela el hilo de ejecuciones y bloquea la UI. Este helper verifica que el store exista
// ANTES de abrir la transacción; si no existe, registra un mensaje limpio y devuelve null para
// que el llamador degrade con gracia (resultado vacío / aborto controlado) en vez de explotar.
function abrirTransaccionDefensiva(db, storeName, modo) {
    if (!db || typeof db.objectStoreNames === 'undefined' || typeof db.transaction !== 'function') {
        console.warn(`[db] Sin conexión válida a IndexedDB. No se pudo abrir transacción sobre '${storeName}'.`);
        return null;
    }
    if (!db.objectStoreNames.contains(storeName)) {
        console.warn(`[db] El object store '${storeName}' NO existe en IndexedDB (esquema inconsistente). ` +
            'Se omite la transacción. La migración V11 debería crearlo físicamente al reabrir.');
        return null;
    }
    return db.transaction([storeName], modo);
}

// ==================== SINCRONIZACIÓN: DATOS SENSIBLES, VALIDACIÓN Y VERSIONES (FASE 3) ====================

// Stores PROHIBIDOS de sincronizar con la nube (A-4): operan SOLO en IndexedDB local.
// - 'usuarios': contiene passwordHash; jamás debe viajar a Firestore.
// - 'configuracionGlobal': ajustes de la app puramente locales.
const STORES_NO_SYNC = Object.freeze(['usuarios', 'configuracionGlobal']);

function esStoreSincronizable(storeName) {
    return !STORES_NO_SYNC.includes(storeName);
}

// Compara dos versiones de un registro para resolución defensiva de conflictos (A-3).
// Gana el de mayor `version`; ante empate, el de `updatedAt` más reciente.
function esMasReciente(a, b) {
    const va = Number(a && a.version) || 0;
    const vb = Number(b && b.version) || 0;
    if (va !== vb) return va > vb;
    const ta = a && a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const tb = b && b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return ta > tb;
}

// Validador interceptor simple (A-5): evita persistir objetos corruptos en IndexedDB/Firestore.
// - Problemas GRAVES (no es objeto / falta id / funciones / NaN / circular) abortan la escritura.
function validarRegistro(storeName, item) {
    const resultado = { ok: true, motivo: '' };

    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
        resultado.ok = false;
        resultado.motivo = `[${storeName}] No se escribió: el registro no es un objeto simple.`;
        return resultado;
    }

    if (typeof item.id === 'undefined') {
        resultado.ok = false;
        resultado.motivo = `[${storeName}] No se escribió: falta el campo 'id'.`;
        return resultado;
    }

    const prohibidos = Object.values(item).some(
        (v) => typeof v === 'function' || (typeof v === 'number' && Number.isNaN(v))
    );
    if (prohibidos) {
        resultado.ok = false;
        resultado.motivo = `[${storeName}] No se escribió: el registro contiene funciones o NaN.`;
        return resultado;
    }

    // Referencias circulares → romperían JSON/IndexedDB/Firestore.
    try {
        JSON.stringify(item);
    } catch (e) {
        resultado.ok = false;
        resultado.motivo = `[${storeName}] No se escribió: el registro contiene referencias circulares.`;
        return resultado;
    }

    return resultado;
}

// FASE 6: la lógica real de persistencia vive en src/services/persistenceService.js.
async function guardar(storeName, item) {
    const p = typeof window !== 'undefined' ? window.__CDA_MODULES__?.persistencia : null;
    if (p && typeof p.guardar === 'function') return p.guardar(storeName, item);
    return null; // degradación controlada
}

// FASE 6: la lógica real de persistencia vive en src/services/persistenceService.js.
async function getTodos(storeName, opciones = {}) {
    const p = typeof window !== 'undefined' ? window.__CDA_MODULES__?.persistencia : null;
    if (p && typeof p.getTodos === 'function') return p.getTodos(storeName, opciones);
    return [];
}

// FASE 6: la lógica real de persistencia vive en src/services/persistenceService.js.
async function eliminar(storeName, id) {
    const p = typeof window !== 'undefined' ? window.__CDA_MODULES__?.persistencia : null;
    if (p && typeof p.eliminar === 'function') return p.eliminar(storeName, id);
}

// FASE 6: la lógica real de persistencia vive en src/services/persistenceService.js.
async function obtenerPorId(storeName, id) {
    const p = typeof window !== 'undefined' ? window.__CDA_MODULES__?.persistencia : null;
    if (p && typeof p.obtenerPorId === 'function') return p.obtenerPorId(storeName, id);
    return null;
}

// Variable global para que la UI muestre el estado de la sincronización
if (typeof window !== 'undefined') {
    window.firebaseSyncResult = { status: 'pending', message: 'Conectando...', count: 0 };
}

// Obtiene los nombres REALES de las colecciones desde IndexedDB (fuente de verdad local)
// para garantizar que la sincronización apunte exactamente a las mismas colecciones
// que usa la aplicación (evita desajustes de nombres entre local y nube).
async function obtenerNombresColeccionesLocales() {
    const db = await openDB();
    return Array.from(db.objectStoreNames);
}

// FASE 6: la lógica real de sincronización vive en src/services/persistenceService.js.
async function sincronizarFirebaseALocal(stores) {
    const p = typeof window !== 'undefined' ? window.__CDA_MODULES__?.persistencia : null;
    if (p && typeof p.sincronizarFirebaseALocal === 'function') return p.sincronizarFirebaseALocal(stores);
    return 0;
}

// FASE 6: la lógica real de sincronización vive en src/services/persistenceService.js.
async function sincronizarLocalAFirebase() {
    const p = typeof window !== 'undefined' ? window.__CDA_MODULES__?.persistencia : null;
    if (p && typeof p.sincronizarLocalAFirebase === 'function') return p.sincronizarLocalAFirebase();
}

// Función para importar datos desde backup
async function importarTodo(datos) {
    limpiarCacheCompleto(); // limpiar todo el caché antes de importar
    const db = await openDB();
    const stores = ['categorias', 'circuitos', 'staff', 'competencias', 'gastos', 'rendiciones', 'detalleGastos', 'adjuntos', 'proveedores', 'campeonatos', 'categoriasInventario', 'subcategoriasInventario', 'talles', 'articulos', 'articuloTalles', 'movimientosInventario', 'entregasInventario', 'detalleEntregas', 'imagenesArticulo', 'personalCompetencia', 'alojamientos', 'ubicacionesInventario', 'tiposMovimiento'];
    
    for (const storeName of stores) {
        if (datos[storeName]) {
            const transaction = abrirTransaccionDefensiva(db, storeName, 'readwrite');
            if (!transaction) { continue; } // store faltante: se omite con un log limpio ya emitido
            const store = transaction.objectStore(storeName);
            
            await new Promise((res, rej) => {
                const reqClear = store.clear();
                reqClear.onsuccess = () => res();
                reqClear.onerror = () => rej(reqClear.error);
            });

            for (const item of datos[storeName]) {
                await new Promise((res, rej) => {
                    const reqPut = store.put(item);
                    reqPut.onsuccess = () => res();
                    reqPut.onerror = () => rej(reqPut.error);
                });
            }
            // After importing this store, update cache so reads are immediate
            _cache[storeName] = Array.isArray(datos[storeName]) ? datos[storeName].map(x => Object.assign({}, x)) : [];
        }
    }
}