"""Tests de la Ola 3.10 · capa de presentación (visualization.py).

Cubre:
  - `generar_grafico`: valida data, redacta por rol antes de renderizar, y
    reenvía al endpoint chart-render.
  - `cashflow_chart` / `margen_marcas_chart`: obtienen datos de analytics,
    redactan, y construyen la serie para el renderizador.
  - `dashboard_resumen`: KPIs + image_urls.
"""
from __future__ import annotations

from unittest import mock

import pytest

from mwt_mcp import visualization as viz


def _patch_api(monkeypatch, post_result=None, get_results=None):
    calls = {"post": [], "get": []}

    def _post(path, body=None):
        calls["post"].append((path, body))
        if post_result is not None:
            return post_result
        return {"success": True, "image_url": "https://img/x.svg", "expires_at": "t"}

    def _get(path, params=None):
        calls["get"].append((path, params))
        return get_results if get_results is not None else []

    monkeypatch.setattr(viz.api, "post", _post)
    monkeypatch.setattr(viz.api, "get", _get)
    return calls


def test_generar_grafico_redacta_antes_de_renderizar(monkeypatch):
    """Los datos sensibles se redactan (client_b2b no manda unit_cost al render)."""
    monkeypatch.setattr(viz, "get_identity_user",
                        lambda: {"role": "client_b2b"})
    calls = _patch_api(monkeypatch)
    data = [{"x": "2026-05", "y": 512, "unit_cost": 100}]
    out = viz.generar_grafico("line", data, {"x": "x", "y": "y"})
    assert out["success"] is True
    path, body = calls["post"][0]
    assert path == "analytics/chart-render/"
    assert body["data"][0]["unit_cost"] == "***"  # redactado
    assert body["data"][0]["y"] == 512            # dato normal intacto


def test_generar_grafico_ceo_no_redacta(monkeypatch):
    monkeypatch.setattr(viz, "get_identity_user", lambda: {"role": "ceo"})
    calls = _patch_api(monkeypatch)
    data = [{"x": "A", "y": 1, "unit_cost": 42}]
    viz.generar_grafico("pie", data)
    _, body = calls["post"][0]
    assert body["data"][0]["unit_cost"] == 42


def test_generar_grafico_data_vacio_o_demasiado(monkeypatch):
    monkeypatch.setattr(viz, "get_identity_user", lambda: {"role": "admin"})
    _patch_api(monkeypatch)
    out = viz.generar_grafico("line", [])
    assert out["success"] is False
    out2 = viz.generar_grafico("line", [{"x": i, "y": i} for i in range(5001)])
    assert out2["success"] is False


def test_generar_grafico_error_del_backend(monkeypatch):
    monkeypatch.setattr(viz, "get_identity_user", lambda: {"role": "admin"})
    _patch_api(monkeypatch, post_result={"error": True, "detail": "tipo inválido"})
    out = viz.generar_grafico("sankey", [{"x": 1, "y": 2}])
    assert out["success"] is False
    assert "tipo inválido" in out["errorMessage"]


def test_cashflow_chart_arma_serie_y_redacta(monkeypatch):
    monkeypatch.setattr(viz, "get_identity_user", lambda: {"role": "manager"})
    calls = _patch_api(monkeypatch, get_results=[
        {"week": "2026-05-01", "proyectado": 100, "real": 90},
        {"week": "2026-05-08", "proyectado": 200, "real": 210},
    ])
    out = viz.cashflow_chart(semanas=12)
    assert out["success"] is True
    assert calls["get"][0][0] == "analytics/cashflow/"
    _, body = calls["post"][0]
    assert body["tipo"] == "line"
    assert body["data"][0]["x"] == "2026-05-01"
    assert out["data"][0]["proyectado"] == 100


def test_cashflow_chart_semanas_acotadas(monkeypatch):
    monkeypatch.setattr(viz, "get_identity_user", lambda: {"role": "admin"})
    calls = _patch_api(monkeypatch, get_results=[])
    viz.cashflow_chart(semanas=9999)  # se acota a 52
    assert calls["get"][0][1] == {"semanas": 52}


def test_margen_marcas_chart(monkeypatch):
    monkeypatch.setattr(viz, "get_identity_user", lambda: {"role": "ceo"})
    calls = _patch_api(monkeypatch, get_results=[
        {"brand_id": "b1", "projected_margin": 5.0, "real_margin": 4.0},
    ])
    out = viz.margen_marcas_chart()
    assert out["success"] is True
    assert calls["get"][0][0] == "analytics/margen_marcas/"
    _, body = calls["post"][0]
    assert body["tipo"] == "bar"
    assert body["data"][0]["category"] == "b1"
    assert out["data"][0]["proyectado"] == 5.0


def test_margen_marcas_chart_error_403(monkeypatch):
    monkeypatch.setattr(viz, "get_identity_user", lambda: {"role": "client_b2b"})
    _patch_api(monkeypatch, get_results={"error": True, "detail": "CEO/Admin only"})
    out = viz.margen_marcas_chart()
    assert out["success"] is False
    assert "CEO/Admin only" in out["errorMessage"]


def test_dashboard_resumen(monkeypatch):
    monkeypatch.setattr(viz, "get_identity_user", lambda: {"role": "ceo"})
    calls = _patch_api(monkeypatch, get_results=[
        {"week": "w1", "proyectado": 100, "real": 50},
        {"week": "w2", "proyectado": 300, "real": 150},
    ])
    out = viz.dashboard_resumen(periodo="30d")
    assert out["success"] is True
    assert out["kpis"]["cashflow_real"] == 200
    assert out["kpis"]["cashflow_proyectado"] == 400
    assert "image_urls" in out
    assert len(calls["post"]) == 2  # cashflow + margen
