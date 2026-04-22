"""
=====================================================================
MWT.ONE · apps.sizing.apps
Agente responsable: [AG-BACKEND]
Sprint: SIZING ENGINE v1
=====================================================================
"""
from django.apps import AppConfig


class SizingConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.sizing"
    label = "sizing"
    verbose_name = "Sizing Engine — Catálogo maestro de tallas (calzado + plantilla)"
