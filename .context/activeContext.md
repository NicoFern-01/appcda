# activeContext.md — Estado actual del desarrollo

> **Mantener actualizado al finalizar cada sesión de código** (ver `.clinerules`).

## Trabajo reciente (última sesión)

**Anti-colgue del Listado de Pilotos: paginación en cliente (20/pág) + buscador con debounce (300 ms).**

### Cambios de esta sesión

| Aspecto | Archivo | Detalle |
|---|---|---|
| Paginación cliente | `app.js` | `listarPilotos()` guarda el array completo filtrado/ordenado en `pilotosCache` (memoria) y `renderPilotoPagina()` pinta SOLO el `slice((paginaActual-1)*20, paginaActual*20)`. Estado global `paginaActual`/`registrosPorPagina=20`. Render en `DocumentFragment` + `tbody.innerHTML=''` previo (libera nodos viejos). |
| Controles | `app.js` + `index.html` + `styles.css` | Pie `.pagination-controls` (#pilotos-pagination): botones Anterior/Siguiente (`.btn btn-secondary`) + "Página X de Y". `renderPilotoPaginador()` y `cambiarPaginaPilotos()` con límites nativos (`disabled` al llegar a borde). CSS: `.pagination-controls`/`.pagination-info`. |
| Debounce | `app.js` + `index.html` | El buscador pasa de `oninput="listarPilotos()"` → `oninput="pilotoBuscarDebounced()"` (timer `setTimeout` 300 ms; al dispararse resetea `paginaActual=1` y re-filtra sobre el array original). |

### Validaciones

- `npx vite build` → exit 0 (~570 ms).
- `npx playwright test tests/menu.spec.js --workers=1` → **6 passed** (43,5 s).
- Spec temporal (borrado tras pasar): con 50 pilotos, página 1×20 / 2×20 / 3×10, botones `disabled` en bordes, y `fill('NOMBRE49')` re-renderiza "Página 1 de 1" con 1 fila tras el debounce → **1 passed** (13,9 s).

**Listado de Pilotos completo: formulario de alta manual con escudo anti-duplicados por DNI + tabla reactiva (onSnapshot).**

### Cambios de esta sesión

| Aspecto | Archivo | Detalle |
|---|---|---|
| Store `pilotos` | `db.js` | **`DB_VERSION` 14 → 15**: object store `pilotos` con `keyPath: 'dni'` (**string, SIN autoIncrement**). El DNI es la clave primaria en local y el doc ID `/pilotos/{dni}` en Firestore. El keyPath rechaza duplicados a nivel de motor (ConstraintError) como tercera barrera. `validarRegistro()` generalizado con `clavePrimariaStore()`/`normalizarClaveStore()` (solo `pilotos` usa `dni`; el resto sigue con `id`). Agregado a `importarTodo()`. Nuevo `onSnapshot` en el import de `firebase-firestore` + bridge `window.__CDA_FIREBASE_RUNTIME__` (lectura en caliente + suscripción). |
| Claves nativas | `src/services/schemaValidator.js`, `src/services/persistenceService.js` | `clavePrimariaStore()` (`pilotos`→`dni`, resto→`id`). `guardar()` NO genera `id` numérico para pilotos; doc ID = DNI en `guardar`/sync up/down; `eliminar`/`obtenerPorId`/caché comparan por clave nativa (sin `Number()`). Nuevos `suscribirColeccion()`/`cancelarSuscripcion()` (una suscripción por colección; cada cambio remoto invalida caché y dispara `firebase-sync-complete`). Reglas Firestore: sin cambios (el comodín `/{collection}/{docId}` ya cubre `pilotos`: lectura `signedIn()`, escritura roles operativos). |
| Vista | `index.html` | `#view-listado-pilotos` deja de ser placeholder: `form#form-piloto.editor-only` (4 campos `required`: `#piloto-nombre`, `#piloto-apellido`, `#piloto-dni` con `inputmode=numeric`, `#piloto-categoria` + `datalist#categorias-piloto`) + botón `#piloto-btn-guardar` "+ Agregar Piloto". Tabla con `search-input#buscar-piloto`, columnas Nombre y Apellido / Documento / Categoría / Acciones y `tbody#pilotos-table-body`. Solo clases existentes (`form-card`, `form-grid`, `form-group`, `table-card`, `table-header-tools`, `badge-info`): **cero CSS nuevo**. |
| Lógica | `app.js` | `guardarPilotoForm()` (sanitiza: `toUpperCase()` + DNI solo dígitos; **escudo 3 barreras**: `getDoc` en caliente → `obtenerPorId` local → `ConstraintError` del keyPath; mensaje exacto `"Error: El DNI ingresado ya pertenece a un piloto registrado"` vía `mostrarToast`), `listarPilotos()` (buscador, orden `es-AR` por apellido+nombre, `escapeHtml()`, confirmación con `mostrarConfirmacion()` y baja vía `eliminar()`), `suscribirPilotosTiempoReal()` + `poblarCategoriasPiloto()`. `cargarDatosVista('listado-pilotos')` en `viewManager.js` **ya invocaba `listarPilotos()`**: sin cambios. |
| Test | `tests/menu.spec.js` | El test existente de "Pilotos" ahora verifica formulario (4 inputs + botón), columnas de la tabla y `tbody`. **Sin stubs**: `listarPilotos` corre real (IndexedDB limpia ⇒ estado vacío ⇒ render OK). |

### Validaciones

- `npx vite build` → exit 0 (422 ms).
- `npx playwright test --workers=1` (suite completa) → **5 passed / 2 skipped**
  (los 2 de `app.spec.js` requieren credenciales; el test de Pilotos corre
  `listarPilotos()` real contra IndexedDB limpia).

### Sesión anterior — Catálogo de sanciones editable + menú en una fila

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

1. **Commitear** el Listado de Pilotos (store `pilotos` V15, formulario + escudo anti-duplicados + tabla reactiva) junto a Penalidades. Mensaje sugerido:
   `pilotos: listado con alta manual, dni como clave y tabla reactiva`.
2. **Diseñar la vista "Pilotos" (overview)** (sigue de placeholder): ¿resumen del
   módulo (conteos por categoría, últimos sancionados) o redirigir a Listado?
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

