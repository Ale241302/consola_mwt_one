Plan de EjecuciÃ¢â€Å“Ã¢â€â€šn Ãƒâ€Ãƒâ€¡ÃƒÂ¶ Ola 3 (frentes 3.25 Ãƒâ€ÃƒÂ¥Ãƒâ€  3.28)
**Proyecto:** MWT.ONE Ã¢â€Â¬Ãƒâ‚¬ `frontend/` (React 18.3.1 + Vite 5.4.8, JSX sin TS, React Router 6.26, framer-motion 11, xlsx 
0.18)
**Autor del plan:** Fugu (arquitecto senior) Ã¢â€Â¬Ãƒâ‚¬ **Fecha:** 2026-08-09
**Alcance:** 4 frentes pendientes de la Ola 3. Fetch centralizado en `src/lib/api.js` (`apiFetch` + factory 
`resource()` + APIs por dominio). CachÃ¢â€Å“Ã‚Â® SWR casera en `src/lib/swrCache.js`. Ya hecho: `React.lazy` por ruta + 
`<Suspense>` en `App.jsx`, `manualChunks` (react/xlsx/motion) y `sourcemap:"hidden"` en `vite.config.js`.

> **Regla de oro para toda la Ola 3:** un archivo grande = un solo editor a la vez (polÃ¢â€Å“Ã‚Â¡tica ya adoptada para 
`server.py`, se aplica aquÃ¢â€Å“Ã‚Â¡ a los monolitos). Nada de big-bang. Cada paso deja el Ã¢â€Å“ÃƒÂ­rbol **verde** (`build` + `bash 
tests/run.sh`).

---

## 0. Contexto tÃ¢â€Å“Ã‚Â®cnico verificado (fuente: lectura del repo)

**Transporte (`src/lib/api.js`):**
- `apiFetch(path, { method="GET", body, token, headers={}, signal, _isRetry, _transientRetried })` Ãƒâ€Ãƒâ€¡ÃƒÂ¶ inyecta JWT, 
auto-refresh 401, reintento transitorio en GET idempotentes, honra `AbortSignal`, kill-switch de mocks.
- `resource(name)` devuelve `{ list(params,opts), get(id,opts), create(body), update(id,body), replace, remove(id), 
action(name,id,body,opts), select(selectName,params,opts) }`. Todas resuelven token vÃ¢â€Å“Ã‚Â¡a `getToken()`.
- APIs por dominio ya exportadas: `nodosApi, marcasApi, clientesApi, productosApi, expedientesApi, lineasApi, ocsApi, 
transferenciasApi, transferLineasApi, pagosApi, ...` (Ãƒâ€ÃƒÂ«ÃƒÂª60 exports).
- `abortInflightGets()` + un `AbortController` global de navegaciÃ¢â€Å“Ã¢â€â€šn ya existen.

**CachÃ¢â€Å“Ã‚Â® SWR (`src/lib/swrCache.js`):** `readCache(key,maxAgeMs?)`, `writeCache(key,value)`, `invalidateCache(key)`, 
`clearCache()`; capas in-memory (Map) + `sessionStorage` (prefijo `mwt-swr:`); se purga en evento `window 
"mwt-auth-logout"`. Usada hoy solo en `usePortalData` y afines.

**Hooks (`src/hooks/`, 18):** patrÃ¢â€Å“Ã¢â€â€šn uniforme `useState({...,loading,error}) + useCallback(load) + 
useEffect(()=>load(),[load])` con `Promise.all` de `resource.list/action/select` y `.catch(()=>fallback)`. Devuelven 
`{...state, reload}`.

**N+1 confirmado (`src/pages/Expedientes.jsx` ~L222):** tras cargar expedientes hace 
`Promise.all(uniqueClientIds.map(id => clientesApi.get(id)))` Ãƒâ€ÃƒÂ¥Ãƒâ€  1 request por cliente Ã¢â€Å“Ã¢â€¢â€˜nico.

**Harness de test (`frontend/tests/run.sh`):** compila bundles de `src/lib/*` con `esbuild@0.21.5` (`--define 
import.meta.env.*`) y corre `node --test "tests/*.test.mjs"`. Helpers en `tests/helpers/env.mjs`. Tests actuales: 
`api_fetch`, `api_mock_mode`, `api_refresh`, `cronograma_data`, `client_dash_metrics`, `operating_company`, 
`error_reporter`.

**UI base (`src/components/ui/`):** `primitives.jsx` (Badge, StatusBadge, Progress, Sparkline, BarChart, 
StateTimeline, Seg, CountryFlagÃƒâ€Ãƒâ€¡Ã‚Âª), `Skeleton.jsx`, `ErrorBoundary.jsx`. **No hay** `Modal`, ni `VirtualTable`, ni 
utilidades de a11y.

**Modales:** ~25 con `role="dialog"`, solo 14 archivos manejan Escape, **0 focus trap**. Ejemplo real 
`components/expedientes/UploadDocumentModal.jsx`: **sin** `role="dialog"`, **sin** Escape, con `role="button" 
tabIndex={0}` en el dropzone.

**CSS:** `@media print` vive en `src/styles/app.css` (302 KB). `tabular-nums` en uso. No Tailwind 
(`tailwind.config.js` presente pero el stack es CSS con tokens).

---

## Frente 3.25 Ãƒâ€Ãƒâ€¡ÃƒÂ¶ Accesibilidad

### 1. Objetivo y criterio de salida
Elevar accesibilidad de formularios y modales sin rediseÃ¢â€Å“Ã¢â€“â€™o visual.
**Criterios medibles:**
- Todo `input/select/textarea` que hoy no estÃ¢â€Å“ÃƒÂ­ envuelto por `<label>` recibe asociaciÃ¢â€Å“Ã¢â€â€šn explÃ¢â€Å“Ã‚Â¡cita (`id`+`htmlFor` o 
`aria-label`/`aria-labelledby`). Meta: **0 controles sin nombre accesible** en las 6 pantallas piloto (Clientes, 
Users, UploadDocumentModal, ReceiveBatchModal, Login, ProfilePage).
- Todos los modales con `role="dialog"` tienen: `aria-modal="true"`, `aria-labelledby` apuntando al tÃ¢â€Å“Ã‚Â¡tulo, **focus 
trap**, cierre con **Escape**, y **restauraciÃ¢â€Å“Ã¢â€â€šn de foco** al disparador.
- Test automatizable: `tests/a11y_modal.test.mjs` valida el comportamiento del hook `useDialogA11y` (focus trap + 
Escape) sobre un DOM simulado (linkedom/jsdom).

### 2. Archivos a crear
```
frontend/src/lib/a11y/useDialogA11y.js        # hook: focus trap + Escape + restore focus
frontend/src/lib/a11y/useAutoId.js            # ids estables para htmlFor (wrapper de React.useId)
frontend/src/components/ui/Modal.jsx          # shell de modal accesible reutilizable
frontend/src/components/ui/Field.jsx          # <Field label> que cablea htmlFor/id automÃ¢â€Å“ÃƒÂ­ticamente
frontend/tests/a11y_modal.test.mjs            # test del hook (Escape + trap)
frontend/src/lib/a11y/README.md              # guÃ¢â€Å“Ã‚Â¡a de migraciÃ¢â€Å“Ã¢â€â€šn para el resto del equipo
```

### 3. Archivos a modificar (piloto, en este orden)
```
frontend/src/components/ui/index.js           # (crear si no existe) re-export de Modal/Field
frontend/src/components/expedientes/UploadDocumentModal.jsx
frontend/src/components/inventario/ReceiveBatchModal.jsx
frontend/src/pages/Clientes.jsx
frontend/src/pages/Users.jsx
frontend/src/pages/ProfilePage.jsx
frontend/src/styles/app.css                   # clases .mwt-modal* + reglas @media print (no imprimir overlay)
```

### 4. Estructura de carpetas propuesta
```
src/lib/a11y/
  Ãƒâ€ÃƒÂ¶Ã‚Â£Ãƒâ€ÃƒÂ¶Ãƒâ€¡ useDialogA11y.js
  Ãƒâ€ÃƒÂ¶Ã‚Â£Ãƒâ€ÃƒÂ¶Ãƒâ€¡ useAutoId.js
  Ãƒâ€ÃƒÂ¶ÃƒÂ¶Ãƒâ€ÃƒÂ¶Ãƒâ€¡ README.md
src/components/ui/
  Ãƒâ€ÃƒÂ¶Ã‚Â£Ãƒâ€ÃƒÂ¶Ãƒâ€¡ Modal.jsx      (nuevo)
  Ãƒâ€ÃƒÂ¶Ã‚Â£Ãƒâ€ÃƒÂ¶Ãƒâ€¡ Field.jsx      (nuevo)
  Ãƒâ€ÃƒÂ¶ÃƒÂ¶Ãƒâ€ÃƒÂ¶Ãƒâ€¡ index.js       (barrel)
```

### 5. Fragmentos clave

**`src/lib/a11y/useDialogA11y.js`** (focus trap + Escape + restore, sin dependencias):
```jsx
import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),' +
  'input:not([disabled]):not([type="hidden"]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function useDialogA11y({ open, onClose }) {
  const ref = useRef(null);
  const returnFocusRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement;
    const node = ref.current;
    const focusables = () => Array.from(node?.querySelectorAll(FOCUSABLE) || []);
    // foco inicial: primer focusable o el contenedor
    (focusables()[0] || node)?.focus?.();

    function onKeyDown(e) {
      if (e.key === "Escape") { e.stopPropagation(); onClose?.(); return; }
      if (e.key !== "Tab") return;
      const f = focusables();
      if (f.length === 0) { e.preventDefault(); return; }
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    node?.addEventListener("keydown", onKeyDown);
    return () => {
      node?.removeEventListener("keydown", onKeyDown);
      returnFocusRef.current?.focus?.();   // restaura foco al disparador
    };
  }, [open, onClose]);

  return ref; // spread en el contenedor del diÃ¢â€Å“ÃƒÂ­logo
}
```

**`src/lib/a11y/useAutoId.js`:**
```jsx
import { useId } from "react";
// id estable y Ã¢â€Å“Ã¢â€¢â€˜nico para asociar labelÃƒâ€ÃƒÂ¥ÃƒÂ¶control sin colisiones.
export function useAutoId(prefix = "fld") {
  const id = useId();
  return `${prefix}-${id}`;
}
```

**`src/components/ui/Modal.jsx`** (shell reutilizable; envuelve el patrÃ¢â€Å“Ã¢â€â€šn existente overlay+card):
```jsx
import React from "react";
import { useDialogA11y } from "../../lib/a11y/useDialogA11y.js";
import { useAutoId } from "../../lib/a11y/useAutoId.js";
import { IconX } from "../../lib/icons.jsx";

export default function Modal({ open, onClose, title, children, footer, size = "md" }) {
  const titleId = useAutoId("modal-title");
  const ref = useDialogA11y({ open, onClose });
  if (!open) return null;
  return (
    <div className="mwt-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`mwt-modal mwt-modal--${size}`}
        tabIndex={-1}
      >
        <div className="mwt-modal-head">
          <h2 id={titleId} className="mwt-modal-title">{title}</h2>
          <button type="button" className="mwt-modal-close" aria-label="Cerrar" onClick={onClose}>
            <IconX />
          </button>
        </div>
        <div className="mwt-modal-body">{children}</div>
        {footer && <div className="mwt-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
```

**`src/components/ui/Field.jsx`** (cablea `htmlFor`/`id`; el hijo recibe el id por render-prop):
```jsx
import React from "react";
import { useAutoId } from "../../lib/a11y/useAutoId.js";

export default function Field({ label, hint, error, required, children }) {
  const id = useAutoId("field");
  const descId = hint || error ? `${id}-desc` : undefined;
  return (
    <div className={`mwt-field${error ? " is-error" : ""}`}>
      <label htmlFor={id} className="mwt-field-label">
        {label}{required && <span aria-hidden="true"> *</span>}
      </label>
      {children({ id, "aria-describedby": descId, "aria-invalid": !!error, required })}
      {(hint || error) && <p id={descId} className="mwt-field-hint">{error || hint}</p>}
    </div>
  );
}
// Uso:  <Field label="Nombre"> {(a)=> <input {...a} value={v} onChange={...}/>} </Field>
```

**Retrofit mÃ¢â€Å“Ã‚Â¡nimo de un modal existente** (patrÃ¢â€Å“Ã¢â€â€šn para `UploadDocumentModal.jsx` sin reescribirlo entero): dentro 
del componente aÃ¢â€Å“Ã¢â€“â€™adir
```jsx
const dialogRef = useDialogA11y({ open, onClose });
// y en el contenedor raÃ¢â€Å“Ã‚Â¡z del overlay:
// <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
```

### 6. Orden de ejecuciÃ¢â€Å“Ã¢â€â€šn
1. Crear `useAutoId.js` y `useDialogA11y.js`.
2. Crear `tests/a11y_modal.test.mjs` (usa `linkedom` para DOM; aÃ¢â€Å“Ã¢â€“â€™adir a `run.sh` como bundle no es necesario, es test 
de mÃ¢â€Å“Ã¢â€â€šdulo puro). Correr Ãƒâ€ÃƒÂ¥Ãƒâ€  rojo esperado.
3. Implementar hasta verde.
4. Crear `Modal.jsx` + `Field.jsx` + estilos `.mwt-modal*` en `app.css` (incluir `@media print { 
.mwt-modal-overlay{display:none} }`).
5. Retrofit `UploadDocumentModal.jsx` y `ReceiveBatchModal.jsx` con `useDialogA11y` (no migrar a `Modal.jsx` todavÃ¢â€Å“Ã‚Â¡a 
Ãƒâ€Ãƒâ€¡ÃƒÂ¶ solo cablear a11y).
6. Cablear labels explÃ¢â€Å“Ã‚Â¡citos en `Clientes.jsx`, `Users.jsx`, `ProfilePage.jsx` con `Field` en formularios 
nuevos/tocados; para inputs existentes aÃ¢â€Å“Ã¢â€“â€™adir `id`+`htmlFor` o `aria-label`.
7. Escribir `a11y/README.md` con la receta de migraciÃ¢â€Å“Ã¢â€â€šn incremental (para las ~19 pantallas restantes).

Comandos:
```powershell
cd frontend
npm i -D linkedom            # DOM ligero para tests de hooks a11y
node --test tests/a11y_modal.test.mjs
npm run build
bash tests/run.sh
```

### 7. Riesgos y mitigaciÃ¢â€Å“Ã¢â€â€šn
- **`document.activeElement` en Node/test:** encapsular el trap para que sea inerte sin DOM; el test usa `linkedom`. 
Mitigar con guardas `?.`.
- **framer-motion + focus:** si el modal anima montaje, el foco inicial puede llegar antes del `AnimatePresence`. 
Mitigar: aplicar foco en `useEffect` (ya lo hace el hook) y no en render.
- **RegresiÃ¢â€Å“Ã¢â€â€šn visual:** no cambiar markup visual, solo atributos ARIA + wrapper `ref`. `role="button"` del dropzone 
ya existe; aÃ¢â€Å“Ã¢â€“â€™adir `onKeyDown` (Enter/Space) para completarlo.
- **`useId` colisiones SSR:** no hay SSR aquÃ¢â€Å“Ã‚Â¡; safe.

### 8. VerificaciÃ¢â€Å“Ã¢â€â€šn
- `node --test tests/a11y_modal.test.mjs` verde.
- Smoke manual: abrir cada modal piloto Ãƒâ€ÃƒÂ¥Ãƒâ€  Tab cicla dentro, Escape cierra, foco vuelve al botÃ¢â€Å“Ã¢â€â€šn. 
Lighthouse/axe-core opcional sobre `/clientes` y `/usuarios`.

---

## Frente 3.26 Ãƒâ€Ãƒâ€¡ÃƒÂ¶ React Query (adopciÃ¢â€Å“Ã¢â€â€šn incremental)

### 1. Objetivo y criterio de salida
Introducir `@tanstack/react-query` como capa de **estado servidor** manteniendo `api.js` como **transporte**. Migrar 
por dominio empezando por Expedientes (elimina el N+1).
**Criterios medibles:**
- `QueryClientProvider` montado en `main.jsx`; devtools solo en dev.
- `pages/Expedientes.jsx` consume `useExpedientesData()` (React Query) y el N+1 de clientes desaparece: **1 request de 
listado de clientes** (o batch `?ids=`) en lugar de N.
- `swrCache.js` sigue funcionando para lo que ya lo usa (no se borra en esta ola).
- ConvenciÃ¢â€Å“Ã¢â€â€šn de **query keys** documentada y aplicada; invalidaciones post-mutaciÃ¢â€Å“Ã¢â€â€šn funcionando.

### 2. Archivos a crear
```
frontend/src/lib/queryClient.js               # instancia QueryClient + defaults
frontend/src/lib/queryKeys.js                 # factory central de keys
frontend/src/hooks/queries/useExpedientesData.js
frontend/src/hooks/queries/useClientesMap.js  # batch de clientes (mata el N+1)
frontend/src/hooks/mutations/useExpedienteMutations.js
frontend/src/hooks/queries/README.md          # guÃ¢â€Å“Ã‚Â¡a de migraciÃ¢â€Å“Ã¢â€â€šn por dominio
```

### 3. Archivos a modificar
```
frontend/package.json                         # + @tanstack/react-query (+ devtools en devDeps)
frontend/src/main.jsx                          # QueryClientProvider
frontend/src/pages/Expedientes.jsx             # reemplazar fetch manual por useExpedientesData
frontend/src/context/AuthContext.jsx           # (o donde se hace logout) queryClient.clear() en logout
frontend/vite.config.js                        # manualChunks: aÃ¢â€Å“Ã¢â€“â€™adir "query" chunk
```

### 4. Decisiones de arquitectura
- **Instalar:** `@tanstack/react-query@^5` (v5, API `useQuery({queryKey,queryFn})`, `staleTime`, `gcTime`). Devtools 
`@tanstack/react-query-devtools@^5` solo `devDependencies`, montado condicional a `import.meta.env.DEV`.
- **`api.js` = transporte:** las `queryFn` llaman a `expedientesApi.list()`, `clientesApi.list()`, etc. **No** se toca 
la firma de `apiFetch`. El `signal` de React Query se pasa como `resource.list(params, { signal })`.
- **Query keys:** factory tipada por convenciÃ¢â€Å“Ã¢â€â€šn en `queryKeys.js`.
- **MigraciÃ¢â€Å“Ã¢â€â€šn por dominio:** Expedientes Ãƒâ€ÃƒÂ¥Ãƒâ€  Transfers Ãƒâ€ÃƒÂ¥Ãƒâ€  Clientes/Productos Ãƒâ€ÃƒÂ¥Ãƒâ€  resto. Los hooks viejos 
(`useTransfersData`, etc.) coexisten; se migran uno por sprint moviÃ¢â€Å“Ã‚Â®ndolos a `hooks/queries/`.
- **Invalidaciones:** cada mutaciÃ¢â€Å“Ã¢â€â€šn invalida su key raÃ¢â€Å“Ã‚Â¡z (`queryKeys.expedientes.all`).
- **`swrCache.js`:** se mantiene esta ola; en una ola futura `usePortalData` migra a RQ y se deprecarÃ¢â€Å“ÃƒÂ­.

### 5. Fragmentos clave

**`src/lib/queryClient.js`:**
```js
import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api.js";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,           // 30s: listados no re-fetch en cada navegaciÃ¢â€Å“Ã¢â€â€šn
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false, // consistente con el comportamiento actual
      retry: (count, err) => {
        if (err instanceof ApiError && [400,401,403,404].includes(err.status)) return false;
        return count < 1;          // 1 reintento, alineado con apiFetch
      },
    },
  },
});
```

**`src/lib/queryKeys.js`:**
```js
export const queryKeys = {
  expedientes: {
    all: ["expedientes"],
    list: (params) => ["expedientes", "list", params ?? {}],
    detail: (id) => ["expedientes", "detail", id],
  },
  clientes: {
    all: ["clientes"],
    list: (params) => ["clientes", "list", params ?? {}],
    byIds: (ids) => ["clientes", "byIds", [...ids].sort()],
  },
  lineas:    { all: ["lineas"],    list: (p) => ["lineas", "list", p ?? {}] },
  productos: { all: ["productos"], list: (p) => ["productos", "list", p ?? {}] },
  transferencias: { all: ["transferencias"], list: (p) => ["transferencias","list",p ?? {}] },
};
```

**`src/main.jsx`** (ediciÃ¢â€Å“Ã¢â€â€šn):
```jsx
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient.js";
// dentro del render, envolviendo <App/> (debajo de RoleProvider):
// <QueryClientProvider client={queryClient}> ... </QueryClientProvider>
// + en dev:  import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />
```

**`src/hooks/queries/useClientesMap.js`** (mata el N+1 Ãƒâ€Ãƒâ€¡ÃƒÂ¶ batch, no N gets):
```js
import { useQuery } from "@tanstack/react-query";
import { clientesApi } from "../../lib/api.js";
import { queryKeys } from "../../lib/queryKeys.js";

// Prefiere un Ã¢â€Å“Ã¢â€¢â€˜nico list() y arma el mapa en cliente. Si el backend
// soporta ?ids=, cÃ¢â€Å“ÃƒÂ­mbialo por clientesApi.list({ ids: ids.join(",") }).
export function useClientesMap(ids) {
  const enabled = Array.isArray(ids) && ids.length > 0;
  return useQuery({
    queryKey: queryKeys.clientes.byIds(ids || []),
    enabled,
    queryFn: async ({ signal }) => {
      const raw = await clientesApi.list(undefined, { signal });
      const arr = Array.isArray(raw) ? raw : (raw?.results || []);
      const wanted = new Set(ids);
      const map = {};
      for (const c of arr) if (c?.id && wanted.has(c.id)) map[c.id] = c;
      return map;
    },
    staleTime: 60_000,
  });
}
```

**`src/hooks/queries/useExpedientesData.js`:**
```js
import { useQuery } from "@tanstack/react-query";
import { expedientesApi, ocsApi, lineasApi, productosApi } from "../../lib/api.js";
import { queryKeys } from "../../lib/queryKeys.js";

export function useExpedientesData(params) {
  return useQuery({
    queryKey: queryKeys.expedientes.list(params),
    queryFn: async ({ signal }) => {
      const [expRaw, ocRaw, lnRaw, prodRaw] = await Promise.all([
        expedientesApi.list(params, { signal }),
        ocsApi.list(undefined, { signal }),
        lineasApi.list({ activo: true }, { signal }),
        productosApi.list(undefined, { signal }),
      ]);
      return { expRaw, ocRaw, lnRaw, prodRaw };
    },
  });
}
// En Expedientes.jsx: derivar uniqueClientIds del resultado y pasarlos a
// useClientesMap(ids) Ãƒâ€ÃƒÂ¥Ãƒâ€  un solo fetch de clientes en vez de N gets.
```

**`src/hooks/mutations/useExpedienteMutations.js`:**
```js
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { expedientesApi } from "../../lib/api.js";
import { queryKeys } from "../../lib/queryKeys.js";

export function useExpedienteMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: queryKeys.expedientes.all });
  return {
    update: useMutation({ mutationFn: ({ id, body }) => expedientesApi.update(id, body), onSuccess: invalidate }),
    create: useMutation({ mutationFn: (body) => expedientesApi.create(body),           onSuccess: invalidate }),
  };
}
```

**`vite.config.js`** (aÃ¢â€Å“Ã¢â€“â€™adir a `manualChunks`):
```js
query: ["@tanstack/react-query"],
```

**Logout** (`AuthContext.jsx` o handler de `mwt-auth-logout`): aÃ¢â€Å“Ã¢â€“â€™adir `queryClient.clear()` junto al `clearCache()` 
existente para no filtrar datos entre usuarios (paridad con la higiene R3 de `swrCache`).

### 6. Orden de ejecuciÃ¢â€Å“Ã¢â€â€šn
```powershell
cd frontend
npm i @tanstack/react-query
npm i -D @tanstack/react-query-devtools
```
1. Crear `queryClient.js`, `queryKeys.js`.
2. Montar `QueryClientProvider` en `main.jsx` (+ devtools en dev). `npm run build` verde.
3. Crear `useClientesMap.js` + `useExpedientesData.js` + mutaciones.
4. Refactor `Expedientes.jsx`: sustituir el bloque de fetch manual (incl. el `Promise.all(...map(clientesApi.get))` 
~L222) por los hooks. Mantener el resto de la lÃ¢â€Å“Ã¢â€â€šgica de enriquecimiento (`orderValue`, `sumClient/sumMwt`) tal cual, 
alimentÃ¢â€Å“ÃƒÂ­ndola desde `data`.
5. AÃ¢â€Å“Ã¢â€“â€™adir `queryClient.clear()` en logout.
6. `manualChunks.query` en `vite.config.js`.
7. Documentar en `hooks/queries/README.md` la receta para el siguiente dominio (Transfers).

### 7. Riesgos y mitigaciÃ¢â€Å“Ã¢â€â€šn
- **AbortSignal doble:** `apiFetch` ya ata GETs al controlador global de navegaciÃ¢â€Å“Ã¢â€â€šn cuando no hay `signal`. Al pasar 
el `signal` de RQ, RQ manda; correcto. No pasar ambos.
- **Shapes inconsistentes (`Array` vs `{results}`):** normalizar SIEMPRE en la `queryFn`/selector (el cÃ¢â€Å“Ã¢â€â€šdigo ya usa 
`Array.isArray(x) ? x : x?.results||[]`).
- **Bundle:** RQ ~ +12KB gz; aislado en chunk `query`, no invalida el chunk de app.
- **Doble fuente de verdad con `swrCache`:** no migrar `usePortalData` en esta ola; dejar frontera clara (RQ para 
dominios nuevos, swrCache para portal).
- **Devtools en prod:** montar solo bajo `import.meta.env.DEV`.
- **401/refresh:** `apiFetch` ya hace auto-refresh; `retry` de RQ excluye 401/403 para no duplicar.

### 8. VerificaciÃ¢â€Å“Ã¢â€â€šn
- `npm run build` + `bash tests/run.sh` verdes (tests de `api.js` no cambian).
- Smoke: abrir `/expedientes` con Network abierto Ãƒâ€ÃƒÂ¥Ãƒâ€  confirmar **1** request a `/clientes/` (no N). Navegar fuera y 
volver dentro de 30s Ãƒâ€ÃƒÂ¥Ãƒâ€  sin re-fetch (staleTime). Editar un expediente Ãƒâ€ÃƒÂ¥Ãƒâ€  lista se invalida y refresca.
- Opcional: `tests/query_keys.test.mjs` (mÃ¢â€Å“Ã¢â€â€šdulo puro) valida estabilidad/orden de keys.

---

## Frente 3.27 Ãƒâ€Ãƒâ€¡ÃƒÂ¶ VirtualizaciÃ¢â€Å“Ã¢â€â€šn

### 1. Objetivo y criterio de salida
Componente `<VirtualTable>` reutilizable que virtualiza filas solo cuando conviene, con **fallback** a `<table>` 
normal bajo umbral y **desactivaciÃ¢â€Å“Ã¢â€â€šn en print**.
**Criterios medibles:**
- `rows.length < threshold` (default 60) Ãƒâ€ÃƒÂ¥Ãƒâ€  render de tabla normal (idÃ¢â€Å“Ã‚Â®ntico al actual).
- `rows.length Ãƒâ€ÃƒÂ«Ãƒâ€˜ threshold` Ãƒâ€ÃƒÂ¥Ãƒâ€  virtualizaciÃ¢â€Å“Ã¢â€â€šn con scroll; DOM mantiene solo filas visibles + overscan.
- `@media print` Ãƒâ€ÃƒÂ¥Ãƒâ€  se renderizan **todas** las filas (sin virtualizaciÃ¢â€Å“Ã¢â€â€šn) para no romper impresiÃ¢â€Å“Ã¢â€â€šn.
- `tabular-nums` y estilos de columnas numÃ¢â€Å“Ã‚Â®ricas preservados.
- Aplicado a **1 tabla piloto** (`pages/Expedientes.jsx`) sin regresiÃ¢â€Å“Ã¢â€â€šn visual/print.

### 2. DecisiÃ¢â€Å“Ã¢â€â€šn de librerÃ¢â€Å“Ã‚Â¡a
**`@tanstack/react-virtual@^3`** (no `react-window`):
- API de hook (`useVirtualizer`) encaja con JSX sin wrappers de tamaÃ¢â€Å“Ã¢â€“â€™o fijo obligatorio.
- Mismo ecosistema TanStack que 3.26 (coherencia mental del equipo).
- Soporta filas de altura variable (`measureElement`) Ãƒâ€Ãƒâ€¡ÃƒÂ¶ Ã¢â€Å“Ã¢â€¢â€˜til para filas con badges/expansiÃ¢â€Å“Ã¢â€â€šn.

### 3. Archivos a crear
```
frontend/src/components/ui/VirtualTable.jsx
frontend/src/lib/useIsPrinting.js             # detecta @media print vÃ¢â€Å“Ã‚Â¡a matchMedia
frontend/tests/virtual_table_threshold.test.mjs  # lÃ¢â€Å“Ã¢â€â€šgica de decisiÃ¢â€Å“Ã¢â€â€šn (mÃ¢â€Å“Ã¢â€â€šdulo puro)
```

### 4. Archivos a modificar
```
frontend/package.json                          # + @tanstack/react-virtual
frontend/src/pages/Expedientes.jsx             # tabla piloto Ãƒâ€ÃƒÂ¥Ãƒâ€  VirtualTable
frontend/src/styles/app.css                    # .mwt-vtable* + @media print { overflow visible }
frontend/vite.config.js                        # (opcional) manualChunks: virtual junto a query
```

### 5. Componente completo

**`src/lib/useIsPrinting.js`:**
```js
import { useEffect, useState } from "react";
export function useIsPrinting() {
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("print");
    const on = (e) => setPrinting(e.matches);
    on(mq);
    mq.addEventListener?.("change", on);
    window.addEventListener("beforeprint", () => setPrinting(true));
    window.addEventListener("afterprint", () => setPrinting(false));
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return printing;
}
```

**`src/components/ui/VirtualTable.jsx`:**
```jsx
import React, { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useIsPrinting } from "../../lib/useIsPrinting.js";

/**
 * columns: [{ key, header, render?(row), className?, align? }]
 * rows: array de datos
 * rowKey: (row) => string|number
 * threshold: nÃ¢â€Â¬Ã¢â€¢â€˜ mÃ¢â€Å“Ã‚Â¡nimo de filas para virtualizar (default 60)
 * estimateRowHeight: px estimados por fila (default 44)
 * maxHeight: alto del viewport virtual (default 640)
 */
export default function VirtualTable({
  columns, rows, rowKey, threshold = 60,
  estimateRowHeight = 44, maxHeight = 640, className = "", emptyLabel = "Sin datos",
}) {
  const printing = useIsPrinting();
  const shouldVirtualize = rows.length >= threshold && !printing;

  const Head = (
    <thead>
      <tr>
        {columns.map((c) => (
          <th key={c.key} className={c.className} style={c.align ? { textAlign: c.align } : undefined}>
            {c.header}
          </th>
        ))}
      </tr>
    </thead>
  );

  const renderRow = (row) => (
    <tr key={rowKey(row)}>
      {columns.map((c) => (
        <td key={c.key} className={c.className} style={c.align ? { textAlign: c.align } : undefined}>
          {c.render ? c.render(row) : row[c.key]}
        </td>
      ))}
    </tr>
  );

  // Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡ Fallback: tabla normal (bajo umbral o imprimiendo) Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡
  if (!shouldVirtualize) {
    return (
      <table className={`mwt-table ${className}`}>
        {Head}
        <tbody>
          {rows.length === 0
            ? <tr><td colSpan={columns.length} className="mwt-table-empty">{emptyLabel}</td></tr>
            : rows.map(renderRow)}
        </tbody>
      </table>
    );
  }

  // Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡ Virtualizado Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€
ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡Ãƒâ€ÃƒÂ¶Ãƒâ€¡
  return <Virtualized {...{ columns, rows, rowKey, estimateRowHeight, maxHeight, className, Head }} />;
}

function Virtualized({ columns, rows, rowKey, estimateRowHeight, maxHeight, className, Head }) {
  const scrollRef = useRef(null);
  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateRowHeight,
    overscan: 10,
  });
  const items = virt.getVirtualItems();
  const padTop = items.length ? items[0].start : 0;
  const padBottom = items.length ? virt.getTotalSize() - items[items.length - 1].end : 0;

  return (
    <div ref={scrollRef} className="mwt-vtable-scroll" style={{ maxHeight, overflow: "auto" }}>
      <table className={`mwt-table ${className}`}>
        {Head}
        <tbody>
          {padTop > 0 && <tr aria-hidden="true" style={{ height: padTop }}><td colSpan={columns.length} /></tr>}
          {items.map((vi) => {
            const row = rows[vi.index];
            return (
              <tr key={rowKey(row)} data-index={vi.index} ref={virt.measureElement}>
                {columns.map((c) => (
                  <td key={c.key} className={c.className} style={c.align ? { textAlign: c.align } : undefined}>
                    {c.render ? c.render(row) : row[c.key]}
                  </td>
                ))}
              </tr>
            );
          })}
          {padBottom > 0 && <tr aria-hidden="true" style={{ height: padBottom }}><td colSpan={columns.length} /></tr>}
        </tbody>
      </table>
    </div>
  );
}
```

**`app.css`** (aÃ¢â€Å“Ã¢â€“â€™adir; preservar print y tabular-nums):
```css
.mwt-vtable-scroll { position: relative; }
.mwt-table td.num, .mwt-table th.num { font-variant-numeric: tabular-nums; text-align: right; }
@media print {
  .mwt-vtable-scroll { max-height: none !important; overflow: visible !important; }
}
```

### 6. Orden de ejecuciÃ¢â€Å“Ã¢â€â€šn
```powershell
cd frontend
npm i @tanstack/react-virtual
node --test tests/virtual_table_threshold.test.mjs
```
1. Crear `useIsPrinting.js` + `VirtualTable.jsx`.
2. Test de la regla de decisiÃ¢â€Å“Ã¢â€â€šn (extraer `shouldVirtualize(rows,threshold,printing)` a funciÃ¢â€Å“Ã¢â€â€šn pura importable para 
testear sin DOM).
3. Estilos en `app.css`.
4. Migrar la tabla de `Expedientes.jsx` a `<VirtualTable columns=... rows=...>`, marcando columnas numÃ¢â€Å“Ã‚Â®ricas con 
`className:"num"`.
5. Verificar print (Ctrl+P / preview) muestra todas las filas.
6. Repetir para Productos, Transferencias, Pagos, LÃ¢â€Å“Ã‚Â¡neas en sprints siguientes.

### 7. Riesgos y mitigaciÃ¢â€Å“Ã¢â€â€šn
- **`<thead>` sticky + virtualizaciÃ¢â€Å“Ã¢â€â€šn:** el header queda fuera del cuerpo virtual; usar `position: sticky; top:0` en 
`th`. Verificado que el patrÃ¢â€Å“Ã¢â€â€šn de padding-rows preserva colspan.
- **Anchos de columna Ãƒâ€Ãƒâ€¡Ã‚Â£saltanÃƒâ€Ãƒâ€¡ÃƒËœ:** con filas variables el ancho puede reflotar. Mitigar con `table-layout: fixed` o 
anchos por `<col>`.
- **Print roto:** cubierto por `useIsPrinting` + `@media print`. Test manual obligatorio.
- **Filas con expansiÃ¢â€Å“Ã¢â€â€šn/detalle:** `measureElement` mide altura real; overscan 10 evita huecos.
- **framer-motion en filas:** no animar filas dentro del cuerpo virtual (recalcula medidas). Animar a nivel de 
contenedor.

### 8. VerificaciÃ¢â€Å“Ã¢â€â€šn
- `node --test tests/virtual_table_threshold.test.mjs` verde.
- Smoke con tabla de >100 expedientes: DOM inspector muestra ~30Ãƒâ€Ãƒâ€¡ÃƒÂ´40 `<tr>` renderizadas, scroll fluido; `Ctrl+P` 
muestra todas.
- `npm run build` verde; confirmar chunk `@tanstack/react-virtual` separado.

---

## Frente 3.28 Ãƒâ€Ãƒâ€¡ÃƒÂ¶ Partir monolitos

### 1. Objetivo y criterio de salida
Reducir 2Ãƒâ€Ãƒâ€¡ÃƒÂ´3 monolitos crÃ¢â€Å“Ã‚Â¡ticos separando **datos (hooks)**, **lÃ¢â€Å“Ã¢â€â€šgica de dominio (utils puros)** y **presentaciÃ¢â€Å“Ã¢â€â€šn 
(subcomponentes)**, sin cambiar comportamiento.
**Criterios medibles por archivo objetivo:**
- Archivo raÃ¢â€Å“Ã‚Â¡z queda **< 1200 LOC**.
- Cada `use<X>Data` extraÃ¢â€Å“Ã‚Â¡do es un hook testeable; la lÃ¢â€Å“Ã¢â€â€šgica pura (cÃ¢â€Å“ÃƒÂ­lculos) sale a `*.logic.js` con tests 
unitarios.
- Sin regresiÃ¢â€Å“Ã¢â€â€šn funcional (smoke del flujo completo).

### 2. SelecciÃ¢â€Å“Ã¢â€â€šn de objetivos (orden por ROI)
1. **`src/components/transfers/TransferLiquidationPanel.jsx` (3184 LOC)** Ãƒâ€Ãƒâ€¡ÃƒÂ¶ lÃ¢â€Å“Ã¢â€â€šgica fiscal pura (NCM/DAI/IVA) muy 
testeable; alto valor de negocio (ya fue foco de la auditorÃ¢â€Å“Ã‚Â¡a de liquidaciÃ¢â€Å“Ã¢â€â€šn).
2. **`src/pages/CreateExpedienteWizardLite.jsx` (3182 LOC, 21 useEffect)** Ãƒâ€Ãƒâ€¡ÃƒÂ¶ ya tiene subcomponentes internos 
(`Step0..Step3`, cards) Ãƒâ€ÃƒÂ¥Ãƒâ€  extracciÃ¢â€Å“Ã¢â€â€šn de bajo riesgo.
3. **`src/pages/ProductFormView.jsx` (3568 LOC)** Ãƒâ€Ãƒâ€¡ÃƒÂ¶ el mÃ¢â€Å“ÃƒÂ­s grande; abordar tras validar el patrÃ¢â€Å“Ã¢â€â€šn con los dos 
primeros.

### 3. Estructura de carpetas propuesta
```
src/features/transfers/liquidation/
  Ãƒâ€ÃƒÂ¶Ã‚Â£Ãƒâ€ÃƒÂ¶Ãƒâ€¡ TransferLiquidationPanel.jsx      (shell < 1200 LOC: orquesta)
  Ãƒâ€ÃƒÂ¶Ã‚Â£Ãƒâ€ÃƒÂ¶Ãƒâ€¡ useLiquidationData.js             (fetch: transfer, docs, tasas)
  Ãƒâ€ÃƒÂ¶Ã‚Â£Ãƒâ€ÃƒÂ¶Ãƒâ€¡ liquidation.logic.js              (PURO: taxRatesForNcm, prorrateo, IVA excluido, scope_json)
  Ãƒâ€ÃƒÂ¶Ã‚Â£Ãƒâ€ÃƒÂ¶Ãƒâ€¡ components/
  Ãƒâ€ÃƒÂ¶ÃƒÂ©   Ãƒâ€ÃƒÂ¶Ã‚Â£Ãƒâ€ÃƒÂ¶Ãƒâ€¡ ScopeChip.jsx
  Ãƒâ€ÃƒÂ¶ÃƒÂ©   Ãƒâ€ÃƒÂ¶Ã‚Â£Ãƒâ€ÃƒÂ¶Ãƒâ€¡ SummaryStat.jsx
  Ãƒâ€ÃƒÂ¶ÃƒÂ©   Ãƒâ€ÃƒÂ¶Ã‚Â£Ãƒâ€ÃƒÂ¶Ãƒâ€¡ DocChip.jsx
  Ãƒâ€ÃƒÂ¶ÃƒÂ©   Ãƒâ€ÃƒÂ¶ÃƒÂ¶Ãƒâ€ÃƒÂ¶Ãƒâ€¡ ConfirmModal.jsx              (migrar a ui/Modal.jsx de 3.25)
  Ãƒâ€ÃƒÂ¶ÃƒÂ¶Ãƒâ€ÃƒÂ¶Ãƒâ€¡ __tests__/liquidation.logic.test.mjs

src/features/expedientes/wizard-lite/
  Ãƒâ€ÃƒÂ¶Ã‚Â£Ãƒâ€ÃƒÂ¶Ãƒâ€¡ CreateExpedienteWizardLite.jsx    (shell < 1200 LOC)
  Ãƒâ€ÃƒÂ¶Ã‚Â£Ãƒâ€ÃƒÂ¶Ãƒâ€¡ useWizardLiteState.js             (consolida los 21 useEffect en un reducer/hook)
  Ãƒâ€ÃƒÂ¶Ã‚Â£Ãƒâ€ÃƒÂ¶Ãƒâ€¡ pricing.logic.js                  (PURO: PRONTO_PAGO_TIERS, proyecciÃ¢â€Å“Ã¢â€â€šn crÃ¢â€Å“Ã‚Â®dito, overrides)
  Ãƒâ€ÃƒÂ¶Ã‚Â£Ãƒâ€ÃƒÂ¶Ãƒâ€¡ steps/
  Ãƒâ€ÃƒÂ¶ÃƒÂ©   Ãƒâ€ÃƒÂ¶Ã‚Â£Ãƒâ€ÃƒÂ¶Ãƒâ€¡ Step0Operador.jsx
  Ãƒâ€ÃƒÂ¶ÃƒÂ©   Ãƒâ€ÃƒÂ¶Ã‚Â£Ãƒâ€ÃƒÂ¶Ãƒâ€¡ Step1Cliente.jsx  (+ MwtOperatorCard, SelectedClientCard)
  Ãƒâ€ÃƒÂ¶ÃƒÂ©   Ãƒâ€ÃƒÂ¶Ã‚Â£Ãƒâ€ÃƒÂ¶Ãƒâ€¡ Step2Productos.jsx
  Ãƒâ€ÃƒÂ¶ÃƒÂ©   Ãƒâ€ÃƒÂ¶ÃƒÂ¶Ãƒâ€ÃƒÂ¶Ãƒâ€¡ Step3Resumen.jsx  (+ CreditProjectionCard, Stat)
  Ãƒâ€ÃƒÂ¶ÃƒÂ¶Ãƒâ€ÃƒÂ¶Ãƒâ€¡ shared/ (Stepper.jsx, Field.jsxÃƒâ€ÃƒÂ¥Ãƒâ€ usa ui/Field, Toast.jsx, adaptClient/orderClientsHierarchy en 
clients.logic.js)

src/features/productos/form/
  Ãƒâ€ÃƒÂ¶Ã‚Â£Ãƒâ€ÃƒÂ¶Ãƒâ€¡ ProductFormView.jsx               (shell)
  Ãƒâ€ÃƒÂ¶Ã‚Â£Ãƒâ€ÃƒÂ¶Ãƒâ€¡ useProductFormData.js
  Ãƒâ€ÃƒÂ¶Ã‚Â£Ãƒâ€ÃƒÂ¶Ãƒâ€¡ product.logic.js                  (specs, precios, validaciÃ¢â€Å“Ã¢â€â€šn)
  Ãƒâ€ÃƒÂ¶ÃƒÂ¶Ãƒâ€ÃƒÂ¶Ãƒâ€¡ sections/  (IdentitySection, PricingSection, SizingSection, NcmSection, MediaSection ...)
```

> **Nota de imports:** mover a `src/features/**` implica actualizar el `lazy(() => import("./pages/..."))` en 
`App.jsx`. Alternativa de menor riesgo: dejar el shell en su ruta actual (`pages/` o `components/transfers/`) y crear 
solo la subcarpeta hermana con hooks/logic/components. **Recomendado para esta ola:** subcarpeta hermana, sin mover el 
archivo raÃ¢â€Å“Ã‚Â¡z (no tocar `App.jsx`).

Estructura recomendada sin mover el shell:
```
src/pages/CreateExpedienteWizardLite.jsx        (shell, se adelgaza)
src/pages/wizard-lite/                           (nuevo, hermano)
  Ãƒâ€ÃƒÂ¶Ã‚Â£Ãƒâ€ÃƒÂ¶Ãƒâ€¡ useWizardLiteState.js
  Ãƒâ€ÃƒÂ¶Ã‚Â£Ãƒâ€ÃƒÂ¶Ãƒâ€¡ pricing.logic.js
  Ãƒâ€ÃƒÂ¶Ã‚Â£Ãƒâ€ÃƒÂ¶Ãƒâ€¡ clients.logic.js
  Ãƒâ€ÃƒÂ¶ÃƒÂ¶Ãƒâ€ÃƒÂ¶Ãƒâ€¡ steps/Step0Operador.jsx ...
```

### 4. Fragmentos clave

**Extraer lÃ¢â€Å“Ã¢â€â€šgica pura (ejemplo `liquidation.logic.js`) Ãƒâ€Ãƒâ€¡ÃƒÂ¶ testeable sin React:**
```js
// Movido tal cual desde el panel: funciÃ¢â€Å“Ã¢â€â€šn pura, cero deps de React.
export function taxRatesForNcm(ncm) { /* ...tabla NCMÃƒâ€ÃƒÂ¥Ãƒâ€ {dai, iva}... */ }

// IVA NO capitaliza (alineado con backend commit d7d21b2):
export const NON_CAPITALIZABLE_KINDS = new Set(["IVA"]);

export function prorateCosts(costLines, items, { excludeKinds = NON_CAPITALIZABLE_KINDS } = {}) {
  // aplica scope_json por lÃ¢â€Å“Ã‚Â¡nea, excluye IVA del landed cost, reparte por valor.
  // devuelve { perItem, extraCostsIvaUsd, extraCostsTotalUsd }
}
```

**Hook de datos (patrÃ¢â€Å“Ã¢â€â€šn existente del repo):**
```js
// src/pages/wizard-lite/useWizardLiteState.js
import { useReducer, useEffect } from "react";
// Consolida los 21 useEffect dispersos en efectos agrupados por responsabilidad:
//  - carga inicial (clientes, catÃ¢â€Å“ÃƒÂ­logos)  Ãƒâ€ÃƒÂ¥Ãƒâ€  1 efecto
//  - recÃ¢â€Å“ÃƒÂ­lculo de precios ante cambios     Ãƒâ€ÃƒÂ¥Ãƒâ€  1 efecto (dep: [lines, selClient, tc])
//  - persistencia/borrador                 Ãƒâ€ÃƒÂ¥Ãƒâ€  1 efecto
// Reduce superficie de bugs por dependencias.
export function useWizardLiteState(initial) { /* ... */ }
```

**Shell adelgazado (orquestaciÃ¢â€Å“Ã¢â€â€šn):**
```jsx
// CreateExpedienteWizardLite.jsx (despuÃ¢â€Å“Ã‚Â®s): importa steps + hook + logic
import Step0Operador from "./wizard-lite/steps/Step0Operador.jsx";
// ...
export default function CreateExpedienteWizardLite() {
  const wiz = useWizardLiteState();
  return (
    <div className="wizard-lite">
      <Stepper step={wiz.step} steps={wiz.steps} onJump={wiz.jump} lang={wiz.lang} />
      {wiz.step === 0 && <Step0Operador {...wiz.step0Props} />}
      {/* ...Step1..Step3... */}
    </div>
  );
}
```

### 5. Orden de ejecuciÃ¢â€Å“Ã¢â€â€šn (por archivo, receta repetible)
Por cada objetivo, en este orden estricto (**un solo editor / archivo a la vez**):
1. **Congelar comportamiento:** identificar el flujo E2E y anotar smoke steps.
2. **Extraer lÃ¢â€Å“Ã¢â€â€šgica pura** Ãƒâ€ÃƒÂ¥Ãƒâ€  `*.logic.js` (mover funciones sin estado: `taxRatesForNcm`, `adaptClient`, 
`orderClientsHierarchy`, cÃ¢â€Å“ÃƒÂ­lculos de precio). Crear su `__tests__/*.test.mjs`. Correr Ãƒâ€ÃƒÂ¥Ãƒâ€  verde.
3. **Extraer hook de datos/estado** (`use<X>Data` / `use<X>State`), moviendo `useEffect`/`useState` relacionados. 
Sustituir en el shell.
4. **Extraer subcomponentes** ya delimitados por `function Xxx(...)` internos (el repo ya los tiene: `Step0Operador`, 
`ScopeChip`, `SummaryStat`, `DocChip`, `ConfirmModal`, etc.). Uno por commit.
5. **Migrar modales internos** (`ConfirmModal`) a `ui/Modal.jsx` de 3.25.
6. `npm run build` + `bash tests/run.sh` verdes tras cada extracciÃ¢â€Å“Ã¢â€â€šn.

Comandos por iteraciÃ¢â€Å“Ã¢â€â€šn:
```powershell
cd frontend
node --test tests/liquidation_logic.test.mjs   # (o el que corresponda)
npm run build
bash tests/run.sh
```

### 6. Riesgos y mitigaciÃ¢â€Å“Ã¢â€â€šn
- **Rutas de import rotas:** preferir subcarpeta hermana para no tocar `App.jsx`. Si se mueve el shell, actualizar el 
`lazy(import())` correspondiente y verificar el chunk.
- **Estado compartido implÃ¢â€Å“Ã‚Â¡cito entre steps:** al extraer, pasar props explÃ¢â€Å“Ã‚Â¡citas (el repo ya pasa props gigantes a 
`Step3Resumen`); documentar contrato de props en cada subcomponente.
- **`useEffect` con deps sutiles (21 en Wizard Lite):** no fusionar a ciegas; agrupar por responsabilidad y verificar 
cada dependencia. Mantener `eslint-disable exhaustive-deps` solo donde ya existÃ¢â€Å“Ã‚Â¡a.
- **Constantes duplicadas** (`PRONTO_PAGO_TIERS` estÃ¢â€Å“ÃƒÂ­ en 3 sitios: wizard, `UploadDocumentModal`, 
`proforma_renderer`): al extraer a `pricing.logic.js`, **no** unificar los tres en esta ola (riesgo backend); dejar 
comentario `// SYNC: ...` como ya existe.
- **RegresiÃ¢â€Å“Ã¢â€â€šn de liquidaciÃ¢â€Å“Ã¢â€â€šn fiscal:** la lÃ¢â€Å“Ã¢â€â€šgica IVA/scope_json ya fue auditada (backend d7d21b2). Los tests de 
`liquidation.logic.js` deben cubrir: IVA excluido del landed cost, prorrateo por `scope_json`, DAI por NCM.
- **framer-motion + code-split:** subcomponentes nuevos heredan el chunk de la ruta (lazy ya activo); no crear nuevos 
`lazy` internos salvo secciones muy pesadas.

### 7. VerificaciÃ¢â€Å“Ã¢â€â€šn
- Tests de `*.logic.js` verdes (nuevos).
- `npm run build` verde; comparar tamaÃ¢â€Å“Ã¢â€“â€™o de chunk de la ruta antes/despuÃ¢â€Å“Ã‚Â®s (debe bajar o mantenerse).
- Smoke E2E por objetivo:
  - **Liquidation:** cargar una transferencia, correr liquidaciÃ¢â€Å“Ã¢â€â€šn, confirmar que IVA no infla landed cost y el 
resumen coincide con el valor previo.
  - **Wizard Lite:** crear expediente ADMIN de punta a punta (Step0Ãƒâ€ÃƒÂ¥Ãƒâ€ Step3), verificar proyecciÃ¢â€Å“Ã¢â€â€šn de crÃ¢â€Å“Ã‚Â®dito y 
overrides de precio.
  - **ProductForm:** editar producto con specs/precios/tallas/NCM y guardar.
- `git diff --stat` confirma LOC del shell < 1200.

---

## Orden global de la Ola 3 restante

| # | Frente | Por quÃ¢â€Å“Ã‚Â® en este orden | Depende de |
|---|--------|----------------------|-----------|
| 1 | **3.25 Accesibilidad** | Crea `ui/Modal.jsx` y `ui/Field.jsx` que reutilizan 3.27 y 3.28; bajo riesgo, alto 
valor transversal. | Ãƒâ€Ãƒâ€¡ÃƒÂ¶ |
| 2 | **3.26 React Query** | Fundamenta la capa de datos; mata el N+1 de Expedientes ya. `queryClient`/keys los usarÃ¢â€Å“ÃƒÂ­ 
3.27 en tablas server-driven. | 3.25 (opcional) |
| 3 | **3.27 VirtualizaciÃ¢â€Å“Ã¢â€â€šn** | `VirtualTable` se alimenta de datos ya cacheados por RQ (3.26); usa print CSS 
establecido. | 3.26 |
| 4 | **3.28 Partir monolitos** | Aprovecha `Modal` (3.25), hooks RQ (3.26) y `VirtualTable` (3.27) al extraer 
subcomponentes; el mÃ¢â€Å“ÃƒÂ­s costoso y de mayor superficie. | 3.25, 3.26, 3.27 |

**SecuenciaciÃ¢â€Å“Ã¢â€â€šn pragmÃ¢â€Å“ÃƒÂ­tica:** 3.25 y el *setup* de 3.26 (provider + keys) pueden ir en paralelo (archivos 
disjuntos). 3.27 empieza cuando Expedientes ya use RQ. 3.28 arranca por `TransferLiquidationPanel` en cuanto exista 
`ui/Modal.jsx`.

**Un objetivo grande por Ãƒâ€Ãƒâ€¡Ã‚Â£editorÃƒâ€Ãƒâ€¡ÃƒËœ a la vez.** Nunca dos personas/agentes tocando el mismo monolito (polÃ¢â€Å“Ã‚Â¡tica 
single-editor ya vigente en el repo).

---

## Riesgos transversales

1. **Sin TypeScript:** los contratos de datos son implÃ¢â€Å“Ã‚Â¡citos. MitigaciÃ¢â€Å“Ã¢â€â€šn: JSDoc en hooks nuevos (`@returns`), 
normalizaciÃ¢â€Å“Ã¢â€â€šn de shape (`Array.isArray(x)?x:x?.results||[]`) en TODA `queryFn`/loader, y tests de mÃ¢â€Å“Ã¢â€â€šdulos puros 
(`*.logic.js`, `queryKeys`) que son la red de seguridad principal dado el harness `node --test`.
2. **Harness de test limitado a `src/lib`:** hoy `run.sh` solo bundlea `src/lib/*`. MitigaciÃ¢â€Å“Ã¢â€â€šn: colocar la **lÃ¢â€Å“Ã¢â€â€šgica 
testeable en `src/lib/**` o en `*.logic.js`** importables como ESM puro; aÃ¢â€Å“Ã¢â€“â€™adir esos entrypoints a `run.sh` o testear 
como mÃ¢â€Å“Ã¢â€â€šdulo directo (`node --test tests/x.test.mjs`) sin esbuild cuando no usen `import.meta.env`.
3. **`app.css` monolÃ¢â€Å“Ã‚Â¡tico (302 KB):** cada frente aÃ¢â€Å“Ã¢â€“â€™ade clases ahÃ¢â€Å“Ã‚Â¡. Riesgo de colisiÃ¢â€Å“Ã¢â€â€šn de nombres. MitigaciÃ¢â€Å“Ã¢â€â€šn: 
prefijos `mwt-` estrictos (`.mwt-modal`, `.mwt-vtable`, `.mwt-field`) y bloque `@media print` centralizado.
4. **Higiene de sesiÃ¢â€Å“Ã¢â€â€šn (R3):** cualquier nueva cachÃ¢â€Å“Ã‚Â® (React Query) debe purgarse en logout igual que `swrCache` 
(`window "mwt-auth-logout"` Ãƒâ€ÃƒÂ¥Ãƒâ€  `queryClient.clear()`). No filtrar datos entre usuarios en la misma mÃ¢â€Å“ÃƒÂ­quina.
5. **AbortSignal / doble cancelaciÃ¢â€Å“Ã¢â€â€šn:** `apiFetch` ya ata GETs al controlador global; al integrar RQ/virtualizaciÃ¢â€Å“Ã¢â€â€šn 
pasar el `signal` de RQ y no combinarlo con el global.
6. **RegresiÃ¢â€Å“Ã¢â€â€šn de impresiÃ¢â€Å“Ã¢â€â€šn:** proformas/facturas/tablas se imprimen. Todo cambio de tabla/modal debe verificar 
`@media print` (modales ocultos, tablas completas, `tabular-nums`).
7. **TamaÃ¢â€Å“Ã¢â€“â€™o de bundle / chunks:** cada dependencia nueva (react-query, react-virtual) va a su `manualChunk` para no 
invalidar el bundle de app ni el de vendor react.
8. **framer-motion vs virtualizaciÃ¢â€Å“Ã¢â€â€šn/foco:** animaciones dentro de listas virtuales o al abrir modales pueden romper 
mediciÃ¢â€Å“Ã¢â€â€šn de altura o foco inicial; animar a nivel contenedor, no de fila, y aplicar foco en `useEffect`.
9. **Constantes SYNC-cruzadas** (`PRONTO_PAGO_TIERS` en 3 archivos + backend `proforma_renderer`): no unificar en esta 
ola; conservar comentarios `// SYNC`.
10. **Rollback:** cada paso es un commit atÃ¢â€Å“Ã¢â€â€šmico que deja el Ã¢â€Å“ÃƒÂ­rbol verde (`build` + `tests`). Ante fallo, `git 
revert` del commit puntual sin arrastrar el resto de la ola.

### Checklist de Ãƒâ€Ãƒâ€¡Ã‚Â£Definition of DoneÃƒâ€Ãƒâ€¡ÃƒËœ por frente
- [ ] `npm run build` verde (sin warnings nuevos de chunk > 900 KB).
- [ ] `bash tests/run.sh` verde + tests nuevos del frente verdes.
- [ ] Smoke manual del flujo afectado (incluye `Ctrl+P` donde haya tablas/modales).
- [ ] Sin regresiÃ¢â€Å“Ã¢â€â€šn visual (markup visual intacto; solo ARIA/estructura).
- [ ] Nuevas cachÃ¢â€Å“Ã‚Â®s purgadas en logout.
- [ ] Commit atÃ¢â€Å“Ã¢â€â€šmico + nota de quÃ¢â€Å“Ã‚Â® se puede revertir aislado.
---FIN-PLAN---
tokens used
112,399
He leÃ¢â€Å“Ã‚Â¡do el repo directamente (la CLI `graphify query` la bloquea el sandbox, pero el grafo existente + lectura de archivos me dio todo el contexto). VerifiquÃ¢â€Å“Ã‚Â®: `api.js` (apiFetch L208, `resource()` L502, APIs por dominio), `swrCache.js`, el patrÃ¢â€Å“Ã¢â€â€šn de hooks (`useTransfersData`), el N+1 real en `Expedientes.jsx` (~L222, `clientesApi.get` por cada client_id Ã¢â€Å“Ã¢â€¢â€˜nico), `App.jsx` (lazy+Suspense ya hecho), el harness de tests (esbuild + `node --test`), los primitives de `ui/`, un modal real sin `role="dialog"` ni Escape, y la estructura de los monolitos. No modifiquÃ¢â€Å“Ã‚Â® ningÃ¢â€Å“Ã¢â€¢â€˜n archivo. AquÃ¢â€Å“Ã‚Â¡ estÃ¢â€Å“ÃƒÂ­ el plan completo:

---INICIO-PLAN---
# Plan de EjecuciÃ¢â€Å“Ã¢â€â€šn Ãƒâ€Ãƒâ€¡ÃƒÂ¶ Ola 3 (frentes 3.25 Ãƒâ€ÃƒÂ¥Ãƒâ€  3.28)
**Proyecto:** MWT.ONE Ã¢â€Â¬Ãƒâ‚¬ `frontend/` (React 18.3.1 + Vite 5.4.8, JSX sin TS, React Router 6.26, framer-motion 11, xlsx 0.18)
**Autor del plan:** Fugu (arquitecto senior) Ã¢â€Â¬Ãƒâ‚¬ **Fecha:** 2026-08-09
**Alcance:** 4 frentes pendientes de la Ola 3. Fetch centralizado en `src/lib/api.js` (`apiFetch` + factory `resource()` + APIs por dominio). CachÃ¢â€Å“Ã‚Â® SWR casera en `src/lib/swrCache.js`. Ya hecho: `React.lazy` por ruta + `<Suspense>` en `App.jsx`, `manualChunks` (react/xlsx/motion) y `sourcemap:"hidden"` en `vite.config.js`.

> **Regla de oro para toda la Ola 3:** un archivo grande = un solo editor a la vez (polÃ¢â€Å“Ã‚Â¡tica ya adoptada para `server.py`, se aplica aquÃ¢â€Å“Ã‚Â¡ a los monolitos). Nada de big-bang. Cada paso deja el Ã¢â€Å“ÃƒÂ­rbol **verde** (`build` + `bash tests/run.sh`).

---

