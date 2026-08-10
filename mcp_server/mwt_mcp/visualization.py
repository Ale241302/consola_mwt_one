"""Shim de compatibilidad — re-exporta las tools del motor de presentación.

La Ola 3.10 ampliada movió la capa de presentación a `presentation.py`
(13 tools en 5 categorías). Este módulo mantiene los nombres previos
(`generar_grafico`, `cashflow_chart`, `margen_marcas_chart`,
`dashboard_resumen`) por compatibilidad con imports existentes.
"""
from __future__ import annotations

from .presentation import (  # noqa: F401
    aging_chart,
    cashflow_chart,
    comparar,
    dashboard_resumen,
    exposicion_chart,
    exportar_csv,
    exportar_xlsx,
    generar_grafico,
    generar_reporte,
    margen_marcas_chart,
    render_tabla,
    reporte_cobranza,
    reporte_expedientes,
)
