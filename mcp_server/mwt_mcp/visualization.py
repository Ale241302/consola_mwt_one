"""Ola 3.10 · Capa de presentación del MCP — tools de visualización.

Convierte el MCP de solo-datos a datos+imagen: las tools devuelven la URL de
un SVG renderizado server-side (estilo antvis/mcp-server-chart) que la IA
puede mostrar en su respuesta.

Seguridad:
  · `redact_for_user` se aplica a los DATOS ANTES de enviarlos al renderizador
    (un manager/client_b2b no puede pedir un chart de costos/margen que no ve).
  · El endpoint del backend valida tipo, tamaño (≤5000 filas) y opciones
    (whitelist); el renderizador recibe SOLO datos puros (sin SSRF).
  · La URL de imagen está firmada con TTL 5 min (patrón storage/signed_url).
"""
from __future__ import annotations

from typing import Any

from . import client as api
from .config import settings
from .jwt_minter import get_identity_user
from .redact import redact_for_user


def _role() -> str:
    user = get_identity_user() or {}
    return user.get("role") or user.get("role_slug") or ""


def _render(tipo: str, data: list, opciones: dict | None = None) -> dict:
    """Envía datos (ya redactados) al renderizador y devuelve {success, image_url, ...}."""
    try:
        body = {"tipo": tipo, "data": data, "opciones": opciones or {}}
        resp = api.post("analytics/chart-render/", body)
    except Exception as e:  # noqa: BLE001 - frontera
        return {"success": False, "image_url": None,
                "errorMessage": f"Error al renderizar: {e}"}
    if isinstance(resp, dict) and resp.get("error"):
        return {"success": False, "image_url": None,
                "errorMessage": str(resp.get("detail") or resp.get("error"))}
    if isinstance(resp, dict) and resp.get("success"):
        return resp
    return {"success": False, "image_url": None,
            "errorMessage": f"Respuesta inesperada del renderizador: {resp}"}


def generar_grafico(tipo: str, data: list, opciones: dict | None = None) -> dict:
    """(Visualización) Genera un chart SVG server-side desde datos puros.

    `tipo`: line | area | bar | column | pie.
    `data`: array de filas `[{x, y}]` (line/area) o `[{category, value}]`
      (bar/pie). Máx 5000 filas.
    `opciones`: {x, y, category, value, titulo, width, height, palette}.

    Devuelve `{success, image_url, tipo, expires_at}`. La URL está firmada con
    TTL 5 min. Los datos se redactan por rol ANTES de renderizar (un rol sin
    acceso a costos/margen no puede dibujarlos).
    """
    try:
        data = list(data or [])
    except Exception:  # noqa: BLE001
        return {"success": False, "image_url": None,
                "errorMessage": "data debe ser un array."}
    if len(data) > 5000:
        return {"success": False, "image_url": None,
                "errorMessage": "data excede 5000 filas."}
    if not data:
        return {"success": False, "image_url": None,
                "errorMessage": "data vacío. Proporciona al menos una fila."}
    redacted = redact_for_user(data, get_identity_user())
    return _render(tipo, redacted, opciones)


def cashflow_chart(semanas: int | None = None) -> dict:
    """(Visualización) Chart de cashflow de las últimas N semanas.

    Usa `analytics/cashflow/` (proyectado vs real por semana). Devuelve
    `{success, image_url, expires_at, data}` — el `data` crudo viene para que
    la IA pueda interpretar los números además de mostrar la imagen.
    """
    try:
        weeks = max(1, min(int(semanas or 12), 52))
    except (TypeError, ValueError):
        weeks = 12
    raw = api.get("analytics/cashflow/", {"semanas": weeks})
    if isinstance(raw, dict) and raw.get("error"):
        return {"success": False, "image_url": None,
                "errorMessage": str(raw.get("detail") or raw.get("error"))}
    rows = raw if isinstance(raw, list) else (raw or {}).get("results") or []
    redacted = redact_for_user(rows, get_identity_user())
    series = [
        {"x": (r.get("week") or r.get("x") or ""), "proyectado": r.get("proyectado"),
         "real": r.get("real")}
        for r in redacted
    ]
    resp = _render("line", series, {
        "x": "x", "y": ["proyectado", "real"],
        "titulo": f"Cashflow últimas {weeks} semanas",
    })
    if resp.get("success"):
        resp["data"] = series
    return resp


def margen_marcas_chart() -> dict:
    """(Visualización, CEO-only) Chart de margen proyectado vs real por marca.

    Usa `analytics/margen_marcas/` (el backend lo restringe a CEO/Admin).
    Devuelve `{success, image_url, expires_at, data}`.
    """
    raw = api.get("analytics/margen_marcas/")
    if isinstance(raw, dict) and raw.get("error"):
        return {"success": False, "image_url": None,
                "errorMessage": str(raw.get("detail") or raw.get("error"))}
    rows = raw if isinstance(raw, list) else (raw or {}).get("results") or []
    redacted = redact_for_user(rows, get_identity_user())
    series = [
        {"category": (r.get("brand_id") or r.get("marca") or ""),
         "proyectado": r.get("projected_margin"),
         "real": r.get("real_margin")}
        for r in redacted
    ]
    resp = _render("bar", series, {
        "category": "category", "value": "proyectado",
        "titulo": "Margen por marca (proyectado)",
    })
    if resp.get("success"):
        resp["data"] = series
    return resp


def dashboard_resumen(periodo: str = "30d", scope: str | None = None) -> dict:
    """(Visualización) Un solo call con KPIs + charts del dashboard.

    Devuelve `{kpis, image_urls: {cashflow, margen}, resumen}`. `periodo` y
    `scope` son pistas para el agente; los charts usan las tools de analytics.
    """
    cash = cashflow_chart(12)
    margen = margen_marcas_chart()
    kpis = {}
    if isinstance(cash.get("data"), list) and cash["data"]:
        kpis["cashflow_real"] = sum(
            float(x.get("real") or 0) for x in cash["data"])
        kpis["cashflow_proyectado"] = sum(
            float(x.get("proyectado") or 0) for x in cash["data"])
    return {
        "success": True,
        "periodo": periodo,
        "scope": scope,
        "kpis": kpis,
        "image_urls": {
            "cashflow": cash.get("image_url"),
            "margen_marcas": margen.get("image_url"),
        },
        "resumen": (
            "Cashflow proyectado vs real y margen por marca. "
            "Interpreta los números con el data de cada chart."
        ),
    }
