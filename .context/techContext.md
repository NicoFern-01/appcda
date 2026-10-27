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
- ~~`VITE_CDA_SYNC_USUARIOS_NUBE`~~ — **ELIMINADA** (sesión 8): la escritura de
  usuarios en la nube es nube-primero simétrico por defecto (alta/edición/baja);
  la defensa de escritura son las reglas de `firestore.rules`, no una bandera
  del cliente (era legible en `dist/` y nunca aportó seguridad)

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

## Herramientas de agente (Cline)

### Dónde lee skills Cline

Verificado en `C:\Users\Test\.vscode\extensions\saoudrizwan.claude-dev-4.1.25\dist\extension.js`
(función `Zbn` = `getSkillsDirectoriesForScan`):

| Scope | Rutas escaneadas |
|---|---|
| Proyecto | `.clinerules/skills/`, `.cline/skills/`, `.claude/skills/`, `.agents/skills/` |
| Global | `~/.cline/skills/`, `~/.agents/skills/` |

Requisitos del `SKILL.md`: frontmatter YAML con `name` (idéntico al nombre del directorio) y
`description` (máx. 1024 chars). Cline **ignora** campos extra (`metadata`, `license`, …).
Carga progresiva: metadata siempre (~100 tok/skill), cuerpo al activar (<5k tok), recursos bajo demanda.

**Instaladas hoy (global):** `~/.agents/skills/ecc-guide`, `~/.agents/skills/find-skills`.

### ECC (Everything Claude Code)

- Repo canónico: `https://github.com/affaan-m/ECC` (NO `affanshahid/everything-claude-code`).
- Paquete skills.sh: `affaan-m/ecc` — 327 skills, ~1.3M installs.
- Proyecciones en el repo: `skills/` (canónica, 311), `.agents/skills/` (Codex, 48),
  `.cursor/skills/` (12), `.kiro/skills/` (43).

```bash
# Buscar en el catálogo de ECC
npx skills find <keyword> --owner affaan-m
# Listar disponibles sin instalar
npx skills add affaan-m/ecc -l
# Instalar una skill puntual para Cline (global)
npx skills add affaan-m/ecc@<skill> -g -a cline -y
# Verificar qué está instalado y para qué agentes
npx skills ls -g --json
```

Notas Windows: el `npx skills` pide Node >=22.20.0 (local v22.16.0 ⇒ warning `EBADENGINE`,
no bloquea); el output de los `.ps1` de npm viene con doble codificación (mojibake), así que
para leer el contenido real usar `skills.sh` o el `SKILL.md` crudo en GitHub; el CLI crea
symlinks en el dir del agente (usar `--copy` si symlinks fallan en Windows).
