# productContext.md — Control CDA

## Qué problema resuelve

Una comisión/entidad de automovilismo necesita controlar, en un mismo lugar:
qué competencias hay en el año, cuánto cuesta cada una (gastos simples +
rendiciones detalladas + personal), quién es el personal asignado y su
asistencia, qué insumos hay en inventario y dónde están, y dónde se aloja el
equipo. Todo con reportes imprimibles/exportables y control de quién puede ver
o editar cada cosa.

## Cómo funciona desde la perspectiva del usuario

1. **Login** (`index.html` → `src/services/authService.js`). Identidad en
   Firebase Auth; el local-part del email ES el username. Perfil en Firestore
   `usuarios/{id}` (id = username en minúsculas) con `rol` y `permisos`.
   Existe también autenticación local con hash `sha256$<salt>$<hash>` (db.js)
   para funcionar sin nube.
2. **Menú lateral dinámico**: `renderizarMenuLateral(usuario)` pinta
   `#menu-list` según permisos (`CATALOGO_MODULOS` en `src/utils/permisosUtil.js`).
   Hay 4 grupos desplegables (Gastos, Personal, Pilotos, Inventario) definidos
   en `GRUPOS_MENU` (`src/services/viewManager.js`).
3. **Navegación SPA**: clic en el menú → `switchView(viewId)` → alterna
   `.view.active` en las 19 secciones, sincroniza la URL por el router y
   dispara `cargarDatosVista(viewId)` (render del dashboard, listados, etc.).
   Sin recarga de página.
4. **Vistas principales**:
   - *Dashboard*: KPIs (gasto total anual, personal registrado, etc.), gráficos
     Chart.js, drill-down por mes, tarjetas que navegan a otras vistas.
   - *Calendario/Competencias*: alta/edición de competencias, código generado,
     detalle con staff asignado.
   - *Gastos*: gastos simples + "Carga Detallada" (rendiciones con adjuntos) +
     "Personal por Competencia"; protección de cambios sin guardar al salir;
     edición inline de montos.
   - *Staff/Personal*: alta de personal, listado imprimible a PDF, reporte de
     asistencia e "Estadísticas de Personal".
   - *Inventario*: artículos, movimientos (entrada/salida con ajuste de stock),
     categorías, entregas, ubicaciones/sectores con stock por ubicación;
     edición/eliminación de movimientos solo admin con rollback.
   - *Alojamiento*, *Categorías y Circuitos*, *Configuración* (solo admin).
   - *Pilotos*: grupo con dos hijos — "Listado de Pilotos" (placeholder) y
     "Penalidades" (planilla de sanciones: nombre, apellido, DNI, nro. de auto,
     categoría, **sanción de texto libre con sugerencias editables vía ruedita**,
     **fecha de inicio (obligatoria) y fecha de fin (opcional)**, motivo ampliado
     y adjuntos PDF; alta, listado con buscador + columnas Inicio/Fin y
     eliminación con confirmación). La **ruedita** abre el catálogo de tipos de
     sanción, donde se pueden **agregar, renombrar y borrar TODOS los tipos**
     (incluidos los 5 que vienen por defecto).
5. **Roles**: admin (acceso total), editor (carga/edición), viewer (solo lectura),
   supervisor (dashboard) y permisos "personalizados" por módulo con las
   funciones `ver/crear/editar/eliminar`.
6. **Persistencia**: todo se escribe primero en IndexedDB local (con caché en
   memoria) y, si está habilitado `VITE_CDA_SYNC_USUARIOS_NUBE` y hay sesión,
   se sincroniza con Firestore. Hay exportación/importación completa de datos y
   una migrador local → Firebase.

## Decisiones de UX relevantes

- Los menús padre navegan a su vista **y** alternan su submenú (recién corregido
  para que las vistas padre no reabran el submenú forzadamente).
- **Menú lateral legible**: cada ítem de primer nivel ocupa una sola fila (las
  etiquetas largas se recortan con "…" en vez de partirse en dos renglones) y la
  lista hace scroll interno si el contenido supera el alto de la pantalla. La
  planilla de Penalidades muestra sus 8 campos básicos en un único renglón.
- Confirmaciones y alertas usan un modal propio (`mostrarConfirmacion` /
  `mostrarToast`) en lugar de `alert()` nativo, y **siempre se dibujan por encima
  de cualquier sub-modal abierto** (z-index 2000).
- Protección de "cambios sin guardar" al salir del editor de rendiciones.
- Todo dato insertado en `innerHTML` debe pasar por `escapeHtml()` (regla
  derivada de la auditoría `technical_analysis.md`, hallazgos S1/S2).
