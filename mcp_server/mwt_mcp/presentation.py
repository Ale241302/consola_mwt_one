"""Ola 3.10 ampliada · Motor de presentación del MCP — 13 tools en 5 categorías.

El MCP deja de ser solo-datos: la IA puede entregar el resultado en el
formato más útil según la pregunta.

Categorías (alineado con plan §0b):
  P1 · Gráficos       generar_grafico, cashflow_chart, margen_marcas_chart
                      (CEO-only), aging_chart, exposicion_chart
  P2 · Tablas         render_tabla
  P3 · Reportes       generar_reporte, reporte_cobranza, reporte_expedientes
  P4 · Dashboards     dashboard_resumen, comparar
  P5 · Exportaciones  exportar_xlsx, exportar_csv

Seguridad (heredada de las Olas 3.5/3.6/3.7):
  · `redact_for_user` se aplica a los DATOS ANTES de enviarlos al renderizador
    — ningún PNG/PDF/tabla/xlsx puede filtrar datos que el rol no ve.
  · El backend solo recibe datos puros (nunca URLs/HTML) → sin SSRF.
  · URLs firmadas con TTL: 5 min imágenes/tablas, 15 min reportes/exportaciones.
  · Rate limit en `/api/presentation/render/`.
"""
from __future__ import annotations

from typing import Any

from . import client as api
from .redact import redact_for_user
from .jwt_minter import get_identity_user

_PRES_URL = "presentation/render/"


def _user() -> dict | None:
    return get_identity_user()


def _redact(payload):
    return redact_for_user(payload, _user())


def _call_render(body: dict) -> dict:
    """POST al motor de presentación y normaliza la respuesta."""
    try:
        resp = api.post(_PRES_URL, body)
    except Exception as e:  # noqa: BLE001 - frontera
        return {"success": False, "url": None, "image_url": None,
                "errorMessage": f"Error al renderizar: {e}"}
    if isinstance(resp, dict) and resp.get("error"):
        return {"success": False, "url": None, "image_url": None,
                "errorMessage": str(resp.get("detail") or resp.get("error"))}
    if isinstance(resp, dict) and resp.get("success"):
        return resp
    return {"success": False, "url": None, "image_url": None,
            "errorMessage": f"Respuesta inesperada: {resp}"}


def _safe_rows(raw) -> list:
    if isinstance(raw, list):
        return raw
    if isinstance(raw, dict) and isinstance(raw.get("results"), list):
        return raw["results"]
    return []


# ═══════════════════════════════════════════════════════════════════════ #
# P1 · Gráficos
# ═══════════════════════════════════════════════════════════════════════ #
def generar_grafico(tipo: str, data: list, opciones: dict | None = None) -> dict:
    """(Presentación P1) Genera un chart SVG server-side desde datos puros.

    `tipo`: line | area | bar | column | pie. `data`: array de filas (máx
    5000). `opciones`: {x, y, category, value, titulo, width, height, palette}.
    Devuelve `{success, image_url, expires_at}` (URL firmada TTL 5 min).
    Los datos se redactan por rol ANTES de renderizar.
    """
    try:
        data = list(data or [])
    except Exception:  # noqa: BLE001
        return {"success": False, "image_url": None,
                "errorMessage": "data debe ser un array."}
    if not data:
        return {"success": False, "image_url": None,
                "errorMessage": "data vacío. Proporciona al menos una fila."}
    if len(data) > 5000:
        return {"success": False, "image_url": None,
                "errorMessage": "data excede 5000 filas."}
    return _call_render({"kind": "chart", "tipo": tipo,
                         "data": _redact(data), "opciones": opciones or {}})


def cashflow_chart(semanas: int | None = None) -> dict:
    """(Presentación P1) Chart de cashflow de las últimas N semanas.

    Usa `analytics/cashflow/` (proyectado vs real). Devuelve
    `{success, image_url, expires_at, data}`.
    """
    try:
        weeks = max(1, min(int(semanas or 12), 52))
    except (TypeError, ValueError):
        weeks = 12
    raw = api.get("analytics/cashflow/", {"semanas": weeks})
    if isinstance(raw, dict) and raw.get("error"):
        return {"success": False, "image_url": None,
                "errorMessage": str(raw.get("detail") or raw.get("error"))}
    rows = _safe_rows(raw)
    redacted = _redact(rows)
    series = [{"x": r.get("week") or r.get("x") or "",
               "proyectado": r.get("proyectado"), "real": r.get("real")}
              for r in redacted]
    resp = _call_render({"kind": "chart", "tipo": "line", "data": series,
                         "opciones": {"x": "x", "y": ["proyectado", "real"],
                                      "titulo": f"Cashflow últimas {weeks} semanas"}})
    if resp.get("success"):
        resp["data"] = series
    return resp


def margen_marcas_chart() -> dict:
    """(Presentación P1, CEO-only) Chart de margen proyectado vs real por marca.

    Usa `analytics/margen_marcas/` (el backend lo restringe a CEO/Admin).
    Devuelve `{success, image_url, expires_at, data}`.
    """
    raw = api.get("analytics/margen_marcas/")
    if isinstance(raw, dict) and raw.get("error"):
        return {"success": False, "image_url": None,
                "errorMessage": str(raw.get("detail") or raw.get("error"))}
    rows = _safe_rows(raw)
    redacted = _redact(rows)
    series = [{"category": r.get("brand_id") or r.get("marca") or "",
               "proyectado": r.get("projected_margin"),
               "real": r.get("real_margin")} for r in redacted]
    resp = _call_render({"kind": "chart", "tipo": "bar", "data": series,
                         "opciones": {"category": "category", "value": "proyectado",
                                      "titulo": "Margen por marca (proyectado)"}})
    if resp.get("success"):
        resp["data"] = series
    return resp


def aging_chart(dias: int | None = None) -> dict:
    """(Presentación P1) Chart de aging de cuentas por cobrar.

    Usa `analytics/aging/` (buckets 0-30, 31-60, 61-90, 90+). Devuelve
    `{success, image_url, expires_at, data}`.
    """
    raw = api.get("analytics/aging/")
    if isinstance(raw, dict) and raw.get("error"):
        return {"success": False, "image_url": None,
                "errorMessage": str(raw.get("detail") or raw.get("error"))}
    data = _redact(raw if isinstance(raw, dict) else {})
    series = [
        {"category": "0-30", "value": data.get("bucket_0_30") or 0},
        {"category": "31-60", "value": data.get("bucket_31_60") or 0},
        {"category": "61-90", "value": data.get("bucket_61_90") or 0},
        {"category": "90+", "value": data.get("bucket_90_plus") or 0},
    ]
    resp = _call_render({"kind": "chart", "tipo": "bar", "data": series,
                         "opciones": {"category": "category", "value": "value",
                                      "titulo": "Aging de cuentas por cobrar"}})
    if resp.get("success"):
        resp["data"] = series
        resp["totales"] = {"total": data.get("total") or 0}
    return resp


def exposicion_chart() -> dict:
    """(Presentación P1) Chart de exposición por cliente.

    Usa `analytics/exposicion_clientes/`. Devuelve `{success, image_url, data}`.
    """
    raw = api.get("analytics/exposicion_clientes/")
    if isinstance(raw, dict) and raw.get("error"):
        return {"success": False, "image_url": None,
                "errorMessage": str(raw.get("detail") or raw.get("error"))}
    rows = _safe_rows(raw)
    redacted = _redact(rows)
    series = [{"category": r.get("client_name") or r.get("client_id") or "?",
               "value": r.get("exposicion") or r.get("balance") or r.get("monto") or 0}
              for r in redacted]
    resp = _call_render({"kind": "chart", "tipo": "bar", "data": series,
                         "opciones": {"category": "category", "value": "value",
                                      "titulo": "Exposición por cliente"}})
    if resp.get("success"):
        resp["data"] = series
    return resp


# ═══════════════════════════════════════════════════════════════════════ #
# P2 · Tablas
# ═══════════════════════════════════════════════════════════════════════ #
def render_tabla(columnas: list, filas: list, titulo: str | None = None,
                 resaltar: str | None = None) -> dict:
    """(Presentación P2) Tabla renderizada server-side con branding MWT.

    `columnas`: [{key, label, tipo?}]. `filas`: list[dict] (máx 500).
    Devuelve `{success, image_url, tabla_markdown}` — el SVG para mostrar y el
    Markdown para que la IA interprete/responda. Los datos se redactan por rol.
    """
    if not columnas or not isinstance(columnas, list):
        return {"success": False, "image_url": None,
                "errorMessage": "columnas debe ser un array no vacío."}
    try:
        filas = list(filas or [])
    except Exception:  # noqa: BLE001
        return {"success": False, "image_url": None,
                "errorMessage": "filas debe ser un array."}
    if len(filas) > 500:
        return {"success": False, "image_url": None,
                "errorMessage": "filas excede 500."}
    redacted = _redact(filas)
    return _call_render({"kind": "tabla", "columnas": columnas, "filas": redacted,
                         "titulo": titulo, "resaltar": resaltar})


# ═══════════════════════════════════════════════════════════════════════ #
# P3 · Reportes
# ═══════════════════════════════════════════════════════════════════════ #
def generar_reporte(titulo: str, secciones: list, formato: str = "markdown") -> dict:
    """(Presentación P3) Genera un reporte (Markdown o PDF firmado).

    `titulo`: del reporte. `secciones`: [{titulo, tipo: "texto"|"tabla"|"chart",
    data?}]. `formato`: "markdown" (default) | "pdf".
    Devuelve `{success, url, markdown}` — URL firmada TTL 15 min.
    """
    if not titulo:
        return {"success": False, "url": None, "markdown": None,
                "errorMessage": "titulo es obligatorio."}
    if not isinstance(secciones, list) or not secciones:
        return {"success": False, "url": None, "markdown": None,
                "errorMessage": "secciones debe ser un array no vacío."}
    # Redactar las tablas dentro de las secciones.
    secciones_r = []
    for sec in secciones:
        s = dict(sec)
        if (sec.get("tipo") or "").lower() == "tabla":
            d = dict(sec.get("data") or {})
            d["filas"] = _redact(d.get("filas") or [])
            s["data"] = d
        secciones_r.append(s)
    fmt = (formato or "markdown").lower()
    return _call_render({"kind": "reporte", "titulo": titulo,
                         "secciones": secciones_r, "formato": fmt})


def reporte_cobranza(mes: str, formato: str = "markdown") -> dict:
    """(Presentación P3) Reporte mensual de cobranza.

    Combina aging + un resumen de montos. Devuelve `{success, url, markdown}`.
    `mes`: "YYYY-MM". Datos redactados por rol antes de armar el reporte.
    """
    raw = api.get("analytics/aging/")
    if isinstance(raw, dict) and raw.get("error"):
        return {"success": False, "url": None, "markdown": None,
                "errorMessage": str(raw.get("detail") or raw.get("error"))}
    data = _redact(raw if isinstance(raw, dict) else {})
    secciones = [
        {"titulo": "Resumen de cobranza", "tipo": "texto",
         "data": (f"Reporte de cobranza del período {mes}. "
                  f"Total pendiente: {data.get('total') or 0}.")},
        {"titulo": "Aging por bucket", "tipo": "tabla",
         "data": {"columnas": [
             {"key": "bucket", "label": "Bucket"},
             {"key": "monto", "label": "Monto", "tipo": "money"},
         ], "filas": [
             {"bucket": "0-30", "monto": data.get("bucket_0_30") or 0},
             {"bucket": "31-60", "monto": data.get("bucket_31_60") or 0},
             {"bucket": "61-90", "monto": data.get("bucket_61_90") or 0},
             {"bucket": "90+", "monto": data.get("bucket_90_plus") or 0},
         ]}},
    ]
    return generar_reporte(f"Reporte de cobranza {mes}", secciones, formato)


def reporte_expedientes(periodo: str | None = None, scope: str | None = None,
                        formato: str = "markdown") -> dict:
    """(Presentación P3) Resumen de expedientes del período.

    Usa `analytics/by_status/` (conteo + montos por estado). Devuelve
    `{success, url, markdown}` — URL firmada TTL 15 min.
    """
    raw = api.get("analytics/by_status/")
    if isinstance(raw, dict) and raw.get("error"):
        return {"success": False, "url": None, "markdown": None,
                "errorMessage": str(raw.get("detail") or raw.get("error"))}
    rows = _safe_rows(raw)
    redacted = _redact(rows)
    secciones = [
        {"titulo": "Resumen de expedientes", "tipo": "texto",
         "data": (f"Expedientes del período {periodo or 'reciente'} "
                  f"(scope: {scope or 'todos'}).")},
        {"titulo": "Conteo por estado", "tipo": "tabla",
         "data": {"columnas": [
             {"key": "status", "label": "Estado"},
             {"key": "count", "label": "Conteo"},
         ], "filas": [{"status": r.get("status"), "count": r.get("count")}
                      for r in redacted]}},
    ]
    return generar_reporte("Reporte de expedientes", secciones, formato)


# ═══════════════════════════════════════════════════════════════════════ #
# P4 · Dashboards
# ═══════════════════════════════════════════════════════════════════════ #
def dashboard_resumen(periodo: str = "30d", scope: str | None = None) -> dict:
    """(Presentación P4) Panorama completo en un solo call.

    Devuelve `{kpis, image_urls: {cashflow, margen, aging, exposicion},
    resumen_markdown}`. Un call para el panorama del mes.
    """
    cash = cashflow_chart(12)
    margen = margen_marcas_chart()
    aging = aging_chart()
    expos = exposicion_chart()

    kpis = {}
    if isinstance(cash.get("data"), list) and cash["data"]:
        kpis["cashflow_real"] = sum(float(x.get("real") or 0) for x in cash["data"])
        kpis["cashflow_proyectado"] = sum(float(x.get("proyectado") or 0) for x in cash["data"])
    if isinstance(aging.get("totales"), dict):
        kpis["cuentas_por_cobrar"] = aging["totales"].get("total")

    resumen = (
        f"# Panorama {periodo}\n\n"
        "KPIs y charts del período. **Cashflow:** proyectado "
        f"{kpis.get('cashflow_proyectado')} / real {kpis.get('cashflow_real')}. "
        "Los charts de margen (CEO) y exposición complementan el panorama."
    )
    return {
        "success": True,
        "periodo": periodo,
        "scope": scope,
        "kpis": kpis,
        "image_urls": {
            "cashflow": cash.get("image_url"),
            "margen_marcas": margen.get("image_url"),
            "aging": aging.get("image_url"),
            "exposicion": expos.get("image_url"),
        },
        "resumen_markdown": resumen,
    }


def comparar(metricas: list, grupo: str = "marca") -> dict:
    """(Presentación P4) Compara métricas entre grupos (marca/cliente/nodo/mes).

    Devuelve `{success, image_url, tabla_markdown, insights}`. Las `metricas`
    deben ser [{grupo, valor}] o [{categoria, valor}] — la IA arma los datos y
    esta tool los presenta de forma consistente. Los datos se redactan por rol.
    """
    if not metricas or not isinstance(metricas, list):
        return {"success": False, "image_url": None, "tabla_markdown": None,
                "errorMessage": "metricas debe ser un array no vacío."}
    redacted = _redact(metricas)
    columnas = [
        {"key": "grupo", "label": grupo.title()},
        {"key": "valor", "label": "Valor", "tipo": "money"},
    ]
    filas = []
    for m in redacted:
        filas.append({
            "grupo": m.get("grupo") or m.get("categoria") or m.get("category") or "?",
            "valor": m.get("valor") or m.get("value") or m.get("monto") or 0,
        })
    resp = _call_render({"kind": "tabla", "columnas": columnas, "filas": filas,
                         "titulo": f"Comparativa por {grupo}"})
    if resp.get("success"):
        # Markdown construido localmente (independiente del backend).
        md_lines = ["| %s | Valor |" % grupo.title(),
                    "|---|---|"]
        for f in filas:
            md_lines.append("| %s | %s |" % (f.get("grupo"), f.get("valor")))
        resp["tabla_markdown"] = "\n".join(md_lines)
        resp["insights"] = (f"Comparativa por {grupo}: {len(filas)} grupos. "
                            "Interpreta los valores del markdown.")
    return resp


# ═══════════════════════════════════════════════════════════════════════ #
# P5 · Exportaciones
# ═══════════════════════════════════════════════════════════════════════ #
def exportar_xlsx(nombre_archivo: str, hojas: list) -> dict:
    """(Presentación P5) Exporta a Excel (XLSX firmado TTL 15 min).

    `hojas`: [{nombre, columnas: [{key, label}], filas: [dict]}]. Máx 5 hojas,
    10000 filas por hoja. Los datos se redactan por rol.
    """
    if not nombre_archivo:
        return {"success": False, "url": None,
                "errorMessage": "nombre_archivo es obligatorio."}
    if not isinstance(hojas, list) or not hojas:
        return {"success": False, "url": None,
                "errorMessage": "hojas debe ser un array no vacío."}
    hojas_r = []
    for h in hojas:
        hh = dict(h)
        hh["filas"] = _redact(h.get("filas") or [])
        hojas_r.append(hh)
    resp = _call_render({"kind": "xlsx", "nombre_archivo": nombre_archivo,
                         "hojas": hojas_r})
    return {"success": resp.get("success"), "download_url": resp.get("url"),
            "expires_at": resp.get("expires_at"),
            "errorMessage": resp.get("errorMessage")}


def exportar_csv(nombre_archivo: str, columnas: list, filas: list) -> dict:
    """(Presentación P5) Exporta a CSV (firmado TTL 15 min).

    `columnas`: [{key, label}]. `filas`: list[dict]. Los datos se redactan.
    """
    if not nombre_archivo:
        return {"success": False, "url": None,
                "errorMessage": "nombre_archivo es obligatorio."}
    if not isinstance(columnas, list) or not columnas:
        return {"success": False, "url": None,
                "errorMessage": "columnas debe ser un array no vacío."}
    redacted = _redact(list(filas or []))
    resp = _call_render({"kind": "csv", "nombre_archivo": nombre_archivo,
                         "columnas": columnas, "filas": redacted})
    return {"success": resp.get("success"), "download_url": resp.get("url"),
            "expires_at": resp.get("expires_at"),
            "errorMessage": resp.get("errorMessage")}
