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

  test('El menú principal dibuja cada ítem en una sola fila y no queda cortado', async ({ page }) => {
    await prepararMenu(page);

    // 1) Cada ítem de NIVEL 1 se renderiza en un único renglón (1 line box):
    //    antes, etiquetas largas ("Categorías y Circuitos") se partían en dos.
    const renglones = await page.locator('#menu-list .menu-item:not(.submenu-item) > span').evaluateAll(
      (spans) => spans.map((s) => s.getClientRects().length)
    );
    expect(renglones.length).toBeGreaterThan(0);
    expect(Math.max(...renglones), 'Algún ítem del menú principal ocupa más de un renglón').toBe(1);

    // 2) Con el menú COLAPSADO (estado inicial) ningún ítem de nivel 1 queda cortado.
    const colapsado = await page.evaluate(() => {
      const items = [...document.querySelectorAll('#menu-list > li > .menu-item, #menu-list > .menu-item')]
        .filter((el) => el.offsetHeight > 0);
      const ultimo = items[items.length - 1];
      return {
        items: items.length,
        fondo: Math.round(ultimo.getBoundingClientRect().bottom),
        ventana: window.innerHeight,
      };
    });
    expect(colapsado.fondo, `El último ítem del menú (${colapsado.fondo}px) supera la ventana (${colapsado.ventana}px)`).toBeLessThanOrEqual(colapsado.ventana);

    // 3) Al desplegar TODOS los grupos el contenido puede pasar de la ventana,
    //    pero el sidebar debe hacer SCROLL en lugar de recortar los ítems.
    for (const grupo of GRUPOS) {
      await page.locator(`#${grupo.padre}`).click();
      await expect(page.locator(`#${grupo.submenu}`)).not.toHaveClass(/collapsed/);
    }

    const listado = await page.locator('#menu-list').evaluate((el) => ({
      overflowY: getComputedStyle(el).overflowY,
      scrollable: el.scrollHeight > el.clientHeight,
      puedoBajar: el.scrollHeight - el.clientHeight,
    }));
    if (listado.scrollable) {
      expect(['auto', 'scroll'], 'El menú recorta su contenido en vez de hacer scroll').toContain(listado.overflowY);
    }

    // Los ítems de nivel 1 siguen en una sola fila aun con todo desplegado.
    const renglonesAbiertos = await page.locator('#menu-list .menu-item:not(.submenu-item) > span').evaluateAll(
      (spans) => spans.map((s) => s.getClientRects().length)
    );
    expect(Math.max(...renglonesAbiertos)).toBe(1);
  });

  test('Pilotos > Penalidades: submenú, planilla y alta de registro con PDF adjunto', async ({ page }) => {
    const erroresPagina = [];
    page.on('pageerror', (err) => erroresPagina.push(err.message));
    await prepararMenu(page);

    // 1) El submenú de Pilotos ahora tiene DOS hijos.
    const items = await page.locator('#submenu-pilotos .submenu-item').allTextContents();
    expect(items).toEqual(['Listado de Pilotos', 'Penalidades']);

    // 2) Navegación a la vista y campos esperados de la planilla.
    await page.locator('#menu-pilotos').click();
    await page.locator('.submenu-item[data-view="penalidades"]').click();
    await expect(page.locator('#view-penalidades')).toHaveClass(/active/);
    await expect(page.locator('#view-penalidades .page-title')).toHaveText('Penalidades');

    const campos = [
      'penalidad-nombre', 'penalidad-apellido', 'penalidad-dni', 'penalidad-auto',
      'penalidad-categoria', 'penalidad-sancion', 'penalidad-motivo',
      'penalidad-fecha-inicio', 'penalidad-fecha-fin', 'penalidad-adjuntos',
    ];
    for (const id of campos) {
      await expect(page.locator(`#${id}`), `Falta el campo #${id}`).toHaveCount(1);
    }
    // Sanción: input de TEXTO LIBRE con datalist (ya no es un <select> cerrado).
    await expect(page.locator('#penalidad-sancion')).toHaveAttribute('list', 'tipos-sancion');
    await expect(page.locator('#tipos-sancion option')).not.toHaveCount(0);
    await expect(page.locator('#penalidad-adjuntos')).toHaveAttribute('multiple', /.?/);
    await expect(page.locator('#penalidad-adjuntos')).toHaveAttribute('accept', /pdf/);

    // Layout: los 8 campos básicos deben caber en UN solo renglón.
    const tops = await page.evaluate(() => {
      const ids = [
        'penalidad-nombre', 'penalidad-apellido', 'penalidad-dni', 'penalidad-auto',
        'penalidad-categoria', 'penalidad-sancion', 'penalidad-fecha-inicio', 'penalidad-fecha-fin',
      ];
      return ids.map((id) => Math.round(document.getElementById(id).getBoundingClientRect().top));
    });
    expect(new Set(tops).size, `Los campos no quedaron en un solo renglón (tops: ${tops.join(', ')})`).toBe(1);

    // 3) Ruedita: gestión del catálogo de tipos de sanción (alta).
    await page.locator('#form-penalidad .gear-btn').click();
    await expect(page.locator('#subModalTiposSancion')).toHaveClass(/active/);
    await page.fill('#nuevo-tipo-sancion', 'Prueba de tipo X');
    await page.locator('#form-nuevo-tipo-sancion button[type="submit"]').click();
    await expect(page.locator('#lista-tipos-sancion')).toContainText('Prueba de tipo X');
    await expect(page.locator('#tipos-sancion option[value="Prueba de tipo X"]')).toHaveCount(1);

    // 3b) Edición (mismo camino que siguen los tipos por defecto del catálogo).
    await page.locator('#lista-tipos-sancion > div', { hasText: 'Prueba de tipo X' })
      .locator('button[title="Editar tipo"]').click();
    await expect(page.locator('#nuevo-tipo-sancion')).toHaveValue('Prueba de tipo X');
    await expect(page.locator('#nuevo-tipo-sancion-cancel')).toBeVisible();
    await page.fill('#nuevo-tipo-sancion', 'Prueba de tipo X renombrado');
    await page.locator('#form-nuevo-tipo-sancion button[type="submit"]').click();
    await expect(page.locator('#lista-tipos-sancion')).toContainText('Prueba de tipo X renombrado');
    await expect(page.locator('#tipos-sancion option[value="Prueba de tipo X renombrado"]')).toHaveCount(1);

    // 3c) Los tipos POR DEFECTO (seed V14) también vienen con Editar y Eliminar.
    const opciones = await page.locator('#tipos-sancion option').allTextContents();
    if (opciones.includes('Advertencia')) {
      const filaPorDefecto = page.locator('#lista-tipos-sancion > div', { hasText: 'Advertencia' });
      await expect(filaPorDefecto.locator('button[title="Editar tipo"]')).toHaveCount(1);
      await expect(filaPorDefecto.locator('button[title="Eliminar tipo"]')).toHaveCount(1);
    }

    // 3d) Eliminación con el modal de confirmación propio de la app.
    await page.locator('#lista-tipos-sancion > div', { hasText: 'Prueba de tipo X renombrado' })
      .locator('button[title="Eliminar tipo"]').click();
    await expect(page.locator('#modal-alerta')).toHaveClass(/active/);
    await page.locator('#alerta-btn-confirmar').click();
    await expect(page.locator('#lista-tipos-sancion')).not.toContainText('Prueba de tipo X renombrado');
    await expect(page.locator('#tipos-sancion option[value="Prueba de tipo X renombrado"]')).toHaveCount(0);

    await page.locator('#subModalTiposSancion .modal-close').click();
    await expect(page.locator('#subModalTiposSancion')).not.toHaveClass(/active/);

    // 4) Completar la planilla (Sanción con TEXTO LIBRE, fuera del catálogo).
    await page.fill('#penalidad-nombre', 'Juan');
    await page.fill('#penalidad-apellido', 'Pérez');
    await page.fill('#penalidad-dni', '30123456');
    await page.fill('#penalidad-auto', '12');
    await page.fill('#penalidad-categoria', 'TC2000');
    await page.fill('#penalidad-sancion', 'Suspensión de 2 fechas');
    await page.fill('#penalidad-motivo', 'Causó un contacto en la salida y dañó a un tercero.');
    await page.fill('#penalidad-fecha-inicio', '2026-04-10');
    await page.fill('#penalidad-fecha-fin', '2026-04-20');

    // 5) Adjuntar un PDF (se valida tipo y se previsualiza en la lista).
    await page.setInputFiles('#penalidad-adjuntos', {
      name: 'acta-infraccion.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF'),
    });
    await page.locator('#form-penalidad button:has-text("Adjuntar")').click();
    await expect(page.locator('#penalidad-adjuntos-list')).toContainText('acta-infraccion.pdf');

    // 6) Guardar: el registro debe aparecer en el listado con su PDF y fechas.
    await page.locator('#penalidad-btn-guardar').click();
    await expect(page.locator('#penalidades-table-body tr')).toHaveCount(1);
    await expect(page.locator('#penalidades-table-body')).toContainText('Juan Pérez');
    await expect(page.locator('#penalidades-table-body')).toContainText('Suspensión de 2 fechas');
    await expect(page.locator('#penalidades-table-body')).toContainText('10/04/2026');
    await expect(page.locator('#penalidades-table-body')).toContainText('20/04/2026');
    await expect(page.locator('#penalidades-table-body button[title^="Abrir PDF"]')).toHaveCount(1);

    // 7) El formulario se limpia para la próxima carga.
    await expect(page.locator('#penalidad-nombre')).toHaveValue('');
    await expect(page.locator('#penalidad-adjuntos-list')).toContainText('Sin archivos adjuntos.');

    expect(erroresPagina, `Excepciones JS:\n${erroresPagina.join('\n')}`).toEqual([]);
  });
});
