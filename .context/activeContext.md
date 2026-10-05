# activeContext.md — Estado actual del desarrollo

> **Mantener actualizado al finalizar cada sesión de código** (ver `.clinerules`).

## Trabajo reciente (última sesión)

**Paso 2 resuelto: la vista padre "Pilotos" pasa de placeholder a dashboard dinámico de 4 ítems.**

### Cambios de esta sesión

| Aspecto | Archivo | Detalle |
|---|---|---|
| Vista | `index.html` | `#view-pilotos` reemplaza "Módulo en construcción" por: `header` (`page-title` "Control de Pilotos"), fila 1 `.stats-grid` con 3 `.stat-card` (KPI total `#pilotos-kpi-total`, sanciones vigentes `#pilotos-kpi-vigentes`, alerta ACTC `#pilotos-kpi-actc` en `.stat-card-alerta` + `.stat-alerta-num`), fila 2 `.charts-grid` con `.chart-card` de barras (`#pilotos-categorias-body`, cabecera `#pilotos-cat-total`) y mini-tabla `.tabla-sancionados` (`thead` Nombre y Apellido / Sanción / Motivo / Vencimiento, `tbody#pilotos-sancionados-body`), más un tercer `.charts-grid` de pie con `.dash-pie-links` (`.link-like` que llaman a `navegarDesdeDashboard('listado-pilotos'|'penalidades')`) y `.dash-aviso-actc` (texto de alcance del cruce). Los dos primeros `.stat-card` son `role="link"` navegables. |
| CSS | `styles.css` | Bloque nuevo antes de "Filtro por mes del Calendario": `.cat-bar-*` (row/head/name/count/track/fill, `.is-alerta`), estados `.cat-bar-placeholder`/`.pilotos-vacio`, skeleton `.cat-bar-skeleton` + `@keyframes cat-shimmer`, `.tabla-sancionados*`, `.stat-card-alerta`/`.stat-icon-alerta`/`.stat-alerta-num`, `.dash-pie-links`/`.dash-aviso-actc` y media query móvil. Todo lo demás reutiliza vocabulario existente (`.stats-grid`, `.stat-card`, `.chart-card`, `.charts-grid`, `.badge-*`, `.tag`): **sin librerías de gráficos ni `.card`/`.progress-bar` nuevos**. |
| Lógica | `app.js` | Bloque `// ==================== PILOTOS: DASHBOARD DEL MÓDULO ====================` (~línea 2948, antes de la sección de importación del padrón): `renderDashboardPilotos()` (skeleton → `Promise.all(getTodos('pilotos'), getTodos('penalidades'))` → KPIs/barras/sancionados; `catch` → `mostrarToast`), `pintarSkeletonPilotos()`, `normalizarCategoriaPiloto()` (**NFD quita tildes** + colapsa espacios: "Sport Histórico" y "SPORT HISTORICO" caen en la misma barra), `categoriaEnAlertaActc()` + `CATEGORIAS_ACTC_NO_FISCALIZADAS` (heurística actual), `conteoPorCategoriaPilotos()` (dedup por DNI con `Set`, orden desc), `fechaPenalidadAMs()` (parseo local de `YYYY-MM-DD`, evita el corrimiento UTC), `inicioDeHoy()`, `clasificarPenalidades()` (vigente = sin `fechaFin` o `fin >= hoy`; cumplidas en caso contrario), `renderKpiPilotos()` (`Intl.NumberFormat('es-AR')`), `renderBarrasCategorias()` (ancho % del máximo, mínimo 3%, `background` de `TONOS_CATEGORIA` salvo en alerta) y `renderSancionados()` (top 12, vigentes ordenadas por vencimiento más próximo, `escapeHtml` + `formatearFechaVisual`, badges `badge-warning`/`badge-success`). |
| Disparador | `src/services/viewManager.js` | `cargarDatosVista()` `case 'pilotos': await invocarGlobal('renderDashboardPilotos')` (antes era `break` vacío). Función global en `app.js` → visible en `window`, mismo patrón que `listarPilotos`. |
| Test | `tests/menu.spec.js` | El test de "Pilotos" pasa de validar el placeholder a validar el dashboard: `page-title`, ausencia de "Módulo en construcción", 1 `.stats-grid` + 2 `.charts-grid`, `#pilotos-kpi-total` con número, `.stat-card-alerta` presente, estado vacío de `#pilotos-categorias-body` (`Sin pilotos cargados`/`Cargando`) y las 3 columnas del `thead` de sancionados. **`renderDashboardPilotos` queda sin stub a propósito** (documentado en el comentario de `CARGADORES`): con IndexedDB vacía renderiza `0` + placeholder. |
| `.context` | `activeContext.md`, `productContext.md` | Paso 2 marcado como resuelto y descripción del dashboard agregada al flujo de Pilotos. |

### Bug real detectado con tests aislados

Un test Node sobre las funciones puras (extraídas del propio `app.js`) descubrió
que `normalizarCategoriaPiloto()` solo colapsaba espacios: el padrón real publica
**"SPORT HISTORICO"** y **"Sport Histórico  "**, que salían como DOS barras
distintas. Se corrigió agregando `normalize('NFD')` + borrado de diacríticos.
Verificado: 10 aserciones en verde (agrupación, orden, alertas ACTC, clasificación
de fechas incl. "vence hoy" y fechas inválidas, parseo sin corrimiento UTC).

### Validaciones

- `node --check app.js` → exit 0.
- Test aislado de lógica pura (10 aserciones) → todas en verde.
- `npx vite build` → exit 0 (560 ms). Los avisos sobre `db.js`/`app.js` sin
  `type="module"` son preexistentes (scripts clásicos by design).
- `npx playwright test --workers=1` → **6 passed / 2 skipped** (51,6 s), igual
  al baseline. El test del dashboard validó el render real.

### Estado de git

Commiteado y pusheado en `df84126` "pilotos: dashboard de la vista padre
(KPIs, barras por categoria, sancionados y alerta ACTC)" (`main` =
`origin/main`, árbol limpio). Archivos del commit: `app.js`, `index.html`,
`styles.css`, `src/services/viewManager.js`, `tests/menu.spec.js`,
`.context/activeContext.md`, `.context/productContext.md` (7 archivos,
+653/−16).

### Sesión previa (conservada por referencia)

**Aterrizaje en máquina nueva: entorno rearmado + Memory Bank corregido.**

### Cambios de esta sesión

| Aspecto | Detalle |
|---|---|
| Entorno | `node_modules` **no existía** tras el cambio de máquina → `npm install` (713 paquetes, 59 s). Faltaba también el navegador de Playwright: `npx playwright install chromium` (6 tests fallaban con `Executable doesn't exist`). Ambos son prerequisite de máquina, **no** cambios de código. |
| `.env` | **Sigue sin existir** (por diseño, está en `.gitignore`). Hay que crearlo desde `.env.example` antes de tocar Firebase: `copy .env.example .env` y completar las claves. |
| Corrección del Memory Bank | Detecté que la **importación del padrón** (funcionalidad del HEAD `58077e7`) **no estaba documentada** en este archivo pese a ser lo último que se escribió en el código. Registrada abajo (§ nueva) y en `productContext.md`. |

### Importación masiva del padrón CDA (HEAD `58077e7`, antes no documentado)

| Aspecto | Archivo | Detalle |
|---|---|---|
| Parser 100% nativo | `app.js` | `extraerRegistrosPadron()` (recorre `table tr`, dedup por DNI con `Map`), `parsearFilaPadron()` (**celda 1 = Apellido, 2 = Nombre, 3 = DNI, 16 = Categoría**; exige ≥17 celdas, salta cabeceras con "tipo"/"auditor" y filas sin DNI o nombre; `toUpperCase()`; categoría vacía → `SIN CATEGORÍA`). Sin librerías: `FileReader` + `DOMParser`. |
| Botones | `index.html` | `#piloto-btn-importar-inicial` (Cargar Padrón Inicial) y `#piloto-btn-importar` (Importar Padrón) + `#piloto-import-file` oculto (`accept=".html,.htm,.xls"`), dentro del form de pilotos. |
| Padrón embebido | `public/padron_inicial.html` | Publicado por la CDA; `PADRON_INICIAL_URL = 'padron_inicial.html'` con `fetch(?v=Date.now())` como cache-busting. Vite lo copia a `dist/`. |
| Escritura por lotes | `app.js` | `importarPadronLotes()`: `invalidarCache('pilotos')` → una **única transacción** IndexedDB con `storeLocal.put()` por registro → y solo si hay sesión en la nube, `writeBatch` de a `PILOTOS_BATCH_MAX = 400` con `doc(db,'pilotos',dni)` + `set(...,{merge:true})` (upsert). `setTimeout(r,0)` entre lotes para no congelar el navegador. Devuelve `true` si subió a la nube. |
| Feedback | `app.js` | `conFeedbackDeImportacion()` deshabilita ambos botones y muestra spinner + progreso `Subiendo i/N...`; captura errores con `mostrarToast`. |

> Nota: el HTML nombra el campo "Apellido" en celda 1 y "Nombre" en celda 2, pero el
> header de `index.html` escribe `Nombre *` primero. Ojo al auditar el mapeo del padrón.

### Sesión previa — Anti-colgue del Listado de Pilotos: paginación en cliente (20/pág) + buscador con debounce (300 ms).

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
- Red de seguridad E2E: **6 tests de menú** (sin credenciales) + 2 de `app.spec.js`
  (requieren credenciales / login desactivado). Suite completa verificada en esta
  sesión: **6 passed / 2 skipped** (2,0 min, exit 0).

## Próximos pasos lógicos

1. **Crear `.env`** en esta máquina (`copy .env.example .env` + claves de Firebase).
   Sin él, la app arranca sin identidad en la nube y la importación del padrón solo
   escribe en local.
2. ~~**Diseñar la vista "Pilotos" (overview)**~~ → **RESUELTO en esta sesión**:
   `#view-pilotos` ahora es un dashboard dinámico de 4 ítems (KPI total,
   barras por categoría, sancionados y alerta ACTC) disparado por
   `invocarGlobal('renderDashboardPilotos')`. Mejoras posibles: cruce REAL con
   la fuente ACTC (hoy es heurística por `CATEGORIAS_ACTC_NO_FISCALIZADAS`),
   reactividad al alta de pilotos desde la misma sesión y filtrado por
   categoría/sanción en los paneles.
3. Evaluar **edición** de penalidades (hoy alta + baja; las `funciones` del
   catálogo no incluyen `editar` a propósito) y exportación/imprenta del listado.
4. Recordar: usuarios no-admin con permisos personalizados persistidos no ven
   los módulos nuevos hasta que un admin edite su matriz de permisos.
5. Pendientes de sesiones previas: migración ESM de `app.js`, auditoría
   `technical_analysis.md` (S1 XSS / S2 CSV injection), tests E2E aislados.

> El paso 1 anterior ("Commitear el Listado de Pilotos") quedó **resuelto**: todo
> está commiteado y pusheado en `58077e7` "Carga de PIlotod" (`main` = `origin/main`).
> El árbol de trabajo estaba limpio al iniciar esta sesión.

## Advertencias operativas

- **Máquina nueva / repo recién clonado**: el setup mínimo es
  `npm install` **+ `npx playwright install chromium`** (los navegadores viven en
  `%LOCALAPPDATA%\ms-playwright`, fuera del repo, así que no viajan con el clone;
  sin esto los 6 tests de menú fallan con `Executable doesn't exist`, no con un
  error de código). Además crear `.env` desde `.env.example`.
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

