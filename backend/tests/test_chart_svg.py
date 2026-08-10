"""Tests del renderizador SVG server-side (Ola 3.10 · chart_svg)."""
from __future__ import annotations

import pytest

from apps.analytics.chart_svg import (
    _esc,
    _num,
    render_chart,
    CHART_TYPES,
)


class TestRenderLine:
    pytestmark = pytest.mark.no_db
    def test_line_genera_polyline_y_escapado(self):
        svg = render_chart("line", [{"x": "A<B", "y": 1}, {"x": "C", "y": 2}],
                           {"x": "x", "y": "y", "titulo": "Título & <demo>"})
        assert "<?xml" in svg
        assert "<svg" in svg
        assert "polyline" in svg
        # El título con & se escapa (no rompe XML).
        assert "&lt;demo&gt;" in svg or "T&amp;tulo" in svg
        assert "<script" not in svg

    def test_line_escapa_labels(self):
        svg = render_chart("line", [{"x": '<img src="x">', "y": 1}], {"x": "x", "y": "y"})
        assert "&lt;img" in svg

    def test_area_genera_polygon(self):
        svg = render_chart("area", [{"x": 1, "y": 2}, {"x": 2, "y": 3}],
                           {"x": "x", "y": "y"})
        assert "polygon" in svg


class TestRenderBar:
    pytestmark = pytest.mark.no_db
    def test_bar_genera_rects(self):
        svg = render_chart("bar", [{"category": "A", "value": 5},
                                   {"category": "B", "value": 8}],
                           {"category": "category", "value": "value"})
        assert "<rect" in svg
        assert "A" in svg

    def test_column_es_alias_de_bar(self):
        svg_bar = render_chart("bar", [{"category": "A", "value": 1}], {})
        svg_col = render_chart("column", [{"category": "A", "value": 1}], {})
        assert "<rect" in svg_col
        # Ambos son del mismo renderizador (estructura equivalente).
        assert svg_bar.startswith("<?xml") and svg_col.startswith("<?xml")


class TestRenderPie:
    pytestmark = pytest.mark.no_db
    def test_pie_genera_paths_y_porcentajes(self):
        svg = render_chart("pie", [{"category": "A", "value": 3},
                                   {"category": "B", "value": 1}],
                           {"category": "category", "value": "value"})
        assert "<path" in svg
        assert "75.0%" in svg  # A = 3/4
        assert "25.0%" in svg  # B = 1/4

    def test_pie_sin_datos_muestra_mensaje(self):
        svg = render_chart("pie", [{"category": "A", "value": 0}], {})
        assert "Sin datos" in svg


class TestValidacion:
    pytestmark = pytest.mark.no_db
    def test_tipo_invalido_lanza(self):
        with pytest.raises(ValueError):
            render_chart("sankey", [{"x": 1, "y": 2}])

    def test_tipos_soportados(self):
        assert set(CHART_TYPES) == {"line", "area", "bar", "column", "pie"}

    def test_data_max_rows_corta(self):
        big = [{"x": i, "y": i} for i in range(6000)]
        svg = render_chart("line", big, {"x": "x", "y": "y"})
        # No revienta con 6000 filas (se corta a _MAX_ROWS internamente).
        assert "<?xml" in svg


class TestHelpers:
    pytestmark = pytest.mark.no_db
    def test_esc_quita_caracteres_peligrosos(self):
        assert _esc('<img onerror="alert(1)">') == "&lt;img onerror=&quot;alert(1)&quot;&gt;"

    def test_num_coerce(self):
        assert _num("12.5") == 12.5
        assert _num("abc") == 0.0
        assert _num(None) == 0.0
