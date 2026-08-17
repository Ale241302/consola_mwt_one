#!/usr/bin/env python3
"""Skip ContextForge tools.execute RBAC for the MWT server (patch v10).

The MWT server is always routed via direct_proxy (patches v8/v9). The
upstream MCP server (mwt_mcp/server.py) authorizes every tool call by role
via tool_rbac.py, and invoke_tool_direct() still enforces
check_gateway_access() on the way through. ContextForge's own tools.execute
RBAC check in call_tool() therefore runs BEFORE the direct-proxy branch and
rejects valid users (observed: "Streamable HTTP RBAC denied:
user=logistica2@sondelsa.com, permission=tools.execute").

This patch skips that check for the MWT server only, so the upstream MCP
server's role-based authorization applies. check_gateway_access() below keeps
it safe (only users with access to the MWT gateway can invoke tools).
"""

FILE = "/app/mcpgateway/transports/streamablehttp_transport.py"

OLD = """    if _should_enforce_streamable_rbac(user_context):
        # Layer 1: Token scope cap
        if not _check_scoped_permission(user_context, "tools.execute"):
            raise PermissionError(_ACCESS_DENIED_MSG)
        # Layer 2: RBAC check
        # Session tokens have no explicit team_id; check across all team-scoped roles.
        # Mirrors the @require_permission decorator's check_any_team fallback (rbac.py:562-576).
        has_execute_permission = await _check_streamable_permission(
            user_context=user_context,
            permission="tools.execute",
            check_any_team=_check_any_team_for_server_scoped_rbac(user_context, server_id),
        )
        if not has_execute_permission:
            raise PermissionError(_ACCESS_DENIED_MSG)"""

NEW = """    # MWT Ola 3 · skip ContextForge RBAC for the MWT server in direct_proxy
    # mode. The upstream MCP server authorizes each tool call by role
    # (tool_rbac.py); ContextForge's tools.execute check is redundant here and
    # would deny valid users (e.g. logistica2@sondelsa.com). invoke_tool_direct
    # still enforces check_gateway_access(), so this is not a bypass.
    if server_id == "1290625df81d4121a18a66bb164f87f1":
        logger.info("MWT call_tool: skipping ContextForge RBAC tools.execute (direct_proxy; upstream MCP authorizes by role)")
    elif _should_enforce_streamable_rbac(user_context):
        # Layer 1: Token scope cap
        if not _check_scoped_permission(user_context, "tools.execute"):
            raise PermissionError(_ACCESS_DENIED_MSG)
        # Layer 2: RBAC check
        # Session tokens have no explicit team_id; check across all team-scoped roles.
        # Mirrors the @require_permission decorator's check_any_team fallback (rbac.py:562-576).
        has_execute_permission = await _check_streamable_permission(
            user_context=user_context,
            permission="tools.execute",
            check_any_team=_check_any_team_for_server_scoped_rbac(user_context, server_id),
        )
        if not has_execute_permission:
            raise PermissionError(_ACCESS_DENIED_MSG)"""


def main():
    with open(FILE, "r", encoding="utf-8") as f:
        content = f.read()

    if "skipping ContextForge RBAC tools.execute" in content:
        print("ContextForge MWT RBAC-skip patch v10 already applied.")
        return

    if OLD not in content:
        print("OLD not found; cannot apply MWT RBAC-skip patch v10.")
        return

    content = content.replace(OLD, NEW, 1)
    with open(FILE, "w", encoding="utf-8") as f:
        f.write(content)
    print("ContextForge MWT RBAC-skip patch v10 applied successfully.")


if __name__ == "__main__":
    main()
