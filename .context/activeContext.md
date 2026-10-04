# activeContext.md — Estado actual del desarrollo

> **Mantener actualizado al finalizar cada sesión de código** (ver `.clinerules`).

## Trabajo reciente (última sesión)

**Catálogo de sanciones totalmente editable/borrable + menú principal en una sola fila.**

### Cambios de esta sesión

| Aspecto | Archivo | Detalle |
|---|---|---|
| Catálogo editable | `app.js` | `guardarTipoSancionModal()` reemplaza a `agregarTipoSancion()`: **alta o renombrado** según `tipoSancionEditandoId` (valida vacío y duplicado en ambos modos). Nuevas `editarTipoSancion(id)` (precarga el input, el botón pasa a ✓ y aparece "Cancelar") y `cancelarEdicionTipoSancion()`. |
| Tipos por defecto borrables | `app.js` | `renderizarListaTiposSancion()` agrega a **cada fila** Editar (`fa-pen-to-square`) + Eliminar (`fa-trash`): los 5 tipos sembrados en V14 **tienen `id`**, así que ya se pueden renombrar/borrar (antes parecían fijos). `eliminarTipoSancion()` abandona el modo edición si borra el tipo que se estaba editando. |
| Sub-modal | `index.html` | `#form-nuevo-tipo-sancion` → `onsubmit="guardarTipoSancionModal()"`; nuevos `#nuevo-tipo-sancion-label`, `#nuevo-tipo-sancion-btn` y `#nuevo-tipo-sancion-cancel` (oculto). |
| **Fix** confirmación | `styles.css` | `#modal-alerta` (+`.active`) sumado a la regla `z-index: 2000 !important`: la confirmación quedaba **DETRÁS** del sub-modal y era imposible pulsar "Aceptar" al borrar un tipo (detectado por el test E2E). |
| Menú principal | `styles.css` | `.menu-list` → `flex:1 1 auto; min-height:0; overflow-y:auto` (antes el contenido se **recortaba**: el `<aside>` no tenía overflow y el arranque del menú de Personal/Pilotos lo empujaba fuera de pantalla); `.menu-item:not(.submenu-item)` → `white-space:nowrap` + `> span { overflow:hidden; text-overflow:ellipsis }` (una fila por ítem; los subítems siguen partiéndose porque van más indentados); espaciado compactado (padding `1rem`, gap `0.4rem`, ítem `0.65rem`). |
| Planilla Penalidades | `styles.css` | `#form-penalidad .form-grid` → `repeat(8, minmax(0,1fr))`: los 8 campos básicos en **un solo renglón** (con `minmax(200px,1fr)` "Fecha de Fin" caía a la segunda fila); media queries a 4 columnas (≤1200px) y 2 (≤760px). |
| Test | `tests/menu.spec.js` | Penalidades: **edita** el tipo creado (precarga, renombrado, datalist) y lo **elimina** vía modal de la app; verifica que los tipos por defecto tengan Editar+Eliminar; mide `getBoundingClientRect().top` de los 8 campos y exige un único renglón. Test nuevo "El menú principal dibuja cada ítem en una sola fila y no queda cortado" (1 *line box* por ítem, último ítem dentro de la ventana en estado colapsado y scroll interno al desplegar todo). |

### Validaciones

- `npx playwright test` → **5 passed / 2 skipped**; `npx vite build` → exit 0.
- La confirmación de borrado se pulsa con `#alerta-btn-confirmar` (`cerrarAlerta(true)`).

### Sesión anterior — Sanción con texto libre (ruedita) y fechas de la sanción

| Aspecto | Archivo | Detalle |
|---|---|---|
| Campo Sanción | `index.html` | `<select>` cerrado → **`<input list="tipos-sancion">`** (texto libre + sugerencias) dentro de `.input-con-gear`, con **ruedita** `action-btn gear-btn admin-only` → `abrirModalTiposSancion()` |
| Fechas | `index.html` | `#penalidad-fecha-inicio` (`date`, **obligatoria**) y `#penalidad-fecha-fin` (`date`, opcional: "Vacía = sanción aún vigente") |
| Listado | `index.html` | columnas **Inicio** y **Fin** (10 columnas; `colspan` del estado vacío = 10) |
| Catálogo | `db.js` | **`DB_VERSION` 13 → 14**: store `tiposSancion` con índice único `valor` + seed idempotente `migrarTiposSancionV14()` (los 5 tipos por defecto), invocado en el arranque de `app.js` junto a V9/V10 |
| Lógica | `app.js` | `obtenerTiposSancion()` (fallback a defecto si la store está vacía), `poblarTiposSancion()`, `abrirModalTiposSancion()` (solo admin), `renderizarListaTiposSancion()` (nombres vía `textContent`), `eliminarTipoSancion()` (confirmación de la app) y `agregarTipoSancion()` (**ya reemplazado** en la sesión siguiente por `guardarTipoSancionModal()` + `editarTipoSancion()`) |
| Guardado | `app.js` | `guardarPenalidadForm()` persiste `fechaInicio`/`fechaFin` y valida **fin ≥ inicio**; `listarPenalidades()` pinta fechas con `formatearFechaVisual()` **dentro de `escapeHtml()`** |
| CSS | `styles.css` | `.input-con-gear input { flex:1; min-width:0 }` (espejo de la regla ya existente para `select`) |
| Sub-modal | `index.html` | `#subModalTiposSancion`, réplica del patrón `subModalGestionTiposMovimiento` (alta + lista + Cerrar repuebla el datalist) |
| Backup | `app.js` / `db.js` | `tiposSancion` agregado a `exportarDatos()` e `importarTodo()` |

> La sesión anterior construyó la base del módulo (menú Pilotos, planilla, PDFs
> y store `penalidades`); su detalle sigue registrado más abajo.

### Registro del módulo (patrón "catálogo como fuente de verdad")

| Punto de registro | Archivo | Cambio |
|---|---|---|
| Catálogo | `src/utils/permisosUtil.js` | `penalidades` (orden **16**, `fa-gavel`, funciones `['ver','crear','eliminar']`); renumerados `alojamiento` 17, `categorias-circuitos` 18, `configuracion` 19 |
| Grupo de menú | `viewManager.GRUPOS_MENU` | `padre: 'pilotos'` → `hijos: ['listado-pilotos', 'penalidades']` |
| Vistas (**19** en total) | `viewManager.VIEWS`, `app.js` (`const views`), `router.js`, `views/index.js` | +`penalidades` |
| Apertura de submenú | `abrirSubmenuDeVista()` | `'penalidades': ['submenu-pilotos', 'menu-pilotos']` |
| Carga de datos | `cargarDatosVista()` | `case 'penalidades'` → `invocarGlobal('listarPenalidades')` |
| DOM | `index.html` | `#view-penalidades` (antes de `#view-alojamiento`): planilla + tabla |
| Persistencia | `db.js` | **`DB_VERSION` 12 → 13** + store `penalidades` (guard `.contains()`). Los PDFs van al store **existente** `adjuntos` con clave foránea `penalidadId` (patrón de `detalleGastoId`) |
| Backup | `exportarDatos()` (app.js) / `importarTodo()` (db.js) | `penalidades` agregado a ambas listas |

| Catálogo de tipos | `index.html` / `app.js` | `#subModalTiposSancion`: alta con `guardarTipoSancionModal()`, **edición** (`editarTipoSancion` + `#nuevo-tipo-sancion-cancel`) y borrado de **cualquier** tipo con `id` (incluidos los 5 por defecto) |

> Todo el trabajo del módulo Penalidades (dos sesiones) sigue **sin commitear**:
> `M app.js, db.js, index.html, src/core/router.js, src/services/viewManager.js,
> src/utils/permisosUtil.js, src/views/index.js, styles.css, tests/menu.spec.js`
> y los 4 archivos de `.context/`. HEAD = `5573e31` "Contexto y Pilotos" (`main`).

### Funcionalidad del módulo (sección `// ==== PILOTOS: PENALIDADES ====` en `app.js`)

- Planilla `#form-penalidad` (`editor-only`): nombre, apellido, DNI, nro. de auto,
  categoría (input + `datalist` desde `getTodos('categorias')`), sanción
  (`input list="tipos-sancion"` + ruedita), fechas inicio/fin, motivo (`textarea`
  full-width) y PDFs (`input multiple accept=.pdf`).
- Adjuntos: `agregarAdjuntoPenalidad()` valida tipo y 10MB, lee con `readAsDataURL`,
  previsualiza en `#penalidad-adjuntos-list` (nombres vía `textContent`) y se
  persisten con `guardar('adjuntos', { penalidadId, nombre, archivo, tipoArchivo, … })`.
- `guardarPenalidadForm()` guarda y resetea; `listarPenalidades()` pinta la tabla
  con buscador y botones "Abrir PDF 1..N" (usan `abrirArchivoAdjunto` + el cache
  `penalidadPdfsCache`); `eliminarPenalidad()` usa `mostrarConfirmacion()` y borra
  la penalidad **y sus adjuntos**. Todo dato pasa por `escapeHtml()`.
- **Sin CSS nuevo de layout propio**: reutiliza `form-card`, `form-grid`, `form-group`, `table-card`,
  `table-header-tools`, `search-input`, `btn`, `tag`.

## Estado general del proyecto

- Funcional y desplegable (GitHub Pages + Firestore); **19 vistas** y 4 grupos
  desplegables (Gastos, Personal, Pilotos, Inventario).
- Migración a módulos ES **en curso y a medias**: viewManager/auth/persistence
  delegan desde los proxies de `app.js`; la mayor parte de la lógica sigue en el
  monolito `app.js` (**11.340 líneas** tras esta sesión).
- La sincronización con Firestore es **genérica por nombre de store**: `penalidades`,
  `tiposSancion` y sus adjuntos sincronizan solos (cubiertos por el comodín de
  `firestore.rules`) si `VITE_CDA_SYNC_USUARIOS_NUBE` está habilitado.
- Red de seguridad E2E: **5 tests de menú** (sin credenciales) + 2 de `app.spec.js`
  (requieren credenciales / login desactivado).

## Próximos pasos lógicos

1. **Commitear** el módulo Penalidades completo (planilla + PDFs + fechas + catálogo
   editable de sanciones + menú en una fila). Mensaje sugerido:
   `pilotos: penalidades con fechas, tipos de sancion editables y menu en una fila`.
2. **Diseñar la vista "Listado de Pilotos"** (sigue de placeholder): fuente de
   datos (¿store `pilotos` nueva o derivada de `staff` con función piloto?),
   tabla con búsqueda y CRUD.
3. Evaluar **edición** de penalidades (hoy alta + baja; las `funciones` del
   catálogo no incluyen `editar` a propósito) y exportación/imprenta del listado.
4. Recordar: usuarios no-admin con permisos personalizados persistidos no ven
   los módulos nuevos hasta que un admin edite su matriz de permisos.
5. Pendientes de sesiones previas: migración ESM de `app.js`, auditoría
   `technical_analysis.md` (S1 XSS / S2 CSV injection), tests E2E aislados.

## Advertencias operativas

- **NUNCA** correr el test de login desactivado contra Firebase de producción:
  un login fallido dispara `intentarMigrarCuentaLocal()` y MUTA la cuenta real.
- Publicar `firestore.rules` antes de habilitar `VITE_CDA_SYNC_USUARIOS_NUBE`.
- Al tocar stores de IndexedDB: **siempre** bump de `DB_VERSION` + creación con
  `.contains()` (si no, `NotFoundError` en `db.transaction` — ya pasó en V10).
- El orden del menú sale de `orden` en `CATALOGO_MODULOS`: al insertar módulos
  intermedios, renumerar el resto (hoy hasta 19).
- Los seeds de catálogos (`tiposMovimiento` V10, `tiposSancion` V14) corren en el
  arranque de `app.js`. Si una store quedara sin sembrar, `obtenerTiposSancion()`
  cae a los 5 valores por defecto **en memoria** y esos ítems (sin `id`) se listan
  sin botones Editar/Eliminar: es el síntoma de que el seed no corrió.
- **No bajar el `z-index` de `#modal-alerta`** (hoy 2000 con `!important`): los
  sub-modales (`#subModalTiposSancion`, `#subModalTiposMovimiento`) son
  `.modal-overlay` de z-index 1000 y quedan más adelante en el DOM, así que la
  confirmación de borrado sería inalcanzable (bug real detectado por el E2E).
- El menú lateral ya hace **scroll interno** (`.menu-list` con `overflow-y:auto`):
  si se agregan más ítems no se recortan, pero conviene revisar el alto disponible
  en pantallas de 768px de alto.
- Los PDFs se guardan como data URL (≈1,33×): por eso el límite de 10MB por archivo.
- El botón "Adjuntar" existe también en el modal de Carga Detallada: en tests,
  acotar el selector a `#form-penalidad`.

