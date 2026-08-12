const fs = require('fs');

// ============================================================
// 1) MODIFICAR db.js: Importar módulo de Firebase Auth
// ============================================================
const dbPath = 'db.js';
let db = fs.readFileSync(dbPath, 'utf8');
const dbLog = [];

// --- 1a) Agregar variables para módulo de Auth ---
const oldVars = `// Variables de módulos de Firebase
let initializeApp, initializeFirestore, getFirestore, collection, doc, setDoc, getDocs, getDoc, deleteDoc, writeBatch, query, where;
let getStorage, refStorage, uploadBytes, getDownloadURL, deleteObject;
let storageFirebase = null;`;

const newVars = `// Variables de módulos de Firebase
let initializeApp, initializeFirestore, getFirestore, collection, doc, setDoc, getDocs, getDoc, deleteDoc, writeBatch, query, where;
let getStorage, refStorage, uploadBytes, getDownloadURL, deleteObject;
let storageFirebase = null;

// Variables de módulo de Firebase Auth
let getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut, createUserWithEmailAndPassword;
let authFirebase = null;`;

if (db.indexOf(oldVars) !== -1) {
    db = db.replace(oldVars, newVars);
    dbLog.push('OK: Variables de Firebase Auth agregadas en db.js');
} else {
    dbLog.push('WARN: No se encontró el bloque de variables de Firebase en db.js');
}

// --- 1b) Importar módulo de Auth en inicializarFirebase() ---
const oldImport = `        // Cargamos módulos oficiales de Firebase v10 desde gstatic CDN para ES Modules
        const appMod = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js');
        const fsMod = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js');
        const storageMod = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js');`;

const newImport = `        // Cargamos módulos oficiales de Firebase v10 desde gstatic CDN para ES Modules
        const appMod = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js');
        const fsMod = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js');
        const storageMod = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js');
        const authMod = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js');`;

if (db.indexOf(oldImport) !== -1) {
    db = db.replace(oldImport, newImport);
    dbLog.push('OK: Módulo firebase-auth.js importado en db.js');
} else {
    dbLog.push('WARN: No se encontró el bloque de imports de Firebase en db.js');
}

// --- 1c) Asignar funciones de Auth después de los otros módulos ---
const oldAssign = `        getStorage = storageMod.getStorage;
        refStorage = storageMod.ref;
        uploadBytes = storageMod.uploadBytes;
        getDownloadURL = storageMod.getDownloadURL;
        deleteObject = storageMod.deleteObject;`;

const newAssign = `        getStorage = storageMod.getStorage;
        refStorage = storageMod.ref;
        uploadBytes = storageMod.uploadBytes;
        getDownloadURL = storageMod.getDownloadURL;
        deleteObject = storageMod.deleteObject;

        // Asignar funciones de Firebase Auth
        getAuth = authMod.getAuth;
        signInWithEmailAndPassword = authMod.signInWithEmailAndPassword;
        onAuthStateChanged = authMod.onAuthStateChanged;
        signOut = authMod.signOut;
        createUserWithEmailAndPassword = authMod.createUserWithEmailAndPassword;`;

if (db.indexOf(oldAssign) !== -1) {
    db = db.replace(oldAssign, newAssign);
    dbLog.push('OK: Funciones de Firebase Auth asignadas en db.js');
} else {
    dbLog.push('WARN: No se encontró el bloque de asignación de Storage en db.js');
}

// --- 1d) Inicializar authFirebase después de initializeApp ---
const oldAppInit = `        const app = initializeApp(config);
        storageFirebase = getStorage(app);`;

const newAppInit = `        const app = initializeApp(config);
        storageFirebase = getStorage(app);
        authFirebase = getAuth(app);`;

if (db.indexOf(oldAppInit) !== -1) {
    db = db.replace(oldAppInit, newAppInit);
    dbLog.push('OK: authFirebase inicializado en db.js');
} else {
    dbLog.push('WARN: No se encontró el bloque de initializeApp en db.js');
}

// --- 1e) Exponer authFirebase globalmente para que app.js pueda usarlo ---
const oldUseFirebase = `        useFirebase = true;
        console.log('Sincronización con Firebase Firestore activa.');`;

const newUseFirebase = `        useFirebase = true;
        console.log('Sincronización con Firebase Firestore activa.');

        // Exponer authFirebase globalmente para que app.js pueda usarlo
        if (typeof window !== 'undefined') {
            window.authFirebase = authFirebase;
            window.signInWithEmailAndPassword = signInWithEmailAndPassword;
            window.onAuthStateChanged = onAuthStateChanged;
            window.signOut = signOut;
        }`;

if (db.indexOf(oldUseFirebase) !== -1) {
    db = db.replace(oldUseFirebase, newUseFirebase);
    dbLog.push('OK: authFirebase expuesto globalmente en db.js');
} else {
    dbLog.push('WARN: No se encontró el bloque de useFirebase en db.js');
}

// ============================================================
// 2) MODIFICAR app.js: Autenticación exclusiva con Firebase Auth
// ============================================================
const appPath = 'app.js';
let app = fs.readFileSync(appPath, 'utf8');
const appLog = [];

// --- 2a) Reemplazar handleLogin() con autenticación Firebase Auth ---
const oldHandleLogin = `async function handleLogin(event) {
    event.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');
    const submitBtn = document.getElementById('login-submit-btn');

    errorEl.style.display = 'none';
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Verificando...';

    try {
        const usuarios = await getTodos('usuarios');
        const usuario = usuarios.find(u => u.username === username && u.activo === true);

        if (usuario) {
            const passwordValida = await verificarPassword(password, usuario.passwordHash);
            if (passwordValida) {
                currentUser = usuario;
                iniciarSesion(usuario);
            } else {
                errorEl.style.display = 'flex';
                document.getElementById('login-password').value = '';
            }
        } else {
            errorEl.style.display = 'flex';
            document.getElementById('login-password').value = '';
        }
    } catch(e) {
        console.error('Error en login:', e);
        errorEl.style.display = 'flex';
    }

    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Ingresar';
}`;

const newHandleLogin = `// Mapea un nombre de usuario a un email válido para Firebase Auth
// Ej: 'admin' -> 'admin@controlcda.com'
function mapearUsuarioAEmail(username) {
    const usuarioLimpio = String(username || '').trim().toLowerCase();
    if (!usuarioLimpio) return '';
    // Si ya es un email, devolverlo tal cual
    if (usuarioLimpio.includes('@')) return usuarioLimpio;
    // Mapear a un dominio interno de la app
    return usuarioLimpio + '@controlcda.com';
}

// Mapea un email de Firebase Auth de vuelta al nombre de usuario
function mapearEmailAUsuario(email) {
    const emailLimpio = String(email || '').trim().toLowerCase();
    if (emailLimpio.endsWith('@controlcda.com')) {
        return emailLimpio.replace('@controlcda.com', '');
    }
    return emailLimpio;
}

// Obtiene el rol del usuario desde Firestore (colección 'usuarios')
async function obtenerRolUsuarioDesdeFirestore(uid) {
    try {
        if (typeof getDoc === 'function' && typeof doc === 'function' && dbFirebase) {
            const docRef = doc(dbFirebase, 'usuarios', String(uid));
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                const data = docSnap.data();
                return {
                    rol: data.rol || 'viewer',
                    nombre: data.nombre || 'Usuario',
                    activo: data.activo !== false
                };
            }
        }
    } catch (e) {
        console.warn('No se pudo obtener el rol desde Firestore:', e);
    }
    // Fallback: buscar en IndexedDB local
    try {
        const usuarios = await getTodos('usuarios');
        const usuario = usuarios.find(u => u.uid === uid || u.username === mapearEmailAUsuario(uid));
        if (usuario) {
            return { rol: usuario.rol || 'viewer', nombre: usuario.nombre || 'Usuario', activo: usuario.activo !== false };
        }
    } catch (e) {
        console.warn('No se pudo obtener el rol desde IndexedDB:', e);
    }
    return { rol: 'viewer', nombre: 'Usuario', activo: true };
}

async function handleLogin(event) {
    event.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');
    const submitBtn = document.getElementById('login-submit-btn');

    errorEl.style.display = 'none';
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Verificando...';

    try {
        // Verificar que Firebase Auth esté inicializado
        if (!authFirebase || typeof signInWithEmailAndPassword !== 'function') {
            throw { code: 'auth/not-initialized', message: 'Firebase Auth no está inicializado.' };
        }

        // Mapear el nombre de usuario a un email válido
        const email = mapearUsuarioAEmail(username);
        if (!email) {
            errorEl.style.display = 'flex';
            document.getElementById('login-password').value = '';
            return;
        }

        // Autenticar directamente contra Firebase Authentication
        const userCredential = await signInWithEmailAndPassword(authFirebase, email, password);
        const firebaseUser = userCredential.user;

        // Obtener el rol del usuario desde Firestore/IndexedDB
        const infoUsuario = await obtenerRolUsuarioDesdeFirestore(firebaseUser.uid);

        if (!infoUsuario.activo) {
            // Usuario desactivado
            await signOut(authFirebase);
            errorEl.style.display = 'flex';
            document.getElementById('login-password').value = '';
            return;
        }

        // Construir el objeto de usuario para la app
        const usuario = {
            id: firebaseUser.uid,
            uid: firebaseUser.uid,
            username: mapearEmailAUsuario(firebaseUser.email),
            email: firebaseUser.email,
            nombre: infoUsuario.nombre,
            rol: infoUsuario.rol,
            activo: true
        };

        // Guardar sesión en localStorage para persistencia
        localStorage.setItem('cda_session', JSON.stringify({
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            username: usuario.username,
            nombre: usuario.nombre,
            rol: usuario.rol,
            token: firebaseUser.accessToken,
            loginTime: new Date().toISOString()
        }));

        currentUser = usuario;
        iniciarSesion(usuario);
    } catch (e) {
        console.error('Error en login:', e);
        
        // Manejar errores específicos de Firebase
        const errorCode = e.code || '';
        const errorMessage = e.message || 'Error desconocido';

        if (errorCode === 'auth/invalid-api-key' || errorCode === 'auth/network-request-failed' || errorCode === 'auth/network-error' || errorCode === 'auth/too-many-requests' || errorCode === 'auth/internal-error') {
            // Error de configuración o conexión
            mostrarAlerta('Error de conexión con el servidor de Firebase', 
                'No se pudo conectar con el servidor de autenticación. Verificá tu conexión a internet y que la configuración de Firebase sea correcta.\n\nCódigo: ' + errorCode,
                'error');
        } else if (errorCode === 'auth/user-not-found' || errorCode === 'auth/wrong-password' || errorCode === 'auth/invalid-credential' || errorCode === 'auth/invalid-login-credentials') {
            // Credenciales incorrectas
            errorEl.style.display = 'flex';
            document.getElementById('login-password').value = '';
        } else if (errorCode === 'auth/user-disabled') {
            mostrarAlerta('Usuario deshabilitado', 'Este usuario ha sido deshabilitado. Contactá al administrador.', 'warning');
        } else if (errorCode === 'auth/too-many-requests') {
            mostrarAlerta('Demasiados intentos', 'Se realizaron demasiados intentos de inicio de sesión. Intentá de nuevo más tarde.', 'warning');
        } else {
            // Error genérico
            errorEl.style.display = 'flex';
            document.getElementById('login-password').value = '';
        }
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Ingresar';
    }
}`;

if (app.indexOf(oldHandleLogin) !== -1) {
    app = app.replace(oldHandleLogin, newHandleLogin);
    appLog.push('OK: handleLogin() reemplazado con Firebase Auth');
} else {
    appLog.push('WARN: No se encontró handleLogin() original en app.js');
}

// --- 2b) Reemplazar handleLogout() para usar signOut() de Firebase ---
const oldHandleLogout = `async function handleLogout() {
    const confirmado = await mostrarConfirmacion('Cerrar sesión', '¿Deseas cerrar la sesión?', 'question');
    if (confirmado) {
        currentUser = null;
        document.getElementById('app-main').style.display = 'none';
        document.getElementById('login-screen').style.display = 'flex';
        document.getElementById('form-login').reset();
        document.getElementById('login-error').style.display = 'none';
    }
}`;

const newHandleLogout = `async function handleLogout() {
    const confirmado = await mostrarConfirmacion('Cerrar sesión', '¿Deseas cerrar la sesión?', 'question');
    if (confirmado) {
        try {
            // Cerrar sesión en Firebase Auth
            if (authFirebase && typeof signOut === 'function') {
                await signOut(authFirebase);
            }
        } catch (e) {
            console.warn('Error al cerrar sesión en Firebase:', e);
        }
        
        // Limpiar sesión local
        localStorage.removeItem('cda_session');
        currentUser = null;
        document.getElementById('app-main').style.display = 'none';
        document.getElementById('login-screen').style.display = 'flex';
        document.getElementById('form-login').reset();
        document.getElementById('login-error').style.display = 'none';
    }
}`;

if (app.indexOf(oldHandleLogout) !== -1) {
    app = app.replace(oldHandleLogout, newHandleLogout);
    appLog.push('OK: handleLogout() usa signOut() de Firebase');
} else {
    appLog.push('WARN: No se encontró handleLogout() original en app.js');
}

// --- 2c) Agregar onAuthStateChanged para persistencia de sesión ---
const oldInit = `// ==================== INICIALIZACIÓN ====================
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await inicializarFirebase();
        await inicializarDatosPorDefecto();
    } catch (error) {
        console.error('Error al inicializar la base de datos:', error);
        alert('Error al iniciar la base de datos local. Por favor, recarga la página.');
    }
});`;

const newInit = `// ==================== INICIALIZACIÓN ====================
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await inicializarFirebase();
        await inicializarDatosPorDefecto();
        
        // Configurar listener de estado de autenticación para persistencia de sesión
        if (authFirebase && typeof onAuthStateChanged === 'function') {
            onAuthStateChanged(authFirebase, async (firebaseUser) => {
                if (firebaseUser) {
                    // Usuario autenticado - restaurar sesión
                    const sessionStr = localStorage.getItem('cda_session');
                    let sessionData = null;
                    if (sessionStr) {
                        try { sessionData = JSON.parse(sessionStr); } catch(e) {}
                    }
                    
                    if (sessionData && sessionData.uid === firebaseUser.uid) {
                        // Sesión restaurada desde localStorage
                        const usuario = {
                            id: firebaseUser.uid,
                            uid: firebaseUser.uid,
                            username: sessionData.username || mapearEmailAUsuario(firebaseUser.email),
                            email: firebaseUser.email,
                            nombre: sessionData.nombre || 'Usuario',
                            rol: sessionData.rol || 'viewer',
                            activo: true
                        };
                        currentUser = usuario;
                        iniciarSesion(usuario);
                    } else {
                        // Sesión activa en Firebase pero no en localStorage - obtener rol
                        const infoUsuario = await obtenerRolUsuarioDesdeFirestore(firebaseUser.uid);
                        const usuario = {
                            id: firebaseUser.uid,
                            uid: firebaseUser.uid,
                            username: mapearEmailAUsuario(firebaseUser.email),
                            email: firebaseUser.email,
                            nombre: infoUsuario.nombre,
                            rol: infoUsuario.rol,
                            activo: true
                        };
                        localStorage.setItem('cda_session', JSON.stringify({
                            uid: firebaseUser.uid,
                            email: firebaseUser.email,
                            username: usuario.username,
                            nombre: usuario.nombre,
                            rol: usuario.rol,
                            token: firebaseUser.accessToken,
                            loginTime: new Date().toISOString()
                        }));
                        currentUser = usuario;
                        iniciarSesion(usuario);
                    }
                } else {
                    // No hay usuario autenticado
                    currentUser = null;
                    localStorage.removeItem('cda_session');
                    const appMain = document.getElementById('app-main');
                    const loginScreen = document.getElementById('login-screen');
                    if (appMain) appMain.style.display = 'none';
                    if (loginScreen) loginScreen.style.display = 'flex';
                }
            });
        }
    } catch (error) {
        console.error('Error al inicializar la base de datos:', error);
        alert('Error al iniciar la base de datos local. Por favor, recarga la página.');
    }
});`;

if (app.indexOf(oldInit) !== -1) {
    app = app.replace(oldInit, newInit);
    appLog.push('OK: onAuthStateChanged configurado para persistencia de sesión');
} else {
    appLog.push('WARN: No se encontró el bloque de inicialización en app.js');
}

// ============================================================
// Guardar cambios
// ============================================================
fs.writeFileSync(dbPath, db);
fs.writeFileSync(appPath, app);

const log = [...dbLog, '--- app.js ---', ...appLog];
fs.writeFileSync('fix_auth_firebase_log.txt', log.join('\n'));
console.log(log.join('\n'));