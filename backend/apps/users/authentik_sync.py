"""
=====================================================================
MWT.ONE · apps.users.authentik_sync
Sync de identidad consola → Authentik (IdP del MCP gateway).

La consola es la FUENTE DE VERDAD de usuarios y passwords. Cuando un
admin crea un usuario, cambia su password o lo deshabilita en
/api/users/, esta app replica el cambio a Authentik (idp.mwt.one) vía
su Admin API REST, para que el usuario pueda entrar al MCP (Claude etc.)
con la MISMA password que usa en la consola.

Endpoints de la Admin API de Authentik usados:
  GET    /api/v3/core/users/?email=<email>          · buscar por email
  POST   /api/v3/core/users/                         · crear
  PATCH  /api/v3/core/users/<pk>/                    · is_active / name / email
  POST   /api/v3/core/users/<pk>/set_password/       · password (204)
  DELETE /api/v3/core/users/<pk>/                    · hard delete (204)

Configuración (env del backend):
  AUTHENTIK_API_URL   · base de la API, p.ej. http://authentik-server:9000/api/v3
  AUTHENTIK_API_TOKEN · token de aplicación (INTENT_API) con scope core

Fail-safe: si no hay token/URL configurados, todas las funciones son
no-op que loguean un warning — la gestión de usuarios de la consola
NUNCA se rompe por una caída o mala config de Authentik.
=====================================================================
"""
from __future__ import annotations

import logging
import os
from typing import Any

import httpx

log = logging.getLogger(__name__)


def _base_url() -> str:
    return (os.environ.get("AUTHENTIK_API_URL") or "").rstrip("/")


def _token() -> str:
    return (os.environ.get("AUTHENTIK_API_TOKEN") or "").strip()


def _enabled() -> bool:
    return bool(_base_url() and _token())


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {_token()}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }


def _client() -> httpx.Client | None:
    if not _enabled():
        log.warning("authentik_sync: AUTHENTIK_API_URL/TOKEN no configurados — sync desactivado.")
        return None
    return httpx.Client(base_url=_base_url(), headers=_headers(), timeout=10.0)


def find_user(email: str) -> dict | None:
    """Busca un usuario en Authentik por email. Devuelve el dict del user o None."""
    email = (email or "").strip().lower()
    if not email:
        return None
    c = _client()
    if c is None:
        return None
    try:
        with c:
            r = c.get("/core/users/", params={"email": email})
            if r.status_code != 200:
                log.warning("authentik find_user(%s): HTTP %s", email, r.status_code)
                return None
            results = (r.json() or {}).get("results") or []
            return results[0] if results else None
    except Exception as e:  # noqa: BLE001 - fail-safe
        log.exception("authentik find_user(%s) error: %s", email, e)
        return None


def ensure_user(email: str, full_name: str, *, is_active: bool = True,
                password: str | None = None) -> dict | None:
    """Crea el usuario en Authentik si no existe; devuelve el user.

    Si `password` viene, la setea (create con password o set_password).
    Si el usuario ya existe, solo actualiza name/is_active cuando difieran.
    """
    email = (email or "").strip().lower()
    if not email:
        return None
    c = _client()
    if c is None:
        return None
    try:
        with c:
            existing = None
            r = c.get("/core/users/", params={"email": email})
            if r.status_code == 200:
                results = (r.json() or {}).get("results") or []
                existing = results[0] if results else None

            if existing:
                pk = existing["pk"]
                needs_patch = (
                    (existing.get("is_active") or False) != bool(is_active)
                    or (existing.get("name") or "") != (full_name or "")
                )
                if needs_patch:
                    body: dict[str, Any] = {"is_active": bool(is_active)}
                    if full_name:
                        body["name"] = full_name
                    pr = c.patch(f"/core/users/{pk}/", json=body)
                    if pr.status_code not in (200, 204):
                        log.warning("authentik patch(%s): HTTP %s", email, pr.status_code)
                if password:
                    pw = c.post(f"/core/users/{pk}/set_password/", json={"password": password})
                    if pw.status_code not in (200, 204):
                        log.warning("authentik set_password(%s): HTTP %s", email, pw.status_code)
                return existing
            else:
                # Crear + setear password (opcional)
                body: dict[str, Any] = {
                    "name": full_name or email.split("@")[0],
                    "email": email,
                    "username": email.split("@")[0],
                    "is_active": bool(is_active),
                }
                cr = c.post("/core/users/", json=body)
                if cr.status_code not in (200, 201):
                    log.warning("authentik create(%s): HTTP %s %s", email, cr.status_code, cr.text[:200])
                    return None
                created = cr.json()
                if password:
                    pw = c.post(f"/core/users/{created['pk']}/set_password/",
                                json={"password": password})
                    if pw.status_code not in (200, 204):
                        log.warning("authentik set_password(new %s): HTTP %s", email, pw.status_code)
                return created
    except Exception as e:  # noqa: BLE001 - fail-safe
        log.exception("authentik ensure_user(%s) error: %s", email, e)
        return None


def set_password(email: str, password: str) -> bool:
    """Setea la password del usuario en Authentik. True si OK/fail-safe."""
    if not password:
        return False
    user = find_user(email)
    if not user:
        return False
    c = _client()
    if c is None:
        return False
    try:
        with c:
            r = c.post(f"/core/users/{user['pk']}/set_password/", json={"password": password})
            if r.status_code not in (200, 204):
                log.warning("authentik set_password(%s): HTTP %s", email, r.status_code)
                return False
            log.info("authentik set_password OK: %s", email)
            return True
    except Exception as e:  # noqa: BLE001 - fail-safe
        log.exception("authentik set_password(%s) error: %s", email, e)
        return False


def set_active(email: str, is_active: bool) -> bool:
    """Activa/desactiva el usuario en Authentik. True si OK/fail-safe."""
    user = find_user(email)
    if not user:
        return False
    c = _client()
    if c is None:
        return False
    try:
        with c:
            r = c.patch(f"/core/users/{user['pk']}/", json={"is_active": bool(is_active)})
            if r.status_code not in (200, 204):
                log.warning("authentik set_active(%s): HTTP %s", email, r.status_code)
                return False
            log.info("authentik set_active(%s) -> %s", email, is_active)
            return True
    except Exception as e:  # noqa: BLE001 - fail-safe
        log.exception("authentik set_active(%s) error: %s", email, e)
        return False
