"""Tests Ola 3.8 · expediente_obtener con shipping_summary adjunto."""
from __future__ import annotations

from unittest import mock

import pytest

from mwt_mcp import server
from mwt_mcp import enrich


@pytest.fixture(autouse=True)
def _reset_caches():
    enrich._client_cache.clear()
    enrich._client_cache_exp.clear()
    yield


def _exp_payload():
    return {
        "id": "exp-1", "codigo": "EXP-504302", "estado": "EN_DESTINO",
        "forma_pago": "CREDITO", "client_id": "c588c410-468a-4d54-b676-3bec174eb39d",
        "oc_codigos": ["PO 504302"], "sap_codigos": ["257021"],
        "proforma_codigos": [], "phase_durations_json": {
            "PRODUCCION": {"start": "2025-12-15", "end": "2026-04-08", "days": 114},
        },
        "balance": "66212.57", "total_cost": "0",
    }


SHIPPING = {
    "expediente_id": "exp-1", "transport_mode": "marítimo", "carrier": "CMA GCM",
    "tracking": "SSZ1769794", "doc_type": "bl", "freight_mode": "prepaid",
    "dispatch_mode": "client", "consolidation": "sí", "transferencia": None,
}


def _fake_get(path, *a, **k):
    if path == "expedientes/exp-1/":
        return _exp_payload()
    if path == "inventario/expedientes/exp-1/shipping-summary/":
        return SHIPPING
    return {}


def test_expediente_obtener_adjunta_shipping(monkeypatch):
    """El detalle del expediente incluye el resumen de envío."""
    monkeypatch.setattr(server.api, "get", _fake_get)
    with mock.patch.object(server, "get_identity_user",
                           return_value={"role": "admin", "role_slug": "admin"}):
        out = server.expediente_obtener("exp-1")
    assert out["estado"] == "EN_DESTINO"
    assert out["forma_pago"] == "CREDITO"
    assert out["phase_durations_json"]["PRODUCCION"]["days"] == 114
    assert out["shipping_summary"]["tracking"] == "SSZ1769794"
    assert out["shipping_summary"]["carrier"] == "CMA GCM"
    assert out["shipping_summary"]["transport_mode"] == "marítimo"


def test_expediente_obtener_shipping_fallback_sin_error(monkeypatch):
    """Si shipping-summary falla, el detalle se devuelve igual."""
    def fake_get2(path, *a, **k):
        if path == "expedientes/exp-1/":
            return _exp_payload()
        raise Exception("shipping down")  # noqa: BLE001
    monkeypatch.setattr(server.api, "get", fake_get2)
    with mock.patch.object(server, "get_identity_user",
                           return_value={"role": "admin", "role_slug": "admin"}):
        out = server.expediente_obtener("exp-1")
    assert out["estado"] == "EN_DESTINO"
    assert "shipping_summary" not in out
