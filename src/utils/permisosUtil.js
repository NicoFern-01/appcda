// src/utils/permisosUtil.js
// ============================================================
// VERSIÓN MÓDULO ES de `permisosUtil.js` (raíz).
// FASE 2 (aditivo): la app en runtime sigue usando la copia clásica de la
// raíz (que expone window.PermisosUtil/verificarPermiso para app.js).
// Este módulo ES es la fuente limpia y reutilizable para los futuros
// módulos de /src. NO se elimina la copia raíz hasta completar la
// conversión ESM de app.js (evita romper referencias).
// ============================================================

// ------------------ Catálogo de módulos ------------------
export const CATALOGO_MODULOS = Object.freeze([
  { id: 'dashboard',              nombre: 'Dashboard',                     icono: 'fa-gauge',           orden: 1,  funciones: ['ver'] },
  { id: 'calendario',             nombre: 'Calendario',                    icono: 'fa-calendar-days',   orden: 2,  funciones: ['ver'] },
  { id: 'competencias',           nombre: 'Competencias',                  icono: 'fa-calendar-days',   orden: 3,  funciones: ['ver', 'crear', 'editar', 'eliminar'] },
  { id: 'gastos',                 nombre: 'Gastos',                        icono: 'fa-receipt',         orden: 4,  funciones: ['ver', 'crear', 'editar', 'eliminar'] },
  { id: 'carga-detallada',        nombre: 'Carga Detallada (Rendiciones)', icono: 'fa-file-invoice',    orden: 5,  funciones: ['ver', 'crear', 'editar', 'eliminar'] },
  { id: 'personal-competencia',   nombre: 'Personal por Competencia',      icono: 'fa-people-group',    orden: 6,  funciones: ['ver', 'crear', 'editar', 'eliminar'] },
  { id: 'inventario',             nombre: 'Inventario',                    icono: 'fa-boxes-stacked',   orden: 7,  funciones: ['ver', 'crear', 'editar', 'eliminar'] },
  { id: 'articulos',              nombre: 'Artículos',                     icono: 'fa-box',             orden: 8,  funciones: ['ver', 'crear', 'editar', 'eliminar'] },
  { id: 'movimientos-inventario', nombre: 'Movimientos',                   icono: 'fa-right-left',      orden: 9,  funciones: ['ver', 'crear', 'editar', 'eliminar'] },
  { id: 'categorias-inventario',  nombre: 'Categorías de Inventario',      icono: 'fa-tags',            orden: 10, funciones: ['ver', 'crear', 'editar', 'eliminar'] },
  { id: 'entregas-inventario',    nombre: 'Entregas',                      icono: 'fa-truck-ramp-box',  orden: 11, funciones: ['ver', 'crear', 'editar', 'eliminar'] },
  { id: 'staff',                  nombre: 'Staff',                         icono: 'fa-user-tie',        orden: 12, funciones: ['ver', 'crear', 'editar', 'eliminar'] },
  { id: 'estadisticas-personal',  nombre: 'Estadísticas de Personal',      icono: 'fa-chart-column',    orden: 13, funciones: ['ver'] },
  { id: 'alojamiento',            nombre: 'Alojamiento',                   icono: 'fa-hotel',           orden: 14, funciones: ['ver', 'crear', 'editar', 'eliminar'] },
  { id: 'categorias-circuitos',   nombre: 'Categorías y Circuitos',        icono: 'fa-flag-checkered',  orden: 15, funciones: ['ver', 'crear', 'editar', 'eliminar'] },
  { id: 'configuracion',          nombre: 'Configuración',                 icono: 'fa-gear',            orden: 16, funciones: ['ver'], soloAdmin: true }
]);

export const MODULOS_MAP = Object.freeze(
  Object.fromEntries(CATALOGO_MODULOS.map((m) => [m.id, m]))
);

export const ACCIONES_VALIDAS = Object.freeze(['ver', 'crear', 'editar', 'eliminar']);
export const ROL_ADMIN = 'admin';
export const MODULOS_SOLO_LECTURA = Object.freeze(['dashboard', 'estadisticas-personal']);

export function construirPermisosAdmin() {
  const permisos = {};
  for (const modulo of CATALOGO_MODULOS) {
    permisos[modulo.id] = Object.fromEntries(modulo.funciones.map((f) => [f, true]));
  }
  return permisos;
}

export function construirPresetRol(rol) {
  const preset = {};
  for (const modulo of CATALOGO_MODULOS) {
    if (modulo.soloAdmin) continue;
    preset[modulo.id] =
      rol === 'viewer' || MODULOS_SOLO_LECTURA.includes(modulo.id)
        ? { ver: true }
        : { ver: true, crear: true, editar: true, eliminar: false };
  }
  return preset;
}

export const DICCIONARIO_ROLES = Object.freeze({
  admin: { label: 'Administrador (Acceso total)', accesoTotal: true, preset: construirPermisosAdmin() },
  editor: { label: 'Editor (Carga y edición de datos)', accesoTotal: false, preset: construirPresetRol('editor') },
  viewer: { label: 'Visualizador (Solo Lectura)', accesoTotal: false, preset: construirPresetRol('viewer') },
  supervisor: { label: 'Supervisor (Dashboard Solo)', accesoTotal: false, preset: { dashboard: { ver: true } } }
});
export function normalizarPermisos(rol, permisos) {
  const defRol = DICCIONARIO_ROLES[rol];
  if (defRol?.accesoTotal || rol === ROL_ADMIN) return construirPermisosAdmin();

  const origen = permisos && typeof permisos === 'object' ? permisos : {};
  const saneado = {};

  for (const modulo of CATALOGO_MODULOS) {
    if (modulo.soloAdmin) continue;
    const permsModulo = origen[modulo.id];
    const funcionesValidas = {};
    for (const funcion of modulo.funciones) {
      funcionesValidas[funcion] = Boolean(
        permsModulo && typeof permsModulo === 'object' && permsModulo[funcion] === true
      );
    }
    saneado[modulo.id] = funcionesValidas;
  }
  return saneado;
}

export function verificarPermiso(usuario, modulo, accion = 'ver') {
  const rol = usuario?.rol;
  if (rol === ROL_ADMIN) return true;
  if (MODULOS_MAP[modulo]?.soloAdmin) return false;
  const defModulo = MODULOS_MAP[modulo];
  if (!defModulo) return false;
  if (!defModulo.funciones.includes(accion)) return false;
  const flags = usuario?.permisos?.[modulo];
  if (!flags || typeof flags !== 'object') return false;
  if (flags.ver !== true) return false;
  return flags[accion] === true;
}

/** Objeto público solicitado en FASE 2: `export const permisos = ...` */
export const permisos = Object.freeze({
  CATALOGO_MODULOS,
  MODULOS_MAP,
  ACCIONES_VALIDAS,
  ROL_ADMIN,
  MODULOS_SOLO_LECTURA,
  DICCIONARIO_ROLES,
  construirPermisosAdmin,
  construirPresetRol,
  normalizarPermisos,
  verificarPermiso,
});
if (typeof globalThis !== 'undefined') {
  globalThis.PermisosUtil = permisos;
  globalThis.CATALOGO_MODULOS = CATALOGO_MODULOS;
  globalThis.MODULOS_MAP = MODULOS_MAP;
  globalThis.ACCIONES_VALIDAS = ACCIONES_VALIDAS;
  globalThis.ROL_ADMIN = ROL_ADMIN;
  globalThis.DICCIONARIO_ROLES = DICCIONARIO_ROLES;
  globalThis.normalizarPermisos = normalizarPermisos;
  globalThis.verificarPermiso = verificarPermiso;
}


export default permisos;