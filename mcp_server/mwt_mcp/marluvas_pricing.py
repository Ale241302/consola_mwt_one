"""Precios Marluvas por banda/plazo para el MCP (Ola 3.7 · Calidad).

El backend expone `commercial/marluvas/product-clients-matrix/?sku=...` que
trae `prices_matrix` precalculado: para CADA banda (1..12) el precio por plazo
(8/15/30/60/90 días), por cliente. Este módulo:

  · Determina la BANDA VIGENTE a partir del tipo de cambio USD/BRL actual
    (`exchange-rate/usd-brl`) usando los mismos rangos/divisores que el
    frontend (BANDAS_MARLUVAS).
  · Devuelve el precio de la banda vigente y el plazo pedido (default 90).
  · Filtra por rol: CEO/Admin ve todos los clientes; client_b2b solo sus
    legal_entity_ids; staff no-CEO ve la matriz pero sin precios por cliente.

Equivalencia con frontend/src/constants/marluvas.js (fuente única de verdad):
  banda id = floor((tc - 4.00) / 0.20) + 1, clamp 1..12.
"""
from __future__ import annotations

from . import client as api

# BANDAS_MARLUVAS (id -> {rango, div}) — espejo del frontend.
BANDAS_MARLUVAS = [
    {"id": 1,  "rango": "4,00 – 4,20", "div": 4.07, "techo": True},
    {"id": 2,  "rango": "4,20 – 4,40", "div": 4.27},
    {"id": 3,  "rango": "4,40 – 4,60", "div": 4.46},
    {"id": 4,  "rango": "4,60 – 4,80", "div": 4.66},
    {"id": 5,  "rango": "4,80 – 5,00", "div": 4.85},
    {"id": 6,  "rango": "5,00 – 5,20", "div": 5.04},
    {"id": 7,  "rango": "5,20 – 5,40", "div": 5.24},
    {"id": 8,  "rango": "5,40 – 5,60", "div": 5.43},
    {"id": 9,  "rango": "5,60 – 5,80", "div": 5.63},
    {"id": 10, "rango": "5,80 – 6,00", "div": 5.82},
    {"id": 11, "rango": "6,00 – 6,20", "div": 6.01},
    {"id": 12, "rango": "6,20 – 6,40", "div": 6.21, "piso": True},
]

# Plazos soportados (días).
PLAZOS_VALIDOS = {8, 15, 30, 60, 90}


def banda_for_tc(tc: float | None) -> dict | None:
    """Banda vigente dado el USD/BRL. Espejo de bandaForTC del frontend."""
    if tc is None:
        return None
    try:
        n = float(tc)
    except (TypeError, ValueError):
        return None
    if n < 4.00 or n >= 6.40:
        return None
    idx = min(11, max(0, int((n - 4.00) / 0.20)))
    return BANDAS_MARLUVAS[idx]


def _tc_usd_brl() -> float | None:
    """Tipo de cambio actual USD/BRL desde el backend. Fail-safe -> None."""
    try:
        data = api.get("commercial/exchange-rate/usd-brl/")
        if isinstance(data, dict):
            rate = data.get("rate")
            return float(rate) if rate is not None else None
    except Exception:  # noqa: BLE001
        pass
    return None


def _coerce_plazo(plazo_dias: int | None) -> int:
    if plazo_dias is None:
        return 90
    try:
        p = int(plazo_dias)
    except (TypeError, ValueError):
        return 90
    return p if p in PLAZOS_VALIDOS else 90


def _pick(matrix_row: dict, plazo: int) -> float | None:
    """Toma el precio de un row de banda para el plazo pedido."""
    if not isinstance(matrix_row, dict):
        return None
    val = matrix_row.get(str(plazo))
    if val is None:
        return None
    try:
        return round(float(val), 4)
    except (TypeError, ValueError):
        return None


def _client_ids_for_user(user: dict | None) -> set[str]:
    ids = (user or {}).get("legal_entity_ids") or []
    return {str(x) for x in ids}


def resolve_precio_cliente(matrix_payload: dict, *, user: dict | None = None,
                           plazo_dias: int | None = None,
                           banda_id: int | None = None,
                           usar_tc_actual: bool = True) -> dict:
    """Resuelve el precio del SKU por cliente.

    `matrix_payload` es la respuesta de product-clients-matrix (o un dict con
    `clients`). Devuelve:
      { sku, banda_vigente: {id, rango, div, tc}, plazo_dias,
        clientes: [{cliente_id, razon_social, nombre_comercial,
                    precio, precio_por_plazos: {...}}] }

    Banda elegida: si `banda_id` viene, esa; si no y usar_tc_actual, la del TC;
    si no hay TC, la 6 (rango 5.00-5.20, la vigente según la captura).
    """
    from .redact import is_ceo_or_admin, is_client

    role = (user or {}).get("role") or (user or {}).get("role_slug") or ""
    plazo = _coerce_plazo(plazo_dias)

    # 1) Resolver la banda vigente.
    banda = None
    tc = None
    if banda_id is not None:
        banda = next((b for b in BANDAS_MARLUVAS if b["id"] == int(banda_id)), None)
    elif usar_tc_actual:
        tc = _tc_usd_brl()
        banda = banda_for_tc(tc)
    if banda is None:
        banda = BANDAS_MARLUVAS[5]  # id 6 · 5,00–5,20 (vigente por defecto)
        if tc is None:
            tc = 5.08

    # 2) Recorrer clientes.
    clients = matrix_payload.get("clients") or [] if isinstance(matrix_payload, dict) else []
    out_clients = []
    allowed = _client_ids_for_user(user)

    for cli in clients:
        cid = str(cli.get("cliente_id") or "")
        if not cid:
            continue
        # Filtro por rol: CEO/Admin ve todos; client_b2b solo sus empresas;
        # staff no-CEO no ve precios por cliente (omitimos).
        if is_ceo_or_admin(role):
            pass
        elif is_client(role):
            if cid not in allowed:
                continue
        else:
            continue  # staff no-CEO: sin precios por cliente

        matrix = cli.get("prices_matrix") or {}
        row = matrix.get(str(banda["id"])) or {}
        precio = _pick(row, plazo)
        precio_por_plazos = {
            str(p): _pick(row, p) for p in sorted(PLAZOS_VALIDOS)
            if _pick(row, p) is not None
        }
        out_clients.append({
            "cliente_id": cid,
            "razon_social": cli.get("razon_social"),
            "nombre_comercial": cli.get("nombre_comercial"),
            "com_pct": cli.get("com_pct"),
            "sobreprecio_pct": cli.get("sobreprecio_pct"),
            "banda": banda["id"],
            "plazo_dias": plazo,
            "precio": precio,
            "precio_por_plazos": precio_por_plazos,
        })

    return {
        "sku": matrix_payload.get("sku") if isinstance(matrix_payload, dict) else None,
        "banda_vigente": {"id": banda["id"], "rango": banda["rango"],
                          "div": banda["div"], "tc_usd_brl": tc},
        "plazo_dias": plazo,
        "clientes": out_clients,
    }
