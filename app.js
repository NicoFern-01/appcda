// app.js - Lógica de Negocio e Interfaz de Usuario para Control de Automovilismo

// ==================== HELPER DE SEGURIDAD: ESCAPAR HTML ====================
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}

// ==================== ESTADO DE SESIÓN ====================
let currentUser = null; // El usuario logueado actualmente

// ==================== INSTANCIAS DE GRÁFICOS ====================
let chartCategoriasInstance = null;
let chartMensualInstance = null;
let chartConceptoInstance = null;

// Flag para evitar re-renderizar el dashboard si no cambiaron los datos
let dashboardDirty = true;

const views = ['dashboard', 'calendario', 'gastos', 'carga-detallada', 'staff', 'configuracion'];

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
        await inicializarDatosPorDefecto();
        // La app empieza mostrando el Login. El estado de sesión NO persiste
        // intencionalmente: cada vez que se abre la pestaña se pide el login.
    } catch (error) {
        console.error('Error al inicializar la base de datos:', error);
        alert('Error al iniciar la base de datos local. Por favor, recarga la página.');
    }
});

// ==================== AUTENTICACIÓN ====================

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

async function handleLogin(event) {
    event.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');
    const submitBtn = document.getElementById('login-submit-btn');

    errorEl.style.display = 'none';
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Verificando...';

    try {
        const usuarios = await getTodos('usuarios');
        const usuario = usuarios.find(u =>
            u.username === username &&
            u.passwordHash === hashPassword(password) &&
            u.activo === true
        );

        if (usuario) {
            currentUser = usuario;
            iniciarSesion(usuario);
        } else {
            errorEl.style.display = 'flex';
            document.getElementById('login-password').value = '';
        }
    } catch(e) {
        console.error('Error en login:', e);
        errorEl.style.display = 'flex';
    }

    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Ingresar';
}

function iniciarSesion(usuario) {
    // Ocultar login y mostrar app
    document.getElementById('login-screen').style.display = 'none';
    const appMain = document.getElementById('app-main');
    appMain.style.display = 'flex';

    // Actualizar info de usuario en sidebar
    document.getElementById('sidebar-user-name').textContent = usuario.nombre;
    document.getElementById('sidebar-avatar').textContent = usuario.nombre.charAt(0).toUpperCase();

    const rolesNombres = { admin: 'Administrador', editor: 'Editor', viewer: 'Visualizador', supervisor: 'Supervisor' };
    document.getElementById('sidebar-user-role').textContent = rolesNombres[usuario.rol] || usuario.rol;

    // Aplicar restricciones de visibilidad según el rol
    aplicarControlDeAcceso(usuario.rol);

    // Cargar la vista inicial
    switchView('dashboard');
}

function handleLogout() {
    if (confirm('¿Deseas cerrar la sesión?')) {
        currentUser = null;
        document.getElementById('app-main').style.display = 'none';
        document.getElementById('login-screen').style.display = 'flex';
        document.getElementById('form-login').reset();
        document.getElementById('login-error').style.display = 'none';
    }
}

function aplicarControlDeAcceso(rol) {
    const esViewer = rol === 'viewer';
    const esAdmin = rol === 'admin';
    const esSupervisor = rol === 'supervisor';

    // Ocultar elementos de edición para visualizadores
    document.querySelectorAll('.editor-only').forEach(el => {
        el.style.display = (esViewer || esSupervisor) ? 'none' : '';
    });

    // Ocultar panel de usuarios si no es admin
    document.querySelectorAll('.admin-only').forEach(el => {
        el.style.display = esAdmin ? '' : 'none';
    });

    // Supervisores solo ven dashboard
    document.querySelectorAll('.menu-item').forEach((item, idx) => {
        if (esSupervisor && idx !== 0) { // idx 0 es dashboard
            item.style.display = 'none';
        } else {
            item.style.display = '';
        }
    });

    // Añadir clase al body para que reglas CSS adicionales puedan aplicar
    document.body.classList.toggle('viewer-mode', esViewer);
    document.body.classList.toggle('admin-mode', esAdmin);
    document.body.classList.toggle('supervisor-mode', esSupervisor);
}

// Verifica si el usuario puede editar (editor o admin)
function puedeEditar() {
    return currentUser && (currentUser.rol === 'admin' || currentUser.rol === 'editor');
}

// Verifica si el usuario es admin
function esAdmin() {
    return currentUser && currentUser.rol === 'admin';
}

// Verifica si el usuario es supervisor (solo lectura, solo dashboard)
function esSupervisor() {
    return currentUser && currentUser.rol === 'supervisor';
}

// ==================== NAVEGACIÓN SPA ====================

function switchView(viewId) {
    document.querySelectorAll('.menu-item').forEach((item, idx) => {
        item.classList.toggle('active', views[idx] === viewId);
    });

    views.forEach(v => {
        const viewEl = document.getElementById(`view-${v}`);
        viewEl.classList.toggle('active', v === viewId);
    });

    cargarDatosVista(viewId);
}

async function cargarDatosVista(viewId) {
    switch(viewId) {
        case 'dashboard':    await renderDashboard(); break;
        case 'calendario':   await listarCompetencias(); break;
        case 'gastos':       await listarGastos(); break;
        case 'carga-detallada': await listarRendiciones(); break;
        case 'staff':        await listarStaff(); break;
        case 'configuracion':await listarConfiguraciones(); break;
    }
}

// ==================== DASHBOARD & GRÁFICOS ====================

async function renderDashboard() {
    // No re-renderizar si los datos no cambiaron
    if (!dashboardDirty) return;
    dashboardDirty = false;

    const [gastos, competencias, staff, categorias] = await Promise.all([
        getTodos('gastos'),
        getTodos('competencias'),
        getTodos('staff'),
        getTodos('categorias')
    ]);

    const totalGasto = gastos.reduce((sum, g) => sum + Number(g.monto), 0);
    document.getElementById('stat-gasto-total').innerText = formatearMoneda(totalGasto);
    document.getElementById('stat-competencias-count').innerText = competencias.length;
    document.getElementById('stat-staff-count').innerText = staff.length;

    // Gráfico 1: Gastos por Categoría
    const gastosPorCat = {};
    categorias.forEach(c => { gastosPorCat[c.nombre] = 0; });
    gastosPorCat['General / Compartido'] = 0;

    gastos.forEach(g => {
        if (g.categoriaId === 'general') {
            gastosPorCat['General / Compartido'] += Number(g.monto);
        } else {
            const cat = categorias.find(c => c.id === Number(g.categoriaId));
            if (cat) gastosPorCat[cat.nombre] = (gastosPorCat[cat.nombre] || 0) + Number(g.monto);
        }
    });

    if (chartCategoriasInstance) chartCategoriasInstance.destroy();
    chartCategoriasInstance = new Chart(document.getElementById('chart-categorias').getContext('2d'), {
        type: 'bar',
        data: {
            labels: Object.keys(gastosPorCat),
            datasets: [{
                label: 'Gastos ($)',
                data: Object.values(gastosPorCat),
                backgroundColor: ['#ff4757','#00d2d3','#2ed573','#ff9f43','#1e90ff','#a55eea','#ff6b81'],
                borderWidth: 0,
                borderRadius: 4
            }]
        },
        options: chartBarOptions()
    });

    // Gráfico 2: Evolución (Mensual o Anual según selector)
    const intervalEl = document.getElementById('dashboard-gastos-interval');
    const interval = intervalEl ? intervalEl.value : 'monthly';

    let labels = [];
    let dataPoints = [];

    if (interval === 'monthly') {
        const mesesNombres = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
        const gastosMensuales = Array(12).fill(0);
        gastos.forEach(g => {
            if (g.fecha) gastosMensuales[new Date(g.fecha).getMonth()] += Number(g.monto);
        });
        labels = mesesNombres;
        dataPoints = gastosMensuales;
    } else {
        // Agrupar por año
        const mapaAnios = {};
        gastos.forEach(g => {
            if (!g.fecha) return;
            const y = new Date(g.fecha).getFullYear();
            mapaAnios[y] = (mapaAnios[y] || 0) + Number(g.monto);
        });
        const sortedAnios = Object.keys(mapaAnios).map(Number).sort((a,b)=>a-b);
        labels = sortedAnios.map(String);
        dataPoints = sortedAnios.map(y => mapaAnios[y] || 0);
    }

    if (chartMensualInstance) chartMensualInstance.destroy();
    chartMensualInstance = new Chart(document.getElementById('chart-mensual').getContext('2d'), {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: interval === 'monthly' ? 'Gastos Mensuales' : 'Gastos Anuales',
                data: dataPoints,
                borderColor: '#00d2d3',
                backgroundColor: 'rgba(0,210,211,0.1)',
                fill: true,
                tension: 0.3,
                borderWidth: 3,
                pointRadius: 4,
                pointBackgroundColor: '#00d2d3'
            }]
        },
        options: chartLineOptions()
    });

    // Gráfico 3: Por Concepto (Donut)
    const gastosPorConcepto = {};
    gastos.forEach(g => {
        const k = g.concepto.trim();
        gastosPorConcepto[k] = (gastosPorConcepto[k] || 0) + Number(g.monto);
    });
    const top = Object.entries(gastosPorConcepto).sort((a, b) => b[1] - a[1]).slice(0, 6);

    if (chartConceptoInstance) chartConceptoInstance.destroy();
    chartConceptoInstance = new Chart(document.getElementById('chart-concepto').getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: top.length > 0 ? top.map(c => c[0]) : ['Sin Gastos'],
            datasets: [{
                data: top.length > 0 ? top.map(c => c[1]) : [0],
                backgroundColor: ['#ff4757','#00d2d3','#2ed573','#ff9f43','#a55eea','#1e90ff'],
                borderWidth: 2,
                borderColor: '#1f2a40'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right', labels: { color: '#94a3b8', font: { family: 'Outfit' } } },
                tooltip: { callbacks: { label: (ctx) => ` $${ctx.raw.toLocaleString()}` } }
            }
        }
    });
}

function chartBarOptions() {
    return {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` $${ctx.raw.toLocaleString()}` } } },
        scales: {
            y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
            x: { grid: { display: false }, ticks: { color: '#94a3b8' } }
        }
    };
}

function chartLineOptions() {
    return {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` $${ctx.raw.toLocaleString()}` } } },
        scales: {
            y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
            x: { grid: { display: false }, ticks: { color: '#94a3b8' } }
        }
    };
}

// ==================== COMPETENCIAS (CALENDARIO) ====================

async function listarCompetencias() {
    // Asegurarse que los selects y filtros estén cargados
    await actualizarSelectoresFormularios();
    const [competencias, circuitos, categorias, gastos] = await Promise.all([
        getTodos('competencias'),
        getTodos('circuitos'),
        getTodos('categorias'),
        getTodos('gastos')
    ]);
    const listContainer = document.getElementById('calendario-list');
    listContainer.innerHTML = '';

    if (competencias.length === 0) {
        listContainer.innerHTML = '<p style="color:var(--text-secondary);grid-column:1/-1;text-align:center;">No hay competencias registradas.</p>';
        return;
    }

    competencias.sort((a, b) => new Date(a.fechaInicio) - new Date(b.fechaInicio));
    // Apply filters from header (categoria / mes / año)
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
        if (filtroMes && filtroMes !== 'todos' && inicio) {
            const mes = inicio.getMonth() + 1;
            if (Number(filtroMes) !== mes) return false;
        }
        if (filtroAno && filtroAno !== 'todos' && inicio) {
            const ano = inicio.getFullYear();
            if (Number(filtroAno) !== ano) return false;
        }
        return true;
    });

    // If compact list view requested, render a simple list with title + fechas
    if (calendarioViewMode === 'list') {
        const ul = document.createElement('ul');
        ul.className = 'competition-list-compact';
        competenciasFiltradas.forEach(comp => {
            const docBtn = comp.documentosUrl ? `<a href="${comp.documentosUrl}" target="_blank" class="action-btn" title="Ver documentos (OneDrive)" style="margin-left: 10px; color: var(--accent); vertical-align: middle;"><i class="fa-solid fa-folder-open"></i></a>` : '';
            const li = document.createElement('li');
            li.className = 'competition-list-item';
            li.innerHTML = `<button class="link-like" onclick="editarCompetencia(${comp.id})">${comp.nombre}</button>${docBtn}` +
                           `<div class="meta">${formatearFechaVisual(comp.fechaInicio)} - ${formatearFechaVisual(comp.fechaFin)}</div>`;
            ul.appendChild(li);
        });
        listContainer.appendChild(ul);
        updateCalendarioToggleButton();
        return;
    }

    // default: card view (existing rendering)
    competenciasFiltradas.forEach(comp => {
        const circ = circuitos.find(c => c.id === Number(comp.circuitoId));
        const circNombre = circ ? `${circ.nombre} (${circ.ubicacion})` : 'Circuito Desconocido';
        const catNombres = comp.categoriasIds.map(id => {
            const cat = categorias.find(c => c.id === Number(id));
            return cat ? cat.nombre : '';
        }).filter(Boolean);
        const costoComp = gastos.filter(g => Number(g.competenciaId) === Number(comp.id)).reduce((s, g) => s + Number(g.monto), 0);

        const editorActions = puedeEditar() ? `
            <button class="action-btn" onclick="editarCompetencia(${comp.id})"><i class="fa-solid fa-pen-to-square"></i></button>
            <button class="action-btn delete" onclick="eliminarCompetencia(${comp.id})"><i class="fa-solid fa-trash"></i></button>
        ` : '';

        const docLink = comp.documentosUrl ? `
            <a href="${comp.documentosUrl}" target="_blank" class="action-btn" title="Ver OneDrive" style="color: var(--accent); display: inline-flex; align-items: center; gap: 6px;">
                <i class="fa-solid fa-folder-open"></i> Ver Archivos
            </a>
        ` : '';

        const card = document.createElement('div');
        card.className = 'data-card';
        card.innerHTML = `
            <div class="data-card-title">
                <span>${comp.nombre}</span>
                <span style="color:var(--accent);font-weight:700;">$${costoComp.toLocaleString(undefined,{minimumFractionDigits:2})}</span>
            </div>
            <div class="data-card-meta"><i class="fa-solid fa-map-location-dot"></i> <span>${circNombre}</span></div>
            <div class="data-card-meta"><i class="fa-solid fa-calendar-day"></i> <span>${formatearFechaVisual(comp.fechaInicio)} al ${formatearFechaVisual(comp.fechaFin)}</span></div>
            <div class="data-card-tags">${catNombres.map(n => `<span class="tag">${n}</span>`).join('')}</div>
            <div class="data-card-actions">
                ${docLink}
                ${editorActions}
            </div>
        `;
        listContainer.appendChild(card);
    });
    updateCalendarioToggleButton();
}

async function openModalCompetencia() {
    if (!puedeEditar()) return;
    await actualizarSelectoresFormularios(); // actualizar al abrir el modal
    document.getElementById('form-competencia').reset();
    document.getElementById('competencia-id').value = '';
    document.getElementById('competencia-documentos').value = '';
    document.getElementById('competencia-modal-title').innerText = 'Agregar Competencia';
    document.querySelectorAll('#competencia-categorias-checkboxes input').forEach(cb => cb.checked = false);
    document.querySelectorAll('#competencia-staff-checkboxes input').forEach(cb => cb.checked = false);
    openModal('modal-competencia');
}

async function editarCompetencia(id) {
    if (!puedeEditar()) return;
    const comp = await obtenerPorId('competencias', id);
    if (!comp) return;

    document.getElementById('competencia-id').value = comp.id;
    document.getElementById('competencia-nombre').value = comp.nombre;
    document.getElementById('competencia-circuito').value = comp.circuitoId;
    document.getElementById('competencia-inicio').value = comp.fechaInicio;
    document.getElementById('competencia-fin').value = comp.fechaFin;
    document.getElementById('competencia-documentos').value = comp.documentosUrl || '';
    document.querySelectorAll('#competencia-categorias-checkboxes input').forEach(cb => {
        cb.checked = comp.categoriasIds.includes(Number(cb.value));
    });
    document.querySelectorAll('#competencia-staff-checkboxes input').forEach(cb => {
        cb.checked = (comp.staffIds || []).includes(Number(cb.value));
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
    if (categoriasIds.length === 0) { alert('Seleccioná al menos una categoría.'); return; }

    const staffCheckboxes = document.querySelectorAll('#competencia-staff-checkboxes input:checked');
    const staffIds = Array.from(staffCheckboxes).map(cb => Number(cb.value));

    const competencia = {
        nombre: document.getElementById('competencia-nombre').value,
        circuitoId: Number(document.getElementById('competencia-circuito').value),
        fechaInicio: document.getElementById('competencia-inicio').value,
        fechaFin: document.getElementById('competencia-fin').value,
        categoriasIds,
        staffIds,
        documentosUrl: document.getElementById('competencia-documentos').value.trim()
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

// ==================== GASTOS ====================

async function listarGastos() {
    const [gastos, competencias, staff, categorias] = await Promise.all([
        getTodos('gastos'),
        getTodos('competencias'),
        getTodos('staff'),
        getTodos('categorias')
    ]);
    const catFiltro = document.getElementById('filtro-categoria-gastos').value;
    const compFiltro = document.getElementById('filtro-competencia-gastos').value;
    const buscador = document.getElementById('buscar-gastos').value.toLowerCase();
    const tbody = document.getElementById('gastos-table-body');
    tbody.innerHTML = '';

    const filtrados = gastos.filter(g => {
        if (catFiltro !== 'todos' && String(g.categoriaId) !== String(catFiltro)) return false;
        if (compFiltro !== 'todos' && String(g.competenciaId) !== String(compFiltro)) return false;
        if (buscador) {
            const c = g.concepto.toLowerCase().includes(buscador);
            const n = g.observaciones ? g.observaciones.toLowerCase().includes(buscador) : false;
            const staffName = staff.find(s => Number(s.id) === Number(g.staffId));
            const p = staffName ? `${staffName.nombre} ${staffName.apellido}`.toLowerCase().includes(buscador) : false;
            if (!c && !n && !p) return false;
        }
        return true;
    }).sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

    if (filtrados.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${puedeEditar() ? 8 : 7}" style="text-align:center;color:var(--text-secondary);">No se encontraron gastos.</td></tr>`;
        return;
    }

    filtrados.forEach(g => {
        const comp = competencias.find(c => c.id === Number(g.competenciaId));
        const compNombre = comp ? comp.nombre : 'General / Sin Carrera';
        let catNombre = 'General / Compartido';
        if (g.categoriaId !== 'general') {
            const cat = categorias.find(c => c.id === Number(g.categoriaId));
            catNombre = cat ? cat.nombre : 'Desconocida';
        }

        const acciones = puedeEditar() ? `
            <td style="text-align:right;">
                <button class="action-btn" onclick="editarGasto(${g.id})"><i class="fa-solid fa-pen-to-square"></i></button>
                <button class="action-btn delete" onclick="eliminarGasto(${g.id})"><i class="fa-solid fa-trash"></i></button>
            </td>
        ` : '';

        const staffMember = staff.find(s => Number(s.id) === Number(g.staffId));
        const staffNombre = staffMember ? `${staffMember.nombre} ${staffMember.apellido}` : '-';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${formatearFechaVisual(g.fecha)}</td>
            <td>${compNombre}</td>
            <td><span class="badge ${g.categoriaId === 'general' ? 'badge-success' : 'badge-info'}">${catNombre}</span></td>
            <td>${staffNombre}</td>
            <td style="font-weight:600;">${g.concepto}</td>
            <td style="color:var(--accent);font-weight:700;">$${Number(g.monto).toLocaleString(undefined,{minimumFractionDigits:2})}</td>
            <td style="color:var(--text-secondary);max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${g.observaciones||''}">${g.observaciones||'-'}</td>
            ${acciones}
        `;
        tbody.appendChild(tr);
    });
}

async function openModalGasto() {
    if (!puedeEditar()) return;
    await actualizarSelectoresFormularios(); // refrescar selects al abrir
    document.getElementById('form-gasto').reset();
    document.getElementById('gasto-id').value = '';
    document.getElementById('gasto-fecha').value = new Date().toISOString().split('T')[0];
    document.getElementById('gasto-modal-title').innerText = 'Cargar Gasto';
    openModal('modal-gasto');
}

async function editarGasto(id) {
    if (!puedeEditar()) return;
    const g = await obtenerPorId('gastos', id);
    if (!g) return;
    await actualizarSelectoresFormularios(); // refrescar selects al abrir
    document.getElementById('gasto-id').value = g.id;
    document.getElementById('gasto-competencia').value = g.competenciaId;
    await actualizarStaffGastoPorCompetencia();
    document.getElementById('gasto-staff').value = g.staffId || '';
    document.getElementById('gasto-categoria').value = g.categoriaId;
    document.getElementById('gasto-concepto').value = g.concepto;
    document.getElementById('gasto-monto').value = g.monto;
    document.getElementById('gasto-fecha').value = g.fecha;
    document.getElementById('gasto-notas').value = g.observaciones || '';
    document.getElementById('gasto-modal-title').innerText = 'Editar Gasto';
    openModal('modal-gasto');
}

async function guardarGastoForm(e) {
    e.preventDefault();
    if (!puedeEditar()) return;
    const id = document.getElementById('gasto-id').value;
    const gasto = {
        competenciaId: document.getElementById('gasto-competencia').value,
        staffId: document.getElementById('gasto-staff').value ? Number(document.getElementById('gasto-staff').value) : null,
        categoriaId: document.getElementById('gasto-categoria').value === 'general' ? 'general' : Number(document.getElementById('gasto-categoria').value),
        concepto: document.getElementById('gasto-concepto').value,
        monto: Number(document.getElementById('gasto-monto').value),
        fecha: document.getElementById('gasto-fecha').value,
        observaciones: document.getElementById('gasto-notas').value
    };
    if (id) gasto.id = Number(id);
    await guardar('gastos', gasto);
    dashboardDirty = true;
    closeModal('modal-gasto');
    listarGastos();
}

async function eliminarGasto(id) {
    if (!puedeEditar()) return;
    if (!confirm('¿Eliminar este registro de gasto?')) return;
    await eliminar('gastos', id);
    dashboardDirty = true;
    listarGastos();
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
               (s.numeroRegistroGrado || '').toLowerCase().includes(buscador) ||
               (s.equipos || '').toLowerCase().includes(buscador) ||
               compMatches;
    });

    if (filtrado.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${puedeEditar() ? 8 : 7}" style="text-align:center;color:var(--text-secondary);">No hay personal registrado.</td></tr>`;
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
            <td style="font-weight:600;">${s.nombre} ${s.apellido}</td>
            <td>${s.dni}</td>
            <td><span class="badge badge-info">${s.funcion}</span></td>
            <td>${s.matricula || '-'}</td>
            <td>${s.mail || '-'}</td>
            <td>${s.numeroRegistroGrado || '-'}</td>
            <td>${s.equipos || '-'}</td>
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
    document.getElementById('staff-numero-registro-grado').value = '';
    document.getElementById('staff-equipos').value = '';
    document.getElementById('staff-modal-title').innerText = 'Agregar Staff';
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
    document.getElementById('staff-numero-registro-grado').value = s.numeroRegistroGrado || '';
    document.getElementById('staff-equipos').value = s.equipos || '';
    document.getElementById('staff-modal-title').innerText = 'Editar Staff';
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
        numeroRegistroGrado: document.getElementById('staff-numero-registro-grado').value,
        equipos: document.getElementById('staff-equipos').value
    };
    if (id) s.id = Number(id);
    const savedStaffId = await guardar('staff', s);
    s.id = Number(savedStaffId);
    closeModal('modal-staff');
    listarStaff();
}

async function eliminarStaff(id) {
    if (!puedeEditar()) return;
    if (!confirm('¿Eliminar este miembro del personal?')) return;
    await eliminar('staff', id);
    await quitarStaffDeCompetencias(id);
    listarStaff();
}

async function aplicarAsignacionesStaff(staffItem) {
    const competencias = await getTodos('competencias');
    for (const comp of competencias) {
        const existeEnCompetencia = (comp.staffIds || []).includes(Number(staffItem.id));
        const debeEstar = (staffItem.competenciasIds || []).includes(Number(comp.id));
        if (debeEstar && !existeEnCompetencia) {
            comp.staffIds = Array.from(new Set([...(comp.staffIds || []), Number(staffItem.id)]));
            await guardar('competencias', comp);
        } else if (!debeEstar && existeEnCompetencia) {
            comp.staffIds = (comp.staffIds || []).filter(sid => Number(sid) !== Number(staffItem.id));
            await guardar('competencias', comp);
        }
    }
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

// ==================== CONFIGURACIÓN: CATEGORÍAS & CIRCUITOS ====================

async function listarConfiguraciones() {
    // Categorías
    const categorias = await getTodos('categorias');
    const catBody = document.getElementById('config-categorias-body');
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
                <td style="font-weight:600;">${c.nombre}</td>
                <td style="color:var(--text-secondary);max-width:200px;text-overflow:ellipsis;overflow:hidden;white-space:nowrap;">${c.descripcion}</td>
                ${acciones}
            </tr>`;
    });

    // Circuitos
    const circuitos = await getTodos('circuitos');
    const circBody = document.getElementById('config-circuitos-body');
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
                <td style="font-weight:600;">${c.nombre}</td>
                <td>${c.ubicacion}</td>
                ${acciones}
            </tr>`;
    });

    // Actualizar el estado de la UI de Firebase
    actualizarEstadoFirebaseUI();

    // Usuarios (solo admin)
    if (esAdmin()) {
        await listarUsuarios();
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
    const cat = { nombre: document.getElementById('categoria-nombre').value, descripcion: document.getElementById('categoria-descripcion').value };
    if (id) cat.id = Number(id);
    await guardar('categorias', cat);
    closeModal('modal-categoria');
    listarConfiguraciones();
}

async function eliminarCategoria(id) {
    if (!puedeEditar()) return;
    if (!confirm('¿Eliminar esta categoría?')) return;
    await eliminar('categorias', id);
    listarConfiguraciones();
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
    listarConfiguraciones();
}

async function eliminarCircuito(id) {
    if (!puedeEditar()) return;
    if (!confirm('¿Eliminar este autódromo?')) return;
    await eliminar('circuitos', id);
    listarConfiguraciones();
}

// ==================== GESTIÓN DE USUARIOS (SOLO ADMIN) ====================

async function listarUsuarios() {
    if (!esAdmin()) return;
    const usuarios = await getTodos('usuarios');
    const tbody = document.getElementById('config-usuarios-body');
    tbody.innerHTML = '';

    const rolesNombres = { admin: 'Administrador', editor: 'Editor', viewer: 'Visualizador', supervisor: 'Supervisor' };
    const rolesBadge = { admin: 'badge-role-admin', editor: 'badge-role-editor', viewer: 'badge-role-viewer', supervisor: 'badge-role-supervisor' };

    usuarios.forEach(u => {
        const esElMismo = currentUser && currentUser.id === u.id;
        tbody.innerHTML += `
            <tr>
                <td style="font-weight:600;">
                    ${u.username}
                    ${esElMismo ? '<span class="badge badge-info" style="font-size:0.7rem;margin-left:0.5rem;">Yo</span>' : ''}
                </td>
                <td>${u.nombre}</td>
                <td><span class="badge ${rolesBadge[u.rol]}">${rolesNombres[u.rol] || u.rol}</span></td>
                <td><span class="badge ${u.activo ? 'badge-active' : 'badge-inactive'}">${u.activo ? 'Activo' : 'Inactivo'}</span></td>
                <td style="text-align:right;">
                    <button class="action-btn" onclick="editarUsuario(${u.id})"><i class="fa-solid fa-pen-to-square"></i></button>
                    ${!esElMismo ? `<button class="action-btn delete" onclick="eliminarUsuario(${u.id})"><i class="fa-solid fa-trash"></i></button>` : ''}
                </td>
            </tr>
        `;
    });
}

function openModalUsuario() {
    if (!esAdmin()) return;
    document.getElementById('form-usuario').reset();
    document.getElementById('usuario-id').value = '';
    document.getElementById('usuario-modal-title').innerText = 'Nuevo Usuario';
    document.getElementById('usuario-password').required = true;
    document.getElementById('password-hint').style.display = 'none';
    openModal('modal-usuario');
}

async function editarUsuario(id) {
    if (!esAdmin()) return;
    const u = await obtenerPorId('usuarios', id);
    if (!u) return;
    document.getElementById('usuario-id').value = u.id;
    document.getElementById('usuario-nombre').value = u.nombre;
    document.getElementById('usuario-username').value = u.username;
    document.getElementById('usuario-rol').value = u.rol;
    document.getElementById('usuario-activo').value = String(u.activo);
    document.getElementById('usuario-password').value = '';
    document.getElementById('usuario-password').required = false;
    document.getElementById('password-hint').style.display = 'block';
    document.getElementById('usuario-modal-title').innerText = 'Editar Usuario';
    openModal('modal-usuario');
}

async function guardarUsuarioForm(e) {
    e.preventDefault();
    if (!esAdmin()) return;
    const id = document.getElementById('usuario-id').value;
    const username = document.getElementById('usuario-username').value.trim();
    const nombre = document.getElementById('usuario-nombre').value.trim();
    const rol = document.getElementById('usuario-rol').value;
    const activo = document.getElementById('usuario-activo').value === 'true';
    const password = document.getElementById('usuario-password').value;

    // Validar que el username no esté duplicado (en modo creación)
    if (!id) {
        const todos = await getTodos('usuarios');
        if (todos.find(u => u.username === username)) {
            alert('Ya existe un usuario con ese nombre de usuario. Elegí uno diferente.');
            return;
        }
    }

    const usuario = { username, nombre, rol, activo };
    if (id) {
        usuario.id = Number(id);
        // Mantener el hash anterior si no se cambió la contraseña
        if (password) {
            usuario.passwordHash = hashPassword(password);
        } else {
            const existente = await obtenerPorId('usuarios', Number(id));
            usuario.passwordHash = existente.passwordHash;
        }
    } else {
        if (!password) { alert('La contraseña es obligatoria para nuevos usuarios.'); return; }
        usuario.passwordHash = hashPassword(password);
    }

    await guardar('usuarios', usuario);

    // Si el admin editó su propio perfil, actualizar la UI del sidebar
    if (currentUser && currentUser.id === usuario.id) {
        currentUser = { ...currentUser, ...usuario };
        document.getElementById('sidebar-user-name').textContent = usuario.nombre;
        document.getElementById('sidebar-avatar').textContent = usuario.nombre.charAt(0).toUpperCase();
    }

    closeModal('modal-usuario');
    await listarUsuarios();
}

async function eliminarUsuario(id) {
    if (!esAdmin()) return;
    if (currentUser && currentUser.id === id) { alert('No podés eliminar tu propio usuario.'); return; }
    const usuarios = await getTodos('usuarios');
    if (usuarios.length <= 1) { alert('Debe existir al menos un usuario en el sistema.'); return; }
    if (!confirm('¿Eliminar este usuario permanentemente?')) return;
    await eliminar('usuarios', id);
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
        gastos: await getTodos('gastos')
        // No se exportan usuarios por seguridad (cada instalación maneja los suyos)
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
    const categorias = await getTodos('categorias');
    const circuitos = await getTodos('circuitos');
    const competencias = await getTodos('competencias');
    const staff = await getTodos('staff');

    // Select de circuito en modal competencia
    const selectCircuito = document.getElementById('competencia-circuito');
    const savedCirc = selectCircuito.value;
    selectCircuito.innerHTML = '<option value="">Seleccione un autódromo...</option>';
    circuitos.forEach(c => selectCircuito.innerHTML += `<option value="${c.id}">${c.nombre} (${c.ubicacion})</option>`);
    selectCircuito.value = savedCirc;

    // Checkboxes de categorías en modal competencia
    const checkContainer = document.getElementById('competencia-categorias-checkboxes');
    const checkedIds = Array.from(checkContainer.querySelectorAll('input:checked')).map(cb => cb.value);
    checkContainer.innerHTML = '';
    categorias.forEach(cat => {
        checkContainer.innerHTML += `
            <label class="checkbox-label">
                <input type="checkbox" value="${cat.id}" ${checkedIds.includes(String(cat.id)) ? 'checked' : ''}>
                <span>${cat.nombre}</span>
            </label>`;
    });

    // Checkboxes de staff en modal competencia
    const staffContainer = document.getElementById('competencia-staff-checkboxes');
    if (staffContainer) {
        const checkedStaffIds = Array.from(staffContainer.querySelectorAll('input:checked')).map(cb => cb.value);
        staffContainer.innerHTML = '';
        if (staff.length === 0) {
            staffContainer.innerHTML = '<p style="color:var(--text-secondary); margin:0;">No hay personal registrado. Agrega personal primero.</p>';
        } else {
            staff.forEach(persona => {
                staffContainer.innerHTML += `
                    <label class="checkbox-label">
                        <input type="checkbox" value="${persona.id}" ${checkedStaffIds.includes(String(persona.id)) ? 'checked' : ''}>
                        <span>${persona.nombre} ${persona.apellido} (${persona.funcion})</span>
                    </label>`;
            });
        }
    }

    // Select de competencia en modal gasto
    const selectGastoComp = document.getElementById('gasto-competencia');
    const savedComp = selectGastoComp.value;
    selectGastoComp.innerHTML = '<option value="">Seleccione la carrera...</option>';
    competencias.forEach(c => selectGastoComp.innerHTML += `<option value="${c.id}">${c.nombre}</option>`);
    selectGastoComp.value = savedComp;

    // Select de categoría en modal gasto
    const selectGastoCat = document.getElementById('gasto-categoria');
    const savedCat = selectGastoCat.value;
    selectGastoCat.innerHTML = '<option value="">Seleccione categoría...</option><option value="general">Gasto General / Compartido</option>';
    categorias.forEach(cat => selectGastoCat.innerHTML += `<option value="${cat.id}">${cat.nombre}</option>`);
    selectGastoCat.value = savedCat;

    // Select de staff en modal gasto
    const selectGastoStaff = document.getElementById('gasto-staff');
    const savedStaff = selectGastoStaff ? selectGastoStaff.value : '';
    await actualizarStaffGastoPorCompetencia();
    if (selectGastoStaff) selectGastoStaff.value = savedStaff;

    // Datalist de conceptos sugeridos
    const datalistConceptos = document.getElementById('conceptos-sugeridos');
    const conceptos = await getTodos('conceptos');
    datalistConceptos.innerHTML = '';
    conceptos.forEach(conc => datalistConceptos.innerHTML += `<option value="${conc.nombre}"></option>`);

    // Filtros en pantalla de Gastos
    const filterCat = document.getElementById('filtro-categoria-gastos');
    const savedFilterCat = filterCat.value;
    filterCat.innerHTML = '<option value="todos">Todas las categorías</option><option value="general">Gasto General / Compartido</option>';
    categorias.forEach(cat => filterCat.innerHTML += `<option value="${cat.id}">${cat.nombre}</option>`);
    filterCat.value = savedFilterCat;

    const filterComp = document.getElementById('filtro-competencia-gastos');
    const savedFilterComp = filterComp.value;
    filterComp.innerHTML = '<option value="todos">Todas las competencias</option>';
    competencias.forEach(c => filterComp.innerHTML += `<option value="${c.id}">${c.nombre}</option>`);
    filterComp.value = savedFilterComp;

    // Calendario: filtro de categoría, mes y año
    const filtroCatCal = document.getElementById('calendario-filtro-categoria');
    if (filtroCatCal) {
        const saved = filtroCatCal.value;
        filtroCatCal.innerHTML = '<option value="todos">Todas</option>';
        categorias.forEach(cat => filtroCatCal.innerHTML += `<option value="${cat.id}">${cat.nombre}</option>`);
        filtroCatCal.value = saved || 'todos';
    }

    const filtroMesCal = document.getElementById('calendario-filtro-mes');
    if (filtroMesCal) {
        const savedM = filtroMesCal.value;
        const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
        filtroMesCal.innerHTML = '<option value="todos">Todos</option>';
        meses.forEach((m, idx) => filtroMesCal.innerHTML += `<option value="${idx+1}">${m}</option>`);
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
        anosArr.forEach(y => filtroAnoCal.innerHTML += `<option value="${y}">${y}</option>`);
        filtroAnoCal.value = savedY || 'todos';
    }

}

async function actualizarStaffGastoPorCompetencia() {
    const competencias = await getTodos('competencias');
    const staff = await getTodos('staff');
    const selectGastoComp = document.getElementById('gasto-competencia');
    const selectGastoStaff = document.getElementById('gasto-staff');
    if (!selectGastoStaff) return;

    const selectedCompId = Number(selectGastoComp.value);
    selectGastoStaff.innerHTML = '<option value="">Sin personal asignado</option>';

    if (!selectedCompId) {
        selectGastoStaff.innerHTML = '<option value="">Seleccioná primero una competencia</option>';
        return;
    }

    const competencia = competencias.find(c => c.id === selectedCompId);
    if (!competencia || !competencia.staffIds || competencia.staffIds.length === 0) {
        selectGastoStaff.innerHTML = '<option value="">No hay personal asignado a esta competencia</option>';
        return;
    }

    const selectedStaffIds = new Set(competencia.staffIds.map(id => Number(id)));
    const assignedStaff = staff.filter(s => selectedStaffIds.has(Number(s.id)));
    if (assignedStaff.length === 0) {
        selectGastoStaff.innerHTML = '<option value="">No hay personal asignado a esta competencia</option>';
        return;
    }

    selectGastoStaff.innerHTML = '<option value="">Sin personal asignado</option>';
    assignedStaff.forEach(persona => {
        selectGastoStaff.innerHTML += `<option value="${persona.id}">${persona.nombre} ${persona.apellido} (${persona.funcion})</option>`;
    });
}

// Gestión de Modales
function openModal(modalId) { document.getElementById(modalId).classList.add('active'); }
function closeModal(modalId) { document.getElementById(modalId).classList.remove('active'); }

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
    
    // Actualizar el select de categoría y recargar la lista
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
    
    // Cambiar gastos de esta categoría a "general"
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

    // Reasignar gastos que usen este concepto a 'Otros' (se crea si no existe)
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

    // No permitir eliminar el concepto 'Otros'
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
        // Validar que sea un JSON válido con los campos necesarios
        const config = JSON.parse(configText);
        if (!config.apiKey || !config.projectId) {
            statusEl.innerHTML = '<span style="color: #ff6b6b;">⚠️ El JSON debe contener al menos "apiKey" y "projectId".</span>';
            return;
        }

        localStorage.setItem('firebase_config', JSON.stringify(config));
        statusEl.innerHTML = '<span style="color: #2ed573;">⌛ Conectando con Firebase...</span>';

        // Recargar la página para que db.js inicialice Firebase con la nueva config
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

        const stores = ['categorias', 'circuitos', 'staff', 'competencias', 'gastos', 'conceptos', 'usuarios'];
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
        statusEl.innerHTML = `<span style="color: #ff6b6b;">❌ Error durante la migración: ${e.message || e}</span>`;
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

// Actualizar el estado de la UI de Firebase al cargar la vista de configuración
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
            // Mostrar la config actual en el textarea
            configTextarea.value = JSON.stringify(config, null, 2);

            if (useFirebase) {
                // Mostrar estado de sincronización
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
// Esta función crea/edita/elimina un registro temporal en 'categorias'
// y registra el estado de la caché `_cache` para verificar actualizaciones inmediatas.
async function ejecutarPruebaCache() {
    try {
        console.group('DB Cache SelfTest');
        console.log('Inicializando DB por defecto...');
        await inicializarDatosPorDefecto();

        console.log('Conteo inicial categorias:', (await getTodos('categorias')).length);

        // Crear categoría temporal
        const temp = { nombre: 'ZZZ_AUTOTEST_TEMP' };
        const savedId = await guardar('categorias', temp);
        console.log('Guardado ID:', savedId);
        console.log('Cache categorias (últimos 5):', (_cache['categorias'] || []).slice(-5));

        // Actualizar
        temp.id = Number(savedId);
        temp.nombre = 'ZZZ_AUTOTEST_UPDATED';
        await guardar('categorias', temp);
        console.log('Después de actualizar (buscar en cache):', (_cache['categorias'] || []).find(c => Number(c.id) === Number(savedId)));

        // Eliminar
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

// Ejecutar la prueba ahora solo si está habilitada en localStorage
// Para habilitar temporalmente: `localStorage.setItem('runDbSelfTest','1')`
if (localStorage.getItem('runDbSelfTest') === '1') {
    ejecutarPruebaCache();
}

// ====================================================================
// MÓDULO: CARGA DETALLADA
// ====================================================================

// ==================== ESTADO DEL EDITOR ====================
let rendicionActual = null;           // Objeto rendición que se está editando
let detallesActuales = [];            // Array de detalleGastos de la rendición actual
let detallesModificados = false;      // Flag para cambios sin guardar
let adjuntosTemporales = {};          // Adjuntos pendientes por fila (key = filaIndex)

// ==================== TOAST SYSTEM ====================
function mostrarToast(mensaje, tipo = 'success') {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast toast-${tipo}`;
    toast.innerHTML = `<i class="fa-solid ${tipo === 'success' ? 'fa-check-circle' : tipo === 'error' ? 'fa-times-circle' : 'fa-triangle-exclamation'}"></i> ${mensaje}`;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(() => toast.remove(), 300); }, 3000);
}

// ==================== LISTADO DE RENDICIONES ====================
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
            const respMatch = resp ? `${resp.nombre} ${resp.apellido}`.toLowerCase().includes(buscador) : false;
            if (!compMatch && !respMatch && !(r.observaciones || '').toLowerCase().includes(buscador)) return false;
        }
        return true;
    }).sort((a, b) => new Date(b.fecha || b.fechaCreacion) - new Date(a.fecha || a.fechaCreacion));

    const tbody = document.getElementById('rendiciones-table-body');
    tbody.innerHTML = '';

    if (filtradas.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;color:var(--text-secondary);">No hay rendiciones registradas. Hacé clic en "Nueva Rendición" para comenzar.</td></tr>`;
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

        const acciones = puedeEditar() ? `
            <td style="text-align:right;white-space:nowrap;">
                <button class="action-btn" onclick="editarRendicion(${r.id})" title="Editar"><i class="fa-solid fa-pen-to-square"></i></button>
                <button class="action-btn" onclick="duplicarRendicionId(${r.id})" title="Duplicar"><i class="fa-solid fa-copy"></i></button>
                <button class="action-btn delete" onclick="eliminarRendicion(${r.id})" title="Eliminar"><i class="fa-solid fa-trash"></i></button>
            </td>
        ` : '';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-weight:600;">${r.id}</td>
            <td>${comp ? comp.nombre : '-'}</td>
            <td>${camp ? camp.nombre : '-'}</td>
            <td>${circ ? circ.nombre : '-'}</td>
            <td>${formatearFechaVisual(r.fecha)}</td>
            <td>${resp ? `${resp.nombre} ${resp.apellido}` : '-'}</td>
            <td style="text-align:center;">${cantGastos}</td>
            <td style="color:var(--accent);font-weight:700;">${formatearMoneda(totalGastos)}</td>
            <td><span class="badge ${estadoBadge}">${estadoText}</span></td>
            ${acciones}
        `;
        tbody.appendChild(tr);
    });
}

// ==================== NUEVA RENDICIÓN ====================
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
    adjuntosTemporales = {};

    llenarFormularioRendicion(rendicionActual);
    document.getElementById('rendiciones-list-container').style.display = 'none';
    document.getElementById('rendicion-editor').style.display = 'block';
    document.getElementById('rendicion-estado-badge').textContent = 'Nueva - Borrador';
    document.getElementById('rendicion-estado-badge').className = 'badge badge-warning';
    document.getElementById('cambios-sin-guardar').style.display = 'none';
    renderizarDetalleGastos();
    recalcularTodosLosTotales();
}

// ==================== CARGAR SELECTORES DE RENDICIÓN ====================
async function cargarSelectoresRendicion() {
    const [competencias, circuitos, staff, campeonatos, conceptos, proveedores] = await Promise.all([
        getTodos('competencias'),
        getTodos('circuitos'),
        getTodos('staff'),
        getTodos('campeonatos'),
        getTodos('conceptos'),
        getTodos('proveedores')
    ]);

    // Competencia
    const selComp = document.getElementById('rendicion-competencia');
    const savedComp = selComp.value;
    selComp.innerHTML = '<option value="">Seleccione competencia...</option>';
    competencias.forEach(c => selComp.innerHTML += `<option value="${c.id}">${c.nombre}</option>`);
    selComp.value = savedComp;

    // Autódromo
    const selAuto = document.getElementById('rendicion-autodromo');
    const savedAuto = selAuto.value;
    selAuto.innerHTML = '<option value="">Seleccione autódromo...</option>';
    circuitos.forEach(c => selAuto.innerHTML += `<option value="${c.id}">${c.nombre}</option>`);
    selAuto.value = savedAuto;

    // Campeonato
    const selCamp = document.getElementById('rendicion-campeonato');
    const savedCamp = selCamp.value;
    selCamp.innerHTML = '<option value="">Sin campeonato</option>';
    campeonatos.forEach(c => selCamp.innerHTML += `<option value="${c.id}">${c.nombre}</option>`);
    selCamp.value = savedCamp;

    // Responsable (staff)
    const selResp = document.getElementById('rendicion-responsable');
    const savedResp = selResp.value;
    selResp.innerHTML = '<option value="">Seleccione responsable...</option>';
    staff.forEach(s => selResp.innerHTML += `<option value="${s.id}">${s.nombre} ${s.apellido}</option>`);
    selResp.value = savedResp;

    // Selector de conceptos (para el modal de detalle)
    const selConc = document.getElementById('detalle-concepto');
    if (selConc) {
        const savedConc = selConc.value;
        selConc.innerHTML = '<option value="">Seleccione concepto...</option>';
        conceptos.forEach(c => selConc.innerHTML += `<option value="${c.id}">${c.nombre}</option>`);
        selConc.value = savedConc;
    }

    // Selector de proveedores (para el modal de detalle)
    const selProv = document.getElementById('detalle-proveedor');
    if (selProv) {
        const savedProv = selProv.value;
        selProv.innerHTML = '<option value="">Seleccione proveedor...</option>';
        proveedores.forEach(p => selProv.innerHTML += `<option value="${p.id}">${p.nombre}</option>`);
        selProv.value = savedProv;
    }
}

// ==================== LLENAR FORMULARIO DE RENDICIÓN ====================
async function llenarFormularioRendicion(r) {
    document.getElementById('rendicion-id').value = r.id || '';
    document.getElementById('rendicion-competencia').value = r.competenciaId || '';
    document.getElementById('rendicion-campeonato').value = r.campeonatoId || '';
    document.getElementById('rendicion-autodromo').value = r.autodromoId || '';
    document.getElementById('rendicion-fecha').value = r.fecha || '';
    document.getElementById('rendicion-responsable').value = r.responsableId || '';
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

// ==================== OBTENER DATOS DEL FORMULARIO ====================
function obtenerDatosFormularioRendicion() {
    return {
        id: document.getElementById('rendicion-id').value ? Number(document.getElementById('rendicion-id').value) : null,
        competenciaId: document.getElementById('rendicion-competencia').value,
        campeonatoId: document.getElementById('rendicion-campeonato').value || null,
        autodromoId: document.getElementById('rendicion-autodromo').value,
        responsableId: document.getElementById('rendicion-responsable').value,
        fecha: document.getElementById('rendicion-fecha').value,
        observaciones: document.getElementById('rendicion-observaciones').value,
        estado: 'completo'
    };
}

// ==================== VALIDAR RENDICIÓN ====================
function validarRendicion() {
    const datos = obtenerDatosFormularioRendicion();
    if (!datos.competenciaId) { mostrarToast('Debe seleccionar una competencia.', 'error'); return false; }
    if (!datos.autodromoId) { mostrarToast('Debe seleccionar un autódromo.', 'error'); return false; }
    if (!datos.fecha) { mostrarToast('Debe ingresar una fecha.', 'error'); return false; }
    if (!datos.responsableId) { mostrarToast('Debe seleccionar un responsable.', 'error'); return false; }
    if (detallesActuales.length === 0) { mostrarToast('Debe agregar al menos un gasto.', 'error'); return false; }

    // Validar cada detalle
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

// ==================== GUARDAR RENDICIÓN ====================
async function guardarRendicion() {
    if (!puedeEditar()) return;
    if (!validarRendicion()) return;
    await ejecutarGuardadoRendicion('completo');
}

async function guardarRendicionBorrador() {
    if (!puedeEditar()) return;
    await ejecutarGuardadoRendicion('borrador');
}

async function ejecutarGuardadoRendicion(estado) {
    try {
        const datos = obtenerDatosFormularioRendicion();
        const ahora = new Date().toISOString();

        // Si es nuevo, establecer fechas de creación
        if (!datos.id) {
            datos.fechaCreacion = ahora;
            datos.usuarioCreacion = currentUser ? currentUser.id : null;
        } else {
            // Preservar fechas de creación originales
            const orig = await obtenerPorId('rendiciones', datos.id);
            if (orig) {
                datos.fechaCreacion = orig.fechaCreacion;
                datos.usuarioCreacion = orig.usuarioCreacion;
            }
        }
        datos.fechaModificacion = ahora;
        datos.usuarioModificacion = currentUser ? currentUser.id : null;
        datos.estado = estado;

        // Guardar rendición
        const savedId = await guardar('rendiciones', datos);
        datos.id = Number(savedId);
        rendicionActual = datos;
        document.getElementById('rendicion-id').value = datos.id;

        // Guardar todos los detalles
        for (let i = 0; i < detallesActuales.length; i++) {
            const detalle = detallesActuales[i];
            detalle.rendicionId = datos.id;
            detalle.orden = i + 1;
            // Calcular total
            detalle.total = Number(detalle.basico || 0) + Number(detalle.iva || 0) +
                Number(detalle.impuestosInternos || 0) + Number(detalle.percepcionIIBB || 0) +
                Number(detalle.percepcionIVA || 0) + Number(detalle.otrosImpuestos || 0);

            const detalleId = await guardar('detalleGastos', detalle);
            detalle.id = Number(detalleId);

            // Guardar adjuntos asociados a este detalle
            const adjuntosFila = adjuntosTemporales[i] || [];
            for (const adj of adjuntosFila) {
                adj.detalleGastoId = detalle.id;
                adj.usuarioCarga = currentUser ? currentUser.id : null;
                adj.fechaCarga = ahora;
                await guardar('adjuntos', adj);
            }
        }

        // Limpiar adjuntos temporales guardados
        adjuntosTemporales = {};

        detallesModificados = false;
        document.getElementById('cambios-sin-guardar').style.display = 'none';

        // Actualizar badge de estado
        const badge = document.getElementById('rendicion-estado-badge');
        badge.textContent = estado === 'completo' ? 'Completo' : 'Borrador';
        badge.className = `badge ${estado === 'completo' ? 'badge-success' : 'badge-warning'}`;

        // Actualizar info de auditoría
        document.getElementById('rendicion-usuario-creacion').textContent = currentUser ? currentUser.nombre : '-';
        document.getElementById('rendicion-fecha-modificacion').textContent = new Date(ahora).toLocaleString();

        invalidarCache('detalleGastos');
        invalidarCache('adjuntos');
        dashboardDirty = true;

        mostrarToast(`Rendición #${datos.id} guardada como "${estado}".`);
    } catch (e) {
        console.error('Error al guardar rendición:', e);
        mostrarToast('Error al guardar la rendición.', 'error');
    }
}

// ==================== EDITAR RENDICIÓN ====================
async function editarRendicion(id) {
    if (!puedeEditar()) return;
    await cargarSelectoresRendicion();

    const rendicion = await obtenerPorId('rendiciones', id);
    if (!rendicion) { mostrarToast('Rendición no encontrada.', 'error'); return; }

    const detalles = await getTodos('detalleGastos');
    detallesActuales = detalles.filter(d => Number(d.rendicionId) === Number(id)).sort((a, b) => (a.orden || 0) - (b.orden || 0));

    // Cargar adjuntos
    const todosAdjuntos = await getTodos('adjuntos');
    adjuntosTemporales = {};
    for (let i = 0; i < detallesActuales.length; i++) {
        const detId = detallesActuales[i].id;
        adjuntosTemporales[i] = todosAdjuntos.filter(a => Number(a.detalleGastoId) === Number(detId));
    }

    rendicionActual = rendicion;
    detallesModificados = false;

    llenarFormularioRendicion(rendicion);
    document.getElementById('rendiciones-list-container').style.display = 'none';
    document.getElementById('rendicion-editor').style.display = 'block';

    const badge = document.getElementById('rendicion-estado-badge');
    badge.textContent = rendicion.estado === 'completo' ? 'Completo' : 'Borrador';
    badge.className = `badge ${rendicion.estado === 'completo' ? 'badge-success' : 'badge-warning'}`;

    document.getElementById('cambios-sin-guardar').style.display = 'none';
    renderizarDetalleGastos();
    recalcularTodosLosTotales();
}

// ==================== CANCELAR EDICIÓN ====================
function cancelarEdicionRendicion() {
    if (detallesModificados) {
        if (!confirm('Hay cambios sin guardar. ¿Estás seguro de que deseas salir?')) return;
    }
    detallesActuales = [];
    adjuntosTemporales = {};
    detallesModificados = false;
    rendicionActual = null;
    document.getElementById('rendiciones-list-container').style.display = 'block';
    document.getElementById('rendicion-editor').style.display = 'none';
    listarRendiciones();
}

// ==================== ELIMINAR RENDICIÓN ====================
async function eliminarRendicion(id) {
    if (!puedeEditar()) return;
    if (!confirm('¿Eliminar esta rendición y todos sus gastos asociados? Esta acción no se puede deshacer.')) return;

    try {
        const detalles = await getTodos('detalleGastos');
        const adjuntos = await getTodos('adjuntos');

        // Eliminar adjuntos de los detalles de esta rendición
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

// ==================== DUPLICAR RENDICIÓN ====================
async function duplicarRendicionId(id) {
    if (!puedeEditar()) return;
    try {
        const orig = await obtenerPorId('rendiciones', id);
        if (!orig) return;

        const detalles = await getTodos('detalleGastos');
        const detallesOrig = detalles.filter(d => Number(d.rendicionId) === Number(id));

        // Crear nueva rendición
        const nueva = { ...orig };
        delete nueva.id;
        nueva.observaciones = (orig.observaciones || '') + ' (Copia)';
        nueva.estado = 'borrador';
        nueva.fechaCreacion = new Date().toISOString();
        nueva.fechaModificacion = new Date().toISOString();
        nueva.usuarioCreacion = currentUser ? currentUser.id : null;
        nueva.usuarioModificacion = currentUser ? currentUser.id : null;

        const newId = await guardar('rendiciones', nueva);

        // Duplicar detalles
        for (const d of detallesOrig) {
            const nuevoDet = { ...d };
            delete nuevoDet.id;
            nuevoDet.rendicionId = Number(newId);
            const detId = await guardar('detalleGastos', nuevoDet);
            // Duplicar adjuntos
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

// ==================== DUPLICAR RENDICIÓN ACTUAL ====================
async function duplicarRendicion() {
    if (!rendicionActual || !rendicionActual.id) {
        mostrarToast('Primero debe guardar la rendición actual.', 'warning');
        return;
    }
    await duplicarRendicionId(rendicionActual.id);
}

// ==================== GRILLA DE DETALLE DE GASTOS ====================
async function renderizarDetalleGastos() {
    const tbody = document.getElementById('detalle-gastos-body');
    tbody.innerHTML = '';

    if (detallesActuales.length === 0) {
        tbody.innerHTML = '<tr><td colspan="16" style="text-align:center;color:var(--text-secondary);padding:2rem;">No hay gastos cargados. Hacé clic en "Agregar Gasto" para comenzar.</td></tr>';
        recalcularTodosLosTotales();
        return;
    }

    for (let index = 0; index < detallesActuales.length; index++) {
        const detalle = detallesActuales[index];
        const tr = document.createElement('tr');
        const proveedor = await obtenerNombreProveedor(detalle.proveedorId);
        const concepto = await obtenerNombreConcepto(detalle.conceptoId);
        const total = calcularTotalFila(detalle);
        const cantAdj = (adjuntosTemporales[index] || []).length;

        tr.innerHTML = `
            <td style="font-weight:600;text-align:center;">${index + 1}</td>
            <td>${proveedor}</td>
            <td>${detalle.tipoComprobante || '-'}</td>
            <td>${detalle.numeroComprobante || '-'}</td>
            <td>${formatearFechaVisual(detalle.fecha)}</td>
            <td>${concepto}</td>
            <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${detalle.descripcion || ''}">${detalle.descripcion || '-'}</td>
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
        `;
        tbody.appendChild(tr);
    }

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
    return Number(detalle.basico || 0) + Number(detalle.iva || 0) +
        Number(detalle.impuestosInternos || 0) + Number(detalle.percepcionIIBB || 0) +
        Number(detalle.percepcionIVA || 0) + Number(detalle.otrosImpuestos || 0);
}

// ==================== RECALCULAR TOTALES ====================
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

// ==================== AGREGAR FILA GASTO (MODAL) ====================
let filaEditandoIndex = -1;

async function agregarFilaGasto() {
    await cargarSelectoresRendicion(); // Asegura que conceptos y proveedores estén cargados
    filaEditandoIndex = -1;
    document.getElementById('detalle-gasto-id').value = '';
    document.getElementById('detalle-gasto-rendicion-id').value = rendicionActual ? (rendicionActual.id || '') : '';
    document.getElementById('detalle-gasto-orden').value = detallesActuales.length + 1;
    document.getElementById('detalle-gasto-modal-title').textContent = 'Agregar Gasto';

    // Limpiar formulario
    document.getElementById('detalle-proveedor').value = '';
    document.getElementById('detalle-tipo-comprobante').value = '';
    document.getElementById('detalle-numero-comprobante').value = '';
    document.getElementById('detalle-fecha').value = new Date().toISOString().split('T')[0];
    document.getElementById('detalle-concepto').value = '';
    document.getElementById('detalle-descripcion').value = '';
    document.getElementById('detalle-basico').value = '';
    document.getElementById('detalle-iva').value = '';
    document.getElementById('detalle-impuestos-internos').value = '';
    document.getElementById('detalle-percepcion-iibb').value = '';
    document.getElementById('detalle-percepcion-iva').value = '';
    document.getElementById('detalle-otros-impuestos').value = '';
    document.getElementById('detalle-cantidad-km').value = '';
    document.getElementById('detalle-valor-km').value = '';
    document.getElementById('campos-kilometros').style.display = 'none';
    document.getElementById('detalle-total').textContent = '$0.00';
    document.getElementById('detalle-adjuntos-list').innerHTML = '';

    // Limpiar adjuntos temporales para esta nueva fila
    adjuntosTemporales['modal'] = [];

    openModal('modal-detalle-gasto');
}

async function editarFilaGasto(index) {
    await cargarSelectoresRendicion();
    const detalle = detallesActuales[index];
    if (!detalle) return;

    filaEditandoIndex = index;
    document.getElementById('detalle-gasto-id').value = detalle.id || '';
    document.getElementById('detalle-gasto-rendicion-id').value = detalle.rendicionId || '';
    document.getElementById('detalle-gasto-orden').value = detalle.orden || (index + 1);
    document.getElementById('detalle-gasto-modal-title').textContent = 'Editar Gasto';

    document.getElementById('detalle-proveedor').value = detalle.proveedorId || '';
    document.getElementById('detalle-tipo-comprobante').value = detalle.tipoComprobante || '';
    document.getElementById('detalle-numero-comprobante').value = detalle.numeroComprobante || '';
    document.getElementById('detalle-fecha').value = detalle.fecha || '';
    document.getElementById('detalle-concepto').value = detalle.conceptoId || '';
    document.getElementById('detalle-descripcion').value = detalle.descripcion || '';
    document.getElementById('detalle-basico').value = detalle.basico || '';
    document.getElementById('detalle-iva').value = detalle.iva || '';
    document.getElementById('detalle-impuestos-internos').value = detalle.impuestosInternos || '';
    document.getElementById('detalle-percepcion-iibb').value = detalle.percepcionIIBB || '';
    document.getElementById('detalle-percepcion-iva').value = detalle.percepcionIVA || '';
    document.getElementById('detalle-otros-impuestos').value = detalle.otrosImpuestos || '';
    document.getElementById('detalle-cantidad-km').value = detalle.cantidadKm || '';
    document.getElementById('detalle-valor-km').value = detalle.valorKm || '';

    // Mostrar/ocultar campos kilómetros según concepto
    onCambioConceptoDetalle();

    // Recalcular total
    recalcularTotalFila();

    // Cargar adjuntos temporales
    adjuntosTemporales['modal'] = adjuntosTemporales[index] || [];
    renderizarAdjuntosModal();

    openModal('modal-detalle-gasto');
}

// ==================== ON CAMBIO CONCEPTO (MOSTRAR KM) ====================
async function onCambioConceptoDetalle() {
    const concId = document.getElementById('detalle-concepto').value;
    if (!concId) { document.getElementById('campos-kilometros').style.display = 'none'; return; }
    try {
        const conc = await obtenerPorId('conceptos', Number(concId));
        const esKm = conc && conc.nombre.toLowerCase() === 'kilómetros';
        document.getElementById('campos-kilometros').style.display = esKm ? 'block' : 'none';
    } catch(e) {
        document.getElementById('campos-kilometros').style.display = 'none';
    }
}

// ==================== RECALCULAR KILÓMETROS ====================
function recalcularKilometros() {
    const km = Number(document.getElementById('detalle-cantidad-km').value) || 0;
    const valorKm = Number(document.getElementById('detalle-valor-km').value) || 0;
    const basico = km * valorKm;
    document.getElementById('detalle-basico').value = basico > 0 ? basico.toFixed(2) : '';
    recalcularTotalFila();
}

// ==================== RECALCULAR TOTAL FILA ====================
function recalcularTotalFila() {
    const basico = Number(document.getElementById('detalle-basico').value) || 0;
    const iva = Number(document.getElementById('detalle-iva').value) || 0;
    const impInt = Number(document.getElementById('detalle-impuestos-internos').value) || 0;
    const iibb = Number(document.getElementById('detalle-percepcion-iibb').value) || 0;
    const percIva = Number(document.getElementById('detalle-percepcion-iva').value) || 0;
    const otros = Number(document.getElementById('detalle-otros-impuestos').value) || 0;
    const total = basico + iva + impInt + iibb + percIva + otros;
    document.getElementById('detalle-total').textContent = formatearMoneda(total);
}

// ==================== GUARDAR DETALLE GASTO (DESDE MODAL) ====================
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
        iva: Number(document.getElementById('detalle-iva').value) || 0,
        impuestosInternos: Number(document.getElementById('detalle-impuestos-internos').value) || 0,
        percepcionIIBB: Number(document.getElementById('detalle-percepcion-iibb').value) || 0,
        percepcionIVA: Number(document.getElementById('detalle-percepcion-iva').value) || 0,
        otrosImpuestos: Number(document.getElementById('detalle-otros-impuestos').value) || 0,
        cantidadKm: Number(document.getElementById('detalle-cantidad-km').value) || 0,
        valorKm: Number(document.getElementById('detalle-valor-km').value) || 0,
        total: 0
    };
    detalle.total = calcularTotalFila(detalle);

    const idExistente = document.getElementById('detalle-gasto-id').value;

    if (filaEditandoIndex >= 0 && filaEditandoIndex < detallesActuales.length) {
        // Editar existente
        if (idExistente) detalle.id = Number(idExistente);
        detalle.rendicionId = detallesActuales[filaEditandoIndex].rendicionId || (rendicionActual ? rendicionActual.id : null);
        detallesActuales[filaEditandoIndex] = detalle;
        // Transferir adjuntos temporales del modal a la fila
        adjuntosTemporales[filaEditandoIndex] = adjuntosTemporales['modal'] || [];
    } else {
        // Nuevo
        detalle.rendicionId = rendicionActual ? rendicionActual.id : null;
        detallesActuales.push(detalle);
        // Transferir adjuntos temporales
        adjuntosTemporales[detallesActuales.length - 1] = adjuntosTemporales['modal'] || [];
    }

    delete adjuntosTemporales['modal'];
    detallesModificados = true;
    document.getElementById('cambios-sin-guardar').style.display = 'inline-flex';

    closeModalDetalleGasto();
    renderizarDetalleGastos();
}

function closeModalDetalleGasto() {
    closeModal('modal-detalle-gasto');
    delete adjuntosTemporales['modal'];
}

// ==================== ACCIONES SOBRE FILAS ====================
function eliminarFilaGasto(index) {
    if (!confirm(`¿Eliminar el gasto #${index + 1}?`)) return;
    detallesActuales.splice(index, 1);
    delete adjuntosTemporales[index];
    // Reindexar adjuntos temporales
    const newAdj = {};
    Object.keys(adjuntosTemporales).forEach(k => {
        const ki = parseInt(k);
        if (ki > index) newAdj[ki - 1] = adjuntosTemporales[k];
        else if (ki < index) newAdj[ki] = adjuntosTemporales[k];
    });
    adjuntosTemporales = newAdj;
    detallesModificados = true;
    document.getElementById('cambios-sin-guardar').style.display = 'inline-flex';
    renderizarDetalleGastos();
}

function duplicarFilaGasto(index) {
    const original = detallesActuales[index];
    if (!original) return;
    const copia = { ...original };
    delete copia.id;
    detallesActuales.splice(index + 1, 0, copia);
    // Duplicar adjuntos
    adjuntosTemporales[index + 1] = [...(adjuntosTemporales[index] || [])].map(a => ({ ...a, id: undefined, detalleGastoId: undefined }));
    detallesModificados = true;
    document.getElementById('cambios-sin-guardar').style.display = 'inline-flex';
    renderizarDetalleGastos();
}

function moverFilaArriba(index) {
    if (index <= 0) return;
    [detallesActuales[index], detallesActuales[index - 1]] = [detallesActuales[index - 1], detallesActuales[index]];
    // Swap adjuntos
    const tempAdj = adjuntosTemporales[index];
    adjuntosTemporales[index] = adjuntosTemporales[index - 1];
    adjuntosTemporales[index - 1] = tempAdj;
    detallesModificados = true;
    document.getElementById('cambios-sin-guardar').style.display = 'inline-flex';
    renderizarDetalleGastos();
}

function moverFilaAbajo(index) {
    if (index >= detallesActuales.length - 1) return;
    [detallesActuales[index], detallesActuales[index + 1]] = [detallesActuales[index + 1], detallesActuales[index]];
    const tempAdj = adjuntosTemporales[index];
    adjuntosTemporales[index] = adjuntosTemporales[index + 1];
    adjuntosTemporales[index + 1] = tempAdj;
    detallesModificados = true;
    document.getElementById('cambios-sin-guardar').style.display = 'inline-flex';
    renderizarDetalleGastos();
}

// ==================== ADJUNTOS EN MODAL ====================
function agregarAdjuntoADetalle() {
    const fileInput = document.getElementById('detalle-adjunto-file');
    const files = fileInput.files;
    if (!files || files.length === 0) { mostrarToast('Seleccioná al menos un archivo.', 'warning'); return; }

    if (!adjuntosTemporales['modal']) adjuntosTemporales['modal'] = [];

    for (const file of files) {
        const reader = new FileReader();
        reader.onload = function(e) {
            adjuntosTemporales['modal'].push({
                nombre: file.name,
                archivo: e.target.result,
                tipoArchivo: file.type
            });
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
        div.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:0.35rem 0.5rem;background:var(--bg-secondary);border-radius:4px;';
        const icono = adj.tipoArchivo?.includes('pdf') ? 'fa-file-pdf' :
                      adj.tipoArchivo?.includes('image') ? 'fa-file-image' :
                      adj.tipoArchivo?.includes('xml') ? 'fa-file-code' : 'fa-file';
        div.innerHTML = `
            <span><i class="fa-regular ${icono}"></i> ${adj.nombre}</span>
            <button type="button" class="action-btn delete" onclick="eliminarAdjuntoModal(${idx})" style="padding:0.15rem 0.3rem;"><i class="fa-solid fa-times"></i></button>
        `;
        container.appendChild(div);
    });
}

function eliminarAdjuntoModal(idx) {
    if (adjuntosTemporales['modal']) {
        adjuntosTemporales['modal'].splice(idx, 1);
        renderizarAdjuntosModal();
    }
}

function mostrarAdjuntosFila(index) {
    const adjuntos = adjuntosTemporales[index] || [];
    if (adjuntos.length === 0) { mostrarToast('Sin archivos adjuntos.', 'warning'); return; }
    let msg = 'Archivos adjuntos:\n\n';
    adjuntos.forEach((a, i) => {
        msg += `${i+1}. ${a.nombre} (${a.tipoArchivo || 'desconocido'})\n`;
    });
    alert(msg);
}

// ==================== PROVEEDOR RÁPIDO ====================
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

// ==================== IMPRIMIR / EXPORTAR ====================
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
    <p><strong>Competencia:</strong> ${comp ? comp.nombre : '-'} | <strong>Autódromo:</strong> ${circ ? circ.nombre : '-'} | <strong>Responsable:</strong> ${resp ? resp.nombre + ' ' + resp.apellido : '-'}</p>
    <p><strong>Fecha:</strong> ${datos.fecha} | <strong>Estado:</strong> ${datos.estado}</p>
    <p><strong>Observaciones:</strong> ${datos.observaciones || '-'}</p>`;

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
                <td>${idx+1}</td><td>${prov}</td><td>${d.tipoComprobante || '-'}</td>
                <td>${d.numeroComprobante || '-'}</td><td>${formatearFechaVisual(d.fecha)}</td>
                <td>${conc}</td>
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

    let csv = '\uFEFF'; // BOM para Excel
    csv += 'N.,Proveedor,Tipo Comp.,N Comprobante,Fecha,Concepto,Descripcion,Basico,IVA,Imp Internos,IIBB,Percep IVA,Otros Imp.,Total\r\n';

    for (let idx = 0; idx < detallesActuales.length; idx++) {
        var d2 = detallesActuales[idx];
        var prov = (await obtenerNombreProveedor(d2.proveedorId) || '-').replace(/,/g, ' ');
        var conc = (await obtenerNombreConcepto(d2.conceptoId) || '-').replace(/,/g, ' ');
        var desc = (d2.descripcion || '').replace(/,/g, ' ');
        var linea = String(idx + 1) + ',' + prov + ',' + (d2.tipoComprobante || '') + ',' + (d2.numeroComprobante || '') + ',' + (d2.fecha || '') + ',' + conc + ',' + desc;
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
