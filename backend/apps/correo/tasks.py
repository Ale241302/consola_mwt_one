"""
apps.correo · tasks (Celery)
Sincroniza la bandeja (recibidos no leídos + enviados) cada pocos minutos.
No-op si no hay credenciales IMAP configuradas.
"""
from celery import shared_task

from django.db import connection

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


@shared_task(
    name="correo.extraer_pendientes",
    bind=True,
    queue="default",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=300,
    retry_jitter=True,
    max_retries=3,
    acks_late=True,
)
def correo_extraer_pendientes_task(self):
    """Etapa 4 · extrae fechas de los mensajes correlacionados sin extracción."""
    from . import extraccion as ex_svc
    with connection.cursor() as c:
        c.execute("""
            SELECT m.id::text, m.expediente_id::text, m.body_text
              FROM correo.mensaje m
             WHERE m.is_active AND m.expediente_id IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM correo.extraccion e WHERE e.mensaje_id = m.id)
             ORDER BY m.created_at DESC
             LIMIT 200
        """)
        rows = c.fetchall()
    n = 0
    for mid, eid, body in rows:
        n += len(ex_svc.crear_propuestas(mid, eid, body or "", fuente="SYNC"))
    return {"extraidas": n}
