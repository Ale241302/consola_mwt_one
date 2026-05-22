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
        row = (MarluvasClientSkuPricing.objects
               .filter(brand_id=bid, cliente_id=cid, sku=sku, is_active=True)
               .order_by("-updated_at")
               .first())
    except Exception as e:
        log.warning("resolve_client_price · DB lookup falló · %s", e)
        out["reason"] = f"db_error: {e}"
        return out

    if not row:
        out["reason"] = "no_active_pricing_row"
        return out

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
