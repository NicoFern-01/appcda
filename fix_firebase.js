const fs = require('fs');
const path = 'db.js';
let c = fs.readFileSync(path, 'utf8');
const log = [];

// ============================================================
// Normalizar saltos de línea para búsquedas robustas
// ============================================================
function normalizar(texto) {
    return texto.replace(/\r\n/g, '\n');
}

// ============================================================
// 1) Verificar/reemplazar DEFAULT_FIREBASE_CONFIG sin authDomain hardcodeado
// ============================================================
const oldConfigBlock = `const DEFAULT_FIREBASE_CONFIG = {
    apiKey: "AIzaSyAGT318kBRICwdjrU05RCUNSJRanAQnfPQ",
    authDomain: "controlcda-e5f97.firebaseapp.com",
    projectId: "controlcda-e5f97",
    storageBucket: "controlcda-e5f97.firebasestorage.app",
    messagingSenderId: "971822887261",
    appId: "1:971822887261:web:abe3fd29049c176946f8b4",
    measurementId: "G-L5C4YLVW1V"
};`;

const newConfigBlock = `const DEFAULT_FIREBASE_CONFIG = {
    apiKey: "AIzaSyAGT318kBRICwdjrU05RCUNSJRanAQnfPQ",
    projectId: "controlcda-e5f97",
    storageBucket: "controlcda-e5f97.firebasestorage.app",
    messagingSenderId: "971822887261",
    appId: "1:971822887261:web:abe3fd29049c176946f8b4",
    measurementId: "G-L5C4YLVW1V"
};

// Detecta el entorno actual y devuelve el authDomain correcto
function obtenerAuthDomainDinamico() {
    const hostname = window.location.hostname;
    // Si estamos en GitHub Pages (producción), usar el dominio de GitHub Pages
    if (hostname.includes('github.io')) {
        return hostname; // Ej: nicofern-01.github.io
    }
    // Si estamos en localhost o cualquier otro entorno, usar el authDomain de Firebase
    return 'controlcda-e5f97.firebaseapp.com';
}

// Obtiene la configuración completa de Firebase, ajustando authDomain dinámicamente
function obtenerConfigFirebase() {
    const configStr = localStorage.getItem('firebase_config');
    let config;
    
    if (configStr) {
        try {
            config = JSON.parse(configStr);
        } catch (err) {
            console.warn('Configuración Firebase inválida en localStorage, usando configuración por defecto.', err);
            config = { ...DEFAULT_FIREBASE_CONFIG };
        }
    } else {
        config = { ...DEFAULT_FIREBASE_CONFIG };
    }
    
    // Ajustar authDomain dinámicamente según el entorno
    // Si el usuario no especificó un authDomain, o si estamos en GitHub Pages,
    // usar el authDomain dinámico
    if (!config.authDomain || window.location.hostname.includes('github.io')) {
        config.authDomain = obtenerAuthDomainDinamico();
    }
    
    // Guardar la configuración ajustada para futuras cargas
    localStorage.setItem('firebase_config', JSON.stringify(config));
    
    return config;
}`;

const cNorm = normalizar(c);
const oldNorm = normalizar(oldConfigBlock);
const newNorm = newConfigBlock.replace(/\r\n/g, '\n');

if (cNorm.indexOf(oldNorm) !== -1) {
    c = cNorm.replace(oldNorm, newNorm);
    log.push('OK: DEFAULT_FIREBASE_CONFIG reemplazado por configuración dinámica');
} else if (c.indexOf('obtenerConfigFirebase') === -1) {
    log.push('WARN: No se encontró el bloque DEFAULT_FIREBASE_CONFIG original (posiblemente ya aplicado o formateado diferente)');
} else {
    log.push('INFO: Configuración dinámica ya está aplicada en db.js');
}

// ============================================================
// 2) Verificar que inicializarFirebase() use obtenerConfigFirebase()
// ============================================================
const oldInitStart = `async function inicializarFirebase() {
    let config;
    const configStr = localStorage.getItem('firebase_config');
    if (configStr) {
        try {
            config = JSON.parse(configStr);
        } catch (err) {
            console.warn('Configuración Firebase inválida en localStorage, cargando configuración por defecto.', err);
            config = DEFAULT_FIREBASE_CONFIG;
            localStorage.setItem('firebase_config', JSON.stringify(config));
        }
    } else {
        config = DEFAULT_FIREBASE_CONFIG;
        localStorage.setItem('firebase_config', JSON.stringify(config));
    }`;

const newInitStart = `async function inicializarFirebase() {
    // Cargar configuración dinámicamente (ajusta authDomain según entorno)
    const config = obtenerConfigFirebase();`;

const initNorm = normalizar(oldInitStart);
const newInitNorm = newInitStart.replace(/\r\n/g, '\n');

if (normalizar(c).indexOf(initNorm) !== -1) {
    c = normalizar(c).replace(initNorm, newInitNorm);
    log.push('OK: inicializarFirebase() ahora usa obtenerConfigFirebase()');
} else if (c.indexOf('obtenerConfigFirebase()') !== -1) {
    log.push('INFO: inicializarFirebase() ya usa obtenerConfigFirebase()');
} else {
    log.push('WARN: No se encontró el bloque de inicialización de config en inicializarFirebase()');
}

// ============================================================
// 3) Verificar que la verificación al cargar esté presente
// ============================================================
const verificarConfig = `// ==================== VERIFICACIÓN DE CONFIGURACIÓN FIREBASE ====================
// Al cargar la página, verificar que la configuración guardada tenga el authDomain correcto
// para el entorno actual (especialmente GitHub Pages en producción)
(function verificarConfigFirebaseAlCargar() {
    try {
        const configStr = localStorage.getItem('firebase_config');
        if (configStr) {
            const config = JSON.parse(configStr);
            const hostname = window.location.hostname;
            
            // Si estamos en GitHub Pages y el authDomain no coincide, actualizarlo
            if (hostname.includes('github.io') && config.authDomain !== hostname) {
                console.log('Actualizando authDomain para GitHub Pages:', hostname);
                config.authDomain = hostname;
                localStorage.setItem('firebase_config', JSON.stringify(config));
            }
        }
    } catch (e) {
        console.warn('Error al verificar configuración Firebase:', e);
    }
})();`;

if (c.indexOf('verificarConfigFirebaseAlCargar') === -1) {
    const anclaVerificacion = '// Limpiar toda la caché al cargar la página para evitar datos obsoletos';
    if (c.indexOf(anclaVerificacion) !== -1) {
        c = c.replace(anclaVerificacion, verificarConfig + '\n\n' + anclaVerificacion);
        log.push('OK: Verificación de configuración Firebase insertada al cargar');
    } else {
        log.push('WARN: No se encontró el ancla para insertar verificación');
    }
} else {
    log.push('INFO: Verificación de configuración Firebase ya está aplicada');
}

// ============================================================
// 4) Garantizar que el archivo se guarde con saltos de línea consistentes
// ============================================================
c = c.replace(/\r\n/g, '\n');

// ============================================================
// 5) Modificar app.js para que guardarYConectarFirebase()
//    ajuste el authDomain automáticamente
// ============================================================
const appPath = 'app.js';
let app = fs.readFileSync(appPath, 'utf8');
const appLog = [];

const oldGuardar = `        const config = JSON.parse(configText);
        if (!config.apiKey || !config.projectId) {
            statusEl.innerHTML = '<span style="color: #ff6b6b;">⚠️ El JSON debe contener al menos "apiKey" y "projectId".</span>';
            return;
        }

        localStorage.setItem('firebase_config', JSON.stringify(config));`;

const newGuardar = `        const config = JSON.parse(configText);
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

        localStorage.setItem('firebase_config', JSON.stringify(config));`;

const appNorm = normalizar(app);
const oldGuardarNorm = normalizar(oldGuardar);
const newGuardarNorm = newGuardar.replace(/\r\n/g, '\n');

if (appNorm.indexOf(oldGuardarNorm) !== -1) {
    app = appNorm.replace(oldGuardarNorm, newGuardarNorm);
    appLog.push('OK: guardarYConectarFirebase() ajusta authDomain dinámicamente');
} else if (app.indexOf('hostname.includes(\'github.io\')') !== -1 || app.indexOf('hostname.includes("github.io")') !== -1) {
    appLog.push('INFO: guardarYConectarFirebase() ya ajusta authDomain dinámicamente');
} else {
    appLog.push('WARN: No se encontró el bloque de guardarYConectarFirebase() en app.js');
}

app = app.replace(/\r\n/g, '\n');
fs.writeFileSync(appPath, app);
log.push('--- app.js ---');
log.push(...appLog);

// ============================================================
// Guardar cambios
// ============================================================
fs.writeFileSync(path, c);
fs.writeFileSync('fix_log.txt', log.join('\n'));
console.log(log.join('\n'));