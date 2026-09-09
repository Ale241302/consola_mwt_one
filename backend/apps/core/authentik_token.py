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

import os

from django.conf import settings

_AUTHENTIK_ISSUER_DEFAULT = "https://idp.mwt.one/application/o/claude-mcp/"


def issuer() -> str:
    return (os.environ.get("AUTHENTIK_ISSUER") or "").strip() \
        or _AUTHENTIK_ISSUER_DEFAULT


def client_id() -> str:
    # aud esperada del token de Authentik = el client_id del provider claude-mcp.
    return (os.environ.get("AUTHENTIK_CLIENT_ID") or "").strip() or "mwt-one-mcp"


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


def validate_authentik_token(token: str) -> dict:
    """Valida un token de acceso/id de Authentik y devuelve sus claims."""
    import jwt  # noqa: PLC0415

    token = (token or "").strip()
    if not token:
        raise AuthentikTokenError("TOKEN_REQUERIDO", "Falta el token.")

    try:
        jwks_client = jwt.PyJWKClient(jwks_uri(), cache_keys=True)
        signing_key = jwks_client.get_signing_key_from_jwt(token)
    except Exception as exc:  # noqa: BLE001
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
        raise AuthentikTokenError("AUD_INVALIDA",
                                  "El token no es para esta aplicación.") from exc
    except Exception as exc:  # noqa: BLE001
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
