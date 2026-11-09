"""Contratos del preflight de creación (`expediente_preflight_creacion`).

Cubre los dos errores que costaron datos en la carga histórica:
  · A4 — el total de las líneas no cuadra con la proforma (2304).
  · C6 — `po_number` de más de 28 caracteres (HTTP 500 y CRASHED al reintentar).

Funciones puras: no tocan la API.
"""
from __future__ import annotations

from mwt_mcp import preflight


class TestPoNumber:
    def test_un_po_number_corto_pasa(self):
        assert preflight.validar_po_number("2501-2026") == []

    def test_sin_po_number_no_bloquea(self):
        assert preflight.validar_po_number(None) == []
        assert preflight.validar_po_number("") == []

    def test_po_number_largo_devuelve_bloqueo_c6(self):
        largo = "MAR-IMPORTACIONES-SAP-2501-2026"  # 31
        bloqueos = preflight.validar_po_number(largo)
        assert len(bloqueos) == 1
        assert bloqueos[0]["codigo"] == "C6"
        assert "28" in bloqueos[0]["detalle"]
        assert "proforma" in bloqueos[0]["accion"]

    def test_el_limite_es_exacto(self):
        assert preflight.validar_po_number("x" * 28) == []
        assert len(preflight.validar_po_number("x" * 29)) == 1


class TestTotal:
    def test_cuadra_al_centavo(self):
        resultado = preflight.comparar_total(14044.80, "14044.80")
        assert resultado["comparable"] is True
        assert resultado["cuadra"] is True
        assert resultado["diferencia"] == "0.00"

    def test_el_caso_2304_no_cuadra(self):
        resultado = preflight.comparar_total(14044.80, "24860.00")
        assert resultado["cuadra"] is False
        assert resultado["diferencia"] == "10815.20"

    def test_sin_total_declarado_no_es_comparable(self):
        resultado = preflight.comparar_total(None, "100.00")
        assert resultado["comparable"] is False
        assert resultado["cuadra"] is None

    def test_sin_total_resuelto_no_es_comparable(self):
        assert preflight.comparar_total("100.00", None)["comparable"] is False

    def test_tolerancia_de_un_centavo(self):
        assert preflight.comparar_total("100.00", "100.01")["cuadra"] is True
        assert preflight.comparar_total("100.00", "100.02")["cuadra"] is False


class TestLineas:
    def test_total_suma_qty_por_precio(self):
        lineas = [
            {"qty": 2, "unit_price": "10.50"},
            {"qty": 3, "unit_price": "1.00"},
        ]
        assert preflight.total_de_lineas(lineas) == "24.00"

    def test_audita_sin_match_y_sin_precio(self):
        lineas = [
            {"producto_id": "p1", "qty": 1, "unit_price": "10"},
            {"producto_id": None, "qty": 1, "unit_price": "10"},
            {"producto_id": "p3", "qty": 1, "unit_price": "0"},
        ]
        audit = preflight.auditar_lineas(lineas)
        assert audit == {"total": 3, "sin_match": 1, "sin_precio": 1}

    def test_lista_vacia(self):
        assert preflight.auditar_lineas([]) == {"total": 0, "sin_match": 0, "sin_precio": 0}


class TestResultado:
    def test_sin_bloqueos_se_puede_crear(self):
        resultado = preflight.construir_resultado(totales={"cuadra": True})
        assert resultado["ok"] is True
        assert resultado["puede_crear"] is True
        assert "expediente_crear" in resultado["siguiente"]

    def test_con_bloqueos_no_se_puede_crear(self):
        resultado = preflight.construir_resultado(
            bloqueos=[{"codigo": "TOTAL", "detalle": "no cuadra"}],
        )
        assert resultado["ok"] is False
        assert resultado["puede_crear"] is False
        assert "Corregí" in resultado["siguiente"]
