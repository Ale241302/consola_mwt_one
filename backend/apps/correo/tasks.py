"""
apps.correo · tasks (Celery)
Sincroniza la bandeja (recibidos no leídos + enviados) cada pocos minutos.
No-op si no hay credenciales IMAP configuradas.
"""
from celery import shared_task

from . import services


@shared_task(
    name="correo.sync",
    bind=True,
    queue="default",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=300,
    retry_jitter=True,
    max_retries=3,
    acks_late=True,
)
def correo_sync_task(self):
    return services.sync_mailbox()
