"""
apps.finanzas · AppConfig
Sprint 2026-05-24 · Decision CEO (Alejandro)
Agente responsable: [AG-BACKEND]

Modulo Finanzas CEO-ONLY: cruza expedientes + lineas + clientes para
calcular comisiones MWT, margenes y devengo. Solo expone GETs — cero
mutaciones sobre data transaccional (la operativa vive en apps.expedientes,
apps.cobros, apps.finance).
"""
from django.apps import AppConfig


class FinanzasConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.finanzas"
    label = "finanzas"
    verbose_name = "Finanzas (CEO-only)"
