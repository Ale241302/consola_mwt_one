# Sprint 01 · Core — Usuarios, Roles, Sesión y Permisos (RBAC)

## 1. Propósito
Columna vertebral de identidad y acceso: autenticación JWT (SimpleJWT), usuarios, roles RBAC, permisos por capability (`can('...')`) y aislamiento de visibilidad POL_VISIBILIDAD (R3): los roles `CLIENT_*` nunca ven datos CEO-ONLY.

## 2. Mapeo Tecnológico
*   **Base de datos**: schemas `users` (`users.mwtuser`, `legal_entity_ids` — A4/A4d), RBAC (`A5_rbac_redesign.sql`), `public._applied_sql` (registro de módulos SQL aplicados).
*   **Backend**: apps `core` (auth JWT, exception handler, `scoped_querysets`, `MwtJWTAuthentication` que relee `legal_entity_ids` fresco por request), `users`, `roles`, `storage` (signed URLs MinIO).
*   **Frontend**: `Login.jsx`, `PasswordReset.jsx`, `Users.jsx`, `UserFormView.jsx`, `RolesPermissions.jsx`, `ProfilePage.jsx`; `context/AuthContext.jsx`, `context/RoleContext.jsx` (viewport ADMIN/CLIENT + `can()`); refresh silencioso JWT en `lib/api.js`.

## 3. Auditoría de Lentitud (BD & Backend)
- [ ] `users.mwtuser`: índices en columnas de login (email/username) y en lecturas por request de `MwtJWTAuthentication` (se ejecuta en CADA llamada — medir su costo).
- [ ] `scoped_querysets.scoped_expediente_ids`: ¿se calcula por request en cada listado? Evaluar cache por-request.
- [ ] Endpoints `/api/auth/me/` y selects de roles: payload mínimo, sin anidados innecesarios.
- [ ] `public._applied_sql`: confirmar que el entrypoint no re-escanea módulos pesados en cada arranque.

## 4. Auditoría de Estabilidad (Frontend)
- [ ] **Refresh JWT single-flight**: en `api.js`, si N fetches reciben 401 a la vez, debe haber UN solo refresh en curso y una cola de reintentos; el resto espera la promesa compartida. (Causa #1 documentada de logout forzado/pantalla blanca.)
- [ ] `AuthContext.jsx`: ningún `setState` tras desmontar; transición login→logout no debe dejar contextos a medio limpiar.
- [ ] `RoleContext`: `user.legal_entity_ids` puede llegar tarde — todo consumidor debe tolerar `undefined`.
- [ ] Rutas protegidas: redirecciones que no entren en bucle al expirar sesión durante navegación rápida.

## 5. Flujo de Trabajo Colaborativo
1. **Frontend** instrumenta el refresh (logs de cuántos refresh paralelos ocurren al navegar rápido) y reporta a **Backend**.
2. **Backend** confirma la política de rotación del refresh token (¿ROTATE_REFRESH_TOKENS invalida el viejo?) y acuerda con Frontend el single-flight.
3. **SQL** mide el costo del relectura por-request de `mwtuser` y propone índice/cache si aparece en el top de queries.
4. Verificación cruzada: prueba de estrés #7 del plan maestro con sesión a punto de expirar.

## 6. Hallazgos y correcciones
**Auditoría 2026-06-11 (Fable 5):**
- ✅ **VERIFICADO OK** — El refresh JWT ya es single-flight: `lib/api.js` ~L323 usa `_refreshPromise` compartida; N fetches en 401 esperan la MISMA promesa. Auto-refresh on-401 + retry 1x + refresh proactivo cada 25 min en `AuthContext`. No se requirió cambio.
- ✅ **CORREGIDO** — `apiFetch` ahora acepta `signal` (AbortController) y lo propaga a los reintentos; `AbortError` nunca se reintenta ni se convierte en `ApiError`. Las páginas pueden adoptar cancelación real incrementalmente.
- ✅ **CORREGIDO** — `ErrorBoundary` por ruta montado en `AppLayout` alrededor del `<Outlet/>` (key=pathname): un crash de render ya no deja la app en blanco; el shell sobrevive con Reintentar/Recargar.
- ⏳ **PENDIENTE** — Medir el costo de `MwtJWTAuthentication` (relee `users.mwtuser` en CADA request); candidato a cache por-request si aparece en el top de queries.
