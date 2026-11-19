// src/services/schemaValidator.js
// ============================================================
// VALIDADOR DE ESQUEMAS EN ESCRITURA (A-5) - versión ES module.
//
// Espejo modular del validador interceptor `validarRegistro` que db.js
// ejecuta dentro de `guardar()` ANTES de impactar IndexedDB/Firestore.
// Esta es la fuente limpia y reutilizable (testeable) para los futuros
// módulos de /src; main.js la expone como window.__CDA_SCHEMA_VALIDATOR__.
//
// Garantiza que ningún objeto corrupto (no-objeto, sin clave primaria, con
// funciones, NaN o referencias circulares) llegue a persistirse y rompa el
// esquema. 'pilotos' usa 'dni' (string) como clave; el resto usa 'id' numérico.
// ============================================================

/** Clave primaria por store (todos usan 'id' con autoIncrement). */
export function clavePrimariaStore(storeName) {
  return 'id';
}

/**
 * Nombres de campos opcionales por store que se validan solo como strings,
 * con default para compatibilidad con registros previos.
 * 'pilotos': tipoLicencia y licencia (cadena o '-', no vacíos).
 */
const camposOpcionalesStrings = {
  pilotos: ['tipoLicencia', 'licencia']
};

/**
 * Valida un registro antes de escribirlo.
 * @param {string} storeName Nombre de la colección/object store.
 * @param {*} item Objeto a validar.
 * @returns {{ ok: boolean, motivo: string }}
 */
export function validarRegistro(storeName, item) {
  const resultado = { ok: true, motivo: '' };

  if (item === null || typeof item !== 'object' || Array.isArray(item)) {
    return fail(resultado, storeName, 'el registro no es un objeto simple');
  }

  const clave = clavePrimariaStore(storeName);
  if (typeof item[clave] === 'undefined') {
    return fail(resultado, storeName, `falta el campo '${clave}'`);
  }

  if (storeName === 'designacionesPersonal') {
    if (item.competenciaId === undefined || item.competenciaId === null || String(item.competenciaId).trim() === '') {
      return fail(resultado, storeName, "falta el campo 'competenciaId'");
    }
    if (item.staffId === undefined || item.staffId === null || String(item.staffId).trim() === '') {
      return fail(resultado, storeName, "falta el campo 'staffId'");
    }
    if (item.funcion !== undefined && (typeof item.funcion !== 'string' || item.funcion.length > 120)) {
      return fail(resultado, storeName, "el campo 'funcion' debe ser texto de hasta 120 caracteres");
    }
  }

  if (storeName === 'listaCorreosDesignaciones') {
    const email = typeof item.email === 'string' ? item.email.trim() : '';
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return fail(resultado, storeName, "el campo 'email' no es válido");
    }
    if (item.etiqueta !== undefined && (typeof item.etiqueta !== 'string' || item.etiqueta.length > 80)) {
      return fail(resultado, storeName, "el campo 'etiqueta' debe ser texto de hasta 80 caracteres");
    }
  }

  // Campos opcionales: valida que sean strings, asegura compatibilidad
  // con registros previos que no los portaron.
  const opcionales = camposOpcionalesStrings[storeName] || [];
  for (const campo of opcionales) {
    const valor = item[campo];
    if (valor === undefined || valor === null || valor === '') {
      item[campo] = '-';
    } else if (typeof valor !== 'string') {
      return fail(resultado, storeName, `el campo '${campo}' debe ser una cadena de texto`);
    }
  }

  const prohibidos = Object.values(item).some(
    (v) => typeof v === 'function' || (typeof v === 'number' && Number.isNaN(v))
  );
  if (prohibidos) {
    return fail(resultado, storeName, 'el registro contiene funciones o NaN');
  }

  try {
    JSON.stringify(item);
  } catch (e) {
    return fail(resultado, storeName, 'el registro contiene referencias circulares');
  }

  return resultado;
}

function fail(resultado, storeName, motivo) {
  resultado.ok = false;
  resultado.motivo = `[${storeName}] No se escribió: ${motivo}.`;
  return resultado;
}

/** Nombres de stores que NUNCA deben sincronizarse a la nube (A-4). */
export const STORES_NO_SYNC = Object.freeze(['usuarios']);

/** true si el store es sincronizable (no está en la lista negra). */
export function esStoreSincronizable(storeName) {
  return !STORES_NO_SYNC.includes(storeName);
}

/** Resolución defensiva de conflictos (A-3): gana mayor versión, empate → updatedAt. */
export function esMasReciente(a, b) {
  const va = Number(a && a.version) || 0;
  const vb = Number(b && b.version) || 0;
  if (va !== vb) return va > vb;
  const ta = a && a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
  const tb = b && b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
  return ta > tb;
}

export default validarRegistro;