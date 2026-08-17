"""
=====================================================================
MWT.ONE · apps.clientes.authentik_provisioning
Ola 3 · 3.2 — provisionamiento de la app MCP por cliente en Authentik.

Crea los objetos que permiten a un cliente conectarse a su MCP remoto:
  1. Grupo  `mcp-cliente-<slug>`      (membresía de los usuarios del cliente)
  2. Provider OAuth2 `mcp-provider-<slug>` (client_id/client_secret generados)
  3. Application `mcp-<slug>`          (binding al provider)

El claim `cliente_id` quemado se entrega por HEADER estático en ContextForge
(X-MWT-Client-ID) según el virtual server — la vía principal del diseño
(plan_olas_mcp_por_cliente.md · Ola 2.1). El scope mapping de Authentik queda
como defensa en profundidad OPCIONAL (se puede crear manualmente en la UI;
el token del backend no tiene permiso sobre property_mappings).

Flujo (idempotente):
  provision_mcp_app(cliente) -> dict {ok, mcp_app_id, client_id, client_secret,
                                      mcp_url, group_name, detail}

Uso de la Admin API (verificado en producción):
  POST  /core/groups/           -> crea grupo (pk UUID)
  PATCH /core/groups/<pk>/      -> {"users": [<pk>,...]}  (membresía)
  POST  /providers/oauth2/      -> crea provider (client_id/secret)
  POST  /core/applications/     -> crea app (slug, provider)
  DELETE /core/applications/<slug>/ , /providers/oauth2/<pk>/  (de-provision)

Fail-safe: si no hay AUTHENTIK_API_URL/TOKEN configurados, devuelve error claro
sin romper el alta del cliente en la consola.
=====================================================================
"""
from __future__ import annotations

import logging
import uuid
from typing import Any

import httpx

log = logging.getLogger(__name__)

# Flujos por defecto de Authentik (verificados en producción).
_AUTHZ_FLOW_UID = "ee68afe7-3e0a-488b-a05c-659ce1d4c480"
_INVALIDATION_FLOW_UID = "ebea0ed1-2595-4073-86d3-4e3033c0e373"
_REDIRECT_CLAUDE = "https://claude.ai/api/mcp/auth_callback"

# Prefijo canónico de grupos de cliente (lo usan sync_groups y el kill-switch).
GROUP_PREFIX = "mcp-cliente-"


def _base_url() -> str:
    import os

    return (os.environ.get("AUTHENTIK_API_URL") or "").rstrip("/")


def _token() -> str:
    import os

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
        log.warning("authentik_provisioning: AUTHENTIK_API_URL/TOKEN no configurados.")
        return None
    return httpx.Client(base_url=_base_url(), headers=_headers(), timeout=15.0)


def _slugify(razon_social: str, cliente_id: str | None = None) -> str:
    import re

    s = (razon_social or "").strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    if len(s) > 40:
        s = s[:40].rstrip("-")
    if not s and cliente_id:
        s = str(cliente_id).replace("-", "")[:12]
    return s or "cliente"


def group_name(cliente_id: str, razon_social: str | None = None) -> str:
    return f"{GROUP_PREFIX}{_slugify(razon_social, cliente_id)}"


def provider_name(cliente_id: str, razon_social: str | None = None) -> str:
    return f"mcp-provider-{_slugify(razon_social, cliente_id)}"


def app_slug(cliente_id: str, razon_social: str | None = None) -> str:
    return f"mcp-{_slugify(razon_social, cliente_id)}"


def _find(c: httpx.Client, path: str, name: str) -> dict | None:
    r = c.get(path, params={"name": name})
    if r.status_code != 200:
        return None
    results = (r.json() or {}).get("results") or []
    return results[0] if results else None


def _ensure_group(c: httpx.Client, name: str) -> dict | None:
    existing = _find(c, "/core/groups/", name)
    if existing:
        return existing
    r = c.post("/core/groups/", json={"name": name, "is_superuser": False})
    if r.status_code not in (200, 201):
        log.warning("authentik create group(%s): HTTP %s %s", name, r.status_code, r.text[:200])
        return None
    return r.json()


def _group_user_pks(c: httpx.Client, group_pk) -> set[int]:
    r = c.get(f"/core/groups/{group_pk}/")
    if r.status_code != 200:
        return set()
    return {int(u) for u in ((r.json() or {}).get("users") or []) if u}


def _set_group_users(c: httpx.Client, group_pk, user_pks: set[int]) -> bool:
    r = c.patch(f"/core/groups/{group_pk}/", json={"users": sorted(user_pks)})
    if r.status_code not in (200, 204):
        log.warning("authentik set users(%s): HTTP %s", group_pk, r.status_code)
        return False
    return True


def _ensure_provider(c: httpx.Client, name: str) -> dict | None:
    """Crea/obtiene el provider OAuth2. Devuelve dict con pk, client_id, secret."""
    existing = _find(c, "/providers/oauth2/", name)
    if existing:
        return existing
    r = c.post("/providers/oauth2/", json={
        "name": name,
        "authorization_flow": _AUTHZ_FLOW_UID,
        "invalidation_flow": _INVALIDATION_FLOW_UID,
        "redirect_uris": [{"matching_mode": "strict", "url": _REDIRECT_CLAUDE}],
        "access_token_validity": "minutes=10",
        "refresh_token_validity": "days=30",
        "client_type": "confidential",
    })
    if r.status_code not in (200, 201):
        log.warning("authentik create provider(%s): HTTP %s %s", name, r.status_code, r.text[:300])
        return None
    return r.json()


def _ensure_application(c: httpx.Client, slug: str, name: str, provider_pk) -> dict | None:
    existing = _find(c, "/core/applications/", slug) if False else None
    # application se busca por slug (único), no por name.
    r_exist = c.get("/core/applications/", params={"slug": slug})
    if r_exist.status_code == 200:
        results = (r_exist.json() or {}).get("results") or []
        if results:
            return results[0]
    r = c.post("/core/applications/", json={
        "name": name,
        "slug": slug,
        "provider": int(provider_pk) if isinstance(provider_pk, (int, float)) else provider_pk,
    })
    if r.status_code not in (200, 201):
        log.warning("authentik create application(%s): HTTP %s %s", slug, r.status_code, r.text[:300])
        return None
    return r.json()


def provision_mcp_app(cliente) -> dict[str, Any]:
    """Ola 3 · 3.2 — crea/actualiza la app MCP del cliente en Authentik.

    Args:
      cliente: instancia de apps.clientes.models.Cliente (tiene id, razon_social).

    Returns:
      dict con:
        ok, detail,
        group_name, provider_name, app_slug,
        authentik_application_uid, authentik_provider_pk,
        oauth_client_id, oauth_client_secret,
        mcp_url  (se arma con el server_id pendiente de ContextForge — Ola 5)
    """
    c = _client()
    if c is None:
        return {"ok": False, "detail": "Authentik no configurado (AUTHENTIK_API_URL/TOKEN)."}
    cid = str(cliente.id)
    razon = cliente.razon_social or ""
    gname = group_name(cid, razon)
    pname = provider_name(cid, razon)
    slug = app_slug(cid, razon)
    try:
        with c:
            # 1. Grupo
            grp = _ensure_group(c, gname)
            if not grp:
                return {"ok": False, "detail": f"no se pudo crear grupo {gname}"}
            # 2. Provider (client_id/secret)
            prov = _ensure_provider(c, pname)
            if not prov:
                return {"ok": False, "detail": f"no se pudo crear provider {pname}"}
            # 3. Application
            app = _ensure_application(c, slug, pname, prov["pk"])
            if not app:
                return {"ok": False, "detail": f"no se pudo crear application {slug}"}
            # 4. Persistir en core.mcp_app
            from apps.core.models import McpApp

            existing = McpApp.objects.filter(cliente_id=cliente.id).first()
            mcp_app, _created = McpApp.objects.update_or_create(
                cliente_id=cliente.id,
                defaults={
                    "id": existing.id if existing else uuid.uuid4(),
                    "slug": slug,
                    "nombre": razon or cid,
                    "authentik_application_uid": app.get("pk"),
                    "authentik_provider_pk": prov.get("pk"),
                    "oauth_client_id": prov.get("client_id"),
                    "oauth_client_secret": prov.get("client_secret"),
                    "estado": "PROVISIONED",
                },
            )
            return {
                "ok": True,
                "detail": "app MCP provisionada",
                "group_name": gname,
                "provider_name": pname,
                "app_slug": slug,
                "authentik_application_uid": str(app.get("pk")) if app.get("pk") else None,
                "authentik_provider_pk": prov.get("pk"),
                "oauth_client_id": prov.get("client_id"),
                "oauth_client_secret": prov.get("client_secret"),
                "mcp_url": mcp_app.mcp_url,
            }
    except Exception as e:  # noqa: BLE001 - fail-safe
        log.exception("authentik_provisioning error cliente=%s: %s", cid, e)
        return {"ok": False, "detail": str(e)}


def sync_cliente_group_members(cliente) -> dict[str, Any]:
    """Ola 3 · 3.1/3.4 — sincroniza los usuarios del cliente en su grupo.

    Replica en Authentik la membresía: todos los usuarios cuyo legal_entity_ids
    contiene el cliente pasan a formar parte del grupo mcp-cliente-<slug>.
    Usado al cambiar legal_entity_ids de un usuario o al provisionar.
    """
    c = _client()
    if c is None:
        return {"ok": False, "detail": "Authentik no configurado."}
    cid = str(cliente.id)
    gname = group_name(cid, cliente.razon_social or "")
    try:
        with c:
            grp = _ensure_group(c, gname)
            if not grp:
                return {"ok": False, "detail": f"grupo {gname} no creado"}
            # pks de Authentik de los usuarios asociados
            from django.db import connection as _conn

            with _conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT email_plain
                      FROM users.mwtuser
                     WHERE %s = ANY(legal_entity_ids)
                       AND is_active = TRUE
                    """,
                    [str(cid)],
                )
                emails = [row[0] for row in cur.fetchall() if row[0]]
            wanted: set[int] = set()
            for em in emails:
                user = None
                r = c.get("/core/users/", params={"email": (em or "").strip().lower()})
                if r.status_code == 200:
                    results = (r.json() or {}).get("results") or []
                    user = results[0] if results else None
                if user:
                    wanted.add(int(user["pk"]))
            current = _group_user_pks(c, grp["pk"])
            if wanted != current:
                _set_group_users(c, grp["pk"], wanted)
            return {"ok": True, "group_name": gname, "members": len(wanted)}
    except Exception as e:  # noqa: BLE001
        log.exception("sync_cliente_group_members error: %s", e)
        return {"ok": False, "detail": str(e)}


def deprovision_mcp_app(cliente) -> dict[str, Any]:
    """Ola 3 · 3.4 — kill-switch: deshabilita/revoca la app MCP del cliente.

    Acciones:
      1. DELETE application (o PATCH is_active=False si la API lo soporta).
      2. DELETE provider (revoca refresh tokens y client_id/secret).
      3. No borra el grupo (queda la membresía; se purga al reactivar).
    """
    c = _client()
    if c is None:
        return {"ok": False, "detail": "Authentik no configurado."}
    cid = str(cliente.id)
    slug = app_slug(cid, cliente.razon_social or "")
    try:
        from apps.core.models import McpApp

        mcp_app = McpApp.objects.filter(cliente_id=cliente.id).first()
        provider_pk = mcp_app.authentik_provider_pk if mcp_app else None
        with c:
            # Deshabilitar application (DELETE soft en Authentik deja la app con is_active=False)
            r_app = c.patch(f"/core/applications/{slug}/", json={"is_active": False})
            if r_app.status_code not in (200, 204):
                log.warning("deprovision app(%s): HTTP %s", slug, r_app.status_code)
            # Revocar provider (borra refresh tokens y credenciales OAuth)
            if provider_pk:
                r_prov = c.delete(f"/providers/oauth2/{provider_pk}/")
                if r_prov.status_code not in (200, 204):
                    log.warning("deprovision provider(%s): HTTP %s", provider_pk, r_prov.status_code)
            if mcp_app:
                mcp_app.estado = "DEPROVISIONED"
                mcp_app.save(update_fields=["estado", "updated_at"])
            return {"ok": True, "detail": "app MCP deshabilitada y provider revocado", "app_slug": slug}
    except Exception as e:  # noqa: BLE001
        log.exception("deprovision_mcp_app error cliente=%s: %s", cid, e)
        return {"ok": False, "detail": str(e)}


def delete_mcp_app(cliente) -> dict[str, Any]:
    """Ola 3 · 3.4 — borrado COMPLETO de la app MCP del cliente.

    Difiere de `deprovision_mcp_app` (kill-switch reversible) en que esto
    ELIMINA la app, provider y grupo de Authentik y el registro de core.mcp_app.
    Se usa al ELIMINAR un cliente (destroy).

    Acciones:
      1. DELETE application (si existe).
      2. DELETE provider (revoca refresh tokens y credenciales OAuth).
      3. DELETE grupo mcp-cliente-<slug> (si existe).
      4. DELETE registro en core.mcp_app.
    """
    c = _client()
    if c is None:
        return {"ok": False, "detail": "Authentik no configurado."}
    cid = str(cliente.id)
    slug = app_slug(cid, cliente.razon_social or "")
    gname = group_name(cid, cliente.razon_social or "")
    try:
        from apps.core.models import McpApp

        mcp_app = McpApp.objects.filter(cliente_id=cliente.id).first()
        provider_pk = mcp_app.authentik_provider_pk if mcp_app else None
        with c:
            # 1. Borrar application (DELETE completo)
            r_app = c.delete(f"/core/applications/{slug}/")
            if r_app.status_code not in (200, 204):
                log.warning("delete app(%s): HTTP %s", slug, r_app.status_code)
            # 2. Borrar provider (revoca tokens)
            if provider_pk:
                r_prov = c.delete(f"/providers/oauth2/{provider_pk}/")
                if r_prov.status_code not in (200, 204):
                    log.warning("delete provider(%s): HTTP %s", provider_pk, r_prov.status_code)
            # 3. Borrar grupo (si quedó huérfano)
            grp = _find(c, "/core/groups/", gname)
            if grp:
                r_grp = c.delete(f"/core/groups/{grp['pk']}/")
                if r_grp.status_code not in (200, 204):
                    log.warning("delete group(%s): HTTP %s", gname, r_grp.status_code)
            # 4. Borrar registro local
            if mcp_app:
                mcp_app.delete()
            return {"ok": True, "detail": "app MCP eliminada por completo", "app_slug": slug}
    except Exception as e:  # noqa: BLE001
        log.exception("delete_mcp_app error cliente=%s: %s", cid, e)
        return {"ok": False, "detail": str(e)}


def sync_mcp_app_after_update(cliente, estado_prev: str | None = None,
                              razon_prev: str | None = None) -> dict[str, Any]:
    """Ola 3 · 3.4 — sincroniza la app MCP tras editar el cliente.

    Reglas (ciclo de vida automático crear/editar/eliminar):
      · estado -> ACTIVO: si no había app (o estaba DEPROVISIONED), provisiona.
      · estado -> INACTIVO/BLOQUEADO/PAUSADO: kill-switch (deshabilita + revoca).
      · razon_social cambió: actualiza el nombre del registro local (el slug
        del provider/grupo se mantiene por estabilidad; el nombre visible sí
        se refresca).
    """
    cid = str(cliente.id)
    estado = (cliente.estado or "ACTIVO").upper()
    from apps.core.models import McpApp

    mcp_app = McpApp.objects.filter(cliente_id=cliente.id).first()

    # Cambio de estado a inactivo/bloqueado/pausado -> kill-switch
    if estado in ("INACTIVO", "BLOQUEADO", "PAUSADO"):
        if mcp_app and mcp_app.estado != "DEPROVISIONED":
            res = deprovision_mcp_app(cliente)
            log.info("sync_mcp_app: cliente %s → %s (kill-switch) %s", cid, estado, res.get("detail"))
            return res
        return {"ok": True, "detail": f"cliente {estado}; sin app activa", "app_slug": None}

    # Estado ACTIVO (o sin estado): asegurar app provisionada
    if not mcp_app or mcp_app.estado != "PROVISIONED":
        res = provision_mcp_app(cliente)
        if not res.get("ok"):
            log.warning("sync_mcp_app: re-provision falló para %s: %s", cid, res.get("detail"))
        return res

    # Ya provisionada: solo refrescar el nombre visible si cambió la razón
    if mcp_app and razon_prev and cliente.razon_social and cliente.razon_social != razon_prev:
        mcp_app.nombre = cliente.razon_social
        mcp_app.save(update_fields=["nombre", "updated_at"])
    return {"ok": True, "detail": "app MCP ya provisionada; sin cambios", "app_slug": mcp_app.slug}
