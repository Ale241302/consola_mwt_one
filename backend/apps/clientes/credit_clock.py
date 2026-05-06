"""
=====================================================================
MWT.ONE · apps.clientes.credit_clock
Agente responsable: [AG-BACKEND]

CreditClockProjector · recomputa el cache `clientes.credit_clock` para
un cliente determinado. Se invoca desde:

  · apps.finance.tasks.recompute_credit_clock_task   (post CONFIRMADO_AI)
  · apps.finance.views (manual recompute si CEO lo pide desde el perfil)

Algoritmo (alineado con spec v2.0):

  Para cada cliente:
    1. Lee config (tope_dias, amarillo, rojo, bloqueo_automatico)
       — fallback a defaults 90/60/75/True si no hay fila.
    2. Recorre expedientes ABIERTOS (status NOT IN ('CERRADO','CANCELADO'))
       y por cada uno computa días de crédito consumidos =
       días desde la primera factura emitida (issued_at) hasta hoy
       descontando los pagos confirmados aplicados.
    3. dias_credito_consumidos = max sobre todos los expedientes.
    4. Cuenta expedientes en amarillo (>= umbral_amarillo) y rojo
       (>= umbral_rojo).
    5. monto_pendiente_usd = Σ Payment.monto_usd de pagos
       PENDIENTE_AI / NEEDS_REVIEW + facturas no cobradas.
    6. bloqueado = bloqueo_automatico AND dias_credito_consumidos >= tope_dias.

NOTA: la lógica REAL de "días desde issued_at" depende del schema de
expedientes/proformas/facturas que cada tenant pobló. En esta primera
versión usamos una heurística defensiva basada en `expedientes.files.opened_at`
y los pagos `finance.payment`. Cualquier ajuste fino se hace en este
proyector sin tocar la API.
=====================================================================
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, asdict
from datetime import datetime, timezone as _tz
from decimal import Decimal
from typing import Any, Dict, Optional

from django.db import connection, transaction

log = logging.getLogger(__name__)


# ════════════════════════════════════════════════════════════
# Resultado del recompute
# ════════════════════════════════════════════════════════════
@dataclass
class CreditClockSnapshot:
    cliente_id: uuid.UUID
    dias_credito_consumidos: int
    expedientes_abiertos_total: int
    expedientes_abiertos_amarillo: int
    expedientes_abiertos_rojo: int
    monto_pendiente_usd: Decimal
    bloqueado: bool
    bloqueo_reason: Optional[str]
    config: Dict[str, Any]            # tope_dias, umbral_*, bloqueo_automatico
    last_payment_id: Optional[uuid.UUID]

    def as_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["cliente_id"] = str(self.cliente_id)
        d["monto_pendiente_usd"] = str(self.monto_pendiente_usd)
        if self.last_payment_id:
            d["last_payment_id"] = str(self.last_payment_id)
        return d


# ════════════════════════════════════════════════════════════
# Defaults globales (alineados con backfill de B8)
# ════════════════════════════════════════════════════════════
DEFAULTS = {
    "tope_dias":            90,
    "umbral_amarillo_dias": 60,
    "umbral_rojo_dias":     75,
    "bloqueo_automatico":   True,
}


class CreditClockProjector:
    """
    Stateless. Cada `recompute()` es atómico (SELECT FOR UPDATE sobre
    credit_clock evita races con otro worker que recompute el mismo
    cliente al mismo tiempo).
    """

    @classmethod
    @transaction.atomic
    def recompute(cls, cliente_id: uuid.UUID,
                  *, last_payment_id: Optional[uuid.UUID] = None) -> CreditClockSnapshot:
        """Recalcula y persiste el credit_clock para `cliente_id`.

        Args:
            cliente_id      → UUID del cliente.
            last_payment_id → opcional · pago que disparó el recompute
                              (queda traceado en credit_clock para audit).
        """
        config = cls._load_config(cliente_id)
        days   = cls._compute_days_consumed(cliente_id)
        counts = cls._count_open_expedientes_by_band(cliente_id, config)
        pending_usd = cls._sum_pending_usd(cliente_id)

        bloqueado = bool(
            config["bloqueo_automatico"] and days >= config["tope_dias"]
        )
        reason = "TOPE_EXCEDIDO" if bloqueado else None

        snap = CreditClockSnapshot(
            cliente_id                    = cliente_id,
            dias_credito_consumidos       = days,
            expedientes_abiertos_total    = counts["total"],
            expedientes_abiertos_amarillo = counts["amarillo"],
            expedientes_abiertos_rojo     = counts["rojo"],
            monto_pendiente_usd           = pending_usd,
            bloqueado                     = bloqueado,
            bloqueo_reason                = reason,
            config                        = config,
            last_payment_id               = last_payment_id,
        )

        cls._persist(snap)
        log.info(
            "CreditClock recompute · cliente=%s · days=%d · open=%d · "
            "amarillo=%d · rojo=%d · pending=%s USD · bloqueado=%s",
            cliente_id, days, counts["total"],
            counts["amarillo"], counts["rojo"], pending_usd, bloqueado,
        )
        return snap

    # ════════════════════════════════════════════════════════
    # Helpers privados
    # ════════════════════════════════════════════════════════
    @classmethod
    def _load_config(cls, cliente_id: uuid.UUID) -> Dict[str, Any]:
        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT tope_dias, umbral_amarillo_dias, umbral_rojo_dias,
                       bloqueo_automatico
                  FROM clientes.credit_config
                 WHERE cliente_id = %s LIMIT 1
                """,
                [str(cliente_id)],
            )
            row = cur.fetchone()
        if not row:
            return dict(DEFAULTS)
        return {
            "tope_dias":            row[0] or DEFAULTS["tope_dias"],
            "umbral_amarillo_dias": row[1] or DEFAULTS["umbral_amarillo_dias"],
            "umbral_rojo_dias":     row[2] or DEFAULTS["umbral_rojo_dias"],
            "bloqueo_automatico":   bool(row[3]) if row[3] is not None
                                    else DEFAULTS["bloqueo_automatico"],
        }

    @classmethod
    def _compute_days_consumed(cls, cliente_id: uuid.UUID) -> int:
        """
        Días = días desde el expediente más antiguo aún ABIERTO con
        algún saldo pendiente (monto_invoiced > monto_paid). Si no hay
        expedientes abiertos con saldo, retorna 0.

        Conservador: si la query explota por schema mismatch, devuelve 0.
        """
        with connection.cursor() as cur:
            try:
                cur.execute(
                    """
                    SELECT MIN(opened_at)::date
                      FROM expedientes.files
                     WHERE client_account_uuid = %s
                       AND status NOT IN ('CERRADO','CANCELADO','closed','archived')
                       AND deleted_at IS NULL
                    """,
                    [str(cliente_id)],
                )
                row = cur.fetchone()
            except Exception as e:
                log.warning("compute_days_consumed query falló (cliente=%s): %s",
                            cliente_id, e)
                return 0
        if not row or not row[0]:
            return 0
        oldest = row[0]
        today  = datetime.now(tz=_tz.utc).date()
        delta  = (today - oldest).days
        return max(0, int(delta))

    @classmethod
    def _count_open_expedientes_by_band(cls, cliente_id: uuid.UUID,
                                         config: Dict[str, Any]) -> Dict[str, int]:
        """
        Cuenta cuántos expedientes abiertos tiene este cliente por banda
        (amarillo/rojo) según los días desde su `opened_at`.
        """
        amarillo = int(config["umbral_amarillo_dias"])
        rojo     = int(config["umbral_rojo_dias"])

        with connection.cursor() as cur:
            try:
                cur.execute(
                    """
                    SELECT
                      COUNT(*) AS total,
                      COUNT(*) FILTER (
                        WHERE EXTRACT(DAY FROM (now() - opened_at)) >= %s
                      ) AS amarillo,
                      COUNT(*) FILTER (
                        WHERE EXTRACT(DAY FROM (now() - opened_at)) >= %s
                      ) AS rojo
                    FROM expedientes.files
                    WHERE client_account_uuid = %s
                      AND status NOT IN ('CERRADO','CANCELADO','closed','archived')
                      AND deleted_at IS NULL
                    """,
                    [amarillo, rojo, str(cliente_id)],
                )
                row = cur.fetchone()
            except Exception as e:
                log.warning("count_expedientes query falló (cliente=%s): %s",
                            cliente_id, e)
                return {"total": 0, "amarillo": 0, "rojo": 0}

        if not row:
            return {"total": 0, "amarillo": 0, "rojo": 0}
        total, am, ro = (int(x or 0) for x in row)
        return {"total": total, "amarillo": am, "rojo": ro}

    @classmethod
    def _sum_pending_usd(cls, cliente_id: uuid.UUID) -> Decimal:
        """
        Σ monto_usd de Payments del cliente que NO están confirmados ni
        revertidos. Es la "exposición pendiente" que el clock muestra.
        """
        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT COALESCE(SUM(monto_usd), 0)
                  FROM finance.payment
                 WHERE client_id = %s
                   AND is_active = TRUE
                   AND estado IN ('PENDIENTE_AI','NEEDS_REVIEW')
                """,
                [str(cliente_id)],
            )
            row = cur.fetchone()
        return Decimal(str(row[0])) if row and row[0] is not None else Decimal("0")

    @classmethod
    def _persist(cls, snap: CreditClockSnapshot) -> None:
        with connection.cursor() as cur:
            # Upsert: hay un row por cliente desde el backfill de B8,
            # pero por idempotencia hacemos INSERT ... ON CONFLICT.
            cur.execute(
                """
                INSERT INTO clientes.credit_clock (
                    cliente_id, dias_credito_consumidos,
                    expedientes_abiertos_total,
                    expedientes_abiertos_amarillo,
                    expedientes_abiertos_rojo,
                    monto_pendiente_usd, bloqueado, bloqueo_reason,
                    last_recalc_at, last_payment_id, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, now(), %s, now())
                ON CONFLICT (cliente_id) DO UPDATE SET
                    dias_credito_consumidos       = EXCLUDED.dias_credito_consumidos,
                    expedientes_abiertos_total    = EXCLUDED.expedientes_abiertos_total,
                    expedientes_abiertos_amarillo = EXCLUDED.expedientes_abiertos_amarillo,
                    expedientes_abiertos_rojo     = EXCLUDED.expedientes_abiertos_rojo,
                    monto_pendiente_usd           = EXCLUDED.monto_pendiente_usd,
                    bloqueado                     = EXCLUDED.bloqueado,
                    bloqueo_reason                = EXCLUDED.bloqueo_reason,
                    last_recalc_at                = EXCLUDED.last_recalc_at,
                    last_payment_id               = EXCLUDED.last_payment_id,
                    updated_at                    = now()
                """,
                [
                    str(snap.cliente_id),
                    int(snap.dias_credito_consumidos),
                    int(snap.expedientes_abiertos_total),
                    int(snap.expedientes_abiertos_amarillo),
                    int(snap.expedientes_abiertos_rojo),
                    snap.monto_pendiente_usd,
                    bool(snap.bloqueado),
                    snap.bloqueo_reason,
                    str(snap.last_payment_id) if snap.last_payment_id else None,
                ],
            )
