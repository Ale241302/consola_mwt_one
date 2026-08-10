"""Tests de la Ola 3.6 · auditoría durable + herramientas de diagnóstico.

Cubre:
  - `_persist_mcp_audit` (helpers): POST best-effort sin romper la tool,
    lanzado en un thread daemon, con timeout corto.
  - `mwt_whoami` enriquecido (server): adjunta el bloque mwt_rbac con las
    tools permitidas/ocultas según el perfil.
  - `mwt_diag_scope` (server): CEO-only (fail-closed para no-CEO).
"""
from __future__ import annotations

from unittest import mock

import pytest

from mwt_mcp import server
from mwt_mcp.helpers import _persist_mcp_audit


# ─────────────────────────────────────────────────────────────────────── #
# _persist_mcp_audit — best-effort, no bloquea, no rompe
# ─────────────────────────────────────────────────────────────────────── #
def test_persist_audit_no_rompe_si_backend_falla(monkeypatch):
    """Si el POST falla, no levanta excepción (best-effort)."""
    import httpx

    class _Boom:
        def __init__(self, *a, **k):  # noqa: ANN002, ANN003
            pass

        def __enter__(self):
            raise httpx.ConnectError("backend caído")

        def __exit__(self, *a):  # noqa: ANN002
            return False

    with mock.patch("mwt_mcp.helpers.httpx.Client", _Boom):
        with mock.patch("mwt_mcp.helpers.threading", _DummyThreading):
            _persist_mcp_audit("write", "cliente_crear", {"nombre": "x"}, True, 201, 12)


class _DummyThread:
    def __init__(self, target=None, daemon=False):  # noqa: ANN001
        self.target = target

    def start(self):
        try:
            self.target()
        except Exception:  # noqa: BLE001 - best-effort
            pass


class _DummyThreading:
    Thread = _DummyThread


def test_persist_audit_ejecuta_post_con_tiempo_corto():
    """Se construye un POST a /api/auth/mcp-audit/ con timeout de 3s."""
    captured = {}

    class _FakeResp:
        status_code = 200

    class _FakeClient:
        def __init__(self, *a, timeout=None, **k):  # noqa: ANN002, ANN003
            captured["timeout"] = timeout

        def __enter__(self):
            return self

        def __exit__(self, *a):  # noqa: ANN002
            return False

        def post(self, url, json=None, headers=None):  # noqa: ANN001
            captured["url"] = url
            captured["json"] = json
            captured["headers"] = headers
            return _FakeResp()

    with mock.patch("mwt_mcp.helpers.httpx.Client", _FakeClient):
        with mock.patch("mwt_mcp.helpers.threading", _DummyThreading):
            with mock.patch("mwt_mcp.jwt_minter._service_auth_header",
                            return_value={"Authorization": "ServiceToken test"}):
                _persist_mcp_audit("read", "expediente_obtener",
                                   {"expediente_id": "x"}, True, 200, 5)

    assert captured["url"].endswith("/auth/mcp-audit/")
    assert captured["timeout"] == 3.0
    assert captured["json"]["tool"] == "expediente_obtener"
    assert captured["json"]["event"] == "read"
    assert captured["json"]["http_status"] == 200


# ─────────────────────────────────────────────────────────────────────── #
# mwt_whoami enriquecido (D2)
# ─────────────────────────────────────────────────────────────────────── #
def test_mwt_whoami_adjunta_rbac_diag(monkeypatch):
    payload = {"id": "u1", "email": "a@b.c", "role": "admin"}
    monkeypatch.setattr(server.api, "get", lambda *a, **k: payload)
    monkeypatch.setattr(
        server,
        "get_identity_user",
        lambda: {"role": "admin", "permissions": {"modules": ["*"]}},
    )
    out = server.mwt_whoami()
    assert out["id"] == "u1"
    assert "mwt_rbac" in out
    # modules=["*"] -> todas las tools permitidas.
    assert out["mwt_rbac"]["total_ocultas"] == 0
    assert out["mwt_rbac"]["total_permitidas"] == len(server.TOOL_MODULES)


def test_mwt_whoami_error_no_rompe_rbac(monkeypatch):
    monkeypatch.setattr(server.api, "get", lambda *a, **k: {"error": True, "detail": "401"})
    out = server.mwt_whoami()
    assert out.get("error") is True


# ─────────────────────────────────────────────────────────────────────── #
# mwt_diag_scope (D5 · CEO-only)
# ─────────────────────────────────────────────────────────────────────── #
def test_diag_scope_rechaza_no_ceo(monkeypatch):
    monkeypatch.setattr(server, "get_identity_user", lambda: {"role": "client_b2b"})
    out = server.mwt_diag_scope(email="x@y.z")
    assert out.get("error") is True
    assert "CEO-only" in out["detail"]


def test_diag_scope_pide_email_o_user_id(monkeypatch):
    monkeypatch.setattr(server, "get_identity_user", lambda: {"role": "admin"})
    out = server.mwt_diag_scope()
    assert out.get("error") is True
    assert "email" in out["detail"]


def test_diag_scope_ok_cruza_rbac(monkeypatch):
    monkeypatch.setattr(server, "get_identity_user", lambda: {"role": "admin"})
    target = {
        "id": "u2",
        "email_plain": "alvaro@muitowork.com",
        "role_slug": "admin",
        "permissions": {"modules": ["expedientes"], "actions": ["expedientes.view"]},
        "legal_entity_ids": ["le-1"],
    }

    def _fake_post_service(path, body):
        assert path == "auth/mcp-diag/"
        assert body == {"email": "alvaro@muitowork.com"}
        return target

    monkeypatch.setattr(server.api, "post_service", _fake_post_service)
    out = server.mwt_diag_scope(email="alvaro@muitowork.com")
    assert out["email_plain"] == "alvaro@muitowork.com"
    assert "mwt_rbac" in out
    # Con modules=["expedientes"] y action view: solo tools expedientes.view + siempre-visibles.
    permitidas = set(out["mwt_rbac"]["tools_permitidas"])
    assert "expediente_obtener" in permitidas
    assert "expediente_crear" not in permitidas
    assert "cliente_crear" not in permitidas
    assert "mwt_whoami" in permitidas  # siempre visible


def test_diag_scope_passthrough_user_id(monkeypatch):
    monkeypatch.setattr(server, "get_identity_user", lambda: {"role": "ceo"})
    captured = {}

    def _fake_post_service(path, body):
        captured["body"] = body
        return {"id": "u3", "email_plain": "j@k.l", "role_slug": "ceo",
                "permissions": {"modules": ["*"]}, "legal_entity_ids": []}

    monkeypatch.setattr(server.api, "post_service", _fake_post_service)
    out = server.mwt_diag_scope(user_id="u3")
    assert captured["body"] == {"user_id": "u3"}
    assert out["mwt_rbac"]["total_ocultas"] == 0


# ─────────────────────────────────────────────────────────────────────── #
# client.post_service — firma con ServiceToken, no con JWT de usuario
# ─────────────────────────────────────────────────────────────────────── #
def test_post_service_firma_con_service_token(monkeypatch):
    from mwt_mcp import client

    captured = {}

    class _FakeResp:
        status_code = 200
        headers = {"content-type": "application/json"}

        def json(self):
            return {"saved": True}

    class _FakeClient:
        def __init__(self, *a, **k):  # noqa: ANN002, ANN003
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):  # noqa: ANN002
            return False

        def post(self, url, json=None, headers=None):  # noqa: ANN001
            captured["url"] = url
            captured["json"] = json
            captured["headers"] = headers
            return _FakeResp()

    monkeypatch.setattr(
        client,
        "_auth_headers",
        lambda: {"Authorization": "Bearer jwt-de-usuario"},  # NO debe usarse
    )
    monkeypatch.setattr(
        "mwt_mcp.jwt_minter._service_auth_header",
        lambda: {"Authorization": "ServiceToken abc"},
    )
    with monkeypatch.context() as m:
        m.setattr(client.httpx, "Client", _FakeClient)
        out = client.post_service("auth/mcp-diag/", {"email": "x@y.z"})

    assert out == {"saved": True}
    assert captured["headers"]["Authorization"] == "ServiceToken abc"
    assert "jwt-de-usuario" not in captured["headers"]["Authorization"]
