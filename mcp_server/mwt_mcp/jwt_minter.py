"""Emisor de tokens JWT de usuario para el backend MWT.ONE.

El MCP server recibe la identidad real del usuario OAuth a través de headers
X-Forwarded-User-* (capturados por el middleware ASGI). Este módulo traduce
esa identidad en un JWT de usuario válido para la API de MWT.ONE.

Modos de operación (en orden de preferencia):
  1. Backend minting (default, más seguro): el token de servicio MCP llama a
     POST /api/auth/mcp-token/ enviando el email/UUID del usuario. El backend
     firma el JWT con su DJANGO_SECRET_KEY; el secret nunca sale del backend.
  2. Firma local (fallback): si MWT_JWT_SIGNING_SECRET está configurado, se
     firma un AccessToken directamente con PyJWT. Esto requiere conocer el rol
     del usuario; por ahora se obtiene del modo 1 y se cachea por email.

Si no hay identidad propagada, se usa el token de servicio estático
(MWT_MCP_TOKEN), que es el comportamiento anterior.
"""
from __future__ import annotations

import os
import sys
import threading
import time
from typing import Any

import httpx

from .config import settings
from .identity import current_identity


# Cache simple en memoria por email/usuario. TTL = 45 min (el backend emite 1h).
_TOKEN_TTL_SECONDS = 45 * 60
_cache: dict[str, dict[str, Any]] = {}
_cache_lock = threading.Lock()


def _cache_key(identity) -> str | None:
    if identity.email:
        return identity.email.lower()
    if identity.user_id:
        return identity.user_id.lower()
    return None


def _cached(key: str) -> str | None:
    if not key:
        return None
    with _cache_lock:
        entry = _cache.get(key)
        if not entry:
            return None
        if entry["exp"] < time.time():
            del _cache[key]
            return None
        return entry["token"]


def _set_cache(key: str, token: str) -> None:
    with _cache_lock:
        _cache[key] = {"token": token, "exp": time.time() + _TOKEN_TTL_SECONDS}


def _service_auth_header() -> dict[str, str]:
    token = settings.require_token()
    # Sprint 2026-08-07 · Ola 1 F3: soporte Bearer (legacy JWT) y ServiceToken.
    # Los tokens de servicio nuevos son opacos de 64 hex y viajan como
    # Authorization: ServiceToken <token>. Los JWT legacy siguen como Bearer.
    if token.startswith("eyJ"):
        return {"Authorization": f"Bearer {token}"}
    return {"Authorization": f"ServiceToken {token}"}


def _mint_from_backend(identity) -> str | None:
    """Pide al backend un JWT firmado para el usuario propagado."""
    if not identity.is_present:
        return None

    body: dict[str, Any] = {}
    if identity.email:
        body["email"] = identity.email
    if identity.user_id:
        body["user_id"] = identity.user_id

    url = f"{settings.api_base}/auth/mcp-token/"
    try:
        with httpx.Client(timeout=settings.http_timeout) as c:
            r = c.post(url, json=body, headers=_service_auth_header())
        if r.status_code == 200:
            return r.json().get("access")
        # Log silencioso vía stderr para no contaminar la respuesta de la tool.
        print(
            f"[mwt-mcp] jwt_minter: backend minting failed {r.status_code}: {r.text[:200]}",
            file=sys.stderr,
        )
    except Exception as e:
        print(f"[mwt-mcp] jwt_minter: error minting token: {e}", file=sys.stderr)
    return None


def _signing_secret() -> str | None:
    return os.environ.get("MWT_JWT_SIGNING_SECRET", "").strip() or None


def _mint_local(identity) -> str | None:
    """Firma local con PyJWT + HS256. Requiere MWT_JWT_SIGNING_SECRET.

    Como ContextForge no siempre envía el rol del usuario, este modo no está
    activo por defecto: se delega al backend minting. Si en el futuro se
    configura un lookup de roles o se propagan roles, este es el punto de
    extensión.
    """
    secret = _signing_secret()
    if not secret:
        return None
    # Sin rol no podemos firmar un token válido para RoleBasedPermission.
    # Se deshabilita firma local automática; volvemos al backend minting.
    print(
        "[mwt-mcp] jwt_minter: MWT_JWT_SIGNING_SECRET set but local signing "
        "needs user role propagation; using backend minting.",
        file=sys.stderr,
    )
    return None


def get_identity_token() -> str:
    """Devuelve el JWT a usar en la próxima llamada a la API.

    - Si hay identidad propagada, devuelve un token de usuario (cacheado).
    - Si no hay identidad, cae al token de servicio estático.
    """
    identity = current_identity()
    print(
        f"[mwt-mcp] get_identity_token: identity email={identity.email!r} "
        f"present={identity.is_present}",
        file=sys.stderr,
    )
    if not identity.is_present:
        print("[mwt-mcp] get_identity_token: no identity, using service token", file=sys.stderr)
        return settings.require_token()

    key = _cache_key(identity)
    if key:
        cached = _cached(key)
        if cached:
            return cached

    token = _mint_from_backend(identity)
    if token:
        print(f"[mwt-mcp] get_identity_token: minted user token for {identity.email!r}", file=sys.stderr)
        if key:
            _set_cache(key, token)
        return token

    # Fallback a firma local si algún día se habilita.
    token = _mint_local(identity)
    if token:
        if key:
            _set_cache(key, token)
        return token

    # Último recurso: usar el token de servicio. Esto mantiene el sistema
    # operativo si el backend minting falla, pero devolverá la identidad
    # quemada del token de servicio.
    print(
        "[mwt-mcp] jwt_minter: could not mint user token; falling back to service token.",
        file=sys.stderr,
    )
    return settings.require_token()
