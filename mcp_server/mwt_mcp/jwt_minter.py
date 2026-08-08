"""Emisor de tokens JWT de usuario para el backend MWT.ONE.

El MCP server recibe la identidad real del usuario OAuth a través de headers
X-Forwarded-User-* (capturados por el middleware ASGI). Este módulo traduce
esa identidad en un JWT de usuario válido para la API de MWT.ONE.

Modos de operación (en orden de preferencia):
  1. Backend minting (default, más seguro): el token de servicio MCP llama a
     POST /api/auth/mcp-token/ enviando el email/UUID del usuario. El backend
     firma el JWT con su DJANGO_SECRET_KEY; el secret nunca sale del backend.

Semántica fail-closed (Ola 1 · 1.11 / Ola 2 · 2.15):
  - Si hay identidad propagada por el gateway (X-Forwarded-User-*) y el
    backend no puede emitir un JWT de usuario (usuario borrado, deshabilitado
    o sin acceso), NO se cae al token de servicio estático: se levanta
    `IdentityMintingError`. Así un usuario dado de baja en la consola deja de
    funcionar de inmediato en el MCP, sin depender de la expiración del token
    de servicio.
  - Si NO hay identidad propagada (acceso directo por ServiceToken, stdio, o
    salud), se usa el token de servicio estático (comportamiento anterior).

Además del JWT, se cachea el perfil del usuario (`get_identity_user()`):
rol y `permissions` (modules/actions) que devuelve el endpoint mcp-token,
para que el `list_tools` del server MCP pueda filtrar las herramientas por
rol del usuario conectado sin pegar al backend por cada listado.
"""
from __future__ import annotations

import sys
import threading
import time
from typing import Any

import httpx

from .config import settings
from .identity import current_identity


# Cache simple en memoria por email/usuario. TTL = 45 min (el backend emite 1h).
_TOKEN_TTL_SECONDS = 45 * 60
# El perfil (rol + permissions) se refresca más seguido (5 min) para que los
# cambios de permisos hechos en la consola se reflejen rápido en el filtrado
# de tools por rol al re-listar (ContextForge / tools/list).
_PROFILE_TTL_SECONDS = 5 * 60
# Entrada: {"token": str, "user": dict|None, "exp": float, "user_exp": float}
_cache: dict[str, dict[str, Any]] = {}
_cache_lock = threading.Lock()


class IdentityMintingError(Exception):
    """No se pudo emitir JWT de usuario para la identidad propagada.

    Fail-closed: cuando hay identidad (gateway) pero el backend la rechaza
    (usuario inactivo, borrado, o sin scope de token_exchange). Los tools
    del MCP deben convertirlo en un error claro, NO caer al token de servicio.
    """


def _cache_key(identity) -> str | None:
    if identity.email:
        return identity.email.lower()
    if identity.user_id:
        return identity.user_id.lower()
    return None


def _cached_entry(key: str) -> dict[str, Any] | None:
    if not key:
        return None
    with _cache_lock:
        entry = _cache.get(key)
        if not entry:
            return None
        if entry["exp"] < time.time():
            del _cache[key]
            return None
        return entry


def _cached(key: str) -> str | None:
    entry = _cached_entry(key)
    return entry.get("token") if entry else None


def _cached_user(key: str) -> dict | None:
    """Devuelve el perfil cacheado solo si aún está fresco (5 min)."""
    if not key:
        return None
    with _cache_lock:
        entry = _cache.get(key)
        if not entry:
            return None
        if entry.get("user_exp", 0) < time.time():
            # Perfil vencido: se re-minteará la próxima vez. El token sigue vivo.
            return None
        return entry.get("user") or None


def _set_cache(key: str, token: str, user: dict | None = None) -> None:
    with _cache_lock:
        _cache[key] = {
            "token": token,
            "user": user,
            "exp": time.time() + _TOKEN_TTL_SECONDS,
            "user_exp": time.time() + _PROFILE_TTL_SECONDS,
        }


def _service_auth_header() -> dict[str, str]:
    token = settings.require_token()
    # Sprint 2026-08-07 · Ola 1 F3: soporte Bearer (legacy JWT) y ServiceToken.
    # Los tokens de servicio nuevos son opacos de 64 hex y viajan como
    # Authorization: ServiceToken <token>. Los JWT legacy siguen como Bearer.
    if token.startswith("eyJ"):
        return {"Authorization": f"Bearer {token}"}
    return {"Authorization": f"ServiceToken {token}"}


def _mint_from_backend(identity) -> dict | None:
    """Pide al backend un JWT firmado para el usuario propagado.

    Devuelve el dict completo `{"access": ..., "user": {...}}` o None.
    """
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
            data = r.json()
            return data if isinstance(data, dict) else {"access": data}
        # Log silencioso vía stderr para no contaminar la respuesta de la tool.
        print(
            f"[mwt-mcp] jwt_minter: backend minting failed {r.status_code}: {r.text[:200]}",
            file=sys.stderr,
        )
    except Exception as e:
        print(f"[mwt-mcp] jwt_minter: error minting token: {e}", file=sys.stderr)
    return None


def _mint_and_cache(identity) -> dict:
    """Mint + cache el token y el perfil para la identidad propagada.

    Fail-closed: si hay identidad pero el backend no emite token, levanta
    IdentityMintingError (NUNCA cae al ServiceToken cuando hay identidad).
    """
    key = _cache_key(identity)
    data = _mint_from_backend(identity)
    if not data or not data.get("access"):
        raise IdentityMintingError(
            "El backend no emitió JWT para la identidad propagada "
            f"(email={identity.email!r}). El usuario puede estar inactivo, "
            "borrado o sin acceso MCP. Fail-closed: se deniega en lugar de "
            "usar el token de servicio."
        )

    token = data["access"]
    user = data.get("user") or None
    if key:
        _set_cache(key, token, user)
    return {"token": token, "user": user}


def get_identity_token() -> str:
    """Devuelve el JWT a usar en la próxima llamada a la API.

    - Si hay identidad propagada, devuelve un token de usuario (cacheado),
      y NUNCA cae al ServiceToken si el minting falla (fail-closed).
    - Si no hay identidad, cae al token de servicio estático.
    """
    identity = current_identity()
    if not identity.is_present:
        return settings.require_token()
    key = _cache_key(identity)
    cached = _cached(key)
    if cached:
        return cached
    return _mint_and_cache(identity)["token"]


def get_identity_user() -> dict | None:
    """Devuelve el perfil del usuario conectado (rol + permissions), o None
    si no hay identidad propagada (modo ServiceToken).

    Usado por el filtrado de tools por rol (`list_tools`). Re-mintea el token
    si el perfil cacheado venció (5 min) para reflejar cambios de permisos
    recientes en la consola. Si hay identidad pero el minting falla,
    propaga IdentityMintingError (fail-closed).
    """
    identity = current_identity()
    if not identity.is_present:
        return None
    key = _cache_key(identity)
    cached_user = _cached_user(key)
    if cached_user is not None:
        return cached_user
    return _mint_and_cache(identity)["user"]
