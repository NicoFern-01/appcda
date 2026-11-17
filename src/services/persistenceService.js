// src/services/persistenceService.js
// ============================================================
// DOMINIO: PERSISTENCIA (extraído de db.js — FASE 6).
//
// Implementa el núcleo de datos como ES module: guardar, getTodos, eliminar,
// obtenerPorId y los dos flujos de sincronización con Firestore. Integra de
// forma nativa e interna:
//   - schemaValidator.js (validarRegistro / esMasReciente / esStoreSincronizable)
//   - versionado incremental (version / updatedAt / createdAt)
//   - lista negra de stores sensibles (usuarios)
//
// Estado compartido con db.js:
//   - cache (_cache/_cloudChecked) vivela en window.__CDA_DB_STATE__ (bridge).
//   - Runtime de Firestore en window.__CDA_FIREBASE_RUNTIME__.
//   - openDB()/abrirTransaccionDefensiva() siguen en db.js (schema + dbInstance).
// ============================================================

import { validarRegistro, esMasReciente, esStoreSincronizable, clavePrimariaStore } from './schemaValidator.js';

// Estado de caché compartido con db.js (mismo objeto en ambos lados).
function estado() {
  const st = (typeof window !== 'undefined' && window.__CDA_DB_STATE__) || {};
  if (!st._cache) st._cache = {};
  if (!st._cloudChecked) st._cloudChecked = {};
  return st;
}

// Runtime de Firestore (expuesto por db.js al conectar).
function runtime() {
  return (typeof window !== 'undefined' && window.__CDA_FIREBASE_RUNTIME__) || {};
}

// Limpia un valor para Firestore (sin references a undefined).
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
      if (cleaned !== undefined) result[key] = cleaned;
    }
    return result;
  }
  return value;
}

function invalidarCache(storeName) {
  const st = estado();
  delete st._cache[storeName];
  delete st._cloudChecked[storeName];
}

function limpiarCacheCompleto() {
  const st = estado();
  Object.keys(st._cache).forEach((k) => delete st._cache[k]);
  Object.keys(st._cloudChecked).forEach((k) => delete st._cloudChecked[k]);
}

async function obtenerNombresColeccionesLocales() {
  const openDB = typeof globalThis !== 'undefined' ? globalThis.openDB : null;
  if (typeof openDB !== 'function') return [];
  const db = await openDB();
  return Array.from(db.objectStoreNames);
}

// ---------------- GUARDAR ----------------
export async function guardar(storeName, item) {
  // A-5: validación de esquema antes de impactar cualquier persistencia.
  // El id debe existir ANTES de validar: el validador lo exige y los stores
  // usan keyPath 'id' con autoIncrement, asi que un registro nuevo llega sin id.
  // Si se validara antes de generarlo, NINGUN alta nueva se podria guardar.
  // EXCEPCIÓN: 'pilotos' usa 'dni' (string) como clave primaria (doc ID
  // `/pilotos/{dni}`): NO se genera id numérico, el DNI llega ya sanitizado
  // desde el formulario y actúa como clave.
  const clave = clavePrimariaStore(storeName);
  // Todos los stores (incluido 'pilotos') usan 'id' como clave primaria.
  // Para 'pilotos' se genera un id numérico/UUID igual que el resto.
  if (!item.id) {
    // UUID string (compatibilidad Firestore). No convertir a number.
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      item.id = crypto.randomUUID();
    } else {
      // Fallback: crypto.getRandomValues → UUID v4 sin tocar números.
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      item.id =
        bytes.subarray(0, 4).join('') + '-' +
        bytes.subarray(4, 6).join('') + '-' +
        bytes.subarray(6, 8).join('') + '-' +
        bytes.subarray(8, 10).join('') + '-' +
        bytes.subarray(10).join('');
    }
  } else {
    // Ya tiene id: preservarlo sin conversion numérica (UUID string).
    if (typeof item.id !== 'string') {
      // Si viene como number y no es UUID, rechazamos.
      if (typeof item.id === 'number') {
        // Solo aceptar si es un UUID válido (string)
        console.warn('[persistencia] ID numérico rechazado para ' + storeName + ': ' + item.id);
        return null;
      }
    }
  }

  const validacion = validarRegistro(storeName, item);
  if (!validacion.ok) {
    console.error(validacion.motivo);
    return null;
  }

  // A-3: versionado incremental.
  const ahora = new Date().toISOString();
  if (!item.createdAt) item.createdAt = ahora;
  item.updatedAt = ahora;
  item.version = Number(item.version) ? Number(item.version) + 1 : 1;

  if (item && typeof item === 'object' && item.permisos && typeof item.permisos === 'object') {
    item.permisos = limpiarObjetoParaFirebase(item.permisos);
  }


  const cache = () => estado()._cache;

  // SIEMPRE guardar primero en IndexedDB (fuente primaria local).
  const result = await new Promise((resolve, reject) => {
    (typeof globalThis !== 'undefined' ? globalThis.openDB() : Promise.reject('no openDB'))
      .then((db) => {
        const transaction = (globalThis.abrirTransaccionDefensiva || (() => null))(db, storeName, 'readwrite');
        if (!transaction) { reject(`Object store '${storeName}' no disponible en IndexedDB.`); return; }
        const store = transaction.objectStore(storeName);
        const request = store.put(item);

        request.onsuccess = (event) => {
          const key = event.target.result;
          if (storeName === 'pilotos') {
            // keyPath 'dni': la clave ES el DNI (string), sin coerción numérica.
            item.dni = String(item.dni ?? key ?? '').trim();
          } else {
            try { if (!item.id) item.id = Number(key); } catch (e) { /* noop */ }
          }
          if (cache()[storeName]) {
            const idx = cache()[storeName].findIndex((x) => String(x[clave]) === String(item[clave]));
            const clone = Object.assign({}, item);
            if (idx >= 0) cache()[storeName][idx] = clone;
            else cache()[storeName].push(clone);
          }
          resolve(key);
        };
        request.onerror = (event) => reject(`Error al guardar en ${storeName}: ` + event.target.error);
      })
      .catch(reject);
  });

  // Clave del documento en Firestore: todos los stores usan el 'id'.
  // Para 'pilotos' el doc vive en `/pilotos/{id}`.
  const claveDoc = String(item.id);

  // Sync cloud: solo si Firebase activo Y store sincronizable (A-4). No bloqueante.
  const rt = runtime();
  if (rt.useFirebase && esStoreSincronizable(storeName)) {
    try {
      await rt.setDoc(rt.doc(rt.dbFirebase, storeName, claveDoc), limpiarObjetoParaFirebase(item));
    } catch (e) {
      console.warn(`Firebase sync warning [${storeName}]:`, e);
    }
  }

  return result;
}

// ---------------- GET TODOS ----------------
export async function getTodos(storeName, opciones = {}) {
  const cache = () => estado()._cache;
  const cloudChecked = () => estado()._cloudChecked;

  if (cache()[storeName] && cache()[storeName].length > 0) {
    return cache()[storeName];
  }

  const abrirTransaccion = globalThis.abrirTransaccionDefensiva || (() => null);
  const dataLocal = await new Promise((resolve, reject) => {
    (typeof globalThis !== 'undefined' ? globalThis.openDB() : Promise.reject('no openDB'))
      .then((db) => {
        const transaction = abrirTransaccion(db, storeName, 'readonly');
        if (!transaction) { resolve([]); return; }
        const store = transaction.objectStore(storeName);
        const request = store.getAll();
        request.onsuccess = (event) => {
          cache()[storeName] = event.target.result;
          resolve(event.target.result);
        };
        request.onerror = (event) => reject(`Error al leer de ${storeName}: ` + event.target.error);
      })
      .catch(reject);
  });

  const rt = runtime();
  // Las reglas de Firestore exigen sesion para LEER. Sin ella, esta lectura
  // falla con "Missing or insufficient permissions" y, peor, marca la coleccion
  // como ya consultada (`cloudChecked`), por lo que no volveria a intentar la nube.
  const haySesion = !!(rt.auth && rt.auth.currentUser);
  if (dataLocal.length === 0 && !opciones.soloLocal && rt.useFirebase && rt.dbFirebase &&
      typeof rt.getDocs === 'function' && typeof rt.collection === 'function' &&
      haySesion && !cloudChecked()[storeName]) {
    cloudChecked()[storeName] = true;
    try {
      console.log(`Colección '${storeName}' vacía en IndexedDB. Forzando lectura directa desde Firestore...`);
      const querySnapshot = await rt.getDocs(rt.collection(rt.dbFirebase, storeName));
      const dataNube = [];
      querySnapshot.forEach((docSnap) => {
        const item = docSnap.data();
        item.id = Number(docSnap.id) || docSnap.id;
        dataNube.push(item);
      });
      cache()[storeName] = dataNube;
      if (dataNube.length > 0) {
        try {
          const db = await globalThis.openDB();
          const transaction = abrirTransaccion(db, storeName, 'readwrite');
          const store = transaction ? transaction.objectStore(storeName) : null;
          if (store) for (const item of dataNube) store.put(item);
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

// ---------------- ELIMINAR ----------------
export async function eliminar(storeName, id) {
  const cache = () => estado()._cache;
  // Clave nativa del store: todos usan el 'id' (UUID string).
  const claveBorrado = String(id ?? '');
  await new Promise((resolve, reject) => {
    (typeof globalThis !== 'undefined' ? globalThis.openDB() : Promise.reject('no openDB'))
      .then((db) => {
        const transaction = (globalThis.abrirTransaccionDefensiva || (() => null))(db, storeName, 'readwrite');
        if (!transaction) { reject(`Object store '${storeName}' no disponible en IndexedDB.`); return; }
        const store = transaction.objectStore(storeName);
        const request = store.delete(claveBorrado);
        request.onsuccess = () => {
          if (cache()[storeName]) {
            cache()[storeName] = cache()[storeName].filter((x) => String(x[clavePrimariaStore(storeName)]) !== String(claveBorrado));
          }
          resolve();
        };
        request.onerror = (event) => reject(`Error al eliminar en ${storeName}: ` + event.target.error);
      })
      .catch(reject);
  });

  // Sync cloud (no bloqueante) y respetando lista negra (A-4).
  const rt = runtime();
  if (rt.useFirebase && esStoreSincronizable(storeName)) {
    try {
      await rt.deleteDoc(rt.doc(rt.dbFirebase, storeName, String(id)));
    } catch (e) {
      console.warn(`Firebase delete sync warning [${storeName}]:`, e);
    }
  }
}

// ---------------- OBTENER POR ID ----------------
export async function obtenerPorId(storeName, id) {
  const cache = () => estado()._cache;
  // Comparación por clave nativa: todos usan el 'id' (UUID string).
  const claveBuscada = String(id ?? '');
  if (cache()[storeName]) {
    const found = cache()[storeName].find((x) => String(x[clavePrimariaStore(storeName)]) === String(claveBuscada));
    if (found) return found;
  }

  return new Promise((resolve, reject) => {
    (typeof globalThis !== 'undefined' ? globalThis.openDB() : Promise.reject('no openDB'))
      .then((db) => {
        const transaction = (globalThis.abrirTransaccionDefensiva || (() => null))(db, storeName, 'readonly');
        if (!transaction) { resolve(null); return; }
        const store = transaction.objectStore(storeName);
        const request = store.get(claveBuscada);
        request.onsuccess = (event) => resolve(event.target.result);
        request.onerror = (event) => reject(`Error al obtener de ${storeName} con id ${id}: ` + event.target.error);
      })
      .catch(reject);
  });
}

// ---------------- SYNC: Firebase → Local ----------------
export async function sincronizarFirebaseALocal(stores) {
  const rt = runtime();
  if (!rt.useFirebase || !rt.dbFirebase || typeof rt.getDocs !== 'function' || typeof rt.collection !== 'function') return 0;
  // Las reglas exigen `signedIn()` para leer. Sin sesión, TODAS las colecciones
  // fallan con "Missing or insufficient permissions": se aborta limpio.
  if (!(rt.auth && rt.auth.currentUser)) {
    console.info('[persistencia] Sin sesión activa: no se descargan datos de Firestore.');
    return 0;
  }

  let total = 0;
  for (const storeName of stores) {
    if (!esStoreSincronizable(storeName)) continue;
    try {
      const snapNube = await rt.getDocs(rt.collection(rt.dbFirebase, storeName));
      if (snapNube.empty) continue;

      invalidarCache(storeName);
      const locales = await getTodos(storeName, { soloLocal: true });
      const claveNativa = (item) => String(item[clavePrimariaStore(storeName)] ?? '');
      const porId = new Map(locales.map((item) => [claveNativa(item), item]));
      const desdeNube = [];

      snapNube.forEach((docSnap) => {
        const item = docSnap.data();
        if (storeName === 'pilotos') {
          // Doc ID de Firestore = DNI (string), sin coerción numérica.
          item.dni = String(docSnap.id);
          item.id = String(docSnap.id);
        } else {
          item.id = Number(docSnap.id) || docSnap.id;
        }
        const local = porId.get(claveNativa(item));
        if (local && esMasReciente(local, item)) return;
        desdeNube.push(item);
      });

      if (desdeNube.length === 0) continue;

      const db = await globalThis.openDB();
      const transaction = (globalThis.abrirTransaccionDefensiva || (() => null))(db, storeName, 'readwrite');
      if (!transaction) continue;
      const store = transaction.objectStore(storeName);
      for (const item of desdeNube) store.put(item);

      await new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error('Transacción cancelada'));
      });

      const fusion = new Map(porId);
      desdeNube.forEach((item) => fusion.set(claveNativa(item), item));
      estado()._cache[storeName] = Array.from(fusion.values());
      total += desdeNube.length;
      console.log(`Colección '${storeName}': ${desdeNube.length} registros descargados desde Firestore (resolución A-3).`);
    } catch (e) {
      // Antes se imprimía el error crudo, que en varios casos era un
      // "TypeError" sin mensaje y se veía como un `null` inútil. Se agrega
      // contexto para poder diagnosticar sin adivinar.
      console.warn(`No se pudo descargar '${storeName}' desde Firestore:`, {
        mensaje: (e && e.message) || String(e),
        codigo: e && e.code,
        nombre: e && e.name,
        conSesion: !!(rt.auth && rt.auth.currentUser)
      });
    }
  }
  return total;
}

// ---------------- SYNC: Local → Firebase ----------------
export async function sincronizarLocalAFirebase() {
  const rt = runtime();
  if (!rt.useFirebase || !rt.dbFirebase) {
    if (typeof window !== 'undefined') {
      window.firebaseSyncResult = { status: 'error', message: 'Firebase no está conectado.', count: 0 };
    }
    return;
  }

  let stores;
  try {
    stores = await obtenerNombresColeccionesLocales();
    console.log('Colecciones locales detectadas en IndexedDB:', stores);
  } catch (e) {
    console.warn('No se pudieron obtener las colecciones locales, usando lista por defecto:', e);
    stores = ['categorias', 'circuitos', 'staff', 'competencias', 'gastos', 'conceptos', 'usuarios', 'rendiciones'];
  }

  let total = 0;
  const detalle = [];

  for (const storeName of stores) {
    if (!esStoreSincronizable(storeName)) {
      detalle.push(`${storeName}: omitido (solo local, lista negra A-4)`);
      continue;
    }

    let snapshot = null;
    try {
      snapshot = await rt.getDocs(rt.collection(rt.dbFirebase, storeName));
    } catch (e) {
      console.warn(`No se pudo verificar la colección '${storeName}' en Firestore:`, e);
      continue;
    }

    const nubePorId = new Map();
    // Doc ID nativo por store: todos usan 'id'.
    const claveDocNube = (item) => String(item[clavePrimariaStore(storeName)] ?? '');
    const claveIdNube = (docSnap, docItem) => {
      docItem.id = Number(docSnap.id) || docSnap.id;
      return claveDocNube(docItem);
    };
    snapshot.forEach((docSnap) => {
      const docItem = docSnap.data();
      nubePorId.set(claveIdNube(docSnap, docItem), docItem);
    });

    invalidarCache(storeName);
    const dataLocal = await getTodos(storeName, { soloLocal: true });

    if (nubePorId.size === 0) {
      for (const item of dataLocal) {
        try {
          await rt.setDoc(rt.doc(rt.dbFirebase, storeName, claveDocNube(item)), limpiarObjetoParaFirebase(item));
          total++;
        } catch (e) {
          console.warn(`Error sync ${storeName}/${claveDocNube(item)}:`, e);
        }
      }
      detalle.push(`${storeName}: ${dataLocal.length} registros subidos (Firestore estaba vacía)`);
    } else {
      let subidos = 0;
      for (const item of dataLocal) {
        const nube = nubePorId.get(claveDocNube(item));
        if (!nube) {
          try {
            await rt.setDoc(rt.doc(rt.dbFirebase, storeName, claveDocNube(item)), limpiarObjetoParaFirebase(item));
            subidos++;
            total++;
          } catch (e) { console.warn(`Error sync ${storeName}/${claveDocNube(item)}:`, e); }
        } else if (!esMasReciente(nube, item)) {
          try {
            await rt.setDoc(rt.doc(rt.dbFirebase, storeName, claveDocNube(item)), limpiarObjetoParaFirebase(item));
            subidos++;
            total++;
          } catch (e) { console.warn(`Error sync ${storeName}/${claveDocNube(item)}:`, e); }
        }
      }
      detalle.push(`${storeName}: ${nubePorId.size} en nube; ${subidos} locales más recientes subidos`);
    }
  }

  if (typeof window !== 'undefined') {
    window.firebaseSyncResult = { status: 'synced', message: `Completado: ${total} registros subidos.`, count: total, detalle };
  }
  console.log(`Sincronización local→Firebase completada: ${total} registros subidos.`);
  console.log('Detalle de sincronización:', detalle);

  const descargados = await sincronizarFirebaseALocal(stores);
  console.log(`Sincronización Firebase→local completada: ${descargados} registros descargados.`);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('firebase-sync-complete', { detail: { total, detalle } }));
  }
}

// ---------------- SUSCRIPCIÓN EN TIEMPO REAL (onSnapshot) ----------------
// Mantiene UNA suscripción activa por colección (para 'pilotos' la usa el
// Listado de Pilotos): cada cambio remoto invalida la cache y re-renderiza
// la vista activa con `firebase-sync-complete` + `listarPilotos()`.
const _suscripciones = {};
export function suscribirColeccion(storeName, coleccion = storeName) {
  const rt = runtime();
  if (typeof rt.onSnapshot !== 'function' || !rt.dbFirebase || typeof rt.collection !== 'function') return null;
  if (_suscripciones[storeName]) return _suscripciones[storeName];
  try {
    const ref = rt.collection(rt.dbFirebase, coleccion);
    _suscripciones[storeName] = rt.onSnapshot(ref, (snap) => {
      invalidarCache(storeName);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('firebase-sync-complete', { detail: { total: snap.size, store: storeName } }));
      }
    });
    return _suscripciones[storeName];
  } catch (e) {
    console.warn(`No se pudo suscribir a '${coleccion}' en tiempo real:`, e);
    return null;
  }
}

export function cancelarSuscripcion(storeName) {
  const off = _suscripciones[storeName];
  if (typeof off === 'function') { try { off(); } catch (e) { /* noop */ } }
  delete _suscripciones[storeName];
}

// ---------------- Interfaz de servicio ----------------
export const persistenceService = {
  guardar,
  getTodos,
  eliminar,
  obtenerPorId,
  invalidarCache,
  limpiarCacheCompleto,
  sincronizarLocalAFirebase,
  sincronizarFirebaseALocal,
  suscribirColeccion,
  cancelarSuscripcion,
  limpiarObjetoParaFirebase,
};

export default persistenceService;
