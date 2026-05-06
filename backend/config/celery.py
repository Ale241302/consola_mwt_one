"""
=====================================================================
MWT.ONE · config.celery
Agente responsable: [AG-BACKEND]

Instancia Celery del proyecto. Auto-descubre los `tasks.py` de cada
app registrada en INSTALLED_APPS.

Uso:
  - Worker (ejecutar tareas en background):
        celery -A config worker -l info -Q ai_analyzer,emails,default

  - Beat (cron — Fase 5 lo activará para fx_rate_refresh / archival):
        celery -A config beat -l info

Queues canónicas:
  · ai_analyzer  — llamadas a Claude (lentas, hasta 30s p95)
  · emails       — envío SMTP/SES, retries exponenciales
  · default      — todo lo demás (tickets emails, jobs ad-hoc)

Si no hay un worker corriendo, los tasks se ejecutan SINCRÓNAMENTE
gracias al fallback en cada `tasks.py`. Esto permite que la API
funcione en dev/local sin levantar el worker, a costa de 1-30s de
latencia extra en el endpoint.
=====================================================================
"""
from __future__ import annotations

import os

from celery import Celery


# Asegura que Celery use el settings de Django incluso cuando se
# invoca desde fuera de manage.py (ej. `celery -A config worker`).
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

app = Celery("consola_mwt_one")

# Lee CELERY_* desde settings.py (broker_url, result_backend, etc.)
app.config_from_object("django.conf:settings", namespace="CELERY")

# Auto-discovery: cada apps/<x>/tasks.py es importado y sus
# @shared_task decorados quedan registrados.
app.autodiscover_tasks()

# Routing por queue — el worker que escucha `-Q ai_analyzer` solo
# toma esos tasks; el resto va a `default`. Lo definimos aquí para
# que cualquier `tasks.py` que use `@shared_task(name="finance.ai_analyzer")`
# sin queue explícita igual termine en la cola correcta.
app.conf.task_routes = {
    "finance.ai_analyzer":              {"queue": "ai_analyzer"},
    "notifications.send_payment_email": {"queue": "emails"},
    # Fase 5A · housekeeping y projectors
    "finance.fx_rate_refresh":          {"queue": "default"},
    "finance.recompute_credit_clock":   {"queue": "default"},
    "tickets.*":                        {"queue": "default"},
}


@app.task(bind=True, ignore_result=True)
def debug_task(self):
    """Útil para verificar que el worker está conectado al broker."""
    print(f"[celery debug_task] request: {self.request!r}")
