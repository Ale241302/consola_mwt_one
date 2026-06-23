"""
=====================================================================
MWT.ONE · backend/apps/commercial/services.py

Sprint 2026-05-22 · Servicios de resolución de precios para Marluvas.

Hasta este sprint, el portal B2B (`/api/portal/products/`) intentaba
importar `resolve_client_price` desde `apps.commercial.services` — pero
ese módulo NUNCA existió. El `try/except` en `portal/views.py:_hydrate_batch`
atrapaba silenciosamente el `ImportError`, dejando el campo
`precio_venta_resolved` sin asignar. El serializer caía a
`obj.precio_distribuidor` que es 0 para los SKUs Marluvas → todas las
cards del catálogo mostraban "Consultar precio".

Este módulo materializa la función esperada. Lee el snapshot vigente
en `pricing.marluvas_client_sku_pricing` (tabla LIVE — no la histórica
`pricing.marluvas_price_history_event`) y devuelve el precio USD del
plazo 90d de la banda activa según la cotización USD/BRL del día.

Contrato:
    resolve_client_price(
        client_id    : str  | UUID,
        brand_id     : str  | UUID,
        product_sku  : str,
        quantity     : int  = 1,            # reservado · descuentos por volumen
        tc_usd_brl   : float | None = None, # cotización del día (opcional)
    ) -> dict

Retorna siempre un dict (nunca lanza):
    {
        "ok":           bool,       # True si encontró precio resoluble
        "final_price":  Decimal,    # precio USD del plazo 90d de la banda activa
        "currency":     "USD",
        "banda_id":     int,        # 1..12 — banda Marluvas usada
        "plazo":        90,         # plazo en días aplicado
        "source":       "marluvas_client_sku_pricing" | "fallback_band_default",
        "reason":       str | None, # explicación cuando ok=False
    }
=====================================================================
"""
from __future__ import annotations

import logging
from decimal import Decimal
from typing import Optional, Union, Dict, Any

from .models import MarluvasClientSkuPricing

log = logging.getLogger(__name__)

# 12 bandas Marluvas — espejo del frontend (constants/marluvas.js)
# Cada banda cubre [piso, techo) — el techo es exclusivo. Si el TC cae
# exactamente en un techo, sube a la banda siguiente:
#   tc = 5.0000 → banda 6 (5.00 – 5.20)   [piso inclusivo]
#   tc = 4.9999 → banda 5 (4.80 – 5.00)
#   tc = 5.0164 → banda 6 (5.00 – 5.20)
# Fuera de [4.00, 6.40) → None (clamp al extremo más cercano).
_BAND_PISO = 4.00
_BAND_STEP = 0.20
_BAND_MIN  = 1
_BAND_MAX  = 12


def banda_for_tc(tc: Optional[float]) -> Optional[int]:
    """Devuelve el id de banda Marluvas (1..12) según la cotización USD/BRL.

    Reglas idénticas al `bandaForTC` del frontend
    (frontend/src/constants/marluvas.js).
    """
    if tc is None:
        return None
    try:
        n = float(tc)
    except (TypeError, ValueError):
        return None
    # Rango Marluvas: [4.00, 6.40) — fuera → None
    if n < _BAND_PISO or n >= _BAND_PISO + _BAND_STEP * _BAND_MAX:
        return None
    idx = int((n - _BAND_PISO) / _BAND_STEP)
    # Clamp 0..11 → id 1..12
    idx = max(0, min(_BAND_MAX - 1, idx))
    return idx + 1


def _find_active_pricing_row(brand_id, cliente_id, sku):
    """Resuelve la fila Marluvas ACTIVA para (brand, cliente, sku).

    Tolerante a deriva de `brand_id`. El detalle de producto
    (`MarluvasProductClientsMatrixView`) resuelve la matriz del cliente
    filtrando por `(sku, is_active)` — sin exigir brand. El portal y la
    nueva-OC, en cambio, exigían además `brand_id == productos.producto.marca_id`.
    Si la marca del producto cambió DESPUÉS de congelar la matriz, la fila
    queda bajo un `brand_id` viejo y el match exacto falla → el portal
    devolvía `no_active_pricing_row` y caía a la calculadora costo-plus,
    mostrando un precio distinto (15.39) al del detalle (14.50).

    Estrategia:
      1. Match EXACTO por (brand, cliente, sku, is_active) — preferido.
      2. Fallback brand-agnóstico por (cliente, sku, is_active), la más
         reciente. Así el portal ve SIEMPRE la misma fila que el detalle.

    Devuelve la tupla (row | None, brand_drift: bool). `brand_drift=True`
    indica que se usó el fallback (la fila vive bajo otro brand_id).
    """
    base_qs = (MarluvasClientSkuPricing.objects
               .filter(cliente_id=cliente_id, sku=sku, is_active=True))

    row = (base_qs.filter(brand_id=brand_id)
           .order_by("-updated_at")
           .first())
    if row is not None:
        return row, False

    # Fallback: misma (cliente, sku) bajo cualquier brand (deriva de marca).
    row = base_qs.order_by("-updated_at").first()
    return row, (row is not None)


def resolve_client_price(
    client_id:   Union[str, "UUID"],
    brand_id:    Union[str, "UUID"],
    product_sku: str,
    quantity:    int = 1,
    tc_usd_brl:  Optional[float] = None,
) -> Dict[str, Any]:
    """Resuelve el precio USD del SKU para un cliente Marluvas.

    Lookup:
      1. Busca el row activo en `pricing.marluvas_client_sku_pricing`
         para el triple (brand_id, client_id, sku) con is_active=True.
      2. Determina la banda vigente:
         - Si `tc_usd_brl` está presente → calcula con `banda_for_tc(tc)`.
         - Si no → fallback a banda 6 (5.00 – 5.20, banda central que es
           la más cercana al precio "techo a 90d" usado en el preview admin).
      3. Lee `prices_matrix[str(banda_id)]["90"]` del row.
      4. Si la banda exacta no existe en la matriz, baja a la banda
         vecina más cercana (defensa contra snapshots parciales).

    Si cualquier paso falla devuelve `ok=False` con la razón. NUNCA
    levanta excepción — el caller (`_hydrate_batch`) ya asume eso.
    """
    out: Dict[str, Any] = {
        "ok":          False,
        "final_price": None,
        "currency":    "USD",
        "banda_id":    None,
        "plazo":       90,
        "source":      None,
        "reason":      None,
    }

    if not (client_id and brand_id and product_sku):
        out["reason"] = "missing_required_args"
        return out

    # Normalizar tipos (UUID o string) para el filter
    cid = str(client_id)
    bid = str(brand_id)
    sku = str(product_sku).strip()
    if not sku:
        out["reason"] = "empty_sku"
        return out

    try:
        row, brand_drift = _find_active_pricing_row(bid, cid, sku)
    except Exception as e:
        log.warning("resolve_client_price · DB lookup falló · %s", e)
        out["reason"] = f"db_error: {e}"
        return out

    if not row:
        out["reason"] = "no_active_pricing_row"
        return out

    if brand_drift:
        log.info(
            "resolve_client_price · brand drift · sku=%s cliente=%s "
            "requested_brand=%s row_brand=%s (usando fila por cliente+sku)",
            sku, cid, bid, row.brand_id,
        )

    matrix = row.prices_matrix or {}
    if not isinstance(matrix, dict) or not matrix:
        out["reason"] = "empty_prices_matrix"
        return out

    # ── Determinar banda vigente ─────────────────────────────────────
    banda_id = banda_for_tc(tc_usd_brl) if tc_usd_brl is not None else None
    used_fallback = False
    if banda_id is None:
        banda_id = 6  # fallback central — banda 5.00–5.20
        used_fallback = True

    # ── Buscar precio en la matriz, con vecino más cercano si falta ──
    price_str = None
    found_banda = None
    # Intento exacto primero
    if str(banda_id) in matrix and isinstance(matrix[str(banda_id)], dict):
        plazos = matrix[str(banda_id)]
        if "90" in plazos:
            price_str = plazos["90"]
            found_banda = banda_id
    # Si no, busca el vecino más cercano (espiral 1, 2, 3, ...)
    if price_str is None:
        for step in range(1, _BAND_MAX):
            for candidate in (banda_id - step, banda_id + step):
                if candidate < _BAND_MIN or candidate > _BAND_MAX:
                    continue
                pl = matrix.get(str(candidate))
                if isinstance(pl, dict) and "90" in pl:
                    price_str = pl["90"]
                    found_banda = candidate
                    break
            if price_str is not None:
                break

    if price_str is None:
        out["reason"] = "no_90d_price_in_any_band"
        out["banda_id"] = banda_id
        return out

    try:
        final_price = Decimal(str(price_str))
    except Exception as e:
        out["reason"] = f"price_parse_error: {e}"
        return out

    if final_price <= 0:
        out["reason"] = "non_positive_price"
        out["banda_id"] = found_banda
        return out

    out.update({
        "ok":          True,
        "final_price": final_price,
        "banda_id":    found_banda,
        "plazo":       90,
        "source":      ("marluvas_client_sku_pricing"
                        if not used_fallback
                        else "fallback_band_default"),
    })
    return out


def get_client_price_matrix(
    client_id:   Union[str, "UUID"],
    brand_id:    Union[str, "UUID"],
    product_sku: str,
    tc_usd_brl:  Optional[float] = None,
) -> Dict[str, Any]:
    """Devuelve la fila completa de plazos para un (cliente, marca, sku)
    en la banda vigente según `tc_usd_brl`.

    Útil para vistas que necesitan mostrar TODOS los plazos disponibles
    del snapshot, no solo el 90d. Por ejemplo, el wizard
    `/portal/nueva-oc` paso 3 ("Propuesta — descuento por pronto pago")
    debe mostrar exactamente los plazos que el operador comercial
    configuró para esa banda del SKU — pueden ser solo 90/60/30/8, o
    incluir custom como 45d o 120d.

    Shape de retorno (siempre se devuelve, nunca lanza):
        {
            "ok":           bool,
            "banda_id":     int | None,     # 1..12 — banda usada
            "banda_rango":  str  | None,    # ej. "5,00 – 5,20"
            "banda_div":    Decimal | None, # divisor BRL de la banda
            "currency":     "USD",
            "base_dias":    90,             # plazo de referencia (precio base)
            "base_price":   Decimal | None, # precio @ base_dias
            "plazos":       [
                { "dias": int, "price": Decimal, "pct": Decimal, "is_base": bool },
                ...
            ],   # ordenados por días ASC; pct = (price - base) / base
            "source":       "marluvas_client_sku_pricing" | "fallback_band_default" | None,
            "reason":       str  | None,
        }
    """
    out: Dict[str, Any] = {
        "ok":           False,
        "banda_id":     None,
        "banda_rango":  None,
        "banda_div":    None,
        "currency":     "USD",
        "base_dias":    90,
        "base_price":   None,
        "plazos":       [],
        "source":       None,
        "reason":       None,
    }

    if not (client_id and brand_id and product_sku):
        out["reason"] = "missing_required_args"
        return out

    cid = str(client_id)
    bid = str(brand_id)
    sku = str(product_sku).strip()
    if not sku:
        out["reason"] = "empty_sku"
        return out

    try:
        row, brand_drift = _find_active_pricing_row(bid, cid, sku)
    except Exception as e:
        log.warning("get_client_price_matrix · DB lookup falló · %s", e)
        out["reason"] = f"db_error: {e}"
        return out

    if not row:
        out["reason"] = "no_active_pricing_row"
        return out

    if brand_drift:
        log.info(
            "get_client_price_matrix · brand drift · sku=%s cliente=%s "
            "requested_brand=%s row_brand=%s (usando fila por cliente+sku)",
            sku, cid, bid, row.brand_id,
        )

    matrix = row.prices_matrix or {}
    if not isinstance(matrix, dict) or not matrix:
        out["reason"] = "empty_prices_matrix"
        return out

    # Banda vigente — TC del día o fallback central
    banda_id = banda_for_tc(tc_usd_brl) if tc_usd_brl is not None else None
    used_fallback = banda_id is None
    if banda_id is None:
        banda_id = 6  # fallback central (5.00–5.20)

    # Espiral defensiva: si la banda exacta no está en la matriz, baja
    # al vecino más cercano (snapshots parciales).
    found_banda = None
    plazos_dict: Dict[str, Any] = {}
    if (str(banda_id) in matrix and isinstance(matrix[str(banda_id)], dict)
            and matrix[str(banda_id)]):
        plazos_dict = matrix[str(banda_id)]
        found_banda = banda_id
    else:
        for step in range(1, _BAND_MAX):
            for candidate in (banda_id - step, banda_id + step):
                if candidate < _BAND_MIN or candidate > _BAND_MAX:
                    continue
                pl = matrix.get(str(candidate))
                if isinstance(pl, dict) and pl:
                    plazos_dict = pl
                    found_banda = candidate
                    break
            if plazos_dict:
                break

    if not plazos_dict or found_banda is None:
        out["reason"] = "no_plazos_in_any_band"
        out["banda_id"] = banda_id
        return out

    # Parse plazos a Decimal + sort por días ASC
    parsed: list[Dict[str, Any]] = []
    for d_key, p_val in plazos_dict.items():
        try:
            dias = int(str(d_key).strip())
        except (TypeError, ValueError):
            continue
        if dias <= 0:
            continue
        try:
            price = Decimal(str(p_val))
        except Exception:
            continue
        if price <= 0:
            continue
        parsed.append({"dias": dias, "price": price})

    if not parsed:
        out["reason"] = "no_positive_prices_in_band"
        out["banda_id"] = found_banda
        return out

    parsed.sort(key=lambda x: x["dias"])

    # Plazo base: usamos 90d si existe; si no, el plazo más largo
    # disponible (representa el precio de referencia / "techo de plazo").
    base_dias = 90
    base_entry = next((p for p in parsed if p["dias"] == base_dias), None)
    if base_entry is None:
        base_entry = parsed[-1]  # plazo más largo
        base_dias = base_entry["dias"]
    base_price = base_entry["price"]

    # Construir plazos con pct relativo a base. pct > 0 = recargo, < 0 = descuento.
    out_plazos: list[Dict[str, Any]] = []
    for p in parsed:
        if base_price > 0:
            pct = (p["price"] - base_price) / base_price
        else:
            pct = Decimal("0")
        out_plazos.append({
            "dias":    p["dias"],
            "price":   p["price"],
            "pct":     pct.quantize(Decimal("0.0001")),
            "is_base": (p["dias"] == base_dias),
        })

    # Metadata de banda
    banda_piso = _BAND_PISO + _BAND_STEP * (found_banda - 1)
    banda_techo = banda_piso + _BAND_STEP
    banda_rango = f"{banda_piso:.2f} – {banda_techo:.2f}".replace(".", ",")
    # divisor: punto medio de la banda (mismo cálculo que frontend)
    banda_div = Decimal(str(banda_piso + (_BAND_STEP / 2)))

    out.update({
        "ok":          True,
        "banda_id":    found_banda,
        "banda_rango": banda_rango,
        "banda_div":   banda_div,
        "base_dias":   base_dias,
        "base_price":  base_price,
        "plazos":      out_plazos,
        "source":      ("marluvas_client_sku_pricing"
                        if not used_fallback
                        else "fallback_band_default"),
    })
    return out
