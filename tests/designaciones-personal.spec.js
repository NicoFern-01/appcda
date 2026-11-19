import { test, expect } from '@playwright/test';

async function prepararModulo(page, query = '', rol = 'admin') {
  const mes = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  await page.goto(`/${query}`);
  await page.waitForFunction(() => !!window.__CDA_MODULES__?.designacionesPersonal);
  if (query) await expect(page.locator('#login-screen')).toBeVisible();

  await page.evaluate(({ mesActual, rolActual }) => {
    const datos = {
      competencias: [{
        id: 'comp-1',
        nombre: 'Competencia E2E',
        fechaInicio: `${mesActual}-15`,
        fechaFin: `${mesActual}-16`,
        circuitoId: 'circuito-1',
        categoriasIds: ['categoria-1']
      }],
      staff: [{ id: 'staff-1', nombre: 'Ana', apellido: 'Prueba', funcion: 'Técnico', activo: true }],
      designacionesPersonal: rolActual === 'viewer'
        ? [{ id: 'designation-1', competenciaId: 'comp-1', staffId: 'staff-1', funcion: 'Técnico' }]
        : [],
      circuitos: [{ id: 'circuito-1', nombre: 'Autódromo E2E', ubicacion: 'Ciudad' }],
      categorias: [{ id: 'categoria-1', nombre: 'Turismo' }],
      listaCorreosDesignaciones: []
    };
    let secuencia = 0;
    const persistencia = window.__CDA_MODULES__.persistencia;
    persistencia.getTodos = async (store) => datos[store] || [];
    persistencia.guardar = async (store, item) => {
      item.id = `mock-${++secuencia}`;
      if (!datos[store]) datos[store] = [];
      datos[store].push({ ...item });
      return item.id;
    };
    persistencia.eliminar = async (store, id) => {
      datos[store] = (datos[store] || []).filter((item) => String(item.id) !== String(id));
    };
    window.__designacionesFixture = datos;
    window.__designacionesMessages = [];
    window.mostrarToast = (mensaje, tipo) => window.__designacionesMessages.push({ mensaje, tipo });
    const permisos = rolActual === 'viewer'
      ? { 'designaciones-personal': { ver: true } }
      : null;
    window.currentUser = { id: 'e2e', nombre: 'E2E', rol: rolActual, permisos };
    window.__CDA_MODULES__.vistas.renderizarMenuLateral(window.currentUser);
    if (queryVista()) {
      window.__CDA_MODULES__.auth.iniciarSesion(window.currentUser);
    } else {
      document.getElementById('login-screen').style.display = 'none';
      document.getElementById('app-main').style.display = 'flex';
      window.__CDA_MODULES__.vistas.switchView('designaciones-personal');
    }

    function queryVista() {
      return new URLSearchParams(window.location.search).get('vista') === 'designaciones-personal';
    }
  }, { mesActual: mes, rolActual: rol });
  return mes;
}

test.describe('Designación de Personal', () => {
  test('aplica el deep-link tras iniciar sesión y evita duplicar una asignación', async ({ page }) => {
    const mes = await prepararModulo(page, '?vista=designaciones-personal&competenciaId=comp-1');

    await expect(page.locator('#view-designaciones-personal')).toHaveClass(/active/);
    await expect(page.locator('#designaciones-mes')).toHaveValue(mes);
    await expect(page.locator('#designaciones-competencia')).toHaveValue('comp-1');
    await expect(page.locator('.designacion-card')).toContainText('Ana Prueba');

    const formulario = page.locator('.designaciones-assign-form');
    await formulario.locator('select').selectOption('staff-1');
    await formulario.locator('input').fill('Comisaria Deportiva');
    await formulario.locator('button[type="submit"]').click();
    await expect(page.locator('.designacion-staff-row')).toHaveCount(1);
    await expect(page.locator('.designacion-staff-row')).toContainText('Comisaria Deportiva');

    const formularioActualizado = page.locator('.designaciones-assign-form');
    await formularioActualizado.locator('select').selectOption('staff-1');
    await formularioActualizado.locator('button[type="submit"]').click();
    await expect(page.locator('.designacion-staff-row')).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => window.__designacionesMessages.at(-1)?.mensaje))
      .toContain('ya está asignada');

    await page.locator('.designaciones-mail-panel > summary').click();
    await page.fill('#designaciones-email', 'correo-invalido');
    await page.locator('#designaciones-email-form button[type="submit"]').click();
    await expect.poll(() => page.evaluate(() => window.__designacionesMessages.at(-1)?.mensaje))
      .toContain('email válida');

    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (texto) => { window.__designacionesCopied = texto; } }
      });
    });
    await page.fill('#designaciones-email', 'staff@example.com');
    await page.fill('#designaciones-email-label', 'Equipo');
    await page.locator('#designaciones-email-form button[type="submit"]').click();
    await expect(page.locator('#designaciones-email-list')).toContainText('Equipo · staff@example.com');

    await page.locator('[data-action="copy-competition"]').click();
    await expect.poll(() => page.evaluate(() => window.__designacionesCopied))
      .toContain('competenciaId=comp-1');
    await page.locator('[data-action="copy-month"]').click();
    await expect.poll(() => page.evaluate(() => window.__designacionesCopied))
      .toContain('mes=');
  });

  test('el Viewer ve las designaciones sin controles de escritura o correo', async ({ page }) => {
    await prepararModulo(page, '', 'viewer');

    await expect(page.locator('.designacion-card')).toContainText('Ana Prueba');
    await expect(page.locator('.designaciones-assign-form')).toHaveCount(0);
    await expect(page.locator('[data-action="mail-month"]')).toBeHidden();
    await expect(page.locator('.designaciones-mail-panel')).toBeHidden();
    await expect(page.locator('[data-action="mail-competition"]')).toHaveCount(0);
  });

  test('los permisos antiguos reciben la matriz nueva por defecto sin cambiar permisos explícitos', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!window.PermisosUtil);
    const permisos = await page.evaluate(() => {
      const { normalizarPermisos } = window.PermisosUtil;
      return {
        editorAntiguo: normalizarPermisos('editor', { dashboard: { ver: true } })['designaciones-personal'],
        supervisor: normalizarPermisos('supervisor', {})['designaciones-personal'],
        viewer: normalizarPermisos('viewer', {})['designaciones-personal'],
        editorRestringido: normalizarPermisos('editor', {
          'designaciones-personal': { ver: true, crear: false, editar: false, eliminar: false }
        })['designaciones-personal']
      };
    });

    expect(permisos.editorAntiguo).toEqual({ ver: true, crear: true, editar: true, eliminar: true });
    expect(permisos.supervisor).toEqual({ ver: true, crear: true, editar: true, eliminar: true });
    expect(permisos.viewer).toEqual({ ver: true, crear: false, editar: false, eliminar: false });
    expect(permisos.editorRestringido).toEqual({ ver: true, crear: false, editar: false, eliminar: false });
  });
});
