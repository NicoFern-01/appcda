// src/views/index.js
// ============================================================
// AGREGADOR DE VISTAS (FASE 2).
// Registro central de las 16 vistas + login. Cada adaptador adopta hoy la
// sección DOM existente del index.html (sin duplicar ids ni alterar el CSS).
// Esto deja listo el desacople: en la próxima fase cada entrada podrá
// apuntar a un HTML/JS propio sin cambiar un solo id/clase.
// ============================================================

const VIEW_IDS = [
  'login',
  'dashboard',
  'calendario',
  'competencias',
  'gastos',
  'carga-detallada',
  'personal-competencia',
  'inventario',
  'articulos',
  'movimientos-inventario',
  'categorias-inventario',
  'entregas-inventario',
  'staff',
  'estadisticas-personal',
  'alojamiento',
  'categorias-circuitos',
  'configuracion'
];

function adoptarVista(id) {
  const containerId = id === 'login' ? 'login-screen' : `view-${id}`;
  return {
    id,
    containerId,
    mount(container) {
      const el = document.getElementById(containerId);
      if (!el) return null; // la vista aún no tiene sección (no rompe nada)
      if (container && el !== container && !container.contains(el)) container.appendChild(el);
      if (id !== 'login') el.classList.add('active');
      return el;
    },
    unmount() {
      const el = document.getElementById(containerId);
      if (el && id !== 'login') el.classList.remove('active');
      return true;
    },
  };
}

/** Mapa { id -> adaptador } listo para router.registerView(id, () => vista). */
export const views = Object.freeze(
  Object.fromEntries(VIEW_IDS.map((id) => [id, adoptarVista(id)]))
);

export const VIEW_IDS_LIST = Object.freeze([...VIEW_IDS]);

export default views;