"""
=====================================================================
MWT.ONE · apps.notifications.tasks
Agente responsable: [AG-BACKEND]

Celery tasks del módulo notifications.

Fase 4 expone:
  · send_payment_email_task(payment_id) → renderiza el template
    pago_registrado.html, descarga el comprobante de MinIO y manda
    el email a info@mwt.one. Retries exponenciales 3 intentos.

Hook desde finance:
  · apps.finance.tasks.ai_analyzer_task encadena este task vía
    `enqueue_payment_email(payment_id)` después de transicionar
    el Payment.estado.

Fallback síncrono:
  Si no hay broker / worker disponible, `enqueue_payment_email`
  ejecuta `apply()` (in-process). Permite QA local sin Celery worker,
  a costa de latencia mayor en la API.
=====================================================================
"""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone as _tz

from celery import shared_task
from django.db import connection

log = logging.getLogger(__name__)


# ════════════════════════════════════════════════════════════
# Public helper · usado por finance.tasks.ai_analyzer_task
# ════════════════════════════════════════════════════════════
def enqueue_payment_email(payment_id: uuid.UUID, *, force_sync: bool = False) -> str:
    """
    Encola `send_payment_email_task` en la queue `emails`. Si el broker
    está caído o `NOTIFICATIONS_EMAIL_SYNC=1`, ejecuta in-process.

    Devuelve:
        "queued"   si se encoló a Celery
        "sync"     si se ejecutó síncronamente (fallback)
        "skipped"  si NOTIFICATIONS_EMAIL_DISABLE=1 (kill-switch QA)
    """
    if os.environ.get("NOTIFICATIONS_EMAIL_DISABLE") == "1":
        log.info("send_payment_email_task skipped · payment=%s", payment_id)
        return "skipped"

    sync_mode = force_sync or os.environ.get("NOTIFICATIONS_EMAIL_SYNC") == "1"
    if sync_mode:
        send_payment_email_task.apply(args=[str(payment_id)])
        return "sync"

    try:
        send_payment_email_task.apply_async(args=[str(payment_id)], queue="emails")
        return "queued"
    except Exception as e:
        log.warning(
            "send_payment_email_task broker unavailable, running sync: %s", e
        )
        send_payment_email_task.apply(args=[str(payment_id)])
        return "sync"


# ════════════════════════════════════════════════════════════
# Task principal
# ════════════════════════════════════════════════════════════
@shared_task(
    name="notifications.send_payment_email",
    bind=True,
    queue="emails",
    # Reintentos exponenciales — mismo patrón que el SKILL pide (R9).
    autoretry_for=(Exception,),
    retry_backoff=True,        # 1s, 2s, 4s, 8s ...
    retry_backoff_max=300,     # cap 5 min
    retry_jitter=True,
    max_retries=3,
    acks_late=True,
)
def send_payment_email_task(self, payment_id: str) -> dict:
    """
    Manda el email de notificación a info@mwt.one para un Payment.

    Flujo:
      1. Crea EmailQueueLog (status QUEUED → STARTED).
      2. Llama EmailDispatcher.send_payment_notification(...).
      3. Marca el log como SENT/FAILED y emite ActivityLog.
      4. Si la excepción es retryable, Celery la propaga y reintenta.
    """
    from .email_dispatcher import EmailDispatcher

    log.info("send_payment_email_task START · payment=%s · attempt=%d",
             payment_id, self.request.retries + 1)

    queue_id   = uuid.uuid4()
    started_at = datetime.now(tz=_tz.utc)
    _create_queue_log(
        queue_id=queue_id,
        celery_task_id=getattr(self.request, "id", None),
        payment_id=payment_id,
        retries=self.request.retries,
    )

    try:
        result = EmailDispatcher().send_payment_notification(uuid.UUID(payment_id))
    except Exception as e:
        # Falló SMTP. Registramos en EmailQueueLog y dejamos que el
        # decorator @autoretry_for lo reencole. En el último retry
        # (cuando self.request.retries == max_retries) se persiste el
        # error final con status='FAILED' permanente.
        attempt = self.request.retries + 1
        log.error(
            "send_payment_email_task fallo · payment=%s · attempt=%d · err=%s",
            payment_id, attempt, e,
        )
        _update_queue_log(
            queue_id, status="RETRY" if attempt < self.max_retries else "FAILED",
            retries=attempt, last_error=f"{type(e).__name__}: {e}"[:1000],
            started_at=started_at,
        )
        # Activity log permanente sólo si nos rendimos
        if attempt >= self.max_retries:
            _log_activity_email(
                payment_id=payment_id, action="payment.email_failed",
                metadata={
                    "queue_id":   str(queue_id),
                    "attempts":   attempt,
                    "last_error": f"{type(e).__name__}: {str(e)[:200]}",
                },
            )
        raise  # Celery aplica retry exponencial vía autoretry_for

    # ── Éxito ─────────────────────────────────────────────────
    duration_ms = int((datetime.now(tz=_tz.utc) - started_at).total_seconds() * 1000)
    _update_queue_log(
        queue_id, status="SENT", retries=self.request.retries,
        last_error=None, started_at=started_at, duration_ms=duration_ms,
        notification_id=result.notification_log_id,
    )
    _log_activity_email(
        payment_id=payment_id,
        action="payment.email_sent",
        metadata={
            "queue_id":           str(queue_id),
            "notification_log":   str(result.notification_log_id),
            "recipient":          result.recipient,
            "subject":            result.subject,
            "duration_ms":        duration_ms,
        },
    )
    log.info(
        "send_payment_email_task DONE · payment=%s · subject=%r · duration=%dms",
        payment_id, result.subject, duration_ms,
    )
    return {
        "ok":                 True,
        "payment_id":         payment_id,
        "notification_log_id": str(result.notification_log_id),
        "recipient":          result.recipient,
        "subject":            result.subject,
        "duration_ms":        duration_ms,
    }


# ════════════════════════════════════════════════════════════
# Helpers · EmailQueueLog + finance.activity_log
# ════════════════════════════════════════════════════════════
def _create_queue_log(*, queue_id: uuid.UUID, celery_task_id,
                       payment_id: str, retries: int) -> None:
    try:
        with connection.cursor() as cur:
            cur.execute(
                """
                INSERT INTO notifications.email_queue_log (
                    id, celery_task_id, template_key, recipient_email,
                    status, retries, max_retries, payload,
                    is_active, enqueued_at, started_at,
                    created_at, updated_at
                ) VALUES (
                    %s, %s, 'pago_registrado', 'info@mwt.one',
                    'STARTED', %s, 3, %s::jsonb,
                    TRUE, now(), now(),
                    now(), now()
                )
                """,
                [
                    str(queue_id),
                    str(celery_task_id) if celery_task_id else None,
                    retries,
                    f'{{"payment_id":"{payment_id}"}}',
                ],
            )
    except Exception as e:
        log.warning("Create EmailQueueLog falló: %s", e)


def _update_queue_log(queue_id: uuid.UUID, *, status: str,
                      retries: int, last_error,
                      started_at,
                      duration_ms: int | None = None,
                      notification_id: uuid.UUID | None = None) -> None:
    try:
        with connection.cursor() as cur:
            cur.execute(
                """
                UPDATE notifications.email_queue_log
                   SET status          = %s,
                       retries         = %s,
                       last_error      = %s,
                       finished_at     = now(),
                       duration_ms     = %s,
                       notification_id = COALESCE(%s, notification_id),
                       updated_at      = now()
                 WHERE id = %s
                """,
                [
                    status, retries,
                    last_error[:1000] if last_error else None,
                    duration_ms,
                    str(notification_id) if notification_id else None,
                    str(queue_id),
                ],
            )
    except Exception as e:
        log.warning("Update EmailQueueLog falló: %s", e)


def _log_activity_email(*, payment_id: str, action: str, metadata: dict) -> None:
    """Wrapper sobre finance.ActivityLogger.log() para no acoplar el
    import de finance al top-level (evita ciclos)."""
    try:
        from apps.finance.services import ActivityLogger
        ActivityLogger.log(
            actor_id     = None,
            actor_role   = "system:email_dispatcher",
            action       = action,
            target_id    = uuid.UUID(payment_id),
            target_type  = "payment",
            payload_diff = {},
            metadata     = metadata,
        )
    except Exception as e:
        # Log to stdout pero no propagar — ActivityLog es nice-to-have
        log.warning("ActivityLog (%s) falló: %s", action, e)
