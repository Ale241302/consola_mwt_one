"""
=====================================================================
MWT.ONE · apps.core.fx_service
Sprint 2026-05-25 (AG-BACKEND)

Helper unificado para resolver el tipo de cambio MONEDA -> USD.

Fuente: Frankfurter (ECB, https://api.frankfurter.app/), gratis,
sin rate limit, datos diarios. Soporta ~50 monedas (CRC, BRL, MXN,
PEN, COP, EUR, GBP, JPY, etc.). Cacheado en Redis por 1 hora.

Uso:
    from apps.core.fx_service import get_fx_to_usd

    rate = get_fx_to_usd("CRC")          # → 0.001937 (≈520 CRC/USD)
    amount_usd = amount_local * rate     # convertir local → USD

Casos:
    - currency == "USD" o None → 1.0
    - currency conocida en cache → valor cacheado
    - currency conocida sin cache → fetch Frankfurter + cache
    - currency desconocida o error → None (caller debe decidir)
=====================================================================
"""
from __future__ import annotations

import logging
import time

import requests
from django.core.cache import cache

log = logging.getLogger(__name__)

_FRANKFURTER_URL = "https://api.frankfurter.app/latest?from={ccy}&to=USD"
_TIMEOUT_SEC = 6
_CACHE_TTL = 60 * 60        # 1 hora
_CACHE_KEY_FMT = "core:fx:{ccy}-usd"


def _normalize_currency(ccy) -> str | None:
    """Devuelve el codigo ISO-4217 en mayusculas o None si invalido."""
    if not ccy:
        return None
    s = str(ccy).upper().strip()[:3]
    return s if s.isalpha() and len(s) == 3 else None


def get_fx_to_usd(currency) -> float | None:
    """Devuelve cuantos USD vale 1 unidad de `currency`.

    Ejemplos:
      get_fx_to_usd("USD") -> 1.0
      get_fx_to_usd("CRC") -> 0.001937   (1 CRC vale ~$0.002)
      get_fx_to_usd("BRL") -> 0.2
      get_fx_to_usd("???") -> None       (moneda desconocida)
      get_fx_to_usd(None)  -> 1.0        (sin moneda → asumimos USD)

    Returns:
        float positivo si se pudo resolver.
        None si la moneda es desconocida o el upstream fallo y no
        habia cache (el caller decide: usar 1.0 como fallback, o
        marcar el item como sin_fx).
    """
    ccy = _normalize_currency(currency)
    if ccy is None or ccy == "USD":
        return 1.0

    cache_key = _CACHE_KEY_FMT.format(ccy=ccy.lower())
    try:
        cached = cache.get(cache_key)
        if cached is not None:
            return float(cached)
    except Exception:  # noqa: BLE001 — cache backend puede fallar
        log.debug("[fx_service] cache.get falló para %s, sigo a Frankfurter", ccy)

    # Frankfurter: from=<local> to=USD → rates.USD = cuántos USD vale 1 local
    url = _FRANKFURTER_URL.format(ccy=ccy)
    try:
        t0 = time.time()
        resp = requests.get(url, timeout=_TIMEOUT_SEC)
        resp.raise_for_status()
        raw = resp.json()
        rate = (raw.get("rates") or {}).get("USD")
        if rate in (None, "", 0, 0.0):
            log.warning("[fx_service] Frankfurter devolvio rate vacio para %s: %s", ccy, raw)
            return None
        rate_f = float(rate)
        if rate_f <= 0:
            log.warning("[fx_service] rate <=0 para %s: %s", ccy, rate_f)
            return None
        try:
            cache.set(cache_key, rate_f, timeout=_CACHE_TTL)
        except Exception:  # noqa: BLE001
            log.debug("[fx_service] cache.set fallo para %s", ccy)
        log.info(
            "[fx_service] Frankfurter ok %s->USD=%s (%.0fms)",
            ccy, rate_f, (time.time() - t0) * 1000,
        )
        return rate_f
    except (requests.RequestException, ValueError, KeyError, TypeError) as exc:
        log.warning("[fx_service] Frankfurter fallo para %s: %s", ccy, exc)
        return None


def convert_to_usd(amount, currency) -> float | None:
    """Atajo: convierte un monto local a USD.

    Returns:
        float si la conversion fue posible.
        None si la moneda es desconocida o el FX fallo.
    """
    try:
        amount_f = float(amount or 0)
    except (TypeError, ValueError):
        return None
    if amount_f == 0:
        return 0.0
    fx = get_fx_to_usd(currency)
    if fx is None:
        return None
    return round(amount_f * fx, 4)
