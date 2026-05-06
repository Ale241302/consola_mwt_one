"""
=====================================================================
MWT.ONE · apps.finance.tasks
Agente responsable: [AG-BACKEND]

Celery tasks del módulo finance.

Fase 3 expone:
  · ai_analyzer_task(payment_id) → ejecuta AIPaymentAnalyzer y
    transiciona Payment.estado a CONFIRMADO_AI o NEEDS_REVIEW.

Fase 4 agregará `send_payment_email_task` (queue `emails`).

Fallback síncrono:
  Si no hay broker / worker disponible (dev local sin Redis), el
  helper `enqueue_ai_analyzer()` ejecuta el task in-process. Esto
  permite probar end-to-end sin levantar el worker, a costa de 1-30s
  de latencia en la API. En producción el worker debe correr.
=====================================================================
"""
from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone as _tz
from decimal import Decimal
from typing import Optional

from celery import shared_task
from django.db import connection

from .enums import (
    AIVerdictStatus, PaymentStatus, AI_AUTO_CONFIRM_MIN_CONFIDENCE,
)
from .models import Payment, PaymentEvidence, PaymentAIVerdict

log = logging.getLogger(__name__)


# ════════════════════════════════════════════════════════════
# Public helper — usado por PaymentService.register()
# ════════════════════════════════════════════════════════════
def enqueue_ai_analyzer(payment_id: uuid.UUID, *, force_sync: bool = False) -> str:
    """
    Encola `ai_analyzer_task` en la queue `ai_analyzer`. Si no hay
    broker disponible o `FINANCE_AI_SYNC=1`, ejecuta in-process.

    Devuelve:
        "queued"   si se encoló a Celery
        "sync"     si se ejecutó síncronamente (fallback)
        "skipped"  si FINANCE_AI_DISABLE=1 (kill-switch para QA)
    """
    if os.environ.get("FINANCE_AI_DISABLE") == "1":
        log.info("ai_analyzer skipped (FINANCE_AI_DISABLE=1) · payment=%s", payment_id)
        return "skipped"

    sync_mode = force_sync or os.environ.get("FINANCE_AI_SYNC") == "1"
    if sync_mode:
        ai_analyzer_task.apply(args=[str(payment_id)])
        return "sync"

    try:
        ai_analyzer_task.apply_async(args=[str(payment_id)], queue="ai_analyzer")
        return "queued"
    except Exception as e:
        # Broker no disponible / connection refused → degradación a
        # síncrono. Mejor latencia alta que un pago colgado.
        log.warning("ai_analyzer broker unavailable, running sync: %s", e)
        ai_analyzer_task.apply(args=[str(payment_id)])
        return "sync"


# ════════════════════════════════════════════════════════════
# Task principal
# ════════════════════════════════════════════════════════════
@shared_task(
    name="finance.ai_analyzer",
    bind=True,
    queue="ai_analyzer",
    autoretry_for=(ConnectionError, TimeoutError),
    retry_backoff=True,
    retry_backoff_max=120,
    retry_jitter=True,
    max_retries=3,
    acks_late=True,
)
def ai_analyzer_task(self, payment_id: str) -> dict:
    """
    Analiza el comprobante del Payment con IA y transiciona el estado.

    Pasos:
      1. Carga el Payment + PaymentEvidence.
      2. Si ya hay un verdict `is_current=TRUE` y el estado del payment
         es CONFIRMADO_AI / CONFIRMADO_HUMANO / RECHAZADO / REVERTIDO,
         no re-analizamos (idempotencia · `re_analyze` action es la
         única forma de re-correrlo manualmente).
      3. Llama AIPaymentAnalyzer.analyze().
      4. Persiste PaymentAIVerdict (el trigger desmarca el previo).
      5. Transiciona Payment.estado:
           · MATCH + confianza ≥ 90 → CONFIRMADO_AI + confirmed_at=now
           · resto                  → NEEDS_REVIEW
      6. Loggea a finance.activity_log.

    Devuelve un dict-resumen útil para inspección directa por celery.
    """
    from apps.ai_hub.payment_analyzer import AIPaymentAnalyzer

    log.info("ai_analyzer_task START payment_id=%s", payment_id)

    try:
        payment = Payment.objects.get(pk=payment_id)
    except Payment.DoesNotExist:
        log.error("Payment %s no existe — abort", payment_id)
        return {"ok": False, "error": "payment_not_found", "payment_id": payment_id}

    # Estados terminales: no re-analizar a menos que el caller pida
    # re-análisis explícito (action `re_analyze` borra current y re-encola).
    terminal = {
        PaymentStatus.CONFIRMADO_HUMANO,
        PaymentStatus.RECHAZADO,
        PaymentStatus.REVERTIDO,
    }
    if payment.estado in terminal:
        log.info("Payment %s en estado terminal %s — skip", payment_id, payment.estado)
        return {"ok": True, "skipped": True, "estado": payment.estado}

    evidence = PaymentEvidence.objects.filter(payment_id=payment.id).first()

    # ── Llamar al analyzer ─────────────────────────────────────
    analyzer = AIPaymentAnalyzer()
    verdict  = analyzer.analyze(payment, evidence)

    # ── Persistir verdict ──────────────────────────────────────
    verdict_id = uuid.uuid4()
    now_utc    = datetime.now(tz=_tz.utc)

    with connection.cursor() as cur:
        cur.execute(
            """
            INSERT INTO finance.payment_ai_verdict (
                id, payment_id, is_current, status, confianza,
                monto_extraido, moneda_extraida, fecha_extraida,
                referencia_extraida, beneficiario_extraido,
                ordenante_extraido, banco_emisor, banco_receptor,
                concepto, mismatch_fields, razon_humana, alertas_fraude,
                raw_claude_response, model_version, skill_version,
                duration_ms, tokens_input, tokens_output, cost_usd,
                error_code, error_message, analyzed_at
            ) VALUES (
                %s, %s, TRUE, %s, %s,
                %s, %s, %s,
                %s, %s,
                %s, %s, %s,
                %s, %s::jsonb, %s, %s::jsonb,
                %s::jsonb, %s, %s,
                %s, %s, %s, %s,
                %s, %s, %s
            )
            """,
            [
                str(verdict_id), str(payment.id), verdict.status,
                Decimal(str(verdict.confianza)),
                _to_decimal_or_none(verdict.monto_extraido),
                verdict.moneda_extraida,
                verdict.fecha_extraida,
                verdict.referencia_extraida,
                verdict.beneficiario_extraido,
                verdict.ordenante_extraido,
                verdict.banco_emisor,
                verdict.banco_receptor,
                verdict.concepto,
                json.dumps(verdict.mismatch_fields or []),
                verdict.razon_humana,
                json.dumps(verdict.alertas_fraude or []),
                json.dumps(verdict.raw_claude_response or {}),
                verdict.model_version,
                verdict.skill_version,
                verdict.duration_ms,
                verdict.tokens_input,
                verdict.tokens_output,
                _to_decimal_or_none(verdict.cost_usd),
                verdict.error_code,
                verdict.error_message,
                now_utc,
            ],
        )

    # ── Transicionar estado del Payment ────────────────────────
    auto_confirm = (
        verdict.status == AIVerdictStatus.MATCH
        and float(verdict.confianza) >= AI_AUTO_CONFIRM_MIN_CONFIDENCE
        and not verdict.error_code
    )
    new_estado = (
        PaymentStatus.CONFIRMADO_AI if auto_confirm
        else PaymentStatus.NEEDS_REVIEW
    )
    confirmed_at_value = now_utc if auto_confirm else None

    with connection.cursor() as cur:
        cur.execute(
            """
            UPDATE finance.payment
               SET estado       = %s,
                   confirmed_at = COALESCE(%s, confirmed_at),
                   updated_at   = now()
             WHERE id = %s
            """,
            [new_estado, confirmed_at_value, str(payment.id)],
        )

    # ── ActivityLog · payment.ai_verdict ───────────────────────
    from .services import ActivityLogger
    ActivityLogger.log(
        actor_id   = None,                      # el actor es el sistema
        actor_role = "system:ai_analyzer",
        action     = "payment.ai_verdict",
        target_id  = payment.id,
        target_type= "payment",
        payload_diff = {
            "estado_antes":  payment.estado,
            "estado_despues": new_estado,
            "verdict_status": verdict.status,
            "confianza":      float(verdict.confianza),
            "auto_confirm":   auto_confirm,
            "error_code":     verdict.error_code,
            "duration_ms":    verdict.duration_ms,
        },
        metadata = {
            "verdict_id":    str(verdict_id),
            "model_version": verdict.model_version,
            "skill_version": verdict.skill_version,
            "tokens_input":  verdict.tokens_input,
            "tokens_output": verdict.tokens_output,
            "cost_usd":      str(verdict.cost_usd) if verdict.cost_usd else None,
        },
    )

    log.info(
        "ai_analyzer_task DONE payment=%s · verdict=%s · confianza=%.1f · estado=%s",
        payment_id, verdict.status, float(verdict.confianza), new_estado,
    )

    # ── Fase 4 · encolar email a info@mwt.one ─────────────────
    # R9 (spec v2.0): cualquier verdict (sea MATCH o NEEDS_REVIEW)
    # dispara email transaccional con el comprobante adjunto.
    # `enqueue_payment_email` tiene fallback síncrono si no hay broker.
    email_outcome = "skipped"
    try:
        from apps.notifications.tasks import enqueue_payment_email
        email_outcome = enqueue_payment_email(payment.id)
    except Exception as e:
        # Nunca queremos que un fallo de email rompa el verdict ya
        # persistido — sólo lo logueamos.
        log.error(
            "enqueue_payment_email falló (verdict ya persistido) · payment=%s · err=%s",
            payment_id, e,
        )

    # ── Fase 5A · recompute del credit clock al confirmar ─────
    # R7 (spec v2.0): el crédito se libera SOLO al confirmar (no al
    # registrar). Encolamos el recompute fuera de la transacción
    # para que el dashboard refleje el cambio en <2s.
    credit_clock_outcome = "skipped"
    if auto_confirm and payment.client_id:
        try:
            credit_clock_outcome = enqueue_credit_clock_recompute(
                payment.client_id, last_payment_id=payment.id,
            )
        except Exception as e:
            log.error(
                "enqueue_credit_clock_recompute falló · payment=%s · err=%s",
                payment_id, e,
            )

    return {
        "ok": True,
        "payment_id": str(payment.id),
        "verdict_id": str(verdict_id),
        "verdict_status": verdict.status,
        "confianza": float(verdict.confianza),
        "auto_confirm": auto_confirm,
        "new_estado": new_estado,
        "duration_ms": verdict.duration_ms,
        "error_code": verdict.error_code,
        "email_outcome": email_outcome,
        "credit_clock_outcome": credit_clock_outcome,
    }


# ════════════════════════════════════════════════════════════
# Fase 5A · Credit Clock recompute (post-CONFIRMADO_AI)
# ════════════════════════════════════════════════════════════
def enqueue_credit_clock_recompute(cliente_id: uuid.UUID, *,
                                    last_payment_id: Optional[uuid.UUID] = None,
                                    force_sync: bool = False) -> str:
    """Fan-out tras confirmar un pago. Nunca rompe el verdict si falla."""
    if not cliente_id:
        return "skipped_no_cliente"
    if force_sync or os.environ.get("CREDIT_CLOCK_SYNC") == "1":
        recompute_credit_clock_task.apply(
            args=[str(cliente_id),
                  str(last_payment_id) if last_payment_id else None]
        )
        return "sync"
    try:
        recompute_credit_clock_task.apply_async(
            args=[str(cliente_id),
                  str(last_payment_id) if last_payment_id else None],
            queue="default",
        )
        return "queued"
    except Exception as e:
        log.warning("credit_clock broker unavailable, running sync: %s", e)
        recompute_credit_clock_task.apply(
            args=[str(cliente_id),
                  str(last_payment_id) if last_payment_id else None]
        )
        return "sync"


@shared_task(
    name="finance.recompute_credit_clock",
    bind=True,
    queue="default",
    autoretry_for=(ConnectionError, TimeoutError),
    retry_backoff=True,
    max_retries=2,
    acks_late=True,
)
def recompute_credit_clock_task(self, cliente_id: str,
                                 last_payment_id: Optional[str] = None) -> dict:
    """Recompute del cache `clientes.credit_clock`."""
    from apps.clientes.credit_clock import CreditClockProjector
    log.info("recompute_credit_clock START · cliente=%s", cliente_id)
    snap = CreditClockProjector.recompute(
        cliente_id=uuid.UUID(cliente_id),
        last_payment_id=uuid.UUID(last_payment_id) if last_payment_id else None,
    )
    log.info("recompute_credit_clock DONE · cliente=%s · bloqueado=%s · days=%d",
             cliente_id, snap.bloqueado, snap.dias_credito_consumidos)
    return {"ok": True, "snapshot": snap.as_dict()}


# ════════════════════════════════════════════════════════════
# Fase 5A · FX rate refresh (Celery beat: 0 1 * * * UTC)
# ════════════════════════════════════════════════════════════
@shared_task(
    name="finance.fx_rate_refresh",
    bind=True,
    queue="default",
    autoretry_for=(ConnectionError, TimeoutError),
    retry_backoff=True,
    max_retries=3,
    acks_late=True,
)
def fx_rate_refresh_task(self) -> dict:
    """Tirar de OXR `latest.json` y persistir snapshots del día.

    Llamado por Celery beat 0 1 * * * UTC (8 PM hora COL del día anterior,
    antes de cierre operativo).
    """
    from .fx_service import FXService
    log.info("fx_rate_refresh START")
    result = FXService.refresh_latest()
    log.info("fx_rate_refresh DONE · %s", result)
    return result


# ════════════════════════════════════════════════════════════
# Helpers
# ════════════════════════════════════════════════════════════
def _to_decimal_or_none(v) -> Optional[Decimal]:
    if v is None or v == "":
        return None
    try:
        return Decimal(str(v))
    except Exception:
        return None
