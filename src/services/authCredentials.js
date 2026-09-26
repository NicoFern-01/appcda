// src/services/authCredentials.js
// ============================================================
// MAPEO DE CREDENCIALES: Username <-> Email de Firebase Auth.
// ============================================================
// El formulario heredado pide "Usuario" (ej. `admin`), pero Firebase Auth
// exige un correo electrónico. Este módulo es la ÚNICA fuente de verdad de esa
// traducción, aislado del resto para que sea testeable de forma unitaria y
// configurable por entorno.
//
// Reglas de normalización (mínimas y predecibles):
//   - Si el valor ya parece un email válido, se usa tal cual.
//   - Si no, se expande a `<usuario>@<DOMINIO_POR_DEFECTO>`.
//   - Se recorta y se pasa a minúsculas para que el login sea estable
//     (Firebase Auth es case-sensitive en el correo).
// ============================================================

/** Dominio sintético para cuentas locales que no son correos reales. */
export const DOMINIO_AUTH_POR_DEFECTO = 'controlcda.com';

/**
 * Caracteres no permitidos en la parte local de un email.
 * Debe ser GLOBAL: se aplica sobre todo el texto, no solo la primera coincidencia.
 */
const INVALIDOS_PARTE_LOCAL = /[^\w.+\-]/g;

/**
 * Dominio efectivo de la aplicacion.
 * Se puede sobreescribir con VITE_CDA_AUTH_DOMAIN (ver .env).
 */
export const DOMINIO_AUTH_ACTIVO = (() => {
  const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : {};
  const configured = env && typeof env.VITE_CDA_AUTH_DOMAIN === 'string' ? env.VITE_CDA_AUTH_DOMAIN.trim() : '';
  return configured || DOMINIO_AUTH_POR_DEFECTO;
})();

/**
 * Normaliza un nombre de usuario a un correo electrónico utilizable por
 * Firebase Auth.
 *
 * @param {string} usernameIngresado Valor crudo del formulario de login.
 * @param {string} [dominio] Dominio a usar cuando el usuario no trae '@'.
 * @returns {string} Correo electrónico normalizado en minúsculas.
 */
export function normalizarUsernameAEmail(usernameIngresado, dominio = DOMINIO_AUTH_ACTIVO) {
  const crudo = String(usernameIngresado ?? '').trim();
  if (!crudo) return '';

  // Ya viene un correo: se respeta tal cual (solo trim + minúsculas).
  if (crudo.includes('@')) return crudo.toLowerCase();

  const parteLocal = crudo.toLowerCase().replace(INVALIDOS_PARTE_LOCAL, '');
  if (!parteLocal) return '';

  return `${parteLocal}@${String(dominio).trim().toLowerCase()}`;
}

/**
 * Extrae el "username" legible desde un correo de Firebase Auth, para
 * mostrarlo en la UI y para consultar el perfil en Firestore.
 *
 * @param {string} email Correo del usuario autenticado.
 * @returns {string} Nombre de usuario sin dominio ni '@'.
 */
export function extraerUsernameDeEmail(email) {
  const base = String(email ?? '').trim().toLowerCase();
  if (!base) return '';
  return base.split('@')[0];
}

/**
 * Construye el mapa de emails candidatos a consultar en Firestore.
 * Permite que el perfil se localize tanto por `email` como por `username`
 * (las colecciones existentes suelen guardar `username`, no `email`).
 *
 * @param {string} usernameIngresado
 * @returns {{ email: string, username: string }}
 */
export function construirIdentidadLogin(usernameIngresado) {
  const crudo = String(usernameIngresado ?? '').trim();
  const username = crudo.includes('@')
    ? extraerUsernameDeEmail(crudo)
    : crudo.toLowerCase();
  return {
    email: normalizarUsernameAEmail(crudo),
    username,
  };
}

export default { normalizarUsernameAEmail, extraerUsernameDeEmail, construirIdentidadLogin, DOMINIO_AUTH_POR_DEFECTO };
