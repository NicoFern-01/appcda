// vite.config.js - Configuración básica para servir la app como SPA estática
// FASE 1 (no invasiva): solo permite servir el sitio. No altera ningún archivo
// existente (index.html, app.js, db.js, styles.css) y no cambia el comportamiento.

import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  // Raíz del proyecto = carpeta donde está index.html
  root: '.',

  // GitHub Pages sirve el sitio en https://<usuario>.github.io/<repo>/.
  // Sin `base`, Vite emite rutas absolutas (/assets/...) que dan 404 en Pages.
  // Con './' todas las rutas quedan relativas al propio index.html, lo que
  // hace que el build funcione en GitHub Pages, en un subdirectorio
  // cualquier e incluso abierto vía file://.
  base: './',

  // La app conserva scripts clásicos además del bundle de módulos ES.
  // Vite NO puede procesar `<script src="app.js">` / `<script src="db.js">`
  // porque no llevan `type="module"`, así que no los incluye en dist/ por su
  // cuenta y en producción terminaban pidiendo archivos inexistentes (404),
  // rompiendo login, IndexedDB y las 16 vistas.
  // viteStaticCopy los copia tal cual, sin transformar, a la raíz de dist/,
  // de modo que las rutas relativas del index.html empaquetado los resuelven.
  plugins: [
    viteStaticCopy({
      targets: [
        { src: 'app.js', dest: '.' },
        { src: 'db.js', dest: '.' },
      ],
    }),
  ],

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