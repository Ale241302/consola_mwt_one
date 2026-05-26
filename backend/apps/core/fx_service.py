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

# Tabla de fallback hardcoded - tasas aproximadas mayo 2026.
# Estas son TASAS DE SEGURIDAD cuando Frankfurter esta bloqueado
# (firewall corporativo, DNS, timeout). Mejor un valor cercano a
# la realidad que arrastrar el bug del fx=1.0 sin convertir.
# Override por env var MWT_FX_OVERRIDE_<CCY> si se necesita ajustar
# sin redeploy (ej. MWT_FX_OVERRIDE_CRC=0.00195).
_FALLBACK_RATES_USD = {
    "USD": 1.0,
    "EUR": 1.08,
    "GBP": 1.27,
    "JPY": 0.0068,        # ~147 JPY/USD
    "CHF": 1.13,
    "CAD": 0.73,
    "AUD": 0.66,
    "CNY": 0.139,         # ~7.2 CNY/USD
    "BRL": 0.196,         # ~5.1 BRL/USD
    "MXN": 0.0498,        # ~20 MXN/USD
    "ARS": 0.00099,       # ~1010 ARS/USD
    "CLP": 0.00104,       # ~960 CLP/USD
    "COP": 0.000238,      # ~4200 COP/USD
    "PEN": 0.264,         # ~3.8 PEN/USD
    "UYU": 0.025,         # ~40 UYU/USD
    "BOB": 0.144,         # ~6.9 BOB/USD
    "PYG": 0.000136,      # ~7350 PYG/USD
    "VES": 0.0274,        # bolivar soberano
    "DOP": 0.0166,        # ~60 DOP/USD
    "CRC": 0.001937,      # ~516 CRC/USD - DUA CR
    "GTQ": 0.129,         # ~7.75 GTQ/USD
    "HNL": 0.0405,        # ~24.7 HNL/USD
    "NIO": 0.0272,        # ~36.7 NIO/USD
    "PAB": 1.0,           # balboa = USD
    "SVC": 0.114,         # colon SV (legacy)
    "HTG": 0.00754,       # ~132 HTG/USD
    "BSD": 1.0,           # bahamas dolar = USD
    "BBD": 0.5,           # ~2 BBD/USD
    "TTD": 0.147,         # ~6.8 TTD/USD
}


def _fallback_rate(ccy: str) -> float | None:
    """Devuelve la tasa hardcoded o un override por env var.

    Permite ajustar sin redeploy via MWT_FX_OVERRIDE_<CCY>=<float>.
    """
    import os
    env_key = f"MWT_FX_OVERRIDE_{ccy}"
    env_val = os.environ.get(env_key)
    if env_val:
        try:
            v = float(env_val)
            if v > 0:
                log.info("[fx_service] override env %s = %s", env_key, v)
                return v
        except (TypeError, ValueError):
            log.warning("[fx_service] override env %s invalido: %r", env_key, env_val)
    return _FALLBACK_RATES_USD.get(ccy)


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
            fb = _fallback_rate(ccy)
            return fb if (fb is not None and fb > 0) else None
        rate_f = float(rate)
        if rate_f <= 0:
            log.warning("[fx_service] rate <=0 para %s: %s", ccy, rate_f)
            fb = _fallback_rate(ccy)
            return fb if (fb is not None and fb > 0) else None
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
        log.warning(
            "[fx_service] Frankfurter fallo para %s: %s - intentando fallback hardcoded",
            ccy, exc,
        )
        fallback = _fallback_rate(ccy)
        if fallback is not None and fallback > 0:
            log.info("[fx_service] usando fallback hardcoded %s->USD=%s", ccy, fallback)
            # NO cacheamos el fallback hardcoded: queremos que el
            # proximo request reintente Frankfurter por si ya volvio.
            return fallback
        log.error(
            "[fx_service] %s sin tasa: Frankfurter fallo y no hay fallback hardcoded",
            ccy,
        )
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
