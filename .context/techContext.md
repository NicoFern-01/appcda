# techContext.md — Contexto tecnológico

## Pila tecnológica exacta

| Capa | Tecnología |
|---|---|
| Runtime | Node.js (scripts npm; ESM `"type": "module"`) |
| Bundler/dev server | Vite ^6.3.5 (`vite-plugin-static-copy` ^4.1.1) |
| Frontend | Vanilla JS (sin framework), HTML estático + CSS puro |
| Gráficos | Chart.js (CDN) |
| Iconos | Font Awesome (CDN) |
| Tipografía | Outfit / Inter (fuentes locales/CDN) |
| Backend | Firebase: Firestore + Firebase Auth (proyecto `controlcda-e5f97`) |
| Almacenamiento local | IndexedDB (db.js / persistenceService.js) |
| Tests | Playwright ^1.63.0 (`@playwright/test`) |
| Deploy | GitHub Pages vía `gh-pages` (`npm run deploy`, build a `dist/`) |
| Reglas | `firestore.rules` desplegables con `firebase-tools` ^15.31.0 (`npm run deploy:rules`) |

**No hay**: React/Vue, TypeScript, ESLint/Prettier configurado, Vitest/Jest,
ni CSS framework.

## Comandos

```bash
npm run dev        # Vite dev server en http://localhost:5173 (strictPort: false)
npm run build      # build a dist/ (base './', sin sourcemaps)
npm run preview    # previsualizar build en :4173
npm run predeploy  # build automático antes de deploy
npm run deploy     # gh-pages -d dist
npm run deploy:rules  # firebase deploy --only firestore:rules
npx playwright test --workers=1          # suite E2E completa
npx playwright test tests/menu.spec.js   # solo tests de menú (sin credenciales)
```

## Variables de entorno (`.env`, ver `.env.example`)

Con prefijo `VITE_` (se inyectan en el bundle):

- `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`,
  `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`,
  `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_MEASUREMENT_ID`
- `VITE_CDA_AUTH_DOMAIN` — dominio sintético p/ expandir username → email
  (`admin` → `admin@controlcda.com`)
- `VITE_CDA_SYNC_USUARIOS_NUBE` — habilita escritura de usuarios en nube
  (SOLO después de publicar reglas restrictivas)

**Sin** prefijo `VITE_` (NO llegan al navegador; las lee Playwright):

- `CDA_E2E_USER`, `CDA_E2E_PASSWORD` — credenciales del harness E2E.

Nota: Playwright **no** carga `.env` automáticamente; para correr los tests que
requieren credenciales hay que exportarlas en el shell.

## Detalles críticos de configuración

- `vite.config.js`: `base: './'` obligatorio para GitHub Pages en subdirectorio.
- `viteStaticCopy` copia `app.js` y `db.js` a `dist/` porque son
  `<script>` clásicos (sin `type="module"`) que Vite no empaqueta.
- `transformIndexHtml` reemplaza `__CDA_BUILD__` por timestamp ⇒ cache-busting
  de los dos scripts clásicos en cada deploy.
- Build sin sourcemaps (`sourcemap: false`) para no exponer el código fuente.
- `playwright.config.js`: `testDir: './tests'`, baseURL `http://localhost:5173`,
  Chromium, `webServer` levanta `npm run dev` (o lo reutiliza).
- `.gitignore` excluye `.env`, `dist/`, `test-results/`, `playwright-report/`.
- Alias `@` → raíz del proyecto (disponible pero opcional).
