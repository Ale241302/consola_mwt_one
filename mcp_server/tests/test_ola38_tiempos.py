"""Tests Ola 3.8 · expediente_tiempos (phase-stats + timeline)."""
from __future__ import annotations

from unittest import mock

import pytest

from mwt_mcp import server
from mwt_mcp import enrich


@pytest.fixture(autouse=True)
def _reset_caches():
    enrich._client_cache.clear()
    # Ola 2 · 2.7 — _client_cache_exp ahora es dict keyed por (email|cliente).
    enrich._client_cache_exp.clear()
    enrich._product_cache.clear()
    enrich._product_cache_exp = 0.0
    yield


PHASE_STATS = {
    "phase_stats": {
        "_ALL": {
            "REGISTRO": {"avg": 24.11, "n": 18},
            "PRODUCCION": {"avg": 54.22, "n": 18},
            "TRANSITO": {"avg": 13.27, "n": 11},
        }
    }
}

TIMELINE = {"expedientes": [
    {"row": {"id": "exp-1", "codigo": "EXP-X"},
     "payload": {"lineas": [{"sku": "700728", "unit_price_client": "38.61",
                             "unit_price_mwt": "27.05"}],
                 "operating_company": {"operated_by_mwt": True, "client_name": "Sondel"}},
     "events": [{"phase_to": "PREPARACION", "created_at": "2026-08-06"}],
     "phase_durations": {"REGISTRO": {"days": 6}, "PRODUCCION": {"days": 21}}},
]}


def _fake_get(path, *a, **k):
    if path == "expedientes/phase-stats/":
        return PHASE_STATS
    if path == "expedientes/timeline-bundle/":
        return TIMELINE
    if path == "portal/me/":
        return {"empresas": [{"id": "c588c410-468a-4d54-b676-3bec174eb39d", "nombre": "Sondel"}]}
    return {}


def test_tiempos_globales_client_filtra_scope(monkeypatch):
    """client_b2b ve phase-stats filtrado a su empresa (client param)."""
    calls = []

    def fake_get2(path, *a, **k):
        params = a[0] if a else k
        calls.append((path, params))
        if path == "portal/me/":
            return {"empresas": [{"id": "c588c410-468a-4d54-b676-3bec174eb39d", "nombre": "Sondel"}]}
        if path == "expedientes/phase-stats/":
            return {"phase_stats": {"_ALL": {"REGISTRO": {"avg": 1}}}}
        return {}

    # server.api y enrich.api son el MISMO módulo client → un solo mock cubre ambos.
    monkeypatch.setattr(server.api, "get", fake_get2)
    with mock.patch.object(server, "get_identity_user",
                           return_value={"role": "client_b2b", "role_slug": "client_b2b"}):
        out = server.expediente_tiempos()
    assert "phase_stats" in out
    phase_calls = [params for (p, params) in calls if p == "expedientes/phase-stats/"]
    assert phase_calls, f"no se llamó phase-stats; calls={calls}"
    assert phase_calls[0].get("client") == "c588c410-468a-4d54-b676-3bec174eb39d"


def test_tiempos_globales_admin_sin_filtro(monkeypatch):
    """admin/CEO ve phase-stats global sin filtrar por cliente."""
    calls = []

    def fake_get2(path, *a, **k):
        params = a[0] if a else k
        calls.append((path, params))
        if path == "expedientes/phase-stats/":
            return PHASE_STATS
        return {}

    monkeypatch.setattr(server.api, "get", fake_get2)
    with mock.patch.object(server, "get_identity_user",
                           return_value={"role": "admin", "role_slug": "admin"}):
        out = server.expediente_tiempos()
    assert "phase_stats" in out
    phase_calls = [params for (p, params) in calls if p == "expedientes/phase-stats/"]
    assert phase_calls
    assert "client" not in phase_calls[0]


def test_tiempos_expediente_usuario_timeline(monkeypatch):
    """Con expediente_id, devuelve el timeline (phase_durations + lineas)."""
    monkeypatch.setattr(server.api, "get", _fake_get)
    with mock.patch.object(server, "get_identity_user",
                           return_value={"role": "client_b2b", "role_slug": "client_b2b"}):
        out = server.expediente_tiempos(expediente_id="exp-1")
    assert out["expediente_id"] == "exp-1"
    assert "phase_durations" in out
    assert "lineas" in out
    assert "operating_company" in out
