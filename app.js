// app.js - Lógica de Negocio e Interfaz de Usuario para Control de Automovilismo

// ==================== HELPER DE SEGURIDAD: ESCAPAR HTML ====================
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}

// ==================== ESTADO DE SESIÓN ====================
let currentUser = null;

// ==================== INSTANCIAS DE GRÁFICOS ====================
let chartCategoriasInstance = null;
let chartMensualInstance = null;
let chartConceptoInstance = null;

// Flag para evitar re-renderizar el dashboard si no cambiaron los datos
let dashboardDirty = true;

const views = ['dashboard', 'calendario', 'gastos', 'carga-detallada', 'personal-competencia', 'inventario', 'articulos', 'movimientos-inventario', 'categorias-inventario', 'entregas-inventario', 'staff', 'estadisticas-personal', 'alojamiento', 'configuracion'];

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
        await inicializarFirebase();
        await inicializarDatosPorDefecto();
        
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
                        activo: true
                    };
                    currentUser = usuario;
                    iniciarSesion(usuario);
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

// Mapea un nombre de usuario a un email válido para Firebase Auth
// Ej: 'admin' -> 'admin@controlcda.com'
function mapearUsuarioAEmail(username) {
    const usuarioLimpio = String(username || '').trim().toLowerCase();
    if (!usuarioLimpio) return '';
    // Si ya es un email, devolverlo tal cual
    if (usuarioLimpio.includes('@')) return usuarioLimpio;
    // Mapear a un dominio interno de la app
    return usuarioLimpio + '@controlcda.com';
}

// Mapea un email de Firebase Auth de vuelta al nombre de usuario
function mapearEmailAUsuario(email) {
    const emailLimpio = String(email || '').trim().toLowerCase();
    if (emailLimpio.endsWith('@controlcda.com')) {
        return emailLimpio.replace('@controlcda.com', '');
    }
    return emailLimpio;
}

// Obtiene el rol del usuario desde Firestore (colección 'usuarios')
async function obtenerRolUsuarioDesdeFirestore(uid) {
    try {
        if (typeof getDoc === 'function' && typeof doc === 'function' && dbFirebase) {
            const docRef = doc(dbFirebase, 'usuarios', String(uid));
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                const data = docSnap.data();
                return {
                    rol: data.rol || 'viewer',
                    nombre: data.nombre || 'Usuario',
                    activo: data.activo !== false
                };
            }
        }
    } catch (e) {
        console.warn('No se pudo obtener el rol desde Firestore:', e);
    }
    // Fallback: buscar en IndexedDB local
    try {
        const usuarios = await getTodos('usuarios');
        const usuario = usuarios.find(u => u.uid === uid || u.username === mapearEmailAUsuario(uid));
        if (usuario) {
            return { rol: usuario.rol || 'viewer', nombre: usuario.nombre || 'Usuario', activo: usuario.activo !== false };
        }
    } catch (e) {
        console.warn('No se pudo obtener el rol desde IndexedDB:', e);
    }
    return { rol: 'viewer', nombre: 'Usuario', activo: true };
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

async function handleLogin(event) {
    event.preventDefault();
    const usernameInput = document.getElementById('login-username').value.trim();
    const passwordInput = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');
    const submitBtn = document.getElementById('login-submit-btn');

    errorEl.style.display = 'none';
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Verificando...';

    try {
        // Verificar que Firestore esté inicializado
        if (!dbFirebase || typeof query !== 'function' || typeof collection !== 'function' || typeof where !== 'function' || typeof getDocs !== 'function') {
            throw new Error('Firestore no está inicializado correctamente.');
        }

        // 1) IMPRIMIR DATOS DE INICIALIZACIÓN
        console.log("Intentando conectar al proyecto:", dbFirebase.app.options.projectId);
        console.log("Usuario ingresado:", usernameInput);
        console.log("Contraseña ingresada en texto plano:", passwordInput);

        // 2) CONSULTA DIRECTA A FIRESTORE
        const usuariosRef = collection(dbFirebase, 'usuarios');
        const q = query(usuariosRef, where('username', '==', usernameInput), where('activo', '==', true));
        const querySnapshot = await getDocs(q);

        // LOGUEAR RESULTADOS DE LA BÚSQUEDA
        if (querySnapshot.empty) {
            console.log("❌ ERROR: No se encontró ningún documento con el username: " + usernameInput + " en la colección 'usuarios'.");
            errorEl.style.display = 'flex';
            document.getElementById('login-password').value = '';
            return;
        } else {
            console.log("📋 Se encontraron " + querySnapshot.size + " documento(s) con el username: " + usernameInput);
        }

        // 3) CORRECCIÓN DEL BUCLE DE VALIDACIÓN (DETENER EN LA PRIMERA COINCIDENCIA)
        // Usar bucle tradicional 'for...of' en lugar de 'forEach' para poder hacer 'return' real
        for (const docSnap of querySnapshot.docs) {
            const usuarioData = docSnap.data();
            const usuarioId = docSnap.id;

            console.log("✅ PROCESANDO DOCUMENTO EN FIRESTORE:", docSnap.id, usuarioData);
            console.log("Contraseña guardada en DB:", usuarioData.passwordHash);
            console.log("Contraseña ingresada por el usuario en texto plano:", passwordInput);

            // 4) VERIFICAR LA CONTRASEÑA CON COMPATIBILIDAD DE AMBOS FORMATOS
            const esValida = await verificarPasswordConCompatibilidad(passwordInput, usuarioData.passwordHash);

            if (esValida) {
                // 5) LOGIN EXITOSO Y PERSISTENCIA
                console.log("✅ CONTRASEÑA VÁLIDA para el documento: " + docSnap.id);

                const usuario = {
                    id: Number(usuarioId) || usuarioId,
                    username: usuarioData.username,
                    nombre: usuarioData.nombre || 'Usuario',
                    rol: usuarioData.rol || 'viewer',
                    activo: true
                };

                // Guardar sesión en localStorage para persistencia
                localStorage.setItem('cda_session', JSON.stringify({
                    id: usuario.id,
                    username: usuario.username,
                    nombre: usuario.nombre,
                    rol: usuario.rol,
                    loginTime: new Date().toISOString()
                }));

                console.log("✅ LOGIN EXITOSO:", usuario);
                currentUser = usuario;
                iniciarSesion(usuario);
                return; // Romper el bucle real con return
            } else {
                console.log("❌ Contraseña incorrecta para el documento: " + docSnap.id + " (passwordHash: " + usuarioData.passwordHash + ")");
            }
        }

        // Si llegamos aquí, ningún documento fue válido
        console.log("❌ CONTRASEÑA INCORRECTA: Ningún documento del usuario '" + usernameInput + "' tiene una contraseña válida.");
        errorEl.style.display = 'flex';
        document.getElementById('login-password').value = '';
    } catch (error) {
        // 6) CONTROLADOR DE ERRORES DEL SDK (CATCH BLOCKS)
        console.error("💥 ERROR CRÍTICO DEL SDK DE FIREBASE:", error.code, error.message);
        alert("Error técnico de Firebase: " + error.message);
        errorEl.style.display = 'flex';
        document.getElementById('login-password').value = '';
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Ingresar';
    }
}

function iniciarSesion(usuario) {
    document.getElementById('login-screen').style.display = 'none';
    const appMain = document.getElementById('app-main');
    appMain.style.display = 'flex';

    document.getElementById('sidebar-user-name').textContent = usuario.nombre;
    document.getElementById('sidebar-avatar').textContent = usuario.nombre.charAt(0).toUpperCase();

    const rolesNombres = { admin: 'Administrador', editor: 'Editor', viewer: 'Visualizador', supervisor: 'Supervisor' };
    document.getElementById('sidebar-user-role').textContent = rolesNombres[usuario.rol] || usuario.rol;

    aplicarControlDeAcceso(usuario.rol);
    switchView('dashboard');
}

async function handleLogout() {
    const confirmado = await mostrarConfirmacion('Cerrar sesión', '¿Deseas cerrar la sesión?', 'question');
    if (confirmado) {
        // Limpiar sesión local
        localStorage.removeItem('cda_session');
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

    document.querySelectorAll('.editor-only').forEach(el => {
        el.style.display = (esViewer || esSupervisor) ? 'none' : '';
    });

    document.querySelectorAll('.admin-only').forEach(el => {
        el.style.display = esAdmin ? '' : 'none';
    });

    document.querySelectorAll('.menu-item').forEach((item, idx) => {
        if (esSupervisor && idx !== 0) {
            item.style.display = 'none';
        } else {
            item.style.display = '';
        }
    });

    document.body.classList.toggle('viewer-mode', esViewer);
    document.body.classList.toggle('admin-mode', esAdmin);
    document.body.classList.toggle('supervisor-mode', esSupervisor);
}

function puedeEditar() {
    return currentUser && (currentUser.rol === 'admin' || currentUser.rol === 'editor');
}

function esAdmin() {
    return currentUser && currentUser.rol === 'admin';
}

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

    // ============ TOTAL GENERAL: Sumar gastos simples + detallados ============
    const totalGastoSimple = gastos.reduce((sum, g) => sum + Number(g.monto), 0);
    const totalGastoDetallado = detalleGastos.reduce((sum, d) => sum + Number(d.total || 0), 0);
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
    gastos.forEach(g => {
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
    detalleGastos.forEach(d => {
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
                backgroundColor: ['#ff4757','#00d2d3','#2ed573','#ff9f43','#1e90ff','#a55eea','#ff6b81','#f368e0','#01a3a4'],
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

    // ============ EVOLUCIÓN MENSUAL / ANUAL ============
    const intervalEl = document.getElementById('dashboard-gastos-interval');
    const interval = intervalEl ? intervalEl.value : 'monthly';

    let labels = [];
    let dataPoints = [];

    if (interval === 'monthly') {
        const mesesNombres = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
        const gastosMensuales = Array(12).fill(0);
        // Gastos simples
        gastos.forEach(g => {
            if (g.fecha) gastosMensuales[new Date(g.fecha).getMonth()] += Number(g.monto);
        });
        // Gastos detallados: usar fecha del detalle o fecha de la rendición
        detalleGastos.forEach(d => {
            let fecha = d.fecha;
            if (!fecha) {
                const rendicion = rendiciones.find(r => Number(r.id) === Number(d.rendicionId));
                if (rendicion) fecha = rendicion.fecha;
            }
            if (fecha) gastosMensuales[new Date(fecha).getMonth()] += Number(d.total || 0);
        });
        labels = mesesNombres;
        dataPoints = gastosMensuales;
    } else {
        const mapaAnios = {};
        const sumarAlAnio = (fecha, monto) => {
            if (!fecha) return;
            const y = new Date(fecha).getFullYear();
            mapaAnios[y] = (mapaAnios[y] || 0) + Number(monto);
        };
        gastos.forEach(g => sumarAlAnio(g.fecha, g.monto));
        detalleGastos.forEach(d => {
            let fecha = d.fecha;
            if (!fecha) {
                const rendicion = rendiciones.find(r => Number(r.id) === Number(d.rendicionId));
                if (rendicion) fecha = rendicion.fecha;
            }
            sumarAlAnio(fecha, d.total || 0);
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

    // ============ GASTOS POR CONCEPTO ============
    // Gastos simples: usan g.concepto (texto)
    // Gastos detallados: usan d.conceptoId → conceptos.nombre
    const gastosPorConcepto = {};
    gastos.forEach(g => {
        const k = g.concepto.trim();
        gastosPorConcepto[k] = (gastosPorConcepto[k] || 0) + Number(g.monto);
    });
    detalleGastos.forEach(d => {
        const conc = conceptos.find(c => c.id === Number(d.conceptoId));
        const k = conc ? conc.nombre.trim() : 'Sin concepto';
        gastosPorConcepto[k] = (gastosPorConcepto[k] || 0) + Number(d.total || 0);
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
            staffContainer.innerHTML += `<span class="tag">${n}</span>`;
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
    if (categoriasIds.length === 0) { alert('Seleccioná al menos una categoría.'); return; }

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

// ==================== FUNCIÓN DE RESUMEN AUTOMÁTICO ====================
// Agrupa los gastos por competencia y suma los montos por categoría.
// Incluye el campo "montoFacturar" para cada gasto.
async function generarResumenGastosPorCompetencia() {
    const [gastos, competencias, categorias] = await Promise.all([
        getTodos('gastos'),
        getTodos('competencias'),
        getTodos('categorias')
    ]);

    const resumen = {};

    // Inicializar resumen para cada competencia existente
    competencias.forEach(comp => {
        resumen[comp.id] = {
            id: comp.id,
            nombre: comp.nombre,
            codigo: comp.codigo || '',
            categorias: {},
            total: 0,
            montoFacturar: 0
        };
    });

    // Procesar cada gasto
    gastos.forEach(g => {
        const compId = Number(g.competenciaId);
        if (!resumen[compId]) {
            // Gasto sin competencia asociada
            resumen[compId] = {
                id: compId,
                nombre: 'Sin competencia',
                codigo: '',
                categorias: {},
                total: 0,
                montoFacturar: 0
            };
        }

        const monto = Number(g.monto) || 0;
        const montoFacturar = Number(g.montoFacturar) || 0;

        // PRIORIDAD 1: El gasto tiene una categoría deportiva específica asignada → usar directamente
        const catDirecta = categorias.find(c => c.id === Number(g.categoriaId));
        if (catDirecta) {
            if (!resumen[compId].categorias[catDirecta.nombre]) {
                resumen[compId].categorias[catDirecta.nombre] = { total: 0, montoFacturar: 0 };
            }
            resumen[compId].categorias[catDirecta.nombre].total += monto;
            resumen[compId].categorias[catDirecta.nombre].montoFacturar += montoFacturar;
            resumen[compId].total += monto;
            resumen[compId].montoFacturar += montoFacturar;
            return;
        }

        // PRIORIDAD 2: Sin categoría específica ('general' o vacío) → distribuir entre las categorías de la competencia
        const comp = competencias.find(c => Number(c.id) === compId);
        if (comp && comp.categoriasIds && comp.categoriasIds.length > 0) {
            const montoCat = monto / comp.categoriasIds.length;
            const montoFacturarCat = montoFacturar / comp.categoriasIds.length;
            comp.categoriasIds.forEach(catId => {
                const cat = categorias.find(c => c.id === Number(catId));
                const nombreCat = cat ? cat.nombre : 'General / Compartido';
                if (!resumen[compId].categorias[nombreCat]) {
                    resumen[compId].categorias[nombreCat] = { total: 0, montoFacturar: 0 };
                }
                resumen[compId].categorias[nombreCat].total += montoCat;
                resumen[compId].categorias[nombreCat].montoFacturar += montoFacturarCat;
            });
            resumen[compId].total += monto;
            resumen[compId].montoFacturar += montoFacturar;
            return;
        }

        // PRIORIDAD 3: Fallback → usar la categoría directamente asignada al gasto si existe
        let catNombre;
        if (g.categoriaId === 'general') {
            catNombre = 'General / Compartido';
        } else {
            const cat = categorias.find(c => c.id === Number(g.categoriaId));
            catNombre = cat ? cat.nombre : 'Desconocida';
        }

        if (!resumen[compId].categorias[catNombre]) {
            resumen[compId].categorias[catNombre] = { total: 0, montoFacturar: 0 };
        }
        resumen[compId].categorias[catNombre].total += monto;
        resumen[compId].categorias[catNombre].montoFacturar += montoFacturar;

        resumen[compId].total += monto;
        resumen[compId].montoFacturar += montoFacturar;
    });

    return resumen;
}

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

async function openModalGasto() {
    if (!puedeEditar()) return;

    const competencias = await getTodos('competencias');
    const compFiltro = document.getElementById('filtro-competencia-gastos').value;
    const selectComp = document.getElementById('age-competencia');
    selectComp.innerHTML = '<option value="">Seleccione la competencia...</option>';
    competencias
        .sort((a, b) => new Date(b.fechaInicio) - new Date(a.fechaInicio))
        .forEach(c => {
            const label = c.codigo ? `${c.codigo} - ${c.nombre}` : c.nombre;
            selectComp.innerHTML += `<option value="${c.id}">${escapeHtml(label)}</option>`;
        });
    selectComp.value = competencias.some(c => String(c.id) === String(compFiltro)) ? compFiltro : '';

    await actualizarDatosCompetenciaGastoExtraordinario();

    // Limpiar campos del formulario
    document.getElementById('age-concepto').value = '';
    document.getElementById('age-monto').value = '';
    document.getElementById('age-detalle').value = '';

    openModal('modal-agregar-gasto-extraordinario');
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

async function editarGasto(id) {
    if (!puedeEditar()) return;
    const g = await obtenerPorId('gastos', id);
    if (!g) return;
    await actualizarSelectoresFormularios();
    document.getElementById('gasto-id').value = g.id;
    document.getElementById('gasto-competencia').value = g.competenciaId;
    if (document.getElementById('gasto-categoria')) {
        document.getElementById('gasto-categoria').value = g.categoriaId || 'general';
    }
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

async function eliminarGasto(id) {
    if (!puedeEditar()) return;
    if (!confirm('¿Eliminar este registro de gasto?')) return;
    await eliminar('gastos', id);
    dashboardDirty = true;
    await listarGastos();
}

// ==================== PANEL RESUMEN DE COMPETENCIA ====================
async function mostrarResumenCompetencia(compId, competencias, gastos, staff, categorias) {
    const comp = await obtenerPorId('competencias', compId);
    if (!comp) { cerrarResumenCompetencia(); return; }

    const panel = document.getElementById('resumen-competencia-panel');
    panel.style.display = 'block';

    const circ = await obtenerPorId('circuitos', Number(comp.circuitoId));
    const circNombre = circ ? `${circ.nombre} (${circ.ubicacion})` : 'Desconocido';
    const catNombres = comp.categoriasIds.map(id => {
        const cat = categorias.find(c => c.id === Number(id));
        return cat ? cat.nombre : '';
    }).filter(Boolean);
    const staffNombres = (comp.staffIds || []).map(id => {
        const s = staff.find(p => p.id === Number(id));
        return s ? `${s.nombre} ${s.apellido} (${s.funcion})` : '';
    }).filter(Boolean);

    // Calcular totales
    const costoSinples = gastos.filter(g => Number(g.competenciaId) === Number(comp.id)).reduce((s, g) => s + Number(g.monto), 0);
    const rendiciones = await getTodos('rendiciones');
    const detalleGastos = await getTodos('detalleGastos');
    const rendicionesComp = rendiciones.filter(r => Number(r.competenciaId) === Number(comp.id));
    const costoDetallado = rendicionesComp.reduce((s, r) => {
        const detallesRend = detalleGastos.filter(d => Number(d.rendicionId) === Number(r.id));
        return s + detallesRend.reduce((sd, d) => sd + Number(d.total || 0), 0);
    }, 0);
    const costoAutoCalc = costoSinples + costoDetallado;
    const tieneManual = comp.gastoTotal !== undefined && comp.gastoTotal !== null;
    const costoComp = tieneManual ? Number(comp.gastoTotal) : costoAutoCalc;

    // Calcular monto a facturar
    const montoFacturarSinples = gastos.filter(g => Number(g.competenciaId) === Number(comp.id)).reduce((s, g) => s + (Number(g.montoFacturar) || 0), 0);
    const montoFacturarDetallado = rendicionesComp.reduce((s, r) => {
        const detallesRend = detalleGastos.filter(d => Number(d.rendicionId) === Number(r.id));
        return s + detallesRend.reduce((sd, d) => sd + (Number(d.montoFacturar) || 0), 0);
    }, 0);
    const montoFacturarTotal = montoFacturarSinples + montoFacturarDetallado;
    const tieneMontoFacturarManual = comp.montoFacturarManual !== undefined && comp.montoFacturarManual !== null;
    const montoFacturarDisplay = tieneMontoFacturarManual ? Number(comp.montoFacturarManual) : montoFacturarTotal;

    // Generar HTML de estadísticas (editable si tiene permisos)
    const puedeEditarComp = puedeEditar() || esSupervisor();
    let totalGastosHtml, montoFacturarHtml;
    
    if (puedeEditarComp) {
        totalGastosHtml = `
            <div class="stat-card" style="padding:1rem;cursor:pointer;" onclick="editarTotalCompetenciaInplace(${comp.id})" title="Clic para editar">
                <div class="stat-info"><h3 style="font-size:0.85rem;">Total Gastos</h3>
                <p style="font-size:1.1rem;color:var(--accent);font-weight:700;">${formatearMoneda(costoComp)}
                    ${tieneManual ? '<i class="fa-solid fa-pencil" style="font-size:0.7rem;margin-left:4px;opacity:0.7;"></i>' : '<i class="fa-regular fa-pen-to-square" style="font-size:0.65rem;margin-left:4px;opacity:0.4;"></i>'}
                </p></div>
                <div class="stat-icon"><i class="fa-solid fa-dollar-sign"></i></div>
            </div>`;
        montoFacturarHtml = `
            <div class="stat-card" style="padding:1rem;cursor:pointer;" onclick="editarMontoFacturarInplace(${comp.id})" title="Clic para editar">
                <div class="stat-info"><h3 style="font-size:0.85rem;">Monto a Facturar</h3>
                <p style="font-size:1.1rem;color:var(--accent);font-weight:700;">${formatearMoneda(montoFacturarDisplay)}
                    ${tieneMontoFacturarManual ? '<i class="fa-solid fa-pencil" style="font-size:0.7rem;margin-left:4px;opacity:0.7;"></i>' : '<i class="fa-regular fa-pen-to-square" style="font-size:0.65rem;margin-left:4px;opacity:0.4;"></i>'}
                </p></div>
                <div class="stat-icon"><i class="fa-solid fa-file-invoice"></i></div>
            </div>`;
    } else {
        totalGastosHtml = `
            <div class="stat-card" style="padding:1rem;">
                <div class="stat-info"><h3 style="font-size:0.85rem;">Total Gastos</h3><p style="font-size:1.1rem;color:var(--accent);font-weight:700;">${formatearMoneda(costoComp)}</p></div>
                <div class="stat-icon"><i class="fa-solid fa-dollar-sign"></i></div>
            </div>`;
        montoFacturarHtml = `
            <div class="stat-card" style="padding:1rem;">
                <div class="stat-info"><h3 style="font-size:0.85rem;">Monto a Facturar</h3><p style="font-size:1.1rem;color:var(--accent);font-weight:700;">${formatearMoneda(montoFacturarDisplay)}</p></div>
                <div class="stat-icon"><i class="fa-solid fa-file-invoice"></i></div>
            </div>`;
    }

    document.getElementById('resumen-comp-stats').innerHTML = `
        <div class="stat-card" style="padding:1rem;"><div class="stat-info"><h3 style="font-size:0.85rem;">Código</h3><p style="font-size:1.1rem;font-family:monospace;">${comp.codigo || 'SIN CÓDIGO'}</p></div><div class="stat-icon"><i class="fa-solid fa-hashtag"></i></div></div>
        ${totalGastosHtml}
        ${montoFacturarHtml}
        <div class="stat-card" style="padding:1rem;"><div class="stat-info"><h3 style="font-size:0.85rem;">Categorías</h3><p style="font-size:1rem;">${catNombres.slice(0, 3).join(', ')}${catNombres.length > 3 ? ` (+${catNombres.length - 3})` : ''}</p></div><div class="stat-icon"><i class="fa-solid fa-tag"></i></div></div>
        <div class="stat-card" style="padding:1rem;"><div class="stat-info"><h3 style="font-size:0.85rem;">Personal</h3><p style="font-size:1rem;">${staffNombres.length} asignados</p></div><div class="stat-icon"><i class="fa-solid fa-users"></i></div></div>
    `;

    document.getElementById('resumen-comp-info').innerHTML = `
        <div><strong>Autódromo:</strong> ${circNombre}</div>
        <div><strong>Código:</strong> <span style="font-family:monospace;">${comp.codigo || 'SIN CÓDIGO'}</span></div>
        <div><strong>Fecha inicio:</strong> ${formatearFechaVisual(comp.fechaInicio)}</div>
        <div><strong>Fecha fin:</strong> ${formatearFechaVisual(comp.fechaFin)}</div>
        <div><strong>Total auto-calculado:</strong> ${formatearMoneda(costoAutoCalc)}</div>
        <div><strong>Gastos simples:</strong> ${formatearMoneda(costoSinples)}</div>
        <div><strong>Gastos detallados:</strong> ${formatearMoneda(costoDetallado)}</div>
        <div><strong>Monto a facturar auto:</strong> ${formatearMoneda(montoFacturarTotal)}</div>
    `;
}

function cerrarResumenCompetencia() {
    const panel = document.getElementById('resumen-competencia-panel');
    if (panel) panel.style.display = 'none';
}

// ==================== GASTO EXTRAORDINARIO ====================
async function guardarGastoExtraordinario() {
    if (!puedeEditar()) return;
    
    const compFiltro = document.getElementById('filtro-competencia-gastos').value;
    if (!compFiltro || compFiltro === 'todos') {
        alert('Seleccioná una competencia para agregar el gasto extraordinario.');
        return;
    }

    const monto = Number(document.getElementById('extra-monto').value);
    const concepto = document.getElementById('extra-concepto').value.trim();
    const detalle = document.getElementById('extra-detalle').value.trim();

    if (!monto || !concepto) {
        alert('Ingresá el monto y concepto del gasto extraordinario.');
        return;
    }

    const gasto = {
        competenciaId: Number(compFiltro),
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
    document.getElementById('extra-monto').value = '';
    document.getElementById('extra-concepto').value = '';
    document.getElementById('extra-detalle').value = '';
    
    mostrarToast('Gasto extraordinario guardado correctamente.');
    await listarGastos();
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
    });

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

// ==================== CONFIGURACIÓN: CATEGORÍAS & CIRCUITOS ====================

async function listarConfiguraciones() {
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
                <td style="font-weight:600;">${escapeHtml(c.nombre)}</td>
                <td style="color:var(--text-secondary);max-width:200px;text-overflow:ellipsis;overflow:hidden;white-space:nowrap;">${escapeHtml(c.descripcion)}</td>
                ${acciones}
            </tr>`;
    });

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
                <td style="font-weight:600;">${escapeHtml(c.nombre)}</td>
                <td>${escapeHtml(c.ubicacion)}</td>
                ${acciones}
            </tr>`;
    });

    actualizarEstadoFirebaseUI();

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
    const cat = { nombre: document.getElementById('categoria-nombre').value, descripcion: document.getElementById('categoria-descripcion').value, activo: true };
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
                    ${escapeHtml(u.username)}
                    ${esElMismo ? '<span class="badge badge-info" style="font-size:0.7rem;margin-left:0.5rem;">Yo</span>' : ''}
                </td>
                <td>${escapeHtml(u.nombre)}</td>
                <td><span class="badge ${rolesBadge[u.rol]}">${rolesNombres[u.rol] || escapeHtml(u.rol)}</span></td>
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
    // limpiar campo de hash mostrado para nuevo usuario
    const passwordToggle = document.getElementById('usuario-password-show');
    if (passwordToggle) passwordToggle.checked = false;
    actualizarResumenUsuarioModal();
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
    const passwordToggle = document.getElementById('usuario-password-show');
    if (passwordToggle) passwordToggle.checked = false;
    actualizarResumenUsuarioModal();
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
        if (password) {
            usuario.passwordHash = await hashPassword(password);
        } else {
            const existente = await obtenerPorId('usuarios', Number(id));
            usuario.passwordHash = existente.passwordHash;
        }
    } else {
        if (!password) { alert('La contraseña es obligatoria para nuevos usuarios.'); return; }
        usuario.passwordHash = await hashPassword(password);
    }

    await guardar('usuarios', usuario);

    if (currentUser && currentUser.id === usuario.id) {
        currentUser = { ...currentUser, ...usuario };
        document.getElementById('sidebar-user-name').textContent = usuario.nombre;
        document.getElementById('sidebar-avatar').textContent = usuario.nombre.charAt(0).toUpperCase();
    }

    mostrarToast(`Usuario guardado correctamente. Usuario: ${escapeHtml(usuario.username)}${password ? ' | Contraseña actualizada' : ' | Contraseña sin cambios'}`, 'success');
    closeModal('modal-usuario');
    await listarUsuarios();
}

function togglePasswordVisibilityModal() {
    const passwordInput = document.getElementById('usuario-password');
    const checkbox = document.getElementById('usuario-password-show');
    if (!passwordInput || !checkbox) return;
    passwordInput.type = checkbox.checked ? 'text' : 'password';
}

async function eliminarUsuario(id) {
    if (!esAdmin()) return;
    if (currentUser && currentUser.id === id) { alert('No podés eliminar tu propio usuario.'); return; }
    const usuarios = await getTodos('usuarios');
    if (usuarios.length <= 1) { alert('Debe existir al menos un usuario en el sistema.'); return; }

    const confirmado = await mostrarConfirmacion(
        'Eliminar usuario',
        '¿Eliminar este usuario permanentemente?',
        'warning'
    );

    if (!confirmado) return;
    await eliminar('usuarios', id);
    mostrarToast('Usuario eliminado correctamente.', 'success');
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
        personalCompetencia: await getTodos('personalCompetencia')
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

// ==================== ALERTA / CONFIRMACIÓN PERSONALIZADA ====================
let _alertaResolve = null;

function mostrarAlerta(titulo, mensaje, icono = 'info') {
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

        iconoEl.innerHTML = iconos[icono] || iconos.info;
        tituloEl.textContent = titulo;
        mensajeEl.textContent = mensaje;
        btnCancelar.style.display = 'none';
        btnConfirmar.textContent = 'Aceptar';

        _alertaResolve = resolve;
        openModal('modal-alerta');
    });
}

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
    toast.innerHTML = `<i class="fa-solid ${tipo === 'success' ? 'fa-check-circle' : tipo === 'error' ? 'fa-times-circle' : 'fa-triangle-exclamation'}"></i> ${mensaje}`;
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
    resumen.push(`<strong>Rol:</strong> ${escapeHtml(rol)}`);
    resumen.push(`<strong>Estado:</strong> ${escapeHtml(activo)}`);
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
            const respMatch = resp ? `${resp.nombre} ${resp.apellido}`.toLowerCase().includes(buscador) : false;
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
            <td>${resp ? `${escapeHtml(resp.nombre)} ${escapeHtml(resp.apellido)}` : '-'}</td>
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
                <p style="font-size:1rem;">${resp ? `${resp.nombre} ${resp.apellido}` : '-'}</p>
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
        <div><strong>Responsable:</strong> ${resp ? `${resp.nombre} ${resp.apellido}` : '-'}</div>
        <div><strong>Autódromo:</strong> ${circ ? circ.nombre : '-'}</div>
        <div><strong>Competencia:</strong> ${comp ? comp.nombre : '-'}</div>
        <div><strong>Código:</strong> <span class="blur-readonly" style="font-family:monospace;">${comp && comp.codigo ? comp.codigo : 'SIN CÓDIGO'}</span></div>
        <div><strong>Fecha:</strong> ${formatearFechaVisual(rendicion.fecha)}</div>
        <div><strong># Rendición:</strong> ${rendicion.id}</div>
    `;
    document.getElementById('ver-rendicion-observaciones').innerHTML = rendicion.observaciones ? `<i class="fa-solid fa-comment"></i> ${rendicion.observaciones}` : '';

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

    const selResp = document.getElementById('rendicion-responsable');
    const savedResp = selResp.value;
    selResp.innerHTML = '<option value="">Seleccione responsable...</option>';
    staff.forEach(s => selResp.innerHTML += `<option value="${s.id}">${s.nombre} ${s.apellido}</option>`);
    selResp.value = savedResp;

    const selConc = document.getElementById('detalle-concepto');
    if (selConc) {
        const savedConc = selConc.value;
        selConc.innerHTML = '<option value="">Seleccione concepto...</option>';
        conceptos.forEach(c => selConc.innerHTML += `<option value="${c.id}">${c.nombre}</option>`);
        selConc.value = savedConc;
    }

    const selProv = document.getElementById('detalle-proveedor');
    if (selProv) {
        const savedProv = selProv.value;
        selProv.innerHTML = '<option value="">Seleccione proveedor...</option>';
        proveedores.forEach(p => selProv.innerHTML += `<option value="${p.id}">${p.nombre}</option>`);
        selProv.value = savedProv;
    }
}

async function llenarFormularioRendicion(r) {
    document.getElementById('rendicion-id').value = r.id || '';
    document.getElementById('rendicion-competencia').value = r.competenciaId || '';
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

function obtenerDatosFormularioRendicion() {
    return {
        id: document.getElementById('rendicion-id').value ? Number(document.getElementById('rendicion-id').value) : null,
        competenciaId: Number(document.getElementById('rendicion-competencia').value),
        autodromoId: Number(document.getElementById('rendicion-autodromo').value),
        responsableId: Number(document.getElementById('rendicion-responsable').value),
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
    if (!datos.responsableId) { mostrarToast('Debe seleccionar un responsable.', 'error'); return false; }
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

            const adjuntosFila = adjuntosTemporales[i] || [];
            for (const adj of adjuntosFila) {
                adj.detalleGastoId = detalle.id;
                adj.usuarioCarga = currentUser ? currentUser.id : null;
                adj.fechaCarga = ahora;
                await guardar('adjuntos', adj);
            }
        }

        adjuntosTemporales = {};
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

async function eliminarRendicion(id) {
    if (!puedeEditar()) return;
    if (!confirm('¿Eliminar esta rendición y todos sus gastos asociados? Esta acción no se puede deshacer.')) return;

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
            <td>${escapeHtml(proveedor)}</td>
            <td>${escapeHtml(detalle.tipoComprobante || '-')}</td>
            <td>${escapeHtml(detalle.numeroComprobante || '-')}</td>
            <td>${formatearFechaVisual(detalle.fecha)}</td>
            <td>${escapeHtml(concepto)}</td>
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

let filaEditandoIndex = -1;

async function agregarFilaGasto() {
    await cargarSelectoresRendicion();
    filaEditandoIndex = -1;
    document.getElementById('detalle-gasto-id').value = '';
    document.getElementById('detalle-gasto-rendicion-id').value = rendicionActual ? (rendicionActual.id || '') : '';
    document.getElementById('detalle-gasto-orden').value = detallesActuales.length + 1;
    document.getElementById('detalle-gasto-modal-title').textContent = 'Agregar Gasto';

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
    document.getElementById('detalle-monto-facturar').value = '';
    document.getElementById('campos-kilometros').style.display = 'none';
    document.getElementById('detalle-total').textContent = '$0.00';
    document.getElementById('detalle-adjuntos-list').innerHTML = '';

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

    onCambioConceptoDetalle();
    recalcularTotalFila();

    adjuntosTemporales['modal'] = adjuntosTemporales[index] || [];
    renderizarAdjuntosModal();

    openModal('modal-detalle-gasto');
}

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

function recalcularKilometros() {
    const km = Number(document.getElementById('detalle-cantidad-km').value) || 0;
    const valorKm = Number(document.getElementById('detalle-valor-km').value) || 0;
    const basico = km * valorKm;
    document.getElementById('detalle-basico').value = basico > 0 ? basico.toFixed(2) : '';
    recalcularTotalFila();
}

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
    document.getElementById('detalle-total').textContent = formatearMoneda(total);
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
    detalle.total = calcularTotalFila(detalle);

    const idExistente = document.getElementById('detalle-gasto-id').value;

    if (filaEditandoIndex >= 0 && filaEditandoIndex < detallesActuales.length) {
        if (idExistente) detalle.id = Number(idExistente);
        detalle.rendicionId = detallesActuales[filaEditandoIndex].rendicionId || (rendicionActual ? rendicionActual.id : null);
        detallesActuales[filaEditandoIndex] = detalle;
        adjuntosTemporales[filaEditandoIndex] = adjuntosTemporales['modal'] || [];
    } else {
        detalle.rendicionId = rendicionActual ? rendicionActual.id : null;
        detallesActuales.push(detalle);
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

function eliminarFilaGasto(index) {
    if (!confirm(`¿Eliminar el gasto #${index + 1}?`)) return;
    detallesActuales.splice(index, 1);
    delete adjuntosTemporales[index];
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
    adjuntosTemporales[index + 1] = [...(adjuntosTemporales[index] || [])].map(a => ({ ...a, id: undefined, detalleGastoId: undefined }));
    detallesModificados = true;
    document.getElementById('cambios-sin-guardar').style.display = 'inline-flex';
    renderizarDetalleGastos();
}

function moverFilaArriba(index) {
    if (index <= 0) return;
    [detallesActuales[index], detallesActuales[index - 1]] = [detallesActuales[index - 1], detallesActuales[index]];
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
    <p><strong>Competencia:</strong> ${comp ? escapeHtml(comp.nombre) : '-'} | <strong>Autódromo:</strong> ${circ ? escapeHtml(circ.nombre) : '-'} | <strong>Responsable:</strong> ${resp ? escapeHtml(resp.nombre + ' ' + resp.apellido) : '-'}</p>
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
    switch(viewId) {
        case 'dashboard':    dashboardDirty = true; await renderDashboard(); break;
        case 'calendario':   await listarCompetencias(); break;
        case 'gastos':       await listarGastos(); break;
        case 'carga-detallada': await listarRendiciones(); break;
        case 'personal-competencia': await cargarPersonalCompetencia(); break;
        case 'inventario':   await renderDashboardInventario(); break;
        case 'articulos':    await listarArticulos(); break;
        case 'movimientos-inventario': await listarMovimientosInventario(); break;
        case 'categorias-inventario': await listarCategoriasInventario(); break;
        case 'entregas-inventario': await listarEntregas(); break;
        case 'staff':        await listarStaff(); break;
        case 'estadisticas-personal': await listarEstadisticasPersonal(); break;
        case 'alojamiento':  await listarAlojamientos(); break;
        case 'configuracion':await listarConfiguraciones(); break;
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
    chartInvCategorias = new Chart(document.getElementById('chart-inv-categorias').getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: Object.keys(articulosPorCat).filter(k => articulosPorCat[k] > 0),
            datasets: [{
                data: Object.values(articulosPorCat).filter(v => v > 0),
                backgroundColor: ['#ff4757','#00d2d3','#2ed573','#ff9f43','#1e90ff','#a55eea','#ff6b81','#f368e0','#ff9ff3','#54a0ff','#5f27cd','#01a3a4'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right', labels: { color: '#94a3b8', font: { size: 11, family: 'Outfit' } } }
            }
        }
    });

    if (chartInvStock) chartInvStock.destroy();
    chartInvStock = new Chart(document.getElementById('chart-inv-stock').getContext('2d'), {
        type: 'bar',
        data: {
            labels: Object.keys(stockPorCat).filter(k => stockPorCat[k] > 0),
            datasets: [{
                label: 'Unidades',
                data: Object.values(stockPorCat).filter(v => v > 0),
                backgroundColor: '#00d2d3',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
                x: { grid: { display: false }, ticks: { color: '#94a3b8' } }
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
        const esIngreso = ['ingreso', 'devolucion', 'compra', 'reposicion'].includes(mov.tipoMovimiento);
        const item = document.createElement('div');
        item.className = `movement-item ${esIngreso ? 'mov-in' : 'mov-out'}`;
        const icono = esIngreso ? 'fa-arrow-down' : 'fa-arrow-up';
        item.innerHTML = `
            <div class="mov-icon"><i class="fa-solid ${icono}"></i></div>
            <div class="mov-info">
                <div class="mov-title">${artName}</div>
                <div class="mov-meta">${mov.tipoMovimiento} • ${mov.motivo || ''} • ${formatearFechaVisual(mov.fecha)}</div>
            </div>
            <div class="mov-qty">${esIngreso ? '+' : '-'}${mov.cantidad}</div>
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

function contarArticulosSinStock(articulos, articuloTalles) {
    return articulos.filter(art => {
        if (art.activo === false) return false;
        let stock = 0;
        if (art.controlaTalles) {
            const tallesArt = articuloTalles.filter(at => Number(at.articuloId) === Number(art.id));
            stock = tallesArt.reduce((s, t) => s + Number(t.stock || 0), 0);
        } else {
            stock = Number(art.stockUnico || 0);
        }
        return stock === 0;
    }).length;
}

function contarArticulosBajoStock(articulos, articuloTalles) {
    return articulos.filter(art => {
        if (art.activo === false) return false;
        let stock = 0;
        if (art.controlaTalles) {
            const tallesArt = articuloTalles.filter(at => Number(at.articuloId) === Number(art.id));
            stock = tallesArt.reduce((s, t) => s + Number(t.stock || 0), 0);
        } else {
            stock = Number(art.stockUnico || 0);
        }
        return stock > 0 && stock <= (art.stockMinimo || 0);
    }).length;
}

async function obtenerStockArticulo(articuloId, articuloTalles) {
    const art = await obtenerPorId('articulos', Number(articuloId));
    if (!art) return 0;
    if (art.controlaTalles) {
        const talles = articuloTalles.filter(at => Number(at.articuloId) === Number(articuloId));
        return talles.reduce((s, t) => s + Number(t.stock || 0), 0);
    }
    return Number(art.stockUnico || 0);
}

async function listarArticulos() {
    const [articulos, categorias, articuloTalles] = await Promise.all([
        getTodos('articulos'),
        getTodos('categoriasInventario'),
        getTodos('articuloTalles')
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
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text-secondary);">No hay artículos que coincidan con los filtros.</td></tr>`;
        return;
    }

    for (const art of filtrados) {
        const cat = categorias.find(c => c.id === Number(art.categoriaId));
        const catName = cat ? cat.nombre : '-';

        let stock = 0;
        if (art.controlaTalles) {
            const tallesArt = articuloTalles.filter(at => Number(at.articuloId) === Number(art.id));
            stock = tallesArt.reduce((s, t) => s + Number(t.stock || 0), 0);
        } else {
            stock = Number(art.stockUnico || 0);
        }

        let stockBadge = 'stock-ok';
        if (stock === 0) stockBadge = 'stock-out';
        else if (stock <= (art.stockMinimo || 0)) stockBadge = 'stock-low';

        const estadoBadge = art.activo !== false ? 'badge-active' : 'badge-inactive';
        const estadoText = art.activo !== false ? 'Activo' : 'Inactivo';

        const acciones = puedeEditar() ? `
            <td style="text-align:right;white-space:nowrap;">
                <button class="action-btn" onclick="verArticulo(${art.id})" title="Ver detalle"><i class="fa-solid fa-eye"></i></button>
                <button class="action-btn" onclick="editarArticulo(${art.id})" title="Editar"><i class="fa-solid fa-pen-to-square"></i></button>
                <button class="action-btn" onclick="duplicarArticulo(${art.id})" title="Duplicar"><i class="fa-solid fa-copy"></i></button>
                <button class="action-btn delete" onclick="eliminarArticulo(${art.id})" title="Eliminar"><i class="fa-solid fa-trash"></i></button>
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
            <td><span class="stock-badge ${stockBadge}"><i class="fa-solid fa-cube"></i> ${stock}</span></td>
            <td><span class="badge ${estadoBadge}">${estadoText}</span></td>
            ${acciones}
        `;
        tbody.appendChild(tr);
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
    
    const [categorias, articuloTalles, movimientos, imagenes] = await Promise.all([
        getTodos('categoriasInventario'),
        getTodos('articuloTalles'),
        getTodos('movimientosInventario'),
        getTodos('imagenesArticulo')
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
        document.getElementById('ver-art-stock').innerHTML = tallesArt.length > 0 ? 
            `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:0.75rem;">${tallesArt.map(t => {
                const talle = talles.find(tl => tl.id === Number(t.talleId));
                return `<div style="background:var(--bg-secondary);padding:0.75rem;border-radius:6px;text-align:center;"><div style="font-size:0.85rem;color:var(--text-secondary);">${talle ? talle.nombre : '?'}</div><div style="font-size:1.3rem;font-weight:700;color:var(--accent-blue);">${t.stock || 0}</div></div>`;
            }).join('')}</div>` : '<span style="color:var(--text-secondary);">Sin stock configurado por talle.</span>';
    } else {
        document.getElementById('ver-art-stock').innerHTML = `<span style="font-weight:700;font-size:1.4rem;color:var(--accent);">${stock}</span> <span style="color:var(--text-secondary);">unidades en stock</span>`;
    }

    if (imagenes.length > 0) {
        const gal = document.getElementById('ver-art-galeria');
        gal.innerHTML = '';
        imagenes.forEach(img => {
            const item = document.createElement('div');
            item.className = 'article-gallery-item';
            item.innerHTML = `<img src="${escapeHtml(img.url)}" alt="Imagen" onerror="this.style.display='none'">`;
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
    document.getElementById('articulo-sector').value = art.sector || '';
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

    if (id) {
        articulo.id = Number(id);
        const orig = await obtenerPorId('articulos', Number(id));
        if (orig) {
            articulo.usuarioCreacion = orig.usuarioCreacion;
            articulo.fechaCreacion = orig.fechaCreacion;
        }
    }

    const savedId = await guardar('articulos', articulo);
    articulo.id = Number(savedId);

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

async function eliminarArticulo(id) {
    if (!puedeEditar()) return;
    const movimientos = await getTodos('movimientosInventario');
    if (movimientos.some(m => Number(m.articuloId) === Number(id))) {
        mostrarToast('No se puede eliminar un artículo con movimientos asociados.', 'error');
        return;
    }
    if (!(await mostrarConfirmacion('Eliminar Artículo', '¿Eliminar este artículo permanentemente?'))) return;

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
    mostrarToast('Artículo eliminado.');
    listarArticulos();
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
        let stock = 0;
        if (art.controlaTalles) {
            const tallesArt = articuloTalles.filter(at => Number(at.articuloId) === Number(art.id));
            stock = tallesArt.reduce((s, t) => s + Number(t.stock || 0), 0);
        } else {
            stock = Number(art.stockUnico || 0);
        }
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

async function listarMovimientosInventario() {
    const [movimientos, articulos] = await Promise.all([
        getTodos('movimientosInventario'),
        getTodos('articulos')
    ]);

    const filtroTipo = document.getElementById('filtro-movimiento-tipo').value;
    const filtroArt = document.getElementById('filtro-movimiento-articulo').value;
    const buscador = document.getElementById('buscar-movimientos').value.toLowerCase();

    const selArt = document.getElementById('filtro-movimiento-articulo');
    const savedArt = selArt.value;
    selArt.innerHTML = '<option value="todos">Todos</option>';
    articulos.forEach(a => selArt.innerHTML += `<option value="${a.id}">${a.nombre}</option>`);
    selArt.value = savedArt;

    let filtrados = movimientos.filter(m => {
        if (filtroTipo !== 'todos' && m.tipoMovimiento !== filtroTipo) return false;
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
        const esIngreso = ['ingreso', 'devolucion', 'compra', 'reposicion'].includes(mov.tipoMovimiento);

        let talleText = '';
        if (mov.talleId) {
            const talles = await getTodos('talles');
            const talle = talles.find(t => Number(t.id) === Number(mov.talleId));
            if (talle) talleText = ` (${talle.nombre})`;
        }

        const item = document.createElement('div');
        item.className = `movement-item ${esIngreso ? 'mov-in' : 'mov-out'}`;
        const icono = esIngreso ? 'fa-arrow-down' : 'fa-arrow-up';
        const fecha = mov.fecha ? formatearFechaVisual(mov.fecha) : '-';
        item.innerHTML = `
            <div class="mov-icon"><i class="fa-solid ${icono}"></i></div>
            <div class="mov-info">
                <div class="mov-title">${escapeHtml(artName)}${talleText}</div>
                <div class="mov-meta">${mov.tipoMovimiento} • ${escapeHtml(mov.motivo || '')} • ${fecha}</div>
                ${mov.observaciones ? `<div class="mov-meta">📝 ${escapeHtml(mov.observaciones)}</div>` : ''}
            </div>
            <div class="mov-qty">${esIngreso ? '+' : '-'}${mov.cantidad}</div>
        `;
        container.appendChild(item);
    }
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
    const tipoBienInfo = document.getElementById('movimiento-tipo-bien-info');
    if (tipoBienInfo) tipoBienInfo.style.display = 'none';
    document.getElementById('movimiento-modal-title').textContent = 'Registrar Movimiento';
    openModal('modal-movimiento');
}

async function onCambioArticuloMovimiento() {
    const artId = document.getElementById('movimiento-articulo').value;
    if (!artId) {
        document.getElementById('movimiento-talle-group').style.display = 'none';
        document.getElementById('movimiento-sector-group').style.display = 'none';
        document.getElementById('movimiento-tipo-bien').value = '';
        const infoEl = document.getElementById('movimiento-tipo-bien-info');
        if (infoEl) infoEl.style.display = 'none';
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

    // Evaluar visibilidad del Sector de Destino ante cambios de artículo o tipo
    onCambioTipoMovimiento();
}

// ===== LÓGICA CONDICIONAL SEGÚN TIPO DE MOVIMIENTO Y TIPO DE BIEN =====
// Si el movimiento es EGRESO y el artículo es "Consumible": se restará el stock por completo.
// Si el movimiento es EGRESO y el artículo es "Bien de Uso": se debe indicar el Sector de Destino
// para realizar una transferencia interna (restar de Depósito y sumar a Sector), sin dar de baja el bien.
function onCambioTipoMovimiento() {
    const tipoMovimiento = document.getElementById('movimiento-tipo').value;
    const tipoBien = document.getElementById('movimiento-tipo-bien').value;

    // Solo para EGRESO con Bien de Uso se muestra el Sector de Destino obligatorio
    const esEgreso = tipoMovimiento === 'egreso';
    const esBienUso = tipoBien === 'bien_uso';
    const sectorGroup = document.getElementById('movimiento-sector-group');
    const sectorSelect = document.getElementById('movimiento-sector-destino');

    if (esEgreso && esBienUso) {
        if (sectorGroup) sectorGroup.style.display = 'block';
        if (sectorSelect) sectorSelect.required = true;
    } else {
        if (sectorGroup) sectorGroup.style.display = 'none';
        if (sectorSelect) {
            sectorSelect.required = false;
            sectorSelect.value = '';
        }
    }
}

async function guardarMovimientoForm(e) {
    e.preventDefault();
    if (!puedeEditar()) return;

    const articuloId = document.getElementById('movimiento-articulo').value;
    const tipo = document.getElementById('movimiento-tipo').value;
    const cantidad = Number(document.getElementById('movimiento-cantidad').value);
    const talleId = document.getElementById('movimiento-talle').value || null;
    const motivo = document.getElementById('movimiento-motivo').value.trim();
    const observaciones = document.getElementById('movimiento-observaciones').value.trim();
    const tipoBien = document.getElementById('movimiento-tipo-bien').value || 'consumible';
    const sectorDestino = document.getElementById('movimiento-sector-destino').value;

    if (!articuloId || !tipo || !cantidad || !motivo) {
        mostrarToast('Completá todos los campos requeridos.', 'error');
        return;
    }

    const art = await obtenerPorId('articulos', Number(articuloId));
    if (!art) { mostrarToast('Artículo no encontrado.', 'error'); return; }

    // ===== LÓGICA CONDICIONAL SEGÚN TIPO DE BIEN =====
    const esEgreso = ['egreso', 'entrega', 'perdida', 'rotura', 'transferencia'].includes(tipo);
    const esBienUso = tipoBien === 'bien_uso';

    // Si es EGRESO y el artículo es Bien de Uso: se requiere Sector de Destino (transferencia interna)
    if (tipo === 'egreso' && esBienUso) {
        if (!sectorDestino) {
            mostrarToast('Para Bienes de Uso, debe seleccionar el Sector de Destino.', 'error');
            return;
        }
    }

    // Validar stock suficiente para egresos
    if (esEgreso) {
        let stockActual = 0;
        if (art.controlaTalles && talleId) {
            const tallesArt = await getTodos('articuloTalles');
            const talleArt = tallesArt.find(t => Number(t.articuloId) === Number(articuloId) && Number(t.talleId) === Number(talleId));
            stockActual = talleArt ? talleArt.stock : 0;
        } else {
            stockActual = Number(art.stockUnico || 0);
        }
        if (cantidad > stockActual) {
            mostrarToast(`Stock insuficiente. Stock actual: ${stockActual}`, 'error');
            return;
        }
    }

    const mov = {
        articuloId: Number(articuloId),
        talleId: talleId ? Number(talleId) : null,
        tipoMovimiento: tipo,
        tipoBien: tipoBien,
        sectorDestino: sectorDestino || null,
        esTransferencia: (tipo === 'egreso' && esBienUso),
        cantidad,
        motivo,
        observaciones,
        usuarioId: currentUser ? currentUser.id : null,
        fecha: new Date().toISOString().split('T')[0]
    };

    await guardar('movimientosInventario', mov);

    // ===== AJUSTE DE STOCK =====
    // Consumible en EGRESO: se resta el stock (se da de baja el bien consumible).
    // Bien de Uso en EGRESO (transferencia interna): se resta de Depósito, y el bien
    // permanece en el inventario global (no se da de baja). El sector de destino
    // queda registrado en el movimiento para trazabilidad.
    if (art.controlaTalles && talleId) {
        const tallesArt = await getTodos('articuloTalles');
        let talleArt = tallesArt.find(t => Number(t.articuloId) === Number(articuloId) && Number(t.talleId) === Number(talleId));
        if (esEgreso) {
            if (talleArt) {
                talleArt.stock = Math.max(0, Number(talleArt.stock) - cantidad);
                await guardar('articuloTalles', talleArt);
            }
        } else {
            if (talleArt) {
                talleArt.stock = Number(talleArt.stock) + cantidad;
                await guardar('articuloTalles', talleArt);
            } else {
                await guardar('articuloTalles', { articuloId: Number(articuloId), talleId: Number(talleId), stock: cantidad });
            }
        }
    } else {
        if (esEgreso) {
            art.stockUnico = Math.max(0, Number(art.stockUnico || 0) - cantidad);
        } else {
            art.stockUnico = Number(art.stockUnico || 0) + cantidad;
        }
        await guardar('articulos', art);
    }

    invalidarCache('articuloTalles');
    invalidarCache('articulos');
    invalidarCache('movimientosInventario');

    closeModal('modal-movimiento');
    const tipoLabel = (tipo === 'egreso' && esBienUso) ? `transferencia interna a ${sectorDestino}` : `${tipo} de ${cantidad} unidades`;
    mostrarToast(`Movimiento registrado: ${tipoLabel}.`);

    const activeView = document.querySelector('.view.active');
    if (activeView) {
        const viewId = activeView.id.replace('view-', '');
        if (viewId === 'movimientos-inventario') listarMovimientosInventario();
    }
}

async function listarCategoriasInventario() {
    const [categorias, subcategorias, talles] = await Promise.all([
        getTodos('categoriasInventario'),
        getTodos('subcategoriasInventario'),
        getTodos('talles')
    ]);

    const catBody = document.getElementById('categorias-inventario-body');
    catBody.innerHTML = '';
    categorias.forEach(c => {
        const acciones = puedeEditar() ? `
            <td style="text-align:right;">
                <button class="action-btn" onclick="editarCategoriaInventario(${c.id})"><i class="fa-solid fa-pen-to-square"></i></button>
                <button class="action-btn delete" onclick="eliminarCategoriaInventario(${c.id})"><i class="fa-solid fa-trash"></i></button>
            </td>
        ` : '';
        const tallesBadge = c.controlaTalles ? '<span class="badge badge-info">Sí</span>' : '<span class="badge badge-secondary">No</span>';
        const tipoBienBadge = c.tipoBien === 'bien_uso' ? '<span class="badge badge-active">Bien de Uso</span>' : '<span class="badge badge-secondary">Consumible</span>';
        const estadoBadge = c.activo !== false ? '<span class="badge badge-active">Activo</span>' : '<span class="badge badge-inactive">Inactivo</span>';
        catBody.innerHTML += `<tr>
            <td style="font-weight:600;">${escapeHtml(c.nombre)}</td>
            <td>${tallesBadge}</td>
            <td>${tipoBienBadge}</td>
            <td>${estadoBadge}</td>
            ${acciones}
        </tr>`;
    });

    const talleBody = document.getElementById('talles-body');
    talleBody.innerHTML = '';
    talles.forEach(t => {
        const acciones = puedeEditar() ? `
            <td style="text-align:right;">
                <button class="action-btn" onclick="editarTalle(${t.id})"><i class="fa-solid fa-pen-to-square"></i></button>
                <button class="action-btn delete" onclick="eliminarTalle(${t.id})"><i class="fa-solid fa-trash"></i></button>
            </td>
        ` : '';
        talleBody.innerHTML += `<tr>
            <td style="font-weight:600;">${escapeHtml(t.nombre)}</td>
            <td>${escapeHtml(t.descripcion || '-')}</td>
            ${acciones}
        </tr>`;
    });

    const subBody = document.getElementById('subcategorias-inventario-body');
    subBody.innerHTML = '';
    subcategorias.forEach(s => {
        const cat = categorias.find(c => c.id === Number(s.categoriaId));
        const catName = cat ? cat.nombre : '-';
        const acciones = puedeEditar() ? `
            <td style="text-align:right;">
                <button class="action-btn" onclick="editarSubcategoria(${s.id})"><i class="fa-solid fa-pen-to-square"></i></button>
                <button class="action-btn delete" onclick="eliminarSubcategoria(${s.id})"><i class="fa-solid fa-trash"></i></button>
            </td>
        ` : '';
        subBody.innerHTML += `<tr>
            <td style="font-weight:600;">${escapeHtml(s.nombre)}</td>
            <td>${escapeHtml(catName)}</td>
            ${acciones}
        </tr>`;
    });
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
        <button type="button" class="action-btn delete" onclick="eliminarFilaEntrega(this)" style="margin-bottom:0.5rem;" title="Quitar"><i class="fa-solid fa-times"></i></button>
    `;

    container.appendChild(row);
}

async function onCambioArticuloEntrega(select) {
    const artId = select.value;
    const talleSelect = select.closest('.entrega-detalle-row').querySelector('.entrega-talle-select');
    if (!artId) {
        talleSelect.innerHTML = '<option value="">Sin talle</option>';
        return;
    }
    const art = await obtenerPorId('articulos', Number(artId));
    if (art && art.controlaTalles) {
        const talles = await getTodos('talles');
        talleSelect.innerHTML = '<option value="">Seleccione talle...</option>';
        talles.forEach(t => talleSelect.innerHTML += `<option value="${t.id}">${t.nombre}</option>`);
    } else {
        talleSelect.innerHTML = '<option value="">Sin talle</option>';
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

        // Validar stock suficiente antes de descontar
        let stockActual = 0;
        if (art.controlaTalles && talleId) {
            const tallesArt = await getTodos('articuloTalles');
            const talleArt = tallesArt.find(t => Number(t.articuloId) === Number(articuloId) && Number(t.talleId) === Number(talleId));
            stockActual = talleArt ? Number(talleArt.stock || 0) : 0;
        } else {
            stockActual = Number(art.stockUnico || 0);
        }
        if (cantidad > stockActual) {
            mostrarToast(`Stock insuficiente para "${art.nombre}". Stock actual: ${stockActual}`, 'error');
            return;
        }

        const detalle = {
            entregaId: entrega.id,
            articuloId: Number(articuloId),
            talleId: talleId ? Number(talleId) : null,
            cantidad
        };
        await guardar('detalleEntregas', detalle);

        if (art.controlaTalles && talleId) {
            const tallesArt = await getTodos('articuloTalles');
            const talleArt = tallesArt.find(t => Number(t.articuloId) === Number(articuloId) && Number(t.talleId) === Number(talleId));
            if (talleArt) {
                talleArt.stock = Math.max(0, Number(talleArt.stock) - cantidad);
                await guardar('articuloTalles', talleArt);
            }
        } else {
            art.stockUnico = Math.max(0, Number(art.stockUnico || 0) - cantidad);
            await guardar('articulos', art);
        }

        await guardar('movimientosInventario', {
            articuloId: Number(articuloId),
            talleId: talleId ? Number(talleId) : null,
            tipoMovimiento: 'entrega',
            cantidad,
            motivo: 'Entrega de indumentaria',
            observaciones: `Entrega #${entrega.id} a persona ID: ${personaId}`,
            usuarioId: currentUser ? currentUser.id : null,
            fecha: new Date().toISOString().split('T')[0]
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
const TASA_SAC_MENSUALIZADO = 1/12;      // 1/12
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
    const limpio = String(str).replace(/\./g, '').replace(/,/g, '.').replace(/[^0-9.-]/g, '');
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
                <input type="text" class="personal-bruto-input" data-index="${idx}" value="${formatearInputMoneda(bruto)}" style="width:130px;text-align:right;" placeholder="0,00">
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
        input.addEventListener('input', onPersonalBrutoInput);
        input.addEventListener('blur', onPersonalBrutoBlur);
        input.addEventListener('keydown', onPersonalBrutoKeydown);
    });
    document.querySelectorAll('.personal-cantidad-input').forEach(input => {
        input.addEventListener('input', recalcularPersonalFila);
        input.addEventListener('change', recalcularPersonalFila);
    });
}

// Evento: formatear mientras escribe en el input de bruto
function onPersonalBrutoInput(e) {
    // Limpiar todo excepto dígitos y coma
    let value = e.target.value;
    if (value) {
        // Remover puntos de miles, mantener solo dígitos y coma decimal
        const soloNumeros = value.replace(/[^\d,]/g, '');
        e.target.dataset.raw = parsearMoneda(soloNumeros);
        // Formatear visualmente con puntos de miles y comas
        e.target.value = formatearInputMoneda(parsearMoneda(soloNumeros));
    }
    recalcularPersonalFila(e);
}

// Evento: al perder foco, mantener formato
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

// Obtener el total de personal para una competencia + gastos normales
async function obtenerTotalGastosConPersonal(compId) {
    const [gastos, rendiciones, detalleGastos] = await Promise.all([
        getTodos('gastos'),
        getTodos('rendiciones'),
        getTodos('detalleGastos')
    ]);
    const costoSinples = gastos.filter(g => Number(g.competenciaId) === Number(compId)).reduce((s, g) => s + Number(g.monto), 0);
    const rendicionesComp = rendiciones.filter(r => Number(r.competenciaId) === Number(compId));
    const costoDetallado = rendicionesComp.reduce((s, r) => {
        const detallesRend = detalleGastos.filter(d => Number(d.rendicionId) === Number(r.id));
        return s + detallesRend.reduce((sd, d) => sd + Number(d.total || 0), 0);
    }, 0);
    const totalPersonal = await obtenerTotalPersonalCompetencia(compId);
    return { normal: costoSinples + costoDetallado, personal: totalPersonal, total: costoSinples + costoDetallado + totalPersonal };
}

// ====================================================================
// MÓDULO: ALOJAMIENTO (OPTIMIZADO)
// ====================================================================

// Estado del módulo
let alojamientosCache = [];
let alojamientosCargados = false;
let alojamientosFiltrosInicializados = false;

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
