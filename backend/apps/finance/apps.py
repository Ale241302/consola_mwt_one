from django.apps import AppConfig


class FinanceConfig(AppConfig):
    """
    Módulo finance v2.0 — "Registrar Pago" con validación IA.

    Schema en `backend/sql/B6_finance_v2.sql`. Modelos `managed=False`
    siguiendo la política del repo (DB owned by [AG-DATABASE]).
    """
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.finance"
    label = "finance"
    verbose_name = "Finance · Pagos v2.0"
