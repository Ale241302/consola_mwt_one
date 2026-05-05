"""
=====================================================================
MWT.ONE · apps.tickets.tasks
Agente responsable: [AG-02 · AG-BACKEND]

Side-effects post-creacion de ticket. Usa Celery si esta disponible
(@shared_task) y sino cae a ejecucion sincrona en el mismo request
(no rompe el flujo si el worker no corre todavia).

Helpers:
  · enqueue_new_ticket_emails(ticket_id) -> dispatcher unico
  · _build_payload(ticket)               -> dict para Jinja2

Las dos plantillas se mandan en paralelo:
  · info@mwt.one   ← ticket_admin_alert
  · usuario       ← ticket_user_confirmation
=====================================================================
"""
from __future__ import annotations

import logging
from typing import Dict, Any

from django.conf import settings

from .email_render import render_and_send
from .models import Ticket

log = logging.getLogger(__name__)


def _build_payload(ticket: Ticket) -> Dict[str, Any]:
    short = str(ticket.id)[:8]
    base  = (
        getattr(settings, "CONSOLA_PUBLIC_URL", None)
        or getattr(settings, "FRONTEND_BASE_URL", None)
        or "https://consola.mwt.one"
    ).rstrip("/")
    reason_label_map = {
        "MEJORA":      "Mejoras de funcionamiento",
        "BUG":         "Reporte de bug",
        "SOPORTE_OP":  "Soporte operativo",
        "FACTURACION": "Duda de facturacion",
        "OTRO":        "Otro",
    }
    return {
        "ticket_id":       str(ticket.id),
        "ticket_id_short": short,
        "reason":          ticket.reason,
        "reason_label":    reason_label_map.get(ticket.reason, ticket.reason),
        "description":     ticket.description or "",
        "user_email":      ticket.user_email or "",
        "user_full_name":  ticket.user_full_name or ticket.user_email or "",
        "context_url":     ticket.context_url or "",
        "created_at":      ticket.created_at.isoformat() if ticket.created_at else "",
        "ticket_admin_url": f"{base}/tickets-admin/{ticket.id}",
        "ticket_user_url":  f"{base}/tickets/{ticket.id}",
    }


def _send_both(ticket_id: str) -> Dict[str, Any]:
    try:
        ticket = Ticket.objects.get(pk=ticket_id)
    except Ticket.DoesNotExist:
        log.warning("send_ticket_emails: ticket %s no existe", ticket_id)
        return {"ok": False, "error": "ticket_not_found"}

    payload = _build_payload(ticket)

    # 1) Alerta interna a info@mwt.one
    admin_to = getattr(settings, "TICKETS_ADMIN_INBOX", "info@mwt.one")
    res_admin = render_and_send(
        template_key="ticket_admin_alert",
        to=admin_to,
        payload=payload,
        reply_to=ticket.user_email,
    )

    # 2) Confirmacion al usuario
    res_user = {"ok": False, "error": "no_user_email"}
    if ticket.user_email:
        res_user = render_and_send(
            template_key="ticket_user_confirmation",
            to=ticket.user_email,
            payload=payload,
            reply_to=admin_to,
        )

    return {"ok": bool(res_admin.get("ok") and res_user.get("ok")),
            "admin": res_admin, "user": res_user}


# ── Celery shim ───────────────────────────────────────────────
# Si Celery esta instalado y configurado, exponemos la funcion
# como @shared_task. Si no, la dejamos como funcion plana y
# enqueue_new_ticket_emails() la ejecuta sincronamente.
try:
    from celery import shared_task

    @shared_task(name="tickets.send_new_ticket_emails")
    def send_new_ticket_emails(ticket_id: str) -> Dict[str, Any]:
        return _send_both(ticket_id)

    _CELERY_AVAILABLE = True
except Exception:  # pragma: no cover - celery no instalado / config rota
    _CELERY_AVAILABLE = False

    def send_new_ticket_emails(ticket_id: str) -> Dict[str, Any]:
        return _send_both(ticket_id)


def enqueue_new_ticket_emails(ticket_id: str) -> str:
    """
    Encola el envio de los 2 emails (interno + usuario). Si el broker
    Celery no esta disponible, ejecuta sincrono y devuelve "sync".
    """
    sid = str(ticket_id)
    if _CELERY_AVAILABLE:
        try:
            send_new_ticket_emails.delay(sid)
            return "queued"
        except Exception as e:
            log.warning("Celery no disponible, fallback sincrono: %s", e)
    try:
        _send_both(sid)
    except Exception as e:
        log.exception("Fallback sincrono fallo para ticket %s: %s", sid, e)
    return "sync"
