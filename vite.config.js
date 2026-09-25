// vite.config.js - Configuración básica para servir la app como SPA estática
// FASE 1 (no invasiva): solo permite servir el sitio. No altera ningún archivo
// existente (index.html, app.js, db.js, styles.css) y no cambia el comportamiento.

import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  // Raíz del proyecto = carpeta donde está index.html
  root: '.',

  // Servir la SPA estática tal cual, sin plugin de framework.
  // La app ya usa scripts clásicos (import dinámico de Firebase al vuelo),
  // por lo que no es necesario ningún plugin adicional.
  plugins: [],

  resolve: {
    // Base para importar archivos de la propia app usando '@/' (opcional, no obligatorio).
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url))
    }
  },

  server: {
    port: 5173,          // Puerto por defecto de Vite (deploy a GitHub Pages: 8080/80)
    open: false,         // No abrir el navegador automáticamente (no invasivo)
    strictPort: false,   // Si 5173 está ocupado, Vite elige otro
  },

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false      // FASE 1: sin sourcemaps para no exponer el código fuente completo
  },

  preview: {
    port: 4173
  }
});