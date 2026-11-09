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
import hashlib
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

# Alerta de auto-cierre bloqueado (A1): el tope venció pero no hay pago, así
# que el expediente NO se cierra. Se avisa por campana y por email una vez
# al día con la lista completa.
TRIGGER_AUTO_CLOSE_BLOCKED = "expediente.tope_sin_pago"


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
    template_key: str = TEMPLATE_KEY,
    trigger: str = TRIGGER_KEY,
):
    """Auditoría de envío en notifications.notification_log."""
    try:
        NotificationLog.objects.create(
            id=uuid.uuid4(),
            ts=datetime.now(tz=_tz.utc),
            completed_at=datetime.now(tz=_tz.utc) if status == "Sent" else None,
            expediente_id=expediente_id,
            template_key=template_key,
            recipient_email=recipient,
            subject=subject,
            body_preview=(body_preview or "")[:500],
            trigger=trigger,
            status=status,
            idempotence_token=token,
            error=(error or "")[:512] if error else None,
        )
    except Exception as e:
        log.warning("NotificationLog falló para exp=%s: %s", expediente_id, e)


def _admin_recipients() -> List[Tuple[uuid.UUID, str]]:
    """Solo admins fijos: la alerta de tope sin pago es interna, no del cliente."""
    recipients: List[Tuple[uuid.UUID, str]] = []
    seen = set()
    for user in MwtUser.objects.filter(is_active=True, email_plain__in=ADMIN_EMAILS):
        email = user.contact_email or user.email_plain
        if email and email not in seen:
            recipients.append((user.id, email))
            seen.add(email)
    return recipients


def _resumen_tope_sin_pago(bloqueados: List[dict]) -> Tuple[str, str]:
    """Asunto y cuerpo de la alerta. Puro: se puede testear sin base."""
    from apps.expedientes.views import AUTO_CLOSE_DAYS

    total = len(bloqueados)
    plural = "expedientes" if total != 1 else "expediente"
    asunto = (
        f"[MWT] {total} {plural} con tope de {AUTO_CLOSE_DAYS} días vencido "
        f"y sin pago confirmado"
    )
    lineas = [
        f"Hay {total} {plural} EN DESTINO con el tope de {AUTO_CLOSE_DAYS} días",
        "vencido y SIN pago confirmado. El auto-cierre NO se aplicó (ajuste A1):",
        "un expediente no se cierra sin pago registrado.",
        "",
        "Qué hacer con cada uno:",
        "  · Si el pago existe, registrarlo (pago_registrar) y conciliarlo.",
        "  · Si no corresponde cerrar, corregir las fechas por etapa.",
        "",
        "Detalle:",
    ]
    for item in bloqueados:
        lineas.append(
            f"  • {item.get('codigo', '?')} · OC {item.get('oc', '—')} · "
            f"{item.get('cliente', 'Cliente')} · tope {item.get('fecha_tope', '?')} · "
            f"{item.get('motivo', 'sin pago confirmado')}"
        )
    lineas += [
        "",
        "Consola: https://consola.mwt.one/expedientes",
    ]
    return asunto, "\n".join(lineas)


def _alertar_tope_sin_pago(bloqueados: List[dict], hoy: date) -> dict:
    """Campana + email con los expedientes trabados por el tope sin pago.

    Un solo correo por día con la lista completa (no uno por expediente) y
    token de idempotencia por fecha: re-ejecutar la tarea no vuelve a avisar.
    """
    if not bloqueados:
        return {"ok": True, "enviados": 0}

    # `notifications.notification_log` tiene un índice único por
    # `idempotence_token` (uq_nlog_idempotence_active), así que el token va por
    # destinatario y no global. La decisión de "ya se avisó hoy" se toma por
    # trigger + fecha.
    prefijo_token = f"tope_sin_pago:{hoy.isoformat()}"
    if NotificationLog.objects.filter(
        trigger=TRIGGER_AUTO_CLOSE_BLOCKED, ts__date=hoy
    ).exclude(status="Skipped").exists():
        log.info("Alerta de tope sin pago ya enviada hoy (%s)", hoy)
        return {"ok": True, "enviados": 0, "omitida": "ya_enviada"}

    asunto, cuerpo = _resumen_tope_sin_pago(bloqueados)
    html_cuerpo = "<p>" + cuerpo.replace("\n", "<br>") + "</p>"
    titulo_campana = f"{len(bloqueados)} expediente(s) con tope vencido sin pago"

    destinatarios = _admin_recipients()
    if not destinatarios:
        log.warning("Alerta de tope sin pago sin destinatarios admin")
        _create_notification_log(
            expediente_id=None,
            recipient=None,
            subject=asunto,
            body_preview=cuerpo[:200],
            status="Skipped",
            token=prefijo_token,
            error="no_recipients",
            template_key=TRIGGER_AUTO_CLOSE_BLOCKED,
            trigger=TRIGGER_AUTO_CLOSE_BLOCKED,
        )
        return {"ok": True, "enviados": 0, "omitida": "sin_destinatarios"}

    enviados = 0
    for user_id, email in destinatarios:
        token = f"{prefijo_token}:{hashlib.sha1(email.lower().encode()).hexdigest()[:8]}"
        # Campana (visible en la consola sin abrir el correo).
        try:
            ActivityFeed.objects.create(
                id=uuid.uuid4(),
                user_id=user_id,
                kind=TRIGGER_AUTO_CLOSE_BLOCKED,
                title=titulo_campana[:160],
                body=cuerpo[:2000],
                severity="WARNING",
                icon="alert-triangle",
                deep_link=_consola_url_base() + "/expedientes",
                related_type="expediente",
                related_id=None,
            )
        except Exception as e:
            log.warning("ActivityFeed tope sin pago falló user=%s: %s", user_id, e)

        try:
            result = send_test_email(
                to=email,
                subject=asunto,
                body=cuerpo,
                html_body=html_cuerpo,
                reply_to=SUPPORT_EMAIL,
            )
            status = "Sent" if result.get("ok") else "Failed"
            error = result.get("error")
        except Exception as e:  # noqa: BLE001
            status = "Failed"
            error = f"{type(e).__name__}: {e}"
            log.exception("Email tope sin pago falló · to=%s", email)

        _create_notification_log(
            expediente_id=None,
            recipient=email,
            subject=asunto,
            body_preview=cuerpo[:200],
            status=status,
            token=token,
            error=error,
            template_key=TRIGGER_AUTO_CLOSE_BLOCKED,
            trigger=TRIGGER_AUTO_CLOSE_BLOCKED,
        )
        enviados += 1

    log.warning(
        "Alerta tope sin pago enviada · expedientes=%d · destinatarios=%d",
        len(bloqueados), enviados,
    )
    return {"ok": True, "enviados": enviados}


def _consola_url_base() -> str:
    return getattr(settings, "CONSOLA_BASE_URL", "https://consola.mwt.one")


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
    bloqueados: List[dict] = []

    for exp in list(qs):
        try:
            # A1 · el cierre a los 120 días ya no es efecto de una lectura y
            # exige pago registrado. Si el tope venció sin pago, el expediente
            # sigue EN_DESTINO y entra en la alerta visible del final.
            from apps.expedientes.views import check_auto_close_en_destino
            proposal = check_auto_close_en_destino(exp, allow_write=True)
            if proposal.get("aplicado"):
                log.info(
                    "Expediente auto-cerrado tras %sd con pago · exp=%s · fecha=%s",
                    proposal.get("dias_tope"), exp.codigo, proposal.get("fecha_cierre"),
                )
                continue
            if proposal.get("aplica"):
                bloqueados.append({
                    "codigo": exp.codigo,
                    "oc": _load_oc_codigo(exp),
                    "cliente": _load_cliente_nombre(exp.client_id),
                    "fecha_tope": proposal.get("fecha_cierre"),
                    "motivo": "sin pago confirmado"
                    if proposal.get("bloqueado") == "sin_pago_registrado"
                    else (proposal.get("bloqueado") or "tope vencido"),
                })
                log.warning(
                    "Auto-cierre NO aplicado · exp=%s · motivo=%s · fecha_tope=%s",
                    exp.codigo, proposal.get("bloqueado"), proposal.get("fecha_cierre"),
                )
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

    # A1 · alerta VISIBLE (campana + email) de los trabados por el tope.
    alerta_tope = None
    if bloqueados:
        try:
            alerta_tope = _alertar_tope_sin_pago(bloqueados, today)
        except Exception as e:  # noqa: BLE001 — la alerta no rompe la tarea
            log.exception("Alerta de tope sin pago falló: %s", e)
            alerta_tope = {"ok": False, "error": str(e)}

    log.info(
        "check_en_destino_eta DONE · alertas=%d · tope_sin_pago=%d",
        alertas, len(bloqueados),
    )
    return {"ok": True, "alertas": alertas, "tope_sin_pago": alerta_tope}
