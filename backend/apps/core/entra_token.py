"""
MWT.ONE · apps.core.entra_token
Validación de tokens de Microsoft Entra ID (multi-inquilino) para el canal
Microsoft 365 Copilot MCP.

Flujo previsto: Microsoft 365 Copilot (de la organización de cada usuario
registrado) autentica al usuario vía OAuth con Entra y entrega un token de
acceso con scope `access_as_user` (app mwt-one-mcp). Este módulo:

  1. Valida el token (firma RS256 contra el JWKS del inquilino del token,
     aud = AZURE_CLIENT_ID, exp, iss). Multi-inquilino: el `tid` claim indica
     de qué inquilino es el usuario → se resuelve contra ese inquilino.
  2. Mapea el `email`/`upn`/`preferred_username` del token al usuario de la
     consola MWT (users.mwtuser / core.users) y devuelve su identidad y las
     empresas con MCP provisionado (misma lógica que el DeviceToken).

Solo lectura de firma: NO se necesita el client secret para validar un token
(los JWKS son públicos). El secret de la app se usa solo si más adelante
hacemos el intercambio OAuth server-side (client credentials), no aquí.

Config (env):
  AZURE_CLIENT_ID   → aud esperada (default AZURE_APP_CLIENT_ID)
  AZURE_TENANT_ID   → inquilino principal (solo diagnóstico)
  MWT_ENTRA_ENABLED → '1' activa el endpoint (fail-closed si '0')
"""
from __future__ import annotations

import logging
import os

from django.conf import settings

log = logging.getLogger("mwt_mcp.entra")

_AUTHORITY = "https://login.microsoftonline.com"


def client_id() -> str:
    return (os.environ.get("AZURE_CLIENT_ID") or "").strip() or \
        (os.environ.get("AZURE_APP_CLIENT_ID") or "").strip() or \
        str(getattr(settings, "AZURE_CLIENT_ID", "") or "").strip()


def tenant_id() -> str:
    return (os.environ.get("AZURE_TENANT_ID") or "").strip() or \
        str(getattr(settings, "AZURE_TENANT_ID", "") or "").strip()


def enabled() -> bool:
    v = (os.environ.get("MWT_ENTRA_ENABLED") or "").strip().lower()
    return v in ("1", "true", "yes")


class EntraTokenError(Exception):
    """Error de validación de token con mensaje accionable (code en atributo)."""

    def __init__(self, code: str, detail: str):
        super().__init__(detail)
        self.code = code
        self.detail = detail


def _jwks_uri_for(tid: str | None) -> str:
    tenant = (tid or "common").strip().lstrip("/")
    return f"{_AUTHORITY}/{tenant}/discovery/v2.0/keys"


def _unverified_claims(token: str) -> dict:
    import jwt  # noqa: PLC0415

    try:
        return jwt.decode(token, options={"verify_signature": False})
    except Exception as exc:  # noqa: BLE001
        raise EntraTokenError("TOKEN_MALFORMADO",
                              "El token no es un JWT válido.") from exc


def validate_entra_token(token: str) -> dict:
    """Valida un token de acceso de Entra y devuelve sus claims.

    Lanza EntraTokenError con code accionable si es inválido.
    """
    import jwt  # noqa: PLC0415

    token = (token or "").strip()
    if not token:
        raise EntraTokenError("TOKEN_REQUERIDO", "Falta el token de Entra.")
    aud = client_id()
    if not aud:
        raise EntraTokenError("NO_CONFIGURADO",
                              "Falta AZURE_CLIENT_ID (config del backend).")

    claims = _unverified_claims(token)
    tid = str(claims.get("tid") or "common")

    try:
        jwks_client = jwt.PyJWKClient(_jwks_uri_for(tid), cache_keys=True)
        signing_key = jwks_client.get_signing_key_from_jwt(token)
    except EntraTokenError:
        raise
    except Exception as exc:  # noqa: BLE001
        log.warning("entra: fallo JWKS para tid=%s: %s", tid, exc)
        raise EntraTokenError("JWKS_FALLO",
                              "No se pudieron obtener las claves del inquilino.") from exc

    try:
        verified = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=aud,
            options={"verify_exp": True, "verify_iss": False},
        )
    except jwt.ExpiredSignatureError as exc:
        raise EntraTokenError("TOKEN_EXPIRADO",
                              "El token de Entra expiró.") from exc
    except jwt.InvalidAudienceError as exc:
        raise EntraTokenError("AUD_INVALIDA",
                              "El token no es para esta aplicación.") from exc
    except Exception as exc:  # noqa: BLE001
        log.warning("entra: firma inválida: %s", exc)
        raise EntraTokenError("FIRMA_INVALIDA",
                              "La firma del token no es válida.") from exc

    # Verificación de issuer multi-inquilino (relajada pero acotada):
    # iss debe ser https://login.microsoftonline.com/{tid}/v2.0
    iss = str(verified.get("iss") or "")
    if f"/{tid}/v2.0" not in iss and "/common/" not in iss:
        raise EntraTokenError("ISS_INVALIDA",
                              f"Emisor no esperado: {iss[:80]}")
    return verified


def email_from_claims(claims: dict) -> str:
    """Email del usuario del token (email > upn > preferred_username)."""
    raw = (claims.get("email") or claims.get("upn")
           or claims.get("preferred_username") or "").strip().lower()
    return raw


def mwt_identity_from_claims(claims: dict) -> dict:
    """Mapea los claims del token al usuario de la consola MWT.

    Devuelve {ok: True, target, clients} o {ok: False, code, detail}.
    """
    email = email_from_claims(claims)
    if not email:
        return {"ok": False, "code": "SIN_EMAIL",
                "detail": "El token no trae email/upn."}
    from .mcp_onboarding import decide_scenario  # noqa: PLC0415

    decision = decide_scenario(email)
    if decision.get("scenario") != "ok":
        return {"ok": False, "code": decision.get("scenario", "NO_OK"),
                "detail": decision.get("detail") or decision.get("scenario")}
    return {"ok": True, "target": decision["target"], "clients": decision["clients"]}
