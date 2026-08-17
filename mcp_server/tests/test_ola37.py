"""Tests de la Ola 3.7 · Calidad y contrato (Ejes C1/C2/C5/D1).

Cubre:
  - validadores de dicts opacos (cliente/producto/nodo/cambios) en schemas.py.
  - `_err_hint` y el shape de error con `hint` en _safe/_safe_role.
  - proyección `campos` en tools de detalle (C1).
  - mwt_health ampliado (DB/Redis/token, D1).
"""
from __future__ import annotations

from unittest import mock

import pytest

from mwt_mcp import server
from mwt_mcp.client import MwtApiError
from mwt_mcp.schemas import (
    validate_cambios,
    validate_cliente_cambios,
    validate_cliente_datos,
    validate_nodo_datos,
    validate_producto_datos,
)


# ─────────────────────────────────────────────────────────────────────── #
# C2 · validadores de dicts opacos
# ─────────────────────────────────────────────────────────────────────── #
def test_cliente_datos_ok_y_falla():
    assert validate_cliente_datos({"razon_social": "Sondel", "pais_iso2": "CR"}) is None
    assert validate_cliente_datos({"pais_iso2": "CR"}) is not None  # falta razon_social
    assert validate_cliente_datos("no-dict") is not None
    assert validate_cliente_datos({}) is not None  # vacío


def test_cliente_cambios_rechaza_campos_desconocidos():
    err = validate_cliente_cambios({"razon_social": "X"})
    assert err is None
    err2 = validate_cliente_cambios({"campo_inexistente": 1})
    assert err2 is not None
    assert "campo_inexistente" in err2


def test_producto_nodo_validators():
    assert validate_producto_datos({"sku": "X", "nombre": "N"}) is None
    assert validate_producto_datos({"nombre": "N"}) is not None  # falta sku
    assert validate_nodo_datos({"tipo": "ALMACEN", "nombre": "Bodega"}) is None
    assert validate_nodo_datos({"tipo": "ALMACEN"}) is not None  # falta nombre


def test_cambios_generico():
    assert validate_cambios({"a": 1}, label="x") is None
    assert validate_cambios({}, label="x") is not None  # vacío no permitido
    assert validate_cambios(None, label="x") is not None
    assert validate_cambios({"x": 1}, label="x", allowed_keys={"a"}) is not None


# ─────────────────────────────────────────────────────────────────────── #
# C5 · hint en el shape de error
# ─────────────────────────────────────────────────────────────────────── #
def test_err_hint_por_status():
    assert "404" not in server._err_hint(404)
    assert "Rate limit" in server._err_hint(429)
    assert "permiso" in server._err_hint(403).lower()
    assert server._err_hint(999)  # fallback genérico


def test_safe_role_error_incluye_hint():
    err = MwtApiError(404, {"detail": "no existe"}, "http://x/api/e/")
    with mock.patch.object(server, "get_identity_user", return_value={"role": "manager"}):
        out = server._safe_role(lambda: (_ for _ in ()).throw(err))
    assert out["error"] is True
    assert out["status"] == 404
    assert out["hint"]  # presente
    assert "404" not in out["hint"]  # no es un string numérico genérico


def test_safe_error_generico_incluye_hint_500():
    out = server._safe(lambda: (_ for _ in ()).throw(ValueError("boom")))
    assert out["error"] is True
    assert out["hint"]


# ─────────────────────────────────────────────────────────────────────── #
# C1 · proyección campos en tools de detalle
# ─────────────────────────────────────────────────────────────────────── #
def test_expediente_lineas_proyecta_campos(monkeypatch):
    rows = {"results": [
        {"id": "l1", "sku": "700728", "qty": "20", "unit_cost": 5.0, "margen": 0.1},
    ]}
    monkeypatch.setattr(server.api, "get", lambda *a, **k: rows)
    with mock.patch.object(server, "get_identity_user", return_value={"role": "ceo"}):
        out = server.expediente_lineas("exp-1", campos="id,sku,qty")
    # _project sobre {results:[...]} recorta cada fila a los campos pedidos.
    fila = out["results"][0]
    assert set(fila.keys()) == {"id", "sku", "qty"}


def test_cliente_obtener_acepta_campos(monkeypatch):
    payload = {"id": "c1", "razon_social": "Sondel", "tax_id": "123"}
    monkeypatch.setattr(server.api, "get", lambda *a, **k: payload)
    with mock.patch.object(server, "get_identity_user", return_value={"role": "admin"}):
        out = server.cliente_obtener("c1", campos="id,razon_social")
    assert set(out.keys()) == {"id", "razon_social"}


# ─────────────────────────────────────────────────────────────────────── #
# C2 · integración: cliente_crear rechaza datos inválidos antes del POST
# ─────────────────────────────────────────────────────────────────────── #
def test_cliente_crear_valida_antes_de_post(monkeypatch):
    llamado = {}

    def _fake_post(path, body):
        llamado["path"] = path
        return {"id": "x"}

    monkeypatch.setattr(server, "_wguard", lambda: None)
    monkeypatch.setattr(server.api, "post", _fake_post)
    out = server.cliente_crear(datos={"campo_inexistente": 1})
    assert out.get("error") is True
    assert "campo_inexistente" in out["detail"]
    assert llamado == {}  # NO se llamó al backend

    # Con datos válidos sí llama.
    out2 = server.cliente_crear(datos={"razon_social": "Sondel"})
    assert llamado.get("path") == "clientes/"
    assert not out2.get("error")


# ─────────────────────────────────────────────────────────────────────── #
# D1 · mwt_health ampliado
# ─────────────────────────────────────────────────────────────────────── #
def test_mwt_health_incluye_db_redis_token(monkeypatch):
    import time as _t

    calls = {"n": 0}

    def _fake_get(path, *a, **k):
        calls["n"] += 1
        if path == "storage/healthz/":
            return {"minio_available": True}
        if path == "auth/me/":
            return {"role": "admin", "email": "a@b.c"}
        if path == "auth/system-health/":
            return {"ok": True, "db": True, "redis": True, "latency_ms": 3}
        return {}

    monkeypatch.setattr(server.api, "get", _fake_get)
    out = server.mwt_health()
    assert out["ok"] is True
    assert out["token_valid"] is True
    assert out["db"] is True
    assert out["redis"] is True
    assert calls["n"] == 3


def test_mwt_health_ok_false_si_token_invalido(monkeypatch):
    def _fake_get(path, *a, **k):
        if path == "storage/healthz/":
            return {"minio_available": True}
        if path == "auth/me/":
            raise MwtApiError(401, {"detail": "expired"}, "http://x/api/auth/me/")
        return {}

    monkeypatch.setattr(server.api, "get", _fake_get)
    out = server.mwt_health()
    assert out["ok"] is False
    assert out["token_valid"] is False


# ─────────────────────────────────────────────────────────────────────── #
# C6 · Privacidad: el código interno EXP-XXXXXX no se expone al client_b2b
# ─────────────────────────────────────────────────────────────────────── #
def test_present_codigos_client_no_expone_codigo_interno(monkeypatch):
    """Un client_b2b ve codigos_presentacion (OC/SAP) pero NO IDs internos."""
    row = {
        "id": "exp-1",
        "codigo": "EXP-504302",
        "fusion_id": "0c6e5683-b04b-4d01-93b8-bc12a4aad3e4",
        "fusion_label": "PO 504983",
        "oc_id": "a1d24aa9-c7cf-4fc9-a840-39edcc4e8b23",
        "operating_company_id": "5525986c-3b09-4d13-bf8f-43ccaa2deae3",
        "brand_id": "51db751c-2e74-4dd3-a592-d4bd2cc38b25",
        "balance": "47876.40",
        "total_cost": "33542.00",
        "oc_codigos": ["504302"],
        "sap_codigos": ["257021"],
        "proforma_codigos": ["2393-2025"],
        "estado": "EN_DESTINO",
    }
    monkeypatch.setattr(server, "get_identity_user", lambda: {"role": "client_b2b", "role_slug": "client_b2b"})

    def _fake_get(path, *a, **k):
        if path == "expedientes/exp-1/lineas/":
            return {"results": [
                {"qty": "10", "unit_price_client": "25.50", "is_active": True},
                {"qty": "5", "unit_price_client": "12.00", "is_active": True},
            ]}
        return {}

    monkeypatch.setattr(server.api, "get", _fake_get)
    out = server._present_codigos({"results": [row]})
    fila = out["results"][0]
    assert "codigos_presentacion" in fila
    assert fila["codigos_presentacion"] == "504302 · 257021"  # sin proforma interna
    assert fila["referencia_cliente"] == "504302"  # identificador legible (PO)
    assert "id" not in fila            # UUID oculto
    assert "codigo" not in fila        # interno oculto
    assert "codigo_interno" not in fila
    assert "fusion_id" not in fila     # UUID de fusión oculto
    assert "oc_id" not in fila
    assert "operating_company_id" not in fila
    assert "brand_id" not in fila
    assert "balance" not in fila       # totales internos ocultos
    assert "total_cost" not in fila
    assert fila["fusion_label"] == "PO 504983"  # label legible se conserva
    assert fila["oc_codigos"] == ["504302"]
    # Total que el cliente SÍ debe ver: 10×25.50 + 5×12.00 = 255 + 60 = 315.00
    assert fila["monto_cliente_usd"] == 315.00


def test_present_codigos_ceo_conserva_codigo_interno(monkeypatch):
    """CEO/Admin ven la proforma interna en codigos_presentacion, pero NO el
    código interno EXP- (número interno que solo usa el sistema)."""
    row = {
        "id": "exp-1",
        "codigo": "EXP-504302",
        "fusion_id": "0c6e5683-b04b-4d01-93b8-bc12a4aad3e4",
        "fusion_label": "PO 504983",
        "oc_codigos": ["504302"],
        "sap_codigos": ["257021"],
        "proforma_codigos": ["2393-2025"],
    }
    monkeypatch.setattr(server, "get_identity_user", lambda: {"role": "admin", "role_slug": "admin"})
    out = server._present_codigos({"results": [row]})
    fila = out["results"][0]
    assert fila["codigos_presentacion"] == "2393-2025 · 504302 · 257021"
    assert "codigo" not in fila        # EXP- oculto para todos los roles
    assert "codigo_interno" not in fila
    assert fila["id"] == "exp-1"       # UUID visible solo a CEO/Admin
    assert fila["fusion_id"] == "0c6e5683-b04b-4d01-93b8-bc12a4aad3e4"
    assert "referencia_cliente" not in fila  # solo para client_b2b
