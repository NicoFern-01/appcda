# Análisis Técnico: Inconsistencias y Problemas de Seguridad

## Resumen Ejecutivo

Se realizó un análisis exhaustivo del código de la aplicación **Control CDA** (app.js, db.js, index.html). Se identificaron **10 problemas de seguridad** y **10 inconsistencias** de diversa gravedad. La mayoría son de severidad media, con dos problemas críticos de seguridad que requieren atención inmediata.

---

## 🔴 PROBLEMAS DE SEGURIDAD

### S1. CRÍTICO: Contraseña temporal expuesta en consola y alerta
**Archivo:** `db.js` líneas 356-358  
**Severidad:** CRÍTICA  
**Descripción:** Al crear el usuario admin por defecto, la contraseña temporal se muestra mediante `console.warn()` y `alert()`. La contraseña queda visible en:
- La consola del navegador (persistente hasta que se limpia)
- Posibles logs de errores del navegador
- Capturas de pantalla si se comparte

```javascript
console.warn(`⚠️ Usuario admin creado con contraseña temporal: ${tempPassword}`);
alert(`Se creó el usuario administrador inicial.\n\nUsuario: admin\nContraseña temporal: ${tempPassword}...`);
```

**Recomendación:** Mostrar la contraseña solo en el `alert()` (que es modal y desaparece al cerrar) y NO en `console.warn()`. Considerar forzar el cambio de contraseña en el primer inicio de sesión (ya existe `requiereCambioPassword` pero no se implementa la verificación).

---

### S2. CRÍTICO: Falta de rate limiting / bloqueo de cuenta en login
**Archivo:** `app.js` función `handleLogin()`  
**Severidad:** CRÍTICA  
**Descripción:** El sistema de login no implementa:
- Rate limiting (límite de intentos por tiempo)
- Bloqueo de cuenta tras N intentos fallidos
- Delay exponencial entre intentos
- CAPTCHA

Un atacante podría realizar intentos de fuerza bruta sin restricciones.

**Recomendación:** Implementar un contador de intentos fallidos por usuario con bloqueo temporal (ej: 5 intentos → bloqueo 15 minutos). Usar `localStorage` o `sessionStorage` para tracking básico.

---

### S3. ALTA: Hash de contraseña legacy inseguro sin migración automática
**Archivo:** `db.js` líneas 64-72  
**Severidad:** ALTA  
**Descripción:** El hash legacy (`hashPasswordLegacy`) usa un algoritmo trivial (operaciones bit a bit simples) que es vulnerable a colisiones y ingeniería inversa. Aunque existe soporte para verificar hashes antiguos, **no hay mecanismo de migración automática** que actualice el hash a SHA-256 cuando el usuario inicia sesión con un hash legacy.

```javascript
function hashPasswordLegacy(password) {
    let hash = 0;
    for (let i = 0; i < password.length; i++) {
        const char = password.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return 'hash_' + Math.abs(hash).toString(16) + '_' + password.length;
}
```

**Recomendación:** En `verificarPassword()`, si se detecta un hash legacy y la contraseña es válida, re-hashear con SHA-256 y actualizar el registro del usuario automáticamente.

---

### S4. ALTA: CSV Injection en exportación de artículos
**Archivo:** `app.js` función `exportarArticulosExcel()`  
**Severidad:** ALTA  
**Descripción:** A diferencia de `exportarExcelRendicion()` y `exportarExcelPersonalCompetencia()` que implementan `sanitizarCSV()`, la función `exportarArticulosExcel()` **NO sanitiza** los campos contra inyección de fórmulas. Un usuario malicioso podría ingresar un nombre de artículo como `=CMD()|'calc'!A1` que se ejecutaría al abrir el CSV en Excel.

```javascript
// FALTA sanitizar:
const linea = [
    art.codigo, art.nombre, (art.descripcion || '').replace(/,/g, ' '),
    catName, art.marca || '', art.modelo || '', art.color || '',
    stock, art.stockMinimo || 0, estado
].join(',');
```

**Recomendación:** Aplicar la misma función `sanitizarCSV()` usada en otras exportaciones a todos los campos de texto.

---

### S5. MEDIA: Sin timeout de sesión
**Archivo:** `app.js`  
**Severidad:** MEDIA  
**Descripción:** No existe un mecanismo de timeout/caducidad de sesión. Una vez que el usuario inicia sesión, la sesión permanece activa indefinidamente hasta que se cierra manualmente o se cierra el navegador. En un entorno compartido, esto representa un riesgo.

**Recomendación:** Implementar un timeout de sesión (ej: 30 minutos de inactividad) usando `setTimeout` que se reinicia con actividad del usuario.

---

### S6. MEDIA: Configuración de Firebase sin reglas de seguridad
**Archivo:** `db.js` función `inicializarFirebase()`  
**Severidad:** MEDIA  
**Descripción:** La configuración de Firebase se almacena en `localStorage` y se usa directamente. Si bien las claves de Firebase son públicas por diseño, **no se verifican ni configuran las reglas de seguridad de Firestore**. Cualquiera con la configuración podría acceder a los datos si las reglas de Firestore permiten acceso público.

**Recomendación:** Documentar la necesidad de configurar reglas de seguridad en Firestore que requieran autenticación. Considerar integrar Firebase Auth en lugar de solo Firestore.

---

### S7. MEDIA: `document.write` en visualización de adjuntos
**Archivo:** `app.js` función `abrirArchivoAdjunto()`  
**Severidad:** MEDIA  
**Descripción:** Se usa `document.write()` para renderizar archivos adjuntos en una nueva ventana. Aunque se usa `escapeHtml()` para el nombre del archivo, el uso de `document.write` es una práctica desaconsejada que puede ser explotada si el contenido del archivo es malicioso.

```javascript
win.document.write(`<html><head><title>${nombreSeguro}</title></head>...`);
```

**Recomendación:** Usar `DOMParser` o crear elementos del DOM directamente en lugar de `document.write()`.

---

### S8. MEDIA: Falta de validación de entrada en formularios
**Archivo:** `app.js` múltiples funciones  
**Severidad:** MEDIA  
**Descripción:** Varios formularios no validan adecuadamente los datos antes de guardar:
- Campos numéricos no verifican rangos (ej: montos negativos en algunos casos)
- Campos de texto no tienen límite de longitud
- No se validan formatos de email en el campo `staff-mail`
- No se validan formatos de CUIT/CUIL en proveedores

**Recomendación:** Agregar validación de entrada en todas las funciones `guardar*Form()` antes de persistir.

---

### S9. BAJA: Uso de `confirm()` y `alert()` nativos
**Archivo:** `app.js` múltiples funciones  
**Severidad:** BAJA  
**Descripción:** A pesar de tener funciones personalizadas `mostrarConfirmacion()` y `mostrarAlerta()`, muchas funciones aún usan `confirm()` y `alert()` nativos del navegador. Estos pueden ser bloqueados por configuración del navegador y no siguen el diseño de la app.

**Recomendación:** Reemplazar todos los `confirm()` y `alert()` nativos con las versiones personalizadas existentes.

---

### S10. BAJA: Información sensible en mensajes de error
**Archivo:** `db.js` múltiples funciones  
**Severidad:** BAJA  
**Descripción:** Los mensajes de error de las operaciones de BD incluyen detalles internos que podrían exponer información sobre la estructura de la base de datos:

```javascript
reject(`Error al guardar en ${storeName}: ` + event.target.error);
reject(`Error al leer de ${storeName}: ` + event.target.error);
```

**Recomendación:** Usar mensajes genéricos para el usuario y registrar detalles técnicos solo en consola.

---

## 🟡 INCONSISTENCIAS

### I1. CRÍTICA: Función `cargarDatosVista` duplicada
**Archivo:** `app.js`  
**Severidad:** CRÍTICA  
**Descripción:** La función `cargarDatosVista(viewId)` está definida **DOS VECES**:
1. Primera definición (~línea 200): No incluye las vistas de inventario
2. Segunda definición (~línea 1400): Incluye todas las vistas de inventario

La segunda definición sobrescribe la primera, pero esto es confuso y propenso a errores. Si alguien edita la primera definición pensando que es la activa, los cambios no tendrán efecto.

**Recomendación:** Eliminar la primera definición y mantener solo una versión completa.

---

### I2. ALTA: Uso inconsistente de `escapeHtml`
**Archivo:** `app.js`  
**Severidad:** ALTA  
**Descripción:** El uso de `escapeHtml()` es inconsistente:
- `listarGastos()`: Usa `escapeHtml(comp.nombre)` ✅
- `listarCompetencias()`: Usa `comp.nombre` directamente en template literals ❌
- `verCompetencia()`: Usa `comp.nombre` sin escapar en el título del modal ❌
- `listarRendiciones()`: Usa `escapeHtml(comp.nombre)` ✅

Esto puede causar XSS si un usuario ingresa HTML/JavaScript en el nombre de una competencia.

**Recomendación:** Auditar todos los `innerHTML` y usar `escapeHtml()` consistentemente en todos los datos de usuario.

---

### I3. ALTA: Mezcla de `confirm()` nativo y `mostrarConfirmacion()` personalizado
**Archivo:** `app.js`  
**Severidad:** MEDIA  
**Descripción:** El código mezcla dos sistemas de confirmación:
- `eliminarCompetencia()`: Usa `confirm()` nativo ❌
- `eliminarGasto()`: Usa `confirm()` nativo ❌
- `eliminarStaff()`: Usa `confirm()` nativo ❌
- `handleLogout()`: Usa `mostrarConfirmacion()` ✅
- `cancelarEdicionRendicion()`: Usa `confirm()` nativo ❌

**Recomendación:** Estandarizar usando `mostrarConfirmacion()` en todas partes.

---

### I4. MEDIA: Uso de `var` en lugar de `let`/`const`
**Archivo:** `app.js` funciones `imprimirRendicion()` y `exportarExcelRendicion()`  
**Severidad:** MEDIA  
**Descripción:** Estas funciones usan `var` para declarar variables, lo cual es inconsistente con el resto del código que usa `let`/`const`:

```javascript
var prov = await obtenerNombreProveedor(d2.proveedorId);
var conc = await obtenerNombreConcepto(d2.conceptoId);
var d2 = detallesActuales[idx];
```

**Recomendación:** Reemplazar `var` con `const` o `let` según corresponda.

---

### I5. MEDIA: `invalidarCache` inconsistente
**Archivo:** `app.js`  
**Severidad:** MEDIA  
**Descripción:** Algunas funciones llaman `invalidarCache()` después de guardar/eliminar y otras no:
- `guardarArticuloForm()`: Llama `invalidarCache('articulos')` ✅
- `guardarGastoForm()`: NO llama `invalidarCache('gastos')` ❌
- `guardarCompetenciaForm()`: NO llama `invalidarCache('competencias')` ❌
- `guardarStaffForm()`: NO llama `invalidarCache('staff')` ❌

Aunque `guardar()` actualiza el caché internamente, no llamar `invalidarCache` puede causar problemas si hay lógica adicional que modifica datos.

**Recomendación:** Estandarizar el manejo de caché después de operaciones de escritura.

---

### I6. MEDIA: Ineficiencia N+1 en `listarEntregas()`
**Archivo:** `app.js` función `listarEntregas()`  
**Severidad:** MEDIA  
**Descripción:** Dentro del loop que procesa cada detalle de cada entrega, se llama `getTodos('articulos')` y `getTodos('talles')` por cada item, causando un problema de N+1 queries:

```javascript
for (const det of detallesEntrega) {
    const articulos = await getTodos('articulos'); // ← Se llama por CADA detalle
    const art = articulos.find(a => Number(a.id) === Number(det.articuloId));
    // ...
    const talles = await getTodos('talles'); // ← Se llama por CADA detalle
}
```

**Recomendación:** Mover las llamadas `getTodos()` fuera del loop y reutilizar los datos.

---

### I7. BAJA: Inconsistencia en comparación de IDs
**Archivo:** `app.js`  
**Severidad:** BAJA  
**Descripción:** Los IDs se comparan de diferentes maneras a lo largo del código:
- `Number(g.competenciaId) === Number(comp.id)` 
- `String(a.id) !== String(id)`
- `parseInt(id)`
- `Number(x.id) === Number(id)`

Esta inconsistencia puede causar bugs sutiles cuando los IDs vienen de diferentes fuentes (URL, DOM, BD).

**Recomendación:** Estandarizar usando `Number()` para todas las comparaciones de IDs.

---

### I8. BAJA: `mostrarToast` no maneja bien el tipo 'warning'
**Archivo:** `app.js` función `mostrarToast()`  
**Severidad:** BAJA  
**Descripción:** La función verifica `tipo === 'success'` y `tipo === 'error'`, pero cualquier otro tipo (incluyendo 'warning') usa el icono de advertencia por defecto. No hay un caso explícito para 'warning' o 'info'.

**Recomendación:** Agregar casos explícitos para 'warning' e 'info' con iconos apropiados.

---

### I9. BAJA: Falta de manejo de errores en operaciones asíncronas
**Archivo:** `app.js`  
**Severidad:** BAJA  
**Descripción:** Muchas funciones asíncronas no tienen bloques `try/catch`:
- `listarCompetencias()`: Sin try/catch
- `listarGastos()`: Sin try/catch
- `listarStaff()`: Sin try/catch

Si una operación de BD falla, la promesa no se maneja y la UI puede quedar en estado inconsistente.

**Recomendación:** Envolver las operaciones de BD en try/catch y mostrar mensajes de error al usuario.

---

### I10. BAJA: Estilos inline excesivos en index.html
**Archivo:** `index.html`  
**Severidad:** BAJA  
**Descripción:** Hay muchos estilos `style="..."` inline en el HTML, lo que dificulta el mantenimiento y es inconsistente con el uso de clases CSS en `styles.css`.

**Recomendación:** Mover los estilos repetidos a clases en `styles.css`.

---

## 📋 Resumen de Prioridades

| Prioridad | Issue | Tipo |
|-----------|-------|------|
| 🔴 CRÍTICA | S1 - Contraseña en consola | Seguridad |
| 🔴 CRÍTICA | S2 - Sin rate limiting en login | Seguridad |
| 🔴 CRÍTICA | I1 - Función duplicada | Inconsistencia |
| 🟠 ALTA | S3 - Hash legacy sin migrar | Seguridad |
| 🟠 ALTA | S4 - CSV Injection en artículos | Seguridad |
| 🟠 ALTA | I2 - escapeHtml inconsistente | Inconsistencia |
| 🟡 MEDIA | S5 - Sin timeout de sesión | Seguridad |
| 🟡 MEDIA | S6 - Firebase sin reglas de seguridad | Seguridad |
| 🟡 MEDIA | S7 - document.write en adjuntos | Seguridad |
| 🟡 MEDIA | S8 - Falta validación de entrada | Seguridad |
| 🟡 MEDIA | I3 - Mezcla de confirm/alert | Inconsistencia |
| 🟡 MEDIA | I4 - Uso de var | Inconsistencia |
| 🟡 MEDIA | I5 - invalidarCache inconsistente | Inconsistencia |
| 🟡 MEDIA | I6 - N+1 en listarEntregas | Inconsistencia |
| 🟢 BAJA | S9 - confirm/alert nativos | Seguridad |
| 🟢 BAJA | S10 - Info sensible en errores | Seguridad |
| 🟢 BAJA | I7 - Comparación de IDs | Inconsistencia |
| 🟢 BAJA | I8 - mostrarToast warning | Inconsistencia |
| 🟢 BAJA | I9 - Falta try/catch | Inconsistencia |
| 🟢 BAJA | I10 - Estilos inline | Inconsistencia |

---

## ✅ Aspectos Positivos Identificados

1. **Hashing de contraseñas moderno:** SHA-256 con salt aleatorio (Web Crypto API)
2. **Función `escapeHtml` existente:** Se usa en la mayoría de los lugares críticos
3. **Sanitización CSV en exportaciones principales:** `exportarExcelRendicion` y `exportarExcelPersonalCompetencia`
4. **Control de acceso por roles:** Implementación de roles (admin, editor, viewer, supervisor)
5. **Caché en memoria:** Optimización de lecturas con invalidación
6. **Validación de stock:** Verificación de stock suficiente antes de egresos/entregas
7. **Arquitectura offline-first:** IndexedDB como fuente primaria con sync opcional a Firebase