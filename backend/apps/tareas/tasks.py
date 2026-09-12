"""
apps.tareas · tasks (Celery)
Genera/actualiza la agenda de tareas automáticas de todos los expedientes.
Es idempotente: no duplica tareas ya vivas (índice único parcial).
"""
from celery import shared_task

from . import services


@shared_task(
    name="tareas.generar_agenda",
    bind=True,
    queue="default",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=300,
    retry_jitter=True,
    max_retries=3,
    acks_late=True,
)
def generar_agenda_task(self):
    return services.generar_global()
