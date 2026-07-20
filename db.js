// db.js - Gestión de Base de Datos Local con IndexedDB e integración con Firebase

const DB_NAME = 'ControlAutomovilismoDB';
const DB_VERSION = 3;

let dbInstance = null;

// ==================== CACHÉ EN MEMORIA ====================
// Evita leer IndexedDB/Firebase en cada cambio de vista.
// Se invalida solo cuando se escriben/eliminan datos.
const _cache = {};

// ==================== INTEGRACIÓN CON FIREBASE ====================
let dbFirebase = null;
let useFirebase = false;

// Variables de módulos de Firebase
let initializeApp, getFirestore, collection, doc, setDoc, getDocs, getDoc, deleteDoc, writeBatch;

async function inicializarFirebase() {
    const configStr = localStorage.getItem('firebase_config');
    if (!configStr) {
        useFirebase = false;
        return false;
    }
    try {
        const config = JSON.parse(configStr);

        // Cargamos módulos oficiales de Firebase v10 desde gstatic CDN para ES Modules
        const appMod = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js');
        const fsMod = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js');

        initializeApp = appMod.initializeApp;
        getFirestore = fsMod.getFirestore;
        collection = fsMod.collection;
        doc = fsMod.doc;
        setDoc = fsMod.setDoc;
        getDocs = fsMod.getDocs;
        getDoc = fsMod.getDoc;
        deleteDoc = fsMod.deleteDoc;
        writeBatch = fsMod.writeBatch;

        const app = initializeApp(config);
        dbFirebase = getFirestore(app);

        // Habilitar persistencia de datos localmente (offline cache) en Firestore
        try {
            await fsMod.enableMultiTabIndexedDbPersistence(dbFirebase);
            console.log('Persistencia offline de Firebase Firestore habilitada.');
        } catch (err) {
            if (err.code == 'failed-precondition') {
                console.warn('Múltiples pestañas abiertas, persistencia habilitada solo en la principal.');
            } else if (err.code == 'unimplemented') {
                console.warn('El navegador no soporta persistencia offline para Firestore.');
            }
        }

        useFirebase = true;
        window.useFirebase = true; // exposición global para depuración
        console.log('Sincronización con Firebase Firestore activa.');

        // Sincronizar automáticamente todos los datos locales a Firebase
        // Esto resuelve el problema de datos creados antes de que Firebase termine de inicializar
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

// Intentar inicializar Firebase en segundo plano de inmediato
inicializarFirebase();

// Limpiar toda la caché al cargar la página para evitar datos obsoletos
limpiarCacheCompleto();

function invalidarCache(storeName) {
    delete _cache[storeName];
}

function limpiarCacheCompleto() {
    Object.keys(_cache).forEach(k => delete _cache[k]);
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
        };

        request.onsuccess = (event) => {
            dbInstance = event.target.result;
            resolve(dbInstance);
        };

        request.onerror = (event) => {
            reject('Error al abrir la base de datos: ' + event.target.errorCode);
        };
    });
}

// Función hash simple para contraseñas (no criptográfica, suficiente para uso local)
function hashPassword(password) {
    let hash = 0;
    for (let i = 0; i < password.length; i++) {
        const char = password.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return 'hash_' + Math.abs(hash).toString(16) + '_' + password.length;
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
        await guardar('usuarios', {
            username: 'admin',
            passwordHash: hashPassword('admin123'),
            nombre: 'Administrador',
            rol: 'admin', // 'admin' | 'editor' | 'viewer'
            activo: true
        });
    }
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
            await setDoc(docRef, item);
        } catch (e) {
            console.warn(`Firebase sync warning [${storeName}]:`, e);
            // No lanzar error - la app sigue funcionando con datos locales
        }
    }

    return result;
}

// Helper genérico para obtener todos los elementos (con caché)
async function getTodos(storeName) {
    // Si hay datos en caché, los devuelve directamente sin tocar la BD
    if (_cache[storeName]) {
        return _cache[storeName];
    }

    // SIEMPRE leer desde IndexedDB como fuente primaria. Firebase es solo para escritura/sync.
    return new Promise((resolve, reject) => {
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

// Sincronizar todos los datos locales (IndexedDB) a Firebase
// Se ejecuta automáticamente cuando Firebase se conecta
async function sincronizarLocalAFirebase() {
    if (!useFirebase || !dbFirebase) {
        if (typeof window !== 'undefined') {
            window.firebaseSyncResult = { status: 'error', message: 'Firebase no está conectado.', count: 0 };
        }
        return;
    }

    const stores = ['categorias', 'circuitos', 'staff', 'competencias', 'gastos', 'conceptos', 'usuarios'];
    let total = 0;

    for (const storeName of stores) {
        // Leer desde IndexedDB (forzando sin caché)
        invalidarCache(storeName);
        const data = await getTodos(storeName);
        for (const item of data) {
            try {
                const docRef = doc(dbFirebase, storeName, String(item.id));
                await setDoc(docRef, item);
                total++;
            } catch (e) {
                console.warn(`Error sync ${storeName}/${item.id}:`, e);
            }
        }
    }

    if (typeof window !== 'undefined') {
        window.firebaseSyncResult = { status: 'synced', message: `Completado: ${total} registros.`, count: total };
    }
    console.log(`Sincronización local→Firebase completada: ${total} registros subidos.`);
}

// Función para importar datos desde backup
async function importarTodo(datos) {
    limpiarCacheCompleto(); // limpiar todo el caché antes de importar
    const db = await openDB();
    const stores = ['categorias', 'circuitos', 'staff', 'competencias', 'gastos'];
    
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




