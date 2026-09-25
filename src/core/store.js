// src/core/store.js
// ============================================================
// ALMACÉN DE ESTADO GLOBAL CONTROLADO (FASE 2, aditivo y no invasivo).
//
// Hoy `app.js` mantiene estado en variables sueltas de ámbito global
// (let currentUser, let dashboardDirty, let chartCategoriasInstance...).
// Para desacoplar esas variables sin romper las referencias (la app actual
// es de scripts clásicos y transversal), centralizamos aquí una vista
// ES-module del estado. Los módulos nuevos de /src lo consumen; el código
// legacy de app.js sigue usando sus propias variables hasta la fase de
// conversión ESM. NUNCA duplicamos mutaciones de sesión para no pisar la
// sesión real gestionada por app.js.
// ============================================================

/**
 * Estado global (interfaz ES module).
 * `currentUser` es un espejo de solo-lectura: los módulos nuevos lo leen,
 * pero quien escribe la sesión es, por ahora, app.js/handleLogin.
 */
export const store = {
  currentUser: null,
  dashboardDirty: true,
  device: {
    isMobile: false,
  },
};

/** Devuelve el objeto `store` (mismo singleton a lo largo de la app). */
export function useStore() {
  return store;
}

/**
 * Sincroniza `store.currentUser` desde la sesión global que gestiona app.js.
 * Función segura: no crea ni cierra sesión; solo refleja el estado actual.
 */
export function syncStoreFromGlobal() {
  if (typeof globalThis !== 'undefined' && globalThis.currentUser !== undefined) {
    store.currentUser = globalThis.currentUser;
  }
  return store;
}

export default store;