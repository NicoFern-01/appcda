# INFORME TÉCNICO - MÓDULO INVENTARIO

## 1. ANÁLISIS DEL PROYECTO EXISTENTE

### Arquitectura
- **Patrón**: SPA (Single Page Application) con HTML/CSS/JS puro
- **Base de datos**: IndexedDB (local) + Firebase Firestore (cloud sync)
- **Framework visual**: Chart.js + FontAwesome + Google Fonts
- **Tema**: Dark theme custom (variables CSS)

### Estructura de datos (db.js)
- `guardar(storeName, item)` - CREATE/UPDATE
- `getTodos(storeName)` - READ ALL (con caché en memoria)
- `obtenerPorId(storeName, id)` - READ ONE
- `eliminar(storeName, id)` - DELETE
- `invalidarCache(storeName)` - Limpiar caché
- `inicializarDatosPorDefecto()` - Seed data

### Capa de presentación (app.js)
- `switchView(viewId)` - Navegación SPA
- `cargarDatosVista(viewId)` - Carga de datos por vista
- `puedeEditar()` / `esAdmin()` - Control de permisos
- `mostrarToast()` - Notificaciones
- `openModal()` / `closeModal()` - Modales
- `formatearMoneda()` / `formatearFechaVisual()` - Formateo

### Navegación (index.html)
- Menú lateral con `.menu-item` + `onclick="switchView('{name}')"`
- Vistas como `<section id="view-{name}" class="view">`

---

## 2. ARCHIVOS A MODIFICAR

| Archivo | Cambios |
|---------|---------|
| **db.js** | Incrementar DB_VERSION de 4→5. Agregar 9 nuevas object stores. Agregar stores en `sincronizarLocalAFirebase()` e `importarTodo()`. |
| **index.html** | Agregar menú "Inventario" en sidebar. Agregar 5 nuevas vistas. Agregar 7 nuevos modales. |
| **app.js** | Agregar ~2000 líneas de lógica de inventario. Agregar `views` array, `switchView`, `cargarDatosVista`. |
| **styles.css** | Agregar ~300 líneas de estilos para inventario (gráficos ERP, size matrix, delivery cards, etc.) |

## 3. ARCHIVOS NUEVOS A CREAR
Ninguno. Todo se integra en los 4 archivos existentes siguiendo el patrón del proyecto.

## 4. TABLAS NUEVAS (INDEXEDDB)

| Store Name | Key | AutoIncrement | Propósito |
|------------|-----|---------------|-----------|
| categoriasInventario | id | sí | Categorías de artículos (Indumentaria, Banderas, etc.) |
| subcategoriasInventario | id | sí | Subcategorías vinculadas a categorías |
| talles | id | sí | Talles administrables (XXXS, S, M, L, XL, 40, 42, etc.) |
| articulos | id | sí | Artículos del inventario |
| articuloTalles | id | sí | Stock por talle (solo indumentaria) |
| movimientosInventario | id | sí | Historial de movimientos de stock |
| entregasInventario | id | sí | Entregas de indumentaria a personal |
| detalleEntregas | id | sí | Detalle de cada entrega |
| imagenesArticulo | id | sí | URLs de imágenes de artículos |

## 5. RELACIONES

```
categoriasInventario 1---* subcategoriasInventario (categoriaId)
categoriasInventario 1---* articulos (categoriaId)
subcategoriasInventario 1---* articulos (subcategoriaId)
articulos 1---* articuloTalles (articuloId)
talles 1---* articuloTalles (talleId)
articulos 1---* movimientosInventario (articuloId)
talles 1---* movimientosInventario (talleId) [nullable]
articulos 1---* detalleEntregas (articuloId)
talles 1---* detalleEntregas (talleId) [nullable]
entregasInventario 1---* detalleEntregas (entregaId)
articulos 1---* imagenesArticulo (articuloId)
```

## 6. COMPONENTES REUTILIZADOS

- `guardar()` - Persistencia
- `getTodos()` - Lectura con caché
- `obtenerPorId()` - Lectura individual
- `eliminar()` - Eliminación
- `invalidarCache()` - Invalidación de caché
- `mostrarToast()` - Notificaciones toast
- `openModal()` / `closeModal()` - Sistema de modales
- `puedeEditar()` / `esAdmin()` - Control de acceso
- `formatearMoneda()` / `formatearFechaVisual()` - Formateo
- `dashboardDirty` - Flag de actualización de dashboard
- Chart.js - Gráficos del dashboard de inventario
- Sistema de badges, cards, tables del CSS existente

## 7. SERVICIOS REUTILIZADOS

- Toda la capa `db.js` (guardar, getTodos, eliminar, obtenerPorId)
- Sistema de autenticación (currentUser, puedeEditar, esAdmin)
- Sistema de navegación SPA (switchView, cargarDatosVista)
- Sistema de modales (openModal, closeModal)
- Sistema de notificaciones (mostrarToast)

## 8. ENDPOINTS (Funciones de negocio)

No hay API REST separada - todo es local con IndexedDB. Se crearán funciones asíncronas en app.js:
- `renderDashboardInventario()`
- `listarArticulos()` / `guardarArticulo()` / `eliminarArticulo()`
- `listarMovimientosInventario()`
- `listarCategoriasInventario()`
- `listarEntregas()` / `guardarEntrega()`
- `calcularStockTotal(articuloId)` / `calcularStockPorTalle(articuloId)`
- `registrarMovimiento()` / `descontarStock()`

## 9. MIGRACIONES

DB_VERSION pasa de 4 a 5. En `onupgradeneeded` se crean las 9 nuevas stores.

## 10. INTEGRACIÓN AL MENÚ LATERAL

Se inserta el item "Inventario" entre "Gastos" y "Staff":
```
<li>
  <div class="menu-item" onclick="switchView('inventario')">
    <i class="fa-solid fa-warehouse"></i>
    <span>Inventario</span>
  </div>
  <div class="submenu">
    <div class="menu-item submenu-item" onclick="switchView('articulos')">
      <i class="fa-solid fa-box"></i><span>Artículos</span>
    </div>
    <div class="menu-item submenu-item" onclick="switchView('movimientos-inventario')">
      <i class="fa-solid fa-arrows-spin"></i><span>Movimientos</span>
    </div>
    <div class="menu-item submenu-item" onclick="switchView('categorias-inventario')">
      <i class="fa-solid fa-tags"></i><span>Categorías</span>
    </div>
    <div class="menu-item submenu-item" onclick="switchView('entregas-inventario')">
      <i class="fa-solid fa-shirt"></i><span>Entregas</span>
    </div>
  </div>
</li>
```

## 11. CONTROL DE STOCK POR TALLE

- Cada artículo tiene flag `controlaTalles`
- Si es TRUE (indumentaria): `articuloTalles` almacena `{ articuloId, talleId, stock }`
- Stock total = SUM de todos los talles de ese artículo
- Al agregar/editar artículo con controlaTalles, se muestra matriz editable de talles
- Al registrar movimiento, se especifica talleId si corresponde
- Los talles son administrables desde Configuración + precargados

## 12. HISTORIAL DE MOVIMIENTOS

- Cada cambio de stock se registra en `movimientosInventario`
- Campos: articuloId, talleId, tipoMovimiento (ingreso/egreso/entrega/ajuste/etc.), cantidad, stockResultante, usuarioId, fecha, motivo, observaciones
- Vista de movimientos permite filtrar por artículo, tipo, fecha
- No se puede eliminar un artículo si tiene movimientos asociados

## 13. PREVENCIÓN DE ROTURAS

1. No se modifican tablas existentes - solo se agregan nuevas
2. DB_VERSION se incrementa manteniendo compatibilidad
3. Las funciones existentes no se tocan - solo se agregan nuevas
4. El menú se inserta en orden sin eliminar items existentes
5. Los permisos existentes se mantienen intactos
6. Las vistas nuevas no afectan el renderizado de las existentes