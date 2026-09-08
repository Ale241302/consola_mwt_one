"""Tests Fase 3 — DeviceToken (onboarding MCP por correo).

Cubre:
  - mint_from_backend envía {grant_secret, ip} (y NO email) al mcp-token.
  - La caché del JWT se ata a (secret + IP): otra IP NO reutiliza el token
    en caché → siempre va al backend (que hace el bind device).
  - Fail-closed con DeviceToken: backend sin access → IdentityMintingError.
  - Middleware ASGI captura `Authorization: DeviceToken <secret>` + IP real.
  - Sin gateway key válido el DeviceToken NO se confía (fail-closed).
"""
from __future__ import annotations

from unittest import mock

import pytest

from mwt_mcp import jwt_minter
from mwt_mcp.asgi_middleware import IdentityPropagationMiddleware
from mwt_mcp.config import settings
from mwt_mcp.identity import Identity, Tenant, current_identity, current_tenant, set_tenant

SECRET = "abc123device-secret-xyz"


class _DevIdentity:
    def __init__(self, secret=SECRET, ip="200.10.20.30", present=True):
        self.email = None
        self.user_id = None
        self.sub = None
        self.device_secret = secret if present else None
        self.device_ip = ip
        self.is_present = present


class _FakeResp:
    def __init__(self, status=200, payload=None):
        self.status_code = status
        self._payload = payload
        self.text = "ok"

    def json(self):
        return self._payload


def scope_with_headers(headers: dict) -> dict:
    h = [(k.encode(), v.encode()) for k, v in headers.items()]
    return {"type": "http", "headers": h}


# ── mint_from_backend: body {grant_secret, ip} ────────────────────────

def test_mint_devicetoken_envia_grant_secret_y_ip(monkeypatch):
    captured = {}

    class _FakeClient:
        def __init__(self, *a, **k):  # noqa: ANN002, ANN003
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):  # noqa: ANN002
            return False

        def post(self, url, json=None, headers=None):  # noqa: ANN001
            captured["json"] = json
            captured["url"] = url
            return _FakeResp(200, {"access": "eyJ.device.token", "user": {"role": "client_b2b"}})

    monkeypatch.setattr(jwt_minter.httpx, "Client", _FakeClient)
    monkeypatch.setattr(jwt_minter, "_service_auth_header",
                        lambda: {"Authorization": "ServiceToken svc"})
    monkeypatch.setattr(jwt_minter.settings, "api_base", "https://consola.mwt.one/api")

    out = jwt_minter._mint_from_backend(_DevIdentity(secret=SECRET, ip="200.10.20.30"))
    assert out["access"] == "eyJ.device.token"
    assert captured["url"].endswith("/auth/mcp-token/")
    assert captured["json"] == {"grant_secret": SECRET, "ip": "200.10.20.30"}


def test_mint_devicetoken_sin_ip_solo_grant_secret(monkeypatch):
    captured = {}

    class _FakeClient:
        def __init__(self, *a, **k):  # noqa: ANN002, ANN003
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):  # noqa: ANN002
            return False

        def post(self, url, json=None, headers=None):  # noqa: ANN001
            captured["json"] = json
            return _FakeResp(200, {"access": "tok", "user": {}})

    monkeypatch.setattr(jwt_minter.httpx, "Client", _FakeClient)
    monkeypatch.setattr(jwt_minter.settings, "api_base", "https://consola.mwt.one/api")
    monkeypatch.setattr(jwt_minter, "_service_auth_header",
                        lambda: {"Authorization": "ServiceToken svc"})

    jwt_minter._mint_from_backend(_DevIdentity(secret=SECRET, ip=""))
    assert captured["json"] == {"grant_secret": SECRET}


# ── caché atada a la IP ───────────────────────────────────────────────

def test_cache_devicetoken_por_secret_e_ip(monkeypatch):
    jwt_minter._cache.clear()
    llamadas = []

    def _fake_mint(identity):
        llamadas.append((identity.device_secret, identity.device_ip))
        return {"access": "eyJ.dev", "user": {"role": "client_b2b",
                                              "legal_entity_ids": []}}

    monkeypatch.setattr(jwt_minter, "_mint_from_backend", _fake_mint)
    monkeypatch.setattr(jwt_minter, "current_identity", lambda: _DevIdentity(secret=SECRET, ip="1.1.1.1"))

    t1 = jwt_minter.get_identity_token()
    t2 = jwt_minter.get_identity_token()   # misma IP → caché
    assert t1 == t2 == "eyJ.dev"
    assert len(llamadas) == 1

    # Otra IP (otro computador) → NO sirve caché → mint (el backend rechaza).
    monkeypatch.setattr(jwt_minter, "current_identity", lambda: _DevIdentity(secret=SECRET, ip="2.2.2.2"))
    jwt_minter.get_identity_token()
    assert len(llamadas) == 2
    assert llamadas[1] == (SECRET, "2.2.2.2")


def test_devicetoken_backend_ko_fail_closed(monkeypatch):
    jwt_minter._cache.clear()
    monkeypatch.setattr(jwt_minter, "current_identity", lambda: _DevIdentity(secret=SECRET, ip="1.1.1.1"))
    monkeypatch.setattr(jwt_minter, "_mint_from_backend", lambda identity: None)
    llamado_service = []
    monkeypatch.setattr(jwt_minter.settings, "require_token",
                        lambda: (llamado_service.append(1), "svc")[1])
    with pytest.raises(jwt_minter.IdentityMintingError):
        jwt_minter.get_identity_token()
    assert llamado_service == []  # NUNCA cae al ServiceToken


# ── middleware ASGI ───────────────────────────────────────────────────

def test_middleware_captura_devicetoken_y_ip():
    import asyncio

    seen = {}

    async def fake_app(scope, receive, send):
        ident = current_identity()
        seen["device_secret"] = ident.device_secret
        seen["device_ip"] = ident.device_ip
        seen["is_present"] = ident.is_present
        seen["tenant"] = current_tenant()
        return None

    mw = IdentityPropagationMiddleware(fake_app)
    asyncio.run(mw(scope_with_headers({
        "authorization": f"DeviceToken {SECRET}",
        "x-forwarded-for": "200.10.20.30, 10.0.0.5",
        "x-real-ip": "200.10.20.30",
    }), None, None))
    assert seen["device_secret"] == SECRET
    assert seen["device_ip"] == "200.10.20.30"
    assert seen["is_present"] is True
    assert seen["tenant"].is_global is True
    set_tenant(Tenant())


def test_middleware_devicetoken_sin_gateway_key_no_se_confia():
    import asyncio
    from mwt_mcp.identity import current_identity as _ci

    settings.gateway_key = "super-secreto"
    seen = {}

    async def fake_app(scope, receive, send):
        ident = _ci()
        seen["device_secret"] = ident.device_secret
        return None

    mw = IdentityPropagationMiddleware(fake_app)
    asyncio.run(mw(scope_with_headers({
        "authorization": f"DeviceToken {SECRET}",
        "x-mwt-gateway-key": "incorrecto",
        "x-forwarded-for": "200.10.20.30",
    }), None, None))
    assert seen["device_secret"] is None  # fail-closed
    settings.gateway_key = ""
    set_tenant(Tenant())


def test_middleware_devicetoken_con_gateway_key_ok_se_confia():
    import asyncio
    from mwt_mcp.identity import current_identity as _ci

    settings.gateway_key = "super-secreto"
    seen = {}

    async def fake_app(scope, receive, send):
        seen["device_secret"] = _ci().device_secret
        return None

    mw = IdentityPropagationMiddleware(fake_app)
    asyncio.run(mw(scope_with_headers({
        "authorization": f"DeviceToken {SECRET}",
        "x-mwt-gateway-key": "super-secreto",
        "x-forwarded-for": "200.10.20.30",
    }), None, None))
    assert seen["device_secret"] == SECRET
    settings.gateway_key = ""
    set_tenant(Tenant())
