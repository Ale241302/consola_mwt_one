"""Tests del wrapper `_safe_role` en server.py (Ola 3.5 · Eje B).

Verifica la integración de la frontera de errores con la redacción por rol,
mockeando `get_identity_user` para no tocar red ni backend.
"""
from __future__ import annotations

from unittest import mock

import pytest

from mwt_mcp import server
from mwt_mcp.client import MwtApiError


def _make_server(identity_user=None):
    """Devuelve (call, mock_get_identity_user) con el módulo server parcheado."""
    patcher = mock.patch.object(server, "get_identity_user", return_value=identity_user)
    patcher.start()
    try:
        return server._safe_role, patcher
    except Exception:
        patcher.stop()
        raise


def test_safe_role_ok_ceo_sin_redaccion():
    # Ola 3.8: el código interno EXP- se elimina para TODOS los roles y la
    # redacción hace deep-copy (nunca muta el payload original). El CEO ve los
    # datos financieros intactos pero sin EXP- interno.
    payload = {"codigo": "PO 505201", "total_cost": 5.0}
    _safe_role, patcher = _make_server({"role": "ceo"})
    try:
        out = _safe_role(lambda: payload)
    finally:
        patcher.stop()
    assert out == {"codigo": "PO 505201", "total_cost": 5.0}
    assert payload["total_cost"] == 5.0  # no mutó el original


def test_safe_role_ok_manager_redacta():
    payload = {"codigo": "PO 505201", "total_cost": 5.0}
    _safe_role, patcher = _make_server({"role": "manager"})
    try:
        out = _safe_role(lambda: payload)
    finally:
        patcher.stop()
    assert out["total_cost"] == "***"
    assert out["codigo"] == "PO 505201"  # código de negocio (no EXP-) se conserva


def test_safe_role_ok_sin_identidad_no_redacta():
    """Sin identidad (ServiceToken/stdio) -> get_identity_user() devuelve None.

    Ola 3.8: sin identidad no se redacta; el enrich_ids puede copiar el shape
    (deep-copy) pero el contenido queda idéntico.
    """
    payload = {"codigo": "EXP-1", "total_cost": 5.0}
    _safe_role, patcher = _make_server(None)
    try:
        out = _safe_role(lambda: payload)
    finally:
        patcher.stop()
    assert out == payload


def test_safe_role_error_mwt_api():
    err = MwtApiError(404, {"detail": "no existe"}, "http://x/api/expedientes/")
    _safe_role, patcher = _make_server({"role": "manager"})
    try:
        out = _safe_role(lambda: (_ for _ in ()).throw(err))
    finally:
        patcher.stop()
    assert out["error"] is True
    assert out["status"] == 404
    assert out["detail"] == {"detail": "no existe"}


def test_safe_role_error_generico():
    _safe_role, patcher = _make_server({"role": "manager"})
    try:
        out = _safe_role(lambda: (_ for _ in ()).throw(ValueError("boom")))
    finally:
        patcher.stop()
    assert out["error"] is True
    assert "boom" in out["detail"]


def test_safe_role_identidad_fallida_fail_closed():
    """Si get_identity_user() falla (IdentityMintingError), NO se fuga el dato:
    se devuelve un error, nunca la respuesta sin redactar."""
    def boom_identity():
        raise RuntimeError("minting falló")

    with mock.patch.object(server, "get_identity_user", side_effect=boom_identity):
        out = server._safe_role(lambda: {"total_cost": 5.0})
    assert out["error"] is True
    assert "identidad" in out["detail"].lower()
