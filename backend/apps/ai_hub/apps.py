"""
=====================================================================
MWT.ONE · apps.ai_hub.apps
Agente responsable: [AG-BACKEND-API]
=====================================================================
"""
from django.apps import AppConfig


class AiHubConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name  = "apps.ai_hub"
    label = "ai_hub"
    verbose_name = "AI Hub"
