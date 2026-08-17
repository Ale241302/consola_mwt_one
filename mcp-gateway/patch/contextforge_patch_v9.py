#!/usr/bin/env python3
"""Force direct_proxy for MWT.ONE tool calls (identity propagation).

list_tools for the MWT virtual server already goes direct_proxy (patch v8),
so tools/list receives X-Forwarded-User-* and RBAC filters correctly. But
tools/call goes through the normal (db/cache) route, where user_identity_var
is often empty for web/app OAuth sessions -> the upstream MCP server receives
no identity and mwt_whoami fails with 401 ("Access denied").

This patch makes call_tool for the MWT server use direct_proxy too, so every
invocation carries the same X-Forwarded-User-* identity as list_tools.
"""

FILE = "/app/mcpgateway/transports/streamablehttp_transport.py"

MWT_SERVER_ID  = "1290625df81d4121a18a66bb164f87f1"
MWT_GATEWAY_ID = "5b0ab59d5b1a4357b93a7f7640ad0a89"

OLD_CODE = """    # Check if we're in direct_proxy mode by looking for X-Context-Forge-Gateway-Id header
    gateway_id_from_header = extract_gateway_id_from_headers(request_headers)

    # If X-Context-Forge-Gateway-Id header is present, use direct proxy mode
    if gateway_id_from_header:"""

NEW_CODE = """    # Check if we're in direct_proxy mode by looking for X-Context-Forge-Gateway-Id header
    gateway_id_from_header = extract_gateway_id_from_headers(request_headers)

    # MWT Ola 3 · force direct_proxy for the MWT server so tools/call carries the
    # same X-Forwarded-User-* identity as tools/list (which already uses direct
    # proxy via patch v8). Without this, web/app OAuth sessions lose identity on
    # tool calls and mwt_whoami returns 401.
    if not gateway_id_from_header and server_id == "1290625df81d4121a18a66bb164f87f1":
        gateway_id_from_header = "5b0ab59d5b1a4357b93a7f7640ad0a89"

    # If X-Context-Forge-Gateway-Id header is present, use direct proxy mode
    if gateway_id_from_header:"""

# Second replacement: in the direct-proxy branch, pass the request-scoped
# user_context (recovered in line ~1728) instead of user_identity_var.get(),
# which is empty on web/app OAuth flows. Mirrors list_tools (patch v8) which
# passes the same user_context and works.
OLD_CALL = """                        user_email=user_email,
                        token_teams=token_teams,
                        user_context=user_identity_var.get(),
                    )"""

NEW_CALL = """                        user_email=user_email,
                        token_teams=token_teams,
                        user_context=user_context,
                    )"""


def main():
    with open(FILE, "r", encoding="utf-8") as f:
        content = f.read()

    if "force direct_proxy for the MWT server so tools/call" in content:
        print("ContextForge MWT direct-proxy call_tool patch v9 already applied.")
        return

    if OLD_CODE not in content:
        print("OLD_CODE not found; cannot apply MWT call_tool direct_proxy patch v9.")
        return

    content = content.replace(OLD_CODE, NEW_CODE, 1)

    if OLD_CALL not in content:
        print("WARNING: OLD_CALL not found; forcing direct_proxy applied but user_context pass-through NOT updated.")
    else:
        content = content.replace(OLD_CALL, NEW_CALL, 1)

    with open(FILE, "w", encoding="utf-8") as f:
        f.write(content)
    print("ContextForge MWT call_tool direct_proxy patch v9 applied successfully.")


if __name__ == "__main__":
    main()
