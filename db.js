// db.js - Gestión de Base de Datos Local con IndexedDB e integración con Firebase

const DB_NAME = 'ControlAutomovilismoDB';
const DB_VERSION = 8;

let dbInstance = null;

// ==================== CACHÉ EN MEMORIA ====================
// Evita leer IndexedDB/Firebase en cada cambio de vista.
// Se invalida solo cuando se escriben/eliminan datos.
const _cache = {};

// Rastrea qué colecciones ya se intentaron leer desde la nube (Firestore)
// para evitar lecturas repetidas innecesarias cuando ambas fuentes están vacías.
const _cloudChecked = {};

// ==================== INTEGRACIÓN CON FIREBASE ====================
let dbFirebase = null;
let useFirebase = false;

const DEFAULT_FIREBASE_CONFIG = {
    apiKey: "AIzaSyAGT318kBRICwdjrU05RCUNSJRanAQnfPQ",
    projectId: "controlcda-e5f97",
    storageBucket: "controlcda-e5f97.firebasestorage.app",
    messagingSenderId: "971822887261",
    appId: "1:971822887261:web:abe3fd29049c176946f8b4",
    measurementId: "G-L5C4YLVW1V"
};

// Detecta el entorno actual y devuelve el authDomain correcto
function obtenerAuthDomainDinamico() {
    const hostname = window.location.hostname;
    // Si estamos en GitHub Pages (producción), usar el dominio de GitHub Pages
    if (hostname.includes('github.io')) {
        return hostname; // Ej: nicofern-01.github.io
    }
    // Si estamos en localhost o cualquier otro entorno, usar el authDomain de Firebase
    return 'controlcda-e5f97.firebaseapp.com';
}

// Obtiene la configuración completa de Firebase, ajustando authDomain dinámicamente
function obtenerConfigFirebase() {
    const configStr = localStorage.getItem('firebase_config');
    let config;
    
    if (configStr) {
        try {
            config = JSON.parse(configStr);
        } catch (err) {
            console.warn('Configuración Firebase inválida en localStorage, usando configuración por defecto.', err);
            config = { ...DEFAULT_FIREBASE_CONFIG };
        }
    } else {
        config = { ...DEFAULT_FIREBASE_CONFIG };
    }
    
    // Ajustar authDomain dinámicamente según el entorno
    // Si el usuario no especificó un authDomain, o si estamos en GitHub Pages,
    // usar el authDomain dinámico
    if (!config.authDomain || window.location.hostname.includes('github.io')) {
        config.authDomain = obtenerAuthDomainDinamico();
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
let authFirebase = null;

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


// ==================== VERIFICACIÓN DE CONFIGURACIÓN FIREBASE ====================
// Al cargar la página, verificar que la configuración guardada tenga el authDomain correcto
// para el entorno actual (especialmente GitHub Pages en producción)
(function verificarConfigFirebaseAlCargar() {
    try {
        const configStr = localStorage.getItem('firebase_config');
        if (configStr) {
            const config = JSON.parse(configStr);
            const hostname = window.location.hostname;
            
            // Si estamos en GitHub Pages y el authDomain no coincide, actualizarlo
            if (hostname.includes('github.io') && config.authDomain !== hostname) {
                console.log('Actualizando authDomain para GitHub Pages:', hostname);
                config.authDomain = hostname;
                localStorage.setItem('firebase_config', JSON.stringify(config));
            }
        }
    } catch (e) {
        console.warn('Error al verificar configuración Firebase:', e);
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
            { nombre: 'TC2000', descripcion: 'La máxima expresión tecnológica de autos de turismo.' },
            { nombre: 'Top Race V6', descripcion: 'Autos de alta potencia con carrocerías siluetas.' },
            { nombre: 'Top Race Series', descripcion: 'Categoría escuela y antesala del TRV6.' },
            { nombre: 'Fórmula Nacional', descripcion: 'Histórico semillero oficial de monoplazas.' },
            { nombre: 'Fiat Competizione', descripcion: 'Monomarca nacional' },
            { nombre: 'Argentino de Karting', descripcion: 'Rotax y Iame series' }
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
    // Comprobar si hay usuarios - crear admin por defecto si no existe ninguno
    const usuarios = await getTodos('usuarios');
    if (usuarios.length === 0) {
        // Generar una contraseña aleatoria segura y mostrarla al usuario
        const tempPassword = generarPasswordTemporal();
        const passwordHash = await hashPassword(tempPassword);
        await guardar('usuarios', {
            username: 'admin',
            passwordHash,
            nombre: 'Administrador',
            rol: 'admin', // 'admin' | 'editor' | 'viewer'
            activo: true,
            requiereCambioPassword: true
        });
        console.warn(`⚠️ Usuario admin creado con contraseña temporal: ${tempPassword}`);
        console.warn('⚠️ IMPORTANTE: Cambie esta contraseña inmediatamente desde Configuración > Usuarios.');
        alert(`Se creó el usuario administrador inicial.\n\nUsuario: admin\nContraseña temporal: ${tempPassword}\n\nIMPORTANTE: Cambie esta contraseña inmediatamente desde Configuración > Usuarios.`);
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
            { nombre: 'Indumentaria', descripcion: 'Prendas y uniformes', activo: true, controlaTalles: true },
            { nombre: 'Banderas', descripcion: 'Banderas y banderines', activo: true, controlaTalles: false },
            { nombre: 'Equipamiento', descripcion: 'Equipamiento general', activo: true, controlaTalles: false },
            { nombre: 'Herramientas', descripcion: 'Herramientas manuales y eléctricas', activo: true, controlaTalles: false },
            { nombre: 'Papelería', descripcion: 'Papelería e impresos', activo: true, controlaTalles: false },
            { nombre: 'Electrónica', descripcion: 'Dispositivos electrónicos', activo: true, controlaTalles: false },
            { nombre: 'Comunicación', descripcion: 'Equipos de comunicación', activo: true, controlaTalles: false },
            { nombre: 'Mobiliario', descripcion: 'Muebles y mobiliario', activo: true, controlaTalles: false },
            { nombre: 'Consumibles', descripcion: 'Materiales consumibles', activo: true, controlaTalles: false },
            { nombre: 'Repuestos', descripcion: 'Repuestos y recambios', activo: true, controlaTalles: false },
            { nombre: 'Material Deportivo', descripcion: 'Material deportivo y pista', activo: true, controlaTalles: false },
            { nombre: 'Seguridad', descripcion: 'Elementos de seguridad', activo: true, controlaTalles: false },
            { nombre: 'Otros', descripcion: 'Otros artículos', activo: true, controlaTalles: false }
        ];
        for (const c of categoriasInventario) {
            await guardar('categoriasInventario', c);
        }
    }
}

// Generar contraseña temporal segura
function generarPasswordTemporal() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
    let password = '';
    const array = new Uint32Array(12);
    crypto.getRandomValues(array);
    for (let i = 0; i < 12; i++) {
        password += chars[array[i] % chars.length];
    }
    return password;
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

// Helper genérico para guardar o actualizar un elemento
async function guardar(storeName, item) {
    // Si la ID no existe, generamos un identificador numérico único basado en timestamp
    if (!item.id) {
        item.id = Date.now() + Math.floor(Math.random() * 1000);
    } else {
        item.id = Number(item.id);
    }

    // SIEMPRE guardar primero en IndexedDB (fuente primaria local)
    const result = await new Promise((resolve, reject) => {
        openDB().then(db => {
            const transaction = db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.put(item);

            request.onsuccess = (event) => {
                const key = event.target.result;
                try { if (!item.id) item.id = Number(key); } catch(e) {}

                // Update in-memory cache if present so UI sees changes immediately
                if (_cache[storeName]) {
                    const idx = _cache[storeName].findIndex(x => Number(x.id) === Number(item.id));
                    const clone = Object.assign({}, item);
                    if (idx >= 0) {
                        _cache[storeName][idx] = clone;
                    } else {
                        _cache[storeName].push(clone);
                    }
                }

                resolve(key);
            };

            request.onerror = (event) => {
                reject(`Error al guardar en ${storeName}: ` + event.target.error);
            };
        }).catch(reject);
    });

    // También sincronizar con Firebase si está conectado (no bloqueante, no revienta si falla)
    if (useFirebase) {
        try {
            const docRef = doc(dbFirebase, storeName, String(item.id));
            const itemToSync = limpiarObjetoParaFirebase(item);
            await setDoc(docRef, itemToSync);
        } catch (e) {
            console.warn(`Firebase sync warning [${storeName}]:`, e);
            // No lanzar error - la app sigue funcionando con datos locales
        }
    }

    return result;
}

// Helper genérico para obtener todos los elementos (con caché)
// opciones.soloLocal: true → no intentar leer desde Firestore si IndexedDB está vacío
// (usado por la sincronización local→nube para evitar lecturas redundantes a la nube)
async function getTodos(storeName, opciones = {}) {
    // Si hay datos en caché (no vacíos), los devuelve directamente sin tocar la BD
    if (_cache[storeName] && _cache[storeName].length > 0) {
        return _cache[storeName];
    }

    // SIEMPRE leer desde IndexedDB como fuente primaria. Firebase es solo para escritura/sync.
    const dataLocal = await new Promise((resolve, reject) => {
        openDB().then(db => {
            const transaction = db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.getAll();

            request.onsuccess = (event) => {
                _cache[storeName] = event.target.result; // guardar en caché
                resolve(event.target.result);
            };

            request.onerror = (event) => {
                reject(`Error al leer de ${storeName}: ` + event.target.error);
            };
        }).catch(reject);
    });

    // OPTIMIZACIÓN DE LAS FUNCIONES DE CARGA DE DATOS (GETDOCS):
    // Si la colección local (IndexedDB) está vacía y Firebase está conectado,
    // forzar un 'await getDocs(collection(dbFirebase, storeName))' directo a la nube
    // para no quedarse congelado apuntando a un almacenamiento local vacío.
    if (dataLocal.length === 0 && !opciones.soloLocal && useFirebase && dbFirebase && typeof getDocs === 'function' && typeof collection === 'function' && !_cloudChecked[storeName]) {
        _cloudChecked[storeName] = true;
        try {
            console.log(`Colección '${storeName}' vacía en IndexedDB. Forzando lectura directa desde Firestore...`);
            const querySnapshot = await getDocs(collection(dbFirebase, storeName));
            const dataNube = [];
            querySnapshot.forEach(docSnap => {
                const item = docSnap.data();
                item.id = Number(docSnap.id) || docSnap.id;
                dataNube.push(item);
            });
            _cache[storeName] = dataNube;

            // Guardar en IndexedDB para futuras cargas rápidas sin depender de la red
            if (dataNube.length > 0) {
                try {
                    const db = await openDB();
                    const transaction = db.transaction([storeName], 'readwrite');
                    const store = transaction.objectStore(storeName);
                    for (const item of dataNube) {
                        store.put(item);
                    }
                } catch (e) {
                    console.warn(`No se pudo guardar en IndexedDB la colección '${storeName}':`, e);
                }
            }

            console.log(`Colección '${storeName}' cargada desde Firestore: ${dataNube.length} registros.`);
            return dataNube;
        } catch (e) {
            console.warn(`Error al leer '${storeName}' desde Firestore:`, e);
        }
    }

    return dataLocal;
}

// Helper genérico para eliminar por ID
async function eliminar(storeName, id) {
    // SIEMPRE eliminar primero de IndexedDB (fuente primaria local)
    await new Promise((resolve, reject) => {
        openDB().then(db => {
            const transaction = db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.delete(Number(id));

            request.onsuccess = () => {
                // Update in-memory cache if present so UI updates immediately
                if (_cache[storeName]) {
                    _cache[storeName] = _cache[storeName].filter(x => Number(x.id) !== Number(id));
                }
                resolve();
            };

            request.onerror = (event) => {
                reject(`Error al eliminar en ${storeName}: ` + event.target.error);
            };
        }).catch(reject);
    });

    // También sincronizar con Firebase si está conectado (no bloqueante)
    if (useFirebase) {
        try {
            await deleteDoc(doc(dbFirebase, storeName, String(id)));
        } catch (e) {
            console.warn(`Firebase delete sync warning [${storeName}]:`, e);
            // No lanzar error - la app sigue funcionando con datos locales
        }
    }
}

// Helper genérico para obtener por ID
async function obtenerPorId(storeName, id) {
    if (_cache[storeName]) {
        const found = _cache[storeName].find(x => Number(x.id) === Number(id));
        if (found) return found;
    }

    // SIEMPRE leer desde IndexedDB como fuente primaria. Firebase es solo para escritura/sync.
    return new Promise((resolve, reject) => {
        openDB().then(db => {
            const transaction = db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.get(Number(id));

            request.onsuccess = (event) => {
                resolve(event.target.result);
            };

            request.onerror = (event) => {
                reject(`Error al obtener de ${storeName} con id ${id}: ` + event.target.error);
            };
        }).catch(reject);
    });
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

// Sincronizar todos los datos locales (IndexedDB) a Firebase
// Se ejecuta automáticamente cuando Firebase se conecta.
// VERIFICACIÓN Y CREACIÓN DE COLECCIONES LOCALES -> NUBE:
// - Descubre dinámicamente los nombres reales de las colecciones desde IndexedDB.
// - Verifica si Firestore está vacía (0 registros) en cada colección.
// - Si está vacía, sube OBLIGATORIAMENTE TODOS los registros locales uno por uno,
//   conservando la misma estructura.
// - Al finalizar, dispara un evento para que la interfaz se recargue de inmediato.
async function sincronizarLocalAFirebase() {
    if (!useFirebase || !dbFirebase) {
        if (typeof window !== 'undefined') {
            window.firebaseSyncResult = { status: 'error', message: 'Firebase no está conectado.', count: 0 };
        }
        return;
    }

    // 1) Descubrir dinámicamente los nombres REALES de las colecciones desde IndexedDB
    let stores;
    try {
        stores = await obtenerNombresColeccionesLocales();
        console.log('Colecciones locales detectadas en IndexedDB:', stores);
    } catch (e) {
        console.warn('No se pudieron obtener las colecciones locales, usando lista por defecto:', e);
        stores = ['categorias', 'circuitos', 'staff', 'competencias', 'gastos', 'conceptos', 'usuarios', 'rendiciones', 'detalleGastos', 'adjuntos', 'proveedores', 'campeonatos', 'categoriasInventario', 'subcategoriasInventario', 'talles', 'articulos', 'articuloTalles', 'movimientosInventario', 'entregasInventario', 'detalleEntregas', 'imagenesArticulo', 'personalCompetencia', 'alojamientos'];
    }

    let total = 0;
    const detalle = [];

    for (const storeName of stores) {
        // 2) VERIFICAR si Firestore ya tiene datos en esta colección
        let registrosNube = 0;
        try {
            const snapNube = await getDocs(collection(dbFirebase, storeName));
            registrosNube = snapNube.size;
        } catch (e) {
            console.warn(`No se pudo verificar la colección '${storeName}' en Firestore:`, e);
        }

        // 3) Si Firestore está VACÍA (0 registros), subir TODOS los registros locales
        if (registrosNube === 0) {
            // Leer desde IndexedDB (forzando sin caché y sin intentar leer de la nube,
            // porque ya sabemos que Firestore está vacía)
            invalidarCache(storeName);
            const data = await getTodos(storeName, { soloLocal: true });
            for (const item of data) {
                try {
                    const docRef = doc(dbFirebase, storeName, String(item.id));
                    const itemToSync = limpiarObjetoParaFirebase(item);
                    await setDoc(docRef, itemToSync);
                    total++;
                } catch (e) {
                    console.warn(`Error sync ${storeName}/${item.id}:`, e);
                }
            }
            if (data.length > 0) {
                detalle.push(`${storeName}: ${data.length} registros subidos (Firestore estaba vacía)`);
                console.log(`Colección '${storeName}': Firestore vacía → subidos ${data.length} registros locales.`);
            } else {
                detalle.push(`${storeName}: 0 registros (local y nube vacíos)`);
            }
        } else {
            detalle.push(`${storeName}: ${registrosNube} registros ya en Firestore (se omite subida)`);
            console.log(`Colección '${storeName}': ya tiene ${registrosNube} registros en Firestore. Se omite la subida.`);
        }
    }

    if (typeof window !== 'undefined') {
        window.firebaseSyncResult = { status: 'synced', message: `Completado: ${total} registros subidos.`, count: total, detalle };
    }
    console.log(`Sincronización local→Firebase completada: ${total} registros subidos.`);
    console.log('Detalle de sincronización:', detalle);

    // RENDERIZADO ASÍNCRONO DE LA INTERFAZ:
    // Disparar evento para que la interfaz gráfica se recargue de inmediato
    // y dibuje los datos descargados/subidos sin necesidad de recargar la página.
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('firebase-sync-complete', { detail: { total, detalle } }));
    }
}

// Función para importar datos desde backup
async function importarTodo(datos) {
    limpiarCacheCompleto(); // limpiar todo el caché antes de importar
    const db = await openDB();
    const stores = ['categorias', 'circuitos', 'staff', 'competencias', 'gastos', 'rendiciones', 'detalleGastos', 'adjuntos', 'proveedores', 'campeonatos', 'categoriasInventario', 'subcategoriasInventario', 'talles', 'articulos', 'articuloTalles', 'movimientosInventario', 'entregasInventario', 'detalleEntregas', 'imagenesArticulo', 'personalCompetencia', 'alojamientos'];
    
    for (const storeName of stores) {
        if (datos[storeName]) {
            const transaction = db.transaction([storeName], 'readwrite');
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