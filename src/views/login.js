// src/views/login.js
// ============================================================
// Vista LOGIN (FASE 2, aditivo).
// En esta fase adopta el DOM existente: `#login-screen` del index.html.
// NO se modifica ninguna clase/ID/etiqueta CSS: la estética es idéntica.
// En fases futuras este módulo podrá renderizar HTML propio manteniendo
// exactamente los mismos ids/clases.
// ============================================================

export default {
  id: 'login',
  containerId: 'login-screen',

  mount(container) {
    const el = document.getElementById(this.containerId);
    if (!el) return null;
    if (container && el !== container && !container.contains(el)) {
      container.appendChild(el);
    }
    el.style.display = ''; // respeta el CSS existente
    return el;
  },

  unmount() {
    // el logout (handleLogout) ya gestiona mostrar/ocultar la pantalla.
    return true;
  },
};