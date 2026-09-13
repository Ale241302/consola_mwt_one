"""
apps.tareas · tasks (Celery)
Genera/actualiza la agenda de tareas automáticas de todos los expedientes.
Es idempotente: no duplica tareas ya vivas (índice único parcial).
"""
from celery import shared_task

from . import services
from .models import Tarea, TareaEvento


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


@shared_task(
    name="tareas.revisar_vencidas",
    bind=True,
    queue="default",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=300,
    retry_jitter=True,
    max_retries=3,
    acks_late=True,
)
def revisar_vencidas_task(self):
    """Automatización diaria: marca (evento VENCIDA) las tareas abiertas pasadas
    de fecha. Idempotente: máximo un evento VENCIDA por tarea y por día."""
    from django.utils import timezone

    hoy = timezone.localdate()
    qs = (Tarea.objects.filter(is_active=True, due_date__lt=hoy)
          .exclude(estado__in=["RESUELTA", "CANCELADA"]))
    marcadas = 0
    for t in qs[:1000]:
        ya = TareaEvento.objects.filter(tarea_id=t.id, accion="VENCIDA",
                                        created_at__date=hoy).exists()
        if ya:
            continue
        services.log_evento(t.id, "VENCIDA",
                            {"due_date": t.due_date.isoformat() if t.due_date else None})
        marcadas += 1
    return {"vencidas_marcadas": marcadas, "total_vencidas": qs.count()}
