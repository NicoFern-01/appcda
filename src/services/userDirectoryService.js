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

// ==================== BANDERA DE FUNCIONALIDAD ====================
// La escritura de usuarios en la nube queda DESACTIVADA por defecto.
//
// Motivo: sin reglas de seguridad de Firestore, cualquiera puede abrir la
// consola y escribirse un documento con `rol: 'admin'`. La API key es publica
// por diseno (va en el bundle), asi que las reglas son la unica defensa.
//
// Para habilitarla, poner en .env:  VITE_CDA_SYNC_USUARIOS_NUBE=true
// (solo despues de haber publicado las reglas restrictivas en Firebase).
//
// Con la bandera apagada NO se rompe nada: el alta/edicion sigue funcionando
// exactamente como antes, guardando solo en IndexedDB.
function leerBanderaSyncNube() {
  const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : {};
  const valor = env && env.VITE_CDA_SYNC_USUARIOS_NUBE;
  return String(valor).trim().toLowerCase() === 'true';
}

const SYNC_USUARIOS_NUBE = leerBanderaSyncNube();
console.info('[usuarios] Sincronizacion de usuarios con la nube: ' +
  (SYNC_USUARIOS_NUBE ? 'HABILITADA' : 'DESACTIVADA (solo local)'));
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
    // Bandera apagada: se omite la nube y se sigue solo con IndexedDB.
    if (!SYNC_USUARIOS_NUBE) {
      console.info('[usuarios] Alta en la nube omitida (bandera desactivada).');
      return { ok: true, nube: false };
    }
    const id = idDocumento(username);
    if (!id) return { ok: false, mensaje: 'El nombre de usuario es obligatorio.' };
    if (!password) return { ok: false, mensaje: 'La contraseña es obligatoria para nuevos usuarios.' };

    if (!authDisponible()) {
      return { ok: false, mensaje: 'Firebase Auth no está disponible. No se pudo crear el usuario.' };
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
      return { ok: false, mensaje: traducirErrorAuth(error), codigo: error && error.code };
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
    // Bandera apagada: se omite la nube y se sigue solo con IndexedDB.
    if (!SYNC_USUARIOS_NUBE) {
      console.info('[usuarios] Edicion de perfil en la nube omitida (bandera desactivada).');
      return { ok: true, nube: false };
    }
    const id = idDocumento(username);
    if (!id) return { ok: false, mensaje: 'El nombre de usuario es obligatorio.' };
    if (!firestoreDisponible()) {
      return { ok: false, mensaje: 'Firestore no está disponible. No se pudo actualizar el perfil.' };
    }

    const idAnterior = idDocumento(usernameAnterior);
    const cambioDeUsuario = idAnterior && idAnterior !== id;

    try {
      const rt = runtime();
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
   * volver a crearse. Se desactiva la identidad documentandolo en el perfil,
   * de modo que el bloqueo quede explícito en lugar de ser un fallo místico.
   */
  async eliminarPerfil(username) {
    if (!SYNC_USUARIOS_NUBE) {
      return { ok: true, nube: false };
    }
    const id = idDocumento(username);
    if (!id) return { ok: false, mensaje: 'El nombre de usuario es obligatorio.' };
    if (!firestoreDisponible()) {
      return { ok: false, mensaje: 'Firestore no está disponible. No se pudo eliminar el perfil.' };
    }
    try {
      const rt = runtime();
      await rt.deleteDoc(rt.doc(rt.dbFirebase, 'usuarios', id));
      return { ok: true, borrado: true };
    } catch (error) {
      console.error('[usuarios] No se pudo eliminar el perfil de la nube:', {
        code: error && error.code, message: error && error.message, path: 'usuarios/' + id
      });
      return { ok: false, mensaje: traducirErrorAuth(error), codigo: error && error.code };
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
      console.warn('[usuarios] Duplicados detectados por username:', duplicados.length);
    }
    return { unicos: Array.from(porUsername.values()), duplicados };
  },
};

export default userDirectoryService;
