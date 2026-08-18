"""Tests de la Ola 2 — MCP por cliente (modo cliente quemado).

Cubre:
  2.1 Resolución del cliente por request (Tenant / identity).
  2.2 Vars de entorno del config.
  2.3 Middleware: captura X-MWT-Client-ID + validación X-MWT-Gateway-Key.
  2.4 verify_tenant: TENANT_MISMATCH / TENANT_SCOPE_VACIO (incl. admin).
  2.5 Guard anti-bypass: tools globales ocultas en app de cliente.
  2.6 El mint envía client_id al backend.
  2.7 Caché enrich por (email|cliente) sin contaminación cross-tenant.
  2.8 TTL del token a 10 min en apps de cliente.
"""
from __future__ import annotations

from unittest import mock

import pytest

from mwt_mcp import jwt_minter, tool_rbac, enrich
from mwt_mcp.identity import Identity, Tenant, set_tenant, current_tenant
from mwt_mcp.asgi_middleware import IdentityPropagationMiddleware
from mwt_mcp.config import settings

SONDEL_ID = "c588c410-468a-4d54-b676-3bec174eb39d"
COMTEK_ID = "88888888-0000-4000-8000-000000000010"


class _FakeIdentity:
    def __init__(self, email="usuario@mwt.one", is_present=True):
        self.email = email
        self.user_id = None
        self.is_present = is_present


class _FakeResp:
    def __init__(self, status=200, payload=None, text="ok"):
        self.status_code = status
        self._payload = payload
        self.text = text

    def json(self):
        return self._payload


# ─────────────────────────────────────────────────────────────────────
# 2.1 / 2.2 — Tenant y resolución del cliente
# ─────────────────────────────────────────────────────────────────────
def test_tenant_scoped_desde_header():
    t = Tenant(client_id=SONDEL_ID, client_name="Sondel S.A.")
    assert t.is_scoped is True
    assert t.client_id == SONDEL_ID
    assert t.label == "Sondel S.A."
    assert t.is_global is False


def test_tenant_global_por_defecto():
    t = Tenant()
    assert t.is_scoped is False
    assert t.is_global is True
    assert t.label == "(global)"


def test_tenant_contextvar_set_current():
    set_tenant(Tenant(client_id=SONDEL_ID))
    assert current_tenant().client_id == SONDEL_ID
    # reset para no contaminar otros tests
    set_tenant(Tenant())


# ─────────────────────────────────────────────────────────────────────
# 2.4 — verify_tenant
# ─────────────────────────────────────────────────────────────────────
def test_verify_tenant_ok_sondel():
    set_tenant(Tenant(client_id=SONDEL_ID))
    user = {"legal_entity_ids": [SONDEL_ID, "otro-uuid"]}
    assert jwt_minter.verify_tenant(user) is None
    set_tenant(Tenant())


def test_verify_tenant_mismatch():
    set_tenant(Tenant(client_id=SONDEL_ID, client_name="Sondel S.A."))
    user = {"legal_entity_ids": [COMTEK_ID]}
    err = jwt_minter.verify_tenant(user)
    assert err == "TENANT_MISMATCH"
    set_tenant(Tenant())


def test_verify_tenant_scope_vacio():
    set_tenant(Tenant(client_id=SONDEL_ID))
    assert jwt_minter.verify_tenant(None) == "TENANT_SCOPE_VACIO"
    assert jwt_minter.verify_tenant({"legal_entity_ids": []}) == "TENANT_SCOPE_VACIO"
    set_tenant(Tenant())


def test_verify_tenant_admin_tambien_verifica():
    """Un admin (con legal_entity_ids ajeno) conectado a app de cliente falla."""
    set_tenant(Tenant(client_id=SONDEL_ID))
    user = {"role": "admin", "legal_entity_ids": [COMTEK_ID]}
    assert jwt_minter.verify_tenant(user) == "TENANT_MISMATCH"
    set_tenant(Tenant())


def test_verify_tenant_modo_global_no_restriccion():
    set_tenant(Tenant())  # global/admin
    assert jwt_minter.verify_tenant({"legal_entity_ids": []}) is None
    assert jwt_minter.verify_tenant(None) is None


def test_mint_and_cache_rechaza_tenant_mismatch(monkeypatch):
    """Fail-closed: identidad sin pertenencia → IdentityMintingError."""
    set_tenant(Tenant(client_id=SONDEL_ID, client_name="Sondel S.A."))
    jwt_minter._cache.clear()
    monkeypatch.setattr(jwt_minter, "_mint_from_backend",
                        lambda identity: {"access": "eyJ.tok",
                                          "user": {"role": "client_b2b",
                                                   "legal_entity_ids": [COMTEK_ID]}})
    with pytest.raises(jwt_minter.IdentityMintingError) as exc:
        jwt_minter._mint_and_cache(_FakeIdentity("a@b.c"))
    assert "TENANT_MISMATCH" in str(exc.value)
    set_tenant(Tenant())


def test_mint_and_cache_ok_sondel(monkeypatch):
    set_tenant(Tenant(client_id=SONDEL_ID))
    jwt_minter._cache.clear()
    monkeypatch.setattr(jwt_minter, "_mint_from_backend",
                        lambda identity: {"access": "eyJ.tok",
                                          "user": {"role": "client_b2b",
                                                   "legal_entity_ids": [SONDEL_ID]}})
    out = jwt_minter._mint_and_cache(_FakeIdentity("logistica2@sondelsa.com"))
    assert out["token"] == "eyJ.tok"
    set_tenant(Tenant())


# ─────────────────────────────────────────────────────────────────────
# 2.6 — el mint envía client_id al backend
# ─────────────────────────────────────────────────────────────────────
def test_mint_from_backend_envia_client_id(monkeypatch):
    set_tenant(Tenant(client_id=SONDEL_ID))
    captured = {}

    class _FakeClient:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, json=None, headers=None):
            captured["json"] = json
            return _FakeResp(200, {"access": "tok", "user": {}})

    monkeypatch.setattr(jwt_minter.httpx, "Client", _FakeClient)
    monkeypatch.setattr(jwt_minter, "_service_auth_header",
                        lambda: {"Authorization": "ServiceToken svc"})
    monkeypatch.setattr(jwt_minter.settings, "api_base", "https://x/api")

    jwt_minter._mint_from_backend(_FakeIdentity("a@b.c"))
    assert captured["json"].get("client_id") == SONDEL_ID
    set_tenant(Tenant())


def test_mint_from_backend_sin_tenant_no_client_id(monkeypatch):
    set_tenant(Tenant())  # global
    captured = {}

    class _FakeClient:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, json=None, headers=None):
            captured["json"] = json
            return _FakeResp(200, {"access": "tok", "user": {}})

    monkeypatch.setattr(jwt_minter.httpx, "Client", _FakeClient)
    monkeypatch.setattr(jwt_minter, "_service_auth_header",
                        lambda: {"Authorization": "ServiceToken svc"})
    monkeypatch.setattr(jwt_minter.settings, "api_base", "https://x/api")

    jwt_minter._mint_from_backend(_FakeIdentity("a@b.c"))
    assert "client_id" not in captured["json"]
    set_tenant(Tenant())


# ─────────────────────────────────────────────────────────────────────
# 2.3 — Middleware ASGI: gateway key + client header
# ─────────────────────────────────────────────────────────────────────
def test_middleware_captura_client_id():
    import asyncio
    from mwt_mcp.identity import current_identity as _ci

    seen = {}

    async def fake_app(scope, receive, send):
        seen["tenant"] = current_tenant()
        seen["email"] = _ci().email
        return None

    mw = IdentityPropagationMiddleware(fake_app)
    asyncio.run(mw(scope_with_headers({
        "x-mwt-client-id": SONDEL_ID,
        "x-forwarded-user-email": "logistica2@sondelsa.com",
    }), None, None))
    assert seen["tenant"].client_id == SONDEL_ID
    assert seen["tenant"].gateway_ok is True
    assert seen["email"] == "logistica2@sondelsa.com"
    set_tenant(Tenant())


def test_middleware_gateway_key_no_coincide_ignora_identidad():
    import asyncio
    from mwt_mcp.identity import current_identity as _ci

    settings.gateway_key = "super-secreto"
    seen = {}

    async def fake_app(scope, receive, send):
        seen["tenant"] = current_tenant()
        seen["email"] = _ci().email
        return None

    mw = IdentityPropagationMiddleware(fake_app)
    asyncio.run(mw(scope_with_headers({
        "x-mwt-client-id": SONDEL_ID,
        "x-mwt-gateway-key": "incorrecto",
        "x-forwarded-user-email": "logistica2@sondelsa.com",
    }), None, None))
    # Identidad NO se confía: email queda vacío.
    assert seen["email"] is None
    assert seen["tenant"].gateway_ok is False
    settings.gateway_key = ""
    set_tenant(Tenant())


def test_middleware_gateway_key_ok_mantiene_identidad():
    import asyncio
    from mwt_mcp.identity import current_identity as _ci

    settings.gateway_key = "super-secreto"
    seen = {}

    async def fake_app(scope, receive, send):
        seen["tenant"] = current_tenant()
        seen["email"] = _ci().email
        return None

    mw = IdentityPropagationMiddleware(fake_app)
    asyncio.run(mw(scope_with_headers({
        "x-mwt-client-id": SONDEL_ID,
        "x-mwt-gateway-key": "super-secreto",
        "x-forwarded-user-email": "logistica2@sondelsa.com",
    }), None, None))
    assert seen["email"] == "logistica2@sondelsa.com"
    assert seen["tenant"].gateway_ok is True
    settings.gateway_key = ""
    set_tenant(Tenant())


async def _fake_app(scope, receive, send):
    return None


def scope_with_headers(headers: dict) -> dict:
    import json

    h = [(k.encode(), v.encode()) for k, v in headers.items()]
    return {"type": "http", "headers": h}


# ─────────────────────────────────────────────────────────────────────
# 2.5 — Guard anti-bypass: tools globales ocultas en app de cliente
# ─────────────────────────────────────────────────────────────────────
def test_allowed_tool_names_oculta_globales_en_cliente():
    set_tenant(Tenant(client_id=SONDEL_ID))
    user = {
        "permissions": {
            "modules": ["roles", "expedientes", "clientes"],
            "actions": ["roles.view", "expedientes.view", "clientes.view"],
        }
    }
    allowed = tool_rbac.allowed_tool_names(user)
    assert allowed is not None
    # Ola 6 · app por cliente: catálogo completo (todas las tools) salvo las
    # de gobernanza interna MWT. El aislamiento de datos vive en el backend.
    assert "mwt_diag_scope" not in allowed
    assert "mwt_audit_write_registry" not in allowed
    assert "expediente_obtener" in allowed
    assert "cliente_crear" in allowed  # catálogo completo, no solo el rol
    assert len(allowed) == len(tool_rbac.TOOL_MODULES) - len(tool_rbac._GLOBAL_ONLY_TOOLS)
    set_tenant(Tenant())


def test_allowed_tool_names_modo_global_mantiene_diag():
    set_tenant(Tenant())
    user = {
        "permissions": {
            "modules": ["roles", "expedientes"],
            "actions": ["roles.view", "expedientes.view"],
        }
    }
    allowed = tool_rbac.allowed_tool_names(user)
    assert "mwt_diag_scope" in allowed  # global: el diag es del operador MWT
    set_tenant(Tenant())


# ─────────────────────────────────────────────────────────────────────
# 2.7 — Caché enrich por (email | cliente)
# ─────────────────────────────────────────────────────────────────────
def test_enrich_cache_namespaced_por_tenant():
    enrich._client_cache.clear()
    enrich._client_cache_exp.clear()

    # Usuario A del cliente Sondel resuelve nombres.
    set_tenant(Tenant(client_id=SONDEL_ID))
    from mwt_mcp import client as api
    with mock.patch.object(api, "get", return_value={"empresas": [
        {"id": SONDEL_ID, "nombre": "Sondel", "razon_social": "Sondel S.A."},
    ]}):
        enrich._resolver()
    k_sondel = enrich._cache_key()
    assert enrich._client_cache[k_sondel][SONDEL_ID] == "Sondel"

    # Usuario B del cliente Comtek: caché separada, sin fuga.
    set_tenant(Tenant(client_id=COMTEK_ID))
    with mock.patch.object(api, "get", return_value={"empresas": [
        {"id": COMTEK_ID, "nombre": "Comtek", "razon_social": "Comtek"},
    ]}):
        enrich._resolver()
    k_comtek = enrich._cache_key()
    assert k_comtek != k_sondel
    assert enrich._client_cache[k_comtek].get(SONDEL_ID) is None
    assert enrich._client_cache[k_comtek][COMTEK_ID] == "Comtek"

    set_tenant(Tenant())
    enrich._client_cache.clear()
    enrich._client_cache_exp.clear()


# ─────────────────────────────────────────────────────────────────────
# 2.8 — TTL del token reducido en apps de cliente
# ─────────────────────────────────────────────────────────────────────
def test_token_ttl_10min_en_app_cliente():
    set_tenant(Tenant(client_id=SONDEL_ID))
    assert jwt_minter._token_ttl_seconds() == 10 * 60
    set_tenant(Tenant())


def test_token_ttl_45min_modo_global():
    set_tenant(Tenant())
    assert jwt_minter._token_ttl_seconds() == 45 * 60
