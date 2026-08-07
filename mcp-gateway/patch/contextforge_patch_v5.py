#!/usr/bin/env python3
"""Restore RFC 9728 'resource' field in OAuth metadata for Authentik."""

FILE = "/app/mcpgateway/services/server_service.py"

OLD_CODE = """        # Build RFC 9728 Protected Resource Metadata response
        # MWT: omit 'resource' because Pocket-ID does not support the RFC 9728
        # resource indicator parameter in authorization requests. Claude will
        # fall back to using client_id as audience, and ContextForge validates
        # audience against the configured client_id fallback.
        response_data: Dict[str, Any] = {
            "authorization_servers": authorization_servers,
            "bearer_methods_supported": ["header"],
        }"""

NEW_CODE = """        # Build RFC 9728 Protected Resource Metadata response
        # MWT: include 'resource' for Authentik; the authorize request already
        # carries the resource indicator and Authentik accepts/ignores it, so
        # restoring the field makes the metadata document fully RFC 9728
        # compliant and helps MCP clients discover the correct AS endpoints.
        response_data: Dict[str, Any] = {
            "resource": resource_base_url,
            "authorization_servers": authorization_servers,
            "bearer_methods_supported": ["header"],
        }"""


def main():
    with open(FILE, "r", encoding="utf-8") as f:
        text = f.read()
    if OLD_CODE not in text:
        if 'include \'resource\' for Authentik' in text:
            print("resource-restore patch v5 already applied.")
            return
        print("OLD_CODE not found; cannot apply resource-restore patch.")
        return
    text = text.replace(OLD_CODE, NEW_CODE, 1)
    with open(FILE, "w", encoding="utf-8") as f:
        f.write(text)
    print("ContextForge OAuth metadata resource-restore patch v5 applied successfully.")


if __name__ == "__main__":
    main()
