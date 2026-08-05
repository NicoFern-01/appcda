# Análisis Técnico: Inconsistencias y Problemas de Seguridad

## Resumen Ejecutivo

Se realizó una auditoría completa del código de la aplicación **Control de Automovilismo** (app.js, db.js, index.html). Se identificaron **problemas de seguridad** (XSS, CSV injection, exposición de datos sensibles) e **inconsistencias** (funciones duplicadas, headers de tabla que no coinciden con los datos, código muerto, UX inconsistente).

---

## 🔴 PROBLEMAS DE SEGURIDAD

### S1. Vulnerabilidades XSS (Cross-Site Scripting) - ALTA SEVERIDAD

**Descripción:** Existen múltiples lugares donde se usa `innerHTML` con datos controlados por el usuario sin escapar. Aunque existe una función `escapeHtml()`, no se usa de manera consistente.

**Ubicaciones afectadas (app.js):**

#### a) Opciones de `<select>` sin escapar
En `actualizarSelectoresFormularios()`, `cargarSelectoresRendicion()`, `cargarSelectoresArticulo()`, `listarEntregas()`, `openModalEntrega()`, `onCambioArticuloMovimiento()`:
```javascript
selectCircuito.innerHTML += `<option value="${c.id}">${c.nombre} (${c.ubicacion})</option>`;
selectGastoComp.innerHTML += `<option value="${c.id}">${c.nombre}</option>`;
selComp.innerHTML += `<option value="${c.id}">${c.nombre}</option>`;
selResp.innerHTML += `<option value="${s.id}">${s.nombre} ${s.apellido}</option>`;
selProv.innerHTML += `<option value="${p.id}">${p.nombre}</option>`;
selPersona.innerHTML += `<option value="${s.id}">${s.nombre} ${s.apellido}</option>`;
selArt.innerHTML += `<option value="${a.id}">${a.codigo} - ${a.nombre}</option>`;
```
Si un usuario malintencionado crea un circuito, staff, proveedor o artículo con un nombre como `<img src=x onerror=alert(1)>`, el código se ejecutará en el navegador de todos los usuarios.

#### b) `verCompetencia()` - Staff sin escapar
```javascript
staffContainer.innerHTML += `<span class="tag">${n}</span>`;
```
Donde `n` es `${s.nombre} ${s.apellido} (${s.funcion})` — no escapado.

#### c) `verRendicion()` - Datos sin escapar
```javascript
<p style="font-size:1rem;">${comp ? comp.nombre : '-'}</p>
<p style="font-size:1rem;">${circ ? circ.nombre : '-'}</p>
<p style="font-size:1rem;">${resp ? `${resp.nombre} ${resp.apellido}` : '-'}</p>
```

#### d) `renderDashboardInventario()` - Nombre de artículo sin escapar
```javascript
<div class="mov-title">${artName}</div>
```

#### e) `listarMovimientosInventario()` - `talleText` sin escapar
```javascript
<div class="mov-title">${escapeHtml(artName)}${talleText}</div>
```
`artName` está escapado pero `talleText` no.

#### f) `mostrarToast()` - Mensaje sin escapar
```javascript
toast.innerHTML = `<i class="fa-solid ..."></i> ${mensaje}`;
```

#### g) `migrarDatosLocalesAFirebase()` - Error sin escapar
```javascript
statusEl.innerHTML = `...${e.message || e}...`;
```

**Recomendación:** Usar `escapeHtml()` en TODOS los lugares donde se insertan datos de usuario en `innerHTML`. Para opciones de `<select>`, considerar usar `document.createElement('option')` con `textContent`.

---

### S2. CSV Injection en `exportarArticulosExcel()` - MEDIA SEVERIDAD

**Descripción:** La función `exportarArticulosExcel()` no sanitiza los datos antes de exportarlos a CSV. Si un usuario malintencionado ingresa un valor como `=CMD|calc.exe!A1` en el nombre o descripción de un artículo, podría ejecutar código al abrir el archivo en Excel.

**Ubicación:** `app.js` - función `exportarArticulosExcel()`
```javascript
const linea = [
    art.codigo, art.nombre, (art.descripcion || '').replace(/,/g, ' '),
    catName, art.marca || '', art.modelo || '', art.color || '',
    stock, art.stockMinimo || 0, estado
].join(',');
```

**Comparación:** La función `exportarExcelRendicion()` SÍ tiene sanitización con `sanitizarCSV()`, lo que hace la inconsistencia evidente.

**Recomendación:** Aplicar la misma función `sanitizarCSV()` en `exportarArticulosExcel()`.

---

### S3. Sincronización de hashes de contraseña a Firebase - MEDIA SEVERIDAD

**Descripción:** La función `sincronizarLocalAFirebase()` sincroniza TODOS los datos locales a Firebase, incluyendo la tabla `usuarios` que contiene hashes de contraseña.

**Ubicación:** `db.js` - función `sincronizarLocalAFirebase()`
```javascript
const stores = ['categorias', ..., 'usuarios', ...];
```

**Recomendación:** Excluir la tabla `usuarios` de la sincronización automática, o implementar reglas de seguridad en Firebase que restrinjan el acceso a esa colección.

---

### S4. Hash de contraseñas con SHA-256 (no ideal) - BAJA SEVERIDAD

**Descripción:** Se usa SHA-256 con salt para hashear contraseñas. Si bien es mejor que texto plano, SHA-256 es un hash rápido y no es ideal para contraseñas.

**Ubicación:** `db.js` - función `hashPassword()`

**Recomendación:** Para una aplicación del lado del cliente, SHA-256 con salt es aceptable. Si se busca mayor seguridad, considerar PBKDF2 (disponible en Web Crypto API) con múltiples iteraciones.

---

### S5. Autorización solo del lado del cliente - BAJA SEVERIDAD (inherente)

**Descripción:** Todas las verificaciones de permisos (`puedeEditar()`, `esAdmin()`, `esSupervisor()`) se ejecutan en el navegador y pueden ser eludidas desde la consola de desarrollador.

**Recomendación:** Esto es inherente a aplicaciones del lado del cliente. Si se requiere seguridad real, implementar validación del lado del servidor o reglas de seguridad en Firebase.

---

### S6. Apertura insegura de archivos adjuntos - BAJA SEVERIDAD

**Descripción:** La función `abrirArchivoAdjunto()` usa `window.open()` y `document.write()` para mostrar archivos. Aunque valida tipos MIME, un atacante podría manipular el data URL.

**Ubicación:** `app.js` - función `abrirArchivoAdjunto()`

**Recomendación:** Considerar usar `URL.createObjectURL()` con un Blob en lugar de `document.write()`.

---

## 🟡 INCONSISTENCIAS

### I1. Función `cargarDatosVista` duplicada - ALTA SEVERIDAD

**Descripción:** Existen DOS definiciones de `cargarDatosVista` en app.js:

1. **Primera definición** (~línea 192):
```javascript
async function cargarDatosVista(viewId) {
    switch(viewId) {
        case 'dashboard':    dashboardDirty = true; await renderDashboard(); break;
        case 'calendario':   await listarCompetencias(); break;
        // ...
    }
}
```

2. **Segunda definición** (~línea 3730, en MÓDULO: INVENTARIO):
```javascript
async function cargarDatosVista(viewId) {
    switch(viewId) {
        case 'dashboard':    await renderDashboard(); break;  // ← NO establece dashboardDirty
        case 'calendario':   await listarCompetencias(); break;
        // ... incluye vistas de inventario
    }
}
```

**Problema:** La segunda definición sobrescribe la primera. Como resultado, `dashboardDirty` nunca se establece en `true` al cambiar a la vista del dashboard, lo que puede causar que el dashboard no se actualice cuando los datos cambian.

**Recomendación:** Eliminar la primera definición y mantener solo la segunda, agregando `dashboardDirty = true` antes de `await renderDashboard()`.

---

### I2. Headers de tabla de gastos no coinciden con los datos - ALTA SEVERIDAD

**Descripción:** Los headers de la tabla de gastos en HTML no coinciden con lo que el JavaScript renderiza.

**HTML (index.html):**
```html
<th>Fecha Carga</th>
<th>Competencia</th>
<th>Categoría</th>
<th>Personal</th>
<th>Concepto</th>
<th>Monto</th>
<th>Observaciones</th>
<th>Acciones</th>
```

**JavaScript (app.js - `listarGastos()`):**
```javascript
tr.innerHTML = `
    <td>${comp.codigo}</td>           ← Código
    <td>${comp.nombre}</td>           ← Nombre
    <td>${comp.fechaInicio}</td>     ← Fecha
    <td>${staffCount}</td>           ← Staff count
    <td>${gastosCount}</td>          ← Gastos count
    <td>${costoTotal}</td>           ← Total
    <td>${montoFacturarTotal}</td>   ← Monto a facturar
    <td>${acciones}</td>              ← Acciones
`;
```

**Recomendación:** Actualizar los headers en HTML para que coincidan con los datos renderizados: Código, Competencia, Fecha, Staff, Gastos, Total, Monto a Facturar, Acciones.

---

### I3. Uso inconsistente de `confirm()` vs `mostrarConfirmacion()` - MEDIA SEVERIDAD

**Descripción:** Algunas funciones usan el diálogo nativo `confirm()` mientras que otras usan el modal personalizado `mostrarConfirmacion()`.

**Usan `confirm()` nativo:**
- `eliminarCompetencia()`
- `eliminarGasto()`
- `eliminarStaff()`
- `eliminarCategoria()`
- `eliminarCircuito()`
- `eliminarUsuario()`
- `eliminarRendicion()`
- `eliminarArticulo()`
- `cancelarEdicionRendicion()`
- `desconectarFirebase()`
- `eliminarCategoriaGasto()`
- `eliminarConceptoGasto()`
- `eliminarProveedorModal()`
- `eliminarFilaGasto()`
- `eliminarTalle()`
- `eliminarSubcategoria()`
- `eliminarEntrega()`

**Usan `mostrarConfirmacion()` personalizado:**
- `handleLogout()`

**Recomendación:** Estandarizar el uso de `mostrarConfirmacion()` en todas las confirmaciones de eliminación.

---

### I4. Código muerto: `actualizarStaffGastoPorCompetencia()` - BAJA SEVERIDAD

**Descripción:** La función `actualizarStaffGastoPorCompetencia()` aún existe en app.js pero ya no se usa porque el campo `gasto-staff` fue eliminado del formulario de gastos. La función verifica si existe `selectGastoStaff` y retorna temprano si no existe.

**Ubicación:** `app.js` - función `actualizarStaffGastoPorCompetencia()`

**Recomendación:** Eliminar la función `actualizarStaffGastoPorCompetencia()` ya que es código muerto.

---

### I5. Elementos HTML inexistentes referenciados en JavaScript - MEDIA SEVERIDAD

**Descripción:** Varias funciones de JavaScript intentan acceder a elementos que no existen en el HTML:

1. `mostrarResumenCompetencia()` referencia `resumen-competencia-panel` (no existe en HTML)
2. `guardarGastoExtraordinario()` referencia `extra-monto`, `extra-concepto`, `extra-detalle` (no existen en HTML)

**Recomendación:** Eliminar estas funciones si ya no se usan, o agregar los elementos HTML correspondientes si son necesarios.

---

### I6. `listarGastos()` ya no muestra gastos individuales - MEDIA SEVERIDAD

**Descripción:** La función `listarGastos()` ahora muestra un listado de competencias con sus totales, en lugar de gastos individuales. Sin embargo:
- El título de la página y los headers de la tabla aún sugieren que muestra gastos individuales
- No hay forma de ver o editar gastos individuales desde esta vista
- La función `editarGasto()` existe pero no hay botón que la invoque desde el listado

**Recomendación:** Actualizar el título y headers de la vista de gastos, o agregar una vista detallada de gastos por competencia.

---

### I7. `eliminarCategoriaGasto()` compara con `String(id)` pero los IDs son numéricos - BAJA SEVERIDAD

**Descripción:** En `eliminarCategoriaGasto()`:
```javascript
if (g.categoriaId === String(id)) {
    g.categoriaId = 'general';
}
```
Pero `g.categoriaId` puede ser un número o el string `'general'`. La comparación `String(id)` puede no funcionar correctamente si `g.categoriaId` es numérico.

**Recomendación:** Usar `String(g.categoriaId) === String(id)` para una comparación robusta.

---

### I8. `exportarDatos()` no incluye `conceptos` en la verificación de importación - BAJA SEVERIDAD

**Descripción:** En `importarDatos()`, la verificación de validez del backup es:
```javascript
if (data.categorias || data.circuitos || data.staff || data.competencias || data.gastos) {
```
Pero `exportarDatos()` exporta muchos más stores. Un backup válido podría no pasar esta verificación si solo contiene, por ejemplo, `articulos`.

**Recomendación:** Ampliar la verificación para incluir todos los stores exportados.

---

## 📊 RESUMEN DE HALLAZGOS

| # | Tipo | Severidad | Descripción |
|---|------|-----------|-------------|
| S1 | Seguridad | 🔴 ALTA | XSS en múltiples `innerHTML` sin escapar |
| S2 | Seguridad | 🟡 MEDIA | CSV Injection en `exportarArticulosExcel()` |
| S3 | Seguridad | 🟡 MEDIA | Hashes de contraseña sincronizados a Firebase |
| S4 | Seguridad | 🟢 BAJA | SHA-256 no es ideal para contraseñas |
| S5 | Seguridad | 🟢 BAJA | Autorización solo del lado del cliente |
| S6 | Seguridad | 🟢 BAJA | Apertura insegura de archivos adjuntos |
| I1 | Inconsistencia | 🔴 ALTA | Función `cargarDatosVista` duplicada |
| I2 | Inconsistencia | 🔴 ALTA | Headers de tabla no coinciden con datos |
| I3 | Inconsistencia | 🟡 MEDIA | Uso inconsistente de `confirm()` vs `mostrarConfirmacion()` |
| I4 | Inconsistencia | 🟢 BAJA | Código muerto: `actualizarStaffGastoPorCompetencia()` |
| I5 | Inconsistencia | 🟡 MEDIA | Elementos HTML inexistentes referenciados |
| I6 | Inconsistencia | 🟡 MEDIA | `listarGastos()` no muestra gastos individuales |
| I7 | Inconsistencia | 🟢 BAJA | Comparación de tipos en `eliminarCategoriaGasto()` |
| I8 | Inconsistencia | 🟢 BAJA | Verificación de importación incompleta |

---

## 🔧 RECOMENDACIONES PRIORITARIAS

1. **Inmediato:** Corregir vulnerabilidades XSS (S1) aplicando `escapeHtml()` en todos los `innerHTML` que usan datos de usuario.
2. **Inmediato:** Eliminar la función `cargarDatosVista` duplicada (I1) y asegurar que `dashboardDirty` se establezca correctamente.
3. **Alto:** Actualizar los headers de la tabla de gastos (I2) para que coincidan con los datos renderizados.
4. **Alto:** Agregar sanitización CSV en `exportarArticulosExcel()` (S2).
5. **Medio:** Excluir tabla `usuarios` de la sincronización con Firebase (S3).
6. **Medio:** Eliminar código muerto y referencias a elementos inexistentes (I4, I5).
7. **Bajo:** Estandarizar el uso de `mostrarConfirmacion()` en todas las eliminaciones (I3).