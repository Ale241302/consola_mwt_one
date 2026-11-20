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
    try:
        with connection.cursor() as cur:
            cur.execute("""
                SELECT brl, ref, source_file, anchor_banda, anchor_plazo,
                       updated_at
                  FROM pricing.marluvas_engine_sku
                 WHERE brand_id = %s AND sku = %s AND is_active = TRUE
                 LIMIT 1
            """, [str(brand_id), str(sku)])
            row = cur.fetchone()
    except Exception as exc:  # noqa: BLE001
        log.warning("engine.snapshot_para_sku failed: %s", exc)
        return None
    if not row:
        return None
    return {
        "brl": float(row[0]),
        "ref": row[1],
        "source_file": row[2],
        "anchor_banda": row[3],
        "anchor_plazo": row[4],
        "updated_at": row[5].isoformat() if row[5] else None,
    }


# =====================================================================
# Materialización por cliente (marluvas_client_sku_pricing)
# =====================================================================
def materializar_clientes(brand_id, rows: list[dict], clientes: list[dict], *,
                          anchor: dict, fecha_inicio=None, fecha_fin=None,
                          user_id=None, notas: str | None = None) -> dict:
    """Upsert (merge) de la matriz por cliente para los SKUs del Excel."""
    from .views import MarluvasSaveSimulationView, _bulk_upsert_bcpa

    banda_id = (anchor.get("banda") or {}).get("id")
    plazo = anchor.get("plazo_dias") or PLAZO_DEFAULT
    resultados = []
    total_skus = 0
    total_cells = 0
    for cli in clientes:
        cid = cli["cliente_id"]
        com = cli["com_pct"]
        skus_payload = []
        for row in rows:
            sku = str(row.get("sku") or "").strip()
            brl = row.get("brl")
            if not sku or not brl:
                continue
            matrix = compute_matrix(brl, com)
            skus_payload.append({
                "sku": sku,
                "brl_override": float(brl),
                "com_pct": com,
                "ajuste_usd": 0,
                "sobreprecio_pct": 0,
                "prices_matrix": matrix,
                "anchor": {"bandaId": int(banda_id or BANDA_DEFAULT_ID),
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
                banda_vigente_id=int(banda_id or BANDA_DEFAULT_ID),
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
                         banda_id: int, plazo: int) -> dict[str, float]:
    """{cliente_id: precio} para el SKU, en la banda/plazo pedidos."""
    out: dict[str, float] = {}
    for cli in clientes:
        matrix = compute_matrix(rows[0]["brl"], cli["com_pct"])
        price = precio_en(matrix, banda_id, plazo)
        if price is not None:
            out[cli["cliente_id"]] = price
    return out


def aplicar_gobernanza_producto(producto, *, anchor: dict | None = None,
                                clientes: list[dict] | None = None,
                                persistir_matrices: bool = True,
                                user_id=None,
                                fecha_inicio=None, fecha_fin=None) -> dict:
    """Aplica el precio del motor a UN producto (gobernanza de precios).

    Deja en el producto:
      · `especificaciones.client_prices[cliente_id]` (lo que lee la
        creación de expedientes al congelar `unit_price_client`),
      · `precio_lista` / `precio_mwt` (= precio base sin comisión),
      · `especificaciones.precio_motor` con la trazabilidad (SKU del Excel,
        BRL, banda, plazo y archivo fuente).

    Devuelve {applied, reason?, ...}. Nunca lanza: si el SKU no está en el
    último Excel, deja el producto intacto y explica por qué.
    """
    from apps.productos.models import Producto

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

    anchor = anchor or anchor_actual(snap.get("anchor_banda"),
                                     snap.get("anchor_plazo"))
    banda_id = int((anchor.get("banda") or {}).get("id") or BANDA_DEFAULT_ID)
    plazo = int(anchor.get("plazo_dias") or PLAZO_DEFAULT)
    clientes = clientes if clientes is not None else clientes_activos()

    row = {"sku": sku, "brl": snap["brl"]}
    precios = _precios_por_cliente([row], clientes, banda_id=banda_id,
                                   plazo=plazo)
    if not precios:
        return {"applied": False, "reason": "sin clientes activos", "sku": sku}

    base_com0 = precio_en(compute_matrix(snap["brl"], 0), banda_id, plazo)
    mwt_price = precios.get(MWT_OPERATING_CLIENT_ID) or base_com0

    espec = dict(getattr(producto, "especificaciones", None) or {})
    cp = dict(espec.get("client_prices") or {})
    cp.update({cid: round(price, 2) for cid, price in precios.items()})
    espec["client_prices"] = cp
    espec["precio_motor"] = {
        "sku": sku,
        "brl": round(snap["brl"], 4),
        "banda": banda_id,
        "plazo_dias": plazo,
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
        "banda": banda_id,
        "plazo_dias": plazo,
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
