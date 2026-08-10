"""Tests de `jwt_minter.py` (Ola 3.9 · H2).

Cubre el token exchange fail-closed:
  - Sin identidad propagada -> ServiceToken estático (comportamiento directo).
  - Con identidad + backend OK -> mint + cache del token y perfil.
  - Con identidad + backend 200 sin access -> IdentityMintingError (fail-closed).
  - Con identidad + backend error/exception -> IdentityMintingError (NUNCA
    cae al ServiceToken).
  - Cache: no re-mintea dentro del TTL.
"""
from __future__ import annotations

from unittest import mock

import pytest

from mwt_mcp import jwt_minter
from mwt_mcp.identity import Identity


class _FakeIdentity:
    """Identity propagada mínima."""

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


def _patch_current_identity(monkeypatch, ident):
    monkeypatch.setattr(jwt_minter, "current_identity", lambda: ident)


def test_sin_identidad_usa_service_token(monkeypatch):
    _patch_current_identity(monkeypatch, _FakeIdentity(is_present=False))
    monkeypatch.setattr(jwt_minter.settings, "require_token", lambda: "svc-token")
    assert jwt_minter.get_identity_token() == "svc-token"


def test_con_identidad_mint_exitoso_y_cache(monkeypatch):
    ident = _FakeIdentity("a@b.c")
    _patch_current_identity(monkeypatch, ident)
    # Limpia cache.
    jwt_minter._cache.clear()

    payload = {"access": "eyJ.user.token", "user": {"role": "admin"}}
    llamadas = []

    def _fake_mint(identity):
        llamadas.append(identity.email)
        return payload

    monkeypatch.setattr(jwt_minter, "_mint_from_backend", _fake_mint)
    token = jwt_minter.get_identity_token()
    assert token == "eyJ.user.token"
    user = jwt_minter.get_identity_user()
    assert user["role"] == "admin"

    # Segunda llamada -> cache (no re-mintea).
    jwt_minter.get_identity_token()
    jwt_minter.get_identity_user()
    assert len(llamadas) == 1


def test_con_identidad_backend_sin_access_fail_closed(monkeypatch):
    ident = _FakeIdentity("a@b.c")
    _patch_current_identity(monkeypatch, ident)
    jwt_minter._cache.clear()

    def _fake_mint(identity):
        return {"user": {"role": "admin"}}  # sin "access"

    monkeypatch.setattr(jwt_minter, "_mint_from_backend", _fake_mint)
    with pytest.raises(jwt_minter.IdentityMintingError):
        jwt_minter.get_identity_token()


def test_con_identidad_backend_none_fail_closed(monkeypatch):
    ident = _FakeIdentity("a@b.c")
    _patch_current_identity(monkeypatch, ident)
    jwt_minter._cache.clear()
    monkeypatch.setattr(jwt_minter, "_mint_from_backend", lambda identity: None)
    with pytest.raises(jwt_minter.IdentityMintingError):
        jwt_minter.get_identity_token()


def test_con_identidad_backend_error_no_cae_a_service(monkeypatch):
    """Fail-closed: identidad propagada + backend caído -> NUNCA ServiceToken."""
    ident = _FakeIdentity("a@b.c")
    _patch_current_identity(monkeypatch, ident)
    jwt_minter._cache.clear()

    # El `_mint_from_backend` real captura la excepción de red y devuelve None;
    # `_mint_and_cache` entonces debe lanzar IdentityMintingError (fail-closed).
    llamado_service = []

    def _require_token():
        llamado_service.append(True)
        return "svc-token"

    monkeypatch.setattr(jwt_minter, "_mint_from_backend", lambda identity: None)
    monkeypatch.setattr(jwt_minter.settings, "require_token", _require_token)
    with pytest.raises(jwt_minter.IdentityMintingError):
        jwt_minter.get_identity_token()
    assert llamado_service == []  # NUNCA cayó al ServiceToken


def test_mint_from_backend_post_auth_mcp_token(monkeypatch):
    """Verifica el POST a /auth/mcp-token/ con email y header de servicio."""
    import httpx

    captured = {}

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
            return _FakeResp(200, {"access": "tok", "user": {}})

    monkeypatch.setattr(jwt_minter.httpx, "Client", _FakeClient)
    monkeypatch.setattr(jwt_minter, "_service_auth_header",
                        lambda: {"Authorization": "ServiceToken svc"})
    monkeypatch.setattr(jwt_minter.settings, "api_base", "https://consola.mwt.one/api")

    out = jwt_minter._mint_from_backend(_FakeIdentity("a@b.c"))
    assert out["access"] == "tok"
    assert captured["url"].endswith("/auth/mcp-token/")
    assert captured["json"] == {"email": "a@b.c"}
    assert captured["headers"]["Authorization"] == "ServiceToken svc"


def test_mint_from_backend_http_error_devuelve_none(monkeypatch):
    class _FakeClient:
        def __init__(self, *a, **k):  # noqa: ANN002, ANN003
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):  # noqa: ANN002
            return False

        def post(self, url, json=None, headers=None):  # noqa: ANN001
            return _FakeResp(403, None, "denegado")

    monkeypatch.setattr(jwt_minter.httpx, "Client", _FakeClient)
    monkeypatch.setattr(jwt_minter.settings, "api_base", "https://x/api")
    assert jwt_minter._mint_from_backend(_FakeIdentity("a@b.c")) is None


def test_identity_headers_bearer_vs_service(monkeypatch):
    """El header de auth distingue Bearer (JWT) de ServiceToken (opaco)."""
    jwt_minter._cache.clear()
    _patch_current_identity(monkeypatch, _FakeIdentity("a@b.c"))
    monkeypatch.setattr(jwt_minter, "_mint_from_backend",
                        lambda identity: {"access": "eyJ.token", "user": {}})
    jwt_minter.get_identity_token()  # pobla cache

    # token JWT -> el auth header global de client usa Bearer.
    from mwt_mcp.client import _auth_headers
    from mwt_mcp import jwt_minter as jm

    # Verificamos la lógica de _auth_headers con un JWT.
    with mock.patch.object(jm.settings, "require_token", return_value="eyJ.legacy"):
        headers = _auth_headers()
    assert headers["Authorization"].startswith("Bearer ")
