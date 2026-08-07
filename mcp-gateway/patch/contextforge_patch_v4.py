#!/usr/bin/env python3
"""Patch ContextForge OAuth metadata to omit 'resource' for Pocket-ID compatibility."""

FILE = "/app/mcpgateway/services/server_service.py"

OLD_CODE = """        # Build RFC 9728 Protected Resource Metadata response
        response_data: Dict[str, Any] = {
            "resource": resource_base_url,
            "authorization_servers": authorization_servers,
            "bearer_methods_supported": ["header"],
        }"""

NEW_CODE = """        # Build RFC 9728 Protected Resource Metadata response
        # MWT: omit 'resource' because Pocket-ID does not support the RFC 9728
        # resource indicator parameter in authorization requests. Claude will
        # fall back to using client_id as audience, and ContextForge validates
        # audience against the configured client_id fallback.
        response_data: Dict[str, Any] = {
            "authorization_servers": authorization_servers,
            "bearer_methods_supported": ["header"],
        }"""


def main():
    with open(FILE, "r", encoding="utf-8") as f:
        text = f.read()
    if OLD_CODE not in text:
        if '# MWT: omit "resource" because Pocket-ID' in text:
            print("resource-omit patch already applied.")
            return
        print("OLD_CODE not found; cannot apply resource-omit patch.")
        return
    text = text.replace(OLD_CODE, NEW_CODE, 1)
    with open(FILE, "w", encoding="utf-8") as f:
        f.write(text)
    print("ContextForge OAuth metadata resource-omit patch applied successfully.")


if __name__ == "__main__":
    main()
