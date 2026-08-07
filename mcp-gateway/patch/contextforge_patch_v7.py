#!/usr/bin/env python3
"""Propagate OAuth identity into MCP upstream tool calls via user_identity_var.

ContextForge's streamable-http transport sets both user_context_var and
user_identity_var for OAuth sessions, but tool_service.py only looks at
global_context.user_context when injecting X-Forwarded-User-* headers for
upstream MCP tools. In the fallback path (no plugin_global_context from
middleware), global_context is built without a user_context, so identity
headers are never added and the upstream MCP server sees an anonymous
caller. This patch falls back to user_identity_var when global_context
has no user_context.
"""

FILE = "/app/mcpgateway/services/tool_service.py"

OLD_CODE = '''                    # Inject identity propagation headers and meta for MCP tools
                    if global_context and global_context.user_context:
                        headers.update(build_identity_headers(global_context.user_context))
                        meta_data = build_identity_meta(global_context.user_context, meta_data)'''

NEW_CODE = '''                    # Inject identity propagation headers and meta for MCP tools
                    user_ctx = None
                    if global_context and global_context.user_context:
                        user_ctx = global_context.user_context
                    else:
                        from mcpgateway.transports.context import user_identity_var  # pylint: disable=import-outside-toplevel
                        user_ctx = user_identity_var.get()
                    if user_ctx:
                        headers.update(build_identity_headers(user_ctx))
                        meta_data = build_identity_meta(user_ctx, meta_data)'''


def main():
    with open(FILE, "r", encoding="utf-8") as f:
        content = f.read()

    if OLD_CODE not in content:
        if "user_ctx = user_identity_var.get()" in content:
            print("MCP identity fallback patch v7 already applied.")
            return
        print("OLD_CODE not found; cannot apply MCP identity fallback patch v7.")
        return

    content = content.replace(OLD_CODE, NEW_CODE, 1)
    with open(FILE, "w", encoding="utf-8") as f:
        f.write(content)
    print("ContextForge MCP identity fallback patch v7 applied successfully.")


if __name__ == "__main__":
    main()
