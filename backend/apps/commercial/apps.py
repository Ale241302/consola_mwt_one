"""
=====================================================================
MWT.ONE · apps.commercial.apps
Agente responsable: [AG-BACKEND]

App que expone la capa comercial del Módulo de Marcas:
  · pricing.pricelist_version / pricing.grade_item / pricing.client_assignment
  · commercial.early_payment_policy / early_payment_tier / commission_rule
  · Endpoint crítico: POST /api/commercial/resolve_client_price/
=====================================================================
"""
from django.apps import AppConfig


class CommercialConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name  = "apps.commercial"
    label = "commercial"
    verbose_name = "Commercial — Pricing + Early Payment + Commissions"
