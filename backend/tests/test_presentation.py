"""Tests del motor de presentación server-side (Ola 3.10 ampliada · presentation.py).

Cubre: tablas SVG/Markdown, reportes Markdown, exportaciones XLSX/CSV, y el
escape de texto (prevención de inyección). Puro — no requiere DB (no_db).
"""
from __future__ import annotations

import pytest

from apps.analytics.presentation import (
    export_csv_bytes,
    export_xlsx_bytes,
    render_reporte_markdown,
    render_tabla_markdown,
    render_tabla_svg,
)


class TestTablaSvg:
    pytestmark = pytest.mark.no_db

    def test_genera_svg_con_branding(self):
        svg = render_tabla_svg(
            [{"key": "sku", "label": "SKU"}, {"key": "qty", "label": "Cantidad"}],
            [{"sku": "700728", "qty": 20}, {"sku": "700729", "qty": 15}],
            titulo="Líneas OC",
        )
        assert "<svg" in svg
        assert "700728" in svg
        assert "#013A57" in svg  # color brand MWT
        assert "<script" not in svg

    def test_escapa_texto(self):
        svg = render_tabla_svg([{"key": "a", "label": "A"}], [{"a": '<img src="x" onerror="alert(1)">'}])
        assert "<img" not in svg
        assert "&lt;img" in svg

    def test_sin_datos(self):
        svg = render_tabla_svg([{"key": "a", "label": "A"}], [])
        assert "Sin datos" in svg

    def test_limita_filas(self):
        filas = [{"a": i} for i in range(600)]
        svg = render_tabla_svg([{"key": "a", "label": "A"}], filas)
        assert "<svg" in svg  # no revienta


class TestTablaMarkdown:
    pytestmark = pytest.mark.no_db

    def test_genera_markdown(self):
        md = render_tabla_markdown(
            [{"key": "sku", "label": "SKU"}], [{"sku": "700728"}])
        assert "| SKU |" in md
        assert "| 700728 |" in md


class TestReporteMarkdown:
    pytestmark = pytest.mark.no_db

    def test_texto(self):
        md = render_reporte_markdown(
            "Reporte", [{"titulo": "Resumen", "tipo": "texto", "data": "hola"}])
        assert "# Reporte" in md
        assert "## Resumen" in md
        assert "hola" in md

    def test_tabla_en_seccion(self):
        md = render_reporte_markdown(
            "R", [{"titulo": "Detalle", "tipo": "tabla",
                   "data": {"columnas": [{"key": "a", "label": "A"}],
                            "filas": [{"a": 1}]}}])
        assert "| A |" in md


class TestExportaciones:
    pytestmark = pytest.mark.no_db

    def test_csv_con_bom(self):
        b = export_csv_bytes([{"key": "a", "label": "A"}], [{"a": 1}, {"a": 2}])
        text = b.decode("utf-8")
        assert text.startswith("\ufeffA")
        assert "1" in text and "2" in text

    def test_xlsx_es_zip(self):
        b = export_xlsx_bytes("export", [
            {"nombre": "Hoja1", "columnas": [{"key": "a", "label": "A"}],
             "filas": [{"a": 1}]}])
        assert b[:2] == b"PK"  # ZIP (xlsx)
