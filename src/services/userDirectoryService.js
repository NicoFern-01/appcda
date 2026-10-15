// src/services/userDirectoryService.js
// ============================================================
// DIRECTORIO DE USUARIOS EN LA NUBE (perfiles, NO credenciales).
// ============================================================
// Separacion de responsabilidades, deliberada:
//
//   Firebase Authentication  -> IDENTIDAD (email + contrasena + sesion).
//                               Es la unica fuente de verdad de la contrasena.
//   Firestore `usuarios/{id}`-> PERFIL    (nombre, rol, activo, permisos).
//                               NO contiene ninguna contrasena ni hash.
//
// Por eso este modulo NUNCA escribe `passwordHash` en la nube: el store
// `usuarios` sigue en STORES_NO_SYNC para el sync generico de app.js, y aca se
// escribe un documento limpio y explicito. Asi los hashes quedan siempre en el
// dispositivo (IndexedDB) y no viajan a Firestore.
//
// El ID de documento es el `username` en minusculas: eso lo hace clave unica e
// inmutable, y elimina los duplicados que se generaban con id numerico
// autoincremental (dos 'admin', dos 'Raul').
// ============================================================

import { normalizarUsernameAEmail } from './authCredentials.js';

/** Runtime de Firebase expuesto por db.js (Firestore + Auth). */

// ==================== SINCRONIZACION CON LA NUBE (SIMETRICA) ====================
// El directorio usa el mismo criterio en las 4 operaciones: LISTAR, ALTA,
// EDICION y BAJA van a la nube SIEMPRE que hay SDK + sesion; IndexedDB queda
// SOLO como fallback local (app sin Firebase / offline), nunca como camino
// paralelo. Cuando la nube no responde, el servicio devuelve {ok:true, nube:false}
// y el llamador persiste en local CON AVISO (nunca falsos exitos).
//
// HISTORICO (bug real): existia la bandera VITE_CDA_SYNC_USUARIOS_NUBE, que
// gateaba ALTA y EDICION pero NO la lectura ni el borrado. Con ella apagada
// (no habia `.env`), la lista mostraba los perfiles de la nube, pero borrarlos
// era un no-op con ok:true (falso exito) y crear usuarios quedaba SOLO en el
// dispositivo: como la lista manda la nube, los nuevos nunca aparecian.
// La bandera fue eliminada.
//
// SEGURIDAD: la defensa de escritura son las reglas de Firestore
// (`firestore.rules`), NO una variable del cliente. La API key es publica por
// diseno (va en el bundle) y con `npm run build` cualquiera lee el valor de
// cualquier bandera en dist/ y puede reescribir el bundle: nunca aporto
// seguridad. Con reglas publicadas (esAdmin(), sin passwordHash, sin
// autoescalada), sincronizar es seguro por defecto; sin reglas, la escritura
// falla con permission-denied y la UI lo informa.
function runtime() {
  return (typeof window !== 'undefined' && window.__CDA_FIREBASE_RUNTIME__) || {};
}

/** ID de documento estable: username en minusculas, sin espacios. */
function idDocumento(username) {
  return String(username || '').trim().toLowerCase();
}

/**
 * Construye el documento de perfil para Firestore.
 * Filtra CUALQUIER campo sensible: aunque el objeto llegue con passwordHash
 * desde el formulario, nunca se escribe a la nube.
 */
function construirDocPerfil({ username, nombre, rol, activo, permisos }) {
  const doc = {
    username: idDocumento(username),
    nombre: String(nombre || '').trim(),
    rol: rol || 'viewer',
    activo: activo !== false,
    email: normalizarUsernameAEmail(username),
    permisos: (permisos && typeof permisos === 'object') ? permisos : null,
    actualizadoEn: new Date().toISOString(),
  };
  // Red de seguridad explicita: nunca persistir material sensible.
  delete doc.passwordHash;
  delete doc.password;
  return doc;
}

/** Traduce errores de Firebase Auth a mensajes claros para la UI. */
function traducirErrorAuth(error) {
  const code = error && error.code ? String(error.code) : '';
  switch (code) {
    case 'auth/email-already-in-use':
    case 'auth/username-already-exists':
      return 'El nombre de usuario ya está registrado.';
    case 'auth/invalid-email':
      return 'El correo generado a partir del usuario no es válido.';
    case 'auth/weak-password':
      return 'La contraseña es demasiado débil. Usá al menos 6 caracteres.';
    case 'auth/operation-not-allowed':
      return 'Firebase Auth no tiene habilitado el método Email/Password.';
    case 'auth/network-request-failed':
      return 'Sin conexión con el servidor de autenticación.';
    case 'auth/too-many-requests':
      return 'Demasiados intentos. Esperá un momento e intentá de nuevo.';
    default:
      return error && error.message
        ? String(error.message)
        : 'No se pudo completar la operación en la nube.';
  }
}

/** El runtime de Auth tiene lo necesario para crear cuentas? */
function authDisponible() {
  const rt = runtime();
  return !!(rt.auth && typeof rt.createUserWithEmailAndPassword === 'function');
}


/** El runtime de Firestore tiene lo necesario para escribir? */
function firestoreDisponible() {
  const rt = runtime();
  return !!(rt.dbFirebase && typeof rt.doc === 'function' && typeof rt.setDoc === 'function');
}
export const userDirectoryService = {
  /**
   * ALTA de usuario: crea la identidad en Firebase Auth y escribe el perfil.
   * @returns {{ok:boolean, mensaje?:string, email?:string}}
   */
  async crearUsuario({ username, nombre, rol, activo, permisos, password }) {
    const id = idDocumento(username);
    if (!id) return { ok: false, mensaje: 'El nombre de usuario es obligatorio.' };
    if (!password) return { ok: false, mensaje: 'La contraseña es obligatoria para nuevos usuarios.' };

    // Sin Auth, sin Firestore o sin sesión NO se toca la nube: se evita crear
    // la identidad sin perfil (medio-alta que deja cuentas huerfanas en Auth).
    // El llamador guarda SOLO en IndexedDB con aviso explicito. Mismo contrato
    // que actualizarPerfil y eliminarPerfil: {ok:true, nube:false}.
    const rtPre = runtime();
    const conSesion = !!(rtPre.auth && rtPre.auth.currentUser);
    if (!authDisponible() || !firestoreDisponible() || !conSesion) {
      console.info('[usuarios] Alta en la nube omitida (sin Auth/Firestore o sin sesión).');
      return { ok: true, nube: false };
    }

    const rt = runtime();
    const email = normalizarUsernameAEmail(username);

    // 1) Identidad primero: si falla, no queda un perfil huerfano en Firestore.
    //    Se usa la app secundaria para NO cerrar la sesion del administrador:
    //    con el Auth principal, createUserWithEmailAndPassword() inicia sesion
    //    con la cuenta nueva y el setDoc siguiente seria rechazado por las reglas.
    try {
      if (typeof rt.crearUsuarioEnAppSecundaria === 'function') {
        await rt.crearUsuarioEnAppSecundaria(email, password);
      } else {
        console.warn('[usuarios] App secundaria no disponible; se usa el Auth principal. ' +
          'La sesion del administrador puede quedar reemplazada.');
        await rt.createUserWithEmailAndPassword(rt.auth, email, password);
      }
    } catch (error) {
      const codigo = error && error.code;
      const esNombreTomado = codigo === 'auth/email-already-in-use' ||
        codigo === 'auth/username-already-exists';
      // Nombre tomado + perfil EXISTENTE en la nube = duplicado real.
      if (esNombreTomado && await userDirectoryService.existeEnNube(id)) {
        return { ok: false, mensaje: 'Ya existe un usuario con ese nombre en el sistema.', codigo };
      }
      // Nombre tomado SIN perfil = cuenta HUERFANA en Firebase Auth (quedó de
      // un borrado anterior: el borrado/purga de perfiles NO elimina cuentas de
      // Auth; eso exige el Admin SDK, fuera del alcance del cliente web). La
      // contraseña de esa cuenta es desconocida, así que no se puede reutilizar.
      if (esNombreTomado) {
        console.warn('[usuarios] Cuenta huerfana en Firebase Auth sin perfil para', email);
        return {
          ok: false,
          mensaje: 'El nombre ya está tomado en Firebase Authentication (la cuenta existe pero sin perfil). ' +
            'Eliminá la cuenta "' + email + '" en la consola de Firebase (Authentication > Users) ' +
            'y volvé a crear el usuario, o elegí otro nombre.',
          codigo,
        };
      }
      return { ok: false, mensaje: traducirErrorAuth(error), codigo };
    }

    // 2) Perfil en Firestore con ID = username (clave unica e inmutable).
    if (firestoreDisponible()) {
      try {
        const doc = construirDocPerfil({ username, nombre, rol, activo, permisos });
        await rt.setDoc(rt.doc(rt.dbFirebase, 'usuarios', id), doc);
      } catch (error) {
        console.error('[usuarios] Escritura de Firestore rechazada:', {
          code: error && error.code,
          message: error && error.message,
          path: 'usuarios/' + id,
          authUser: rt.auth && rt.auth.currentUser ? rt.auth.currentUser.email : null,
          rolSesion: globalThis.currentUser ? globalThis.currentUser.rol : null
        });
        return {
          ok: false,
          mensaje: 'La cuenta se creó pero no se pudo guardar el perfil: ' + traducirErrorAuth(error),
          codigo: error && error.code,
        };
      }
    }

    return { ok: true, email };
  },

  /**
   * EDICION de perfil: actualiza SOLO el documento de Firestore.
   * Nunca toca la contrasena de Firebase Auth (eso es una operacion separada y
   * explicita). Si el documento aun no existe, se crea con merge.
   *
   * IMPORTANTE: el ID de documento ES el username en minusculas, por lo que
   * cambiar el nombre de usuario implica un documento NUEVO. Si no se pasa
   * `usernameAnterior`, el documento viejo queda huerfano en la nube (y su
   * cuenta de Auth sigue existiendo). Por eso se borra explicitamente.
   */
  async actualizarPerfil({ username, nombre, rol, activo, permisos, usernameAnterior }) {
    const id = idDocumento(username);
    if (!id) return { ok: false, mensaje: 'El nombre de usuario es obligatorio.' };
    const rt = runtime();
    const conSesion = !!(rt.auth && rt.auth.currentUser);
    // Sin Firestore o sin sesión no hay nube que actualizar: se reporta
    // `nube:false` y el llamador persiste el cambio SOLO en IndexedDB (mismo
    // contrato que crearUsuario y eliminarPerfil). Antes, con la bandera
    // apagada devolvía ok:true y la edición NO se guardaba en NINGÚN lado
    // (app.js informaba exito tempranamente y salia sin escribir local).
    if (!firestoreDisponible() || !conSesion) {
      console.info('[usuarios] Edición de perfil en la nube omitida (sin Firestore o sin sesión).');
      return { ok: true, nube: false };
    }

    const idAnterior = idDocumento(usernameAnterior);
    const cambioDeUsuario = idAnterior && idAnterior !== id;

    try {
      const doc = construirDocPerfil({ username, nombre, rol, activo, permisos });
      await rt.setDoc(rt.doc(rt.dbFirebase, 'usuarios', id), doc, { merge: true });

      // Renombre: el documento anterior debe desaparecer, si no el usuario
      // queda duplicado en la nube y su nombre viejo nunca se libera.
      if (cambioDeUsuario) {
        try {
          await rt.deleteDoc(rt.doc(rt.dbFirebase, 'usuarios', idAnterior));
          console.info('[usuarios] Documento anterior eliminado tras renombrar:', idAnterior, '->', id);
        } catch (errDel) {
          console.warn('[usuarios] No se pudo borrar el documento anterior "' + idAnterior + '":', errDel && errDel.code, errDel && errDel.message);
        }
      }
      return { ok: true, renombrado: cambioDeUsuario };
    } catch (error) {
      return { ok: false, mensaje: traducirErrorAuth(error), codigo: error && error.code };
    }
  },

  /**
   * BAJA de usuario: elimina el documento de perfil de Firestore.
   *
   * La cuenta de Firebase Auth NO se puede borrar desde el cliente (requiere el
   * Admin SDK). Por eso el nombre queda tomado en la nube y el usuario no puede
   * volver a crearse.
   *
   * NOTA DE DISEÑO: la BAJA sigue el mismo esquema simétrico nube-primero que
   * LISTAR/ALTA/EDICIÓN (la bandera VITE_CDA_SYNC_USUARIOS_NUBE fue eliminada).
   * Historicamente el borrado sí estaba gateado por esa bandera y, con ella
   * apagada, era un no-op que devolvía {ok:true}: la UI informaba "eliminado
   * correctamente" y el perfil seguía en la lista. La defensa de escritura son
   * las reglas de Firestore (`allow delete: if esAdmin() && userId != miId()`).
   */
  async eliminarPerfil(username) {
    const id = idDocumento(username);
    if (!id) return { ok: false, mensaje: 'El nombre de usuario es obligatorio.' };
    const rt = runtime();
    const conSesion = !!(rt.auth && rt.auth.currentUser);
    // Sin Firestore o sin sesión no hay nada que borrar en la nube: se reporta
    // `ok` para que el llamador continúe con el borrado LOCAL sin error falso.
    if (!firestoreDisponible() || !conSesion) {
      return { ok: true, nube: false };
    }
    try {
      await rt.deleteDoc(rt.doc(rt.dbFirebase, 'usuarios', id));

      // VERIFICACIÓN ESTRICTA: la relectura debe ser EXITOSA y sin el documento.
      // Antes, si la relectura fallaba, `sigueExistiendo` quedaba en false y se
      // informaba "eliminado correctamente" sin haberlo borrado: el error quedaba
      // oculto y el usuario seguia apareciendo en la lista.
      await new Promise((r) => setTimeout(r, 250));
      try {
        const leer = typeof rt.getDocsFromServer === 'function' ? rt.getDocsFromServer : rt.getDocs;
        const snap = await leer(rt.collection(rt.dbFirebase, 'usuarios'));
        const sigueExistiendo = !!(snap && snap.docs && snap.docs.some((d) => d.id === id));
        if (sigueExistiendo) {
          console.error('[usuarios] El documento "' + id + '" sigue existiendo tras deleteDoc.');
          return {
            ok: false,
            mensaje: 'Firestore rechazó el borrado o el documento no se eliminó. Revisá las reglas de seguridad (allow delete).',
            codigo: 'no-eliminado'
          };
        }
      } catch (eVerif) {
        console.error('[usuarios] No se pudo verificar la baja de "' + id + '":', eVerif && eVerif.code);
        return {
          ok: false,
          mensaje: 'no se pudo verificar el borrado en el servidor (' +
            ((eVerif && (eVerif.code || eVerif.message)) || 'error desconocido') + ')',
          codigo: 'verificacion-fallida'
        };
      }
      return { ok: true, borrado: true };
    } catch (error) {
      console.error('[usuarios] No se pudo eliminar el perfil de la nube:', {
        code: error && error.code, message: error && error.message, path: 'usuarios/' + id
      });
      return { ok: false, mensaje: traducirErrorAuth(error), codigo: error && error.code };
    }
  },

  /**
   * Lista los perfiles de la NUBE (Firestore), que es la fuente de verdad de
   * los usuarios multi-dispositivo.
   *
   * ESTO ES ESENCIAL: la lista de "Control de Usuarios" se armaba solo con
   * IndexedDB, que es POR DISPOSITIVO. Por eso los usuarios creados en la
   * consola de Firebase (o en otro dispositivo) no aparecian nunca, aunque
   * existieran y se pudieran loguear.
   *
   * @returns {Promise<Array>} perfiles normalizados (id = doc id).
   */
  async listarPerfiles() {
    const rt = runtime();
    if (!firestoreDisponible() || typeof rt.getDocs !== 'function') return [];
    // Sin sesión las reglas rechazan la lectura: se devuelve vacío sin romper.
    if (!rt.auth || !rt.auth.currentUser) {
      console.info('[usuarios] Sin sesión activa: no se listan los perfiles de la nube.');
      return [];
    }
    try {
      // Se lee DIRECTO del servidor (sin la caché de Firestore): con caché, un
      // usuario recién borrado o editado seguía apareciendo con los datos viejos
      // y la app parecía no haber guardado nada.
      const leer = typeof rt.getDocsFromServer === 'function' ? rt.getDocsFromServer : rt.getDocs;
      const snap = await leer(rt.collection(rt.dbFirebase, 'usuarios'));
      if (!snap || snap.empty) return [];
      return snap.docs.map((d) => {
        const data = d.data() || {};
        return {
          id: d.id,
          username: data.username || d.id,
          nombre: data.nombre || data.username || d.id,
          rol: data.rol || 'viewer',
          activo: data.activo !== false,
          email: data.email || null,
          permisos: (data.permisos && typeof data.permisos === 'object')
            ? JSON.parse(JSON.stringify(data.permisos))
            : null,
          origen: 'nube'
        };
      });
    } catch (e) {
      console.error('[usuarios] No se pudieron listar los perfiles de la nube:', {
        code: e && e.code, message: e && e.message
      });
      return [];
    }
  },

  /** ¿Existe ya un perfil en Firestore para este username? */
  async existeEnNube(username) {
    if (!firestoreDisponible()) return false;
    try {
      const rt = runtime();
      const snap = await rt.getDoc(rt.doc(rt.dbFirebase, 'usuarios', idDocumento(username)));
      return !!(snap && snap.exists && (snap.exists() || snap.data));
    } catch (e) {
      return false;
    }
  },

  /**
   * Igual que `listarPerfiles()` pero DISTINGUE "colección vacía" de "falló la
   * lectura". Sin esto, un error de red o de permisos devolvía `[]` y la UI caía
   * silenciosamente a IndexedDB, mostrando usuarios viejos ya borrados de la
   * nube (el síntoma clásico de "borré y sigue apareciendo").
   *
   * @returns {Promise<{ok: boolean, perfiles: Array, mensaje: string|null}>}
   */
  async listarPerfilesConEstado() {
    const rt = runtime();
    if (!firestoreDisponible() || typeof rt.getDocs !== 'function') {
      return { ok: true, perfiles: [], mensaje: null, sinNube: true };
    }
    if (!rt.auth || !rt.auth.currentUser) {
      return { ok: true, perfiles: [], mensaje: null, sinSesion: true };
    }
    try {
      const leer = typeof rt.getDocsFromServer === 'function' ? rt.getDocsFromServer : rt.getDocs;
      const snap = await leer(rt.collection(rt.dbFirebase, 'usuarios'));
      const docs = (snap && snap.docs) ? snap.docs : [];
      return { ok: true, perfiles: docs.map((d) => {
        const data = d.data() || {};
        return {
          id: d.id,
          username: data.username || d.id,
          nombre: data.nombre || data.username || d.id,
          rol: data.rol || 'viewer',
          activo: data.activo !== false,
          email: data.email || null,
          permisos: (data.permisos && typeof data.permisos === 'object')
            ? JSON.parse(JSON.stringify(data.permisos))
            : null,
          origen: 'nube'
        };
      }), mensaje: null };
    } catch (e) {
      const mensaje = 'No se pudieron leer los perfiles de Firebase: ' +
        ((e && (e.code || e.message)) || 'error desconocido');
      console.error('[usuarios] ' + mensaje, e);
      return { ok: false, perfiles: [], mensaje };
    }
  },

  /**
   * PURGA MASIVA: elimina TODOS los perfiles de Firestore excepto los indicados
   * en `conservar` (normalmente el admin ancla). Útil para limpiar la colección
   * cuando quedaron documentos huérfanos o duplicados que el borrado individual
   * no alcanza a remover.
   *
   * Reporta qué se borró y qué falló, y verifica con una relectura FINAL que
   * solo queden los conservados.
   *
   * @param {string[]} conservar usernames (o ids de documento) a preservar.
   * @returns {Promise<{ok, borrados, fallidos, restantes, mensaje}>}
   */
  async purgarPerfilesExcepto(conservar) {
    const conservarIds = new Set((Array.isArray(conservar) ? conservar : [])
      .map((u) => idDocumento(typeof u === 'object' && u ? (u.username || u.id) : u))
      .filter(Boolean));
    if (!firestoreDisponible()) {
      return { ok: false, borrados: [], fallidos: [], restantes: [], mensaje: 'Firestore no está disponible.' };
    }
    const rt = runtime();
    if (!rt.auth || !rt.auth.currentUser) {
      return { ok: false, borrados: [], fallidos: [], restantes: [], mensaje: 'Sin sesión activa.' };
    }

    let ids = [];
    try {
      const leer = typeof rt.getDocsFromServer === 'function' ? rt.getDocsFromServer : rt.getDocs;
      const snap = await leer(rt.collection(rt.dbFirebase, 'usuarios'));
      ids = (snap && snap.docs) ? snap.docs.map((d) => d.id) : [];
    } catch (e) {
      return { ok: false, borrados: [], fallidos: [], restantes: [],
        mensaje: 'No se pudo leer la colección para purgar: ' + ((e && (e.code || e.message)) || 'error') };
    }

    const objetivo = ids.filter((id) => !conservarIds.has(idDocumento(id)));
    const borrados = [];
    const fallidos = [];

    for (const id of objetivo) {
      try {
        await rt.deleteDoc(rt.doc(rt.dbFirebase, 'usuarios', id));
        borrados.push(id);
      } catch (e) {
        console.error('[usuarios] Purga: no se pudo borrar "' + id + '":', e && (e.code || e.message));
        fallidos.push({ id, error: (e && (e.code || e.message)) || 'error desconocido' });
      }
    }

    // Verificación final con relectura EXITOSA del servidor.
    let restantes = null;
    try {
      const leer = typeof rt.getDocsFromServer === 'function' ? rt.getDocsFromServer : rt.getDocs;
      const snap = await leer(rt.collection(rt.dbFirebase, 'usuarios'));
      restantes = (snap && snap.docs) ? snap.docs.map((d) => d.id).filter((id) => !conservarIds.has(idDocumento(id))) : [];
    } catch (e) {
      return { ok: false, borrados, fallidos, restantes: null,
        mensaje: 'No se pudo verificar la purga: ' + ((e && (e.code || e.message)) || 'error') };
    }

    return {
      ok: restantes.length === 0 && fallidos.length === 0,
      borrados, fallidos, restantes,
      mensaje: restantes.length === 0 && fallidos.length === 0
        ? null
        : 'Quedaron ' + restantes.length + ' perfil(es) sin borrar.',
    };
  },

  /**
   * Detecta duplicados locales por `username`.
   * Conserva el registro con el rol mas privilegiado (admin > editor > viewer) y,
   * ante empate, el de menor id (el primero creado).
   */
  async limpiarDuplicadosLocales(usuarios) {
    const lista = Array.isArray(usuarios) ? usuarios : [];
    const prioridad = { admin: 3, supervisor: 2, editor: 1, viewer: 0 };
    const porUsername = new Map();
    const duplicados = [];

    for (const u of lista) {
      const key = idDocumento(u.username);
      if (!key) continue;
      const actual = porUsername.get(key);
      if (!actual) { porUsername.set(key, u); continue; }

      const pNuevo = prioridad[u.rol] !== undefined ? prioridad[u.rol] : -1;
      const pActual = prioridad[actual.rol] !== undefined ? prioridad[actual.rol] : -1;
      if (pNuevo > pActual || (pNuevo === pActual && Number(u.id) < Number(actual.id))) {
        porUsername.set(key, u);
        duplicados.push(actual);
      } else {
        duplicados.push(u);
      }
    }

    if (duplicados.length) {
      // INFO y no WARN: al fusionar nube+locales es esperable ver el mismo
      // usuario en ambos origenes, y un warn cada vez inundaba la consola.
      console.info('[usuarios] Se colapsaron ' + duplicados.length +
        ' registro(s) duplicado(s) por username (mismo usuario enIndexedDB y en la nube).');
    }
    return { unicos: Array.from(porUsername.values()), duplicados };
  },
};

export default userDirectoryService;
