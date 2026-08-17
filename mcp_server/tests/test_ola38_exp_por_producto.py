"""Tests Ola 3.8 · expediente_buscar_por_producto (busca expedientes por producto,
con el PRECIO DEL EXPEDIENTE no el del catálogo)."""
from __future__ import annotations

from unittest import mock

import pytest

from mwt_mcp import server
from mwt_mcp import enrich


@pytest.fixture(autouse=True)
def _reset_caches():
    enrich._product_cache.clear()
    enrich._product_cache_exp = 0.0
    enrich._search_index.clear()
    enrich._search_index_built = 0.0
    enrich._specs_cache.clear()
    enrich._specs_cache_exp = 0.0
    enrich._alias_loaded = False
    enrich._client_cache.clear()
    enrich._client_cache_exp.clear()
    yield


PORTAL_PRODUCTS = {"results": [
    {"id": "p1", "sku": "700059", "nombre": "60B29-CPAP-SRV", "marca_label": "Marluvas"},
]}
DETALLE = {"id": "p1", "sku": "700059", "nombre": "60B29-CPAP-SRV",
           "especificaciones": {"tipo_calzado": "Bota al Tobillo"}}

LINEAS = {"results": [
    {"id": "l1", "expediente_id": "exp-1", "producto_id": "p1", "sku": "700059",
     "size": "39", "qty": "10", "unit_price_client": "38.61", "unit_price_mwt": "27.05",
     "total_price": "386.10", "is_active": True},
    {"id": "l2", "expediente_id": "exp-2", "producto_id": "p1", "sku": "700059",
     "size": "40", "qty": "5", "unit_price_client": "38.61", "unit_price_mwt": "27.05",
     "total_price": "193.05", "is_active": True},
]}


def _fake_get(path, *a, **k):
    if path == "portal/products/":
        return PORTAL_PRODUCTS
    if path.startswith("portal/products/"):
        return DETALLE
    if path == "lineas/":
        return LINEAS
    return {}


def test_expediente_buscar_por_producto_client_precio_cliente(monkeypatch):
    """client_b2b ve unit_price_client, NO unit_price_mwt."""
    monkeypatch.setattr(server.api, "get", _fake_get)
    with mock.patch.object(server, "get_identity_user",
                           return_value={"role": "client_b2b", "role_slug": "client_b2b"}):
        out = server.expediente_buscar_por_producto("60b29")
    assert out["total"] == 2
    exp1 = out["expedientes"][0]
    prod = exp1["productos"][0]
    assert prod["sku"] == "700059"
    assert prod["unit_price_client"] == "38.61"
    assert prod["unit_price_mwt"] is None  # oculto para client_b2b


def test_expediente_buscar_por_producto_admin_ve_mwt(monkeypatch):
    """admin/CEO ve unit_price_client y unit_price_mwt (precio del expediente)."""
    monkeypatch.setattr(server.api, "get", _fake_get)
    with mock.patch.object(server, "get_identity_user",
                           return_value={"role": "admin", "role_slug": "admin"}):
        out = server.expediente_buscar_por_producto("60b29")
    assert out["total"] == 2
    prod = out["expedientes"][0]["productos"][0]
    assert prod["unit_price_client"] == "38.61"
    assert prod["unit_price_mwt"] == "27.05"


def test_expediente_buscar_por_producto_sin_match(monkeypatch):
    def fake_get2(path, *a, **k):
        if path == "portal/products/":
            return {"results": []}
        return {}
    monkeypatch.setattr(server.api, "get", fake_get2)
    with mock.patch.object(server, "get_identity_user",
                           return_value={"role": "client_b2b", "role_slug": "client_b2b"}):
        out = server.expediente_buscar_por_producto("no-existe")
    assert out["total"] == 0
    assert "No se encontró" in out["detail"]


def test_expediente_buscar_por_producto_requiere_q():
    with mock.patch.object(server, "get_identity_user",
                           return_value={"role": "admin", "role_slug": "admin"}):
        out = server.expediente_buscar_por_producto("")
    assert out.get("error") is True
