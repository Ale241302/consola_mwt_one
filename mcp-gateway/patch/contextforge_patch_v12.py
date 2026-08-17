#!/usr/bin/env python3
"""MWT Ola 6 · usa el jwks_uri del oauth_config cuando el discovery no responde HTTPS.

ContextForge valida los access tokens de Authentik descargando el JWKS. El
discovery OIDC interno (desde el contenedor) devuelve el issuer/jwks_uri con
scheme http (Authentik no recibe X-Forwarded-Proto en el fetch interno), y
verify_oauth_access_token los rechaza por la SSRF defense (jwks_uri debe ser
https y compartir origen con el issuer).

Este patch hace que, tras un discovery fallido o con scheme http, se use el
`jwks_uri` declarado en el `oauth_config` del virtual server (que apuntamos a
https y responde 200). Es la pieza que cierra el flujo OAuth por cliente.

Idempotente. Aplica sobre /app/mcpgateway/utils/verify_credentials.py.
"""

FILE = "/app/mcpgateway/utils/verify_credentials.py"

OLD = """    # Discover OIDC metadata and resolve JWKS URI
    metadata = await _discover_oidc_metadata(normalized_issuer)
    if not metadata:
        return None

    jwks_uri = metadata.get("jwks_uri")
    if not isinstance(jwks_uri, str) or not jwks_uri.strip():
        logger.warning("No jwks_uri in OIDC metadata for issuer %s", sanitize_for_log(normalized_issuer))
        return None"""

NEW = """    # Discover OIDC metadata and resolve JWKS URI
    metadata = await _discover_oidc_metadata(normalized_issuer)
    jwks_uri = metadata.get("jwks_uri") if metadata else None

    # MWT Ola 6 · fallback: si el discovery no respondió (o respondió con
    # scheme http que la SSRF defense rechaza), usamos el jwks_uri declarado
    # en el oauth_config del virtual server (https, responde 200 en Authentik).
    # Esto es necesario porque Authentik no recibe X-Forwarded-Proto en el
    # fetch interno de discovery y devuelve el jwks con http.
    if not isinstance(jwks_uri, str) or not jwks_uri.strip():
        cfg_jwks = None
        try:
            import os
            _cfg = os.environ.get("MWT_OAUTH_JWKS_URI", "")
            cfg_jwks = _cfg if _cfg.startswith("https://") else None
        except Exception:  # noqa: BLE001
            cfg_jwks = None
        if cfg_jwks:
            logger.info("MWT Ola 6: usando jwks_uri del entorno (%s)", cfg_jwks)
            jwks_uri = cfg_jwks
        else:
            logger.warning("No jwks_uri in OIDC metadata for issuer %s", sanitize_for_log(normalized_issuer))
            return None"""


def main():
    with open(FILE, "r", encoding="utf-8") as f:
        content = f.read()
    if "MWT Ola 6" in content:
        print("ContextForge jwks fallback patch v12 already applied.")
        return
    if OLD not in content:
        print("OLD block not found in verify_credentials.py; cannot apply v12.")
        return
    content = content.replace(OLD, NEW, 1)
    with open(FILE, "w", encoding="utf-8") as f:
        f.write(content)
    print("ContextForge jwks fallback patch v12 applied successfully.")


if __name__ == "__main__":
    main()
