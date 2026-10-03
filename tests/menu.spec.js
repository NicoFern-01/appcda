import { test, expect } from '@playwright/test';

// ============================================================
// MENÚ LATERAL — alternancia de submenús (regresión)
// ============================================================
// Bug cubierto: al hacer clic en un menú PADRE, el submenú se cerraba y
// `switchView(vistaPadre)` lo volvía a abrir de inmediato, dejando el grupo
// (p. ej. "Personal") imposible de contraer, a diferencia de los demás.
//
// No requiere credenciales ni red: el menú se renderiza con un usuario admin
// de prueba y las cargas de datos de cada vista se neutralizan con stubs.
const GRUPOS = [
  { padre: 'menu-gastos',     submenu: 'submenu-gastos',     vista: 'gastos' },
  { padre: 'menu-personal',   submenu: 'submenu-personal',   vista: 'staff' },
  { padre: 'menu-pilotos',    submenu: 'submenu-pilotos',    vista: 'pilotos' },
  { padre: 'menu-inventario', submenu: 'submenu-inventario', vista: 'inventario' },
];

// Cargadores que `cargarDatosVista` invoca al navegar (evitan IndexedDB/red).
const CARGADORES = [
  'renderDashboard', 'cargarYParsearCalendario', 'listarCompetencias', 'listarGastos',
  'listarRendiciones', 'cargarPersonalCompetencia', 'renderDashboardInventario',
  'listarArticulos', 'listarMovimientosInventario', 'listarCategoriasInventario',
  'listarEntregas', 'listarStaff', 'listarEstadisticasPersonal', 'listarAlojamientos',
  'listarCategoriasCircuitos', 'listarConfiguraciones',
];

/** Carga la app, muestra el shell y pinta el menú con un admin de prueba. */
async function prepararMenu(page) {
  const erroresPagina = [];
  page.on('pageerror', (err) => erroresPagina.push(err.message));

  await page.goto('/');
  await page.waitForFunction(() => typeof window.__CDA_MODULES__?.vistas?.renderizarMenuLateral === 'function');

  await page.evaluate((cargadores) => {
    cargadores.forEach((fn) => { window[fn] = async () => {}; });
    window.mostrarToast = () => {};

    document.getElementById('app-main').style.display = 'flex';
    // La pantalla de login queda encima y intercepta los clics: se oculta
    // (la app real la elimina al autenticarse).
    const login = document.getElementById('login-screen');
    if (login) login.style.display = 'none';
    const usuario = { id: 'e2e-menu', nombre: 'E2E', rol: 'admin', permisos: null };
    window.currentUser = usuario;
    window.__CDA_MODULES__.vistas.renderizarMenuLateral(usuario);
  }, CARGADORES);

  return erroresPagina;
}

test.describe('Menú lateral — submenús desplegables', () => {
  test('Los grupos desplegables se expanden y vuelven a contraer con el clic en el padre', async ({ page }) => {
    const erroresPagina = await prepararMenu(page);

    for (const grupo of GRUPOS) {
      const padre = page.locator(`#${grupo.padre}`);
      const submenu = page.locator(`#${grupo.submenu}`);

      await expect(padre, `Falta el padre #${grupo.padre}`).toHaveCount(1);
      await expect(submenu, `Falta el submenú #${grupo.submenu}`).toHaveCount(1);

      // Estado inicial: contraído.
      await expect(submenu, `#${grupo.submenu} debería iniciar contraído`).toHaveClass(/collapsed/);

      // 1) Clic => expande y navega a la vista padre.
      await padre.click();
      await expect(submenu, `#${grupo.submenu} no se expandió`).not.toHaveClass(/collapsed/);
      await expect(padre).toHaveClass(/expanded/);
      await expect(page.locator(`#view-${grupo.vista}`)).toHaveClass(/active/);

      // 2) Segundo clic => CONTRAE (aquí fallaba "Personal").
      await padre.click();
      await expect(submenu, `#${grupo.submenu} no se pudo contraer`).toHaveClass(/collapsed/);
      await expect(padre).not.toHaveClass(/expanded/);

      // 3) Y vuelve a expandirse.
      await padre.click();
      await expect(submenu, `#${grupo.submenu} no volvió a expandirse`).not.toHaveClass(/collapsed/);
    }

    expect(erroresPagina, `Excepciones JS:\n${erroresPagina.join('\n')}`).toEqual([]);
  });

  test('Navegar a una vista HIJA sí abre su submenú y la marca activa', async ({ page }) => {
    await prepararMenu(page);

    // La vista hija de "Personal" debe abrir su submenú al activarse.
    await page.evaluate(() => window.__CDA_MODULES__.vistas.switchView('estadisticas-personal'));

    await expect(page.locator('#submenu-personal')).not.toHaveClass(/collapsed/);
    await expect(page.locator('#menu-personal')).toHaveClass(/expanded/);
    await expect(page.locator('#view-estadisticas-personal')).toHaveClass(/active/);
    await expect(page.locator('.submenu-item[data-view="estadisticas-personal"]')).toHaveClass(/active/);

    // Contraer el padre desde el submenú abierto también debe funcionar.
    await page.locator('#menu-personal').click();
    await expect(page.locator('#submenu-personal')).toHaveClass(/collapsed/);
  });

  test('El grupo "Pilotos" queda debajo de "Personal" y navega a su vista placeholder', async ({ page }) => {
    await prepararMenu(page);

    // 1) Orden físico exacto del menú (según `orden` de CATALOGO_MODULOS).
    //    Los grupos son un <li> sin id: el id (menu-*) vive en su <div> hijo.
    const secuencia = await page.locator('#menu-list').evaluate((el) =>
      [...el.children].map((c) => {
        const item = c.matches('.menu-item') ? c : c.querySelector('.menu-item');
        return item?.id || `view:${item?.dataset?.view}`;
      })
    );
    expect(secuencia).toEqual([
      'view:dashboard', 'view:calendario', 'view:competencias',
      'menu-gastos', 'menu-inventario', 'menu-personal',
      'menu-pilotos',                      // ← nuevo, justo debajo de Personal
      'view:alojamiento', 'view:categorias-circuitos', 'view:configuracion',
    ]);

    // 2) Icono y chevron: mismo markup que los demás grupos desplegables.
    const icono = page.locator('#menu-pilotos > i').first();
    await expect(icono).toHaveClass(/fa-id-card/);
    await expect(page.locator('#menu-pilotos .submenu-chevron')).toHaveCount(1);

    // 3) Clic en el padre: expande el submenú y activa la vista padre.
    await page.locator('#menu-pilotos').click();
    await expect(page.locator('#submenu-pilotos')).not.toHaveClass(/collapsed/);
    await expect(page.locator('#view-pilotos')).toHaveClass(/active/);

    // 4) El hijo "Listado de Pilotos" navega a su placeholder.
    await page.locator('.submenu-item[data-view="listado-pilotos"]').click();
    await expect(page.locator('#view-listado-pilotos')).toHaveClass(/active/);
    await expect(page.locator('#view-listado-pilotos .page-title')).toHaveText('Listado de Pilotos');
    await expect(page.locator('.submenu-item[data-view="listado-pilotos"]')).toHaveClass(/active/);

    // 5) El grupo también se puede contraer (misma regla que los demás).
    await page.locator('#menu-pilotos').click();
    await expect(page.locator('#submenu-pilotos')).toHaveClass(/collapsed/);
  });
});
