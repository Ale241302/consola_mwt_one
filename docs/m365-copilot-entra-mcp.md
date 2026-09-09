# Conexión MCP de MWT.ONE — decisión de cierre (vía principal DeviceToken)

Estado: **CERRADO (opción A)** · la vía activa que respeta roles/tools es **DeviceToken**
(`/device`). El conector de **Authentik** (login de la consola) queda **documentado como
pendiente** porque su filtrado por rol depende del gateway ContextForge.

## ✅ Vía PRINCIPAL (funciona, respeta roles) — DeviceToken / `.json`
- Cómo conecta: el usuario pega el `.json` (o el agente corre `claude mcp add --transport http mcp-... https://mcp.mwt.one/device --header "Authorization: DeviceToken <token>"`).
- El backend **mapea el token → usuario → rol** (`McpTokenView` + `core.roles.permissions`) y **`tool_rbac` filtra** → el usuario ve SOLO las tools de su rol (client_b2b ≈ 23 tools incl. `mwt_whoami`), ocultando las de otros roles.
- Clientes soportados: Claude Code, Gemini CLI, Cursor, VS Code/Copilot, opencode.
- **Claude Desktop (app)**: NO vía DeviceToken (no acepta header). Requiere el conector (ver abajo) → pendiente.

## 🔶 Vía Conector de Claude Desktop / Authentik — PENDIENTE (RBAC del gateway)
- **Qué funciona**: Agnes el conector personalizado con la **URL del MCP server del cliente**
  (`https://mcp.mwt.one/servers/<uuid>/mcp`, dada por la "Integración MCP" de
  `https://consola.mwt.one/clientes/<id>`), "Cliente OAuth → Usa tu propio cliente OAuth" con
  el **client_id/secret** de la app de Authentik. El **login** se hace en **Authentik**
  (`idp.mwt.one`) con el **email + contraseña del usuario** de la consola. ✔ el OAuth y el login
  funcionan.
- **Qué NO funciona aún**: **el filtrado por rol**. Conectando por el conector aparecen las
  **99 tools** (todas) porque **ContextForge (gateway) no pasa la identidad del usuario (email)
  al MCP upstream** → `tool_rbac` recibe identidad vacía → devuelve todas.
- **Causa raíz**: `mcp-gateway` (IBM mcp-context-forge), en `streamablehttp_transport.py`
  (~línea 1499), inyecta headers de identidad con `build_identity_headers(identity, gateway)`,
  pero esa identidad **no llega** al MCP de MWT para resolver el rol del usuario.
- **Para cerrarlo (trabajo futuro)**: hacer que ContextForge reenvíe al upstream la identidad
  del usuario autenticado (o el `Authorization: Bearer <access_token>`), para que el MCP lo use
  en `jwt_minter` → `McpTokenView` (que ya soporta token de Authentik vía `authentik_token.py`)
  → rol → filtro. Requiere **rebuild del gateway + prueba E2E con Claude Desktop**.

## Decisión
1. **Para "qué tools mostrar / cuáles ocultar" (RBAC por rol)**: usar la vía **DeviceToken/`.json`**
   — garantizado y ya desplegado.
2. El **conector de Authentik** queda como vía oficial pero el **RBAC por rol depende del gateway
   ContextForge** → pendiente; si se prioriza, arrancar por el gateway (rebuild + E2E).

## Referencias
- `apps/core/mcp_onboarding.py` → `build_package()` (`.md` + `.json`, 2 adjuntos).
- `mcp_server/mwt_mcp/` → `tool_rbac.py` (filtro por rol), `asgi_middleware.py` (Bearer opt-in),
  `jwt_minter.py`.
- `backend/apps/core/entra_token.py` / `authentik_token.py` → validadores OAuth (Entra / Authentik).
- Extensión `.dxt`/`.MCPB`: **descartada** (el correo solo manda `.md` + `.json`).
