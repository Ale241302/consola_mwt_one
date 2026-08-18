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


# ═══════════════════════════════════════════════════════════════════
# Ola 3 · 3.1 — sync de GRUPOS de cliente (membresía MCP por empresa)
# ═══════════════════════════════════════════════════════════════════
def _slugify_client(razon_social: str, cliente_id: str | None = None) -> str:
    """Slug canónico de grupo: `mcp-cliente-<slug>`.

    Deriva un slug corto desde razon_social (ASCII, lowercase, guiones);
    si queda vacío usa los primeros 8 chars del UUID del cliente.
    """
    import re

    s = (razon_social or "").strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    if len(s) > 40:
        s = s[:40].rstrip("-")
    if not s and cliente_id:
        s = str(cliente_id).replace("-", "")[:12]
    return s or "cliente"


def client_group_name(cliente_id: str, razon_social: str | None = None) -> str:
    """Nombre del grupo Authentik para un cliente: `mcp-cliente-<slug>`."""
    return f"mcp-cliente-{_slugify_client(razon_social, cliente_id)}"


def _find_group(c: httpx.Client, name: str) -> dict | None:
    r = c.get("/core/groups/", params={"name": name})
    if r.status_code != 200:
        return None
    results = (r.json() or {}).get("results") or []
    return results[0] if results else None


def _ensure_group(c: httpx.Client, name: str) -> dict | None:
    """Obtiene o crea el grupo; devuelve su dict o None si falla."""
    existing = _find_group(c, name)
    if existing:
        return existing
    r = c.post("/core/groups/", json={"name": name, "is_superuser": False})
    if r.status_code not in (200, 201):
        log.warning("authentik create group(%s): HTTP %s %s", name, r.status_code, r.text[:200])
        return None
    return r.json()


def _group_user_pks(c: httpx.Client, group_pk) -> set[int]:
    """Pks de usuarios actualmente en el grupo (campo `users` = lista ints)."""
    r = c.get(f"/core/groups/{group_pk}/")
    if r.status_code != 200:
        return set()
    g = r.json() or {}
    return {int(u) for u in (g.get("users") or []) if u}


def _set_group_users(c: httpx.Client, group_pk, user_pks: set[int]) -> bool:
    """Reemplaza la membresía del grupo (PATCH users=[...]). True si OK."""
    r = c.patch(f"/core/groups/{group_pk}/", json={"users": sorted(user_pks)})
    if r.status_code not in (200, 204):
        log.warning("authentik set users(%s): HTTP %s", group_pk, r.status_code)
        return False
    return True


def sync_groups(email: str, legal_entity_ids: list[str],
                client_names: dict[str, str] | None = None) -> dict:
    """Ola 3 · 3.1 — sincroniza la membresía del usuario en grupos de cliente.

    Regla: por cada `legal_entity_id` del usuario se crea/obtiene el grupo
    `mcp-cliente-<slug>` (si no existe) y se añade al usuario. Si el usuario
    estaba en grupos de clientes que ya no tiene asignados, se remueve.

    Args:
      email:            email del usuario (users.mwtuser).
      legal_entity_ids: clientes.cliente.id asignados (pool del usuario).
      client_names:     opcional, mapa cliente_id -> razon_social (para slug).

    Returns:
      {"ok": bool, "groups": [nombre_grupo], "detail": str}
    """
    email = (email or "").strip().lower()
    c = _client()
    if c is None or not email:
        return {"ok": False, "groups": [], "detail": "sync desactivado o sin email"}
    try:
        user = find_user(email)
        if not user:
            return {"ok": False, "groups": [], "detail": f"usuario {email} no existe en Authentik"}
        user_pk = int(user["pk"])
        target_groups: list[str] = []
        # Ola 6 · resolver nombres de clientes si no vienen (para el slug del
        # grupo). Si no hay nombre, el slug cae al UUID — correcto pero menos
        # legible; los grupos nuevos usan la razón social.
        names = dict(client_names or {})
        cids = [str(x) for x in (legal_entity_ids or []) if x]
        missing = [x for x in cids if x not in names]
        if missing:
            try:
                from django.db import connection as _conn

                with _conn.cursor() as cur:
                    cur.execute(
                        """
                        SELECT id::text, razon_social
                          FROM clientes.cliente
                         WHERE id::text = ANY(%s::text[])
                        """,
                        [missing],
                    )
                    for cid, razon in cur.fetchall():
                        names[cid] = razon or ""
            except Exception:  # noqa: BLE001 - fail-safe, slug por UUID
                pass
        with c:
            # Construir mapa grupo_nombre -> conjunto de pks (incluye al usuario).
            # Un usuario multi-empresa debe pertenecer a TODOS sus grupos de cliente.
            by_group: dict[str, set[int]] = {}
            for cid_str in cids:
                name = names.get(cid_str) or ""
                gname = client_group_name(cid_str, name)
                by_group.setdefault(gname, set()).add(user_pk)
                target_groups.append(gname)

            # Aplicar membresía en todos los grupos mcp-cliente-*.
            r = c.get("/core/groups/", params={"page_size": 100})
            if r.status_code != 200:
                return {"ok": False, "groups": [], "detail": "no se pudo listar grupos"}
            all_groups = (r.json() or {}).get("results") or []
            for g in all_groups:
                gname = g.get("name") or ""
                if not gname.startswith("mcp-cliente-"):
                    continue
                gp = g["pk"]
                wanted = by_group.get(gname, set())
                current = _group_user_pks(c, gp)
                if wanted != current:
                    _set_group_users(c, gp, wanted)
            # Crear grupos de cliente que aún no existen (asegurar).
            for gname in by_group:
                grp = _ensure_group(c, gname)
                if grp:
                    current = _group_user_pks(c, grp["pk"])
                    if by_group[gname] != current:
                        _set_group_users(c, grp["pk"], by_group[gname])
            return {"ok": True, "groups": target_groups, "detail": f"sync OK para {email}"}
    except Exception as e:  # noqa: BLE001 - fail-safe
        log.exception("authentik sync_groups(%s) error: %s", email, e)
        return {"ok": False, "groups": [], "detail": str(e)}
