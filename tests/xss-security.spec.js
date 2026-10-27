import { test, expect } from '@playwright/test';

// ============================================================
// SEGURIDAD XSS — S1b verCompetencia() y S1e listarMovimientosInventario()
// ============================================================
// Pruebas de regresión que invocan las funciones REALES de app.js con datos
// aislados (mock de getTodos/obtenerPorId) y verifican el DOM resultante.
// No tocan Firebase ni IndexedDB real: todo se simula en el navegador.

test.describe('XSS S1b/S1e — render real', () => {
  test('S1b: verCompetencia muestra staff malicioso como texto (sin img/script)', async ({ page }) => {
    const erroresPagina = [];
    let dialogDisparado = false;
    page.on('pageerror', (err) => erroresPagina.push(err.message));
    page.on('dialog', async (dialog) => { dialogDisparado = true; await dialog.dismiss(); });

    await page.goto('/');
    await page.waitForFunction(() =>
      typeof window.verCompetencia === 'function' &&
      typeof window.listarMovimientosInventario === 'function');

    await page.evaluate(async () => {
      window.__XSS_EJECUTADO__ = false;
      window.getTodos = async (store) => {
        if (store === 'competencias') return [{ id: 1, nombre: 'Comp Test', circuitoId: 1, categoriasIds: [], staffIds: [1], gastoTotal: null }];
        if (store === 'circuitos') return [{ id: 1, nombre: 'Autodromo', ubicacion: 'Loc' }];
        if (store === 'categorias') return [];
        if (store === 'staff') return [{ id: 1, nombre: '<img src=x onerror=alert(1)>', apellido: 'Apellido', funcion: 'Mecanico' }];
        if (store === 'gastos') return [];
        if (store === 'rendiciones') return [];
        if (store === 'detalleGastos') return [];
        if (store === 'personalCompetencia') return [];
        return [];
      };
      window.obtenerPorId = async (store, id) => {
        if (store === 'competencias' && Number(id) === 1) {
          return { id: 1, nombre: 'Comp Test', circuitoId: 1, categoriasIds: [], staffIds: [1], gastoTotal: null };
        }
        return null;
      };
      window.currentUser = { id: 'e2e', nombre: 'E2E', rol: 'admin', permisos: null };
      window.mostrarToast = () => {};
      document.getElementById('app-main').style.display = 'flex';
      const login = document.getElementById('login-screen');
      if (login) login.style.display = 'none';
      await window.verCompetencia(1);
    });

    const result = await page.evaluate(() => {
      const staff = document.getElementById('ver-comp-staff');
      return {
        imgScriptCount: staff.querySelectorAll('img, script').length,
        spanCount: staff.querySelectorAll('span.tag').length,
        text: staff.textContent,
      };
    });

    expect(result.imgScriptCount, 'Se creó un nodo ejecutable a partir del nombre').toBe(0);
    expect(result.spanCount, 'No se renderizó el span del personal').toBe(1);
    expect(result.text, 'El nombre malicioso no se muestra como texto').toContain('<img src=x onerror=alert(1)>');
    expect(dialogDisparado, 'Se disparó un diálogo (XSS ejecutado)').toBe(false);
    expect(erroresPagina, `Excepciones JS:\\n${erroresPagina.join('\\n')}`).toEqual([]);
  });

  test('S1e: listarMovimientosInventario muestra talle malicioso como texto', async ({ page }) => {
    const erroresPagina = [];
    let dialogDisparado = false;
    page.on('pageerror', (err) => erroresPagina.push(err.message));
    page.on('dialog', async (dialog) => { dialogDisparado = true; await dialog.dismiss(); });

    await page.goto('/');
    await page.waitForFunction(() =>
      typeof window.verCompetencia === 'function' &&
      typeof window.listarMovimientosInventario === 'function');

    await page.evaluate(async () => {
      window.__XSS_EJECUTADO__ = false;
      window.getTodos = async (store) => {
        if (store === 'movimientosInventario') {
          return [{
            id: 1,
            articuloId: 1,
            tipoMovimiento: 'ingreso',
            cantidad: 5,
            fecha: '2026-01-01',
            motivo: 'motivo',
            personaId: null,
            observaciones: '',
            talleId: 1,
          }];
        }
        if (store === 'articulos') return [{ id: 1, nombre: 'Articulo Legitimo' }];
        if (store === 'staff') return [];
        if (store === 'talles') return [{ id: 1, nombre: '<script>alert(1)</script>' }];
        return [];
      };
      window.currentUser = { id: 'e2e', nombre: 'E2E', rol: 'admin', permisos: null };
      window.mostrarToast = () => {};
      window.esAdmin = () => true;
      document.getElementById('app-main').style.display = 'flex';
      const login = document.getElementById('login-screen');
      if (login) login.style.display = 'none';
      await window.listarMovimientosInventario();
    });

    const result = await page.evaluate(() => {
      const container = document.getElementById('movimientos-list');
      return {
        imgScriptCount: container.querySelectorAll('img, script').length,
        text: container.textContent,
        html: container.innerHTML,
      };
    });

    expect(result.imgScriptCount, 'Se creó un nodo ejecutable a partir del talle').toBe(0);
    expect(result.text, 'El talle malicioso no se muestra como texto').toContain('<script>alert(1)</script>');
    expect(result.text, 'El nombre legítimo del artículo no se muestra').toContain('Articulo Legitimo');
    expect(dialogDisparado, 'Se disparó un diálogo (XSS ejecutado)').toBe(false);
    expect(erroresPagina, `Excepciones JS:\\n${erroresPagina.join('\\n')}`).toEqual([]);
  });
});
