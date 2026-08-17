"""
=====================================================================
MWT.ONE · tests/test_ola1_mcp_scoping.py
Ola 1 — Aislamiento por cliente (la caja fuerte)

Cubre:
  1.1 get_user respeta el claim legal_entity_ids del JWT MCP.
  1.2 Guard anti-bypass: un admin con token MCP scopeado NO bypasea.
  1.3 Mint verifica Cliente.estado/is_active (desactivar corta acceso).
  1.4 Brechas P0 cerradas: transfers, commercial, clientes.
  1.5 Modelo McpApp (tabla core.mcp_app).
=====================================================================
"""
from __future__ import annotations

import uuid

import pytest

from apps.clientes.models import Cliente
from apps.core.jwt_auth import MwtUser, _active_client_ids
from apps.core.scoped_querysets import is_bypass, _scope_ids, _is_bypass
from apps.core.models import McpApp
from apps.core.auth_views import _active_client_ids_scope
from tests.factories import ClienteModelFactory


# ─────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────
def _mcp_client_user(cliente_id: str, role: str = "manager") -> MwtUser:
    """Usuario como lo construiría get_user con un token MCP (claim scope).

    Rol interno no-bypass (manager) que SÍ tiene `clientes.view` en la matriz
    real de core.roles — el `client_b2b` no tiene módulo clientes y daría 403
    de RBAC antes del scope-check (comportamiento correcto).
    """
    return MwtUser(
        user_id=str(uuid.uuid4()),
        email="qa-mcp@mwt.test",
        role=role,
        permissions={"modules": ["expedientes", "clientes", "productos"]},
        is_active=True,
        legal_entity_ids=[str(cliente_id)],
        mcp_scoped=True,
        tenant_id=str(cliente_id),
    )


def _staff_user() -> MwtUser:
    """Admin normal (login de consola, sin scope MCP) — bypasea."""
    return MwtUser(
        user_id=str(uuid.uuid4()),
        email="qa-admin@mwt.test",
        role="admin",
        permissions={"modules": ["*"]},
        is_active=True,
        legal_entity_ids=[],
    )


# ═════════════════════════════════════════════════════════════════
# 1.1 — get_user respeta claim legal_entity_ids del JWT MCP
# ═════════════════════════════════════════════════════════════════
def test_mcp_user_scope_se_fija_desde_claim():
    """Un token MCP con legal_entity_ids del claim produce un MwtUser con
    ese scope (tenant quemado), no el scope del email."""
    cid = str(uuid.uuid4())
    u = _mcp_client_user(cid)
    assert u.mcp_scoped is True
    assert u.tenant_id == cid
    assert _scope_ids(u) == [cid.lower()]


def test_mcp_user_scope_vacio_es_fail_closed():
    """Token MCP con scope vacío → sin tenant, pero mcp_scoped evita bypass."""
    u = MwtUser(
        user_id=str(uuid.uuid4()),
        role="client_b2b",
        legal_entity_ids=[],
        mcp_scoped=True,
        tenant_id=None,
    )
    assert u.mcp_scoped is True
    assert _scope_ids(u) == []


# ═════════════════════════════════════════════════════════════════
# 1.2 — Guard anti-bypass: admin scopeado NO bypasea (P0-6)
# ═════════════════════════════════════════════════════════════════
def test_admin_mcp_scopeado_no_bypasea():
    cid = str(uuid.uuid4())
    u = _mcp_client_user(cid, role="admin")
    # Es admin pero con token MCP scopeado → NO bypasea.
    assert is_bypass(u) is False
    assert _scope_ids(u) == [cid.lower()]


def test_admin_consola_si_bypasea():
    u = _staff_user()
    assert is_bypass(u) is True


def test_is_bypass_alias_mcp():
    """Backward-compat: el alias _is_bypass se comporta igual."""
    u = _mcp_client_user(str(uuid.uuid4()))
    assert _is_bypass(u) is False


# ═════════════════════════════════════════════════════════════════
# 1.3 — Mint verifica Cliente.estado/is_active (P0-7)
# ═════════════════════════════════════════════════════════════════
def test_active_client_ids_scope_filtra_inactivos():
    cliente = ClienteModelFactory.create(estado="ACTIVO", is_active=True)
    cliente_baja = ClienteModelFactory.create(estado="INACTIVO", is_active=False)
    out = _active_client_ids_scope([str(cliente.id), str(cliente_baja.id)])
    assert str(cliente.id) in out
    assert str(cliente_baja.id) not in out


def test_active_client_ids_solo_activos():
    cliente = ClienteModelFactory.create(estado="ACTIVO", is_active=True)
    out = _active_client_ids([str(cliente.id)])
    assert str(cliente.id) in out


def test_active_client_ids_cliente_eliminado_excluido():
    cliente = ClienteModelFactory.create(estado="ACTIVO", is_active=False)
    out = _active_client_ids([str(cliente.id)])
    assert str(cliente.id) not in out


# ═════════════════════════════════════════════════════════════════
# 1.4 — Brechas P0 cerradas (vistas)
# ═════════════════════════════════════════════════════════════════
@pytest.fixture
def dos_clientes():
    a = ClienteModelFactory.create(estado="ACTIVO", is_active=True)
    b = ClienteModelFactory.create(estado="ACTIVO", is_active=True)
    return a, b


def test_cliente_retrieve_fuera_de_scope_404(api_client, dos_clientes):
    """Un client_b2b del cliente A no ve el detalle del cliente B (B-BE-3)."""
    a, b = dos_clientes
    u = _mcp_client_user(str(a.id))
    api_client.force_authenticate(user=u, token={"role": "manager"})
    r = api_client.get(f"/api/clientes/{b.id}/")
    assert r.status_code == 404


def test_cliente_retrieve_en_scope_ok(api_client, dos_clientes):
    a, _b = dos_clientes
    u = _mcp_client_user(str(a.id))
    api_client.force_authenticate(user=u, token={"role": "manager"})
    r = api_client.get(f"/api/clientes/{a.id}/")
    assert r.status_code == 200
    assert r.json()["id"] == str(a.id)


def test_admin_ve_todos_los_clientes(api_client, dos_clientes):
    a, b = dos_clientes
    u = _staff_user()
    api_client.force_authenticate(user=u, token={"role": "admin"})
    r = api_client.get(f"/api/clientes/{b.id}/")
    assert r.status_code == 200


def test_admin_mcp_scopeado_no_ve_cliente_ajeno(api_client, dos_clientes):
    """Un admin conectado por app de cliente SOLO ve SU cliente (P0-6)."""
    a, b = dos_clientes
    u = _mcp_client_user(str(a.id), role="admin")
    api_client.force_authenticate(user=u, token={"role": "admin"})
    r = api_client.get(f"/api/clientes/{b.id}/")
    assert r.status_code == 404


def test_cliente_update_fuera_de_scope_404(api_client, dos_clientes):
    a, b = dos_clientes
    u = _mcp_client_user(str(a.id))
    api_client.force_authenticate(user=u, token={"role": "manager"})
    r = api_client.patch(f"/api/clientes/{b.id}/", {"razon_social": "hack"})
    assert r.status_code == 404


def test_cliente_destroy_fuera_de_scope_404(api_client, dos_clientes):
    a, b = dos_clientes
    u = _mcp_client_user(str(a.id))
    api_client.force_authenticate(user=u, token={"role": "manager"})
    r = api_client.delete(f"/api/clientes/{b.id}/")
    assert r.status_code == 404


# ═════════════════════════════════════════════════════════════════
# 1.4b — commercial: ?client_id= validado contra scope (P0-4)
# ═════════════════════════════════════════════════════════════════
def test_commercial_client_assignment_fuera_scope_vacio(api_client, dos_clientes):
    from tests.factories import ClientAssignmentModelFactory

    a, b = dos_clientes
    ClientAssignmentModelFactory.create(client_id=str(b.id), brand_sku="SKU-B")
    # Admin MCP-scopeado: RBAC wildcard pasa, pero el scope se fija a cliente A.
    u = _mcp_client_user(str(a.id), role="admin")
    api_client.force_authenticate(user=u, token={"role": "admin"})
    r = api_client.get(f"/api/commercial/client-assignments/?client_id={b.id}")
    assert r.status_code == 200
    body = r.json()
    assert body.get("count") == 0  # fail-closed: no ve asignaciones del cliente B


def test_commercial_client_assignment_en_scope_ok(api_client, dos_clientes):
    from tests.factories import ClientAssignmentModelFactory

    a, _b = dos_clientes
    ClientAssignmentModelFactory.create(client_id=str(a.id), brand_sku="SKU-A")
    u = _mcp_client_user(str(a.id), role="admin")
    api_client.force_authenticate(user=u, token={"role": "admin"})
    r = api_client.get(f"/api/commercial/client-assignments/?client_id={a.id}")
    assert r.status_code == 200
    results = r.json().get("results") or []
    assert len(results) == 1
    assert results[0]["brand_sku"] == "SKU-A"


# ═════════════════════════════════════════════════════════════════
# 1.5 — Modelo McpApp (tabla core.mcp_app)
# ═════════════════════════════════════════════════════════════════
def test_mcp_app_tabla_existe_y_persiste(dos_clientes):
    a, _b = dos_clientes
    app = McpApp.objects.create(
        id=uuid.uuid4(),
        cliente_id=a.id,
        slug="mcp-test-ola1",
        nombre="Cliente Test Ola1",
        oauth_client_id="test-client-id",
        mcp_url="https://mcp.mwt.one/servers/x/mcp",
        estado="PROVISIONED",
    )
    fetched = McpApp.objects.get(cliente_id=a.id)
    assert fetched.slug == "mcp-test-ola1"
    assert fetched.oauth_client_id == "test-client-id"
