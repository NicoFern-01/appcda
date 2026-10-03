# activeContext.md — Estado actual del desarrollo

> **Mantener actualizado al finalizar cada sesión de código** (ver `.clinerules`).

## Trabajo reciente (última sesión)

**Nuevo módulo de menú: "Pilotos" con submenú desplegable "Listado de Pilotos".**

Registro completo siguiendo el patrón "catálogo como fuente de verdad":

| Punto de registro | Archivo | Cambio |
|---|---|---|
| Catálogo de módulos | `src/utils/permisosUtil.js` | `pilotos` (orden 14, `fa-id-card`) y `listado-pilotos` (orden 15, `fa-list-ul`); renumerados `alojamiento` 16, `categorias-circuitos` 17, `configuracion` 18 para ubicar el grupo **justo debajo de Personal** |
| Grupo de menú | `src/services/viewManager.js` → `GRUPOS_MENU` | `{ padreId: 'menu-pilotos', submenuId: 'submenu-pilotos', padre: 'pilotos', hijos: ['listado-pilotos'] }` |
| Vistas | `viewManager.VIEWS`, `app.js` (`const views`), `src/core/router.js` (`VIEW_IDS`), `src/views/index.js` | +`pilotos`, +`listado-pilotos` (ahora 18 vistas) |
| Apertura de submenú | `viewManager.abrirSubmenuDeVista()` | `'listado-pilotos': ['submenu-pilotos', 'menu-pilotos']` (hijo ⇒ sí abre forzado; el padre queda cubierto por la guarda de padres) |
| Carga de datos | `viewManager.cargarDatosVista()` | `case 'pilotos'` / `case 'listado-pilotos'` → placeholder comentado (sin cargador todavía) |
| DOM | `index.html` | Secciones `#view-pilotos` y `#view-listado-pilotos` insertadas antes de `#view-alojamiento`, con `header` + `page-title` + `page-subtitle` + `table-card` (mismo estilo que el resto) |

- **Sin cambios en control de acceso**: los presets de rol, `normalizarPermisos`,
  `verificarPermiso`, `aplicarControlDeAcceso` y la matriz de permisos son
  catálogo-driven, así que los dos módulos nuevos heredan todo automáticamente.
- **Tests**: `tests/menu.spec.js` ampliado — `GRUPOS` ahora incluye `menu-pilotos`
  (los tests de expandir/contraer corren sobre los 4 grupos) y hay un test nuevo
  que verifica: orden físico exacto del menú (Pilotos debajo de Personal), icono
  `fa-id-card` + chevron, expansión, navegación al placeholder, marca activa en
  el hijo y contracción final.
- Validación: `npx playwright test` → **3 passed / 2 skipped** (los 2 de
  `app.spec.js` se saltean sin `CDA_E2E_*`); `npx vite build` → exit 0.

### Estado git al cierre de esa sesión
```
M  app.js
M  index.html
M  src/core/router.js
M  src/services/viewManager.js   (incluye el fix previo del submenú Personal)
M  src/utils/permisosUtil.js
M  src/views/index.js
?? tests/menu.spec.js            (nuevo, aún sin versionar)
?? .context/  y  .clinerules     (Memory Bank, sin versionar aún)
```
(HEAD = `0774866` en `main`; ninguna sesión anterior fue commiteada)

## Estado general del proyecto

- Funcional y desplegable (GitHub Pages + Firestore).
- Migración a módulos ES **en curso y a medias**: viewManager/auth/persistence
  ya delegan desde los proxies de `app.js`; la mayor parte de la lógica
  (gastos, inventario, combustible, personal, exportaciones) sigue en el
  monolito `app.js`.
- Red de seguridad E2E presente pero mínima (3 tests de menú + 2 de
  `app.spec.js`, estos últimos requieren credenciales / login desactivado).

## Próximos pasos lógicos

1. **Diseñar la vista "Listado de Pilotos"** (hoy es un placeholder limpio con
   título): definir fuente de datos (¿nueva store `pilotos` en IndexedDB con
   schemaValidator + alta/edición?, ¿o derivado de `staff` con `funcion` =
   piloto?), tabla con búsqueda tipo `#buscar-staff`, filtros y acciones CRUD.
2. Definir las `funciones` definitivas de `pilotos`/`listado-pilotos` en
   `CATALOGO_MODULOS` (hoy solo `['ver']`) cuando se agreguen crear/editar/eliminar.
3. Commitear en bloque: fix del submenú Personal + módulo Pilotos + tests
   (commits convención cortos en español, p. ej. `menu: grupo Pilotos con
   Listado de Pilotos (placeholder)`).
4. **Recordar**: usuarios no-admin con permisos *personalizados* persistidos NO
   verán "Pilotos" hasta que un admin edite su matriz de permisos (los módulos
   nuevos faltan en su objeto `permisos` persistido). Los roles con preset
   estándar (editor/viewer) sí lo ven automáticamente.
5. Continuar migración ESM de `app.js`; auditoría `technical_analysis.md`
   (S1 XSS / S2 CSV injection); tests E2E aislados de producción.

## Advertencias operativas

- **NUNCA** correr el test de login desactivado contra Firebase de producción:
  un login fallido dispara `intentarMigrarCuentaLocal()` y MUTA la cuenta real.
- Publicar `firestore.rules` antes de habilitar `VITE_CDA_SYNC_USUARIOS_NUBE`.
- Al modificar `app.js`/`db.js`, recordar que el cache-busting depende de
  `__CDA_BUILD__` (ya automático por el plugin de Vite).
- El orden del menú sale de `orden` en `CATALOGO_MODULOS`: al insertar módulos
  intermedios, renumerar el resto (hoy hasta 18) en vez de usar decimales.

