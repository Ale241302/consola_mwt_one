"""Tests Ola 3.8 · líneas de expediente (nombre de producto) y búsqueda sin EXP-."""
from __future__ import annotations

from unittest import mock

import pytest

from mwt_mcp import server
from mwt_mcp import enrich


@pytest.fixture(autouse=True)
def _reset_caches():
    """Aísla el cache de productos/tallas entre tests."""
    enrich._product_cache.clear()
    enrich._product_cache_exp = 0.0
    enrich._client_cache.clear()
    enrich._client_cache_exp.clear()
    enrich._talla_cache.clear()
    enrich._talla_cache_exp = 0.0
    yield


# ─────────────────────────────────────────────────────────────────────── #
# enrich_lineas: añade producto_nombre/marca_nombre legibles
# ─────────────────────────────────────────────────────────────────────── #
def test_enrich_lineas_adjunta_nombre(monkeypatch):
    monkeypatch.setattr(
        enrich.api, "get",
        lambda path, *a, **k: {
            "results": [
                {"id": "p1", "nombre": "75BPR29-MSMC-CPAP-ST", "sku": "700728",
                 "marca_label": "Marluvas"},
            ]
        } if path == "portal/products/" else {},
    )
    data = {"results": [
        {"id": "l1", "producto_id": "p1", "sku": "700728", "qty": "20"},
        {"id": "l2", "producto_id": "p9", "sku": "OTRO"},  # no resuelve
    ]}
    out = enrich.enrich_lineas(data)
    fila = out["results"][0]
    assert fila["producto_nombre"] == "75BPR29-MSMC-CPAP-ST"
    assert fila["marca_nombre"] == "Marluvas"
    assert fila["sku"] == "700728"
    # La línea sin producto resuelto queda tal cual (sin clave añadida).
    assert "producto_nombre" not in out["results"][1]


# ─────────────────────────────────────────────────────────────────────── #
# expediente_lineas: pasa por _safe_role_read + enrich_lineas
# ─────────────────────────────────────────────────────────────────────── #
def test_expediente_lineas_enriquece_nombre(monkeypatch):
    monkeypatch.setattr(
        server.api, "get",
        lambda path, *a, **k: {
            "results": [
                {"id": "l1", "producto_id": "p1", "sku": "700728",
                 "unit_price_client": "38.61", "qty": "20"},
            ]
        } if path == "expedientes/e1/lineas/" else
        ({"results": [{"id": "p1", "nombre": "75BPR29", "sku": "700728"}]} if path == "portal/products/" else {}),
    )
    with mock.patch.object(server, "get_identity_user", return_value={"role": "client_b2b"}):
        out = server.expediente_lineas("e1")
    fila = out["results"][0]
    assert fila["sku"] == "700728"
    assert fila["producto_nombre"] == "75BPR29"
    assert fila["unit_price_client"] == "38.61"
    assert "unit_price_mwt" not in fila or fila.get("unit_price_mwt") == "***"


# ─────────────────────────────────────────────────────────────────────── #
# expediente_buscar: un client_b2b NO ve el código EXP- pero sí la referencia
# ─────────────────────────────────────────────────────────────────────── #
def test_expediente_buscar_client_no_ve_codigo_exp(monkeypatch):
    rows = {"results": [
        {"id": "exp-1", "codigo": "EXP-504302", "oc_id": "oc-1",
         "oc_codigos": ["PO 504302"], "sap_codigos": ["257021"],
         "proforma_codigos": [], "estado": "EN_DESTINO",
         "client_id": "cli-1", "fusion_id": None, "fusion_label": None, "sap": "257021"},
    ]}
    monkeypatch.setattr(server.api, "get", lambda *a, **k: rows)
    with mock.patch.object(server, "get_identity_user", return_value={"role": "client_b2b"}):
        out = server.expediente_buscar(oc_number="504302")
    assert out["existe"] is True
    m = out["matches"][0]
    assert "codigo" not in m            # EXP- oculto
    assert "id" not in m                # UUID oculto
    assert m["expediente_id"] == "exp-1"  # encadenamiento conservado
    assert m["referencia_cliente"] == "PO 504302"
    assert m["estado"] == "EN_DESTINO"


def test_expediente_buscar_ceo_no_ve_codigo_exp(monkeypatch):
    """CEO/Admin conservan el UUID pero NO el código interno EXP-."""
    rows = {"results": [
        {"id": "exp-1", "codigo": "EXP-504302", "oc_id": "oc-1",
         "oc_codigos": ["PO 504302"], "sap_codigos": ["257021"],
         "proforma_codigos": [], "estado": "EN_DESTINO",
         "client_id": "cli-1", "fusion_id": None, "fusion_label": None, "sap": "257021"},
    ]}
    monkeypatch.setattr(server.api, "get", lambda *a, **k: rows)
    with mock.patch.object(server, "get_identity_user", return_value={"role": "admin"}):
        out = server.expediente_buscar(oc_number="504302")
    m = out["matches"][0]
    assert "codigo" not in m  # EXP- oculto para todos los roles
    assert m["id"] == "exp-1"
