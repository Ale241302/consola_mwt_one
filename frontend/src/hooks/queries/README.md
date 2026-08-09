# React Query — guía de migración por dominio (Ola 3 · 3.26)

Objetivo: adoptar `@tanstack/react-query` como capa de **estado servidor**,
manteniendo `src/lib/api.js` como **transporte**. Migración incremental por
dominio. La pantalla piloto es **Expedientes** (mata el N+1 de clientes).

## Reglas

1. **`api.js` es el transporte.** Las `queryFn` llaman a
   `expedientesApi.list()`, `clientesApi.list()`, etc. NO se toca la firma de
   `apiFetch`. El `signal` de React Query se pasa como
   `resource.list(params, { signal })`.

2. **Query keys centralizadas** en `src/lib/queryKeys.js`. Cada dominio declara:
   - `<dominio>.all` → clave raíz (para invalidaciones).
   - `<dominio>.list(params)` → listado.
   - `<dominio>.detail(id)` → detalle.
   - `<dominio>.byIds(ids)` → colección resuelta por ids (mata el N+1).

3. **Normalizar SIEMPRE el shape** en la `queryFn`/selector:
   `Array.isArray(x) ? x : (x?.results || [])`.

4. **Invalidaciones:** cada mutación invalida su key raíz, p.ej.
   `qc.invalidateQueries({ queryKey: queryKeys.expedientes.all })`.

5. **Caché SWR (`swrCache.js`) se mantiene** en esta ola. Frontera clara:
   React Query para dominios nuevos, `swrCache` para `usePortalData` y afines.
   Se depreca en una ola futura cuando `usePortalData` migre a RQ.

6. **Higiene de sesión:** `queryClient.clear()` en logout (ya hecho en
   `AuthContext.jsx`, paridad con `clearCache()` de `swrCache`).

## Receta para migrar un dominio

1. Crear `use<X>Data.js` en `src/hooks/queries/` que devuelva los datos
   agregados del listado (`Promise.all` de los `resource.list` paralelos).
2. Crear `use<X>Map.js` si el listado necesita resolver N entidades hijas
   (clientes, marcas) — un solo `list()` + mapa en cliente, NO N `get()`.
3. Crear `use<X>Mutations.js` en `src/hooks/mutations/` con las mutaciones y
   sus invalidaciones.
4. Sustituir en la página el bloque de fetch manual + `useState` por los hooks.
   Conservar el enriquecimiento derivado (sumas, ordenamiento) alimentándolo
   desde `data`.
5. `npm run build` + `bash tests/run.sh` verdes.
6. Actualizar `queryKeys.js` si el dominio añade claves nuevas.

## Orden sugerido de dominios

1. **Expedientes** (piloto — N+1 de clientes ya resuelto con batch).
2. **Transfers** (listados + liquidación).
3. **Clientes / Productos**.
4. Resto.

## Verificación

- Network: 1 request a `/clientes/` (no N) al abrir `/expedientes`.
- Navegar fuera y volver dentro de 30s → sin re-fetch (`staleTime`).
- Editar un expediente → el listado se invalida y refresca.
