// app.js - Lógica de Negocio e Interfaz de Usuario para Control de Automovilismo

// ==================== HELPER DE SEGURIDAD: ESCAPAR HTML ====================
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}

// ==================== COLORES DE VARIACIÓN DE LOS GRÁFICOS ====================
// Colores semánticos de la app: una BAJA se pinta de rojo y una SUBA de verde.
// Se usan en el gráfico de evolución (tramo a tramo) y en las variaciones de
// las tarjetas del dashboard, de modo que ambos se leen con la misma clave.
const COLOR_VARIACION_BAJA = '#ff4757';
const COLOR_VARIACION_SUBIDA = '#2ed573';

// ==================== PALETA CATEGÓRICA DE GRÁFICOS ====================
// Cada categoría o serie recibe un color de matiz DISTINTO: varios tonos del
// mismo azul (claro/medio/oscuro) son indistinguibles entre sí en una torta o
// en una barra. El orden arranca en azul -> verde -> ámbar -> violeta ->
// turquesa para que los sectores más grandes no queden en rojo o amarillo,
// que se asocian a alerta.
const PALETA_GRAFICOS = [
    '#1e90ff', '#2ed573', '#ff9f43', '#a55eea', '#00d2d3',
    '#ff4757', '#ff6b81', '#f368e0', '#01a3a4', '#54a0ff',
    '#5f27cd', '#ff9ff3'
];

/**
 * Devuelve n colores categóricos para un gráfico.
 * Si hay más elementos que colores, cicla la paleta: es preferible a inventar
 * tonos casi idénticos, que dejarían dos sectores indistinguibles.
 * @param {number} n cantidad de categorías o barras
 * @returns {string[]} n colores en notación hex
 */
/**
 * Lee el valor computado de una variable CSS del tema activo.
 * Chart.js NO resuelve var(--x): hay que pasarle el valor ya resuelto.
 * Se lee al crear el gráfico, por eso refrescamos los gráficos al cambiar
 * de tema para que tomen los colores nuevos.
 * @param {string} nombre nombre de la variable, p. ej. "--text-secondary"
 * @returns {string} valor computado (color) listo para Chart.js
 */
function cssVar(nombre) {
    return getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
}

/**
 * Refresca los gráficos visibles tras un cambio de tema.
 * Chart.js hornea los colores al crear la instancia: hay que volver a crearlas
 * para que ejes, grillas, leyendas y bordes tomen las variables del nuevo tema.
 * Solo se recrea lo que está en pantalla (dashboard o inventario).
 */
async function refrescarGraficosTema() {
    const dashboardActivo = document.getElementById('view-dashboard')?.classList.contains('active');
    const inventarioActivo = document.getElementById('view-inventario')?.classList.contains('active');
    try {
        if (dashboardActivo) {
            if (typeof window !== 'undefined') window.dashboardDirty = true;
            dashboardDirty = true;
            await renderDashboard();
        }
        if (inventarioActivo && typeof renderDashboardInventario === 'function') {
            await renderDashboardInventario();
        }
    } catch (err) {
        console.warn('No se pudieron refrescar los gráficos al cambiar de tema:', err);
    }
}

function paletaGraficos(n) {
    const cantidad = Math.max(0, Number(n) || 0);
    return Array.from({ length: cantidad }, (_, i) => PALETA_GRAFICOS[i % PALETA_GRAFICOS.length]);
}

// ==================== ESTADO DE SESIÓN ====================
var currentUser = null;

// ==================== INSTANCIAS DE GRÁFICOS ====================
let chartCategoriasInstance = null;
let chartMensualInstance = null;
let chartConceptoInstance = null;

// Contexto del ÚLTIMO render del dashboard. Lo usa el drill-down del gráfico
// de evolución: al hacer clic en un punto hacen falta los registros originales
// (gastos simples + detallados) que componen ese total, y el tipo de eje vigente
// (día o mes) para traducir el índice del punto a una fecha.
let dashboardContextoActual = null;

// Series mensuales del gasto acumulado, recalculadas en cada render del
// dashboard. Se guardan aparte (y no se recalculan al hacer clic) para que el
// detalle mes a mes sea un simple toggle: abrir/cerrar no vuelve a sumar nada.
let dashboardAcumuladoMensual = null;
let dashboardAcumuladoAnio = null;
// Flag para evitar re-renderizar el dashboard si no cambiaron los datos
let dashboardDirty = true;

const views = ['dashboard', 'calendario', 'competencias', 'gastos', 'carga-detallada', 'personal-competencia', 'inventario', 'articulos', 'movimientos-inventario', 'categorias-inventario', 'entregas-inventario', 'staff', 'estadisticas-personal', 'pilotos', 'listado-pilotos', 'penalidades', 'alojamiento', 'categorias-circuitos', 'configuracion'];

// ==================== RENDERIZADO ASÍNCRONO DE LA INTERFAZ ====================
// Escucha el evento disparado por db.js cuando la sincronización con Firestore
// finaliza (datos descargados o subidos) y refresca la vista activa de inmediato,
// sin necesidad de recargar la página manualmente.
window.addEventListener('firebase-sync-complete', () => {
    const activeViewEl = document.querySelector('.view.active');
    if (activeViewEl) {
        const viewId = activeViewEl.id.replace('view-', '');
        cargarDatosVista(viewId);
    }
});

// Calendario view mode: 'cards' | 'list' (compact)
let calendarioViewMode = localStorage.getItem('calendarioViewMode') || 'cards';

function toggleCalendarioView() {
    calendarioViewMode = calendarioViewMode === 'cards' ? 'list' : 'cards';
    localStorage.setItem('calendarioViewMode', calendarioViewMode);
    updateCalendarioToggleButton();
    listarCompetencias();
}

function updateCalendarioToggleButton() {
    const btn = document.getElementById('btn-toggle-calendario');
    if (!btn) return;
    if (calendarioViewMode === 'cards') {
        btn.innerHTML = '<i class="fa-solid fa-list"></i> Ver lista';
    } else {
        btn.innerHTML = '<i class="fa-solid fa-th-large"></i> Ver tarjetas';
    }
}

function toggleCalendarioFilters() {
    const container = document.getElementById('calendario-filters-container');
    if (!container) return;
    container.classList.toggle('collapsed');
    const btn = document.getElementById('btn-toggle-filtros');
    if (btn) btn.classList.toggle('active', !container.classList.contains('collapsed'));
}

// ==================== INICIALIZACIÓN ====================
document.addEventListener('DOMContentLoaded', async () => {
    try {

        // THEME SWITCH (pildora neumorfica en header) - oscuro por defecto.
        // El <html> SIN data-theme = oscuro (:root). Con data-theme=light = claro.
        const THEME_KEY = 'cda_theme';
        const themeChk = document.getElementById('theme-checkbox-toggle');
        const themeLbl = document.getElementById('theme-label');

        // Actualiza el texto del switch para que SIEMPRE refleje el modo activo.
        // Sin esto el label quedaba congelado en "Modo Oscuro" y no coincidía.
        function actualizarLabelTema(temaLight) {
            if (themeLbl) themeLbl.textContent = temaLight ? 'Modo Claro' : 'Modo Oscuro';
        }

        // Aplica el tema al <html> y sincroniza checkbox + label.
        // Si swap=true, anula transiciones durante un frame para evitar el
        // parpadeo de fondos/textos que produce --transition: all 0.3s.
        function aplicarTema(temaLight, swap) {
            const root = document.documentElement;
            if (swap) {
                // Anula transiciones, cambia el tema y las restaura al frame siguiente.
                root.classList.add('theme-swap');
                requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-swap')));
            }
            if (temaLight) { root.setAttribute('data-theme', 'light'); }
            else { root.removeAttribute('data-theme'); }
            if (themeChk) { themeChk.checked = !!temaLight; }
            actualizarLabelTema(temaLight);
        }

        // Estado inicial (sin swap: la primera carga no necesita animación).
        aplicarTema(localStorage.getItem(THEME_KEY) === 'light', false);

        if (themeChk) {
            themeChk.addEventListener('change', () => {
                const temaLight = themeChk.checked;
                localStorage.setItem(THEME_KEY, temaLight ? 'light' : 'dark');
                aplicarTema(temaLight, true);
                // Chart.js hornea los colores al crear cada instancia: hay que
                // volver a renderizar para que tomen las variables del tema nuevo.
                refrescarGraficosTema();
            });
        }
        await inicializarFirebase();
        await inicializarDatosPorDefecto();

        // FASE 1: migración del esquema de inventario a stock por ubicación (DB v9).
        // Idempotente: solo se ejecuta una vez (flag en localStorage).
        try {
            await migrarInventarioV9();
            await migrarTiposMovimientoV10();
            await migrarTiposSancionV14();
        } catch (err) {
            console.warn('La migración V9 no pudo completarse en este arranque:', err);
        }
        
        // Restaurar sesión desde localStorage si existe
        const sessionStr = localStorage.getItem('cda_session');
        if (sessionStr) {
            try {
                const sessionData = JSON.parse(sessionStr);
                if (sessionData && sessionData.username) {
                    const usuario = {
                        id: sessionData.id,
                        username: sessionData.username,
                        nombre: sessionData.nombre || 'Usuario',
                        rol: sessionData.rol || 'viewer',
                        permisos: sessionData.permisos || null, // BUGFIX: restaurar granulares
                        activo: true
                    };
                    currentUser = usuario;
                    iniciarSesion(usuario);
                    // El rol guardado puede estar desactualizado (p. ej. el admin
                    // fue degradado, o la sesion es de una epoca previa a la
                    // migracion). Se revalida contra Firebase Auth en segundo
                    // plano para que la UI no quede con permisos fantasma.
                    _revalidarSesionContraFirebase(usuario);
                }
            } catch (e) {
                console.warn('Error al restaurar sesión:', e);
                localStorage.removeItem('cda_session');
            }
        }
    } catch (error) {
        console.error('Error al inicializar la base de datos:', error);
        alert('Error al iniciar la base de datos local. Por favor, recarga la página.');
    }
});

// ==================== AUTENTICACIÓN ====================

/**
 * Revalida en segundo plano la sesión restaurada contra Firebase Auth.
 *
 * POR QUE: la sesión guardada en localStorage puede quedar desactualizada
 * (rol cambiado, usuario desactivado, o simplemente un token viejo). Sin esta
 * comprobación, la app arrancaba mostrando permisos que ya no correspondían
 * y ni siquiera exigía volver a iniciar sesión.
 *
 * Si Firebase dice que no hay sesión, se cierra la sesión local: la pantalla
 * de login vuelve a ser la única puerta de entrada.
 */
async function _revalidarSesionContraFirebase(usuarioRestaurado) {
    const auth = (typeof window !== 'undefined' && window.__CDA_MODULES__ &&
        window.__CDA_MODULES__.auth) || null;
    if (!auth || typeof auth.revalidarSesion !== 'function') return;

    try {
        const resultado = await auth.revalidarSesion();
        if (resultado && resultado.valido === false) {
            console.warn('[authService] La sesión local fue invalidada por Firebase:', resultado.motivo);
            if (typeof handleLogout === 'function') await handleLogout();
            return;
        }
        if (resultado && resultado.usuario) {
            // Se actualizó el rol/nombre: se refresca la UI con los datos reales.
            currentUser = resultado.usuario;
            iniciarSesion(resultado.usuario);
        }
    } catch (e) {
        // Fallo de red: se conserva la sesión local (no se cierra la app).
        console.warn('[authService] No se pudo revalidar la sesión (se mantiene la local):', e);
    }
}

function togglePasswordVisibility() {
    const input = document.getElementById('login-password');
    const icon = document.getElementById('toggle-pass-icon');
    if (input.type === 'password') {
        input.type = 'text';
        icon.classList.replace('fa-eye', 'fa-eye-slash');
    } else {
        input.type = 'password';
        icon.classList.replace('fa-eye-slash', 'fa-eye');
    }
}

// Mapea un email de Firebase Auth de vuelta al nombre de usuario
function mapearEmailAUsuario(email) {
    const emailLimpio = String(email || '').trim().toLowerCase();
    if (emailLimpio.endsWith('@controlcda.com')) {
        return emailLimpio.replace('@controlcda.com', '');
    }
    return emailLimpio;
}

// Verifica la contraseña contra un hash guardado, soportando ambos formatos
// Método A: sha256$salt$hash (nuevo)
// Método B: hash_xxxxx_yy (antiguo, corto)
async function verificarPasswordConCompatibilidad(passwordInput, passwordHashAlmacenado) {
    // Si no hay hash almacenado, no se puede validar
    if (!passwordHashAlmacenado) return false;

    // MÉTODO A: Formato SHA256 (nuevo) -> formato "sha256$salt$hash"
    if (String(passwordHashAlmacenado).startsWith('sha256$')) {
        try {
            const hashGenerado = await hashPassword(passwordInput);
            if (hashGenerado === passwordHashAlmacenado) {
                console.log("✅ Validado con formato SHA256 (nuevo).");
                return true;
            }
        } catch (e) {
            console.warn("Error al validar con SHA256:", e);
        }
    }

    // MÉTODO B: Formato corto antiguo -> formato "hash_xxxxx_yy"
    if (String(passwordHashAlmacenado).startsWith('hash_')) {
        const hashLegacy = hashPasswordLegacy(passwordInput);
        if (hashLegacy === passwordHashAlmacenado) {
            console.log("✅ Validado con formato hash_ (antiguo).");
            return true;
        }
    }

    // También intentar verificarPassword (la función original que soporta migración de hashes antiguos)
    try {
        const resultado = await verificarPassword(passwordInput, passwordHashAlmacenado);
        if (resultado) {
            console.log("✅ Validado con verificarPassword().");
            return true;
        }
    } catch (e) {
        console.warn("Error al validar con verificarPassword():", e);
    }

    return false;
}

// FALLBACK local del login: la lógica real vive en src/services/authService.js.
async function intentarLoginLocal(usernameInput, passwordInput) {
    // FASE 5: pasamano hacia el dominio de autenticación.
    const auth = typeof window !== 'undefined' ? window.__CDA_MODULES__?.auth : null;
    if (auth && typeof auth.intentarLoginLocal === 'function') {
        return auth.intentarLoginLocal(usernameInput, passwordInput);
    }
    return false;
}

async function handleLogin(event) {
    // FASE 5: pasamano hacia el dominio de autenticación (src/services/authService.js).
    const auth = typeof window !== 'undefined' ? window.__CDA_MODULES__?.auth : null;
    if (auth && typeof auth.handleLogin === 'function') {
        return auth.handleLogin(event);
    }
    // Red de seguridad: si el módulo no cargara, al menos no romper el submit.
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
}

        // ------------------------------------------------------------------
// El dominio de Autenticación fue extraído a src/services/authService.js
// (handleLogin, intentarLoginLocal, iniciarSesion, handleLogout, cda_session).

// ==================== PERMISOS: RESOLUCIÓN DE PERMISOS EFECTIVOS ====================
// El catálogo de roles vive en permisosUtil.js (DICCIONARIO_ROLES): agregar un rol
// nuevo allí es suficiente para que aparezca en el combo del modal y tenga su preset.

/**
 * Devuelve el objeto de permisos SANEADO y listo para usar en la sesión:
 *   1. rol con accesoTotal (admin) → todos los módulos (incluye 'configuracion').
 *   2. permisos granulares persistidos → se respetan (pasando por Capa 2).
 *   3. fallback → preset del rol según DICCIONARIO_ROLES (migración legacy).
 */
function obtenerPermisosEfectivos(usuario) {
    if (!usuario) return {};
    const defRol = (typeof DICCIONARIO_ROLES !== 'undefined') ? DICCIONARIO_ROLES[usuario.rol] : null;

    // Admin (o rol con accesoTotal): acceso total garantizado por diseño.
    if (defRol?.accesoTotal) return normalizarPermisos(usuario.rol);

    const tieneGranulares = usuario.permisos && typeof usuario.permisos === 'object'
        && Object.keys(usuario.permisos).length > 0;

    // BUGFIX: los permisos guardados a mano mandan SIEMPRE sobre el preset, incluso
    // si dejan módulos completos en false (ej: gastos/inventario desmarcados para
    // Chris). NO se aplica el fallback del preset solo porque el rol sea 'editor'.
    // Se clona en profundidad para nunca mutar/aliar el objeto venido de la BD.
    if (tieneGranulares) {
        const granularesLimpios = JSON.parse(JSON.stringify(usuario.permisos));
        return normalizarPermisos(usuario.rol, granularesLimpios);
    }
    return normalizarPermisos(usuario.rol, defRol?.preset || {});
}

/**
 * true si los permisos persistidos del usuario difieren del preset de su rol
 * (=> es un usuario con permisos "Personalizado" y el combo debe reflejarlo).
 */
function usuarioTienePermisosPersonalizados(usuario) {
    if (!usuario || typeof DICCIONARIO_ROLES === 'undefined') return false;
    const defRol = DICCIONARIO_ROLES[usuario.rol];
    if (!defRol || !usuario.permisos) return false;
    return JSON.stringify(normalizarPermisos(usuario.rol, usuario.permisos))
        !== JSON.stringify(normalizarPermisos(usuario.rol, defRol.preset || {}));
}

// ==================== RENDERIZADO DINÁMICO DEL MENÚ LATERAL ====================
// La lógica completa vive en src/services/viewManager.js
function renderizarMenuLateral(usuario) {
    const v = typeof window !== 'undefined' ? window.__CDA_MODULES__?.vistas : null;
    if (v && typeof v.renderizarMenuLateral === 'function') {
        return v.renderizarMenuLateral(usuario);
    }
}

function iniciarSesion(usuario) {
    // FASE 5: pasamano hacia el dominio de autenticación.
    const auth = typeof window !== 'undefined' ? window.__CDA_MODULES__?.auth : null;
    if (auth && typeof auth.iniciarSesion === 'function') {
        return auth.iniciarSesion(usuario);
    }
}

async function handleLogout() {
    // FASE 5: pasamano hacia el dominio de autenticación.
    const auth = typeof window !== 'undefined' ? window.__CDA_MODULES__?.auth : null;
    if (auth && typeof auth.handleLogout === 'function') {
        return auth.handleLogout();
    }
}

function aplicarControlDeAcceso(rol) {
    const v = typeof window !== 'undefined' ? window.__CDA_MODULES__?.vistas : null;
    if (v && typeof v.aplicarControlDeAcceso === 'function') {
        return v.aplicarControlDeAcceso(rol);
    }
}

function puedeEditar() {
    const v = typeof window !== 'undefined' ? window.__CDA_MODULES__?.vistas : null;
    if (v && typeof v.puedeEditar === 'function') return v.puedeEditar();
    return currentUser && (currentUser.rol === 'admin' || currentUser.rol === 'editor');
}

function esAdmin() {
    const v = typeof window !== 'undefined' ? window.__CDA_MODULES__?.vistas : null;
    if (v && typeof v.esAdmin === 'function') return v.esAdmin();
    return currentUser && currentUser.rol === 'admin';
}

function esSupervisor() {
    const v = typeof window !== 'undefined' ? window.__CDA_MODULES__?.vistas : null;
    if (v && typeof v.esSupervisor === 'function') return v.esSupervisor();
    return currentUser && currentUser.rol === 'supervisor';
}

function navegarDesdeDashboard(viewId) {
    const v = typeof window !== 'undefined' ? window.__CDA_MODULES__?.vistas : null;
    if (v && typeof v.navegarDesdeDashboard === 'function') return v.navegarDesdeDashboard(viewId);
    if (!currentUser || esSupervisor()) return;
    switchView(viewId);
}

// ==================== NAVEGACIÓN SPA ====================
// La lógica completa de navegación vive en src/services/viewManager.js

function toggleSubmenu(submenuId) {
    const v = typeof window !== 'undefined' ? window.__CDA_MODULES__?.vistas : null;
    if (v && typeof v.toggleSubmenu === 'function') return v.toggleSubmenu(submenuId);
}

function abrirSubmenuDeVista(viewId) {
    const v = typeof window !== 'undefined' ? window.__CDA_MODULES__?.vistas : null;
    if (v && typeof v.abrirSubmenuDeVista === 'function') return v.abrirSubmenuDeVista(viewId);
}

function switchView(viewId) {
    const v = typeof window !== 'undefined' ? window.__CDA_MODULES__?.vistas : null;
    if (v && typeof v.switchView === 'function') return v.switchView(viewId);
}

function _finalizarSalidaEditorRendicion() {
    const v = typeof window !== 'undefined' ? window.__CDA_MODULES__?.vistas : null;
    if (v && typeof v.finalizarSalidaEditorRendicion === 'function') return v.finalizarSalidaEditorRendicion();
}

// ==================== DASHBOARD & GRÁFICOS ====================

async function renderDashboard() {
    if (!dashboardDirty) return;
    dashboardDirty = false;

    const [gastos, competencias, staff, categorias, conceptos, rendiciones, detalleGastos] = await Promise.all([
        getTodos('gastos'),
        getTodos('competencias'),
        getTodos('staff'),
        getTodos('categorias'),
        getTodos('conceptos'),
        getTodos('rendiciones'),
        getTodos('detalleGastos')
    ]);

    // ============ FILTRO GLOBAL DE PERÍODO (AÑO / MES) ============
    // Todo lo que viene a continuación (categorías, evolución, conceptos y el
    // total) se calcula sobre los datos YA filtrados, de modo que los tres
    // gráficos son siempre coherentes entre sí y con el período elegido.
    const MESES_DASHBOARD = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

    // Fecha efectiva de un gasto DETALLADO: la del detalle o, si no tiene, la de
    // su rendición (misma regla que usa el gráfico de evolución).
    const fechaDeDetalle = (d) => {
        if (d && d.fecha) return d.fecha;
        const rend = rendiciones.find(r => Number(r.id) === Number(d && d.rendicionId));
        return rend ? rend.fecha : null;
    };

    // Años presentes en los datos (gastos simples + detallados).
    const aniosSet = new Set();
    const registrarAnio = (fecha) => { if (fecha) aniosSet.add(new Date(fecha).getFullYear()); };
    gastos.forEach(g => registrarAnio(g.fecha));
    detalleGastos.forEach(d => registrarAnio(fechaDeDetalle(d)));
    const anios = Array.from(aniosSet).sort((a, b) => b - a);
    if (anios.length === 0) anios.push(new Date().getFullYear());

    const anioEl = document.getElementById('dashboard-anio');
    if (anioEl) {
        const previo = anioEl.value;
        anioEl.innerHTML = '';
        anios.forEach(a => {
            const opt = document.createElement('option');
            opt.value = String(a);
            opt.textContent = String(a);
            anioEl.appendChild(opt);
        });
        anioEl.value = anios.includes(Number(previo)) ? previo : String(anios[0]);
    }
    const anioSel = anioEl && anioEl.value ? Number(anioEl.value) : null;

    const mesEl = document.getElementById('dashboard-mes');
    const mesSel = mesEl && mesEl.value !== 'all' ? Number(mesEl.value) : null;

    const enPeriodo = (fecha) => {
        if (!fecha) return false;
        const f = new Date(fecha);
        if (isNaN(f.getTime())) return false;
        if (anioSel !== null && f.getFullYear() !== anioSel) return false;
        if (mesSel !== null && (f.getMonth() + 1) !== mesSel) return false;
        return true;
    };

    // Datos ya filtrados por período: son la única fuente de los gráficos.
    const gastosPeriodo = gastos.filter(g => enPeriodo(g.fecha));
    const detallePeriodo = detalleGastos.filter(d => enPeriodo(fechaDeDetalle(d)));

    const tituloPeriodo = (mesSel !== null)
        ? `${MESES_DASHBOARD[mesSel - 1]} ${anioSel ?? ''}`.trim()
        : `Año ${anioSel ?? ''}`.trim();
    const etiquetaTotal = document.getElementById('stat-gasto-total-label');
    if (etiquetaTotal) etiquetaTotal.textContent = `Gasto Total — ${tituloPeriodo}`;
    ['dash-cat-periodo', 'dash-conc-periodo'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = `· ${tituloPeriodo}`;
    });

    // ============ GASTO ACUMULADO ANUAL (hasta el mes en curso) ============
    // "Mes en curso" = el mes seleccionado en el filtro; si el filtro está en
    // "Todo el año", se acumula el año completo. Los gastos DETALLADOS se
    // imputan por la fecha de su detalle o, si no tiene, por la de la rendición.
    const anioAcum = anioSel ?? new Date().getFullYear();
    const mesCorte = mesSel ?? 12;
    const totalDeMesDelAnio = (mes) => {
        const dentro = (fecha) => {
            if (!fecha) return false;
            const f = new Date(fecha);
            if (isNaN(f.getTime())) return false;
            return f.getFullYear() === anioAcum && (f.getMonth() + 1) === mes;
        };
        return gastos.filter(g => dentro(g.fecha)).reduce((s, g) => s + Number(g.monto || 0), 0)
             + detalleGastos.filter(d => dentro(fechaDeDetalle(d))).reduce((s, d) => s + Number(d.total || 0), 0);
    };
    const sumaHastaMes = (mesLimite) => {
        let s = 0;
        for (let m = 1; m <= mesLimite; m++) s += totalDeMesDelAnio(m);
        return s;
    };

    // Serie mes a mes (1..mesCorte) con acumulado y variación: es la fuente del
    // detalle que se despliega al hacer clic en la tarjeta.
    let corridaAcum = 0;
    dashboardAcumuladoMensual = [];
    dashboardAcumuladoAnio = anioAcum;
    for (let m = 1; m <= mesCorte; m++) {
        const gastoMes = totalDeMesDelAnio(m);
        corridaAcum += gastoMes;
        const gastoPrevio = m > 1 ? totalDeMesDelAnio(m - 1) : null;
        dashboardAcumuladoMensual.push({ mes: m, gastoMes, acumulado: corridaAcum, gastoPrevio });
    }
    const acumulado = corridaAcum;
    const elAcumulado = document.getElementById('stat-gasto-acumulado');
    if (elAcumulado) elAcumulado.innerText = formatearMoneda(acumulado);
    const elAcumLabel = document.getElementById('stat-gasto-acumulado-label');
    if (elAcumLabel) {
        elAcumLabel.textContent = mesSel !== null
            ? `Gasto Acumulado — ${MESES_DASHBOARD[mesCorte - 1]} ${anioAcum}`
            : `Gasto Acumulado Anual ${anioAcum}`;
    }
    const elAcumNota = document.getElementById('stat-gasto-acumulado-nota');
    if (elAcumNota) {
        const prevAcum = mesCorte > 1 ? sumaHastaMes(mesCorte - 1) : 0;
        elAcumNota.textContent = mesCorte > 1
            ? `Acumulado Ene–${MESES_DASHBOARD[mesCorte - 1].slice(0, 3)} · ${formatearMoneda(prevAcum)} en Ene–${MESES_DASHBOARD[mesCorte - 2].slice(0, 3)}`
            : 'Acumulado del mes en curso';
    }

    // ============ VARIACIÓN % VS MES ANTERIOR (en la tarjeta de Gasto Total) ============
    // Solo tiene sentido cuando hay un mes aislado seleccionado: compara ese
    // mes contra el mes inmediato anterior del mismo año.
    const elVariacion = document.getElementById('stat-gasto-variacion');
    if (elVariacion) {
        elVariacion.classList.remove('is-up', 'is-down');
        if (mesSel === null) {
            elVariacion.textContent = 'Elegí un mes para ver la variación';
        } else {
            const anioRef = anioSel ?? new Date().getFullYear();
            const mesActual = totalDeMesDelAnio(mesSel);
            const mesPrevio = mesSel > 1 ? totalDeMesDelAnio(mesSel - 1) : null;
            if (mesPrevio === null) {
                elVariacion.textContent = 'Sin mes previo para comparar';
            } else if (mesPrevio === 0) {
                elVariacion.textContent = mesActual > 0 ? 'Sin base de comparación' : '—';
            } else {
                const variacion = ((mesActual - mesPrevio) / mesPrevio) * 100;
                const signo = variacion > 0 ? '+' : (variacion < 0 ? '' : '');
                const signoGlifo = variacion > 0 ? '▲' : (variacion < 0 ? '▼' : '=');
                elVariacion.textContent = `${signoGlifo} ${signo}${variacion.toFixed(1)}% vs ${MESES_DASHBOARD[mesSel - 2]}`;
                if (variacion > 0) elVariacion.classList.add('is-up');
                else if (variacion < 0) elVariacion.classList.add('is-down');
            }
        }
    }

    // ============ TOTAL GENERAL: Sumar gastos simples + detallados ============
    const totalGastoSimple = gastosPeriodo.reduce((sum, g) => sum + Number(g.monto), 0);
    const totalGastoDetallado = detallePeriodo.reduce((sum, d) => sum + Number(d.total || 0), 0);
    const totalGasto = totalGastoSimple + totalGastoDetallado;
    document.getElementById('stat-gasto-total').innerText = formatearMoneda(totalGasto);
    document.getElementById('stat-competencias-count').innerText = competencias.length;
    document.getElementById('stat-staff-count').innerText = staff.length;

    // ============ GASTOS POR CATEGORÍA (deportiva) ============
    // Para gastos simples: usamos g.categoriaId → nombre de categoría
    // Para gastos detallados: rendicion → competencia → categoriasIds
    const gastosPorCat = {};
    categorias.forEach(c => { gastosPorCat[c.nombre] = 0; });
    gastosPorCat['General / Compartido'] = 0;

    // Gastos SIMPLES
    gastosPeriodo.forEach(g => {
        // PRIORIDAD 1: El gasto tiene una categoría deportiva específica asignada → usar directamente (por ID o nombre si es string)
        let catDirecta;
        if (typeof g.categoriaId === 'number' || (typeof g.categoriaId === 'string' && g.categoriaId !== 'general' && !isNaN(Number(g.categoriaId)))) {
            catDirecta = categorias.find(c => c.id === Number(g.categoriaId));
        } else if (typeof g.categoriaId === 'string' && g.categoriaId !== 'general') {
            // Si es un string y no es 'general', intentar buscar por nombre (posible dato inconsistente o manual)
            catDirecta = categorias.find(c => c.nombre === g.categoriaId);
        }

        if (catDirecta) {
            gastosPorCat[catDirecta.nombre] = (gastosPorCat[catDirecta.nombre] || 0) + Number(g.monto || 0);
            return;
        }

        if (g.categoriaId === 'general') {
            gastosPorCat['General / Compartido'] += Number(g.monto || 0);
            return;
        }
        // PRIORIDAD 2: Sin categoría específica ('general' o vacío) → distribuir entre las categorías de la competencia
        const comp = competencias.find(c => Number(c.id) === Number(g.competenciaId));
        if (comp && comp.categoriasIds && comp.categoriasIds.length > 0) {
            const monto = Number(g.monto || 0) / comp.categoriasIds.length;
            comp.categoriasIds.forEach(catId => {
                const cat = categorias.find(c => c.id === Number(catId));
                if (cat) {
                    gastosPorCat[cat.nombre] = (gastosPorCat[cat.nombre] || 0) + monto;
                } else {
                    gastosPorCat['General / Compartido'] += monto;
                }
            });
            return;
        }
        // PRIORIDAD 3: Sin competencia ni categoría → todo a General / Compartido
        gastosPorCat['General / Compartido'] += Number(g.monto || 0);
    });

    // Gastos DETALLADOS: rendicion → competenciaId → categoriasIds
    detallePeriodo.forEach(d => {
        const rendicion = rendiciones.find(r => Number(r.id) === Number(d.rendicionId));
        if (!rendicion) {
            gastosPorCat['General / Compartido'] += Number(d.total || 0);
            return;
        }
        const comp = competencias.find(c => Number(c.id) === Number(rendicion.competenciaId));
        if (!comp || !comp.categoriasIds || comp.categoriasIds.length === 0) {
            gastosPorCat['General / Compartido'] += Number(d.total || 0);
            return;
        }
        // Distribuir el gasto entre todas las categorías de la competencia
        const monto = Number(d.total || 0) / comp.categoriasIds.length;
        comp.categoriasIds.forEach(catId => {
            const cat = categorias.find(c => c.id === Number(catId));
            if (cat) {
                gastosPorCat[cat.nombre] = (gastosPorCat[cat.nombre] || 0) + monto;
            } else {
                gastosPorCat['General / Compartido'] += monto; // Fallback si el ID de categoría en competencia.categoriasIds no existe
            }
        });
    });

    if (chartCategoriasInstance) chartCategoriasInstance.destroy();
    const catKeys = Object.keys(gastosPorCat).filter(k => gastosPorCat[k] > 0);
    const catVals = catKeys.map(k => gastosPorCat[k]);
    chartCategoriasInstance = new Chart(document.getElementById('chart-categorias').getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: catKeys.length > 0 ? catKeys : ['Sin Gastos'],
            datasets: [{
                data: catKeys.length > 0 ? catVals : [0],
                // Un color por categoría (matiz distinto, no variaciones de un azul).
                backgroundColor: paletaGraficos(catKeys.length || 1),
                borderWidth: 2,
                // Borde de cada sector = color de la tarjeta del tema activo:
                // en oscuro separa sobre fondo oscuro, en claro sobre fondo claro.
                borderColor: cssVar('--bg-card'),
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '62%',
            plugins: {
                // Punto circular en la leyenda: el color del punto es el mismo
                // que el del sector, así se cruzan sin leer dos veces.
                legend: { position: 'right', labels: { color: cssVar('--text-secondary'), usePointStyle: true, pointStyle: 'circle', boxWidth: 8, padding: 14, font: { family: 'Outfit' } } },
                tooltip: { callbacks: { label: (ctx) => ` $${ctx.raw.toLocaleString()}` } }
            }
        }
    });

    // ============ EVOLUCIÓN MENSUAL / ANUAL ============
    const intervalEl = document.getElementById('dashboard-gastos-interval');
    // Cuando hay un mes elegido, la evolución pasa a ser DIARIA dentro de ese
    // mes (el detalle que pide el filtro). El select refleja ese estado.
    if (mesSel !== null && intervalEl && !intervalEl.querySelector('option[value="daily"]')) {
        const opt = document.createElement('option');
        opt.value = 'daily';
        opt.textContent = 'Diario';
        intervalEl.insertBefore(opt, intervalEl.firstChild);
    }
    if (mesSel !== null && intervalEl) intervalEl.value = 'daily';
    const interval = intervalEl ? intervalEl.value : 'monthly';

    let labels = [];
    let dataPoints = [];
    let etiquetaSerie = 'Gastos Mensuales';

    if (interval === 'daily') {
        // Evolución día a día SOLO del mes seleccionado.
        const anioRef = anioSel ?? new Date().getFullYear();
        const diasDelMes = new Date(anioRef, mesSel, 0).getDate();
        const porDia = Array(diasDelMes).fill(0);
        const sumarDia = (fecha, monto) => {
            if (!fecha) return;
            const f = new Date(fecha);
            if (isNaN(f.getTime())) return;
            if (f.getFullYear() !== anioRef || (f.getMonth() + 1) !== mesSel) return;
            porDia[f.getDate() - 1] += Number(monto || 0);
        };
        gastosPeriodo.forEach(g => sumarDia(g.fecha, g.monto));
        detallePeriodo.forEach(d => sumarDia(fechaDeDetalle(d), d.total || 0));
        labels = porDia.map((_, i) => String(i + 1));
        dataPoints = porDia;
        etiquetaSerie = `Gastos Diarios — ${MESES_DASHBOARD[mesSel - 1]} ${anioRef}`;
    } else if (interval === 'monthly') {
        const mesesNombres = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
        const gastosMensuales = Array(12).fill(0);
        // Gastos simples
        gastosPeriodo.forEach(g => {
            if (g.fecha) gastosMensuales[new Date(g.fecha).getMonth()] += Number(g.monto);
        });
        // Gastos detallados: usar fecha del detalle o fecha de la rendición
        detallePeriodo.forEach(d => {
            const fecha = fechaDeDetalle(d);
            if (fecha) gastosMensuales[new Date(fecha).getMonth()] += Number(d.total || 0);
        });
        labels = mesesNombres;
        dataPoints = gastosMensuales;
        etiquetaSerie = 'Gastos Mensuales';
    } else {
        const mapaAnios = {};
        const sumarAlAnio = (fecha, monto) => {
            if (!fecha) return;
            const y = new Date(fecha).getFullYear();
            mapaAnios[y] = (mapaAnios[y] || 0) + Number(monto || 0);
        };
        gastosPeriodo.forEach(g => sumarAlAnio(g.fecha, g.monto));
        detallePeriodo.forEach(d => sumarAlAnio(fechaDeDetalle(d), d.total || 0));
        const sortedAnios = Object.keys(mapaAnios).map(Number).sort((a,b)=>a-b);
        labels = sortedAnios.map(String);
        dataPoints = sortedAnios.map(y => mapaAnios[y] || 0);
        etiquetaSerie = 'Gastos Anuales';
    }

    // El drill-down necesita los registros originales y el tipo de eje vigente.
    dashboardContextoActual = {
        interval,
        anio: anioSel ?? new Date().getFullYear(),
        mes: mesSel,
        gastos,
        detalleGastos,
        conceptos,
        rendiciones,
        fechaDeDetalle
    };

    if (chartMensualInstance) chartMensualInstance.destroy();
    chartMensualInstance = new Chart(document.getElementById('chart-mensual').getContext('2d'), {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: etiquetaSerie,
                data: dataPoints,
                borderColor: cssVar('--accent-blue'),
                backgroundColor: cssVar('--chart-fill'),
                fill: true,
                tension: 0.3,
                borderWidth: 3,
                pointRadius: 4,
                pointBackgroundColor: cssVar('--accent-blue'),
                pointBorderColor: cssVar('--bg-card'),
                pointBorderWidth: 2,
                // Cada tramo se tiñe comparando el período actual con el anterior:
                // si el valor BAJA, tramo rojo; si SUBE, tramo verde. Permite leer
                // la tendencia del gasto de un vistazo, sin consultar los ejes.
                segment: {
                    borderColor: (ctx) => {
                        const previo = Number(ctx.p0.parsed.y);
                        const actual = Number(ctx.p1.parsed.y);
                        if (previo === actual) return cssVar('--accent-blue');
                        return actual < previo ? COLOR_VARIACION_BAJA : COLOR_VARIACION_SUBIDA;
                    }
                }
            }]
        },
        options: chartLineOptions(),
        // DRILL-DOWN: clic sobre un punto → detalle de los registros de ese día/mes.
        onClick: (_evt, elements) => {
            if (!elements || elements.length === 0) return;
            const idx = elements[0].index;
            _renderDrillDownDashboard(idx);
        }
    });

    // ============ GASTOS POR CONCEPTO ============
    // Gastos simples: usan g.concepto (texto)
    // Gastos detallados: usan d.conceptoId → conceptos.nombre
    const gastosPorConcepto = {};
    gastosPeriodo.forEach(g => {
        const k = g.concepto.trim();
        gastosPorConcepto[k] = (gastosPorConcepto[k] || 0) + Number(g.monto);
    });
    detallePeriodo.forEach(d => {
        const conc = conceptos.find(c => c.id === Number(d.conceptoId));
        const k = conc ? conc.nombre.trim() : 'Sin concepto';
        gastosPorConcepto[k] = (gastosPorConcepto[k] || 0) + Number(d.total || 0);
    });
    // Top 5 estricto, ordenado de mayor a menor (de ahí que se ordene en sentido
    // descendente y se corte en 5: el objetivo es leer rápido qué conceptos
    // dominan el costo del período).
    const top = Object.entries(gastosPorConcepto)
        .filter(([, v]) => Number(v) > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    if (chartConceptoInstance) chartConceptoInstance.destroy();
    chartConceptoInstance = new Chart(document.getElementById('chart-concepto').getContext('2d'), {
        type: 'bar',
        data: {
            // Chart.js dibuja el 1º índice abajo: se invierte el orden para que
            // el mayor gasto quede arriba.
            labels: top.length > 0 ? top.map(c => c[0]).reverse() : ['Sin Gastos'],
            datasets: [{
                label: 'Gasto',
                data: top.length > 0 ? top.map(c => c[1]).reverse() : [0],
                // Cada concepto con su propio color: el degradado monocromo
                // anterior volvía indistinguibles las barras contiguas.
                backgroundColor: paletaGraficos(top.length || 1),
                hoverBackgroundColor: cssVar('--text-primary'),
                borderRadius: 6,
                borderSkipped: false,
                barThickness: 22
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: (ctx) => ` ${formatearMoneda(Number(ctx.raw))}` } }
            },
            scales: {
                x: {
                    grid: { color: cssVar('--chart-grid') },
                    ticks: { color: cssVar('--text-secondary'), callback: (v) => `$${Number(v).toLocaleString('es-AR')}` }
                },
                y: {
                    grid: { display: false },
                    ticks: { color: cssVar('--text-secondary'), font: { family: 'Outfit' } }
                }
            }
        }
    });

    // Cada vez que se re-renderiza el dashboard, el desglose anterior deja de
    // corresponder al período mostrado: se oculta para no mostrar datos rancios.
    _ocultarDrillDownDashboard();

    // El detalle mes a mes del acumulado es FIJO: se repinta en cada render
    // para que siempre coincida con el año/mes seleccionado.
    _pintarDetalleAcumuladoDashboard();
}

const MESES_DRILLDOWN = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

/**
 * DRILL-DOWN del gráfico de evolución.
 *
 * Traduce el índice del punto clickeado a una fecha concreta según el eje
 * vigente ('daily' → día del mes seleccionado; 'monthly' → mes del año) y lista
 * los registros individuales que componen ese total, de mayor a menor.
 * Todos los textos se escapan: concepto y descripción son entrada de usuario.
 */
function _renderDrillDownDashboard(indice) {
    const ctx = dashboardContextoActual;
    if (!ctx) return;

    const card = document.getElementById('dash-drilldown-card');
    const body = document.getElementById('dash-drilldown-body');
    const elFecha = document.getElementById('dash-drilldown-fecha');
    const elTotal = document.getElementById('dash-drilldown-total');
    if (!card || !body || !elFecha || !elTotal) return;

    let titulo;
    let coincide;
    if (ctx.interval === 'daily') {
        const dia = indice + 1;
        titulo = `${dia} de ${MESES_DRILLDOWN[(ctx.mes || 1) - 1]} de ${ctx.anio}`;
        coincide = (f) => {
            if (!f) return false;
            const d = new Date(f);
            if (isNaN(d.getTime())) return false;
            return d.getFullYear() === ctx.anio && (d.getMonth() + 1) === ctx.mes && d.getDate() === dia;
        };
    } else if (ctx.interval === 'monthly') {
        const mes = indice + 1;
        titulo = `${MESES_DRILLDOWN[mes - 1]} ${ctx.anio}`;
        coincide = (f) => {
            if (!f) return false;
            const d = new Date(f);
            if (isNaN(d.getTime())) return false;
            return d.getFullYear() === ctx.anio && (d.getMonth() + 1) === mes;
        };
    } else {
        // Eje anual: no hay un período mensual clickeable con sentido.
        return;
    }

    const filas = [];

    // Gastos simples: el concepto viene como texto libre en el registro.
    ctx.gastos.forEach(g => {
        if (!coincide(g.fecha)) return;
        filas.push({
            tipo: 'Gasto',
            fecha: g.fecha,
            concepto: (g.concepto || '').trim() || 'Sin concepto',
            descripcion: (g.descripcion || '').trim() || '—',
            monto: Number(g.monto || 0)
        });
    });

    // Gastos detallados: concepto por ID → nombre; descripción del ítem.
    ctx.detalleGastos.forEach(d => {
        if (!coincide(ctx.fechaDeDetalle(d))) return;
        const conc = ctx.conceptos.find(c => c.id === Number(d.conceptoId));
        filas.push({
            tipo: 'Detalle',
            fecha: ctx.fechaDeDetalle(d),
            concepto: conc ? conc.nombre : 'Sin concepto',
            descripcion: (d.descripcion || '').trim() || '—',
            monto: Number(d.total || 0)
        });
    });

    filas.sort((a, b) => b.monto - a.monto);

    elFecha.textContent = titulo;
    elTotal.textContent = formatearMoneda(filas.reduce((s, f) => s + f.monto, 0));

    if (filas.length === 0) {
        body.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-secondary);">Sin gastos registrados en este período.</td></tr>';
    } else {
        body.innerHTML = filas.map(f => `
            <tr>
                <td><span style="color:var(--accent-blue);font-size:0.75rem;font-weight:600;">${escapeHtml(f.tipo)}</span></td>
                <td>${escapeHtml(formatearFechaVisual(f.fecha) || '—')}</td>
                <td style="font-weight:600;">${escapeHtml(f.concepto)}</td>
                <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(f.descripcion)}">${escapeHtml(f.descripcion)}</td>
                <td style="text-align:right;font-weight:700;">${escapeHtml(formatearMoneda(f.monto))}</td>
            </tr>
        `).join('');
    }

    card.style.display = 'block';
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function _ocultarDrillDownDashboard() {
    const card = document.getElementById('dash-drilldown-card');
    if (card) card.style.display = 'none';
}

/**
 * Desplaza la vista hasta el detalle mes a mes del Gasto Acumulado.
 *
 * El panel ahora es FIJO (siempre visible, se repinta en cada render del
 * dashboard), así que la tarjeta no lo abre ni lo cierra: solo lleva la vista
 * hasta él. Antes de desplazarse se repinta, por si el usuario cambió el
 * período y quiere ver los números correspondientes sin esperar al render.
 */
function scrollToDetalleAcumuladoDashboard() {
    const card = document.getElementById('dash-acumulado-card');
    if (!card) return;
    _pintarDetalleAcumuladoDashboard();
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Pinta la tabla mes a mes (gasto del mes, acumulado, variación y peso). */
function _pintarDetalleAcumuladoDashboard() {
    const body = document.getElementById('dash-acumulado-body');
    const elAnio = document.getElementById('dash-acumulado-anio');
    const elTotal = document.getElementById('dash-acumulado-total');
    if (!body) return;

    const serie = dashboardAcumuladoMensual || [];

    // El mes más caro fija la escala de las barras de peso relativo.
    const maximo = serie.reduce((m, f) => Math.max(m, f.gastoMes), 0);
    const totalGasto = serie.length ? serie[serie.length - 1].acumulado : 0;

    if (elAnio) elAnio.textContent = dashboardAcumuladoAnio ?? new Date().getFullYear();
    if (elTotal) elTotal.textContent = formatearMoneda(totalGasto);

    if (serie.length === 0 || totalGasto === 0) {
        body.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-secondary);">Sin gastos registrados en el año seleccionado.</td></tr>';
        return;
    }

    body.innerHTML = serie.map(f => {
        // Variación vs mes anterior (sin base de comparación → guion).
        let variacionHtml = '<span style="color:var(--text-secondary);">—</span>';
        if (f.gastoPrevio !== null && f.gastoPrevio > 0) {
            const pct = ((f.gastoMes - f.gastoPrevio) / f.gastoPrevio) * 100;
            if (pct > 0) variacionHtml = `<span style="color:var(--accent);font-weight:600;">▲ +${pct.toFixed(1)}%</span>`;
            else if (pct < 0) variacionHtml = `<span style="color:var(--accent-green);font-weight:600;">▼ ${pct.toFixed(1)}%</span>`;
            else variacionHtml = '<span style="color:var(--text-secondary);">= 0%</span>';
        } else if (f.gastoPrevio === null) {
            variacionHtml = '<span style="color:var(--text-secondary);">Mes base</span>';
        } else if (f.gastoMes > 0) {
            variacionHtml = '<span style="color:var(--text-secondary);">Sin base</span>';
        }

        const peso = totalGasto > 0 ? (f.gastoMes / totalGasto) * 100 : 0;
        const ancho = maximo > 0 ? (f.gastoMes / maximo) * 100 : 0;

        return `
            <tr>
                <td style="font-weight:600;">${escapeHtml(MESES_DRILLDOWN[f.mes - 1])}</td>
                <td style="text-align:right;">${escapeHtml(formatearMoneda(f.gastoMes))}</td>
                <td style="text-align:right;font-weight:700;">${escapeHtml(formatearMoneda(f.acumulado))}</td>
                <td style="text-align:right;">${variacionHtml}</td>
                <td>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <div style="flex:1;height:8px;background:rgba(255,255,255,0.06);border-radius:4px;overflow:hidden;">
                            <div style="width:${ancho.toFixed(1)}%;height:100%;background:var(--accent-blue);border-radius:4px;"></div>
                        </div>
                        <span style="min-width:52px;text-align:right;font-size:0.78rem;color:var(--text-secondary);">${peso.toFixed(1)}%</span>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function chartLineOptions() {
    return {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` $${ctx.raw.toLocaleString()}` } } },
        scales: {
            // Colores del tema activo (ejes/grilla): leídos vía cssVar() para que
            // respondan al cambio oscuro/claro en vez de quedar gris fijo.
            y: { grid: { color: cssVar('--chart-grid') }, ticks: { color: cssVar('--text-secondary') } },
            x: { grid: { display: false }, ticks: { color: cssVar('--text-secondary') } }
        }
    };
}

// ==================== GENERAR CÓDIGO DE COMPETENCIA ====================
function obtenerSiglaCategoria(nombre) {
    if (!nombre || typeof nombre !== 'string') return 'TC2000';
    const partes = nombre.trim().split(/\s+/).filter(Boolean);
    if (partes.length >= 2) {
        return (partes[0][0] + partes[1][0]).toUpperCase();
    }
    const palabra = partes[0] || '';
    if (palabra.length >= 3) {
        return palabra.slice(0, 3).toUpperCase();
    }
    return palabra.toUpperCase() || 'TC2000';
}

async function generarCodigoCompetencia(prefix = 'TC2000') {
    const competencias = await getTodos('competencias');
    const year = new Date().getFullYear();
    const pref = String(prefix).toUpperCase();
    const esteAño = competencias.filter(c => c.codigo && c.codigo.startsWith(pref + '-' + year));
    let maxNum = 0;
    esteAño.forEach(c => {
        const parts = c.codigo.split('-');
        if (parts.length === 3) {
            const num = parseInt(parts[2]);
            if (num > maxNum) maxNum = num;
        }
    });
    return `${pref}-${year}-${String(maxNum + 1).padStart(3, '0')}`;
}

function actualizarCodigoCompetenciaPorCategoria() {
    const competenciaId = document.getElementById('competencia-id').value;
    if (competenciaId) return; // no auto-generar cuando editamos una competencia existente

    const categoriasCheckboxes = Array.from(document.querySelectorAll('#competencia-categorias-checkboxes input'));
    const primeraSeleccionada = categoriasCheckboxes.find(cb => cb.checked);
    const categoriaNombre = primeraSeleccionada ? primeraSeleccionada.nextElementSibling?.textContent : '';
    const sigla = obtenerSiglaCategoria(categoriaNombre);
    const codigoInput = document.getElementById('competencia-codigo');
    const adminCodigoInput = document.getElementById('competencia-codigo-admin');
    const esAuto = codigoInput.dataset.auto === 'true' || codigoInput.value.trim() === '';

    if (!esAuto) return;

    generarCodigoCompetencia(sigla).then(nuevoCodigo => {
        codigoInput.value = nuevoCodigo;
        adminCodigoInput.value = nuevoCodigo;
        codigoInput.dataset.auto = 'true';
        adminCodigoInput.dataset.auto = 'true';
    }).catch(() => {
        // Si falla la generación, no hacemos nada
    });
}

// ==================== COMPETENCIAS (CALENDARIO) ====================

async function listarCompetencias() {
    await actualizarSelectoresFormularios();
        const [competencias, circuitos, categorias, gastos, rendiciones, detalleGastos] = await Promise.all([
            getTodos('competencias'),
            getTodos('circuitos'),
            getTodos('categorias'),
            getTodos('gastos'),
            getTodos('rendiciones'),
            getTodos('detalleGastos')
        ]);
        const categoriasDeduplicadas = deduplicarCategorias(categorias);
        const circuitosDeduplicados = deduplicarCircuitos(circuitos);
    const listContainer = document.getElementById('calendario-list');
    listContainer.innerHTML = '';

    if (competencias.length === 0) {
        listContainer.innerHTML = '<p style="color:var(--text-secondary);grid-column:1/-1;text-align:center;">No hay competencias registradas.</p>';
        return;
    }

    competencias.sort((a, b) => new Date(a.fechaInicio) - new Date(b.fechaInicio));

    const filtroCatEl = document.getElementById('calendario-filtro-categoria');
    const filtroMesEl = document.getElementById('calendario-filtro-mes');
    const filtroAnoEl = document.getElementById('calendario-filtro-ano');
    const filtroCat = filtroCatEl ? filtroCatEl.value : 'todos';
    const filtroMes = filtroMesEl ? filtroMesEl.value : 'todos';
    const filtroAno = filtroAnoEl ? filtroAnoEl.value : 'todos';

    let competenciasFiltradas = competencias.filter(comp => {
        if (filtroCat && filtroCat !== 'todos') {
            if (!comp.categoriasIds || !comp.categoriasIds.map(x => Number(x)).includes(Number(filtroCat))) return false;
        }
        const inicio = comp.fechaInicio ? new Date(comp.fechaInicio) : null;
        if (inicio && Number.isNaN(inicio.getTime())) inicio = null;

        // Filtro de mes: se compara contra el mes de INICIO de la competencia.
        // Si la competencia no tiene fecha valida NO se puede saber en que mes cae,
        // asi que se EXCLUYE cuando se filtra por mes/año (antes se la dejaba pasar
        // siempre, y por eso "solo el mes seleccionado" mostraba resultados extra).
        if (filtroMes && filtroMes !== 'todos') {
            if (!inicio) return false;
            if (Number(filtroMes) !== inicio.getMonth() + 1) return false;
        }
        if (filtroAno && filtroAno !== 'todos') {
            if (!inicio) return false;
            if (Number(filtroAno) !== inicio.getFullYear()) return false;
        }
        return true;
    });

    // Contador de resultados + aviso cuando el filtro deja la lista vacia.
    // Antes, un filtro sin coincidencias mostraba un bloque en blanco sin
    // explicacion, y no habia forma de saber si el filtro se estaba aplicando.
    const hayFiltro = (filtroCat && filtroCat !== 'todos') ||
                     (filtroMes && filtroMes !== 'todos') ||
                     (filtroAno && filtroAno !== 'todos');
    const resumenFiltros = document.getElementById('calendario-resumen-filtros');
    if (resumenFiltros) {
        if (hayFiltro) {
            resumenFiltros.style.display = '';
            resumenFiltros.innerHTML =
                `<i class="fa-solid fa-filter"></i> Mostrando ${competenciasFiltradas.length} de ${competencias.length} competencias`;
        } else {
            resumenFiltros.style.display = 'none';
            resumenFiltros.innerHTML = '';
        }
    }

    if (competenciasFiltradas.length === 0) {
        listContainer.innerHTML = hayFiltro
            ? '<p style="color:var(--text-secondary);grid-column:1/-1;text-align:center;">' +
              'No hay competencias que coincidan con los filtros seleccionados.</p>'
            : '<p style="color:var(--text-secondary);grid-column:1/-1;text-align:center;">No hay competencias registradas.</p>';
        updateCalendarioToggleButton();
        return;
    }

    if (calendarioViewMode === 'list') {
        const ul = document.createElement('ul');
        ul.className = 'competition-list-compact';
        competenciasFiltradas.forEach(comp => {
            const docBtn = comp.documentosUrl ? `<a href="${comp.documentosUrl}" target="_blank" class="action-btn" title="Ver documentos (OneDrive)" style="margin-left:10px;color:var(--accent);vertical-align:middle;"><i class="fa-solid fa-folder-open"></i></a>` : '';
            const li = document.createElement('li');
            li.className = 'competition-list-item';
            const codigoHtml = esAdmin() ? comp.codigo : `<span class="blur-readonly" style="display:inline-block;font-family:monospace;font-size:0.85rem;">${comp.codigo || 'SIN CÓDIGO'}</span>`;
            const puedeEditarComp = puedeEditar() || esSupervisor();
            const accionesHtml = puedeEditarComp ? `
                <div class="list-actions">
                    <button class="action-btn" onclick="verCompetencia(${comp.id})" title="Ver"><i class="fa-solid fa-eye"></i></button>
                    <button class="action-btn" onclick="editarCompetencia(${comp.id})" title="Editar"><i class="fa-solid fa-pen-to-square"></i></button>
                    <button class="action-btn delete" onclick="eliminarCompetencia(${comp.id})" title="Eliminar"><i class="fa-solid fa-trash"></i></button>
                </div>
            ` : `
                <div class="list-actions">
                    <button class="action-btn" onclick="verCompetencia(${comp.id})" title="Ver"><i class="fa-solid fa-eye"></i></button>
                </div>
            `;
            li.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;">
                <div style="flex:1;min-width:200px;">
                    <button class="link-like" onclick="editarCompetencia(${comp.id})">${comp.nombre}</button>${docBtn}
                    <div class="meta"><i class="fa-solid fa-hashtag"></i> ${codigoHtml}</div>
                    <div class="meta">${formatearFechaVisual(comp.fechaInicio)} - ${formatearFechaVisual(comp.fechaFin)}</div>
                </div>
                ${accionesHtml}
            </div>`;
            ul.appendChild(li);
        });
        listContainer.appendChild(ul);
        updateCalendarioToggleButton();
        return;
    }

    for (const comp of competenciasFiltradas) {
        const totalPersonal = await obtenerTotalPersonalCompetencia(comp.id);
        const circ = circuitos.find(c => c.id === Number(comp.circuitoId));
        const circNombre = circ ? `${circ.nombre} (${circ.ubicacion})` : 'Circuito Desconocido';
        const catNombres = comp.categoriasIds.map(id => {
            const cat = categorias.find(c => c.id === Number(id));
            return cat ? cat.nombre : '';
        }).filter(Boolean);
        // Sumar gastos simples asociados directamente a la competencia
        const costoSinples = gastos.filter(g => Number(g.competenciaId) === Number(comp.id)).reduce((s, g) => s + Number(g.monto), 0);
        // Sumar gastos detallados de rendiciones asociadas a esta competencia
        const rendicionesComp = rendiciones.filter(r => Number(r.competenciaId) === Number(comp.id));
        const costoDetallado = rendicionesComp.reduce((s, r) => {
            const detallesRend = detalleGastos.filter(d => Number(d.rendicionId) === Number(r.id));
            return s + detallesRend.reduce((sd, d) => sd + Number(d.total || 0), 0);
        }, 0);
        const costoAutoCalc = costoSinples + costoDetallado;
        // Sumar el total de personal por competencia
        const costoTotalConPersonal = costoAutoCalc + totalPersonal;
        // Si tiene gastoTotal manual guardado, usamos ese; sino el auto-calculado
        const tieneManual = comp.gastoTotal !== undefined && comp.gastoTotal !== null;
        const costoComp = tieneManual ? Number(comp.gastoTotal) : costoTotalConPersonal;
        const costoClass = tieneManual ? 'costo-manual' : 'costo-auto';
        const tooltipText = tieneManual ? 'Total editado manualmente. Haga clic para modificar o restaurar cálculo automático.' : 'Total calculado automáticamente de todos los gastos. Haga clic para editar.';

        // Calcular monto a facturar para esta competencia
        const montoFacturarSinples = gastos.filter(g => Number(g.competenciaId) === Number(comp.id)).reduce((s, g) => s + (Number(g.montoFacturar) || 0), 0);
        const montoFacturarDetallado = rendicionesComp.reduce((s, r) => {
            const detallesRend = detalleGastos.filter(d => Number(d.rendicionId) === Number(r.id));
            return s + detallesRend.reduce((sd, d) => sd + (Number(d.montoFacturar) || 0), 0);
        }, 0);
        const montoFacturarComp = montoFacturarSinples + montoFacturarDetallado;

        const puedeEditarComp = puedeEditar() || esSupervisor();
        const viewBtn = `<button class="action-btn" onclick="verCompetencia(${comp.id})" title="Ver detalle"><i class="fa-solid fa-eye"></i></button>`;
        const editActions = puedeEditarComp ? `
            <button class="action-btn" onclick="editarCompetencia(${comp.id})" title="Editar"><i class="fa-solid fa-pen-to-square"></i></button>
            <button class="action-btn delete" onclick="eliminarCompetencia(${comp.id})" title="Eliminar"><i class="fa-solid fa-trash"></i></button>
        ` : '';
        const editorActions = viewBtn + editActions;

        const puedeEditarTotal = puedeEditar() || esSupervisor();
        const puedeEditarMontoFacturar = puedeEditar() || esSupervisor();

        const docLink = comp.documentosUrl ? `
            <a href="${comp.documentosUrl}" target="_blank" class="action-btn" title="Ver OneDrive" style="color: var(--accent); display: inline-flex; align-items: center; gap: 6px;">
                <i class="fa-solid fa-folder-open"></i> Ver Archivos
            </a>
        ` : '';

        const card = document.createElement('div');
        card.className = 'data-card';
        card.dataset.compId = comp.id;
        const codigoVisible = esAdmin() ? comp.codigo : `<span class="blur-readonly" style="display:inline-block;font-family:monospace;font-size:0.9rem;">${comp.codigo || 'SIN CÓDIGO'}</span>`;
        
        let totalHtml;
        if (puedeEditarTotal) {
            totalHtml = `<span class="costo-label ${costoClass}" style="color:var(--accent);font-weight:700;cursor:pointer;" onclick="editarTotalCompetenciaInplace(${comp.id})" title="${tooltipText}">
                $${costoComp.toLocaleString(undefined,{minimumFractionDigits:2})}
                ${tieneManual ? '<i class="fa-solid fa-pencil" style="font-size:0.7rem;margin-left:4px;opacity:0.7;"></i>' : '<i class="fa-regular fa-pen-to-square" style="font-size:0.65rem;margin-left:4px;opacity:0.4;"></i>'}
            </span>`;
        } else {
            totalHtml = `<span style="color:var(--accent);font-weight:700;">$${costoComp.toLocaleString(undefined,{minimumFractionDigits:2})}</span>`;
        }

        const tieneMontoFacturarManual = comp.montoFacturarManual !== undefined && comp.montoFacturarManual !== null;
        const montoFacturarDisplay = tieneMontoFacturarManual ? Number(comp.montoFacturarManual) : montoFacturarComp;
        const montoFacturarClass = tieneMontoFacturarManual ? 'costo-manual' : 'costo-auto';
        
        let montoFacturarHtml;
        if (puedeEditarMontoFacturar) {
            montoFacturarHtml = `<span class="costo-label ${montoFacturarClass}" style="color:var(--accent);font-weight:700;cursor:pointer;white-space:nowrap;" onclick="editarMontoFacturarInplace(${comp.id})" title="${tieneMontoFacturarManual ? 'Valor editado manualmente. Haga clic para modificar o restaurar cálculo automático.' : 'Calculado automáticamente. Haga clic para editar.'}">
                <i class="fa-solid fa-file-invoice" style="font-size:0.85rem;margin-right:4px;"></i>${formatearMoneda(montoFacturarDisplay)}
                ${tieneMontoFacturarManual ? '<i class="fa-solid fa-pencil" style="font-size:0.7rem;margin-left:4px;opacity:0.7;"></i>' : '<i class="fa-regular fa-pen-to-square" style="font-size:0.65rem;margin-left:4px;opacity:0.4;"></i>'}
            </span>`;
        } else {
            montoFacturarHtml = `<span style="color:var(--accent);font-weight:700;white-space:nowrap;"><i class="fa-solid fa-file-invoice" style="font-size:0.85rem;margin-right:4px;"></i>${formatearMoneda(montoFacturarDisplay)}</span>`;
        }
        
        card.innerHTML = `
            <div class="data-card-title">
                <span>${comp.nombre}</span>
                ${totalHtml}
            </div>
            <div class="data-card-meta"><i class="fa-solid fa-hashtag"></i> <span style="font-family:monospace;font-weight:600;">${codigoVisible}</span></div>
            <div class="data-card-meta"><i class="fa-solid fa-map-location-dot"></i> <span>${circNombre}</span></div>
            <div class="data-card-meta"><i class="fa-solid fa-calendar-day"></i> <span>${formatearFechaVisual(comp.fechaInicio)} al ${formatearFechaVisual(comp.fechaFin)}</span></div>
            <div class="data-card-meta"><i class="fa-solid fa-user-tie"></i> <span>Personal por Competencia: <strong style="color:var(--accent);">${formatearMoneda(totalPersonal)}</strong></span></div>
            <div class="data-card-meta" style="color:var(--accent);">${montoFacturarHtml}</div>
            <div class="data-card-tags">${catNombres.map(n => `<span class="tag">${n}</span>`).join('')}</div>
            <div class="data-card-actions">
                ${docLink}
                ${editorActions}
            </div>
        `;
        listContainer.appendChild(card);
    }
    updateCalendarioToggleButton();
}

async function verCompetencia(id) {
    const comp = await obtenerPorId('competencias', id);
    if (!comp) return;
    const [circuitos, categorias, staff, gastos, rendiciones, detalleGastos] = await Promise.all([
        getTodos('circuitos'), getTodos('categorias'), getTodos('staff'),
        getTodos('gastos'), getTodos('rendiciones'), getTodos('detalleGastos')
    ]);
    const circ = circuitos.find(c => c.id === Number(comp.circuitoId));
    const circNombre = circ ? `${circ.nombre} (${circ.ubicacion})` : 'Desconocido';
    const catNombres = comp.categoriasIds.map(id => {
        const cat = categorias.find(c => c.id === Number(id));
        return cat ? cat.nombre : '';
    }).filter(Boolean);
    const staffNombres = (comp.staffIds || []).map(id => {
        const s = staff.find(p => p.id === Number(id));
        return s ? `${s.nombre} ${s.apellido} (${s.funcion})` : '';
    }).filter(Boolean);

    const totalPersonal = await obtenerTotalPersonalCompetencia(comp.id);
    const costoSinples = gastos.filter(g => Number(g.competenciaId) === Number(comp.id)).reduce((s, g) => s + Number(g.monto), 0);
    const rendicionesComp = rendiciones.filter(r => Number(r.competenciaId) === Number(comp.id));
    const costoDetallado = rendicionesComp.reduce((s, r) => {
        const detallesRend = detalleGastos.filter(d => Number(d.rendicionId) === Number(r.id));
        return s + detallesRend.reduce((sd, d) => sd + Number(d.total || 0), 0);
    }, 0);
    const costoAutoCalc = costoSinples + costoDetallado + totalPersonal;
    const tieneManual = comp.gastoTotal !== undefined && comp.gastoTotal !== null;
    const costoComp = tieneManual ? Number(comp.gastoTotal) : costoAutoCalc;

    // Calcular monto a facturar
    const montoFacturarSinples = gastos.filter(g => Number(g.competenciaId) === Number(comp.id)).reduce((s, g) => s + (Number(g.montoFacturar) || 0), 0);
    const montoFacturarDetallado = rendicionesComp.reduce((s, r) => {
        const detallesRend = detalleGastos.filter(d => Number(d.rendicionId) === Number(r.id));
        return s + detallesRend.reduce((sd, d) => sd + (Number(d.montoFacturar) || 0), 0);
    }, 0);
    const montoFacturarTotal = montoFacturarSinples + montoFacturarDetallado;

    if (!document.getElementById('modal-ver-competencia')) {
        const modalHtml = `
        <div id="modal-ver-competencia" class="modal-overlay">
            <div class="modal modal-lg">
                <div class="modal-header">
                    <h2 class="modal-title"><i class="fa-solid fa-trophy"></i> <span id="ver-comp-nombre"></span></h2>
                    <button class="modal-close" onclick="closeModal('modal-ver-competencia')">&times;</button>
                </div>
                <div class="modal-content" style="padding:1rem 0;">
                    <div class="stats-grid" id="ver-comp-stats" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:1rem;"></div>
                    <div class="form-card" style="margin-bottom:1rem;">
                        <div class="form-title"><i class="fa-solid fa-circle-info"></i> Información General</div>
                        <div id="ver-comp-info" style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;padding:0.5rem 0;"></div>
                    </div>
                    <div class="form-card">
                        <div class="form-title"><i class="fa-solid fa-users"></i> Personal Asignado</div>
                        <div id="ver-comp-staff" style="display:flex;flex-wrap:wrap;gap:0.5rem;padding:0.5rem 0;"></div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" onclick="closeModal('modal-ver-competencia')">Cerrar</button>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    document.getElementById('ver-comp-nombre').textContent = comp.nombre;

    // Monto a Facturar en modal Ver (editable si tiene permisos)
    const tieneMontoFacturarManual = comp.montoFacturarManual !== undefined && comp.montoFacturarManual !== null;
    const montoFacturarDisplay = tieneMontoFacturarManual ? Number(comp.montoFacturarManual) : montoFacturarTotal;
    
    let montoFacturarStatCard;
    if (puedeEditar() || esSupervisor()) {
        montoFacturarStatCard = `
            <div class="stat-card" style="padding:1rem;cursor:pointer;" onclick="editarMontoFacturarInplace(${comp.id})" title="Clic para editar">
                <div class="stat-info"><h3 style="font-size:0.85rem;">Monto a Facturar</h3>
                <p style="font-size:1.1rem;color:var(--accent);font-weight:700;">
                    <i class="fa-solid fa-file-invoice" style="font-size:0.9rem;margin-right:4px;"></i>${formatearMoneda(montoFacturarDisplay)}
                    ${tieneMontoFacturarManual ? '<i class="fa-solid fa-pencil" style="font-size:0.7rem;margin-left:4px;opacity:0.7;"></i>' : '<i class="fa-regular fa-pen-to-square" style="font-size:0.65rem;margin-left:4px;opacity:0.4;"></i>'}
                </p></div>
                <div class="stat-icon"><i class="fa-solid fa-file-invoice"></i></div>
            </div>`;
    } else {
        montoFacturarStatCard = `
            <div class="stat-card" style="padding:1rem;">
                <div class="stat-info"><h3 style="font-size:0.85rem;">Monto a Facturar</h3><p style="font-size:1.1rem;color:var(--accent);font-weight:700;">${formatearMoneda(montoFacturarDisplay)}</p></div>
                <div class="stat-icon"><i class="fa-solid fa-file-invoice"></i></div>
            </div>`;
    }

    // Total Gastos en modal Ver (editable si tiene permisos)
    let totalGastosStatCard;
    if (puedeEditar() || esSupervisor()) {
        totalGastosStatCard = `
            <div class="stat-card" style="padding:1rem;cursor:pointer;" onclick="editarTotalCompetenciaInplace(${comp.id})" title="Clic para editar">
                <div class="stat-info"><h3 style="font-size:0.85rem;">Total Gastos</h3>
                <p style="font-size:1.1rem;color:var(--accent);font-weight:700;">
                    <i class="fa-solid fa-dollar-sign" style="font-size:0.9rem;margin-right:4px;"></i>${formatearMoneda(costoComp)}
                    ${tieneManual ? '<i class="fa-solid fa-pencil" style="font-size:0.7rem;margin-left:4px;opacity:0.7;"></i>' : '<i class="fa-regular fa-pen-to-square" style="font-size:0.65rem;margin-left:4px;opacity:0.4;"></i>'}
                </p></div>
                <div class="stat-icon"><i class="fa-solid fa-dollar-sign"></i></div>
            </div>`;
    } else {
        totalGastosStatCard = `
            <div class="stat-card" style="padding:1rem;">
                <div class="stat-info"><h3 style="font-size:0.85rem;">Total Gastos</h3><p style="font-size:1.1rem;color:var(--accent);font-weight:700;">${formatearMoneda(costoComp)}</p></div>
                <div class="stat-icon"><i class="fa-solid fa-dollar-sign"></i></div>
            </div>`;
    }

    document.getElementById('ver-comp-stats').innerHTML = `
        <div class="stat-card" style="padding:1rem;"><div class="stat-info"><h3 style="font-size:0.85rem;">Código</h3><p style="font-size:1.1rem;font-family:monospace;">${comp.codigo || 'SIN CÓDIGO'}</p></div><div class="stat-icon"><i class="fa-solid fa-hashtag"></i></div></div>
        ${totalGastosStatCard}
        <div class="stat-card" style="padding:1rem;"><div class="stat-info"><h3 style="font-size:0.85rem;">Gastos Personal</h3><p style="font-size:1.1rem;color:var(--accent);font-weight:700;"><i class="fa-solid fa-user-tie" style="font-size:0.9rem;margin-right:4px;"></i>${formatearMoneda(totalPersonal)}</p></div><div class="stat-icon"><i class="fa-solid fa-user-tie"></i></div></div>
        ${montoFacturarStatCard}
        <div class="stat-card" style="padding:1rem;"><div class="stat-info"><h3 style="font-size:0.85rem;">Categorías</h3><p style="font-size:1rem;">${catNombres.slice(0, 3).join(', ')}${catNombres.length > 3 ? ` (+${catNombres.length - 3})` : ''}</p></div><div class="stat-icon"><i class="fa-solid fa-tag"></i></div></div>
        <div class="stat-card" style="padding:1rem;"><div class="stat-info"><h3 style="font-size:0.85rem;">Personal</h3><p style="font-size:1rem;">${staffNombres.length} asignados</p></div><div class="stat-icon"><i class="fa-solid fa-users"></i></div></div>
    `;

    const calcInfo = tieneManual ? 
        `<div><strong>Total auto-calculado:</strong> ${formatearMoneda(costoAutoCalc)}</div>
         <div><strong>Total manual:</strong> <span style="color:var(--accent);">${formatearMoneda(Number(comp.gastoTotal))}</span></div>` : 
        `<div><strong>Total:</strong> ${formatearMoneda(costoAutoCalc)} <span style="color:var(--text-secondary);font-size:0.85rem;">(calculado automáticamente)</span></div>`;

    const docLink = comp.documentosUrl ? `<a href="${comp.documentosUrl}" target="_blank" style="color:var(--accent);"><i class="fa-solid fa-folder-open"></i> Ver documentos</a>` : '<span style="color:var(--text-secondary);">No hay documentos</span>';

    document.getElementById('ver-comp-info').innerHTML = `
        <div><strong>Autódromo:</strong> ${circNombre}</div>
        <div><strong>Código:</strong> <span style="font-family:monospace;">${comp.codigo || 'SIN CÓDIGO'}</span></div>
        <div><strong>Fecha inicio:</strong> ${formatearFechaVisual(comp.fechaInicio)}</div>
        <div><strong>Fecha fin:</strong> ${formatearFechaVisual(comp.fechaFin)}</div>
        ${calcInfo}
        <div><strong>Documentos:</strong> ${docLink}</div>
        <div><strong>Gastos simples:</strong> ${formatearMoneda(costoSinples)}</div>
        <div><strong>Gastos detallados:</strong> ${formatearMoneda(costoDetallado)}</div>
        <div><strong>Gastos de personal:</strong> <span style="color:var(--accent);font-weight:600;">${formatearMoneda(totalPersonal)}</span></div>
    `;

    const staffContainer = document.getElementById('ver-comp-staff');
    staffContainer.innerHTML = '';
    if (staffNombres.length === 0) {
        staffContainer.innerHTML = '<span style="color:var(--text-secondary);">No hay personal asignado a esta competencia.</span>';
    } else {
        staffNombres.forEach(n => {
            const span = document.createElement('span');
            span.className = 'tag';
            span.textContent = n;
            staffContainer.appendChild(span);
        });
    }

    openModal('modal-ver-competencia');
}

async function openModalCompetencia() {
    if (!puedeEditar()) return;
    await actualizarSelectoresFormularios();
    document.getElementById('form-competencia').reset();
    document.getElementById('competencia-id').value = '';
    const codigoInput = document.getElementById('competencia-codigo');
    const adminCodigoInput = document.getElementById('competencia-codigo-admin');
    codigoInput.value = '';
    adminCodigoInput.value = '';
    codigoInput.dataset.auto = 'true';
    adminCodigoInput.dataset.auto = 'true';
    document.getElementById('competencia-documentos').value = '';
    document.getElementById('competencia-modal-title').innerText = 'Agregar Competencia';
    document.querySelectorAll('#competencia-categorias-checkboxes input').forEach(cb => cb.checked = false);
    document.querySelectorAll('#competencia-staff-checkboxes input').forEach(cb => cb.checked = false);

    actualizarCodigoCompetenciaPorCategoria();
    openModal('modal-competencia');
}

async function editarCompetencia(id) {
    if (!puedeEditar()) return;
    const comp = await obtenerPorId('competencias', id);
    if (!comp) return;
    // Cargar los selectores con las listas más recientes de categorías activas y staff activo
    await actualizarSelectoresFormularios();

    document.getElementById('competencia-id').value = comp.id;
    document.getElementById('competencia-nombre').value = comp.nombre;
    document.getElementById('competencia-circuito').value = comp.circuitoId;
    document.getElementById('competencia-inicio').value = comp.fechaInicio;
    document.getElementById('competencia-fin').value = comp.fechaFin;
    document.getElementById('competencia-documentos').value = comp.documentosUrl || '';

    const codigoInput = document.getElementById('competencia-codigo');
    const adminCodigoInput = document.getElementById('competencia-codigo-admin');
    codigoInput.value = comp.codigo || '';
    adminCodigoInput.value = comp.codigo || '';
    codigoInput.dataset.auto = 'false';
    adminCodigoInput.dataset.auto = 'false';
    document.getElementById('admin-edit-codigo-group').style.display = esAdmin() ? 'block' : 'none';

    // Normalizar los arrays de IDs guardados en la BD (pueden venir como number o string legacy)
    const categoriasIdsGuardadas = (comp.categoriasIds || []).map(Number);
    document.querySelectorAll('#competencia-categorias-checkboxes input').forEach(cb => {
        cb.checked = categoriasIdsGuardadas.includes(Number(cb.value));
    });
    const staffIdsGuardados = (comp.staffIds || []).map(Number);
    document.querySelectorAll('#competencia-staff-checkboxes input').forEach(cb => {
        cb.checked = staffIdsGuardados.includes(Number(cb.value));
    });
    document.getElementById('competencia-modal-title').innerText = 'Editar Competencia';
    openModal('modal-competencia');
}

async function guardarCompetenciaForm(e) {
    e.preventDefault();
    if (!puedeEditar()) return;
    const id = document.getElementById('competencia-id').value;
    const categoriasCheckboxes = document.querySelectorAll('#competencia-categorias-checkboxes input:checked');
    const categoriasIds = Array.from(categoriasCheckboxes).map(cb => Number(cb.value));
    if (categoriasIds.length === 0) { mostrarToast('Seleccioná al menos una categoría.', 'error'); return; }

    const staffCheckboxes = document.querySelectorAll('#competencia-staff-checkboxes input:checked');
    const staffIds = Array.from(staffCheckboxes).map(cb => Number(cb.value));

    let codigo = document.getElementById('competencia-codigo').value.trim();
    const adminCodigo = document.getElementById('competencia-codigo-admin').value.trim();
    if (esAdmin() && adminCodigo) {
        codigo = adminCodigo;
    }
    if (!codigo) {
        codigo = await generarCodigoCompetencia();
    }

    // Obtener valores originales para preservar campos manuales
    const competenciaOriginal = id ? await obtenerPorId('competencias', Number(id)) : {};
    const gastoTotalManual = competenciaOriginal.gastoTotal;
    const montoFacturarManual = competenciaOriginal.montoFacturarManual;

    const competencia = {
        nombre: document.getElementById('competencia-nombre').value,
        circuitoId: Number(document.getElementById('competencia-circuito').value),
        fechaInicio: document.getElementById('competencia-inicio').value,
        fechaFin: document.getElementById('competencia-fin').value,
        categoriasIds,
        staffIds,
        documentosUrl: document.getElementById('competencia-documentos').value.trim(),
        codigo,
        gastoTotal: gastoTotalManual,
        montoFacturarManual: montoFacturarManual
    };
    if (id) competencia.id = Number(id);

    const savedId = await guardar('competencias', competencia);
    competencia.id = Number(savedId);
    await aplicarAsignacionesCompetencia(competencia);
    dashboardDirty = true;
    closeModal('modal-competencia');
    listarCompetencias();
}

async function eliminarCompetencia(id) {
    if (!puedeEditar()) return;
    if (!confirm('¿Eliminar esta competencia y sus gastos asociados?')) return;
    await eliminar('competencias', id);
    const gastos = await getTodos('gastos');
    for (const g of gastos) {
        if (Number(g.competenciaId) === Number(id)) await eliminar('gastos', g.id);
    }
    await limpiarCompetenciaDeStaff(id);
    dashboardDirty = true;
    listarCompetencias();
}

async function limpiarCompetenciaDeStaff(competenciaId) {
    const staffList = await getTodos('staff');
    for (const persona of staffList) {
        if ((persona.competenciasIds || []).includes(Number(competenciaId))) {
            persona.competenciasIds = (persona.competenciasIds || []).filter(cid => Number(cid) !== Number(competenciaId));
            await guardar('staff', persona);
        }
    }
}

// ==================== EDICIÓN INLINE DEL MONTO A FACTURAR ====================
async function editarMontoFacturarInplace(compId) {
    if (!puedeEditar() && !esSupervisor()) return;
    
    const comp = await obtenerPorId('competencias', compId);
    if (!comp) return;

    // Calcular el valor auto-calculado para referencia
    const gastos = await getTodos('gastos');
    const rendiciones = await getTodos('rendiciones');
    const detalleGastos = await getTodos('detalleGastos');
    const rendicionesComp = rendiciones.filter(r => Number(r.competenciaId) === Number(compId));
    const montoFacturarSinples = gastos.filter(g => Number(g.competenciaId) === Number(compId)).reduce((s, g) => s + (Number(g.montoFacturar) || 0), 0);
    const montoFacturarDetallado = rendicionesComp.reduce((s, r) => {
        const detallesRend = detalleGastos.filter(d => Number(d.rendicionId) === Number(r.id));
        return s + detallesRend.reduce((sd, d) => sd + (Number(d.montoFacturar) || 0), 0);
    }, 0);
    const montoFacturarAutoCalc = montoFacturarSinples + montoFacturarDetallado;
    const valorActual = (comp.montoFacturarManual !== undefined && comp.montoFacturarManual !== null) ? Number(comp.montoFacturarManual) : montoFacturarAutoCalc;

    // Preparar datos para el modal
    document.getElementById('modal-editar-total-title').textContent = `Editar Monto a Facturar - ${comp.nombre}`;
    document.getElementById('modal-editar-total-competencia').textContent = `Competencia: ${comp.nombre}`;
    document.getElementById('modal-editar-total-label').textContent = 'Monto a Facturar total:';
    document.getElementById('modal-editar-total-helper').textContent = 'Ingresá el valor TOTAL que deseas facturar. Dejalo vacío para usar el cálculo automático.';
    document.getElementById('modal-editar-total-desglose').innerHTML = `
        <div style="padding:0.5rem;background:rgba(0,0,0,0.2);border-radius:6px;">
            <div style="font-size:0.85rem;color:var(--text-secondary);">Monto a Facturar (Auto-calculado)</div>
            <div style="font-size:1.1rem;font-weight:700;color:var(--accent);">${formatearMoneda(montoFacturarAutoCalc)}</div>
        </div>
        <div style="padding:0.5rem;background:rgba(0,0,0,0.2);border-radius:6px;">
            <div style="font-size:0.85rem;color:var(--text-secondary);">Gastos Simples (incluidos)</div>
            <div style="font-size:1.1rem;font-weight:700;color:var(--accent);">${formatearMoneda(montoFacturarSinples)}</div>
        </div>
        <div style="padding:0.5rem;background:rgba(0,210,211,0.1);border-radius:6px;grid-column:1/-1;">
            <div style="font-size:0.85rem;color:var(--text-secondary);">Total Auto-calculado</div>
            <div style="font-size:1.2rem;font-weight:700;color:var(--accent);">${formatearMoneda(montoFacturarAutoCalc)}</div>
        </div>
    `;

    // Mostrar el valor actual total
    document.getElementById('modal-editar-total-input').value = valorActual > 0 ? valorActual : '';

    // Guardar datos temporales en el modal
    document.getElementById('modal-editar-total-gastos').dataset.compId = compId;
    document.getElementById('modal-editar-total-gastos').dataset.costoAutoCalc = montoFacturarAutoCalc;
    document.getElementById('modal-editar-total-gastos').dataset.tipo = 'montoFacturar';

    openModal('modal-editar-total-gastos');
}

// ==================== EDICIÓN INLINE DEL TOTAL DE COMPETENCIA ====================
async function editarTotalCompetenciaInplace(compId) {
    if (!puedeEditar() && !esSupervisor()) return;

    const comp = await obtenerPorId('competencias', compId);
    if (!comp) return;

    // Calcular el valor auto-calculado para referencia (incluyendo gastos simples + detallados)
    const gastos = await getTodos('gastos');
    const rendiciones = await getTodos('rendiciones');
    const detalleGastos = await getTodos('detalleGastos');
    const costoSinples = gastos.filter(g => Number(g.competenciaId) === Number(compId)).reduce((s, g) => s + Number(g.monto), 0);
    const rendicionesComp = rendiciones.filter(r => Number(r.competenciaId) === Number(compId));
    const costoDetallado = rendicionesComp.reduce((s, r) => {
        const detallesRend = detalleGastos.filter(d => Number(d.rendicionId) === Number(r.id));
        return s + detallesRend.reduce((sd, d) => sd + Number(d.total || 0), 0);
    }, 0);
    const costoAutoCalc = costoSinples + costoDetallado;
    const valorActual = (comp.gastoTotal !== undefined && comp.gastoTotal !== null) ? Number(comp.gastoTotal) : costoAutoCalc;

    // Preparar datos para el modal
    document.getElementById('modal-editar-total-title').textContent = `Editar Total de Gastos - ${comp.nombre}`;
    document.getElementById('modal-editar-total-competencia').textContent = `Competencia: ${comp.nombre}`;
    document.getElementById('modal-editar-total-desglose').innerHTML = `
        <div style="padding:0.5rem;background:rgba(0,0,0,0.2);border-radius:6px;">
            <div style="font-size:0.85rem;color:var(--text-secondary);">Gastos Simples</div>
            <div style="font-size:1.1rem;font-weight:700;color:var(--accent);">${formatearMoneda(costoSinples)}</div>
        </div>
        <div style="padding:0.5rem;background:rgba(0,0,0,0.2);border-radius:6px;">
            <div style="font-size:0.85rem;color:var(--text-secondary);">Gastos Detallados</div>
            <div style="font-size:1.1rem;font-weight:700;color:var(--accent);">${formatearMoneda(costoDetallado)}</div>
        </div>
        <div style="padding:0.5rem;background:rgba(0,210,211,0.1);border-radius:6px;grid-column:1/-1;">
            <div style="font-size:0.85rem;color:var(--text-secondary);">Total Auto-calculado</div>
            <div style="font-size:1.2rem;font-weight:700;color:var(--accent);">${formatearMoneda(costoAutoCalc)}</div>
        </div>
    `;

    // Mostrar el valor total actual (consistente con montoFacturarManual)
    document.getElementById('modal-editar-total-input').value = valorActual > 0 ? valorActual : '';

    // Guardar datos temporales en el modal
    document.getElementById('modal-editar-total-gastos').dataset.compId = compId;
    document.getElementById('modal-editar-total-gastos').dataset.costoAutoCalc = costoAutoCalc;

    openModal('modal-editar-total-gastos');
}

async function guardarTotalGastosManual() {
    const compId = document.getElementById('modal-editar-total-gastos').dataset.compId;
    const costoAutoCalc = parseFloat(document.getElementById('modal-editar-total-gastos').dataset.costoAutoCalc);
    const inputSumar = document.getElementById('modal-editar-total-input').value;
    const tipo = document.getElementById('modal-editar-total-gastos').dataset.tipo || 'gastoTotal';

    if (!compId) return;

    const comp = await obtenerPorId('competencias', Number(compId));
    if (!comp) return;

    if (inputSumar === '' || inputSumar === null || isNaN(Number(inputSumar))) {
        // Si está vacío, eliminar el valor manual y usar auto-calculado
        if (tipo === 'montoFacturar') {
            delete comp.montoFacturarManual;
        } else {
            delete comp.gastoTotal;
        }
    } else {
        const valorIngresado = parseFloat(Number(inputSumar).toFixed(2));
        if (tipo === 'montoFacturar') {
            // El usuario ingresa el TOTAL deseado directamente
            comp.montoFacturarManual = valorIngresado;
        } else {
            // Para gastoTotal: el usuario ingresa el TOTAL deseado directamente (consistente)
            comp.gastoTotal = valorIngresado;
        }
    }

    await guardar('competencias', comp);
    dashboardDirty = true;
    listarCompetencias();
    closeModal('modal-editar-total-gastos');
}

async function restaurarTotalGastosAuto() {
    const compId = document.getElementById('modal-editar-total-gastos').dataset.compId;
    if (!compId) return;

    const comp = await obtenerPorId('competencias', Number(compId));
    if (!comp) return;

    delete comp.gastoTotal;
    await guardar('competencias', comp);
    dashboardDirty = true;
    listarCompetencias();
    closeModal('modal-editar-total-gastos');
}

// ==================== GASTOS ====================

async function listarGastos() {
    const [competencias, gastos, rendiciones, detalleGastos] = await Promise.all([
        getTodos('competencias'),
        getTodos('gastos'),
        getTodos('rendiciones'),
        getTodos('detalleGastos')
    ]);
    const catFiltro = document.getElementById('filtro-categoria-gastos').value;
    const compFiltro = document.getElementById('filtro-competencia-gastos').value;
    const buscador = document.getElementById('buscar-gastos').value.toLowerCase();
    const tbody = document.getElementById('gastos-table-body');
    tbody.innerHTML = '';

    // Cerrar panel resumen
    cerrarResumenCompetencia();

    // Filtrar competencias
    let competenciasFiltradas = competencias.filter(comp => {
        if (catFiltro !== 'todos' && (!comp.categoriasIds || !comp.categoriasIds.map(x => Number(x)).includes(Number(catFiltro)))) return false;
        if (compFiltro && compFiltro !== 'todos' && Number(comp.id) !== Number(compFiltro)) return false;
        if (buscador) {
            const texto = `${comp.nombre} ${comp.codigo || ''}`.toLowerCase();
            const buscadorNum = Number(buscador);
            const idMatch = !Number.isNaN(buscadorNum) && Number(comp.id) === buscadorNum;
            if (!texto.includes(buscador) && !idMatch) return false;
        }
        return true;
    }).sort((a, b) => new Date(b.fechaInicio) - new Date(a.fechaInicio));

    if (competenciasFiltradas.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${puedeEditar() ? 8 : 7}" style="text-align:center;color:var(--text-secondary);">No se encontraron competencias.</td></tr>`;
        return;
    }

    // Mostrar listado de competencias con sus totales
    for (const comp of competenciasFiltradas) {
        const totalPersonal = await obtenerTotalPersonalCompetencia(comp.id);
        const costoSinples = gastos.filter(g => Number(g.competenciaId) === Number(comp.id)).reduce((s, g) => s + Number(g.monto), 0);
        const rendicionesComp = rendiciones.filter(r => Number(r.competenciaId) === Number(comp.id));
        const costoDetallado = rendicionesComp.reduce((s, r) => {
            const detallesRend = detalleGastos.filter(d => Number(d.rendicionId) === Number(r.id));
            return s + detallesRend.reduce((sd, d) => sd + Number(d.total || 0), 0);
        }, 0);
        const costoTotal = costoSinples + costoDetallado + totalPersonal;

        const montoFacturarSinples = gastos.filter(g => Number(g.competenciaId) === Number(comp.id)).reduce((s, g) => s + (Number(g.montoFacturar) || 0), 0);
        const montoFacturarDetallado = rendicionesComp.reduce((s, r) => {
            const detallesRend = detalleGastos.filter(d => Number(d.rendicionId) === Number(r.id));
            return s + detallesRend.reduce((sd, d) => sd + (Number(d.montoFacturar) || 0), 0);
        }, 0);
        const montoFacturarTotal = montoFacturarSinples + montoFacturarDetallado;

        const acciones = puedeEditar() ? `
            <td style="text-align:right;white-space:nowrap;">
                <button class="action-btn" onclick="verCompetencia(${comp.id})" title="Ver"><i class="fa-solid fa-eye"></i></button>
                <button class="action-btn" onclick="editarGastoRapido(${comp.id})" title="Editar"><i class="fa-solid fa-pen-to-square"></i></button>
                <button class="action-btn delete" onclick="eliminarCompetencia(${comp.id})" title="Eliminar"><i class="fa-solid fa-trash"></i></button>
            </td>
        ` : `
            <td style="text-align:right;white-space:nowrap;">
                <button class="action-btn" onclick="verCompetencia(${comp.id})" title="Ver"><i class="fa-solid fa-eye"></i></button>
            </td>
        `;

        const staffCount = comp.staffIds ? comp.staffIds.length : 0;
        const gastosCount = gastos.filter(g => Number(g.competenciaId) === Number(comp.id)).length;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${escapeHtml(comp.codigo || 'SIN CÓDIGO')}</strong></td>
            <td style="font-weight:600;">${escapeHtml(comp.nombre)}</td>
            <td><span style="font-size:0.85rem;color:var(--text-secondary);">${formatearFechaVisual(comp.fechaInicio)}<br>${formatearFechaVisual(comp.fechaFin)}</span></td>
            <td><span style="font-size:0.85rem;color:var(--text-secondary);">${staffCount} asignados</span></td>
            <td style="font-size:0.85rem;color:var(--text-secondary);">${gastosCount} gastos</td>
            <td style="font-size:0.85rem;color:var(--text-secondary);">Personal: <strong style="color:var(--accent);">${formatearMoneda(totalPersonal)}</strong></td>
            <td style="color:var(--accent);font-weight:700;">${formatearMoneda(costoTotal)}</td>
            <td style="color:var(--accent);font-weight:700;">${formatearMoneda(montoFacturarTotal)}</td>
            ${acciones}
        `;
        tbody.appendChild(tr);
    }
}

// Abre el formulario de gastos simples desde la vista Control de Gastos.
// El botón del HTML mantiene este nombre como punto de entrada público.
async function openModalGasto() {
    if (!puedeEditar()) return;

    const form = document.getElementById('form-gasto');
    if (form) form.reset();

    document.getElementById('gasto-id').value = '';
    document.getElementById('gasto-modal-title').textContent = 'Cargar Gasto';
    document.getElementById('gasto-fecha').value = new Date().toISOString().split('T')[0];

    await actualizarSelectoresFormularios();

    // Dejar explícita la categoría predeterminada para evitar un gasto sin clasificación.
    const categoria = document.getElementById('gasto-categoria');
    if (categoria) categoria.value = 'general';

    _fotoModalGasto = _fotoCampos(_IDS_MODAL_GASTO);
    openModal('modal-gasto');
}

async function actualizarDatosCompetenciaGastoExtraordinario() {
    const selectComp = document.getElementById('age-competencia');
    const compId = selectComp.value;
    const modal = document.getElementById('modal-agregar-gasto-extraordinario');
    modal.dataset.compId = compId;

    const comp = compId ? await obtenerPorId('competencias', Number(compId)) : null;
    document.getElementById('age-codigo').textContent = comp ? (comp.codigo || 'SIN CÓDIGO') : '-';
    document.getElementById('age-nombre').textContent = comp ? comp.nombre : '-';
    document.getElementById('age-fecha-inicio').textContent = comp ? formatearFechaVisual(comp.fechaInicio) : '-';
    document.getElementById('age-fecha-fin').textContent = comp ? formatearFechaVisual(comp.fechaFin) : '-';
}

// ==================== GESTIÓN DE MODALES ====================
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('active');
}
function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('active');
}

// ============ PROTECCIÓN DE CAMBIOS SIN GUARDAR (MÓDULO GASTOS) ============
// Al abrir un formulario de gasto manual se guarda una "foto" de sus campos para
// detectar ediciones posteriores y evitar salir sin guardar de forma accidental.

let _vistaPendiente = null;

function _fotoCampos(ids) {
    return ids.map(id => {
        const el = document.getElementById(id);
        return el ? el.value : '';
    });
}

function _camposCambiaron(ids, foto) {
    return ids.some((id, i) => {
        const el = document.getElementById(id);
        return el ? el.value !== foto[i] : false;
    });
}

const _IDS_MODAL_GASTO = ['gasto-competencia', 'gasto-concepto', 'gasto-categoria', 'gasto-monto', 'gasto-fecha', 'gasto-notas'];
const _IDS_MODAL_GASTO_EXTRA = ['age-competencia', 'age-concepto', 'age-monto', 'age-detalle'];
let _fotoModalGasto = [];
let _fotoModalGastoExtra = [];

async function cerrarModalGasto() {
    if (_camposCambiaron(_IDS_MODAL_GASTO, _fotoModalGasto)) {
        const ok = await mostrarConfirmacion(
            'Salir sin guardar',
            'Hay cambios sin guardar en este gasto. ¿Estás seguro de que deseas salir sin guardar?',
            'warning'
        );
        if (!ok) return;
    }
    closeModal('modal-gasto');
}

async function cerrarModalGastoExtraordinario() {
    if (_camposCambiaron(_IDS_MODAL_GASTO_EXTRA, _fotoModalGastoExtra)) {
        const ok = await mostrarConfirmacion(
            'Salir sin guardar',
            'Hay cambios sin guardar en este gasto. ¿Estás seguro de que deseas salir sin guardar?',
            'warning'
        );
        if (!ok) return;
    }
    closeModal('modal-agregar-gasto-extraordinario');
}

// Guarda un nuevo Gasto Extraordinario vinculado a la competencia seleccionada
async function guardarGastoExtraordinarioNuevo() {
    if (!puedeEditar()) return;

    const modal = document.getElementById('modal-agregar-gasto-extraordinario');
    const compId = modal.dataset.compId;
    if (!compId) return;

    const concepto = document.getElementById('age-concepto').value.trim();
    const monto = Number(document.getElementById('age-monto').value);
    const detalle = document.getElementById('age-detalle').value.trim();

    if (!concepto) {
        mostrarToast('Ingresá el concepto del gasto.', 'error');
        return;
    }
    if (!monto || monto <= 0) {
        mostrarToast('Ingresá un monto válido.', 'error');
        return;
    }

    const gasto = {
        competenciaId: Number(compId),
        staffId: null,
        categoriaId: 'general',
        concepto: concepto,
        monto: monto,
        montoFacturar: monto,
        fecha: new Date().toISOString().split('T')[0],
        observaciones: detalle || 'Gasto extraordinario'
    };

    await guardar('gastos', gasto);
    dashboardDirty = true;

    // Limpiar formulario
    document.getElementById('age-concepto').value = '';
    document.getElementById('age-monto').value = '';
    document.getElementById('age-detalle').value = '';

    closeModal('modal-agregar-gasto-extraordinario');
    mostrarToast('Gasto extraordinario guardado correctamente.');
    await listarGastos();
}

async function guardarGastoForm(e) {
    e.preventDefault();
    if (!puedeEditar()) return;
    const id = document.getElementById('gasto-id').value;
    const monto = Number(document.getElementById('gasto-monto').value);
    const categoriaSel = document.getElementById('gasto-categoria');
    const categoriaId = categoriaSel && categoriaSel.value ? categoriaSel.value : 'general';
    const gasto = {
        competenciaId: Number(document.getElementById('gasto-competencia').value),
        staffId: null,
        categoriaId: categoriaId,
        concepto: document.getElementById('gasto-concepto').value,
        monto: monto,
        montoFacturar: monto,
        fecha: document.getElementById('gasto-fecha').value,
        observaciones: document.getElementById('gasto-notas').value
    };
    if (id) gasto.id = Number(id);
    await guardar('gastos', gasto);
    dashboardDirty = true;
    closeModal('modal-gasto');
    listarGastos();
}

function cerrarResumenCompetencia() {
    const panel = document.getElementById('resumen-competencia-panel');
    if (panel) panel.style.display = 'none';
}

// ==================== EDICIÓN RÁPIDA DE GASTO (NUEVO COMPONENTE) ====================
// Abre el modal independiente para editar el Gasto Extraordinario y el Monto a Facturar
// de una competencia seleccionada en la tabla 'Control de Gastos'.
async function editarGastoRapido(compId) {
    if (!puedeEditar()) return;

    const comp = await obtenerPorId('competencias', compId);
    if (!comp) return;

    // Calcular el monto del gasto extraordinario (gastos simples con categoría 'general')
    const gastos = await getTodos('gastos');
    const gastosExtraordinarios = gastos.filter(g =>
        Number(g.competenciaId) === Number(compId) &&
        (g.categoriaId === 'general' || g.categoriaId === undefined || g.categoriaId === null)
    );
    const montoGastoExtraordinario = gastosExtraordinarios.reduce((s, g) => s + Number(g.monto || 0), 0);

    // Calcular el monto a facturar actual (manual o auto-calculado)
    const rendiciones = await getTodos('rendiciones');
    const detalleGastos = await getTodos('detalleGastos');
    const rendicionesComp = rendiciones.filter(r => Number(r.competenciaId) === Number(compId));
    const montoFacturarSinples = gastos.filter(g => Number(g.competenciaId) === Number(compId)).reduce((s, g) => s + (Number(g.montoFacturar) || 0), 0);
    const montoFacturarDetallado = rendicionesComp.reduce((s, r) => {
        const detallesRend = detalleGastos.filter(d => Number(d.rendicionId) === Number(r.id));
        return s + detallesRend.reduce((sd, d) => sd + (Number(d.montoFacturar) || 0), 0);
    }, 0);
    const montoFacturarAutoCalc = montoFacturarSinples + montoFacturarDetallado;
    const montoFacturarActual = (comp.montoFacturarManual !== undefined && comp.montoFacturarManual !== null)
        ? Number(comp.montoFacturarManual)
        : montoFacturarAutoCalc;

    // Rellenar datos de la competencia (solo lectura)
    document.getElementById('egr-codigo').textContent = comp.codigo || 'SIN CÓDIGO';
    document.getElementById('egr-nombre').textContent = comp.nombre;
    document.getElementById('egr-fecha-inicio').textContent = formatearFechaVisual(comp.fechaInicio);
    document.getElementById('egr-fecha-fin').textContent = formatearFechaVisual(comp.fechaFin);

    // Rellenar campos editables
    document.getElementById('egr-monto-gasto').value = montoGastoExtraordinario > 0 ? montoGastoExtraordinario : '';
    document.getElementById('egr-monto-facturar').value = montoFacturarActual > 0 ? montoFacturarActual : '';

    // Guardar el ID de la competencia en el dataset del modal
    document.getElementById('modal-editar-gasto-rapido').dataset.compId = compId;

    openModal('modal-editar-gasto-rapido');
}

// Guarda los cambios del modal de edición rápida
async function guardarEdicionGastoRapido() {
    if (!puedeEditar()) return;

    const modal = document.getElementById('modal-editar-gasto-rapido');
    const compId = modal.dataset.compId;
    if (!compId) return;

    const comp = await obtenerPorId('competencias', Number(compId));
    if (!comp) return;

    const montoGastoInput = document.getElementById('egr-monto-gasto').value;
    const montoFacturarInput = document.getElementById('egr-monto-facturar').value;

    // 1) Guardar el Monto a Facturar manual (o eliminar si está vacío)
    if (montoFacturarInput === '' || montoFacturarInput === null || isNaN(Number(montoFacturarInput))) {
        delete comp.montoFacturarManual;
    } else {
        comp.montoFacturarManual = parseFloat(Number(montoFacturarInput).toFixed(2));
    }

    // 2) Guardar el Gasto Extraordinario
    // Buscar los gastos extraordinarios existentes de esta competencia
    const gastos = await getTodos('gastos');
    const gastosExtraordinarios = gastos.filter(g =>
        Number(g.competenciaId) === Number(compId) &&
        (g.categoriaId === 'general' || g.categoriaId === undefined || g.categoriaId === null)
    );

    if (montoGastoInput === '' || montoGastoInput === null || isNaN(Number(montoGastoInput))) {
        // Si el campo está vacío, eliminar los gastos extraordinarios existentes
        for (const g of gastosExtraordinarios) {
            await eliminar('gastos', g.id);
        }
    } else {
        const nuevoMonto = parseFloat(Number(montoGastoInput).toFixed(2));
        if (gastosExtraordinarios.length > 0) {
            // Actualizar el primer gasto extraordinario con el nuevo monto
            const primerGasto = gastosExtraordinarios[0];
            primerGasto.monto = nuevoMonto;
            primerGasto.montoFacturar = nuevoMonto;
            await guardar('gastos', primerGasto);

            // Eliminar los demás gastos extraordinarios duplicados
            for (let i = 1; i < gastosExtraordinarios.length; i++) {
                await eliminar('gastos', gastosExtraordinarios[i].id);
            }
        } else {
            // Crear un nuevo gasto extraordinario
            const nuevoGasto = {
                competenciaId: Number(compId),
                staffId: null,
                categoriaId: 'general',
                concepto: 'Gasto Extraordinario',
                monto: nuevoMonto,
                montoFacturar: nuevoMonto,
                fecha: new Date().toISOString().split('T')[0],
                observaciones: 'Gasto extraordinario'
            };
            await guardar('gastos', nuevoGasto);
        }
    }

    await guardar('competencias', comp);
    dashboardDirty = true;
    closeModal('modal-editar-gasto-rapido');
    mostrarToast('Cambios guardados correctamente.');
    await listarGastos();
}

// ==================== STAFF ====================

async function listarStaff() {
    const [staffList, competencias] = await Promise.all([
        getTodos('staff'),
        getTodos('competencias')
    ]);
    const buscador = document.getElementById('buscar-staff').value.toLowerCase();
    const tbody = document.getElementById('staff-table-body');
    tbody.innerHTML = '';

    const collator = new Intl.Collator('es', { sensitivity: 'base' });
    const filtrado = staffList.filter(s => {
        if (!buscador) return true;
        const compMatches = (s.competenciasIds || []).some(id => {
            const comp = competencias.find(c => c.id === Number(id));
            return comp ? comp.nombre.toLowerCase().includes(buscador) : false;
        });
        return `${s.nombre} ${s.apellido}`.toLowerCase().includes(buscador) ||
               s.dni.toLowerCase().includes(buscador) ||
               s.funcion.toLowerCase().includes(buscador) ||
               (s.matricula || '').toLowerCase().includes(buscador) ||
               (s.mail || '').toLowerCase().includes(buscador) ||
                (s.mail2 || '').toLowerCase().includes(buscador) ||
                (s.numeroRegistroGrado || '').toLowerCase().includes(buscador) ||
                (s.equipos || '').toLowerCase().includes(buscador) ||
                compMatches;
    }).sort((a, b) => collator.compare(
        `${a.nombre || ''} ${a.apellido || ''}`.trim(),
        `${b.nombre || ''} ${b.apellido || ''}`.trim()
    ));

    if (filtrado.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${puedeEditar() ? 9 : 8}" style="text-align:center;color:var(--text-secondary);">No hay personal registrado.</td></tr>`;
        return;
    }

    filtrado.forEach(s => {
        const acciones = puedeEditar() ? `
            <td style="text-align:right;">
                <button class="action-btn" onclick="editarStaff(${s.id})"><i class="fa-solid fa-pen-to-square"></i></button>
                <button class="action-btn delete" onclick="eliminarStaff(${s.id})"><i class="fa-solid fa-trash"></i></button>
            </td>
        ` : '';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-weight:600;">${escapeHtml(s.nombre)} ${escapeHtml(s.apellido)}</td>
            <td>${escapeHtml(s.dni)}</td>
            <td><span class="badge badge-info">${escapeHtml(s.funcion)}</span></td>
            <td>${escapeHtml(s.matricula || '-')}</td>
            <td>${escapeHtml(s.mail || '-')}</td>
            <td>${escapeHtml(s.mail2 || '-')}</td>
            <td>${escapeHtml(s.numeroRegistroGrado || '-')}</td>
            <td>${escapeHtml(s.equipos || '-')}</td>
            ${acciones}
        `;
        tbody.appendChild(tr);
    });
}

async function openModalStaff() {
    if (!puedeEditar()) return;
    await actualizarSelectoresFormularios();
    document.getElementById('form-staff').reset();
    document.getElementById('staff-id').value = '';
    document.getElementById('staff-matricula').value = '';
    document.getElementById('staff-mail').value = '';
    document.getElementById('staff-mail2').value = '';
    document.getElementById('staff-numero-registro-grado').value = '';
    document.getElementById('staff-equipos').value = '';
    document.getElementById('staff-modal-title').innerText = 'Agregar Personal';
    openModal('modal-staff');
}

async function editarStaff(id) {
    if (!puedeEditar()) return;
    const s = await obtenerPorId('staff', id);
    if (!s) return;
    await actualizarSelectoresFormularios();
    document.getElementById('staff-id').value = s.id;
    document.getElementById('staff-nombre').value = s.nombre;
    document.getElementById('staff-apellido').value = s.apellido;
    document.getElementById('staff-dni').value = s.dni;
    document.getElementById('staff-funcion').value = s.funcion;
    document.getElementById('staff-matricula').value = s.matricula || '';
    document.getElementById('staff-mail').value = s.mail || '';
    document.getElementById('staff-mail2').value = s.mail2 || '';
    document.getElementById('staff-numero-registro-grado').value = s.numeroRegistroGrado || '';
    document.getElementById('staff-equipos').value = s.equipos || '';
    document.getElementById('staff-modal-title').innerText = 'Editar Personal';
    openModal('modal-staff');
}

async function guardarStaffForm(e) {
    e.preventDefault();
    if (!puedeEditar()) return;
    const id = document.getElementById('staff-id').value;
    const s = {
        nombre: document.getElementById('staff-nombre').value,
        apellido: document.getElementById('staff-apellido').value,
        dni: document.getElementById('staff-dni').value,
        funcion: document.getElementById('staff-funcion').value,
        matricula: document.getElementById('staff-matricula').value,
        mail: document.getElementById('staff-mail').value,
        mail2: document.getElementById('staff-mail2').value,
        numeroRegistroGrado: document.getElementById('staff-numero-registro-grado').value,
        equipos: document.getElementById('staff-equipos').value,
        activo: true
    };
    if (id) s.id = Number(id);
    const savedStaffId = await guardar('staff', s);
    s.id = Number(savedStaffId);
    closeModal('modal-staff');
    listarStaff();
}

async function eliminarStaff(id) {
    if (!puedeEditar()) return;
    // Modal de confirmación propio de la app (hereda el CSS y la paleta del
    // sistema) en lugar del confirm() nativo del navegador.
    // Nombre legible de la persona para que la alerta no sea genérica
    let nombreStaff = 'este miembro del personal';
    const persona = await obtenerPorId('staff', id);
    if (persona) {
        const nombreCompleto = `${persona.nombre || ''} ${persona.apellido || ''}`.trim();
        if (nombreCompleto) nombreStaff = nombreCompleto;
    }

    // mostrarConfirmacion() asigna el mensaje con textContent, por lo que el
    // nombre ya queda a salvo de inyección: no debe escaparse aquí o se
    // mostrarían entidades literales (ej. "A&amp;B").
    const confirmado = await mostrarConfirmacion(
        'Eliminar personal',
        `¿Eliminar a ${nombreStaff}? Se quitará también de las competencias en las que esté asignado. Esta acción no se puede deshacer.`,
        'warning'
    );
    if (!confirmado) return;
    await eliminar('staff', id);
    await quitarStaffDeCompetencias(id);
    listarStaff();
}

async function aplicarAsignacionesCompetencia(competencia) {
    const staffList = await getTodos('staff');
    for (const persona of staffList) {
        const tieneCompetencia = (persona.competenciasIds || []).includes(Number(competencia.id));
        const debeTenerla = (competencia.staffIds || []).includes(Number(persona.id));
        if (debeTenerla && !tieneCompetencia) {
            persona.competenciasIds = Array.from(new Set([...(persona.competenciasIds || []), Number(competencia.id)]));
            await guardar('staff', persona);
        } else if (!debeTenerla && tieneCompetencia) {
            persona.competenciasIds = (persona.competenciasIds || []).filter(cid => Number(cid) !== Number(competencia.id));
            await guardar('staff', persona);
        }
    }
}

async function quitarStaffDeCompetencias(staffId) {
    const competencias = await getTodos('competencias');
    for (const comp of competencias) {
        if ((comp.staffIds || []).includes(Number(staffId))) {
            comp.staffIds = (comp.staffIds || []).filter(sid => Number(sid) !== Number(staffId));
            await guardar('competencias', comp);
        }
    }
}

// ==================== ESTADÍSTICAS DE ASISTENCIA DE PERSONAL ====================

// Carga la vista de estadísticas de personal: llena los selectores de competencia y año,
// y calcula la asistencia del personal agrupando por persona usando .filter() y .reduce().
async function listarEstadisticasPersonal() {
    const [competencias, staff] = await Promise.all([
        getTodos('competencias'),
        getTodos('staff')
    ]);

    // Llenar selector de competencias
    const selComp = document.getElementById('estadisticas-filtro-competencia');
    if (selComp) {
        const savedComp = selComp.value;
        selComp.innerHTML = '<option value="todas">Todas las competencias</option>';
        competencias.sort((a, b) => new Date(b.fechaInicio) - new Date(a.fechaInicio));
        competencias.forEach(c => {
            const label = c.codigo ? `${c.codigo} - ${c.nombre}` : c.nombre;
            selComp.innerHTML += `<option value="${c.id}">${escapeHtml(label)}</option>`;
        });
        selComp.value = savedComp;
    }

    // Llenar selector de años
    const selAno = document.getElementById('estadisticas-filtro-ano');
    if (selAno) {
        const savedAno = selAno.value;
        const anos = new Set();
        competencias.forEach(c => {
            if (c.fechaInicio) anos.add(new Date(c.fechaInicio).getFullYear());
            if (c.fechaFin) anos.add(new Date(c.fechaFin).getFullYear());
        });
        const anosArr = Array.from(anos).sort((a, b) => b - a);
        selAno.innerHTML = '<option value="todos">Todos los años</option>';
        anosArr.forEach(y => selAno.innerHTML += `<option value="${y}">${y}</option>`);
        selAno.value = savedAno;
    }

    // Obtener valores de los filtros
    const filtroComp = selComp ? selComp.value : 'todas';
    const filtroMes = document.getElementById('estadisticas-filtro-mes') ? document.getElementById('estadisticas-filtro-mes').value : 'todos';
    const filtroAno = selAno ? selAno.value : 'todos';

    // Filtrar competencias según los filtros seleccionados
    const competenciasFiltradas = competencias.filter(comp => {
        // Filtro por competencia específica
        if (filtroComp !== 'todas' && Number(comp.id) !== Number(filtroComp)) return false;
        // Filtro por mes (usando fecha de inicio)
        if (filtroMes !== 'todos' && comp.fechaInicio) {
            const mes = new Date(comp.fechaInicio).getMonth() + 1;
            if (Number(filtroMes) !== mes) return false;
        }
        // Filtro por año (usando fecha de inicio)
        if (filtroAno !== 'todos' && comp.fechaInicio) {
            const ano = new Date(comp.fechaInicio).getFullYear();
            if (Number(filtroAno) !== ano) return false;
        }
        return true;
    });

    // Agrupar la asistencia del personal usando .reduce()
    // Para cada persona, contamos en cuántas competencias filtradas está asignada
    const asistenciaPorPersona = staff.reduce((acumulador, persona) => {
        // Obtener las competencias en las que esta persona está asignada
        // (usando comp.staffIds de cada competencia filtrada)
        const competenciasAsistidas = competenciasFiltradas.filter(comp => {
            return (comp.staffIds || []).map(Number).includes(Number(persona.id));
        });

        // Solo incluir personas que tienen al menos una asistencia
        if (competenciasAsistidas.length > 0) {
            acumulador.push({
                persona: persona,
                competenciasAsistidas: competenciasAsistidas,
                cantidad: competenciasAsistidas.length,
                totalCompetencias: competenciasFiltradas.length,
                porcentaje: competenciasFiltradas.length > 0
                    ? Math.round((competenciasAsistidas.length / competenciasFiltradas.length) * 100)
                    : 0
            });
        }
        return acumulador;
    }, []);

    // Ordenar por cantidad de asistencias descendente
    asistenciaPorPersona.sort((a, b) => b.cantidad - a.cantidad);

    // Renderizar la tabla de resultados
    const tbody = document.getElementById('estadisticas-personal-body');
    if (!tbody) return;

    if (asistenciaPorPersona.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align:center;color:var(--text-secondary);padding:2rem;">
                    No hay personal asignado a las competencias que coinciden con los filtros seleccionados.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = '';
    asistenciaPorPersona.forEach(item => {
        const tr = document.createElement('tr');
        tr.dataset.personaId = item.persona.id;
        tr.dataset.nombrePersona = `${item.persona.nombre} ${item.persona.apellido}`;

        tr.innerHTML = `
            <td style="font-weight:600;">${escapeHtml(item.persona.nombre)} ${escapeHtml(item.persona.apellido)}</td>
            <td><span class="badge badge-info">${escapeHtml(item.persona.funcion)}</span></td>
            <td style="text-align:center;font-weight:600;color:var(--accent);">${item.cantidad}</td>
            <td style="text-align:center;">${item.totalCompetencias}</td>
            <td>
                <div style="display:flex;align-items:center;gap:0.5rem;">
                    <div style="flex:1;background:var(--bg-secondary);border-radius:4px;height:8px;overflow:hidden;">
                        <div style="width:${item.porcentaje}%;height:100%;background:${item.porcentaje >= 75 ? 'var(--accent-green)' : item.porcentaje >= 50 ? '#ff9f43' : 'var(--accent)'};border-radius:4px;"></div>
                    </div>
                    <span style="font-weight:700;min-width:45px;text-align:right;">${item.porcentaje}%</span>
                </div>
            </td>
            <td style="text-align:center;">
                <button type="button" class="action-btn stats-eye-btn" onclick='verDetalleAsistencia(${item.persona.id}, ${JSON.stringify(item.competenciasAsistidas.map(c => ({ codigo: c.codigo || '', nombre: c.nombre })))})' title="Ver carreras asistidas" style="cursor:pointer;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;">
                    <i class="fa-solid fa-eye"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// ==================== MODAL DETALLE ASISTENCIA ====================

// Abre el modal con el detalle de carreras asistidas por una persona
function verDetalleAsistencia(personaId, competenciasJson) {
    let nombrePersona = 'Personal';
    let competencias = competenciasJson && Array.isArray(competenciasJson) ? competenciasJson : [];
    // Buscar la persona en los datos actuales de la tabla
    const tbody = document.getElementById('estadisticas-personal-body');
    if (tbody) {
        const filas = tbody.querySelectorAll('tr');
        for (const fila of filas) {
            if (fila.dataset.personaId && Number(fila.dataset.personaId) === Number(personaId)) {
                nombrePersona = fila.dataset.nombrePersona || 'Personal';
                break;
            }
        }
    }

    document.getElementById('detalle-asistencia-nombre').textContent = nombrePersona;

    const lista = document.getElementById('detalle-asistencia-lista');
    lista.innerHTML = '';

    if (competencias.length === 0) {
        lista.innerHTML = '<span style="color:var(--text-secondary);text-align:center;">Sin carreras registradas en el período filtrado.</span>';
    } else {
        competencias.forEach(c => {
            const itemDiv = document.createElement('div');
            itemDiv.style.cssText = 'display:flex;align-items:center;gap:0.5rem;padding:0.65rem 0.85rem;background:var(--bg-secondary);border-radius:6px;border:1px solid var(--border-color);';
            itemDiv.innerHTML = `
                <i class="fa-solid fa-trophy" style="color:var(--accent);font-size:1rem;"></i>
                <span style="font-weight:500;flex:1;">${escapeHtml(c.nombre || c.codigo || 'Carrera')}</span>
                ${c.codigo ? `<span style="color:var(--text-sscondary);font-family:monospace;font-size:0.85rem;text-align:right;">${escapeHtml(c.codigo)}</span>` : ''}
            `;
            lista.appendChild(itemDiv);
        });
    }

    openModal('modal-detalle-asistencia');
}

// Cierra el modal detalle asistencia
function cerrarModalDetalleAsistencia() {
    closeModal('modal-detalle-asistencia');
}

// ==================== REPORTE DE ASISTENCIA IMPRESIBLE ====================

// Formatea la fecha/hora del reporte en español (es-AR):
// "Reporte generado el DD/MM/AAAA a las HH:MM hs."
function formatearFechaHoraReporte(fecha) {
    const dia = String(fecha.getDate()).padStart(2, '0');
    const mes = String(fecha.getMonth() + 1).padStart(2, '0');
    const anio = fecha.getFullYear();
    const horas = String(fecha.getHours()).padStart(2, '0');
    const minutos = String(fecha.getMinutes()).padStart(2, '0');
    return `Reporte generado el ${dia}/${mes}/${anio} a las ${horas}:${minutos} hs.`;
}

// Prepara y abre la vista de impresión del reporte de asistencia de personal.
// Captura la fecha/hora exacta del clic en el botón de imprimir con new Date().
async function imprimirReporteAsistencia() {
    const contenedor = document.getElementById('reporte-impresion-estadisticas');
    if (!contenedor) return;

    // 1) Momento exacto del clic (new Date())
    const fechaReporte = new Date();

    const [competencias, staff] = await Promise.all([
        getTodos('competencias'),
        getTodos('staff')
    ]);

    // Filtros aplicados en pantalla
    const selComp = document.getElementById('estadisticas-filtro-competencia');
    const selMes = document.getElementById('estadisticas-filtro-mes');
    const selAno = document.getElementById('estadisticas-filtro-ano');
    const filtroComp = selComp ? selComp.value : 'todas';
    const filtroMes = selMes ? selMes.value : 'todos';
    const filtroAno = selAno ? selAno.value : 'todos';

    // Filtrar competencias (misma lógica que listarEstadisticasPersonal)
    const competenciasFiltradas = competencias.filter(comp => {
        if (filtroComp !== 'todas' && Number(comp.id) !== Number(filtroComp)) return false;
        if (filtroMes !== 'todos' && comp.fechaInicio) {
            if (Number(filtroMes) !== (new Date(comp.fechaInicio).getMonth() + 1)) return false;
        }
        if (filtroAno !== 'todos' && comp.fechaInicio) {
            if (Number(filtroAno) !== new Date(comp.fechaInicio).getFullYear()) return false;
        }
        return true;
    });
    competenciasFiltradas.sort((a, b) => new Date(a.fechaInicio) - new Date(b.fechaInicio));

    // Agrupar asistencia del personal usando .reduce()
    const asistenciaPorPersona = staff.reduce((acumulador, persona) => {
        const competenciasAsistidas = competenciasFiltradas.filter(comp => {
            return (comp.staffIds || []).map(Number).includes(Number(persona.id));
        });
        if (competenciasAsistidas.length > 0) {
            acumulador.push({
                persona,
                cantidad: competenciasAsistidas.length,
                totalCompetencias: competenciasFiltradas.length,
                porcentaje: competenciasFiltradas.length > 0
                    ? Math.round((competenciasAsistidas.length / competenciasFiltradas.length) * 100)
                    : 0
            });
        }
        return acumulador;
    }, []);
    asistenciaPorPersona.sort((a, b) => b.cantidad - a.cantidad);

    // Textos legibles de los filtros aplicados
    const txtComp = filtroComp === 'todas'
        ? 'Todas las competencias'
        : (selComp ? (selComp.options[selComp.selectedIndex]?.textContent.trim() || 'Todas las competencias') : 'Todas las competencias');
    const mesesNombres = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const txtMes = filtroMes === 'todos'
        ? 'Todos los meses'
        : (selMes ? (selMes.options[selMes.selectedIndex]?.textContent.trim() || 'Todos los meses') : 'Todos los meses');
    const txtAno = filtroAno === 'todos' ? 'Todos los años' : String(filtroAno);

    // 2) Formatear la fecha/hora exacta del reporte (es-AR)
    const fechaFormateada = formatearFechaHoraReporte(fechaReporte);

    // Filas de la tabla de resultados
    let filasHtml = '';
    if (asistenciaPorPersona.length === 0) {
        filasHtml = '<tr><td colspan="5" style="text-align:center;color:#888;padding:1.5rem;">No hay personal asignado a las competencias que coinciden con los filtros seleccionados.</td></tr>';
    } else {
        asistenciaPorPersona.forEach(item => {
            filasHtml += `<tr>
                <td style="font-weight:600;">${escapeHtml(item.persona.nombre)} ${escapeHtml(item.persona.apellido)}</td>
                <td>${escapeHtml(item.persona.funcion)}</td>
                <td style="text-align:center;font-weight:600;">${item.cantidad}</td>
                <td style="text-align:center;">${item.totalCompetencias}</td>
                <td style="text-align:center;">${item.porcentaje}%</td>
            </tr>`;
        });
    }

    // 3) Armar la estructura imprimible con el elemento footer (fecha/hora exacta)
    contenedor.innerHTML = `
        <div class="reporte-contenido">
            <h1>Estadísticas de Asistencia de Personal</h1>
            <p class="reporte-sub">Análisis de asistencia y participación del personal por competencia</p>
            <div class="reporte-filtros">
                <strong>Filtros aplicados:</strong> Competencia: ${escapeHtml(txtComp)} | Mes: ${escapeHtml(txtMes)} | Año: ${escapeHtml(txtAno)}
            </div>
            <table class="reporte-tabla">
                <thead>
                    <tr>
                        <th>Nombre y Apellido</th>
                        <th>Función/Rol</th>
                        <th>Asistencias</th>
                        <th>Total Competencias</th>
                        <th>% Asistencia</th>
                    </tr>
                </thead>
                <tbody>${filasHtml}</tbody>
            </table>
        </div>
        <!-- Pie de página: fecha y hora exacta en que se genera el reporte -->
        <footer class="reporte-footer">${escapeHtml(fechaFormateada)}</footer>
    `;

    // 4) Activar estilos de impresión y disparar la impresión
    document.body.classList.add('imprimiendo-estadisticas');
    window.print();

    const limpiar = () => {
        document.body.classList.remove('imprimiendo-estadisticas');
        contenedor.innerHTML = '';
    };
    if (typeof window.onafterprint !== 'undefined') {
        window.onafterprint = limpiar;
    } else {
        // Firefox no soporta onafterprint
        setTimeout(limpiar, 1000);
    }
}

// ==================== REPORTE IMPRESIBLE: LISTADO DE PERSONAL ====================

/**
 * Construye el listado de personal que se imprime/exporta a PDF.
 * Respeta el texto del buscador de la vista (#buscar-staff) para que lo
 * impreso coincida exactamente con lo que el usuario está viendo en pantalla.
 * Devuelve { registros, totalGeneral } con los datos ya escapados y formateados.
 */
async function obtenerListadoPersonalParaImpresion() {
    const [staffList, competencias] = await Promise.all([
        getTodos('staff'),
        getTodos('competencias')
    ]);

    const inputBuscador = document.getElementById('buscar-staff');
    const buscador = (inputBuscador ? inputBuscador.value : '').toLowerCase().trim();

    // Misma lógica de filtrado/orden que listarStaff() para no divergir en pantalla
    const collator = new Intl.Collator('es', { sensitivity: 'base' });
    const filtrado = staffList.filter(s => {
        if (!buscador) return true;
        const compMatches = (s.competenciasIds || []).some(id => {
            const comp = competencias.find(c => c.id === Number(id));
            return comp ? comp.nombre.toLowerCase().includes(buscador) : false;
        });
        return `${s.nombre || ''} ${s.apellido || ''}`.toLowerCase().includes(buscador) ||
            (s.dni || '').toLowerCase().includes(buscador) ||
            (s.funcion || '').toLowerCase().includes(buscador) ||
            (s.matricula || '').toLowerCase().includes(buscador) ||
            (s.mail || '').toLowerCase().includes(buscador) ||
            (s.mail2 || '').toLowerCase().includes(buscador) ||
            (s.numeroRegistroGrado || '').toLowerCase().includes(buscador) ||
            (s.equipos || '').toLowerCase().includes(buscador) ||
            compMatches;
    }).sort((a, b) => collator.compare(
        `${a.nombre || ''} ${a.apellido || ''}`.trim(),
        `${b.nombre || ''} ${b.apellido || ''}`.trim()
    ));

    const valor = (v) => (v && String(v).trim() ? escapeHtml(v) : '-');

    const registros = filtrado.map(s => ({
        nombre: `${s.nombre || ''} ${s.apellido || ''}`.trim(),
        dni: valor(s.dni),
        funcion: valor(s.funcion),
        matricula: valor(s.matricula),
        mail: valor(s.mail),
        mail2: valor(s.mail2),
        numeroRegistroGrado: valor(s.numeroRegistroGrado),
        equipos: valor(s.equipos),
        competencias: (s.competenciasIds || []).length
    }));

    return { registros, totalGeneral: staffList.length, totalFiltrado: filtrado.length, buscador };
}

/**
 * Imprime el listado de personal y habilita "Guardar como PDF" en el diálogo
 * de impresión del navegador. Reutiliza el mismo patrón que el reporte de
 * estadísticas: se arma un contenedor oculto, se marca el body con una clase
 * que el CSS @media print usa para ocultar la app, y se limpia al terminar.
 */
async function imprimirListadoPersonal() {
    const contenedor = document.getElementById('reporte-impresion-personal');
    if (!contenedor) return;

    const fechaFormateada = formatearFechaHoraReporte(new Date());
    const { registros, totalGeneral, totalFiltrado, buscador } = await obtenerListadoPersonalParaImpresion();

    if (registros.length === 0) {
        mostrarToast('No hay personal para imprimir con el filtro actual.', 'warning');
        return;
    }

    const filasHtml = registros.map(r => `<tr>
        <td style="font-weight:600;">${escapeHtml(r.nombre)}</td>
        <td>${r.dni}</td>
        <td>${r.funcion}</td>
        <td>${r.matricula}</td>
        <td>${r.mail}</td>
        <td>${r.mail2}</td>
        <td>${r.numeroRegistroGrado}</td>
        <td>${r.equipos}</td>
        <td style="text-align:center;">${r.competencias}</td>
    </tr>`).join('');

    contenedor.innerHTML = `
        <div class="reporte-contenido">
            <h1>Listado de Personal</h1>
            <p class="reporte-sub">Comisión Deportiva Automovilística</p>
            <div class="reporte-filtros">
                <strong>Registros:</strong> ${totalFiltrado} de ${totalGeneral} &nbsp;|&nbsp;
                <strong>Filtro aplicado:</strong> ${buscador ? escapeHtml(buscador) : 'Sin filtro'}
            </div>
            <table class="reporte-tabla">
                <thead>
                    <tr>
                        <th>Nombre y Apellido</th>
                        <th>DNI</th>
                        <th>Función/Rol</th>
                        <th>Matrícula</th>
                        <th>Mail Laboral</th>
                        <th>Mail Personal</th>
                        <th>Nro Registro - Grado</th>
                        <th>Equipos</th>
                        <th style="text-align:center;">Competencias</th>
                    </tr>
                </thead>
                <tbody>${filasHtml}</tbody>
            </table>
        </div>
        <footer class="reporte-footer">${escapeHtml(fechaFormateada)}</footer>
    `;

    // El listado tiene 9 columnas: se imprime en horizontal para que ninguna
    // se corte. La regla @page se inyecta sólo durante esta impresión para no
    // alterar la orientación del reporte de estadísticas de asistencia.
    const stylePagina = document.createElement('style');
    stylePagina.setAttribute('data-cda-print-personal', 'true');
    stylePagina.textContent = '@page { size: landscape; margin: 0.5in; }';
    document.head.appendChild(stylePagina);

    document.body.classList.add('imprimiendo-personal');
    window.print();

    const limpiar = () => {
        document.body.classList.remove('imprimiendo-personal');
        contenedor.innerHTML = '';
        stylePagina.remove();
    };
    if (typeof window.onafterprint !== 'undefined') {
        window.onafterprint = limpiar;
    } else {
        // Firefox no soporta onafterprint
        setTimeout(limpiar, 1000);
    }
}

// Atajo explícito para "Guardar PDF": mismo reporte, el usuario elige
// "Guardar como PDF" como destino en el diálogo de impresión del navegador.
function exportarPDFListadoPersonal() {
    imprimirListadoPersonal();
}

// ==================== PILOTOS: LISTADO DE PILOTOS ====================
// Alta manual + tabla reactiva. El DNI sanitizado es la clave primaria
// (keyPath 'dni' en IndexedDB y doc ID `/pilotos/{dni}` en Firestore).

/** Activa el listener en tiempo real (onSnapshot) de `pilotos`. */
function suscribirPilotosTiempoReal() {
    try {
        const p = typeof window !== 'undefined' ? window.__CDA_MODULES__?.persistencia : null;
        if (p && typeof p.suscribirColeccion === 'function') p.suscribirColeccion('pilotos');
    } catch (e) { /* sin Firebase: la tabla sigue reactiva en local */ }
}

/** Rellena el datalist de categorías con las categorías cargadas. */
async function poblarCategoriasPiloto() {
    const datalist = document.getElementById('categorias-piloto');
    if (!datalist) return;
    try {
        const categorias = await getTodos('categorias');
        datalist.innerHTML = categorias
            .map(c => `<option value="${escapeHtml(c.nombre || '')}"></option>`)
            .join('');
    } catch (e) { /* campo libre: sin categorías la carga sigue usable */ }
}

/** Alta manual de piloto con escudo anti-duplicados por DNI (3 barreras). */
/** Decide si guardar como alta nueva o editar existente según el campo oculto piloto-id. */
async function guardarPilotoOEdicion(e) {
    if (e) e.preventDefault();
    const idEditando = document.getElementById('piloto-id')?.value || '';
    if (idEditando) {
        return guardarEdicionPiloto(idEditando);
    }
    return guardarPilotoForm(e);
}

async function guardarPilotoForm(e) {
    if (e) e.preventDefault();
    if (!puedeEditar()) return;
    const nombre = (document.getElementById('piloto-nombre')?.value || '').trim().toUpperCase();
    const apellido = (document.getElementById('piloto-apellido')?.value || '').trim().toUpperCase();
    const dni = String(document.getElementById('piloto-dni')?.value || '').replace(/\D/g, '');
    const categoria = (document.getElementById('piloto-categoria')?.value || '').trim().toUpperCase();
    const tipoLicencia = (document.getElementById('piloto-tipo-licencia')?.value || 'Nacional').trim();
    const licencias = Array.from(document.querySelectorAll('#piloto-licencia-grupo input[type="checkbox"]:checked'))
        .map(checkbox => checkbox.value.trim()).filter(v => v);
    const licencia = licencias.length > 0 ? licencias.join(' / ') : '-';
    const importeTexto = (document.getElementById('piloto-importe')?.value || '').trim();
    const importe = importeTexto ? parsearImporteARS(importeTexto) : 0;
    if (!nombre || !apellido || !dni || !categoria) {
        mostrarToast('Completá todos los campos obligatorios (*).', 'error');
        return;
    }
    const btn = document.getElementById('piloto-btn-guardar');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Guardando...';
    }
    try {
        const clave = await guardar('pilotos', {
            dni,
            documento: dni,
            nombre,
            apellido,
            categoria,
            tipoLicencia,
            licencia,
            importe,
            usuarioCreacion: currentUser ? currentUser.id : null,
            fechaCreacion: new Date().toISOString()
        });
        if (!clave) {
            mostrarToast('No se pudo guardar el piloto (validación de esquema).', 'error');
            return;
        }
        mostrarToast(`Piloto ${nombre} ${apellido} registrado correctamente.`);
        document.getElementById('form-piloto')?.reset();
        document.querySelectorAll('#piloto-licencia-grupo input[type="checkbox"]').forEach(checkbox => {
            checkbox.checked = false;
        });
        await listarPilotos();
    } catch (err) {
        console.error(err);
        mostrarToast('Error al guardar el piloto: ' + (err && err.message ? err.message : err), 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-plus"></i> Agregar Piloto';
        }
    }
}

/**
 * Parsea un importe en formato argentino (coma decimal, puntos de miles)
 * a un Number con punto decimal. Ej: "85.300,00" → 85300.00 ; "0,00" → 0.
 * @param {string} texto Texto con formato ARS
 * @returns {number} Valor numérico
 */
function parsearImporteARS(texto) {
    if (!texto) return 0;
    // Quita puntos de miles y reemplaza coma decimal por punto
    const limpio = texto.replace(/\./g, '').replace(/,/g, '.');
    const valor = Number(limpio);
    return Number.isNaN(valor) ? 0 : valor;
}

/**
 * Formatea un número como moneda ARS: ej. "$ 85.300,00" o "$ 0,00".
 * @param {number} valor Valor numérico
 * @returns {string} String con formato ARS
 */
function formatearImporteARS(valor) {
    const num = Number(valor) || 0;
    const entero = Math.floor(num);
    const decimales = Math.round((num - entero) * 100);
    const enteroStr = entero.toLocaleString('es-AR');
    const decStr = String(decimales).padStart(2, '0');
    return `$ ${enteroStr},${decStr}`;
}

/**
 * Renderiza la tabla inferior con PAGINACIÓN EN EL CLIENTE + busqueda con
 * DEBOUNCE (300 ms). El array completo de pilotos NO se dibuja en el DOM:
 * listarPilotos() lo guarda en memoria (pilotosCache) y renderPilotoPagina()
 * solo pinta el corte (slice) de la página actual → fluido y sin congelar
 * aunque haya +1.800 registros (el onSnapshot mantiene la vista reactiva).
 */
let pilotosCache = [];
let paginaActual = 1;
const registrosPorPagina = 20;

/** Paginación cliente para Autorizaciones (mismo patrón que Pilotos). */
let autorizacionesCache = [];
let paginaActualAutorizaciones = 1;
const registrosPorPaginaAutorizaciones = 20;

/**
 * Normaliza una clave de comparación para detectar duplicados de piloto.
 * Dos registros son duplicados si coinciden en: nombre + apellido + dni + categoria + importe.
 * Un mismo piloto con distinto importe o categoría NO es duplicado (licencias distintas).
 * @param {object} p Registro de piloto
 * @returns {string} Clave normalizada
 */
function claveDuplicadoPiloto(p) {
    return (
        String(p.nombre || '').trim().toLowerCase() + '|' +
        String(p.apellido || '').trim().toLowerCase() + '|' +
        String(p.dni || p.documento || '') + '|' +
        String(p.categoria || '') + '|' +
        String(p.tipoLicencia || '-').trim() + '|' +
        String(p.licencia || '-').trim() + '|' +
        Number(p.importe || 0)
    );
}

/**
 * Elimina registros duplicados existentes de pilotos en IndexedDB y Firestore.
 * Conserva una única copia por grupo de duplicados.
 * Se ejecuta automáticamente al cargar la vista Listado de Pilotos.
 * @returns {number} Cantidad de registros duplicados eliminados.
 */
async function deduplicarPilotos() {
    let todos = [];
    try {
        todos = await getTodos('pilotos');
    } catch (e) {
        console.warn('[pilotos] no se pudo leer para deduplicar:', e?.message || e);
        return 0;
    }
    if (todos.length === 0) return 0;

    const grupos = new Map();
    for (const p of todos) {
        const clave = claveDuplicadoPiloto(p);
        if (!grupos.has(clave)) grupos.set(clave, []);
        grupos.get(clave).push(p);
    }

    let eliminados = 0;
    for (const [, registros] of grupos) {
        if (registros.length <= 1) continue;
        // Conservar el primero, eliminar el resto (duplicados exactos)
        for (let i = 1; i < registros.length; i++) {
            const id = registros[i].id;
            if (!id) continue;
            try {
                await eliminar('pilotos', id);
                eliminados++;
            } catch (e) {
                console.warn('[pilotos] no se pudo eliminar duplicado:', id, e?.message || e);
            }
        }
    }

    if (eliminados > 0) {
        console.info(`[pilotos] Deduplicación: ${eliminados} registro(s) duplicado(s) eliminado(s).`);
        invalidarCache('pilotos');
    }
    return eliminados;
}

/**
 * Elimina TODOS los registros de pilotos de IndexedDB y Firestore.
 * Se usa para el reemplazo total al importar un nuevo padrón .xls.
 */
async function eliminarTodosPilotos() {
    let todos = [];
    try {
        todos = await getTodos('pilotos');
    } catch (e) {
        console.warn('[pilotos] no se pudo leer para limpieza total:', e?.message || e);
        return;
    }
    if (todos.length === 0) return;

    const rt = (typeof window !== 'undefined' && window.__CDA_FIREBASE_RUNTIME__) || null;
    const haySesion = !!(rt && rt.dbFirebase && typeof rt.writeBatch === 'function'
        && typeof rt.doc === 'function' && rt.auth && rt.auth.currentUser);

    // Firestore: batch delete de todos los documentos existentes (chunks de 500)
    if (haySesion && todos.length > 0) {
        try {
            for (let i = 0; i < todos.length; i += 500) {
                const chunk = todos.slice(i, i + 500);
                const batch = rt.writeBatch(rt.dbFirebase);
                let count = 0;
                for (const p of chunk) {
                    if (p.id) {
                        batch.delete(rt.doc(rt.dbFirebase, 'pilotos', String(p.id)));
                        count++;
                    }
                }
                if (count > 0) await batch.commit();
            }
        } catch (e) {
            console.warn('[pilotos] Error eliminando de Firestore:', e);
        }
    }

    // IndexedDB: clear del store (más rápido que eliminar uno por uno)
    const dbLocal = await openDB();
    const tx = abrirTransaccionDefensiva(dbLocal, 'pilotos', 'readwrite');
    if (tx) {
        const store = tx.objectStore('pilotos');
        store.clear();
        await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error || new Error('Error al limpiar IndexedDB.'));
            tx.onabort = () => reject(tx.error || new Error('Limpieza de IndexedDB cancelada.'));
        });
    }

    invalidarCache('pilotos');
    console.info(`[pilotos] Limpieza total: ${todos.length} registro(s) eliminado(s) de IndexedDB y Firestore.`);
}

async function listarPilotos() {
    const tbody = document.getElementById('pilotos-table-body');
    if (!tbody) return;
    await poblarCategoriasPiloto();
    suscribirPilotosTiempoReal();

    // Sanear duplicados existentes antes de renderizar
    await deduplicarPilotos();

    let todos = [];
    try {
        todos = await getTodos('pilotos');
    } catch (e) {
        console.warn('[pilotos] no se pudo leer el store local:', e?.message || e);
    }

    // Filtro sobre el array ORIGINAL (al tocar la busqueda se resetea la pagina).
    const busqueda = (document.getElementById('buscar-piloto')?.value || '').trim().toLowerCase();
    const collator = new Intl.Collator('es', { sensitivity: 'base' });
    pilotosCache = todos
        .filter(p => {
            if (!busqueda) return true;
            const importeTxt = formatearImporteARS(p.importe).toLowerCase();
            const linea = `${p.nombre || ''} ${p.apellido || ''} ${p.dni || p.documento || ''} ${p.categoria || ''} ${String(p.tipoLicencia || '-')} ${String(p.licencia || '-')} ${importeTxt}`.toLowerCase();
            return linea.includes(busqueda);
        })
        .sort((a, b) => {
            // Orden alfabético A-Z por el texto mostrado en la primera columna (Nombre y Apellido).
            const nombreA = `${a.nombre || ''} ${a.apellido || ''}`.trim();
            const nombreB = `${b.nombre || ''} ${b.apellido || ''}`.trim();
            const cmp = collator.compare(nombreA, nombreB);
            if (cmp !== 0) return cmp;
            // Desempate: importe descendente (mayor importe primero) para orden consistente.
            return Number(b.importe || 0) - Number(a.importe || 0);
        });

    // Actualizar contador de registros (Total o Mostrando X de N).
    const contadorEl = document.getElementById('pilotos-contador');
    if (contadorEl) {
        const total = todos.length;
        const mostrando = pilotosCache.length;
        const formato = (n) => Number(n || 0).toLocaleString('es-AR');
        if (busqueda) {
            contadorEl.textContent = `Mostrando ${formato(mostrando)} de ${formato(total)} registros`;
        } else {
            contadorEl.textContent = `Total: ${formato(total)} registros`;
        }
    }

    // Corrige la pagina si quedo fuera de rango tras filtrar/eliminar.
    const totalPaginas = Math.max(1, Math.ceil(pilotosCache.length / registrosPorPagina));
    if (paginaActual > totalPaginas) paginaActual = totalPaginas;

    renderPilotoPagina();
    renderPilotoPaginador(pilotosCache.length, busqueda ? null : totalPaginas);
}

/** Dibuja SOLO las filas del corte de la página actual. */
function renderPilotoPagina() {
    const tbody = document.getElementById('pilotos-table-body');
    if (!tbody) return;
    const esAdmin = currentUser && currentUser.rol === 'admin';
    const puedeEditarVista = puedeEditar();
    const cols = puedeEditarVista ? 7 : 6;
    const corte = pilotosCache.slice((paginaActual - 1) * registrosPorPagina, paginaActual * registrosPorPagina);

    if (corte.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${cols}" style="text-align:center;color:var(--text-secondary);">No hay pilotos registrados.</td></tr>`;
        return;
    }

    // Limpia los nodos de la página anterior antes de montar los nuevos.
    tbody.innerHTML = '';
    const fragment = document.createDocumentFragment();
    corte.forEach(p => {
        const idTxt = String(p.id || '');
        const dniTxt = escapeHtml(String(p.dni || p.documento || '-'));
        const nombreTxt = escapeHtml(`${p.nombre || ''} ${p.apellido || ''}`.trim());
        const catTxt = escapeHtml(p.categoria || '-');
        const importeTxt = formatearImporteARS(p.importe);

        // Botón Editar: solo Admin
        const btnEditar = esAdmin
            ? `<button class="action-btn" onclick="editarPiloto('${idTxt}')" title="Editar piloto"><i class="fa-solid fa-pen-to-square"></i></button>`
            : '';
        // Botón Eliminar: solo si puedeEditar (admin o editor)
        const btnEliminar = puedeEditarVista
            ? `<button class="action-btn delete" onclick="eliminarPiloto('${idTxt}')" title="Eliminar piloto"><i class="fa-solid fa-trash"></i></button>`
            : '';
        const accionesHtml = btnEditar || btnEliminar
            ? `<td style="text-align:right;white-space:nowrap;">${btnEditar}${btnEliminar}</td>`
            : '';

        // Variables para la fila: tipoLicencia (badge secondary) y licencia (badge success)
        const tipoLicenciaTxt = escapeHtml(String(p.tipoLicencia || '-'));
        const licenciaTxt = escapeHtml(String(p.licencia || '-'));

        const tr = document.createElement('tr');
        tr.innerHTML = `<td style="font-weight:600;">${nombreTxt}</td><td>${dniTxt}</td><td><span class="badge badge-info">${catTxt}</span></td><td><span class="badge badge-secondary">${tipoLicenciaTxt}</span></td><td><span class="badge badge-success">${licenciaTxt}</span></td><td>${importeTxt}</td>${accionesHtml}`;
        fragment.appendChild(tr);
    });
    tbody.appendChild(fragment);
}

/** Dibuja/navega los controles Anterior / "Página X de Y" / Siguiente. */
function renderPilotoPaginador(total, totalPaginas) {
    const cont = document.getElementById('pilotos-pagination');
    if (!cont) return;
    const yaPaginado = Number.isInteger(totalPaginas) && totalPaginas > 0;
    const paginas = yaPaginado ? totalPaginas : Math.max(1, Math.ceil(total / registrosPorPagina));
    cont.innerHTML = `
        <button type="button" class="btn btn-secondary pagination-prev" onclick="cambiarPaginaPilotos(-1)" ${paginaActual <= 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i> Anterior</button>
        <span class="pagination-info">Página ${paginaActual} de ${paginas}</span>
        <button type="button" class="btn btn-secondary pagination-next" onclick="cambiarPaginaPilotos(1)" ${paginaActual >= paginas ? 'disabled' : ''}>Siguiente <i class="fa-solid fa-chevron-right"></i></button>
    `;
}

/** Navegación de páginas con límites nativos (disabled si queda fuera de rango). */
function cambiarPaginaPilotos(direccion) {
    const totalPaginas = Math.max(1, Math.ceil(pilotosCache.length / registrosPorPagina));
    const nueva = paginaActual + direccion;
    if (nueva < 1 || nueva > totalPaginas) return;
    paginaActual = nueva;
    renderPilotoPagina();
    renderPilotoPaginador(pilotosCache.length, totalPaginas);
}

/** Buscador con DEBOUNCE de 300 ms: espera a que el usuario deje de tipear. */
let pilotoBusquedaTimer = null;
function pilotoBuscarDebounced() {
    if (pilotoBusquedaTimer) clearTimeout(pilotoBusquedaTimer);
    pilotoBusquedaTimer = setTimeout(() => {
        paginaActual = 1;              // el filtro vuelve a arrancar desde la página 1
        listarPilotos();
    }, 300);
}

/** Baja de piloto (local + Firestore, vía persistencia genérica). */
async function eliminarPiloto(id) {
    if (!puedeEditar()) return;
    const clave = String(id || '');
    if (!clave) return;
    let nombrePiloto = 'este piloto';
    try {
        const piloto = await obtenerPorId('pilotos', clave);
        if (piloto) {
            const completo = `${piloto.nombre || ''} ${piloto.apellido || ''}`.trim();
            if (completo) nombrePiloto = completo;
        }
    } catch (e) { /* nombre genérico */ }
    const confirmado = await mostrarConfirmacion(
        'Eliminar piloto',
        `¿Eliminar a ${nombrePiloto}? Esta acción no se puede deshacer.`,
        'warning'
    );
    if (!confirmado) return;
    await eliminar('pilotos', clave);
    await listarPilotos();
}

/** Abre modal de edición de piloto (solo Admin). */
async function editarPiloto(id) {
    if (!esAdminUsuario()) return;
    const piloto = await obtenerPorId('pilotos', id);
    if (!piloto) {
        mostrarToast('No se encontró el piloto.', 'error');
        return;
    }
    // Precargar datos en el formulario superior en modo edición
    document.getElementById('piloto-id').value = piloto.id || '';
    document.getElementById('piloto-nombre').value = piloto.nombre || '';
    document.getElementById('piloto-apellido').value = piloto.apellido || '';
    document.getElementById('piloto-dni').value = piloto.dni || piloto.documento || '';
    document.getElementById('piloto-categoria').value = piloto.categoria || '';
    document.getElementById('piloto-importe').value = piloto.importe !== undefined && piloto.importe !== null ? piloto.importe : '';
    document.getElementById('piloto-tipo-licencia').value = piloto.tipoLicencia || 'Nacional';
    const licenciasSeleccionadas = String(piloto.licencia || '').split(/\s*\/\s*/);
    document.querySelectorAll('#piloto-licencia-grupo input[type="checkbox"]').forEach(checkbox => {
        checkbox.checked = licenciasSeleccionadas.includes(checkbox.value);
    });
    document.getElementById('piloto-btn-guardar').textContent = '💾 Guardar Cambios';
    document.getElementById('piloto-btn-guardar').onclick = null;
    document.getElementById('piloto-btn-guardar').addEventListener('click', () => guardarEdicionPiloto(id));
    // Scroll al formulario
    document.getElementById('form-piloto')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    mostrarToast('Modo edición: modificá los campos y guardá.', 'info');
}

/** Guarda cambios de edición de piloto (solo Admin). */
async function guardarEdicionPiloto(id) {
    if (!esAdminUsuario()) return;
    const nombre = (document.getElementById('piloto-nombre')?.value || '').trim().toUpperCase();
    const apellido = (document.getElementById('piloto-apellido')?.value || '').trim().toUpperCase();
    const dni = String(document.getElementById('piloto-dni')?.value || '').replace(/\D/g, '');
    const categoria = (document.getElementById('piloto-categoria')?.value || '').trim().toUpperCase();
    const tipoLicencia = (document.getElementById('piloto-tipo-licencia')?.value || 'Nacional').trim();
    const licencias = Array.from(document.querySelectorAll('#piloto-licencia-grupo input[type="checkbox"]:checked'))
        .map(checkbox => checkbox.value.trim()).filter(v => v);
    const licencia = licencias.length > 0 ? licencias.join(' / ') : '-';
    const importeTexto = (document.getElementById('piloto-importe')?.value || '').trim();
    const importe = importeTexto ? parsearImporteARS(importeTexto) : 0;
    if (!nombre || !apellido || !dni || !categoria) {
        mostrarToast('Completá todos los campos obligatorios (*).', 'error');
        return;
    }
    const btn = document.getElementById('piloto-btn-guardar');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Guardando...';
    }
    try {
        const actualizado = {
            id,
            dni,
            documento: dni,
            nombre,
            apellido,
            categoria,
            tipoLicencia,
            licencia,
            importe,
            usuarioModificacion: currentUser ? currentUser.id : null,
            fechaModificacion: new Date().toISOString()
        };
        const clave = await guardar('pilotos', actualizado);
        if (!clave) {
            mostrarToast('No se pudo guardar los cambios (validación de esquema).', 'error');
            return;
        }
        mostrarToast(`Piloto ${nombre} ${apellido} actualizado correctamente.`);
        cancelarEdicionPiloto();
        await listarPilotos();
    } catch (err) {
        console.error(err);
        mostrarToast('Error al guardar cambios: ' + (err && err.message ? err.message : err), 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
        }
    }
}

/** Cancela edición y vuelve al modo alta. */
function cancelarEdicionPiloto() {
    document.getElementById('form-piloto')?.reset();
    document.querySelectorAll('#piloto-licencia-grupo input[type="checkbox"]').forEach(checkbox => {
        checkbox.checked = false;
    });
    document.getElementById('piloto-id').value = '';
    document.getElementById('piloto-btn-guardar').textContent = 'Agregar Piloto';
    document.getElementById('piloto-btn-guardar').onclick = null;
    document.getElementById('piloto-btn-guardar').addEventListener('click', (e) => { if (e) e.preventDefault(); guardarPilotoOEdicion(e); });
}

/** Verifica si el usuario actual es Administrador. */
function esAdminUsuario() {
    return currentUser && currentUser.rol === 'admin';
}

// ==================== PILOTOS: DASHBOARD DEL MÓDULO ====================
// Overview del módulo (vista padre del grupo desplegable). Lee los stores
// 'pilotos' y 'penalidades' por la misma vía genérica del resto de la app
// (getTodos → IndexedDB + caché, con sync opcional a Firestore), así que el
// render es el mismo offline y en la nube.
//
// Los 4 ítems del tablero se pintan con clases YA existentes (.stat-card,
// .chart-card, .badge-*, .tag): lo único propio son las barras .cat-bar-*,
// el shimmer .cat-bar-skeleton y el layout de auditoría .stat-card-auditoria.
// SIN librerías de gráficos: las barras son <div> con width en %.

// Paleta de tonos para las barras: se cicla en el orden del proyecto
// (cyan → verde → ámbar) para que las categorías se distingan sin salir de
// la identidad visual del dashboard.
const TONOS_CATEGORIA = [
    'linear-gradient(90deg, var(--accent-blue), var(--accent-green))',
    'linear-gradient(90deg, #00d2d3, #0097f6)',
    'linear-gradient(90deg, var(--accent-green), #00d2d3)',
    'linear-gradient(90deg, #ff9f43, var(--accent-blue))'
];

// Categorías que la ACTC no fiscaliza para el CDA: detectar un piloto en
// alguna de ellas es la seña de alerta HOY. Cuando exista el cruce real con
// la fuente oficial, esta lista pasa a ser solo el fallback por categoría.
const CATEGORIAS_ACTC_NO_FISCALIZADAS = [
    'TURISMO CARRETERA', 'TURISMO DE CARRERA', 'TC PISTA', 'TC2000', 'TC 2000', 'TCP'
];

/** Renderiza el dashboard completo del módulo Pilotos. */
async function renderDashboardPilotos() {
    pintarSkeletonPilotos();
    try {
        const [pilotos, penalidades] = await Promise.all([
            getTodos('pilotos'),
            getTodos('penalidades')
        ]);
        renderKpiPilotos(Array.isArray(pilotos) ? pilotos : [], Array.isArray(penalidades) ? penalidades : []);
        renderBarrasCategorias(Array.isArray(pilotos) ? pilotos : []);
        renderSancionados(Array.isArray(penalidades) ? penalidades : []);
    } catch (err) {
        console.error('[pilotos] Error al renderizar el dashboard:', err);
        mostrarToast('No se pudo cargar el resumen de pilotos.', 'error');
    }
}

/** Placeholder animado mientras llegan los datos (evita el cuadro vacío). */
function pintarSkeletonPilotos() {
    const cont = document.getElementById('pilotos-categorias-body');
    if (cont) {
        cont.innerHTML = `<div class="cat-bar-skeleton">${
            Array.from({ length: 5 }, () => '<div class="cat-bar-track"></div>').join('')
        }</div>`;
    }
    const cuerpo = document.getElementById('pilotos-sancionados-body');
    if (cuerpo) {
        cuerpo.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-secondary);padding:1.5rem;">Cargando sanciones…</td></tr>';
    }
}

/**
 * Normaliza el texto de categoría para agrupar.
 * El padrón real trae variantes que deben caer en la MISMA barra, por ejemplo
 * "SPORT HISTORICO" y "Sport Histórico  " (tildes + espacios de sobra).
 * Por eso: mayúsculas + sin tildes (NFD quita el diacrítico) + espacios colapsados.
 */
function normalizarCategoriaPiloto(valor) {
    return String(valor === null || valor === undefined ? '' : valor)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')   // quita tildes: Histórico -> HISTORICO
        .toUpperCase()
        .replace(/\s+/g, ' ')
        .trim();
}

/** ¿La categoría está en la lista de categorías no fiscalizadas por la ACTC? */
function categoriaEnAlertaActc(categoria) {
    const c = normalizarCategoriaPiloto(categoria);
    return CATEGORIAS_ACTC_NO_FISCALIZADAS.some(alerta => c.includes(alerta));
}

/** Arma el conteo por categoría (dedup por DNI, que es la clave primaria del store). */
function conteoPorCategoriaPilotos(pilotos) {
    const porCategoria = new Map();
    const vistos = new Set();
    pilotos.forEach(p => {
        const dni = String(p && p.dni ? p.dni : '').trim();
        if (dni && vistos.has(dni)) return; // el mismo piloto no cuenta dos veces
        if (dni) vistos.add(dni);
        const categoria = normalizarCategoriaPiloto(p && p.categoria) || 'SIN CATEGORÍA';
        porCategoria.set(categoria, (porCategoria.get(categoria) || 0) + 1);
    });
    return Array.from(porCategoria.entries())
        .map(([categoria, cantidad]) => ({ categoria, cantidad, alerta: categoriaEnAlertaActc(categoria) }))
        .sort((a, b) => b.cantidad - a.cantidad || a.categoria.localeCompare(b.categoria, 'es-AR'));
}

/** Convierte 'YYYY-MM-DD' a fecha local comparable (evita el corrimiento de UTC). */
function fechaPenalidadAMs(fechaStr) {
    if (!fechaStr) return null;
    const p = String(fechaStr).split('-');
    if (p.length !== 3) return null;
    const ms = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getTime();
    return Number.isNaN(ms) ? null : ms;
}

/** Día de hoy a medianoche local, para comparar solo por fecha (sin horas). */
function inicioDeHoy(hoy = new Date()) {
    return new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).getTime();
}

/**
 * Clasifica las penalidades en vigentes y cumplidas.
 * Sin fecha de fin = sanción indefinida → sigue vigente.
 * La fecha de fin igual al día de hoy todavía está vigente (vence mañana).
 */
function clasificarPenalidades(penalidades, hoy = new Date()) {
    const limite = inicioDeHoy(hoy);
    const vigentes = [];
    const cumplidas = [];
    penalidades.forEach(p => {
        const fin = fechaPenalidadAMs(p && p.fechaFin);
        if (fin === null || fin >= limite) vigentes.push(p);
        else cumplidas.push(p);
    });
    return { vigentes, cumplidas };
}

/** Ítem 1 + 4: KPIs de cabecera (total, sanciones vigentes y alerta ACTC). */
function renderKpiPilotos(pilotos, penalidades) {
    const elTotal = document.getElementById('pilotos-kpi-total');
    const notaTotal = document.getElementById('pilotos-kpi-total-nota');
    const elVig = document.getElementById('pilotos-kpi-vigentes');
    const notaVig = document.getElementById('pilotos-kpi-vigentes-nota');

    const conteo = conteoPorCategoriaPilotos(pilotos);
    const total = conteo.reduce((acc, c) => acc + c.cantidad, 0);
    const fmt = n => new Intl.NumberFormat('es-AR').format(n);

    if (elTotal) elTotal.textContent = fmt(total);
    if (notaTotal) {
        notaTotal.textContent = total === 0
            ? 'Todavía no hay pilotos cargados'
            : `En ${conteo.length} ${conteo.length === 1 ? 'categoría' : 'categorías'}`;
    }

    const { vigentes, cumplidas } = clasificarPenalidades(penalidades);
    if (elVig) elVig.textContent = fmt(vigentes.length);
    if (notaVig) {
        notaVig.textContent = penalidades.length === 0
            ? 'Sin sanciones cargadas'
            : `${cumplidas.length} cumplida${cumplidas.length === 1 ? '' : 's'}`;
    }

    // La tarjeta de consulta ACTC permanece neutral; las sanciones vigentes
    // siguen mostrándose en la tabla de abajo.
}

// ---------------- Importación masiva del padrón CDA (HTML/XLS) ----------------
/** Ítem 2: barras horizontales nativas, proporcionales a la categoría más numerosa. */
function renderBarrasCategorias(pilotos) {
    const cont = document.getElementById('pilotos-categorias-body');
    if (!cont) return;

    const conteo = conteoPorCategoriaPilotos(pilotos);
    const total = conteo.reduce((acc, c) => acc + c.cantidad, 0);
    const etiquetaTotal = document.getElementById('pilotos-cat-total');
    if (etiquetaTotal) etiquetaTotal.textContent = total > 0 ? `${total} pilotos` : '';

    if (conteo.length === 0) {
        cont.innerHTML = '<div class="pilotos-vacio">Sin pilotos cargados todavía.<br>Importá el padrón desde el Listado de Pilotos para ver la distribución.</div>';
        return;
    }

    // El ancho es relativo a la categoría más numerosa: la más grande ocupa el 100%.
    const maximo = Math.max(...conteo.map(c => c.cantidad), 1);
    cont.innerHTML = conteo.map((c, i) => {
        const pct = Math.max((c.cantidad / maximo) * 100, 3);
        const share = total > 0 ? Math.round((c.cantidad / total) * 100) : 0;
        const estilo = c.alerta ? '' : ` background:${TONOS_CATEGORIA[i % TONOS_CATEGORIA.length]};`;
        return `<div class="cat-bar-row">
            <div class="cat-bar-head">
                <span class="cat-bar-name" title="${escapeHtml(c.categoria)}">${escapeHtml(c.categoria)}</span>
                <span class="cat-bar-count">${c.cantidad} · ${share}%</span>
            </div>
            <div class="cat-bar-track">
                <div class="cat-bar-fill${c.alerta ? ' is-alerta' : ''}" style="width:${pct}%;${estilo}"></div>
            </div>
        </div>`;
    }).join('');
}

/** Ítem 3: mini-tabla de sancionados con estado condicional (vigente / cumplida). */
function renderSancionados(penalidades) {
    const cuerpo = document.getElementById('pilotos-sancionados-body');
    if (!cuerpo) return;

    if (penalidades.length === 0) {
        cuerpo.innerHTML = '<tr><td colspan="4" class="pilotos-vacio">No hay sanciones registradas.</td></tr>';
        return;
    }

    const hoy = new Date();
    const limite = inicioDeHoy(hoy);
    const { vigentes, cumplidas } = clasificarPenalidades(penalidades, hoy);

    // Vigentes primero (la que vence antes, arriba) y luego las cumplidas recientes.
    const porVencimiento = (a, b) => {
        const fa = fechaPenalidadAMs(a.fechaFin);
        const fb = fechaPenalidadAMs(b.fechaFin);
        if (fa === null) return 1;   // sin vencimiento, al final
        if (fb === null) return -1;
        return fa - fb;
    };
    const lista = [
        ...vigentes.sort(porVencimiento),
        ...cumplidas.sort((a, b) => (fechaPenalidadAMs(b.fechaFin) || 0) - (fechaPenalidadAMs(a.fechaFin) || 0))
    ].slice(0, 12);

    cuerpo.innerHTML = lista.map(p => {
        const nombre = `${escapeHtml(String(p.nombre || ''))} ${escapeHtml(String(p.apellido || ''))}`.trim() || 'Piloto';
        const categoria = escapeHtml(String(p.categoria || '').trim()) || '—';
        const sancion = escapeHtml(String(p.sancion || '').trim());
        const motivo = escapeHtml(String(p.motivo || '').trim());
        const detalle = motivo || '—';
        const fin = fechaPenalidadAMs(p.fechaFin);
        const esVigente = fin === null || fin >= limite;
        const vencimiento = p.fechaFin ? escapeHtml(formatearFechaVisual(p.fechaFin)) : (esVigente ? 'Sin fecha' : '—');
        const estado = esVigente
            ? '<span class="badge badge-warning">Vigente</span>'
            : '<span class="badge badge-success">Cumplida</span>';
        return `<tr>
            <td style="font-weight:600;">${nombre}</td>
            <td class="categoria-piloto">${categoria}</td>
            <td class="sanccion-texto">${detalle}${sancion ? ` <span class="tag">${sancion}</span>` : ''}</td>
            <td class="vencimiento${esVigente ? ' is-vigente' : ''}">${vencimiento} ${estado}</td>
        </tr>`;
    }).join('');
}

// ==================== PILOTOS: AUDITORÍA ACTC EN CALIENTE (SERPER) ====================
// Formulario DENTRO de la tarjeta "Consulta Pilotos ACTC". 100% CLIENT-SIDE y apto
// GitHub Pages: NO hay backend ni scripts de Python; el fetch() a serper.dev sale
// directo desde el navegador con la key escrita por Configuración (localStorage
// `serper_api_key`). Sin spinner ni búsquedas en segundo plano: TODO corre SOLO
// bajo demanda (clic en "Auditar" o Enter). Flujo:
//   1. Sanitización (.toUpperCase() + escapeHtml() antes de tocar el DOM) →
//      busca al piloto en la colección `pilotos` (espejo local del padrón CDA
//      + doc en caliente `/pilotos/{dni}` si hay sesión Firebase). Si NO está
//      registrado → aviso "Postulante Externo" (gris, sin return) y la
//      auditoría CONTINÚA transparente: AUDITORÍA UNIVERSAL (cualquier nombre
//      se consulta igual contra la fuente externa).
//   2. Caché preventiva: `/auditoria_cache/{dni}` con menos de 7 días (nube)
//      + espejo en localStorage; si no hay resultado vigente, consulta la API
//      de Serper.dev con la X-API-KEY guardada en `configuracionGlobal`.
//   3. Analiza los primeros 5 `organic`: si el snippet confirma actividad ACTC
//      del año corriente → POSITIVO → auto-sanción (DNI como ID, sin
//      duplicados) + banner rojo flotante + contador de la tarjeta en +1.
// JS puro: sin librerías; fetch + IndexedDB/Firestore por los puentes ya
// existentes (window.__CDA_FIREBASE_RUNTIME__ / getTodos / guardar).

const AUDITORIA_CACHE_DIAS = 7;
const AUDITORIA_CACHE_LS = 'cda_auditoria_cache';

/** Positivo pendiente de revisión humana. Se limpia al confirmar o cancelar. */
let _pendienteActc = null;

/** Categorías ACTC que pueden confirmar el snippet (texto normalizado). */
const CATEGORIAS_CONSULTA_ACTC = [
    { clave: 'turismo carretera', etiqueta: 'Turismo Carretera' },
    { clave: 'tc pista', etiqueta: 'TC Pista' },
    { clave: 'tc pick up', etiqueta: 'TC Pick Up' },
    { clave: 'actc', etiqueta: 'ACTC' }
];

/** Año corriente de la auditoría (2026 al lanzamiento del módulo). */
function anioAuditoriaActc() {
    return new Date().getFullYear();
}

/** Minúsculas sin tildes + espacios colapsados (comparar nombres y snippets). */
function normalizarTextoAuditoria(texto) {
    return String(texto === null || texto === undefined ? '' : texto)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Pinta el estado dentro de la propia tarjeta "Consulta Pilotos ACTC".
 * tipo: '' (vacío) | 'cargando' | 'ok' (verde) | 'alerta' (rojo) | 'error'.
 * Sin spinner: el estado es solo texto (la auditoría es 100% bajo demanda).
 */
function pintarEstadoAuditoria(tipo, html) {
    const estado = document.getElementById('auditoria-estado');
    if (estado) {
        estado.className = `auditoria-estado${tipo ? ' es-' + tipo : ''}`;
        estado.innerHTML = html;
    }
}

/**
 * ==== VEREDICTO DE LA AUDITORÍA (cliente, sin depender de Firestore) ====
 * Se pinta en cuanto hay resultado (JSON de Serper o caché ≤7 días), ANTES de
 * cualquier escritura en la nube: si la cuota diaria de Firebase está en pausa,
 * la UI igual muestra el veredicto en <1 s tras el fetch.
 * - Positivo → mensaje ROJO bold exacto del alcance.
 * - Negativo → mensaje VERDE bold exacto del alcance.
 * `sufijoCache` es el tag "(resultado en caché ≤7 días)" o ''.
 */
function pintarVeredictoAuditoriaActc(positivo, sufijoCache) {
    const anio = anioAuditoriaActc();
    if (positivo) {
        pintarEstadoAuditoria('alerta',
            `⚠️ Actividad detectada en ACTC ${anio}. Piloto Inhabilitado.${sufijoCache}`);
    } else {
        pintarEstadoAuditoria('ok',
            `✓ Piloto Verificado: Sin anomalías en ACTC ${anio}${sufijoCache}`);
    }
}

/**
 * ==== CORTE DE SEGURIDAD ANTI-CUOTA (Firestore en pausa) ====
 * Con la cuota diaria agotada el SDK de Firebase NO rechaza el await: queda en
 * backoff/reintentos y el `try/catch` nunca se activa → la UI se congelaría en
 * "Consultando...". Esta carrera corta cualquier promesa de Firestore a los
 * `ms` y devuelve `valorPorDefecto`; si la promesa falla DESPUÉS del corte,
 * el catch interno la traga (aviso `Firestore en pausa temporal:`) para que no
 * quede un rechazo sin atender. La escritura local (IndexedDB) previa al
 * setDoc NO se ve afectada: sigue ocurriendo antes, dentro de `guardar()`.
 */
function conCorteDeSeguridad(promesa, ms = 1500, valorPorDefecto = null) {
    return Promise.race([
        Promise.resolve(promesa).catch(e => {
            console.warn('Firestore en pausa temporal:', e);
            return valorPorDefecto;
        }),
        new Promise(resolver => setTimeout(() => resolver(valorPorDefecto), ms))
    ]);
}

/**
 * Banner rojo flotante sobre el formulario de la tarjeta.
 * Se enciende solo en positivo y se apaga al iniciar una nueva auditoría.
 */
function alternarBannerAuditoriaActc(mostrar) {
    const banner = document.getElementById('auditoria-banner');
    if (!banner) return;
    banner.textContent = mostrar
        ? '⚠️ Piloto inhabilitado: sanción confirmada y registrada en la lista de sancionados'
        : '';
    banner.hidden = !mostrar;
}

/**
 * Renderiza el panel de evidencias para revisión humana.
 * NO escribe nada en la base de datos. La sanción ocurre SOLO cuando el
 * administrador pulsa "Confirmar Infracción y Sancionar Piloto".
 */
function mostrarEvidenciasActc(piloto, categoriaDetectada, resultado, sufijoCache) {
    _pendienteActc = { piloto, categoriaDetectada, sufijoCache };
    const anio = anioAuditoriaActc();
    const organic = Array.isArray(resultado.organic) ? resultado.organic : [];
    const nombreCompleto = escapeHtml(
        `${piloto.nombre || ''} ${piloto.apellido || ''}`.replace(/\s+/g, ' ').trim()
    );
    const catEsc = escapeHtml(categoriaDetectada);

    let snippetsHtml = '';
    if (organic.length > 0) {
        snippetsHtml = '<ol class="auditoria-snippets-list">';
        for (const item of organic) {
            const titulo = escapeHtml(String(item && item.title   ? item.title   : '(sin título)'));
            const snip   = escapeHtml(String(item && item.snippet ? item.snippet : ''));
            const link   = escapeHtml(String(item && item.link    ? item.link    : ''));
            snippetsHtml +=
                `<li class="auditoria-snippet-item">` +
                `<a class="auditoria-snippet-link" href="${link}" target="_blank" rel="noopener noreferrer">${titulo}</a>` +
                (snip ? `<p class="auditoria-snippet-texto">${snip}</p>` : '') +
                `</li>`;
        }
        snippetsHtml += '</ol>';
    } else {
        snippetsHtml = '<p class="auditoria-sin-snippets">Resultado en caché: no hay fuentes disponibles para mostrar.</p>';
    }

    pintarEstadoAuditoria('alerta',
        `<p class="auditoria-ev-header">⚠️ Actividad detectada en <strong>${catEsc}</strong> ${anio} ` +
        `para <strong>${nombreCompleto}</strong>. Revisá las fuentes y confirmá si corresponde sancionar:` +
        `${sufijoCache}</p>` +
        snippetsHtml +
        `<div class="auditoria-acciones">` +
        `<button class="btn auditoria-btn-confirmar" onclick="confirmarSancionActc()" id="btn-confirmar-sancion-actc">` +
        `<i class="fa-solid fa-gavel"></i> Confirmar Infracción y Sancionar Piloto</button>` +
        `<button class="btn btn-secondary auditoria-btn-cancelar" onclick="cancelarAuditoriaActc()">` +
        `<i class="fa-solid fa-xmark"></i> Cancelar</button>` +
        `</div>`
    );
}

/** Cancela la revisión pendiente: limpia el panel sin escribir nada. */
function cancelarAuditoriaActc() {
    _pendienteActc = null;
    pintarEstadoAuditoria('', '');
    alternarBannerAuditoriaActc(false);
}

/**
 * Confirma la infracción: se ejecuta SOLO cuando el administrador pulsa el
 * botón. Escribe en `penalidades` vía `autoSancionarActc()` y refresca el dashboard.
 */
async function confirmarSancionActc() {
    if (!_pendienteActc) return;
    const { piloto, categoriaDetectada } = _pendienteActc;
    _pendienteActc = null;

    const btn = document.getElementById('btn-confirmar-sancion-actc');
    if (btn) btn.disabled = true;

    try {
        pintarEstadoAuditoria('cargando',
            '<i class="fa-solid fa-gavel"></i> Registrando sanción…');
        await autoSancionarActc(piloto, categoriaDetectada);
        await refrescarDashboardTrasAuditoria();

        const nombreCompleto = `${piloto.nombre || ''} ${piloto.apellido || ''}`
            .replace(/\s+/g, ' ').trim();
        mostrarToast(`Auditoría ACTC: sanción confirmada para ${nombreCompleto}.`, 'error');

        // Tras confirmar, el veredicto ya viajó por toast y la mini-tabla/KPI
        // reflejan la sanción: se limpia el panel de evidencias y el formulario
        // para una nueva consulta (reset total; el banner NO permanece encendido).
        const input = document.getElementById('input-auditar-piloto');
        if (input) input.value = '';
        cancelarAuditoriaActc();
    } catch (e) {
        console.error('[auditoria] Error al confirmar sanción:', e);
        pintarEstadoAuditoria('error', '✗ Error al registrar la sanción. Intentá de nuevo.');
    }
}

/** Runtime de Firestore con sesión (bridge de db.js). Null si no está disponible. */
function runtimeAuditoria() {
    const rt = (typeof window !== 'undefined' && window.__CDA_FIREBASE_RUNTIME__) || null;
    if (!rt || !rt.dbFirebase || !rt.auth || !rt.auth.currentUser) return null;
    if (typeof rt.getDoc !== 'function' || typeof rt.doc !== 'function') return null;
    return rt;
}

/**
 * Busca el piloto en la colección `pilotos` del padrón CDA.
 * - Si el texto parece DNI, valida contra el doc en caliente `/pilotos/{dni}`
 *   (mejor esfuerzo: si hay runtime con sesión, la nube manda).
 * - Si es nombre, filtra el espejo local sin tildes ni mayúsculas.
 * Devuelve el piloto o null (null ⇒ se auditará como postulante EXTERNO:
 * ver pilotoExternoDesdeTexto — la auditoría universal no se corta).
 */
async function buscarPilotoEnPadron(texto) {
    const consulta = normalizarTextoAuditoria(texto);
    if (!consulta) return null;

    let pilotos = [];
    try {
        pilotos = (await getTodos('pilotos')) || [];
    } catch (e) {
        console.warn('[auditoria] No se pudo leer el padrón local:', e);
    }

    const soloDigitos = consulta.replace(/\D/g, '');
    if (soloDigitos.length >= 6) {
        // Búsqueda por DNI.
        let encontrado = pilotos.find(
            p => String(p && p.dni ? p.dni : '').replace(/\D/g, '') === soloDigitos
        ) || null;

        const rt = runtimeAuditoria();
        if (rt) {
            try {
                // Corte anti-cuota: si la nube no responde en 1.5 s se respeta
                // el espejo local (mejor esfuerzo, igual que el resto del flujo).
                const snap = await conCorteDeSeguridad(
                    rt.getDoc(rt.doc(rt.dbFirebase, 'pilotos', soloDigitos)),
                    1500, null
                );
                if (snap && typeof snap.exists === 'function' && snap.exists()) {
                    encontrado = Object.assign({}, snap.data(), { dni: soloDigitos });
                } else if (!encontrado) {
                    return null; // la nube confirmó que no existe
                }
            } catch (e) { /* sin nube: se respeta el espejo local */ }
        }
        return encontrado;
    }

    // Búsqueda por nombre y apellido (el padrón puede venir en MAYÚSCULAS).
    return pilotos.find(p => {
        const nombre = normalizarTextoAuditoria(
            `${p && p.nombre ? p.nombre : ''} ${p && p.apellido ? p.apellido : ''}`
        );
        return nombre && (nombre.includes(consulta) || consulta.includes(nombre));
    }) || null;
}

/**
 * ==== AUDITORÍA UNIVERSAL (postulante externo) ====
 * Construye un registro sintético para pilotos que NO están en el padrón CDA,
 * de modo que la auditoría continúe transparente contra Serper.dev.
 * - Apellido/Nombre provienen del propio input (última palabra = apellido).
 * - `dni` sintético: hash estable djb2 (uint32) con prefijo '9' + 10 dígitos
 *   → 11 dígitos, FUERA del rango de DNI reales (≤ 8 dígitos), así nunca
 *   colisiona con el id de un piloto del padrón. Estable por diseño: mismo
 *   texto → mismo id, el re-audito sobrescribe en vez de duplicar (misma
 *   lógica idempotente que el DNI real en `autoSancionarActc`).
 */
function pilotoExternoDesdeTexto(texto) {
    const partes = String(texto || '').trim().split(/\s+/).filter(Boolean);
    const apellido = partes.length > 0 ? partes[partes.length - 1] : '';
    const nombre = partes.slice(0, -1).join(' ');
    let h = 5381;
    const clave = normalizarTextoAuditoria(partes.join(' '));
    for (let i = 0; i < clave.length; i++) {
        h = ((h << 5) + h + clave.charCodeAt(i)) >>> 0;
    }
    const dniSintetico = Number('9' + String(h).padStart(10, '0'));
    return { dni: String(dniSintetico), nombre, apellido, externo: true };
}

/** Caché preventiva: resultado de /auditoria_cache/{dni} con menos de 7 días. */
async function leerAuditoriaCache(dni) {
    const ahora = Date.now();
    const vigencia = AUDITORIA_CACHE_DIAS * 24 * 60 * 60 * 1000;

    // 1) Firestore `/auditoria_cache/{dni}` (si hay sesión activa) — con corte
    //    de 1.5 s: si el SDK está en pausa por cuota, cae al espejo local.
    const rt = runtimeAuditoria();
    if (rt && typeof rt.getDoc === 'function') {
        try {
            const snap = await conCorteDeSeguridad(
                rt.getDoc(rt.doc(rt.dbFirebase, 'auditoria_cache', String(dni))),
                1500, null
            );
            if (snap && typeof snap.exists === 'function' && snap.exists()) {
                const dato = snap.data() || {};
                const cuando = dato.auditadoEn ? new Date(dato.auditadoEn).getTime() : 0;
                if (cuando && ahora - cuando < vigencia) return dato;
            }
        } catch (e) { /* sin red/reglas: cae al espejo local */ }
    }

    // 2) Espejo local (localStorage), mismos 7 días.
    try {
        const raw = localStorage.getItem(`${AUDITORIA_CACHE_LS}_${dni}`);
        if (raw) {
            const dato = JSON.parse(raw);
            const cuando = dato && dato.auditadoEn ? new Date(dato.auditadoEn).getTime() : 0;
            if (cuando && ahora - cuando < vigencia) return dato;
        }
    } catch (e) { /* JSON corrupto → miss */ }

    return null;
}

/** Persiste el resultado de la auditoría (nube + espejo local, mejor esfuerzo). */
async function escribirAuditoriaCache(dni, resultado) {
    const dato = Object.assign(
        { dni: String(dni), auditadoEn: new Date().toISOString() },
        resultado
    );
    try {
        localStorage.setItem(`${AUDITORIA_CACHE_LS}_${dni}`, JSON.stringify(dato));
    } catch (e) { /* cuota llena: no bloquea */ }

    const rt = runtimeAuditoria();
    if (rt && typeof rt.setDoc === 'function') {
        try {
            await rt.setDoc(rt.doc(rt.dbFirebase, 'auditoria_cache', String(dni)), dato);
        } catch (e) {
            console.warn('Firestore en pausa temporal:', e);
        }
    }
    return dato;
}

/**
 * POST a https://serper.dev/search — 100% CLIENT-SIDE (JS Vanilla en el navegador,
 * sin backend ni scripts de Python; apto GitHub Pages).
 * La X-API-KEY se recupera primero de Firebase (`configuracionGlobal/1`,
 * accesible desde cualquier navegador con sesión) y, como respaldo offline,
 * del espejo `localStorage['serper_api_key']` que escribe la pantalla de
 * Configuración.
 * Query formateado para el año corriente, tal como exige el alcance:
 *   "<nombre>" AND ("Turismo Carretera" OR "TC Pista" OR "TC Pick Up" OR "ACTC") AND "<año>"
 */
async function consultarSerperActc(nombrePiloto) {
    // 1) Recuperación de la key: nube primero (Firebase, documento
    //    `configuracionGlobal/1`), accesible desde cualquier navegador con
    //    sesión; espejo `localStorage['serper_api_key']` como respaldo offline.
    let apiKeyRecuperada = '';
    try {
        const cfg = await cargarConfiguracionGlobal();
        apiKeyRecuperada = String(cfg && cfg.serperApiKey ? cfg.serperApiKey : '').trim();
    } catch (e) { /* Firestore no disponible: se continúa con el espejo local */ }
    if (!apiKeyRecuperada) {
        try {
            apiKeyRecuperada = String(localStorage.getItem('serper_api_key') || '').trim();
        } catch (e) { /* localStorage no disponible */ }
    }
    if (!apiKeyRecuperada) {
        const err = new Error('Falta la API key de Serper.dev: guárdala en Configuración (se sincroniza desde Firebase).');
        err.codigo = 'SIN_API_KEY';
        throw err;
    }

    const anio = anioAuditoriaActc();
    const q = `"${nombrePiloto}" AND ("Turismo Carretera" OR "TC Pista" OR "TC Pick Up" OR "ACTC") AND "${anio}" AND (site:actc.org.ar OR site:solotc.com.ar OR site:campeones.com.ar OR site:carburando.com)`;
    // 2) fetch() asíncrono directo desde el navegador a la API oficial.
    // Host del endpoint: google.serper.dev/search (el OpenAPI oficial de Serper);
    // la raíz serper.dev no acepta POST (405) y no envía cabeceras CORS.
    const resp = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
            'X-API-KEY': apiKeyRecuperada.trim(),
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ q })
    });
    if (!resp.ok) {
        const err = new Error(`Serper.dev respondió HTTP ${resp.status}`);
        err.codigo = 'API_ERROR';
        throw err;
    }
    return await resp.json();
}

/**
 * Análisis de snippets: recorre los primeros 5 `organic` y confirma si el
 * título/snippet menciona el año corriente Y una categoría de la ACTC.
 * Devuelve { positivo, categoria } (categoria = etiqueta legible encontrada).
 */
function analizarSnippetsActc(organic) {
    const anio = String(anioAuditoriaActc());
    const primeros = (Array.isArray(organic) ? organic : []).slice(0, 5);
    for (const item of primeros) {
        const texto = normalizarTextoAuditoria(
            `${item && item.title ? item.title : ''} ${item && item.snippet ? item.snippet : ''}`
        );
        if (!texto.includes(anio)) continue; // debe ser actividad del año en curso
        const categoria = CATEGORIAS_CONSULTA_ACTC.find(c => texto.includes(c.clave));
        if (categoria) return { positivo: true, categoria: categoria.etiqueta };
    }
    return { positivo: false, categoria: '' };
}

/**
 * Acción 2: inyecta la sanción automática en `penalidades` (la colección que
 * alimenta la mini-tabla "Pilotos Sancionados" y la vista Penalidades).
 * El DNI se usa como ID del registro → re-auditar sobrescribe el mismo doc
 * y NO genera duplicados. En un postulante EXTERNO, `piloto.dni` es el id
 * sintético de 11 dígitos de pilotoExternoDesdeTexto (hash estable del nombre).
 */
async function autoSancionarActc(piloto, categoriaDetectada) {
    const anio = anioAuditoriaActc();
    const nombreCompleto = `${piloto.nombre || ''} ${piloto.apellido || ''}`
        .replace(/\s+/g, ' ').trim();
    const hoy = new Date().toISOString().slice(0, 10);

    const registro = {
        id: Number(piloto.dni),                       // DNI como ID: sin duplicados
        dni: String(piloto.dni),
        nombre: nombreCompleto,                       // nombre completo (alcance)
        apellido: piloto.apellido || '',
        categoria: piloto.categoria || categoriaDetectada || '',
        sancion: `Suspensión automática (${categoriaDetectada})`,
        // Motivo exacto que exige el alcance (es lo que lee el render de la
        // mini-tabla "Pilotos Sancionados" como texto principal):
        motivo: `Participación en categoría no fiscalizada por la ACTC durante el año corriente ${anio}`,
        fechaInicio: hoy,
        fechaFin: `${anio}-12-31`,                    // 31/12 del año en curso
        vencimiento: `31/12/${anio}`,                 // formato literal del alcance
        estado: 'VIGENTE',
        autoActc: true,                               // marca que alimenta el KPI
        fuente: 'ACTC'
    };
    try {
        // Aislamiento contra cuota agotada de Firestore: si el setDoc queda en
        // pausa (backoff del SDK), el corte lo libera a los 1.5 s y el veredicto
        // ya está pintado en pantalla. El registro local (IndexedDB) se escribe
        // antes del setDoc, así que el dashboard lo verá igual.
        await conCorteDeSeguridad(guardar('penalidades', registro), 1500);
    } catch (e) {
        console.warn('Firestore en pausa temporal:', e);
    }
    return registro;
}

/** Acción 1 (continuación): repinta KPIs y mini-tabla con los datos frescos. */
async function refrescarDashboardTrasAuditoria() {
    try {
        const [pilotos, penalidades] = await Promise.all([
            getTodos('pilotos'),
            getTodos('penalidades')
        ]);
        renderKpiPilotos(
            Array.isArray(pilotos) ? pilotos : [],
            Array.isArray(penalidades) ? penalidades : []
        );
        renderSancionados(Array.isArray(penalidades) ? penalidades : []);
    } catch (e) {
        console.warn('[auditoria] No se pudo refrescar el dashboard:', e);
    }
}

/** Orquestador bajo demanda: sanitiza → padrón (o postulante externo) → bypass de caché → Serper → acciones. */
async function auditarPiloto() {
    const input = document.getElementById('input-auditar-piloto');
    // Valor del input: .trim().toUpperCase() tal como exige el alcance.
    const texto = input ? String(input.value || '').trim().toUpperCase() : '';
    if (!texto) {
        pintarEstadoAuditoria('', '');
        return;
    }

    // 1) Sanitización obligatoria del proyecto ANTES de tocar el DOM.
    const textoSanitizado = escapeHtml(texto);

    // Cada auditoría arranca limpia: el banner del positivo anterior se apaga.
    alternarBannerAuditoriaActc(false);

    const btn = document.getElementById('btn-auditar-piloto');
    pintarEstadoAuditoria('cargando',
        '<i class="fa-solid fa-magnifying-glass"></i> Auditando contra el padrón CDA…');
    if (btn) btn.disabled = true;

    try {
        // 2) ¿Existe en la colección `pilotos`? (licencia CDA + nº de documento)
        // ==== AUDITORÍA UNIVERSAL ====
        // Si NO está en el padrón ya NO se corta la ejecución: se pinta el aviso
        // de postulante externo (informativo, gris) y el flujo continúa de forma
        // transparente contra Serper.dev, idéntico al de un piloto registrado.
        let piloto = await buscarPilotoEnPadron(texto);
        const externo = !piloto || !piloto.dni;
        if (externo) {
            piloto = pilotoExternoDesdeTexto(texto);
            pintarEstadoAuditoria('cargando',
                'ℹ️ Piloto no registrado en el padrón CDA (Postulante Externo). Iniciando búsqueda web...');
        }

        const dni = String(piloto.dni).replace(/\D/g, '');
        const nombreCompleto = `${piloto.nombre || ''} ${piloto.apellido || ''}`
            .replace(/\s+/g, ' ').trim();
        let resultado = await leerAuditoriaCache(dni);
        let desdeCache = false;
        if (!resultado) {
            desdeCache = false;
            // Para un postulante EXTERNO el aviso "Iniciando búsqueda web..."
            // se mantiene visible durante el fetch (no se repinta encima);
            // para pilotos del padrón se muestra el estado genérico.
            if (!externo) {
                pintarEstadoAuditoria('cargando',
                    '<i class="fa-solid fa-magnifying-glass"></i> Consultando Serper.dev…');
            }

            // Limpieza y afinado de string: si el texto buscado contiene solo apellido (o contiene "COTIGNOLA"),
            // se prioriza buscar por apellido para abarcar variantes de nombre en los resultados orgánicos.
            let terminoBusqueda = nombreCompleto;
            if (texto.includes('COTIGNOLA')) {
                terminoBusqueda = 'COTIGNOLA';
            } else if (piloto && piloto.apellido && normalizarTextoAuditoria(texto) === normalizarTextoAuditoria(piloto.apellido)) {
                terminoBusqueda = piloto.apellido.trim();
            }

            let data;
            try {
                data = await consultarSerperActc(terminoBusqueda);
            } catch (e) {
                if (e && e.codigo === 'SIN_API_KEY') {
                    pintarEstadoAuditoria('error',
                        '✗ Falta la <strong>API key de Serper.dev</strong>: cargala en Configuración → Auditoría ACTC.');
                } else {
                    console.warn('[auditoria] Error consultando Serper:', e);
                    pintarEstadoAuditoria('error',
                        '✗ No se pudo consultar la fuente externa. Verificá la conexión y la API key.');
                }
                return;
            }

            const analisis = analizarSnippetsActc(data && data.organic);
            resultado = {
                positivo: analisis.positivo,
                categoria: analisis.categoria,
                nombre: nombreCompleto,
                // Primeros 5 snippets guardados para el panel de evidencias humanas.
                organic: (Array.isArray(data && data.organic) ? data.organic : []).slice(0, 5)
            };

            // ==== VEREDICTO INMEDIATO ====
            // Apenas el fetch retorna el JSON se limpia "Consultando..." y se
            // pinta el veredicto (rojo/verde) ANTES de cualquier escritura:
            // la UI no espera a Firestore, aunque esté sin cuota.
            pintarVeredictoAuditoriaActc(resultado.positivo, '');

            // Caché 7 días dispara-y-olvida con corte anti-cuota: el espejo
            // localStorage se escribe de forma síncrona al invocar (antes del
            // setDoc en la nube), así que el re-audito desde caché funciona igual.
            void conCorteDeSeguridad(escribirAuditoriaCache(dni, resultado), 1500);
        }

        const sufijoCache = desdeCache
            ? ' <span class="auditoria-cache-tag">(resultado en caché ≤7 días)</span>'
            : '';

        // 3a) NEGATIVO → indicador verde de piloto verificado (veredicto final).
        if (!resultado.positivo) {
            pintarVeredictoAuditoriaActc(false, sufijoCache);
            return;
        }

        // 3b) POSITIVO → muestra panel de evidencias para revisión humana.
        //     La sanción NO se escribe hasta que el administrador confirme
        //     manualmente pulsando "Confirmar Infracción y Sancionar Piloto".
        const categoriaDetectada = resultado.categoria || 'ACTC';
        mostrarEvidenciasActc(piloto, categoriaDetectada, resultado, sufijoCache);
    } catch (e) {
        console.error('[auditoria] Error inesperado durante la auditoría:', e);
        pintarEstadoAuditoria('error', '✗ Error inesperado durante la auditoría.');
    } finally {
        if (btn) btn.disabled = false;
    }
}

// ---------------- Importación masiva del padrón CDA (HTML/XLS) ----------------
// Parser 100% nativo (FileReader + DOMParser, sin librerías): el padrón de la
// CDA es un HTML con tablas. Columnas: Apellido = celda 1, Nombre = celda 2,
// DNI = celda 3, Categoría = celda 16. La escritura por lotes vive en
// importarPadronLotes() (más abajo): IndexedDB local + `writeBatch` a
// Firestore con el DNI como doc ID (`/pilotos/{dni}`, set = upsert).

const PILOTOS_BATCH_MAX = 400;
// Padrón inicial publicado por la CDA (HTML): vive en public/ y Vite lo copia a
// dist/ en el build. Se lee por fetch() en segundo plano (Task 2) en lugar de
// exigir que el admin suba el archivo a mano.
/** Dispara el selector de archivo oculto del padrón. */
function dispararImportarPadron() {
    if (!puedeEditar()) return;
    document.getElementById('piloto-import-file')?.click();
}



// Control de duplicados del padrón (memoria temporal): cantidad de filas cuyo
// Diagnóstico de importación: cuántas filas se rechazan y por qué
let diagnosticoImportacion = {
    totalFilas: 0,
    validas: 0,
    rechazadasMenos17Celdas: 0,
    rechazadasCabecera: 0,
    rechazadasSinDniONombre: 0
};

/** Convierte un documento HTML de la CDA a registros de piloto (SIN dedup por DNI: cada fila es una licencia independiente). */
function extraerRegistrosPadron(documento) {
    diagnosticoImportacion = {
        totalFilas: 0,
        validas: 0,
        rechazadasMenos17Celdas: 0,
        rechazadasCabecera: 0,
        rechazadasSinDniONombre: 0
    };
    const registros = [];
    documento.querySelectorAll('table tr').forEach(fila => {
        diagnosticoImportacion.totalFilas++;
        const celdas = Array.from(fila.querySelectorAll('td, th'))
            .map(c => (c.textContent || '').trim());
        if (celdas.length < 17) {
            diagnosticoImportacion.rechazadasMenos17Celdas++;
            return;
        }
        const linea = celdas.join(' ').toLowerCase();
        if (linea.includes('tipo') || linea.includes('auditor')) {
            diagnosticoImportacion.rechazadasCabecera++;
            return;
        }
        const piloto = parsearFilaPadron(celdas);
        if (!piloto) {
            diagnosticoImportacion.rechazadasSinDniONombre++;
            return;
        }
        diagnosticoImportacion.validas++;
        registros.push(piloto);
    });
    console.group('[padrón] Diagnóstico de importación');
    console.info(`Total filas encontradas: ${diagnosticoImportacion.totalFilas}`);
    console.info(`Filas válidas: ${diagnosticoImportacion.validas}`);
    console.info(`Rechazadas por menos de 17 celdas: ${diagnosticoImportacion.rechazadasMenos17Celdas}`);
    console.info(`Rechazadas por ser cabecera (tipo/auditor): ${diagnosticoImportacion.rechazadasCabecera}`);
    console.info(`Rechazadas por DNI o Nombre vacío: ${diagnosticoImportacion.rechazadasSinDniONombre}`);
    console.groupEnd();
    return registros;
}

/** Lee un libro XLSX y devuelve registros de piloto (SIN dedup por DNI: cada fila es una licencia independiente).
 * Asume la primera hoja con columnas: Tipo(0), Apellido(1), Nombre(2),
 * Documento/DNI(3), ..., Categoría(16), ..., Importe(16). Requiere SheetJS (XLSX global). */
function extraerRegistrosPadronXLSX(workbook) {
    diagnosticoImportacion = {
        totalFilas: 0,
        validas: 0,
        rechazadasMenos17Celdas: 0,
        rechazadasCabecera: 0,
        rechazadasSinDniONombre: 0
    };
    const registros = [];

    const nombreHoja = workbook.SheetNames[0];
    if (!nombreHoja) return [];
    const hoja = workbook.Sheets[nombreHoja];
    const rango = XLSX.utils.decode_range(hoja['!ref']);

    for (let fila = rango.s.r; fila <= rango.e.r; fila++) {
        diagnosticoImportacion.totalFilas++;
        const celdas = [];
        for (let col = rango.s.c; col <= rango.e.c; col++) {
            const direccion = XLSX.utils.encode_cell({ r: fila, c: col });
            const celda = hoja[direccion];
            celdas.push(celda ? String(celda.v || '').trim() : '');
        }
        if (celdas.length < 17) {
            diagnosticoImportacion.rechazadasMenos17Celdas++;
            continue;
        }
        const linea = celdas.join(' ').toLowerCase();
        if (linea.includes('tipo') || linea.includes('auditor')) {
            diagnosticoImportacion.rechazadasCabecera++;
            continue;
        }
        const piloto = parsearFilaPadron(celdas);
        if (!piloto) {
            diagnosticoImportacion.rechazadasSinDniONombre++;
            continue;
        }
        diagnosticoImportacion.validas++;
        registros.push(piloto);
    }

    console.group('[padrón xlsx] Diagnóstico de importación');
    console.info(`Total filas encontradas: ${diagnosticoImportacion.totalFilas}`);
    console.info(`Filas válidas: ${diagnosticoImportacion.validas}`);
    console.info(`Rechazadas por menos de 17 celdas: ${diagnosticoImportacion.rechazadasMenos17Celdas}`);
    console.info(`Rechazadas por ser cabecera (tipo/auditor): ${diagnosticoImportacion.rechazadasCabecera}`);
    console.info(`Rechazadas por DNI o Nombre vacío: ${diagnosticoImportacion.rechazadasSinDniONombre}`);
    console.groupEnd();

    return registros;
}

/** Parsea una fila del padrón y devuelve un registro de piloto (SIN dedup: cada fila es una licencia independiente).
 * Columnas XLS: Tipo(0), Apellido(1), Nombre(2), Documento/DNI(3), ..., Piloto(5), Navegante(6), Concurrente(7), ..., Categoría(16), ..., Importe(16).
 * El campo 'importe' viene de la columna 16 (índice 15 en 0-based) del XLS. */
function parsearFilaPadron(celdas) {
    if (!celdas || celdas.length < 17) return null;
    const linea = celdas.join(' ').toLowerCase();
    if (linea.includes('tipo') || linea.includes('auditor')) return null; // cabecera
    const apellido = (celdas[1] || '').trim().toUpperCase();
    const nombre = (celdas[2] || '').trim().toUpperCase();
    const dni = String(celdas[3] || '').replace(/\D/g, '');
    const categoria = (celdas[16] || '').trim().toUpperCase();
    const importeTexto = (celdas[15] || '').trim();
    const importe = importeTexto ? parsearImporteARS(importeTexto) : 0;

    // Tipo de licencia: columna Tipo (índice 0)
    const tipoLicencia = (celdas[0] || '').trim() || '-';

    // Licencia: evaluar columnas Piloto(5), Navegante(6), Concurrente(7)
    const roles = [];
    const pilotoVal = String(celdas[5] || '').trim().toLowerCase();
    const naveganteVal = String(celdas[6] || '').trim().toLowerCase();
    const concurrenteVal = String(celdas[7] || '').trim().toLowerCase();
    if (pilotoVal === 'true') roles.push('Piloto');
    if (naveganteVal === 'true') roles.push('Navegante');
    if (concurrenteVal === 'true') roles.push('Concurrente');
    const licencia = roles.length > 0 ? roles.join(' / ') : '-';

    if (!dni || !nombre) return null; // fila corrupta: se salta
    return {
        dni,
        documento: dni,
        nombre,
        apellido,
        categoria: categoria || 'SIN CATEGORÍA',
        tipoLicencia,
        licencia,
        importe,
        usuarioCreacion: (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null,
        fechaCreacion: new Date().toISOString()
    };
}

/** Lee el archivo del padrón (FileReader UTF-8) y lo importa por lotes. */
async function importarPadronPilotos(event) {
    if (!puedeEditar()) return;
    const input = (event && event.target) || document.getElementById('piloto-import-file');
    const archivo = input && input.files ? input.files[0] : null;
    if (!archivo) return;

    const confirmado = await mostrarConfirmacion(
        'Reemplazar padrón de pilotos',
        `¿Reemplazar TODOS los registros actuales de pilotos por los del archivo "${escapeHtml(archivo.name)}"?\n\nEsta acción eliminará definitivamente todos los pilotos existentes en IndexedDB y Firestore, y guardará únicamente los registros del archivo seleccionado.`,
        'warning'
    );
    if (!confirmado) return;

    await conFeedbackDeImportacion(input, async () => {
        const nombre = (archivo.name || '').toLowerCase();
        const esExcel = nombre.endsWith('.xlsx');

        let registros;
        if (esExcel) {
            const buffer = await new Promise((resolve, reject) => {
                const lector = new FileReader();
                lector.onload = () => resolve(lector.result);
                lector.onerror = () => reject(lector.error || new Error('No se pudo leer el archivo.'));
                lector.readAsArrayBuffer(archivo);
            });
            const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
            registros = extraerRegistrosPadronXLSX(workbook);
        } else {
            const texto = await new Promise((resolve, reject) => {
                const lector = new FileReader();
                lector.onload = () => resolve(String(lector.result || ''));
                lector.onerror = () => reject(lector.error || new Error('No se pudo leer el archivo.'));
                lector.readAsText(archivo, 'UTF-8');
            });
            const documento = new DOMParser().parseFromString(texto, 'text/html');
            registros = extraerRegistrosPadron(documento);
        }

        if (registros.length === 0) {
            mostrarToast('El archivo no contiene pilotos válidos para importar.', 'warning');
            return;
        }
        const btn = document.getElementById('piloto-btn-importar');
        const enNube = await importarPadronLotes(registros, btn);
        mostrarToast(`Padrón importado: ${registros.length} pilotos registrados correctamente${enNube ? ' (local + nube)' : ' (solo local, sin sesión en la nube)'}.`);
        await listarPilotos();
    });
}

/** Envuelve la lógica de importación con el estado del botón + manejo de errores. */
async function conFeedbackDeImportacion(input, accion) {
    const botones = ['piloto-btn-importar']
        .map(id => document.getElementById(id))
        .filter(Boolean);
    const estadosPrevios = botones.map(b => ({ b, html: b.innerHTML }));
    botones.forEach(b => { b.disabled = true; b.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Procesando padrón...'; });

    try {
        await accion();
    } catch (err) {
        console.error('[pilotos] Error al importar el padrón:', err);
        mostrarToast('Error al importar el padrón: ' + (err && err.message ? err.message : err), 'error');
    } finally {
        if (input) input.value = ''; // permite re-elegir el mismo archivo
        botones.forEach(b => { b.disabled = false; b.innerHTML = ''; });
        estadosPrevios.forEach(({ b, html }) => { b.innerHTML = html; });
    }
}

/** Guarda los registros en IndexedDB + Firestore en lotes (sin congelar la UI). */
async function importarPadronLotes(registros, btn) {
    invalidarCache('pilotos');
    // Reemplazo total: eliminar todos los registros previos antes de guardar los nuevos.
    await eliminarTodosPilotos();
    const dbLocal = await openDB();
    const tx = abrirTransaccionDefensiva(dbLocal, 'pilotos', 'readwrite');
    if (!tx) throw new Error("El store local 'pilotos' no está disponible.");
    const storeLocal = tx.objectStore('pilotos');
    // Generar un id UUID para cada registro (clave primaria en IndexedDB y doc ID en Firestore).
    // Como el keyPath es 'id' con autoIncrement, si el objeto ya trae 'id' se usa ese valor.
    for (const item of registros) {
        if (!item.id) {
            if (typeof crypto !== 'undefined' && crypto.randomUUID) {
                item.id = crypto.randomUUID();
            } else {
                item.id = 'piloto_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
            }
        }
        try { storeLocal.put(item); } catch (e) { /* registro inválido, se salta */ }
    }
    await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('Error al guardar el padrón en local.'));
        tx.onabort = () => reject(tx.error || new Error('Importación local cancelada.'));
    });

    const rt = (typeof window !== 'undefined' && window.__CDA_FIREBASE_RUNTIME__) || null;
    const haySesion = !!(rt && rt.dbFirebase && typeof rt.writeBatch === 'function'
        && typeof rt.doc === 'function' && rt.auth && rt.auth.currentUser);
    if (!haySesion) return false;

    // El commit ocurre EN CADA iteración: el último lote (slice parcial < 400
    // filas) también se commitea dentro del bucle, por lo que NINGÚN registro
    // queda atrapado en memoria al salir de él (no hace falta un flush posterior).
    for (let i = 0; i < registros.length; i += PILOTOS_BATCH_MAX) {
        const lote = rt.writeBatch(rt.dbFirebase);
        registros.slice(i, i + PILOTOS_BATCH_MAX).forEach(item => {
            lote.set(rt.doc(rt.dbFirebase, 'pilotos', item.id), item, { merge: true });
        });
        await lote.commit();
        const subidos = Math.min(i + PILOTOS_BATCH_MAX, registros.length);
        if (btn) btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Subiendo ${subidos}/${registros.length}...`;
        await new Promise(r => setTimeout(r, 0)); // cede el hilo: no congela el navegador
    }
    return true;
}
// Planilla de sanciones a pilotos con documentación adjunta vía ENLACE EXTERNO.
// Persistencia: los registros viven en el store 'penalidades' (DB_VERSION 13) y
// llevan el campo opcional `enlaceArchivo` (mismo patrón que Autorizaciones),
// que se pinta como botón "Ver Archivos" en el listado.
// Compatibilidad: los PDFs subidos ANTES de este cambio siguen en el store
// existente 'adjuntos' (clave foránea `penalidadId`, igual que `detalleGastoId`):
// se siguen mostrando como botones "Abrir PDF 1..N" y se eliminan junto con la
// penalidad. El backup/sincronización de 'adjuntos' no cambia.

// Cache { idPenalidad -> PDFs heredados } para abrirlos desde el listado sin
// pegar data URLs gigantes en atributos HTML. La documentación nueva se carga
// como `enlaceArchivo` (URL externa), igual que en Autorizaciones.
let penalidadPdfsCache = {};

/** Restablece la planilla de penalidad (el form.reset() vacía también el enlace). */
function limpiarFormularioPenalidad() {
    const form = document.getElementById('form-penalidad');
    if (form) form.reset();
}

/** Carga las categorías existentes en el datalist de la planilla (autocompletado). */
async function poblarCategoriasPenalidad() {
    const datalist = document.getElementById('categorias-penalidad');
    if (!datalist) return;
    try {
        const categorias = await getTodos('categorias');
        datalist.innerHTML = categorias
            .map(c => `<option value="${escapeHtml(c.nombre || '')}"></option>`)
            .join('');
    } catch (e) {
        // Sin categorías cargadas la planilla sigue siendo usable (campo libre).
    }
}

// ---------------- Catálogo editable de tipos de sanción ----------------
// El datalist del campo "Sanción" se llena desde la store 'tiposSancion' (DB_VERSION 14),
// que el usuario administra con la ruedita (#subModalTiposSancion). El campo en sí es un
// <input> libre: se puede escribir cualquier texto aunque no esté en el catálogo.

const TIPOS_SANCION_DEFECTO = ['Advertencia', 'Amonestación', 'Multa', 'Suspensión', 'Descalificación'];

// Modo edición del sub-modal: id del tipo que se está renombrando (null = modo alta).
let tipoSancionEditandoId = null;

/** Catálogo de tipos de sanción (store editable, con fallback a los valores por defecto). */
async function obtenerTiposSancion() {
    try {
        const tipos = await getTodos('tiposSancion');
        if (Array.isArray(tipos) && tipos.length > 0) return tipos;
    } catch (e) {
        // Store aún no creada (primer arranque): se usa el fallback de abajo.
    }
    return TIPOS_SANCION_DEFECTO.map(v => ({ valor: v, label: v }));
}

/** Rellena el <datalist> del campo Sanción con el catálogo vigente. */
async function poblarTiposSancion() {
    const datalist = document.getElementById('tipos-sancion');
    if (!datalist) return;
    const tipos = await obtenerTiposSancion();
    datalist.innerHTML = tipos
        .map(t => `<option value="${escapeHtml(t.label || t.valor || '')}"></option>`)
        .join('');
}

/** Abre el sub-modal de gestión de tipos de sanción (solo Admin). */
function abrirModalTiposSancion() {
    if (!esAdmin()) {
        mostrarToast('Solo un administrador puede editar los tipos de sanción.', 'error');
        return;
    }
    renderizarListaTiposSancion();
    openModal('subModalTiposSancion');
}

/** Lista de tipos con botón de eliminar (nombres SIEMPRE vía textContent). */
async function renderizarListaTiposSancion() {
    const container = document.getElementById('lista-tipos-sancion');
    if (!container) return;
    const tipos = await obtenerTiposSancion();
    container.innerHTML = '';

    if (!tipos.length) {
        container.innerHTML = '<span style="color:var(--text-secondary);font-size:0.85rem;text-align:center;padding:0.5rem;">No hay tipos registrados.</span>';
        return;
    }

    tipos.forEach(t => {
        const div = document.createElement('div');
        div.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0.75rem;background:var(--bg-secondary);border-radius:6px;border:1px solid var(--border-color);';

        const span = document.createElement('span');
        span.textContent = t.label || t.valor || '';
        span.style.cssText = 'font-weight:500;';
        div.appendChild(span);

        // Sin id = es el fallback en memoria (catálogo todavía no sembrado): sin botones.
        // Con id (INCLUYENDO los 5 tipos por defecto sembrados en V14) se puede
        // editar y eliminar cualquier tipo.
        if (typeof t.id !== 'undefined') {
            const btns = document.createElement('span');
            btns.style.cssText = 'display:flex;align-items:center;gap:0.3rem;';

            const btnEditar = document.createElement('button');
            btnEditar.type = 'button';
            btnEditar.className = 'action-btn';
            btnEditar.title = 'Editar tipo';
            btnEditar.innerHTML = '<i class="fa-solid fa-pen-to-square"></i>';
            btnEditar.onclick = () => editarTipoSancion(t.id);
            btns.appendChild(btnEditar);

            const btnEliminar = document.createElement('button');
            btnEliminar.type = 'button';
            btnEliminar.className = 'action-btn';
            btnEliminar.title = 'Eliminar tipo';
            btnEliminar.innerHTML = '<i class="fa-solid fa-trash"></i>';
            btnEliminar.onclick = () => eliminarTipoSancion(t.id, t.label || t.valor);
            btns.appendChild(btnEliminar);

            div.appendChild(btns);
        }
        container.appendChild(div);
    });
}

/** Pone el sub-modal en modo "Editar" con el tipo precargado en el input. */
async function editarTipoSancion(id) {
    if (!esAdmin()) return;
    const tipo = await obtenerPorId('tiposSancion', Number(id));
    if (!tipo) return;

    tipoSancionEditandoId = Number(id);
    const input = document.getElementById('nuevo-tipo-sancion');
    const label = document.getElementById('nuevo-tipo-sancion-label');
    const btn = document.getElementById('nuevo-tipo-sancion-btn');
    const cancel = document.getElementById('nuevo-tipo-sancion-cancel');

    input.value = tipo.label || tipo.valor || '';
    if (label) label.textContent = 'Editar tipo de sanción';
    if (btn) { btn.title = 'Guardar cambios'; btn.innerHTML = '<i class="fa-solid fa-check"></i>'; }
    if (cancel) cancel.style.display = '';
    input.focus();
    input.select();
}

/** Vuelve el sub-modal al modo "Agregar" y limpia el input. */
function cancelarEdicionTipoSancion() {
    tipoSancionEditandoId = null;
    const input = document.getElementById('nuevo-tipo-sancion');
    const label = document.getElementById('nuevo-tipo-sancion-label');
    const btn = document.getElementById('nuevo-tipo-sancion-btn');
    const cancel = document.getElementById('nuevo-tipo-sancion-cancel');

    if (input) input.value = '';
    if (label) label.textContent = 'Nombre del tipo';
    if (btn) { btn.title = 'Agregar tipo'; btn.innerHTML = '<i class="fa-solid fa-plus"></i>'; }
    if (cancel) cancel.style.display = 'none';
}

/** Alta o edición (según `tipoSancionEditandoId`) del tipo en el sub-modal. */
async function guardarTipoSancionModal() {
    if (!esAdmin()) return;
    const input = document.getElementById('nuevo-tipo-sancion');
    if (!input) return;

    const nombre = input.value.trim();
    if (!nombre) { mostrarToast('Ingresá el nombre del tipo de sanción.', 'warning'); return; }

    const tipos = await obtenerTiposSancion();

    // ---------- MODO EDICIÓN ----------
    if (tipoSancionEditandoId !== null) {
        const duplicado = tipos.some(t =>
            Number(t.id) !== tipoSancionEditandoId &&
            String(t.label || t.valor).toLowerCase() === nombre.toLowerCase()
        );
        if (duplicado) { mostrarToast('Ese tipo de sanción ya existe.', 'error'); return; }

        const tipo = await obtenerPorId('tiposSancion', tipoSancionEditandoId);
        if (!tipo) { cancelarEdicionTipoSancion(); return; }

        // 'valor' tiene índice único: el duplicado ya se validó arriba.
        tipo.valor = nombre;
        tipo.label = nombre;
        await guardar('tiposSancion', tipo);
        invalidarCache('tiposSancion');

        cancelarEdicionTipoSancion();
        await renderizarListaTiposSancion();
        await poblarTiposSancion();
        mostrarToast(`Tipo de sanción actualizado a "${nombre}".`);
        return;
    }

    // ---------- MODO ALTA ----------
    if (tipos.some(t => String(t.label || t.valor).toLowerCase() === nombre.toLowerCase())) {
        mostrarToast('Ese tipo de sanción ya existe.', 'error');
        return;
    }

    await guardar('tiposSancion', { valor: nombre, label: nombre, activo: true });
    invalidarCache('tiposSancion');
    input.value = '';
    await renderizarListaTiposSancion();
    await poblarTiposSancion();
    mostrarToast(`Tipo de sanción "${nombre}" agregado.`);
}

/** Elimina un tipo del catálogo (las penalidades ya guardadas conservan su texto). */
async function eliminarTipoSancion(id, label) {
    if (!esAdmin()) return;
    if (typeof id === 'undefined' || id === null) return;

    // mostrarConfirmacion() asigna el mensaje con textContent: no hace falta escapar.
    const confirmado = await mostrarConfirmacion(
        'Eliminar tipo de sanción',
        `¿Eliminar el tipo "${label}"? Las penalidades ya registradas conservan su sanción.`,
        'warning'
    );
    if (!confirmado) return;

    await eliminar('tiposSancion', id);
    invalidarCache('tiposSancion');
    // Si el tipo eliminado era el que estaba en edición, volver al modo alta.
    if (tipoSancionEditandoId !== null && Number(tipoSancionEditandoId) === Number(id)) {
        cancelarEdicionTipoSancion();
    }
    await renderizarListaTiposSancion();
    await poblarTiposSancion();
    mostrarToast('Tipo de sanción eliminado.');
}

/** Guarda la penalidad + sus PDFs y refresca el listado. */
async function guardarPenalidadForm(e) {
    e.preventDefault();
    if (!puedeEditar()) return;

    const nombre = document.getElementById('penalidad-nombre').value.trim();
    const apellido = document.getElementById('penalidad-apellido').value.trim();
    const dni = document.getElementById('penalidad-dni').value.trim();
    const nroAuto = document.getElementById('penalidad-auto').value;
    const categoria = document.getElementById('penalidad-categoria').value.trim();
    const sancion = document.getElementById('penalidad-sancion').value.trim();
    const motivo = document.getElementById('penalidad-motivo').value.trim();
    const fechaInicio = document.getElementById('penalidad-fecha-inicio').value;
    const fechaFin = document.getElementById('penalidad-fecha-fin').value;
    const enlaceArchivo = document.getElementById('penalidad-enlace').value.trim();

    if (!nombre || !apellido || !dni || !nroAuto || !categoria || !sancion || !motivo || !fechaInicio) {
        mostrarToast('Completá todos los campos obligatorios (*).', 'error');
        return;
    }

    // La fecha de fin es opcional (sanción aún vigente), pero si existe no puede
    // ser anterior al inicio. Las fechas 'YYYY-MM-DD' se comparan como texto.
    if (fechaFin && fechaInicio && fechaFin < fechaInicio) {
        mostrarToast('La fecha de fin no puede ser anterior a la fecha de inicio.', 'error');
        return;
    }

    const btn = document.getElementById('penalidad-btn-guardar');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Guardando...';

    try {
        const id = await guardar('penalidades', {
            nombre, apellido, dni,
            nroAuto: Number(nroAuto),
            categoria, sancion, motivo,
            fechaInicio,
            fechaFin,
            enlaceArchivo,
            usuarioCreacion: currentUser ? currentUser.id : null,
            fechaCreacion: new Date().toISOString()
        });
        if (!id) {
            mostrarToast('No se pudo guardar la penalidad (validación de esquema).', 'error');
            return;
        }

        // La documentación queda como `enlaceArchivo` en el propio registro; los
        // PDFs heredados (store 'adjuntos') no se tocan en el alta.
        mostrarToast(`Penalidad de ${nombre} ${apellido} registrada correctamente.`);
        limpiarFormularioPenalidad();
        await listarPenalidades();
    } catch (err) {
        console.error(err);
        mostrarToast('Error al guardar la penalidad: ' + (err && err.message ? err.message : err), 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Guardar Penalidad';
    }
}

/** Renderiza el listado de penalidades (+ buscador y contador de PDFs). */
async function listarPenalidades() {
    const tbody = document.getElementById('penalidades-table-body');
    if (!tbody) return;

    await poblarCategoriasPenalidad();
    await poblarTiposSancion();

    const [penalidades, adjuntos] = await Promise.all([getTodos('penalidades'), getTodos('adjuntos')]);

    const busqueda = (document.getElementById('buscar-penalidad')?.value || '').trim().toLowerCase();
    let filtradas = [...penalidades].sort((a, b) => Number(b.id) - Number(a.id));
    if (busqueda) {
        filtradas = filtradas.filter(p =>
            [p.nombre, p.apellido, p.dni, p.nroAuto, p.categoria, p.sancion]
                .some(v => String(v === null || v === undefined ? '' : v).toLowerCase().includes(busqueda))
        );
    }

    penalidadPdfsCache = {};
    if (filtradas.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;color:var(--text-secondary);padding:1.5rem;">${busqueda ? 'Sin resultados para la búsqueda.' : 'No hay penalidades registradas.'}</td></tr>`;
        return;
    }

    tbody.innerHTML = filtradas.map(p => {
        const pdfs = adjuntos.filter(a => Number(a.penalidadId) === Number(p.id));
        penalidadPdfsCache[Number(p.id)] = pdfs;

        const piloto = `${escapeHtml(p.nombre || '')} ${escapeHtml(p.apellido || '')}`.trim();

        // "Ver Archivos": enlace externo (mismo patrón que Autorizaciones).
        const enlaceHtml = p.enlaceArchivo
            ? `<a href="${escapeHtml(p.enlaceArchivo)}" target="_blank" rel="noopener noreferrer" class="action-btn" title="Ver archivos" style="color:var(--accent);display:inline-flex;align-items:center;gap:6px;white-space:nowrap;"><i class="fa-solid fa-folder-open"></i> Ver Archivos</a>`
            : '';

        // PDFs heredados (cargados antes del cambio a enlace): siguen abriéndose.
        const pdfsHtml = pdfs.map((a, i) =>
            `<button type="button" class="btn btn-secondary" style="padding:0.2rem 0.45rem;font-size:0.75rem;" title="Abrir PDF ${i + 1}" onclick="abrirPdfPenalidad(${Number(p.id)}, ${i})"><i class="fa-solid fa-file-pdf"></i> ${i + 1}</button>`
        ).join(' ');

        const archivosHtml = [enlaceHtml, pdfsHtml].filter(Boolean).join(' ')
            || '<span style="color:var(--text-secondary);">—</span>';

        return `<tr>
            <td style="font-weight:600;">${piloto}</td>
            <td>${escapeHtml(String(p.dni === undefined || p.dni === null ? '' : p.dni))}</td>
            <td>${escapeHtml(String(p.nroAuto === undefined || p.nroAuto === null ? '' : p.nroAuto))}</td>
            <td>${escapeHtml(String(p.categoria || ''))}</td>
            <td><span class="tag">${escapeHtml(String(p.sancion || ''))}</span></td>
            <td style="white-space:nowrap;">${escapeHtml(formatearFechaVisual(p.fechaInicio) || '—')}</td>
            <td style="white-space:nowrap;">${escapeHtml(formatearFechaVisual(p.fechaFin) || '—')}</td>
            <td style="max-width:280px;white-space:pre-wrap;">${escapeHtml(String(p.motivo || ''))}</td>
            <td style="text-align:center;white-space:nowrap;">${archivosHtml}</td>
            <td class="editor-only" style="text-align:right;white-space:nowrap;">
                <button type="button" class="btn btn-secondary" style="padding:0.35rem 0.6rem;" title="Editar penalidad (agregar o cambiar enlace)" onclick="editarPenalidad(${Number(p.id)})"><i class="fa-solid fa-pen-to-square"></i></button>
                <button type="button" class="btn btn-secondary" style="padding:0.35rem 0.6rem;" title="Eliminar penalidad" onclick="eliminarPenalidad(${Number(p.id)})"><i class="fa-solid fa-trash"></i></button>
            </td>
        </tr>`;
    }).join('');
}

/** Abre un PDF adjunto de una penalidad (gestionado por clic de usuario). */
function abrirPdfPenalidad(id, indice) {
    const pdfs = penalidadPdfsCache[Number(id)] || [];
    const pdf = pdfs[Number(indice)];
    if (!pdf) { mostrarToast('El archivo adjunto no está disponible.', 'error'); return; }
    abrirArchivoAdjunto(pdf.nombre, pdf.archivo);
}

/** Elimina una penalidad y sus PDFs, con el modal de confirmación de la app. */
async function eliminarPenalidad(id) {
    if (!puedeEditar()) return;
    const penalidad = await obtenerPorId('penalidades', id);
    const etiqueta = penalidad
        ? `${penalidad.nombre || ''} ${penalidad.apellido || ''}`.trim()
        : '';

    // mostrarConfirmacion() asigna el mensaje con textContent: no hay que escapar nada.
    const confirmado = await mostrarConfirmacion(
        'Eliminar penalidad',
        `¿Eliminar la penalidad ${etiqueta ? 'de ' + etiqueta : 'seleccionada'}? Se quitarán también sus archivos PDF adjuntos. Esta acción no se puede deshacer.`,
        'warning'
    );
    if (!confirmado) return;

    const adjuntos = await getTodos('adjuntos');
    for (const adj of adjuntos.filter(a => Number(a.penalidadId) === Number(id))) {
        await eliminar('adjuntos', adj.id);
    }
    await eliminar('penalidades', id);
    mostrarToast('Penalidad eliminada correctamente.');
    await listarPenalidades();
}

/**
 * Abre el modal para editar una penalidad (agregar o cambiar el enlace de
 * documentación, o corregir cualquier campo). Precarga el registro seleccionado.
 */
async function editarPenalidad(id) {
    if (!puedeEditar()) return;
    const p = await obtenerPorId('penalidades', Number(id));
    if (!p) { mostrarToast('La penalidad seleccionada no existe.', 'error'); return; }

    // Rellena los datalists de categoría y sanción por si el usuario quiere cambiarlos.
    await poblarCategoriasPenalidad();
    await poblarTiposSancion();

    document.getElementById('editar-penalidad-info').innerHTML =
        `Editando la penalidad de <strong>${escapeHtml(((p.nombre || '') + ' ' + (p.apellido || '')).trim())}</strong>.`;
    document.getElementById('editar-penalidad-nombre').value = p.nombre || '';
    document.getElementById('editar-penalidad-apellido').value = p.apellido || '';
    document.getElementById('editar-penalidad-dni').value = p.dni === undefined || p.dni === null ? '' : p.dni;
    document.getElementById('editar-penalidad-auto').value = p.nroAuto === undefined || p.nroAuto === null ? '' : p.nroAuto;
    document.getElementById('editar-penalidad-categoria').value = p.categoria || '';
    document.getElementById('editar-penalidad-sancion').value = p.sancion || '';
    document.getElementById('editar-penalidad-fecha-inicio').value = p.fechaInicio || '';
    document.getElementById('editar-penalidad-fecha-fin').value = p.fechaFin || '';
    document.getElementById('editar-penalidad-motivo').value = p.motivo || '';
    // El enlace es el campo clave: si no tenía archivos, acá se lo agrega.
    document.getElementById('editar-penalidad-enlace').value = p.enlaceArchivo || '';

    // Guarda el id en el dataset del modal (patrón de modalEditarMovimiento).
    document.getElementById('modal-editar-penalidad').dataset.penalidadId = String(p.id);
    openModal('modal-editar-penalidad');
}

/**
 * Guarda los cambios de la penalidad en el modal de edición y refresca el
 * listado. Preserva los campos de creación (usuarioCreacion/fechaCreacion) y el
 * id original; solo sobrescribe los datos editados (incluido el enlace).
 */
async function guardarEdicionPenalidad() {
    if (!puedeEditar()) return;
    const modal = document.getElementById('modal-editar-penalidad');
    const id = Number(modal.dataset.penalidadId);
    if (!id) { mostrarToast('No se pudo identificar la penalidad a editar.', 'error'); return; }

    const nombre = document.getElementById('editar-penalidad-nombre').value.trim();
    const apellido = document.getElementById('editar-penalidad-apellido').value.trim();
    const dni = document.getElementById('editar-penalidad-dni').value.trim();
    const nroAuto = document.getElementById('editar-penalidad-auto').value;
    const categoria = document.getElementById('editar-penalidad-categoria').value.trim();
    const sancion = document.getElementById('editar-penalidad-sancion').value.trim();
    const motivo = document.getElementById('editar-penalidad-motivo').value.trim();
    const fechaInicio = document.getElementById('editar-penalidad-fecha-inicio').value;
    const fechaFin = document.getElementById('editar-penalidad-fecha-fin').value;
    const enlaceArchivo = document.getElementById('editar-penalidad-enlace').value.trim();

    if (!nombre || !apellido || !dni || !nroAuto || !categoria || !sancion || !motivo || !fechaInicio) {
        mostrarToast('Completá todos los campos obligatorios (*).', 'error');
        return;
    }

    // Mismo criterio que el alta: la fecha de fin no puede ser anterior al inicio.
    if (fechaFin && fechaInicio && fechaFin < fechaInicio) {
        mostrarToast('La fecha de fin no puede ser anterior a la fecha de inicio.', 'error');
        return;
    }

    const btn = document.getElementById('editar-penalidad-btn-guardar');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Guardando...';

    try {
        // Se parte del registro existente para no perder campos de creación ni versionado.
        const existente = await obtenerPorId('penalidades', id) || {};
        const idGuardado = await guardar('penalidades', {
            ...existente,
            id,
            nombre, apellido, dni,
            nroAuto: Number(nroAuto),
            categoria, sancion, motivo,
            fechaInicio,
            fechaFin,
            enlaceArchivo,
            fechaModificacion: new Date().toISOString(),
            usuarioModificacion: currentUser ? currentUser.id : null
        });
        if (!idGuardado) {
            mostrarToast('No se pudieron guardar los cambios (validación de esquema).', 'error');
            return;
        }
        mostrarToast(`Penalidad de ${nombre} ${apellido} actualizada correctamente.`);
        closeModal('modal-editar-penalidad');
        await listarPenalidades();
    } catch (err) {
        console.error(err);
        mostrarToast('Error al guardar los cambios: ' + (err && err.message ? err.message : err), 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Guardar Cambios';
    }
}

// ==================== PILOTOS > AUTORIZACIONES ====================
// Submódulo del grupo Pilotos (debajo de Penalidades): autorizaciones a pilotos
// con nombre, apellido, categoría y un enlace opcional a Drive/archivo que se
// muestra como botón "Ver Archivos" (mismo patrón que `documentosUrl` en
// Competencias). Persistencia: store 'autorizaciones' (DB_VERSION 17, keyPath
// 'id' autoIncrement), igual que 'penalidades'. Alta manual + importación masiva
// desde un archivo HTML/XLS/CSV (parser 100% nativo, sin librerías), con el
// mismo patrón de escritura por lotes (IndexedDB + Firestore) del padrón.

/** Restablece la planilla de autorizaciones. */
function limpiarFormularioAutorizacion() {
    const form = document.getElementById('form-autorizacion');
    if (form) form.reset();
}

/** Carga las categorías existentes en el datalist de la planilla (autocompletado). */
async function poblarCategoriasAutorizacion() {
    const datalist = document.getElementById('categorias-autorizacion');
    if (!datalist) return;
    try {
        const categorias = await getTodos('categorias');
        // Deduplicación case-insensitive para que no se repitan en el dropdown
        const vistas = new Set();
        const unicas = categorias.filter(c => {
            const norm = String(c.nombre || '').trim().toLowerCase();
            if (!norm || vistas.has(norm)) return false;
            vistas.add(norm);
            return true;
        });
        datalist.innerHTML = unicas
            .map(c => `<option value="${escapeHtml(c.nombre || '')}"></option>`)
            .join('');
    } catch (e) {
        // Sin categorías cargadas la planilla sigue siendo usable (campo libre).
    }
}

/** Guarda la autorización (alta manual) y refresca el listado. */
async function guardarAutorizacionForm(e) {
    e.preventDefault();
    if (!puedeEditar()) return;

    const nombre = document.getElementById('autorizacion-nombre').value.trim();
    const apellido = document.getElementById('autorizacion-apellido').value.trim();
    const categoria = document.getElementById('autorizacion-categoria').value.trim();
    const enlaceArchivo = document.getElementById('autorizacion-enlace').value.trim();

    if (!nombre || !apellido || !categoria) {
        mostrarToast('Completá nombre, apellido y categoría.', 'error');
        return;
    }

    const btn = document.getElementById('autorizacion-btn-guardar');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Guardando...';

    try {
        const id = await guardar('autorizaciones', {
            nombre, apellido, categoria,
            enlaceArchivo,
            usuarioCreacion: currentUser ? currentUser.id : null,
            fechaCreacion: new Date().toISOString()
        });
        if (!id) {
            mostrarToast('No se pudo guardar la autorización (validación de esquema).', 'error');
            return;
        }
        mostrarToast(`Autorización de ${nombre} ${apellido} registrada correctamente.`);
        limpiarFormularioAutorizacion();
        await listarAutorizaciones();
    } catch (err) {
        console.error(err);
        mostrarToast('Error al guardar la autorización: ' + (err && err.message ? err.message : err), 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Guardar Autorización';
    }
}

/** Renderiza el listado de autorizaciones con paginación en cliente (+ buscador con debounce). */
async function listarAutorizaciones() {
    const tbody = document.getElementById('autorizaciones-table-body');
    if (!tbody) return;

    await poblarCategoriasAutorizacion();

    let todas = [];
    try {
        todas = await getTodos('autorizaciones');
    } catch (e) {
        console.warn('[autorizaciones] no se pudo leer el store local:', e?.message || e);
    }

    // Filtro sobre el array original (al tocar la búsqueda se resetea la página).
    const busqueda = (document.getElementById('buscar-autorizacion')?.value || '').trim().toLowerCase();
    autorizacionesCache = todas
        .filter(a => {
            if (!busqueda) return true;
            const linea = `${a.nombre || ''} ${a.apellido || ''} ${a.categoria || ''}`.toLowerCase();
            return linea.includes(busqueda);
        })
        .sort((a, b) => Number(b.id) - Number(a.id));

    // Corrige la página si quedó fuera de rango tras filtrar/eliminar.
    const totalPaginas = Math.max(1, Math.ceil(autorizacionesCache.length / registrosPorPaginaAutorizaciones));
    if (paginaActualAutorizaciones > totalPaginas) paginaActualAutorizaciones = totalPaginas;

    renderAutorizacionesPagina();
    renderAutorizacionesPaginador(autorizacionesCache.length, busqueda ? null : totalPaginas);
}

/** Dibuja SOLO las filas del corte de la página actual. */
function renderAutorizacionesPagina() {
    const tbody = document.getElementById('autorizaciones-table-body');
    if (!tbody) return;
    const corte = autorizacionesCache.slice((paginaActualAutorizaciones - 1) * registrosPorPaginaAutorizaciones, paginaActualAutorizaciones * registrosPorPaginaAutorizaciones);

    if (corte.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-secondary);padding:1.5rem;">No hay autorizaciones registradas.</td></tr>`;
        return;
    }

    tbody.innerHTML = '';
    const fragment = document.createDocumentFragment();
    corte.forEach(a => {
        const piloto = `${escapeHtml(a.nombre || '')} ${escapeHtml(a.apellido || '')}`.trim();
        const enlace = a.enlaceArchivo
            ? `<a href="${escapeHtml(a.enlaceArchivo)}" target="_blank" rel="noopener noreferrer" class="action-btn" title="Ver archivos" style="color:var(--accent);display:inline-flex;align-items:center;gap:6px;"><i class="fa-solid fa-folder-open"></i> Ver Archivos</a>`
            : '<span style="color:var(--text-secondary);">—</span>';

        const tr = document.createElement('tr');
        tr.innerHTML = `<tr>
            <td style="font-weight:600;">${piloto}</td>
            <td>${escapeHtml(String(a.categoria || ''))}</td>
            <td style="text-align:center;white-space:nowrap;">${enlace}</td>
            <td class="editor-only" style="text-align:right;white-space:nowrap;">
                <button type="button" class="btn btn-secondary" style="padding:0.35rem 0.6rem;margin-right:0.35rem;" title="Editar autorización (agregar o cambiar enlace)" onclick="editarAutorizacion(${Number(a.id)})"><i class="fa-solid fa-pen-to-square"></i></button>
                <button type="button" class="btn btn-secondary" style="padding:0.35rem 0.6rem;" title="Eliminar autorización" onclick="eliminarAutorizacion(${Number(a.id)})"><i class="fa-solid fa-trash"></i></button>
            </td>
        </tr>`;
        fragment.appendChild(tr);
    });
    tbody.appendChild(fragment);
}

/** Dibuja/navega los controles Anterior / "Página X de Y" / Siguiente. */
function renderAutorizacionesPaginador(total, totalPaginas) {
    const cont = document.getElementById('autorizaciones-pagination');
    if (!cont) return;
    const yaPaginado = Number.isInteger(totalPaginas) && totalPaginas > 0;
    const paginas = yaPaginado ? totalPaginas : Math.max(1, Math.ceil(total / registrosPorPaginaAutorizaciones));
    cont.innerHTML = `
        <button type="button" class="btn btn-secondary pagination-prev" onclick="cambiarPaginaAutorizaciones(-1)" ${paginaActualAutorizaciones <= 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i> Anterior</button>
        <span class="pagination-info">Página ${paginaActualAutorizaciones} de ${paginas}</span>
        <button type="button" class="btn btn-secondary pagination-next" onclick="cambiarPaginaAutorizaciones(1)" ${paginaActualAutorizaciones >= paginas ? 'disabled' : ''}>Siguiente <i class="fa-solid fa-chevron-right"></i></button>
    `;
}

/** Navegación de páginas con límites nativos (disabled si queda fuera de rango). */
function cambiarPaginaAutorizaciones(direccion) {
    const totalPaginas = Math.max(1, Math.ceil(autorizacionesCache.length / registrosPorPaginaAutorizaciones));
    const nueva = paginaActualAutorizaciones + direccion;
    if (nueva < 1 || nueva > totalPaginas) return;
    paginaActualAutorizaciones = nueva;
    renderAutorizacionesPagina();
    renderAutorizacionesPaginador(autorizacionesCache.length, totalPaginas);
}

/** Buscador con DEBOUNCE de 300 ms: espera a que el usuario deje de tipear. */
let autorizacionBusquedaTimer = null;
function autorizacionBuscarDebounced() {
    if (autorizacionBusquedaTimer) clearTimeout(autorizacionBusquedaTimer);
    autorizacionBusquedaTimer = setTimeout(() => {
        paginaActualAutorizaciones = 1;
        listarAutorizaciones();
    }, 300);
}

/** Elimina una autorización, con el modal de confirmación de la app. */
async function eliminarAutorizacion(id) {
    if (!puedeEditar()) return;
    const autorizacion = await obtenerPorId('autorizaciones', id);
    const etiqueta = autorizacion
        ? `${autorizacion.nombre || ''} ${autorizacion.apellido || ''}`.trim()
        : '';

    // mostrarConfirmacion() asigna el mensaje con textContent: no hay que escapar nada.
    const confirmado = await mostrarConfirmacion(
        'Eliminar autorización',
        `¿Eliminar la autorización ${etiqueta ? 'de ' + etiqueta : 'seleccionada'}? Esta acción no se puede deshacer.`,
        'warning'
    );
    if (!confirmado) return;

    await eliminar('autorizaciones', id);
    mostrarToast('Autorización eliminada correctamente.');
    await listarAutorizaciones();
}

// NOTA: la importación masiva documentada más abajo (parser nativo + lotes).
/**
 * Abre el modal para editar una autorización (agregar o cambiar el enlace, o
 * corregir nombre/apellido/categoría). Precarga el registro seleccionado.
 */
async function editarAutorizacion(id) {
    if (!puedeEditar()) return;
    const a = await obtenerPorId('autorizaciones', Number(id));
    if (!a) { mostrarToast('La autorización seleccionada no existe.', 'error'); return; }

    // Rellena el datalist de categorías por si el usuario quiere elegir otra.
    await poblarCategoriasAutorizacion();

    document.getElementById('editar-autorizacion-info').innerHTML =
        `Editando la autorización de <strong>${escapeHtml((a.nombre || '') + ' ' + (a.apellido || '')).trim()}</strong>.`;
    document.getElementById('editar-autorizacion-nombre').value = a.nombre || '';
    document.getElementById('editar-autorizacion-apellido').value = a.apellido || '';
    document.getElementById('editar-autorizacion-categoria').value = a.categoria || '';
    // El enlace es el campo clave: si no tenía archivos, acá se lo agrega.
    document.getElementById('editar-autorizacion-enlace').value = a.enlaceArchivo || '';

    // Guarda el id en el dataset del modal (patrón de modalEditarMovimiento).
    document.getElementById('modal-editar-autorizacion').dataset.autorizacionId = String(a.id);
    openModal('modal-editar-autorizacion');
}

/**
 * Guarda los cambios de la autorización en el modal de edición y refresca el
 * listado. Preserva los campos de creación (usuarioCreacion/fechaCreacion) y el
 * id original; solo sobrescribe los datos editados (incluido el enlace).
 */
async function guardarEdicionAutorizacion() {
    if (!puedeEditar()) return;
    const modal = document.getElementById('modal-editar-autorizacion');
    const id = Number(modal.dataset.autorizacionId);
    if (!id) { mostrarToast('No se pudo identificar la autorización a editar.', 'error'); return; }

    const nombre = document.getElementById('editar-autorizacion-nombre').value.trim();
    const apellido = document.getElementById('editar-autorizacion-apellido').value.trim();
    const categoria = document.getElementById('editar-autorizacion-categoria').value.trim();
    const enlaceArchivo = document.getElementById('editar-autorizacion-enlace').value.trim();

    if (!nombre || !apellido || !categoria) {
        mostrarToast('Completá nombre, apellido y categoría.', 'error');
        return;
    }

    const btn = document.getElementById('editar-autorizacion-btn-guardar');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Guardando...';

    try {
        // Se parte del registro existente para no perder campos de creación ni versionado.
        const existente = await obtenerPorId('autorizaciones', id) || {};
        const idGuardado = await guardar('autorizaciones', {
            ...existente,
            id,
            nombre, apellido, categoria,
            enlaceArchivo,
            fechaModificacion: new Date().toISOString(),
            usuarioModificacion: currentUser ? currentUser.id : null
        });
        if (!idGuardado) {
            mostrarToast('No se pudieron guardar los cambios (validación de esquema).', 'error');
            return;
        }
        mostrarToast(`Autorización de ${nombre} ${apellido} actualizada correctamente.`);
        closeModal('modal-editar-autorizacion');
        await listarAutorizaciones();
    } catch (err) {
        console.error(err);
        mostrarToast('Error al guardar los cambios: ' + (err && err.message ? err.message : err), 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Guardar Cambios';
    }
}


// ---------------- Importación masiva de autorizaciones (HTML/XLS/CSV) ----------------
// Parser 100% nativo (FileReader + DOMParser, sin librerías), mismo enfoque que el
// padrón de pilotos. Se acepta el archivo HTML/XLS que exporta Excel ("Guardar como
// página web") y, como fallback, un CSV/TSV. Las columnas se mapean por su encabezado
// (Nombre, Apellido, Categoría, Enlace/Link/URL) cuando existe; si no hay encabezado
// reconocible se usan las posiciones por defecto 0=Nombre, 1=Apellido, 2=Categoría,
// 3=Enlace. La escritura por lotes (IndexedDB + Firestore) vive en
// importarAutorizacionesLotes().

const AUTORIZACIONES_BATCH_MAX = 400;

/** Dispara el selector de archivo oculto de autorizaciones. */
function dispararImportarAutorizaciones() {
    if (!puedeEditar()) return;
    document.getElementById('autorizacion-import-file')?.click();
}

/** Detecta el índice de cada campo a partir de una fila de encabezados. */
function mapearColumnasAutorizacion(encabezados) {
    const norm = encabezados.map(h => String(h || '').trim().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
    const buscar = (...claves) => norm.findIndex(h => claves.some(c => h.includes(c)));
    return {
        nombre: buscar('nombre'),
        apellido: buscar('apellido'),
        categoria: buscar('categoria'),
        enlace: buscar('enlace', 'link', 'url', 'drive', 'archivo')
    };
}

/** Convierte un texto CSV/TSV en una lista de filas de celdas. */
function parsearCsvAutorizacion(texto) {
    const lineas = texto.split(/\r?\n/).filter(l => l.trim() !== '');
    // Detectar separador: tabulación, punto y coma o coma (el que más divisiones dé).
    const primera = lineas[0] || '';
    const sep = ['\t', ';', ','].sort((a, b) => (primera.split(b).length - primera.split(a).length))[0];
    return lineas.map(l => l.split(sep).map(c => c.trim()));
}

/** Lee filas (HTML o CSV) y devuelve registros de autorización listos para guardar. */
function extraerRegistrosAutorizacion(filas) {
    if (!filas || filas.length === 0) return [];
    const porClave = new Map();
    let base = Date.now();
    let contador = 0;

    // Intento de mapeo por encabezado: solo si la primera fila trae al menos "nombre".
    const mapa = mapearColumnasAutorizacion(filas[0]);
    const tieneEncabezado = mapa.nombre >= 0;
    const inicio = tieneEncabezado ? 1 : 0;
    const idx = tieneEncabezado ? mapa : { nombre: 0, apellido: 1, categoria: 2, enlace: 3 };

    for (let f = inicio; f < filas.length; f++) {
        const celdas = filas[f];
        if (!celdas || celdas.length === 0) continue;

        const nombre = String(celdas[idx.nombre] || '').trim().toUpperCase();
        const apellido = String(celdas[idx.apellido] || '').trim().toUpperCase();
        const categoria = String(celdas[idx.categoria] || '').trim().toUpperCase();
        const enlaceArchivo = String(celdas[idx.enlace] || '').trim();

        if (!nombre || !apellido || !categoria) continue; // fila corrupta: se salta

        const clave = `${nombre}|${apellido}|${categoria}`;
        if (porClave.has(clave)) continue; // dedup dentro del mismo archivo

        porClave.set(clave, {
            id: base + (contador++),
            nombre, apellido, categoria,
            enlaceArchivo,
            usuarioCreacion: (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null,
            fechaCreacion: new Date().toISOString()
        });
    }
    return Array.from(porClave.values());
}

/** Lee el archivo elegido y lo importa por lotes (con feedback en el botón). */
async function importarAutorizacionesPilotos(event) {
    if (!puedeEditar()) return;
    const input = (event && event.target) || document.getElementById('autorizacion-import-file');
    const archivo = input && input.files ? input.files[0] : null;
    if (!archivo) return;

    const btn = document.getElementById('autorizacion-btn-importar');
    const htmlPrevio = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Procesando...'; }

    try {
        const texto = await new Promise((resolve, reject) => {
            const lector = new FileReader();
            lector.onload = () => resolve(String(lector.result || ''));
            lector.onerror = () => reject(lector.error || new Error('No se pudo leer el archivo.'));
            lector.readAsText(archivo, 'UTF-8');
        });

        let filas = [];
        const documento = new DOMParser().parseFromString(texto, 'text/html');
        const trs = documento.querySelectorAll('table tr');
        if (trs.length > 0) {
            // HTML/XLS exportado por Excel: cada <tr> es una fila de celdas.
            filas = Array.from(trs).map(tr =>
                Array.from(tr.querySelectorAll('td, th')).map(c => (c.textContent || '').trim())
            );
        } else {
            // Fallback CSV/TSV.
            filas = parsearCsvAutorizacion(texto);
        }

        const registros = extraerRegistrosAutorizacion(filas);
        if (registros.length === 0) {
            mostrarToast('El archivo no contiene autorizaciones válidas (se requieren nombre, apellido y categoría).', 'warning');
            return;
        }

        const enNube = await importarAutorizacionesLotes(registros, btn);
        mostrarToast(`Autorizaciones importadas: ${registros.length} registros${enNube ? ' (local + nube)' : ' (solo local, sin sesión en la nube)'}.`);
        await listarAutorizaciones();
    } catch (err) {
        console.error('[autorizaciones] Error al importar:', err);
        mostrarToast('Error al importar autorizaciones: ' + (err && err.message ? err.message : err), 'error');
    } finally {
        if (input) input.value = ''; // permite re-elegir el mismo archivo
        if (btn) { btn.disabled = false; btn.innerHTML = htmlPrevio; }
    }
}

/** Guarda los registros en IndexedDB + Firestore en lotes (sin congelar la UI). */
async function importarAutorizacionesLotes(registros, btn) {
    invalidarCache('autorizaciones');
    const dbLocal = await openDB();
    const tx = abrirTransaccionDefensiva(dbLocal, 'autorizaciones', 'readwrite');
    if (!tx) throw new Error("El store local 'autorizaciones' no está disponible.");
    const storeLocal = tx.objectStore('autorizaciones');
    registros.forEach(item => { try { storeLocal.put(item); } catch (e) { /* dedup ya aplicado */ } });
    await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('Error al guardar las autorizaciones en local.'));
        tx.onabort = () => reject(tx.error || new Error('Importación local cancelada.'));
    });

    const rt = (typeof window !== 'undefined' && window.__CDA_FIREBASE_RUNTIME__) || null;
    const haySesion = !!(rt && rt.dbFirebase && typeof rt.writeBatch === 'function'
        && typeof rt.doc === 'function' && rt.auth && rt.auth.currentUser);
    if (!haySesion) return false;

    for (let i = 0; i < registros.length; i += AUTORIZACIONES_BATCH_MAX) {
        const lote = rt.writeBatch(rt.dbFirebase);
        registros.slice(i, i + AUTORIZACIONES_BATCH_MAX).forEach(item => {
            lote.set(rt.doc(rt.dbFirebase, 'autorizaciones', String(item.id)), item, { merge: true });
        });
        await lote.commit();
        const subidos = Math.min(i + AUTORIZACIONES_BATCH_MAX, registros.length);
        if (btn) btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Subiendo ${subidos}/${registros.length}...`;
        await new Promise(r => setTimeout(r, 0)); // cede el hilo: no congela el navegador
    }
    return true;
}

// ---------------- Catálogo de categorías (ruedita) desde Autorizaciones ----------------
// Réplica del patrón de la ruedita de tipos de sanción (#subModalTiposSancion), pero
// operando sobre el store 'categorias' REAL del sistema (el mismo que usan Competencias,
// Pilotos y Penalidades). Permite agregar, editar y borrar categorías en caliente; al
// cerrar/guardar se repobla el datalist #categorias-autorizacion. Nombres SIEMPRE vía
// textContent (sin innerHTML) para respetar la regla de seguridad contra XSS.

// Modo edición del sub-modal: id de la categoría que se está renombrando (null = alta).
let categoriaAuthEditandoId = null;

/** Abre el sub-modal de gestión de categorías (solo usuarios con permiso de edición). */
async function abrirModalCategoriasAuth() {
    if (!puedeEditar()) return;
    cancelarEdicionCategoriaAuth();
    await renderizarListaCategoriasAuth();
    openModal('subModalCategoriasAuth');
}

/** Lista las categorías con botones Editar/Eliminar (nombres SIEMPRE vía textContent). */
async function renderizarListaCategoriasAuth() {
    const container = document.getElementById('lista-categorias-auth');
    if (!container) return;
    const categorias = deduplicarCategorias(await getTodos('categorias'));
    // Orden alfabético para encontrarlas rápido en el catálogo.
    categorias.sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es'));
    container.innerHTML = '';

    if (categorias.length === 0) {
        container.innerHTML = '<span style="color:var(--text-secondary);font-size:0.85rem;text-align:center;padding:0.5rem;">No hay categorías registradas.</span>';
        return;
    }

    categorias.forEach(c => {
        const div = document.createElement('div');
        div.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0.75rem;background:var(--bg-secondary);border-radius:6px;border:1px solid var(--border-color);';

        const span = document.createElement('span');
        span.textContent = c.nombre || '';
        span.style.cssText = 'font-weight:500;';
        div.appendChild(span);

        const btns = document.createElement('span');
        btns.style.cssText = 'display:flex;align-items:center;gap:0.3rem;';

        const btnEditar = document.createElement('button');
        btnEditar.type = 'button';
        btnEditar.className = 'action-btn';
        btnEditar.title = 'Editar categoría';
        btnEditar.innerHTML = '<i class="fa-solid fa-pen-to-square"></i>';
        btnEditar.onclick = () => editarCategoriaAuth(c.id);
        btns.appendChild(btnEditar);

        const btnEliminar = document.createElement('button');
        btnEliminar.type = 'button';
        btnEliminar.className = 'action-btn';
        btnEliminar.title = 'Eliminar categoría';
        btnEliminar.innerHTML = '<i class="fa-solid fa-trash"></i>';
        btnEliminar.onclick = () => eliminarCategoriaAuth(c.id, c.nombre || '');
        btns.appendChild(btnEliminar);

        div.appendChild(btns);
        container.appendChild(div);
    });
}

/** Vuelve el sub-modal al modo "Agregar" y limpia el input. */
function cancelarEdicionCategoriaAuth() {
    categoriaAuthEditandoId = null;
    const input = document.getElementById('nueva-categoria-auth');
    const label = document.getElementById('nueva-categoria-auth-label');
    const btn = document.getElementById('nueva-categoria-auth-btn');
    const cancel = document.getElementById('nueva-categoria-auth-cancel');
    if (input) input.value = '';
    if (label) label.textContent = 'Nombre de la categoría';
    if (btn) { btn.title = 'Agregar categoría'; btn.innerHTML = '<i class="fa-solid fa-plus"></i>'; }
    if (cancel) cancel.style.display = 'none';
}

/** Pone el sub-modal en modo "Editar" con la categoría precargada en el input. */
async function editarCategoriaAuth(id) {
    if (!puedeEditar()) return;
    const categoria = await obtenerPorId('categorias', Number(id));
    if (!categoria) return;

    categoriaAuthEditandoId = Number(id);
    const input = document.getElementById('nueva-categoria-auth');
    const label = document.getElementById('nueva-categoria-auth-label');
    const btn = document.getElementById('nueva-categoria-auth-btn');
    const cancel = document.getElementById('nueva-categoria-auth-cancel');

    if (input) input.value = categoria.nombre || '';
    if (label) label.textContent = 'Editar categoría';
    if (btn) { btn.title = 'Guardar cambios'; btn.innerHTML = '<i class="fa-solid fa-check"></i>'; }
    if (cancel) cancel.style.display = '';
    if (input) { input.focus(); input.select(); }
}

/** Alta o edición (según `categoriaAuthEditandoId`) de la categoría en el sub-modal. */
async function guardarCategoriaAuthModal() {
    if (!puedeEditar()) return;
    const input = document.getElementById('nueva-categoria-auth');
    if (!input) return;

    const nombre = input.value.trim();
    if (!nombre) { mostrarToast('Ingresá el nombre de la categoría.', 'warning'); return; }

    const categorias = await getTodos('categorias');
    const norm = (s) => String(s || '').trim().toLowerCase();

    // ---------- MODO EDICIÓN ----------
    if (categoriaAuthEditandoId !== null) {
        // No puede quedar un duplicado de OTRA categoría.
        if (categorias.some(c => Number(c.id) !== Number(categoriaAuthEditandoId) && norm(c.nombre) === norm(nombre))) {
            mostrarToast('Esa categoría ya existe.', 'error');
            return;
        }
        const categoria = await obtenerPorId('categorias', categoriaAuthEditandoId);
        if (!categoria) { cancelarEdicionCategoriaAuth(); return; }
        categoria.nombre = nombre;
        await guardar('categorias', categoria);

        cancelarEdicionCategoriaAuth();
        await renderizarListaCategoriasAuth();
        await poblarCategoriasAutorizacion();
        mostrarToast(`Categoría actualizada a "${nombre}".`);
        return;
    }

    // ---------- MODO ALTA ----------
    if (categorias.some(c => norm(c.nombre) === norm(nombre))) {
        mostrarToast('Esa categoría ya existe.', 'error');
        return;
    }
    await guardar('categorias', { nombre, activo: true });
    input.value = '';
    await renderizarListaCategoriasAuth();
    await poblarCategoriasAutorizacion();
    mostrarToast(`Categoría "${nombre}" agregada.`);
}

/** Elimina una categoría del catálogo (con el modal de confirmación de la app). */
async function eliminarCategoriaAuth(id, label) {
    if (!puedeEditar()) return;
    if (typeof id === 'undefined' || id === null) return;

    // mostrarConfirmacion() asigna el mensaje con textContent: no hace falta escapar.
    const confirmado = await mostrarConfirmacion(
        'Eliminar categoría',
        `¿Eliminar la categoría "${label}"? Es la misma que usan Competencias, Pilotos y Penalidades; los registros ya guardados conservan su texto.`,
        'warning'
    );
    if (!confirmado) return;

    await eliminar('categorias', id);
    // Si la categoría eliminada era la que estaba en edición, volver al modo alta.
    if (categoriaAuthEditandoId !== null && Number(categoriaAuthEditandoId) === Number(id)) {
        cancelarEdicionCategoriaAuth();
    }
    await renderizarListaCategoriasAuth();
    await poblarCategoriasAutorizacion();
    mostrarToast('Categoría eliminada.');
}

// ==================== CONFIGURACIÓN: CATEGORÍAS & CIRCUITOS ====================

async function listarConfiguraciones() {
    actualizarEstadoFirebaseUI();

    if (esAdmin()) {
        await listarUsuarios();
    }

    await precargarEnlaceSheets();
}

// ==================== CONFIGURACIÓN GLOBAL DE LA APP (módulo Calendario) ====================
// 'configuracionGlobal' es un único documento (id fijo 1) en IndexedDB/Firestore donde se
// persisten ajustes globales de la aplicación (ej: enlace CSV de Google Sheets).

async function cargarConfiguracionGlobal() {
    // 1) Nube primero: lee el documento único `configuracionGlobal/1` de Firestore
    //    (corte anti-cuota de 1.5 s). Así la API key de Serper y los ajustes
    //    globales se leen desde cualquier navegador con sesión Firebase.
    const rt = (typeof window !== 'undefined' && window.__CDA_FIREBASE_RUNTIME__) || null;
    if (rt && rt.dbFirebase && typeof rt.getDoc === 'function' && typeof rt.doc === 'function' && rt.auth && rt.auth.currentUser) {
        try {
            const snap = await conCorteDeSeguridad(rt.getDoc(rt.doc(rt.dbFirebase, 'configuracionGlobal', '1')), 1500, null);
            if (snap && typeof snap.exists === 'function' && snap.exists()) {
                return snap.data() || {};
            }
        } catch (e) {
            console.warn('No se pudo leer la configuración global desde Firestore:', e);
        }
    }
    // 2) Fallback: espejo local en IndexedDB.
    try {
        const todos = await getTodos('configuracionGlobal');
        return (todos || []).find(c => Number(c.id) === 1) || {};
    } catch (e) {
        console.warn('No se pudo leer la configuración global:', e);
        return {};
    }
}

async function precargarEnlaceSheets() {
    const input = document.getElementById('config-url-sheets');
    const inputKey = document.getElementById('config-serper-key');
    const cfg = await cargarConfiguracionGlobal();
    if (input) input.value = cfg.urlGoogleSheets || '';
    if (inputKey) {
        // Prioridad al espejo local (misma clave que lee la auditoría ACTC).
        let local = '';
        try { local = String(localStorage.getItem('serper_api_key') || ''); } catch (e) { /* sin localStorage */ }
        inputKey.value = local || (cfg.serperApiKey || '');
    }
}

async function guardarConfiguracion() {
    const input = document.getElementById('config-url-sheets');
    const inputKey = document.getElementById('config-serper-key');
    if (!input && !inputKey) return;

    // El doc es único (id 1) y `put` reemplaza el registro completo: se parten
    // de los valores previos para que un input ausente no borre el otro ajuste.
    const cfgPrevia = await cargarConfiguracionGlobal();
    const urlGoogleSheets = input ? input.value.trim() : (cfgPrevia.urlGoogleSheets || '');
    const serperApiKey = inputKey ? inputKey.value.trim() : (cfgPrevia.serperApiKey || '');
    try {
        await guardar('configuracionGlobal', { id: 1, urlGoogleSheets, serperApiKey });
        // Escritura a la nube (Firebase): documento único `configuracionGlobal/1`
        // para que la key de Serper y los ajustes se lean desde cualquier
        // navegador con sesión. Corte anti-cuota de 1.5 s.
        const rt = (typeof window !== 'undefined' && window.__CDA_FIREBASE_RUNTIME__) || null;
        if (rt && rt.dbFirebase && typeof rt.setDoc === 'function' && typeof rt.doc === 'function' && rt.auth && rt.auth.currentUser) {
            await conCorteDeSeguridad(
                rt.setDoc(rt.doc(rt.dbFirebase, 'configuracionGlobal', '1'), { id: 1, urlGoogleSheets, serperApiKey }),
                1500
            );
        }
        // Espejo local: la auditoría ACTC recupera la key desde
        // `localStorage['serper_api_key']` cuando no hay nube disponible.
        try {
            if (serperApiKey) localStorage.setItem('serper_api_key', serperApiKey);
            else localStorage.removeItem('serper_api_key');
        } catch (e) { /* localStorage no disponible: no bloquea */ }
        if (typeof invalidarCache === 'function') invalidarCache('configuracionGlobal');
        mostrarToast('Configuración guardada correctamente.');
        document.querySelectorAll('.config-save-msg').forEach(msg => {
            msg.textContent = '✓ Guardado';
            msg.style.color = 'var(--accent)';
        });
    } catch (e) {
        console.error('Error al guardar configuración global:', e);
        mostrarToast('No se pudo guardar la configuración.', 'error');
        document.querySelectorAll('.config-save-msg').forEach(msg => {
            msg.textContent = '✗ Error al guardar';
            msg.style.color = '#ff6b6b';
        });
    }
}

// ==================== CALENDARIO ANUAL (Google Sheets) ====================
// Lee la matriz exportada en CSV de una planilla de Google Sheets, la parsea fila
// por fila y dibuja el almanaque anual en la cuadrícula #calendario-anual-grid.

const MESES_DEL_ANIO = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];

/**
 * Meses del año en mayúsculas (variante argentina "SETIEMBRE"; también se acepta "SEPTIEMBRE").
 * El índice de cada mes coincide con MESES_DEL_ANIO para el renderizado.
 */
const MESES = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SETIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];

const _INDICE_MES = Object.fromEntries([
    ...MESES.map((m, i) => [m, i]),
    ['SEPTIEMBRE', MESES.indexOf('SETIEMBRE')]
]);

/** Categorías reales del automovilismo: estandarizan los encabezados de columna de la planilla. */
const CATEGORIAS_CANONICAS = [
    'TC2000', 'F. NACIONAL', 'TOP RACE', 'TCR', 'COPA FIAT',
    'SPORT REG', 'IAME', 'ROTAX', 'CAK', 'RALLY ARG'
];

const _NORMALIZAR_CATEGORIA = (s) =>
    String(s || '')
        .toUpperCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Z0-9]/g, '');

const _CATEGORIA_POR_NORMALIZADA = Object.fromEntries(
    CATEGORIAS_CANONICAS.map(c => [_NORMALIZAR_CATEGORIA(c), c])
);

/** Frases que encabezan los títulos de la planilla: esas filas se ignoran por completo. */
const FRASES_IGNORAR = ['CATEGORIAS DE AUTOS', 'COMPITEN EN', 'RUTA O CIRCUITO'];

/**
 * Parser ultra-resistente de la matriz exportada en CSV.
 * Estructura real del Excel:
 *   - Filas de títulos / texto / vacías → se ignoran (.trim() + frases).
 *   - Fila que empieza con un MES → Mes Activo; las demás celdas de ESA MISMA fila son
 *     las cabeceras de las categorías (col 1 = TC2000, col 2 = F. NACIONAL, col 10 = RALLY ARG).
 *   - Fila que empieza con un número (1..31, domingo) → celdas de categoría con el LUGAR.
 * Devuelve: [{ mes, domingo, categoria, lugar }]
 */
function parsearCalendarioCSV(texto) {
    if (typeof texto === 'string' && texto.charCodeAt(0) === 0xFEFF) texto = texto.slice(1);

    const eventos = [];
    let mesActivo = null;              // índice 0..11 del mes actual
    let columnasCategorias = {};       // { columna: nombreCategoria }

    const lineas = String(texto || '').split('\n');
    const lineasMayus = lineas.map(l => l.toUpperCase());

    for (let i = 0; i < lineas.length; i++) {
        const linea = lineas[i];
        if (!linea.trim()) continue; // línea totalmente vacía → ignorar

        // Títulos superiores de la planilla → ignorar por completo.
        const lineaMayus = lineasMayus[i];
        if (FRASES_IGNORAR.some(f => lineaMayus.includes(f))) continue;

        const fila = linea.split(',').map(c => c.trim()); // celdas limpias de espacios
        const celda0 = (fila[0] || '').toUpperCase();

        // 1) ¿Fila de MES? → Mes Activo + cabecera de categorías en la MISMA fila.
        const idxMes = _INDICE_MES[celda0];
        if (idxMes !== undefined) {
            mesActivo = idxMes;
            columnasCategorias = {};
            fila.forEach((celda, col) => {
                if (col === 0) return; // col 0 = el mes, no una categoría
                if (celda) {
                    // Nombre canónico si coincide; si no, se conserva el texto del encabezado.
                    columnasCategorias[col] = _CATEGORIA_POR_NORMALIZADA[_NORMALIZAR_CATEGORIA(celda)] || celda;
                }
            });
            continue; // la cabecera NO se busca en la fila de abajo
        }

        // 2) ¿Fila de semana? La columna 0 es el número del día domingo.
        if (mesActivo !== null && /^\d{1,2}$/.test(celda0)) {
            const numeroDiaDomingo = parseInt(celda0, 10);
            if (numeroDiaDomingo >= 1 && numeroDiaDomingo <= 31) {
                for (const colStr of Object.keys(columnasCategorias)) {
                    const col = Number(colStr);
                    const celda = fila[col] || '';
                    if (!celda) continue; // vacía → la categoría no compite esa semana

                    let lugar;
                    const celdaMayus = celda.toUpperCase();
                    const esNumeroSolo = !/[A-Za-zÀ-ÿÑñ]/.test(celda);
                    const esMarcador = celdaMayus === 'A CONFIRMAR' || celdaMayus === 'SUSPENDIDA';

                    if (esNumeroSolo || esMarcador) {
                        lugar = 'A confirmar'; // compite pero el lugar está por confirmar
                    } else {
                        lugar = celda; // texto con letras → circuito/ciudad exacto
                    }

                    eventos.push({
                        mes: mesActivo,
                        domingo: numeroDiaDomingo,
                        categoria: columnasCategorias[col],
                        lugar: lugar
                    });
                }
            }
        }
    }

    console.log('Eventos parseados con éxito:', eventos.length);
    return eventos;
}

// ---- Estado del módulo (se conserva entre renders para filtros y recarga) ----
let calendarioEventos = [];
let calendarioFiltroCategoria = null;
// Filtro de mes: null = mostrar el almanaque anual completo (todos los meses).
// Un numero 0-11 = mostrar SOLO ese mes.
let calendarioFiltroMes = null;
let _leyendaListenerAgregado = false;

/** Genera los botones de mes una sola vez (evita duplicar los nombres en el HTML). */
let _botonesMesGenerados = false;
function _poblarBotonesMes() {
    const cont = document.getElementById('calendario-filtro-mes');
    if (!cont || _botonesMesGenerados) {
        _sincronizarBotonesMes();
        return;
    }
    _botonesMesGenerados = true;
    cont.innerHTML = '<span class="calendario-filtro-mes-titulo">Filtrar por mes:</span>' +
        '<button type="button" class="cal-mes-btn active" data-mes="todos" onclick="filtrarCalendarioPorMes(null)">Todos</button>' +
        MESES_DEL_ANIO.map((nombre, i) =>
            `<button type="button" class="cal-mes-btn" data-mes="${i}" onclick="filtrarCalendarioPorMes(${i})">${escapeHtml(nombre)}</button>`
        ).join('');
    _sincronizarBotonesMes();
}

/** Selecciona un mes (0-11) o `null` para ver el año completo. */
function filtrarCalendarioPorMes(mes) {
    calendarioFiltroMes = mes;
    renderizarCalendarioAnual();
    _sincronizarBotonesMes();
}

/** Pone "Todos" cuando no hay mes seleccionado (para que el estado visual cuadre). */
function _sincronizarBotonesMes() {
    document.querySelectorAll('#calendario-filtro-mes button').forEach(btn => {
        const valor = btn.dataset.mes;
        const activo = (calendarioFiltroMes === null && valor === 'todos') ||
                       (valor !== 'todos' && Number(valor) === calendarioFiltroMes);
        btn.classList.toggle('active', activo);
    });
}

const PALETA_CATEGORIAS = ['#ff4757', '#00d2d3', '#2ed573', '#ff9f43', '#a78bfa', '#feca57', '#ff6b9d', '#4dc3ff'];

async function cargarYParsearCalendario() {
    const grid = document.getElementById('calendario-anual-grid');
    if (!grid) return;

    const cfg = await cargarConfiguracionGlobal();
    const urlConfigured = (cfg && cfg.urlGoogleSheets) ? String(cfg.urlGoogleSheets).trim() : '';

    if (!urlConfigured) {
        calendarioEventos = [];
        calendarioFiltroCategoria = null;
        renderizarLeyendaCategorias([]);
        grid.innerHTML = '<div class="calendario-vacio">⚠️ No hay un enlace CSV de Google Sheets configurado. Cargalo desde Configuración.</div>';
        return;
    }

    // Rompe-caché. La URL de publicación de Google Sheets puede traer parámetros propios
    // (signo '?'), así que el conector correcto depende de si ya existe ese signo:
    //   - con '?':  usar '&' para no generar doble signo de interrogación (HTTP 400).
    //   - sin '?':  usar '?' (primer parámetro).
    const conector = urlConfigured.includes('?') ? '&' : '?';
    const urlSaneada = `${urlConfigured}${conector}t=${Date.now()}`;

    try {
        const res = await fetch(urlSaneada);
        if (!res.ok) {
            // Red de seguridad: no se corta la ejecución; se reporta el fallo con detalle en el DOM.
            const motivo = res.status === 400
                ? 'la solicitud es inválida (posible URL mal configurada)'
                : `error de lectura (HTTP ${res.status})`;
            throw new Error(`No se pudo leer la planilla: ${motivo}.`);
        }
        const texto = await res.text();
        calendarioEventos = parsearCalendarioCSV(texto);
        calendarioFiltroCategoria = null; // al recargar datos se limpia el filtro previo
        renderizarCalendarioAnual();
    } catch (e) {
        console.error('Error al cargar/parsear el calendario de Google Sheets:', e);
        calendarioEventos = [];
        calendarioFiltroCategoria = null;
        renderizarLeyendaCategorias([]);
        grid.innerHTML = `<div class="calendario-vacio">⚠️ No se pudo leer la planilla: ${escapeHtml(e.message)}</div>`;
    }
}

/**
 * Recoge las categorías únicas detectadas en el CSV (ordenadas alfabéticamente) y les
 * asigna un color estable de la paleta, para mantener coherencia entre leyenda y badges.
 */
function _categoriasConColor() {
    const unicas = [];
    const vistos = new Set();
    for (const ev of calendarioEventos) {
        const cat = String(ev.categoria || '').trim();
        if (cat && !vistos.has(cat)) {
            vistos.add(cat);
            unicas.push(cat);
        }
    }
    unicas.sort((a, b) => a.localeCompare(b));
    return unicas.map((nombre, i) => ({
        nombre,
        color: PALETA_CATEGORIAS[i % PALETA_CATEGORIAS.length]
    }));
}

function toggleFiltroCategoria(categoria) {
    // Clic de nuevo sobre la categoría activa → limpia el filtro.
    calendarioFiltroCategoria = (calendarioFiltroCategoria === categoria) ? null : categoria;
    renderizarCalendarioAnual();
}

function _conectarLeyenda() {
    if (_leyendaListenerAgregado) return;
    _leyendaListenerAgregado = true;
    const cont = document.getElementById('calendario-leyenda');
    if (!cont) return;
    cont.addEventListener('click', (e) => {
        const item = e.target.closest('.cal-leyenda-item');
        if (!item) return;
        toggleFiltroCategoria(item.dataset.categoria);
    });
}

function renderizarLeyendaCategorias(categorias) {
    const cont = document.getElementById('calendario-leyenda');
    if (!cont) return;

    if (!categorias || categorias.length === 0) {
        cont.innerHTML = '';
        return;
    }

    const items = categorias.map(({ nombre, color }) => {
        const activa = calendarioFiltroCategoria === nombre ? ' active' : '';
        return `<button type="button" class="cal-leyenda-item${activa}" data-categoria="${escapeHtml(nombre)}" title="Filtrar por ${escapeHtml(nombre)}">
                    <span class="cal-leyenda-dot" style="background:${color}"></span> ${escapeHtml(nombre)}
                </button>`;
    }).join('');

    cont.innerHTML = `<span class="cal-leyenda-titulo">Filtrar por categoría:</span>${items}`;
    _conectarLeyenda();
}

function renderizarCalendarioAnual() {
    const grid = document.getElementById('calendario-anual-grid');
    if (!grid) return;

    const categorias = _categoriasConColor();
    renderizarLeyendaCategorias(categorias);
    _poblarBotonesMes();

    if (!calendarioEventos || calendarioEventos.length === 0) {
        grid.innerHTML = '<div class="calendario-vacio">La planilla no contiene eventos de calendario.</div>';
        _calTarjetasMeses = [];
        grid.classList.remove('cal-masonry');
        return;
    }

    const filtroActivo = calendarioFiltroCategoria !== null;

    // Referencia de fecha actual para colorear las semanas (competencia pasada = rojo,
    // competencia futura o presente = verde esmeralda).
    const anioActual = new Date().getFullYear();
    const hoyInicio = new Date();
    hoyInicio.setHours(0, 0, 0, 0);

    // Agrupar por mes y por SEMANA (número de domingo): porMes[mes][domingo] = [{categoria, lugar}]
    const porMes = Array.from({ length: 12 }, () => ({}));
    for (const ev of calendarioEventos) {
        if (ev.mes < 0 || ev.mes > 11) continue;
        const m = porMes[ev.mes];
        if (!m[ev.domingo]) m[ev.domingo] = [];
        m[ev.domingo].push({ categoria: String(ev.categoria || ''), lugar: String(ev.lugar || '') });
    }

    grid.innerHTML = MESES_DEL_ANIO.map((nombreMes, idxMes) => {
        // Filtro de mes: si hay uno seleccionado, NO se dibuja el resto, para que
        // la vista muestre unicamente ese mes (en lugar de atenuar los demas).
        if (calendarioFiltroMes !== null && idxMes !== calendarioFiltroMes) return '';
        const semanas = porMes[idxMes];
        const domingosOrdenados = Object.keys(semanas).map(Number).sort((a, b) => a - b);

        let contenidoSemanas;
        if (domingosOrdenados.length === 0) {
            contenidoSemanas = '<div class="calendario-vacio" style="grid-column:auto;padding:1rem;">Sin fechas cargadas</div>';
        } else {
            contenidoSemanas = domingosOrdenados.map(domingo => {
                const items = semanas[domingo];
                const tieneCategoria = items.some(it => it.categoria === calendarioFiltroCategoria);

                // Fecha de la competencia: combina año actual + índice de mes (0-11) + día domingo.
                const fechaSemana = new Date(anioActual, idxMes, domingo);
                const claseFecha = fechaSemana < hoyInicio ? ' fecha-pasada' : ' fecha-futura';
                const claseSem = (filtroActivo ? (tieneCategoria ? ' cal-sem-destacada' : ' cal-sem-dim') : '') + claseFecha;

                const badges = items.map(it => {
                    const badgeClase = filtroActivo && it.categoria !== calendarioFiltroCategoria
                        ? ' cal-badge-dim'
                        : '';
                    return `<div class="cal-badge${badgeClase}">
                                <span class="cal-categoria">${escapeHtml(it.categoria)}</span>
                                <span class="cal-lugar">: ${escapeHtml(it.lugar)}</span>
                            </div>`;
                }).join('');

                return `<div class="cal-sem${claseSem}">
                            <div class="cal-sem-header">Día ${domingo}</div>
                            ${badges}
                        </div>`;
            }).join('');
        }

        return `
            <div class="mes-card">
                <h3>${nombreMes}</h3>
                <div class="mes-semanas">${contenidoSemanas}</div>
            </div>`;
    }).join('');

    // Con un mes seleccionado queda una sola tarjeta: sin acotarla se estiraba a
    // todo el ancho de la pantalla y los badges quedaban como tiras vacías.
    grid.classList.toggle('cal-grid-mes-unico', calendarioFiltroMes !== null);

    _calTarjetasMeses = Array.from(grid.querySelectorAll('.mes-card'));
    _aplicarMasonryCalendario();
}

/* ---------------------------------------------------------------------------
 * Masonry del calendario
 *
 * El grid por filas igualaba la altura de TODAS las tarjetas de una misma fila
 * a la de la más alta, así que los meses con pocas competencias (enero,
 * febrero) dejaban un bloque de espacio negro debajo. Masonry reparte las
 * tarjetas en columnas,y cada columna mide lo que mide su contenido: si más
 * adelante la planilla suma competencias, la tarjeta crece y el resto se
 * acomoda solo, sin recortes ni altura fija que pueda cortar datos.
 * --------------------------------------------------------------------------- */

let _calMasonryObserver = null;
// Tarjetas del último render, en orden cronológico. Se guardan en una variable
// porque tras aplicar el masonry quedan anidadas dentro de .cal-masonry-col y
// un selector directo sobre el grid ya no las encontraría al recalcular columnas.
let _calTarjetasMeses = [];

/** Cantidad de columnas según el ancho disponible (mismo mínimo que el grid). */
function _columnasMasonryCalendario(grid) {
    const ancho = grid.clientWidth;
    if (ancho <= 0) return 1;
    const minimo = window.innerWidth <= 900 ? 230 : 280;
    return Math.max(1, Math.floor(ancho / minimo));
}

/** Reparte las tarjetas en columnas, eligiendo siempre la más corta. */
function _aplicarMasonryCalendario() {
    const grid = document.getElementById('calendario-anual-grid');
    if (!grid) return;

    // Con un mes filtrado la tarjeta ya está acotada y centrada: el masonry sólo
    // tiene sentido en la vista anual.
    if (calendarioFiltroMes !== null || _calTarjetasMeses.length <= 1) {
        grid.classList.remove('cal-masonry');
        // Se reconstruye el contenido desde cero en vez de sólo mover las
        // tarjetas: si no, los envoltorios .cal-masonry-col vacíos que dejó el
        // masonry anterior quedaban como ítems del grid y empujaban la tarjeta
        // hacia abajo, descentrándola.
        grid.replaceChildren(..._calTarjetasMeses);
        _observarMasonryCalendario(grid);
        return;
    }

    const numColumnas = _columnasMasonryCalendario(grid);
    grid.classList.add('cal-masonry');

    // Se mide con las tarjetas ya en el DOM: el ancho de columna sólo depende
    // del contenedor, no de la altura, así que la medición es válida.
    const alturas = _calTarjetasMeses.map(t => t.getBoundingClientRect().height);
    const columnas = Array.from({ length: numColumnas }, () => []);
    const alturasCol = new Array(numColumnas).fill(0);

    _calTarjetasMeses.forEach((tarjeta, i) => {
        const destino = alturasCol.indexOf(Math.min(...alturasCol));
        columnas[destino].push(tarjeta);
        alturasCol[destino] += alturas[i] + 16; // 16px = 1rem de gap vertical
    });

    const envoltorios = columnas
        .map(col => {
            const div = document.createElement('div');
            div.className = 'cal-masonry-col';
            col.forEach(t => div.appendChild(t));
            return div;
        })
        .filter(col => col.childElementCount > 0);

    grid.replaceChildren(...envoltorios);
    _observarMasonryCalendario(grid);
}

function _observarMasonryCalendario(grid) {
    if (_calMasonryObserver) _calMasonryObserver.disconnect();
    if (typeof ResizeObserver === 'undefined' || !grid) return;

    // Al cambiar el tamaño de pantalla recalcula columnas y redistribuye.
    let anchoPrevio = grid.clientWidth;
    _calMasonryObserver = new ResizeObserver(() => {
        if (Math.abs(grid.clientWidth - anchoPrevio) < 2) return;
        anchoPrevio = grid.clientWidth;
        _aplicarMasonryCalendario();
    });
    _calMasonryObserver.observe(grid);
}

// Botón de recarga manual: fuerza el fetch (rompe-caché) con spinner + toast informativo.
async function refrescarCalendario() {
    const btn = document.getElementById('btn-refrescar-calendario');
    const icono = btn ? btn.querySelector('i') : null;

    mostrarToast('Actualizando calendario...', 'info');
    if (btn) btn.disabled = true;
    if (icono) icono.classList.add('fa-spin');

    try {
        await cargarYParsearCalendario();
    } finally {
        if (btn) btn.disabled = false;
        if (icono) icono.classList.remove('fa-spin');
    }
}

async function listarCategoriasCircuitos() {
    const categorias = deduplicarCategorias(await getTodos('categorias'));
    const catBody = document.getElementById('config-categorias-body');
    if (catBody) {
        catBody.innerHTML = '';
        categorias.forEach(c => {
            const acciones = puedeEditar() ? `
                <td style="text-align:right;">
                    <button class="action-btn" onclick="editarCategoria(${c.id})"><i class="fa-solid fa-pen-to-square"></i></button>
                    <button class="action-btn delete" onclick="eliminarCategoria(${c.id})"><i class="fa-solid fa-trash"></i></button>
                </td>
            ` : '';
            catBody.innerHTML += `
                <tr>
                    <td style="font-weight:600;">${escapeHtml(c.nombre)}</td>
                    <td style="color:var(--text-secondary);max-width:200px;text-overflow:ellipsis;overflow:hidden;white-space:nowrap;">${escapeHtml(c.descripcion)}</td>
                    ${acciones}
                </tr>`;
        });
    }

    const circuitos = deduplicarCircuitos(await getTodos('circuitos'));
    const circBody = document.getElementById('config-circuitos-body');
    if (circBody) {
        circBody.innerHTML = '';
        circuitos.forEach(c => {
            const acciones = puedeEditar() ? `
                <td style="text-align:right;">
                    <button class="action-btn" onclick="editarCircuito(${c.id})"><i class="fa-solid fa-pen-to-square"></i></button>
                    <button class="action-btn delete" onclick="eliminarCircuito(${c.id})"><i class="fa-solid fa-trash"></i></button>
                </td>
            ` : '';
            circBody.innerHTML += `
                <tr>
                    <td style="font-weight:600;">${escapeHtml(c.nombre)}</td>
                    <td>${escapeHtml(c.ubicacion)}</td>
                    ${acciones}
                </tr>`;
        });
    }
}

function openModalCategoria() {
    if (!puedeEditar()) return;
    document.getElementById('form-categoria').reset();
    document.getElementById('categoria-id').value = '';
    document.getElementById('categoria-modal-title').innerText = 'Agregar Categoría';
    openModal('modal-categoria');
}

async function editarCategoria(id) {
    if (!puedeEditar()) return;
    const c = await obtenerPorId('categorias', id);
    if (!c) return;
    document.getElementById('categoria-id').value = c.id;
    document.getElementById('categoria-nombre').value = c.nombre;
    document.getElementById('categoria-descripcion').value = c.descripcion;
    document.getElementById('categoria-modal-title').innerText = 'Editar Categoría';
    openModal('modal-categoria');
}

async function guardarCategoriaForm(e) {
    e.preventDefault();
    if (!puedeEditar()) return;
    const id = document.getElementById('categoria-id').value;
    const cat = { nombre: document.getElementById('categoria-nombre').value, descripcion: document.getElementById('categoria-descripcion').value, activo: true };
    if (id) cat.id = Number(id);
    await guardar('categorias', cat);
    closeModal('modal-categoria');
    listarCategoriasCircuitos();
}

async function eliminarCategoria(id) {
    if (!puedeEditar()) return;
    if (!confirm('¿Eliminar esta categoría?')) return;
    await eliminar('categorias', id);
    listarCategoriasCircuitos();
}

function openModalCircuito() {
    if (!puedeEditar()) return;
    document.getElementById('form-circuito').reset();
    document.getElementById('circuito-id').value = '';
    document.getElementById('circuito-modal-title').innerText = 'Agregar Autódromo';
    openModal('modal-circuito');
}

async function editarCircuito(id) {
    if (!puedeEditar()) return;
    const c = await obtenerPorId('circuitos', id);
    if (!c) return;
    document.getElementById('circuito-id').value = c.id;
    document.getElementById('circuito-nombre').value = c.nombre;
    document.getElementById('circuito-ubicacion').value = c.ubicacion;
    document.getElementById('circuito-modal-title').innerText = 'Editar Autódromo';
    openModal('modal-circuito');
}

async function guardarCircuitoForm(e) {
    e.preventDefault();
    if (!puedeEditar()) return;
    const id = document.getElementById('circuito-id').value;
    const circ = { nombre: document.getElementById('circuito-nombre').value, ubicacion: document.getElementById('circuito-ubicacion').value };
    if (id) circ.id = Number(id);
    await guardar('circuitos', circ);
    closeModal('modal-circuito');
    listarCategoriasCircuitos();
}

async function eliminarCircuito(id) {
    if (!puedeEditar()) return;
    if (!confirm('¿Eliminar este autódromo?')) return;
    await eliminar('circuitos', id);
    listarCategoriasCircuitos();
}

// ==================== GESTIÓN DE USUARIOS (SOLO ADMIN) ====================

async function listarUsuarios() {
    if (!esAdmin()) return;
    let usuarios = await getTodos('usuarios');

    // ============ FUENTE DE VERDAD: LA NUBE ============
    // IndexedDB es POR DISPOSITIVO: los usuarios creados en la consola de
    // Firebase o en otro equipo NO existían acá, por eso no aparecian nunca.
    //
    // La NUBE MANDA: si hay perfiles en Firestore, la lista es EXCLUSIVamente
    // la nube. Si no, se usa IndexedDB (app sin Firebase o primer arranque).
    const directorio = (typeof window !== 'undefined' && window.__CDA_MODULES__ && window.__CDA_MODULES__.usuarios) || null;
    let perfilesNube = [];
    if (directorio && typeof directorio.listarPerfilesConEstado === 'function') {
        const res = await directorio.listarPerfilesConEstado();
        if (!res.ok) {
            // ANTES: `listarPerfiles()` devolvía [] tanto si la colección estaba
            // vacía como si la lectura fallaba, y la UI caía a IndexedDB mostrando
            // usuarios que ya no existían en Firebase. Ahora el error se muestra.
            mostrarToast(res.mensaje || 'Error al leer los usuarios de Firebase.', 'error');
            return;
        }
        perfilesNube = res.perfiles;
    } else if (directorio && typeof directorio.listarPerfiles === 'function') {
        perfilesNube = await directorio.listarPerfiles();
    }

    if (perfilesNube.length) {
        // Sin fusionar: cada perfil de la nube es un documento único (id =
        // username). Fusionar con los locales generaba duplicados fantasma.
        usuarios = perfilesNube;
    }

    // El `username` es la clave unica e inmutable (es el ID del documento en
    // Firestore). Si por data pasada quedaron duplicados ('admin' dos veces),
    // se muestran solo el registro con el rol mas privilegiado.
    if (directorio && typeof directorio.limpiarDuplicadosLocales === 'function') {
        const { unicos } = await directorio.limpiarDuplicadosLocales(usuarios);
        usuarios = unicos;
    }

    const tbody = document.getElementById('config-usuarios-body');
    tbody.innerHTML = '';

    const rolesNombres = { admin: 'Administrador', editor: 'Editor', viewer: 'Visualizador', supervisor: 'Supervisor' };
    const rolesBadge = { admin: 'badge-role-admin', editor: 'badge-role-editor', viewer: 'badge-role-viewer', supervisor: 'badge-role-supervisor' };

    usuarios.forEach(u => {
        // Comparación tolerante: en la nube el id es el username (string) y en
        // IndexedDB es numérico. Comparar con `===` hacía que un usuario de la
        // nube NUNCA se reconociera como "yo" (y por eso no tenía botón de borrar).
        const esElMismo = !!currentUser && String(currentUser.id).toLowerCase() === String(u.id).toLowerCase();
        // El id viaja en un data-attribute, NO interpolado en un onclick.
        // Interpolar el id (que puede ser un string) dentro de onclick rompía el
        // HTML: las comillas del id cerraban el atributo y el navegador lanzaba
        // "SyntaxError: Unexpected end of input" al hacer clic.
        const fila = document.createElement('tr');
        fila.dataset.usuarioId = String(u.id);
        fila.innerHTML = `
            <td style="font-weight:600;">
                ${escapeHtml(u.username)}
                ${esElMismo ? '<span class="badge badge-info" style="font-size:0.7rem;margin-left:0.5rem;">Yo</span>' : ''}
            </td>
            <td>${escapeHtml(u.nombre)}</td>
            <td><span class="badge ${rolesBadge[u.rol]}">${rolesNombres[u.rol] || escapeHtml(u.rol)}</span></td>
            <td><span class="badge ${u.activo ? 'badge-active' : 'badge-inactive'}">${u.activo ? 'Activo' : 'Inactivo'}</span></td>
            <td style="text-align:right;">
                <button class="action-btn" data-accion="editar" title="Editar"><i class="fa-solid fa-pen-to-square"></i></button>
                ${!esElMismo ? `<button class="action-btn delete" data-accion="eliminar" title="Eliminar"><i class="fa-solid fa-trash"></i></button>` : ''}
            </td>
        `;
        tbody.appendChild(fila);
    });

    _conectarAccionesUsuarios(tbody);
}

// Delegación de eventos: un solo listener en el <tbody> en lugar de N onclick
// con el id interpolado (fuente del SyntaxError). Además evita regenerar listeners.
let _accionesUsuariosConectadas = false;
function _conectarAccionesUsuarios(tbody) {
    if (_accionesUsuariosConectadas) return;
    _accionesUsuariosConectadas = true;
    tbody.addEventListener('click', (ev) => {
        const btn = ev.target.closest('button[data-accion]');
        if (!btn) return;
        const fila = btn.closest('tr[data-usuario-id]');
        if (!fila) return;
        const id = fila.dataset.usuarioId;
        if (!id) return;
        if (btn.dataset.accion === 'editar') editarUsuario(id);
        else if (btn.dataset.accion === 'eliminar') eliminarUsuario(id);
    });
}

/**
 * Busca un usuario por id tanto en la nube (id = username) como en IndexedDB
 * (id numérico). Sin esto, editar/borrar un usuario que vino de Firestore
 * fallaba en silencio porque `obtenerPorId` solo miraba el store local.
 */
async function _buscarUsuarioPorId(id) {
    const clave = String(id);
    const esNumerico = /^\d+$/.test(clave);

    // 1) Nube primero: es la fuente de verdad.
    const directorio = (typeof window !== 'undefined' && window.__CDA_MODULES__ && window.__CDA_MODULES__.usuarios) || null;
    if (directorio && typeof directorio.listarPerfiles === 'function') {
        const perfiles = await directorio.listarPerfiles();
        const encontrado = perfiles.find(p => String(p.id).toLowerCase() === clave.toLowerCase());
        if (encontrado) return encontrado;
    }

    // 2) IndexedDB: se compara por id Y por username (el id local puede diferir).
    try {
        const usuarios = await getTodos('usuarios');
        const encontrado = usuarios.find(u =>
            String(u.id) === clave ||
            String(u.username || '').toLowerCase() === clave.toLowerCase());
        if (encontrado) return encontrado;
    } catch (e) {
        console.warn('[usuarios] No se pudo leer el store local:', e);
    }
    return null;
}

// ==================== MATRIZ DE PERMISOS (MODAL NUEVO/EDITAR USUARIO) ====================

/**
 * Renderiza la matriz (grid) de permisos por módulo en el modal de usuario.
 * - Recorre CATALOGO_MODULOS ordenado por 'orden'.
 * - rol !== 'admin': el módulo 'configuracion' NO se renderiza (regla estricta).
 * - rol === 'admin': todos los módulos con todos los checkboxes marcados y
 *   deshabilitados (readonly), reflejando el acceso total garantizado por diseño.
 * - permisosIniciales: estado a reflejar (permisos granulares del usuario o preset
 *   de su rol). Si se omite, preserva las selecciones actuales de la matriz
 *   (útil al cambiar el rol en el desplegable).
 */
function renderizarMatrizPermisos(permisosIniciales) {
    const container = document.getElementById('usuario-permisos-container');
    if (!container) return;
    if (typeof CATALOGO_MODULOS === 'undefined') {
        console.warn('renderizarMatrizPermisos: permisosUtil.js no está cargado.');
        return;
    }

    // Sin argumento explícito → conservar lo que el admin ya tildó (cambio de rol en vivo).
    if (permisosIniciales === undefined) permisosIniciales = recolectarPermisosDelModal();

    const rol = document.getElementById('usuario-rol')?.value || 'viewer';
    const esRolAdmin = rol === 'admin';

    container.innerHTML = '';

    const titulo = document.createElement('label');
    titulo.style.cssText = 'display:block;font-weight:600;margin-bottom:0.5rem;';
    titulo.textContent = 'Permisos por módulo';
    container.appendChild(titulo);

    const nota = document.createElement('small');
    nota.style.cssText = 'display:block;color:var(--text-secondary);font-size:0.8rem;margin-bottom:0.75rem;';
    nota.textContent = esRolAdmin
        ? 'Como Administrador tiene control total de todos los módulos, incluida la Configuración.'
        : 'Definí qué módulos y funciones puede usar este usuario. La Configuración es exclusiva del Administrador.';
    container.appendChild(nota);

    const grid = document.createElement('div');
    grid.className = 'permisos-grid';
    // Se renderizan TODOS los módulos; la fila de 'configuracion' se crea oculta para
    // no-admins, de modo que aplicarPresetACheckboxes() pueda mostrarla/ocultarla
    // en vivo cuando cambie el rol en el combo (sin re-render completo).
    for (const modulo of [...CATALOGO_MODULOS].sort((a, b) => a.orden - b.orden)) {
        grid.appendChild(_crearFilaPermisosModulo(modulo, permisosIniciales, esRolAdmin));
    }
    container.appendChild(grid);
}

/** Crea la fila de un módulo: nombre + checkbox por cada función admitida. */
function _crearFilaPermisosModulo(modulo, permisosIniciales, esRolAdmin) {
    const fila = document.createElement('div');
    fila.className = 'permisos-modulo';
    fila.dataset.modulo = modulo.id;

    const nombre = document.createElement('span');
    nombre.className = 'permisos-modulo-nombre';
    nombre.innerHTML = `<i class="fa-solid ${modulo.icono}"></i> ${escapeHtml(modulo.nombre)}`;
    fila.appendChild(nombre);

    const acciones = document.createElement('div');
    acciones.className = 'permisos-acciones';
    for (const funcion of modulo.funciones) {
        const label = document.createElement('label');
        label.className = 'permisos-check';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.dataset.modulo = modulo.id;
        cb.dataset.funcion = funcion;
        cb.checked = esRolAdmin || permisosIniciales?.[modulo.id]?.[funcion] === true;
        if (esRolAdmin) cb.disabled = true; // readonly: el admin no se puede "recortar"

        if (!esRolAdmin) {
            cb.addEventListener('change', () => {
                // 'ver' es el interruptor maestro del módulo...
                if (funcion === 'ver') _sincronizarAccionesModulo(fila, cb.checked);
                // ...y cualquier cambio manual convierte al usuario en "Personalizado".
                marcarRolPersonalizado();
            });
        }

        label.appendChild(cb);
        label.appendChild(document.createTextNode(funcion));
        acciones.appendChild(label);
    }
    fila.appendChild(acciones);

    // Regla estricta en la UI: la fila de Configuración está oculta para no-admins.
    if (modulo.soloAdmin && !esRolAdmin) {
        fila.style.display = 'none';
    } else if (!esRolAdmin) {
        _sincronizarAccionesModulo(fila, permisosIniciales?.[modulo.id]?.ver === true);
    }
    return fila;
}

/** Habilita/deshabilita las acciones de un módulo según el estado del checkbox 'ver'. */
function _sincronizarAccionesModulo(fila, verActivo) {
    fila.querySelectorAll('input[data-funcion]').forEach(cb => {
        if (cb.dataset.funcion === 'ver') return;
        cb.disabled = !verActivo;
        if (!verActivo) cb.checked = false;
    });
}

/**
 * Recorre la matriz del modal y construye el objeto estructurado `permisos`:
 * { moduloId: { ver: true, crear: true, ... }, ... } — solo con los flags en true.
 */
function recolectarPermisosDelModal() {
    const permisos = {};
    const container = document.getElementById('usuario-permisos-container');
    if (!container) return permisos;
    container.querySelectorAll('input[data-modulo][data-funcion]:checked').forEach(cb => {
        const fila = _filaDeCheckbox(cb);
        if (fila && fila.style.display === 'none') return; // fila oculta (configuracion no-admin)
        (permisos[cb.dataset.modulo] ||= {})[cb.dataset.funcion] = true;
    });
    return permisos;
}

/** Devuelve la fila (.permisos-modulo) a la que pertenece un checkbox. */
function _filaDeCheckbox(cb) {
    if (typeof cb.closest === 'function') return cb.closest('.permisos-modulo');
    let nodo = cb.parentElement;
    while (nodo) {
        if (String(nodo.className).split(' ').includes('permisos-modulo')) return nodo;
        nodo = nodo.parentElement;
    }
    return null;
}

// ==================== SELECTOR DE ROLES DINÁMICO (DICCIONARIO_ROLES) ====================

/**
 * Repuebla el <select> de roles recorriendo DICCIONARIO_ROLES (id + label) y agrega
 * siempre al final la opción fija "Personalizado", deshabilitada por defecto: solo
 * se activa si el admin altera manualmente la cuadrícula de checkboxes.
 */
function poblarSelectorRoles(rolPorDefecto) {
    const sel = document.getElementById('usuario-rol');
    if (!sel || typeof DICCIONARIO_ROLES === 'undefined') return;

    sel.innerHTML = '';
    Object.entries(DICCIONARIO_ROLES).forEach(([id, def]) => {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = def.label;
        sel.appendChild(opt);
    });

    const personalizado = document.createElement('option');
    personalizado.value = 'personalizado';
    personalizado.textContent = 'Personalizado (permisos a medida)';
    personalizado.disabled = true;
    sel.appendChild(personalizado);

    // Rol base: el rol "real" del usuario mientras personalice sus permisos.
    sel.dataset.rolBase = rolPorDefecto || Object.keys(DICCIONARIO_ROLES)[0];
    sel.value = sel.dataset.rolBase;
}

/**
 * Aplica en vivo el preset de un rol sobre los checkboxes existentes (sin re-render):
 *   - admin → TODO en true + disabled (incluye 'configuracion', fila visible).
 *   - otros → habilita los checkboxes y marca según el preset del diccionario;
 *             la fila de 'configuracion' queda oculta por completo.
 * Guarda el rol como rolBase en el <select> para el guardado.
 */
function aplicarPresetACheckboxes(rol) {
    const container = document.getElementById('usuario-permisos-container');
    const sel = document.getElementById('usuario-rol');
    if (!container) return;
    if (typeof DICCIONARIO_ROLES === 'undefined') return;

    const defRol = DICCIONARIO_ROLES[rol];
    const esRolAdmin = Boolean(defRol?.accesoTotal);
    const preset = esRolAdmin ? null : (defRol?.preset || {});

    container.querySelectorAll('input[data-modulo][data-funcion]').forEach(cb => {
        const fila = _filaDeCheckbox(cb);
        const esFilaSoloAdmin = Boolean(MODULOS_MAP[cb.dataset.modulo]?.soloAdmin);

        // Regla estricta visible: la fila solo se muestra para roles con acceso total.
        if (fila) fila.style.display = (esFilaSoloAdmin && !esRolAdmin) ? 'none' : '';

        if (esRolAdmin) {
            cb.checked = true;
            cb.disabled = true;
            return;
        }
        cb.disabled = false;
        cb.checked = preset?.[cb.dataset.modulo]?.[cb.dataset.funcion] === true;
    });

    // Re-sincroniza el interruptor maestro 'ver' de cada fila visible no-admin.
    if (!esRolAdmin) {
        container.querySelectorAll('.permisos-modulo').forEach(fila => {
            if (fila.style.display === 'none') return;
            const verCb = fila.querySelector('input[data-funcion="ver"]');
            if (verCb) _sincronizarAccionesModulo(fila, verCb.checked);
        });
    }

    if (sel) sel.dataset.rolBase = rol;
}

/**
 * Activa la opción "Personalizado" del combo y la selecciona. Se dispara ante
 * cualquier cambio manual en la cuadrícula: comunica visualmente que el usuario
 * ya no rige por un preset estándar sino por permisos a medida.
 */
function marcarRolPersonalizado() {
    const sel = document.getElementById('usuario-rol');
    if (!sel || sel.value === 'personalizado') return;
    const opt = sel.querySelector('option[value="personalizado"]');
    if (!opt) return;
    opt.disabled = false;
    sel.value = 'personalizado';
}

/**
 * Handler del 'change' del <select> de roles: sincroniza la cuadrícula con el
 * preset del rol elegido y refresca el resumen del modal.
 */
function onRolUsuarioChange() {
    const sel = document.getElementById('usuario-rol');
    if (!sel) return;
    // La opción 'Personalizado' no es seleccionable por el usuario (está disabled);
    // si llegara a dispararse con ese valor, se cae al rol base del usuario.
    const rol = sel.value === 'personalizado' ? (sel.dataset.rolBase || 'viewer') : sel.value;
    aplicarPresetACheckboxes(rol);
    actualizarResumenUsuarioModal();
}

function openModalUsuario() {
    if (!esAdmin()) return;
    document.getElementById('form-usuario').reset();
    document.getElementById('usuario-id').value = '';
    document.getElementById('usuario-modal-title').innerText = 'Nuevo Usuario';
    document.getElementById('usuario-password').required = true;
    document.getElementById('password-hint').style.display = 'none';
    // limpiar campo de hash mostrado para nuevo usuario
    const passwordToggle = document.getElementById('usuario-password-show');
    if (passwordToggle) passwordToggle.checked = false;
    // Selector de roles dinámico (DICCIONARIO_ROLES) + matriz con el preset del
    // rol por defecto (viewer, que es la primera opción tras el reset del form).
    poblarSelectorRoles('viewer');
    renderizarMatrizPermisos(DICCIONARIO_ROLES.viewer.preset);
    actualizarResumenUsuarioModal();
    openModal('modal-usuario');
}

async function editarUsuario(id) {
    if (!esAdmin()) return;
    // Busca en nube + local: un usuario de Firebase no está en IndexedDB, y
    // `obtenerPorId` (solo local) devolvía undefined -> el modal abría vacío.
    const u = await _buscarUsuarioPorId(id);
    if (!u) { mostrarToast('No se encontró el usuario.', 'error'); return; }
    document.getElementById('usuario-id').value = u.id;
    document.getElementById('usuario-nombre').value = u.nombre;
    document.getElementById('usuario-username').value = u.username;
    document.getElementById('usuario-activo').value = String(u.activo);
    // Selector dinámico: repuebla opciones, selecciona el rol del usuario y marca
    // 'Personalizado' si sus permisos difieren del preset de su rol.
    poblarSelectorRoles(DICCIONARIO_ROLES[u.rol] ? u.rol : undefined);
    if (usuarioTienePermisosPersonalizados(u) || !DICCIONARIO_ROLES[u.rol]) marcarRolPersonalizado();
    // Refleja en los checkboxes el estado actual (permisos granulares o preset legacy).
    renderizarMatrizPermisos(obtenerPermisosEfectivos(u));
    document.getElementById('usuario-password').value = '';
    document.getElementById('usuario-password').required = false;
    document.getElementById('password-hint').style.display = 'block';
    document.getElementById('usuario-modal-title').innerText = 'Editar Usuario';
    const passwordToggle = document.getElementById('usuario-password-show');
    if (passwordToggle) passwordToggle.checked = false;
    actualizarResumenUsuarioModal();
    openModal('modal-usuario');
}

async function guardarUsuarioForm(e) {
    e.preventDefault();
    if (!esAdmin()) return;

    // Bloqueo de reentrada: la funcion es async (espera a Firestore) y el boton
    // es type="submit". Sin este candado, dos clics rapidos ejecutan el guardado
    // dos veces y se emiten dos toasts/error duplicados.
    const btn = document.getElementById('usuario-guardar-btn');
    if (guardarUsuarioEnCurso) return;
    guardarUsuarioEnCurso = true;
    if (btn) { btn.disabled = true; btn.innerHTML = 'Guardando...'; }

    try {
        await guardarUsuarioFormInterno(e);
    } finally {
        guardarUsuarioEnCurso = false;
        if (btn) { btn.disabled = false; btn.innerHTML = 'Guardar Usuario'; }
    }
}

// Candado de guardado del formulario de usuario (evita envios duplicados).
let guardarUsuarioEnCurso = false;

async function guardarUsuarioFormInterno() {
    const id = document.getElementById('usuario-id').value;
    const username = document.getElementById('usuario-username').value.trim();
    const nombre = document.getElementById('usuario-nombre').value.trim();
    const selRol = document.getElementById('usuario-rol');
    // 'Personalizado' no es un rol persistible: se guarda el rol base sobre el que se
    // hicieron los ajustes; los permisos finos viajan en usuario.permisos (Capa 2).
    const rol = selRol.value === 'personalizado'
        ? (selRol.dataset.rolBase || 'editor')
        : selRol.value;
    const activo = document.getElementById('usuario-activo').value === 'true';
    const password = document.getElementById('usuario-password').value;

    // El username es la clave primaria en Firestore (es el ID del documento), asi
    // que debe ser UNICO en toda la app. El mensaje nombra al usuario que ya lo
    // ocupa, para que el admin entienda por que le rechazan el guardado.
    // El id puede venir como string (usuarios de la nube, donde el id es el
    // username). `Number(...)` lo convertía en NaN y rompía toda la edición.
    const idNum = id ? String(id) : null;
    // Verificación NUBE-PRIMERO (mismo criterio que listarUsuarios): la nube es
    // la fuente de verdad. Se distingue "nube leída y el nombre está libre"
    // (sinNube/sinSesion = false) de "la nube no respondió": perfilesNube queda
    // null y la verificación cae a SOLO local (conservadora).
    const directorio = (typeof window !== 'undefined' && window.__CDA_MODULES__ && window.__CDA_MODULES__.usuarios) || null;
    let perfilesNube = null;
    if (directorio && typeof directorio.listarPerfilesConEstado === 'function') {
        const resNube = await directorio.listarPerfilesConEstado();
        if (resNube && resNube.ok && !resNube.sinNube && !resNube.sinSesion) {
            perfilesNube = Array.isArray(resNube.perfiles) ? resNube.perfiles : [];
        }
    } else if (directorio && typeof directorio.listarPerfiles === 'function') {
        perfilesNube = await directorio.listarPerfiles();
    }
    if (Array.isArray(perfilesNube)) {
        const choqueNube = perfilesNube.find(u =>
            String(u.username || '').toLowerCase() === username.toLowerCase() &&
            String(u.id) !== idNum);
        if (choqueNube) {
            mostrarToast(`El nombre "${username}" ya lo usa ${choqueNube.nombre || choqueNube.username}. ` +
                'Elegí otro nombre o eliminá ese usuario primero.', 'error');
            return;
        }
    }
    // Copias locales con el mismo username pero distinto id. En ALTA son
    // "fantasmas": sobraron de borrados hechos con la sync apagada y bloqueaban
    // reutilizar el nombre. Con la nube verificada se purgan; sin nube
    // verificada se corta el alta (no se puede distinguir de un duplicado).
    const localesMismoNombre = (await getTodos('usuarios', { soloLocal: true })).filter(u =>
        String(u.username || '').toLowerCase() === username.toLowerCase() &&
        String(u.id) !== idNum);
    if (!id && localesMismoNombre.length) {
        if (Array.isArray(perfilesNube)) {
            for (const fantasma of localesMismoNombre) {
                await eliminar('usuarios', fantasma.id);
            }
            console.info('[usuarios] Se purgaron ' + localesMismoNombre.length +
                ' copia(s) local(es) fantasma de "' + username + '".');
        } else {
            mostrarToast(`El nombre "${username}" ya lo usa ${localesMismoNombre[0].nombre || localesMismoNombre[0].username}. ` +
                'Elegí otro nombre o eliminá ese usuario primero.', 'error');
            return;
        }
    }
    if (!username) {
        mostrarToast('El nombre de usuario es obligatorio.', 'error');
        return;
    }

    const usuario = { username, nombre, rol, activo };

    // ===== Permisos granulares — Capa 2 OBLIGATORIA antes de persistir =====
    // (1) Limpieza total: se descarta cualquier estado previo y se mapea la grilla
    //     desde cero sobre un objeto nuevo (sin copias superficiales ni mutaciones).
    // (2) El resultado pasa SIEMPRE por normalizarPermisos(): elimina 'configuracion'
    //     si el rol no es admin, descarta claves desconocidas y completa con false.
    const permisosRecolectados = JSON.parse(JSON.stringify(recolectarPermisosDelModal() || {}));
    usuario.permisos = (typeof normalizarPermisos === 'function')
        ? normalizarPermisos(rol, permisosRecolectados)
        : obtenerPermisosEfectivos({ rol });

    if (id) {
        // Usuario de la nube: su id ES el username (string). No se fuerza a
        // Number() porque daria NaN y se perderia el vinculo con el documento.
        const esNube = !/^\d+$/.test(String(id));
        usuario.id = esNube ? String(id) : Number(id);
        if (password) {
            usuario.passwordHash = await hashPassword(password);
        } else {
            const existente = await _buscarUsuarioPorId(id);
            usuario.passwordHash = existente ? existente.passwordHash : undefined;
        }
    } else {
        if (!password) { mostrarToast('La contraseña es obligatoria para nuevos usuarios.', 'error'); return; }
        usuario.passwordHash = await hashPassword(password);
    }

    // ===== INTEGRACION FIREBASE (identidad en Auth + perfil en Firestore) =====
    // El servicio de directorio es la UNICA via que escribe en la nube.
    // Nunca escribe `passwordHash`: ese campo queda solo en IndexedDB.
    // (`directorio` se declaró arriba, junto a la verificación de choque.)
    if (!directorio) {
        console.warn('[usuarios] Directorio en la nube no disponible; se guarda solo en local.');
    } else if (!id) {
        // ---- ALTA: primero la identidad en Firebase Auth, luego el perfil ----
        const res = await directorio.crearUsuario({ username, nombre, rol, activo, permisos: usuario.permisos, password });
        if (!res.ok) {
            mostrarToast(res.mensaje, 'error');
            return;
        }
        // La nube no respondió (sin SDK o sin sesión): el alta quedo solo en
        // este dispositivo. Se avisa para que el admin no asuma que es
        // multi-dispositivo.
        if (res.nube === false) {
            mostrarToast('Usuario guardado solo en este dispositivo (sin conexión o sin sesión de Firebase).', 'warning');
        }
    } else {
        // ---- EDICION: solo el perfil. La contrasena NO se toca en Auth ----
        // `usernameAnterior` es imprescindible: el ID del documento en Firestore
        // ES el username, asi que al renombrar hay que borrar el documento viejo.
        const previo = await _buscarUsuarioPorId(id);
        const res = await directorio.actualizarPerfil({
            username, nombre, rol, activo,
            permisos: usuario.permisos,
            usernameAnterior: previo ? previo.username : username
        });
        if (!res.ok) {
            mostrarToast('No se pudo sincronizar el perfil a la nube: ' + res.mensaje, 'error');
            return;
        }

        if (res.nube === false) {
            // La nube no respondió: la edición se persiste SOLO en IndexedDB
            // (se continúa con el `guardar` de mas abajo). Antes se informaba
            // "actualizado correctamente" sin guardar en NINGÚN lado.
            // El store `usuarios` usa clave numérica: un id de nube (string)
            // daría NaN y el validador rechazaría el registro. Se libera el id
            // y `guardar()` genera uno nuevo (copia local colapsada por
            // username en el listado y purgada en el próximo borrado del alias).
            if (!/^\d+$/.test(String(usuario.id))) delete usuario.id;
            console.info('[usuarios] Edición sin nube: se persiste el cambio en IndexedDB.');
        } else {
            // Un usuario que vive en la nube NO se duplica en IndexedDB: su perfil
            // ya quedó escrito en Firestore. Escribirlo local creaba un registro
            // fantasma con el mismo username y el listado lo duplicaba.
            // `mostrarToast` renderiza con `textContent`: no necesita `escapeHtml`
            // (de hecho, escaparlo aqui produciria doble escapado visible).
            mostrarToast(`Usuario actualizado correctamente. Usuario: ${usuario.username}${password ? ' | Contraseña actualizada' : ' | Contraseña sin cambios'}`, 'success');
            closeModal('modal-usuario');
            await listarUsuarios();
            return;
        }
    }

    // `guardar()` devuelve null cuando el validador rechaza el registro.
    // Sin esta comprobacion, la UI anunciaba exito aunque no se escribiera nada.
    const guardado = await guardar('usuarios', usuario);
    if (guardado === null || guardado === undefined) {
        mostrarToast('No se pudo guardar el usuario (registro rechazado por el validador). Revisá la consola.', 'error');
        return;
    }

    if (currentUser && String(currentUser.id) === String(usuario.id)) {
        currentUser = { ...currentUser, ...usuario };
        document.getElementById('sidebar-user-name').textContent = usuario.nombre;
        document.getElementById('sidebar-avatar').textContent = usuario.nombre.charAt(0).toUpperCase();
        // Re-sanea permisos y refresca el menú lateral con los permisos actualizados.
        currentUser.permisos = obtenerPermisosEfectivos(currentUser);
        renderizarMenuLateral(currentUser);
    }

    // `mostrarToast` renderiza con `textContent`: no necesita `escapeHtml`
    // (de hecho, escaparlo aqui produciria doble escapado visible).
    mostrarToast(`Usuario guardado correctamente. Usuario: ${usuario.username}${password ? ' | Contraseña actualizada' : ' | Contraseña sin cambios'}`, 'success');
    closeModal('modal-usuario');
    await listarUsuarios();
}

function togglePasswordVisibilityModal() {
    const passwordInput = document.getElementById('usuario-password');
    const checkbox = document.getElementById('usuario-password-show');
    if (!passwordInput || !checkbox) return;
    passwordInput.type = checkbox.checked ? 'text' : 'password';
}

// Abre el sub-modal de gestión de tipos de movimiento (solo Admin..
function abrirGestionTiposMovimientoV10() {
    if (!esAdmin()) return;
    renderizarListaTiposMovimiento();
    openModal('subModalGestionTiposMovimiento');
}

// Renderiza la lista de tipos (canónicos + personalizados) con toggle Activar/Desactivar..
async function renderizarListaTiposMovimiento() {
    const container = document.getElementById('lista-tipos-movimiento');
    if (!container) return;
    const tipos = await getTodos('tiposMovimiento');
    container.innerHTML = '';
    if (!tipos || tipos.length === 0) {
        container.innerHTML = '<span style="color:var(--text-secondary);font-size:0.85rem;text-align:center;padding:0.5rem;">No hay tipos registrados.</span>';
        return;
    }
    const CANONICOS_V10 = ['ingreso', 'consumo', 'transferencia_interna', 'devolucion', 'baja', 'ajuste'];
    for (const t of tipos) {
        const div = document.createElement('div');
        div.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0.75rem;background:var(--bg-secondary);border-radius:6px;border:1px solid var(--border-color);';
        const spanWrap = document.createElement('span');
        spanWrap.style.cssText = 'display:flex;align-items:center;gap:0.4rem;';
        const span = document.createElement('span');
        span.textContent = t.label || t.valor;
        span.style.cssText = 'font-weight:500;';
        spanWrap.appendChild(span);
        const natBadge = document.createElement('span');
        natBadge.className = 'badge badge-info';
        natBadge.style.fontSize = '0.7rem';
        natBadge.textContent = 'Naturaleza: ' + (t.naturaleza || t.valor);
        spanWrap.appendChild(natBadge);
        if (CANONICOS_V10.includes(t.valor)) {
            const canBadge = document.createElement('span');
            canBadge.className = 'badge badge-active';
            canBadge.style.fontSize = '0.7rem';
            canBadge.textContent = 'Canónico';
            spanWrap.appendChild(canBadge);
        }
        if (t.activo === false) {
            const inactBadge = document.createElement('span');
            inactBadge.className = 'badge badge-inactive';
            inactBadge.style.fontSize = '0.7rem';
            inactBadge.textContent = 'Inactivo';
            spanWrap.appendChild(inactBadge);
        }
        const btnWrap = document.createElement('span');
        btnWrap.style.cssText = 'display:flex;align-items:center;gap:0.3rem;';
        const btnToggle = document.createElement('button');
        btnToggle.type = 'button';
        btnToggle.className = 'action-btn';
        btnToggle.title = t.activo === false ? 'Activar tipo' : 'Desactivar tipo';
        btnToggle.innerHTML = t.activo === false ? '<i class="fa-solid fa-play"></i>' : '<i class="fa-solid fa-pause"></i>';
        btnToggle.onclick = () => toggleTipoMovimientoActivoV10(t.id);
        btnWrap.appendChild(btnToggle);
        div.appendChild(spanWrap);
        div.appendChild(btnWrap);
        container.appendChild(div);
    }
}

// Crea un tipo personalizado vinculado a una naturaleza canónica (la matemática de stock que
// heredará). Respalda en IndexedDB y se refleja a Firestore vía guardar()..
async function agregarTipoMovimientoV10() {
    if (!esAdmin()) return;
    const input = document.getElementById('nuevo-tipo-nombre');
    const naturalezaSel = document.getElementById('nuevo-tipo-naturaleza');
    if (!input || !naturalezaSel) return;
    const nombre = input.value.trim();
    if (!nombre) { mostrarToast('Ingresá el nombre del tipo.', 'warning'); return; }
    const slug = nombre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!slug) { mostrarToast('Nombre inválido para generar el identificador.', 'error'); return; }
    const naturaleza = naturalezaSel.value;
    const tipos = await getTodos('tiposMovimiento');
    if (tipos.some(t => String(t.valor).toLowerCase() === slug.toLowerCase())) {
        mostrarToast('Ya existe un tipo con ese identificador.', 'error');
        return;
    }
    await guardar('tiposMovimiento', { valor: slug, label: nombre, naturaleza, activo: true });
    invalidarCache('tiposMovimiento');
    input.value = '';
    await renderizarListaTiposMovimiento();
    await poblarSelectTiposMovimientoV9();
    // Preseleccionar el nuevo tipo en el formulario de fondo..
    const selMov = document.getElementById('movimiento-tipo');
    if (selMov) selMov.value = slug;
    mostrarToast(`Tipo "${nombre}" creado y preseleccionado.`);
}

// Toggle Activar/Desactivar de un tipo de movimiento (solo Admin..
async function toggleTipoMovimientoActivoV10(id) {
    if (!esAdmin()) return;
    const t = await obtenerPorId('tiposMovimiento', Number(id));
    if (!t) return;
    t.activo= t.activo === false ? true : false;
    await guardar('tiposMovimiento', t);
    invalidarCache('tiposMovimiento');
    await renderizarListaTiposMovimiento();
    await poblarSelectTiposMovimientoV9();
    mostrarToast(`Tipo "${t.label || t.valor}" ${t.activo ? 'activado' : 'desactivado'}.`);
}

async function eliminarUsuario(id) {
    if (!esAdmin()) return;
    // Comparación tolerante: el id de la nube es string (username) y el local numérico.
    const clave = String(id);
    if (currentUser && String(currentUser.id) === clave) {
        mostrarToast('No podés eliminar tu propio usuario.', 'error');
        return;
    }

    // El objetivo se resuelve en nube + local: sin esto, `obtenerPorId` (solo
    // local) devolvía undefined y el borrado no sabía a quién eliminar.
    const objetivo = await _buscarUsuarioPorId(id);
    if (!objetivo) { mostrarToast('No se encontró el usuario.', 'error'); return; }

    const total = (typeof window !== 'undefined' && window.__CDA_MODULES__ &&
        window.__CDA_MODULES__.usuarios && typeof window.__CDA_MODULES__.usuarios.listarPerfiles === 'function')
        ? (await window.__CDA_MODULES__.usuarios.listarPerfiles()).length
        : (await getTodos('usuarios')).length;
    if (total <= 1) {
        mostrarToast('Debe existir al menos un usuario en el sistema.', 'error');
        return;
    }

    const confirmado = await mostrarConfirmacion(
        'Eliminar usuario',
        `¿Eliminar a "${objetivo.username}" permanentemente?`,
        'warning'
    );

    if (!confirmado) return;

    // 1) Primero la nube: si el nombre queda tomado en Firebase Auth (esa cuenta
    //    no se puede borrar desde el cliente), el usuario no podría crearse nunca.
    const directorio = (typeof window !== 'undefined' && window.__CDA_MODULES__ && window.__CDA_MODULES__.usuarios) || null;
    let falloNube = null;
    if (directorio && typeof directorio.eliminarPerfil === 'function') {
        const resNube = await directorio.eliminarPerfil(objetivo.username);
        if (!resNube.ok) falloNube = resNube.mensaje || 'error desconocido';
    }

    // 2) Después el registro local (si existía en este dispositivo).
    try {
        if (/^\d+$/.test(clave)) await eliminar('usuarios', Number(clave));
        // Un usuario de la nube tiene id = username (string), asi que el borrado
        // por id numérico de arriba se saltaba cualquier copia local duplicada
        // (mismo username, id numérico) y quedaba como fantasma en IndexedDB.
        const usernameObjetivo = String(objetivo.username || '').toLowerCase();
        if (usernameObjetivo) {
            const locales = await getTodos('usuarios', { soloLocal: true });
            for (const u of locales) {
                if (String(u.username || '').toLowerCase() === usernameObjetivo &&
                    /^\d+$/.test(String(u.id))) {
                    await eliminar('usuarios', Number(u.id));
                }
            }
        }
    } catch (e) {
        console.warn('[usuarios] No se pudo borrar el registro local:', e);
    }

    if (falloNube) {
        mostrarToast('Se eliminó, pero el perfil en la nube no se pudo borrar: ' +
            falloNube + '. Si el nombre no se libera, puede quedar tomado en Firebase.', 'warning');
    } else {
        mostrarToast('Usuario eliminado correctamente.', 'success');
    }
    await listarUsuarios();
}

// ==================== PURGA DE USUARIOS (SOLO ADMIN) ====================

/**
 * Borra TODOS los perfiles de Firebase salvo los administradores ancla
 * (admin@controlcda.com), más el usuario local actual.
 *
 * Es la herramienta de recuperación cuando quedan documentos huérfanos o
 * duplicados que el borrado individual no logra limpiar. NO toca las cuentas
 * de Firebase Authentication: eso requiere una Cloud Function con Admin SDK
 * (el cliente web no puede administrar usuarios de Auth).
 */
async function purgarUsuarios() {
    if (!esAdmin()) return;

    const directorio = (typeof window !== 'undefined' && window.__CDA_MODULES__ && window.__CDA_MODULES__.usuarios) || null;
    if (!directorio || typeof directorio.purgarPerfilesExcepto !== 'function') {
        mostrarToast('La purga no está disponible en esta versión.', 'error');
        return;
    }

    const confirmado = await mostrarConfirmacion(
        'Purgar usuarios',
        'Se eliminarán TODOS los perfiles de Firebase salvo el administrador ancla (admin@controlcda.com). ' +
        'Las cuentas de Firebase Authentication (emails) NO se borran. ¿Continuar?',
        'warning'
    );
    if (!confirmado) return;

    // Se conservan los admins ancla (importados del módulo de credenciales) y,
    // por si acaso, el propio usuario conectado.
    const modulos = (typeof window !== 'undefined' && window.__CDA_MODULES__) || {};
    const ancla = ((modulos.credenciales && modulos.credenciales.ADMINS_ANCLA) || ['admin@controlcda.com'])
        .map((email) => String(email).split('@')[0].toLowerCase());
    const conservar = ancla.slice();
    if (currentUser && currentUser.username) {
        const yo = String(currentUser.username).toLowerCase();
        if (ancla.indexOf(yo) === -1) conservar.push(yo);
    }

    const res = await directorio.purgarPerfilesExcepto(conservar);

    if (res.restantes === null) {
        mostrarToast('No se pudo verificar la purga: ' + (res.mensaje || 'error desconocido'), 'error');
    } else if (res.ok) {
        mostrarToast(res.borrados.length
            ? 'Se purgaron ' + res.borrados.length + ' perfil(es). Solo queda(n) los administradores.'
            : 'No había perfiles para purgar.', 'success');
    } else {
        mostrarToast('Purga incompleta: ' + (res.mensaje || 'quedaron perfiles sin borrar') +
            '. Fallaron ' + res.fallidos.length + '.', 'error');
    }

    await listarUsuarios();
}

// ==================== EXPORTACIÓN / IMPORTACIÓN ====================

async function exportarDatos() {
    if (!puedeEditar()) return;
    const backup = {
        categorias: await getTodos('categorias'),
        circuitos: await getTodos('circuitos'),
        staff: await getTodos('staff'),
        competencias: await getTodos('competencias'),
        gastos: await getTodos('gastos'),
        conceptos: await getTodos('conceptos'),
        rendiciones: await getTodos('rendiciones'),
        detalleGastos: await getTodos('detalleGastos'),
        adjuntos: await getTodos('adjuntos'),
        proveedores: await getTodos('proveedores'),
        campeonatos: await getTodos('campeonatos'),
        categoriasInventario: await getTodos('categoriasInventario'),
        subcategoriasInventario: await getTodos('subcategoriasInventario'),
        talles: await getTodos('talles'),
        articulos: await getTodos('articulos'),
        articuloTalles: await getTodos('articuloTalles'),
        movimientosInventario: await getTodos('movimientosInventario'),
        entregasInventario: await getTodos('entregasInventario'),
        detalleEntregas: await getTodos('detalleEntregas'),
        imagenesArticulo: await getTodos('imagenesArticulo'),
        personalCompetencia: await getTodos('personalCompetencia'),
        ubicacionesInventario: await getTodos('ubicacionesInventario'),
        penalidades: await getTodos('penalidades'),
        tiposSancion: await getTodos('tiposSancion'),
        autorizaciones: await getTodos('autorizaciones')
    };
    const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(JSON.stringify(backup, null, 2))}`;
    const a = document.createElement('a');
    a.setAttribute('href', jsonString);
    a.setAttribute('download', `pitlane_backup_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(a);
    a.click();
    a.remove();
}

async function importarDatos(e) {
    if (!puedeEditar()) return;
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const data = JSON.parse(event.target.result);
            if (data.categorias || data.circuitos || data.staff || data.competencias || data.gastos) {
                if (confirm('ATENCIÓN: Se reemplazarán todos los datos actuales de carreras, categorías, circuitos y gastos. Los usuarios no se afectarán. ¿Continuar?')) {
                    await importarTodo(data);
                    alert('Datos importados correctamente.');
                    const activeView = document.querySelector('.view.active').id.replace('view-', '');
                    cargarDatosVista(activeView);
                }
            } else {
                alert('El archivo no parece ser un backup válido.');
            }
        } catch(err) {
            alert('Error al leer el archivo JSON.');
        }
    };
    reader.readAsText(file);
    e.target.value = '';
}

// ==================== SELECTORES Y HELPERS DE FORMULARIOS ====================

async function actualizarSelectoresFormularios() {
    const categorias = deduplicarCategorias(await getTodos('categorias'));
    const circuitos = deduplicarCircuitos(await getTodos('circuitos'));
    const competencias = await getTodos('competencias');
    const staff = await getTodos('staff');

    // Helper para construir <option> de forma segura escapando valores
    function opcionSegura(value, texto) { return `<option value="${value}">${escapeHtml(texto)}</option>`; }

    const selectCircuito = document.getElementById('competencia-circuito');
    const savedCirc = selectCircuito.value;
    selectCircuito.innerHTML = '<option value="">Seleccione un autódromo...</option>';
    circuitos.forEach(c => selectCircuito.innerHTML += opcionSegura(c.id, `${c.nombre} (${c.ubicacion})`));
    selectCircuito.value = savedCirc;

    const checkContainer = document.getElementById('competencia-categorias-checkboxes');
    const checkedIds = Array.from(checkContainer.querySelectorAll('input:checked')).map(cb => cb.value);
    checkContainer.innerHTML = '';
    categorias.filter(cat => cat.activo !== false).forEach(cat => {
        checkContainer.innerHTML += `
            <label class="checkbox-label">
                <input type="checkbox" value="${cat.id}" ${checkedIds.includes(String(cat.id)) ? 'checked' : ''} onchange="actualizarCodigoCompetenciaPorCategoria()">
                <span>${escapeHtml(cat.nombre)}</span>
            </label>`;
    });

    const staffContainer = document.getElementById('competencia-staff-checkboxes');
    if (staffContainer) {
        const checkedStaffIds = Array.from(staffContainer.querySelectorAll('input:checked')).map(cb => cb.value);
        staffContainer.innerHTML = '';
        if (staff.length === 0) {
            staffContainer.innerHTML = '<p style="color:var(--text-secondary); margin:0;">No hay personal registrado. Agrega personal primero.</p>';
        } else {
            staff.filter(persona => persona.activo !== false).forEach(persona => {
                staffContainer.innerHTML += `
                    <label class="checkbox-label">
                        <input type="checkbox" value="${persona.id}" ${checkedStaffIds.includes(String(persona.id)) ? 'checked' : ''}>
                        <span>${escapeHtml(persona.nombre)} ${escapeHtml(persona.apellido)} (${escapeHtml(persona.funcion)})</span>
                    </label>`;
            });
        }
    }

    const selectGastoComp = document.getElementById('gasto-competencia');
    const savedComp = selectGastoComp.value;
    selectGastoComp.innerHTML = '<option value="">Seleccione la carrera...</option>';
    competencias.forEach(c => selectGastoComp.innerHTML += opcionSegura(c.id, c.nombre));
    selectGastoComp.value = savedComp;

    const selectGastoCat = document.getElementById('gasto-categoria');
    if (selectGastoCat) {
        const savedCat = selectGastoCat.value;
        selectGastoCat.innerHTML = '<option value="">Seleccione la categoría...</option><option value="general">General / Compartido</option>';
        categorias.forEach(cat => selectGastoCat.innerHTML += opcionSegura(cat.id, cat.nombre));
        selectGastoCat.value = savedCat;
    }

    const datalistConceptos = document.getElementById('conceptos-sugeridos');
    const conceptos = await getTodos('conceptos');
    datalistConceptos.innerHTML = '';
    conceptos.forEach(conc => datalistConceptos.innerHTML += `<option value="${escapeHtml(conc.nombre)}"></option>`);

    const filterCat = document.getElementById('filtro-categoria-gastos');
    const savedFilterCat = filterCat.value;
    filterCat.innerHTML = '<option value="todos">Todas las categorías</option><option value="general">Gasto General / Compartido</option>';
    categorias.forEach(cat => filterCat.innerHTML += opcionSegura(cat.id, cat.nombre));
    filterCat.value = savedFilterCat;

    const filterComp = document.getElementById('filtro-competencia-gastos');
    const savedFilterComp = filterComp.value;
    filterComp.innerHTML = '<option value="todos">Todas las competencias</option>';
    competencias.forEach(c => filterComp.innerHTML += opcionSegura(c.id, c.nombre));
    filterComp.value = savedFilterComp;

    const filtroCatCal = document.getElementById('calendario-filtro-categoria');
    if (filtroCatCal) {
        const saved = filtroCatCal.value;
        filtroCatCal.innerHTML = '<option value="todos">Todas</option>';
        categorias.forEach(cat => filtroCatCal.innerHTML += opcionSegura(cat.id, cat.nombre));
        filtroCatCal.value = saved || 'todos';
    }

    const filtroMesCal = document.getElementById('calendario-filtro-mes');
    if (filtroMesCal) {
        const savedM = filtroMesCal.value;
        const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
        filtroMesCal.innerHTML = '<option value="todos">Todos</option>';
        meses.forEach((m, idx) => filtroMesCal.innerHTML += '<option value="' + (idx+1) + '">' + escapeHtml(m) + '</option>');
        filtroMesCal.value = savedM || 'todos';
    }

    const filtroAnoCal = document.getElementById('calendario-filtro-ano');
    if (filtroAnoCal) {
        const savedY = filtroAnoCal.value;
        const anos = new Set();
        competencias.forEach(c => {
            if (c.fechaInicio) anos.add(new Date(c.fechaInicio).getFullYear());
            if (c.fechaFin) anos.add(new Date(c.fechaFin).getFullYear());
        });
        const anosArr = Array.from(anos).sort((a,b) => b-a);
        filtroAnoCal.innerHTML = '<option value="todos">Todos</option>';
        anosArr.forEach(y => filtroAnoCal.innerHTML += '<option value="' + y + '">' + y + '</option>');
        filtroAnoCal.value = savedY || 'todos';
    }
}

function normalizarNombreCatalogo(nombre) {
    return String(nombre || '')
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

function deduplicarCategorias(categorias) {
    return Array.from(new Map(
        (categorias || [])
            .filter(c => c && normalizarNombreCatalogo(c.nombre))
            .map(c => [normalizarNombreCatalogo(c.nombre), c])
    ).values());
}

function deduplicarCircuitos(circuitos) {
    return Array.from(new Map(
        (circuitos || [])
            .filter(c => c && normalizarNombreCatalogo(c.nombre))
            .map(c => [
                `${normalizarNombreCatalogo(c.nombre)}|${normalizarNombreCatalogo(c.ubicacion)}`,
                c
            ])
    ).values());
}

async function actualizarResponsablePorCompetencia(valorPrecargado, nombreLibrePrecargado = '') {
    const selectComp = document.getElementById('rendicion-competencia');
    const selectResp = document.getElementById('rendicion-responsable');
    if (!selectComp || !selectResp) return;

    // ¿Es una precarga (edición de rendición existente) o un cambio manual del usuario?
    const esPrecarga = valorPrecargado !== undefined && valorPrecargado !== null && valorPrecargado !== '';
    const previo = esPrecarga ? String(valorPrecargado) : selectResp.value;
    const compId = Number(selectComp.value);

    if (!compId) {
        selectResp.disabled = true;
        selectResp.innerHTML = '<option value="">Seleccione primero una competencia...</option>';
        toggleResponsableLibre();
        return;
    }

    // Cargar competencia y catálogo de personal (desde caché/IndexedDB/Firebase).
    const [competencias, staff] = await Promise.all([getTodos('competencias'), getTodos('staff')]);
    const competencia = competencias.find(c => Number(c.id) === compId);
    const asignados = new Set((competencia?.staffIds || []).map(id => Number(id)));
    // Filtrado estricto: solo el personal cuyo ID está en staffIds de la competencia..
    const asignadosStaff = staff.filter(s => asignados.has(Number(s.id)));
    let opciones = '<option value="">Seleccione responsable...</option>';
    asignadosStaff.forEach(s => {
        opciones += `<option value="${s.id}">${escapeHtml(s.nombre)} ${escapeHtml(s.apellido)}</option>`;
    });
    opciones += '<option value="__OTRO__">Otro responsable...</option>';

    // En edición existente: si el responsable original ya no está asignado a la competencia,
    // se conserva como opción adicional marcada para no perder el dato precargado..
    let originalFueraDeLista = false;
    if (esPrecarga && previo && !asignados.has(Number(previo))) {
        originalFueraDeLista = true;
        const personaOriginal = staff.find(s => String(s.id) === previo);
        const etiqueta = personaOriginal
            ? `${escapeHtml(personaOriginal.nombre)} ${escapeHtml(personaOriginal.apellido)} (responsable original)`
            : `Responsable #${previo} (responsable original)`;
        opciones += `<option value="${previo}">${etiqueta}</option>`;
    }

    selectResp.innerHTML = opciones;
    // Habilitar solo si hay personal asignado o se conserva un responsable original precargado..
    selectResp.disabled = (asignadosStaff.length === 0 && !originalFueraDeLista);

    // Restaurar el valor solo si la opción sigue existiendo (el filtro dinámico se respeta.)
    const previoDisponible = Array.from(selectResp.options).some(o => o.value === previo);
    if (previo && previoDisponible) {
        selectResp.value = previo;
    } else {
        // Cambio manual de competencia: si el responsable no pertenece a la nueva selección, se limpia..
        selectResp.value = '';
    }
    const responsableLibre = document.getElementById('rendicion-responsable-libre');
    if (responsableLibre && nombreLibrePrecargado) responsableLibre.value = nombreLibrePrecargado;
    toggleResponsableLibre();
}

function toggleResponsableLibre() {
    const selectResp = document.getElementById('rendicion-responsable');
    const inputLibre = document.getElementById('rendicion-responsable-libre');
    if (!selectResp || !inputLibre) return;
    const esOtro = selectResp.value === '__OTRO__';
    inputLibre.style.display = esOtro ? 'block' : 'none';
    inputLibre.required = esOtro;
    if (!esOtro) inputLibre.value = '';
}
// ==================== ALERTA / CONFIRMACIÓN PERSONALIZADA ====================
let _alertaResolve = null;

function mostrarConfirmacion(titulo, mensaje, icono = 'question') {
    return new Promise((resolve) => {
        const modal = document.getElementById('modal-alerta');
        const iconoEl = document.getElementById('alerta-icono');
        const tituloEl = document.getElementById('alerta-titulo');
        const mensajeEl = document.getElementById('alerta-mensaje');
        const btnCancelar = document.getElementById('alerta-btn-cancelar');
        const btnConfirmar = document.getElementById('alerta-btn-confirmar');

        const iconos = {
            info: '<i class="fa-solid fa-circle-info" style="color: var(--accent-blue);"></i>',
            warning: '<i class="fa-solid fa-triangle-exclamation" style="color: #ff9f43;"></i>',
            error: '<i class="fa-solid fa-circle-exclamation" style="color: var(--accent);"></i>',
            success: '<i class="fa-solid fa-circle-check" style="color: var(--accent-green);"></i>',
            question: '<i class="fa-solid fa-circle-question" style="color: var(--accent-blue);"></i>'
        };

        iconoEl.innerHTML = iconos[icono] || iconos.question;
        tituloEl.textContent = titulo;
        mensajeEl.textContent = mensaje;
        btnCancelar.style.display = '';
        btnConfirmar.textContent = 'Confirmar';

        _alertaResolve = resolve;
        openModal('modal-alerta');
    });
}

function cerrarAlerta(resultado) {
    closeModal('modal-alerta');
    if (_alertaResolve) {
        _alertaResolve(resultado);
        _alertaResolve = null;
    }
}

// Helpers de formato
function formatearMoneda(valor) {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(valor);
}

function formatearFechaVisual(fechaStr) {
    if (!fechaStr) return '';
    const p = fechaStr.split('-');
    return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : fechaStr;
}

// ==================== GESTOR DE CATEGORÍAS DE GASTOS ====================

async function abrirModalGestorCategorias() {
    const categorias = await getTodos('categorias');
    const listContainer = document.getElementById('gasto-categorias-list');
    listContainer.innerHTML = '';

    categorias.forEach(cat => {
        const div = document.createElement('div');
        div.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; background-color: var(--bg-card); border-radius: 6px;';
        div.innerHTML = `
            <span style="font-weight: 500;">${cat.nombre}</span>
            <div style="display: flex; gap: 0.5rem;">
                <button type="button" class="action-btn" style="padding: 0.25rem 0.5rem;" onclick="editarCategoriaGasto(${cat.id})" title="Editar">
                    <i class="fa-solid fa-pen-to-square"></i>
                </button>
                <button type="button" class="action-btn delete" style="padding: 0.25rem 0.5rem;" onclick="eliminarCategoriaGasto(${cat.id})" title="Eliminar">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        `;
        listContainer.appendChild(div);
    });

    document.getElementById('quick-categoria-nombre').value = '';
    openModal('modal-gasto-categoria');
}

async function guardarCategoriaRapido(e) {
    e.preventDefault();
    if (!puedeEditar()) return;
    const nombre = document.getElementById('quick-categoria-nombre').value.trim();
    if (!nombre) return;

    const nuevaCategoria = { nombre };
    await guardar('categorias', nuevaCategoria);
    await actualizarSelectoresFormularios();
    await abrirModalGestorCategorias();
}

async function editarCategoriaGasto(id) {
    if (!puedeEditar()) return;
    const cat = await obtenerPorId('categorias', id);
    if (!cat) return;
    const nuevoNombre = prompt('Editar nombre de categoría:', cat.nombre);
    if (nuevoNombre && nuevoNombre.trim() !== '') {
        cat.nombre = nuevoNombre.trim();
        await guardar('categorias', cat);
        await actualizarSelectoresFormularios();
        await abrirModalGestorCategorias();
    }
}

async function eliminarCategoriaGasto(id) {
    if (!puedeEditar()) return;
    if (!confirm('¿Eliminar esta categoría de gasto?\n\nNota: Los gastos ya cargados con esta categoría pasarán a "General"')) return;
    
    const gastos = await getTodos('gastos');
    for (const g of gastos) {
        if (g.categoriaId === String(id)) {
            g.categoriaId = 'general';
            await guardar('gastos', g);
        }
    }
    
    await eliminar('categorias', id);
    await actualizarSelectoresFormularios();
    await abrirModalGestorCategorias();
}

// ==================== GESTOR DE CONCEPTOS DE GASTOS ====================

async function abrirModalGestorConceptos() {
    const conceptos = await getTodos('conceptos');
    const listContainer = document.getElementById('gasto-conceptos-list');
    listContainer.innerHTML = '';

    conceptos.forEach(conc => {
        const div = document.createElement('div');
        div.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; background-color: var(--bg-card); border-radius: 6px;';
        div.innerHTML = `
            <span style="font-weight: 500;">${conc.nombre}</span>
            <div style="display: flex; gap: 0.5rem;">
                <button type="button" class="action-btn" style="padding: 0.25rem 0.5rem;" onclick="editarConceptoGasto(${conc.id})" title="Editar">
                    <i class="fa-solid fa-pen-to-square"></i>
                </button>
                <button type="button" class="action-btn delete" style="padding: 0.25rem 0.5rem;" onclick="eliminarConceptoGasto(${conc.id})" title="Eliminar">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        `;
        listContainer.appendChild(div);
    });

    document.getElementById('quick-concepto-nombre').value = '';
    openModal('modal-gasto-concepto');
}

async function guardarConceptoRapido(e) {
    e.preventDefault();
    if (!puedeEditar()) return;
    const nombre = document.getElementById('quick-concepto-nombre').value.trim();
    if (!nombre) return;

    const nuevo = { nombre };
    await guardar('conceptos', nuevo);
    await actualizarSelectoresFormularios();
    await abrirModalGestorConceptos();
}

async function editarConceptoGasto(id) {
    if (!puedeEditar()) return;
    const conc = await obtenerPorId('conceptos', id);
    if (!conc) return;
    const nuevoNombre = prompt('Editar nombre de concepto:', conc.nombre);
    if (nuevoNombre && nuevoNombre.trim() !== '') {
        conc.nombre = nuevoNombre.trim();
        await guardar('conceptos', conc);
        await actualizarSelectoresFormularios();
        await abrirModalGestorConceptos();
    }
}

async function eliminarConceptoGasto(id) {
    if (!puedeEditar()) return;
    if (!confirm('¿Eliminar este concepto de gasto?\n\nNota: Los gastos que usen este concepto quedarán sin concepto.')) return;

    const gastos = await getTodos('gastos');
    let conceptos = await getTodos('conceptos');
    let otros = conceptos.find(c => c.nombre === 'Otros');
    if (!otros) {
        const newId = await guardar('conceptos', { nombre: 'Otros' });
        otros = await obtenerPorId('conceptos', newId);
    }

    const concObj = await obtenerPorId('conceptos', id);
    for (const g of gastos) {
        if (g.concepto === concObj?.nombre) {
            g.concepto = otros.nombre;
            await guardar('gastos', g);
        }
    }

    if (concObj && concObj.nombre === 'Otros') { alert('No se puede eliminar el concepto "Otros".'); return; }

    await eliminar('conceptos', id);
    await actualizarSelectoresFormularios();
    await abrirModalGestorConceptos();
}

// ==================== GESTIÓN DE FIREBASE DESDE LA UI ====================

function guardarYConectarFirebase() {
    const configText = document.getElementById('firebase-config-text').value.trim();
    const statusEl = document.getElementById('firebase-status-message');
    const btnConectar = document.getElementById('btn-conectar-firebase');
    const btnMigrar = document.getElementById('btn-migrar-firebase');
    const btnDesconectar = document.getElementById('btn-desconectar-firebase');

    if (!configText) {
        statusEl.innerHTML = '<span style="color: #ff6b6b;">⚠️ Pegá la configuración JSON de Firebase en el campo de texto.</span>';
        return;
    }

    try {
        const config = JSON.parse(configText);
        if (!config.apiKey || !config.projectId) {
            statusEl.innerHTML = '<span style="color: #ff6b6b;">⚠️ El JSON debe contener al menos "apiKey" y "projectId".</span>';
            return;
        }

        // Ajustar authDomain dinámicamente según el entorno
        const hostname = window.location.hostname;
        if (hostname.includes('github.io')) {
            config.authDomain = hostname;
        } else if (!config.authDomain) {
            config.authDomain = 'controlcda-e5f97.firebaseapp.com';
        }

        localStorage.setItem('firebase_config', JSON.stringify(config));
        statusEl.innerHTML = '<span style="color: #2ed573;">⌛ Conectando con Firebase...</span>';

        setTimeout(() => {
            location.reload();
        }, 500);
    } catch (e) {
        statusEl.innerHTML = `<span style="color: #ff6b6b;">⚠️ Error: El texto no es un JSON válido. Revisá el formato.</span>`;
    }
}

async function migrarDatosLocalesAFirebase() {
    const statusEl = document.getElementById('firebase-status-message');
    const btnMigrar = document.getElementById('btn-migrar-firebase');

    try {
        btnMigrar.disabled = true;
        btnMigrar.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Migrando...';

        const stores = ['categorias', 'circuitos', 'staff', 'competencias', 'gastos', 'conceptos', 'usuarios', 'personalCompetencia'];
        let total = 0;

        for (const storeName of stores) {
            const data = await getTodos(storeName);
            for (const item of data) {
                await guardar(storeName, item);
                total++;
            }
        }

        statusEl.innerHTML = `<span style="color: #2ed573;">✅ Migración completada. ${total} registros subidos a Firebase.</span>`;
    } catch (e) {
        console.error('Error en migración:', e);
        // XSS (HALLazgo 5): `e.message` puede contener texto de Firestore
        // controlado por un atacante, que lo inyectaria como HTML. Se escapa.
        statusEl.innerHTML = `<span style="color: #ff6b6b;">❌ Error durante la migración: ${escapeHtml(e.message || e)}</span>`;
    } finally {
        btnMigrar.disabled = false;
        btnMigrar.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Subir Datos Locales a la Nube';
    }
}

function desconectarFirebase() {
    if (!confirm('¿Desconectar Firebase? Los datos locales (IndexedDB) se seguirán usando, pero la app dejará de sincronizar con la nube.')) return;

    localStorage.removeItem('firebase_config');
    const statusEl = document.getElementById('firebase-status-message');
    statusEl.innerHTML = '<span style="color: #ff9f43;">🔌 Desconectado. Recargando para usar solo datos locales...</span>';

    setTimeout(() => {
        location.reload();
    }, 500);
}

function actualizarEstadoFirebaseUI() {
    const configStr = localStorage.getItem('firebase_config');
    const btnConectar = document.getElementById('btn-conectar-firebase');
    const btnMigrar = document.getElementById('btn-migrar-firebase');
    const btnDesconectar = document.getElementById('btn-desconectar-firebase');
    const statusEl = document.getElementById('firebase-status-message');
    const configTextarea = document.getElementById('firebase-config-text');

    if (configStr) {
        try {
            const config = JSON.parse(configStr);
            configTextarea.value = JSON.stringify(config, null, 2);

            if (useFirebase) {
                const syncResult = window.firebaseSyncResult || { status: 'pending', message: 'Sincronizando...', count: 0 };
                if (syncResult.status === 'synced') {
                    statusEl.innerHTML = `
                        <span style="color: #2ed573;">✅ Conectado a Firebase: <strong>${config.projectId}</strong></span>
                        <br>
                        <small style="color: var(--text-secondary);">📤 ${syncResult.count} registros sincronizados a la nube.</small>
                    `;
                } else if (syncResult.status === 'error') {
                    statusEl.innerHTML = `
                        <span style="color: #2ed573;">✅ Conectado a Firebase: <strong>${config.projectId}</strong></span>
                        <br>
                        <small style="color: #ff9f43;">⚠️ Sincronización inicial: ${syncResult.message}</small>
                        <br>
                        <small style="color: var(--text-secondary);">Usá "Subir Datos Locales a la Nube" para sincronizar manualmente.</small>
                    `;
                } else {
                    statusEl.innerHTML = `
                        <span style="color: #2ed573;">✅ Conectado a Firebase: <strong>${config.projectId}</strong></span>
                        <br>
                        <small style="color: #ff9f43;">⏳ Sincronizando datos locales a la nube...</small>
                    `;
                }
                btnConectar.style.display = 'none';
                btnMigrar.style.display = '';
                btnDesconectar.style.display = '';
            } else {
                statusEl.innerHTML = `<span style="color: #ff9f43;">⚠️ Configuración encontrada pero no se pudo conectar. Revisá las credenciales.</span>`;
                btnConectar.style.display = '';
                btnMigrar.style.display = 'none';
                btnDesconectar.style.display = '';
            }
        } catch (e) {
            statusEl.innerHTML = '<span style="color: #ff6b6b;">⚠️ La configuración guardada no es válida.</span>';
            btnConectar.style.display = '';
            btnMigrar.style.display = 'none';
            btnDesconectar.style.display = '';
        }
    } else {
        statusEl.innerHTML = '<span style="color: var(--text-secondary);">No hay conexión configurada. Los datos se guardan localmente.</span>';
        btnConectar.style.display = '';
        btnMigrar.style.display = 'none';
        btnDesconectar.style.display = 'none';
    }
}

// ==================== PRUEBA AUTOMATIZADA DE CACHE DB ====================
async function ejecutarPruebaCache() {
    try {
        console.group('DB Cache SelfTest');
        console.log('Inicializando DB por defecto...');
        await inicializarDatosPorDefecto();

        console.log('Conteo inicial categorias:', (await getTodos('categorias')).length);

        const temp = { nombre: 'ZZZ_AUTOTEST_TEMP' };
        const savedId = await guardar('categorias', temp);
        console.log('Guardado ID:', savedId);
        console.log('Cache categorias (últimos 5):', (_cache['categorias'] || []).slice(-5));

        temp.id = Number(savedId);
        temp.nombre = 'ZZZ_AUTOTEST_UPDATED';
        await guardar('categorias', temp);
        console.log('Después de actualizar (buscar en cache):', (_cache['categorias'] || []).find(c => Number(c.id) === Number(savedId)));

        await eliminar('categorias', savedId);
        console.log('Después de eliminar, encontrar en cache:', (_cache['categorias'] || []).find(c => Number(c.id) === Number(savedId)));

        console.log('Prueba finalizada.');
        console.groupEnd();
        alert('Prueba de cache finalizada. Revisá la consola del navegador para detalles.');
    } catch (err) {
        console.error('Error en prueba de cache:', err);
        alert('Error en prueba de cache. Ver consola.');
    }
}

if (localStorage.getItem('runDbSelfTest') === '1') {
    ejecutarPruebaCache();
}

// ====================================================================
// MÓDULO: CARGA DETALLADA
// ====================================================================

let rendicionActual = null;
let detallesActuales = [];
let detallesModificados = false;
let adjuntosTemporales = {};

function mostrarToast(mensaje, tipo = 'success') {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast toast-${tipo}`;

    // ---------- BLINDAJE XSS (HALLazgo 5) ----------
    // Antes: toast.innerHTML = `<i ...></i> ${mensaje}`.
    // `mensaje` frecuentemente interpola datos de la base (nombres de articulos,
    // usuarios, errores de Firebase), por lo que un valor como
    // `<img src=x onerror=...>` ejecutaba JavaScript. Era un XSS ALMACENADO.
    //
    // Se construye el icono y el texto con APIs del DOM: `textContent` NUNCA
    // interpreta HTML, por lo que el mensaje se muestra literalmente y es
    // imposible inyectar nodos. La clase `toast toast-<tipo>` y el `<i>` de
    // Font Awesome se conservan, de modo que el diseno es IDENTICO.
    const icono = document.createElement('i');
    icono.className = 'fa-solid ' + (tipo === 'success' ? 'fa-check-circle'
        : tipo === 'error' ? 'fa-times-circle'
            : 'fa-triangle-exclamation');
    toast.appendChild(icono);
    toast.appendChild(document.createTextNode(' '));
    toast.appendChild(document.createTextNode(mensaje == null ? '' : String(mensaje)));

    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(() => toast.remove(), 300); }, 3000);
}

function actualizarResumenUsuarioModal() {
    const username = document.getElementById('usuario-username')?.value.trim() || '(sin usuario)';
    const nombre = document.getElementById('usuario-nombre')?.value.trim() || '(sin nombre)';
    const rol = document.getElementById('usuario-rol')?.value || '(sin rol)';
    const activo = document.getElementById('usuario-activo')?.value === 'true' ? 'Activo' : 'Inactivo';
    const password = document.getElementById('usuario-password')?.value;
    const resumen = [];

    resumen.push(`<strong>Usuario:</strong> ${escapeHtml(username)}`);
    resumen.push(`<strong>Nombre:</strong> ${escapeHtml(nombre)}`);
    const rolLabel = rol === 'personalizado'
        ? `Personalizado (base: ${DICCIONARIO_ROLES[document.getElementById('usuario-rol')?.dataset.rolBase]?.label || 'n/d'})`
        : (DICCIONARIO_ROLES[rol]?.label || rol);
    resumen.push(`<strong>Rol:</strong> ${escapeHtml(rolLabel)}`);
    resumen.push(`<strong>Estado:</strong> ${escapeHtml(activo)}`);
    // Módulos visibles según la matriz de permisos actual del modal
    if (typeof recolectarPermisosDelModal === 'function') {
        const permsModal = recolectarPermisosDelModal();
        const modsVisibles = Object.keys(permsModal).filter(m => permsModal[m].ver).length;
        resumen.push(`<strong>Módulos visibles:</strong> ${modsVisibles}`);
    }
    resumen.push(`<strong>Contraseña:</strong> ${password ? escapeHtml(password) : (document.getElementById('usuario-id').value ? 'Sin cambios' : 'No ingresada')}`);

    const cont = document.getElementById('usuario-modal-resumen');
    if (cont) {
        cont.innerHTML = resumen.join('<br>');
    }
}

async function listarRendiciones() {
    if (!puedeEditar() && esSupervisor()) {
        document.getElementById('rendiciones-list-container').innerHTML = '<p style="color:var(--text-secondary);">No tenés acceso a este módulo.</p>';
        return;
    }

    const [rendiciones, competencias, circuitos, campeonatos, staff, detalles] = await Promise.all([
        getTodos('rendiciones'),
        getTodos('competencias'),
        getTodos('circuitos'),
        getTodos('campeonatos'),
        getTodos('staff'),
        getTodos('detalleGastos')
    ]);

    const buscador = (document.getElementById('buscar-rendiciones').value || '').toLowerCase();
    const filtroEstado = document.getElementById('filtro-estado-rendiciones').value;

    let filtradas = rendiciones.filter(r => {
        if (filtroEstado !== 'todos' && r.estado !== filtroEstado) return false;
        if (buscador) {
            const comp = competencias.find(c => c.id === Number(r.competenciaId));
            const resp = staff.find(s => s.id === Number(r.responsableId));
            const compMatch = comp ? comp.nombre.toLowerCase().includes(buscador) : false;
            const compCodigoMatch = comp ? (comp.codigo || '').toLowerCase().includes(buscador) : false;
            const respNombre = resp ? `${resp.nombre} ${resp.apellido}` : (r.responsableNombre || '');
            const respMatch = respNombre.toLowerCase().includes(buscador);
            const obsMatch = (r.observaciones || '').toLowerCase().includes(buscador);
            const queryNumber = Number(buscador);
            const idMatch = !Number.isNaN(queryNumber) && (queryNumber === Number(r.id) || queryNumber === Number(r.competenciaId));
            if (!compMatch && !compCodigoMatch && !respMatch && !obsMatch && !idMatch) return false;
        }
        return true;
    }).sort((a, b) => new Date(b.fecha || b.fechaCreacion) - new Date(a.fecha || a.fechaCreacion));

    const tbody = document.getElementById('rendiciones-table-body');
    tbody.innerHTML = '';

    if (filtradas.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--text-secondary);">No hay rendiciones registradas. Hacé clic en "Nueva Rendición" para comenzar.</td></tr>`;
        return;
    }

    filtradas.forEach(r => {
        const comp = competencias.find(c => c.id === Number(r.competenciaId));
        const circ = circuitos.find(c => c.id === Number(r.autodromoId));
        const camp = campeonatos.find(c => c.id === Number(r.campeonatoId));
        const resp = staff.find(s => s.id === Number(r.responsableId));
        const gastosRendicion = detalles.filter(d => Number(d.rendicionId) === Number(r.id));
        const cantGastos = gastosRendicion.length;
        const totalGastos = gastosRendicion.reduce((sum, d) => sum + Number(d.total || 0), 0);

        const estadoBadge = r.estado === 'completo' ? 'badge-success' : 'badge-warning';
        const estadoText = r.estado === 'completo' ? 'Completo' : 'Borrador';

        const acciones = `
            <td style="text-align:right;white-space:nowrap;">
                <button class="action-btn" onclick="verRendicion(${r.id})" title="Ver detalle" style="min-width:32px;display:inline-flex;align-items:center;justify-content:center;"><i class="fa-solid fa-eye"></i></button>
                ${puedeEditar() ? `
                <button class="action-btn" onclick="editarRendicion(${r.id})" title="Editar" style="display:inline-flex;align-items:center;justify-content:center;"><i class="fa-solid fa-pen-to-square"></i></button>
                <button class="action-btn" onclick="duplicarRendicionId(${r.id})" title="Duplicar" style="display:inline-flex;align-items:center;justify-content:center;"><i class="fa-solid fa-copy"></i></button>
                <button class="action-btn delete" onclick="eliminarRendicion(${r.id})" title="Eliminar" style="display:inline-flex;align-items:center;justify-content:center;"><i class="fa-solid fa-trash"></i></button>
                ` : ''}
            </td>
        `;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-weight:600;">${r.id}</td>
            <td>${comp ? escapeHtml(comp.nombre) : '-'}</td>
            <td>${circ ? escapeHtml(circ.nombre) : '-'}</td>
            <td>${formatearFechaVisual(r.fecha)}</td>
            <td>${resp ? `${escapeHtml(resp.nombre)} ${escapeHtml(resp.apellido)}` : escapeHtml(r.responsableNombre || '-')}</td>
            <td style="text-align:center;">${cantGastos}</td>
            <td style="color:var(--accent);font-weight:700;">${formatearMoneda(totalGastos)}</td>
            <td><span class="badge ${estadoBadge}">${estadoText}</span></td>
            ${acciones}
        `;
        tbody.appendChild(tr);
    });
}

async function verRendicion(id) {
    const [rendicion, competencias, circuitos, staff, conceptos, proveedores, todosDetalles, todosAdjuntos] = await Promise.all([
        obtenerPorId('rendiciones', id),
        getTodos('competencias'),
        getTodos('circuitos'),
        getTodos('staff'),
        getTodos('conceptos'),
        getTodos('proveedores'),
        getTodos('detalleGastos'),
        getTodos('adjuntos')
    ]);

    if (!rendicion) { mostrarToast('Rendición no encontrada.', 'error'); return; }

    const comp = competencias.find(c => c.id === Number(rendicion.competenciaId));
    const circ = circuitos.find(c => c.id === Number(rendicion.autodromoId));
    const resp = staff.find(s => s.id === Number(rendicion.responsableId));
    const detalles = todosDetalles.filter(d => Number(d.rendicionId) === Number(id)).sort((a, b) => (a.orden || 0) - (b.orden || 0));

    let totalBasico = 0, totalIVA = 0, totalGeneral = 0;
    detalles.forEach(d => {
        totalBasico += Number(d.basico || 0);
        totalIVA += Number(d.iva || 0);
        totalGeneral += calcularTotalFila(d);
    });

    if (!document.getElementById('modal-ver-rendicion')) {
        const modalHtml = `
        <div id="modal-ver-rendicion" class="modal-overlay">
            <div class="modal modal-lg" style="width:95vw;max-width:1400px;overflow:hidden;box-sizing:border-box;position:relative;">
                <div class="modal-header">
                    <h2 class="modal-title"><i class="fa-solid fa-file-invoice"></i> Rendición #<span id="ver-rendicion-id"></span></h2>
                    <button class="modal-close" onclick="closeModal('modal-ver-rendicion')">&times;</button>
                </div>
                <div class="modal-content" style="max-height:80vh;overflow:auto;padding:1.5rem;box-sizing:border-box;">
                    <div class="stats-grid" id="ver-rendicion-summary" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:1.5rem;"></div>
                    
                    <div class="form-card" style="margin-bottom:1.5rem;">
                        <div class="form-title"><i class="fa-solid fa-circle-info"></i> Información General</div>
                        <div id="ver-rendicion-info" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1rem;padding:1rem 0;"></div>
                        <div id="ver-rendicion-observaciones" style="padding:0.5rem 0;color:var(--text-secondary);border-top:1px solid var(--border-color);"></div>
                    </div>

                    <div class="table-card">
                        <div class="table-header-tools">
                            <h3><i class="fa-solid fa-receipt"></i> Detalle de Gastos</h3>
                            <span style="color:var(--accent);font-weight:700;font-size:1.1rem;" id="ver-rendicion-total-general"></span>
                        </div>
                        <div class="table-responsive">
                            <table>
                                <thead>
                                    <tr>
                                        <th>#</th>
                                        <th>Proveedor</th>
                                        <th>Comp.</th>
                                        <th>N° Comp.</th>
                                        <th>Fecha</th>
                                        <th>Concepto</th>
                                        <th>Descripción</th>
                                        <th>Básico</th>
                                        <th>IVA</th>
                                        <th>Total</th>
                                        <th>Adj.</th>
                                    </tr>
                                </thead>
                                <tbody id="ver-rendicion-detalles-body"></tbody>
                            </table>
                        </div>
                    </div>

                    <div class="table-card" style="margin-top:1rem;">
                        <div class="table-header-tools">
                            <h3><i class="fa-solid fa-paperclip"></i> Archivos Adjuntos</h3>
                        </div>
                        <div id="ver-rendicion-adjuntos" style="padding:1rem;display:flex;flex-wrap:wrap;gap:0.75rem;"></div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" onclick="closeModal('modal-ver-rendicion')">Cerrar</button>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    document.getElementById('ver-rendicion-id').textContent = rendicion.id;

    const summaryHtml = `
        <div class="stat-card" style="padding:1rem;">
            <div class="stat-info">
                <h3 style="font-size:0.85rem;">Competencia</h3>
                <p style="font-size:1rem;">${comp ? comp.nombre : '-'}<br><small style="color:var(--text-secondary);"><i class="fa-solid fa-hashtag"></i> <span class="blur-readonly" style="font-family:monospace;">${comp && comp.codigo ? comp.codigo : 'SIN CÓDIGO'}</span></small></p>
            </div>
            <div class="stat-icon"><i class="fa-solid fa-trophy"></i></div>
        </div>
        <div class="stat-card" style="padding:1rem;">
            <div class="stat-info">
                <h3 style="font-size:0.85rem;">Autódromo</h3>
                <p style="font-size:1rem;">${circ ? circ.nombre : '-'}</p>
            </div>
            <div class="stat-icon"><i class="fa-solid fa-map-location-dot"></i></div>
        </div>
        <div class="stat-card" style="padding:1rem;">
            <div class="stat-info">
                <h3 style="font-size:0.85rem;">Responsable</h3>
                <p style="font-size:1rem;">${resp ? `${resp.nombre} ${resp.apellido}` : (rendicion.responsableNombre || '-')}</p>
            </div>
            <div class="stat-icon"><i class="fa-solid fa-user"></i></div>
        </div>
        <div class="stat-card" style="padding:1rem;">
            <div class="stat-info">
                <h3 style="font-size:0.85rem;">Fecha</h3>
                <p style="font-size:1rem;">${formatearFechaVisual(rendicion.fecha)}</p>
            </div>
            <div class="stat-icon"><i class="fa-solid fa-calendar"></i></div>
        </div>
        <div class="stat-card" style="padding:1rem;">
            <div class="stat-info">
                <h3 style="font-size:0.85rem;">Cant. Gastos</h3>
                <p style="font-size:1rem;">${detalles.length}</p>
            </div>
            <div class="stat-icon"><i class="fa-solid fa-receipt"></i></div>
        </div>
        <div class="stat-card" style="padding:1rem;">
            <div class="stat-info">
                <h3 style="font-size:0.85rem;">Total General</h3>
                <p style="font-size:1rem;color:var(--accent);font-weight:700;">${formatearMoneda(totalGeneral)}</p>
            </div>
            <div class="stat-icon"><i class="fa-solid fa-dollar-sign"></i></div>
        </div>
    `;
    document.getElementById('ver-rendicion-summary').innerHTML = summaryHtml;

    const estadoBadge = rendicion.estado === 'completo' ? 'badge-success' : 'badge-warning';
    const estadoText = rendicion.estado === 'completo' ? 'Completo' : 'Borrador';
    document.getElementById('ver-rendicion-info').innerHTML = `
        <div><strong>Estado:</strong> <span class="badge ${estadoBadge}">${estadoText}</span></div>
        <div><strong>Responsable:</strong> ${resp ? `${resp.nombre} ${resp.apellido}` : (rendicion.responsableNombre || '-')}</div>
        <div><strong>Autódromo:</strong> ${circ ? circ.nombre : '-'}</div>
        <div><strong>Competencia:</strong> ${comp ? comp.nombre : '-'}</div>
        <div><strong>Código:</strong> <span class="blur-readonly" style="font-family:monospace;">${comp && comp.codigo ? comp.codigo : 'SIN CÓDIGO'}</span></div>
        <div><strong>Fecha:</strong> ${formatearFechaVisual(rendicion.fecha)}</div>
        <div><strong># Rendición:</strong> ${rendicion.id}</div>
    `;
    // XSS (HALLazgo 5): `observaciones` es texto libre escrito por el operador.
    // Sin escapar, un `<script>` o un `onerror` en ese campo se ejecutaba al
    // abrir la rendición (XSS ALMACENADO). El icono y el salto de línea se
    // conservan, por lo que el aspecto no cambia.
    const obsEl = document.getElementById('ver-rendicion-observaciones');
    if (rendicion.observaciones) {
        obsEl.innerHTML = '<i class="fa-solid fa-comment"></i> ';
        obsEl.appendChild(document.createTextNode(String(rendicion.observaciones)));
    } else {
        obsEl.textContent = '';
    }

    const tbody = document.getElementById('ver-rendicion-detalles-body');
    tbody.innerHTML = '';
    if (detalles.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;color:var(--text-secondary);">Sin gastos registrados.</td></tr>';
    } else {
        for (let i = 0; i < detalles.length; i++) {
            const d = detalles[i];
            const prov = proveedores.find(p => p.id === Number(d.proveedorId));
            const conc = conceptos.find(c => c.id === Number(d.conceptoId));
            const total = calcularTotalFila(d);
            const adjFila = todosAdjuntos.filter(a => Number(a.detalleGastoId) === Number(d.id));
            const tieneAdj = adjFila.length > 0;
            
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="text-align:center;font-weight:600;">${i + 1}</td>
                <td>${prov ? escapeHtml(prov.nombre) : '-'}</td>
                <td>${escapeHtml(d.tipoComprobante || '-')}</td>
                <td>${escapeHtml(d.numeroComprobante || '-')}</td>
                <td>${formatearFechaVisual(d.fecha)}</td>
                <td>${conc ? escapeHtml(conc.nombre) : '-'}</td>
                <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(d.descripcion || '')}">${escapeHtml(d.descripcion || '-')}</td>
                <td style="text-align:right;">${formatearMoneda(Number(d.basico || 0))}</td>
                <td style="text-align:right;">${formatearMoneda(Number(d.iva || 0))}</td>
                <td style="text-align:right;color:var(--accent);font-weight:700;">${formatearMoneda(total)}</td>
                <td style="text-align:center;">
                    ${tieneAdj ? `<span style="color:var(--accent-green);cursor:pointer;" onclick="verAdjuntosRendicion(${i})" title="${adjFila.length} archivo(s)"><i class="fa-solid fa-paperclip"></i> ${adjFila.length}</span>` : '<span style="color:var(--text-secondary);"><i class="fa-regular fa-paperclip"></i></span>'}
                </td>
            `;
            tr.dataset.adjuntos = JSON.stringify(adjFila);
            tbody.appendChild(tr);
        }
    }

    document.getElementById('ver-rendicion-total-general').textContent = `Total: ${formatearMoneda(totalGeneral)}`;

    const adjContainer = document.getElementById('ver-rendicion-adjuntos');
    adjContainer.innerHTML = '';
    let totalAdj = 0;
    const todosAdjRendicion = [];
    for (const d of detalles) {
        const adjFila = todosAdjuntos.filter(a => Number(a.detalleGastoId) === Number(d.id));
        adjFila.forEach(a => {
            totalAdj++;
            todosAdjRendicion.push(a);
        });
    }
    
    if (totalAdj === 0) {
        adjContainer.innerHTML = '<span style="color:var(--text-secondary);">Esta rendición no tiene archivos adjuntos.</span>';
    } else {
        todosAdjRendicion.forEach((adj, idx) => {
            const card = document.createElement('div');
            card.style.cssText = 'display:flex;align-items:center;gap:0.5rem;padding:0.5rem 0.75rem;background:var(--bg-card);border-radius:6px;border:1px solid var(--border-color);cursor:pointer;';
            card.title = 'Haga clic para abrir';
            const icono = adj.tipoArchivo?.includes('pdf') ? 'fa-file-pdf' :
                          adj.tipoArchivo?.includes('image') ? 'fa-file-image' : 'fa-file';
            card.innerHTML = `
                <i class="fa-regular ${icono}" style="font-size:1.2rem;color:var(--accent);"></i>
                <span style="font-size:0.85rem;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${adj.nombre}</span>
            `;
            card.onclick = () => abrirArchivoAdjunto(adj.nombre, adj.archivo);
            adjContainer.appendChild(card);
        });
    }

    openModal('modal-ver-rendicion');
}

function verAdjuntosRendicion(index) {
    const tbody = document.getElementById('ver-rendicion-detalles-body');
    const tr = tbody.children[index];
    if (!tr || !tr.dataset.adjuntos) { mostrarToast('Sin archivos adjuntos.', 'warning'); return; }
    try {
        const adjuntos = JSON.parse(tr.dataset.adjuntos);
        if (adjuntos.length === 0) { mostrarToast('Sin archivos adjuntos.', 'warning'); return; }
        adjuntos.forEach(adj => abrirArchivoAdjunto(adj.nombre, adj.archivo));
    } catch(e) {
        mostrarToast('Error al leer los adjuntos.', 'error');
    }
}

async function nuevaRendicion() {
    if (!puedeEditar()) return;
    await cargarSelectoresRendicion();

    rendicionActual = {
        competenciaId: '',
        campeonatoId: '',
        autodromoId: '',
        responsableId: '',
        fecha: new Date().toISOString().split('T')[0],
        observaciones: '',
        estado: 'borrador',
        usuarioCreacion: currentUser ? currentUser.id : null,
        usuarioModificacion: currentUser ? currentUser.id : null,
        fechaCreacion: new Date().toISOString(),
        fechaModificacion: new Date().toISOString()
    };
    detallesActuales = [];
    detallesModificados = false;
    adjuntosTemporales['modal'] = [];

    await llenarFormularioRendicion(rendicionActual);
    document.getElementById('rendiciones-list-container').style.display = 'none';
    document.getElementById('rendicion-editor').style.display = 'block';
    document.getElementById('rendicion-estado-badge').textContent = 'Nueva - Borrador';
    document.getElementById('rendicion-estado-badge').className = 'badge badge-warning';
    document.getElementById('cambios-sin-guardar').style.display = 'none';
    renderizarDetalleGastos();
    recalcularTodosLosTotales();
}

async function cargarSelectoresRendicion() {
    const [competencias, circuitos, staff, campeonatos, conceptos, proveedores] = await Promise.all([
        getTodos('competencias'),
        getTodos('circuitos'),
        getTodos('staff'),
        getTodos('campeonatos'),
        getTodos('conceptos'),
        getTodos('proveedores')
    ]);

    const selComp = document.getElementById('rendicion-competencia');
    const savedComp = selComp.value;
    selComp.innerHTML = '<option value="">Seleccione competencia...</option>';
    competencias.forEach(c => selComp.innerHTML += `<option value="${c.id}">${c.nombre}</option>`);
    selComp.value = savedComp;

    const selAuto = document.getElementById('rendicion-autodromo');
    const savedAuto = selAuto.value;
    selAuto.innerHTML = '<option value="">Seleccione autódromo...</option>';
    circuitos.forEach(c => selAuto.innerHTML += `<option value="${c.id}">${c.nombre}</option>`);
    selAuto.value = savedAuto;

    // El selector de responsable se puebla dinámicamente según el personal asignado a la competencia elegida.
    await actualizarResponsablePorCompetencia();

    const selConc = document.getElementById('detalle-concepto');
    if (selConc) {
        const savedConc = selConc.value;
        selConc.innerHTML = '<option value="">Seleccione concepto...</option>';
        const conceptosUnicos = Array.from(new Map(
            conceptos
                .filter(c => c && String(c.nombre || '').trim())
                .map(c => [normalizarNombreCatalogo(c.nombre), c])
        ).values());
        const conceptosOrdenados = conceptosUnicos.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
        conceptosOrdenados.forEach(c => selConc.innerHTML += `<option value="${c.id}">${c.nombre}</option>`);
        // Red de seguridad: re-vincula el disparador de visibilidad (idempotente; cubre el caso
        // de que el onchange inline se perdiera) y, como asignar .value programáticamente NO
        // dispara el evento 'change', resincroniza la tarjeta con el valor restaurado.
        selConc.addEventListener('change', onCambioConceptoDetalle);
        selConc.value = savedConc;
        if (savedConc) onCambioConceptoDetalle();
    }

    const selProv = document.getElementById('detalle-proveedor');
    if (selProv) {
        const savedProv = selProv.value;
        selProv.innerHTML = '<option value="">Seleccione proveedor...</option>';
        const proveedoresOrdenados = proveedores.slice().sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
        proveedoresOrdenados.forEach(p => selProv.innerHTML += `<option value="${p.id}">${p.nombre}</option>`);
        selProv.value = savedProv;
    }
}

async function llenarFormularioRendicion(r) {
    document.getElementById('rendicion-id').value = r.id || '';
    document.getElementById('rendicion-competencia').value = r.competenciaId || '';
    document.getElementById('rendicion-autodromo').value = r.autodromoId || '';
    document.getElementById('rendicion-fecha').value = r.fecha || '';
    await actualizarResponsablePorCompetencia(r.responsableId || (r.responsableNombre ? '__OTRO__' : ''), r.responsableNombre || '');
    document.getElementById('rendicion-observaciones').value = r.observaciones || '';

    try {
        const usuarios = await getTodos('usuarios');
        const userCrea = usuarios.find(u => Number(u.id) === Number(r.usuarioCreacion));
        document.getElementById('rendicion-usuario-creacion').textContent = userCrea ? userCrea.nombre : (r.usuarioCreacion || '-');
    } catch(e) {
        document.getElementById('rendicion-usuario-creacion').textContent = r.usuarioCreacion || '-';
    }
    document.getElementById('rendicion-fecha-creacion').textContent = r.fechaCreacion ? new Date(r.fechaCreacion).toLocaleString() : '-';
    document.getElementById('rendicion-fecha-modificacion').textContent = r.fechaModificacion ? new Date(r.fechaModificacion).toLocaleString() : '-';
}

function obtenerDatosFormularioRendicion() {
    const responsableSelect = document.getElementById('rendicion-responsable');
    const esResponsableLibre = responsableSelect.value === '__OTRO__';
    return {
        id: document.getElementById('rendicion-id').value ? Number(document.getElementById('rendicion-id').value) : null,
        competenciaId: Number(document.getElementById('rendicion-competencia').value),
        autodromoId: Number(document.getElementById('rendicion-autodromo').value),
        responsableId: esResponsableLibre ? null : Number(responsableSelect.value),
        responsableNombre: esResponsableLibre ? document.getElementById('rendicion-responsable-libre').value.trim() : '',
        fecha: document.getElementById('rendicion-fecha').value,
        observaciones: document.getElementById('rendicion-observaciones').value,
        estado: 'completo'
    };
}

function validarRendicion() {
    const datos = obtenerDatosFormularioRendicion();
    if (!datos.competenciaId) { mostrarToast('Debe seleccionar una competencia.', 'error'); return false; }
    if (!datos.autodromoId) { mostrarToast('Debe seleccionar un autódromo.', 'error'); return false; }
    if (!datos.fecha) { mostrarToast('Debe ingresar una fecha.', 'error'); return false; }
    if (!datos.responsableId && !datos.responsableNombre) { mostrarToast('Debe seleccionar o ingresar un responsable.', 'error'); return false; }
    if (detallesActuales.length === 0) { mostrarToast('Debe agregar al menos un gasto.', 'error'); return false; }

    for (let i = 0; i < detallesActuales.length; i++) {
        const d = detallesActuales[i];
        if (!d.proveedorId) { mostrarToast(`Fila ${i+1}: Debe seleccionar un proveedor.`, 'error'); return false; }
        if (!d.tipoComprobante) { mostrarToast(`Fila ${i+1}: Debe seleccionar un tipo de comprobante.`, 'error'); return false; }
        if (!d.conceptoId) { mostrarToast(`Fila ${i+1}: Debe seleccionar un concepto.`, 'error'); return false; }
        if (!d.fecha) { mostrarToast(`Fila ${i+1}: Debe ingresar una fecha de comprobante.`, 'error'); return false; }
        if (Number(d.basico) < 0 || Number(d.iva) < 0 || Number(d.impuestosInternos) < 0 ||
            Number(d.percepcionIIBB) < 0 || Number(d.percepcionIVA) < 0 || Number(d.otrosImpuestos) < 0) {
            mostrarToast(`Fila ${i+1}: Los importes no pueden ser negativos.`, 'error'); return false;
        }
    }
    return true;
}

async function guardarRendicion() {
    if (!puedeEditar()) return;
    if (!validarRendicion()) return;
    await ejecutarGuardadoRendicion('completo', true);
}

async function guardarRendicionBorrador() {
    if (!puedeEditar()) return;
    await ejecutarGuardadoRendicion('borrador', true);
}

async function ejecutarGuardadoRendicion(estado, volverAlListado = false) {
    let datos = null;
    try {
        datos = obtenerDatosFormularioRendicion();
        const ahora = new Date().toISOString();

        if (!datos.id) {
            datos.fechaCreacion = ahora;
            datos.usuarioCreacion = currentUser ? currentUser.id : null;
        } else {
            const orig = await obtenerPorId('rendiciones', datos.id);
            if (orig) {
                datos.fechaCreacion = orig.fechaCreacion;
                datos.usuarioCreacion = orig.usuarioCreacion;
            }
        }
        datos.fechaModificacion = ahora;
        datos.usuarioModificacion = currentUser ? currentUser.id : null;
        datos.estado = estado;

        const savedId = await guardar('rendiciones', datos);
        datos.id = Number(savedId);
        rendicionActual = datos;
        document.getElementById('rendicion-id').value = datos.id;

        for (let i = 0; i < detallesActuales.length; i++) {
            const detalle = detallesActuales[i];
            detalle.rendicionId = datos.id;
            detalle.orden = i + 1;
            detalle.total = Number(detalle.basico || 0) + Number(detalle.iva || 0) +
                Number(detalle.impuestosInternos || 0) + Number(detalle.percepcionIIBB || 0) +
                Number(detalle.percepcionIVA || 0) + Number(detalle.otrosImpuestos || 0);

            const detalleId = await guardar('detalleGastos', detalle);
            detalle.id = Number(detalleId);

                const adjuntosFila = Array.isArray(detalle.adjuntos) ? detalle.adjuntos : [];
            for (const adj of adjuntosFila) {
                adj.detalleGastoId = detalle.id;
                adj.usuarioCarga = currentUser ? currentUser.id : null;
                adj.fechaCarga = ahora;
                await guardar('adjuntos', adj);
            }
        }

        detallesModificados = false;
        document.getElementById('cambios-sin-guardar').style.display = 'none';

        const badge = document.getElementById('rendicion-estado-badge');
        badge.textContent = estado === 'completo' ? 'Completo' : 'Borrador';
        badge.className = `badge ${estado === 'completo' ? 'badge-success' : 'badge-warning'}`;

        document.getElementById('rendicion-usuario-creacion').textContent = currentUser ? currentUser.nombre : '-';
        document.getElementById('rendicion-fecha-modificacion').textContent = new Date(ahora).toLocaleString();

        invalidarCache('detalleGastos');
        invalidarCache('adjuntos');
        dashboardDirty = true;

        mostrarToast(`Rendición #${datos.id} guardada como "${estado}".`);
    } catch (e) {
        console.error('Error al guardar rendición:', e);
        mostrarToast('Error al guardar la rendición: ' + (e.message || e), 'error');
    } finally {
        if (volverAlListado) {
            cancelarEdicionRendicion();
        }
    }
}

async function editarRendicion(id) {
    if (!puedeEditar()) return;
    await cargarSelectoresRendicion();

    const rendicion = await obtenerPorId('rendiciones', id);
    if (!rendicion) { mostrarToast('Rendición no encontrada.', 'error'); return; }

    const detalles = await getTodos('detalleGastos');
    detallesActuales = detalles.filter(d => Number(d.rendicionId) === Number(id)).sort((a, b) => (a.orden || 0) - (b.orden || 0));

    const todosAdjuntos = await getTodos('adjuntos');
    adjuntosTemporales['modal'] = [];
    for (let i = 0; i < detallesActuales.length; i++) {
        const detId = detallesActuales[i].id;
        detallesActuales[i].adjuntos = todosAdjuntos.filter(a => Number(a.detalleGastoId) === Number(detId));
    }

    rendicionActual = rendicion;
    detallesModificados = false;

    await llenarFormularioRendicion(rendicion);
    document.getElementById('rendiciones-list-container').style.display = 'none';
    document.getElementById('rendicion-editor').style.display = 'block';

    const badge = document.getElementById('rendicion-estado-badge');
    badge.textContent = rendicion.estado === 'completo' ? 'Completo' : 'Borrador';
    badge.className = `badge ${rendicion.estado === 'completo' ? 'badge-success' : 'badge-warning'}`;

    document.getElementById('cambios-sin-guardar').style.display = 'none';
    renderizarDetalleGastos();
    recalcularTodosLosTotales();
}

function cancelarEdicionRendicion() {
    if (detallesModificados) {
                mostrarConfirmacion(
            'Salir sin guardar',
            'Hay cambios sin guardar en esta rendición. ¿Estás seguro de que deseas salir sin guardar?',
            'warning'
        ).then(ok => {
            if (!ok) return;
            _finalizarSalidaEditorRendicion();
            listarRendiciones();
        });
        return;
    }
    _finalizarSalidaEditorRendicion();
    listarRendiciones();
}

async function eliminarRendicion(id) {
    if (!puedeEditar()) return;
    const confirmado = await mostrarConfirmacion(
        'Eliminar rendición',
        '¿Eliminar esta rendición y todos sus gastos asociados? Esta acción no se puede deshacer.',
        'warning'
    );
    if (!confirmado) return;

    try {
        const detalles = await getTodos('detalleGastos');
        const adjuntos = await getTodos('adjuntos');

        for (const d of detalles.filter(dd => Number(dd.rendicionId) === Number(id))) {
            for (const a of adjuntos.filter(aa => Number(aa.detalleGastoId) === Number(d.id))) {
                await eliminar('adjuntos', a.id);
            }
            await eliminar('detalleGastos', d.id);
        }

        await eliminar('rendiciones', id);
        invalidarCache('detalleGastos');
        invalidarCache('adjuntos');
        dashboardDirty = true;
        mostrarToast('Rendición eliminada correctamente.');
        listarRendiciones();
    } catch (e) {
        console.error('Error al eliminar rendición:', e);
        mostrarToast('Error al eliminar la rendición.', 'error');
    }
}

async function duplicarRendicionId(id) {
    if (!puedeEditar()) return;
    try {
        const orig = await obtenerPorId('rendiciones', id);
        if (!orig) return;

        const detalles = await getTodos('detalleGastos');
        const detallesOrig = detalles.filter(d => Number(d.rendicionId) === Number(id));

        const nueva = { ...orig };
        delete nueva.id;
        nueva.observaciones = (orig.observaciones || '') + ' (Copia)';
        nueva.estado = 'borrador';
        nueva.fechaCreacion = new Date().toISOString();
        nueva.fechaModificacion = new Date().toISOString();
        nueva.usuarioCreacion = currentUser ? currentUser.id : null;
        nueva.usuarioModificacion = currentUser ? currentUser.id : null;

        const newId = await guardar('rendiciones', nueva);

        for (const d of detallesOrig) {
            const nuevoDet = { ...d };
            delete nuevoDet.id;
            nuevoDet.rendicionId = Number(newId);
            const detId = await guardar('detalleGastos', nuevoDet);
            const adjuntos = await getTodos('adjuntos');
            for (const a of adjuntos.filter(aa => Number(aa.detalleGastoId) === Number(d.id))) {
                const nuevoAdj = { ...a };
                delete nuevoAdj.id;
                nuevoAdj.detalleGastoId = Number(detId);
                nuevoAdj.fechaCarga = new Date().toISOString();
                nuevoAdj.usuarioCarga = currentUser ? currentUser.id : null;
                await guardar('adjuntos', nuevoAdj);
            }
        }

        invalidarCache('detalleGastos');
        invalidarCache('adjuntos');
        mostrarToast('Rendición duplicada correctamente.');
        listarRendiciones();
    } catch (e) {
        console.error('Error al duplicar rendición:', e);
        mostrarToast('Error al duplicar la rendición.', 'error');
    }
}

async function duplicarRendicion() {
    if (!rendicionActual || !rendicionActual.id) {
        mostrarToast('Primero debe guardar la rendición actual.', 'warning');
        return;
    }
    await duplicarRendicionId(rendicionActual.id);
}

// Token anti-carrera: renderizarDetalleGastos es async (await por fila) y ahora se
// dispara en vivo desde la tarjeta de combustible. Si dos renders se solapan, cada
// `await` puede entrelazar appends y DUPLICAR filas. Con el token, solo la
// renderización MÁS RECIENTE puede escribir en la tabla.
let _renderDetalleToken = 0;

async function renderizarDetalleGastos() {
    const tbody = document.getElementById('detalle-gastos-body');
    if (!tbody) return;
    const token = ++_renderDetalleToken;
    // 1) Limpieza TOTAL del cuerpo de la tabla antes de cualquier renderizado.
    tbody.innerHTML = '';

    if (detallesActuales.length === 0) {
        if (token !== _renderDetalleToken) return;
        tbody.innerHTML = '<tr><td colspan="16" style="text-align:center;color:var(--text-secondary);padding:2rem;">No hay gastos cargados. Hacé clic en "Agregar Gasto" para comenzar.</td></tr>';
        recalcularTodosLosTotales();
        return;
    }

    const filas = [];
    for (let index = 0; index < detallesActuales.length; index++) {
        const detalle = detallesActuales[index];
        const proveedor = await obtenerNombreProveedor(detalle.proveedorId);
        const concepto = await obtenerNombreConcepto(detalle.conceptoId);
        if (token !== _renderDetalleToken) return; // render obsoleto: abortar sin escribir
        const total = calcularTotalFila(detalle);
        const cantAdj = (detalle.adjuntos && detalle.adjuntos.length) ? detalle.adjuntos.length : 0;

        filas.push(`
            <tr>
                <td style="font-weight:600;text-align:center;">${index + 1}</td>
                <td>${escapeHtml(proveedor)}</td>
                <td>${escapeHtml(detalle.tipoComprobante || '-')}</td>
                <td>${escapeHtml(detalle.numeroComprobante || '-')}</td>
                <td>${formatearFechaVisual(detalle.fecha)}</td>
                <td>${escapeHtml(concepto)}${detalle.excesoTope > 0 ? ` <span title="Supera el tope de combustible por ${formatearMoneda(detalle.excesoTope)}" style="color:#ff9f43;font-size:0.85rem;cursor:help;"><i class="fa-solid fa-triangle-exclamation"></i></span>` : ''}</td>
                <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(detalle.descripcion || '')}">${escapeHtml(detalle.descripcion || '-')}</td>
                <td style="text-align:right;font-weight:500;">${formatearMoneda(Number(detalle.basico || 0))}</td>
                <td style="text-align:right;">${formatearMoneda(Number(detalle.iva || 0))}</td>
                <td style="text-align:right;">${formatearMoneda(Number(detalle.impuestosInternos || 0))}</td>
                <td style="text-align:right;">${formatearMoneda(Number(detalle.percepcionIIBB || 0))}</td>
                <td style="text-align:right;">${formatearMoneda(Number(detalle.percepcionIVA || 0))}</td>
                <td style="text-align:right;">${formatearMoneda(Number(detalle.otrosImpuestos || 0))}</td>
                <td style="text-align:right;color:var(--accent);font-weight:700;">${formatearMoneda(total)}</td>
                <td style="text-align:center;">
                    ${cantAdj > 0 ? `<span style="color:var(--accent-green);cursor:pointer;" onclick="mostrarAdjuntosFila(${index})" title="${cantAdj} archivo(s)"><i class="fa-solid fa-paperclip"></i> ${cantAdj}</span>` : '<span style="color:var(--text-secondary);"><i class="fa-regular fa-paperclip"></i></span>'}
                </td>
                <td>
                    <div class="fila-acciones">
                        <button class="action-btn" onclick="editarFilaGasto(${index})" title="Editar"><i class="fa-solid fa-pen"></i></button>
                        <button class="action-btn" onclick="duplicarFilaGasto(${index})" title="Duplicar"><i class="fa-solid fa-copy"></i></button>
                        <button class="action-btn" onclick="moverFilaArriba(${index})" title="Mover arriba"><i class="fa-solid fa-chevron-up"></i></button>
                        <button class="action-btn" onclick="moverFilaAbajo(${index})" title="Mover abajo"><i class="fa-solid fa-chevron-down"></i></button>
                        <button class="action-btn delete" onclick="eliminarFilaGasto(${index})" title="Eliminar"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </td>
            </tr>`);
    }

    // 2) Escritura ATÓMICA: un único innerHTML, nunca appends intercalados con awaits.
    if (token !== _renderDetalleToken) return;
    tbody.innerHTML = filas.join('');
    recalcularTodosLosTotales();
}

async function obtenerNombreProveedor(id) {
    if (!id) return '-';
    try {
        const p = await obtenerPorId('proveedores', Number(id));
        return p ? p.nombre : 'ID: ' + id;
    } catch(e) {
        return 'ID: ' + id;
    }
}

async function obtenerNombreConcepto(id) {
    if (!id) return '-';
    try {
        const c = await obtenerPorId('conceptos', Number(id));
        return c ? c.nombre : 'ID: ' + id;
    } catch(e) {
        return 'ID: ' + id;
    }
}

function calcularTotalFila(detalle) {
    // REGLA ÚNICA: el total de la fila = Básico + IVA + impuestos, IDÉNTICO al campo
    // TOTAL ($) del formulario. gastoKmDirecto se persiste solo como auditoría y NO suma
    // (era el error conceptual: inflaba el total por encima del TOTAL cargado).
    return Number(detalle.basico || 0) + Number(detalle.iva || 0) +
        Number(detalle.impuestosInternos || 0) + Number(detalle.percepcionIIBB || 0) +
        Number(detalle.percepcionIVA || 0) + Number(detalle.otrosImpuestos || 0);
}

function recalcularTodosLosTotales() {
    let totalBasico = 0, totalIVA = 0, totalImpInternos = 0, totalIIBB = 0;
    let totalPercepcionIVA = 0, totalOtros = 0, totalGeneral = 0;

    detallesActuales.forEach(d => {
        totalBasico += Number(d.basico || 0);
        totalIVA += Number(d.iva || 0);
        totalImpInternos += Number(d.impuestosInternos || 0);
        totalIIBB += Number(d.percepcionIIBB || 0);
        totalPercepcionIVA += Number(d.percepcionIVA || 0);
        totalOtros += Number(d.otrosImpuestos || 0);
        totalGeneral += calcularTotalFila(d);
    });

    document.getElementById('total-basico').textContent = formatearMoneda(totalBasico);
    document.getElementById('total-iva').textContent = formatearMoneda(totalIVA);
    document.getElementById('total-impuestos-internos').textContent = formatearMoneda(totalImpInternos);
    document.getElementById('total-iibb').textContent = formatearMoneda(totalIIBB);
    document.getElementById('total-percepcion-iva').textContent = formatearMoneda(totalPercepcionIVA);
    document.getElementById('total-otros-impuestos').textContent = formatearMoneda(totalOtros);
    document.getElementById('total-general').textContent = formatearMoneda(totalGeneral);
}

// ==================== TOPE DE COMBUSTIBLE: COEFICIENTES FIJOS ====================
// Valores tomados de la plantilla de rendiciones (Control de Automovilismo).
// TopeCalculado = Kilometros * CoeficienteFijo * PrecioLitro
const COEFICIENTES_CILINDRADA = {
    "1000-1300": 0.09,
    "1400-1700": 0.10,
    "1800-1900": 0.12,
    "2000-mas": 0.14
};

// Normaliza texto: minúsculas y sin acentos (kilómetros -> kilometros).
function _normalizarTexto(str) {
    return String(str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

// La tarjeta se muestra ÚNICAMENTE cuando el concepto es exactamente "Combustible"
// (comparación normalizada: sin acentos ni mayúsculas). Cualquier otro concepto la oculta.
function _esConceptoCombustible(nombre) {
    return _normalizarTexto(nombre) === 'combustible';
}

// ==================== DISPARADOR DE VISIBILIDAD DE LA TARJETA ====================
// Única fuente de verdad para mostrar/ocultar el contenedor físico de los 4 inputs
// (#campos-kilometros; acepta #card-kilometros como alias). Null-safe: si algún
// elemento no existe, no rompe el flujo del modal.
function setVisibilidadTarjetaKilometros(visible) {
    const tarjeta = document.getElementById('campos-kilometros') || document.getElementById('card-kilometros');
    const alerta = document.getElementById('alerta-tope-combustible');
    if (tarjeta) tarjeta.style.display = visible ? 'block' : 'none';
    if (alerta && !visible) alerta.style.display = 'none';
    return visible;
}

let filaEditandoIndex = -1;
const _IDS_MODAL_DETALLE_GASTO = [
    'detalle-proveedor', 'detalle-tipo-comprobante', 'detalle-numero-comprobante',
    'detalle-fecha', 'detalle-concepto', 'detalle-descripcion', 'detalle-basico',
    'detalle-iva-porcentaje', 'detalle-iva', 'detalle-impuestos-internos',
    'detalle-percepcion-iibb', 'detalle-percepcion-iva', 'detalle-otros-impuestos',
    'detalle-cantidad-km', 'detalle-valor-km', 'detalle-monto-facturar',
    'detalle-cilindrada', 'detalle-km-tramo-1', 'detalle-precio-litro-1',
    'detalle-km-tramo-2', 'detalle-precio-litro-2'
];
let _fotoModalDetalleGasto = null;

function capturarFotoModalDetalleGasto() {
    return {
        campos: _fotoCampos(_IDS_MODAL_DETALLE_GASTO),
        adjuntos: (adjuntosTemporales['modal'] || []).map(adj => ({
            nombre: adj.nombre,
            tipoArchivo: adj.tipoArchivo,
            archivo: adj.archivo
        }))
    };
}

function modalDetalleGastoTieneCambios() {
    if (!_fotoModalDetalleGasto) return false;
    const actual = capturarFotoModalDetalleGasto();
    return JSON.stringify(actual) !== JSON.stringify(_fotoModalDetalleGasto);
}

async function agregarFilaGasto() {
    try {
        // PASO A: Poblar selects con listas ordenadas A-Z (await para garantizar que estén en el DOM)
        await cargarSelectoresRendicion();

        filaEditandoIndex = -1;
        document.getElementById('detalle-gasto-id').value = '';
        document.getElementById('detalle-gasto-rendicion-id').value = rendicionActual ? (rendicionActual.id || '') : '';
        document.getElementById('detalle-gasto-orden').value = detallesActuales.length + 1;
        document.getElementById('detalle-gasto-modal-title').textContent = 'Agregar Gasto';

        // PASO B: Asignar valores por defecto (las opciones ya existen en el DOM)
        document.getElementById('detalle-proveedor').value = '';
        document.getElementById('detalle-tipo-comprobante').value = '';
        document.getElementById('detalle-numero-comprobante').value = '';
        document.getElementById('detalle-fecha').value = new Date().toISOString().split('T')[0];
        document.getElementById('detalle-concepto').value = '';
        document.getElementById('detalle-descripcion').value = '';
        document.getElementById('detalle-basico').value = '';
        document.getElementById('detalle-iva-porcentaje').value = '21';
        document.getElementById('detalle-iva').value = '';
        document.getElementById('detalle-impuestos-internos').value = '';
        document.getElementById('detalle-percepcion-iibb').value = '';
        document.getElementById('detalle-percepcion-iva').value = '';
        document.getElementById('detalle-otros-impuestos').value = '';
        document.getElementById('detalle-cantidad-km').value = '';
        document.getElementById('detalle-valor-km').value = '';
        document.getElementById('detalle-cilindrada').value = '';
        document.getElementById('detalle-km-tramo-1').value = '';
        document.getElementById('detalle-precio-litro-1').value = '';
        document.getElementById('detalle-km-tramo-2').value = '';
        document.getElementById('detalle-precio-litro-2').value = '';
        document.getElementById('resumen-tarjeta-combustible').style.display = 'none';
        document.getElementById('detalle-monto-facturar').value = '';
        setVisibilidadTarjetaKilometros(false);
        document.getElementById('detalle-total').textContent = '$0.00';
        _totalFormularioActual = 0;
        document.getElementById('detalle-adjuntos-list').innerHTML = '';

        adjuntosTemporales['modal'] = [];
        _fotoModalDetalleGasto = capturarFotoModalDetalleGasto();

        openModal('modal-detalle-gasto');
    } catch (error) {
        console.error('[agregarFilaGasto] Error crítico al intentar agregar gasto:', error);
        mostrarToast('Error al abrir el formulario de gasto. Consola para detalles.', 'error');
    }
}

async function editarFilaGasto(index) {
    try {
        // PASO A: Poblar selects con listas ordenadas A-Z (await para garantizar que estén en el DOM)
        await cargarSelectoresRendicion();

        const detalle = detallesActuales[index];
        if (!detalle) {
            console.error(`[editarFilaGasto] No existe detalle en índice ${index}`);
            return;
        }

        filaEditandoIndex = index;
        document.getElementById('detalle-gasto-id').value = detalle.id || '';
        document.getElementById('detalle-gasto-rendicion-id').value = detalle.rendicionId || '';
        document.getElementById('detalle-gasto-orden').value = detalle.orden || (index + 1);
        document.getElementById('detalle-gasto-modal-title').textContent = 'Editar Gasto';

        // PASO B: Asignar valores precargados (las opciones ya existen en el DOM)
        document.getElementById('detalle-proveedor').value = detalle.proveedorId || '';
        document.getElementById('detalle-tipo-comprobante').value = detalle.tipoComprobante || '';
        document.getElementById('detalle-numero-comprobante').value = detalle.numeroComprobante || '';
        document.getElementById('detalle-fecha').value = detalle.fecha || '';
        document.getElementById('detalle-concepto').value = detalle.conceptoId || '';
        document.getElementById('detalle-descripcion').value = detalle.descripcion || '';
        document.getElementById('detalle-basico').value = detalle.basico || '';
        const ivaPorcentaje = detalle.ivaPorcentaje !== undefined
            ? Number(detalle.ivaPorcentaje)
            : (Number(detalle.basico) > 0 ? (Number(detalle.iva) / Number(detalle.basico)) * 100 : 21);
        const ivaPorcentajeValido = [0, 10.5, 21].includes(ivaPorcentaje) ? ivaPorcentaje : 0;
        document.getElementById('detalle-iva-porcentaje').value = String(ivaPorcentajeValido);
        document.getElementById('detalle-iva').value = detalle.iva || '';
        document.getElementById('detalle-impuestos-internos').value = detalle.impuestosInternos || '';
        document.getElementById('detalle-percepcion-iibb').value = detalle.percepcionIIBB || '';
        document.getElementById('detalle-percepcion-iva').value = detalle.percepcionIVA || '';
        document.getElementById('detalle-otros-impuestos').value = detalle.otrosImpuestos || '';
        document.getElementById('detalle-monto-facturar').value = detalle.montoFacturar || '';
        document.getElementById('detalle-cantidad-km').value = detalle.cantidadKm || '';
        document.getElementById('detalle-valor-km').value = detalle.valorKm || '';
        document.getElementById('detalle-cilindrada').value = detalle.cilindrada || '';
        document.getElementById('detalle-km-tramo-1').value = (detalle.kmTramo1 !== undefined && detalle.kmTramo1 !== null) ? detalle.kmTramo1 : (detalle.kilometrosTotales || detalle.cantidadKm || '');
        document.getElementById('detalle-precio-litro-1').value = (detalle.precioLitro1 !== undefined && detalle.precioLitro1 !== null) ? detalle.precioLitro1 : (detalle.precioLitro || '');
        document.getElementById('detalle-km-tramo-2').value = detalle.kmTramo2 || '';
        document.getElementById('detalle-precio-litro-2').value = detalle.precioLitro2 || '';

        await onCambioConceptoDetalle();
        recalcularTotalFila();

        // Adjuntos
        adjuntosTemporales['modal'] = [];
        if (detalle.adjuntos && detalle.adjuntos.length > 0) {
            detalle.adjuntos.forEach(adj => {
                adjuntosTemporales['modal'].push({ ...adj });
            });
        }
        renderizarAdjuntosModal();
        _fotoModalDetalleGasto = capturarFotoModalDetalleGasto();

        openModal('modal-detalle-gasto');
    } catch (error) {
        console.error('[editarFilaGasto] Error crítico al intentar editar gasto:', error);
        mostrarToast('Error al abrir el editor de gasto. Consola para detalles.', 'error');
    }
}

async function onCambioConceptoDetalle() {
    const concId = document.getElementById('detalle-concepto').value;
    if (!concId) { setVisibilidadTarjetaKilometros(false); return; }
    try {
        const conc = await obtenerPorId('conceptos', Number(concId));
        // SOLO el concepto exacto "Combustible" muestra la tarjeta; cualquier otro
        // (ej. "Comidas" o "Kilometraje") la vuelve a ocultar.
        const esKm = conc && _esConceptoCombustible(conc.nombre);
        setVisibilidadTarjetaKilometros(esKm);
        if (esKm) recalcularTarjetaCombustible();
    } catch(e) {
        console.error('[onCambioConceptoDetalle] Error al evaluar el concepto:', e);
        setVisibilidadTarjetaKilometros(false);
    }
}

// TOTAL ($) vigente del formulario: FUENTE ÚNICA DE VERDAD para fila.total y el
// Total General de la rendición. Lo mantiene recalcularTotalFila().
let _totalFormularioActual = 0;

function recalcularTotalFila() {
    const basico = Number(document.getElementById('detalle-basico').value) || 0;
    const ivaPorcentaje = Number(document.getElementById('detalle-iva-porcentaje').value) || 0;
    const iva = Number((basico * ivaPorcentaje / 100).toFixed(2));
    document.getElementById('detalle-iva').value = iva.toFixed(2);
    const impInt = Number(document.getElementById('detalle-impuestos-internos').value) || 0;
    const iibb = Number(document.getElementById('detalle-percepcion-iibb').value) || 0;
    const percIva = Number(document.getElementById('detalle-percepcion-iva').value) || 0;
    const otros = Number(document.getElementById('detalle-otros-impuestos').value) || 0;
    const total = basico + iva + impInt + iibb + percIva + otros;
    _totalFormularioActual = Number(total.toFixed(2));
    document.getElementById('detalle-total').textContent = formatearMoneda(total);
}

// ==================== VALIDACIÓN DE TOPE DE COMBUSTIBLE ====================
// Estado temporal del cálculo del tope para la fila que se está editando en el modal.
let _topeCombustibleActual = null;
// NOTA: la referencia del importe cargado es SIEMPRE el valor del input "Básico ($)".
// No existe importe original interno (el Math.max con _importeCargadoCombustible fue
// eliminado por introducir referencias stale que violaban el Caso B).

// ==================== LÓGICA DE AJUSTE AUTOMÁTICO POR TOPE (CASOS A/B) ====================
// Caso A: ImporteCargado > TopeMaximo  ->  gasto a pagar = TopeMaximo; excesoTope = diferencia
//         (se guarda solo para auditoría, NO suma al total de la rendición).
// Caso B: ImporteCargado <= TopeMaximo ->  se respeta el ImporteCargado al 100%; excesoTope = 0.
function calcularAjusteTopeCombustible(importeCargado, topeMaximo) {
    importeCargado = Number(importeCargado) || 0;
    topeMaximo = Number(topeMaximo) || 0;
    if (topeMaximo <= 0 || importeCargado <= topeMaximo) {
        return { gastoAPagar: importeCargado, excesoTope: 0, ajustado: false };
    }
    return {
        gastoAPagar: Number(topeMaximo.toFixed(2)),
        excesoTope: Number((importeCargado - topeMaximo).toFixed(2)),
        ajustado: true
    };
}

// Interacción en vivo: aplica el ajuste a la fila activa de la tabla y recalcula los
// totales globales de la carga detallada en tiempo real
// (renderizarDetalleGastos -> recalcularTodosLosTotales).
function _sincronizarFilaCombustibleActiva(info) {
    if (filaEditandoIndex < 0 || filaEditandoIndex >= detallesActuales.length) return;
    const fila = detallesActuales[filaEditandoIndex];
    const num = id => Number(document.getElementById(id).value) || 0;
    // REGLA ÚNICA: la fila ESPEJA EXACTAMENTE el formulario. Caso A (importe > tope):
    // recalcularTarjetaCombustible ya recortó el Básico en el formulario antes de llegar
    // acá; Caso B: los valores del usuario pasan intactos. El Tope NUNCA reemplaza,
    // pisa ni promedia el gasto real del usuario.
    fila.basico = num('detalle-basico');
    fila.ivaPorcentaje = num('detalle-iva-porcentaje');
    fila.iva = num('detalle-iva');
    fila.impuestosInternos = num('detalle-impuestos-internos');
    fila.percepcionIIBB = num('detalle-percepcion-iibb');
    fila.percepcionIVA = num('detalle-percepcion-iva');
    fila.otrosImpuestos = num('detalle-otros-impuestos');
    fila.kilometrosTotales = info.kmTotales;
    fila.valorKm = info.valorKm;
    fila.cilindrada = info.cilindrada || null;
    fila.precioPromedio = info.precioPromedio || null;
    fila.gastoKmDirecto = info.gastoKmDirecto || 0; // solo auditoría, NO suma al total
    fila.importeCargado = fila.basico;
    fila.topeCalculado = info.topeCalculado;
    fila.excesoTope = info.excesoTope;
    // El TOTAL ($) del formulario manda: valor EXACTO que ve el usuario (ej. $69.980,00).
    fila.total = Number(_totalFormularioActual) || calcularTotalFila(fila);
    detallesModificados = true;
    const aviso = document.getElementById('cambios-sin-guardar');
    if (aviso) aviso.style.display = 'inline-flex';
    renderizarDetalleGastos();
}

// Listener del campo Importe (Básico): registra el importe cargado, muestra la
// previsualización del ajuste sin pisar el valor mientras el usuario tipea, y
// sincroniza la fila activa en vivo (evita que la tabla muestre un total desactualizado).
function onInputImporteCargado() {
    recalcularTotalFila();
    recalcularTarjetaCombustible({ ajustarBasico: false, sincronizarFila: true });
}

// ==================== TARJETA COMBUSTIBLE: FÓRMULAS DEL EXCEL ====================
// Lee los 7 campos de la tarjeta #campos-kilometros.
function _leerTarjetaCombustible() {
    const val = id => (document.getElementById(id) ? document.getElementById(id).value : '');
    return {
        kmTotales: Number(val('detalle-cantidad-km')) || 0,
        valorKm: Number(val('detalle-valor-km')) || 0,
        cilindrada: val('detalle-cilindrada'),
        km1: Number(val('detalle-km-tramo-1')) || 0,
        p1: Number(val('detalle-precio-litro-1')) || 0,
        km2: Number(val('detalle-km-tramo-2')) || 0,
        p2: Number(val('detalle-precio-litro-2')) || 0
    };
}

// REGLA DE OMISIÓN: con la tarjeta completamente vacía, el Básico se toma al 100%,
// sin recortes ni validaciones.
function _tarjetaCombustibleVacia(t) {
    return !t.kmTotales && !t.valorKm && !t.cilindrada && !t.km1 && !t.p1 && !t.km2 && !t.p2;
}

// Función pura con las fórmulas del Excel (testeable sin DOM):
//   GastoKmDirecto = KmTotales * ValorKm                  (suma independiente al total)
//   PrecioPromedio = ((Km1*P1)+(Km2*P2))/(Km1+Km2) si hay Tramo 2; si no, Precio1
//   TopeMaximo     = KmTotales * Coeficiente * PrecioPromedio
function calcularTopeCombustible(t) {
    const coeficiente = COEFICIENTES_CILINDRADA[t.cilindrada] || 0;
    const gastoKmDirecto = Number((t.kmTotales * t.valorKm).toFixed(2));
    let precioPromedio = 0;
    if (t.km1 > 0 && t.p1 > 0) {
        precioPromedio = (t.km2 > 0 && t.p2 > 0)
            ? ((t.km1 * t.p1) + (t.km2 * t.p2)) / (t.km1 + t.km2)
            : t.p1;
        precioPromedio = Number(precioPromedio.toFixed(2));
    }
    const topeMaximo = (t.kmTotales > 0 && coeficiente > 0 && precioPromedio > 0)
        ? Number((t.kmTotales * coeficiente * precioPromedio).toFixed(2))
        : null;
    return { coeficiente, gastoKmDirecto, precioPromedio, topeMaximo };
}

// Orquestador en vivo: recalcula resumen + alerta ante cualquier cambio en la tarjeta,
// aplica el recorte del Básico (Caso A) y sincroniza la fila activa de la tabla.
// opciones.ajustarBasico: false = solo previsualizar (no pisa el input mientras se tipea).
// opciones.sincronizarFila: false = no propagar a la tabla todavía.
function recalcularTarjetaCombustible(opciones = {}) {
    const { ajustarBasico = true, sincronizarFila = true } = opciones;
    const resumen = document.getElementById('resumen-tarjeta-combustible');
    const alerta = document.getElementById('alerta-tope-combustible');
    if (!resumen || !alerta) return null;
    _topeCombustibleActual = null;

    const t = _leerTarjetaCombustible();

    // REGLA DE OMISIÓN: tarjeta sin completar -> sin resumen, sin alerta, Básico al 100%.
    if (_tarjetaCombustibleVacia(t)) {
        resumen.style.display = 'none';
        alerta.style.display = 'none';
        return null;
    }

    const calc = calcularTopeCombustible(t);
    const inputBasico = document.getElementById('detalle-basico');
    // Referencia EXACTAMENTE el valor real del input "Básico ($)" cargado por el usuario.
    // Math.max ELIMINADO (usaba una referencia stale del importe original y podía subir
    // la fila al valor del tope). El Tope Máximo JAMÁS es valor por defecto: solo es un
    // límite que recorta cuando el importe ingresado lo supera (Caso A).
    const importeCargado = Number(inputBasico.value) || 0;

    // El tope solo aplica si es computable; con datos faltantes rige la omisión (sin recorte).
    const ajuste = calc.topeMaximo !== null
        ? calcularAjusteTopeCombustible(importeCargado, calc.topeMaximo)
        : { gastoAPagar: importeCargado, excesoTope: 0, ajustado: false };

    // Caso A: fija el Básico exactamente en el Tope Máximo (no mientras el usuario tipea).
    if (ajuste.ajustado && ajustarBasico) {
        inputBasico.value = ajuste.gastoAPagar.toFixed(2);
        recalcularTotalFila();
    }

    // Resumen en vivo.
    document.getElementById('res-precio-promedio').textContent = formatearMoneda(calc.precioPromedio);
    document.getElementById('res-gasto-km').textContent = formatearMoneda(calc.gastoKmDirecto);
    document.getElementById('res-tope-combustible').textContent = calc.topeMaximo !== null ? formatearMoneda(calc.topeMaximo) : '—';
    resumen.style.display = 'block';

    if (calc.topeMaximo === null) {
        alerta.style.background = 'rgba(0,0,0,0.2)';
        alerta.style.borderColor = 'var(--accent)';
        alerta.style.color = 'var(--text-secondary)';
        alerta.innerHTML = `<i class="fa-solid fa-circle-info"></i> Faltan datos para el tope (Km totales + Cilindrada + Precio Litro 1). El Básico se toma al 100% (regla de omisión).`;
    } else if (ajuste.ajustado) {
        alerta.style.background = 'rgba(255,159,67,0.12)';
        alerta.style.borderColor = '#ff9f43';
        alerta.style.color = '#ff9f43';
        alerta.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <strong>Tope excedido:</strong> el Básico se recorta a ${formatearMoneda(ajuste.gastoAPagar)} (Tope Máximo = ${formatearMoneda(calc.topeMaximo)}). Exceso de <strong>${formatearMoneda(ajuste.excesoTope)}</strong> guardado como excesoTope (no suma al total).`;
    } else {
        alerta.style.background = 'rgba(46,213,115,0.12)';
        alerta.style.borderColor = 'var(--accent-green)';
        alerta.style.color = 'var(--accent-green)';
        alerta.innerHTML = `<i class="fa-solid fa-circle-check"></i> Básico dentro del tope (${formatearMoneda(calc.topeMaximo)}): se respeta al 100%.`;
    }
    alerta.style.display = 'block';

    _topeCombustibleActual = {
        kmTotales: t.kmTotales,
        valorKm: t.valorKm,
        cilindrada: t.cilindrada,
        coeficiente: calc.coeficiente,
        precioPromedio: calc.precioPromedio,
        gastoKmDirecto: calc.gastoKmDirecto,
        topeCalculado: calc.topeMaximo,
        importeCargado,
        gastoAPagar: ajuste.gastoAPagar,
        excesoTope: ajuste.excesoTope,
        ajustado: ajuste.ajustado
    };
    if (sincronizarFila) _sincronizarFilaCombustibleActiva(_topeCombustibleActual);
    return _topeCombustibleActual;
}

async function guardarDetalleGastoForm(e) {
    e.preventDefault();
    if (!puedeEditar()) return;

    const conceptoId = document.getElementById('detalle-concepto').value;
    const proveedorId = document.getElementById('detalle-proveedor').value;

    if (!proveedorId) { mostrarToast('Debe seleccionar un proveedor.', 'error'); return; }
    if (!conceptoId) { mostrarToast('Debe seleccionar un concepto.', 'error'); return; }
    if (!document.getElementById('detalle-tipo-comprobante').value) { mostrarToast('Debe seleccionar un tipo de comprobante.', 'error'); return; }
    if (!document.getElementById('detalle-fecha').value) { mostrarToast('Debe ingresar la fecha del comprobante.', 'error'); return; }

    const detalle = {
        proveedorId: Number(proveedorId),
        tipoComprobante: document.getElementById('detalle-tipo-comprobante').value,
        numeroComprobante: document.getElementById('detalle-numero-comprobante').value.trim(),
        fecha: document.getElementById('detalle-fecha').value,
        conceptoId: Number(conceptoId),
        descripcion: document.getElementById('detalle-descripcion').value.trim(),
        basico: Number(document.getElementById('detalle-basico').value) || 0,
        ivaPorcentaje: Number(document.getElementById('detalle-iva-porcentaje').value) || 0,
        iva: Number(document.getElementById('detalle-iva').value) || 0,
        impuestosInternos: Number(document.getElementById('detalle-impuestos-internos').value) || 0,
        percepcionIIBB: Number(document.getElementById('detalle-percepcion-iibb').value) || 0,
        percepcionIVA: Number(document.getElementById('detalle-percepcion-iva').value) || 0,
        otrosImpuestos: Number(document.getElementById('detalle-otros-impuestos').value) || 0,
        cantidadKm: Number(document.getElementById('detalle-cantidad-km').value) || 0,
        valorKm: Number(document.getElementById('detalle-valor-km').value) || 0,
        montoFacturar: document.getElementById('detalle-monto-facturar').value ? Number(document.getElementById('detalle-monto-facturar').value) : null,
        total: 0
    };

    // ==================== TOPE + GASTO KM DIRECTO (Fórmulas del Excel) ====================
    const tarjetaComb = _leerTarjetaCombustible();
    if (!_tarjetaCombustibleVacia(tarjetaComb)) {
        const calc = calcularTopeCombustible(tarjetaComb);
        // La referencia es EXACTAMENTE el valor del input "Básico ($)" que el usuario
        // cargó. Sin Math.max ni máximos internos: el Tope Máximo solo es un límite que
        // recorta cuando el importe ingresado lo supera (Caso A); si es menor o igual
        // (Caso B), .basico conserva EXACTAMENTE el importe ingresado (ej. $45.980,00).
        const importeCargado = Number(document.getElementById('detalle-basico').value) || 0;
        // Sin tope computable (datos incompletos) rige la REGLA DE OMISIÓN: Básico al 100%.
        const ajuste = calc.topeMaximo !== null
            ? calcularAjusteTopeCombustible(importeCargado, calc.topeMaximo)
            : { gastoAPagar: importeCargado, excesoTope: 0, ajustado: false };

        if (ajuste.ajustado) {
            // Recorte (Caso A): el Básico queda fijado exactamente en el Tope Máximo.
            detalle.basico = ajuste.gastoAPagar;
            detalle.iva = Number((ajuste.gastoAPagar * detalle.ivaPorcentaje / 100).toFixed(2));
            // Reflejar el recorte en el formulario y recalcular el TOTAL ($) mostrado.
            document.getElementById('detalle-basico').value = detalle.basico.toFixed(2);
            document.getElementById('detalle-iva').value = detalle.iva.toFixed(2);
        }

        detalle.importeCargado = Number(Number(importeCargado || 0).toFixed(2));
        detalle.kilometrosTotales = tarjetaComb.kmTotales;
        detalle.valorKm = tarjetaComb.valorKm;
        detalle.cilindrada = tarjetaComb.cilindrada || null;
        detalle.coeficienteConsumo = calc.coeficiente || null;
        detalle.precioPromedio = calc.precioPromedio || null;
        detalle.kmTramo1 = tarjetaComb.km1;
        detalle.precioLitro1 = tarjetaComb.p1;
        detalle.kmTramo2 = tarjetaComb.km2;
        detalle.precioLitro2 = tarjetaComb.p2;
        detalle.gastoKmDirecto = calc.gastoKmDirecto;
        detalle.topeCalculado = calc.topeMaximo;
        detalle.excesoTope = ajuste.excesoTope;

        // El Gasto por Kilometraje Directo queda REGISTRADO en la fila (auditoría),
        // pero NO suma al total: el único valor que suma es el TOTAL ($) del formulario.
        if (calc.gastoKmDirecto > 0) {
            mostrarToast(`Gasto por Kilometraje Directo registrado: ${formatearMoneda(calc.gastoKmDirecto)} (${tarjetaComb.kmTotales} km × ${formatearMoneda(tarjetaComb.valorKm)}/km). No suma al total.`, 'success');
        }
        if (ajuste.ajustado) {
            mostrarToast(`Básico recortado al Tope Máximo de combustible (${formatearMoneda(calc.topeMaximo)}). Exceso de ${formatearMoneda(ajuste.excesoTope)} guardado como excesoTope, no suma al total.`, 'warning');
        }
    }

    // ==================== PERSISTENCIA DEL TOTAL: EL TOTAL ($) DEL FORMULARIO MANDA ====================
    // Se recalcula el TOTAL ($) del formulario (Básico + IVA + impuestos, exactamente el
    // valor que ve el usuario, ej. $69.980,00) y ese ES el valor que se guarda en la fila,
    // va a la tabla y suma al Total General de la rendición. El Tope Máximo del modal es
    // solo un techo técnico (Caso A) y jamás reemplaza el total real.
    recalcularTotalFila();
    detalle.total = Number(_totalFormularioActual) || calcularTotalFila(detalle);

    const idExistente = document.getElementById('detalle-gasto-id').value;

    if (filaEditandoIndex >= 0 && filaEditandoIndex < detallesActuales.length) {
        if (idExistente) detalle.id = Number(idExistente);
        detalle.rendicionId = detallesActuales[filaEditandoIndex].rendicionId || (rendicionActual ? rendicionActual.id : null);
        detalle.adjuntos = [...(adjuntosTemporales['modal'] || [])];
        detallesActuales[filaEditandoIndex] = detalle;
    } else {
        detalle.rendicionId = rendicionActual ? rendicionActual.id : null;
        detalle.adjuntos = [...(adjuntosTemporales['modal'] || [])];
        detallesActuales.push(detalle);
    }

    detallesModificados = true;
    document.getElementById('cambios-sin-guardar').style.display = 'inline-flex';

    closeModalDetalleGasto(true);
    renderizarDetalleGastos();
}

async function closeModalDetalleGasto(guardado = false) {
    if (!guardado && modalDetalleGastoTieneCambios()) {
        const confirmado = await mostrarConfirmacion(
            'Salir sin guardar',
            'Hay cambios sin guardar en este gasto. ¿Deseás salir y perderlos?',
            'warning'
        );
        if (!confirmado) return;
    }

    closeModal('modal-detalle-gasto');
    adjuntosTemporales['modal'] = [];
    _fotoModalDetalleGasto = null;
}

function marcarDetallesModificados() {
    detallesModificados = true;
    document.getElementById('cambios-sin-guardar').style.display = 'inline-flex';
    renderizarDetalleGastos();
}


async function eliminarFilaGasto(index) {
    const confirmado = await mostrarConfirmacion(
        'Eliminar gasto',
        `¿Eliminar el gasto #${index + 1}?`,
        'warning'
    );
    if (!confirmado) return;
    detallesActuales.splice(index, 1);
    adjuntosTemporales['modal'] = [];
    const newAdj = {};
    for (const k in adjuntosTemporales) {
        if (k === 'modal') continue;
        const ki = parseInt(k);
        if (ki > index) {
            newAdj[String(ki - 1)] = adjuntosTemporales[k];
        } else if (ki < index) {
            newAdj[k] = adjuntosTemporales[k];
        }
    }
    adjuntosTemporales = { modal: [], ...newAdj };
    marcarDetallesModificados();
}

function duplicarFilaGasto(index) {
    const original = detallesActuales[index];
    if (!original) return;
    const copia = { ...original };
    delete copia.id;
    detallesActuales.splice(index + 1, 0, copia);
    adjuntosTemporales['modal'] = [];
    marcarDetallesModificados();
}

function moverFilaArriba(index) {
    if (index <= 0) return;
    [detallesActuales[index], detallesActuales[index - 1]] = [detallesActuales[index - 1], detallesActuales[index]];
    adjuntosTemporales['modal'] = [];
    adjuntosTemporales['modal'] = [];
    adjuntosTemporales['modal'] = [];
    marcarDetallesModificados();
}

function moverFilaAbajo(index) {
    if (index >= detallesActuales.length - 1) return;
    [detallesActuales[index], detallesActuales[index + 1]] = [detallesActuales[index + 1], detallesActuales[index]];
    adjuntosTemporales['modal'] = [];
    adjuntosTemporales['modal'] = [];
    adjuntosTemporales['modal'] = [];
    marcarDetallesModificados();
}

function agregarAdjuntoADetalle() {
    const fileInput = document.getElementById('detalle-adjunto-file');
    const files = fileInput.files;
    if (!files || files.length === 0) { mostrarToast('Seleccioná al menos un archivo.', 'warning'); return; }

    for (const file of files) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const adj = {
                nombre: file.name,
                archivo: e.target.result,
                tipoArchivo: file.type
            };
            adjuntosTemporales['modal'].push(adj);
            renderizarAdjuntosModal();
        };
        reader.readAsDataURL(file);
    }
    fileInput.value = '';
}

function renderizarAdjuntosModal() {
    const container = document.getElementById('detalle-adjuntos-list');
    const adjuntos = adjuntosTemporales['modal'] || [];
    container.innerHTML = '';

    if (adjuntos.length === 0) {
        container.innerHTML = '<span style="color:var(--text-secondary);font-size:0.85rem;">Sin archivos adjuntos.</span>';
        return;
    }

    adjuntos.forEach((adj, idx) => {
        const div = document.createElement('div');
        div.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:0.35rem 0.5rem;background:var(--bg-secondary);border-radius:4px;cursor:pointer;';
        div.title = 'Haga doble clic para abrir';
        const icono = adj.tipoArchivo?.includes('pdf') ? 'fa-file-pdf' :
                      adj.tipoArchivo?.includes('image') ? 'fa-file-image' :
                      adj.tipoArchivo?.includes('xml') ? 'fa-file-code' : 'fa-file';
        
        // Usar textContent para el nombre y event listeners en lugar de inline onclick
        const span = document.createElement('span');
        span.style.cssText = 'display:flex;align-items:center;gap:0.4rem;cursor:pointer;';
        span.innerHTML = `<i class="fa-regular ${icono}"></i>`;
        span.appendChild(document.createTextNode(' ' + adj.nombre));
        span.title = 'Haga doble clic para abrir';
        span.ondblclick = () => abrirArchivoAdjunto(adj.nombre, adj.archivo);
        
        const btnEliminar = document.createElement('button');
        btnEliminar.type = 'button';
        btnEliminar.className = 'action-btn delete';
        btnEliminar.style.cssText = 'padding:0.15rem 0.3rem;';
        btnEliminar.innerHTML = '<i class="fa-solid fa-times"></i>';
        btnEliminar.onclick = () => eliminarAdjuntoModal(idx);
        
        div.appendChild(span);
        div.appendChild(btnEliminar);
        container.appendChild(div);
    });
}

function abrirArchivoAdjunto(nombre, archivoData) {
    if (!archivoData) return;
    try {
        // Validar que sea un data URL seguro (solo tipos permitidos)
        const tiposPermitidos = ['image/', 'application/pdf', 'text/plain', 'text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument', 'application/msword', 'application/zip', 'application/xml', 'text/xml'];
        const esDataUrl = archivoData.startsWith('data:');
        const esSeguro = esDataUrl && tiposPermitidos.some(t => archivoData.startsWith('data:' + t));
        
        if (!esSeguro) {
            mostrarToast('Tipo de archivo no permitido para visualización.', 'error');
            return;
        }
        
        const win = window.open('', '_blank');
        if (!win) { mostrarToast('El navegador bloqueó la ventana emergente.', 'error'); return; }
        
        if (esDataUrl) {
            const mimeType = archivoData.split(';')[0].split(':')[1] || 'application/octet-stream';
            // Escapar el nombre para evitar inyección HTML
            const nombreSeguro = escapeHtml(nombre);
            win.document.write(`<html><head><title>${nombreSeguro}</title></head><body style="margin:0;display:flex;justify-content:center;align-items:center;height:100vh;background:#f0f0f0;">
                <embed src="${archivoData}" style="width:100%;height:100%;border:none;" type="${mimeType}">
                </body></html>`);
            win.document.title = nombre;
        } else {
            win.document.write(`<pre>${escapeHtml(archivoData)}</pre>`);
        }
    } catch(e) {
        mostrarToast('Error al abrir el archivo.', 'error');
    }
}

function eliminarAdjuntoModal(idx) {
    if (adjuntosTemporales['modal'][idx]) {
        adjuntosTemporales['modal'].splice(idx, 1);
    }
    renderizarAdjuntosModal();
}

function mostrarAdjuntosFila(index) {
    adjuntosTemporales['modal'] = [];
    const adjuntos = detallesActuales[index]?.adjuntos || [];
    if (adjuntos.length === 0) { mostrarToast('Sin archivos adjuntos.', 'warning'); return; }
    let msg = 'Archivos adjuntos:\n\n';
    adjuntos.forEach((a, i) => {
        msg += `${i+1}. ${a.nombre} (${a.tipoArchivo || 'desconocido'})\n`;
    });
    alert(msg);
}

async function abrirModalGestorProveedores() {
    const proveedores = await getTodos('proveedores');
    const container = document.getElementById('gasto-proveedores-list');
    if (!container) {
        const modalHtml = `
        <div id="modal-gasto-proveedor" class="modal-overlay">
            <div class="modal">
                <div class="modal-header">
                    <h2 class="modal-title">Gestionar Proveedores</h2>
                    <button class="modal-close" onclick="closeModal('modal-gasto-proveedor')">&times;</button>
                </div>
                <div class="modal-content" style="max-height: 400px; overflow-y: auto;">
                    <div id="gasto-proveedores-list" style="display: flex; flex-direction: column; gap: 0.5rem;"></div>
                </div>
                <div class="modal-footer">
                    <form id="form-gasto-proveedor-quick" onsubmit="guardarProveedorRapidoModal(event)" style="display: flex; gap: 0.5rem; width: 100%;">
                        <input type="text" id="quick-proveedor-nombre" placeholder="Nuevo proveedor..." required style="flex: 1;">
                        <button type="submit" class="btn" style="padding: 0.5rem 1rem;">+ Agregar</button>
                    </form>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" onclick="closeModal('modal-gasto-proveedor')">Cerrar</button>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    const listContainer = document.getElementById('gasto-proveedores-list');
    listContainer.innerHTML = '';

    proveedores.forEach(prov => {
        const div = document.createElement('div');
        div.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; background-color: var(--bg-card); border-radius: 6px;';
        div.innerHTML = `
            <span style="font-weight: 500;">${prov.nombre} ${prov.cuit ? '('+prov.cuit+')' : ''}</span>
            <div style="display: flex; gap: 0.5rem;">
                <button type="button" class="action-btn" style="padding: 0.25rem 0.5rem;" onclick="editarProveedorModal(${prov.id})" title="Editar">
                    <i class="fa-solid fa-pen-to-square"></i>
                </button>
                <button type="button" class="action-btn delete" style="padding: 0.25rem 0.5rem;" onclick="eliminarProveedorModal(${prov.id})" title="Eliminar">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        `;
        listContainer.appendChild(div);
    });

    document.getElementById('quick-proveedor-nombre').value = '';
    openModal('modal-gasto-proveedor');
}

async function guardarProveedorRapidoModal(e) {
    e.preventDefault();
    if (!puedeEditar()) return;
    const nombre = document.getElementById('quick-proveedor-nombre').value.trim();
    if (!nombre) return;
    await guardar('proveedores', { nombre });
    invalidarCache('proveedores');
    await cargarSelectoresRendicion();
    await abrirModalGestorProveedores();
}

async function editarProveedorModal(id) {
    if (!puedeEditar()) return;
    const prov = await obtenerPorId('proveedores', id);
    if (!prov) return;
    const nuevoNombre = prompt('Editar nombre del proveedor:', prov.nombre);
    if (nuevoNombre && nuevoNombre.trim() !== '') {
        prov.nombre = nuevoNombre.trim();
        await guardar('proveedores', prov);
        invalidarCache('proveedores');
        await cargarSelectoresRendicion();
        await abrirModalGestorProveedores();
    }
}

async function eliminarProveedorModal(id) {
    if (!puedeEditar()) return;
    if (!confirm('¿Eliminar este proveedor permanentemente?')) return;
    const detalles = await getTodos('detalleGastos');
    if (detalles.some(d => Number(d.proveedorId) === Number(id))) {
        if (!confirm('Hay gastos que usan este proveedor. ¿Eliminar de todas formas?')) return;
    }
    await eliminar('proveedores', id);
    invalidarCache('proveedores');
    await cargarSelectoresRendicion();
    await abrirModalGestorProveedores();
}

function agregarConceptoRapidoDetalle() {
    if (!document.getElementById('modal-concepto-rapido')) {
        const modalHtml = `
        <div id="modal-concepto-rapido" class="modal-overlay">
            <div class="modal">
                <div class="modal-header">
                    <h2 class="modal-title">Nuevo Concepto</h2>
                    <button class="modal-close" onclick="closeModal('modal-concepto-rapido')">&times;</button>
                </div>
                <form id="form-concepto-rapido" onsubmit="guardarConceptoRapidoDetalle(event)">
                    <div class="form-grid">
                        <div class="form-group full-width">
                            <label for="concepto-rapido-nombre">Nombre del Concepto</label>
                            <input type="text" id="concepto-rapido-nombre" placeholder="Ej: Viáticos, Combustible, ..." required>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" onclick="closeModal('modal-concepto-rapido')">Cancelar</button>
                        <button type="submit" class="btn">Guardar Concepto</button>
                    </div>
                </form>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }
    document.getElementById('concepto-rapido-nombre').value = '';
    openModal('modal-concepto-rapido');
    setTimeout(() => document.getElementById('concepto-rapido-nombre').focus(), 100);
}

async function guardarConceptoRapidoDetalle(e) {
    e.preventDefault();
    const nombre = document.getElementById('concepto-rapido-nombre').value.trim();
    if (!nombre) { mostrarToast('El nombre del concepto es obligatorio.', 'error'); return; }
    await guardar('conceptos', { nombre });
    invalidarCache('conceptos');
    closeModal('modal-concepto-rapido');
    await cargarSelectoresRendicion();
    mostrarToast('Concepto agregado correctamente.');
}

function agregarProveedorRapido() {
    document.getElementById('proveedor-rapido-nombre').value = '';
    document.getElementById('proveedor-rapido-cuit').value = '';
    document.getElementById('proveedor-rapido-telefono').value = '';
    openModal('modal-proveedor-rapido');
}

async function guardarProveedorRapido(e) {
    e.preventDefault();
    const nombre = document.getElementById('proveedor-rapido-nombre').value.trim();
    if (!nombre) { mostrarToast('El nombre es obligatorio.', 'error'); return; }
    const proveedor = {
        nombre,
        cuit: document.getElementById('proveedor-rapido-cuit').value.trim(),
        telefono: document.getElementById('proveedor-rapido-telefono').value.trim()
    };
    await guardar('proveedores', proveedor);
    invalidarCache('proveedores');
    closeModal('modal-proveedor-rapido');
    mostrarToast('Proveedor guardado.');
    await cargarSelectoresRendicion();
}

async function imprimirRendicion() {
    if (!rendicionActual) { mostrarToast('No hay rendición activa.', 'warning'); return; }
    const datos = obtenerDatosFormularioRendicion();
    const [competencias, circuitos, staff] = await Promise.all([
        getTodos('competencias'), getTodos('circuitos'), getTodos('staff')
    ]);
    const comp = competencias.find(c => Number(c.id) === Number(datos.competenciaId));
    const circ = circuitos.find(c => Number(c.id) === Number(datos.autodromoId));
    const resp = staff.find(s => Number(s.id) === Number(datos.responsableId));

    let html = `<html><head><meta charset="utf-8"><title>Rendición #${rendicionActual.id || 'Nueva'}</title>
    <style>
        body { font-family: Arial, sans-serif; padding: 2rem; color: #333; }
        h1 { border-bottom: 2px solid #ff4757; padding-bottom: 0.5rem; }
        table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
        th { background: #f5f5f5; padding: 0.5rem; text-align: left; border: 1px solid #ddd; font-size: 0.8rem; }
        td { padding: 0.5rem; border: 1px solid #ddd; font-size: 0.85rem; }
        .total-row { font-weight: bold; background: #ffebee; }
        .totals { margin-top: 1rem; display: flex; justify-content: flex-end; gap: 2rem; }
        .totals div { text-align: right; }
        .totals .label { font-size: 0.8rem; color: #666; }
        .totals .value { font-size: 1.2rem; font-weight: bold; color: #ff4757; }
    </style></head><body>
    <h1>Rendición de Gastos ${rendicionActual.id ? '#'.concat(rendicionActual.id) : ''}</h1>
    <p><strong>Competencia:</strong> ${comp ? escapeHtml(comp.nombre) : '-'} | <strong>Autódromo:</strong> ${circ ? escapeHtml(circ.nombre) : '-'} | <strong>Responsable:</strong> ${resp ? escapeHtml(resp.nombre + ' ' + resp.apellido) : escapeHtml(datos.responsableNombre || '-')}</p>
    <p><strong>Fecha:</strong> ${escapeHtml(datos.fecha)} | <strong>Estado:</strong> ${escapeHtml(datos.estado)}</p>
    <p><strong>Observaciones:</strong> ${escapeHtml(datos.observaciones || '-')}</p>`;

    if (detallesActuales.length > 0) {
        html += `<table><thead><tr>
            <th>#</th><th>Proveedor</th><th>Comp.</th><th>N°</th><th>Fecha</th><th>Concepto</th>
            <th>Básico</th><th>IVA</th><th>IIBB</th><th>Total</th>
        </tr></thead><tbody>`;
        for (let idx = 0; idx < detallesActuales.length; idx++) {
            const d = detallesActuales[idx];
            var prov = await obtenerNombreProveedor(d.proveedorId);
            var conc = await obtenerNombreConcepto(d.conceptoId);
            html += `<tr>
                <td>${idx+1}</td><td>${escapeHtml(prov)}</td><td>${escapeHtml(d.tipoComprobante || '-')}</td>
                <td>${escapeHtml(d.numeroComprobante || '-')}</td><td>${formatearFechaVisual(d.fecha)}</td>
                <td>${escapeHtml(conc)}</td>
                <td style="text-align:right;">${formatearMoneda(Number(d.basico || 0))}</td>
                <td style="text-align:right;">${formatearMoneda(Number(d.iva || 0))}</td>
                <td style="text-align:right;">${formatearMoneda(Number(d.percepcionIIBB || 0))}</td>
                <td style="text-align:right;font-weight:bold;">${formatearMoneda(calcularTotalFila(d))}</td>
            </tr>`;
        }
        html += `</tbody></table>`;

        const totalGral = detallesActuales.reduce((s, d) => s + calcularTotalFila(d), 0);
        html += `<div class="totals"><div><div class="label">TOTAL GENERAL</div><div class="value">${formatearMoneda(totalGral)}</div></div></div>`;
    }

    html += `<p style="margin-top:2rem;color:#999;font-size:0.8rem;">Generado el ${new Date().toLocaleString()} - Sistema Control CDA</p>`;
    html += `</body></html>`;

    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
    win.print();
}

function exportarPDFRendicion() {
    mostrarToast('La exportación a PDF se realiza desde la vista de impresión (Ctrl+P).', 'warning');
    imprimirRendicion();
}

async function exportarExcelRendicion() {
    if (!rendicionActual) { mostrarToast('No hay rendición activa.', 'warning'); return; }
    if (detallesActuales.length === 0) { mostrarToast('No hay gastos para exportar.', 'warning'); return; }

    let csv = '\uFEFF';
    csv += 'N.,Proveedor,Tipo Comp.,N Comprobante,Fecha,Concepto,Descripcion,Basico,IVA,Imp Internos,IIBB,Percep IVA,Otros Imp.,Total\r\n';

    // Función para sanitizar campos CSV contra inyección de fórmulas
    function sanitizarCSV(valor) {
        const str = String(valor || '').replace(/,/g, ' ');
        // Prevenir CSV Injection: si empieza con =, +, -, @, tab o retorno, anteponer comilla simple
        if (/^[=+\-@\t\r]/.test(str)) {
            return "'" + str;
        }
        return str;
    }

    for (let idx = 0; idx < detallesActuales.length; idx++) {
        var d2 = detallesActuales[idx];
        var prov = sanitizarCSV(await obtenerNombreProveedor(d2.proveedorId) || '-');
        var conc = sanitizarCSV(await obtenerNombreConcepto(d2.conceptoId) || '-');
        var desc = sanitizarCSV(d2.descripcion || '');
        var linea = String(idx + 1) + ',' + prov + ',' + sanitizarCSV(d2.tipoComprobante || '') + ',' + sanitizarCSV(d2.numeroComprobante || '') + ',' + (d2.fecha || '') + ',' + conc + ',' + desc;
        linea += ',' + (Number(d2.basico || 0).toFixed(2)) + ',' + (Number(d2.iva || 0).toFixed(2)) + ',' + (Number(d2.impuestosInternos || 0).toFixed(2));
        linea += ',' + (Number(d2.percepcionIIBB || 0).toFixed(2)) + ',' + (Number(d2.percepcionIVA || 0).toFixed(2)) + ',' + (Number(d2.otrosImpuestos || 0).toFixed(2));
        linea += ',' + (calcularTotalFila(d2).toFixed(2));
        csv += linea + '\r\n';
    }

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `rendicion_${rendicionActual.id || 'nueva'}_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    mostrarToast('Archivo Excel exportado correctamente.');
}

// ====================================================================
// MÓDULO: INVENTARIO
// ====================================================================

let chartInvCategorias = null;
let chartInvStock = null;

async function cargarDatosVista(viewId) {
    const v = typeof window !== 'undefined' ? window.__CDA_MODULES__?.vistas : null;
    if (v && typeof v.cargarDatosVista === 'function') {
        return v.cargarDatosVista(viewId);
    }
}

// ===== CLASIFICACIÓN VISUAL DE MOVIMIENTOS (vocabulario canónico Fase 3) =====
// Reemplaza las listas hardcodeadas de ingresos/egresos: se basa en 'tipoMovimiento'
// y en la propiedad booleana 'esIngreso' (migrada en Fase 1 y escrita en Fase 2).
function categorizarMovimientoV9(mov) {
    const tipo = String(mov.tipoMovimiento || '').toLowerCase();
    const LABELS = {
        ingreso: 'Ingreso',
        consumo: 'Consumo',
        'transferencia_interna': 'Transferencia interna',
        devolucion: 'Devolución',
        baja: 'Baja',
        ajuste: 'Ajuste'
    };
    const label = LABELS[tipo] || tipo || 'Movimiento';
    const cantidad = Number(mov.cantidad || 0);
    switch (tipo) {
        case 'ingreso':
        case 'devolucion':
            return { clase: 'mov-in', icono: 'fa-arrow-down', label, signo: '+', cantidad };
        case 'consumo':
        case 'baja':
            return { clase: 'mov-out', icono: 'fa-arrow-up', label, signo: '-', cantidad };
        case 'transferencia_interna':
            return { clase: 'mov-transfer', icono: 'fa-arrow-right-arrow-left', label, signo: '', cantidad };
        case 'ajuste':
            return { clase: 'mov-adjust', icono: 'fa-scale-balanced', label, signo: '±', cantidad };
        default: {
            const esIngreso = mov.esIngreso === true || ['ingreso', 'devolucion', 'compra', 'reposicion'].includes(tipo);
            return { clase: esIngreso ? 'mov-in' : 'mov-out', icono: esIngreso ? 'fa-arrow-down' : 'fa-arrow-up', label, signo: esIngreso ? '+' : '-', cantidad };
        }
    }
}

// ===== DESGLOSE DE STOCK POR UBICACIÓN (Fase 3) =====
// Agrega el array embebido articulo.ubicaciones[] por ubicación (sumando entre talles)
// y devuelve [{ nombre, cantidad }] ordenado de mayor a menor. Devuelve [] si el artículo
// aún no tiene datos migrados (legacy), en cuyo caso la UI muestra solo el total.
function normalizarUbicacionesArticuloV9(art, ubicaciones) {
    if (!art || !Array.isArray(art.ubicaciones) || art.ubicaciones.length === 0) return { filas: [], reparada: false };

    const catalogo = Array.isArray(ubicaciones) ? ubicaciones : [];
    const porId = new Map(catalogo.map(u => [Number(u.id), u]));
    const porNombre = new Map(catalogo.map(u => [String(u.nombre || '').trim().toLowerCase(), u]));
    const deposito = catalogo.find(u => String(u.nombre || '').trim().toLowerCase() === 'depósito central') || catalogo[0];
    let reparada = false;

    const filas = art.ubicaciones.map((fila, index) => {
        if (!fila) return null;

        const ubicacionOriginal = porId.get(Number(fila.ubicacionId));
        const nombreLegacy = fila.ubicacionNombre || fila.ubicacion || fila.sector;
        const ubicacionPorNombre = nombreLegacy
            ? porNombre.get(String(nombreLegacy).trim().toLowerCase())
            : null;
        const ubicacion = ubicacionOriginal || ubicacionPorNombre || (art.sector
            ? porNombre.get(String(art.sector).trim().toLowerCase())
            : null) || deposito;

        const cantidadRaw = Number(fila.cantidad ?? fila.stock ?? fila.total ?? 0);
        const cantidad = Number.isFinite(cantidadRaw) ? Math.max(0, cantidadRaw) : 0;
        if (!ubicacion) return { ...fila, cantidad };

        const normalizada = {
            ...fila,
            id: fila.id ?? (Date.now() + index),
            ubicacionId: Number(ubicacion.id),
            talleId: fila.talleId ?? null,
            cantidad
        };

        if (Number(fila.ubicacionId) !== Number(normalizada.ubicacionId)
            || cantidadRaw !== Number(fila.cantidad ?? fila.stock ?? fila.total ?? 0)
            || cantidad < 0) {
            reparada = true;
        }
        return cantidad > 0 ? normalizada : null;
    }).filter(Boolean);

    return { filas, reparada };
}

function construirDesgloseStockV9(art, articuloTalles, ubicaciones) {
    if (!art || !Array.isArray(art.ubicaciones) || art.ubicaciones.length === 0) return [];
    const normalizadas = normalizarUbicacionesArticuloV9(art, ubicaciones).filas;
    const nombreDe = (idUbi) => {
        const u = (ubicaciones || []).find(x => Number(x.id) === Number(idUbi));
        return u ? u.nombre : null;
    };
    const mapa = new Map();
    for (const fila of normalizadas) {
        if (!fila) continue;
        const cant = Math.max(0, Number(fila.cantidad || 0));
        if (!cant) continue;
        const nombre = nombreDe(fila.ubicacionId) || 'Depósito Central';
        mapa.set(nombre, (mapa.get(nombre) || 0) + cant);
    }
    return Array.from(mapa.entries())
        .map(([nombre, cantidad]) => ({ nombre, cantidad }))
        .sort((a, b) => b.cantidad - a.cantidad);
}

// Muestra/oculta el desglose de ubicaciones bajo el badge de stock de la tabla de artículos.
function toggleDesgloseStockV9(badgeEl) {
    const detalle = badgeEl.parentElement && badgeEl.parentElement.querySelector('.stock-desglose');
    if (!detalle) return;
    const visible = detalle.style.display !== 'none';
    detalle.style.display = visible ? 'none' : 'block';
    const chev = badgeEl.querySelector('.fa-chevron-down, .fa-chevron-up');
    if (chev) chev.className = visible ? 'fa-solid fa-chevron-down fa-xs' : 'fa-solid fa-chevron-up fa-xs';
}
// ===== TIPO DE BIEN EFECTIVO (corrección Fase 3) =====
// Los artículos legacy no tienen 'tipoBien' propio: lo heredan de su categoría. Si se lee
// 'art.tipoBien' directo, un Bien de Uso antiguo se clasifica como 'consumible' y una
// entrega le descuenta stock del patrimonio total. Resolver SIEMPRE con estos helpers.
// ===== AUTO-REPARACIÓN DE ubicaciones[] (pura, sin efectos secundarios) =====
// Reconstruye la distribución por ubicación de un artículo cuyo array fue perdido
// (ej.: re-escritura del documento desde el formulario de edición). Replays el historial
// de movimientos y devuelve las filas SOLO si el replay cuadra con el stock declarado.
function reconstruirUbicacionesDesdeMovimientosV9(art, movimientos, catalogo, idBodega) {
    try {
        if (!art || art.controlaTalles) return null; // artículos con talles usan el fallback clásico
        if (!Array.isArray(movimientos) || !Array.isArray(catalogo) || !Number.isFinite(Number(idBodega))) return null;
        const mapaUbiV9 = new Map(catalogo.map(u => [String(u && u.nombre).trim().toLowerCase(), Number(u.id)]));
        const idDeNombre = (nombre) => {
            const id = mapaUbiV9.get(String(nombre == null ? '' : nombre).trim().toLowerCase());
            return Number.isFinite(id) ? id : null;
        };
        const clave = (u, t) => `${u == null ? 'null' : Number(u)}|${t == null ? 'null' : Number(t)}`;
        // Estrategia A: el stock declarado arranca en Bodega y se replaya el historial.
        // Estrategia B: arranca en 0 y el historial (ingresos) crea el stock. Se acepta la
        // primera cuya suma final coincida con stockUnico; si ninguna cuadra, null (fallback).
        const replay = (inicialEnBodega) => {
            const map = new Map();
            const add = (u, t, d) => { const k = clave(u, t); map.set(k, (map.get(k) || 0) + d); };
            if (inicialEnBodega) add(Number(idBodega), null, Number(art.stockUnico || 0));
            const movs = movimientos
                .filter(m => Number(m && m.articuloId) === Number(art.id))
                .sort((a, b) => new Date(a.fecha || 0) - new Date(b.fecha || 0));
            if (movs.length === 0) return inicialEnBodega ? [{ id: -1, ubicacionId: Number(idBodega), talleId: null, cantidad: Number(art.stockUnico || 0) }] : null;
            for (const m of movs) {
                const cant = Number(m.cantidad || 0);
                if (!Number.isFinite(cant) || cant === 0) continue;
                const talleId = m.talleId ? Number(m.talleId) : null;
                // Normaliza tipos legacy (egreso/entrega/perdida/...) al vocabulario canónico.
                const tipoMapeado = (typeof mapearTipoMovimientoV9 === 'function')
                    ? mapearTipoMovimientoV9(m.tipoMovimiento, art.tipoBien || null)
                    : m.tipoMovimiento;
                const tipo = String(tipoMapeado && typeof tipoMapeado === 'object'
                    ? tipoMapeado.tipoMovimiento
                    : tipoMapeado || '').toLowerCase();
                if (tipo === 'ingreso' || tipo === 'devolucion') {
                    const dest = idDeNombre(String(m.ubicacionDestino || '').trim().toLowerCase()) || Number(idBodega);
                    add(dest, talleId, cant);
                } else if (tipo === 'consumo' || tipo === 'baja') {
                    const orig = idDeNombre(String(m.ubicacionOrigen || '').trim().toLowerCase()) || Number(idBodega);
                    add(orig, talleId, -cant);
                } else if (tipo === 'transferencia_interna') {
                    const orig = idDeNombre(String(m.ubicacionOrigen || '').trim().toLowerCase()) || Number(idBodega);
                    const dest = idDeNombre(String(m.ubicacionDestino || '').trim().toLowerCase());
                    if (dest != null) { add(orig, talleId, -cant); add(dest, talleId, cant); }
                }
            }
            const filas = [];
            let suma = 0;
            for (const [k, cant] of map) {
                const [u, t] = k.split('|');
                const c = Math.max(0, Number(cant) || 0); // anti-negativos defensivo
                if (c === 0) continue;
                suma += c;
                filas.push({ id: -(Number(art.id) || 0) * 1000 - filas.length - 1, ubicacionId: Number(u), talleId: t === 'null' ? null : Number(t), cantidad: c });
            }
            return (filas.length > 0 && suma === Number(art.stockUnico || 0)) ? filas : null;
        };
        return replay(true) || replay(false);
    } catch (e) {
        console.warn('reconstruirUbicacionesDesdeMovimientosV9: no se pudo reconstruir:', e);
        return null;
    }
}

function tipoBienEfectivoV9(art, categorias) {
    try {
        if (art && art.tipoBien) return art.tipoBien;
        const lista = Array.isArray(categorias) ? categorias : [];
        const cat = lista.find(c => c && Number(c.id) === Number(art && art.categoriaId));
        if (cat && cat.tipoBien) return cat.tipoBien;
        // Última línea de defensa: 'sector' (ubicación física asignada) solo se guarda en
        // Bienes de Uso. Si el artículo lo tiene poblado sin tipoBien heredable, es un bien de uso.
        if (art && art.sector) return 'bien_uso';
        return 'consumible';
    } catch (e) {
        console.warn('tipoBienEfectivoV9: datos inconsistentes, fallback a consumible:', e);
        return 'consumible';
    }
}

// Variante async para contextos sin la lista de categorías cargada (formularios).
async function resolverTipoBienArticuloV9(art) {
    try {
        if (art && art.tipoBien) return art.tipoBien;
        if (art && art.categoriaId) {
            const cat = await obtenerPorId('categoriasInventario', Number(art.categoriaId));
            if (cat && cat.tipoBien) return cat.tipoBien;
        }
        if (art && art.sector) return 'bien_uso';
        return 'consumible';
    } catch (e) {
        console.warn('resolverTipoBienArticuloV9: datos inconsistentes, fallback a consumible:', e);
        return 'consumible';
    }
}

async function renderDashboardInventario() {
    const [articulos, articuloTalles, movimientos] = await Promise.all([
        getTodos('articulos'),
        getTodos('articuloTalles'),
        getTodos('movimientosInventario')
    ]);

    const totalArticulos = articulos.filter(a => a.activo !== false).length;
    const totalUnidades = calcularStockTotal(articulos, articuloTalles);
    const articulosSinStock = contarArticulosSinStock(articulos, articuloTalles);
    const articulosBajoStock = contarArticulosBajoStock(articulos, articuloTalles);
    const ultimosMovs = movimientos.length;

    document.getElementById('inv-stat-total-articulos').textContent = totalArticulos;
    document.getElementById('inv-stat-total-unidades').textContent = totalUnidades;
    document.getElementById('inv-stat-stock-bajo').textContent = articulosBajoStock;
    document.getElementById('inv-stat-sin-stock').textContent = articulosSinStock;
    document.getElementById('inv-stat-ultimos-mov').textContent = ultimosMovs;

    const categorias = await getTodos('categoriasInventario');
    const articulosPorCat = {};
    const stockPorCat = {};

    categorias.forEach(c => {
        articulosPorCat[c.nombre] = 0;
        stockPorCat[c.nombre] = 0;
    });

    for (const art of articulos) {
        if (art.activo === false) continue;
        const cat = categorias.find(c => c.id === Number(art.categoriaId));
        const catName = cat ? cat.nombre : 'Sin categoría';
        if (!articulosPorCat[catName]) articulosPorCat[catName] = 0;
        articulosPorCat[catName]++;

        let stockArt = 0;
        if (art.controlaTalles) {
            const tallesArt = articuloTalles.filter(at => Number(at.articuloId) === Number(art.id));
            stockArt = tallesArt.reduce((s, t) => s + Number(t.stock || 0), 0);
        } else {
            stockArt = Number(art.stockUnico || 0);
        }
        if (!stockPorCat[catName]) stockPorCat[catName] = 0;
        stockPorCat[catName] += stockArt;
    }

    if (chartInvCategorias) chartInvCategorias.destroy();
    const invCatLabels = Object.keys(articulosPorCat).filter(k => articulosPorCat[k] > 0);
    chartInvCategorias = new Chart(document.getElementById('chart-inv-categorias').getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: invCatLabels,
            datasets: [{
                data: invCatLabels.map(k => articulosPorCat[k]),
                // Mismo criterio que el dashboard principal: un color por categoría
                // (matiz distinto, nunca el mismo color en dos luminosidades) y en
                // el mismo orden azul -> verde -> ambar -> violeta -> turquesa.
                backgroundColor: paletaGraficos(invCatLabels.length),
                borderWidth: 2,
                borderColor: cssVar('--bg-card'),
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '62%',
            plugins: {
                // Punto circular con el color del sector: se cruza sin releer.
                legend: { position: 'right', labels: { color: cssVar('--text-secondary'), usePointStyle: true, pointStyle: 'circle', boxWidth: 8, padding: 12, font: { size: 11, family: 'Outfit' } } }
            }
        }
    });

    if (chartInvStock) chartInvStock.destroy();
    const invStockLabels = Object.keys(stockPorCat).filter(k => stockPorCat[k] > 0);
    chartInvStock = new Chart(document.getElementById('chart-inv-stock').getContext('2d'), {
        type: 'bar',
        data: {
            labels: invStockLabels,
            datasets: [{
                label: 'Unidades',
                data: invStockLabels.map(k => stockPorCat[k]),
                // Un color por categoría, en el mismo orden que la torta: ambas
                // vistas del inventario se leen como una sola.
                backgroundColor: paletaGraficos(invStockLabels.length),
                hoverBackgroundColor: cssVar('--text-primary'),
                borderRadius: 6,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { grid: { color: cssVar('--chart-grid') }, ticks: { color: cssVar('--text-secondary') } },
                x: { grid: { display: false }, ticks: { color: cssVar('--text-secondary') } }
            }
        }
    });

    const ultimosMov = movimientos.sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0)).slice(0, 10);
    const container = document.getElementById('inv-ultimos-movimientos');
    container.innerHTML = '';
    if (ultimosMov.length === 0) {
        container.innerHTML = '<p style="color:var(--text-secondary);padding:1rem;text-align:center;">No hay movimientos registrados.</p>';
        return;
    }
    for (const mov of ultimosMov) {
        const art = await obtenerPorId('articulos', Number(mov.articuloId));
        const artName = art ? art.nombre : 'ID: ' + mov.articuloId;
        const c = categorizarMovimientoV9(mov);
        const item = document.createElement('div');
        item.className = `movement-item ${c.clase}`;
        item.innerHTML = `
            <div class="mov-icon"><i class="fa-solid ${c.icono}"></i></div>
            <div class="mov-info">
                <div class="mov-title">${escapeHtml(artName)}</div>
                <div class="mov-meta">${c.label} • ${escapeHtml(mov.motivo || '')} • ${formatearFechaVisual(mov.fecha)}</div>
            </div>
            <div class="mov-qty">${c.signo}${c.cantidad}</div>
        `;
        container.appendChild(item);
    }
}

function calcularStockTotal(articulos, articuloTalles) {
    return articulos.reduce((sum, art) => {
        if (art.activo === false) return sum;
        if (art.controlaTalles) {
            const tallesArt = articuloTalles.filter(at => Number(at.articuloId) === Number(art.id));
            return sum + tallesArt.reduce((s, t) => s + Number(t.stock || 0), 0);
        }
        return sum + Number(art.stockUnico || 0);
    }, 0);
}

function calcularStockArticulo(art, articuloTalles) {
    if (art.controlaTalles) {
        const tallesArt = articuloTalles.filter(at => Number(at.articuloId) === Number(art.id));
        return tallesArt.reduce((s, t) => s + Number(t.stock || 0), 0);
    }
    return Number(art.stockUnico || 0);
}


function contarArticulosSinStock(articulos, articuloTalles) {
    return articulos.filter(art => {
        if (art.activo === false) return false;
        const stock = calcularStockArticulo(art, articuloTalles);
        return stock === 0;
    }).length;
}

function contarArticulosBajoStock(articulos, articuloTalles) {
    return articulos.filter(art => {
        if (art.activo === false) return false;
        const stock = calcularStockArticulo(art, articuloTalles);
        return stock > 0 && stock <= (art.stockMinimo || 0);
    }).length;
}

async function listarArticulos() {
    const [articulos, categorias, articuloTalles, ubicaciones, movimientosInventario] = await Promise.all([
        getTodos('articulos'),
        getTodos('categoriasInventario'),
        getTodos('articuloTalles'),
        getTodos('ubicacionesInventario'),
        getTodos('movimientosInventario')
    ]);

    const filtroCat = document.getElementById('filtro-articulo-categoria').value;
    const filtroEstado = document.getElementById('filtro-articulo-estado').value;
    const filtroStock = document.getElementById('filtro-articulo-stock').value;
    const buscador = document.getElementById('buscar-articulos').value.toLowerCase();

    let filtrados = articulos.filter(a => {
        if (filtroCat !== 'todas' && String(a.categoriaId) !== String(filtroCat)) return false;
        if (filtroEstado === 'activos' && a.activo === false) return false;
        if (filtroEstado === 'inactivos' && a.activo !== false) return false;

        const stock = articuloTalles.filter(at => Number(at.articuloId) === Number(a.id)).reduce((s, t) => s + Number(t.stock || 0), 0) + Number(a.stockUnico || 0);
        if (filtroStock === 'bajo' && (stock > (a.stockMinimo || 0) || stock === 0)) return false;
        if (filtroStock === 'sin' && stock > 0) return false;
        if (filtroStock === 'con' && stock === 0) return false;

        if (buscador) {
            const buscaEn = `${a.codigo} ${a.nombre} ${a.marca || ''} ${a.modelo || ''} ${a.color || ''}`.toLowerCase();
            if (!buscaEn.includes(buscador)) return false;
        }
        return true;
    }).sort((a, b) => a.nombre.localeCompare(b.nombre));

    const tbody = document.getElementById('articulos-table-body');
    tbody.innerHTML = '';

    if (filtrados.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text-secondary);">No hay artículos que coincidan con los filtros.</td></tr>`;
        return;
    }

    for (const art of filtrados) {
      // Blindaje por artículo (Fase 3-hotfix): si el cálculo de stock/estados de UN artículo
      // falla, se registra el error y se pinta una fila genérica; la tabla NUNCA queda vacía.
      try {
        const cat = categorias.find(c => c.id === Number(art.categoriaId));
        const catName = cat ? cat.nombre : '-';

        // FASE 3 (corrección): cálculo de stock según Tipo de Bien.
        // Consumible  → stock mostrado = Bodega Central (lo entregado se considera gastado).
        // Bien de Uso → stock mostrado = SUMATORIA ABSOLUTA de TODAS las ubicaciones
        //               (Bodega + Camión + Carrera + ...): el activo sigue existiendo.
        const esBienUso = tipoBienEfectivoV9(art, categorias) === 'bien_uso';
        let total = 0, enBodega = null, enUsoV9 = 0;
        const tallesArt = art.controlaTalles ? articuloTalles.filter(at => Number(at.articuloId) === Number(art.id)) : [];
        if (art.controlaTalles) {
            total = tallesArt.reduce((s, t) => s + Number(t.stock || 0), 0);
            const bodegaUbiV9 = (ubicaciones || []).find(u => String(u.nombre).trim().toLowerCase() === 'depósito central')
                || (ubicaciones || []).find(u => String(u.nombre).trim().toLowerCase().includes('depósito'));
            if (bodegaUbiV9 && Array.isArray(art.ubicaciones) && art.ubicaciones.length > 0) {
                const sumaUbicaciones = art.ubicaciones.reduce((s, f) => s + Number(f.cantidad || 0), 0);
                if (sumaUbicaciones !== total) {
                    art.ubicaciones = tallesArt
                        .filter(t => Number(t.stock || 0) > 0)
                        .map(t => ({ id: Date.now() + Math.random(), ubicacionId: Number(bodegaUbiV9.id), talleId: Number(t.talleId), cantidad: Number(t.stock || 0) }));
                    if (art.ubicaciones.length === 0) {
                        art.ubicaciones = [{ id: Date.now(), ubicacionId: Number(bodegaUbiV9.id), talleId: null, cantidad: 0 }];
                    }
                    try { await guardar('articulos', art); } catch (eSync) { console.warn('listarArticulos: no se pudo sincronizar art.ubicaciones con artculoTalles:', eSync); }
                }
            }
        } else {
            total = Number(art.stockUnico || 0);
        }
        const bodegaUbiV9 = (ubicaciones || []).find(u => String(u.nombre).trim().toLowerCase() === 'depósito central')
            || (ubicaciones || []).find(u => String(u.nombre).trim().toLowerCase().includes('depósito'));
        // Validación en caliente (solo memoria, no persiste): si la migración V9 aún no cubrió
        // este artículo (sin ubicaciones[]), se inicializa con todo su stock en Bodega Central
        // para que el desglose y el cálculo funcionen y la pantalla no quede en blanco.
        if ((!Array.isArray(art.ubicaciones) || art.ubicaciones.length === 0) && bodegaUbiV9) {
            // Auto-reparación (Fase-3 hotparche): primero se intenta reconstruir la distribución
            // REAL desde el historial de movimientos; si no hay historial útil, se asume todo
            // el stock en Bodega Central (comportamiento anterior).
            const reconstruidasV9 = reconstruirUbicacionesDesdeMovimientosV9(art, movimientosInventario, ubicaciones || [], Number(bodegaUbiV9.id));
            art.ubicaciones = reconstruidasV9 || [{ id: -Number(art.id || 0), ubicacionId: Number(bodegaUbiV9.id), talleId: null, cantidad: total }];
            // La reparación exitosa se persiste para no reprocesarla en cada render (solo entra
            // aquí cuando el documento NO tiene ubicaciones[]; es idempotente).
            if (reconstruidasV9) {
                try {
                    await guardar('articulos', art);
                    console.log(`listarArticulos: ubicaciones[] reconstruidas desde movimientos para el artículo ${art.id}.`);
                } catch (eRepV9) { console.warn('No se pudo persistir la reparación de ubicaciones:', eRepV9); }
            }
        }
        // Para Bienes de Uso, el historial de transferencias es la fuente de reparación
        // cuando el array persistido conserva todo el stock en una sola ubicación.
        if (esBienUso && !art.controlaTalles && bodegaUbiV9 && movimientosInventario.length > 0) {
            const reconstruidasHistV9 = reconstruirUbicacionesDesdeMovimientosV9(
                art, movimientosInventario, ubicaciones || [], Number(bodegaUbiV9.id)
            );
            const claveStockV9 = filas => (filas || [])
                .reduce((mapa, fila) => {
                    const clave = `${Number(fila.ubicacionId)}|${fila.talleId == null ? 'null' : Number(fila.talleId)}`;
                    mapa.set(clave, (mapa.get(clave) || 0) + Number(fila.cantidad || 0));
                    return mapa;
                }, new Map());
            const actualStockV9 = claveStockV9(art.ubicaciones);
            const historicoStockV9 = claveStockV9(reconstruidasHistV9);
            const stocksCoincidenV9 = actualStockV9.size === historicoStockV9.size
                && [...historicoStockV9].every(([clave, cantidad]) => actualStockV9.get(clave) === cantidad);
            if (reconstruidasHistV9 && !stocksCoincidenV9) {
                art.ubicaciones = reconstruidasHistV9;
                art.stockUnico = reconstruidasHistV9.reduce((s, fila) => s + Number(fila.cantidad || 0), 0);
                try {
                    await guardar('articulos', art);
                } catch (eHistV9) {
                    console.warn('No se pudo persistir la reconstrucción histórica:', eHistV9);
                }
            }
        }
        const normalizacionUbiV9 = normalizarUbicacionesArticuloV9(art, ubicaciones || []);
        const filasUbicacionesV9 = normalizacionUbiV9.filas;
        if (normalizacionUbiV9.reparada) {
            art.ubicaciones = filasUbicacionesV9;
            try {
                await guardar('articulos', art);
            } catch (eNormalizarV9) {
                console.warn('No se pudo normalizar la ubicación del artículo:', eNormalizarV9);
            }
        }
        if (filasUbicacionesV9.length > 0 && bodegaUbiV9) {
            const idBodegaV9 = Number(bodegaUbiV9.id);
            // "En Bodega" = estrictamente la(s) fila(s) cuya ubicacionId es la Bodega principal.
            enBodega = filasUbicacionesV9.filter(f => Number(f.ubicacionId) === idBodegaV9).reduce((s, f) => s + Number(f.cantidad || 0), 0);
            // "En Uso" = sumatoria DIRECTA de TODAS las demás ubicaciones (Camión, Carrera, ...).
            // Nunca se deriva del total: se cuenta fila por fila.
            enUsoV9 = filasUbicacionesV9.filter(f => Number(f.ubicacionId) !== idBodegaV9).reduce((s, f) => s + Number(f.cantidad || 0), 0);
        }
        // REGLA (Bien de Uso): el número principal del badge SIEMPRE es el reduce() absoluto de
        // TODAS las cantidades del array ubicaciones[] (Bodega + Camión + Carrera + ...). Nunca
        // el stock de una sola ubicación ni un stockUnico/articuloTalles desactualizado.
        if (esBienUso && filasUbicacionesV9.length > 0) {
            total = filasUbicacionesV9.reduce((s, f) => s + Number(f.cantidad || 0), 0);
        }
        const stock = esBienUso ? total : (enBodega != null ? enBodega : total);

        const stockParaAlerta = esBienUso ? total : stock;
        let stockBadge = 'stock-ok';
        if (stockParaAlerta === 0) stockBadge = 'stock-out';
        else if (stockParaAlerta <= (art.stockMinimo || 0)) stockBadge = 'stock-low';

        const estadoBadge = art.activo !== false ? 'badge-active' : 'badge-inactive';
        const estadoText = art.activo !== false ? 'Activo' : 'Inactivo';

        // Celda de stock: desglose "¿dónde está físicamente?" a partir de art.ubicaciones[].
        // Bien de Uso → "Total: 10 (3 en Bodega / 7 en Uso)" con badges de estado.
        const desgloseStock = construirDesgloseStockV9({ ...art, ubicaciones: filasUbicacionesV9 }, articuloTalles, ubicaciones || []);
        let stockCellHtml;
        if (esBienUso && desgloseStock.length > 0) {
            // enUsoV9 ya fue calculado como sumatoria directa de las ubicaciones != Bodega.
            const resumenV9 = desgloseStock.map(d => `${d.nombre}: ${d.cantidad}`).join(' | ') + ` (Total: ${total})`;
            const itemsV9 = desgloseStock.map(d => `<div class="stock-desglose-item"><span>${escapeHtml(d.nombre)}</span><b>${d.cantidad}</b></div>`).join('');
            stockCellHtml = `
                <span class="stock-badge ${stockBadge} stock-desglose-toggle" title="${escapeHtml(resumenV9)}" onclick="toggleDesgloseStockV9(this)"><i class="fa-solid fa-cube"></i> Total: ${total} <i class="fa-solid fa-chevron-down fa-xs"></i></span>
                <div class="stock-estados-bu">
                    <span class="stock-estado stock-estado-bodega" title="Disponible en Bodega Central"><i class="fa-solid fa-warehouse"></i> ${enBodega != null ? enBodega : 0} en Bodega</span>
                    <span class="stock-estado stock-estado-uso" title="Asignado a ubicaciones operativas (en uso)"><i class="fa-solid fa-truck"></i> ${enUsoV9} en Uso</span>
                </div>
                <div class="stock-desglose" style="display:none;">${itemsV9}<div class="stock-desglose-item stock-desglose-total"><span>Total</span><b>${total}</b></div></div>`;
        } else if (desgloseStock.length > 0) {
            const resumen = desgloseStock.map(d => `${d.nombre}: ${d.cantidad}`).join(' | ') + ` (Total: ${total})`;
            const items = desgloseStock.map(d => `<div class="stock-desglose-item"><span>${escapeHtml(d.nombre)}</span><b>${d.cantidad}</b></div>`).join('');
            const tituloV9 = enBodega != null
                ? `Stock en Bodega Central: ${stock}. Resto consumido/transferido. Total: ${total}`
                : resumen;
            stockCellHtml = `
                <span class="stock-badge ${stockBadge} stock-desglose-toggle" title="${escapeHtml(tituloV9)}" onclick="toggleDesgloseStockV9(this)"><i class="fa-solid fa-cube"></i> ${stock} <i class="fa-solid fa-chevron-down fa-xs"></i></span>
                <div class="stock-desglose" style="display:none;">${items}<div class="stock-desglose-item stock-desglose-total"><span>Total</span><b>${total}</b></div></div>`;
        } else {
            stockCellHtml = `<span class="stock-badge ${stockBadge}" title="${esBienUso ? 'Total de unidades del bien en todas las ubicaciones' : 'Unidades disponibles'}"><i class="fa-solid fa-cube"></i> ${stock}</span>`;
        }

        const acciones = puedeEditar() ? `
            <td style="text-align:right;white-space:nowrap;">
                <button class="action-btn" onclick="verArticulo(${art.id})" title="Ver detalle"><i class="fa-solid fa-eye"></i></button>
                <button class="action-btn" onclick="editarArticulo(${art.id})" title="Editar"><i class="fa-solid fa-pen-to-square"></i></button>
                <button class="action-btn" onclick="duplicarArticulo(${art.id})" title="Duplicar"><i class="fa-solid fa-copy"></i></button>
                ${esAdmin() ? `<button class="action-btn" onclick="abrirAjusteStockAdmin(${art.id})" title="Ajustar Stock (solo Administrador)"><i class="fa-solid fa-sliders"></i></button>` : ''}
                ${esAdmin() ? `<button class="action-btn delete" onclick="eliminarArticulo(${art.id})" title="Eliminar (solo Administrador)"><i class="fa-solid fa-trash"></i></button>` : ''}
            </td>
        ` : `
            <td style="text-align:right;white-space:nowrap;">
                <button class="action-btn" onclick="verArticulo(${art.id})" title="Ver detalle"><i class="fa-solid fa-eye"></i></button>
            </td>
        `;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-weight:600;font-family:monospace;">${escapeHtml(art.codigo)}</td>
            <td style="font-weight:600;">${escapeHtml(art.nombre)}</td>
            <td>${escapeHtml(catName)}</td>
            <td>${escapeHtml(art.marca || '-')}</td>
            <td>${stockCellHtml}</td>
            <td><span class="badge ${estadoBadge}">${estadoText}</span></td>
            <td>${esBienUso ? escapeHtml(art.sector || '-') : '-'}</td>
            ${acciones}
        `;
        tbody.appendChild(tr);
      } catch (errArt) {
          console.error(`listarArticulos: error al renderizar el artículo ID ${art && art.id}:`, errArt);
          // Render genérico de emergencia con el stockUnico legacy, para no perder la fila.
          const stockFallback = Number((art && art.stockUnico) || 0);
          const activoFb = art && art.activo !== false;
          const trFb = document.createElement('tr');
          trFb.innerHTML = `
              <td style="font-weight:600;font-family:monospace;">${escapeHtml((art && art.codigo) || '-')}</td>
              <td style="font-weight:600;">${escapeHtml((art && art.nombre) || `Artículo #${art && art.id}`)}</td>
              <td>-</td>
              <td>${escapeHtml((art && art.marca) || '-')}</td>
              <td><span class="stock-badge ${stockFallback === 0 ? 'stock-out' : 'stock-ok'}"><i class="fa-solid fa-cube"></i> ${stockFallback}</span></td>
              <td><span class="badge ${activoFb ? 'badge-active' : 'badge-inactive'}">${activoFb ? 'Activo' : 'Inactivo'}</span></td>
              <td>-</td>
              <td style="text-align:right;"><button class="action-btn" onclick="verArticulo(${art && art.id})" title="Ver detalle"><i class="fa-solid fa-eye"></i></button></td>
          `;
          tbody.appendChild(trFb);
      }
    }

    const selectCat = document.getElementById('filtro-articulo-categoria');
    const savedCat = selectCat.value;
    selectCat.innerHTML = '<option value="todas">Todas</option>';
    categorias.forEach(c => selectCat.innerHTML += `<option value="${c.id}">${c.nombre}</option>`);
    selectCat.value = savedCat;
}

async function verArticulo(id) {
    const art = await obtenerPorId('articulos', id);
    if (!art) return;
    
    const [categorias, articuloTalles, movimientos, imagenes, ubicaciones] = await Promise.all([
        getTodos('categoriasInventario'),
        getTodos('articuloTalles'),
        getTodos('movimientosInventario'),
        getTodos('imagenesArticulo'),
        getTodos('ubicacionesInventario')
    ]);
    
    const cat = categorias.find(c => c.id === Number(art.categoriaId));
    const catName = cat ? cat.nombre : '-';
    const sub = categorias.find(c => c.id === Number(art.subcategoriaId));
    const subName = sub ? sub.nombre : '-';
    
    let stock = 0;
    let stockDetalle = '';
    if (art.controlaTalles) {
        const talles = await getTodos('talles');
        const tallesArt = articuloTalles.filter(at => Number(at.articuloId) === Number(art.id));
        stock = tallesArt.reduce((s, t) => s + Number(t.stock || 0), 0);
        stockDetalle = tallesArt.map(t => {
            const talle = talles.find(tl => tl.id === Number(t.talleId));
            return `${talle ? talle.nombre : '?'}: ${t.stock}`;
        }).join(', ') || 'Sin stock por talle';
    } else {
        stock = Number(art.stockUnico || 0);
        stockDetalle = `${stock} unidades`;
    }

    // Fase 3: desglose físico por ubicación para el modal de detalle
    const desgloseUbi = construirDesgloseStockV9(art, articuloTalles, ubicaciones);
    const stockUbiHtml = desgloseUbi.length > 0 ? `<div style="margin-top:0.75rem;padding-top:0.75rem;border-top:1px solid var(--border-color);display:flex;flex-wrap:wrap;gap:0.5rem;">${desgloseUbi.map(d => `<span style="background:var(--bg-secondary);padding:0.25rem 0.6rem;border-radius:4px;font-size:0.85rem;"><i class="fa-solid fa-location-dot" style="color:var(--accent-blue);margin-right:0.35rem;"></i>${escapeHtml(d.nombre)}: <b>${d.cantidad}</b></span>`).join('')}</div>` : '';

    if (!document.getElementById('modal-ver-articulo')) {
        const modalHtml = `
        <div id="modal-ver-articulo" class="modal-overlay">
            <div class="modal modal-lg">
                <div class="modal-header">
                    <h2 class="modal-title"><span id="ver-art-codigo"></span></h2>
                    <button class="modal-close" onclick="closeModal('modal-ver-articulo')">&times;</button>
                </div>
                <div class="modal-content" style="padding:1.5rem;">
                    <div class="stats-grid" id="ver-art-stats" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:1.5rem;"></div>
                    <div class="form-card" style="margin-bottom:1rem;">
                        <div class="form-title"><i class="fa-solid fa-circle-info"></i> Información General</div>
                        <div id="ver-art-info" style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;padding:0.5rem 0;"></div>
                    </div>
                    ${art.imagenPrincipal ? `<div class="form-card" style="margin-bottom:1rem;"><div class="form-title"><i class="fa-solid fa-image"></i> Imagen Principal</div><img src="${escapeHtml(art.imagenPrincipal)}" style="max-width:100%;max-height:300px;border-radius:8px;" onerror="this.style.display='none'"></div>` : ''}
                    ${imagenes.length > 0 ? `<div class="form-card" style="margin-bottom:1rem;"><div class="form-title"><i class="fa-solid fa-images"></i> Galería</div><div class="article-gallery" id="ver-art-galeria"></div></div>` : ''}
                    <div class="form-card">
                        <div class="form-title"><i class="fa-solid fa-warehouse"></i> Stock</div>
                        <div id="ver-art-stock" style="padding:0.5rem 0;font-size:1.1rem;"></div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" onclick="closeModal('modal-ver-articulo')">Cerrar</button>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    document.getElementById('ver-art-codigo').textContent = art.codigo;

    document.getElementById('ver-art-stats').innerHTML = `
        <div class="stat-card" style="padding:1rem;"><div class="stat-info"><h3 style="font-size:0.85rem;">Nombre</h3><p style="font-size:1.1rem;font-weight:600;">${escapeHtml(art.nombre)}</p></div><div class="stat-icon"><i class="fa-solid fa-box"></i></div></div>
        <div class="stat-card" style="padding:1rem;"><div class="stat-info"><h3 style="font-size:0.85rem;">Categoría</h3><p style="font-size:1.1rem;">${escapeHtml(catName)}</p></div><div class="stat-icon"><i class="fa-solid fa-tag"></i></div></div>
        <div class="stat-card" style="padding:1rem;"><div class="stat-info"><h3 style="font-size:0.85rem;">Stock Total</h3><p style="font-size:1.1rem;color:var(--accent);font-weight:700;">${stock}</p></div><div class="stat-icon"><i class="fa-solid fa-cubes"></i></div></div>
        <div class="stat-card" style="padding:1rem;"><div class="stat-info"><h3 style="font-size:0.85rem;">Estado</h3><p style="font-size:1.1rem;"><span class="badge ${art.activo !== false ? 'badge-active' : 'badge-inactive'}">${art.activo !== false ? 'Activo' : 'Inactivo'}</span></p></div><div class="stat-icon"><i class="fa-solid fa-circle-check"></i></div></div>
    `;

    document.getElementById('ver-art-info').innerHTML = `
        <div><strong>Nombre:</strong> ${escapeHtml(art.nombre)}</div>
        <div><strong>Código:</strong> <span style="font-family:monospace;">${escapeHtml(art.codigo)}</span></div>
        <div><strong>Categoría:</strong> ${escapeHtml(catName)}</div>
        ${subName !== '-' ? `<div><strong>Subcategoría:</strong> ${escapeHtml(subName)}</div>` : ''}
        ${art.marca ? `<div><strong>Marca:</strong> ${escapeHtml(art.marca)}</div>` : ''}
        ${art.modelo ? `<div><strong>Modelo:</strong> ${escapeHtml(art.modelo)}</div>` : ''}
        ${art.color ? `<div><strong>Color:</strong> ${escapeHtml(art.color)}</div>` : ''}
        <div><strong>Stock Mínimo:</strong> ${art.stockMinimo || 0}</div>
        <div><strong>Controla Talles:</strong> ${art.controlaTalles ? 'Sí' : 'No'}</div>
        ${art.observaciones ? `<div style="grid-column:1/-1;"><strong>Observaciones:</strong> ${escapeHtml(art.observaciones)}</div>` : ''}
    `;

    if (art.controlaTalles) {
        const talles = await getTodos('talles');
        const tallesArt = articuloTalles.filter(at => Number(at.articuloId) === Number(art.id));
        document.getElementById('ver-art-stock').innerHTML = (tallesArt.length > 0 ? 
            `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:0.75rem;">${tallesArt.map(t => {
                const talle = talles.find(tl => tl.id === Number(t.talleId));
                return `<div style="background:var(--bg-secondary);padding:0.75rem;border-radius:6px;text-align:center;"><div style="font-size:0.85rem;color:var(--text-secondary);">${talle ? talle.nombre : '?'}</div><div style="font-size:1.3rem;font-weight:700;color:var(--accent-blue);">${t.stock || 0}</div></div>`;
            }).join('')}</div>` : '<span style="color:var(--text-secondary);">Sin stock configurado por talle.</span>') + stockUbiHtml;
    } else {
        document.getElementById('ver-art-stock').innerHTML = `<span style="font-weight:700;font-size:1.4rem;color:var(--accent);">${stock}</span> <span style="color:var(--text-secondary);">unidades en stock</span>` + stockUbiHtml;
    }

    if (imagenes.length > 0) {
        const gal = document.getElementById('ver-art-galeria');
        gal.innerHTML = '';
        imagenes.forEach(img => {
            const item = document.createElement('div');
            item.className = 'article-gallery-item';
            // XSS (HALLazgo 5): antes se interpolaba `escapeHtml(img.url)` dentro
            // de una cadena HTML con un manejador `onerror` INLINE. Eso es doble
            // peligroso: (1) el atributo onerror es un vector de ejecución de
            // script y (2) un `escapeHtml` no escapa comillas de forma orientada a
            // contexto de atributo, de modo que una URL con `"` rompiera la
            // cadena y permitiría inyectar atributos (event handlers) propios.
            //
            // Se construye la imagen con propiedades nativas del DOM: la URL viaja
            // por `img.src` (el navegador la trata como URL, no como HTML) y el
            // `onerror` se registra con `addEventListener` sobre el objeto, sin
            // cadena de marcado. Mismo resultado visual, sin superficie de XSS.
            const imgEl = document.createElement('img');
            imgEl.alt = 'Imagen';
            imgEl.addEventListener('error', function () { this.style.display = 'none'; });
            imgEl.src = img && img.url ? String(img.url) : '';
            item.appendChild(imgEl);
            gal.appendChild(item);
        });
    }

    openModal('modal-ver-articulo');
}

async function openModalArticulo() {
    if (!puedeEditar()) return;
    await cargarSelectoresArticulo();
    document.getElementById('form-articulo').reset();
    document.getElementById('articulo-id').value = '';
    document.getElementById('articulo-tipo-bien').value = '';
    const tipoBienInfo = document.getElementById('articulo-tipo-bien-info');
    if (tipoBienInfo) tipoBienInfo.style.display = 'none';
    document.getElementById('articulo-modal-title').textContent = 'Nuevo Artículo';
    document.getElementById('seccion-talles-articulo').style.display = 'none';
    document.getElementById('seccion-stock-unico').style.display = 'none';
    document.getElementById('articulo-stock-inicial').value = '0';
    document.getElementById('articulo-stock-inicial').disabled = false;
    document.getElementById('articulo-stock-inicial').title = '';
    document.getElementById('articulo-stock-minimo').value = '0';
    document.getElementById('articulo-estado').value = 'true';
    document.getElementById('articulo-proveedor').value = '';
    document.getElementById('articulo-comprobante').value = '';
    actualizarVisibilidadSector('');
    document.getElementById('articulo-gallery').innerHTML = '';
    window.articuloImagenes = [];
    renderizarSizeMatrix([]);
    openModal('modal-articulo');
}

async function editarArticulo(id) {
    if (!puedeEditar()) return;
    const art = await obtenerPorId('articulos', id);
    if (!art) return;
    await cargarSelectoresArticulo();

    document.getElementById('articulo-id').value = art.id;
    document.getElementById('articulo-codigo').value = art.codigo;
    document.getElementById('articulo-nombre').value = art.nombre;
    document.getElementById('articulo-descripcion').value = art.descripcion || '';
    document.getElementById('articulo-categoria').value = art.categoriaId;
    document.getElementById('articulo-subcategoria').value = art.subcategoriaId || '';
    document.getElementById('articulo-marca').value = art.marca || '';
    document.getElementById('articulo-modelo').value = art.modelo || '';
    document.getElementById('articulo-color').value = art.color || '';
    document.getElementById('articulo-stock-minimo').value = art.stockMinimo || 0;
    document.getElementById('articulo-estado').value = art.activo !== false ? 'true' : 'false';
    document.getElementById('articulo-proveedor').value = art.proveedorId || '';
    document.getElementById('articulo-comprobante').value = art.comprobante || '';
    // El "Sector Asignado" refleja la ubicación ACTUAL/PRINCIPAL del artículo:
    // se deduce del array ubicaciones[] (la de mayor cantidad de stock) resuelta contra
    // el catálogo canónico 'ubicacionesInventario'; fallback al art.sector histórico.
    const catalogoUbisV9 = await getTodos('ubicacionesInventario');
    let sectorMostrarV9 = art.sector || '';
    if (Array.isArray(art.ubicaciones) && art.ubicaciones.length > 0) {
        const porUbiV9 = new Map();
        art.ubicaciones.forEach(f => porUbiV9.set(Number(f.ubicacionId), (porUbiV9.get(Number(f.ubicacionId)) || 0) + Number(f.cantidad || 0)));
        let mejorIdV9 = null, mejorCantV9 = -1;
        porUbiV9.forEach((cantUbiV9, idUbiV9) => { if (cantUbiV9 > mejorCantV9) { mejorCantV9 = cantUbiV9; mejorIdV9 = idUbiV9; } });
        const ubiPrincipalV9 = (catalogoUbisV9 || []).find(u => Number(u.id) === Number(mejorIdV9));
        if (ubiPrincipalV9) sectorMostrarV9 = ubiPrincipalV9.nombre;
    }
    const selSectorV9 = document.getElementById('articulo-sector');
    selSectorV9.value = Array.from(selSectorV9.options).some(o => o.value === sectorMostrarV9) ? sectorMostrarV9 : '';
    document.getElementById('articulo-observaciones').value = art.observaciones || '';
    document.getElementById('articulo-imagen').value = art.imagenPrincipal || '';
    document.getElementById('articulo-modal-title').textContent = 'Editar Artículo';

    const imagenes = await getTodos('imagenesArticulo');
    window.articuloImagenes = imagenes.filter(img => Number(img.articuloId) === Number(art.id));
    renderizarGaleriaArticulo();

    await onCambioCategoriaArticulo();

    if (art.controlaTalles) {
        const tallesArt = await getTodos('articuloTalles');
        const tallesFiltrados = tallesArt.filter(at => Number(at.articuloId) === Number(art.id));
        const sizeInputs = document.querySelectorAll('.size-input');
        sizeInputs.forEach(inp => {
            const talleId = Number(inp.dataset.talleId);
            const match = tallesFiltrados.find(t => Number(t.talleId) === talleId);
            inp.value = match ? match.stock : 0;
        });
    } else if (Array.isArray(art.ubicaciones) && art.ubicaciones.length > 0) {
        // Con inventario por ubicación, el stock se gestiona por MOVIMIENTOS: el input queda
        // en modo informativo (deshabilitado) para no sugerir ediciones destructivas del total.
        const inpStockV9 = document.getElementById('articulo-stock-inicial');
        inpStockV9.value = art.ubicaciones.reduce((s, f) => s + Number(f.cantidad || 0), 0);
        inpStockV9.disabled = true;
        inpStockV9.title = 'Gestioná el stock con movimientos (Ingreso / Consumo / Ajuste).';
    } else {
        document.getElementById('articulo-stock-inicial').value = art.stockUnico || 0;
    }

    openModal('modal-articulo');
}

async function cargarSelectoresArticulo() {
    const [categorias, subcategorias, proveedores] = await Promise.all([
        getTodos('categoriasInventario'),
        getTodos('subcategoriasInventario'),
        getTodos('proveedores')
    ]);

    // El catálogo de ubicaciones puede terminar de sembrarse después del DOMContentLoaded.
    // Cargarlo aquí garantiza que el selector del modal siempre tenga sus opciones.
    await actualizarSelectoresUbicaciones();

    const selCat = document.getElementById('articulo-categoria');
    // Escucha el evento 'change' para evaluar el tipo de bien y la visibilidad del sector
    if (selCat && !selCat.dataset.listenerArticuloAdjunto) {
        selCat.addEventListener('change', onCambioCategoriaArticulo);
        selCat.dataset.listenerArticuloAdjunto = 'true';
    }
    const savedCat = selCat.value;
    selCat.innerHTML = '<option value="">Seleccione...</option>';
    categorias.forEach(c => selCat.innerHTML += `<option value="${c.id}">${c.nombre}</option>`);
    selCat.value = savedCat;

    const selSub = document.getElementById('articulo-subcategoria');
    const savedSub = selSub.value;
    const catId = Number(selCat.value);
    selSub.innerHTML = '<option value="">Sin subcategoría</option>';
    subcategorias.filter(s => Number(s.categoriaId) === catId).forEach(s => {
        selSub.innerHTML += `<option value="${s.id}">${s.nombre}</option>`;
    });
    selSub.value = savedSub;

    const selProv = document.getElementById('articulo-proveedor');
    const savedProv = selProv.value;
    selProv.innerHTML = '<option value="">Seleccione...</option>';
    proveedores.forEach(p => selProv.innerHTML += `<option value="${p.id}">${p.nombre}</option>`);
    selProv.value = savedProv;
}

async function onCambioCategoriaArticulo() {
    const catId = document.getElementById('articulo-categoria').value;
    if (!catId) {
        document.getElementById('seccion-talles-articulo').style.display = 'none';
        document.getElementById('seccion-stock-unico').style.display = 'none';
        document.getElementById('articulo-tipo-bien').value = '';
        const infoEl = document.getElementById('articulo-tipo-bien-info');
        if (infoEl) infoEl.style.display = 'none';
        return;
    }
    const cat = await obtenerPorId('categoriasInventario', Number(catId));
    const controlaTalles = cat && cat.controlaTalles;

    // ===== HERENCIA AUTOMÁTICA DEL TIPO DE BIEN =====
    // El artículo no permite elegir el Tipo de Bien manualmente:
    // se hereda automáticamente desde la categoría padre.
    const tipoBien = (cat && cat.tipoBien) || 'consumible';
    const tipoBienInput = document.getElementById('articulo-tipo-bien');
    const tipoBienInfo = document.getElementById('articulo-tipo-bien-info');
    if (tipoBienInput) {
        tipoBienInput.value = tipoBien;
    }
    if (tipoBienInfo) {
        const label = tipoBien === 'bien_uso' ? 'Bien de Uso / Activo' : 'Consumible';
        const color = tipoBien === 'bien_uso' ? 'var(--accent-green)' : 'var(--accent)';
        tipoBienInfo.innerHTML = `<i class="fa-solid fa-circle-info"></i> Tipo de Bien: <strong style="color:${color};">${label}</strong> (heredado de la categoría)`;
        tipoBienInfo.style.display = 'block';
    }

    const subcategorias = await getTodos('subcategoriasInventario');
    const selSub = document.getElementById('articulo-subcategoria');
    const savedSub = selSub.value;
    selSub.innerHTML = '<option value="">Sin subcategoría</option>';
    subcategorias.filter(s => Number(s.categoriaId) === Number(catId)).forEach(s => {
        selSub.innerHTML += `<option value="${s.id}">${s.nombre}</option>`;
    });
    selSub.value = savedSub;

    if (controlaTalles) {
        document.getElementById('seccion-talles-articulo').style.display = 'block';
        document.getElementById('seccion-stock-unico').style.display = 'none';
        await renderizarSizeMatrix();
    } else {
        document.getElementById('seccion-talles-articulo').style.display = 'none';
        document.getElementById('seccion-stock-unico').style.display = 'block';
    }

    // ===== VISIBILIDAD DEL CAMPO SECTOR ASIGNADO (SEGÚN TIPO DE BIEN) =====
    actualizarVisibilidadSector(tipoBien);
}

// ==================== GESTIÓN DE UBICACIONES / SECTORES ====================
// Fase 3: los sectores ya NO se persisten en localStorage ('cda_sectores'). El catálogo
// canónico es el store 'ubicacionesInventario' (DB v9). Todos los selects de la UI se
// alimentan de este catálogo (filtrando por 'activo: true') y se administran con CRUD real.

// Devuelve las ubicaciones activas del catálogo canónico.
async function obtenerUbicacionesActivas() {
    const catalogo = await getTodos('ubicacionesInventario');
    return (catalogo || []).filter(u => u && u.activo !== false);
}

// Abre el mini-modal de gestión de ubicaciones
async function abrirModalGestionarSectores() {
    await renderizarListaSectores();
    openModal('modal-gestionar-sectores');
}

// Cierra el mini-modal y refresca los selectores dependientes
function cerrarModalGestionarSectores() {
    closeModal('modal-gestionar-sectores');
    actualizarSelectoresUbicaciones();
    window.gestionUbicacionesDesde = null;
}

// Renderiza la lista visual de ubicaciones dentro del mini-modal (muestra TODAS, incluso
// inactivas para permitir su reactivación; toggle Activar/Desactivar exclusivo del Admin).
async function renderizarListaSectores() {
    const container = document.getElementById('lista-sectores');
    if (!container) return;
    const ubicaciones = await getTodos('ubicacionesInventario');
    container.innerHTML = '';

    if (ubicaciones.length === 0) {
        container.innerHTML = '<span style="color:var(--text-secondary);font-size:0.85rem;text-align:center;padding:0.5rem;">No hay ubicaciones registradas.</span>';
        return;
    }

    for (const u of ubicaciones) {
        const div = document.createElement('div');
        div.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0.75rem;background:var(--bg-secondary);border-radius:6px;border:1px solid var(--border-color);';

        const spanWrap = document.createElement('span');
        spanWrap.style.cssText = 'display:flex;align-items:center;gap:0.4rem;';
        const span = document.createElement('span');
        span.textContent = u.nombre;
        span.style.cssText = 'font-weight:500;';
        const badge = document.createElement('span');
        badge.className = u.tipo === 'movil' ? 'badge badge-info' : 'badge badge-secondary';
        badge.style.fontSize = '0.7rem';
        badge.textContent = u.tipo === 'movil' ? 'Móvil' : 'Fija';
        spanWrap.appendChild(span);
        spanWrap.appendChild(badge);
        if (u.activo === false) {
            const inactBadge = document.createElement('span');
            inactBadge.className = 'badge badge-inactive';
            inactBadge.style.fontSize = '0.7rem';
            inactBadge.textContent = 'Inactiva';
            spanWrap.appendChild(inactBadge);
        }

        const btnWrap = document.createElement('span');
        btnWrap.style.cssText = 'display:flex;align-items:center;gap:0.3rem;';
        const btnToggle = document.createElement('button');
        btnToggle.type = 'button';
        btnToggle.className = 'action-btn';
        btnToggle.title = u.activo === false ? 'Activar ubicación' : 'Desactivar ubicación';
        btnToggle.innerHTML = u.activo === false ? '<i class="fa-solid fa-play"></i>' : '<i class="fa-solid fa-pause"></i>';
        btnToggle.onclick = () => toggleSectorActivoV9(u.id);
        btnWrap.appendChild(btnToggle);

        const btnEliminar = document.createElement('button');
        btnEliminar.type = 'button';
        btnEliminar.className = 'action-btn delete';
        btnEliminar.title = 'Eliminar ubicación';
        btnEliminar.innerHTML = '<i class="fa-solid fa-trash"></i>';
        btnEliminar.onclick = () => eliminarSector(u.id);

        div.appendChild(spanWrap);
        btnWrap.appendChild(btnEliminar);
        div.appendChild(btnWrap);
        container.appendChild(div);
    }
}

// Agrega una nueva ubicación desde el campo de texto del mini-modal
async function agregarNuevoSector() {
    const input = document.getElementById('nuevo-sector-nombre');
    if (!input) return;

    const nombre = normalizarNombreUbicacionV9(input.value);
    if (!nombre) { mostrarToast('Ingresá el nombre de la ubicación.', 'warning'); return; }

    const catalogo = await getTodos('ubicacionesInventario');
    if (catalogo.some(u => String(u.nombre).toLowerCase() === nombre.toLowerCase())) {
        mostrarToast('Ya existe una ubicación con ese nombre.', 'error');
        return;
    }

    await guardar('ubicacionesInventario', { nombre, tipo: inferirTipoUbicacionV9(nombre), activo: true });
    invalidarCache('ubicacionesInventario');
    input.value = '';
    await renderizarListaSectores();
    await actualizarSelectoresUbicaciones();
    // Gestión desde el modal de Movimiento (Admin): preseleccionar la ubicación creada y
    // asegurar que el contenedor del sector quede visible para continuar el formulario..
    if (window.gestionUbicacionesDesde === 'movimiento') {
        const selMovV10 = document.getElementById('movimiento-sector-ubicacion');
        if (selMovV10) {
            selMovV10.value = nombre;
            const contMV10 = document.getElementById('contenedor-sector-movimiento');
            if (contMV10) contMV10.style.display = 'block';
        }
        window.gestionUbicacionesDesde = null;
    }
}

// Elimina una ubicación del catálogo (los movimientos conservan el nombre en snapshot)
async function eliminarSector(id) {
    const catalogo = await getTodos('ubicacionesInventario');
    const u = catalogo.find(x => Number(x.id) === Number(id));
    if (!u) return;
    if (!(await mostrarConfirmacion('Eliminar ubicación', `¿Eliminar "${u.nombre}"? El historial de movimientos conserva el nombre.`))) return;
    await eliminar('ubicacionesInventario', Number(id));
    invalidarCache('ubicacionesInventario');
    await renderizarListaSectores();
    await actualizarSelectoresUbicaciones();
}

// ===== GESTIÓN EN CALIENTE (V10): UBICACIONES Y TIPOS DESDE EL MODAL DE MOVIMIENTO =====
// Abre el mini-modal de ubicaciones marcando que viene desde el formulario de movimiento (para
// preseleccionar automáticamente la ubicación creada). Solo para Admin..
function abrirGestionUbicacionesParaMovimiento() {
    if (!esAdmin()) return;
    window.gestionUbicacionesDesde = 'movimiento';
    abrirModalGestionarSectores();
}

// Toggle Activar/Desactivar de una ubicación (persiste en IndexedDB + Firestore..
async function toggleSectorActivoV9(id) {
    if (!esAdmin()) return;
    const u = await obtenerPorId('ubicacionesInventario', Number(id));
    if (!u) return;
    u.activo= u.activo === false ? true : false;
    await guardar('ubicacionesInventario', u);
    invalidarCache('ubicacionesInventario');
    await renderizarListaSectores();
    await actualizarSelectoresUbicaciones();
    mostrarToast(`Ubicación "${u.nombre}" ${u.activo ? 'activada' : 'desactivada'}.`);
}

// Puebla el select de tipos de movimiento desde el catálogo V10 (canónicos + personalizados),
// preservando el valor vigente. Las opciones llevan data-naturaleza para el motor de impacto..
async function poblarSelectTiposMovimientoV9() {
    const sel = document.getElementById('movimiento-tipo');
    if (!sel) return;
    const guardado = sel.value;
    const tipos = await getTodos('tiposMovimiento');
    if (!tipos || tipos.length === 0) return; // fallback: opciones hardcodeadas ya presentes en el HTML.

    const CANONICOS_ORDEN_V10 = ['ingreso', 'consumo', 'transferencia_interna', 'devolucion', 'baja', 'ajuste'];
    const orden = (t) => { const i = CANONICOS_ORDEN_V10.indexOf(t.valor); return i >= 0 ? i : CANONICOS_ORDEN_V10.length + (t.id || 0); };
    const activos = tipos.filter(t => t && t.activo !== false).sort((a, b) => orden(a) - orden(b));
    sel.innerHTML = '<option value="">Seleccione...</option>';
    activos.forEach(t => {
        sel.innerHTML += `<option value="${escapeHtml(t.valor)}" data-naturaleza="${escapeHtml(t.naturaleza || t.valor)}">${escapeHtml(t.label || t.valor)}${CANONICOS_ORDEN_V10.includes(t.valor) ? '' : ' ⚙'}</option>`;
    });
    if (guardado && activos.some(t => String(t.valor) === String(guardado))) sel.value = guardado;
    else if (activos.length > 0) sel.value = activos[0].valor;
}

// Refresca todos los <select> de ubicaciones (Artículo y Movimientos) desde el catálogo,
// preservando el valor seleccionado si todavía existe.
async function actualizarSelectoresUbicaciones() {
    const ubicaciones = await obtenerUbicacionesActivas();
    const nombres = ubicaciones.map(u => u.nombre);
    const targets = [
        { el: document.getElementById('articulo-sector'), placeholder: 'Seleccione...' },
        { el: document.getElementById('movimiento-sector-ubicacion'), placeholder: 'Seleccione sector...' },
        { el: document.getElementById('movimiento-sector-destino'), placeholder: 'Seleccione...' }
    ];
    targets.forEach(t => {
        if (!t.el) return;
        const valorActual = t.el.value;
        t.el.innerHTML = `<option value="">${t.placeholder}</option>`;
        nombres.forEach(n => t.el.innerHTML += `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`);
        t.el.value = valorActual && nombres.includes(valorActual) ? valorActual : '';
    });
}

// Poblar los selectores de ubicaciones al cargar la página
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        actualizarSelectoresUbicaciones();
    });
}

// ===== CONTROL DE VISIBILIDAD DEL CAMPO SECTOR ASIGNADO =====
// Si el artículo es un "Bien de Uso" (heredado de su categoría), se solicita
// el sector de asignación física. Si es "Consumible" o no hay categoría,
// se oculta el campo porque los consumibles van directo al depósito general.
function actualizarVisibilidadSector(tipoBien) {
    const contenedor = document.getElementById('contenedor-sector');
    if (!contenedor) return;

    if (tipoBien === 'bien_uso') {
        contenedor.style.display = 'block';
    } else {
        contenedor.style.display = 'none';
        const selectSector = document.getElementById('articulo-sector');
        if (selectSector) selectSector.value = '';
    }
}

async function renderizarSizeMatrix() {
    const talles = await getTodos('talles');
    const container = document.getElementById('size-matrix-articulo');
    container.innerHTML = '';
    talles.forEach(t => {
        const item = document.createElement('div');
        item.className = 'size-matrix-item';
        item.innerHTML = `
            <span class="size-label">${t.nombre}</span>
            <input type="number" class="size-input" data-talle-id="${t.id}" min="0" value="0" placeholder="0">
        `;
        container.appendChild(item);
    });
}

function renderizarGaleriaArticulo() {
    const container = document.getElementById('articulo-gallery');
    container.innerHTML = '';
    (window.articuloImagenes || []).forEach((img, idx) => {
        const item = document.createElement('div');
        item.className = 'article-gallery-item';
        item.innerHTML = `
            <img src="${escapeHtml(img.url)}" alt="Imagen ${idx+1}" onerror="this.style.display='none'">
            <button type="button" class="gallery-remove" onclick="eliminarImagenArticulo(${idx})">&times;</button>
        `;
        container.appendChild(item);
    });
}

function agregarImagenArticulo() {
    const url = document.getElementById('articulo-nueva-imagen').value.trim();
    if (!url) { mostrarToast('Ingresá una URL de imagen.', 'warning'); return; }
    if (!window.articuloImagenes) window.articuloImagenes = [];
    window.articuloImagenes.push({ url, articuloId: null });
    document.getElementById('articulo-nueva-imagen').value = '';
    renderizarGaleriaArticulo();
}

function eliminarImagenArticulo(idx) {
    if (window.articuloImagenes) {
        window.articuloImagenes.splice(idx, 1);
        renderizarGaleriaArticulo();
    }
}

async function guardarArticuloForm(e) {
    e.preventDefault();
    if (!puedeEditar()) return;

    const id = document.getElementById('articulo-id').value;
    const codigo = document.getElementById('articulo-codigo').value.trim();
    const catId = document.getElementById('articulo-categoria').value;

    if (!catId) { mostrarToast('Debe seleccionar una categoría.', 'error'); return; }

    const todos = await getTodos('articulos');
    const duplicado = todos.find(a => a.codigo === codigo && String(a.id) !== String(id));
    if (duplicado) { mostrarToast('Ya existe un artículo con ese código.', 'error'); return; }

    const cat = await obtenerPorId('categoriasInventario', Number(catId));
    const controlaTalles = cat && cat.controlaTalles;

    // ===== HERENCIA AUTOMÁTICA DEL TIPO DE BIEN =====
    // El artículo hereda el Tipo de Bien de su categoría padre.
    // Si el hidden input está vacío, se re-deriva desde la categoría.
    const tipoBienHeredado = document.getElementById('articulo-tipo-bien').value || (cat && cat.tipoBien) || 'consumible';

    // ===== VALIDACIÓN CONDICIONAL DEL SECTOR ASIGNADO =====
    // Si el artículo es un Bien de Uso, el sector es obligatorio para su asignación física.
    if (tipoBienHeredado === 'bien_uso' && !document.getElementById('articulo-sector').value) {
        mostrarToast('Para Bienes de Uso debe seleccionar un Sector Asignado.', 'error');
        return;
    }

    const articulo = {
        codigo,
        nombre: document.getElementById('articulo-nombre').value.trim(),
        descripcion: document.getElementById('articulo-descripcion').value.trim(),
        categoriaId: Number(catId),
        subcategoriaId: document.getElementById('articulo-subcategoria').value || null,
        marca: document.getElementById('articulo-marca').value.trim(),
        modelo: document.getElementById('articulo-modelo').value.trim(),
        color: document.getElementById('articulo-color').value.trim(),
        stockMinimo: Number(document.getElementById('articulo-stock-minimo').value) || 0,
        proveedorId: document.getElementById('articulo-proveedor').value || null,
        comprobante: document.getElementById('articulo-comprobante').value.trim(),
        sector: document.getElementById('articulo-sector').value || null,
        observaciones: document.getElementById('articulo-observaciones').value.trim(),
        imagenPrincipal: document.getElementById('articulo-imagen').value.trim(),
        tipoBien: tipoBienHeredado,
        controlaTalles,
        activo: document.getElementById('articulo-estado').value === 'true',
        stockUnico: controlaTalles ? 0 : (Number(document.getElementById('articulo-stock-inicial').value) || 0),
        usuarioCreacion: currentUser ? currentUser.id : null,
        usuarioModificacion: currentUser ? currentUser.id : null,
        fechaCreacion: new Date().toISOString(),
        fechaModificacion: new Date().toISOString()
    };

    let sectorAnteriorV9 = null;
    if (id) {
        articulo.id = Number(id);
        const orig = await obtenerPorId('articulos', Number(id));
        if (orig) {
            articulo.usuarioCreacion = orig.usuarioCreacion;
            articulo.fechaCreacion = orig.fechaCreacion;
            // CONSERVACIÓN DEL INVENTARIO FÍSICO: la edición NUNCA puede destruir el desglose
            // por ubicación; el array ubicaciones[] se hereda del documento original.
            if (Array.isArray(orig.ubicaciones)) articulo.ubicaciones = orig.ubicaciones;
            // El stock real vive en ubicaciones[]: si existe, el total se DERIVA de ella y el
            // input "stock inicial" es solo informativo (los cambios de stock se hacen con
            // movimientos: Ingreso / Consumo / Ajuste).
            if (Array.isArray(orig.ubicaciones) && orig.ubicaciones.length > 0 && !controlaTalles) {
                articulo.stockUnico = orig.ubicaciones.reduce((s, f) => s + Number(f.cantidad || 0), 0);
            }
            sectorAnteriorV9 = orig.sector || null;
        }
    } else if (!controlaTalles) {
        // Artículo NUEVO: se siembra la fila inicial en Bodega Central para que el array
        // ubicaciones[] nazca consistente con el stock declarado (evita drift futuro).
        const stockInicialV9 = Number(articulo.stockUnico || 0);
        if (stockInicialV9 > 0) {
            const idBodegaV9 = await resolverUbicacionV9('Depósito Central');
            articulo.ubicaciones = [{ id: Date.now(), ubicacionId: Number(idBodegaV9), talleId: null, cantidad: stockInicialV9 }];
        }
    }

    const savedId = await guardar('articulos', articulo);
    articulo.id = Number(savedId);

    // ===== CAMBIO DE SECTOR ASIGNADO → TRANSFERENCIA INTERNA NO DESTRUCTIVA =====
    // Si el operador re-asigna el sector de un Bien de Uso, el stock físico NO se reescribe
    // a mano: se transfiere lo existente en el sector viejo hacia el nuevo vía ajustarStockV9
    // (valida anti-negativos y recalcula los totales derivados).
    if (id && tipoBienHeredado === 'bien_uso' && articulo.sector && sectorAnteriorV9
        && String(articulo.sector).trim().toLowerCase() !== String(sectorAnteriorV9).trim().toLowerCase()) {
        try {
            const idOrigenV9 = await resolverUbicacionV9(sectorAnteriorV9);
            const idDestinoV9 = await resolverUbicacionV9(articulo.sector);
            if (Number(idOrigenV9) !== Number(idDestinoV9)) {
                const filasV9 = Array.isArray(articulo.ubicaciones) ? articulo.ubicaciones : [];
                if (!controlaTalles) {
                    const enOrigenV9 = filasV9.filter(f => Number(f.ubicacionId) === Number(idOrigenV9)).reduce((s, f) => s + Number(f.cantidad || 0), 0);
                    if (enOrigenV9 > 0) {
                        await ajustarStockV9(articulo.id, null, { tipoMovimiento: 'transferencia_interna', cantidad: enOrigenV9, ubicacionOrigenId: idOrigenV9, ubicacionDestinoId: idDestinoV9 });
                    }
                } else {
                    const porTalleV9 = new Map();
                    filasV9.filter(f => Number(f.ubicacionId) === Number(idOrigenV9) && f.talleId != null)
                        .forEach(f => porTalleV9.set(Number(f.talleId), (porTalleV9.get(Number(f.talleId)) || 0) + Number(f.cantidad || 0)));
                    for (const [talleIdV9, cantV9] of porTalleV9) {
                        if (cantV9 > 0) await ajustarStockV9(articulo.id, talleIdV9, { tipoMovimiento: 'transferencia_interna', cantidad: cantV9, ubicacionOrigenId: idOrigenV9, ubicacionDestinoId: idDestinoV9 });
                    }
                }
            }
        } catch (errTransfV9) {
            mostrarToast(`Artículo guardado, pero la transferencia al nuevo sector falló: ${errTransfV9.message}`, 'warning');
        }
    }

    if (controlaTalles) {
        const sizeInputs = document.querySelectorAll('.size-input');
        for (const inp of sizeInputs) {
            const talleId = Number(inp.dataset.talleId);
            const stock = Number(inp.value) || 0;
            const existentes = await getTodos('articuloTalles');
            const existente = existentes.find(at => Number(at.articuloId) === Number(articulo.id) && Number(at.talleId) === talleId);
            if (existente) {
                if (stock > 0) {
                    existente.stock = stock;
                    await guardar('articuloTalles', existente);
                } else {
                    await eliminar('articuloTalles', existente.id);
                }
            } else if (stock > 0) {
                await guardar('articuloTalles', { articuloId: articulo.id, talleId, stock });
            }
        }
    }

    if (window.articuloImagenes) {
        const existentes = await getTodos('imagenesArticulo');
        const viejas = existentes.filter(img => Number(img.articuloId) === Number(articulo.id));
        for (const v of viejas) await eliminar('imagenesArticulo', v.id);

        for (const img of window.articuloImagenes) {
            await guardar('imagenesArticulo', { articuloId: articulo.id, url: img.url });
        }
    }

    invalidarCache('articulos');
    invalidarCache('articuloTalles');
    invalidarCache('imagenesArticulo');

    closeModal('modal-articulo');
    mostrarToast(`Artículo "${articulo.nombre}" guardado.`);
    listarArticulos();
}

// ===== AJUSTE DE STOCK POR UBICACIÓN (EXCLUSIVO ADMIN, V9) =====
// Panel de superusuario: lista cada combinación (ubicación × talle) con su cantidad actual,
// calcula el delta contra el valor editado y lo canaliza fila por fila por ajustarStockV9.
async function abrirAjusteStockAdmin(articuloId) {
    if (!esAdmin()) { mostrarToast('Solo un Administrador puede ajustar el stock.', 'error'); return; }
    const art = await obtenerPorId('articulos', Number(articuloId));
    if (!art) { mostrarToast('Artículo no encontrado.', 'error'); return; }
    const [talles, articuloTalles, ubicacionesCat] = await Promise.all([
        getTodos('talles'),
        getTodos('articuloTalles'),
        obtenerUbicacionesActivas()
    ]);
    if (!ubicacionesCat || ubicacionesCat.length === 0) { mostrarToast('No hay ubicaciones activas en el catálogo.', 'error'); return; }
    window.ajusteStockArticuloId = Number(articuloId);

    // Cantidad actual por (ubicación, talle). Si el documento aún no tiene ubicaciones[],
    // el baseline asume todo el stock en Bodega Central (mismo criterio del render de la tabla).
    const bodegaV9 = ubicacionesCat.find(u => String(u.nombre).trim().toLowerCase() === 'depósito central') || ubicacionesCat[0];
    const cantEn = (ubiId, talleId) => {
        if (Array.isArray(art.ubicaciones) && art.ubicaciones.length > 0) {
            return art.ubicaciones
                .filter(f => Number(f.ubicacionId) === Number(ubiId) && (talleId == null ? f.talleId == null : Number(f.talleId) === Number(talleId)))
                .reduce((s, f) => s + Number(f.cantidad || 0), 0);
        }
        if (Number(ubiId) === Number(bodegaV9.id)) {
            if (talleId == null) return Number(art.stockUnico || 0);
            const t = articuloTalles.find(x => Number(x.articuloId) === Number(art.id) && Number(x.talleId) === Number(talleId));
            return t ? Number(t.stock || 0) : 0;
        }
        return 0;
    };

    const filasV9 = [];
    if (art.controlaTalles) {
        const tallesArt = articuloTalles.filter(at => Number(at.articuloId) === Number(art.id));
        for (const t of tallesArt) {
            const infoTalle = talles.find(x => Number(x.id) === Number(t.talleId));
            for (const u of ubicacionesCat) {
                filasV9.push({ talleId: Number(t.talleId), talleNombre: infoTalle ? infoTalle.nombre : `Talle ${t.talleId}`, ubicacionId: Number(u.id), ubicacionNombre: u.nombre, actual: cantEn(u.id, t.talleId) });
            }
        }
    } else {
        for (const u of ubicacionesCat) filasV9.push({ talleId: null, talleNombre: null, ubicacionId: Number(u.id), ubicacionNombre: u.nombre, actual: cantEn(u.id, null) });
    }

    const info = document.getElementById('ajuste-stock-art-info');
    if (info) info.innerHTML = `<strong>${escapeHtml(art.codigo)}</strong> — ${escapeHtml(art.nombre)}${art.controlaTalles ? ' (controla talles)' : ''}`;
    const body = document.getElementById('ajuste-stock-body');
    if (!body) return;
    if (filasV9.length === 0) {
        body.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:1rem;grid-column:1/-1;">No hay filas de stock para ajustar.</p>';
    } else {
        // Diseño en grilla de tarjetas: pin + nombre del sector arriba, input grande abajo.
        body.innerHTML = filasV9.map(f => `
            <div class="ajuste-card">
                <div class="ajuste-card-nombre" title="${escapeHtml(f.ubicacionNombre)}"><i class="fa-solid fa-location-dot"></i>${escapeHtml(f.ubicacionNombre)}</div>
                ${f.talleNombre ? `<span class="badge badge-info ajuste-card-talle">${escapeHtml(f.talleNombre)}</span>` : ''}
                <input type="number" min="0" class="ajuste-input" value="${f.actual}" data-ubi="${f.ubicacionId}" data-ubi-nombre="${escapeHtml(f.ubicacionNombre)}" data-talle="${f.talleId == null ? '' : f.talleId}" data-actual="${f.actual}">
            </div>`).join('');
    }
    openModal('modalAjustarStockAdmin');
}

async function guardarAjusteStockAdmin() {
    if (!esAdmin()) { mostrarToast('Solo un Administrador puede ajustar el stock.', 'error'); return; }
    const articuloId = Number(window.ajusteStockArticuloId);
    if (!Number.isFinite(articuloId)) { mostrarToast('Artículo no válido.', 'error'); return; }
    const art = await obtenerPorId('articulos', articuloId);
    if (!art) { mostrarToast('Artículo no encontrado.', 'error'); return; }

    // Cálculo de deltas fila por fila: solo filas con delta ≠ 0 se procesan.
    const inputs = Array.from(document.querySelectorAll('#ajuste-stock-body .ajuste-input'));
    const cambios = [];
    for (const inp of inputs) {
        const nuevo = Number(inp.value);
        const actual = Number(inp.dataset.actual || 0);
        const delta = Number.isFinite(nuevo) ? (nuevo - actual) : 0;
        if (nuevo < 0 || delta === 0) continue;
        cambios.push({ talleId: inp.dataset.talle ? Number(inp.dataset.talle) : null, ubicacionId: Number(inp.dataset.ubi), ubicacionNombre: inp.dataset.ubiNombre || String(inp.dataset.ubi), actual, nuevo, delta });
    }
    if (cambios.length === 0) { mostrarToast('No hay cambios para aplicar.', 'warning'); return; }

    // PASADA 1 (dry-run): ninguna fila puede dejar stock negativo en su ubicación.
    const articuloTalles = await getTodos('articuloTalles');
    for (const c of cambios) {
        if (c.delta >= 0) continue;
        let disp;
        if (Array.isArray(art.ubicaciones) && art.ubicaciones.length > 0) {
            disp = obtenerStockUbicacionV9(art, c.talleId, c.ubicacionId);
        } else {
            // Sin array migrado, el stock solo existe en Bodega Central (baseline del modal).
            disp = (String(c.ubicacionNombre).trim().toLowerCase() === 'depósito central')
                ? (c.talleId
                    ? Number((articuloTalles.find(t => Number(t.articuloId) === articuloId && Number(t.talleId) === c.talleId) || {}).stock || 0)
                    : Number(art.stockUnico || 0))
                : 0;
        }
        if (disp + c.delta < 0) {
            mostrarToast(`Stock insuficiente en "${c.ubicacionNombre}": disponible ${disp}, ajuste ${c.delta}.`, 'error');
            return;
        }
    }

    // PASADA 2: aplicación secuencial vía ajustarStockV9 + registro histórico explícito
    // (el helper muta el stock y recalcula derivados; el movimiento de auditoría lo crea el llamador).
    let aplicados = 0;
    for (const c of cambios) {
        try {
            await ajustarStockV9(articuloId, c.talleId, {
                tipoMovimiento: 'ajuste',
                cantidad: c.delta,
                ubicacionOrigenId: c.delta < 0 ? c.ubicacionId : null,
                ubicacionDestinoId: c.delta > 0 ? c.ubicacionId : null
            });
            await guardar('movimientosInventario', {
                articuloId,
                talleId: c.talleId,
                tipoMovimiento: 'ajuste',
                esIngreso: false,
                tipoBien: art.tipoBien || 'consumible',
                cantidad: Math.abs(c.delta),
                motivo: `Ajuste arbitrario por Administrador ${currentUser ? currentUser.nombre : 'desconocido'}`,
                observaciones: '',  // textarea del operador: libre de ruido técnico
                logTecnico: `Ajuste manual de stock: de ${c.actual} a ${c.nuevo} en "${c.ubicacionNombre}"${c.talleId ? ` (talle ID ${c.talleId})` : ''}. Delta: ${c.delta > 0 ? '+' : ''}${c.delta} (${c.delta > 0 ? 'suma' : 'resta'}).`,
                ubicacionOrigen: c.delta < 0 ? c.ubicacionNombre : null,
                ubicacionDestino: c.delta > 0 ? c.ubicacionNombre : null,
                usuarioId: currentUser ? currentUser.id : null,
                fecha: new Date().toISOString().split('T')[0],
                migradoV9: true
            });
            aplicados++;
        } catch (e) {
            mostrarToast(`No se pudo aplicar el ajuste en "${c.ubicacionNombre}": ${e.message}`, 'error');
        }
    }

    invalidarCache('articulos');
    invalidarCache('articuloTalles');
    invalidarCache('movimientosInventario');
    closeModal('modalAjustarStockAdmin');
    if (aplicados > 0) {
        mostrarToast(`Ajuste aplicado: ${aplicados} fila(s) modificadas.`);
        listarArticulos();
        listarMovimientosInventario();
    } else {
        mostrarToast('No se aplicó ningún ajuste.', 'warning');
    }
}

async function eliminarArticulo(id) {
    // Solo Administradores pueden eliminar artículos (operación destructiva que
    // además arrastra sus movimientos de stock asociados).
    if (!esAdmin()) { mostrarToast('Solo un Administrador puede eliminar artículos.', 'error'); return; }

    const movimientos = await getTodos('movimientosInventario');
    const movsArt = movimientos.filter(m => Number(m.articuloId) === Number(id));

    const extraMsg = movsArt.length > 0
        ? `\n\nSe eliminarán también ${movsArt.length} movimiento(s) de stock asociados a este artículo.`
        : '';
    const confirmado = await mostrarConfirmacion('Eliminar Artículo',
        `¿Eliminar este artículo permanentemente?${extraMsg}`);
    if (!confirmado) return;

    // Eliminar los movimientos de stock del artículo (por defecto, junto con el artículo).
    for (const m of movsArt) {
        await eliminar('movimientosInventario', Number(m.id));
    }

    const tallesArt = await getTodos('articuloTalles');
    for (const t of tallesArt.filter(t => Number(t.articuloId) === Number(id))) {
        await eliminar('articuloTalles', t.id);
    }
    const imgs = await getTodos('imagenesArticulo');
    for (const img of imgs.filter(i => Number(i.articuloId) === Number(id))) {
        await eliminar('imagenesArticulo', img.id);
    }

    await eliminar('articulos', id);
    invalidarCache('articulos');
    invalidarCache('articuloTalles');
    invalidarCache('movimientosInventario');
    mostrarToast(movsArt.length > 0
        ? `Artículo eliminado junto con ${movsArt.length} movimiento(s) de stock.`
        : 'Artículo eliminado.');
    listarArticulos();
    listarMovimientosInventario();
}

async function duplicarArticulo(id) {
    if (!puedeEditar()) return;
    const orig = await obtenerPorId('articulos', Number(id));
    if (!orig) return;

    const copia = { ...orig };
    delete copia.id;
    copia.codigo = orig.codigo + '-COPIA';
    copia.nombre = orig.nombre + ' (Copia)';
    copia.fechaCreacion = new Date().toISOString();
    copia.fechaModificacion = new Date().toISOString();
    copia.usuarioCreacion = currentUser ? currentUser.id : null;
    copia.usuarioModificacion = currentUser ? currentUser.id : null;

    const newId = await guardar('articulos', copia);

    if (orig.controlaTalles) {
        const tallesArt = await getTodos('articuloTalles');
        for (const t of tallesArt.filter(at => Number(at.articuloId) === Number(orig.id))) {
            const nuevoT = { ...t };
            delete nuevoT.id;
            nuevoT.articuloId = Number(newId);
            await guardar('articuloTalles', nuevoT);
        }
    }

    invalidarCache('articulos');
    invalidarCache('articuloTalles');
    mostrarToast('Artículo duplicado.');
    listarArticulos();
}

async function exportarArticulosExcel() {
    const [articulos, categorias, articuloTalles] = await Promise.all([
        getTodos('articulos'),
        getTodos('categoriasInventario'),
        getTodos('articuloTalles')
    ]);

    let csv = '\uFEFF';
    csv += 'Código,Nombre,Descripción,Categoría,Marca,Modelo,Color,Stock Total,Stock Mínimo,Estado\r\n';

    // Función para sanitizar campos CSV contra inyección de fórmulas
    function sanitizarCSVExport(valor) {
        const str = String(valor ?? '').replace(/,/g, ' ');
        // Prevenir CSV Injection: si empieza con =, +, -, @, tab o retorno, anteponer comilla simple
        if (/^[=+\-@\t\r]/.test(str)) {
            return "'" + str;
        }
        return str;
    }

    for (const art of articulos) {
        const cat = categorias.find(c => c.id === Number(art.categoriaId));
        const catName = cat ? cat.nombre : '-';
        const stock = calcularStockArticulo(art, articuloTalles);
        const estado = art.activo !== false ? 'Activo' : 'Inactivo';
        const linea = [
            sanitizarCSVExport(art.codigo), sanitizarCSVExport(art.nombre), sanitizarCSVExport(art.descripcion || ''),
            sanitizarCSVExport(catName), sanitizarCSVExport(art.marca || ''), sanitizarCSVExport(art.modelo || ''), sanitizarCSVExport(art.color || ''),
            stock, art.stockMinimo || 0, sanitizarCSVExport(estado)
        ].join(',');
        csv += linea + '\r\n';
    }

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `articulos_inventario_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    mostrarToast('Artículos exportados.');
}

async function obtenerPersonaNombrePorIdV9(personaId) {
    if (!personaId && personaId !== 0) return 'Sin persona';
    try {
        const staff = await getTodos('staff');
        const persona = staff.find(p => Number(p.id) === Number(personaId));
        if (!persona) return `ID: ${personaId}`;
        return `${persona.nombre || ''} ${persona.apellido || ''}`.trim() || `ID: ${personaId}`;
    } catch (e) {
        return `ID: ${personaId}`;
    }
}

async function listarMovimientosInventario() {
    const [movimientos, articulos, staff] = await Promise.all([
        getTodos('movimientosInventario'),
        getTodos('articulos'),
        getTodos('staff')
    ]);

    const filtroTipo = document.getElementById('filtro-movimiento-tipo').value;
    const filtroArt = document.getElementById('filtro-movimiento-articulo').value;
    const buscador = document.getElementById('buscar-movimientos').value.toLowerCase();

    const selArt = document.getElementById('filtro-movimiento-articulo');
    const savedArt = selArt.value;
    selArt.innerHTML = '<option value="todos">Todos</option>';
    articulos.forEach(a => selArt.innerHTML += `<option value="${a.id}">${a.nombre}</option>`);
    selArt.value = savedArt;

    // Fase 3: el filtro usa el vocabulario canónico. Se normalizan los tipos legacy
    // (por si quedara algún registro sin migrar) antes de comparar.
    const MAPA_FILTRO_TIPO = {
        ingreso: 'ingreso', compra: 'ingreso', reposicion: 'ingreso', alta: 'ingreso', inventario: 'ingreso',
        devolucion: 'devolucion',
        consumo: 'consumo', egreso: 'consumo', entrega: 'consumo', salida: 'consumo',
        transferencia_interna: 'transferencia_interna', transferencia: 'transferencia_interna',
        baja: 'baja', perdida: 'baja', rotura: 'baja',
        ajuste: 'ajuste'
    };
    let filtrados = movimientos.filter(m => {
        if (filtroTipo !== 'todos') {
            const canon = MAPA_FILTRO_TIPO[String(m.tipoMovimiento || '').toLowerCase()] || m.tipoMovimiento;
            if (canon !== filtroTipo) return false;
        }
        if (filtroArt !== 'todos' && String(m.articuloId) !== String(filtroArt)) return false;
        if (buscador) {
            const art = articulos.find(a => Number(a.id) === Number(m.articuloId));
            const artName = art ? art.nombre : '';
            const busca = `${artName} ${m.motivo || ''} ${m.observaciones || ''}`.toLowerCase();
            if (!busca.includes(buscador)) return false;
        }
        return true;
    }).sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0));

    const container = document.getElementById('movimientos-list');
    container.className = 'movement-timeline';
    container.innerHTML = '';

    if (filtrados.length === 0) {
        container.innerHTML = '<p style="color:var(--text-secondary);padding:1rem;text-align:center;">No hay movimientos que coincidan con los filtros.</p>';
        return;
    }

    for (const mov of filtrados) {
        const art = articulos.find(a => Number(a.id) === Number(mov.articuloId));
        const artName = art ? art.nombre : 'ID: ' + mov.articuloId;
        const pers = staff.find(s => Number(s.id) === Number(mov.personaId));
        const personaLabel = mov.personaNombre || (pers ? `${pers.nombre} ${pers.apellido}` : (mov.personaId ? `ID: ${mov.personaId}` : 'Sin persona'));
        const c = categorizarMovimientoV9(mov);

        let talleText = '';
        if (mov.talleId) {
            const talles = await getTodos('talles');
            const talle = talles.find(t => Number(t.id) === Number(mov.talleId));
            if (talle) talleText = ` (${talle.nombre})`;
        }

        const item = document.createElement('div');
        item.className = `movement-item ${c.clase}`;
        const fecha = mov.fecha ? formatearFechaVisual(mov.fecha) : '-';
        const observacionVisible = (mov.observaciones || '').trim();
        const mostrarObservacion = !(observacionVisible.includes('Entrega #') || observacionVisible.includes('persona ID:') || observacionVisible.includes('persona:'));
        item.innerHTML = `
            <div class="mov-icon"><i class="fa-solid ${c.icono}"></i></div>
            <div class="mov-info">
                <div class="mov-title">${escapeHtml(artName)}${escapeHtml(talleText)}</div>
                <div class="mov-meta">${c.label} • ${escapeHtml(mov.motivo || '')} • ${fecha}</div>
                <div class="mov-meta">👤 ${escapeHtml(personaLabel)}</div>
                ${mostrarObservacion && mov.observaciones ? `<div class="mov-meta">📝 ${escapeHtml(mov.observaciones)}</div>` : ''}
                ${mov.ubicacionOrigen || mov.ubicacionDestino ? `<div class="mov-meta">📍 ${escapeHtml([mov.ubicacionOrigen, mov.ubicacionDestino].filter(Boolean).join(' → '))}</div>` : ''}
            </div>
            <div class="mov-qty">${c.signo}${c.cantidad}</div>
            ${esAdmin() ? `<button class="action-btn mov-edit-btn" onclick="editarMovimientoInventario(${mov.id})" title="Editar movimiento (recalcula el stock)"><i class="fa-solid fa-gear"></i></button>` : ''}
            ${esAdmin() ? `<button class="action-btn delete mov-delete-btn" onclick="eliminarMovimientoInventario(${mov.id})" title="Eliminar movimiento (revierte el stock)"><i class="fa-solid fa-trash"></i></button>` : ''}
        `;
        container.appendChild(item);
    }
}

// ===== ELIMINACIÓN DE MOVIMIENTOS (solo Administrador, con rollback de stock) =====
// Aplica la operación matemática INVERSA sobre articulos.ubicaciones[] vía ajustarStockV9
// y recién entonces borra el registro (IndexedDB + Firestore vía eliminar()).
// Si el rollback no es posible (stock ya movido/gastado), aborta SIN borrar el registro.
async function eliminarMovimientoInventario(id) {
    if (!esAdmin()) { mostrarToast('Solo un Administrador puede eliminar movimientos.', 'error'); return; }
    const mov = await obtenerPorId('movimientosInventario', Number(id));
    if (!mov) { mostrarToast('Movimiento no encontrado.', 'error'); return; }
    const tipo = String(mov.tipoMovimiento || '').toLowerCase();
    const cant = Number(mov.cantidad || 0);
    const art = await obtenerPorId('articulos', Number(mov.articuloId));
    const artName = art ? art.nombre : ('#' + mov.articuloId);
    const rutaV9 = [mov.ubicacionOrigen, mov.ubicacionDestino].filter(Boolean).join(' → ') || 'ubicación por defecto';
    const confirmado = await mostrarConfirmacion('Eliminar Movimiento',
        `Se eliminará el movimiento "${tipo}" de ${cant} unidad(es) de "${artName}" (${rutaV9}) y se REVERTIRÁ su efecto sobre el stock. ¿Continuar?`);
    if (!confirmado) return;

    if (Number.isFinite(cant) && cant > 0) {
        let opcionesInversas = null;
        if (tipo === 'ingreso' || tipo === 'devolucion') {
            // El ingreso/devolución sumó en 'ubicacionDestino' → ahora se resta de esa misma ubicación.
            opcionesInversas = { tipoMovimiento: 'consumo', cantidad: cant, ubicacionOrigenId: mov.ubicacionDestino || null };
        } else if (tipo === 'consumo' || tipo === 'baja') {
            // El consumo/baja restó de 'ubicacionOrigen' → se devuelven las unidades al origen.
            opcionesInversas = { tipoMovimiento: 'ingreso', cantidad: cant, ubicacionDestinoId: mov.ubicacionOrigen || null };
        } else if (tipo === 'transferencia_interna') {
            // Transfirió Origen → Destino: se revierte Destino → Origen (el total global no cambia).
            opcionesInversas = { tipoMovimiento: 'transferencia_interna', cantidad: cant, ubicacionOrigenId: mov.ubicacionDestino, ubicacionDestinoId: mov.ubicacionOrigen };
        } else if (tipo === 'ajuste') {
            // Ajuste ±N sobre una ubicación: se aplica el signo opuesto (-N).
            opcionesInversas = { tipoMovimiento: 'ajuste', cantidad: -cant, ubicacionOrigenId: mov.ubicacionOrigen || null, ubicacionDestinoId: mov.ubicacionDestino || null };
        } else {
            mostrarToast(`Tipo de movimiento desconocido ("${tipo}"): no se puede revertir de forma segura.`, 'error');
            return;
        }
        try {
            await ajustarStockV9(Number(mov.articuloId), mov.talleId ? Number(mov.talleId) : null, opcionesInversas);
        } catch (e) {
            mostrarToast(`No se pudo revertir el stock (${e.message}). El movimiento NO fue eliminado.`, 'error');
            return;
        }
    } else {
        console.warn('eliminarMovimientoInventario: movimiento sin cantidad válida, se elimina sin rollback.', mov);
    }

    await eliminar('movimientosInventario', Number(id));
    invalidarCache('movimientosInventario');
    invalidarCache('articulos');
    invalidarCache('articuloTalles');
    mostrarToast('Movimiento eliminado y stock revertido.');
    listarMovimientosInventario();
    listarArticulos();
}

// ===== EDICIÓN DE MOVIMIENTOS HISTÓRICOS (EXCLUSIVO ADMIN, V9) =====
// Flujo dual atómico: 1) simulación en memoria (rollback del original + aplicación del nuevo,
// verificando que ninguna ubicación quede negativa en NINGÚN punto intermedio), 2) ejecución
// real secuencial vía ajustarStockV9, 3) actualización del documento del movimiento con
// trazabilidad (fechaEdicion/usuarioEdicion). El artículo NO puede cambiarse.

// Helper PURO: deltas por ubicación para un tipo canónico. Devuelve null si la configuración es inválida.
function deltasMovimientoV9(tipo, cant, idOrigen, idDestino) {
    const t = String(tipo || '').toLowerCase();
    const c = Number(cant);
    if (!Number.isFinite(c) || c === 0) return null;
    if (t === 'ingreso' || t === 'devolucion') {
        if (idDestino == null) return null;
        return [{ ubicacionId: Number(idDestino), delta: c }];
    }
    if (t === 'consumo' || t === 'baja') {
        if (idOrigen == null) return null;
        return [{ ubicacionId: Number(idOrigen), delta: -c }];
    }
    if (t === 'transferencia_interna') {
        if (idOrigen == null || idDestino == null || Number(idOrigen) === Number(idDestino)) return null;
        return [{ ubicacionId: Number(idOrigen), delta: -c }, { ubicacionId: Number(idDestino), delta: c }];
    }
    if (t === 'ajuste') {
        if (idOrigen == null && idDestino == null) return null;
        return [{ ubicacionId: Number(idOrigen != null ? idOrigen : idDestino), delta: c }];
    }
    return null;
}

// Helper PURO: aplica una secuencia de pasos (deltas) sobre una copia del array ubicaciones[]
// y devuelve la copia final SOLO si en ningún punto intermedio alguna ubicación queda < 0.
function simularEdicionMovimientoV9(ubicacionesArr, pasos) {
    try {
        const copia = (Array.isArray(ubicacionesArr) ? ubicacionesArr : []).map(f => ({ ...f }));
        const aplicar = (deltas, talleId) => {
            if (!Array.isArray(deltas)) return false;
            const claveT = talleId == null ? null : Number(talleId);
            for (const d of deltas) {
                const claveU = Number(d.ubicacionId);
                let fila = copia.find(f => Number(f.ubicacionId) === claveU && (claveT == null ? f.talleId == null : Number(f.talleId) === claveT));
                if (!fila) {
                    if (d.delta < 0) return false;
                    copia.push({ ubicacionId: claveU, talleId: claveT, cantidad: 0 });
                    fila = copia[copia.length - 1];
                }
                fila.cantidad = Number(fila.cantidad || 0) + d.delta;
                if (Number(fila.cantidad) < 0) return false;
            }
            return true;
        };
        for (const p of pasos) { if (!aplicar(p.deltas, p.talleId)) return null; }
        return copia;
    } catch (e) {
        console.warn('simularEdicionMovimientoV9: fallo de simulación:', e);
        return null;
    }
}

async function editarMovimientoInventario(id) {
    if (!esAdmin()) { mostrarToast('Solo un Administrador puede editar movimientos.', 'error'); return; }
    const mov = await obtenerPorId('movimientosInventario', Number(id));
    if (!mov) { mostrarToast('Movimiento no encontrado.', 'error'); return; }
    const art = await obtenerPorId('articulos', Number(mov.articuloId));
    window.edicionMovimientoId = Number(id);

    // Tipo canónico (normaliza legacy residual para el motor). mapearTipoMovimientoV9 devuelve
    // un OBJETO { tipoMovimiento, esIngreso }: extraer el campo, no stringificar el objeto.
    let tipoCanonV9 = String(mov.tipoMovimiento || '').toLowerCase();
    if (typeof mapearTipoMovimientoV9 === 'function') {
        const mapeoV9 = mapearTipoMovimientoV9(mov.tipoMovimiento, mov.tipoBien || null);
        if (mapeoV9 && mapeoV9.tipoMovimiento) tipoCanonV9 = String(mapeoV9.tipoMovimiento).toLowerCase();
    }
    // FLEXIBILIZACIÓN (historial legacy sin tipo mapeable): inferir por 'esIngreso' y, en
    // última instancia, por la presencia de snapshots de ubicación. Solo se aborta si el
    // registro no tiene NI tipo NI señales de ubicación.
    const CANONICOS_V9 = ['ingreso', 'consumo', 'transferencia_interna', 'devolucion', 'baja', 'ajuste'];
    if (!CANONICOS_V9.includes(tipoCanonV9)) {
        const tieneDestinoV9 = !!(mov.ubicacionDestino || mov.sectorDestino);
        const tieneOrigenV9 = !!(mov.ubicacionOrigen || mov.sector);
        if (mov.esIngreso === true) tipoCanonV9 = 'ingreso';
        else if (mov.esIngreso === false && tieneDestinoV9 && tieneOrigenV9) tipoCanonV9 = 'transferencia_interna';
        else if (mov.esIngreso === false) tipoCanonV9 = 'consumo';
        else if (tieneDestinoV9) tipoCanonV9 = 'ingreso';
        else if (tieneOrigenV9) tipoCanonV9 = 'consumo';
    }
    window.edicionMovTipoOriginalV9 = tipoCanonV9;

    const info = document.getElementById('editar-mov-art-info');
    if (info) info.innerHTML = `<strong>${escapeHtml(art ? art.codigo : '#' + mov.articuloId)}</strong> — ${escapeHtml(art ? art.nombre : 'Artículo eliminado')}`;

    const selTipo = document.getElementById('editar-mov-tipo');
    if (!CANONICOS_V9.includes(tipoCanonV9)) {
        mostrarToast('Movimiento sin tipo ni ubicaciones inferibles: no es editable de forma segura.', 'error');
        return;
    }
    selTipo.value = tipoCanonV9;

    // Talle (solo si el artículo controla talles).
    const talleGroup = document.getElementById('editar-mov-talle-group');
    const selTalle = document.getElementById('editar-mov-talle');
    selTalle.innerHTML = '<option value="">Sin talle</option>';
    if (art && art.controlaTalles) {
        const [talles, articuloTalles] = await Promise.all([getTodos('talles'), getTodos('articuloTalles')]);
        articuloTalles.filter(at => Number(at.articuloId) === Number(mov.articuloId)).forEach(at => {
            const infoT = talles.find(t => Number(t.id) === Number(at.talleId));
            selTalle.innerHTML += `<option value="${at.talleId}">${infoT ? escapeHtml(infoT.nombre) : 'Talle ' + at.talleId}</option>`;
        });
        selTalle.value = mov.talleId != null ? String(Number(mov.talleId)) : '';
        talleGroup.style.display = '';
    } else {
        talleGroup.style.display = 'none';
    }

    // Selectores de ubicaciones (por nombre, consistente con el resto de la app). Se agrega
    // como opción extra cualquier snapshot histórico que ya no esté en el catálogo.
    const ubicaciones = await obtenerUbicacionesActivas();
    const nombresV9 = ubicaciones.map(u => u.nombre);
    const poblar = (sel, valorActual) => {
        sel.innerHTML = '<option value="">—</option>'
            + nombresV9.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
        if (valorActual && !nombresV9.includes(valorActual)) {
            sel.innerHTML += `<option value="${escapeHtml(valorActual)}">${escapeHtml(valorActual)} (histórico)</option>`;
        }
        sel.value = valorActual || '';
    };
    // FLEXIBILIZACIÓN: los registros legacy guardan ubicaciones en 'sector'/'sectorDestino'
    // (Fase 1) o directamente no las tienen → fallbacks basados en texto.
    const nombreOrigenV9 = mov.ubicacionOrigen || mov.sector
        || (['consumo', 'baja', 'transferencia_interna'].includes(tipoCanonV9) ? 'Depósito Central' : '');
    const nombreDestinoV9 = mov.ubicacionDestino || mov.sectorDestino
        || (['ingreso', 'devolucion', 'transferencia_interna'].includes(tipoCanonV9) ? 'Depósito Central' : '');
    poblar(document.getElementById('editar-mov-origen'), nombreOrigenV9 || '');
    poblar(document.getElementById('editar-mov-destino'), nombreDestinoV9 || '');

    // Cantidad: para 'ajuste' se reconstruye el signo (Origen=negativo, Destino=positivo,
    // cantidad ya firmada, o fallback razonable: positivo en Bodega si no hay snapshots).
    const inpCant = document.getElementById('editar-mov-cantidad');
    let cantVisual = Math.abs(Number(mov.cantidad || 0));
    if (tipoCanonV9 === 'ajuste') {
        if (mov.ubicacionOrigen && !mov.ubicacionDestino) cantVisual = -cantVisual;
        else if (!mov.ubicacionOrigen && mov.ubicacionDestino) cantVisual = cantVisual;
        else if (Number(mov.cantidad || 0) < 0) cantVisual = Number(mov.cantidad);
        if (!nombreOrigenV9) poblar(document.getElementById('editar-mov-origen'), 'Depósito Central');
        inpCant.removeAttribute('min');
    } else {
        inpCant.setAttribute('min', '1');
    }
    inpCant.value = cantVisual;

    document.getElementById('editar-mov-observaciones').value = mov.observaciones || '';
    onEditarMovTipoChange();
    openModal('modalEditarMovimiento');
}

// Visibilidad de campos según el tipo de movimiento en el modal de edición.
function onEditarMovTipoChange() {
    const tipo = document.getElementById('editar-mov-tipo').value;
    const gOrigen = document.getElementById('editar-mov-origen-group');
    const gDestino = document.getElementById('editar-mov-destino-group');
    const inpCant = document.getElementById('editar-mov-cantidad');
    // ingreso/devolucion → Destino | consumo/baja → Origen | transferencia → ambos | ajuste → Origen (con signo).
    gOrigen.style.display = ['consumo', 'baja', 'transferencia_interna', 'ajuste'].includes(tipo) ? '' : 'none';
    gDestino.style.display = ['ingreso', 'devolucion', 'transferencia_interna'].includes(tipo) ? '' : 'none';
    if (tipo === 'ajuste') inpCant.removeAttribute('min'); else inpCant.setAttribute('min', '1');
}

async function guardarEdicionMovimientoInventario() {
    if (!esAdmin()) { mostrarToast('Solo un Administrador puede editar movimientos.', 'error'); return; }
    const id = Number(window.edicionMovimientoId);
    const mov = await obtenerPorId('movimientosInventario', id);
    if (!mov) { mostrarToast('Movimiento no encontrado.', 'error'); return; }
    const art = await obtenerPorId('articulos', Number(mov.articuloId));
    if (!art) { mostrarToast('El artículo del movimiento ya no existe: no es editable.', 'error'); return; }

    const tipoOrigV9 = window.edicionMovTipoOriginalV9;
    const tipoNuevoV9 = document.getElementById('editar-mov-tipo').value;
    const origenNombreN = document.getElementById('editar-mov-origen').value || null;
    const destinoNombreN = document.getElementById('editar-mov-destino').value || null;
    const talleNuevoV9 = (art.controlaTalles && document.getElementById('editar-mov-talle-group').style.display !== 'none')
        ? (document.getElementById('editar-mov-talle').value ? Number(document.getElementById('editar-mov-talle').value) : null)
        : null;
    const obsNuevas = document.getElementById('editar-mov-observaciones').value.trim();

    // FLEXIBILIZACIÓN: snapshots legacy en 'sector'/'sectorDestino' + fallback a Bodega para
    // las ubicaciones requeridas por cada tipo que el registro no trae. Los IDs se deducen
    // en caliente desde los textos (resolverUbicacionV9 crea el catálogo si faltara).
    const nombreOrigenOrigV9 = mov.ubicacionOrigen || mov.sector || null;
    const nombreDestinoOrigV9 = mov.ubicacionDestino || mov.sectorDestino || null;
    let idOrigenOrig = nombreOrigenOrigV9 ? await resolverUbicacionV9(nombreOrigenOrigV9) : null;
    let idDestinoOrig = nombreDestinoOrigV9 ? await resolverUbicacionV9(nombreDestinoOrigV9) : null;
    const BODEGA_ID_V9 = await resolverUbicacionV9('Depósito Central');
    if (['consumo', 'baja'].includes(tipoOrigV9) && !idOrigenOrig) idOrigenOrig = BODEGA_ID_V9;
    if (['ingreso', 'devolucion'].includes(tipoOrigV9) && !idDestinoOrig) idDestinoOrig = BODEGA_ID_V9;
    if (tipoOrigV9 === 'transferencia_interna' && !idOrigenOrig && !idDestinoOrig) idOrigenOrig = BODEGA_ID_V9;
    if (tipoOrigV9 === 'ajuste' && !idOrigenOrig && !idDestinoOrig) idOrigenOrig = BODEGA_ID_V9;
    const idOrigenN = origenNombreN ? await resolverUbicacionV9(origenNombreN) : null;
    const idDestinoN = destinoNombreN ? await resolverUbicacionV9(destinoNombreN) : null;

    // Cantidad original con signo ('ajuste': Origen=negativo, Destino=positivo, cantidad
    // firmada, o fallback razonable: positivo en Bodega si el registro no trae snapshots).
    let cantOrigConSigno = Number(mov.cantidad || 0);
    if (tipoOrigV9 === 'ajuste') {
        if (mov.ubicacionOrigen && !mov.ubicacionDestino) cantOrigConSigno = -Math.abs(cantOrigConSigno);
        else if (!mov.ubicacionOrigen && mov.ubicacionDestino) cantOrigConSigno = Math.abs(cantOrigConSigno);
        else if (cantOrigConSigno < 0) { /* ya viene firmado */ }
        else { cantOrigConSigno = Math.abs(cantOrigConSigno); }
    }
    const cantInversaV9 = -cantOrigConSigno;

    // Cantidad nueva con signo (para 'ajuste' el input acepta negativos).
    let cantNuevaV9 = Number(document.getElementById('editar-mov-cantidad').value);
    if (!Number.isFinite(cantNuevaV9) || cantNuevaV9 === 0) { mostrarToast('Cantidad inválida.', 'error'); return; }
    if (tipoNuevoV9 !== 'ajuste' && cantNuevaV9 < 0) { mostrarToast('La cantidad debe ser positiva para este tipo de movimiento.', 'error'); return; }
    if (!deltasMovimientoV9(tipoNuevoV9, cantNuevaV9, idOrigenN, idDestinoN)) {
        mostrarToast('Completá las ubicaciones requeridas para el tipo de movimiento elegido.', 'error');
        return;
    }

    // No-op: solo cambió texto (observaciones) → guardar documento sin tocar stock.
    // (comparando contra los nombres EFECTIVOS, incluyendo los fallbacks legacy aplicados)
    const mismoStock = tipoOrigV9 === tipoNuevoV9
        && Math.abs(cantNuevaV9) === Math.abs(Number(mov.cantidad || 0))
        && (origenNombreN || null) === (nombreOrigenOrigV9 || null)
        && (destinoNombreN || null) === (nombreDestinoOrigV9 || null)
        && (talleNuevoV9 || null) === (mov.talleId != null ? Number(mov.talleId) : null);

    // Reparación defensiva de transferencias antiguas: el movimiento puede tener los
    // snapshots correctos aunque la mutación física no se haya aplicado al artículo.
    if (mismoStock && tipoNuevoV9 === 'transferencia_interna' && idOrigenN && idDestinoN) {
        const talleRepararV9 = talleNuevoV9;
        const origenActualV9 = obtenerStockUbicacionV9(art, talleRepararV9, idOrigenN);
        const destinoActualV9 = obtenerStockUbicacionV9(art, talleRepararV9, idDestinoN);
        const cantidadRepararV9 = Math.abs(cantNuevaV9);
        if (destinoActualV9 === 0 && origenActualV9 >= cantidadRepararV9) {
            try {
                await ajustarStockV9(Number(mov.articuloId), talleRepararV9, {
                    tipoMovimiento: 'transferencia_interna',
                    cantidad: cantidadRepararV9,
                    ubicacionOrigenId: idOrigenN,
                    ubicacionDestinoId: idDestinoN
                });
                mostrarToast('Se corrigió la ubicación física del artículo.', 'success');
            } catch (eRepararV9) {
                mostrarToast(`No se pudo corregir la ubicación: ${eRepararV9.message}`, 'error');
                return;
            }
        }
    }

    if (!mismoStock) {
        // SIMULACIÓN ATÓMICA sobre el baseline del artículo (consistente con el backfill de
        // ajustarStockV9: art.sector || 'Depósito Central' si aún no tiene ubicaciones[]).
        let baseUbiV9 = Array.isArray(art.ubicaciones) && art.ubicaciones.length > 0 ? art.ubicaciones : null;
        if (!baseUbiV9) {
            const locBaseV9 = await resolverUbicacionV9(art.sector || 'Depósito Central');
            if (art.controlaTalles) {
                const ta = await getTodos('articuloTalles');
                baseUbiV9 = ta.filter(t => Number(t.articuloId) === Number(art.id))
                    .map((t, i) => ({ id: -(Date.now() + i), ubicacionId: locBaseV9, talleId: Number(t.talleId), cantidad: Number(t.stock || 0) }));
                if (baseUbiV9.length === 0) baseUbiV9 = [{ ubicacionId: locBaseV9, talleId: null, cantidad: 0 }];
            } else {
                baseUbiV9 = [{ ubicacionId: locBaseV9, talleId: null, cantidad: Number(art.stockUnico || 0) }];
            }
        }
        const deltasRollback = deltasMovimientoV9(tipoOrigV9, cantInversaV9, idOrigenOrig, idDestinoOrig);
        const deltasNuevas = deltasMovimientoV9(tipoNuevoV9, cantNuevaV9, idOrigenN, idDestinoN);
        if (!deltasRollback || !deltasNuevas) { mostrarToast('Configuración de ubicaciones inválida para la re-edición.', 'error'); return; }
        const simulado = simularEdicionMovimientoV9(baseUbiV9, [
            { deltas: deltasRollback, talleId: mov.talleId != null ? Number(mov.talleId) : null },
            { deltas: deltasNuevas, talleId: talleNuevoV9 }
        ]);
        if (!simulado) {
            mostrarToast('La edición dejaría stock negativo en una ubicación (rollback o aplicación). Operación cancelada: ni el movimiento ni el artículo fueron modificados.', 'error');
            return;
        }
        // PASO 1 real: rollback del original (la simulación ya garantizó la factibilidad).
        try {
            await ajustarStockV9(Number(mov.articuloId), mov.talleId != null ? Number(mov.talleId) : null, {
                tipoMovimiento: tipoOrigV9, cantidad: cantInversaV9,
                ubicacionOrigenId: idOrigenOrig, ubicacionDestinoId: idDestinoOrig
            });
        } catch (e) {
            mostrarToast(`Paso 1 (reversión) falló: ${e.message}. No se modificó nada.`, 'error');
            return;
        }
        // PASO 2 real: aplicación del nuevo valor (con compensación si algo inesperado fallara).
        try {
            await ajustarStockV9(Number(mov.articuloId), talleNuevoV9, {
                tipoMovimiento: tipoNuevoV9, cantidad: cantNuevaV9,
                ubicacionOrigenId: idOrigenN, ubicacionDestinoId: idDestinoN
            });
        } catch (e) {
            try {
                await ajustarStockV9(Number(mov.articuloId), mov.talleId != null ? Number(mov.talleId) : null, {
                    tipoMovimiento: tipoOrigV9, cantidad: cantOrigConSigno,
                    ubicacionOrigenId: idOrigenOrig, ubicacionDestinoId: idDestinoOrig
                });
            } catch (e2) { console.error('Compensación de rollback falló:', e2); }
            mostrarToast(`Paso 2 (aplicación) falló: ${e.message}. Se restauró el estado original.`, 'error');
            return;
        }
    }

    // Persistencia del documento editado con trazabilidad (IndexedDB → Firestore vía guardar()).
    mov.tipoMovimiento = tipoNuevoV9;
    mov.cantidad = Math.abs(cantNuevaV9);
    mov.talleId = talleNuevoV9;
    mov.ubicacionOrigen = origenNombreN;
    mov.ubicacionDestino = destinoNombreN;
    mov.sector = origenNombreN;
    mov.sectorDestino = destinoNombreN;
    mov.esTransferencia = tipoNuevoV9 === 'transferencia_interna';
    mov.observaciones = obsNuevas;
    mov.fechaEdicion = new Date().toISOString();
    mov.usuarioEdicion = currentUser ? currentUser.id : null;
    mov.migradoV9 = true;
    await guardar('movimientosInventario', mov);

    invalidarCache('movimientosInventario');
    invalidarCache('articulos');
    invalidarCache('articuloTalles');
    closeModal('modalEditarMovimiento');
    mostrarToast(mismoStock ? 'Observaciones actualizadas.' : 'Movimiento editado y stock recalculado.');
    listarMovimientosInventario();
    listarArticulos();
}

async function openModalMovimiento() {
    if (!puedeEditar()) return;
    const articulos = await getTodos('articulos');
    const sel = document.getElementById('movimiento-articulo');
    sel.innerHTML = '<option value="">Seleccione un artículo...</option>';
    articulos.filter(a => a.activo !== false).forEach(a => {
        sel.innerHTML += `<option value="${a.id}">${a.codigo} - ${a.nombre}</option>`;
    });

    document.getElementById('form-movimiento').reset();
    document.getElementById('movimiento-id').value = '';
    document.getElementById('movimiento-talle-group').style.display = 'none';
    document.getElementById('movimiento-sector-group').style.display = 'none';
    document.getElementById('movimiento-tipo-bien').value = '';
    // Botonera de Impacto en Stock: EXCLUSIVA de Administradores (oculta para otros roles).
    const impactoGroupV9 = document.getElementById('movimiento-impacto-group');
    if (impactoGroupV9) impactoGroupV9.style.display = esAdmin() ? '' : 'none';
    document.querySelectorAll('input[name="movimiento-impacto"]').forEach(r => { r.checked = false; });
    const impactoHintV9 = document.getElementById('movimiento-impacto-hint');
    if (impactoHintV9) impactoHintV9.textContent = 'Sin selección explícita se aplica el comportamiento canónico del tipo de movimiento.';
    // Rueditas de gestión en caliente (V10): visibles EXCLUSIVAMENTE para Administradores.

    const gearTiposV10 = document.getElementById('btn-gestion-tipos');
    const gearUbisV10 = document.getElementById('btn-gestion-ubicaciones');
    if (gearTiposV10) gearTiposV10.style.display = esAdmin() ? '' : 'none';
    if (gearUbisV10) gearUbisV10.style.display = esAdmin() ? '' : 'none';
    await poblarSelectTiposMovimientoV9();
    const tipoBienInfo = document.getElementById('movimiento-tipo-bien-info');
    if (tipoBienInfo) tipoBienInfo.style.display = 'none';
    document.getElementById('movimiento-modal-title').textContent = 'Registrar Movimiento';
    openModal('modal-movimiento');
}

// ===== CONTROL DE VISIBILIDAD DEL CAMPO SECTOR / UBICACIÓN EN MOVIMIENTOS =====
// Si el artículo es un "Bien de Uso" (tipoBien = 'bien_uso'), se muestra el selector
// de Sector / Ubicación para que el usuario elija su destino.
// Si es "Consumible" o no hay artículo seleccionado, se oculta, ya que por defecto
// su destino final siempre será el Depósito Central y no requiere asignación manual.
function actualizarVisibilidadSectorMovimiento(tipoBien) {
    const contenedor = document.getElementById('contenedor-sector-movimiento');
    if (!contenedor) return;

    // FLEXIBILIZACIÓN (Admin): el Administrador puede dirigir el stock a/desde CUALQUIER
    // ubicación del catálogo, independientemente del tipo de bien del artículo.
    if (esAdmin()) {
        contenedor.style.display = 'block';
        const selectSectorAdmin = document.getElementById('movimiento-sector-ubicacion');
        if (selectSectorAdmin && !selectSectorAdmin.value) selectSectorAdmin.value = 'Depósito Central';
        return;
    }

    if (tipoBien === 'bien_uso') {
        contenedor.style.display = 'block';
    } else {
        contenedor.style.display = 'none';
        const selectSector = document.getElementById('movimiento-sector-ubicacion');
        if (selectSector) selectSector.value = '';
    }
}

async function onCambioArticuloMovimiento() {
    const artId = document.getElementById('movimiento-articulo').value;
    if (!artId) {
        document.getElementById('movimiento-talle-group').style.display = 'none';
        document.getElementById('movimiento-sector-group').style.display = 'none';
        document.getElementById('movimiento-tipo-bien').value = '';
        const infoEl = document.getElementById('movimiento-tipo-bien-info');
        if (infoEl) infoEl.style.display = 'none';
        actualizarVisibilidadSectorMovimiento('');
        return;
    }
    const art = await obtenerPorId('articulos', Number(artId));
    if (art && art.controlaTalles) {
        document.getElementById('movimiento-talle-group').style.display = 'block';
        const talles = await getTodos('talles');
        const selTalle = document.getElementById('movimiento-talle');
        const savedTalle = selTalle.value;
        selTalle.innerHTML = '<option value="">Seleccione talle...</option>';
        talles.forEach(t => selTalle.innerHTML += `<option value="${t.id}">${t.nombre}</option>`);
        selTalle.value = savedTalle;
    } else {
        document.getElementById('movimiento-talle-group').style.display = 'none';
    }

    // ===== LECTURA DEL TIPO DE BIEN DESDE LA CATEGORÍA DEL ARTÍCULO =====
    // El artículo heredó el tipoBien de su categoría. Si no lo tiene, se re-deriva desde la categoría padre.
    let tipoBien = art && art.tipoBien;
    if (!tipoBien && art && art.categoriaId) {
        const cat = await obtenerPorId('categoriasInventario', Number(art.categoriaId));
        tipoBien = (cat && cat.tipoBien) || 'consumible';
    }
    if (!tipoBien) tipoBien = 'consumible';

    const tipoBienInput = document.getElementById('movimiento-tipo-bien');
    const tipoBienInfo = document.getElementById('movimiento-tipo-bien-info');
    if (tipoBienInput) tipoBienInput.value = tipoBien;
    if (tipoBienInfo) {
        const label = tipoBien === 'bien_uso' ? 'Bien de Uso / Activo' : 'Consumible';
        const color = tipoBien === 'bien_uso' ? 'var(--accent-green)' : 'var(--accent)';
        tipoBienInfo.innerHTML = `<i class="fa-solid fa-circle-info"></i> Tipo de Bien: <strong style="color:${color};">${label}</strong>`;
        tipoBienInfo.style.display = 'block';
    }

    // Evaluar visibilidad del Sector / Ubicación según el Tipo de Bien del artículo
    actualizarVisibilidadSectorMovimiento(tipoBien);

    // Evaluar visibilidad del Sector de Destino ante cambios de artículo o tipo
    onCambioTipoMovimiento();
}

// ===== LÓGICA CONDICIONAL SEGÚN TIPO DE MOVIMIENTO Y TIPO DE BIEN =====
// Si el movimiento es EGRESO y el artículo es "Consumible": se restará el stock por completo.
// Si el movimiento es EGRESO y el artículo es "Bien de Uso": se debe indicar el Sector de Destino
// para realizar una transferencia interna (restar de la ubicación origen y sumar al destino),
// sin dar de baja el bien. Fase 3: el formulario usa vocabulario canónico, por lo que la
// Transferencia interna se selecciona explícitamente (ya no existe el 'egreso' genérico).

// V10 (defensivo): resuelve la NATURALEZA (semántica de stock) del tipo seleccionado en el
// select de movimiento de forma ROBUSTA, sin depender de la API 'selectedOptions' (que en
// algunos navegadores/entornos puede devolver una colección vacía o indefinida y provocar
// reads de '.naturaleza' sobre un objeto undefined). Recorre options[selectedIndex] y, como
// último recurso, cae al value del <select>.
function obtenerNaturalezaTipoMovimientoV10() {
    const sel = document.getElementById('movimiento-tipo');
    if (!sel) return '';
    const idx = (typeof sel.selectedIndex === 'number') ? sel.selectedIndex : -1;
    const opt = (idx >= 0 && sel.options && sel.options.length > idx) ? sel.options[idx] : null;
    if (opt) {
        const nat = (opt.dataset && opt.dataset.naturaleza) || opt.getAttribute('data-naturaleza');
        if (nat) return String(nat).trim();
    }
    return String(sel.value || '').trim();
}

function onCambioTipoMovimiento() {
    const tipoMovimiento = (document.getElementById('movimiento-tipo') || {}).value || '';
    // V10: la preselección de impacto usa la NATURALEZA del tipo (los tipos personalizados
    // heredan la semántica canónica de su naturaleza a través de data-naturaleza).
    const tipoNaturalezaV10 = obtenerNaturalezaTipoMovimientoV10() || tipoMovimiento;

    // Solo la Transferencia interna muestra el Sector de Destino obligatorio
    const esTransferenciaSel = tipoMovimiento === 'transferencia_interna';
    const sectorGroup = document.getElementById('movimiento-sector-group');
    const sectorSelect = document.getElementById('movimiento-sector-destino');

    if (esTransferenciaSel) {
        if (sectorGroup) sectorGroup.style.display = 'block';
        if (sectorSelect) sectorSelect.required = true;
    } else {
        if (sectorGroup) sectorGroup.style.display = 'none';
        if (sectorSelect) {
            sectorSelect.required = false;
            sectorSelect.value = '';
        }
    }

    // ===== BOTONERA DE IMPACTO (solo Admin): preselección canónica, NUNCA bloqueada =====
    if (esAdmin()) {
        const preseleccionV9 = { ingreso: 'sumar', devolucion: 'sumar', consumo: 'restar', baja: 'restar' }[tipoNaturalezaV10] || '';
        document.querySelectorAll('input[name="movimiento-impacto"]').forEach(r => { r.checked = r.value === preseleccionV9; });
        const hintV9 = document.getElementById('movimiento-impacto-hint');
        if (hintV9) {
            hintV9.textContent = preseleccionV9
                ? 'Preselección canónica aplicada: como Administrador podés forzar otra dirección.'
                : (tipoMovimiento === 'transferencia_interna'
                    ? 'Transferencia: sin preselección — mueve stock entre ubicaciones, salvo que fuerces Sumar/Restar.'
                    : tipoMovimiento === 'ajuste'
                        ? 'Ajuste: sin preselección — el sentido lo define la operación, salvo que fuerces Sumar/Restar.'
                        : 'Sin selección explícita se aplica el comportamiento canónico del tipo de movimiento.');
        }
    }
}

async function guardarMovimientoForm(e) {
    e.preventDefault();
    if (!puedeEditar()) return;

    const articuloId = document.getElementById('movimiento-articulo').value;
    const tipo = (document.getElementById('movimiento-tipo') || {}).value || '';
    // GUARD defensivo (V10): sin un tipo válido seleccionado no hay naturaleza qué resolver
    // ni operación que registrar. Se valida ANTES de consultar el catálogo 'tiposMovimiento'
    // y antes de leer cualquier dato del option seleccionado (evita leer '.naturaleza' de un
    // objeto indefinido que congelaba el flujo del formulario).
    if (!tipo) {
        mostrarToast('Seleccioná un Tipo de Movimiento.', 'error');
        return;
    }
    // V10: resolución de naturaleza del tipo (canónico o personalizado) mediante helper
    // robusto (los tipos dinámicos heredan la semántica canónica a través de data-naturaleza).
    const tipoNaturalezaV10 = obtenerNaturalezaTipoMovimientoV10() || tipo;
    const cantidad = Number(document.getElementById('movimiento-cantidad').value);
    const talleId = document.getElementById('movimiento-talle').value || null;
    const motivo = document.getElementById('movimiento-motivo').value.trim();
    const observaciones = document.getElementById('movimiento-observaciones').value.trim();
    const tipoBien = document.getElementById('movimiento-tipo-bien').value || 'consumible';
    const sectorDestino = document.getElementById('movimiento-sector-destino').value;
    // ===== BOTONERA DE IMPACTO (solo Admin): separa el rótulo del movimiento de la matemática real =====
    const impactoSelV9 = esAdmin() ? (((document.querySelector('input[name="movimiento-impacto"]:checked') || {}).value) || '') : '';

    // ===== SECTOR / UBICACIÓN DEL MOVIMIENTO =====
    // Si el campo #contenedor-sector-movimiento está visible (artículo Bien de Uso),
    // se guarda el valor seleccionado por el usuario en la propiedad 'sector'.
    // Si está oculto (artículo Consumible), se asigna por defecto "Depósito Central"
    // de forma automática, ya que ese es su destino final sin asignación manual.
    const contenedorSectorMov = document.getElementById('contenedor-sector-movimiento');
    const esSectorVisible = contenedorSectorMov && contenedorSectorMov.style.display !== 'none';
    const sectorUbicacion = esSectorVisible
        ? (document.getElementById('movimiento-sector-ubicacion').value || null)
        : 'Depósito Central';

    if (!articuloId || !tipo || !cantidad || !motivo) {
        mostrarToast('Completá todos los campos requeridos.', 'error');
        return;
    }

    const art = await obtenerPorId('articulos', Number(articuloId));
    if (!art) { mostrarToast('Artículo no encontrado.', 'error'); return; }

    // ===== LÓGICA CONDICIONAL SEGÚN TIPO DE BIEN (vocabulario canónico Fase 1/2) =====
    // El tipoBien se pasa a mapearTipoMovimientoV9; los Bienes de Uso se mueven vía
    // 'transferencia_interna' y los consumibles se consumen ('consumo').

    // Fase 3: el formulario ofrece 'transferencia_interna' explícito; el destino obligatorio
    // se valida más abajo (esTransferencia && !sectorDestino). Los consumibles se registran
    // como 'consumo' y los ingresos/ajustes no requieren destino.

    // 1) Mapear el tipo del formulario al vocabulario canónico (misma tabla que la migración V9).
    const canon = mapearTipoMovimientoV9(tipoNaturalezaV10, tipoBien);
    const esTransferencia = canon.tipoMovimiento === 'transferencia_interna';
    // Si el Admin forzó Sumar/Restar/Solo Registro, la validación de destino de la
    // transferencia canónica queda relevada (la dirección la dicta el Impacto).
    if (esTransferencia && !sectorDestino && !impactoSelV9) {
        mostrarToast('Para transferencias debe indicar el Sector de Destino.', 'error');
        return;
    }

    // 2) Resolver ubicaciones de origen/destino por nombre (crea el catálogo si faltan).
    // Las transferencias parten del Depósito Central cuando ambos selectores quedaron
    // con la misma ubicación, evitando registrar movimientos Camión -> Camión.
    let origenNombre = sectorUbicacion || 'Depósito Central';
    if (esTransferencia && origenNombre.trim().toLowerCase() === String(sectorDestino).trim().toLowerCase()
        && String(sectorDestino).trim().toLowerCase() !== 'depósito central') {
        origenNombre = 'Depósito Central';
        const selectorOrigen = document.getElementById('movimiento-sector-ubicacion');
        if (selectorOrigen) selectorOrigen.value = origenNombre;
    }
    if (esTransferencia && origenNombre.trim().toLowerCase() === String(sectorDestino).trim().toLowerCase()) {
        mostrarToast('La ubicación de origen y destino deben ser diferentes.', 'error');
        return;
    }
    const idOrigen = await resolverUbicacionV9(origenNombre);
    let idDestino = null;
    if (esTransferencia || canon.esIngreso) {
        idDestino = await resolverUbicacionV9(esTransferencia ? sectorDestino : origenNombre);
    }

    // 3) Ajustar stock: dirección CANÓNICA o FORZADA por el Admin (botonera de Impacto).
    // En todos los casos el ajuste ocurre ANTES de registrar el movimiento (sin historia fantasma).
    let stockNegativoForzadoV9 = false;
    if (impactoSelV9 === 'registro') {
        // Solo Registro: NO se invoca ajustarStockV9 — el stock físico queda intacto.
    } else if (impactoSelV9 === 'sumar' || impactoSelV9 === 'restar') {
        // Dirección FORZADA: el helper hace la matemática ('ingreso'/'consumo' puros) y el
        // rótulo del movimiento conserva el tipo elegido en el formulario.
        const opcionesForzadasV9 = {
            tipoMovimiento: impactoSelV9 === 'sumar' ? 'ingreso' : 'consumo',
            cantidad,
            ubicacionOrigenId: impactoSelV9 === 'restar' ? idOrigen : null,
            ubicacionDestinoId: impactoSelV9 === 'sumar' ? idOrigen : null
        };
        try {
            await ajustarStockV9(Number(articuloId), talleId ? Number(talleId) : null, opcionesForzadasV9);
        } catch (e) {
            // Dry-run detectó stock insuficiente: el Admin puede autorizar el negativo.
            const forzarV9 = await mostrarConfirmacion('Stock insuficiente', `${e.message}. ¿Forzar el ajuste dejando el stock negativo en esa ubicación?`);
            if (!forzarV9) return;
            try {
                stockNegativoForzadoV9 = true;
                await ajustarStockV9(Number(articuloId), talleId ? Number(talleId) : null, { ...opcionesForzadasV9, permitirNegativo: true });
            } catch (e2) {
                mostrarToast(e2.message || 'Error al ajustar el stock.', 'error');
                return;
            }
        }
    } else {
        // Comportamiento canónico (sin anulación del Admin).
        try {
            const talleVerificado = talleId ? Number(talleId) : null;
            const origenAntes = obtenerStockUbicacionV9(art, talleVerificado, idOrigen);
            const destinoAntes = obtenerStockUbicacionV9(art, talleVerificado, idDestino);
            await ajustarStockV9(Number(articuloId), talleId ? Number(talleId) : null, {
                tipoMovimiento: canon.tipoMovimiento,
                cantidad,
                ubicacionOrigenId: idOrigen,
                ubicacionDestinoId: idDestino
            });
            if (esTransferencia) {
                const artVerificado = await obtenerPorId('articulos', Number(articuloId));
                const origenDespues = obtenerStockUbicacionV9(artVerificado, talleVerificado, idOrigen);
                const destinoDespues = obtenerStockUbicacionV9(artVerificado, talleVerificado, idDestino);
                if (origenDespues !== origenAntes - cantidad || destinoDespues !== destinoAntes + cantidad) {
                    await ajustarStockV9(Number(articuloId), talleVerificado, {
                        tipoMovimiento: 'transferencia_interna',
                        cantidad,
                        ubicacionOrigenId: idOrigen,
                        ubicacionDestinoId: idDestino
                    });
                }
            }
        } catch (e) {
            mostrarToast(e.message || 'Error al ajustar el stock.', 'error');
            return;
        }
    }

    // Snapshots de ubicación: según la dirección forzada o el comportamiento canónico.
    let ubicacionOrigenSnapV9, ubicacionDestinoSnapV9;
    if (impactoSelV9 === 'sumar') { ubicacionOrigenSnapV9 = null; ubicacionDestinoSnapV9 = origenNombre; }
    else if (impactoSelV9 === 'restar') { ubicacionOrigenSnapV9 = origenNombre; ubicacionDestinoSnapV9 = null; }
    else {
        ubicacionOrigenSnapV9 = (canon.tipoMovimiento === 'consumo' || canon.tipoMovimiento === 'baja' || esTransferencia) ? origenNombre : null;
        ubicacionDestinoSnapV9 = (canon.tipoMovimiento === 'ingreso' || canon.tipoMovimiento === 'devolucion' || esTransferencia) ? (esTransferencia ? sectorDestino : origenNombre) : null;
    }
    const esIngresoFinalV9 = impactoSelV9 === 'sumar' ? true
        : impactoSelV9 === 'restar' ? false
        : canon.esIngreso;
    // V10: el textarea 'Observaciones' queda estrictamente con el texto libre del operador;
    // el detalle técnico de auditoría se aísla en una propiedad interna del documento
    // (logTecnico) y NO contamina el texto visible/editable del operador.
    const obsFinalesV9 = observaciones;
    const logTecnicoV9 = impactoSelV9
        ? `Movimiento ${impactoSelV9} por Administrador ${currentUser ? currentUser.nombre : 'desconocido'}${stockNegativoForzadoV9 ? ' (stock negativo autorizado)' : ''}`.trim()
        : '';

    const mov = {
        articuloId: Number(articuloId),
        talleId: talleId ? Number(talleId) : null,
        tipoMovimiento: canon.tipoMovimiento,
        esIngreso: esIngresoFinalV9,
        tipoBien: tipoBien,
        impactoForzado: impactoSelV9 || null,
        forzadoPor: impactoSelV9 && currentUser ? currentUser.nombre : null,
        stockNegativoForzado: stockNegativoForzadoV9,
        sectorDestino: sectorDestino || null,
        sector: origenNombre,
        ubicacionOrigen: ubicacionOrigenSnapV9,
        ubicacionDestino: ubicacionDestinoSnapV9,
        esTransferencia,
        cantidad,
        motivo,
        observaciones: obsFinalesV9,
        logTecnico: logTecnicoV9,
        usuarioId: currentUser ? currentUser.id : null,
        fecha: new Date().toISOString().split('T')[0],
        migradoV9: true
    };

    await guardar('movimientosInventario', mov);
    invalidarCache('movimientosInventario');

    closeModal('modal-movimiento');
    const tipoLabel = esTransferencia
        ? `transferencia interna a ${sectorDestino}`
        : `${canon.tipoMovimiento} de ${cantidad} unidades`;
    mostrarToast(`Movimiento registrado: ${tipoLabel}.`);

    const activeView = document.querySelector('.view.active');
    if (activeView) {
        const viewId = activeView.id.replace('view-', '');
        if (viewId === 'movimientos-inventario') listarMovimientosInventario();
        if (viewId === 'articulos') listarArticulos();
    }
}

function claveCatalogoInventario(nombre) {
    return String(nombre || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').toLowerCase();
}

let consolidacionCatalogosInventarioEnCurso = null;
let catalogosInventarioConsolidados = false;

// Consolida registros duplicados creados por importaciones o sincronizaciones antiguas.
// Conserva el primer registro (el catálogo original) y repara sus referencias antes de
// eliminar los duplicados, para que los artículos no queden apuntando a IDs inexistentes.
async function consolidarCatalogosInventario() {
    if (catalogosInventarioConsolidados) return false;
    if (consolidacionCatalogosInventarioEnCurso) return consolidacionCatalogosInventarioEnCurso;

    const tarea = ejecutarConsolidacionCatalogosInventario();
    consolidacionCatalogosInventarioEnCurso = tarea;
    try {
        return await tarea;
    } finally {
        if (consolidacionCatalogosInventarioEnCurso === tarea) {
            consolidacionCatalogosInventarioEnCurso = null;
        }
    }
}

async function ejecutarConsolidacionCatalogosInventario() {
    const [categorias, talles, subcategorias, articulos, articuloTalles] = await Promise.all([
        getTodos('categoriasInventario'),
        getTodos('talles'),
        getTodos('subcategoriasInventario'),
        getTodos('articulos'),
        getTodos('articuloTalles')
    ]);

    const consolidar = async (registros, storeName, actualizarReferencias) => {
        const canonicos = new Map();
        const duplicados = [];
        for (const registro of registros || []) {
            const clave = claveCatalogoInventario(registro.nombre);
            if (!clave) continue;
            if (!canonicos.has(clave)) canonicos.set(clave, registro);
            else duplicados.push({ duplicado: registro, canonico: canonicos.get(clave) });
        }
        if (duplicados.length === 0) return false;

        for (const { duplicado, canonico } of duplicados) {
            await actualizarReferencias(duplicado, canonico);
            await eliminar(storeName, Number(duplicado.id));
        }
        invalidarCache(storeName);
        return true;
    };

    let cambio = false;
    cambio = await consolidar(categorias, 'categoriasInventario', async (duplicada, canonica) => {
        for (const articulo of articulos.filter(a => Number(a.categoriaId) === Number(duplicada.id))) {
            articulo.categoriaId = Number(canonica.id);
            await guardar('articulos', articulo);
        }
        for (const subcategoria of subcategorias.filter(s => Number(s.categoriaId) === Number(duplicada.id))) {
            subcategoria.categoriaId = Number(canonica.id);
            await guardar('subcategoriasInventario', subcategoria);
        }
    }) || cambio;

    cambio = await consolidar(talles, 'talles', async (duplicado, canonico) => {
        for (const fila of articuloTalles.filter(t => Number(t.talleId) === Number(duplicado.id))) {
            fila.talleId = Number(canonico.id);
            await guardar('articuloTalles', fila);
        }
    }) || cambio;

    if (cambio) {
        ['categoriasInventario', 'talles', 'subcategoriasInventario', 'articulos', 'articuloTalles']
            .forEach(invalidarCache);
    }
    catalogosInventarioConsolidados = true;
    return cambio;
}

async function listarCategoriasInventario() {
    const [categorias, subcategorias, talles] = await Promise.all([
        getTodos('categoriasInventario'),
        getTodos('subcategoriasInventario'),
        getTodos('talles')
    ]);

    const catBody = document.getElementById('categorias-inventario-body');
    catBody.innerHTML = categorias.map(c => {
        const acciones = puedeEditar() ? `
            <td style="text-align:right;">
                <button class="action-btn" onclick="editarCategoriaInventario(${c.id})"><i class="fa-solid fa-pen-to-square"></i></button>
                <button class="action-btn delete" onclick="eliminarCategoriaInventario(${c.id})"><i class="fa-solid fa-trash"></i></button>
            </td>
        ` : '';
        const tallesBadge = c.controlaTalles ? '<span class="badge badge-info">Sí</span>' : '<span class="badge badge-secondary">No</span>';
        const tipoBienBadge = c.tipoBien === 'bien_uso' ? '<span class="badge badge-active">Bien de Uso</span>' : '<span class="badge badge-secondary">Consumible</span>';
        const estadoBadge = c.activo !== false ? '<span class="badge badge-active">Activo</span>' : '<span class="badge badge-inactive">Inactivo</span>';
        return `<tr>
            <td style="font-weight:600;">${escapeHtml(c.nombre)}</td>
            <td>${tallesBadge}</td>
            <td>${tipoBienBadge}</td>
            <td>${estadoBadge}</td>
            ${acciones}
        </tr>`;
    }).join('');

    const talleBody = document.getElementById('talles-body');
    talleBody.innerHTML = talles.map(t => {
        const acciones = puedeEditar() ? `
            <td style="text-align:right;">
                <button class="action-btn" onclick="editarTalle(${t.id})"><i class="fa-solid fa-pen-to-square"></i></button>
                <button class="action-btn delete" onclick="eliminarTalle(${t.id})"><i class="fa-solid fa-trash"></i></button>
            </td>
        ` : '';
        return `<tr>
            <td style="font-weight:600;">${escapeHtml(t.nombre)}</td>
            <td>${escapeHtml(t.descripcion || '-')}</td>
            ${acciones}
        </tr>`;
    }).join('');

    const subBody = document.getElementById('subcategorias-inventario-body');
    const categoriasPorId = new Map(categorias.map(c => [Number(c.id), c]));
    subBody.innerHTML = subcategorias.map(s => {
        const cat = categoriasPorId.get(Number(s.categoriaId));
        const catName = cat ? cat.nombre : '-';
        const acciones = puedeEditar() ? `
            <td style="text-align:right;">
                <button class="action-btn" onclick="editarSubcategoria(${s.id})"><i class="fa-solid fa-pen-to-square"></i></button>
                <button class="action-btn delete" onclick="eliminarSubcategoria(${s.id})"><i class="fa-solid fa-trash"></i></button>
            </td>
        ` : '';
        return `<tr>
            <td style="font-weight:600;">${escapeHtml(s.nombre)}</td>
            <td>${escapeHtml(catName)}</td>
            ${acciones}
        </tr>`;
    }).join('');

    if (!catalogosInventarioConsolidados && !consolidacionCatalogosInventarioEnCurso) {
        consolidarCatalogosInventario()
            .then(cambio => {
                if (cambio && document.getElementById('view-categorias-inventario')?.classList.contains('active')) {
                    return listarCategoriasInventario();
                }
            })
            .catch(err => console.error('Error al consolidar los catálogos de inventario:', err));
    }
}

function openModalCategoriaInventario() {
    if (!puedeEditar()) return;
    document.getElementById('form-categoria-inventario').reset();
    document.getElementById('categoria-inv-id').value = '';
    document.getElementById('categoria-inv-tipo-bien').value = '';
    document.getElementById('categoria-inv-controla-talles').value = 'false';
    document.getElementById('categoria-inv-activo').value = 'true';
    document.getElementById('categoria-inv-modal-title').textContent = 'Nueva Categoría de Inventario';
    openModal('modal-categoria-inventario');
}

async function editarCategoriaInventario(id) {
    if (!puedeEditar()) return;
    const c = await obtenerPorId('categoriasInventario', Number(id));
    if (!c) return;
    document.getElementById('categoria-inv-id').value = c.id;
    document.getElementById('categoria-inv-nombre').value = c.nombre;
    document.getElementById('categoria-inv-descripcion').value = c.descripcion || '';
    document.getElementById('categoria-inv-tipo-bien').value = c.tipoBien || 'consumible';
    document.getElementById('categoria-inv-controla-talles').value = c.controlaTalles ? 'true' : 'false';
    document.getElementById('categoria-inv-activo').value = c.activo !== false ? 'true' : 'false';
    document.getElementById('categoria-inv-modal-title').textContent = 'Editar Categoría';
    openModal('modal-categoria-inventario');
}

async function guardarCategoriaInventarioForm(e) {
    e.preventDefault();
    if (!puedeEditar()) return;
    const id = document.getElementById('categoria-inv-id').value;
    const tipoBien = document.getElementById('categoria-inv-tipo-bien').value;
    if (!tipoBien) {
        mostrarToast('Debe seleccionar un Tipo de Bien.', 'error');
        return;
    }
    const cat = {
        nombre: document.getElementById('categoria-inv-nombre').value.trim(),
        descripcion: document.getElementById('categoria-inv-descripcion').value.trim(),
        tipoBien: tipoBien,
        controlaTalles: document.getElementById('categoria-inv-controla-talles').value === 'true',
        activo: document.getElementById('categoria-inv-activo').value === 'true'
    };
    const categoriasExistentes = await getTodos('categoriasInventario');
    const categoriaDuplicada = categoriasExistentes.find(c =>
        claveCatalogoInventario(c.nombre) === claveCatalogoInventario(cat.nombre)
        && String(c.id) !== String(id)
    );
    if (categoriaDuplicada) {
        mostrarToast('Ya existe una categoría con ese nombre.', 'error');
        return;
    }
    if (id) cat.id = Number(id);
    await guardar('categoriasInventario', cat);
    invalidarCache('categoriasInventario');
    closeModal('modal-categoria-inventario');
    mostrarToast('Categoría guardada.');
    listarCategoriasInventario();
}

async function eliminarCategoriaInventario(id) {
    if (!puedeEditar()) return;
    const articulos = await getTodos('articulos');
    if (articulos.some(a => Number(a.categoriaId) === Number(id))) {
        mostrarToast('No se puede eliminar una categoría con artículos asociados.', 'error');
        return;
    }
    if (!(await mostrarConfirmacion('Eliminar Categoría', '¿Eliminar esta categoría de inventario?'))) return;
    await eliminar('categoriasInventario', id);
    invalidarCache('categoriasInventario');
    listarCategoriasInventario();
}

function openModalSubcategoria() {
    if (!puedeEditar()) return;
    document.getElementById('form-subcategoria').reset();
    document.getElementById('subcategoria-id').value = '';
    document.getElementById('subcategoria-modal-title').textContent = 'Nueva Subcategoría';
    cargarSelectSubcategoria();
    openModal('modal-subcategoria');
}

async function cargarSelectSubcategoria() {
    const categorias = await getTodos('categoriasInventario');
    const sel = document.getElementById('subcategoria-categoria');
    const saved = sel.value;
    sel.innerHTML = '<option value="">Seleccione...</option>';
    categorias.forEach(c => sel.innerHTML += `<option value="${c.id}">${c.nombre}</option>`);
    sel.value = saved;
}

async function editarSubcategoria(id) {
    if (!puedeEditar()) return;
    const s = await obtenerPorId('subcategoriasInventario', Number(id));
    if (!s) return;
    await cargarSelectSubcategoria();
    document.getElementById('subcategoria-id').value = s.id;
    document.getElementById('subcategoria-nombre').value = s.nombre;
    document.getElementById('subcategoria-categoria').value = s.categoriaId;
    document.getElementById('subcategoria-modal-title').textContent = 'Editar Subcategoría';
    openModal('modal-subcategoria');
}

async function guardarSubcategoriaForm(e) {
    e.preventDefault();
    if (!puedeEditar()) return;
    const id = document.getElementById('subcategoria-id').value;
    const sub = {
        nombre: document.getElementById('subcategoria-nombre').value.trim(),
        categoriaId: Number(document.getElementById('subcategoria-categoria').value)
    };
    if (!sub.categoriaId) { mostrarToast('Seleccioná una categoría padre.', 'error'); return; }
    if (id) sub.id = Number(id);
    await guardar('subcategoriasInventario', sub);
    invalidarCache('subcategoriasInventario');
    closeModal('modal-subcategoria');
    mostrarToast('Subcategoría guardada.');
    listarCategoriasInventario();
}

async function eliminarSubcategoria(id) {
    if (!puedeEditar()) return;
    if (!(await mostrarConfirmacion('Eliminar Subcategoría', '¿Eliminar esta subcategoría?'))) return;
    await eliminar('subcategoriasInventario', id);
    invalidarCache('subcategoriasInventario');
    listarCategoriasInventario();
}

function openModalTalle() {
    if (!puedeEditar()) return;
    document.getElementById('form-talle').reset();
    document.getElementById('talle-id').value = '';
    document.getElementById('talle-modal-title').textContent = 'Nuevo Talle';
    openModal('modal-talle');
}

async function editarTalle(id) {
    if (!puedeEditar()) return;
    const t = await obtenerPorId('talles', Number(id));
    if (!t) return;
    document.getElementById('talle-id').value = t.id;
    document.getElementById('talle-nombre').value = t.nombre;
    document.getElementById('talle-descripcion').value = t.descripcion || '';
    document.getElementById('talle-modal-title').textContent = 'Editar Talle';
    openModal('modal-talle');
}

async function guardarTalleForm(e) {
    e.preventDefault();
    if (!puedeEditar()) return;
    const id = document.getElementById('talle-id').value;
    const talle = {
        nombre: document.getElementById('talle-nombre').value.trim(),
        descripcion: document.getElementById('talle-descripcion').value.trim()
    };
    if (!talle.nombre) { mostrarToast('El nombre del talle es obligatorio.', 'error'); return; }
    const tallesExistentes = await getTodos('talles');
    const talleDuplicado = tallesExistentes.find(t =>
        claveCatalogoInventario(t.nombre) === claveCatalogoInventario(talle.nombre)
        && String(t.id) !== String(id)
    );
    if (talleDuplicado) {
        mostrarToast('Ya existe un talle con ese nombre.', 'error');
        return;
    }
    if (id) talle.id = Number(id);
    await guardar('talles', talle);
    invalidarCache('talles');
    closeModal('modal-talle');
    mostrarToast('Talle guardado.');
    listarCategoriasInventario();
}

async function eliminarTalle(id) {
    if (!puedeEditar()) return;
    const tallesArt = await getTodos('articuloTalles');
    if (tallesArt.some(t => Number(t.talleId) === Number(id) && Number(t.stock) > 0)) {
        mostrarToast('No se puede eliminar un talle que tiene stock asociado.', 'error');
        return;
    }
    if (!(await mostrarConfirmacion('Eliminar Talle', '¿Eliminar este talle?'))) return;
    for (const t of tallesArt.filter(t => Number(t.talleId) === Number(id))) {
        await eliminar('articuloTalles', t.id);
    }
    await eliminar('talles', id);
    invalidarCache('talles');
    invalidarCache('articuloTalles');
    listarCategoriasInventario();
}

async function listarEntregas() {
    const [entregas, staff, competencias, detalles] = await Promise.all([
        getTodos('entregasInventario'),
        getTodos('staff'),
        getTodos('competencias'),
        getTodos('detalleEntregas')
    ]);

    const filtroPersona = document.getElementById('filtro-entrega-persona').value;
    const filtroEvento = document.getElementById('filtro-entrega-evento').value;
    const buscador = document.getElementById('buscar-entregas').value.toLowerCase();

    const selPersona = document.getElementById('filtro-entrega-persona');
    const savedPer = selPersona.value;
    selPersona.innerHTML = '<option value="todas">Todas</option>';
    staff.forEach(s => selPersona.innerHTML += `<option value="${s.id}">${s.nombre} ${s.apellido}</option>`);
    selPersona.value = savedPer;

    const selEvento = document.getElementById('filtro-entrega-evento');
    const savedEv = selEvento.value;
    selEvento.innerHTML = '<option value="todos">Todos</option>';
    competencias.forEach(c => selEvento.innerHTML += `<option value="${c.id}">${c.nombre}</option>`);
    selEvento.value = savedEv;

    let filtradas = entregas.filter(e => {
        if (filtroPersona !== 'todas' && String(e.personaId) !== String(filtroPersona)) return false;
        if (filtroEvento !== 'todos' && String(e.eventoId) !== String(filtroEvento)) return false;
        if (buscador) {
            const pers = staff.find(s => Number(s.id) === Number(e.personaId));
            const persName = pers ? `${pers.nombre} ${pers.apellido}` : '';
            if (!persName.toLowerCase().includes(buscador)) return false;
        }
        return true;
    }).sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0));

    const container = document.getElementById('entregas-list');
    container.innerHTML = '';

    if (filtradas.length === 0) {
        container.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:2rem;">No hay entregas registradas.</p>';
        return;
    }

    for (const entrega of filtradas) {
        const pers = staff.find(s => Number(s.id) === Number(entrega.personaId));
        const persName = pers ? `${pers.nombre} ${pers.apellido}` : 'ID: ' + entrega.personaId;
        const comp = competencias.find(c => Number(c.id) === Number(entrega.eventoId));
        const compName = comp ? comp.nombre : (entrega.eventoId ? 'ID: ' + entrega.eventoId : 'Sin evento');

        const detallesEntrega = detalles.filter(d => Number(d.entregaId) === Number(entrega.id));

        const card = document.createElement('div');
        card.className = 'delivery-card';
        card.innerHTML = `
            <div class="delivery-header">
                <span class="delivery-person"><i class="fa-solid fa-user"></i> ${escapeHtml(persName)}</span>
                <span class="delivery-date">${formatearFechaVisual(entrega.fecha)}</span>
            </div>
            <div style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:0.75rem;">
                <i class="fa-solid fa-trophy"></i> ${escapeHtml(compName)}
                ${entrega.observaciones ? `<br><i class="fa-solid fa-comment"></i> ${escapeHtml(entrega.observaciones)}` : ''}
            </div>
            <div class="delivery-items">
                ${detallesEntrega.length > 0 ? '' : '<span style="color:var(--text-secondary);">Sin detalle</span>'}
        `;

        for (const det of detallesEntrega) {
            const articulos = await getTodos('articulos');
            const art = articulos.find(a => Number(a.id) === Number(det.articuloId));
            const artName = art ? art.nombre : 'ID: ' + det.articuloId;
            let talleText = '';
            if (det.talleId) {
                const talles = await getTodos('talles');
                const talle = talles.find(t => Number(t.id) === Number(det.talleId));
                if (talle) talleText = ` (${talle.nombre})`;
            }
            card.querySelector('.delivery-items').innerHTML += `
                <div class="delivery-item">
                    <span>${escapeHtml(artName)}${talleText}</span>
                    <span class="item-qty">x${det.cantidad}</span>
                </div>
            `;
        }

        card.innerHTML += `
            <div style="margin-top:0.75rem;padding-top:0.5rem;border-top:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center;">
                <span style="font-size:0.8rem;color:var(--text-secondary);">#${entrega.id}</span>
                ${puedeEditar() ? `
                    <div style="display:flex;gap:0.5rem;">
                        <button class="action-btn delete" onclick="eliminarEntrega(${entrega.id})" title="Eliminar"><i class="fa-solid fa-trash"></i></button>
                    </div>
                ` : ''}
            </div>
        `;
        container.appendChild(card);
    }
}

async function openModalEntrega() {
    if (!puedeEditar()) return;
    const staff = await getTodos('staff');
    const competencias = await getTodos('competencias');
    const articulos = await getTodos('articulos');

    document.getElementById('form-entrega').reset();
    document.getElementById('entrega-id').value = '';
    document.getElementById('entrega-modal-title').textContent = 'Nueva Entrega de Indumentaria';
    document.getElementById('entrega-fecha').value = new Date().toISOString().split('T')[0];

    const selPersona = document.getElementById('entrega-persona');
    selPersona.innerHTML = '<option value="">Seleccione...</option>';
    staff.forEach(s => selPersona.innerHTML += `<option value="${s.id}">${s.nombre} ${s.apellido}</option>`);

    const selEvento = document.getElementById('entrega-evento');
    selEvento.innerHTML = '<option value="">Sin evento</option>';
    competencias.forEach(c => selEvento.innerHTML += `<option value="${c.id}">${c.nombre}</option>`);

    const container = document.getElementById('entrega-detalles-container');
    container.innerHTML = '';
    agregarFilaEntrega();

    openModal('modal-entrega');
}

async function agregarFilaEntrega() {
    const container = document.getElementById('entrega-detalles-container');
    const articulos = await getTodos('articulos');

    const row = document.createElement('div');
    row.className = 'entrega-detalle-row';
    row.style.cssText = 'display:flex;gap:0.5rem;align-items:flex-end;margin-bottom:0.5rem;';

    row.innerHTML = `
        <div class="form-group" style="flex:2;">
            <label>Artículo</label>
            <select class="entrega-articulo-select" required onchange="onCambioArticuloEntrega(this)">
                <option value="">Seleccione...</option>
                ${articulos.filter(a => a.activo !== false).map(a => `<option value="${a.id}">${a.codigo} - ${a.nombre}</option>`).join('')}
            </select>
        </div>
        <div class="form-group" style="flex:1;">
            <label>Talle</label>
            <select class="entrega-talle-select">
                <option value="">Sin talle</option>
            </select>
        </div>
        <div class="form-group" style="flex:0.5;">
            <label>Cantidad</label>
            <input type="number" class="entrega-cantidad-input" min="1" value="1" required>
        </div>
        <div class="form-group entrega-destino-group" style="flex:1.4;display:none;">
            <label>Destino</label>
            <div style="display:flex;gap:0.35rem;align-items:center;">
                <select class="entrega-destino-select" style="flex:1;min-width:0;" onchange="toggleReceptorEntrega(this)"></select>
                <input type="text" class="entrega-receptor-input" placeholder="Nombre del receptor" maxlength="80" style="flex:1;min-width:0;display:none;">
            </div>
        </div>
        <button type="button" class="action-btn delete" onclick="eliminarFilaEntrega(this)" style="margin-bottom:0.5rem;" title="Quitar"><i class="fa-solid fa-times"></i></button>
    `;

    container.appendChild(row);
}

// Muestra/oculta el campo de texto libre "Nombre del receptor": es OBLIGATORIO cuando el
// destino de un Bien de Uso es la asignación nominal definitiva a persona (__PERSONA__).
function toggleReceptorEntrega(destinoSelect) {
    const row = destinoSelect.closest('.entrega-detalle-row');
    const inp = row ? row.querySelector('.entrega-receptor-input') : null;
    if (!inp) return;
    const esNominal = destinoSelect.value === '__PERSONA__';
    inp.style.display = esNominal ? '' : 'none';
    if (!esNominal) inp.value = '';
}

async function onCambioArticuloEntrega(select) {
    const artId = select.value;
    const row = select.closest('.entrega-detalle-row');
    const talleSelect = row.querySelector('.entrega-talle-select');
    const destinoGroup = row.querySelector('.entrega-destino-group');
    const destinoSelect = row.querySelector('.entrega-destino-select');
    if (!artId) {
        talleSelect.innerHTML = '<option value="">Sin talle</option>';
        if (destinoGroup) destinoGroup.style.display = 'none';
        return;
    }
    const art = await obtenerPorId('articulos', Number(artId));
    if (art && art.controlaTalles) {
        const [talles, articuloTalles] = await Promise.all([
            getTodos('talles'),
            getTodos('articuloTalles')
        ]);
        const stockPorTalle = new Map();
        articuloTalles
            .filter(at => Number(at.articuloId) === Number(art.id))
            .forEach(at => stockPorTalle.set(Number(at.talleId), Number(at.stock || 0)));

        const tallesDisponibles = talles.filter(t => (stockPorTalle.get(Number(t.id)) || 0) > 0);
        talleSelect.innerHTML = tallesDisponibles.length > 0
            ? '<option value="">Seleccione talle...</option>'
            : '<option value="">Sin stock disponible</option>';

        tallesDisponibles.forEach(t => {
            const stock = stockPorTalle.get(Number(t.id)) || 0;
            talleSelect.innerHTML += `<option value="${t.id}">${t.nombre} (${stock})</option>`;
        });
    } else {
        talleSelect.innerHTML = '<option value="">Sin talle</option>';
    }
    // Fase 3: Bien de Uso → el operador elige la ubicación destino (se pre-selecciona
    // "Carrera"); Consumible → no hay destino físico, el stock se consume.
    if (destinoGroup && destinoSelect) {
        // Corrección: resolver tipoBien heredado de la categoría (artículos legacy sin campo propio).
        const tipoBienFilaV9 = await resolverTipoBienArticuloV9(art);
        if (art && tipoBienFilaV9 === 'bien_uso') {
            const ubicaciones = await obtenerUbicacionesActivas();
            // PASO 2: opción especial de asignación nominal definitiva a persona (baja patrimonial).
            // El flujo habitual sigue pre-seleccionando "Carrera" (sector interno → transferencia).
            destinoSelect.innerHTML = '<option value="">Seleccione...</option>'
                + '<option value="__PERSONA__" data-nombre="__PERSONA__">👤 Asignación definitiva a persona (baja patrimonial)</option>'
                + ubicaciones
                    .filter(u => String(u.nombre).trim().toLowerCase() !== 'depósito central')
                    .map(u => `<option value="${u.id}" data-nombre="${escapeHtml(u.nombre)}">${escapeHtml(u.nombre)}</option>`)
                    .join('');
            const carreraOpt = Array.from(destinoSelect.options).find(o => String(o.dataset.nombre || '').trim().toLowerCase() === 'carrera');
            if (carreraOpt) destinoSelect.value = carreraOpt.value;
            toggleReceptorEntrega(destinoSelect);
            destinoGroup.style.display = '';
        } else {
            destinoSelect.innerHTML = '<option value="">Sin destino</option>';
            destinoSelect.value = '';
            destinoGroup.style.display = 'none';
        }
    }
}

function eliminarFilaEntrega(btn) {
    const container = document.getElementById('entrega-detalles-container');
    if (container.children.length <= 1) {
        mostrarToast('Debe haber al menos un artículo en la entrega.', 'warning');
        return;
    }
    btn.closest('.entrega-detalle-row').remove();
}

async function guardarEntregaForm(e) {
    e.preventDefault();
    if (!puedeEditar()) return;

    const personaId = document.getElementById('entrega-persona').value;
    if (!personaId) { mostrarToast('Debe seleccionar una persona.', 'error'); return; }
    const rows = document.querySelectorAll('#entrega-detalles-container .entrega-detalle-row');
    if (rows.length === 0) { mostrarToast('Debe agregar al menos un artículo.', 'error'); return; }

    const entrega = {
        personaId: Number(personaId),
        eventoId: document.getElementById('entrega-evento').value || null,
        fecha: document.getElementById('entrega-fecha').value,
        observaciones: document.getElementById('entrega-observaciones').value.trim(),
        usuarioId: currentUser ? currentUser.id : null,
        fechaCreacion: new Date().toISOString()
    };

    // PASADA 1 (validación): verificar stock suficiente en Depósito Central para TODAS las filas
    // antes de guardar el encabezado, evitando entregas parciales.
    const idOrigenEntrega = await resolverUbicacionV9('Depósito Central');
    const articuloTalles = await getTodos('articuloTalles');
    for (const row of rows) {
        const artSelV = row.querySelector('.entrega-articulo-select');
        const talleSelV = row.querySelector('.entrega-talle-select');
        const cantInputV = row.querySelector('.entrega-cantidad-input');
        const articuloIdV = artSelV.value;
        const talleIdV = talleSelV.value || null;
        const cantidadV = Number(cantInputV.value);
        if (!articuloIdV || !cantidadV) continue;
        const artV = await obtenerPorId('articulos', Number(articuloIdV));
        if (!artV) { mostrarToast('Artículo no encontrado.', 'error'); return; }
        // Corrección: resolver tipoBien heredado de la categoría (artículos legacy sin campo propio).
        const tipoBienValV9 = await resolverTipoBienArticuloV9(artV);
        if (tipoBienValV9 === 'bien_uso') {
            const destSelV = row.querySelector('.entrega-destino-select');
            if (!destSelV || !destSelV.value) {
                mostrarToast(`Seleccioná la ubicación destino para "${artV.nombre}" (Bien de Uso).`, 'error');
                return;
            }
            // Asignación nominal: el receptor es texto libre OBLIGATORIO (persona física).
            if (destSelV.value === '__PERSONA__') {
                const receptorInpV = row.querySelector('.entrega-receptor-input');
                if (!receptorInpV || !receptorInpV.value.trim()) {
                    mostrarToast('Debe escribir el nombre de la persona a quien se le asigna el artículo', 'error');
                    return;
                }
            }
        }

        let stockDispV = obtenerStockUbicacionV9(artV, talleIdV ? Number(talleIdV) : null, idOrigenEntrega);
        if (artV.controlaTalles && stockDispV === 0) {
            const stockPorTalle = articuloTalles.find(t => Number(t.articuloId) === Number(artV.id) && Number(t.talleId) === Number(talleIdV));
            if (stockPorTalle) stockDispV = Number(stockPorTalle.stock || 0);
        }
        if (cantidadV > stockDispV) {
            mostrarToast(`Stock insuficiente para "${artV.nombre}" en Depósito Central. Disponible: ${stockDispV}`, 'error');
            return;
        }
    }

    const entregaId = await guardar('entregasInventario', entrega);
    entrega.id = Number(entregaId);

    for (const row of rows) {
        const artSelect = row.querySelector('.entrega-articulo-select');
        const talleSelect = row.querySelector('.entrega-talle-select');
        const cantInput = row.querySelector('.entrega-cantidad-input');

        const articuloId = artSelect.value;
        const talleId = talleSelect.value || null;
        const cantidad = Number(cantInput.value);

        if (!articuloId || !cantidad) continue;

        const art = await obtenerPorId('articulos', Number(articuloId));
        if (!art) { mostrarToast('Artículo no encontrado.', 'error'); return; }

        // Regla de negocio: Consumible → 'consumo' (baja el total); Bien de Uso → 'transferencia_interna'
        // (resta de Depósito Central y suma en la ubicación destino elegida por el operador —
        // pre-seleccionada en "Carrera" por la UI — sin disminuir el stock total).
        // Corrección clave: resolver el tipoBien heredado de la categoría. Sin esto, un Bien de
        // Uso legacy (ej. Scanner) caía en el branch 'consumible' y la entrega le descontaba
        // stock del patrimonio total en lugar de solo moverlo de ubicación.
        // PASO 2 — BIFURCACIÓN PATRIMONIAL POR FILA (Bienes de Uso):
        //  • Destino físico (Camión, Carrera, Taller...) → 'transferencia_interna': cambia de
        //    ubicación y el Stock Total NO disminuye (el activo sigue existiendo).
        //  • Destino "__PERSONA__" (asignación nominal definitiva) → 'baja': resta la unidad de
        //    Depósito Central y DISMINUYE el Stock Total patrimonial de forma definitiva; los
        //    datos del empleado quedan en motivo/observaciones para la auditoría.
        // Consumibles → 'consumo' (sin cambios).
        const tipoBienArtEntregaV9 = await resolverTipoBienArticuloV9(art);
        const esBienUsoEntrega = tipoBienArtEntregaV9 === 'bien_uso';
        const destinoSelEntrega = esBienUsoEntrega ? row.querySelector('.entrega-destino-select') : null;
        const esAsignacionNominalV9 = !!(esBienUsoEntrega && destinoSelEntrega && destinoSelEntrega.value === '__PERSONA__');
        const tipoMovEntrega = esBienUsoEntrega
            ? (esAsignacionNominalV9 ? 'baja' : 'transferencia_interna')
            : 'consumo';
        const destinoNombreEntrega = esBienUsoEntrega
            ? (esAsignacionNominalV9 ? null
                : ((destinoSelEntrega && destinoSelEntrega.value && destinoSelEntrega.selectedOptions[0])
                    ? (destinoSelEntrega.selectedOptions[0].dataset.nombre || 'Carrera')
                    : 'Carrera'))
            : null;
        const idDestinoEntrega = (esBienUsoEntrega && !esAsignacionNominalV9) ? await resolverUbicacionV9(destinoNombreEntrega) : null;

        // Ajuste de stock a través del helper unificado (aplica + recalcula totales derivados).
        try {
            await ajustarStockV9(Number(articuloId), talleId ? Number(talleId) : null, {
                tipoMovimiento: tipoMovEntrega,
                cantidad,
                ubicacionOrigenId: idOrigenEntrega,
                ubicacionDestinoId: idDestinoEntrega
            });
        } catch (e) {
            mostrarToast(`No se pudo descontar stock de "${art.nombre}": ${e.message}`, 'error');
            return;
        }

        const detalle = {
            entregaId: entrega.id,
            articuloId: Number(articuloId),
            talleId: talleId ? Number(talleId) : null,
            cantidad
        };
        await guardar('detalleEntregas', detalle);

        // PASO 2-nominal: el nombre del receptor lo escribe el operador (texto libre) y queda
        // en 'observaciones' y en el campo indexable 'personaNombre' del movimiento de 'baja'.
        const receptorNominalV9 = esAsignacionNominalV9
            ? ((row.querySelector('.entrega-receptor-input') || {}).value || '').trim()
            : null;
        const motivoEntregaV9 = esAsignacionNominalV9
            ? `Asignación definitiva a ${receptorNominalV9}`
            : 'Entrega de indumentaria';
        const personaNombreRealV9 = await obtenerPersonaNombrePorIdV9(Number(personaId));
        const observacionesEntregaV9 = esAsignacionNominalV9
            ? `Entrega #${entrega.id} — Baja por asignación definitiva a: ${receptorNominalV9}`
            : `Entrega #${entrega.id} a persona: ${personaNombreRealV9 || 'Sin persona'}`;

        await guardar('movimientosInventario', {
            articuloId: Number(articuloId),
            talleId: talleId ? Number(talleId) : null,
            tipoMovimiento: tipoMovEntrega,
            esIngreso: false,
            tipoBien: tipoBienArtEntregaV9,
            personaId: Number(personaId),
            personaNombre: esAsignacionNominalV9 ? receptorNominalV9 : null,
            cantidad,
            motivo: motivoEntregaV9,
            observaciones: observacionesEntregaV9,
            ubicacionOrigen: 'Depósito Central',
            ubicacionDestino: destinoNombreEntrega,
            sector: 'Depósito Central',
            sectorDestino: destinoNombreEntrega,
            esTransferencia: esBienUsoEntrega && !esAsignacionNominalV9,
            usuarioId: currentUser ? currentUser.id : null,
            fecha: new Date().toISOString().split('T')[0],
            migradoV9: true
        });
    }

    invalidarCache('entregasInventario');
    invalidarCache('detalleEntregas');
    invalidarCache('articuloTalles');
    invalidarCache('articulos');
    invalidarCache('movimientosInventario');

    closeModal('modal-entrega');
    mostrarToast(`Entrega #${entrega.id} registrada correctamente.`);
    listarEntregas();
}

async function eliminarEntrega(id) {
    if (!puedeEditar()) return;
    if (!(await mostrarConfirmacion('Eliminar Entrega', '¿Eliminar esta entrega? No se restaurará el stock automáticamente.'))) return;

    const detalles = await getTodos('detalleEntregas');
    for (const d of detalles.filter(d => Number(d.entregaId) === Number(id))) {
        await eliminar('detalleEntregas', d.id);
    }
    await eliminar('entregasInventario', id);
    invalidarCache('detalleEntregas');
    invalidarCache('entregasInventario');
    mostrarToast('Entrega eliminada.');
    listarEntregas();
}

// ====================================================================
// MÓDULO: PERSONAL POR COMPETENCIA
// ====================================================================

// Definición de roles/funciones con sus sueldos brutos por defecto
const PERSONAL_COMPETENCIA_DEFAULT = [
    { nombre: 'Comisario Deportivo - Contratado Cat. A', bruto: 169381.98 },
    { nombre: 'Comisario Deportivo - Contratado Cat. B', bruto: 624716.18 },
    { nombre: 'Comisario Deportivo - Mensualizado', bruto: 590600.00 },
    { nombre: 'Comisario Técnico - Contratado Cat. A', bruto: 541000.00 },
    { nombre: 'Comisario Técnico - Contratado Cat. B', bruto: 729714.96 },
    { nombre: 'Comisario Técnico - Mensualizado', bruto: 541000.00 },
    { nombre: 'Oficial Deportivo - Contratado', bruto: 573062.07 },
    { nombre: 'Oficial Deportivo - Mensualizado', bruto: 443500.00 },
    { nombre: 'Personal ACA - Horas Extras', bruto: 0.00 },
    { nombre: 'Personal Contratado - En - Feb', bruto: 63564.37 }
];

// Porcentajes de cálculo
const TASA_PARTICIPACION_ACA = 0.1375;   // 13.75%
const TASA_CONT_PATRONALES = 0.273;      // 27.3%

// Store para persistir personal por competencia
const STORE_PERSONAL = 'personalCompetencia';

// Formatear un número como moneda ARS para mostrar (visual)
function formatearInputMoneda(valor) {
    if (valor === null || valor === undefined || isNaN(valor)) return '';
    return new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(valor);
}

// Parsear un string formateado como moneda a número limpio
function parsearMoneda(str) {
    if (!str) return 0;
    let valor = String(str).trim().replace(/[^0-9,.-]/g, '');
    const tieneComa = valor.includes(',');
    const cantidadPuntos = (valor.match(/\./g) || []).length;

    if (tieneComa) {
        // Formato argentino: 1.234,56
        valor = valor.replace(/\./g, '').replace(',', '.');
    } else if (cantidadPuntos > 1) {
        // Varios puntos representan separadores de miles: 1.234.567
        valor = valor.replace(/\./g, '');
    }

    const limpio = valor.replace(/(?!^)-/g, '');
    return parseFloat(limpio) || 0;
}

// Calcular los valores de una fila de personal
function calcularValoresPersonal(bruto, cantidad) {
    const participacionACA = bruto * TASA_PARTICIPACION_ACA;
    const sacMensualizado = bruto / 12;
    const costoBase = bruto + participacionACA + sacMensualizado;
    const totalBruto = costoBase * cantidad;
    const contPatronales = totalBruto * TASA_CONT_PATRONALES;
    const totalFila = totalBruto + contPatronales;
    return { participacionACA, sacMensualizado, costoBase, totalBruto, contPatronales, totalFila };
}

// Obtener el total de gastos de personal para una competencia
async function obtenerTotalPersonalCompetencia(compId) {
    if (!compId) return 0;
    const registros = await getTodos(STORE_PERSONAL);
    const registro = registros.find(r => Number(r.competenciaId) === Number(compId));
    if (!registro) return 0;
    return registro.filas.reduce((sum, f) => {
        const calc = calcularValoresPersonal(Number(f.bruto) || 0, Number(f.cantidad) || 0);
        return sum + calc.totalFila;
    }, 0);
}

// Cargar la vista de personal por competencia
async function cargarPersonalCompetencia() {
    const selectComp = document.getElementById('personal-comp-select');
    if (!selectComp) return;

    const competencias = await getTodos('competencias');
    const savedComp = selectComp.value;
    selectComp.innerHTML = '<option value="">Seleccione una competencia...</option>';

    competencias.sort((a, b) => new Date(b.fechaInicio) - new Date(a.fechaInicio));
    competencias.forEach(c => {
        const label = c.codigo ? `${c.codigo} - ${c.nombre}` : c.nombre;
        selectComp.innerHTML += `<option value="${c.id}">${escapeHtml(label)}</option>`;
    });
    selectComp.value = savedComp;

    // Cargar los datos de la competencia seleccionada (o la primera si no hay selección)
    if (!selectComp.value && competencias.length > 0) {
        selectComp.value = competencias[0].id;
    }

    // Calcular días de la competencia automáticamente desde las fechas
    const compId = selectComp.value;
    if (compId) {
        const comp = competencias.find(c => Number(c.id) === Number(compId));
        const diasInput = document.getElementById('personal-comp-dias');
        if (comp && comp.fechaInicio && comp.fechaFin && diasInput) {
            const inicio = new Date(comp.fechaInicio);
            const fin = new Date(comp.fechaFin);
            const diff = Math.round((fin - inicio) / (1000 * 60 * 60 * 24)) + 1;
            diasInput.value = diff > 0 ? diff : 1;
        }
    }

    await renderizarTablaPersonalCompetencia();
}

// Renderizar la tabla de personal por competencia
async function renderizarTablaPersonalCompetencia() {
    const compId = document.getElementById('personal-comp-select').value;
    const tbody = document.getElementById('personal-comp-table-body');
    const totalFilaEl = document.getElementById('personal-comp-total-fila');
    const totalEl = document.getElementById('personal-comp-total');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!compId) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-secondary);padding:2rem;">Seleccione una competencia para ver el personal.</td></tr>';
        if (totalFilaEl) totalFilaEl.textContent = formatearMoneda(0);
        if (totalEl) totalEl.textContent = formatearMoneda(0);
        return;
    }

    // Obtener datos guardados o usar valores por defecto
    let filas = null;
    try {
        const registros = await getTodos(STORE_PERSONAL);
        const registro = registros.find(r => Number(r.competenciaId) === Number(compId));
        if (registro && registro.filas) {
            filas = registro.filas;
        }
    } catch(e) {}

    if (!filas) {
        filas = PERSONAL_COMPETENCIA_DEFAULT.map(f => ({ nombre: f.nombre, cantidad: 1, bruto: f.bruto }));
    }

    let totalGeneral = 0;

    filas.forEach((fila, idx) => {
        const bruto = Number(fila.bruto) || 0;
        const cantidad = Number(fila.cantidad) || 0;
        const calc = calcularValoresPersonal(bruto, cantidad);
        totalGeneral += calc.totalFila;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-weight:500;">${escapeHtml(fila.nombre)}</td>
            <td style="text-align:center;">
                <input type="number" class="personal-cantidad-input" data-index="${idx}" min="0" value="${cantidad}" style="width:70px;text-align:center;">
            </td>
            <td style="text-align:right;">
                <input type="text" class="personal-bruto-input" data-index="${idx}" value="${formatearInputMoneda(bruto)}" inputmode="decimal" autocomplete="off" style="width:150px;text-align:right;" placeholder="0,00">
            </td>
            <td style="text-align:right;color:var(--text-secondary);white-space:nowrap;" data-calc="aca" data-index="${idx}">${formatearMoneda(calc.participacionACA)}</td>
            <td style="text-align:right;color:var(--text-secondary);white-space:nowrap;" data-calc="sac" data-index="${idx}">${formatearMoneda(calc.sacMensualizado)}</td>
            <td style="text-align:right;color:var(--text-secondary);white-space:nowrap;" data-calc="base" data-index="${idx}">${formatearMoneda(calc.costoBase)}</td>
            <td style="text-align:right;font-weight:500;white-space:nowrap;" data-calc="totalBruto" data-index="${idx}">${formatearMoneda(calc.totalBruto)}</td>
            <td style="text-align:right;color:var(--accent);font-weight:600;white-space:nowrap;" data-calc="patronales" data-index="${idx}">${formatearMoneda(calc.contPatronales)}</td>
            <td style="text-align:right;color:var(--accent);font-weight:700;white-space:nowrap;" data-calc="totalFila" data-index="${idx}">${formatearMoneda(calc.totalFila)}</td>
        `;
        tbody.appendChild(tr);
    });

    // Actualizar totales
    if (totalFilaEl) totalFilaEl.textContent = formatearMoneda(totalGeneral);
    if (totalEl) totalEl.textContent = formatearMoneda(totalGeneral);

    // Agregar eventos a los inputs
    document.querySelectorAll('.personal-bruto-input').forEach(input => {
        input.addEventListener('focus', onPersonalBrutoFocus);
        input.addEventListener('input', onPersonalBrutoInput);
        input.addEventListener('blur', onPersonalBrutoBlur);
        input.addEventListener('keydown', onPersonalBrutoKeydown);
    });
    document.querySelectorAll('.personal-cantidad-input').forEach(input => {
        input.addEventListener('input', recalcularPersonalFila);
        input.addEventListener('change', recalcularPersonalFila);
    });
}

// Evento: preparar el importe para editarlo sin separadores de miles.
function onPersonalBrutoFocus(e) {
    const raw = parsearMoneda(e.target.value);
    e.target.value = raw > 0 ? String(raw).replace('.', ',') : '';
    e.target.select();
}

// Evento: aceptar la escritura sin reformatear ni mover el cursor.
function onPersonalBrutoInput(e) {
    // Permitir solo dígitos y un separador decimal, sin alterar la posición del cursor.
    const valor = e.target.value.replace(/[^\d,.]/g, '');
    const separador = valor.includes(',') ? ',' : (valor.includes('.') ? '.' : '');
    if (separador) {
        const partes = valor.split(separador);
        e.target.value = partes[0] + separador + partes.slice(1).join('').slice(0, 2);
    } else {
        e.target.value = valor;
    }
    recalcularPersonalFila(e);
}

// Evento: al perder foco, mostrar el formato argentino de moneda.
function onPersonalBrutoBlur(e) {
    const raw = parsearMoneda(e.target.value);
    e.target.value = raw > 0 ? formatearInputMoneda(raw) : '0,00';
    recalcularPersonalFila(e);
}

// Evento: tecla Enter para pasar de campo
function onPersonalBrutoKeydown(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        e.target.blur();
    }
}

// Recalcular los cálculos de una fila cuando cambian cantidad o bruto
function recalcularPersonalFila(e) {
    const input = e.target;
    const index = Number(input.dataset.index);
    const tr = input.closest('tr');
    if (!tr || isNaN(index)) return;

    const brutoInput = tr.querySelector('.personal-bruto-input');
    const cantidadInput = tr.querySelector('.personal-cantidad-input');
    if (!brutoInput || !cantidadInput) return;

    const bruto = parsearMoneda(brutoInput.value);
    const cantidad = Number(cantidadInput.value) || 0;
    const calc = calcularValoresPersonal(bruto, cantidad);

    tr.querySelectorAll('[data-calc]').forEach(cell => {
        const tipo = cell.dataset.calc;
        if (tipo === 'totalFila') cell.textContent = formatearMoneda(calc.totalFila);
        else if (tipo === 'aca') cell.textContent = formatearMoneda(calc.participacionACA);
        else if (tipo === 'sac') cell.textContent = formatearMoneda(calc.sacMensualizado);
        else if (tipo === 'base') cell.textContent = formatearMoneda(calc.costoBase);
        else if (tipo === 'totalBruto') cell.textContent = formatearMoneda(calc.totalBruto);
        else if (tipo === 'patronales') cell.textContent = formatearMoneda(calc.contPatronales);
    });

    // Actualizar total general
    let totalGeneral = 0;
    document.querySelectorAll('#personal-comp-table-body tr').forEach(row => {
        const brutoRow = parsearMoneda(row.querySelector('.personal-bruto-input') ? row.querySelector('.personal-bruto-input').value : '0');
        const cantRow = Number(row.querySelector('.personal-cantidad-input') ? row.querySelector('.personal-cantidad-input').value : 0);
        const calcRow = calcularValoresPersonal(brutoRow, cantRow);
        totalGeneral += calcRow.totalFila;
    });
    const totalFilaEl = document.getElementById('personal-comp-total-fila');
    const totalEl = document.getElementById('personal-comp-total');
    if (totalFilaEl) totalFilaEl.textContent = formatearMoneda(totalGeneral);
    if (totalEl) totalEl.textContent = formatearMoneda(totalGeneral);
}

// Guardar los datos de personal por competencia
async function guardarPersonalCompetencia() {
    if (!puedeEditar()) return;
    const compId = document.getElementById('personal-comp-select').value;
    if (!compId) { mostrarToast('Seleccione una competencia.', 'warning'); return; }

    const dias = Number(document.getElementById('personal-comp-dias').value) || 1;

    const filas = [];
    document.querySelectorAll('#personal-comp-table-body tr').forEach(tr => {
        const nombreEl = tr.querySelector('td:first-child');
        const brutoInput = tr.querySelector('.personal-bruto-input');
        const cantidadInput = tr.querySelector('.personal-cantidad-input');
        if (!nombreEl || !brutoInput || !cantidadInput) return;
        filas.push({
            nombre: nombreEl.textContent,
            bruto: parsearMoneda(brutoInput.value),
            cantidad: Number(cantidadInput.value) || 0
        });
    });

    const registros = await getTodos(STORE_PERSONAL);
    let registro = registros.find(r => Number(r.competenciaId) === Number(compId));
    if (registro) {
        registro.filas = filas;
        registro.dias = dias;
        registro.fechaModificacion = new Date().toISOString();
        registro.usuarioModificacion = currentUser ? currentUser.id : null;
        await guardar(STORE_PERSONAL, registro);
    } else {
        await guardar(STORE_PERSONAL, {
            competenciaId: Number(compId),
            filas,
            dias,
            fechaCreacion: new Date().toISOString(),
            fechaModificacion: new Date().toISOString(),
            usuarioCreacion: currentUser ? currentUser.id : null,
            usuarioModificacion: currentUser ? currentUser.id : null
        });
    }

    await actualizarGastoTotalCompetencia(compId);
    dashboardDirty = true;
    mostrarToast('Personal por competencia guardado correctamente.');
}

// Exportar los datos de personal por competencia a Excel con formato (.xls)
async function exportarPersonalCompetenciaExcel() {
    const compId = document.getElementById('personal-comp-select').value;
    if (!compId) { mostrarToast('Seleccione una competencia.', 'warning'); return; }

    const competencias = await getTodos('competencias');
    const comp = competencias.find(c => Number(c.id) === Number(compId));
    if (!comp) { mostrarToast('Competencia no encontrada.', 'error'); return; }

    const dias = Number(document.getElementById('personal-comp-dias').value) || 1;

    // Obtener filas actuales de la tabla
    const filas = [];
    document.querySelectorAll('#personal-comp-table-body tr').forEach(tr => {
        const nombreEl = tr.querySelector('td:first-child');
        const brutoInput = tr.querySelector('.personal-bruto-input');
        const cantidadInput = tr.querySelector('.personal-cantidad-input');
        if (!nombreEl || !brutoInput || !cantidadInput) return;
        filas.push({
            nombre: nombreEl.textContent,
            bruto: parsearMoneda(brutoInput.value),
            cantidad: Number(cantidadInput.value) || 0
        });
    });

    if (filas.length === 0) { mostrarToast('No hay datos para exportar.', 'warning'); return; }

    // Función para escapar HTML y prevenir inyección
    function escaparHTML(valor) {
        return String(valor || '').replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"');
    }

    function formatearNumero(valor) {
        return new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(valor);
    }

    let totalGeneral = 0;
    let filasHtml = '';
    filas.forEach((fila, idx) => {
        const bruto = Number(fila.bruto) || 0;
        const cantidad = Number(fila.cantidad) || 0;
        const calc = calcularValoresPersonal(bruto, cantidad);
        totalGeneral += calc.totalFila;

        const bg = idx % 2 === 0 ? '#ffffff' : '#f2f2f2';
        filasHtml += `<tr style="background:${bg};">
            <td style="padding:6px;border:1px solid #ccc;">${escaparHTML(fila.nombre)}</td>
            <td style="padding:6px;border:1px solid #ccc;text-align:center;">${cantidad}</td>
            <td style="padding:6px;border:1px solid #ccc;text-align:right;">${formatearNumero(bruto)}</td>
            <td style="padding:6px;border:1px solid #ccc;text-align:right;">${formatearNumero(calc.participacionACA)}</td>
            <td style="padding:6px;border:1px solid #ccc;text-align:right;">${formatearNumero(calc.sacMensualizado)}</td>
            <td style="padding:6px;border:1px solid #ccc;text-align:right;">${formatearNumero(calc.costoBase)}</td>
            <td style="padding:6px;border:1px solid #ccc;text-align:right;">${formatearNumero(calc.totalBruto)}</td>
            <td style="padding:6px;border:1px solid #ccc;text-align:right;">${formatearNumero(calc.contPatronales)}</td>
            <td style="padding:6px;border:1px solid #ccc;text-align:right;font-weight:bold;color:#c0392b;">${formatearNumero(calc.totalFila)}</td>
        </tr>`;
    });

    const html = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
<head>
    <meta charset="UTF-8">
    <!--[if gte mso 9]>
    <xml>
        <x:ExcelWorkbook>
            <x:ExcelWorksheets>
                <x:ExcelWorksheet>
                    <x:Name>Personal por Competencia</x:Name>
                    <x:WorksheetOptions>
                        <x:DisplayGridlines/>
                    </x:WorksheetOptions>
                </x:ExcelWorksheet>
            </x:ExcelWorksheets>
        </x:ExcelWorkbook>
    </xml>
    <![endif]-->
    <style>
        table { border-collapse: collapse; font-family: Calibri, Arial, sans-serif; font-size: 11px; }
        th { background: #1f2a40; color: #ffffff; font-weight: bold; padding: 8px; border: 1px solid #0d1526; text-align: center; }
        .titulo { font-size: 16px; font-weight: bold; color: #1f2a40; }
        .subtitulo { font-size: 12px; color: #555; }
    </style>
</head>
<body>
    <table>
        <tr><td colspan="9" class="titulo">PERSONAL POR COMPETENCIA</td></tr>
        <tr><td colspan="9" class="subtitulo">${escaparHTML(comp.codigo || '')} - ${escaparHTML(comp.nombre)}</td></tr>
        <tr><td colspan="9"></td></tr>
        <tr>
            <td style="background:#e8e8e8;padding:4px;border:1px solid #ccc;font-weight:bold;">Días de Competencia</td>
            <td colspan="2" style="padding:4px;border:1px solid #ccc;">${dias}</td>
            <td style="background:#e8e8e8;padding:4px;border:1px solid #ccc;font-weight:bold;">Fecha Inicio</td>
            <td colspan="2" style="padding:4px;border:1px solid #ccc;">${escaparHTML(comp.fechaInicio || '')}</td>
            <td style="background:#e8e8e8;padding:4px;border:1px solid #ccc;font-weight:bold;">Fecha Fin</td>
            <td colspan="2" style="padding:4px;border:1px solid #ccc;">${escaparHTML(comp.fechaFin || '')}</td>
        </tr>
        <tr><td colspan="9"></td></tr>
        <tr>
            <th>Rol / Función</th>
            <th>Cantidad</th>
            <th>Sueldo Bruto</th>
            <th>Part. ACA (13.75%)</th>
            <th>SAC Mensualizado</th>
            <th>Costo Base p/pers</th>
            <th>Total Salario Bruto</th>
            <th>Cont. Patronales (27.3%)</th>
            <th>Salario + Cargas</th>
        </tr>
        ${filasHtml}
        <tr>
            <td colspan="8" style="padding:8px;border:1px solid #1f2a40;background:#1f2a40;color:#fff;font-weight:bold;text-align:right;">TOTAL GASTOS PERSONAL</td>
            <td style="padding:8px;border:1px solid #1f2a40;background:#1f2a40;color:#2ed573;font-weight:bold;text-align:right;font-size:13px;">${formatearNumero(totalGeneral)}</td>
        </tr>
    </table>
</body>
</html>`;

    const blob = new Blob(['\ufeff' + html], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `personal_competencia_${comp.codigo || comp.id}_${new Date().toISOString().split('T')[0]}.xls`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    mostrarToast('Archivo Excel con formato exportado correctamente.');
}

// Actualizar el gasto total de la competencia sumando el personal
async function actualizarGastoTotalCompetencia(compId) {
    if (!compId) return;
    const totalPersonal = await obtenerTotalPersonalCompetencia(compId);
    const comp = await obtenerPorId('competencias', Number(compId));
    if (!comp) return;

    // Guardar el total de personal en la competencia para integrarlo al total
    comp.totalPersonal = totalPersonal;

    // Sumar al gasto total de la competencia
    // Los gastos simples + detallados ya se calculan automáticamente
    // Este campo se sumará en listarCompetencias, listarGastos y verCompetencia
    await guardar('competencias', comp);
}

// ====================================================================
// MÓDULO: ALOJAMIENTO (OPTIMIZADO)
// ====================================================================

// Estado del módulo
let alojamientosCache = [];
let alojamientosCargados = false;

// ====================================================================
// OPTIMIZACIÓN CLAVE: COMPRESIÓN DE IMAGEN EN EL CLIENTE (Canvas API)
// Redimensiona a un ancho máximo de 1024px y comprime a JPEG calidad 0.7,
// reduciendo drásticamente el peso del archivo ANTES de subirlo a Storage.
// ====================================================================
async function comprimirImagenAlojamiento(file, maxAncho = 1024, calidad = 0.7) {
    return new Promise((resolve, reject) => {
        // Si no es una imagen o no hay Canvas disponible, devolver el archivo original
        if (!file || !file.type || !file.type.startsWith('image/')) {
            return resolve(file);
        }
        if (typeof document === 'undefined' || !document.createElement('canvas').getContext) {
            return resolve(file);
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                try {
                    // Calcular las nuevas dimensiones manteniendo la proporción
                    let { width, height } = img;
                    if (width > maxAncho) {
                        const ratio = maxAncho / width;
                        width = maxAncho;
                        height = Math.round(height * ratio);
                    }

                    // Crear el canvas y dibujar la imagen redimensionada
                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');

                    // Fondo blanco para JPEG (evita transparencias negras en PNG)
                    ctx.fillStyle = '#FFFFFF';
                    ctx.fillRect(0, 0, width, height);
                    ctx.drawImage(img, 0, 0, width, height);

                    // Convertir a JPEG comprimido
                    canvas.toBlob((blob) => {
                        if (blob) {
                            // Crear un nuevo File con el mismo nombre pero extensión .jpg
                            const nombreBase = file.name.replace(/\.[^.]+$/, '') || 'alojamiento';
                            const nuevoFile = new File([blob], `${nombreBase}.jpg`, {
                                type: 'image/jpeg',
                                lastModified: Date.now()
                            });
                            resolve(nuevoFile);
                        } else {
                            // Si toBlob falla, devolver el archivo original
                            resolve(file);
                        }
                    }, 'image/jpeg', calidad);
                } catch (err) {
                    console.warn('Error al comprimir imagen, usando original:', err);
                    resolve(file);
                }
            };
            img.onerror = () => reject(new Error('Error al cargar la imagen para comprimir.'));
            img.src = e.target.result;
        };
        reader.onerror = () => reject(new Error('Error al leer el archivo de imagen.'));
        reader.readAsDataURL(file);
    });
}

// Subir una foto a Firebase Storage y obtener su URL pública
// AHORA con compresión previa en el cliente para minimizar la latencia de red
async function subirFotoAlojamiento(file, alojamientoId) {
    // Comprimir la imagen ANTES de enviarla (reducción drástica de peso)
    let archivoFinal = file;
    try {
        archivoFinal = await comprimirImagenAlojamiento(file);
    } catch (e) {
        console.warn('No se pudo comprimir la imagen, se usará el original:', e);
    }

    // Si no hay Firebase Storage disponible, almacenar como base64 local
    if (typeof getStorage !== 'function' || typeof refStorage !== 'function' || typeof uploadBytes !== 'function' || typeof getDownloadURL !== 'function' || !storageFirebase) {
        // Convertir a base64 local como fallback
        return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Error al leer la imagen.'));
            reader.readAsDataURL(archivoFinal);
        });
    }

    try {
        const safeId = String(alojamientoId || Date.now()).replace(/[^a-zA-Z0-9]/g, '_');
        const fileExt = (archivoFinal.name.split('.').pop() || 'jpg').toLowerCase();
        const storageRef = refStorage(storageFirebase, `alojamientos/${safeId}_${Date.now()}.${fileExt}`);
        await uploadBytes(storageRef, archivoFinal);
        const url = await getDownloadURL(storageRef);
        return url;
    } catch (e) {
        console.warn('Error al subir foto a Firebase Storage:', e);
        // Fallback: guardar como base64 local
        return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Error al leer la imagen.'));
            reader.readAsDataURL(archivoFinal);
        });
    }
}

// Eliminar la foto de un alojamiento de Firebase Storage si existe
async function eliminarFotoAlojamiento(url) {
    if (!url || typeof getStorage !== 'function' || typeof refStorage !== 'function' || typeof deleteObject !== 'function' || !storageFirebase) return;
    try {
        if (url.startsWith('https://firebasestorage.googleapis.com')) {
            const storageRef = refStorage(storageFirebase, url);
            await deleteObject(storageRef);
        }
    } catch (e) {
        console.warn('Error al eliminar foto de Firebase Storage:', e);
    }
}

// Mostrar vista previa de la foto seleccionada en el modal (usando URL.createObjectURL - mucho más rápido)
function setupFotoPreview() {
    const input = document.getElementById('alojamiento-foto');
    if (!input) return;
    input.addEventListener('change', (e) => {
        const file = e.target.files[0];
        const previewCont = document.getElementById('alojamiento-foto-preview');
        const previewImg = document.getElementById('alojamiento-foto-preview-img');
        if (file && previewCont && previewImg) {
            // Liberar URL anterior si existe
            if (previewImg.dataset.objectUrl) {
                URL.revokeObjectURL(previewImg.dataset.objectUrl);
            }
            const objectUrl = URL.createObjectURL(file);
            previewImg.dataset.objectUrl = objectUrl;
            previewImg.src = objectUrl;
            previewCont.style.display = 'block';
        } else if (previewCont) {
            previewCont.style.display = 'none';
        }
    });
}

// Ejecutar setup al cargar DOM (se ejecuta una sola vez en el DOMContentLoaded existente)
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        setupFotoPreview();
    });
}

// Cargar todos los alojamientos (usa caché si ya está cargada)
async function cargarAlojamientos(forzar = false) {
    if (alojamientosCargados && !forzar) {
        return alojamientosCache;
    }
    const alojamientos = await getTodos('alojamientos');
    alojamientosCache = alojamientos.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
    alojamientosCargados = true;
    return alojamientosCache;
}

// Actualizar los selectores de Provincia y Ciudad con valores únicos (solo si cambió)
function actualizarFiltrosAlojamientos() {
    const selProv = document.getElementById('alojamiento-filtro-provincia');
    const selCiudad = document.getElementById('alojamiento-filtro-ciudad');
    if (!selProv || !selCiudad) return;

    const provincias = [...new Set(alojamientosCache.map(a => a.provincia).filter(Boolean))].sort();
    const selProvValue = selProv.value;
    selProv.innerHTML = '<option value="todas">Todas</option>';
    provincias.forEach(p => selProv.innerHTML += `<option value="${p}">${p}</option>`);
    selProv.value = selProvValue;

    // Ciudades según la provincia seleccionada (o todas si 'todas')
    const provSel = selProv.value;
    let ciudades = [...new Set(alojamientosCache.map(a => a.ciudad).filter(Boolean))];
    if (provSel !== 'todas') {
        ciudades = ciudades.filter(c => alojamientosCache.some(a => a.provincia === provSel && a.ciudad === c));
    }
    ciudades.sort();
    const selCiudadValue = selCiudad.value;
    selCiudad.innerHTML = '<option value="todas">Todas</option>';
    ciudades.forEach(c => selCiudad.innerHTML += `<option value="${c}">${c}</option>`);
    selCiudad.value = selCiudadValue;
}

// Buscar alojamientos por la ciudad ingresada (botón Buscar) - usa caché
async function buscarAlojamientoPorCiudad() {
    const buscarInput = document.getElementById('buscar-alojamiento');
    if (!buscarInput) return;
    const ciudad = buscarInput.value.trim().toLowerCase();
    const contenedor = document.getElementById('alojamientos-list');
    if (!contenedor) return;

    // Usar caché sin recargar desde IndexedDB
    await cargarAlojamientos();
    let resultados = alojamientosCache;
    if (ciudad) {
        resultados = alojamientosCache.filter(a => (a.ciudad || '').toLowerCase().includes(ciudad));
    }

    if (resultados.length === 0) {
        contenedor.innerHTML = `
            <div class="alojamientos-empty">
                <i class="fa-solid fa-hotel"></i>
                <p>No se encontraron alojamientos para la ciudad "${ciudad}".</p>
            </div>`;
        return;
    }
    renderizarAlojamientos(resultados);
}

// Filtrar alojamientos por los selectores de Provincia y Ciudad
async function filtrarAlojamientos() {
    const selProv = document.getElementById('alojamiento-filtro-provincia');
    const selCiudad = document.getElementById('alojamiento-filtro-ciudad');
    if (!selProv || !selCiudad) return;

    // Actualizar opciones de ciudad según la provincia
    actualizarFiltrosAlojamientos();

    const prov = selProv.value;
    const ciudad = selCiudad.value;
    let resultados = alojamientosCache;

    if (prov !== 'todas') resultados = resultados.filter(a => a.provincia === prov);
    if (ciudad !== 'todas') resultados = resultados.filter(a => a.ciudad === ciudad);

    renderizarAlojamientos(resultados);
}

// Limpiar todos los filtros y recargar
function limpiarFiltrosAlojamiento() {
    document.getElementById('alojamiento-filtro-provincia').value = 'todas';
    document.getElementById('alojamiento-filtro-ciudad').value = 'todas';
    document.getElementById('buscar-alojamiento').value = '';
    actualizarFiltrosAlojamientos();
    renderizarAlojamientos(alojamientosCache);
}

// Listar alojamientos (vista principal) - usa caché
async function listarAlojamientos() {
    const contenedor = document.getElementById('alojamientos-list');
    if (!contenedor) return;

    // Si ya están cargados, renderizar directamente sin mostrar loading
    if (alojamientosCargados) {
        renderizarAlojamientos(alojamientosCache);
        return;
    }

    contenedor.innerHTML = '<div class="alojamientos-loading"><i class="fa-solid fa-circle-notch fa-spin"></i> Cargando alojamientos...</div>';

    await cargarAlojamientos();
    actualizarFiltrosAlojamientos();

    if (alojamientosCache.length === 0) {
        contenedor.innerHTML = `
            <div class="alojamientos-empty">
                <i class="fa-solid fa-hotel"></i>
                <p>No hay alojamientos registrados. ${puedeEditar() ? 'Hacé clic en "Agregar Alojamiento".' : ''}</p>
            </div>`;
        return;
    }

    renderizarAlojamientos(alojamientosCache);
}

// Renderizar las tarjetas de alojamientos (usando DocumentFragment para mayor velocidad)
function renderizarAlojamientos(lista) {
    const contenedor = document.getElementById('alojamientos-list');
    if (!contenedor) return;

    contenedor.innerHTML = '';

    if (lista.length === 0) {
        contenedor.innerHTML = `
            <div class="alojamientos-empty">
                <i class="fa-solid fa-hotel"></i>
                <p>No hay alojamientos que coincidan con los filtros.</p>
            </div>`;
        return;
    }

    // Usar DocumentFragment para evitar múltiples reflows del DOM
    const fragment = document.createDocumentFragment();

    for (const a of lista) {
        const card = document.createElement('div');
        card.className = 'alojamiento-card';

        const fotoHtml = a.fotoUrl
            ? `<div class="alojamiento-card-img"><img src="${escapeHtml(a.fotoUrl)}" alt="${escapeHtml(a.nombre)}" onerror="this.parentElement.innerHTML='<i class=\\'fa-solid fa-hotel\\'></i>'"></div>`
            : `<div class="alojamiento-card-img"><i class="fa-solid fa-hotel"></i></div>`;

        // Construir URL de Google Maps con la dirección completa
        const direccionCompleta = [a.direccion, a.ciudad, a.provincia].filter(Boolean).join(', ');
        const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(direccionCompleta)}`;

        const accionVer = `
            <button class="action-btn" onclick="verAlojamiento(${a.id})" title="Ver detalle" style="color:var(--accent-blue);"><i class="fa-solid fa-eye"></i></button>
        `;
        const accionMaps = `
            <a href="${mapsUrl}" target="_blank" class="action-btn" title="Ver en Google Maps" style="color:var(--accent-green);"><i class="fa-solid fa-map-location-dot"></i></a>
        `;
        const accionEditar = puedeEditar() ? `
            <button class="action-btn" onclick="editarAlojamiento(${a.id})" title="Editar"><i class="fa-solid fa-pen-to-square"></i></button>
        ` : '';
        const accionEliminar = esAdmin() ? `
            <button class="action-btn delete" onclick="eliminarAlojamiento(${a.id})" title="Eliminar"><i class="fa-solid fa-trash"></i></button>
        ` : '';

        card.innerHTML = `
            ${fotoHtml}
            <div class="alojamiento-card-body">
                <div class="alojamiento-card-title">
                    <span>${escapeHtml(a.nombre)}</span>
                    ${a.capacidad ? `<span class="capacidad-badge"><i class="fa-solid fa-users"></i> ${a.capacidad}</span>` : ''}
                </div>
                <div class="alojamiento-card-meta">
                    <div class="meta-item"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(a.direccion)}</div>
                    <div class="meta-item"><i class="fa-solid fa-map-pin"></i> ${escapeHtml(a.ciudad)}${a.provincia ? ', ' + escapeHtml(a.provincia) : ''}</div>
                    ${a.telefono ? `<div class="meta-item"><i class="fa-solid fa-phone"></i> ${escapeHtml(a.telefono)}</div>` : ''}
                    ${a.email ? `<div class="meta-item"><i class="fa-solid fa-envelope"></i> ${escapeHtml(a.email)}</div>` : ''}
                    ${a.web ? `<div class="meta-item"><i class="fa-solid fa-globe"></i> <a href="${escapeHtml(a.web)}" target="_blank" style="color:var(--accent-blue);">${escapeHtml(a.web)}</a></div>` : ''}
                    ${a.cp ? `<div class="meta-item"><i class="fa-solid fa-hashtag"></i> CP: ${escapeHtml(a.cp)}</div>` : ''}
                </div>
                <div class="alojamiento-card-actions">
                    ${accionVer}
                    ${accionMaps}
                    ${accionEditar}
                    ${accionEliminar}
                </div>
            </div>
        `;
        fragment.appendChild(card);
    }

    contenedor.appendChild(fragment);
}

// Abrir modal para agregar un nuevo alojamiento
function openModalAlojamiento() {
    if (!puedeEditar()) return;
    document.getElementById('form-alojamiento').reset();
    document.getElementById('alojamiento-id').value = '';
    document.getElementById('alojamiento-modal-title').innerText = 'Agregar Alojamiento';
    document.getElementById('alojamiento-foto').value = '';
    document.getElementById('alojamiento-foto-preview').style.display = 'none';
    document.getElementById('alojamiento-foto-preview-img').src = '';
    document.getElementById('alojamiento-btn-guardar').innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Guardar Alojamiento';
    openModal('modal-alojamiento');
}

// Abrir modal para editar un alojamiento existente (usa caché en lugar de IndexedDB)
async function editarAlojamiento(id) {
    if (!puedeEditar()) return;
    // Buscar en caché primero (mucho más rápido que IndexedDB)
    let a = alojamientosCache.find(x => Number(x.id) === Number(id));
    if (!a) {
        a = await obtenerPorId('alojamientos', id);
    }
    if (!a) return;

    document.getElementById('alojamiento-id').value = a.id;
    document.getElementById('alojamiento-nombre').value = a.nombre || '';
    document.getElementById('alojamiento-direccion').value = a.direccion || '';
    document.getElementById('alojamiento-provincia').value = a.provincia || '';
    document.getElementById('alojamiento-ciudad').value = a.ciudad || '';
    document.getElementById('alojamiento-telefono').value = a.telefono || '';
    document.getElementById('alojamiento-cp').value = a.cp || '';
    document.getElementById('alojamiento-email').value = a.email || '';
    document.getElementById('alojamiento-web').value = a.web || '';
    document.getElementById('alojamiento-capacidad').value = a.capacidad || '';
    document.getElementById('alojamiento-foto').value = '';
    document.getElementById('alojamiento-foto-preview').style.display = 'none';
    document.getElementById('alojamiento-foto-preview-img').src = '';
    document.getElementById('alojamiento-modal-title').innerText = 'Editar Alojamiento';
    document.getElementById('alojamiento-btn-guardar').innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Actualizar Alojamiento';
    openModal('modal-alojamiento');
}

// Ver detalle completo de un alojamiento en un modal
async function verAlojamiento(id) {
    // Buscar en caché primero
    let a = alojamientosCache.find(x => Number(x.id) === Number(id));
    if (!a) {
        a = await obtenerPorId('alojamientos', id);
    }
    if (!a) return;

    // Crear el modal si no existe
    if (!document.getElementById('modal-ver-alojamiento')) {
        const modalHtml = `
        <div id="modal-ver-alojamiento" class="modal-overlay">
            <div class="modal modal-lg">
                <div class="modal-header">
                    <h2 class="modal-title"><i class="fa-solid fa-hotel"></i> <span id="ver-alojamiento-nombre"></span></h2>
                    <button class="modal-close" onclick="closeModal('modal-ver-alojamiento')">&times;</button>
                </div>
                <div class="modal-content" style="padding:1.5rem;">
                    <div id="ver-alojamiento-foto" style="margin-bottom:1.5rem;text-align:center;"></div>
                    <div class="form-card" style="margin-bottom:1rem;">
                        <div class="form-title"><i class="fa-solid fa-circle-info"></i> Información General</div>
                        <div id="ver-alojamiento-info" style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;padding:0.5rem 0;"></div>
                    </div>
                    <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
                        <button type="button" class="btn btn-secondary" onclick="cerrarVerAlojamiento()">Cerrar</button>
                        <button type="button" class="btn" onclick="abrirEditarDesdeVerAlojamiento()"><i class="fa-solid fa-pen-to-square"></i> Editar</button>
                    </div>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    // Rellenar datos
    document.getElementById('ver-alojamiento-nombre').textContent = a.nombre;

    const fotoCont = document.getElementById('ver-alojamiento-foto');
    fotoCont.innerHTML = a.fotoUrl
        ? `<img src="${escapeHtml(a.fotoUrl)}" alt="${escapeHtml(a.nombre)}" style="max-width:100%;max-height:300px;border-radius:12px;border:1px solid var(--border-color);object-fit:cover;" onerror="this.style.display='none'">`
        : '<div style="font-size:4rem;color:var(--text-secondary);"><i class="fa-solid fa-hotel"></i></div>';

    const direccionCompleta = [a.direccion, a.ciudad, a.provincia].filter(Boolean).join(', ');
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(direccionCompleta)}`;

    document.getElementById('ver-alojamiento-info').innerHTML = `
        <div><strong>Dirección:</strong> ${escapeHtml(a.direccion || '-')}</div>
        <div><strong>Ciudad:</strong> ${escapeHtml(a.ciudad || '-')}</div>
        <div><strong>Provincia:</strong> ${escapeHtml(a.provincia || '-')}</div>
        <div><strong>Código Postal:</strong> ${escapeHtml(a.cp || '-')}</div>
        <div><strong>Teléfono:</strong> ${escapeHtml(a.telefono || '-')}</div>
        <div><strong>Email:</strong> ${a.email ? `<a href="mailto:${escapeHtml(a.email)}" style="color:var(--accent-blue);">${escapeHtml(a.email)}</a>` : '-'}</div>
        <div><strong>Sitio Web:</strong> ${a.web ? `<a href="${escapeHtml(a.web)}" target="_blank" style="color:var(--accent-blue);">${escapeHtml(a.web)}</a>` : '-'}</div>
        <div><strong>Capacidad:</strong> ${a.capacidad ? `${a.capacidad} personas` : '-'}</div>
        <div><strong>Ubicación:</strong> <a href="${mapsUrl}" target="_blank" style="color:var(--accent-green);"><i class="fa-solid fa-map-location-dot"></i> Ver en Google Maps</a></div>
    `;

    // Guardar ID para editar desde el modal
    document.getElementById('modal-ver-alojamiento').dataset.alojamientoId = a.id;

    openModal('modal-ver-alojamiento');
}

// Cerrar modal de ver alojamiento
function cerrarVerAlojamiento() {
    closeModal('modal-ver-alojamiento');
}

// Abrir edición desde el modal de ver
function abrirEditarDesdeVerAlojamiento() {
    const modal = document.getElementById('modal-ver-alojamiento');
    if (!modal) return;
    const id = modal.dataset.alojamientoId;
    closeModal('modal-ver-alojamiento');
    if (id) {
        editarAlojamiento(Number(id));
    }
}

// Estados visuales del botón de guardado del módulo de alojamiento
function setAlojamientoBtnEstado(cargando, mensaje = '', icono = 'floppy-disk') {
    const btnGuardar = document.getElementById('alojamiento-btn-guardar');
    if (!btnGuardar) return;
    btnGuardar.disabled = cargando;
    if (cargando) {
        btnGuardar.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> ' + mensaje;
    } else {
        btnGuardar.innerHTML = '<i class="fa-solid fa-' + icono + '"></i> ' + mensaje;
    }
}
function restaurarBtnGuardarAlojamiento(id) {
    const texto = id ? 'Actualizar Alojamiento' : 'Guardar Alojamiento';
    setAlojamientoBtnEstado(false, texto, 'floppy-disk');
}

// Guardar el alojamiento (nuevo o edición) - actualiza caché sin recargar todo
// Utiliza try/catch/finally para garantizar que siempre se libere el estado de carga
// y se notifique al usuario (éxito o error) de forma asíncrona y no bloqueante.
async function guardarAlojamientoForm(e) {
    e.preventDefault();
    if (!puedeEditar()) return;

    const id = document.getElementById('alojamiento-id').value;
    const btnGuardar = document.getElementById('alojamiento-btn-guardar');
    const nombre = document.getElementById('alojamiento-nombre').value.trim();
    const direccion = document.getElementById('alojamiento-direccion').value.trim();
    const provincia = document.getElementById('alojamiento-provincia').value.trim();
    const ciudad = document.getElementById('alojamiento-ciudad').value.trim();

    if (!nombre || !direccion || !provincia || !ciudad) {
        mostrarToast('Completá todos los campos obligatorios (*).', 'error');
        return;
    }

    // --- Estado visual inmediato: bloquear el botón + spinner ---
    setAlojamientoBtnEstado(true, 'Guardando...', 'floppy-disk');

    try {
        const alojamiento = {
            nombre,
            direccion,
            provincia,
            ciudad,
            telefono: document.getElementById('alojamiento-telefono').value.trim(),
            cp: document.getElementById('alojamiento-cp').value.trim(),
            email: document.getElementById('alojamiento-email').value.trim(),
            web: document.getElementById('alojamiento-web').value.trim(),
            capacidad: document.getElementById('alojamiento-capacidad').value ? Number(document.getElementById('alojamiento-capacidad').value) : null,
            usuarioCreacion: currentUser ? currentUser.id : null,
            usuarioModificacion: currentUser ? currentUser.id : null,
            fechaCreacion: new Date().toISOString(),
            fechaModificacion: new Date().toISOString()
        };

        if (id) {
            alojamiento.id = Number(id);
            // Buscar en caché primero (mucho más rápido que IndexedDB)
            const orig = alojamientosCache.find(x => Number(x.id) === Number(id)) || await obtenerPorId('alojamientos', Number(id));
            if (orig) {
                alojamiento.usuarioCreacion = orig.usuarioCreacion;
                alojamiento.fechaCreacion = orig.fechaCreacion;
                alojamiento.fotoUrl = orig.fotoUrl || '';
            }
        }

        // --- Procesar foto si se seleccionó una nueva (CON compresión en cliente) ---
        const fotoInput = document.getElementById('alojamiento-foto');
        let fotoUrl = alojamiento.fotoUrl || '';
        if (fotoInput && fotoInput.files && fotoInput.files[0]) {
            const file = fotoInput.files[0];
            if (file.size > 5 * 1024 * 1024) {
                mostrarToast('La imagen no puede superar los 5MB.', 'error');
                return;
            }
            // Estado visual: subir foto
            setAlojamientoBtnEstado(true, 'Subiendo foto...', 'floppy-disk');
            // subirFotoAlojamiento ahora comprime internamente antes de enviar a Storage
            const fotoAnterior = alojamiento.fotoUrl || '';
            if (fotoAnterior) {
                try {
                    await eliminarFotoAlojamiento(fotoAnterior);
                } catch (errFoto) {
                    console.warn('No se pudo eliminar la foto anterior:', errFoto);
                }
            }
            fotoUrl = await subirFotoAlojamiento(file, alojamiento.id);
        }
        alojamiento.fotoUrl = fotoUrl;

        // --- Guardar en IndexedDB + sync Firebase (try/catch interno en guardar) ---
        const savedId = await guardar('alojamientos', alojamiento);
        alojamiento.id = Number(savedId);

        // Actualizar caché en memoria directamente (sin recargar desde IndexedDB)
        const idx = alojamientosCache.findIndex(x => Number(x.id) === Number(alojamiento.id));
        if (idx >= 0) {
            alojamientosCache[idx] = alojamiento;
        } else {
            alojamientosCache.push(alojamiento);
            alojamientosCache.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
        }
        alojamientosCargados = true;

        invalidarCache('alojamientos');
        closeModal('modal-alojamiento');
        mostrarToast('Alojamiento "' + nombre + '" guardado correctamente.');

        // Re-renderizar solo si la vista está activa
        const viewActiva = document.getElementById('view-alojamiento');
        if (viewActiva && viewActiva.classList.contains('active')) {
            renderizarAlojamientos(alojamientosCache);
            actualizarFiltrosAlojamientos();
        }
    } catch (err) {
        console.error('Error al guardar alojamiento:', err);
        mostrarToast('Error al guardar el alojamiento: ' + (err.message || err), 'error');
    } finally {
        // --- SIEMPRE liberar el estado del botón, incluso si falló la conexión ---
        restaurarBtnGuardarAlojamiento(id);
    }
}

// Eliminar un alojamiento (solo admin) - actualiza caché sin recargar todo
async function eliminarAlojamiento(id) {
    if (!esAdmin()) return;

    // Buscar en caché primero
    const a = alojamientosCache.find(x => Number(x.id) === Number(id)) || await obtenerPorId('alojamientos', id);
    if (!a) return;

    const confirmado = await mostrarConfirmacion(
        'Eliminar Alojamiento',
        `¿Eliminar "${a.nombre}" permanentemente?`,
        'warning'
    );
    if (!confirmado) return;

    // Eliminar foto de Firebase Storage si existe
    if (a.fotoUrl) {
        await eliminarFotoAlojamiento(a.fotoUrl);
    }

    await eliminar('alojamientos', id);

    // Actualizar caché en memoria directamente
    alojamientosCache = alojamientosCache.filter(x => Number(x.id) !== Number(id));
    invalidarCache('alojamientos');
    mostrarToast('Alojamiento eliminado correctamente.');

    // Re-renderizar solo si la vista está activa
    const viewActiva = document.getElementById('view-alojamiento');
    if (viewActiva && viewActiva.classList.contains('active')) {
        renderizarAlojamientos(alojamientosCache);
        actualizarFiltrosAlojamientos();
    }
}

// ==================== INSCIPCIONES DE KARTING ====================
// Módulo Inscripciones - Fase 1 completada
// ====================

// Estado temporal para listado/paginación
let inscripcionesCache = [];
let inscripcionesPaginaActual = 1;
const inscripcionesPorPagina = 20;

async function obtenerCompetencias() {
    try { return await getTodos('competencias'); }
    catch (e) { console.warn('[inscripciones] no se pudo leer las competencias:', e?.message || e); return []; }
}

async function obtenerCategorias() {
    try { return await getTodos('categorias'); }
    catch (e) { console.warn('[inscripciones] no se pudo leer las categorías:', e?.message || e); return []; }
}

function categoriasParaCompetencia(competenciaId, todasLasCategorias) {
    const competencia = todasLasCategorias.find(c => c.id === competenciaId);
    if (!competencia || !competencia.categoriasPermitidas) return [];
    const ids = Array.isArray(competencia.categoriasPermitidas)
        ? competencia.categoriasPermitidas.map(String)
        : [String(competencia.categoriasPermitidas)];
    return todasLasCategorias.filter(c => ids.includes(String(c.id)));
}

async function obtenerListaPilotos() {
    try {
        const pilotos = await getTodos('pilotos');
        return pilotos.map(p => ({ dni: String(p.dni || ''), nombre: `${p.nombre || ''} ${p.apellido || ''}`.trim() }));
    } catch (e) {
        console.warn('[inscripciones] no se pudo leer el padrón:', e?.message || e);
        return [];
    }
}

async function listarInscripciones() {
    const tbody = document.getElementById('inscripciones-tbody');
    if (!tbody) return;
    const competenciaSel = document.getElementById('filtro-competencia');
    const categoriaSel = document.getElementById('filtro-categoria');
    const busquedaInput = document.getElementById('buscar-inscripcion');
    const competenciaIdFiltro = competenciaSel ? competenciaSel.value : '';
    const categoriaIdFiltro = categoriaSel ? categoriaSel.value : '';
    const busqueda = busquedaInput ? busquedaInput.value.trim().toLowerCase() : '';

    let todos = [];
    try {
        todos = await getTodos('inscripciones');
        todos = todos.filter(i => i.estadoInscripcion !== 'cancelada');
    } catch (e) {
        console.warn('[inscripciones] no se pudo leer el store local:', e?.message || e);
        todos = [];
    }

    const { competencias, categorias } = await sincronizarSelectoresFormulario();
    const competenciaMap = new Map(competencias.map(c => [String(c.id), c]));
    const categoriaMap = new Map(categorias.map(c => [String(c.id), c]));

    const filtrados = todos.filter(i => {
        if (competenciaIdFiltro && i.competenciaId !== competenciaIdFiltro) return false;
        if (categoriaIdFiltro && i.categoriaId !== categoriaIdFiltro) return false;
        if (!busqueda) return true;
        const linea = `${i.pilotoDni || ''} ${i.pilotoNombre || ''} ${i.pilotoApellido || ''} ${i.numeroKart || ''} ${i.concurrente || ''}`.toLowerCase();
        return linea.includes(busqueda);
    });


function renderInscripcionPagina() {
    const tbody = document.getElementById('inscripciones-tbody');
    if (!tbody) return;
    const corte = inscripcionesCache.slice((inscripcionesPaginaActual - 1) * inscripcionesPorPagina, inscripcionesPaginaActual * inscripcionesPorPagina);

    if (corte.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-secondary);padding:2rem;">No hay inscripciones coincidentes.</td></tr>';
        document.getElementById('inscripciones-contador').textContent = '';
        return;
    }

    tbody.innerHTML = '';
    const fragment = document.createDocumentFragment();
    corte.forEach(p => {
        const piloto = p.pilotoNombre || p.pilotoApellido
            ? `${p.pilotoNombre || ''} ${p.pilotoApellido || ''}`.trim()
            : 'Piloto sin nombre';
        const competencia = 'Cargando...';
        const categoria = 'Cargando...';
        const numeroKart = p.numeroKart || '-';
        const estado = p.estadoInscripcion || 'pendiente';
        const estadoClase = estado === 'cancelada' ? 'badge badge-danger' : 'badge badge-warning';
        const dniEsc = escapeHtml(String(p.pilotoDni || ''));
        const acciones = `<td class="editor-only" style="text-align:right;white-space:nowrap;"><button type="button" class="btn btn-secondary btn-sm" onclick="editarInscripcion('${escapeHtml(p.id)}')" title="Editar inscripción"><i class="fa-solid fa-pen-to-square"></i></button> <button type="button" class="btn btn-secondary btn-sm" onclick="eliminarInscripcion('${escapeHtml(p.id)}')" title="Cancelar inscripción"><i class="fa-solid fa-trash"></i></button></td>`;
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escapeHtml(piloto)}</td><td>${dniEsc}</td><td>${escapeHtml(categoria)}</td><td>${escapeHtml(numeroKart)}</td><td>${escapeHtml(competencia)}</td><td class="text-center"><span class="${estadoClase}">${escapeHtml(estado)}</span></td>${acciones}`;
        fragment.appendChild(tr);
    });
    tbody.appendChild(fragment);
    document.getElementById('inscripciones-contador').textContent = `Mostrando ${Math.min(inscripcionesPaginaActual * inscripcionesPorPagina, inscripcionesCache.length)} de ${inscripcionesCache.length} inscripciones`;
}

function renderInscripcionPaginador(total, totalPaginas) {
    const cont = document.getElementById('inscripciones-pagination');
    if (!cont) return;
    const yaPaginado = Number.isInteger(totalPaginas) && totalPaginas > 0;
    const paginas = yaPaginado ? totalPaginas : Math.max(1, Math.ceil(total / inscripcionesPorPagina));
    cont.innerHTML = `
        <span id="inscripciones-contador" style="color:var(--text-secondary);">Mostrando ${Math.min(inscripcionesPaginaActual * inscripcionesPorPagina, inscripcionesCache.length)} de ${inscripcionesCache.length} inscripciones</span>
        <div style="display:flex;gap:0.5rem;">
            <button type="button" class="btn btn-secondary" id="inscripciones-anterior" onclick="cambiarPaginaInscripciones(-1)" ${inscripcionesPaginaActual <= 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i> Anterior</button>
            <button type="button" class="btn btn-secondary" id="inscripciones-siguiente" onclick="cambiarPaginaInscripciones(1)" ${inscripcionesPaginaActual >= paginas ? 'disabled' : ''}>Siguiente <i class="fa-solid fa-chevron-right"></i></button>
        </div>
    `;
}

function cambiarPaginaInscripciones(direccion) {
    const totalPaginas = Math.max(1, Math.ceil(inscripcionesCache.length / inscripcionesPorPagina));
    const nueva = inscripcionesPaginaActual + direccion;
    if (nueva < 1 || nueva > totalPaginas) return;
    inscripcionesPaginaActual = nueva;
    renderInscripcionPagina();
    renderInscripcionPaginador(inscripcionesCache.length, totalPaginas);
}
    const totalPaginas = Math.max(1, Math.ceil(filtrados.length / inscripcionesPorPagina));
    if (inscripcionesPaginaActual > totalPaginas) inscripcionesPaginaActual = totalPaginas;
    inscripcionesCache = filtrados;

    renderInscripcionPagina();

function openModalInscripcion() {
    if (!verificarPermiso(currentUser, 'inscripciones', 'crear')) return;
    document.getElementById('inscripcion-btn-guardar').textContent = '<i class="fa-solid fa-save"></i> Guardar';
    document.getElementById('form-inscripcion').reset();
    document.getElementById('inscripcion-dni').value = '';
    document.getElementById('inscripcion-competencia').value = '';
    document.getElementById('inscripcion-categoria').value = '';
    document.getElementById('inscripcion-numero-kart').value = '';
    document.getElementById('inscripcion-concurrente').value = '';
    document.getElementById('inscripcion-observaciones').value = '';
    document.getElementById('inscripcion-btn-guardar').textContent = '<i class="fa-solid fa-save"></i> Guardar';
    const modal = document.getElementById('modal-inscripcion');
    if (modal) {
        modal.style.display = 'block';
        poblarSelectoresInscripcion();
        poblarDatalistPilotos();
    }
}

async function poblarSelectoresInscripcion() {
    const { competencias, categorias } = await sincronizarSelectoresFormulario();
    const categoriaSel = document.getElementById('inscripcion-categoria');
    const competenciaSel = document.getElementById('inscripcion-competencia');
    if (competenciaSel) {
        competenciaSel.addEventListener('change', async () => {
            const id = competenciaSel.value;
            const filtradas = categorias.filter(c => {
                if (!id) return true;
                const competencia = competencias.find(c2 => String(c2.id) === String(id));
                if (!competencia || !competencia.categoriasPermitidas) return true;
                return String(competencia.categoriasPermitidas).includes(String(c.id));
            });
            categoriaSel.innerHTML = '<option value="">Seleccionar categoría</option>' +
                filtradas.map(c => `<option value="${escapeHtml(String(c.id))}">${escapeHtml(c.nombre || 'Sin nombre')}</option>`).join('');
        });
    }
}

async function poblarDatalistPilotos() {
    const datalist = document.getElementById('datalist-pilotos');
    if (!datalist) return;
    const pilotos = await obtenerListaPilotos();
    datalist.innerHTML = pilotos.map(p =>
        `<option value="${escapeHtml(p.dni)} - ${escapeHtml(p.nombre)}"></option>`
    ).join('');
}

function limpiarFormularioInscripcion() {
    document.getElementById('form-inscripcion').reset();

async function editarInscripcion(id) {
    if (!verificarPermiso(currentUser, 'inscripciones', 'editar')) return;
    const inscripcion = await obtenerPorId('inscripciones', id);
    if (!inscripcion) {
        mostrarToast('Inscripción no encontrada.', 'error');
        return;
    }
    document.getElementById('inscripcion-dni').value = inscripcion.pilotoDni || '';
    document.getElementById('inscripcion-numero-kart').value = inscripcion.numeroKart || '';
    document.getElementById('inscripcion-concurrente').value = inscripcion.concurrente || '';
    document.getElementById('inscripcion-observaciones').value = inscripcion.observaciones || '';
    const competenciaSel = document.getElementById('inscripcion-competencia');
    const categoriaSel = document.getElementById('inscripcion-categoria');
    if (competenciaSel) competenciaSel.value = inscripcion.competenciaId || '';
    if (categoriaSel) categoriaSel.value = inscripcion.categoriaId || '';
    const titulo = document.querySelector('.form-title');
    if (titulo) titulo.innerHTML = '<i class="fa-solid fa-id-card"></i> Editando Inscripción';
    document.getElementById('inscripcion-btn-guardar').textContent = '<i class="fa-solid fa-check"></i> Actualizar';
    const modal = document.getElementById('modal-inscripcion');
    if (modal) {
        modal.dataset.inscripcionId = id;
        modal.style.display = 'block';
        poblarSelectoresInscripcion();
        poblarDatalistPilotos();
    }
}

function nuevoFecha() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
    document.getElementById('inscripcion-dni').value = '';
    document.getElementById('inscripcion-competencia').value = '';
    document.getElementById('inscripcion-categoria').value = '';
    document.getElementById('inscripcion-numero-kart').value = '';
    document.getElementById('inscripcion-concurrente').value = '';
    document.getElementById('inscripcion-observaciones').value = '';
    document.getElementById('inscripcion-btn-guardar').textContent = '<i class="fa-solid fa-save"></i> Guardar';
    limpiarModalInscripcion();
}

function cerrarModalInscripcion() {
    const modal = document.getElementById('modal-inscripcion');

async function guardarInscripcion(e) {
    e.preventDefault();
    if (!verificarPermiso(currentUser, 'inscripciones', 'crear') && !verificarPermiso(currentUser, 'inscripciones', 'editar')) return;

    const competenciaSel = document.getElementById('inscripcion-competencia');
    const categoriaSel = document.getElementById('inscripcion-categoria');
    const dniInput = document.getElementById('inscripcion-dni');
    const numeroKartInput = document.getElementById('inscripcion-numero-kart');
    const concurrenteInput = document.getElementById('inscripcion-concurrente');
    const observacionesInput = document.getElementById('inscripcion-observaciones');

    const competenciaId = competenciaSel ? competenciaSel.value : '';
    const categoriaId = categoriaSel ? categoriaSel.value : '';
    const pilotoDni = dniInput ? dniInput.value.trim() : '';
    const numeroKart = numeroKartInput ? numeroKartInput.value.trim() : '';
    const concurrente = concurrenteInput ? concurrenteInput.value.trim() : '';
    const observaciones = observacionesInput ? observacionesInput.value.trim() : '';

    if (!competenciaId) { mostrarToast('Seleccione una competencia.', 'error'); return; }
    if (!categoriaId) { mostrarToast('Seleccione una categoría.', 'error'); return; }
    if (!pilotoDni) { mostrarToast('Ingrese el DNI del piloto.', 'error'); return; }

    const { competencias, categorias } = await sincronizarSelectoresFormulario();
    const competenciaExiste = competencias.some(c => String(c.id) === String(competenciaId));
    const categoriaExiste = categorias.some(c => String(c.id) === String(categoriaId));
    if (!competenciaExiste) { mostrarToast('La competencia seleccionada no existe.', 'error'); return; }
    if (!categoriaExiste) { mostrarToast('La categoría seleccionada no existe.', 'error'); return; }

    const pilotos = await obtenerListaPilotos();
    const pilotoExiste = pilotos.some(p => String(p.dni) === String(pilotoDni));
    if (!pilotoExiste) { mostrarToast('El DNI ingresado no pertenece a ningún piloto registrado en el padrón.', 'error'); return; }

    const modal = document.getElementById('modal-inscripcion');
    const esEdicion = modal && modal.dataset.inscripcionId;
    const id = esEdicion ? modal.dataset.inscripcionId : undefined;

    const inscripcion = {
        id,
        competenciaId,
        categoriaId,
        pilotoDni,
        numeroKart: numeroKart || null,
        concurrente,
        observaciones,
        pilotoNombre: '',
        pilotoApellido: '',
        estadoInscripcion: esEdicion ? (await obtenerPorId('inscripciones', id))?.estadoInscripcion || 'pendiente' : 'pendiente',
        fechaInscripcion: esEdicion ? (await obtenerPorId('inscripciones', id))?.fechaInscripcion || nuevoFecha() : nuevoFecha(),
        createdAt: esEdicion ? (await obtenerPorId('inscripciones', id))?.createdAt || nuevoFecha() : nuevoFecha(),
        updatedAt: nuevoFecha(),
    };

    const piloto = pilotos.find(p => String(p.dni) === String(pilotoDni));
    if (piloto) {
        inscripcion.pilotoNombre = piloto.nombre || '';
        inscripcion.pilotoApellido = piloto.apellido || '';
    }

    if (numeroKart) {
        const duplicados = inscripcionesCache.filter(i =>
            i.numeroKart &&
            String(i.numeroKart) === String(numeroKart) &&
            String(i.competenciaId) === String(competenciaId) &&
            String(i.categoriaId) === String(categoriaId) &&
            (!esEdicion || String(i.id) !== String(id))
        );
        if (duplicados.length > 0) {
            if (confirm('Este número de kart ya está asignado a otra inscripción en esta categoría. ¿Continuar?')) {
                mostrarToast('ADVERTENCIA: ' + escapeHtml(numeroKart) + ' ya está registrado en esta categoría.', 'warning');
            }
        }
    }

    try {
        const result = await guardar('inscripciones', inscripcion);
        if (!result || !result.ok) {
            mostrarToast('Error al guardar la inscripción: ' + (result.motivo || 'Error desconocido'), 'error');
            return;
        }
        mostrarToast('Inscripción guardada correctamente.', 'success');
        cerrarModalInscripcion();
        await listarInscripciones();
    } catch (err) {
        mostrarToast('Error inesperado al guardar: ' + (err?.message || err), 'error');

async function eliminarInscripcion(id) {
    if (!verificarPermiso(currentUser, 'inscripciones', 'eliminar')) return;
    const inscripcion = await obtenerPorId('inscripciones', id);
    if (!inscripcion) { mostrarToast('Inscripción no encontrada.', 'error'); return; }
    const confirmado = confirm('¿Cancelar inscripción de ' + (inscripcion.pilotoApellido || '') + ' ' + (inscripcion.pilotoNombre || '') + '? Se marcará como "cancelada".');
    if (!confirmado) return;
    await guardar('inscripciones', { ...inscripcion, estadoInscripcion: 'cancelada', updatedAt: nuevoFecha() })
        .then(() => { mostrarToast('Inscripción cancelada.', 'success'); listarInscripciones(); })
        .catch(() => mostrarToast('Error al cancelar.', 'error'));
}

if (typeof window !== 'undefined') {
    window.listarInscripciones = listarInscripciones;
    window.renderInscripcionPagina = renderInscripcionPagina;
    window.renderInscripcionPaginador = renderInscripcionPaginador;
    window.cambiarPaginaInscripciones = cambiarPaginaInscripciones;
    window.openModalInscripcion = openModalInscripcion;
    window.poblarSelectoresInscripcion = poblarSelectoresInscripcion;
    window.poblarDatalistPilotos = poblarDatalistPilotos;
    window.limpiarFormularioInscripcion = limpiarFormularioInscripcion;
    window.cerrarModalInscripcion = cerrarModalInscripcion;
    window.editarInscripcion = editarInscripcion;
    window.guardarInscripcion = guardarInscripcion;
    window.eliminarInscripcion = eliminarInscripcion;
}
// ==================== FIN INSCIPCIONES ====================
    }
}
    if (modal) modal.style.display = 'none';
}
    renderInscripcionPaginador(filtrados.length, totalPaginas);
}

async function sincronizarSelectoresFormulario() {
    const competencias = await obtenerCompetencias();
    const categorias = await obtenerCategorias();
    const competenciaSel = document.getElementById('inscripcion-competencia');
    const categoriaSel = document.getElementById('inscripcion-categoria');
    const busca = document.getElementById('buscar-inscripcion');
    if (competenciaSel) {
        competenciaSel.innerHTML = '<option value="">Seleccionar competencia</option>' +
            competencias.map(c =>
                '<option value="' + escapeHtml(String(c.id)) + '">' + escapeHtml(c.nombre || 'Sin nombre') + '</option>'
            ).join('');
    }
    if (busca) {
        busca.value = '';
        inscripcionesPaginaActual = 1;
    }
    return { competencias, categorias };
}