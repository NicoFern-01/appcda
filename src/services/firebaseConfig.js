// src/services/firebaseConfig.js
// ============================================================
// CONFIGURACIÓN DE FIREBASE CENTRALIZADA (FASE 2).
//
// Lee las variables de entorno de Vite (archivo .env / .env.example) vía
// import.meta.env.VITE_FIREBASE_*. Si faltan (por ejemplo en un entorno sin
// .env), conserva los valores por defecto actuales (extraídos de db.js,
// DEFAULT_FIREBASE_CONFIG) para que la app jamás arranque rota.
//
// NOTA DE ARQUITECTURA: `import.meta.env` solo existe en módulos ES.
// `db.js` hoy es un script clásico, por eso se centraliza aquí la lectura
// de .env y, cuando db.js se convierta a ESM, este módulo se importará
// desde db.js/manteniendo exactamente la misma configuración.
// ============================================================

// Valores por defecto (idénticos a DEFAULT_FIREBASE_CONFIG de db.js).
const FALLBACK_CONFIG = {
  apiKey: 'AIzaSyAGT318kBRICwdjrU05RCUNSJRanAQnfPQ',
  projectId: 'controlcda-e5f97',
  storageBucket: 'controlcda-e5f97.firebasestorage.app',
  messagingSenderId: '971822887261',
  appId: '1:971822887261:web:abe3fd29049c176946f8b4',
  measurementId: 'G-L5C4YLVW1V'
};

// Mapas variable-de-entorno → clave del objeto config.
const ENV_MAP = [
  ['VITE_FIREBASE_API_KEY', 'apiKey'],
  ['VITE_FIREBASE_AUTH_DOMAIN', 'authDomain'],
  ['VITE_FIREBASE_PROJECT_ID', 'projectId'],
  ['VITE_FIREBASE_STORAGE_BUCKET', 'storageBucket'],
  ['VITE_FIREBASE_MESSAGING_SENDER_ID', 'messagingSenderId'],
  ['VITE_FIREBASE_APP_ID', 'appId'],
  ['VITE_FIREBASE_MEASUREMENT_ID', 'measurementId']
];

/**
 * Devuelve el objeto de configuración Firebase, priorizando .env (Vite)
 * y cayendo a los valores por defecto para cualquier clave ausente.
 * authDomain queda SIN valor por defecto para que db.js siga aplicando su
 * lógica dinámica (GitHub Pages vs localhost) sobre él.
 *
 * @returns {{apiKey:string, projectId:string, storageBucket?:string,
 *   messagingSenderId?:string, appId?:string, measurementId?:string, authDomain?:string}}
 */
export function getFirebaseConfig() {
  const env = /** @type {Record<string,string|undefined>} */ (
    typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {}
  );

  const config = { ...FALLBACK_CONFIG };

  for (const [envKey, confKey] of ENV_MAP) {
    const val = env[envKey];
    if (typeof val === 'string' && val.length > 0) {
      config[confKey] = val;
    }
  }

  // authDomain: si .env no lo aporta, NO forzamos uno (decisión de db.js).
  return config;
}

/** versión corta con alias para compatibilidad o testing. */
export const firebaseConfig = getFirebaseConfig();

export default getFirebaseConfig;