"""Tests Ola 3.8 · producto_buscar (SKU/nombre/alias/característica por rol)."""
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


PORTAL_PRODUCTS = {
    "results": [
        {"id": "p1", "sku": "700059", "nombre": "60B29-CPAP-SRV",
         "marca_label": "Marluvas", "precio_venta": 33.1, "categoria": "Bota al Tobillo"},
        {"id": "p2", "sku": "701340", "nombre": "75BPR29-BOTA-ALTA",
         "marca_label": "Marluvas", "precio_venta": 47.69, "categoria": "Bota Alta"},
        {"id": "p3", "sku": "555555", "nombre": "OTRO PRODUCTO",
         "marca_label": "X", "precio_venta": 10, "categoria": "Otro"},
    ]
}

DETALLES = {
    "p1": {"id": "p1", "sku": "700059", "nombre": "60B29-CPAP-SRV",
           "especificaciones": {"tipo_calzado": "Bota al Tobillo", "suela": "Bidensidad PU",
                                "color": "Negro", "normativa": ["ISO 20345"]}},
    "p2": {"id": "p2", "sku": "701340", "nombre": "75BPR29-BOTA-ALTA",
           "especificaciones": {"tipo_calzado": "Bota Alta", "suela": "Caucho",
                                "color": "Café", "riesgo": ["Caída Objetos"]}},
}


def _fake_get(path, *a, **k):
    if path == "portal/products/":
        return PORTAL_PRODUCTS
    if path.startswith("portal/products/"):
        pid = path.split("/")[-2]
        return DETALLES.get(pid, {"id": pid})
    if path.startswith("productos/") and path.endswith("/aliases/"):
        pid = path.split("/")[-2]
        if pid == "p1":
            return [{"alias": "60B29-CPAP-SRV"}, {"alias": "700059"}]
        return []
    return {}


def test_producto_buscar_client_por_sku(monkeypatch):
    monkeypatch.setattr(server.api, "get", _fake_get)
    with mock.patch.object(server, "get_identity_user",
                           return_value={"role": "client_b2b", "role_slug": "client_b2b"}):
        out = server.producto_buscar("60b29")
    assert out["total"] == 1
    assert out["productos"][0]["sku"] == "700059"


def test_producto_buscar_client_por_nombre(monkeypatch):
    monkeypatch.setattr(server.api, "get", _fake_get)
    with mock.patch.object(server, "get_identity_user",
                           return_value={"role": "client_b2b", "role_slug": "client_b2b"}):
        out = server.producto_buscar("cpap")
    assert out["total"] == 1
    assert out["productos"][0]["sku"] == "700059"


def test_producto_buscar_client_por_caracteristica(monkeypatch):
    """'bota alta' resuelve por especificaciones (tipo_calzado)."""
    monkeypatch.setattr(server.api, "get", _fake_get)
    with mock.patch.object(server, "get_identity_user",
                           return_value={"role": "client_b2b", "role_slug": "client_b2b"}):
        out = server.producto_buscar("bota alta")
    assert out["total"] == 1
    assert out["productos"][0]["sku"] == "701340"


def test_producto_buscar_client_por_suela(monkeypatch):
    monkeypatch.setattr(server.api, "get", _fake_get)
    with mock.patch.object(server, "get_identity_user",
                           return_value={"role": "client_b2b", "role_slug": "client_b2b"}):
        out = server.producto_buscar("caucho")
    assert out["total"] == 1
    assert out["productos"][0]["sku"] == "701340"


def test_producto_buscar_admin_por_alias(monkeypatch):
    """admin/CEO busca por alias comercial '60B29-CPAP-SRV'."""
    monkeypatch.setattr(server.api, "get", _fake_get)
    with mock.patch.object(server, "get_identity_user",
                           return_value={"role": "admin", "role_slug": "admin"}):
        out = server.producto_buscar("60B29-CPAP-SRV")
    assert out["total"] >= 1
    assert out["productos"][0]["sku"] == "700059"


def test_producto_buscar_requiere_q():
    with mock.patch.object(server, "get_identity_user",
                           return_value={"role": "admin", "role_slug": "admin"}):
        out = server.producto_buscar("")
    assert out.get("error") is True
