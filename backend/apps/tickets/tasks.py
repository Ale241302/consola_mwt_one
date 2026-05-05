"""
=====================================================================
MWT.ONE · apps.tickets.tasks
Agente responsable: [AG-02 · AG-BACKEND]

Side-effects post-creacion / mensaje / cambio de estado de ticket.

Decision (sprint 2026-05-05): se eliminan los .delay() a Celery porque
el docker-compose de este proyecto NO levanta worker; las tasks queda-
ban encoladas y nunca se procesaban. Hasta que haya worker corriendo,
el envio SMTP corre dentro del propio request (latencia ~500ms).

Si en el futuro se agrega un servicio celery-worker, basta con flipear
TICKETS_USE_CELERY=1 en el .env y la funcion enqueue_* hara .delay()
sobre la misma task en lugar del fallback sincrono.

Helpers expuestos:
  - enqueue_new_ticket_emails(ticket_id)
  - enqueue_message_email(ticket_id, message_id)
  - enqueue_status_change_email(ticket_id, old_status, new_status)

Cada uno emite emails a:
  - info@mwt.one    (TICKETS_ADMIN_INBOX)
  - usuario duenio del ticket  (ticket.user_email)
=====================================================================
"""
from __future__ import annotations

import logging
import os
from typing import Dict, Any

from django.conf import settings

from .email_render import render_and_send
from .models import Ticket, TicketMessage

log = logging.getLogger(__name__)


_REASON_LABELS = {
    "MEJORA":      "Mejoras de funcionamiento",
    "BUG":         "Reporte de bug",
    "SOPORTE_OP":  "Soporte operativo",
    "FACTURACION": "Duda de facturacion",
    "OTRO":        "Otro",
}

_STATUS_LABELS = {
    "ABIERTO":     "Abierto",
    "EN_REVISION": "En revision",
    "RESUELTO":    "Resuelto",
    "FINALIZADO":  "Finalizado",
}


def _admin_inbox():
    return getattr(settings, "TICKETS_ADMIN_INBOX", "info@mwt.one")


def _public_url_base():
    base = (
        getattr(settings, "CONSOLA_PUBLIC_URL", None)
        or getattr(settings, "FRONTEND_BASE_URL", None)
        or "https://consola.mwt.one"
    )
    return base.rstrip("/")


def _build_payload(ticket):
    short = str(ticket.id)[:8]
    base  = _public_url_base()
    return {
        "ticket_id":       str(ticket.id),
        "ticket_id_short": short,
        "reason":          ticket.reason,
        "reason_label":    _REASON_LABELS.get(ticket.reason, ticket.reason),
        "status":          ticket.status,
        "status_label":    _STATUS_LABELS.get(ticket.status, ticket.status),
        "description":     ticket.description or "",
        "user_email":      ticket.user_email or "",
        "user_full_name":  ticket.user_full_name or ticket.user_email or "",
        "context_url":     ticket.context_url or "",
        "created_at":      ticket.created_at.isoformat() if ticket.created_at else "",
        "ticket_admin_url": "{}/tickets/{}".format(base, ticket.id),
        "ticket_user_url":  "{}/tickets/{}".format(base, ticket.id),
    }


def _send_pair(template_key, ticket, payload):
    """Manda la MISMA plantilla al admin y al usuario del ticket."""
    admin_to = _admin_inbox()

    res_admin = render_and_send(
        template_key=template_key,
        to=admin_to,
        payload=payload,
        reply_to=ticket.user_email or admin_to,
    )

    res_user = {"ok": False, "to": ticket.user_email, "error": "no_user_email"}
    if ticket.user_email:
        res_user = render_and_send(
            template_key=template_key,
            to=ticket.user_email,
            payload=payload,
            reply_to=admin_to,
        )

    if not res_admin.get("ok"):
        log.warning("ticket email admin failed (%s): %s",
                    template_key, res_admin.get("error"))
    if ticket.user_email and not res_user.get("ok"):
        log.warning("ticket email user failed (%s): %s",
                    template_key, res_user.get("error"))

    return {
        "ok":    bool(res_admin.get("ok")) and bool(
                     res_user.get("ok") if ticket.user_email else True),
        "admin": res_admin,
        "user":  res_user,
    }


# =====================================================================
# Casos de uso
# =====================================================================

def _do_new_ticket(ticket_id):
    try:
        ticket = Ticket.objects.get(pk=ticket_id)
    except Ticket.DoesNotExist:
        log.warning("send_new_ticket_emails: ticket %s no existe", ticket_id)
        return {"ok": False, "error": "ticket_not_found"}
    payload = _build_payload(ticket)
    admin_to = _admin_inbox()

    # Templates DIFERENTES por destino: el admin ve "Nuevo ticket"
    # (ticket_admin_alert), el usuario ve "Hemos recibido tu ticket"
    # (ticket_user_confirmation).
    res_admin = render_and_send(
        template_key="ticket_admin_alert",
        to=admin_to,
        payload=payload,
        reply_to=ticket.user_email or admin_to,
    )
    res_user = {"ok": False, "error": "no_user_email"}
    if ticket.user_email:
        res_user = render_and_send(
            template_key="ticket_user_confirmation",
            to=ticket.user_email,
            payload=payload,
            reply_to=admin_to,
        )

    if not res_admin.get("ok"):
        log.warning("new_ticket admin email failed: %s", res_admin.get("error"))
    if ticket.user_email and not res_user.get("ok"):
        log.warning("new_ticket user email failed: %s", res_user.get("error"))

    return {"ok": True, "admin": res_admin, "user": res_user}


def _do_message(ticket_id, message_id):
    try:
        ticket = Ticket.objects.get(pk=ticket_id)
    except Ticket.DoesNotExist:
        return {"ok": False, "error": "ticket_not_found"}
    try:
        msg = TicketMessage.objects.get(pk=message_id)
    except TicketMessage.DoesNotExist:
        return {"ok": False, "error": "message_not_found"}

    payload = _build_payload(ticket)
    payload.update({
        "message_id":      str(msg.id),
        "message_content": msg.content or "",
        "message_sender":  msg.sender_email or "",
        "message_role":    msg.sender_role or "",
        "message_time":    msg.created_at.isoformat() if msg.created_at else "",
    })
    return _send_pair("ticket_new_message", ticket, payload)


def _do_status_change(ticket_id, old_status, new_status):
    try:
        ticket = Ticket.objects.get(pk=ticket_id)
    except Ticket.DoesNotExist:
        return {"ok": False, "error": "ticket_not_found"}

    payload = _build_payload(ticket)
    payload.update({
        "old_status":       old_status,
        "new_status":       new_status,
        "old_status_label": _STATUS_LABELS.get(old_status, old_status),
        "new_status_label": _STATUS_LABELS.get(new_status, new_status),
    })
    return _send_pair("ticket_status_changed", ticket, payload)


# =====================================================================
# Celery shim — la decoracion @shared_task se mantiene para que cuando
# haya worker en docker-compose simplemente flipeemos TICKETS_USE_CELERY=1.
# =====================================================================
try:
    from celery import shared_task

    @shared_task(name="tickets.send_new_ticket_emails")
    def _t_new_ticket(ticket_id):
        return _do_new_ticket(ticket_id)

    @shared_task(name="tickets.send_message_email")
    def _t_message(ticket_id, message_id):
        return _do_message(ticket_id, message_id)

    @shared_task(name="tickets.send_status_change_email")
    def _t_status(ticket_id, old_status, new_status):
        return _do_status_change(ticket_id, old_status, new_status)

    _CELERY_OK = True
except Exception:  # pragma: no cover
    _CELERY_OK = False


def _use_celery():
    """Solo encola en Celery si el flag explicito esta encendido. Por
    default ejecutamos sincrono para garantizar entrega (no hay worker
    corriendo en el docker-compose actual)."""
    if not _CELERY_OK:
        return False
    flag = (os.environ.get("TICKETS_USE_CELERY", "")
            or getattr(settings, "TICKETS_USE_CELERY", "")
            or "").lower()
    return flag in ("1", "true", "yes")


# ── Public dispatchers (NO lanzan: atrapan todo y loggean) ──────────

def enqueue_new_ticket_emails(ticket_id):
    sid = str(ticket_id)
    if _use_celery():
        try:
            _t_new_ticket.delay(sid)
            return "queued"
        except Exception as e:
            log.warning("Celery enqueue fallo, fallback sincrono: %s", e)
    try:
        _do_new_ticket(sid)
    except Exception as e:
        log.exception("new ticket emails fallaron para %s: %s", sid, e)
    return "sync"


def enqueue_message_email(ticket_id, message_id):
    sid = str(ticket_id); mid = str(message_id)
    if _use_celery():
        try:
            _t_message.delay(sid, mid)
            return "queued"
        except Exception as e:
            log.warning("Celery enqueue fallo, fallback sincrono: %s", e)
    try:
        _do_message(sid, mid)
    except Exception as e:
        log.exception("message email fallo (ticket=%s msg=%s): %s", sid, mid, e)
    return "sync"


def enqueue_status_change_email(ticket_id, old_status, new_status):
    sid = str(ticket_id)
    if _use_celery():
        try:
            _t_status.delay(sid, old_status, new_status)
            return "queued"
        except Exception as e:
            log.warning("Celery enqueue fallo, fallback sincrono: %s", e)
    try:
        _do_status_change(sid, old_status, new_status)
    except Exception as e:
        log.exception("status change email fallo (ticket=%s): %s", sid, e)
    return "sync"


# Compat — antes la task se llamaba `send_new_ticket_emails`. La dejamos
# como alias para que cualquier import existente siga funcionando.
def send_new_ticket_emails(ticket_id):
    return _do_new_ticket(str(ticket_id))
