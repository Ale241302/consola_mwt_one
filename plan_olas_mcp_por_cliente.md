# Plan de Olas — MCP por Cliente (aislamiento multi-tenant)

**Proyecto:** consola_mwt_one (MWT.ONE)
**Documento:** `plan_olas_mcp_por_cliente.md`
**Fecha:** 2026-08-17
**Base:** `investigacion_mcp_por_cliente.md` (auditoría + arquitectura) + estado real verificado en producción.

---

## 0. Decisión de arquitectura (confirmada con el CEO)

**Un solo contenedor MCP compartido** (NO un contenedor por cliente).

- Ya existe `consola-mwt-one-mcp` healthy en producción.
- El aislamiento real de datos lo garantiza el **backend** filtrando por `client_id`
  (igual que hace el portal), NO el contenedor.
- "La puerta tiene llave" (Authentik) vs "la caja fuerte tiene combinación"
  (backend). La caja fuerte es lo que importa.
- Implica: una **Application por cliente en Authentik** (cada una con su
  Client ID/Secret), un **virtual server por cliente en ContextForge** (cada una
  con su URL `https://mcp.mwt.one/servers/<vsid>/mcp`), y el **mismo contenedor
  MCP** atendiendo a todos, con `MWT_MCP_CLIENT_ID` resuelto por request
  (header del gateway) o por virtual server.

---

## Ola 1 — Backend: aislamiento por cliente (LA CAJA FUERTE)

**Objetivo:** ningún usuario puede ver datos de un cliente que no es suyo, ni
siquiera por un bug de queryset. Todo pasa por `client_id`.

### 1.1 `get_user` respeta el claim `legal_entity_ids` del JWT del MCP
`backend/apps/core/jwt_auth.py:180-321`
- Hoy `MwtJWTAuthentication.get_user` ignora el claim `legal_entity_ids` del
  token y rehidrata el scope desde `users.mwtuser` por email (`jwt_auth.py:248-290`).
- Cambio: si el token trae `legal_entity_ids` (claim del JWT emitido por
  `McpTokenView`), usarlos como fuente canónica del scope, **sin** rehidratar
  por email. Si viene vacío pero el claim existe (`[]`), scope = `[]` (fail-closed).
- Fallback a la rehidratación por email SOLO si el token no trae el claim.
- Verificar en el mismo lookup `Cliente.is_active=True AND estado='ACTIVO'`
  para los ids del claim; si el cliente está inactivo → `AuthenticationFailed`.

### 1.2 Guard anti-bypass (un admin por app de cliente solo ve SU cliente)
`backend/apps/core/scoped_querysets.py:51`
- Hoy `BYPASS_ROLES = ("superadmin", "admin")` ignora el scope y un admin
  conectado por el MCP de Sondel vería TODOS los clientes (P0-6).
- Cambio: `filter_by_user_clients` y `_scope_ids` reciben `request.auth`
  (claims). Si el token trae `legal_entity_ids` (modo MCP), el bypass NO aplica:
  el scope queda fijado a esos ids aunque el rol sea admin/superadmin.
- `filter_by_user_clients_sql` idem.
- `is_bypass(user)` → nueva firma `is_bypass(user, bypass_roles, forced_scope=None)`.

### 1.3 Mint verifica estado del cliente (desactivar corta acceso)
`backend/apps/core/auth_views.py:777-856`
- En `McpTokenView.post`, tras intersectar `user_legal_ids & service_legal_ids`
  (`auth_views.py:826-829`):
  - Si el ServiceToken tiene `client_ids` → validar que cada uno corresponda a
    un `Cliente` con `is_active=True AND estado='ACTIVO'`. Si alguno está
    inactivo → 403 `CLIENTE_INACTIVO`.
  - Emitir claim `tenant_id` = cliente quemado cuando haya un solo cliente, y
    `legal_entity_ids` = intersección resultante.

### 1.4 Cerrar brechas de scoping P0 (transfers, commercial, clientes)

| Brecha | Archivo | Cambio |
|---|---|---|
| B-BE-1 transfers | `backend/apps/transfers/views.py:280-317, 1312` | Aplicar `filter_by_user_clients` en `list`/`retrieve` (client_field vía join a expedientes/cliente). Exponer 403/vacío cross-cliente. |
| B-BE-2 commercial | `backend/apps/commercial/views.py:115-126, 351-362, 384-392, 468-473` | Validar `?client_id=` contra `_scope_ids(request)`; fuera de scope → 403 o filtro ignorado. |
| B-BE-3 clientes | `backend/apps/clientes/views.py:232-237, 251-260, 263-269, 274+` | `retrieve/update/destroy/subsidiarias`: verificar que `pk` ∈ scope del usuario (no-bypass). |
| B-BE-4 unificar scope | `backend/apps/clientes/views.py:32-54` | `_client_scope_ids` debe leer `request.auth` (claims MCP) y respetar el guard anti-bypass de 1.2. |

### 1.5 Tabla `core.mcp_app` + ServiceToken por cliente
- Nueva migración SQL numerada (`backend/sql/9x_mcp_app.sql`): tabla
  `core.mcp_app(id, cliente_id UNIQUE, slug, nombre, authentik_application_uid,
  authentik_provider_pk, oauth_client_id, oauth_client_secret, mcp_url,
  service_token_id, estado, created_at, updated_at)`.
- Modelo `managed=False` en `backend/apps/core/models.py`.
- Emitir ServiceToken por cliente: `manage.py mint_mcp_token --name mcp-<slug>
  --client-ids <uuid>` (ya soportado, `mint_mcp_token.py:14`).

### 1.6 Tests backend
`backend/tests/` — casos:
(a) JWT con `tenant_id` ajeno al usuario → 403;
(b) cliente desactivado → 401 en cualquier endpoint;
(c) transfers/commercial devuelven vacío/403 cross-cliente;
(d) admin con scope MCP quemado solo ve ese tenant.

**Criterio de aceptación:** la suite de tests pasa; el contenedor MCP + API
siguen respondiendo 200 en producción tras el deploy.

---

## Ola 2 — MCP server: modo cliente quemado

**Objetivo:** el MCP rechaza la conexión si la identidad propagada no pertenece
al cliente de la app, y no se fuga por caché. En el modelo de **contenedor
compartido**, el "cliente quemado" se resuelve **por request** (header del
gateway según el virtual server), con un fallback por env para despliegues
dedicados.

> **Cliente piloto (confirmado por el CEO):** Sondel S.A. — UUID
> `c588c410-468a-4d54-b676-3bec174eb39d`. Los usuarios de prueba en producción:
> `logistica2@sondelsa.com` (Allan Ramírez) y `compras2@sondelsa.com`
> (Stephanie Guerrero), ambos `client_b2b` con `legal_entity_ids =
> ["c588c410-468a-4d54-b676-3bec174eb39d"]`. El resto de clientes (Comtek
> `88888888-…010`, Sonepar `88888888-…011`, Muito Work `5525986c-…`, etc.) se
> mapean después con el mismo mecanismo.

### 2.1 Resolución del cliente por request (core del diseño)

El contenedor compartido atiende N clientes. El cliente activo de cada request
se determina así, en orden de precedencia:

1. **Header `X-MWT-Client-ID`** (inyectado por ContextForge según el virtual
   server, Ola 5) — forma preferida en producción multi-cliente.
2. **Env `MWT_MCP_CLIENT_ID`** (UUID quemado por despliegue) — para modo
   dedicado / stdio / testing unitario.
3. **Ninguno** → modo global/admin (ServiceToken, app `mcp-admin`).

Este "cliente resuelto" se guarda en un **contextvar** (`identity.py`, igual que
la identidad) y lo consumen `jwt_minter`, `enrich`, `tool_rbac` y las tools.

### 2.2 Nuevas vars de entorno
`mcp_server/mwt_mcp/config.py`
- `MWT_MCP_CLIENT_ID` — UUID del cliente de este despliegue (vacío = global/admin).
  Para el piloto Sondel: `c588c410-468a-4d54-b676-3bec174eb39d`.
- `MWT_MCP_CLIENT_NAME` — nombre legible ("Sondel S.A.") para errores
  `TENANT_MISMATCH` accionables.
- `MWT_MCP_GATEWAY_KEY` — secreto compartido gateway→MCP para validación inbound.
- `MWT_MCP_REQUIRE_CLIENT_HEADER` (bool, default off) — en producción multi-cliente
  se activa: exige `X-MWT-Client-ID` en todo request con identidad (fail-closed).

### 2.3 Captura del cliente en el middleware ASGI
`mcp_server/mwt_mcp/asgi_middleware.py:21-39`
- Leer `X-MWT-Client-ID` y `X-MWT-Gateway-Key` junto a `X-Forwarded-User-*`.
- Validar el gateway key ANTES de honrar la identidad:
  - `MWT_MCP_GATEWAY_KEY` definido + header ausente/no coincide → **no** setear
    identidad (cae a ServiceToken) o 401 (configurable).
  - Si `MWT_MCP_REQUIRE_CLIENT_HEADER=1` y no viene `X-MWT-Client-ID` → 401
    `CLIENT_HEADER_REQUIRED` (un contenedor compartido sin cliente no debe
    operar multi-tenant).
- Guardar cliente resuelto + identidad en el contextvar.

### 2.4 Doble verificación en el mint
`mcp_server/mwt_mcp/jwt_minter.py`
- En `_mint_and_cache` (`jwt_minter.py:151-171`): tras recibir `user` del
  backend:
  - `client = resolved_client()` (contextvar, 2.1).
  - Si `client` definido y `client ∉ set(user["legal_entity_ids"])` →
    `IdentityMintingError` con detail `TENANT_MISMATCH` y mención del
    `MWT_MCP_CLIENT_NAME` (fail-closed existente, `jwt_minter.py:160-165`).
    Ej. "Esta aplicación MCP está restringida a Sondel S.A. y tu usuario no está
    asociado a esa empresa."
  - Si el perfil viene sin `legal_entity_ids` y hay cliente quemado →
    `TENANT_SCOPE_VACIO` (misma excepción).
- La verificación se hace SIEMPRE, incluso si el rol es admin/superadmin
  (cierra el caso "admin entra por app de cliente", ver 2.5).
- Nueva función de testabilidad: `verify_tenant(identity_user) -> None | str`.

### 2.5 Guard anti-bypass admin
`mcp_server/mwt_mcp/jwt_minter.py` / `tool_rbac.py`
- Si `client` resuelto y rol ∈ `{admin, superadmin, ceo}`:
  - El mint NO falla (el usuario SÍ pertenece al cliente, p. ej. MWT opera
    Sondel), pero el backend (Ola 1 · 1.2) fuerza el scope al cliente.
  - En el MCP: ocultar del `list_tools` las tools internas globales
    (`mwt_diag_scope`, `mwt_audit_write_registry`) cuando hay cliente resuelto;
    el usuario admin conectado a una app de cliente opera como ese cliente.

### 2.6 El mint envía el cliente al backend
`mcp_server/mwt_mcp/jwt_minter.py:120-148`
- `_mint_from_backend`: añadir `client_id` al body del `POST /auth/mcp-token/`
  cuando haya cliente resuelto. El backend (Ola 1 · 1.3) lo intersecta con el
  ServiceToken y emite `tenant_id` + `legal_entity_ids` acotados.
- Esto hace que la intersección `usuario ∩ ServiceToken.client_ids` ya no sea
  un no-op (los ServiceTokens de producción hoy no tienen `client_ids`).

### 2.7 Namespacing de caché por (usuario + cliente)
`mcp_server/mwt_mcp/enrich.py:29-63`
- `_client_cache` global → cache keyed por `f"{email}|{client_id}"` con TTL.
  Dos usuarios de clientes distintos NUNCA comparten nombres enriquecidos.
- `user_client_ids()` pasa a filtrar por el cliente resuelto.

### 2.8 TTL de token reducido en apps de cliente
`mcp_server/mwt_mcp/jwt_minter.py:41-45`
- Si hay cliente resuelto → `_TOKEN_TTL_SECONDS = 10 * 60` (acota revocación a
  ≤10 min). En modo global/admin se mantiene 45 min.

### 2.9 Piloto Sondel — despliegue del modo cliente
Para probar en producción SIN romper el global:

1. **No** se setea `MWT_MCP_CLIENT_ID` en el contenedor compartido (sigue
   global). Se activa el camino por header `X-MWT-Client-ID`.
2. Se registra el virtual server de Sondel en ContextForge (Ola 5) que inyecta
   `X-MWT-Client-ID: c588c410-468a-4d54-b676-3bec174eb39d` y
   `X-MWT-Gateway-Key: <secreto>`.
3. Se emite ServiceToken scopeado: `manage.py mint_mcp_token --name mcp-sondel
   --client-ids c588c410-468a-4d54-b676-3bec174eb39d --expires-days 30` y se
   documenta en el `.env.mcp` (Ola 0 · 0.4).
4. Prueba con `logistica2@sondelsa.com`: `mwt_whoami` muestra rol `client_b2b`
   y `legal_entity_ids=["c588c410-…"]`; `expediente_listar` solo trae Sondel.
5. Prueba negativa: usuario de Comtek (`comunicaciones@comtek.la`, si existiera
   en Authentik) → `TENANT_MISMATCH` en el mint.

### 2.10 Tests MCP (Ola 2)
`mcp_server/tests/` — casos nuevos:
- `test_tenant_verify_ok_sondel`: user con `legal_entity_ids` incluye
  `c588c410-…` → mint OK.
- `test_tenant_verify_mismatch`: user sin `c588c410-…` → `IdentityMintingError`
  con `TENANT_MISMATCH`.
- `test_tenant_scope_vacio`: user sin `legal_entity_ids` + cliente quemado →
  `TENANT_SCOPE_VACIO`.
- `test_gateway_key_ausente`: request sin `X-MWT-Gateway-Key` → identidad
  ignorada (mode ServiceToken) o 401.
- `test_client_header_requerido`: `MWT_MCP_REQUIRE_CLIENT_HEADER=1` sin header
  → 401.
- `test_admin_degradado_en_app_cliente`: admin en app de cliente → mint OK pero
  `list_tools` sin `mwt_diag_scope`.
- `test_enrich_no_contamina_cross_tenant`: dos usuarios de clientes distintos →
  caché separada.
- `test_mint_envia_client_id`: el body del `POST /auth/mcp-token/` incluye
  `client_id`.

**Criterio de aceptación:** suite MCP verde (116 actuales + los nuevos); en
producción `whoami` con identidad de otro cliente da `TENANT_MISMATCH` y NUNCA
datos; `logistica2@sondelsa.com` en el vsid de Sondel solo ve Sondel.

---

## Ola 3 — Authentik: apps por cliente (LA LLAVE)

**Objetivo:** crear/editar/eliminar un Cliente en la consola crea/edita/elimina
su Application en Authentik, con Client ID/Secret propios.

### 3.1 Sync de grupos consola→Authentik
`backend/apps/users/authentik_sync.py`
- Nueva función `sync_groups(email, legal_entity_ids)`:
  - Crear/obtener grupo `mcp-cliente-<slug>` (slug por razon_social) en Authentik
    (`POST /core/groups/`).
  - `POST /core/groups/<pk>/add_user/` para cada usuario vinculado.
  - Remover al usuario de grupos de clientes que ya no tiene.
- Llamarla desde `backend/apps/users/views.py` en toda mutación de
  `legal_entity_ids` y desde `ensure_user`.

### 3.2 Servicio de provisionamiento
Nuevo módulo `backend/apps/clientes/authentik_provisioning.py`
- `provision_mcp_app(cliente)` → vía Admin API de Authentik:
  1. Grupo `mcp-cliente-<slug>` (+ binding de la app en Fase 3.4).
  2. Scope Mapping `mwt-cliente-<slug>` (Property Mapping tipo Scope Mapping),
     scope `mwt-cliente`, expresión estática:
     `return {"cliente_id": "<uuid>", "mwt_cliente_slug": "<slug>"}`.
  3. Provider OAuth2 `mcp-provider-<slug>`: redirect STRICT
     `https://claude.ai/api/mcp/auth_callback`, scopes `openid email profile`
     + mapping, `access_token_validity=minutes=10`, `refresh_token_validity=days=30`.
  4. Application `mcp-<slug>` con binding de grupo `mcp-cliente-<slug>`.
- Persistir `oauth_client_id` / `oauth_client_secret` / UIDs en `core.mcp_app`
  (1.5).
- `deprovision_mcp_app(cliente)` → revoca refresh tokens, deshabilita o borra.
- `regenerate_secret(cliente)` → rota client_secret vía Admin API.

### 3.3 App ADMIN global
- Application `mcp-admin` + provider `mcp-provider-admin`, grupo `mwt-internal`,
  scope mapping `{"cliente_id": "*", "mwt_admin": true}`. Sin cliente quemado.

### 3.4 Kill-switch al desactivar cliente
`backend/apps/clientes/views.py:263-269`
- En `destroy()` y en cualquier mutación de `estado` → tarea Celery que:
  1. Deshabilita Application `mcp-<slug>` (PATCH Admin API).
  2. Revoca refresh tokens del provider (`DELETE /oauth2/refresh_tokens/<id>/`).
  3. Remueve el UUID de `users.mwtuser.legal_entity_ids` de todos los usuarios.
  4. Revoca ServiceToken del cliente (`core.service_token`).
- Acceso residual ≤ 10 min por los access tokens ya emitidos.

### 3.5 Blueprint versionado
`mcp-gateway/blueprints/mcp_app_per_client.yml` — definición idempotente de los
4 objetos, para regenerar manualmente si el estado diverge.

**Criterio de aceptación:** crear un cliente de prueba en la consola dispara sus
4 objetos en Authentik; desactivarlo deshabilita la app y revoca refresh tokens.

---

## Ola 4 — Frontend: credenciales MCP en el cliente

**Objetivo:** al ver/editar un cliente se muestran URL del servidor MCP remoto,
OAuth Client ID y Client Secret.

### 4.1 Backend: endpoint de credenciales MCP
- Nuevo action en `ClienteViewSet`:
  - `GET /api/clientes/{id}/mcp-app/` → `{mcp_url, oauth_client_id,
    oauth_client_secret, estado, slug, created_at}`. CEO/Admin-only
    (permiso `clientes.view` + rol staff).
  - `POST /api/clientes/{id}/mcp-app/provision/` → llama a `provision_mcp_app`.
  - `POST /api/clientes/{id}/mcp-app/regenerate-secret/` → rotación.
  - `POST /api/clientes/{id}/mcp-app/deprovision/` → kill-switch manual.
- Serializer que **nunca** devuelve el secret salvo en acciones explícitas.

### 4.2 UI: ClienteFormView
`frontend/src/pages/ClienteFormView.jsx` — nueva Sección 6 "App MCP"
(CEO-ONLY, `isAdmin`), al editar un cliente existente:
- URL del servidor MCP remoto (read-only, con botón copiar).
- OAuth Client ID (read-only).
- OAuth Client Secret (oculto por defecto, botón revelar/copiar).
- Botones: Crear/Regenerar/Desactivar app.

### 4.3 UI: ClienteDetail
`frontend/src/pages/ClienteDetail.jsx` — bloque "Integración MCP" en el hero o
tab nueva, con los mismos campos (CEO-only).

**Criterio de aceptación:** en `https://consola.mwt.one/clientes/<id>/editar`
se ven las credenciales del cliente; regenerar actualiza el secret.

---

## Ola 5 — ContextForge + nginx: virtual servers por cliente

**Objetivo:** cada cliente tiene su URL `https://mcp.mwt.one/servers/<vsid>/mcp`
y un token de la app A no sirve en la app B.

### 5.1 Verificación previa
Comprobar si la versión de ContextForge desplegada soporta OAuth/DCR por
virtual server. Si no → Plan B nginx (5.3).

### 5.2 Generalizar patches v8–v10
`mcp-gateway/patch/contextforge_patch_v*.py`
- Reemplazar los literales `server_id == "1290625df…"` / `gateway_id = "5b0ab59d…"`
  por una tabla de mapeo `MWT_SERVER_MAP` (env): `vsid → (gateway_id, cliente_id)`.
- Añadir los patches v9/v9b/v10 al `entrypoint.sh` (hoy solo aplica v3–v8;
  P0-1: un `--force-recreate` pierde la propagación de identidad).

### 5.3 Patch v11 de enforcement
`mcp-gateway/patch/contextforge_patch_v11.py`
- En el gateway, rechazar si `claims["cliente_id"] != mapeo[vsid]`
  (salvo `mwt_admin=true`). → 401/403.

### 5.4 Registrar virtual servers
- Un virtual server por cliente apuntando al contenedor MCP compartido
  (direct_proxy), con `X-MWT-Client-ID` inyectado según el vsid.
- Re-registrar el catálogo de tools (el catálogo actual tiene 99; el código 125).

### 5.5 nginx
`infra/nginx/` — rutas `mcp.mwt.one/servers/<vsid>/mcp` → contexto correcto;
Plan B: `location = /servers/<vsid>/authorize` forzando `client_id` del provider
del cliente.

**Criterio de aceptación:** cada URL de cliente responde 401 + metadata RFC 9728
con su propio `resource`; token de app A rechazado en vsid de app B.

---

## Ola 6 — Pruebas de aislamiento en producción

Suite adversarial real (de `investigacion_mcp_por_cliente.md` §7):

| # | Prueba | Debe |
|---|---|---|
| 6.1 | Usuario de Comtek autoriza la app de Sondel | Denegado en Authentik |
| 6.2 | Token de app Sondel usado contra vsid Comtek | 401/403 en ContextForge |
| 6.3 | Identidad sin pertenencia llega al MCP | `TENANT_MISMATCH` |
| 6.4 | `expediente_listar?client=<uuid-Sonepar>` como Sondel | `qs.none()` |
| 6.5 | `expediente_obtener(<uuid-Sonepar>)` como Sondel | 403/404 |
| 6.6 | Admin en app de cliente | Degradado a scope del cliente |
| 6.7 | Desactivar Sondel con token vivo | Corte ≤ 10 min |
| 6.8 | Productos/precios/tallas como Sondel | Solo catálogo del cliente |
| 6.9 | Dos usuarios consecutivos: caché enrich | Sin fuga de nombres |
| 6.10 | Token inválido/expirado/aud equivocada | 401 |

**Verificación manual end-to-end (piloto Sondel):**
1. Login en `https://mcp.mwt.one/servers/<vsid-sondel>/mcp` con
   `logistica2@sondelsa.com`.
2. `expediente_listar` → solo expedientes de Sondel (13 activos hoy).
3. `producto_buscar` → catálogo del cliente.
4. Intentar `expediente_obtener` de un EXP de Sonepar → no existe/403.
5. `tipo_cambio`, `documentos` → solo los de Sondel (audience CLIENT/publicados).

**Criterio de aceptación:** todas las pruebas pasan en producción; se entrega
el runbook `docs/runbook_mcp_clientes.md` (alta/baja/rotación/troubleshooting).

---

## Orden de ejecución y deploys

Cada Ola se commitea en `main` con mensaje descriptivo, se hace
`git push origin main` (auto-deploy por `deploy.yml`), y se verifica en
producción antes de pasar a la siguiente.

| Ola | Foco | Deploy | Verificación |
|---|---|---|---|
| 1 | Backend aislamiento | push main → deploy.yml | tests + login API 200 + 6 brechas cerradas |
| 2 | MCP modo cliente | push main → deploy.yml (reconstruye mcp) | suite MCP + `TENANT_MISMATCH` |
| 3 | Authentik apps | push main | crear cliente de prueba → 4 objetos en Authentik |
| 4 | Frontend credenciales | push main | ver credenciales en `/clientes/<id>/editar` |
| 5 | ContextForge/nginx | push main + scripts VPS | URLs por cliente + rechazo cross-app |
| 6 | Pruebas prod | — | suite adversarial + runbook |

---

*Documento de planificación. Requiere validación del CEO por Ola antes de cada
deploy a producción.*
