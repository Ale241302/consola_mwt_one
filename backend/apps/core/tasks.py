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
from .service_tokens import renew_due


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


@shared_task(
    name="core.renew_service_tokens",
    ignore_result=True,
    acks_late=True,
    max_retries=0,
    soft_time_limit=120,
)
def renew_service_tokens() -> dict:
    """Corre la vigencia de los ServiceToken auto-renovables.

    Red de seguridad independiente del consumidor: aunque el MCP esté caído,
    su token no vence por olvido. El MCP además se renueva solo al arrancar.
    """
    renewed = renew_due()
    return {"renewed": len(renewed), "tokens": [r["name"] for r in renewed]}
