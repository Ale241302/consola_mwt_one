"""
=====================================================================
MWT.ONE · apps.finance.fx_service
Agente responsable: [AG-BACKEND]

FXService · gestión de tasas de cambio para snapshots de Payment.

Política CEO (spec v2.0):
  · Moneda primaria del sistema: USD.
  · Fuente: Open Exchange Rates (OXR), plan paid.
  · `latest.json` (base USD) cubre 200+ monedas con SLA 99.99%.
  · Cron Celery beat `fx_rate_refresh` corre `0 1 * * *` UTC.
  · Cada Payment persiste `tasa_cambio_a_usd` snapshot al momento del
    registro. Inmutable.

Tabla: cobros.fx_rate_history (creada por 81_cobros_audit.sql).
  · Cache local — primera fuente de consulta.
  · Si la fecha < hoy y no hay row, llamamos OXR `historical/<date>.json`.
  · Si OXR falla (no key, 5xx, timeout) → fallback a 1.0 con warning.

Endpoints OXR usados:
  GET https://openexchangerates.org/api/latest.json?app_id=<KEY>&base=USD
  GET https://openexchangerates.org/api/historical/2026-04-20.json?app_id=...

Variables env requeridas:
  OXR_APP_ID       — API key (paid plan recomendado para historical)
  OXR_BASE_URL     — opcional, default https://openexchangerates.org/api
  FX_REQUEST_TIMEOUT — opcional, default 8 (segundos)

Estrategia de fallback:
  1. Cache hit → devuelve rate.
  2. Si moneda == USD → 1.0 (no llama API).
  3. Si OXR_APP_ID vacío → 1.0 con warning.
  4. Si la API falla → 1.0 con warning + log.
=====================================================================
"""
from __future__ import annotations

import logging
import os
import uuid
from datetime import date, datetime, timezone as _tz
from decimal import Decimal
from typing import Dict, List, Optional

from django.db import connection

log = logging.getLogger(__name__)


OXR_BASE_URL = os.environ.get("OXR_BASE_URL", "https://openexchangerates.org/api")
OXR_APP_ID   = os.environ.get("OXR_APP_ID", "")
FX_TIMEOUT   = int(os.environ.get("FX_REQUEST_TIMEOUT", "8"))
FX_SOURCE    = "OXR"


# ════════════════════════════════════════════════════════════
# FXService
# ════════════════════════════════════════════════════════════
class FXService:
    """Servicio stateless. Todos los métodos son `@classmethod`."""

    # ── Public API ──────────────────────────────────────────
    @classmethod
    def get_usd_rate(cls, moneda: str, fecha: Optional[date] = None) -> Decimal:
        """
        Devuelve la tasa para convertir `moneda → USD` para una fecha
        dada. Si `fecha` es None usa hoy.

        El convention es: USD = monto_origen * tasa_cambio_a_usd.
        Por ejemplo si moneda=COP y rate ~ 0.00024, entonces:
            500.000 COP * 0.00024 = 120 USD

        OXR devuelve `rates.<MONEDA>` = "cuántas unidades de MONEDA
        cuesta 1 USD". Lo invertimos para tener "cuántos USD = 1 MONEDA".
        """
        cur = (moneda or "USD").upper()
        if cur == "USD":
            return Decimal("1")
        target = fecha or datetime.now(tz=_tz.utc).date()

        # 1. Cache hit (cobros.fx_rate_history)
        cached = cls._read_cache(moneda_from=cur, fecha=target)
        if cached is not None:
            return cached

        # 2. OXR API (latest si fecha == hoy, historical si < hoy)
        if not OXR_APP_ID:
            log.warning("FXService: OXR_APP_ID vacío · %s/%s → fallback 1.0",
                        cur, target)
            return Decimal("1")

        try:
            rates = (cls._fetch_latest() if target >= datetime.now(tz=_tz.utc).date()
                     else cls._fetch_historical(target))
        except Exception as e:
            log.warning("FXService: OXR call falló para %s/%s: %s · fallback 1.0",
                        cur, target, e)
            return Decimal("1")

        rate_per_usd = rates.get(cur)
        if rate_per_usd is None or rate_per_usd <= 0:
            log.warning("FXService: %s no encontrado en OXR rates · fallback 1.0", cur)
            return Decimal("1")

        # OXR devuelve "1 USD = rate_per_usd MONEDA". Lo invertimos.
        rate_to_usd = Decimal("1") / Decimal(str(rate_per_usd))
        rate_to_usd = rate_to_usd.quantize(Decimal("0.000001"))

        cls._write_cache(moneda_from=cur, fecha=target, rate=rate_to_usd)
        return rate_to_usd

    @classmethod
    def refresh_latest(cls) -> Dict[str, int]:
        """
        Pull de OXR `latest.json` y persistencia en `cobros.fx_rate_history`.
        Llamado por el Celery beat `fx_rate_refresh`.

        Devuelve un dict con counters (`fetched`, `inserted`, `skipped`).
        """
        if not OXR_APP_ID:
            log.warning("FXService.refresh_latest: OXR_APP_ID vacío · skip")
            return {"fetched": 0, "inserted": 0, "skipped": 0,
                    "error": "no_app_id"}

        rates = cls._fetch_latest()
        today = datetime.now(tz=_tz.utc).date()
        inserted = 0
        skipped  = 0

        for cur, rate_per_usd in rates.items():
            if not isinstance(cur, str) or len(cur) != 3:
                continue
            if rate_per_usd is None or rate_per_usd <= 0:
                skipped += 1
                continue
            rate_to_usd = (Decimal("1") / Decimal(str(rate_per_usd))).quantize(
                Decimal("0.000001")
            )
            ok = cls._write_cache(moneda_from=cur, fecha=today, rate=rate_to_usd)
            if ok:
                inserted += 1
            else:
                skipped += 1

        log.info("FXService.refresh_latest: fetched=%d inserted=%d skipped=%d",
                 len(rates), inserted, skipped)
        return {"fetched": len(rates), "inserted": inserted, "skipped": skipped}

    # ════════════════════════════════════════════════════════
    # Cache I/O · cobros.fx_rate_history
    # ════════════════════════════════════════════════════════
    @classmethod
    def _read_cache(cls, *, moneda_from: str, fecha: date) -> Optional[Decimal]:
        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT rate
                  FROM cobros.fx_rate_history
                 WHERE moneda_from = %s
                   AND moneda_to   = 'USD'
                   AND fecha       = %s
                   AND is_active   = TRUE
                 ORDER BY created_at DESC
                 LIMIT 1
                """,
                [moneda_from, fecha],
            )
            row = cur.fetchone()
        if row and row[0] is not None:
            return Decimal(str(row[0]))
        return None

    @classmethod
    def _write_cache(cls, *, moneda_from: str, fecha: date, rate: Decimal) -> bool:
        """Idempotente: si ya hay un row activo para (moneda_from, fecha,
        source=OXR), no inserta. Devuelve True si insertó."""
        try:
            with connection.cursor() as cur:
                # Aprovecha el unique partial index `idx_uq_fx_rate_daily`
                cur.execute(
                    """
                    INSERT INTO cobros.fx_rate_history
                        (id, fecha, moneda_from, moneda_to, rate, source, source_ref, is_active)
                    VALUES
                        (gen_random_uuid(), %s, %s, 'USD', %s, %s, %s, TRUE)
                    ON CONFLICT ON CONSTRAINT idx_uq_fx_rate_daily DO NOTHING
                    """,
                    [fecha, moneda_from, rate, FX_SOURCE,
                     f"oxr:latest:{fecha.isoformat()}"],
                )
                return cur.rowcount > 0
        except Exception as e:
            # El index unique parcial puede no existir si el SQL no se
            # corrió en este DB (versión vieja). Caemos a un INSERT
            # plain con WHERE NOT EXISTS para mantener idempotencia.
            log.debug("FXService cache insert con ON CONFLICT falló (%s); "
                      "intentando upsert manual", e)
            try:
                with connection.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO cobros.fx_rate_history
                            (id, fecha, moneda_from, moneda_to, rate, source, source_ref, is_active)
                        SELECT gen_random_uuid(), %s, %s, 'USD', %s, %s, %s, TRUE
                         WHERE NOT EXISTS (
                            SELECT 1 FROM cobros.fx_rate_history
                             WHERE fecha = %s AND moneda_from = %s
                               AND moneda_to = 'USD' AND source = %s
                               AND is_active = TRUE
                         )
                        """,
                        [fecha, moneda_from, rate, FX_SOURCE,
                         f"oxr:latest:{fecha.isoformat()}",
                         fecha, moneda_from, FX_SOURCE],
                    )
                    return cur.rowcount > 0
            except Exception as e2:
                log.warning("FXService cache insert fallback falló: %s", e2)
                return False

    # ════════════════════════════════════════════════════════
    # OXR HTTP calls
    # ════════════════════════════════════════════════════════
    @classmethod
    def _fetch_latest(cls) -> Dict[str, float]:
        return cls._fetch(f"{OXR_BASE_URL}/latest.json")

    @classmethod
    def _fetch_historical(cls, fecha: date) -> Dict[str, float]:
        return cls._fetch(f"{OXR_BASE_URL}/historical/{fecha.isoformat()}.json")

    @classmethod
    def _fetch(cls, url: str) -> Dict[str, float]:
        import requests  # type: ignore  # ya está en requirements.txt
        params = {"app_id": OXR_APP_ID, "base": "USD"}
        resp = requests.get(url, params=params, timeout=FX_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        rates = data.get("rates") or {}
        if not isinstance(rates, dict) or not rates:
            raise RuntimeError(f"OXR respuesta sin rates: {data}")
        return rates
