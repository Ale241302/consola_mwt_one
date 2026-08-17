"""
=====================================================================
MWT.ONE · tests/test_ola3_mcp_app.py
Ola 3 — Apps MCP por cliente (provisionamiento Authentik + kill-switch)

Cubre:
  3.0 Matriz client_b2b con productos.read (regla del CEO).
  3.1 sync_groups (crea grupo + membresía) con Authentik mockeado.
  3.2 provision_mcp_app (grupo + provider + application + core.mcp_app).
  3.4 deprovision_mcp_app (kill-switch).
  Serializer: mcp_app expuesto con secret solo para staff.
=====================================================================
"""
from __future__ import annotations

import uuid

import pytest
from unittest import mock

from apps.clientes.models import Cliente
from apps.clientes import authentik_provisioning as prov
from apps.core.models import McpApp
from apps.core.jwt_auth import MwtUser
from tests.factories import ClienteModelFactory


SONDEL_ID = "c588c410-468a-4d54-b676-3bec174eb39d"
# UUID de prueba (nunca toca el Sondel real de la DB).
TEST_CLIENTE_UUID = "aaaaaaaa-1111-4222-8333-444455556666"


# ─────────────────────────────────────────────────────────────────────
# 3.0 — matriz client_b2b con productos.read
# ─────────────────────────────────────────────────────────────────────
def test_client_b2b_matriz_tiene_productos():
    """Tras H2, client_b2b tiene productos.can_read=True (regla del CEO)."""
    from apps.roles.models import RolePermission

    cell = RolePermission.objects.filter(
        role_slug="client_b2b", module_slug="productos"
    ).first()
    assert cell is not None
    assert cell.can_read is True
    assert cell.can_create is False
    assert cell.can_update is False
    assert cell.can_delete is False


# ─────────────────────────────────────────────────────────────────────
# Helpers de Authentik mockeado (no tocar red)
# ─────────────────────────────────────────────────────────────────────
class _FakeAKClient:
    """Simula la Admin API de Authentik en memoria."""

    def __init__(self, *a, **k):
        self.groups: dict[str, dict] = {}
        self.providers: dict[str, dict] = {}
        self.apps: dict[str, dict] = {}
        self._calls = []

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def get(self, path, params=None, **k):
        self._calls.append(("GET", path, params))
        if path == "/core/groups/":
            name = (params or {}).get("name")
            results = [g for g in self.groups.values() if g["name"] == name] if name else list(self.groups.values())
            return _Resp({"results": results})
        if path.startswith("/core/groups/"):
            pk = path.split("/")[-2]
            if pk in self.groups:
                return _Resp(self.groups[pk])
            return _Resp({}, 404)
        if path == "/providers/oauth2/":
            name = (params or {}).get("name")
            results = [p for p in self.providers.values() if p["name"] == name] if name else list(self.providers.values())
            return _Resp({"results": results})
        if path == "/core/applications/":
            slug = (params or {}).get("slug")
            results = [a for a in self.apps.values() if a["slug"] == slug] if slug else list(self.apps.values())
            return _Resp({"results": results})
        if path == "/core/users/":
            email = (params or {}).get("email", "")
            # mapear emails a pks deterministas
            pk = 100 + hash(email) % 1000 if email else None
            return _Resp({"results": [{"pk": pk, "email": email}]} if email else {"results": []})
        return _Resp({"results": []})

    def post(self, path, json=None, **k):
        self._calls.append(("POST", path, json))
        if path == "/core/groups/":
            g = {"pk": str(uuid.uuid4()), "name": json["name"], "users": json.get("users", [])}
            self.groups[g["pk"]] = g
            return _Resp(g, 201)
        if path == "/providers/oauth2/":
            p = {
                "pk": len(self.providers) + 1,
                "name": json["name"],
                "client_id": f"cid-{len(self.providers)+1}",
                "client_secret": f"secret-{len(self.providers)+1}",
            }
            self.providers[p["pk"]] = p
            return _Resp(p, 201)
        if path == "/core/applications/":
            a = {"pk": str(uuid.uuid4()), "name": json["name"], "slug": json["slug"], "provider": json["provider"], "is_active": True}
            self.apps[a["slug"]] = a
            return _Resp(a, 201)
        return _Resp({}, 404)

    def patch(self, path, json=None, **k):
        self._calls.append(("PATCH", path, json))
        if path.startswith("/core/groups/"):
            pk = path.split("/")[-2]
            if pk in self.groups:
                self.groups[pk]["users"] = json.get("users", [])
                return _Resp(self.groups[pk])
        if path.startswith("/core/applications/"):
            slug = path.split("/")[-2]
            if slug in self.apps:
                self.apps[slug].update(json or {})
                return _Resp(self.apps[slug])
        return _Resp({}, 404)

    def delete(self, path, **k):
        self._calls.append(("DELETE", path))
        if path.startswith("/providers/oauth2/"):
            pk = int(path.split("/")[-2])
            self.providers.pop(pk, None)
            return _Resp({}, 204)
        if path.startswith("/core/applications/"):
            slug = path.split("/")[-2]
            self.apps.pop(slug, None)
            return _Resp({}, 204)
        if path.startswith("/core/groups/"):
            pk = path.split("/")[-2]
            self.groups.pop(pk, None)
            return _Resp({}, 204)
        return _Resp({}, 204)


class _Resp:
    def __init__(self, data, status=200):
        self._data = data
        self.status_code = status

    def json(self):
        return self._data

    @property
    def text(self):
        import json as _j
        return _j.dumps(self._data)


@pytest.fixture
def ak_client():
    return _FakeAKClient()


@pytest.fixture
def cliente_sondel():
    c = ClienteModelFactory.create(
        id=uuid.UUID(TEST_CLIENTE_UUID),
        razon_social="Cliente Test Ola3",
        estado="ACTIVO",
        is_active=True,
    )
    return c


def _patch_client(monkeypatch, fake):
    monkeypatch.setattr(prov, "_client", lambda: fake)
    monkeypatch.setattr(prov, "_enabled", lambda: True)


# ─────────────────────────────────────────────────────────────────────
# 3.1 — sync_groups (membresía)
# ─────────────────────────────────────────────────────────────────────
def test_sync_groups_crea_grupo_y_membresia(monkeypatch, ak_client):
    _patch_client(monkeypatch, ak_client)
    from apps.users import authentik_sync as aus

    monkeypatch.setattr(aus, "_client", lambda: ak_client)
    result = aus.sync_groups("logistica2@sondelsa.com", [SONDEL_ID], {"x": "y"})
    assert result["ok"] is True
    assert len(result["groups"]) == 1
    gname = result["groups"][0]
    grp = next(iter(ak_client.groups.values()))
    assert grp["name"] == gname
    assert len(grp["users"]) >= 1  # el usuario fue añadido


# ─────────────────────────────────────────────────────────────────────
# 3.2 — provision_mcp_app
# ─────────────────────────────────────────────────────────────────────
def test_provision_mcp_app_crea_objetos(monkeypatch, ak_client, cliente_sondel):
    _patch_client(monkeypatch, ak_client)
    result = prov.provision_mcp_app(cliente_sondel)
    assert result["ok"] is True
    assert result["oauth_client_id"].startswith("cid-")
    assert result["oauth_client_secret"].startswith("secret-")
    assert len(ak_client.groups) >= 1
    assert len(ak_client.providers) >= 1
    assert len(ak_client.apps) >= 1
    # persistido en core.mcp_app
    app = McpApp.objects.filter(cliente_id=cliente_sondel.id).first()
    assert app is not None
    assert app.oauth_client_id == result["oauth_client_id"]
    assert app.estado == "PROVISIONED"


def test_provision_mcp_app_idempotente(monkeypatch, ak_client, cliente_sondel):
    _patch_client(monkeypatch, ak_client)
    r1 = prov.provision_mcp_app(cliente_sondel)
    r2 = prov.provision_mcp_app(cliente_sondel)
    assert r1["ok"] is True and r2["ok"] is True
    # No duplica: mismo provider/app (pk conservado), mismo registro mcp_app.
    assert r1["oauth_client_id"] == r2["oauth_client_id"]
    assert McpApp.objects.filter(cliente_id=cliente_sondel.id).count() == 1


# ─────────────────────────────────────────────────────────────────────
# 3.4 — deprovision (kill-switch)
# ─────────────────────────────────────────────────────────────────────
def test_deprovision_mcp_app_kill_switch(monkeypatch, ak_client, cliente_sondel):
    _patch_client(monkeypatch, ak_client)
    prov.provision_mcp_app(cliente_sondel)
    result = prov.deprovision_mcp_app(cliente_sondel)
    assert result["ok"] is True
    # provider eliminado (revocado)
    assert len(ak_client.providers) == 0
    # registro marcado DEPROVISIONED
    app = McpApp.objects.filter(cliente_id=cliente_sondel.id).first()
    assert app.estado == "DEPROVISIONED"


# ─────────────────────────────────────────────────────────────────────
# Serializer: mcp_app con secret solo para staff
# ─────────────────────────────────────────────────────────────────────
def _client_with_role(role):
    return _AuthenticatedClient(role)


class _AuthenticatedClient:
    def __init__(self, role):
        self.user = MwtUser(user_id=str(uuid.uuid4()), role=role, email=f"{role}@mwt.test")


def test_serializer_mcp_app_secret_solo_staff(monkeypatch, ak_client, cliente_sondel):
    from apps.clientes.serializers import ClienteSerializer

    prov.provision_mcp_app(cliente_sondel)
    staff_ctx = {"request": _AuthenticatedClient("admin")}
    nonstaff_ctx = {"request": _AuthenticatedClient("client_b2b")}

    s_staff = ClienteSerializer(cliente_sondel, context=staff_ctx)
    s_client = ClienteSerializer(cliente_sondel, context=nonstaff_ctx)
    assert s_staff.data["mcp_app"]["oauth_client_secret"] is not None
    assert s_client.data["mcp_app"]["oauth_client_secret"] is None


# ─────────────────────────────────────────────────────────────────────
# 3.4b — ciclo de vida automático (crear/editar/eliminar)
# ─────────────────────────────────────────────────────────────────────
def test_sync_after_update_kill_switch(monkeypatch, ak_client, cliente_sondel):
    """Editar un cliente a INACTIVO dispara el kill-switch (deshabilitar+revocar)."""
    _patch_client(monkeypatch, ak_client)
    prov.provision_mcp_app(cliente_sondel)
    assert McpApp.objects.filter(cliente_id=cliente_sondel.id).first().estado == "PROVISIONED"

    cliente_sondel.estado = "INACTIVO"
    cliente_sondel.save()
    result = prov.sync_mcp_app_after_update(cliente_sondel, estado_prev="ACTIVO")
    assert result["ok"] is True
    # provider revocado
    assert len(ak_client.providers) == 0
    # registro DEPROVISIONED
    assert McpApp.objects.filter(cliente_id=cliente_sondel.id).first().estado == "DEPROVISIONED"


def test_sync_after_update_reactiva(monkeypatch, ak_client, cliente_sondel):
    """Volver un cliente a ACTIVO re-provisiona la app."""
    _patch_client(monkeypatch, ak_client)
    prov.provision_mcp_app(cliente_sondel)
    prov.deprovision_mcp_app(cliente_sondel)
    assert McpApp.objects.filter(cliente_id=cliente_sondel.id).first().estado == "DEPROVISIONED"

    cliente_sondel.estado = "ACTIVO"
    cliente_sondel.save()
    result = prov.sync_mcp_app_after_update(cliente_sondel, estado_prev="INACTIVO")
    assert result["ok"] is True
    app = McpApp.objects.filter(cliente_id=cliente_sondel.id).first()
    assert app.estado == "PROVISIONED"
    assert app.oauth_client_id is not None


def test_delete_mcp_app_borra_todo(monkeypatch, ak_client, cliente_sondel):
    """Eliminar un cliente borra app + provider + grupo + registro local."""
    _patch_client(monkeypatch, ak_client)
    prov.provision_mcp_app(cliente_sondel)
    assert McpApp.objects.filter(cliente_id=cliente_sondel.id).count() == 1
    assert len(ak_client.providers) == 1
    assert len(ak_client.apps) == 1
    assert len(ak_client.groups) == 1

    result = prov.delete_mcp_app(cliente_sondel)
    assert result["ok"] is True
    assert len(ak_client.providers) == 0
    assert len(ak_client.apps) == 0
    assert len(ak_client.groups) == 0
    assert McpApp.objects.filter(cliente_id=cliente_sondel.id).count() == 0
