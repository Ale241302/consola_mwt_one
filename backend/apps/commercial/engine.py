"""Motor de precios Marluvas · fuente única de verdad en el backend.

Este módulo concentra la matemática del motor de precios COMEX (la misma
que aplica el frontend en `src/lib/marluvasPricing.js` y el MCP en
`mwt_mcp/marluvas_pricing.py`) para que el backend pueda:

  1. Importar el Excel COMEX una sola vez y guardar el precio base BRL por
     SKU en `pricing.marluvas_engine_sku` (el "último Excel del motor").
  2. Materializar la matriz 12 bandas × plazos por cliente en
     `pricing.marluvas_client_sku_pricing`.
  3. Aplicar la GOBERNANZA DE PRECIOS a un producto: dejar
     `especificaciones.client_prices` (lo que lee la creación de
     expedientes), `precio_lista` y `precio_mwt` calculados desde ese
     snapshot. Así un producto creado por una IA nunca queda en $0.

Fórmulas (idénticas al frontend):
    P_base[banda]      = (BRL / divisor[banda]) × 1.0183^com × 1.030
    P_lista[banda]     = P_base + ajuste_$ + P_base × sobreprecio_%
    P_final[banda,plazo] = P_lista × factor_plazo

`com` son PUNTOS porcentuales (10 = 10%). En `clientes.cliente.comision_pct`
la comisión se guarda como fracción (0.10) → este módulo la normaliza.
"""
from __future__ import annotations

import json
import logging
import re
import unicodedata
import uuid
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable

from django.db import connection, transaction
from django.utils import timezone

log = logging.getLogger(__name__)

# ── Constantes del motor (espejo de frontend/src/constants/marluvas.js) ──
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

# (días, factor) — 90d es la base.
PLAZOS_MARLUVAS = [
    (90, 1.0000),
    (60, 0.9900),
    (30, 0.9825),
    (15, 0.9757),
    (8,  0.9725),
]

INDICE_ME_90 = 1.030
FACTOR_COMISION = 1.0183
BANDA_DEFAULT_ID = 10          # 5,80 – 6,00 (fallback si no hay TC)
PLAZO_DEFAULT = 90
MODEL_VERSION = "comex-2026"

# Cliente que representa a Muito Work Limitada como entidad legal.
MWT_OPERATING_CLIENT_ID = "5525986c-3b09-4d13-bf8f-43ccaa2deae3"


# =====================================================================
# Matemática
# =====================================================================
def round4(value: float) -> float:
    return round(float(value) + 0.0, 4)


def precio_base_usd(brl: float, divisor: float, com_pct: float) -> float:
    """(BRL / divisor) × 1.0183^com × 1.030 — precio base de una banda."""
    if not divisor:
        return 0.0
    com = float(com_pct) if com_pct is not None else 0.0
    return (float(brl) / float(divisor)) * (FACTOR_COMISION ** com) * INDICE_ME_90


def banda_para_tc(tc: float | None) -> dict:
    """Banda vigente para el USD/BRL (misma regla que el frontend)."""
    try:
        n = float(tc)
    except (TypeError, ValueError):
        n = None
    if n is None or n < 4.00 or n >= 6.40:
        return next(b for b in BANDAS_MARLUVAS if b["id"] == BANDA_DEFAULT_ID)
    idx = min(11, max(0, int((n - 4.00) / 0.20)))
    return BANDAS_MARLUVAS[idx]


def comision_a_puntos(valor: Any) -> float:
    """Normaliza la comisión a PUNTOS porcentuales.

    `clientes.cliente.comision_pct` guarda fracción (0.10 = 10%). Si llega
    un valor > 1 se asume que ya está en puntos.
    """
    if valor in (None, ""):
        return 0.0
    try:
        num = float(valor)
    except (TypeError, ValueError):
        return 0.0
    if num <= 1.0:
        num *= 100.0
    return round(num, 4)


def compute_matrix(brl: float, com_pct: float, *, ajuste: float = 0.0,
                   sobreprecio: float = 0.0,
                   plazos: Iterable[tuple[int, float]] | None = None,
                   ) -> dict[str, dict[str, float]]:
    """Matriz {banda: {plazo: precio}} con la fórmula del motor."""
    ajuste = float(ajuste or 0)
    sobreprecio = float(sobreprecio or 0)
    plazos = list(plazos or PLAZOS_MARLUVAS)
    out: dict[str, dict[str, float]] = {}
    for banda in BANDAS_MARLUVAS:
        base = precio_base_usd(brl, banda["div"], com_pct)
        lista = base + ajuste + base * sobreprecio
        out[str(banda["id"])] = {
            str(dias): round4(lista * factor) for dias, factor in plazos
        }
    return out


def precio_en(matrix: dict, banda_id: int, plazo_dias: int) -> float | None:
    """Precio de una celda de la matriz; None si no existe."""
    try:
        row = (matrix or {}).get(str(int(banda_id))) or {}
    except (TypeError, ValueError):
        return None
    val = row.get(str(int(plazo_dias)))
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


# =====================================================================
# Banda vigente POR CLIENTE
# =====================================================================
def politica_cliente(brand_id, cliente_id) -> dict | None:
    """Política de banda configurada para (marca, cliente), si existe."""
    try:
        with connection.cursor() as cur:
            cur.execute("""
                SELECT banda_vigente, banda_techo, banda_piso, plazo_dias,
                       updated_at
                  FROM pricing.marluvas_client_band_policy
                 WHERE brand_id = %s AND cliente_id = %s AND is_active = TRUE
                 LIMIT 1
            """, [str(brand_id), str(cliente_id)])
            row = cur.fetchone()
    except Exception as exc:  # noqa: BLE001
        log.warning("engine.politica_cliente failed: %s", exc)
        return None
    if not row:
        return None
    return {
        "banda_vigente": int(row[0]) if row[0] else None,
        "banda_techo": int(row[1] or 1),
        "banda_piso": int(row[2] or 12),
        "plazo_dias": int(row[3] or PLAZO_DEFAULT),
        "updated_at": row[4].isoformat() if row[4] else None,
    }


def politicas_de_clientes(brand_id, clientes: list[dict], *,
                        tc: float | None = None) -> dict[str, dict]:
    """Resuelve la banda/plazo efectivos de cada cliente en UNA query.

    Devuelve {cliente_id: {banda, plazo_dias, fuente, banda_vigente,
    banda_techo, banda_piso}}. `fuente` es "CLIENTE" si la banda viene de la
    política configurada o "TC" si es automática.
    """
    tc = tc if tc is not None else tc_usd_brl()
    ids = [str(c["cliente_id"]) for c in clientes]
    politicas: dict[str, dict] = {}
    if ids:
        try:
            with connection.cursor() as cur:
                cur.execute("""
                    SELECT cliente_id::text, banda_vigente, banda_techo,
                           banda_piso, plazo_dias
                      FROM pricing.marluvas_client_band_policy
                     WHERE brand_id = %s AND is_active = TRUE
                       AND cliente_id::text = ANY(%s)
                """, [str(brand_id), ids])
                for cid, vig, techo, piso, plazo in cur.fetchall():
                    politicas[str(cid)] = {
                        "banda_vigente": int(vig) if vig else None,
                        "banda_techo": int(techo or 1),
                        "banda_piso": int(piso or 12),
                        "plazo_dias": int(plazo or PLAZO_DEFAULT),
                    }
        except Exception as exc:  # noqa: BLE001
            log.warning("engine.politicas failed: %s", exc)

    out: dict[str, dict] = {}
    for cli in clientes:
        cid = str(cli["cliente_id"])
        pol = politicas.get(cid) or {}
        vig = pol.get("banda_vigente")
        if vig:
            banda = next((b for b in BANDAS_MARLUVAS if b["id"] == vig),
                         None) or banda_para_tc(tc)
            fuente = "CLIENTE"
        else:
            banda = banda_para_tc(tc)
            fuente = "TC"
        out[cid] = {
            "banda": banda,
            "plazo_dias": int(pol.get("plazo_dias") or PLAZO_DEFAULT),
            "fuente": fuente,
            "banda_vigente": vig,
            "banda_techo": int(pol.get("banda_techo") or 1),
            "banda_piso": int(pol.get("banda_piso") or 12),
        }
    return out


def guardar_politica_cliente(brand_id, cliente_id, *, banda_vigente=None,
                             banda_techo=1, banda_piso=12, plazo_dias=90,
                             user_id=None) -> dict:
    """Upsert de la política de banda del cliente (desactiva la anterior)."""
    def _banda(value, field):
        if value in (None, "", "auto", "AUTO"):
            return None
        try:
            num = int(value)
        except (TypeError, ValueError):
            raise ValueError(f"{field} debe ser 1..12 o null") from None
        if not 1 <= num <= 12:
            raise ValueError(f"{field} debe ser 1..12 o null")
        return num

    vig = _banda(banda_vigente, "banda_vigente")
    techo = _banda(banda_techo, "banda_techo") or 1
    piso = _banda(banda_piso, "banda_piso") or 12
    try:
        plazo = int(plazo_dias or PLAZO_DEFAULT)
    except (TypeError, ValueError):
        plazo = PLAZO_DEFAULT
    if plazo not in {p[0] for p in PLAZOS_MARLUVAS}:
        plazo = PLAZO_DEFAULT

    with transaction.atomic():
        with connection.cursor() as cur:
            cur.execute("""
                UPDATE pricing.marluvas_client_band_policy
                   SET is_active = FALSE, updated_at = now()
                 WHERE brand_id = %s AND cliente_id = %s AND is_active = TRUE
            """, [str(brand_id), str(cliente_id)])
            cur.execute("""
                INSERT INTO pricing.marluvas_client_band_policy
                    (id, brand_id, cliente_id, banda_vigente, banda_techo,
                     banda_piso, plazo_dias, updated_by, is_active,
                     created_at, updated_at)
                VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s,
                        TRUE, now(), now())
            """, [str(brand_id), str(cliente_id), vig, techo, piso, plazo,
                  str(user_id) if user_id else None])
    return {
        "brand_id": str(brand_id),
        "cliente_id": str(cliente_id),
        "banda_vigente": vig,
        "banda_techo": techo,
        "banda_piso": piso,
        "plazo_dias": plazo,
    }


# =====================================================================
# Tipo de cambio USD/BRL (cache compartida con MarluvasExchangeRateView)
# =====================================================================
def tc_usd_brl() -> float | None:
    """USD/BRL actual. Cache → AwesomeAPI → Frankfurter → None.

    Nunca lanza: el motor cae a la banda default si no hay cotización.
    """
    from django.core.cache import cache

    cached = None
    try:
        cached = cache.get("commercial:fx:usd-brl")
    except Exception:  # noqa: BLE001
        cached = None
    if isinstance(cached, dict) and cached.get("rate"):
        try:
            return float(cached["rate"])
        except (TypeError, ValueError):
            pass
    try:
        import requests
        resp = requests.get(
            "https://economia.awesomeapi.com.br/last/USD-BRL", timeout=4)
        resp.raise_for_status()
        bid = ((resp.json() or {}).get("USDBRL") or {}).get("bid")
        if bid:
            return float(bid)
    except Exception as exc:  # noqa: BLE001
        log.info("engine.tc_usd_brl sin cotización: %s", exc)
    return None


def anchor_actual(banda_id: int | None = None,
                  plazo_dias: int | None = None) -> dict:
    """Ancla efectiva del motor: banda (TC vigente) + plazo (90 por default)."""
    tc = tc_usd_brl()
    banda = None
    if banda_id not in (None, ""):
        try:
            banda = next((b for b in BANDAS_MARLUVAS
                          if b["id"] == int(banda_id)), None)
        except (TypeError, ValueError):
            banda = None
    if banda is None:
        banda = banda_para_tc(tc)
    try:
        plazo = int(plazo_dias) if plazo_dias not in (None, "") else PLAZO_DEFAULT
    except (TypeError, ValueError):
        plazo = PLAZO_DEFAULT
    if plazo not in {p[0] for p in PLAZOS_MARLUVAS}:
        plazo = PLAZO_DEFAULT
    return {"banda": banda, "plazo_dias": plazo, "tc_usd_brl": tc}


# =====================================================================
# Clientes de la marca
# =====================================================================
def clientes_activos() -> list[dict]:
    """Clientes activos con su comisión en PUNTOS porcentuales."""
    rows: list[dict] = []
    try:
        with connection.cursor() as cur:
            cur.execute("""
                SELECT id::text, razon_social, comision_pct
                  FROM clientes.cliente
                 WHERE is_active = TRUE
                   AND COALESCE(estado, 'ACTIVO') = 'ACTIVO'
                 ORDER BY razon_social
            """)
            for cid, razon, com in cur.fetchall():
                rows.append({
                    "cliente_id": cid,
                    "razon_social": razon,
                    "com_pct": comision_a_puntos(com),
                })
    except Exception as exc:  # noqa: BLE001
        log.warning("engine.clientes_activos failed: %s", exc)
    return rows


# =====================================================================
# Snapshot del Excel (precio base BRL por SKU)
# =====================================================================
def upsert_snapshot(brand_id, rows: list[dict], *, file_name: str | None = None,
                    anchor: dict | None = None,
                    user_id=None) -> dict:
    """Guarda/actualiza el precio BRL por SKU del último Excel del motor."""
    if not rows:
        return {"saved": 0}
    now = timezone.now()
    anchor = anchor or {}
    banda_id = (anchor.get("banda") or {}).get("id")
    plazo = anchor.get("plazo_dias")
    saved = 0
    with transaction.atomic():
        with connection.cursor() as cur:
            for row in rows:
                sku = str(row.get("sku") or "").strip()
                if not sku:
                    continue
                try:
                    brl = Decimal(str(row.get("brl")))
                except (InvalidOperation, TypeError, ValueError):
                    continue
                if brl <= 0:
                    continue
                ref = str(row.get("ref") or "").strip()[:240] or None
                cur.execute("""
                    INSERT INTO pricing.marluvas_engine_sku
                        (id, brand_id, sku, ref, brl, source_file,
                         anchor_banda, anchor_plazo, uploaded_by,
                         is_active, created_at, updated_at)
                    VALUES
                        (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s,
                         TRUE, now(), now())
                    ON CONFLICT (brand_id, sku) DO UPDATE SET
                        ref          = EXCLUDED.ref,
                        brl          = EXCLUDED.brl,
                        source_file  = EXCLUDED.source_file,
                        anchor_banda = EXCLUDED.anchor_banda,
                        anchor_plazo = EXCLUDED.anchor_plazo,
                        uploaded_by  = EXCLUDED.uploaded_by,
                        is_active    = TRUE,
                        updated_at   = now()
                """, [str(brand_id), sku, ref, brl, file_name,
                      banda_id, plazo, str(user_id) if user_id else None])
                saved += 1
    log.info("engine.upsert_snapshot brand=%s file=%s skus=%s",
             brand_id, file_name, saved)
    return {"saved": saved, "at": now.isoformat()}


def snapshot_para_sku(brand_id, sku: str) -> dict | None:
    """Precio base BRL del último Excel para un SKU."""
    return snapshot_todos(brand_id, skus=[sku]).get(str(sku))


def snapshot_todos(brand_id, skus: list[str] | None = None) -> dict[str, dict]:
    """Precio base BRL del último Excel para todos los SKU de una marca.

    Devuelve {sku: {brl, ref, source_file, anchor_banda, anchor_plazo,
    updated_at}}. Una sola query: lo usan la gobernanza y el refresh de
    banda vigente.
    """
    sql = """
        SELECT sku, brl, ref, source_file, anchor_banda, anchor_plazo,
               updated_at
          FROM pricing.marluvas_engine_sku
         WHERE brand_id = %s AND is_active = TRUE
    """
    params: list[Any] = [str(brand_id)]
    if skus:
        sql += " AND sku = ANY(%s)"
        params.append([str(s) for s in skus])
    out: dict[str, dict] = {}
    try:
        with connection.cursor() as cur:
            cur.execute(sql, params)
            for row in cur.fetchall():
                out[str(row[0])] = {
                    "brl": float(row[1]),
                    "ref": row[2],
                    "source_file": row[3],
                    "anchor_banda": row[4],
                    "anchor_plazo": row[5],
                    "updated_at": row[6].isoformat() if row[6] else None,
                }
    except Exception as exc:  # noqa: BLE001
        log.warning("engine.snapshot_todos failed: %s", exc)
    return out


# =====================================================================
# Materialización por cliente (marluvas_client_sku_pricing)
# =====================================================================
def _as_matrix(value) -> dict:
    """Normaliza una matriz que puede venir como dict o como JSON string."""
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip().startswith("{"):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except (TypeError, ValueError):
            return {}
    return {}


def matrices_activas(brand_id, cliente_ids: list[str],
                     skus: list[str]) -> dict[tuple[str, str], dict]:
    """{(cliente_id, sku): {matrix, com_pct, ajuste_usd, sobreprecio_pct}}.

    Son las matrices congeladas (contrato). La gobernanza y los refrescos
    deben leer el precio de aquí, no recalcularlo, para no pisar ajustes
    manuales pactados con el cliente.
    """
    out: dict[tuple[str, str], dict] = {}
    cids = [str(c) for c in (cliente_ids or []) if c]
    sku_list = [str(s) for s in (skus or []) if s]
    if not cids or not sku_list:
        return out
    try:
        with connection.cursor() as cur:
            cur.execute("""
                SELECT cliente_id::text, sku, prices_matrix, com_pct,
                       ajuste_usd, sobreprecio_pct
                  FROM pricing.marluvas_client_sku_pricing
                 WHERE brand_id = %s AND is_active = TRUE
                   AND cliente_id::text = ANY(%s)
                   AND sku = ANY(%s)
            """, [str(brand_id), cids, sku_list])
            for cid, sku, matrix, com, ajuste, sobre in cur.fetchall():
                out[(str(cid), str(sku))] = {
                    "matrix": _as_matrix(matrix),
                    "com_pct": float(com or 0),
                    "ajuste_usd": float(ajuste or 0),
                    "sobreprecio_pct": float(sobre or 0),
                }
    except Exception as exc:  # noqa: BLE001
        log.warning("engine.matrices_activas failed: %s", exc)
    return out


def materializar_clientes(brand_id, rows: list[dict], clientes: list[dict], *,
                          anchor: dict | None = None, fecha_inicio=None,
                          fecha_fin=None, user_id=None,
                          notas: str | None = None,
                          preservar_matriz: bool = True) -> dict:
    """Upsert (merge) de la matriz por cliente para los SKUs del Excel.

    El ancla de cada cliente es:
      · `anchor` explícita (import / override), o
      · su política de banda configurada (`banda_vigente` + `plazo_dias`),
      · o la banda del TC si el cliente no tiene política.

    `preservar_matriz=True` (default): si el cliente+SKU ya tiene una fila
    activa, se conserva su matriz congelada (precio pactado / editado a
    mano) y solo se actualiza el ancla. Sin esto, cualquier recálculo pisaba
    los precios acordados con el cliente.
    """
    from .views import MarluvasSaveSimulationView, _bulk_upsert_bcpa

    tc = (anchor or {}).get("tc_usd_brl")
    politicas = politicas_de_clientes(brand_id, clientes, tc=tc)
    forced_banda = (anchor or {}).get("banda") or None
    forced_plazo = (anchor or {}).get("plazo_dias")
    existentes = matrices_activas(
        brand_id, [str(c["cliente_id"]) for c in clientes],
        [str(r.get("sku") or "") for r in rows],
    ) if preservar_matriz else {}
    resultados = []
    total_skus = 0
    total_cells = 0
    for cli in clientes:
        cid = cli["cliente_id"]
        com = cli["com_pct"]
        pol = politicas.get(str(cid)) or {}
        banda_id = (forced_banda or {}).get("id") or (pol.get("banda") or {}).get("id") or BANDA_DEFAULT_ID
        plazo = forced_plazo or pol.get("plazo_dias") or PLAZO_DEFAULT
        skus_payload = []
        for row in rows:
            sku = str(row.get("sku") or "").strip()
            brl = row.get("brl")
            if not sku or not brl:
                continue
            prev = existentes.get((str(cid), sku))
            if prev and _as_matrix(prev.get("matrix")):
                matrix = _as_matrix(prev.get("matrix"))
                com_use = prev.get("com_pct", com)
                ajuste_use = prev.get("ajuste_usd", 0)
                sobre_use = prev.get("sobreprecio_pct", 0)
            else:
                matrix = compute_matrix(brl, com)
                com_use, ajuste_use, sobre_use = com, 0, 0
            skus_payload.append({
                "sku": sku,
                "brl_override": float(brl),
                "com_pct": com_use,
                "ajuste_usd": ajuste_use,
                "sobreprecio_pct": sobre_use,
                "prices_matrix": matrix,
                "anchor": {"bandaId": int(banda_id),
                           "plazoDias": int(plazo)},
                "activo": True,
            })
        if not skus_payload:
            continue
        try:
            res = MarluvasSaveSimulationView.persist_upsert_many(
                brand_id=brand_id,
                cliente_id=uuid.UUID(str(cid)),
                skus_payload=skus_payload,
                custom_plazos={},
                banda_vigente_id=int(banda_id),
                fecha_ini=fecha_inicio,
                fecha_fin=fecha_fin,
                notas=notas or f"[motor precios {len(skus_payload)} SKUs]",
                user_id=user_id,
            )
            _bulk_upsert_bcpa(
                brand_id=brand_id, cliente_id=uuid.UUID(str(cid)),
                fecha_ini=fecha_inicio, fecha_fin=fecha_fin,
                file_name=None, file_size_bytes=None,
                notas=notas, user_id=user_id,
            )
            total_skus += res["saved"]
            total_cells += res["cells"]
            resultados.append({"cliente_id": cid, "ok": True,
                               "saved": res["saved"], "cells": res["cells"]})
        except Exception as exc:  # noqa: BLE001
            log.warning("engine.materializar cliente=%s falló: %s", cid, exc)
            resultados.append({"cliente_id": cid, "ok": False,
                               "error": str(exc)})
    return {
        "clientes": len(resultados),
        "clientes_ok": sum(1 for r in resultados if r["ok"]),
        "skus_guardados": total_skus,
        "cells": total_cells,
        "results": resultados,
    }


# =====================================================================
# Gobernanza del producto
# =====================================================================
def _precios_por_cliente(rows: list[dict], clientes: list[dict], *,
                         politicas: dict[str, dict],
                         matrices: dict[tuple[str, str], dict] | None = None,
                         banda_id: int | None = None,
                         plazo: int | None = None) -> dict[str, float]:
    """{cliente_id: precio} del SKU, en la banda/plazo de cada cliente.

    Si el cliente ya tiene una matriz congelada para el SKU, el precio sale
    de esa matriz (contrato). Si no, se calcula con el motor.
    """
    out: dict[str, float] = {}
    sku = str(rows[0].get("sku") or "")
    for cli in clientes:
        cid = str(cli["cliente_id"])
        pol = politicas.get(cid) or {}
        banda_ef = int(banda_id or (pol.get("banda") or {}).get("id")
                       or BANDA_DEFAULT_ID)
        plazo_ef = int(plazo or pol.get("plazo_dias") or PLAZO_DEFAULT)
        prev = (matrices or {}).get((cid, sku)) or {}
        matrix = _as_matrix(prev.get("matrix")) or compute_matrix(
            rows[0]["brl"], cli["com_pct"])
        price = precio_en(matrix, banda_ef, plazo_ef)
        if price is None:
            price = precio_en(compute_matrix(rows[0]["brl"], cli["com_pct"]),
                              banda_ef, plazo_ef)
        if price is not None:
            out[cid] = price
    return out


def aplicar_gobernanza_producto(producto, *, anchor: dict | None = None,
                                clientes: list[dict] | None = None,
                                persistir_matrices: bool = True,
                                user_id=None,
                                fecha_inicio=None, fecha_fin=None) -> dict:
    """Aplica el precio del motor a UN producto (gobernanza de precios).

    Cada cliente usa SU banda vigente configurada (o la del TC si es
    automática). Deja en el producto:
      · `especificaciones.client_prices[cliente_id]` (lo que lee la
        creación de expedientes al congelar `unit_price_client`),
      · `precio_lista` / `precio_mwt` (= precio base sin comisión),
      · `especificaciones.precio_motor` con la trazabilidad (SKU del Excel,
        BRL, banda, plazo y archivo fuente).

    Devuelve {applied, reason?, ...}. Nunca lanza: si el SKU no está en el
    último Excel, deja el producto intacto y explica por qué.
    """
    sku = (getattr(producto, "sku", None) or "").strip()
    brand_id = getattr(producto, "marca_id", None)
    if not sku or not brand_id:
        return {"applied": False, "reason": "producto sin sku o marca"}

    snap = snapshot_para_sku(brand_id, sku)
    if not snap:
        return {
            "applied": False,
            "reason": "SKU sin precio en el último Excel del motor",
            "hint": "Sube el Excel COMEX en Marcas → Marluvas → Motor de Precios.",
            "sku": sku,
        }

    clientes = clientes if clientes is not None else clientes_activos()
    if not clientes:
        return {"applied": False, "reason": "sin clientes activos", "sku": sku}

    forced_banda = (anchor or {}).get("banda") or None
    forced_plazo = (anchor or {}).get("plazo_dias")
    tc = (anchor or {}).get("tc_usd_brl")
    politicas = politicas_de_clientes(brand_id, clientes, tc=tc)

    row = {"sku": sku, "brl": snap["brl"]}
    matrices_prev = matrices_activas(
        brand_id, [str(c["cliente_id"]) for c in clientes], [sku])
    precios = _precios_por_cliente(
        [row], clientes, politicas=politicas, matrices=matrices_prev,
        banda_id=(forced_banda or {}).get("id"),
        plazo=forced_plazo)

    mwt_pol = politicas.get(MWT_OPERATING_CLIENT_ID) or next(
        iter(politicas.values()), {})
    banda_mwt = int((forced_banda or {}).get("id")
                    or (mwt_pol.get("banda") or {}).get("id")
                    or BANDA_DEFAULT_ID)
    plazo_mwt = int(forced_plazo or mwt_pol.get("plazo_dias")
                    or PLAZO_DEFAULT)
    mwt_matrix = _as_matrix(
        (matrices_prev.get((MWT_OPERATING_CLIENT_ID, sku)) or {}).get("matrix")
    ) or compute_matrix(snap["brl"], 0)
    base_com0 = precio_en(mwt_matrix, banda_mwt, plazo_mwt)
    mwt_price = precios.get(MWT_OPERATING_CLIENT_ID) or base_com0

    espec = dict(getattr(producto, "especificaciones", None) or {})
    cp = dict(espec.get("client_prices") or {})
    cp.update({cid: round(price, 2) for cid, price in precios.items()})
    espec["client_prices"] = cp
    espec["precio_motor"] = {
        "sku": sku,
        "brl": round(snap["brl"], 4),
        "banda": banda_mwt,
        "plazo_dias": plazo_mwt,
        "bandas_clientes": {
            cid: int(((politicas.get(cid) or {}).get("banda") or {}).get("id")
                     or banda_mwt)
            for cid in precios
        },
        "source_file": snap.get("source_file"),
        "model": MODEL_VERSION,
        "applied_at": timezone.now().isoformat(),
    }

    producto.especificaciones = espec
    if base_com0:
        producto.precio_lista = Decimal(str(round(base_com0, 2)))
    if mwt_price:
        producto.precio_mwt = Decimal(str(round(mwt_price, 2)))
    producto.save(update_fields=["especificaciones", "precio_lista",
                                 "precio_mwt", "updated_at"])

    matrices = None
    if persistir_matrices and clientes:
        try:
            matrices = materializar_clientes(
                brand_id, [row], clientes, anchor=anchor,
                fecha_inicio=fecha_inicio, fecha_fin=fecha_fin,
                user_id=user_id,
                notas=f"[gobernanza producto {sku}]",
            )
        except Exception as exc:  # noqa: BLE001
            log.warning("engine.gobernanza matrices %s: %s", sku, exc)

    return {
        "applied": True,
        "sku": sku,
        "brl": round(snap["brl"], 4),
        "banda": banda_mwt,
        "plazo_dias": plazo_mwt,
        "source_file": snap.get("source_file"),
        "precio_lista": float(producto.precio_lista or 0),
        "precio_mwt": float(producto.precio_mwt or 0),
        "clientes_con_precio": len(precios),
        "client_prices": {cid: round(p, 2) for cid, p in precios.items()},
        "matrices": matrices,
    }


def aplicar_gobernanza_por_sku(brand_id, sku: str, **kwargs) -> dict:
    """Igual que `aplicar_gobernanza_producto`, buscando el producto por SKU."""
    from apps.productos.models import Producto
    try:
        producto = Producto.objects.get(sku=sku, is_active=True)
    except Producto.DoesNotExist:
        return {"applied": False, "reason": "producto no existe", "sku": sku}
    return aplicar_gobernanza_producto(producto, **kwargs)


# =====================================================================
# Re-anclar a la BANDA VIGENTE (todo un cliente/SKU de la marca)
# =====================================================================
def refrescar_vigente(brand_id, *, banda_id: int | None = None,
                      plazo_dias: int | None = None, user_id=None) -> dict:
    """Recalcula TODOS los SKU/productos de la marca en la banda vigente.

    Es la operación "actualizar la banda vigente de cada cliente de cada SKU":

      1. Toma el TC USD/BRL actual → banda vigente (o `banda_id` explícita).
      2. Reescribe la matriz de cada cliente con esa banda como ancla
         (`pricing.marluvas_client_sku_pricing`), dejando UN evento de
         historial por cliente con todos los SKUs (`marluvas_price_history`).
      3. Actualiza cada producto: `especificaciones.client_prices`,
         `precio_lista`, `precio_mwt` y la trazabilidad `precio_motor`.

    Idempotente: si el TC no cambió, los precios quedan igual (y el evento
    de historial se registra igual).
    """
    anchor = anchor_actual(banda_id, plazo_dias) if (
        banda_id not in (None, "") or plazo_dias not in (None, "")
    ) else None
    if anchor:
        banda = anchor.get("banda") or {}
        banda_id_eff = int(banda.get("id") or BANDA_DEFAULT_ID)
        plazo = int(anchor.get("plazo_dias") or PLAZO_DEFAULT)
    else:
        banda = {}
        banda_id_eff = None
        plazo = None

    snaps = snapshot_todos(brand_id)
    if not snaps:
        return {
            "ok": False,
            "detail": "La marca no tiene Excel del motor cargado.",
            "hint": "Sube la tabla en Marcas → [marca] → Motor de Precios.",
            "banda": banda_id_eff,
            "plazo_dias": plazo,
        }

    from apps.productos.models import Producto
    productos = list(
        Producto.objects.filter(marca_id=brand_id, is_active=True)
        .exclude(sku__isnull=True).exclude(sku="")
    )
    con_precio = [p for p in productos if str(p.sku) in snaps]
    sin_excel = [p.sku for p in productos if str(p.sku) not in snaps]

    clientes = clientes_activos()

    # 1) Matrices: un solo pase por cliente con todos los SKUs con precio.
    rows = [{"sku": str(p.sku), "brl": snaps[str(p.sku)]["brl"]}
            for p in con_precio]
    matrices = {"clientes": 0, "clientes_ok": 0, "skus_guardados": 0,
                "cells": 0, "results": []}
    if rows:
        nota_anchor = (f"banda {banda_id_eff} · {plazo}d"
                       if anchor else "politica por cliente")
        matrices = materializar_clientes(
            brand_id, rows, clientes, anchor=anchor,
            user_id=user_id,
            notas=f"[banda vigente {nota_anchor} · {len(rows)} SKUs]",
        )

    # 2) Productos: client_prices + precio_lista/mwt (sin reescribir matrices).
    applied = 0
    errores = 0
    muestra = []
    for producto in con_precio:
        try:
            res = aplicar_gobernanza_producto(
                producto, anchor=anchor, clientes=clientes,
                persistir_matrices=False, user_id=user_id)
            if res.get("applied"):
                applied += 1
            if len(muestra) < 5:
                muestra.append({
                    "sku": producto.sku,
                    "lista": res.get("precio_lista"),
                    "mwt": res.get("precio_mwt"),
                    "clientes": res.get("clientes_con_precio"),
                })
        except Exception as exc:  # noqa: BLE001
            errores += 1
            log.warning("engine.refrescar producto=%s: %s", producto.sku, exc)

    # 3) Bitácora del refresh.
    try:
        with connection.cursor() as cur:
            cur.execute("""
                INSERT INTO pricing.marluvas_engine_import
                    (brand_id, file_name, skus, clientes, banda_id,
                     plazo_dias, tc_usd_brl, source, created_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, [str(brand_id), "refresh banda vigente", len(rows),
                  matrices.get("clientes_ok") or 0, banda_id_eff,
                  plazo or PLAZO_DEFAULT,
                  (anchor or {}).get("tc_usd_brl"), "REFRESH",
                  str(user_id) if user_id else None])
    except Exception as exc:  # noqa: BLE001
        log.warning("engine.refrescar bitácora falló: %s", exc)

    politicas = politicas_de_clientes(brand_id, clientes,
                                      tc=(anchor or {}).get("tc_usd_brl"))
    bandas_config = {
        cid: (p.get("banda") or {}).get("id") for cid, p in politicas.items()
    }
    return {
        "ok": True,
        "banda": banda_id_eff,
        "rango": banda.get("rango"),
        "plazo_dias": plazo,
        "tc_usd_brl": (anchor or {}).get("tc_usd_brl"),
        "modo": "forzada" if anchor else "politica por cliente",
        "bandas_clientes": bandas_config,
        "productos_marca": len(productos),
        "productos_actualizados": applied,
        "productos_sin_excel": len(sin_excel),
        "errores": errores,
        "matrices": {
            "clientes": matrices.get("clientes"),
            "clientes_ok": matrices.get("clientes_ok"),
            "skus": matrices.get("skus_guardados"),
            "cells": matrices.get("cells"),
        },
        "muestra": muestra,
    }


def refrescar_cliente(brand_id, cliente_id, *, user_id=None) -> dict:
    """Recalcula matriz y precios de UN cliente con SU banda configurada.

    Se ejecuta al guardar la política de banda del cliente: deja la matriz
    anclada a esa banda (con evento de historial) y actualiza su precio en
    `especificaciones.client_prices` de cada producto.
    """
    cliente_id = str(cliente_id)
    cli = [c for c in clientes_activos() if c["cliente_id"] == cliente_id]
    if not cli:
        return {"ok": False,
                "detail": "Cliente no activo o inexistente.",
                "cliente_id": cliente_id}

    snaps = snapshot_todos(brand_id)
    if not snaps:
        return {"ok": False,
                "detail": "La marca no tiene Excel del motor cargado.",
                "cliente_id": cliente_id}

    rows = [{"sku": sku, "brl": s["brl"]} for sku, s in snaps.items()]
    try:
        mats = materializar_clientes(
            brand_id, rows, cli, anchor=None, user_id=user_id,
            notas=f"[politica banda cliente {cliente_id}]",
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("engine.refrescar_cliente matrices: %s", exc)
        mats = {}

    pol = politicas_de_clientes(brand_id, cli).get(cliente_id, {})
    banda_ef = int((pol.get("banda") or {}).get("id") or BANDA_DEFAULT_ID)
    plazo_ef = int(pol.get("plazo_dias") or PLAZO_DEFAULT)
    com = cli[0]["com_pct"]

    from apps.productos.models import Producto
    productos = (Producto.objects.filter(marca_id=brand_id, is_active=True)
                 .exclude(sku__isnull=True).exclude(sku=""))
    skus_prod = [str(p.sku) for p in productos if str(p.sku) in snaps]
    previas = matrices_activas(brand_id, [cliente_id], skus_prod)
    actualizados = 0
    for producto in productos:
        snap = snaps.get(str(producto.sku))
        if not snap:
            continue
        prev = previas.get((cliente_id, str(producto.sku))) or {}
        matrix = _as_matrix(prev.get("matrix")) or compute_matrix(
            snap["brl"], com)
        price = precio_en(matrix, banda_ef, plazo_ef)
        if price is None:
            price = precio_en(compute_matrix(snap["brl"], com),
                              banda_ef, plazo_ef)
        if price is None:
            continue
        espec = dict(getattr(producto, "especificaciones", None) or {})
        cp = dict(espec.get("client_prices") or {})
        cp[cliente_id] = round(price, 2)
        espec["client_prices"] = cp
        # Trazabilidad: la banda de ESTE cliente dentro de precio_motor.
        pm = dict(espec.get("precio_motor") or {})
        bandas = dict(pm.get("bandas_clientes") or {})
        bandas[cliente_id] = banda_ef
        pm["bandas_clientes"] = bandas
        pm.setdefault("sku", producto.sku)
        pm["applied_at"] = timezone.now().isoformat()
        espec["precio_motor"] = pm
        producto.especificaciones = espec
        producto.save(update_fields=["especificaciones", "updated_at"])
        actualizados += 1

    try:
        with connection.cursor() as cur:
            cur.execute("""
                INSERT INTO pricing.marluvas_engine_import
                    (brand_id, file_name, skus, clientes, banda_id,
                     plazo_dias, tc_usd_brl, source, created_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, [str(brand_id), f"politica banda cliente {cliente_id}",
                  len(rows), 1, banda_ef, plazo_ef, tc_usd_brl(),
                  "POLICY", str(user_id) if user_id else None])
    except Exception as exc:  # noqa: BLE001
        log.warning("engine.refrescar_cliente bitácora: %s", exc)

    return {
        "ok": True,
        "cliente_id": cliente_id,
        "banda": banda_ef,
        "plazo_dias": plazo_ef,
        "fuente": pol.get("fuente"),
        "productos_actualizados": actualizados,
        "matrices": {
            "skus": (mats or {}).get("skus_guardados"),
            "cells": (mats or {}).get("cells"),
        },
    }


# =====================================================================
# Import masivo desde Excel / JSON
# =====================================================================
def _norm_header(value: Any) -> str:
    s = str(value if value is not None else "").lower()
    s = "".join(c for c in unicodedata.normalize("NFD", s)
                if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


SKU_RE = re.compile(r"^[78]\d{5}$")


def parse_xlsx(path: str) -> list[dict]:
    """Parser del Excel COMEX (Material + Preço … vN/R$).

    Espejo de `parseExcelMarluvas` del frontend: recorre hojas, detecta el
    header con columna de precio y material/SKU y devuelve [{sku, ref, brl}].
    """
    import openpyxl

    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    seen: set[str] = set()
    out: list[dict] = []
    for name in wb.sheetnames:
        ws = wb[name]
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            continue
        header_idx = price_col = sku_col = ref_col = -1
        for idx in range(min(8, len(rows))):
            row = rows[idx] or ()
            local_price = local_sku = local_ref = -1
            for col, value in enumerate(row):
                norm = _norm_header(value)
                if not norm:
                    continue
                if (local_price < 0 and re.search(r"\bpreco\b", norm)
                        and re.search(r"\b(v7|v8|v9|v10|r)\b", norm)):
                    local_price = col
                if local_sku < 0 and norm in ("material", "sku"):
                    local_sku = col
                if local_ref < 0 and norm.startswith("descric"):
                    local_ref = col
            if local_price >= 0 and local_sku >= 0:
                header_idx, price_col = idx, local_price
                sku_col, ref_col = local_sku, local_ref
                break
        if price_col < 0 or sku_col < 0:
            continue
        for row in rows[header_idx + 1:]:
            if not row:
                continue
            sku_raw = row[sku_col] if sku_col < len(row) else None
            if sku_raw is None:
                continue
            sku = str(sku_raw).strip()
            if not SKU_RE.match(sku) or sku in seen:
                continue
            raw_price = row[price_col] if price_col < len(row) else None
            if raw_price is None:
                continue
            try:
                brl = float(str(raw_price).replace(",", "."))
            except (TypeError, ValueError):
                continue
            if brl <= 0:
                continue
            ref = ""
            if 0 <= ref_col < len(row) and row[ref_col]:
                ref = str(row[ref_col]).strip()
            seen.add(sku)
            out.append({"sku": sku, "ref": ref, "brl": round(brl, 4)})
    return out


def importar(brand_id, rows: list[dict], *, file_name: str | None = None,
             cliente_ids: list[str] | None = None,
             banda_id: int | None = None, plazo_dias: int | None = None,
             fecha_inicio: date | None = None, fecha_fin: date | None = None,
             user_id=None, aplicar_productos: bool = True) -> dict:
    """Import completo: snapshot + matrices por cliente + gobernanza productos."""
    rows = [r for r in (rows or []) if str(r.get("sku") or "").strip()]
    if not rows:
        return {"ok": False, "detail": "Sin filas para importar."}

    anchor = anchor_actual(banda_id, plazo_dias)
    snap = upsert_snapshot(brand_id, rows, file_name=file_name,
                           anchor=anchor, user_id=user_id)

    todos = clientes_activos()
    if cliente_ids:
        wanted = {str(c) for c in cliente_ids}
        clientes = [c for c in todos if c["cliente_id"] in wanted]
    else:
        clientes = todos

    mats = materializar_clientes(
        brand_id, rows, clientes, anchor=anchor,
        fecha_inicio=fecha_inicio, fecha_fin=fecha_fin, user_id=user_id,
        notas=f"[motor precios {file_name or 'import'}]",
    )

    prod = {"applied": 0, "skipped": 0, "errors": 0}
    if aplicar_productos:
        skus = [r["sku"] for r in rows]
        from apps.productos.models import Producto
        productos = list(Producto.objects.filter(
            marca_id=brand_id, sku__in=skus, is_active=True))
        for producto in productos:
            try:
                res = aplicar_gobernanza_producto(
                    producto, anchor=anchor, clientes=clientes,
                    persistir_matrices=False, user_id=user_id,
                    fecha_inicio=fecha_inicio, fecha_fin=fecha_fin)
                prod["applied" if res.get("applied") else "skipped"] += 1
            except Exception as exc:  # noqa: BLE001
                log.warning("engine.import producto=%s: %s", producto.sku, exc)
                prod["errors"] += 1

    # Bitácora de la importación (best-effort).
    try:
        with connection.cursor() as cur:
            cur.execute("""
                INSERT INTO pricing.marluvas_engine_import
                    (brand_id, file_name, skus, clientes, banda_id,
                     plazo_dias, tc_usd_brl, source, created_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, [str(brand_id), file_name, len(rows),
                  mats.get("clientes_ok") or 0,
                  (anchor.get("banda") or {}).get("id"),
                  anchor.get("plazo_dias"), anchor.get("tc_usd_brl"),
                  "XLSX" if file_name and str(file_name).lower().endswith(
                      (".xlsx", ".xls", ".xlsm")) else "API",
                  str(user_id) if user_id else None])
    except Exception as exc:  # noqa: BLE001
        log.warning("engine.import bitácora falló: %s", exc)

    return {
        "ok": True,
        "brand_id": str(brand_id),
        "file_name": file_name,
        "anchor": {
            "banda": (anchor.get("banda") or {}).get("id"),
            "rango": (anchor.get("banda") or {}).get("rango"),
            "plazo_dias": anchor.get("plazo_dias"),
            "tc_usd_brl": anchor.get("tc_usd_brl"),
        },
        "skus": len(rows),
        "snapshot": snap,
        "clientes": mats,
        "productos": prod,
    }
