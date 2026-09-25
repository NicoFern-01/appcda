/* eslint-disable */
/* eslint-enable */
// src/main.js
// ============================================================
// NUEVO PUNTO DE ENTRADA MODERNO DE LA APLICACIÓN (FASE 2).
//
// ES ADITIVO Y NO DESTRUCTIVO: la app legacy (scripts clásicos
// permisosUtil.js/db.js/app.js) sigue siendo la que arranca e inicializa
// la UI en esta etapa. main.js se suma como capa de módulos ES para
// centralizar: estado (store), router de vistas, permisos y configuración
// Firebase desde .env.
//
// FASE 3: además expone bridge globales que db.js (script clásico) consume:
//   - window.__CDA_FIREBASE_CONFIG__   → config central desde .env
//   - window.__CDA_SCHEMA_VALIDATOR__  → validador ES reutilizable (A-5)
// ============================================================

import store, { syncStoreFromGlobal } from './core/store.js';
import { registerView, navigate, VIEW_IDS } from './core/router.js';
import { permisos } from './utils/permisosUtil.js';
import getFirebaseConfig, { firebaseConfig } from './services/firebaseConfig.js';
import validarRegistro from './services/schemaValidator.js';
import authService from './services/authService.js';
import persistenceService from './services/persistenceService.js';
import viewManager from './services/viewManager.js';
import { views } from './views/index.js';

// Registrar los adaptadores de vistas en el router (idempotente y seguro).
VIEW_IDS.forEach((id) => {
  if (views[id]) registerView(id, () => views[id]);
});

// Bridge globales consumidos por db.js (script clásico). Se aplican en
// tiempo de evaluación del módulo, ANTES de que DOMContentLoaded dispare
// inicializarFirebase(), por lo que db.js siempre encuentra la config.
if (typeof window !== 'undefined') {
  window.__CDA_FIREBASE_CONFIG__ = firebaseConfig;
  window.__CDA_SCHEMA_VALIDATOR__ = validarRegistro;

  window.__CDA_MODULES__ = Object.freeze({
    store,
    permisos,
    firebaseConfig,
    auth: authService,
    persistencia: persistenceService,
    vistas: viewManager,
    router: { registerView, navigate, VIEW_IDS },
  });
}

// Arranque auxiliar (no interfiere con el DOMContentLoaded de app.js).
function boot() {
  try {
    // Reflejar la sesión que app.js ya estableció (o null si aún no hay).
    syncStoreFromGlobal();
    // Pre-cargar la config desde .env (para logs y futuras fases).
    // eslint-disable-next-line no-unused-vars
    const config = getFirebaseConfig();
    console.info('[main.js] Capa de módulos lista. (FASE 4 - red de seguridad + servicios)');
  } catch (err) {
    // Nunca romper la app por el arranque de la capa auxiliar.
    console.warn('[main.js] No se pudo inicializar la capa de módulos:', err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}

export default {
  store,
  permisos,
  firebaseConfig,
  auth: authService,
  persistencia: persistenceService,
  vistas: viewManager,
  validarRegistro,
};