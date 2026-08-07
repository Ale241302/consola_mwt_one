#!/usr/bin/env python3
"""Propagate OAuth identity to upstream MCP servers via X-Forwarded-User headers.

ContextForge's OAuth access-token path populates ``user_context_var`` but does
not call ``_set_user_identity_from_dict``, so ``user_identity_var`` stays
None and ``build_identity_headers`` never injects ``X-Forwarded-User-*``
headers when proxying to the upstream MCP server. This patch mirrors the
internal JWT path by also setting the per-request user identity.
"""

FILE = "/app/mcpgateway/transports/streamablehttp_transport.py"

OLD_CODE = '''        user_context_var.set(
            {
                "email": user_email,
                "teams": final_teams,
                "is_authenticated": True,
                "is_admin": is_admin,
                "permission_is_admin": is_admin,
                "exp": claims.get("exp"),
                "token_use": "session",  # nosec B105 - JWT claim type marker, not a password
                "auth_method": "oauth_access_token",
            }
        )
        _oauth_checked_var.set(True)
        return OAuthAuthResult.SUCCESS'''

NEW_CODE = '''        auth_user_ctx = {
            "email": user_email,
            "teams": final_teams,
            "is_authenticated": True,
            "is_admin": is_admin,
            "permission_is_admin": is_admin,
            "exp": claims.get("exp"),
            "token_use": "session",  # nosec B105 - JWT claim type marker, not a password
            "auth_method": "oauth_access_token",
        }
        user_context_var.set(auth_user_ctx)
        _set_user_identity_from_dict(auth_user_ctx)
        _oauth_checked_var.set(True)
        return OAuthAuthResult.SUCCESS'''


def main():
    with open(FILE, "r", encoding="utf-8") as f:
        content = f.read()

    if OLD_CODE not in content:
        if "_set_user_identity_from_dict(auth_user_ctx)" in content:
            print("OAuth identity propagation patch v6 already applied.")
            return
        print("OLD_CODE not found; cannot apply OAuth identity propagation patch.")
        return

    content = content.replace(OLD_CODE, NEW_CODE, 1)
    with open(FILE, "w", encoding="utf-8") as f:
        f.write(content)
    print("ContextForge OAuth identity propagation patch v6 applied successfully.")


if __name__ == "__main__":
    main()
