// src/services/authService.js
// ============================================================
// DOMINIO: Autenticación y sesión (extraído de app.js — FASE 5).
//
// La lógica real de login/logout/iniciarSesion vive AQUÍ como ES module.
// app.js conserva proxies que delegan en window.__CDA_MODULES__.auth, de modo
// que los onclick/onsubmit incrustados en index.html siguen funcionando.
//
// Dependencias externas que siguen en los scripts clásicos (app.js/db.js):
//   - currentUser: ahora es `var` en app.js => accesible como globalThis.currentUser
//   - getTodos, verificarPasswordConCompatibilidad, obtenerPermisosEfectivos,
//     renderizarMenuLateral, aplicarControlDeAcceso, switchView, mostrarConfirmacion
//   - Runtime de Firestore (dbFirebase/collection/query/where/getDocs): expuesto por
//     db.js en window.__CDA_FIREBASE_RUNTIME__ (bridge aditivo).
// ============================================================

// Devuelve un global como función si existe (la app legacy sigue siendo de scripts clásicos).
function lecturaGlobal(fn) {
  return typeof globalThis !== 'undefined' && typeof globalThis[fn] === 'function'
    ? globalThis[fn]
    : null;
}

/** Runtime de Firestore expuesto por db.js (se llena al conectar). */
function firebaseRuntime() {
  return (typeof window !== 'undefined' && window.__CDA_FIREBASE_RUNTIME__) || {};
}

/** Persiste la sesión en localStorage bajo la clave `cda_session`. */
function guardarSesion(usuario) {
  localStorage.setItem('cda_session', JSON.stringify({
    id: usuario.id,
    username: usuario.username,
    nombre: usuario.nombre,
    rol: usuario.rol,
    permisos: usuario.permisos,
    loginTime: new Date().toISOString()
  }));
}

// ---------------- Login local (A-4) ----------------
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
      activo: true
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

// ---------------- Iniciar sesión ----------------
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
    console.warn('No se pudo actualizar la sesión con los permisos:', e);
  }

  const renderizarMenuLateral = lecturaGlobal('renderizarMenuLateral');
  if (renderizarMenuLateral) renderizarMenuLateral(usuario);

  const aplicarControlDeAcceso = lecturaGlobal('aplicarControlDeAcceso');
  if (aplicarControlDeAcceso) aplicarControlDeAcceso(usuario.rol);

  const switchView = lecturaGlobal('switchView');
  if (switchView) switchView('dashboard');
}

// ---------------- Login principal (Firestore + fallback local) ----------------
export async function handleLogin(event) {
  event.preventDefault();
  const usernameInput = document.getElementById('login-username').value.trim();
  const passwordInput = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  const submitBtn = document.getElementById('login-submit-btn');

  errorEl.style.display = 'none';
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Verificando...';

  try {
    const rt = firebaseRuntime();
    if (!rt.dbFirebase || typeof rt.query !== 'function' || typeof rt.collection !== 'function' ||
        typeof rt.where !== 'function' || typeof rt.getDocs !== 'function') {
      if (await intentarLoginLocal(usernameInput, passwordInput)) return;
      throw new Error('Firestore no está inicializado correctamente.');
    }

    console.log('Intentando conectar al proyecto:', rt.dbFirebase.app.options.projectId);
    const usuariosRef = rt.collection(rt.dbFirebase, 'usuarios');
    const q = rt.query(usuariosRef, rt.where('username', '==', usernameInput), rt.where('activo', '==', true));
    const querySnapshot = await rt.getDocs(q);

    if (querySnapshot.empty) {
      if (await intentarLoginLocal(usernameInput, passwordInput)) return;
      errorEl.style.display = 'flex';
      document.getElementById('login-password').value = '';
      return;
    }

    const verificar = lecturaGlobal('verificarPasswordConCompatibilidad');
    for (const docSnap of querySnapshot.docs) {
      const usuarioData = docSnap.data();
      const usuarioId = docSnap.id;
      const esValida = verificar ? await verificar(passwordInput, usuarioData.passwordHash) : false;

      if (esValida) {
        const usuario = {
          id: Number(usuarioId) || usuarioId,
          username: usuarioData.username,
          nombre: usuarioData.nombre || 'Usuario',
          rol: usuarioData.rol || 'viewer',
          permisos: (usuarioData.permisos && typeof usuarioData.permisos === 'object')
            ? JSON.parse(JSON.stringify(usuarioData.permisos))
            : null,
          activo: true
        };
        guardarSesion(usuario);
        console.log('✅ LOGIN EXITOSO:', usuario);
        globalThis.currentUser = usuario;
        iniciarSesion(usuario);
        return;
      }
    }

    if (await intentarLoginLocal(usernameInput, passwordInput)) return;
    errorEl.style.display = 'flex';
    document.getElementById('login-password').value = '';
  } catch (error) {
    if (await intentarLoginLocal(usernameInput, passwordInput)) return;
    console.error('💥 ERROR CRÍTICO DEL SDK DE FIREBASE:', error && error.code, error && error.message);
    alert('Error técnico de Firebase: ' + (error && error.message));
    errorEl.style.display = 'flex';
    document.getElementById('login-password').value = '';
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Ingresar';
  }
}

// ---------------- Logout ----------------
export async function handleLogout() {
  const mostrarConfirmacion = lecturaGlobal('mostrarConfirmacion');
  const confirmado = mostrarConfirmacion
    ? await mostrarConfirmacion('Cerrar sesión', '¿Deseas cerrar la sesión?', 'question')
    : true;
  if (confirmado) {
    localStorage.removeItem('cda_session');
    globalThis.currentUser = null;
    document.getElementById('app-main').style.display = 'none';
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('form-login').reset();
    document.getElementById('login-error').style.display = 'none';
  }
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
