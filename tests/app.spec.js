import { test, expect } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';

// ============================================================
// CREDENCIALES E2E — LEIDAS DEL ENTORNO, NUNCA DEL CÓDIGO NI DEL BUNDLE
// ============================================================
//-origen: variables SIN prefijo `VITE_` definidas en .env (ver .env.example).
// Al no llevar el prefijo `VITE_`, Vite NO las inyecta en el bundle del navegador,
// por lo que la contraseña de pruebas jamás aparece en dist/ (producción).
//
// Requisitos: levantá el harness con las variables presentes, por ejemplo
//   npx playwright test --workers=1
// tras exportarlas en tu shell, o con `dotenv`/`.env` leído por tu runner.
const E2E_USER = (process.env.CDA_E2E_USER || '').trim();
const E2E_PASSWORD = process.env.CDA_E2E_PASSWORD || '';

// Falla ruidosamente y ANTES de levantar el navegador si falta la configuración,
// en lugar de reportar un falso "PASS" por un login que nunca ocurrió.
test.skip(
  !E2E_USER || !E2E_PASSWORD,
  'Faltan CDA_E2E_USER / CDA_E2E_PASSWORD en el entorno (ver .env). No se ejecutan pruebas E2E.'
);

/**
 * Replica el formato de hash local de db.js: `sha256$<saltHex>$<sha256(salt+pass)>`.
 * El salt se genera en runtime para que el par usuario/contraseña no deje ninguna
 * credencial derivada (ni siquiera un hash reutilizable) en el repositorio.
 */
function hashLocalmente(password) {
  const saltHex = randomBytes(16).toString('hex');
  const hash = createHash('sha256').update(saltHex + password, 'utf8').digest('hex');
  return `sha256$${saltHex}$${hash}`;
}

// El hash se calcula en runtime, no se versiona.
const ADMIN_HASH = hashLocalmente(E2E_PASSWORD);

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
  // ⚠ TEST DESACTIVADO TEMPORALMENTE — MUTABA PRODUCCIÓN ⚠
  // El `test.skip` real va DENTRO del cuerpo de este test (ver abajo). Si se
  // declarara a nivel de `describe`, Playwright lo aplicaria a TODOS los tests
  // del bloque, incluido el de regresión XSS, que debe seguir ejecutándose.
  //
  // MOTIVO (auditoría de seguridad):
  // Este test NO era un test de humo: la app real, al recibir
  // `auth/invalid-credential` de Firebase Auth, dispara el rescate
  // `intentarMigrarCuentaLocal()` (src/services/authService.js:401), que
  // CREA la cuenta en Firebase Auth de PRODUCCIÓN con la contraseña del
  // entorno y escribe su perfil en Firestore.
  //
  // Consecuencia: cada ejecución MUTABA la cuenta real
  // admin@controlcda.com. No era idempotente y, al reintentarse, quedaba en
  // un estado inconsistente (credencial en la nube distinta de la del test),
  // lo que hacia fallar el login de forma reproducible.
  //
  // Se desactiva para dejar de alterar la cuenta del administrador real.
  // No se borra: es la red de seguridad del flujo de login.
  //
  // REACTIVACION SEGURA: usar el emulador de Firebase (o credenciales de una
  // cuenta de pruebas real sembrada en Firestore), NUNCA contra la cuenta del
  // administrador de producción.
  test('Flujo crítico: login + navegación entre vistas sin errores de consola', async ({ page }) => {
    test.skip(true,
      'DESACTIVADO: este test mutaba la cuenta real de Firebase Auth en produccion ' +
      '(migracion local -> createUserWithEmailAndPassword). Reactivar con emulador de Firebase.');

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
    await page.addInitScript(({ hash, username }) => {
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
            username: username,
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
    }, { hash: ADMIN_HASH, username: E2E_USER });

    // 1) La pantalla de Login se renderiza
    await page.goto('/');
    await expect(page.locator('#login-screen')).toBeVisible();
    await expect(page.locator('#form-login')).toBeVisible();

    // 2) Simular un inicio de sesión real con credenciales conocidas
    await page.fill('#login-username', E2E_USER);
    await page.fill('#login-password', E2E_PASSWORD);
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

  // ==============================================================
  // REGRESION XSS — mostrarToast() (HALLazgo 5)
  // ==============================================================
  // Verifica que un mensaje con markup malicioso se renderice como TEXTO
  // LITERAL (sin crear nodos ni disparar el payload) y que la maqueta del
  // toast (clase + icono Font Awesome) se conserve identica.
  test('XSS: mostrarToast escapa el payload y conserva el diseno', async ({ page }) => {
    const erroresPagina = [];
    page.on('pageerror', (err) => erroresPagina.push(err.message));
    page.on('dialog', async (dialog) => dialog.dismiss());

    // Imprescindible navegar: `mostrarToast` vive en app.js (script clásico) y
    // solo existe una vez cargada la pagina. Sin este goto, `page.evaluate`
    // corre en un documento vacio y la funcion no esta definida.
    await page.goto('/');
    await expect(page.locator('#login-screen')).toBeVisible();

    const payload = `<img src=x onerror="window.__XSS_EJECUTADO__=true"><script>window.__XSS_EJECUTADO__=true</script>`;

    // Se inyecta la funcion real de la app y se invoca con el payload.
    const resultado = await page.evaluate((mensaje) => {
      window.__XSS_EJECUTADO__ = false;
      mostrarToast(mensaje, 'success');

      const toast = document.querySelector('.toast.toast-success');
      if (!toast) return { encontrado: false };

      return {
        encontrado: true,
        // El payload NO debe haber creado elementos: todo debe ser texto.
        sinImgInyectada: toast.querySelectorAll('img, script').length === 0,
        textoLiteral: toast.textContent.includes('<img src=x'),
        // Paridad visual: la clase y el icono se siguen generando.
        tieneIcono: !!toast.querySelector('i.fa-check-circle'),
        claseCorrecta: toast.classList.contains('toast') && toast.classList.contains('toast-success'),
        ejecutoPayload: window.__XSS_EJECUTADO__ === true,
      };
    }, payload);

    expect(resultado.encontrado, 'No se genero el toast').toBe(true);
    expect(resultado.sinImgInyectada, 'El payload creo nodos en el DOM (XSS)').toBe(true);
    expect(resultado.textoLiteral, 'El mensaje no se mostro como texto literal').toBe(true);
    expect(resultado.tieneIcono, 'Se perdio el icono Font Awesome del toast').toBe(true);
    expect(resultado.claseCorrecta, 'Se perdieron las clases CSS del toast').toBe(true);
    expect(resultado.ejecutoPayload, 'El payload XSS se ejecutó').toBe(false);
    expect(erroresPagina, `Excepciones JS:\n${erroresPagina.join('\n')}`).toEqual([]);
  });
});