"""Tests de la Ola 3.10 ampliada · motor de presentación (presentation.py).

Cubre las 13 tools en 5 categorías:
  P1 Gráficos: generar_grafico, cashflow_chart, margen_marcas_chart,
              aging_chart, exposicion_chart.
  P2 Tablas:  render_tabla.
  P3 Reportes: generar_reporte, reporte_cobranza, reporte_expedientes.
  P4 Dashboards: dashboard_resumen, comparar.
  P5 Exportaciones: exportar_xlsx, exportar_csv.

Verifica redacción ANTES de renderizar en todas las salidas.
"""
from __future__ import annotations

from unittest import mock

from mwt_mcp import presentation as pr


def _patch_api(monkeypatch, post_result=None, get_results=None):
    calls = {"post": [], "get": []}

    def _post(path, body=None):
        calls["post"].append((path, body))
        if post_result is not None:
            return post_result
        return {"success": True, "url": "https://img/x.svg",
                "image_url": "https://img/x.svg", "expires_at": "t"}

    def _get(path, params=None):
        calls["get"].append((path, params))
        return get_results if get_results is not None else []

    monkeypatch.setattr(pr.api, "post", _post)
    monkeypatch.setattr(pr.api, "get", _get)
    return calls


def _role(monkeypatch, role):
    monkeypatch.setattr(pr, "get_identity_user", lambda: {"role": role})


# ═══════════════════════════════════════════════════════════════════ #
# P1 · Gráficos
# ═══════════════════════════════════════════════════════════════════ #
def test_generar_grafico_redacta_antes_de_renderizar(monkeypatch):
    _role(monkeypatch, "client_b2b")
    calls = _patch_api(monkeypatch)
    data = [{"x": "2026-05", "y": 512, "unit_cost": 100}]
    out = pr.generar_grafico("line", data, {"x": "x", "y": "y"})
    assert out["success"] is True
    path, body = calls["post"][0]
    assert path == "presentation/render/"
    assert body["kind"] == "chart"
    assert body["data"][0]["unit_cost"] == "***"  # redactado
    assert body["data"][0]["y"] == 512            # dato normal intacto


def test_generar_grafico_ceo_no_redacta(monkeypatch):
    _role(monkeypatch, "ceo")
    calls = _patch_api(monkeypatch)
    pr.generar_grafico("pie", [{"x": "A", "y": 1, "unit_cost": 42}])
    _, body = calls["post"][0]
    assert body["data"][0]["unit_cost"] == 42


def test_generar_grafico_data_vacio(monkeypatch):
    _role(monkeypatch, "admin")
    _patch_api(monkeypatch)
    assert pr.generar_grafico("line", [])["success"] is False


def test_cashflow_chart(monkeypatch):
    _role(monkeypatch, "manager")
    calls = _patch_api(monkeypatch, get_results=[
        {"week": "2026-05-01", "proyectado": 100, "real": 90}])
    out = pr.cashflow_chart(semanas=12)
    assert out["success"] is True
    assert calls["get"][0][0] == "analytics/cashflow/"
    _, body = calls["post"][0]
    assert body["kind"] == "chart" and body["tipo"] == "line"
    assert out["data"][0]["proyectado"] == 100


def test_margen_marcas_chart(monkeypatch):
    _role(monkeypatch, "ceo")
    calls = _patch_api(monkeypatch, get_results=[
        {"brand_id": "b1", "projected_margin": 5.0}])
    out = pr.margen_marcas_chart()
    assert out["success"] is True
    assert calls["get"][0][0] == "analytics/margen_marcas/"
    assert out["data"][0]["category"] == "b1"


def test_margen_marcas_chart_error_403(monkeypatch):
    _role(monkeypatch, "client_b2b")
    _patch_api(monkeypatch, get_results={"error": True, "detail": "CEO/Admin only"})
    out = pr.margen_marcas_chart()
    assert out["success"] is False
    assert "CEO/Admin only" in out["errorMessage"]


def test_aging_chart(monkeypatch):
    _role(monkeypatch, "admin")
    calls = _patch_api(monkeypatch, get_results={
        "bucket_0_30": 100, "bucket_31_60": 50, "bucket_61_90": 20,
        "bucket_90_plus": 5, "total": 175})
    out = pr.aging_chart()
    assert out["success"] is True
    assert calls["get"][0][0] == "analytics/aging/"
    assert out["totales"]["total"] == 175
    assert out["data"][0]["category"] == "0-30"


def test_exposicion_chart(monkeypatch):
    _role(monkeypatch, "admin")
    calls = _patch_api(monkeypatch, get_results=[
        {"client_name": "Sondel", "exposicion": 500}])
    out = pr.exposicion_chart()
    assert out["success"] is True
    assert calls["get"][0][0] == "analytics/exposicion_clientes/"
    assert out["data"][0]["category"] == "Sondel"


# ═══════════════════════════════════════════════════════════════════ #
# P2 · Tablas
# ═══════════════════════════════════════════════════════════════════ #
def test_render_tabla(monkeypatch):
    _role(monkeypatch, "client_b2b")
    calls = _patch_api(monkeypatch)
    columnas = [{"key": "sku", "label": "SKU"}, {"key": "unit_cost", "label": "Costo"}]
    filas = [{"sku": "A", "unit_cost": 25.0}]
    out = pr.render_tabla(columnas, filas, titulo="Líneas")
    assert out["success"] is True
    _, body = calls["post"][0]
    assert body["kind"] == "tabla"
    assert body["filas"][0]["unit_cost"] == "***"  # redactado
    assert body["filas"][0]["sku"] == "A"


# ═══════════════════════════════════════════════════════════════════ #
# P3 · Reportes
# ═══════════════════════════════════════════════════════════════════ #
def test_generar_reporte(monkeypatch):
    _role(monkeypatch, "manager")
    calls = _patch_api(monkeypatch)
    secciones = [
        {"titulo": "Resumen", "tipo": "texto", "data": "texto"},
        {"titulo": "Detalle", "tipo": "tabla",
         "data": {"columnas": [{"key": "a", "label": "A"}],
                  "filas": [{"a": 1, "unit_cost": 99}]}},
    ]
    out = pr.generar_reporte("Reporte", secciones, formato="markdown")
    assert out["success"] is True
    _, body = calls["post"][0]
    assert body["kind"] == "reporte"
    assert body["formato"] == "markdown"
    # tabla redactada dentro de las secciones
    tabla = body["secciones"][1]["data"]
    assert tabla["filas"][0]["unit_cost"] == "***"


def test_reporte_cobranza(monkeypatch):
    _role(monkeypatch, "finance")
    calls = _patch_api(monkeypatch, get_results={
        "bucket_0_30": 100, "bucket_31_60": 50, "bucket_61_90": 20,
        "bucket_90_plus": 5, "total": 175})
    out = pr.reporte_cobranza(mes="2026-07")
    assert out["success"] is True
    assert calls["get"][0][0] == "analytics/aging/"
    assert out.get("markdown") or calls["post"]


def test_reporte_expedientes(monkeypatch):
    _role(monkeypatch, "admin")
    calls = _patch_api(monkeypatch, get_results=[
        {"status": "PRODUCCION", "count": 12}])
    out = pr.reporte_expedientes(periodo="2026-07")
    assert out["success"] is True
    assert calls["get"][0][0] == "analytics/by_status/"


# ═══════════════════════════════════════════════════════════════════ #
# P4 · Dashboards
# ═══════════════════════════════════════════════════════════════════ #
def test_dashboard_resumen(monkeypatch):
    _role(monkeypatch, "ceo")

    def _get(path, params=None):
        if path == "analytics/cashflow/":
            return [{"week": "w1", "proyectado": 100, "real": 50},
                    {"week": "w2", "proyectado": 300, "real": 150}]
        if path == "analytics/aging/":
            return {"bucket_0_30": 10, "total": 10}
        return []  # margen, exposicion

    monkeypatch.setattr(pr.api, "get", _get)
    monkeypatch.setattr(pr.api, "post",
                        lambda p, body=None: {"success": True, "image_url": "x"})
    out = pr.dashboard_resumen(periodo="30d")
    assert out["success"] is True
    assert out["kpis"]["cashflow_real"] == 200
    assert out["kpis"]["cashflow_proyectado"] == 400
    assert set(out["image_urls"].keys()) == {
        "cashflow", "margen_marcas", "aging", "exposicion"}
    assert "resumen_markdown" in out


def test_comparar(monkeypatch):
    _role(monkeypatch, "manager")
    calls = _patch_api(monkeypatch)
    out = pr.comparar([{"grupo": "Marluvas", "valor": 120},
                       {"grupo": "Sondel", "valor": 80}], grupo="marca")
    assert out["success"] is True
    _, body = calls["post"][0]
    assert body["kind"] == "tabla"
    assert out["insights"]
    assert out["tabla_markdown"]


def test_comparar_redacta(monkeypatch):
    _role(monkeypatch, "client_b2b")
    calls = _patch_api(monkeypatch)
    out = pr.comparar([{"grupo": "A", "valor": 1, "comision_pct": 0.08}], grupo="marca")
    # `comparar` solo proyecta grupo/valor al output: comision_pct NUNCA sale.
    assert out["success"] is True
    _, body = calls["post"][0]
    assert "comision_pct" not in body["filas"][0]
    assert "comision_pct" not in out["tabla_markdown"]


# ═══════════════════════════════════════════════════════════════════ #
# P5 · Exportaciones
# ═══════════════════════════════════════════════════════════════════ #
def test_exportar_xlsx(monkeypatch):
    _role(monkeypatch, "manager")
    calls = _patch_api(monkeypatch)
    out = pr.exportar_xlsx("pagos", [
        {"nombre": "Pagos", "columnas": [{"key": "a", "label": "A"}],
         "filas": [{"a": 1, "unit_cost": 42}]},
    ])
    assert out["success"] is True
    assert out["download_url"]
    _, body = calls["post"][0]
    assert body["kind"] == "xlsx"
    assert body["hojas"][0]["filas"][0]["unit_cost"] == "***"  # redactado


def test_exportar_csv(monkeypatch):
    _role(monkeypatch, "manager")
    calls = _patch_api(monkeypatch)
    out = pr.exportar_csv("pagos", [{"key": "a", "label": "A"}],
                          [{"a": 1, "comision_pct": 0.08}])
    assert out["success"] is True
    _, body = calls["post"][0]
    assert body["kind"] == "csv"
    assert body["filas"][0]["comision_pct"] == "***"  # redactado


def test_exportar_requiere_nombre(monkeypatch):
    _role(monkeypatch, "admin")
    _patch_api(monkeypatch)
    assert pr.exportar_xlsx("", [{"nombre": "H", "columnas": [], "filas": []}])["success"] is False
    assert pr.exportar_csv("", [{"key": "a", "label": "A"}], [])["success"] is False
