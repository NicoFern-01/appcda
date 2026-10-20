# activeContext.md — Estado actual del desarrollo

> **Mantener actualizado al finalizar cada sesión de código** (ver `.clinerules`).

## Sesión 10/06/2026 (8): USUARIOS — sincronización simétrica nube-primero, bandera eliminada

> La bandera `VITE_CDA_SYNC_USUARIOS_NUBE` gateaba ALTA/EDICIÓN pero NO lectura ni borrado:
> con ella apagada (sin `.env`) la lista mostraba perfiles de la nube, el borrado era un
> no-op con `ok:true` (falso éxito) y las altas quedaban solo en IndexedDB sin aparecer nunca.
> Además la bandera, legible en `dist/`, nunca aportó seguridad: la defensa real son las reglas.

### Cambios

| Archivo | Cambio |
|---|---|
| `src/services/userDirectoryService.js` | Eliminadas `leerBanderaSyncNube()`/`SYNC_USUARIOS_NUBE`. ALTA/EDICIÓN/BAJA van a la nube siempre que hay SDK + sesión; si no, `{ok:true, nube:false}` y el llamador persiste local CON AVISO. ALTA distingue email tomado + perfil existente (duplicado) de cuenta huérfana en Auth (mensaje con pasos de consola). EDICIÓN con renombre borra el documento viejo. Docstrings actualizados. |
| `app.js` (`guardarUsuarioFormInterno`) | Chequeo de duplicados NUBE-PRIMERO (`listarPerfilesConEstado`, distingue `sinNube/sinSesion`; fallback a `listarPerfiles`). En ALTA purga fantasmas locales si la nube respondió; si no, bloquea. En EDICIÓN sin nube persiste en IndexedDB (libera id string numérico-incompatible); con nube no duplica local. Toast de alta solo-local actualizado. |
| `.env.example` | Variable `VITE_CDA_SYNC_USUARIOS_NUBE` eliminada; comentario explica el esquema simétrico + `firestore.rules`. |
| `.context/techContext.md` | Bandera marcada ELIMINADA (sesión 8) con el motivo de seguridad. |
| `.context/productContext.md`, `.context/activeContext.md` | Menciones obsoletas de la bandera corregidas (líneas 70, 556, 606). |

### Validaciones

- `npx vite build` → **exit 0** (556 ms; warnings pre-existentes sin `type="module"`).
- Sin tests automatizados del directorio (requieren Firebase real; no tocar producción desde tests).

### Verificación manual pendiente

- Con sesión admin + reglas publicadas: alta aparece en la lista (otro dispositivo), edición/renombre sin duplicados, borrado desaparece de la lista.
- Sin sesión / sin Firebase: alta/edición solo-local con toast `warning`, sin falsos éxitos.

---

## Sesión 10/06/2026 (7): BORRADO DE USUARIOS — fix: "eliminado correctamente" pero el usuario seguía en la lista

> Tarea del usuario: al eliminar el usuario "prueba" aparecía el mensaje de éxito
> pero el usuario seguía visible en Gestión de Usuarios (imagen adjunta).

### Causa raíz (asimetría de banderas en `src/services/userDirectoryService.js`)

- **La LECTURA de usuarios ignora la bandera `VITE_CDA_SYNC_USUARIOS_NUBE`**:
  `listarPerfiles()` / `listarPerfilesConEstado()` leen Firestore siempre que hay
  SDK + sesión. Por eso "prueba" (un perfil de la nube) se veía en la lista.
- **El BORRADO respetaba la bandera**: `eliminarPerfil()` empezaba con
  `if (!SYNC_USUARIOS_NUBE) return { ok: true, nube: false };` — un **no-op que
  devuelve `ok:true`**. Como no hay `.env` (solo `.env.example` con `false`), la
  bandera está apagada → el borrado no hacía nada → `app.js` mostraba "Usuario
  eliminado correctamente." → `listarUsuarios()` relee la nube → seguía ahí.
- Con la bandera **encendida** el bug no existía. La lectura y el borrado
  debían usar la misma condición.

### Cambios

| Archivo | Cambio |
|---|---|
| `src/services/userDirectoryService.js` | `eliminarPerfil()` ya NO gatea el BORRADO con `SYNC_USUARIOS_NUBE`. Ahora: valida `id`, y solo retorna `{ok:true, nube:false}` si `!firestoreDisponible() \|\| !conSesion` (no hay nube que borrar → el llamador sigue con el local). El borrado es seguro sin la bandera porque las reglas de Firestore ya lo protegen (`allow delete: if esAdmin() && userId != miId()`) y no es vector de autoescalada (la bandera protege ALTA/EDICIÓN, no baja). Docstring actualizado. |
| `app.js` (`eliminarUsuario`, ~6416) | Borrado **local** robustecido: además de por id numérico, limpia por `username` cualquier copia local duplicada (un usuario de la nube tiene id = username/string, así que el borrado por id numérico se la saltaba y quedaba como fantasma en IndexedDB). Usa `getTodos('usuarios', { soloLocal: true })`. |

### Validaciones

- `npx vite build` → **exit 0** (`✓ built in 639ms`).
- No existe test unitario de `eliminarUsuario`/`eliminarPerfil` (verificado). La
  corrección es de comportamiento en runtime contra Firebase.

### Limitación / verificación manual

- **Requiere verificación manual en la UI con Firebase real**: borrar un usuario
  de la nube y comprobar que desaparece de la lista. No se puede automatizar sin
  credenciales (no tocar Firebase de producción desde tests).
- Nota: el entorno de comandos de esta sesión inyectaba `\r` en los comandos
  PowerShell (abría REPLs de Node por error). Los edits multilinea con el tool
  `editor` fallaban por CRLF; se resolvió usando anclas de UNA sola línea y, para
  `userDirectoryService.js`, un script ESM temporal (`.mjs`) ya borrado.

---


## Sesión 10/06/2026 (6): CONTROL DE USUARIOS — "Listado de Pilotos", "Penalidades" y "Autorizaciones" con las 4 acciones en la matriz de permisos

> Tarea del usuario: en **Control de Usuarios**, la matriz "Permisos por módulo" no
> ofrecía todas las acciones para tildar en tres filas: "Listado de Pilotos" solo
> tenía Ver; y "Penalidades"/"Autorizaciones" tenían Ver/Crear/Eliminar pero **les
> faltaba el check Editar** (foto del usuario mostrando ambas filas sin Editar).
> Deben quedar como Alojamiento (Ver/Crear/Editar/Eliminar).

### Causa raíz

La matriz del modal (`renderizarMatrizPermisos()` → `_crearFilaPermisosModulo()` en `app.js`)
genera un checkbox **por cada elemento de `modulo.funciones`** de `CATALOGO_MODULOS`.
`listado-pilotos` declaraba `funciones: ['ver']` y `penalidades`/`autorizaciones`
`['ver','crear','eliminar']` (sin `'editar'`), por lo que `normalizarPermisos()` además
descartaba los flags no listados al persistir. (Dato verificado: la copia clásica raíz
`permisosUtil.js` **ya no existe**; el comentario de cabecera de `src/utils/permisosUtil.js`
que la menciona está desactualizado — la única fuente es el módulo ES.)

### Cambios de esta sesión

| Aspecto | Archivo | Detalle |
|---|---|---|
| Catálogo | `src/utils/permisosUtil.js` | `listado-pilotos`: `['ver']` → **`['ver','crear','editar','eliminar']`**. `penalidades` y `autorizaciones`: `['ver','crear','eliminar']` → **`['ver','crear','editar','eliminar']`**. Mismo patrón que `alojamiento`. Único cambio funcional: la matriz, los presets de rol y `verificarPermiso()` derivan todos de `CATALOGO_MODULOS`. El dashboard `pilotos` (solo lectura) **no** cambia. |
| Test | `tests/menu.spec.js` | Test "Listado de Pilotos ofrece las 4 acciones para tildar (igual que Alojamiento)" (describe "Control de usuarios — matriz de permisos"): renderiza la matriz con preset viewer y exige `['ver','crear','editar','eliminar']` en **`listado-pilotos`, `penalidades`, `autorizaciones` y `alojamiento`**, y `['ver']` en `pilotos`. |

### Alcance y limitación (importante)

- Penalidades y Autorizaciones **ya tenían** botón "Editar" + modal propio en su vista
  (sesiones 4/5: `editarPenalidad`/`guardarEdicionPenalidad` y
  `editarAutorizacion`/`guardarEdicionAutorizacion`, gateados por `puedeEditar()` por rol);
  el flag `'editar'` faltaba solo en el catálogo. No hay ningún
  `verificarPermiso(..., 'penalidades'|'autorizaciones', ...)` en uso hoy.
- Los flags `crear/editar/eliminar` ahora **se pueden tildar y se persisten**, pero las
  vistas todavía no ocultan botones según ellos: el enforcement intra-vista es solo por
  rol (`.editor-only` ↔ viewer/supervisor) y por `ver` a nivel de menú/navegación —
  igual que en TODOS los demás módulos (Alojamiento, Staff, etc.). Si se desea que al
  desmarcar "Crear" se oculte el formulario de alta, habrá que agregar
  `verificarPermiso()` por acción dentro de la vista (trabajo aparte).
- Usuarios existentes no-admin: al normalizar, les quedan `crear/editar/eliminar` en
  `false` hasta que el admin los tilde y guarde (el preset "Editor" ahora sí los
  incluye efectivamente para estos módulos).

### Validaciones (esta sesión)

- `npx vite build` → **exit 0** (982 ms; warnings pre-existentes sin `type="module"`).
- `npx playwright test tests/menu.spec.js --workers=1 -g "matriz de permisos"` → **1 passed**.
- Ampliación posterior (penalidades/autorizaciones): build y test de matriz
  **re-ejecutados tras los cambios → exit 0 y 1 passed** con las aserciones nuevas.
- Suite completa `menu.spec.js` → **9 passed, 1 failed**: el único fallo es "Pilotos >
  Auditoría ACTC" (`__CDA_FETCHES__.length` esperaba 2, recibió 1) — **pre-existente**,
  ya reproducido con los cambios stash-eados en la sesión anterior.

### Estado de git

**Sin commitear:** `M src/utils/permisosUtil.js`, `M tests/menu.spec.js` (además de los
pendientes de la sesión (5): `M app.js`, `M index.html`, `.context/activeContext.md`).

### Próximos pasos

1. Commit de la sesión (5) + esta sesión juntos, o en dos commits temáticos.
2. (Opcional) Enforcement por acción dentro de la vista Listado de Pilotos
   (`verificarPermiso(usuario, 'listado-pilotos', 'crear'|'editar'|'eliminar')`).
3. Investigar por separado el fallo pre-existente de "Auditoría ACTC" (conteo de fetches con bypass de caché).

---

## Sesión 10/06/2026 (5): PENALIDADES — adjuntar PDF → ENLACE EXTERNO + modal Editar

> Tarea del usuario: en **Pilotos > Penalidades**, cambiar "Documentación adjunta
> (PDF)" (`input file` + botón Adjuntar) por un **enlace externo**, igual a como
> funciona en Autorizaciones. A elección del usuario se replicó también el botón
> **Editar** por fila con modal (mismo criterio que `#modal-editar-autorizacion`).

### Cambios de esta sesión

| Aspecto | Archivo | Detalle |
|---|---|---|
| Formulario | `index.html` | Grupo "Documentación adjunta": se reemplazó el `input file` + botón "Adjuntar" + `#penalidad-adjuntos-list` por **`#penalidad-enlace`** (`type="text" inputmode="url"`, placeholder de Drive, `small` explicativo). Subtítulo de la vista → "…por enlace externo"; `<th>PDFs</th>` → **Archivos**. |
| Modal de edición | `index.html` | Nuevo `#modal-editar-penalidad` (max-width 640px) insertado **ANTES** de `#subModalTiposSancion` (la ruedita de tipos de sanción apila encima). Contiene TODOS los campos de la planilla + enlace; botón `#editar-penalidad-btn-guardar` → `guardarEdicionPenalidad()`. ⚠️ Lección repetida: `insert_line` usa el NÚMERO DE LÍNEA ACTUAL; tras ediciones previas el ancla se corrige sola — verificar siempre con un read posterior (esta vez cayó dentro del sub-modal y se corrigió). |
| Alta | `app.js` | `guardarPenalidadForm()` lee `enlaceArchivo` y lo persiste en 'penalidades'; ya **no** escribe en 'adjuntos'. Eliminados `penalidadAdjuntosTemporales`, `PENALIDAD_MAX_PDF_BYTES`, `agregarAdjuntoPenalidad()`, `renderizarAdjuntosPenalidad()`, `eliminarAdjuntoPenalidad()`. `limpiarFormularioPenalidad()` = solo `form.reset()`. |
| Listado | `app.js` | `listarPenalidades()`: columna Archivos = **"Ver Archivos"** (`escapeHtml` en el href, `target="_blank" rel="noopener noreferrer"`) + PDFs heredados ("Abrir PDF 1..N"); se conserva `penalidadPdfsCache` y `abrirPdfPenalidad()`. Celda ACCIONES: botón **Editar** (`fa-pen-to-square`, `title="Editar penalidad (agregar o cambiar enlace)"`) antes de Eliminar. |
| Edición | `app.js` | `editarPenalidad(id)`: precarga los 10 campos + datalists (`poblarCategoriasPenalidad`, `poblarTiposSancion`), guarda el id en `modal.dataset.penalidadId`. `guardarEdicionPenalidad()`: valida igual que alta (incl. fin ≥ inicio), parte de `...existente` (preserva creación/versionado), escribe `fechaModificacion`/`usuarioModificacion`; mismo `id` ⇒ `put()`/`set(merge)` sin duplicar. |
| Test | `tests/menu.spec.js` | Test renombrado a "…alta de registro con enlace externo"; campo `penalidad-enlace` en el listado de campos; aserciones `multiple/accept` → `inputmode=url`; paso 5 = `fill('#penalidad-enlace', …)`; aserciones de "Ver Archivos" (href + target); **paso 8 nuevo**: abrir Editar → precarga correcta → cambiar enlace → guardar → 1 solo registro y href actualizado. |

### Compatibilidad y datos existentes

- PDFs heredados en store `adjuntos` (`penalidadId`): **NO se borran ni se ocultan**;
  siguen mostrándose como "Abrir PDF 1..N" y `eliminarPenalidad()` los sigue limpiando.
- El nuevo `enlaceArchivo` es opcional y no requiere migración: los registros viejos
  quedan sin botón hasta que se los complete vía Editar.
- Backup/importación no cambia (`adjuntos` sigue en `exportarDatos()`/`importarTodo()`).

### Validaciones (esta sesión)

- `node --check app.js` → **exit 0**.
- `npx vite build` → **exit 0** (664 ms; warnings pre-existentes sin `type="module"`).
- `npx playwright test tests/menu.spec.js --workers=1 -g "Penalidades"` → **1 passed**.
- Suite completa `menu.spec.js` → **8 passed, 1 failed**: el fallo es "Pilotos > Auditoría
  ACTC" (`__CDA_FETCHES__.length` esperaba 2, vino 1) y se **reproduce idéntico con
  `git stash` de los cambios de esta sesión** ⇒ **pre-existente, no relacionado**.
  (Durante la verificación se hizo `stash push` + `stash pop`; stash list = vacío,
  cambios restaurados y re-validados.)

### Estado de git

- `M app.js`, `M index.html`, `M tests/menu.spec.js`, `M .context/activeContext.md` — sin commitear.
  (Antes de esta sesión solo estaba pendiente `.context/activeContext.md`; el trabajo de
  las sesiones (3) y (4) ya está en HEAD `5892679`.)

### Próximos pasos

- Verificación manual: crear una penalidad con enlace → aparece "Ver Archivos"; Editar →
  cambiar y vaciar el enlace; si hay PDFs heredados, confirmar que siguen abriéndose.
- Investigar aparte el fallo **pre-existente** del test "Auditoría ACTC" (bypass de caché).
- Commit de los 4 archivos modificados.

---

## Sesión 10/06/2026 (4): EDITAR AUTORIZACIÓN (agregar/cambiar enlace por fila)

> Tarea del usuario: en **Pilotos > Autorizaciones**, la tabla solo tenía Eliminar.
> Se pidió poder **agregar el enlace** a un registro cargado sin él, o **modificar**
> el registro. Ahora cada fila tiene un botón **Editar** (ícono lápiz) que abre el
> modal `#modal-editar-autorizacion`.

### Cambios de esta sesión

| Aspecto | Archivo | Detalle |
|---|---|---|
| Botón Editar por fila | `app.js` | `listarAutorizaciones()`: en la celda ACCIONES se agregó, ANTES del botón Eliminar, un botón `title="Editar autorización (agregar o cambiar enlace)"` que llama a `editarAutorizacion(id)`. Clase `btn btn-secondary` + `fa-pen-to-square`. |
| Modal de edición | `index.html` | Nuevo `#modal-editar-autorizacion` (`.modal-overlay`, max-width 560px), insertado **ANTES** de `#subModalCategoriasAuth` para que la ruedita de categorías apile correctamente encima (mismo criterio que los sub-modales sobre `#modal-alerta`). Campos: `#editar-autorizacion-info`, `#editar-autorizacion-nombre/apellido/categoria` (categoría con `.input-con-gear` + ruedita y `list="categorias-autorizacion"`), y **`#editar-autorizacion-enlace`** (`type="text" inputmode="url"`, NO `type="url"` — misma lección del formulario principal: la validación nativa bloqueaba enlaces de Drive/OneDrive sin esquema). Botón `#editar-autorizacion-btn-guardar` → `guardarEdicionAutorizacion()`. |
| Abrir y precargar | `app.js` | `editarAutorizacion(id)`: `puedeEditar()`; `obtenerPorId`; `poblarCategoriasAutorizacion()`; rellena info + los 4 campos; guarda el id en `modal.dataset.autorizacionId`; `openModal`. |
| Guardar cambios | `app.js` | `guardarEdicionAutorizacion()`: valida nombre/apellido/categoría; **parte del registro existente** (`...existente`) para no perder `usuarioCreacion`/`fechaCreacion`/versionado; sobrescribe los editados + `fechaModificacion`/`usuarioModificacion`; `guardar()` (id ya presente ⇒ el validador acepta la edición); toast + `closeModal` + `listarAutorizaciones()`. El enlace vacío **quita** el botón "Ver Archivos". |

### Nota de comportamiento

- El registro SIN enlace ahora es editable: se le puede pegar el enlace y pasa a
  mostrar el botón "Ver Archivos". Con enlace ya existente se puede cambiar o vaciar.
- No se duplican registros: se reutiliza el `id` ⇒ `put()` sobrescribe en IndexedDB
  y `set(..., {merge:true})` en Firestore. Se preserva el `id` y el `dataset` del modal.
- El modal de edición reutiliza el **mismo datalist `#categorias-autorizacion`** que la
  planilla de alta (una sola fuente de categorías).

### Validaciones (esta sesión)

- `node --check app.js` → **exit 0**.
- `npx vite build` → **exit 0** (626 ms; warnings pre-existentes de `db.js`/`app.js` sin `type="module"`).
- `npx playwright test tests/menu.spec.js --workers=1 -g "Autorizaciones"` → **2 passed** (alta manual/Ver Archivos/baja + Migración V18).
- 0 secuencias mojibake (UTF-8 sin BOM).

### Estado de git

- `M app.js`, `M index.html` (+ los `M` previos de sesiones anteriores sin commitear:
  `db.js`, `src/services/viewManager.js`, `src/utils/permisosUtil.js`, `src/views/index.js`,
  `tests/menu.spec.js`, `styles.css`, `.context/activeContext.md`).

### Próximos pasos

- Verificación manual: crear una autorización SIN enlace,Editarla,p egar un enlace de
  Drive y confirmar que aparece "Ver Archivos"; y que se pueda vaciar el enlace.
- Considerar agregar un test E2E del flujo de edición (cubrir `editarAutorizacion` +
  `guardarEdicionAutorizacion`) en `tests/menu.spec.js`.

## Trabajo reciente (última sesión)

**Nuevo submódulo "Autorizaciones" dentro del grupo Pilotos (debajo de Penalidades) + fix del guardado manual (enlace sin esquema) + "ruedita" para gestionar categorías. Todo validado con test E2E en verde.**

### Cambios de esta sesión

| Aspecto | Archivo | Detalle |
|---|---|---|
| **Módulo Autorizaciones** | `src/utils/permisosUtil.js` | Nuevo `autorizaciones` en `CATALOGO_MODULOS` (`fa-file-signature`, `orden: 17`, funciones `['ver','crear','eliminar']`). Renumerados `alojamiento`→18, `categorias-circuitos`→19, `configuracion`→20. |
| Menú / navegación | `src/services/viewManager.js` | `VIEWS` + `autorizaciones`; `GRUPOS_MENU` de pilotos ahora `['listado-pilotos','penalidades','autorizaciones']`; `abrirSubmenuDeVista` y `cargarDatosVista` (`invocarGlobal('listarAutorizaciones')`). |
| Agregador de vistas | `src/views/index.js` | `autorizaciones` agregado a `VIEW_IDS`. |
| Persistencia | `db.js` | **`DB_VERSION` 16 → 17** + store `autorizaciones` (guard `.contains()`, `keyPath:'id'` autoIncrement, igual que `penalidades`); agregado a `importarTodo()`. **FIX (V17 → 18): REPARACIÓN DEFINITIVA** del store `autorizaciones` — un navegador abrió la base en V17 y el store quedó sin materializar (guardado manual fallaba con *"Object store 'autorizaciones' no disponible en IndexedDB"*). Mismo patrón que V11 (`tiposMovimiento`) y V16 (`pilotos`): bump a **V18** + bloque `if (event.oldVersion < 18)` con `.contains()` que fuerza la creación física. |
| Vista | `index.html` | `#view-autorizaciones` (entre `#view-penalidades` y `#view-alojamiento`): planilla `editor-only` con `#autorizacion-nombre/apellido/categoria` + ruedita `.gear-btn` → `abrirModalCategoriasAuth()`, `#autorizacion-enlace` (**`type="text"` con `inputmode="url"`, NO `type="url"`**: la validación nativa de URL bloqueaba el submit al pegar enlaces de Drive/OneDrive sin esquema — era la causa de "no me deja guardar"), botón `#autorizacion-btn-importar` + input oculto `#autorizacion-import-file` (`accept=".html,.htm,.xls,.csv"`), y tabla con `#autorizaciones-table-body`. Nuevo **`#subModalCategoriasAuth`** (réplica de `#subModalTiposSancion`). |
| Lógica | `app.js` | `guardarAutorizacionForm`, `listarAutorizaciones` (buscador + botón **"Ver Archivos"** con `target=_blank`, mismo patrón que `documentosUrl` en Competencias), `eliminarAutorizacion`, `limpiarFormularioAutorizacion`, `poblarCategoriasAutorizacion`, importación XLS (`dispararImportarAutorizaciones` + parser nativo `mapearColumnasAutorizacion`/`parsearCsvAutorizacion`/`extraerRegistrosAutorizacion` + `importarAutorizacionesLotes`). **Ruedita de categorías** sobre el store `categorias` REAL (compartido con Competencias/Pilotos/Penalidades): `abrirModalCategoriasAuth`, `renderizarListaCategoriasAuth` (nombres SIEMPRE vía `textContent`), `guardarCategoriaAuthModal` (alta + edición, dedup case-insensitive, `categoriaAuthEditandoId`), `editarCategoriaAuth`, `cancelarEdicionCategoriaAuth`, `eliminarCategoriaAuth` (modal de confirmación). `autorizaciones` agregado a `exportarDatos()`. |
| Test | `tests/menu.spec.js` | Submenú de pilotos con **3 hijos**; test "Pilotos > Autorizaciones" ampliado: ruedita (alta, alta duplicada rechazada, edición, repoblado del datalist por `option[value]`, baja), alta manual con enlace **sin esquema**, "Ver Archivos" (href/target) y baja de la autorización. **Test nuevo "Migración V18"**: siembra una IndexedDB en V17 SIN el store `autorizaciones`, verifica que al cargar la app el store se crea físicamente y el alta manual funciona (cubre el error reportado por el usuario). |

### Validaciones (esta sesión)

- `node --check app.js`, `node --check db.js`, `node --check tests/menu.spec.js` → exit 0.
- `npx vite build` → **exit 0** (warnings esperados de `db.js`/`app.js` como scripts clásicos copiados por `viteStaticCopy`).
- `npx playwright test tests/menu.spec.js --workers=1` → **7 passed / 1 failed**. El fallo es el test **"Auditoría ACTC"** (`fetches === 2`), **PREEXISTENTE y ajeno** (verificado con `git stash`: falla igual sin mis cambios; tema de red/timing de Serper). Autorizaciones, Penalidades y Listado pasan.

### Estado de git

**Sin commitear:** `M app.js`, `M db.js`, `M index.html`, `M src/services/viewManager.js`, `M src/utils/permisosUtil.js`, `M src/views/index.js`, `M tests/menu.spec.js`, `M .context/activeContext.md`.

### Auditoría universal (eliminar bloqueo de padrón local)

**Auditoría universal: sin bloqueo del padrón local; postulante externo con búsqueda web transparente, sanción genérica con ID sintético y revisión humana.**

### Cambios de esta sesión

| Aspecto | Archivo | Detalle |
|---|---|---|
| Eliminar `return` de validación local | `app.js` | En `auditarPiloto` se elimina el `return` que cortaba la ejecución cuando el piloto no está en el padrón. Al no encontrarse, se pinta el aviso gris de postulante externo y se continúa con `fetch` a `google.serper.dev/search` en caliente (idéntico al de un piloto registrado). |
| Postulante externo | `app.js` | `pilotoExternoDesdeTexto()` genera `dni` sintético de 11 dígitos (hash djb2, prefijo `9`); `apellido` = última palabra del input; `externo: true`. |
| Mensaje informativo | `app.js` | `ℹ️ Piloto no registrado en el padrón CDA (Postulante Externo). Iniciando búsqueda web...` (clase `.es-cargando` = gris `var(--text-secondary)`). |
| Sanción genérica de externo | `app.js` | `autoSancionarActc()` escribe `registro` en `penalidades` con `id: Number(piloto.dni)` (sintético de 11 dígitos), `dni: String(piloto.dni)`, `nombre: nombreCompleto`, `apellido: piloto.apellido || ''`. |
| Confirmación manual | `app.js` | `confirmarSancionActc()` → `autoSancionarActc(piloto, categoriaDetectada)` → `guardar('penalidades', registro)`; toast + limpieza. |
| E2E | `tests/menu.spec.js` | Nuevos tests de `Nadie Existe` (aviso + fetch ×3) y `Pablo Externo` (confirmar → sanción con ID sintético 11 dígitos). |

### Validaciones (esta sesión)

- `node --check app.js` → **exit 0**.
- `npx vite build` → **exit 0** (vite v6.4.3, 1.14 s; los avisos de `type="module"` son preexistentes por el uso de scripts clásicos).
- `npx playwright test tests/menu.spec.js --workers=1` → **7 passed** (1.1 m; exit 0). Los 6 fallos previos por `browserContext.close: ENOENT` desaparecen tras borrar `test-results`.

---

## Sesión anterior — Auditoría ACTC: auto-sanción eliminada → flujo 100% humano (bypass + site:)

**Auditoría ACTC: auto-sanción eliminada → flujo de revisión 100% humana.**

### Cambios de esa sesión

| Aspecto | Archivo | Detalle |
|---|---|---|
| Estado pendiente | `app.js` | Nueva variable `let _pendienteActc = null` (módulo-level): guarda `{ piloto, categoriaDetectada, sufijoCache }` mientras el positivo aguarda confirmación. Se limpia al confirmar o al cancelar. |
| `mostrarEvidenciasActc()` | `app.js` | Nueva función: en positivo, renderiza dentro de `#auditoria-estado` un panel con cabecera de alerta, lista `<ol>` de hasta 5 snippets (título como `<a target="_blank">` + párrafo snippet), y dos botones: **"⚠️ Confirmar Infracción y Sancionar Piloto"** + **"Cancelar"**. Todo el contenido externo (Serper) pasa por `escapeHtml()`. |
| `cancelarAuditoriaActc()` | `app.js` | Limpia `_pendienteActc`, vacía el panel y apaga el banner. Sin escritura en ninguna base de datos. |
| `confirmarSancionActc()` | `app.js` | Lee `_pendienteActc`, lo limpia, deshabilita el botón mientras procesa, llama `autoSancionarActc()` + `refrescarDashboardTrasAuditoria()` + `alternarBannerAuditoriaActc(true)`. Solo ocurre al clic manual del admin. |
| `auditarPiloto()` | `app.js` | Rama POSITIVO: eliminada secuencia auto-sanción (`pintarVeredictoAuditoriaActc` + `autoSancionarActc` + `refrescarDashboard`). Reemplazada por `mostrarEvidenciasActc(piloto, categoriaDetectada, resultado, sufijoCache)`. |
| `resultado` object | `app.js` | Agrega campo `organic: data.organic.slice(0,5)` para el panel. Si viene de caché sin `organic`, muestra aviso "Resultado en caché: no hay fuentes disponibles". |
| Banner text | `app.js` | "Registrado **automáticamente**" → "sanción **confirmada** y registrada…" |
| Bypass de Caché (Depuración) | `app.js` | Desactivada temporalmente la lectura de `/auditoria_cache` y `localStorage` en `auditarPiloto()`. Todas las auditorías viajan en caliente a Serper.dev consumiendo saldo real para validación de datos en vivo. |
| Afinado de query + `site:` | `app.js` | Se agregaron restricciones de dominio al query de Serper: `(site:actc.org.ar OR site:solotc.com.ar OR site:campeones.com.ar OR site:carburando.com)`. Además, si se busca por apellido (ej. "COTIGNOLA"), se envía el apellido solo para capturar todas las variantes de nombres en los resultados orgánicos. |
| Tests E2E adaptados | `tests/menu.spec.js` | Test actualizado para validar que el query lleve `site:actc.org.ar` y que las re-auditorías realicen el fetch directo bajo el bypass temporal. |

### Validaciones

- `npx vite build` → **exit 0** (724 ms).
- `npx playwright test tests/menu.spec.js --workers=1` → **7 passed** (1.1m, exit 0). Suite completa en verde con bypass de caché y operadores `site:`.

---

## Sesión anterior — Tarjeta ACTC on-demand + anti-cuota

**Tarjeta "CONSULTA PILOTOS ACTC" 100% client-side: input + botón "Auditar", fetch Serper, caché 7 días, banner, (antes) auto-sanción.**

### Cambios de esta sesión (auditoría ACTC)

| Aspecto | Archivo | Detalle |
|---|---|---|
| **Anti-cuota / veredicto inmediato** | `app.js` | La UI ya **no espera a Firestore**: (1) helper `conCorteDeSeguridad(promesa, ms=1500, valorPorDefecto=null)` (~línea 3286) que hace `Promise.race` con timeout y `catch` interno (`console.warn('Firestore en pausa temporal:', e)`) — necesario porque con `Quota exceeded` el SDK **no rechaza** el await (queda en backoff) y el `try/catch` solo no saltaba; (2) `pintarVeredictoAuditoriaActc(positivo, sufijoCache)` (~línea 3265) pinta apenas retorna el JSON de Serper: positivo → `⚠️ Actividad detectada en ACTC 2026. Piloto Inhabilitado.` (clase `es-alerta`, rojo bold), negativo → `✓ Piloto Verificado: Sin anomalías en ACTC 2026` (clase `es-ok`, verde bold), limpiando "Consultando Serper.dev…" en el mismo paso; (3) `escribirAuditoriaCache()` en la nube se dispara **sin await** (`void conCorteDeSeguridad(...)`, el espejo `localStorage` es síncrono antes del `setDoc`); (4) `autoSancionarActc()` envuelve `guardar('penalidades', ...)` en `try/catch` + corte de 1.5 s (el `setDoc` va DESPUÉS del `put` IndexedDB dentro de `guardar()`, así que lo local siempre persiste); (5) `getDoc` de `leerAuditoriaCache()` y `buscarPilotoEnPadron()` también con corte de 1.5 s (fallback al espejo local). El mensaje positivo final conserva `auto-sancionado` + `vencimiento` + sufijo de caché tras la sanción. Veredicto pintado en <1 s tras el fetch, muy por debajo del objetivo de 3 s. |
| Vista | `index.html` | Tarjeta **CONSULTA PILOTOS ACTC** `#pilotos-kpi-actc-card` en columna, **encabezado depurado**: título `<h3>CONSULTA PILOTOS ACTC` (sin span de año; se removió `#pilotos-kpi-actc-anio`), badge `#pilotos-kpi-actc-badge` ("PELIGRO", `hidden`) e ícono `#pilotos-kpi-actc-icono`. **Removidos** el número gigante `<p id="pilotos-kpi-actc" class="stat-alerta-num">` y la nota `<span id="pilotos-kpi-actc-nota">` ("N categoría sin fiscalizar") — no pertenecen al módulo. Abajo: formulario `.auditoria-form--tarjeta` con `#input-auditar-piloto` + `#btn-auditar-piloto` ("Auditar", `type=submit` → `auditarPiloto()`), `#auditoria-estado` y `#auditoria-banner` (`role="alert"`, `hidden`). **Eliminados**: loader `#pilotos-kpi-actc-loader` y la `.chart-card` separada `#pilotos-auditoria-card`. Configuración: card `admin-only` con `#config-serper-key` (`type=password`), spans `.config-save-msg`. |
| Lógica | `app.js` | Sección `PILOTOS: AUDITORÍA ACTC EN CALIENTE (SERPER)` (~línea 3211): **100% on-demand** — sin debounce ni timer; `auditarPiloto()` solo por clic/Enter. Flujo: `input.value.trim().toUpperCase()` + `escapeHtml` antes de tocar el DOM → `buscarPilotoEnPadron()` (`getTodos('pilotos')` + hot `getDoc` `/pilotos/{dni}` si hay sesión) → no registrado ⇒ mensaje exacto **"Piloto no registrado en el padrón CDA"** y corte → `leerAuditoriaCache()`/`escribirAuditoriaCache()` (`/auditoria_cache/{dni}` ≤7 días + espejo `localStorage`) → `consultarSerperActc()` (POST **`https://google.serper.dev/search`** — endpoint oficial (OpenAPI de Serper); **la raíz `serper.dev/search` NO sirve**: responde 405 y no envía cabeceras CORS (por eso el error de consola previo) — verificado con preflight: `access-control-allow-origin: *` y `X-API-KEY` permitido —, **directo desde el navegador — 100% client-side, sin backend ni scripts de Python; apto GitHub Pages** —, headers **`X-API-KEY` + `Content-Type` exactos** con `'X-API-KEY': apiKeyRecuperada.trim()`, key recuperada de `localStorage['serper_api_key']` con fallback a `configuracionGlobal.serperApiKey` — base híbrida `/configuracion/global` con fallback IndexedDB —, body **`JSON.stringify({ q })`** con `` q = `"${nombre}" AND ("Turismo Carretera" OR "TC Pista" OR "TC Pick Up" OR "ACTC") AND "${año}"` `` → evalúa a `"2026"` en el año en curso) → `analizarSnippetsActc()` (primeros 5 `organic`: año + categoría ⇒ positivo) → `autoSancionarActc()` (`motivo` literal *"Participación en categoría no fiscalizada por la ACTC durante el año corriente 2026"*, `fechaFin` `${año}-12-31`, `vencimiento` `31/12/${año}`, `sancion` corta con la categoría, `autoActc:true`, DNI como `id` vía `guardar` = `setDoc` idempotente) + `refrescarDashboardTrasAuditoria()` + banner `alternarBannerAuditoriaActc(true)` (texto exacto **"⚠️ Piloto inhabilitado: Registrado automáticamente en la lista de sancionados"**, se apaga al iniciar cada nueva auditoría). |

| KPI reactivo | `app.js` | `renderKpiPilotos()`: el contador/nota ACTC (`#pilotos-kpi-actc`, `#pilotos-kpi-actc-nota`) se **eliminó del DOM y de la función** (ya no hay número gigante ni "N categoría sin fiscalizar"); también cayó `#pilotos-kpi-actc-anio` (el título es fijo **CONSULTA PILOTOS ACTC**). Solo quedan `badgeActc.hidden = autoActc === 0` y `.is-peligro` en `#pilotos-kpi-actc-card` + `#pilotos-kpi-actc-icono` cuando hay auto-sanciones vigentes. |
| Config | `app.js` | `precargarEnlaceSheets()` precarga `#config-serper-key` priorizando `localStorage['serper_api_key']`; `guardarConfiguracion()` guarda `{id:1, urlGoogleSheets, serperApiKey}` **fusionando con la cfg previa** (un input ausente no borra el otro), **espeja la key a `localStorage['serper_api_key']`** (removeItem si vacía) y actualiza todos `.config-save-msg`. `configuracionGlobal` sigue en `STORES_NO_SYNC` → la key nunca viaja a la nube. |
| CSS | `styles.css` | Bloque "Auditoría ACTC" antes de "Filtro por mes del Calendario": `.auditoria-form`/`.auditoria-estado` + variantes `.es-cargando/.es-ok/.es-alerta/.es-error`, `.auditoria-nombre`, `.auditoria-cache-tag`, `.alerta-badge` (rojo con glow), `.stat-card-alerta.is-peligro`. **Nuevo en esta sesión:** `.stat-card-alerta` en columna (`flex-direction:column; position:relative`), `.stat-fila-actc` (KPI + ícono en fila), `.auditoria-form--tarjeta` (compacto dentro de la tarjeta) y `.auditoria-banner` (absoluto, rojo, flotante sobre el formulario, `@keyframes auditoria-banner-in`, regla `[hidden]{display:none}`). **Eliminados** `.audit-spinner` y `@keyframes audit-spin`. Media query ≤760px sigue apilando el formulario. |
| Test | `tests/menu.spec.js` | Test "Pilotos > Auditoría ACTC bajo demanda: sin spinner, cruce Serper, caché de 7 días y auto-sanción" (stubs de `getTodos`, `guardar` idempotente por id y `fetch`): formulario **dentro de** `#pilotos-kpi-actc-card`, `#pilotos-kpi-actc-loader` count 0, **`#pilotos-kpi-actc` y `#pilotos-kpi-actc-nota` count 0** (placeholders removidos, también en el test del dashboard), tipear NO dispara nada (900ms ⇒ 0 llamadas), clic ⇒ UNA llamada con `X-API-KEY` y query del alcance, sanción con DNI-ID + `motivo` literal *"…durante el año corriente 2026"* + `fechaFin '2026-12-31'`, **banner visible** con *"⚠️ Piloto inhabilitado: Registrado automáticamente en la lista de sancionados"*, badge + `.is-peligro`, mini-tabla (prefijo del motivo), caché 7 días sin 2ª llamada, inexistente ⇒ *"Piloto no registrado en el padrón CDA"* sin llamada, verde "Piloto Verificado" con banner apagado. |

### Notas / decisiones de diseño
- **Post-Confirmación (esta sesión)**: Tras confirmar manualmente una infracción ACTC (botón `Confirmar Infracción y Sancionar Piloto`), el input `#input-auditar-piloto` se limpia, y el panel de evidencias (junto con el banner de alerta) se resetea inmediatamente llamando a `cancelarAuditoriaActc()`. El feedback de éxito se traslada exclusivamente al toast (`mostrarToast`), dejando la tarjeta 100% limpia para realizar consultas consecutivas sin molestias visuales. Las aserciones de E2E fueron actualizadas para validar esta limpieza.


- El encargo pedía `setDoc` con DNI como ID en "la colección de sancionados": se cumple vía `guardar('penalidades', { id: Number(dni) })` → mismo doc ID local y en `/penalidades/{dni}`, preservando el esquema real que consume el render (`fechaFin` para el badge "Vigente", `apellido` vacío con `nombre` completo). Los campos literales del encargo (`vencimiento`, `estado`) se guardan además por compatibilidad.
- `/auditoria_cache` requiere sesión Firebase para la nube; sin ella manda el espejo `localStorage` (misma vigencia de 7 días). Las reglas wildcard ya cubren la colección (lectura `signedIn`, escritura roles operativos): **sin cambios en `firestore.rules`**.
- La API key de Serper queda solo en el navegador (`localStorage['serper_api_key']` + `configuracionGlobal`, lista negra de sync). Riesgo aceptado y documentado (análogo al de Firebase, que también va en el bundle). **Sin backend ni scripts de Python: el POST a serper.dev sale del navegador (GitHub Pages compatible).**
- **Sin disparo automático**: no hay debounce ni polling; si el usuario solo tipea, no se consume saldo de Serper. El texto se sanitiza con `.toUpperCase()` + `escapeHtml()` antes de tocar el DOM; la query conserva el nombre canónico del padrón.
- El banner `#auditoria-banner` es la única superficie "flotante": se inyecta con `textContent` (fijo, sin HTML del usuario) **abajo del input** y se apaga al inicio de cada nueva auditoría. Texto exacto de éxito: *"⚠️ Piloto inhabilitado: Registrado automáticamente en la lista de sancionados"*.
- **Limpieza de placeholders (esta sesión)**: se removieron de la tarjeta el número gigante (`#pilotos-kpi-actc`, ej. "26") y la nota `#pilotos-kpi-actc-nota` ("N categoría sin fiscalizar") + su lógica en `renderKpiPilotos`; el badge/borde `.is-peligro` siguen reaccionando a `autoActc`. El `motivo` de la sanción ahora es literal *"Participación en categoría no fiscalizada por la ACTC durante el año corriente 2026"* (año dinámico) y el body de Serper es solo `{ q }` (sin `num`).

### Validaciones (esta sesión)

- `node --check app.js` y `node --check tests/menu.spec.js` → exit 0.
- `npx vite build` → exit 0. Los avisos sobre `db.js`/`app.js` sin
  `type="module"` son preexistentes (scripts clásicos by design).
- `npx playwright test tests/menu.spec.js --workers=1` → **6 passed /
  1 failed**: pasa el test de la auditoría ACTC (`...cruce Serper, caché de
  7 días y auto-sanción` ✓, 4.6 s) y falla solo `Pilotos > Penalidades`;
  el fallo **se reprodujo también con `git stash` sobre HEAD limpio** →
  preexistente/ambiental (cuota Firebase, ver advertencia abajo).

### ⚠️ Advertencia operativa: test Penalidades falla por cuota Firebase

- **Síntoma**: el alta en `#form-nuevo-tipo-sancion` no pinta en
  `#lista-tipos-sancion` (timeout 10 s); los 5 tipos por defecto aparecen
  **sin `id`** (fallback en memoria → sin botones Editar/Eliminar).
- **Causa raíz** (diagnosticada con spec temporal + probe): en
  `src/services/persistenceService.js` `guardar()` hace
  `await rt.setDoc(...)` (comentario dice "No bloqueante" pero se espera) y
  Firestore del proyecto `controlcda-e5f97` responde
  `FirebaseError [resource-exhausted]: Quota exceeded` → SDK entra en
  *maximum backoff* → el `await` queda **colgado >60 s** → ni el toast ni
  `renderizarListaTiposSancion()` se ejecutan (lo mismo bloquea el seed
  `migrarTiposSancionV14`, por eso los defaults sin `id`).
- **Fix posibles** (pendiente de decisión, fuera del alcance ACTC):
  (a) revisar cuota/billing/plan del proyecto Firebase y esperar el reset;
  (b) hacer el `setDoc` de `guardar()` realmente fire-and-forget
  (`void rt.setDoc(...).catch(warn)`), coherente con el comentario "No
  bloqueante" y con el diseño local-first — la app seguiría funcionando
  con la nube caída.
- **Mitigación YA aplicada en el flujo ACTC (esta sesión)**: `app.js` ya no
  espera a Firestore en ninguna lectura/escritura de la auditoría (ver fila
  "Anti-cuota / veredicto inmediato"): `conCorteDeSeguridad()` (carrera con
  timeout de 1.5 s + `console.warn('Firestore en pausa temporal:', e)`),
  escritura de caché dispara-y-olvida y veredicto rojo/verde pintado apenas
  retorna el JSON de Serper. La auditoría muestra el resultado en <1 s aunque
  la cuota siga agotada. **El seed/`guardar()` del resto de la app (vista
  Penalidades, altas de tipos de sanción) sigue afectado** hasta aplicar (a) o (b).

### Estado de git

**SIN COMMIT (esperando confirmación del usuario):** working tree con
`M app.js`, `M index.html`, `M styles.css`, `M tests/menu.spec.js`,
`M .context/activeContext.md` → incluye la columna **Categoría** de la sesión
anterior (aún no commiteada) + la auditoría ACTC de esta sesión. Commit
sugerido al dar luz verde: `feat(pilotos): columna Categoría y auditoría ACTC en caliente con Serper`.

### Próximos pasos

1. Commit + push de los 5 archivos pendientes (previa confirmación).
2. Cargar la API key real de Serper en Configuración y probar un cruce real
   desde el navegador. **Restricción de diseño**: la consulta debe ser 100%
   client-side (GitHub Pages, sin backend ni Python); si serper.dev no envía
   cabeceras CORS que habiliten el POST desde el navegador, escalar al usuario
   (el alcance prohíbe montar un servidor proxy).
3. Backlog abierto: cruce ACTC por DNI contra padrón oficial, reactividad del
   dashboard al alta de pilotos, filtros por categoría/sanción.

## Sesión anterior — Dashboard de Pilotos (conservada por referencia)

**Paso 2 resuelto: la vista padre "Pilotos" pasa de placeholder a dashboard dinámico de 4 ítems.**

### Cambios de esta sesión

| Aspecto | Archivo | Detalle |
|---|---|---|
| Vista | `index.html` | `#view-pilotos` reemplaza "Módulo en construcción" por: `header` (`page-title` "Control de Pilotos"), fila 1 `.stats-grid` con 3 `.stat-card` (KPI total `#pilotos-kpi-total`, sanciones vigentes `#pilotos-kpi-vigentes`, alerta ACTC `#pilotos-kpi-actc` en `.stat-card-alerta` + `.stat-alerta-num`), fila 2 `.charts-grid` con `.chart-card` de barras (`#pilotos-categorias-body`, cabecera `#pilotos-cat-total`) y mini-tabla `.tabla-sancionados` (`thead` Nombre y Apellido / Categoría / Sanción / Motivo / Vencimiento, `tbody#pilotos-sancionados-body`), más un tercer `.charts-grid` de pie con `.dash-pie-links` (`.link-like` que llaman a `navegarDesdeDashboard('listado-pilotos'|'penalidades')`) y `.dash-aviso-actc` (texto de alcance del cruce). Los dos primeros `.stat-card` son `role="link"` navegables. |
| CSS | `styles.css` | Bloque nuevo antes de "Filtro por mes del Calendario": `.cat-bar-*` (row/head/name/count/track/fill, `.is-alerta`), estados `.cat-bar-placeholder`/`.pilotos-vacio`, skeleton `.cat-bar-skeleton` + `@keyframes cat-shimmer`, `.tabla-sancionados*`, `.stat-card-alerta`/`.stat-icon-alerta`/`.stat-alerta-num`, `.dash-pie-links`/`.dash-aviso-actc` y media query móvil. Todo lo demás reutiliza vocabulario existente (`.stats-grid`, `.stat-card`, `.chart-card`, `.charts-grid`, `.badge-*`, `.tag`): **sin librerías de gráficos ni `.card`/`.progress-bar` nuevos**. |
| Lógica | `app.js` | Bloque `// ==================== PILOTOS: DASHBOARD DEL MÓDULO ====================` (~línea 2948, antes de la sección de importación del padrón): `renderDashboardPilotos()` (skeleton → `Promise.all(getTodos('pilotos'), getTodos('penalidades'))` → KPIs/barras/sancionados; `catch` → `mostrarToast`), `pintarSkeletonPilotos()`, `normalizarCategoriaPiloto()` (**NFD quita tildes** + colapsa espacios: "Sport Histórico" y "SPORT HISTORICO" caen en la misma barra), `categoriaEnAlertaActc()` + `CATEGORIAS_ACTC_NO_FISCALIZADAS` (heurística actual), `conteoPorCategoriaPilotos()` (dedup por DNI con `Set`, orden desc), `fechaPenalidadAMs()` (parseo local de `YYYY-MM-DD`, evita el corrimiento UTC), `inicioDeHoy()`, `clasificarPenalidades()` (vigente = sin `fechaFin` o `fin >= hoy`; cumplidas en caso contrario), `renderKpiPilotos()` (`Intl.NumberFormat('es-AR')`), `renderBarrasCategorias()` (ancho % del máximo, mínimo 3%, `background` de `TONOS_CATEGORIA` salvo en alerta) y `renderSancionados()` (top 12, vigentes ordenadas por vencimiento más próximo, `escapeHtml` + `formatearFechaVisual`, badges `badge-warning`/`badge-success`, columna **Categoría** de `p.categoria` con fallback `—`). |
| Disparador | `src/services/viewManager.js` | `cargarDatosVista()` `case 'pilotos': await invocarGlobal('renderDashboardPilotos')` (antes era `break` vacío). Función global en `app.js` → visible en `window`, mismo patrón que `listarPilotos`. |
| Test | `tests/menu.spec.js` | El test de "Pilotos" pasa de validar el placeholder a validar el dashboard: `page-title`, ausencia de "Módulo en construcción", 1 `.stats-grid` + 2 `.charts-grid`, `#pilotos-kpi-total` con número, `.stat-card-alerta` presente, estado vacío de `#pilotos-categorias-body` (`Sin pilotos cargados`/`Cargando`) y las 4 columnas del `thead` de sancionados (incluye **Categoría** de la penalidad). **`renderDashboardPilotos` queda sin stub a propósito** (documentado en el comentario de `CARGADORES`): con IndexedDB vacía renderiza `0` + placeholder. |
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
  full-width) y documentación (**hoy enlace externo** `#penalidad-enlace`; esta
  sección se escribió cuando era `input multiple accept=.pdf`).
> **SUPERADO por la sesión 10/06/2026 (5):** el adjuntar PDFs (`agregarAdjuntoPenalidad()`,
> `#penalidad-adjuntos-list`, `PENALIDAD_MAX_PDF_BYTES`) fue reemplazado por un
> **enlace externo** (`enlaceArchivo` en el propio registro) + botón Editar por fila.
> Los PDFs ya persistidos en `adjuntos` siguen siendo legibles (columna Archivos).
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
  `firestore.rules`); el directorio de usuarios usa la nube siempre que hay SDK + sesión.
- Red de seguridad E2E: **6 tests de menú** (sin credenciales) + 2 de `app.spec.js`
  (requieren credenciales / login desactivado). Suite completa verificada en esta
  sesión: **6 passed / 2 skipped** (2,0 min, exit 0).

## Próximos pasos lógicos

1. **Commit + push** de los archivos modificados (`app.js`, `index.html`,
   `styles.css`, `src/services/viewManager.js`, `tests/menu.spec.js`,
   `.context/activeContext.md`) y considerar eliminar `?? fix_app.js`
   (parche roto de la sesión previa; su intención ya está aplicada en
   `confirmarSancionActc()`).
2. **Revertir el bypass de caché** al terminar la fase de depuración: en
   `auditarPiloto()` restaurar `const resultado = await leerAuditoriaCache(dni);`
   y el sufijo "(resultado en caché ≤7 días)". La escritura
   `escribirAuditoriaCache()` nunca se apagó, así que la caché a 7 días
   seguirá vigente al reactivar la lectura.
3. **Warnings de consola `persistenceService.js:347`** (`tiposMovimiento`,
   `tiposSancion`, `ubicacionesInventario`): diagnóstico a medias — son las
   ÚNICAS stores sincronizables con **índice único** en IndexedDB
   (`valor`/`nombre`) y a la vez las 3 últimas alfabéticamente del sync;
   candidatas: `ConstraintError` al hacer `store.put` de docs nube con id
   distinto pero mismo `valor`/`nombre`, o cuota IndexedDB. Falta abrir el
   Object del warn (`codigo`/`mensaje`) en consola del navegador para
   confirmar antes de tocar `sincronizarFirebaseALocal()`.
4. **Crear `.env`** en esta máquina (`copy .env.example .env` + claves de
   Firebase). Sin él, la app arranca sin identidad en la nube y la
   importación del padrón solo escribe en local.
5. Mejoras del dashboard de Pilotos (cruce REAL con la fuente ACTC, hoy
   heurística por `CATEGORIAS_ACTC_NO_FISCALIZADAS`; reactividad al alta;
   filtros por categoría/sanción). Evaluar **edición** de penalidades (hoy
   alta + baja) y exportación/imprenta del listado. Recordar: usuarios
   no-admin no ven módulos nuevos hasta que un admin edite su matriz.
6. Pendientes históricos: migración ESM de `app.js`, auditoría
   `technical_analysis.md` (S1 XSS / S2 CSV injection), tests E2E aislados.

## Advertencias operativas

- **`app.js` arrastra trabajo sin commitear**: en la sesión previa una
  sobrescritura/git checkout borró TODO el módulo de auditoría (solo
  sobrevivió en `dist/app.js`, la copia de `viteStaticCopy`). Commitear
  temprano; ante una pérdida, `dist/app.js` sirve como snapshot de
  recuperación (copia byte a byte del fuente al hacer build).
- **Máquina nueva / repo recién clonado**: el setup mínimo es
  `npm install` **+ `npx playwright install chromium`** (los navegadores viven en
  `%LOCALAPPDATA%\ms-playwright`, fuera del repo, así que no viajan con el clone;
  sin esto los 6 tests de menú fallan con `Executable doesn't exist`, no con un
  error de código). Además crear `.env` desde `.env.example`.
- **NUNCA** correr el test de login desactivado contra Firebase de producción:
  un login fallido dispara `intentarMigrarCuentaLocal()` y MUTA la cuenta real.
- La defensa de escritura del directorio de usuarios son las `firestore.rules` publicadas
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

## SESIÓN 10/06/2026 (3): SWITCH DE TEMA FUNCIONAL + GRÁFICOS SENSIBLES AL TEMA

### Qué se hizo

Problemas reportados: default oscuro OK pero el switch "no cambiaba", el label
decía "Modo Oscuro" sin coincidir, y la transición parpadeaba/texto feo.

- **app.js** (bloque THEME en `DOMContentLoaded`): reescrito completo:
  - `actualizarLabelTema(light)`: label `#theme-label` dinámico -> "Modo Claro"
    / "Modo Oscuro". Antes estaba congelado en el HTML (no coincidía nunca).
  - `aplicarTema(temaLight, swap)`: con `swap=true` añade `html.theme-swap` (clase
    que anula transiciones), cambia `data-theme` y la quita a los 2 frames vía
    `requestAnimationFrame`. Esto elimina el parpadeo.
  - Init `aplicarTema(..., false)` sin swap; listener `change` en
    `#theme-checkbox-toggle` persiste en `localStorage["cda_theme"]` y llama a
    `refrescarGraficosTema()`.
- **app.js** (auditoría de gráficos Chart.js):
  - Nuevo helper `cssVar(nombre)` = `getComputedStyle(documentElement).getPropertyValue()`
    (Chart.js no resuelve `var(--x)`; hay que pasarle el valor ya resuelto).
  - Nueva `refrescarGraficosTema()`: si la vista activa es dashboard o inventario,
    marca `dashboardDirty=true` y re-renderiza para que las instancias tomen los
    colores nuevos (Chart.js hornea los colores al crear la instancia).
  - `chartLineOptions()`: grid `--chart-grid`, ticks `--text-secondary` (antes hex fijo).
  - Torta dashboard + inventario: `borderColor -> --bg-card`, leyenda `-> --text-secondary`.
  - Barras concepto + stock: hover `-> --text-primary`, grid/ticks `-> vars`.
  - Línea evolución: `borderColor/pointBackgroundColor -> --accent-blue`,
    `backgroundColor relleno -> --chart-fill`, `pointBorderColor -> --bg-card`,
    tramo recto del `segment` -> `--accent-blue` (se evalúa en cada draw).
  - NO se tocaron los `#1f2a40` de reportes de impresión (HTML estático de
    print, correctos con fondo fijo).
- **styles.css**:
  - Nuevas vars `--chart-grid` y `--chart-fill` en `:root` (dark) y
    `[data-theme=light]`.
  - Nueva regla `html.theme-swap, * ... { transition:none!important; animation:none!important; }`
    que suprime toda transición mientras dura el swap de tema.
- **index.html**: labels inline `color:#94a3b8` (Año/Mes/títulos de gráficos)
  -> `color:var(--text-secondary)` (49 ocurrencias) para responder al tema.

### Validaciones

- `npx vite build` → **exit 0** (654 ms; warnings pre-existentes de `db.js`/`app.js`
  sin `type="module"`).
- 0 secuencias mojibake en app.js / styles.css / index.html (UTF-8 sin BOM).
- Colores de gráficos restantes con hex: solo en bloques de impresión (OK).

### Estado de git

- `M app.js`, `M styles.css`, `M index.html`, `M .context/activeContext.md`

### Próximos pasos

- Verificación visual/manual: default oscuro en cache limpio; alternar el switch
  actualiza label + tema sin parpadeo; logo visible en ambos temas; gráficos
  cambian ejes/leyendas/bordes al alternar (dashboard y inventario).
- Correr `npx playwright test --workers=1` si se quiere regresión E2E.

### Advertencias operativas nuevas

- PowerShell 5.1 rompe el escaping de comillas en comandos largos con JS/template
  literals: falla en parseo y NO escribe. Para inserts complejos usar el tool
`editor` con `insert_line`/`old_text` (respeta UTF-8) en vez de construir strings
  gigantes en una línea.
- Chart.js hornea colores al crear la instancia: cambiar `data-theme` NO repinta
  gráficos ya creados. Por eso `refrescarGraficosTema()` re-renderiza la vista activa.


## Sesion 15/10/2026 (5): SERPER — API key en Firebase (acceso multi-navegador)

> La API key de Serper estaba solo en localStorage/IndexedDB del navegador activo. En otro navegador la auditoria ACTC pedia la key de nuevo. Se mueve a Firestore (documento configuracionGlobal/1) para que cualquier navegador con sesion Firebase lea la misma clave.

### Cambios

| Archivo | Cambio |
|---|---|
| firestore.rules | Nuevo bloque match /configuracionGlobal/{docId}: read si signedIn(), write si esAdmin(). El comodin genérico /{collection}/{docId} ahora excluye tambien configuracionGlobal (precedencia). |
| db.js | STORES_NO_SYNC pasa de [usuarios, configuracionGlobal] a [usuarios]. configuracionGlobal SÍ se sincroniza a Firestore. |
| src/services/schemaValidator.js | STORES_NO_SYNC pasa de [usuarios, configuracionGlobal] a [usuarios]. |
| src/services/persistenceService.js | Comentario de lista negra actualizado: solo usuarios. |
| app.js | cargarConfiguracionGlobal(): nube-primero (getDoc configuracionGlobal/1 con corte 1.5s, fallback IndexedDB). consultarSerperActc(): orden invertido — nube primero, espejo localStorage como respaldo offline. guardarConfiguracion(): escribe tambien a Firestore (setDoc configuracionGlobal/1) con corte 1.5s. |
| index.html | Texto de la tarjeta actualizado: clave se guarda en Firebase + replica local offline, legible desde cualquier navegador con sesion. |

### Validaciones


### Pendiente / proximos pasos

1. Desplegar firestore.rules: firebase deploy --only firestore:rules (o npm run deploy:rules).
2. Probar en dos navegadores distintos con sesion Firebase: guardar la key en uno, abrir la app en el otro y verificar que la auditoria ACTC usa la misma clave sin pedirla de nuevo.
3. El archivo src/worker.js y wrangler.toml (sesion previa) quedan disponibles como alternativa futura de proxy; no se eliminan.

## Sesion 15/10/2026 (5): SERPER — API key en Firebase (acceso multi-navegador)

> La API key de Serper estaba solo en localStorage/IndexedDB del navegador activo. En otro navegador la auditoria ACTC pedia la key de nuevo. Se mueve a Firestore (documento configuracionGlobal/1) para que cualquier navegador con sesion Firebase lea la misma clave.

### Cambios

| Archivo | Cambio |
|---|---|
| firestore.rules | Nuevo bloque match /configuracionGlobal/{docId}: read si signedIn(), write si esAdmin(). El comodin generico /{collection}/{docId} ahora excluye tambien configuracionGlobal (precedencia). |
| db.js | STORES_NO_SYNC pasa de [usuarios, configuracionGlobal] a [usuarios]. configuracionGlobal SI se sincroniza a Firestore. |
| src/services/schemaValidator.js | STORES_NO_SYNC pasa de [usuarios, configuracionGlobal] a [usuarios]. |
| src/services/persistenceService.js | Comentario de lista negra actualizado: solo usuarios. |
| app.js | cargarConfiguracionGlobal(): nube-primero (getDoc configuracionGlobal/1 con corte 1.5s, fallback IndexedDB). consultarSerperActc(): orden invertido - nube primero, espejo localStorage como respaldo offline. guardarConfiguracion(): escribe tambien a Firestore (setDoc configuracionGlobal/1) con corte 1.5s. |
| index.html | Texto de la tarjeta actualizado: clave se guarda en Firebase + replica local offline, legible desde cualquier navegador con sesion. |

### Validaciones

node --check app.js / db.js / src/services/schemaValidator.js -> exit 0.
npx vite build -> exit 0 (560 ms, solo warnings preexistentes de type=module en db.js/app.js).

### Pendiente / proximos pasos

1. Desplegar firestore.rules: firebase deploy --only firestore:rules (o npm run deploy:rules).
2. Probar en dos navegadores distintos con sesion Firebase: guardar la key en uno, abrir la app en el otro y verificar que la auditoria ACTC usa la misma clave sin pedirla de nuevo.
3. El archivo src/worker.js y wrangler.toml (sesion previa) quedan disponibles como alternativa futura de proxy; no se eliminan.

--- 

## Sesión 10/06/2026 (9): SUBMENÚ INSCRIPCIONES EN PILOTOS

### Cambios

| Archivo | Cambio |
|---------|--------|
| `src/utils/permisosUtil.js` | Agregado módulo `inscripciones` (orden: 18, icono: `fa-ticket`, funciones: `['ver']`); desplazados alojamiento→19, categorías-circuitos→20, configuracion→21 |
| `src/services/viewManager.js` | `GRUPOS_MENU`: `pilotos` hijos ahora `['listado-pilotos', 'penalidades', 'autorizaciones', 'inscripciones']`; `VIEWS`: agregado `'inscripciones'`; `abrirSubmenuDeVista()`: mapeo `'inscripciones': ['submenu-pilotos', 'menu-pilotos']`; `cargarDatosVista()`: `case 'inscripciones': break` (vacío, pendiente de desarrollo) |
| `src/views/index.js` | Agregado `'inscripciones'` a `VIEW_IDS` |
| `index.html` | Sección `#view-inscripciones` vacía (título "Inscripciones", subtítulo "Módulo en construcción") |
| `tests/menu.spec.js` | Test actualizado: espera 4 hijos en submenú Pilotos (`['Listado de Pilotos', 'Penalidades', 'Autorizaciones', 'Inscripciones']`) |

### Validaciones

- `node --check` en los 3 archivos ES → exit 0
- `npx vite build` → exit 0 (1.13 s)
- `npx playwright test tests/menu.spec.js --workers=1` → **9 passed / 1 failed** (fallo preexistente en Auditoría ACTC, no relacionado)

### Estado de git

Sin commitear aún.
