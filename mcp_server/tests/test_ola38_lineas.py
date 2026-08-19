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
    assert "codigo" not in m                # EXP- oculto
    assert "id" not in m                    # UUID oculto
    assert "expediente_id" not in m         # UUID oculto (fix 2026-08-19)
    assert "expediente_codigo" not in m     # client_b2b solo OC/SAP (fix 2026-08-19)
    assert m["referencia_cliente"] == "PO 504302"
    assert m["estado"] == "EN_DESTINO"


def test_expediente_buscar_ceo_no_ve_uuid(monkeypatch):
    """CEO/Admin no ven UUIDs internos (id/expediente_id); encadenan por
    `expediente_codigo` (EXP-…) y ven proforma en codigos_presentacion."""
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
    assert "codigo" not in m
    assert "id" not in m                # UUID oculto para admin también
    assert "expediente_id" not in m     # UUID oculto para admin también
    assert m["expediente_codigo"] == "EXP-504302"


def test_expediente_buscar_fusion_expone_label_y_members(monkeypatch):
    """Una fusión expone fusion_label + fusion_members (códigos role-aware),
    nunca el fusion_id UUID."""
    rows = {"results": [
        {"id": "exp-1", "codigo": "EXP-504302", "oc_id": "oc-1",
         "oc_codigos": ["PO 504983"], "sap_codigos": ["257021"],
         "proforma_codigos": [], "estado": "EN_DESTINO",
         "client_id": "cli-1", "fusion_id": "0c6e5683-b04b-4d01-93b8-bc12a4aad3e4",
         "fusion_label": "PO 504983", "sap": "257021"},
    ]}
    fusion_members = {"results": [
        {"id": "exp-1", "codigo": "EXP-504302", "oc_codigos": ["PO 504983"],
         "sap_codigos": ["257021"], "proforma_codigos": [], "estado": "EN_DESTINO",
         "sap": "257021"},
        {"id": "exp-2", "codigo": "EXP-504303", "oc_codigos": ["PO 504983"],
         "sap_codigos": ["257022"], "proforma_codigos": [], "estado": "EN_DESTINO",
         "sap": "257022"},
    ]}

    def _fake_get(path, *a, **k):
        params = k.get("params") or {}
        if params.get("fusion"):
            return fusion_members
        return rows

    monkeypatch.setattr(server.api, "get", _fake_get)
    with mock.patch.object(server, "get_identity_user", return_value={"role": "client_b2b"}):
        out = server.expediente_buscar(oc_number="504983")
    m = out["matches"][0]
    assert "fusion_id" not in m                 # UUID de fusión oculto
    assert m["fusion_label"] == "PO 504983"
    assert "fusion_members" in m
    member = m["fusion_members"][0]
    assert "expediente_id" not in member        # UUID oculto en miembros
    assert member["oc_codigos"] == ["PO 504983"]
    assert member["sap_codigos"] == ["257021"]
