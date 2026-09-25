// playwright.config.js - Harness E2E (red de seguridad de la migración).
// Configuración básica para probar la app en el puerto local de Vite.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,   // un solo test crítico; evitar condiciones de carrera
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],

  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    viewport: { width: 1366, height: 768 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },

  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],

  // Levanta (o reutiliza) el servidor de Vite automáticamente.
  webServer: {
    command: 'npm run dev',
    port: 5173,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});