# systemPatterns.md — Patrones y estructura del código

## Estructura de carpetas

```
appcda/
├── index.html          # 18 vistas estáticas + login (markup dueño del DOM)
├── app.js              # monolito legacy ~10.866 líneas: UI, vistas, menú, gráficos
├── db.js               # legacy ~1.460 líneas: IndexedDB, hash, puentes Firebase
├── styles.css          # ~2.909 líneas, variables CSS, responsive
├── src/
│   ├── main.js         # entrada ES: expone window.__CDA_MODULES__ (bridge)
│   ├── core/
│   │   ├── router.js   # registro/navegación de vistas (adoptExistingDom)
│   │   └── store.js    # estado global ES (espejo solo-lectura de currentUser)
│   ├── services/
│   │   ├── authService.js          # login/logout, sesión, roles (~27 KB)
│   │   ├── persistenceService.js   # IndexedDB + sync Firestore (~16 KB)
│   │   ├── userDirectoryService.js # directorio de usuarios (~20 KB)
│   │   ├── viewManager.js          # menú + navegación + control de acceso
│   │   ├── firebaseConfig.js       # config desde .env
│   │   ├── schemaValidator.js      # validación de registros
│   │   └── authCredentials.js      # ADMINS_ANCLA
│   ├── utils/permisosUtil.js       # CATÁLOGO_MODULOS, roles, verificarPermiso
│   └── views/                      # adaptadores (login, dashboard, index)
├── tests/app.spec.js   # E2E Playwright (login navega + regresión XSS)
├── tests/menu.spec.js  # E2E sin credenciales: submenús del menú lateral
├── firestore.rules     # única defensa real de escritura
└── technical_analysis.md  # auditoría seguridad/consistencia
```

## Patrones de diseño en uso

1. **Bridge global `window.__CDA_MODULES__` (fachada congelada)**
   Punto único de interoperabilidad legacy ↔ ES. Los scripts clásicos hacen:
   ```js
   const v = window.__CDA_MODULES__?.vistas;
   if (v && typeof v.switchView === 'function') return v.switchView(...);
   ```
   Regla: **nunca** duplicar estado de sesión; `store.currentUser` es espejo.

2. **Migración aditiva por fases ("no invasivo")**
   Ningún módulo ES elimina código legacy; lo reemplaza cuando el proxy delega.
   Comentario de cabecera en cada archivo ES explica su fase y su no-invasividad.

3. **Catálogo como fuente de verdad**
   `CATALOGO_MODULOS` (orden, icono, funciones, `soloAdmin`) define vistas,
   permisos y menú. `MODULOS_MAP` indexa por id. Agregar una vista = agregarla
   a `CATALOGO_MODULOS` + `VIEWS`/`GRUPOS_MENU` en viewManager + sección en
   index.html + entrada en `cargarDatosVista()`.

4. **Grupos de menú declarativos**
   `GRUPOS_MENU = [{ padreId, submenuId, padre, hijos }]` gobierna render,
   apertura automática y permisos (padre visible e hijos filtrados).

5. **Apertura automática de submenús SOLO para vistas hijas**
   `abrirSubmenuDeVista(viewId)` tiene guarda: si `viewId` es un `padre` de
   `GRUPOS_MENU`, retorna sin forzar apertura (regresión corregida: "Personal"
   no se podía contraer).

6. **Control de acceso en dos capas**
   - Cliente: `verificarPermiso(usuario, modulo, accion)` (rol admin ⇒ true;
     `soloAdmin` ⇒ false para no-admin; si no, flags del usuario).
   - Servidor: `firestore.rules` con `esAdmin()` leído del propio perfil
     (el cliente no puede auto-asignarse admin).

7. **Offline-first con caché en memoria**
   `getTodos/guardar/eliminar` → caché → IndexedDB → (sync opcional Firestore).
   `db.js` degrada controlado devolviendo `[]`/`null` si el puente no existe.

8. **Seguridad por escapado**
   Todo dato de usuario en `innerHTML` pasa por `escapeHtml()`; toast y modales
   propios en vez de `alert/confirm`. Hash de password `sha256$salt$hash`.

9. **Vite plugin propio `cda-version-scripts-classicos`**
   Reemplaza `?v=__CDA_BUILD__` por timestamp en `transformIndexHtml` para
   invalidar caché de `app.js`/`db.js` (nombres fijos sin hash).

10. **Test E2E aislado de producción**
    Credenciales de test viven en `.env` SIN prefijo `VITE_` (nunca llegan al
    bundle). El test de login está desactivado porque mutaba la cuenta real;
    los tests nuevos evitan Firebase con stubs de `cargarDatosVista`.

## Convenciones de código

- Comentarios en **español**, cabeceras `// ==================== SECCIÓN ====================`.
- Funciones globales con nombres en español (`listarStaff`, `switchView`).
- Módulos ES con `export` nombrado + `export default { ... }` agrupado.
- Navegación y permisos SIEMPRE por `viewManager` (no acceso directo al DOM del menú).
- Estado de sesiones/`dashboardDirty` vive en `app.js`; el store ES solo refleja.
