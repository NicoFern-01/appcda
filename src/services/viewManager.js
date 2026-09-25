// src/services/viewManager.js
// ============================================================
// DOMINIO: Gestión de Vistas, Menú y Enrutamiento Moderno (FASE 7).
// ============================================================

import { navigate as routerNavigate } from '../core/router.js';
import store from '../core/store.js';
import { CATALOGO_MODULOS, MODULOS_MAP, verificarPermiso as verificarPermisoES } from '../utils/permisosUtil.js';

export const GRUPOS_MENU = [
    { padreId: 'menu-gastos',     submenuId: 'submenu-gastos',     padre: 'gastos',     hijos: ['carga-detallada', 'personal-competencia'] },
    { padreId: 'menu-inventario', submenuId: 'submenu-inventario', padre: 'inventario', hijos: ['articulos', 'movimientos-inventario', 'categorias-inventario', 'entregas-inventario'] }
];

export const VIEWS = [
    'dashboard', 'calendario', 'competencias', 'gastos', 'carga-detallada',
    'personal-competencia', 'inventario', 'articulos', 'movimientos-inventario',
    'categorias-inventario', 'entregas-inventario', 'staff', 'estadisticas-personal',
    'alojamiento', 'categorias-circuitos', 'configuracion'
];

function getCurrentUser() {
    if (typeof window !== 'undefined' && window.currentUser) {
        return window.currentUser;
    }
    return store?.currentUser || null;
}

function chequearPermiso(usuario, modulo, accion) {
    if (typeof window !== 'undefined' && typeof window.verificarPermiso === 'function') {
        return window.verificarPermiso(usuario, modulo, accion);
    }
    return verificarPermisoES(usuario, modulo, accion);
}

function invocarGlobal(fnName, ...args) {
    if (typeof window !== 'undefined' && typeof window[fnName] === 'function') {
        return window[fnName](...args);
    }
    return undefined;
}

export function renderizarMenuLateral(usuario) {
    if (typeof document === 'undefined') return;
    const menuList = document.getElementById('menu-list');
    if (!menuList || !usuario) return;

    menuList.innerHTML = '';

    const catalogo = (typeof window !== 'undefined' && window.CATALOGO_MODULOS) || CATALOGO_MODULOS;
    const grupos = (typeof window !== 'undefined' && window.GRUPOS_MENU) || GRUPOS_MENU;

    const modulosOrdenados = [...catalogo].sort((a, b) => a.orden - b.orden);
    const gruposPorPadre = Object.fromEntries(grupos.map(g => [g.padre, g]));
    const idsHijos = new Set(grupos.flatMap(g => g.hijos));

    for (const modulo of modulosOrdenados) {
        if (idsHijos.has(modulo.id)) continue;

        const grupo = gruposPorPadre[modulo.id];
        if (grupo) {
            const padreVisible = chequearPermiso(usuario, grupo.padre, 'ver');
            const hijosVisibles = grupo.hijos.filter(id => chequearPermiso(usuario, id, 'ver'));
            if (!padreVisible && hijosVisibles.length === 0) continue;
            menuList.appendChild(crearGrupoMenu(grupo, modulo, hijosVisibles, padreVisible));
            continue;
        }

        if (!chequearPermiso(usuario, modulo.id, 'ver')) continue;
        menuList.appendChild(crearMenuItemEl(modulo, false));
    }
}

export function crearMenuItemEl(modulo, esSubmenu) {
    const item = document.createElement('div');
    item.className = esSubmenu ? 'menu-item submenu-item' : 'menu-item';
    item.dataset.view = modulo.id;

    const icono = document.createElement('i');
    icono.className = `fa-solid ${modulo.icono}`;
    const texto = document.createElement('span');
    texto.textContent = modulo.nombre;

    item.append(icono, texto);
    item.addEventListener('click', () => switchView(modulo.id));
    return item;
}

export function crearGrupoMenu(grupo, moduloPadre, hijosVisibles, padreVisible) {
    const li = document.createElement('li');

    const padre = document.createElement('div');
    padre.id = grupo.padreId;
    padre.className = 'menu-item menu-parent';
    if (padreVisible) padre.dataset.view = moduloPadre.id;

    const icono = document.createElement('i');
    icono.className = `fa-solid ${moduloPadre.icono}`;
    const texto = document.createElement('span');
    texto.textContent = moduloPadre.nombre;
    const chevron = document.createElement('i');
    chevron.className = 'fa-solid fa-chevron-down submenu-chevron';
    padre.append(icono, texto, chevron);

    padre.addEventListener('click', () => {
        toggleSubmenu(grupo.submenuId);
        if (padreVisible) switchView(moduloPadre.id);
    });

    const submenu = document.createElement('div');
    submenu.id = grupo.submenuId;
    submenu.className = 'submenu collapsed';
    const modulosMap = (typeof window !== 'undefined' && window.MODULOS_MAP) || MODULOS_MAP;
    hijosVisibles.forEach(id => {
        const def = modulosMap[id];
        if (def) submenu.appendChild(crearMenuItemEl(def, true));
    });

    li.append(padre, submenu);
    return li;
}

export function aplicarControlDeAcceso(rol) {
    if (typeof document === 'undefined') return;
    const esViewer = rol === 'viewer';
    const esAdminRol = rol === 'admin';
    const esSupervisorRol = rol === 'supervisor';
    const user = getCurrentUser();

    document.querySelectorAll('.editor-only').forEach(el => {
        el.style.display = (esViewer || esSupervisorRol) ? 'none' : '';
    });

    document.querySelectorAll('.admin-only').forEach(el => {
        el.style.display = esAdminRol ? '' : 'none';
    });

    document.querySelectorAll('.menu-item[data-view]').forEach(item => {
        const permitido = chequearPermiso(user, item.dataset.view, 'ver');
        item.style.display = permitido ? '' : 'none';
    });

    document.body.classList.toggle('viewer-mode', esViewer);
    document.body.classList.toggle('admin-mode', esAdminRol);
    document.body.classList.toggle('supervisor-mode', esSupervisorRol);

    document.querySelectorAll('.dashboard-link-card').forEach(card => {
        card.classList.toggle('dashboard-link-disabled', esSupervisorRol);
        card.setAttribute('aria-disabled', String(esSupervisorRol));
        card.tabIndex = esSupervisorRol ? -1 : 0;
    });
}

export function puedeEditar() {
    const user = getCurrentUser();
    return user && (user.rol === 'admin' || user.rol === 'editor');
}

export function esAdmin() {
    const user = getCurrentUser();
    return user && user.rol === 'admin';
}

export function esSupervisor() {
    const user = getCurrentUser();
    return user && user.rol === 'supervisor';
}

export function navegarDesdeDashboard(viewId) {
    const user = getCurrentUser();
    if (!user || esSupervisor()) return;
    switchView(viewId);
}

export function toggleSubmenu(submenuId) {
    if (typeof document === 'undefined') return;
    const submenu = document.getElementById(submenuId);
    if (!submenu) return;
    submenu.classList.toggle('collapsed');

    const parent = submenu.previousElementSibling;
    if (parent) parent.classList.toggle('expanded', !submenu.classList.contains('collapsed'));
}

export function abrirSubmenuDeVista(viewId) {
    if (typeof document === 'undefined') return;
    const grupos = {
        'carga-detallada': ['submenu-gastos', 'menu-gastos'],
        'personal-competencia': ['submenu-gastos', 'menu-gastos'],
        'articulos': ['submenu-inventario', 'menu-inventario'],
        'movimientos-inventario': ['submenu-inventario', 'menu-inventario'],
        'categorias-inventario': ['submenu-inventario', 'menu-inventario'],
        'entregas-inventario': ['submenu-inventario', 'menu-inventario']
    };
    const grupo = grupos[viewId];
    if (!grupo) return;
    const submenu = document.getElementById(grupo[0]);
    const parent = document.getElementById(grupo[1]);
    if (submenu) submenu.classList.remove('collapsed');
    if (parent) parent.classList.add('expanded');
}
export function switchView(viewId) {
    const user = getCurrentUser();

    if (!chequearPermiso(user, viewId, 'ver')) {
        invocarGlobal('mostrarToast', 'Acceso denegado: no tenés permisos para acceder a este módulo.', 'error');
        if (viewId !== 'dashboard') {
            ejecutarSwitchView('dashboard');
        }
        return;
    }

    if (typeof document !== 'undefined') {
        const rendEditor = document.getElementById('rendicion-editor');
        const detallesModificados = (typeof window !== 'undefined' && window.detallesModificados);
        if (rendEditor && rendEditor.style.display === 'block' && detallesModificados) {
            let vistaActual = null;
            const listaVistas = (typeof window !== 'undefined' && window.views) || VIEWS;
            listaVistas.forEach(v => {
                const el = document.getElementById(`view-${v}`);
                if (el && el.classList.contains('active')) vistaActual = v;
            });
            if (vistaActual && vistaActual !== viewId) {
                if (typeof window !== 'undefined') window._vistaPendiente = viewId;
                const mostrarConfirmacion = window.mostrarConfirmacion;
                if (typeof mostrarConfirmacion === 'function') {
                    mostrarConfirmacion(
                        'Salir sin guardar',
                        'Hay cambios sin guardar en la rendición. ¿Deseas salir y perder los cambios?',
                        'warning'
                    ).then(ok => {
                        if (ok && window._vistaPendiente === viewId) {
                            window._vistaPendiente = null;
                            finalizarSalidaEditorRendicion();
                            ejecutarSwitchView(viewId);
                        } else {
                            if (typeof window !== 'undefined') window._vistaPendiente = null;
                        }
                    });
                    return;
                }
            }
        }
    }

    ejecutarSwitchView(viewId);
}

export function ejecutarSwitchView(viewId) {
    if (typeof document === 'undefined') return;

    document.querySelectorAll('.menu-item[data-view]').forEach(item => {
        item.classList.toggle('active', item.dataset.view === viewId);
    });

    const listaVistas = (typeof window !== 'undefined' && window.views) || VIEWS;
    listaVistas.forEach(v => {
        const viewEl = document.getElementById(`view-${v}`);
        if (!viewEl) return;
        viewEl.classList.toggle('active', v === viewId);
    });

    abrirSubmenuDeVista(viewId);

    try {
        routerNavigate(viewId);
    } catch (e) {
        // Enrutador tolerante: si la vista no tiene adapter, continúa sin error
    }

    cargarDatosVista(viewId);
}

export function finalizarSalidaEditorRendicion() {
    if (typeof window !== 'undefined') {
        window.detallesActuales = [];
        if (window.adjuntosTemporales) window.adjuntosTemporales['modal'] = [];
        window.detallesModificados = false;
        window.rendicionActual = null;
    }
    if (typeof document === 'undefined') return;
    const list = document.getElementById('rendiciones-list-container');
    const editor = document.getElementById('rendicion-editor');
    const aviso = document.getElementById('cambios-sin-guardar');
    if (list) list.style.display = 'block';
    if (editor) editor.style.display = 'none';
    if (aviso) aviso.style.display = 'none';
}

export async function cargarDatosVista(viewId) {
    switch (viewId) {
        case 'dashboard':
            if (typeof window !== 'undefined') window.dashboardDirty = true;
            await invocarGlobal('renderDashboard');
            break;
        case 'calendario':
            await invocarGlobal('cargarYParsearCalendario');
            break;
        case 'competencias':
            await invocarGlobal('listarCompetencias');
            break;
        case 'gastos':
            await invocarGlobal('listarGastos');
            break;
        case 'carga-detallada':
            await invocarGlobal('listarRendiciones');
            break;
        case 'personal-competencia':
            await invocarGlobal('cargarPersonalCompetencia');
            break;
        case 'inventario':
            await invocarGlobal('renderDashboardInventario');
            break;
        case 'articulos':
            await invocarGlobal('listarArticulos');
            break;
        case 'movimientos-inventario':
            await invocarGlobal('listarMovimientosInventario');
            break;
        case 'categorias-inventario':
            await invocarGlobal('listarCategoriasInventario');
            break;
        case 'entregas-inventario':
            await invocarGlobal('listarEntregas');
            break;
        case 'staff':
            await invocarGlobal('listarStaff');
            break;
        case 'estadisticas-personal':
            await invocarGlobal('listarEstadisticasPersonal');
            break;
        case 'alojamiento':
            await invocarGlobal('listarAlojamientos');
            break;
        case 'categorias-circuitos':
            await invocarGlobal('listarCategoriasCircuitos');
            break;
        case 'configuracion':
            await invocarGlobal('listarConfiguraciones');
            break;
        default:
            break;
    }
}

export const viewManager = {
    VIEWS,
    GRUPOS_MENU,
    renderizarMenuLateral,
    crearMenuItemEl,
    crearGrupoMenu,
    aplicarControlDeAcceso,
    puedeEditar,
    esAdmin,
    esSupervisor,
    navegarDesdeDashboard,
    toggleSubmenu,
    abrirSubmenuDeVista,
    switchView,
    ejecutarSwitchView,
    finalizarSalidaEditorRendicion,
    cargarDatosVista,
    routerNavigate
};

export default viewManager;

