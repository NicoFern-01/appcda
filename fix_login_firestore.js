const fs = require('fs');

// ============================================================
// MODIFICAR app.js: Login con consulta directa a Firestore
// ============================================================
const appPath = 'app.js';
let app = fs.readFileSync(appPath, 'utf8');
const log = [];

// --- Reemplazar handleLogin() con lógica de Firestore ---
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

const newHandleLogin = `async function handleLogin(event) {
    event.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');
    const submitBtn = document.getElementById('login-submit-btn');

    errorEl.style.display = 'none';
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Verificando...';

    try {
        // Verificar que Firestore esté inicializado
        if (!dbFirebase || typeof query !== 'function' || typeof collection !== 'function' || typeof where !== 'function' || typeof getDocs !== 'function') {
            throw new Error('Firestore no está inicializado correctamente.');
        }

        // 1) CONSULTA DIRECTA A FIRESTORE
        // Buscar en la colección 'usuarios' donde username = ingresado Y activo = true
        const usuariosRef = collection(dbFirebase, 'usuarios');
        const q = query(usuariosRef, where('username', '==', username), where('activo', '==', true));
        const querySnapshot = await getDocs(q);

        // Si no se encontró ningún usuario, mostrar error genérico
        if (querySnapshot.empty) {
            errorEl.style.display = 'flex';
            document.getElementById('login-password').value = '';
            return;
        }

        // Tomar el primer documento encontrado
        const docSnap = querySnapshot.docs[0];
        const usuarioData = docSnap.data();
        const usuarioId = docSnap.id;

        // 2) VERIFICACIÓN DE CONTRASEÑA (HASH DE LA APP)
        // Generar el hash de la contraseña ingresada con la MISMA función de la app
        const passwordHashIngresada = hashPasswordLegacy(password);
        const passwordHashAlmacenado = usuarioData.passwordHash || '';

        // Comparar los hashes
        if (passwordHashIngresada !== passwordHashAlmacenado) {
            errorEl.style.display = 'flex';
            document.getElementById('login-password').value = '';
            return;
        }

        // 3) LOGIN EXITOSO Y PERSISTENCIA
        // Construir el objeto de usuario
        const usuario = {
            id: Number(usuarioId) || usuarioId,
            username: usuarioData.username,
            nombre: usuarioData.nombre || 'Usuario',
            rol: usuarioData.rol || 'viewer',
            activo: true
        };

        // Guardar sesión en localStorage para persistencia
        localStorage.setItem('cda_session', JSON.stringify({
            id: usuario.id,
            username: usuario.username,
            nombre: usuario.nombre,
            rol: usuario.rol,
            loginTime: new Date().toISOString()
        }));

        currentUser = usuario;
        iniciarSesion(usuario);
    } catch (e) {
        // 4) CONTROL DE ERRORES
        console.error('Error en login:', e);
        errorEl.style.display = 'flex';
        document.getElementById('login-password').value = '';
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Ingresar';
    }
}`;

if (app.indexOf(oldHandleLogin) !== -1) {
    app = app.replace(oldHandleLogin, newHandleLogin);
    log.push('OK: handleLogin() reescrito con consulta directa a Firestore');
} else {
    log.push('WARN: No se encontró handleLogin() con Firebase Auth en app.js');
}

// --- Reemplazar handleLogout() para limpiar sesión local (sin Firebase Auth) ---
const oldHandleLogout = `async function handleLogout() {
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

const newHandleLogout = `async function handleLogout() {
    const confirmado = await mostrarConfirmacion('Cerrar sesión', '¿Deseas cerrar la sesión?', 'question');
    if (confirmado) {
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
    log.push('OK: handleLogout() simplificado para limpiar sesión local');
} else {
    log.push('WARN: No se encontró handleLogout() con Firebase Auth en app.js');
}

// --- Reemplazar onAuthStateChanged con restauración de sesión desde localStorage ---
const oldInit = `// ==================== INICIALIZACIÓN ====================
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

const newInit = `// ==================== INICIALIZACIÓN ====================
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await inicializarFirebase();
        await inicializarDatosPorDefecto();
        
        // Restaurar sesión desde localStorage si existe
        const sessionStr = localStorage.getItem('cda_session');
        if (sessionStr) {
            try {
                const sessionData = JSON.parse(sessionStr);
                if (sessionData && sessionData.username) {
                    const usuario = {
                        id: sessionData.id,
                        username: sessionData.username,
                        nombre: sessionData.nombre || 'Usuario',
                        rol: sessionData.rol || 'viewer',
                        activo: true
                    };
                    currentUser = usuario;
                    iniciarSesion(usuario);
                }
            } catch (e) {
                console.warn('Error al restaurar sesión:', e);
                localStorage.removeItem('cda_session');
            }
        }
    } catch (error) {
        console.error('Error al inicializar la base de datos:', error);
        alert('Error al iniciar la base de datos local. Por favor, recarga la página.');
    }
});`;

if (app.indexOf(oldInit) !== -1) {
    app = app.replace(oldInit, newInit);
    log.push('OK: Inicialización restaura sesión desde localStorage');
} else {
    log.push('WARN: No se encontró el bloque de inicialización con onAuthStateChanged');
}

// --- Eliminar funciones de mapeo de email que ya no son necesarias ---
// (mapearUsuarioAEmail, mapearEmailAUsuario, obtenerRolUsuarioDesdeFirestore)
// Estas funciones ya no se usan con la lógica de Firestore directa

// Guardar cambios
fs.writeFileSync(appPath, app);
fs.writeFileSync('fix_login_firestore_log.txt', log.join('\n'));
console.log(log.join('\n'));