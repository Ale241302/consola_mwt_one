"""
MWT.ONE · apps.core.authentik_token
Validación de tokens de Authentik (idp.mwt.one) para el flujo OAuth del MCP
(conector de Claude Desktop / agentes).

Authentik es el IdP propio (login de la consola de usuarios MWT). El token
emitido por el provider `claude-mcp` se valida contra su JWKS y se mapea el
email al usuario de `users.mwtuser` (misma lógica que el DeviceToken/Entra).

Config (env):
  AUTHENTIK_ISSUER  (default https://idp.mwt.one/application/o/claude-mcp/)
  MWT_ENTRA_ENABLED → gate del canal (reusamos la misma env: '1' activa)
"""
from __future__ import annotations

import logging
import os
import time

from django.conf import settings

log = logging.getLogger("mwt_mcp.authentik")

_AUTHENTIK_ISSUER_DEFAULT = "https://idp.mwt.one/application/o/claude-mcp/"
# `aud` del access token = client_id del provider OAuth2 "Claude MCP" (slug
# claude-mcp). Si se reprovisiona el provider, ajustar AUTHENTIK_CLIENT_ID.
_AUTHENTIK_CLIENT_ID_DEFAULT = "3b9e3913-a124-4dbb-8fc6-b19d3df3d73c"

# Cloudflare bloquea el User-Agent por defecto de urllib ("Python-urllib/3.x")
# en idp.mwt.one → PyJWKClient recibía HTTP 403 y el minting fail-closed
# rechazaba a TODOS los usuarios OAuth. Traemos el JWKS con requests + UA
# propio y lo cacheamos 1h.
_JWKS_UA = "MWT.ONE-MCP/1.0 (+https://mwt.one)"
_JWKS_TTL_SECONDS = 3600
_jwks_cache: dict = {"data": None, "exp": 0.0}


def issuer() -> str:
    return (os.environ.get("AUTHENTIK_ISSUER") or "").strip() \
        or _AUTHENTIK_ISSUER_DEFAULT


def client_id() -> str:
    return (os.environ.get("AUTHENTIK_CLIENT_ID") or "").strip() \
        or _AUTHENTIK_CLIENT_ID_DEFAULT


def jwks_uri() -> str:
    return f"{issuer().rstrip('/')}/jwks/"


def enabled() -> bool:
    v = (os.environ.get("MWT_ENTRA_ENABLED") or "").strip().lower()
    return v in ("1", "true", "yes")


class AuthentikTokenError(Exception):
    def __init__(self, code: str, detail: str):
        super().__init__(detail)
        self.code = code
        self.detail = detail


def _fetch_jwks() -> dict:
    """Trae el JWKS de Authentik con un User-Agent normal (Cloudflare bloquea
    el UA de urllib/PyJWKClient con HTTP 403). Cachea 1h."""
    import requests  # noqa: PLC0415

    now = time.time()
    cached = _jwks_cache.get("data")
    if cached and float(_jwks_cache.get("exp") or 0) > now:
        return cached
    resp = requests.get(jwks_uri(), timeout=10, headers={"User-Agent": _JWKS_UA})
    resp.raise_for_status()
    data = resp.json()
    _jwks_cache["data"] = data
    _jwks_cache["exp"] = now + _JWKS_TTL_SECONDS
    return data


def _signing_key_for_token(token: str):
    """Resuelve la clave de firma (por `kid`) del JWKS de Authentik."""
    import jwt  # noqa: PLC0415

    try:
        header = jwt.get_unverified_header(token)
    except Exception as exc:  # noqa: BLE001
        raise AuthentikTokenError("TOKEN_MALFORMADO",
                                  "El token no es un JWT válido.") from exc
    kid = header.get("kid")
    keys = (_fetch_jwks() or {}).get("keys") or []
    for key_data in keys:
        if not kid or key_data.get("kid") == kid:
            return jwt.PyJWK(key_data).key
    raise AuthentikTokenError("JWKS_FALLO",
                              "No se encontró la clave de firma (kid) en el JWKS de Authentik.")


def validate_authentik_token(token: str) -> dict:
    """Valida un token de acceso/id de Authentik y devuelve sus claims."""
    import jwt  # noqa: PLC0415

    token = (token or "").strip()
    if not token:
        raise AuthentikTokenError("TOKEN_REQUERIDO", "Falta el token.")

    try:
        signing_key = _signing_key_for_token(token)
    except AuthentikTokenError:
        raise
    except Exception as exc:  # noqa: BLE001
        log.warning("authentik: fallo JWKS en %s: %s", jwks_uri(), exc)
        raise AuthentikTokenError("JWKS_FALLO",
                                  "No se pudieron obtener las claves de Authentik.") from exc

    try:
        verified = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=client_id(),
            options={"verify_exp": True, "verify_iss": True},
            issuer=issuer(),
        )
    except jwt.ExpiredSignatureError as exc:
        raise AuthentikTokenError("TOKEN_EXPIRADO",
                                  "El token de Authentik expiró.") from exc
    except jwt.InvalidAudienceError as exc:
        log.warning("authentik: aud inválida (esperado %s): %s", client_id(), exc)
        raise AuthentikTokenError("AUD_INVALIDA",
                                  "El token no es para esta aplicación.") from exc
    except jwt.InvalidIssuerError as exc:
        log.warning("authentik: iss inválida (esperado %s): %s", issuer(), exc)
        raise AuthentikTokenError("ISS_INVALIDA",
                                  "El emisor del token no es Authentik.") from exc
    except Exception as exc:  # noqa: BLE001
        log.warning("authentik: firma inválida: %s", exc)
        raise AuthentikTokenError("FIRMA_INVALIDA",
                                  "La firma del token no es válida.") from exc
    return verified


def email_from_claims(claims: dict) -> str:
    raw = (claims.get("email") or claims.get("preferred_username")
           or claims.get("upn") or "").strip().lower()
    return raw


def mwt_identity_from_claims(claims: dict) -> dict:
    """Mapea los claims del token de Authentik al usuario de la consola MWT."""
    email = email_from_claims(claims)
    if not email:
        return {"ok": False, "code": "SIN_EMAIL",
                "detail": "El token no trae email."}
    from .mcp_onboarding import decide_scenario  # noqa: PLC0415
    decision = decide_scenario(email)
    if decision.get("scenario") != "ok":
        return {"ok": False, "code": decision.get("scenario", "NO_OK"),
                "detail": decision.get("detail") or decision.get("scenario")}
    return {"ok": True, "target": decision["target"], "clients": decision["clients"]}
