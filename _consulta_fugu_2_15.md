# Consulta a Fugu (Sakana AI) — Decisión sobre punto 2.15 del plan

Eres `fugu`, autor del plan `auditoria_mwt_mcp_consola_plan_fugu.md` (7-ago-2026).
Un agente ya implementó la Ola 2 (puntos 2.16–2.22) y necesita tu decisión sobre
cómo proceder con el punto **2.15 — Endurecer token exchange y gateway** en PRODUCCIÓN.

## Estado verificado en producción (el agente ya auditó el código desplegado y
## los contenedores reales en el VPS 187.77.218.102):

### Cadena de identidad (implementada y verificada)
1. `backend/apps/core/auth_views.py` → `McpTokenView` (POST /api/auth/mcp-token/):
   - Requiere ServiceToken con scope `mcp:token_exchange` (MwtServiceTokenAuthentication).
   - Lee la identidad propagada (X-Forwarded-User-Email / -Id) o body email/user_id.
   - Busca el usuario real en core.users, valida is_active, y emite AccessToken con:
     `user_uuid`, `email`, `role`, `mcp=true`, `modules` (desde core.roles permissions)
     y `legal_entity_ids` **intersectados** con los del ServiceToken. Lifetime 1h.
2. MCP `mcp_server/mwt_mcp/{config,identity,jwt_minter,asgi_middleware,client}.py`:
   - Middleware ASGI captura X-Forwarded-User-* → contextvar Identity.
   - `get_identity_token()`: si hay identidad → pide token de usuario a
     POST /api/auth/mcp-token/ (backend minting, cache 45 min); si NO hay
     identidad → cae a `MWT_MCP_TOKEN` (fallback).
   - `_auth_headers()`: token que empieza con `eyJ` → `Bearer`; si no, `ServiceToken`.
3. Gateway ContextForge en VPS aplica parches `contextforge_patch_v3..v7` (identidad OAuth,
   propagación, recurso omit/restore, MCP identity fallback) vía `entrypoint.sh`.

### Hallazgo crítico (riesgo del punto #1 del plan)
- El env del contenedor `mcp-gateway-contextforge` (producción) tiene:
  `MWT_MCP_TOKEN=<JWT con role:admin>` HARDCODEADO.
- Como el gateway NO inyecta identidad en todos los casos, el MCP cae a ese token admin
  en fallback → privilegios de administrador implícitos en llamadas sin identidad.
  Es exactamente el riesgo que el plan manda mitigar.

### Hardening pendiente del gateway (verificado en contenedor real)
- `LOG_LEVEL=DEBUG` → debería ser INFO/WARN
- `MCPGATEWAY_ADMIN_API_ENABLED=true` → debería deshabilitarse en producción
- `SECURE_COOKIES=false` → debería ser true
- Backend Django es JWT-only (sin set_cookie en auth_views): cookies seguras del backend
  son de menor impacto; el punto #5 aplica sobre todo al gateway OAuth.

### Incertidumbre detectada: migración Authentik → Pocket-ID incompleta
- `/opt/consola-mwt-one/mcp-gateway/docker-compose.yml` apunta a `pocket-id`, pero el
  runtime REAL en el VPS corre `mcp-gateway-authentik-*` (goauthentik 2025.6.3) — ambos
  coexisten. Existe `docker-compose.yml.bak.authentik`. Estado intermedio frágil.
- El contenedor contextforge fue creado desde ese compose (laabels de compose lo confirman),
  pero el stack autentik sigue corriendo.

## TU DECISIÓN REQUERIDA
Dado que tocar el gateway interrumpe brevemente `mcp.mwt.one` y hay que resolver la
inconsistencia Authentik vs Pocket-ID, responde con UNA recomendación concreta:

**OPCIÓN A** — Hardening completo del gateway en una pasada:
   reemplazar `MWT_MCP_TOKEN` por ServiceToken opaco scopeado
   (manage.py mint_mcp_token --scopes mcp:read,mcp:token_exchange con client_ids
   acotados), `LOG_LEVEL=INFO`, `MCPGATEWAY_ADMIN_API_ENABLED=false`,
   `SECURE_COOKIES=true`, y recrear el contenedor contextforge.

**OPCIÓN B** — Solo reemplazar el token admin por ServiceToken scopeado (lo más
   crítico); dejar cookies/log/admin para ventana dedicada.

**OPCIÓN C** — No tocar el gateway aún; documentar el diagnóstico.

Además aconseja cómo resolver la inconsistencia Authentik→Pocket-ID antes de recrear
los contenedores (¿completar la migración a Pocket-ID primero, o alinear el compose
al stack autentik que corre?, ¿qué riesgos de interrupción de sesiones OAuth activas
acarrea?), y qué scope exacto de ServiceToken recomiendas para el fallback del MCP
(tener en mente que cuando no hay identidad, ese token es la superficie de privilegio).

Devuelve: 1) respuesta a la opción A/B/C con justificación, 2) plan operativo paso a
paso seguro para producción, 3) verificación post-cambio (cómo confirmar que no hay
escalada admin y que el mcp_audit muestra el usuario real).
