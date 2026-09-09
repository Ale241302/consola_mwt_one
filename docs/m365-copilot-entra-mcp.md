# Microsoft 365 Copilot · MCP de MWT.ONE vía Entra ID

Estado: **implementado A+B (backend + bridge Bearer en el MCP server)** · pendiente de
validación E2E contra un tenant real de Microsoft y del registro por organización.

## Qué permite
Que un usuario registrado en la consola MWT.ONE (cualquier empresa/cliente) use las tools
MCP de MWT dentro de su **Microsoft 365 Copilot**, autenticando con su cuenta Microsoft
laboral (multi-inquilino).

## Arquitectura (flujo OAuth de MCP)
```
Microsoft 365 Copilot (cliente MCP)              Entra ID            Backend MWT
        │  1. POST https://mcp.mwt.one/device         │                    │
        │  (sin auth) → 401 + metadatos OAuth ───────▶│                    │
        │  2. login/consent del usuario               │                    │
        │  ◀──── 302 a https://mcp.mwt.one/oauth/callback?code=…          │
        │  3. callback intercambia code (client_secret) ────────────────▶ 4. valida+mapea
        │  5. llama MCP con Authorization: Bearer <access_token>          │
        │      → asgi captura bearer → mint envía {entra_token} ────────▶ 6. McpTokenView:
        │         valida JWKS (tid), email → consola → emite sesión MCP   │
```
Pasos 1-3 = canal **A** (OAuth). Pasos 5-6 = puente **B** (Bearer).

## Implementado
### Backend (django)
- `apps/core/entra_token.py` — valida token Entra RS256 contra el JWKS del `tid`
  (multi-inquilino), `aud = AZURE_CLIENT_ID`. Errores con `code` accionable.
- `apps/core/entra_oauth.py` — URLs de Entra + `exchange_code()` (usa `AZURE_CLIENT_SECRET`).
- `apps/core/entra_views.py` — endpoints:
  - `POST /api/entra/validate` (Bearer → identidad MWT)
  - `GET  /api/entra/.well-known/oauth-authorization-server`
  - `GET  /api/entra/oauth/authorize` (302 a Entra)
  - `GET  /api/entra/oauth/callback` (intercambio de code)
- `apps/core/auth_views.py` (`McpTokenView`) — acepta `entra_token` (+ opcional `cliente_id`):
  valida, decide empresa (1 sola o por `cliente_id`), emite el JWT de sesión MCP.

### MCP server (mcp_server) — puente Bearer
- `asgi_middleware.py` — `Authorization: Bearer <entra>` → header `x-mwt-entra-token`
  (espejo del DeviceToken).
- `identity.py` — atributo `entra_token` (+ `is_present`).
- `jwt_minter.py` — el mint envía `{entra_token, client_id?}` al backend.

## Config (env en /opt/consola-mwt-one/.env)
```
AZURE_CLIENT_ID=7a687d90-425f-4fc4-a371-8225cae9897b
AZURE_TENANT_ID=dded4a6a-f9b9-417e-ac26-9217f5315158
AZURE_CLIENT_SECRET=<secret>      # nunca en el repo
AZURE_REDIRECT_URI=https://mcp.mwt.one/oauth/callback
MWT_ENTRA_ENABLED=1
```

## App en Azure (hecha)
`mwt-one-mcp` · multi-inquilino · redirect `https://mcp.mwt.one/oauth/callback` ·
scope `access_as_user` (delegado, admin+user) · User.Read · secret creado.

## Pendiente
1. **Validación E2E** con un token real de Entra (p. ej. `az account get-access-token`) →
   `/api/entra/validate` y el mint Bearer.
2. **Callback productivo**: hoy el callback solo confirma el intercambio; en producción
   debe completar el flujo y devolver el control al cliente MCP.
3. **Registro por organización (Microsoft, no nuestro)**: el admin de CADA cliente va a
   Centro de admin M365 → Copilot → MCP servers y registra `https://mcp.mwt.one/device`
   (+ consiente la app en su tenant). Sin eso el usuario final no lo ve.
4. **Verificación de editor (MPN)** de la app para que usuarios de otros tenants
   consientan sin admin.
5. Alternativa DeviceToken (VS Code Copilot/opencode/Claude/Cursor) sigue intacta: esos
   clientes usan el paquete `.md`+`.json` normal.
