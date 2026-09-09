"""
MWT.ONE · apps.core.entra_oauth
Handshake OAuth (authorization code + PKCE) contra Microsoft Entra ID para el
canal Microsoft 365 Copilot MCP.

Endpoints:
  GET  /api/entra/.well-known/oauth-authorization-server   → metadatos OAuth
  GET  /api/entra/oauth/authorize   → redirige al login de Entra
  GET  /api/entra/oauth/callback    → intercambia code → id_token/access

Config: reusa AZURE_CLIENT_ID / AZURE_TENANT_ID / AZURE_CLIENT_SECRET del .env.
"""
from __future__ import annotations

import logging
import os
import urllib.parse

log = logging.getLogger("mwt_mcp.entra_oauth")

_AUTHORITY = os.environ.get("AZURE_AUTHORITY") or "https://login.microsoftonline.com"
_REDIRECT_DEFAULT = os.environ.get("AZURE_REDIRECT_URI") \
    or "https://mcp.mwt.one/oauth/callback"


def tenant_id() -> str:
    return (os.environ.get("AZURE_TENANT_ID") or "").strip() or "organizations"


def client_id() -> str:
    return (os.environ.get("AZURE_CLIENT_ID") or "").strip()


def client_secret() -> str:
    return (os.environ.get("AZURE_CLIENT_SECRET") or "").strip()


def authorization_endpoint() -> str:
    return f"{_AUTHORITY}/{tenant_id()}/oauth2/v2.0/authorize"


def token_endpoint() -> str:
    return f"{_AUTHORITY}/{tenant_id()}/oauth2/v2.0/token"


def issuer() -> str:
    return f"{_AUTHORITY}/{tenant_id()}/v2.0"


def build_authorize_url(*, redirect_uri: str | None = None,
                        scope: str | None = None,
                        state: str = "",
                        code_challenge: str = "") -> str:
    """Arma la URL de autorización de Entra (authorization code + PKCE)."""
    params = {
        "response_type": "code",
        "client_id": client_id(),
        "redirect_uri": redirect_uri or _REDIRECT_DEFAULT,
        "scope": scope or f"openid profile email offline_access api://{client_id()}/access_as_user",
        "response_mode": "query",
    }
    if state:
        params["state"] = state
    if code_challenge:
        params["code_challenge"] = code_challenge
        params["code_challenge_method"] = "S256"
    return f"{authorization_endpoint()}?{urllib.parse.urlencode(params)}"


def exchange_code(*, code: str, redirect_uri: str | None = None) -> dict:
    """Intercambia el authorization code por tokens (usa el client secret).

    Devuelve el JSON de Entra o lanza Exception con mensaje.
    """
    import requests  # noqa: PLC0415

    data = {
        "client_id": client_id(),
        "client_secret": client_secret(),
        "code": code,
        "grant_type": "authorization_code",
        "redirect_uri": redirect_uri or _REDIRECT_DEFAULT,
    }
    resp = requests.post(token_endpoint(), data=data, timeout=30)
    try:
        payload = resp.json()
    except Exception:  # noqa: BLE001
        raise RuntimeError(f"Entra token: HTTP {resp.status_code}") from None
    if resp.status_code >= 400 or "access_token" not in payload:
        err = payload.get("error_description") or payload.get("error") or resp.text[:200]
        raise RuntimeError(f"Entra token: {err}")
    return payload
