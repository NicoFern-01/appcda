// permisosUtil.js - Sistema de permisos granulares por módulos y funciones
// ========================================================================
// Capa 2 (Normalización): normalizarPermisos()  → sanea ANTES de guardar en Firestore/IndexedDB.
// Capa 3 (Consulta):      verificarPermiso()    → decide EN RUNTIME si se permite una acción.
//
// Regla estricta: el módulo 'configuracion' es EXCLUSIVO del rol 'admin'.
//
// Compatible con <script> clásico (como index.html lo carga hoy) y con módulos ES:
//   - Carga clásica (recomendada): <script src="permisosUtil.js"></script> (ANTES de app.js)
//     → expone window.PermisosUtil y los globales normalizarPermisos()/verificarPermiso().
//   - Módulo ES (futuro): import { CATALOGO_MODULOS, normalizarPermisos, verificarPermiso }
//     from './permisosUtil.js';
// ========================================================================

'use strict';

// ==================== CATÁLOGO DE MÓDULOS (constante, NO se persiste) ====================
// Fuente única de verdad sobre qué módulos existen y qué funciones admite cada uno.
// Los IDs coinciden 1:1 con la constante `views` de app.js.
// 'soloAdmin: true' marca los módulos de acceso restringido (regla estricta).

const CATALOGO_MODULOS = Object.freeze([
    { id: 'dashboard',              nombre: 'Dashboard',                     icono: 'fa-gauge',           orden: 1,  funciones: ['ver'] },
    // Módulo 'calendario' (nuevo): lee datos desde Google Sheets. Por ahora solo lectura.
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

// Índice O(1) por id de módulo (evita recorrer el array en cada verificación).
const MODULOS_MAP = Object.freeze(
    Object.fromEntries(CATALOGO_MODULOS.map(m => [m.id, m]))
);

// Acciones válidas del sistema (orden canónico para UIs y serialización).
const ACCIONES_VALIDAS = Object.freeze(['ver', 'crear', 'editar', 'eliminar']);

// Rol privilegiado: acceso total garantizado por diseño, no por datos.
const ROL_ADMIN = 'admin';

// ==================== DICCIONARIO DE ROLES (extensible) ====================
// Fuente única de verdad para el combo de roles del modal de usuarios y para
// los presets de migración. Para agregar un rol nuevo (ej: 'auditor') basta con
// sumar una entrada aquí: { label: '...', accesoTotal: false, preset: {...} }.
//   - accesoTotal: true  → acceso garantizado a TODOS los módulos (solo admin).
//   - preset: mapa { moduloId: { funcion: bool } } usado como base del rol.

// Módulos que solo admiten la función 'ver' (no tienen sentido crear/editar/eliminar).
const MODULOS_SOLO_LECTURA = Object.freeze(['dashboard', 'estadisticas-personal']);

/**
 * Construye un preset "estilo rol clásico" recorriendo el catálogo:
 * ver/crear/editar en true y eliminar en false (omitido en módulos de solo lectura).
 */
function construirPresetRol(rol) {
    const preset = {};
    for (const modulo of CATALOGO_MODULOS) {
        if (modulo.soloAdmin) continue; // 'configuracion' jamás en presets de no-admins
        preset[modulo.id] = (rol === 'viewer' || MODULOS_SOLO_LECTURA.includes(modulo.id))
            ? { ver: true }
            : { ver: true, crear: true, editar: true, eliminar: false };
    }
    return preset;
}

const DICCIONARIO_ROLES = Object.freeze({
    admin: {
        label: 'Administrador (Acceso total)',
        accesoTotal: true,
        preset: construirPermisosAdmin()
    },
    editor: {
        label: 'Editor (Carga y edición de datos)',
        accesoTotal: false,
        preset: construirPresetRol('editor')
    },
    viewer: {
        label: 'Visualizador (Solo Lectura)',
        accesoTotal: false,
        preset: construirPresetRol('viewer')
    },
    supervisor: {
        label: 'Supervisor (Dashboard Solo)',
        accesoTotal: false,
        preset: { dashboard: { ver: true } }
    }
    // Aquí podés agregar nuevos roles en el futuro (ej: 'auditor', 'coordinador').
});

/**
 * Construye el objeto de permisos COMPLETO para el rol admin:
 * todos los módulos del catálogo con TODAS sus funciones admitidas en true.
 * (Los módulos de solo lectura reciben únicamente { ver: true }).
 * @returns {Object} permisos completos
 */
function construirPermisosAdmin() {
    const permisos = {};
    for (const modulo of CATALOGO_MODULOS) {
        permisos[modulo.id] = Object.fromEntries(modulo.funciones.map(f => [f, true]));
    }
    return permisos;
}

/**
 * CAPA 2 - NORMALIZACIÓN (ejecutar SIEMPRE antes de guardar en Firestore/IndexedDB).
 *
 * Garantiza la invariante del diseño:
 *   - rol 'admin'  → objeto completo, todos los módulos con todas sus funciones en true
 *                    (incluye 'configuracion').
 *   - rol != admin → elimina POR COMPLETO la clave 'configuracion', descarta módulos
 *                    y funciones desconocidas (datos sucios), y rellena con false
 *                    cualquier módulo o función faltante del catálogo.
 *
 * Es una función PURA: nunca muta el objeto recibido.
 *
 * @param {string} rol        Rol del usuario ('admin' | 'editor' | 'viewer' | 'supervisor' | ...)
 * @param {Object} [permisos] Objeto de permisos tal cual llegó (puede ser null/undefined/sucio)
 * @returns {Object} Objeto `permisos` completamente saneado, listo para persistir
 */
function normalizarPermisos(rol, permisos) {
    // ---- Caso rol con accesoTotal (admin): acceso total garantizado por el
    // diccionario (ignora lo que venga, por seguridad). ROL_ADMIN queda como
    // fallback de compatibilidad con datos históricos. ----
    const defRol = DICCIONARIO_ROLES[rol];
    if (defRol?.accesoTotal || rol === ROL_ADMIN) return construirPermisosAdmin();

    // ---- Caso no-admin: saneo completo ----
    const origen = (permisos && typeof permisos === 'object') ? permisos : {};
    const saneado = {};

    for (const modulo of CATALOGO_MODULOS) {
        // Regla estricta: 'configuracion' NUNCA se persiste para no-admins.
        if (modulo.soloAdmin) continue;

        const permsModulo = origen[modulo.id];
        const funcionesValidas = {};

        for (const funcion of modulo.funciones) {
            // Coerción estricta: solo un booleano true explícito cuenta como permitido.
            funcionesValidas[funcion] = Boolean(
                permsModulo && typeof permsModulo === 'object' && permsModulo[funcion] === true
            );
        }
        saneado[modulo.id] = funcionesValidas;
    }

    // Nota: los módulos presentes en `origen` que NO están en el catálogo (o que sean
    // soloAdmin) se descartan silenciosamente: el resultado solo contiene claves válidas.
    return saneado;
}

/**
 * CAPA 3 - CONSULTA EN RUNTIME (reemplaza progresivamente a puedeEditar()/esAdmin()).
 *
 * Reglas de evaluación (en orden):
 *   1. rol 'admin'                            → true inmediato (acceso total).
 *   2. módulo 'configuracion' sin rol admin   → false inmediato (regla estricta).
 *   3. módulo o acción desconocidos           → false (fail-safe).
 *   4. `permisos[modulo].ver` !== true        → false (interruptor maestro del módulo).
 *   5. flag de la acción pedida !== true      → false.
 *
 * @param {Object} usuario          Objeto usuario completo: { rol, permisos, ... }
 * @param {string} modulo           ID del módulo según CATALOGO_MODULOS (ej: 'gastos')
 * @param {string} [accion='ver']   Acción a evaluar: 'ver' | 'crear' | 'editar' | 'eliminar'
 * @returns {boolean}
 */
function verificarPermiso(usuario, modulo, accion = 'ver') {
    const rol = usuario?.rol;

    // 1) Admin: acceso total garantizado por diseño.
    if (rol === ROL_ADMIN) return true;

    // 2) Regla estricta: módulos soloAdmin ('configuracion') son exclusivos de admin.
    if (MODULOS_MAP[modulo]?.soloAdmin) return false;

    // 3) Fail-safe: módulo inexistente en el catálogo o acción no admitida por el módulo.
    const defModulo = MODULOS_MAP[modulo];
    if (!defModulo) return false;
    if (!defModulo.funciones.includes(accion)) return false;

    // 4/5) Evaluación de flags. Fail-safe: falta usuario, permisos o módulo → false.
    const flags = usuario?.permisos?.[modulo];
    if (!flags || typeof flags !== 'object') return false;
    if (flags.ver !== true) return false; // interruptor maestro: sin 'ver' no hay nada

    return flags[accion] === true;
}

// ==================== EXPORTACIÓN / EXPOSICIÓN GLOBAL ====================
const PermisosUtil = Object.freeze({
    CATALOGO_MODULOS,
    MODULOS_MAP,
    ACCIONES_VALIDAS,
    ROL_ADMIN,
    DICCIONARIO_ROLES,
    normalizarPermisos,
    verificarPermiso
});

// Entorno: se usa `globalThis` (funciona en browser y Node).
// - Browser: queda disponible como window.PermisosUtil y como globals sueltos
//   para que app.js pueda llamar directamente normalizarPermisos()/verificarPermiso().
// - Node/CommonJS (tests): se exporta como módulo.
if (typeof globalThis !== 'undefined') {
    globalThis.PermisosUtil = PermisosUtil;
    // Alias globales (comodidad para el uso sin namespace en app.js).
    globalThis.normalizarPermisos = normalizarPermisos;
    globalThis.verificarPermiso = verificarPermiso;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PermisosUtil;
}
