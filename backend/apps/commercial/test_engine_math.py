"""Motor de precios · tests puros de la matemática (sin DB).

Si estos valores cambian, el backend y el frontend
(`src/lib/marluvasPricing.js`) se separaron. Los esperados salen del
propio frontend ejecutado con los mismos inputs.
"""
import pytest

from apps.commercial import engine

pytestmark = pytest.mark.no_db


def test_precio_base_usd_banda_1_com_0():
    # 67.7508 BRL · banda 1 (div 4.07) · comisión 0
    assert engine.precio_base_usd(67.7508, 4.07, 0) == pytest.approx(
        17.1458, abs=1e-4)


def test_matriz_com_10_banda_10_90d():
    matrix = engine.compute_matrix(67.7508, 10)
    assert matrix["10"]["90"] == pytest.approx(14.3743, abs=1e-4)
    assert matrix["1"]["90"] == pytest.approx(20.5549, abs=1e-4)


def test_matriz_con_ajuste_y_sobreprecio():
    matrix = engine.compute_matrix(194.6701, 5.61, ajuste=1.5,
                                   sobreprecio=0.03)
    assert matrix["1"]["90"] == pytest.approx(57.6775, abs=1e-4)
    assert matrix["10"]["8"] == pytest.approx(39.664, abs=1e-4)


def test_comision_normaliza_fraccion_y_puntos():
    assert engine.comision_a_puntos(0.10) == pytest.approx(10.0)
    assert engine.comision_a_puntos(10) == pytest.approx(10.0)
    assert engine.comision_a_puntos(None) == 0.0
    assert engine.comision_a_puntos("basura") == 0.0


def test_banda_para_tc():
    assert engine.banda_para_tc(5.892)["id"] == 10
    assert engine.banda_para_tc(4.05)["id"] == 1
    # fuera de rango → banda default
    assert engine.banda_para_tc(7.5)["id"] == engine.BANDA_DEFAULT_ID


def test_precio_en_lee_celda():
    matrix = engine.compute_matrix(100, 0)
    assert engine.precio_en(matrix, 1, 90) is not None
    assert engine.precio_en(matrix, 99, 90) is None
