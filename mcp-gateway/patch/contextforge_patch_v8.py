#!/usr/bin/env python3
"""Force live tools/list for the MWT.ONE virtual server (direct_proxy by identity).

ContextForge serves tools/list from its SQLite cache by default, so the
role-based filtering implemented in the MWT MCP server (mcp_server/mwt_mcp/
tool_rbac.py) never applies to the list Claude sees. The direct_proxy path
already exists and already forwards X-Forwarded-User-* (patch v6/v7), but it
only triggers when the request carries an X-Context-Forge-Gateway-Id header
(which Claude does not send).

This patch makes the MWT virtual server ALWAYS use direct_proxy for
tools/list (and calls), looking up the gateway by server association, so the
upstream MCP server filters tools by the connected user's role. This hides
cliente_crear for admin (clientes.create=false in /roles) while keeping it
for manager/superadmin.
"""

MWT_SERVER_ID  = "1290625df81d4121a18a66bb164f87f1"
MWT_GATEWAY_ID = "5b0ab59d5b1a4357b93a7f7640ad0a89"

FILE = "/app/mcpgateway/transports/streamablehttp_transport.py"

OLD_CODE = """                # Check if server exists for cache mode
                server = db.execute(select(DbServer).where(DbServer.id == server_id)).scalar_one_or_none()
                if not server:
                    logger.warning("Server %s not found in database", server_id)
                    return []

                # Default cache mode: use database
                tools = await tool_service.list_server_tools(db, server_id, user_email=user_email, token_teams=token_teams, _request_headers=request_headers)
                return _tools_for_client(tools)"""

NEW_CODE = """                # MWT Ola 2 · RBAC por rol: el server MWT siempre va en vivo al
                # gateway upstream (direct_proxy) para que el filtrado por rol
                # del mcp_server (tool_rbac.py) se aplique al listar. Sin esto
                # ContextForge serviría la cache SQLite (99 tools) y cliente_crear
                # aparecería aunque el rol no pueda crearlo.
                if server_id == "1290625df81d4121a18a66bb164f87f1":
                    _gw = db.execute(select(DbGateway).where(DbGateway.id == "5b0ab59d5b1a4357b93a7f7640ad0a89")).scalar_one_or_none()
                    if _gw and getattr(_gw, "gateway_mode", "cache") == "direct_proxy" and settings.mcpgateway_direct_proxy_enabled:
                        if await check_gateway_access(db, _gw, user_email, token_teams):
                            _meta = None
                            try:
                                _meta = mcp_app.request_context.meta
                            except (LookupError, AttributeError):
                                _meta = None
                            logger.info(
                                "[LIST TOOLS] MWT forced direct_proxy for server %s via gateway %s",
                                server_id, _gw.id,
                            )
                            return await _proxy_list_tools_to_gateway(_gw, request_headers, user_context, _meta)
                        else:
                            logger.warning("Access denied to MWT gateway %s for user %s", _gw.id, user_email)
                            return []

                # Check if server exists for cache mode
                server = db.execute(select(DbServer).where(DbServer.id == server_id)).scalar_one_or_none()
                if not server:
                    logger.warning("Server %s not found in database", server_id)
                    return []

                # Default cache mode: use database
                tools = await tool_service.list_server_tools(db, server_id, user_email=user_email, token_teams=token_teams, _request_headers=request_headers)
                return _tools_for_client(tools)"""


def main():
    with open(FILE, "r", encoding="utf-8") as f:
        content = f.read()

    if "MWT forced direct_proxy for server" in content:
        print("ContextForge live tools/list-by-identity patch v8 already applied.")
        return

    if OLD_CODE not in content:
        print("OLD_CODE not found; cannot apply MWT direct_proxy patch v8.")
        print("El bloque de cache mode cambió en esta versión de ContextForge.")
        return

    content = content.replace(OLD_CODE, NEW_CODE, 1)
    with open(FILE, "w", encoding="utf-8") as f:
        f.write(content)
    print("ContextForge live tools/list-by-identity patch v8 applied successfully.")


if __name__ == "__main__":
    main()
