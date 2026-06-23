# Codex Execution Log — Componentes 1, 2 y 3

Fecha: 2026-06-23  
Modo: Orquestador Fugu con coordinación virtual de roles **Orquestador / Desarrollador / Auditor / QA**.

## Resumen de coordinación

- **Orquestador:** leyó el plan, secuenció Componentes 1 → 2 → 3, integró cambios y preparó verificaciones.
- **Desarrollador (agente virtual):** revisó Componente 1; priorizó `apiFetch`, `resource.action/select`, hooks de selects y borrado seguro en liquidación.
- **Auditor (agente virtual):** revisó Componente 2; priorizó `client_*`, guards positivos CEO/Admin, rutas frontend y traceback seguro.
- **QA (agente virtual):** revisó Componente 3; priorizó side effects en render, cancelación real, `reload` seguro y memoización de Command Palette.

---

## Componente 1 — Cliente API y Adaptadores Frontend

### `frontend/src/lib/api.js`

**Cambios aplicados**
- [x] `apiFetch` ya no retorna una promesa pendiente al abortar GETs globales; ahora propaga `AbortError` controlado.
- [x] `resource(name).action` acepta params de query en forma segura:
  - `action("select", { q: "..." })` → `/resource/select/?q=...`
  - `action("foo", id, undefined, { params, signal })` → `/resource/id/foo/?...`
- [x] `resource(name).select(selectName, params, opts)` acepta query params y `AbortSignal`.
- [x] `aiChatApi.selectAgents/selectSkills/selectInstructions` reenvían params al endpoint.
- [x] `analyticsApi.*` acepta `opts` para pasar `signal` desde `useDashboardKpis`.

**Checklist de calidad**
- [x] Evita URL malformada con slash dentro del query param.
- [x] AbortError queda manejable por hooks invocadores.
- [x] Se mantiene compatibilidad con acciones POST existentes.
- [x] RBAC no depende de estos helpers, pero no se omiten tokens.

### `frontend/src/hooks/useProductoSelects.js`

**Cambios aplicados**
- [x] `loadSubcategorias` usa `productosApi.select("subcategorias", { categoria })`.
- [x] `load` y `loadSubcategorias` aceptan `opts.signal`.
- [x] Se agregó `AbortController` en `useEffect`.
- [x] Se ignora `AbortError` sin marcar error de UI.

**Checklist**
- [x] Query params correctos.
- [x] Sin loaders colgados por abort global.
- [x] Sin setState tras abort explícito.

### `frontend/src/hooks/useInventarioSelects.js`

**Cambios aplicados**
- [x] `loadMotivos` usa `movimientosApi.select("motivos", { tipo_mov })`.
- [x] `load` y `loadMotivos` aceptan `opts.signal`.
- [x] Se agregó `AbortController` en `useEffect`.
- [x] Se ignora `AbortError`.

**Checklist**
- [x] Query params correctos para motivos.
- [x] Sin slash final dentro de `tipo_mov`.
- [x] Cancelación explícita en desmontaje.

### `frontend/src/components/transfers/TransferLiquidationPanel.jsx`

**Cambios aplicados**
- [x] `confirmRemoveCost()` reemplazó `fetch()` nativo por `transferDetailApi.removeCost(...)`.
- [x] La fila se elimina visualmente solo después de éxito del backend.
- [x] Errores HTTP se muestran usando `e.body.detail || e.message`.
- [x] `AbortError` se ignora como cancelación controlada.
- [x] Se dispara `onLiquidated?.()` para re-sincronizar totales del padre.

**Checklist**
- [x] No hay borrado visual si servidor responde 403/404/500.
- [x] Se usa capa API central con token y errores normalizados.
- [x] Se evita inconsistencia local vs backend.

---

## Componente 2 — Seguridad y RBAC

### `backend/apps/core/permissions.py`

**Cambios aplicados**
- [x] Se agregaron helpers centralizados: `normalize_role`, `is_client_role`, `is_ceo_or_admin_role`, `user_is_ceo_or_admin`.
- [x] Se agregó permiso DRF positivo `IsCeoOrAdmin`.

**Checklist**
- [x] `client_*` se clasifica como cliente.
- [x] CEO/Admin es allowlist explícita: `superadmin`, `admin`, `ceo`.
- [x] Reutilizable por AI Hub y analytics.

### `backend/apps/core/jwt_auth.py`

**Cambios aplicados**
- [x] `MwtUser.role` se normaliza a lowercase/strip.
- [x] `MwtUser` expone flags `is_client` e `is_ceo_admin`.
- [x] Warning de `CLIENT sin legal_entity_ids` usa helper `is_client_role`, cubriendo `client_*`.

**Checklist**
- [x] Backend reconoce `client_distributor`, `client_retail`, etc. como cliente.
- [x] Se reduce duplicación de heurísticas de roles.

### `frontend/src/context/RoleContext.jsx`

**Cambios aplicados**
- [x] `deriveBaseViewport` usa `isClientBackendRole`, que cubre `role.startsWith("client_")`.
- [x] Se agregó `isCeoAdmin` al contexto.
- [x] `can(capability)` para capacidades CEO-only usa rol real CEO/Admin, no solo viewport `ADMIN`.
- [x] Se agregó módulo `ai` a `CLIENT_ALLOWED_MODULES` para alinear comentarios/rutas.

**Checklist**
- [x] `client_*` no obtiene viewport `ADMIN` por error.
- [x] Capacidades CEO-only no se habilitan por ser staff interno no privilegiado.
- [x] El frontend oculta UI; backend mantiene defensa real.

### `backend/apps/ai_hub/views.py`

**Cambios aplicados**
- [x] `_is_client_role` usa helper central con soporte `client_*`.
- [x] Gobernanza AI (`AiAgentViewSet`, `AiSkillViewSet`, `AiInstructionViewSet`) usa permiso positivo `IsCeoOrAdmin`.
- [x] `initial()` de gobernanza aplica `_ensure_ai_governance_allowed` con logging y 403.
- [x] `AiUsageLogViewSet` queda CEO/Admin-only.

**Checklist**
- [x] Clientes y roles internos no CEO/Admin no acceden a catálogos de gobernanza.
- [x] Usage logs/tokens/costos AI no quedan visibles a clientes.
- [x] Defensa backend independiente del guard del frontend.

### `backend/apps/ai_hub/chat_views.py`

**Cambio complementario aplicado**
- [x] Detección de cliente en `ChatSendView` usa `is_client_role`, cubriendo `client_*`.

### `backend/apps/analytics/views.py`

**Cambios aplicados**
- [x] Se agregó `_deny_unless_ceo_admin` usando `user_is_ceo_or_admin`.
- [x] Se protegió `margen_marcas`.
- [x] Se protegió `top_skus_margen`.
- [x] Se protegió `expediente_margin_scatter`.
- [x] Se protegió `_diag`.

**Checklist**
- [x] Márgenes/costos/scatter no se exponen a clientes ni staff no privilegiado.
- [x] Diagnóstico SQL `_diag` requiere CEO/Admin.

### `frontend/src/App.jsx`

**Cambios aplicados**
- [x] Se agregó `InternalOnlyRoute` para excluir clientes de vistas internas.
- [x] Se agregó `CeoAdminOnlyRoute` para rutas sensibles.
- [x] Rutas CEO/Admin-only protegidas: `/portal/diag`, `/finanzas`, `/ai/governance`, `/usuarios`, `/roles`, `/historial-precios`, motor de precios cliente-marca.
- [x] Rutas internas operativas protegidas para clientes: inventario, transferencias, nodos, clientes, marcas, productos internos, tallas, NCM, proveedores, templates, notificaciones, cobros.

**Checklist**
- [x] Cliente real `client_*` no navega por URL a pantallas internas.
- [x] Gobernanza y finanzas no dependen de viewport visual.
- [x] Separación frontend: cliente vs interno vs CEO/Admin.

### `backend/apps/core/json_error_middleware.py`

**Cambios aplicados**
- [x] Traceback default seguro: `MWT_DEBUG_500` default `0`.
- [x] Traceback solo se incluye si `MWT_DEBUG_500=1` y `settings.DEBUG=True`.
- [x] Respuesta pública usa `error_type`, no `str(exception)`.
- [x] Query params solo se devuelven en debug y con redacción de claves sensibles.

**Checklist**
- [x] No se filtra traceback por default.
- [x] No se filtra texto crudo de excepción en producción.
- [x] Query params sensibles como token/key/password quedan redactados.

### `backend/apps/roles/permissions.py`

**Cambio complementario aplicado**
- [x] `is_client(user)` reconoce `client_*`.

---

## Componente 3 — Rendimiento y Bucles de Renderizado

### `frontend/src/components/layout/AppLayout.jsx`

**Cambios aplicados**
- [x] `abortInflightGets()` se movió fuera del cuerpo de render.
- [x] Ahora se ejecuta en `useLayoutEffect` dependiente solo de `location.pathname`.

**Checklist**
- [x] No hay side effects durante render.
- [x] Al navegar, se cancelan GETs previos antes de efectos normales de pantallas hijas.
- [x] Se reduce riesgo en React Strict/Concurrent.

### `frontend/src/hooks/useDashboardKpis.js`

**Cambios aplicados**
- [x] Importa `useRole` y no dispara analytics admin si `isAdmin` es falso.
- [x] Usa `AbortController` propio por carga.
- [x] Aborta la carga anterior al hacer reload nuevo.
- [x] Usa `requestIdRef` para evitar carreras de respuestas antiguas.
- [x] `reload` es wrapper sin argumentos, evitando el bug `isAlive is not a function` al usarlo en `onClick`.
- [x] Los `.catch` parciales re-lanzan `AbortError` y solo convierten errores reales de widget a vacío.

**Checklist**
- [x] Cliente no dispara endpoints CEO/Admin de analytics desde el hook.
- [x] No hay promesas colgadas por abort global.
- [x] Múltiples reloads rápidos no pisan estado con respuestas antiguas.
- [x] Abort no se convierte en widgets vacíos falsos.

### `frontend/src/components/CommandPalette.jsx`

**Cambios aplicados**
- [x] `filtered` se memoiza con `useMemo`.
- [x] `grouped` se memoiza con `useMemo`.
- [x] `active` se clampa cuando cambia `filtered.length`.

**Checklist**
- [x] Menos churn de listener por arrays reconstruidos innecesariamente.
- [x] `Enter` no queda apuntando a índice fuera de rango tras filtrar.
- [x] Búsqueda role-aware se mantiene.

---

## Verificación ejecutada

Pendiente de completar en esta misma ejecución:
- [ ] Parse AST Python.
- [ ] Build frontend.
- [ ] Pruebas backend disponibles.

EOF

## Verificación final ejecutada

- [x] `python -c "import ast; ..."` sobre archivos backend modificados: **OK**.
- [x] `cd frontend && npm run build`: **OK**.
  - Nota QA: Vite mantiene warning de chunk grande (`assets/index-Do5gYIPB.js` ≈ 2.94 MB / gzip ≈ 817 KB), ya existente como riesgo de optimización/codesplitting.
- [x] `python backend/manage.py test` con Python global: **falló por entorno** (`ModuleNotFoundError: No module named 'django'`).
- [x] `backend\.venv\Scripts\python.exe backend\manage.py test`: **OK**, system check sin issues, 0 tests descubiertos.

## Estado final

- [x] Componentes 1, 2 y 3 implementados.
- [x] Build frontend exitoso.
- [x] Sintaxis Python validada.
- [x] Prueba Django ejecutada con el venv disponible; no hay tests descubiertos por Django en este entorno.
- [x] RBAC reforzado para `client_*`, rutas internas, gobernanza AI, analytics sensibles y tracebacks.
- [x] Render loops/side effects reducidos y cancelación de requests fortalecida.
