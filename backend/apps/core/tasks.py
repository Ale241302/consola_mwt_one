"""
=====================================================================
MWT.ONE · apps.core.tasks — tareas Celery del núcleo.

Fase 1 · Onboarding MCP por correo: poller del buzón mcp@mwt.one.
Programado en CELERY_BEAT_SCHEDULE (settings) cada 2 minutos.
Si MCP_MAILBOX_USER/PASSWORD no están configurados, el task sale sin hacer
nada (poll_once devuelve {"skipped": True}).
=====================================================================
"""
from __future__ import annotations

from celery import shared_task

from .mcp_mailbox import poll_once


@shared_task(
    name="core.mcp_poll_inbox",
    ignore_result=True,
    acks_late=True,
    max_retries=0,
    soft_time_limit=240,
)
def mcp_poll_inbox() -> dict:
    """Procesa los correos nuevos de mcp@mwt.one y responde con credenciales."""
    return poll_once()
