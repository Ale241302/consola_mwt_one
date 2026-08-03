"""
=====================================================================
MWT.ONE · apps.expedientes.tasks
Sprint 2026-07-30 · Alerta de fecha destino alcanzada (EN_DESTINO).

Task diario que detecta expedientes en estado EN_DESTINO cuya fecha de
fin de fase (phase_durations_json.EN_DESTINO.end) ya llegó o venció.
Para cada uno:
  1. Crea notificación in-app (users.activity_feed) para admins fijos
     y usuarios asociados al cliente del expediente.
  2. Envía email a los mismos destinatarios.
  3. Registra auditoría en notifications.notification_log con token de
     idempotencia por (expediente, fecha fin) para no spamear.

Registro en CELERY_BEAT_SCHEDULE:
  "check_en_destino_eta": {
      "task": "expedientes.check_en_destino_eta",
      "schedule": crontab(hour=7, minute=0),
      "options": {"queue": "default", "expires": 3600},
  }
=====================================================================
"""
from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timezone as _tz
from typing import List, Optional, Tuple

from celery import shared_task
from django.conf import settings
from django.template.loader import render_to_string

from apps.expedientes.models import Expediente, Oc
from apps.notifications.models import NotificationLog
from apps.storage.services import send_test_email
from apps.users.models import ActivityFeed, MwtUser

log = logging.getLogger(__name__)

# Destinatarios admin siempre incluidos en alertas operativas.
ADMIN_EMAILS = ["alvaro@muitowork.com", "alejandro@muitowork.com"]
SUPPORT_EMAIL = getattr(settings, "SUPPORT_EMAIL", "soporte@mwt.one")
TEMPLATE_KEY = "en_destino_eta"
TRIGGER_KEY = "expediente.en_destino_eta"


def _parse_date(value) -> Optional[date]:
    """Convierte string/date/datetime a date."""
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, str):
        try:
            return date.fromisoformat(value)
        except ValueError:
            return None
    return None


def _resolve_end_date(exp: Expediente) -> Optional[date]:
    """Fecha fin preferente: phase_durations_json.EN_DESTINO.end, fallback ETA."""
    pd = exp.phase_durations_json or {}
    en_destino = pd.get("EN_DESTINO") or {}
    end = _parse_date(en_destino.get("end"))
    if end:
        return end
    return _parse_date(exp.eta)


def _load_oc_codigo(exp: Expediente) -> str:
    try:
        oc = Oc.objects.filter(pk=exp.oc_id).first()
        return oc.codigo if oc else "—"
    except Exception:
        return "—"


def _load_cliente_nombre(client_id) -> str:
    try:
        from apps.clientes.models import Cliente
        c = Cliente.objects.filter(pk=client_id).first()
        if c:
            return c.nombre_comercial or c.razon_social or "Cliente"
    except Exception:
        pass
    return "Cliente"


def _consola_url(exp: Expediente) -> str:
    base = getattr(settings, "CONSOLA_BASE_URL", "https://consola.mwt.one")
    return f"{base}/expedientes/{exp.oc_id}/exp/{exp.id}"


def _resolve_recipients(exp: Expediente) -> List[Tuple[uuid.UUID, str]]:
    """Devuelve (user_id, email) para admins + usuarios del cliente."""
    recipients: List[Tuple[uuid.UUID, str]] = []
    seen = set()

    # 1) Admins fijos por email
    for user in MwtUser.objects.filter(is_active=True, email_plain__in=ADMIN_EMAILS):
        email = user.contact_email or user.email_plain
        if email and email not in seen:
            recipients.append((user.id, email))
            seen.add(email)

    # 2) Usuarios asociados al cliente (legal_entity_ids contiene client_id)
    if exp.client_id:
        client_id_str = str(exp.client_id)
        client_qs = MwtUser.objects.filter(
            is_active=True,
            legal_entity_ids__contains=[client_id_str],
        ).exclude(email_plain__in=ADMIN_EMAILS)
        for user in client_qs:
            email = user.contact_email or user.email_plain
            if email and email not in seen:
                recipients.append((user.id, email))
                seen.add(email)

    return recipients


def _create_activity_feed(user_id: uuid.UUID, exp: Expediente, end_date: date, oc_codigo: str):
    """Notificación in-app (campana) para un destinatario."""
    try:
        ActivityFeed.objects.create(
            id=uuid.uuid4(),
            user_id=user_id,
            kind=TRIGGER_KEY,
            title=f"Expediente {exp.codigo} llegó a fecha destino",
            body=(
                f"La OC {oc_codigo} del expediente {exp.codigo} tiene fecha "
                f"de destino {end_date.isoformat()}. Revisa el siguiente paso."
            ),
            severity="WARNING",
            icon="clock",
            deep_link=_consola_url(exp),
            related_type="expediente",
            related_id=exp.id,
        )
    except Exception as e:
        log.warning("ActivityFeed falló para user=%s exp=%s: %s", user_id, exp.codigo, e)


def _create_notification_log(
    *,
    expediente_id: uuid.UUID,
    recipient: Optional[str],
    subject: str,
    body_preview: str,
    status: str = "Sent",
    token: Optional[str] = None,
    error: Optional[str] = None,
):
    """Auditoría de envío en notifications.notification_log."""
    try:
        NotificationLog.objects.create(
            id=uuid.uuid4(),
            ts=datetime.now(tz=_tz.utc),
            completed_at=datetime.now(tz=_tz.utc) if status == "Sent" else None,
            expediente_id=expediente_id,
            template_key=TEMPLATE_KEY,
            recipient_email=recipient,
            subject=subject,
            body_preview=(body_preview or "")[:500],
            trigger=TRIGGER_KEY,
            status=status,
            idempotence_token=token,
            error=(error or "")[:512] if error else None,
        )
    except Exception as e:
        log.warning("NotificationLog falló para exp=%s: %s", expediente_id, e)


@shared_task(
    name="expedientes.check_en_destino_eta",
    bind=True,
    queue="default",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=300,
    retry_jitter=True,
    max_retries=3,
    acks_late=True,
)
def check_en_destino_eta_task(self):
    """
    Diariamente revisa expedientes EN_DESTINO cuya fecha fin sea EXACTAMENTE
    hoy. No alerta fechas pasadas ni futuras: solo el día que se cumple.
    """
    today = date.today()
    log.info("check_en_destino_eta START · today=%s", today)

    qs = Expediente.objects.filter(estado="EN_DESTINO", is_active=True)
    alertas = 0

    for exp in list(qs):
        try:
            from apps.expedientes.views import check_auto_close_en_destino
            if check_auto_close_en_destino(exp):
                log.info("Expediente auto-cerrado tras 120d · exp=%s", exp.codigo)
                continue
        except Exception as exc:
            log.warning("check_auto_close_en_destino failed for exp %s: %s", exp.codigo, exc)

        end_date = _resolve_end_date(exp)
        if end_date != today:
            continue

        alertas += 1
        token = f"{TRIGGER_KEY}:{exp.id}:{end_date.isoformat()}"

        # Idempotencia: una alerta por expediente + fecha fin.
        if NotificationLog.objects.filter(idempotence_token=token).exists():
            log.info("Alerta ya enviada · exp=%s end=%s", exp.codigo, end_date)
            continue

        oc_codigo = _load_oc_codigo(exp)
        cliente_nombre = _load_cliente_nombre(exp.client_id)
        context = {
            "expediente": exp,
            "oc_codigo": oc_codigo,
            "end_date": end_date.isoformat(),
            "cliente_nombre": cliente_nombre,
            "consola_url": _consola_url(exp),
            "support_email": SUPPORT_EMAIL,
            "year": today.year,
        }

        html_body = render_to_string("emails/en_destino_eta.html", context)
        try:
            text_body = render_to_string("emails/en_destino_eta.txt", context)
        except Exception:
            text_body = (
                f"El expediente {exp.codigo} llegó a su fecha destino ({end_date}). "
                f"Ver: {_consola_url(exp)}"
            )

        subject = f"[MWT] {exp.codigo} · llegó a fecha destino · OC {oc_codigo}"
        recipients = _resolve_recipients(exp)

        if not recipients:
            log.warning("Sin destinatarios · exp=%s", exp.codigo)
            _create_notification_log(
                expediente_id=exp.id,
                recipient=None,
                subject=subject,
                body_preview="Sin destinatarios resueltos",
                status="Skipped",
                token=token,
                error="no_recipients",
            )
            continue

        for user_id, email in recipients:
            _create_activity_feed(user_id, exp, end_date, oc_codigo)

            try:
                result = send_test_email(
                    to=email,
                    subject=subject,
                    body=text_body,
                    html_body=html_body,
                    reply_to=SUPPORT_EMAIL,
                )
                ok = result.get("ok")
                error = result.get("error")
                status = "Sent" if ok else "Failed"
            except Exception as e:
                status = "Failed"
                error = f"{type(e).__name__}: {e}"
                log.exception("Email falló · exp=%s to=%s", exp.codigo, email)

            _create_notification_log(
                expediente_id=exp.id,
                recipient=email,
                subject=subject,
                body_preview=text_body[:200],
                status=status,
                token=token,
                error=error,
            )

    log.info("check_en_destino_eta DONE · alertas=%d", alertas)
    return {"ok": True, "alertas": alertas}
