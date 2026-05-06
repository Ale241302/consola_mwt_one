# Importamos la app Celery aquí para que esté disponible cuando
# Django arranque (settings.AUTODISCOVER_TASKS espera encontrarla
# en config.celery.app).
from .celery import app as celery_app  # noqa: F401

__all__ = ("celery_app",)
