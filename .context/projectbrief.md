# projectbrief.md — Control CDA (appcda)

## Propósito central

**Control CDA** es una aplicación web de gestión integral para una entidad de
automovilismo (CDA — Circuito de Automovilismo). Resuelve la operación diaria de
competencias: calendario anual, control de gastos y rendiciones, personal/staff
asignado, inventario de insumos, alojamiento y reportes, con autenticación de
usuarios y matriz de permisos por rol.

Repo: `https://github.com/NicoFern-01/appcda.git` (rama `main`).
Proyecto Firebase por defecto: `controlcda-e5f97`.

## Objetivos

1. **Operar todo el negocio en una sola SPA**: 16 vistas (dashboard, calendario,
   competencias, gastos, carga detallada/rendiciones, personal por competencia,
   inventario con 5 subvistas, staff, estadísticas de personal, alojamiento,
   categorías/circuitos, configuración).
2. **Funcionar offline-first**: IndexedDB local (db.js + persistenceService) con
   sincronización opcional a Firestore, más migración local → nube.
3. **Seguridad por capas**: hash de contraseñas con Web Crypto (sal + SHA-256),
   Firebase Auth como identidad, `firestore.rules` como única defensa real de
   escritura, roles admin/editor/viewer/supervisor + permisos personalizados.
4. **Migración incremental sin romper la app**: convertir el monolito legacy
   (`app.js` ~10.866 líneas, `db.js` ~1.460, `index.html` ~2.554) a módulos ES
   en `/src`, manteniendo en paralelo los scripts clásicos funcionando.

## Arquitectura general identificada

```
index.html (16 <section id="view-*"> + login)   ── markup estático, no se toca
   ├── <script type="module" src="/src/main.js">   capa ES moderna (aditiva)
   ├── <script src="db.js?v=__CDA_BUILD__">        clásico: IndexedDB + puentes Firebase
   └── <script src="app.js?v=__CDA_BUILD__">       clásico: UI, vistas, menú, gráficos
```

- **Puente entre mundos**: `src/main.js` congela `window.__CDA_MODULES__`
  (`store`, `auth`, `persistencia`, `vistas`, `usuarios`, `permisos`,
  `firebaseConfig`, `credenciales`, `router`) y `window.__CDA_FIREBASE_CONFIG__`
  / `window.__CDA_SCHEMA_VALIDATOR__`. Los scripts clásicos delegan ahí cuando
  existe la función (patrón "proxy/pasamano" repetido en app.js y db.js).
- **Dominios en `/src`**: `core/` (router, store), `services/` (authService,
  persistenceService, userDirectoryService, viewManager, firebaseConfig,
  schemaValidator, authCredentials), `utils/` (permisosUtil — fuente de verdad
  del catálogo de módulos), `views/` (adaptadores login/dashboard/index).
- **Lógica de negocio principal** (gastos, inventario/stock, combustible,
  personal, exportaciones) sigue en `app.js`.

## Estado de la migración (fases)

- FASE 1: Vite como servidor/build sin invadir archivos legacy.
- FASE 2: entrada ES (`main.js`), store y router aditivos.
- FASE 3: puentes de Firebase y validador de esquemas.
- FASE 4+: servicios (auth, persistencia, directorio de usuarios, permisos).
- FASE 7: navegación/menú migrados a `src/services/viewManager.js` (los proxies
  de app.js ya delegan en `window.__CDA_MODULES__.vistas`).
- Pendiente (declarado en comentarios): conversión ESM completa de `app.js` y
  eliminación de las copias legacy (`permisosUtil.js` raíz, proxies).
