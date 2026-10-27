import { test, expect } from '@playwright/test';

test.describe('Etapa 2 — regresión de helpers en app.js', () => {
  test('calcularStockArticulo conserva el cálculo original', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => typeof window.calcularStockArticulo === 'function');

    const resultados = await page.evaluate(() => {
      const helper = window.calcularStockArticulo;
      return {
        tallesSuma: helper({ id: 1, controlaTalles: true }, [
          { articuloId: 1, stock: 2 },
          { articuloId: 2, stock: 9 },
          { articuloId: 1, stock: '3' },
        ]),
        tallesVacio: helper({ id: 1, controlaTalles: true }, []),
        sinTalles: helper({ id: 2, controlaTalles: false, stockUnico: 5 }, []),
        stockUnicoCero: helper({ id: 3, controlaTalles: false, stockUnico: 0 }, []),
        stockUnicoNull: helper({ id: 4, controlaTalles: false, stockUnico: null }, []),
        stockUnicoString: helper({ id: 5, controlaTalles: false, stockUnico: '7' }, []),
        talleStockNull: helper({ id: 6, controlaTalles: true }, [{ articuloId: 6, stock: null }]),
      };
    });

    expect(resultados.tallesSuma).toBe(5);
    expect(resultados.tallesVacio).toBe(0);
    expect(resultados.sinTalles).toBe(5);
    expect(resultados.stockUnicoCero).toBe(0);
    expect(resultados.stockUnicoNull).toBe(0);
    expect(resultados.stockUnicoString).toBe(7);
    expect(resultados.talleStockNull).toBe(0);
  });

  test('marcarDetallesModificados conserva efectos secundarios', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => typeof window.marcarDetallesModificados === 'function');

    const resultado = await page.evaluate(() => {
      window.__renderCalled = false;
      window.renderizarDetalleGastos = () => { window.__renderCalled = true; };
      eval('detallesModificados = false;');
      const el = document.getElementById('cambios-sin-guardar');
      if (el) el.style.display = 'none';
      window.marcarDetallesModificados();
      return {
        detallesModificados: eval('detallesModificados'),
        display: el ? el.style.display : null,
        renderCalled: window.__renderCalled,
      };
    });

    expect(resultado.detallesModificados).toBe(true);
    expect(resultado.display).toBe('inline-flex');
    expect(resultado.renderCalled).toBe(true);
  });
});
