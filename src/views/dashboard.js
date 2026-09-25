// src/views/dashboard.js
// ============================================================
// Vista DASHBOARD (FASE 2, aditivo).
// Adopta la sección existente #view-dashboard del index.html.
// NO toca clases/IDs/estructura: la estética permanece 100% idéntica.
// ============================================================

export default {
  id: 'dashboard',
  containerId: 'view-dashboard',

  mount(container) {
    const el = document.getElementById(this.containerId);
    if (!el) return null;
    if (container && el !== container && !container.contains(el)) {
      container.appendChild(el);
    }
    el.classList.add('active'); // mismo mecanismo de activado que app.js
    return el;
  },

  unmount() {
    const el = document.getElementById(this.containerId);
    if (el) el.classList.remove('active');
    return true;
  },
};