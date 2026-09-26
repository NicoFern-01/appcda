// src/services/authService.js
// ============================================================
// DOMINIO: Autenticacion y sesion (extraido de app.js - FASE 5).
//
// MIGRACION A FIREBASE AUTHENTICATION (email + password).
// La validacion de credenciales ya NO se hace contra hashes en IndexedDB:
// se delega en `signInWithEmailAndPassword`. Tras autenticar, se resuelve el
// PERFIL (nombre, rol, permisos) desde la coleccion `usuarios` y se guarda en
// `cda_session`, de modo que viewManager.js y permisosUtil.js sigan aplicando
// los permisos granulares exactamente igual que antes.
//
// ESTRATEGIA (degradacion segura en capas):
//   1. Firebase Auth  -> credencial valida en la nube (login multi-dispositivo).
//   2. Perfil         -> coleccion `usuarios` en Firestore (rol/nombre/permisos).
//   3. Fallback local -> si la nube no responde (CDN caido, offline, pruebas),
//      se conserva el login legacy para no dejar la app inutilizable.
//
// El runtime llega por `window.__CDA_FIREBASE_RUNTIME__` (bridge de db.js).
// app.js conserva proxies que delegan en window.__CDA_MODULES__.auth, de modo
// que los onclick/onsubmit incrustados en index.html siguen funcionando.
//
// Dependencias externas que siguen en los scripts clasicos (app.js/db.js):
//   - currentUser: ahora es `var` en app.js => accesible como globalThis.currentUser
//   - getTodos, verificarPasswordConCompatibilidad, obtenerPermisosEfectivos,
//     renderizarMenuLateral, aplicarControlDeAcceso, switchView, mostrarConfirmacion
//   - Runtime de Firestore (dbFirebase/collection/query/where/getDocs) y de Auth
//     (auth/signInWithEmailAndPassword/signOut): db.js lo expone en
//     window.__CDA_FIREBASE_RUNTIME__ (bridge aditivo).
// ============================================================

import { construirIdentidadLogin } from './authCredentials.js';

// Devuelve un global como funcion si existe (la app legacy sigue siendo de scripts clasicos).
function lecturaGlobal(fn) {
  return typeof globalThis !== 'undefined' && typeof globalThis[fn] === 'function'
    ? globalThis[fn]
    : null;
}

/** Runtime de Firebase (Firestore + Auth) expuesto por db.js (se llena al conectar). */
function firebaseRuntime() {
  return (typeof window !== 'undefined' && window.__CDA_FIREBASE_RUNTIME__) || {};
}

/** Persiste la sesion en localStorage bajo la clave `cda_session`. */
function guardarSesion(usuario) {
  localStorage.setItem('cda_session', JSON.stringify({
    id: usuario.id,
    username: usuario.username,
    nombre: usuario.nombre,
    rol: usuario.rol,
    permisos: usuario.permisos,
    // Metadatos de Firebase Auth: permiten cerrar sesion en la nube y trazar
    // el origen del login. No afectan a los permisos.
    email: usuario.email || null,
    firebaseUid: usuario.firebaseUid || null,
    origen: usuario.origen || 'local',
    loginTime: new Date().toISOString()
  }));
}


/** Traduce los codigos de error de Firebase Auth a un mensaje para la UI. */
function mensajeErrorAuth(error) {
  const code = error && error.code ? String(error.code) : '';
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' ||
      code === 'auth/user-not-found' || code === 'auth/invalid-email') {
    return 'Usuario o contraseña incorrectos.';
  }
  if (code === 'auth/too-many-requests') {
    return 'Demasiados intentos. Esperá un momento e intentá de nuevo.';
  }
  if (code === 'auth/network-request-failed') {
    return 'Sin conexión con el servidor de autenticación.';
  }
  if (code === 'auth/user-disabled') {
    return 'La cuenta está deshabilitada. Contactá al administrador.';
  }
  // Cualquier otro caso: no se filtra el detalle tecnico al usuario final.
  return 'Usuario o contraseña incorrectos.';
}

/** Muestra el error de login sin bloquear la interfaz. */
function mostrarErrorLogin(errorEl) {
  if (errorEl) errorEl.style.display = 'flex';
  const inputPass = document.getElementById('login-password');
  if (inputPass) inputPass.value = '';
}

// ---------------- Login local (A-4) - FALLBACK DEGRADADO ----------------
/**
 * Login contra el store local `usuarios` (IndexedDB).
 *
 * Se conserva EXCLUSIVAMENTE como red de seguridad para cuando Firebase no
 * esta disponible (CDN inaccesible, offline, o pruebas sin credenciales
 * reales). No es la via principal de autenticacion.
 */
export async function intentarLoginLocal(usernameInput, passwordInput) {
  try {
    const getTodos = lecturaGlobal('getTodos');
    const verificar = lecturaGlobal('verificarPasswordConCompatibilidad');
    if (!getTodos || !verificar) return false;

    const usuarios = await getTodos('usuarios');
    const match = usuarios.find((u) =>
      String(u.username).toLowerCase() === String(usernameInput).trim().toLowerCase() &&
      u.activo !== false
    );
    if (!match) return false;

    const valida = await verificar(passwordInput, match.passwordHash);
    if (!valida) return false;

    const usuario = {
      id: Number(match.id) || match.id,
      username: match.username,
      nombre: match.nombre || 'Usuario',
      rol: match.rol || 'viewer',
      permisos: (match.permisos && typeof match.permisos === 'object')
        ? JSON.parse(JSON.stringify(match.permisos))
        : null,
      activo: true,
      origen: 'local'
    };
    guardarSesion(usuario);
    globalThis.currentUser = usuario;
    iniciarSesion(usuario);
    return true;
  } catch (e) {
    console.warn('[authService] Fallover local de login no disponible:', e);
    return false;
  }
}

/**
 * Resuelve el perfil (nombre, rol, permisos) de un usuario ya autenticado en
 * Firebase Auth. Busca en la coleccion `usuarios` por `username` y, como
 * respaldo, por `email`. Si no hay documento, devuelve null y el llamador
 * aplica un perfil minimo con rol `viewer` (nunca permisos elevados).
 */
async function resolverPerfilEnFirestore(username, email) {
  const rt = firebaseRuntime();
  if (!rt.dbFirebase || typeof rt.collection !== 'function' ||
      typeof rt.query !== 'function' || typeof rt.where !== 'function' ||
      typeof rt.getDocs !== 'function') {
    return null;
  }

  const ref = rt.collection(rt.dbFirebase, 'usuarios');

  const intentarPor = async (campo, valor) => {
    try {
      const q = rt.query(ref, rt.where(campo, '==', valor), rt.where('activo', '==', true));
      const snap = await rt.getDocs(q);
      if (snap && !snap.empty) {
        const doc = snap.docs[0];
        const data = doc.data();
        return {
          id: doc.id,
          username: data.username || username,
          nombre: data.nombre || 'Usuario',
          rol: data.rol || 'viewer',
          permisos: (data.permisos && typeof data.permisos === 'object')
            ? JSON.parse(JSON.stringify(data.permisos))
            : null,
          activo: true
        };
      }
    } catch (e) {
      console.warn('[authService] No se pudo leer el perfil por ' + campo + ':', e && e.code);
    }
    return null;
  };

  return (await intentarPor('username', username)) || (await intentarPor('email', email));
}

// ---------------- Iniciar sesion ----------------
export function iniciarSesion(usuario) {
  document.getElementById('login-screen').style.display = 'none';
  const appMain = document.getElementById('app-main');
  appMain.style.display = 'flex';

  document.getElementById('sidebar-user-name').textContent = usuario.nombre;
  document.getElementById('sidebar-avatar').textContent = usuario.nombre.charAt(0).toUpperCase();

  const rolesNombres = { admin: 'Administrador', editor: 'Editor', viewer: 'Visualizador', supervisor: 'Supervisor' };
  document.getElementById('sidebar-user-role').textContent = rolesNombres[usuario.rol] || usuario.rol;

  const obtenerPermisosEfectivos = lecturaGlobal('obtenerPermisosEfectivos');
  if (obtenerPermisosEfectivos) {
    usuario.permisos = obtenerPermisosEfectivos(usuario);
  }

  try {
    const sesion = JSON.parse(localStorage.getItem('cda_session') || 'null');
    if (sesion) {
      sesion.permisos = usuario.permisos;
      localStorage.setItem('cda_session', JSON.stringify(sesion));
    }
  } catch (e) {
    console.warn('No se pudo actualizar la sesion con los permisos:', e);
  }

  const renderizarMenuLateral = lecturaGlobal('renderizarMenuLateral');
  if (renderizarMenuLateral) renderizarMenuLateral(usuario);

  const aplicarControlDeAcceso = lecturaGlobal('aplicarControlDeAcceso');
  if (aplicarControlDeAcceso) aplicarControlDeAcceso(usuario.rol);

  const switchView = lecturaGlobal('switchView');
  if (switchView) switchView('dashboard');
}

// ---------------- Login principal: Firebase Auth + perfil ----------------
export async function handleLogin(event) {
  event.preventDefault();
  const usernameInput = document.getElementById('login-username').value.trim();
  const passwordInput = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  const submitBtn = document.getElementById('login-submit-btn');

  if (errorEl) errorEl.style.display = 'none';
  if (!usernameInput || !passwordInput) {
    mostrarErrorLogin(errorEl);
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Verificando...';
  }

  const identidad = construirIdentidadLogin(usernameInput);
  const rt = firebaseRuntime();
  const authListo = !!(rt.auth && typeof rt.signInWithEmailAndPassword === 'function');

  try {
    // ---------- CAPA 1: Firebase Authentication ----------
    if (authListo) {
      const cred = await rt.signInWithEmailAndPassword(rt.auth, identidad.email, passwordInput);
      const firebaseUser = cred && cred.user ? cred.user : null;
      const email = (firebaseUser && firebaseUser.email) ? firebaseUser.email : identidad.email;
      const uid = (firebaseUser && firebaseUser.uid) ? firebaseUser.uid : null;

      // ---------- CAPA 2: perfil y rol desde Firestore ----------
      const perfil = await resolverPerfilEnFirestore(identidad.username, email);

      const usuario = {
        id: perfil ? (Number(perfil.id) || perfil.id) : (uid || identidad.username),
        username: perfil ? perfil.username : identidad.username,
        nombre: perfil ? perfil.nombre : identidad.username,
        rol: perfil ? perfil.rol : 'viewer',
        permisos: perfil ? perfil.permisos : null,
        activo: true,
        email,
        firebaseUid: uid,
        origen: 'firebase-auth'
      };

      guardarSesion(usuario);
      console.log('LOGIN EXITOSO (Firebase Auth):', usuario.username, '| rol:', usuario.rol);
      globalThis.currentUser = usuario;
      iniciarSesion(usuario);
      return;
    }

    // Firebase Auth no esta disponible (SDK no cargo): degradamos de forma
    // explicita, sin romper la app.
    console.warn('[authService] Firebase Auth no disponible; se usa login local degradado.');

    // ---------- CAPA 3: fallback local ----------
    if (await intentarLoginLocal(usernameInput, passwordInput)) return;

    mostrarErrorLogin(errorEl);
  } catch (error) {
    const code = error && error.code ? String(error.code) : '';
    const esErrorDeCredencial =
      code === 'auth/invalid-credential' || code === 'auth/wrong-password' ||
      code === 'auth/user-not-found' || code === 'auth/invalid-email' ||
      code === 'auth/user-disabled';

    // Un rechazo de credenciales es un caso NORMAL del formulario de login, no
    // una falla de la app: se registra como advertencia para no inundar la
    // consola (la UI ya muestra "Usuario o contraseña incorrectos").
    if (esErrorDeCredencial) {
      console.warn('[authService] Credenciales rechazadas por Firebase:', code);
      mostrarErrorLogin(errorEl);
      return;
    }

    console.error('ERROR DE AUTENTICACION:', code, error && error.message);

    // Fallo de infraestructura/red: aqui si se degrada al login local para que
    // la app siga utilizable sin conectividad.
    if (await intentarLoginLocal(usernameInput, passwordInput)) return;

    console.warn('[authService] Login local no disponible:', mensajeErrorAuth(error));
    mostrarErrorLogin(errorEl);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Ingresar';
    }
  }
}

// ---------------- Logout ----------------
export async function handleLogout() {
  const mostrarConfirmacion = lecturaGlobal('mostrarConfirmacion');
  const confirmado = mostrarConfirmacion
    ? await mostrarConfirmacion('Cerrar sesión', '¿Deseas cerrar la sesión?', 'question')
    : true;
  if (!confirmado) return;

  // Cierre de sesion en Firebase Auth (ademas de limpiar la sesion local).
  try {
    const rt = firebaseRuntime();
    if (rt.auth && typeof rt.signOut === 'function') {
      await rt.signOut(rt.auth);
      console.log('Sesion de Firebase Auth cerrada.');
    }
  } catch (e) {
    // Nunca bloquear el logout local por un fallo de red al cerrar en la nube.
    console.warn('[authService] No se pudo cerrar la sesion en Firebase Auth:', e);
  }

  localStorage.removeItem('cda_session');
  globalThis.currentUser = null;
  document.getElementById('app-main').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('form-login').reset();
  document.getElementById('login-error').style.display = 'none';
}

// ---------------- Interfaz de servicio ----------------
export const authService = {
  handleLogin,
  intentarLoginLocal,
  iniciarSesion,
  handleLogout,
  getUsuarioActual() {
    return typeof globalThis !== 'undefined' ? (globalThis.currentUser ?? null) : null;
  },
  async login(username, password) {
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    setVal('login-username', username);
    setVal('login-password', password);
    const form = document.getElementById('form-login');
    if (form && form.requestSubmit) { form.requestSubmit(); return true; }
    await handleLogin({ preventDefault: () => {}, target: form || null });
    return true;
  },
  logout: handleLogout
};

export default authService;
