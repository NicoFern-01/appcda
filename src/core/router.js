// src/core/router.js
// ============================================================
// ENRUTADOR / SISTEMA DE CARGA DINÁMICA DE VISTAS (FASE 2).
//
// El index.html actual  contiene las 16 vistas estáticas (secciones
// <div id="view-...">) y la pantalla de login. En lugar de romper ese
// DOM (regla de oro), este router define el CONTRATO de desacople:
//   1) Se registran "adapters" por id de vista (módulos en /src/views/).
//   2) Cada adapter EXPORTA una función `mount(container)` que materializa
//      la vista DOM (hoy adopta la sección existente #view-<id>; en fases
//      futuras, renderiza HTML/JS independientes sin tocar clases/IDs).
//   3) `navigate(id)` resuelve el adapter y monta/desmonta sin recargar.
//
// Es ADITIVO: hoy no sustituye a switchView() de app.js (eso acarrearía
// regresión). Simplemente queda listo y expuesto para la migración.
// ============================================================

/** IDs de las 16 vistas + la pantalla de login. Coinciden con const `views` de app.js. */
export const VIEW_IDS = [
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

/** Registro interno { id -> loader() } */
const registry = new Map();

/** Monta la sección DOM nativa existente para una vista (modo "adoptar"). */
function adoptExistingDom(viewId) {
  return {
    viewId,
    containerId: viewId === 'login' ? 'login-screen' : `view-${viewId}`,
    mount(container) {
      const el = document.getElementById(this.containerId);
      if (!el) return null; // la vista aún no tiene sección en el HTML (no rompe nada)
      if (container && el !== container && !container.contains(el)) {
        container.appendChild(el);
      }
      el.classList.add('active');
      return el;
    },
    unmount(container) {
      const el = document.getElementById(this.containerId);
      if (el) el.classList.remove('active');
    }
  };
}

/**
 * Registra una vista. `loader` devuelve un objeto con mount/unmount.
 * Si no se provee, se usa el adapter por defecto que adopta #view-<id>.
 */
export function registerView(id, loader) {
  registry.set(id, loader || (() => adoptExistingDom(id)));
}

/**
 * Navega a una vista resolviendo su adapter de forma dinámica (import
 * diferido). Emite un CustomEvent 'cda:route' (no interfiere con app.js).
 */
export async function navigate(viewId, container) {
  const loader = registry.get(viewId) || (() => adoptExistingDom(viewId));
  const view = await loader();
  if (container) {
    // desmontar vistas previas
    registry.forEach((otherLoader, otherId) => {
      if (otherId !== viewId && typeof otherLoader._mounted !== 'undefined') {
        // placeholder; la gestión real de desmonte se hace en la fase siguiente
      }
    });
    view.mount(container);
  }
  document.dispatchEvent(new CustomEvent('cda:route', { detail: { viewId } }));
  return view;
}

/** Devuelve todas las vistas registradas (para debugging/migración). */
export function getRegisteredViews() {
  return Array.from(registry.keys());
}

// Pre-registrar adapters por defecto de TODAS las vistas (no rompe nada:
// solo resuelven el DOM existente si alguien invoca navigate()).
VIEW_IDS.forEach((id) => registerView(id));

export default { VIEW_IDS, registerView, navigate, getRegisteredViews };