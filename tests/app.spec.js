import { test, expect } from '@playwright/test';

// Credenciales de red de seguridad (admin pre-sembrado en IndexedDB).
const PASSWORD = 'Admin123!';
// Hash precomputado (sha256$salt$sha256(salt+pass)) para el admin sembrado.
const ADMIN_HASH =
  'sha256$641721bc92dc6043f7120affbae5c69e$99f443b9770a6116854de1b7d70a1ad83b8260d1ef84e1a95e1030d4781d9d3d';

// Errores de consola benignos (red/recursos externos: Firebase/Chart.js desde CDN).
const ERRORES_BENIGNOS = [
  /net::ERR_|Failed to load resource|ERR_CONNECTION/i,
  /gstatic\.com\/firebasejs/i,
  /cdn\.jsdelivr\.net|cdnjs\.cloudflare/i,
  /favicon/i,
];

function esErrorReal(msg) {
  return !ERRORES_BENIGNOS.some((patron) => patron.test(msg));
}

test.describe('Red de seguridad E2E — appcda', () => {
  test('Flujo crítico: login + navegación entre vistas sin errores de consola', async ({ page }) => {
    const erroresConsola = [];
    const erroresPagina = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') erroresConsola.push(msg.text());
    });
    page.on('pageerror', (err) => erroresPagina.push(err.message));
    page.on('dialog', async (dialog) => dialog.dismiss());

    // Pre-sembrar IndexedDB con el admin de contraseña conocida ANTES de que corra
    // la app: así inicializarDatosPorDefecto no crea un admin transitorio aleatorio
    // y el login es 100% determinista.
    await page.addInitScript(({ hash }) => {
      return new Promise((resolveSeedo) => {
        const req = indexedDB.open('ControlAutomovilismoDB', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('usuarios')) {
            const store = db.createObjectStore('usuarios', { keyPath: 'id', autoIncrement: true });
            store.createIndex('username', 'username', { unique: true });
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('usuarios', 'readwrite');
          const store = tx.objectStore('usuarios');
          store.put({
            id: 1,
            username: 'admin',
            passwordHash: hash,
            nombre: 'Administrador',
            rol: 'admin',
            activo: true,
            permisos: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            version: 1,
          });
          tx.oncomplete = () => { db.close(); resolveSeedo(); };
          tx.onerror = () => { db.close(); resolveSeedo(); };
        };
        req.onerror = () => resolveSeedo();
      });
    }, { hash: ADMIN_HASH });

    // 1) La pantalla de Login se renderiza
    await page.goto('/');
    await expect(page.locator('#login-screen')).toBeVisible();
    await expect(page.locator('#form-login')).toBeVisible();

    // 2) Simular un inicio de sesión real con credenciales conocidas
    await page.fill('#login-username', 'admin');
    await page.fill('#login-password', PASSWORD);
    await page.click('#login-submit-btn');

    // La app principal debe quedar visible y el dashboard activo
    await expect(page.locator('#app-main')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#view-dashboard')).toHaveClass(/active/, { timeout: 15_000 });

    // 3) Navegar por las vistas principales (solo las que existen en el DOM)
    const vistas = [
      'dashboard', 'competencias', 'gastos', 'staff',
      'estadisticas-personal', 'alojamiento', 'categorias-circuitos', 'configuracion',
    ];

    for (const vid of vistas) {
      const itemMenu = page.locator(`.menu-item[data-view="${vid}"]`);
      if (await itemMenu.count()) {
        await itemMenu.click();
        await page.waitForTimeout(120);
      }
      const vistaEl = page.locator(`#view-${vid}`);
      if (await vistaEl.count()) {
        await expect(vistaEl, `La vista #view-${vid} debería estar activa`).toHaveClass(/active/);
      }
    }

    // 4) Sin excepciones no capturadas ni errores reales en la consola
    const reales = erroresConsola.filter(esErrorReal);
    expect(erroresPagina, `Excepciones JS no capturadas:\n${erroresPagina.join('\n')}`).toEqual([]);
    expect(reales, `Errores de consola:\n${reales.join('\n')}`).toEqual([]);
  });
});