from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    PaymentViewSet,
    # Sprint Registrar Pago (Fase 1)
    MwtAccountViewSet,
    CounterpartyOpenDebtsViewSet,
)

router = DefaultRouter()
# Prefijo `finance/payments` para no colisionar con `apps.cobros.pagos`
# (que ya registró /api/pagos/ y maneja el modelo legacy de cobros).
router.register(r"finance/payments", PaymentViewSet, basename="finance-payments")

# Sprint Registrar Pago (Fase 1)
router.register(r"finance/mwt-accounts",   MwtAccountViewSet,
                basename="finance-mwt-accounts")
router.register(r"finance/counterparties", CounterpartyOpenDebtsViewSet,
                basename="finance-counterparties")

# Sprint 2026-05-25 - paths manuales para los actions montados por
# monkey-patch en views.py. DefaultRouter NO los detecta porque
# escanea la clase ANTES de que el monkey-patch les asigne los
# attrs. Los registramos manualmente; PaymentViewSet.as_view()
# resuelve el callable en cada request (no en el scan).
# Estos paths VAN ANTES de router.urls para que tomen precedencia
# sobre el detail route generico /payments/<pk>/ que capturaria
# 'select_rejection_reasons' como un UUID falso (causando 500).
monkey_payment_paths = [
    # detail=False (collection-level)
    path("finance/payments/dry-run/",
         PaymentViewSet.as_view({"post": "dry_run"}),
         name="finance-payment-dry-run"),
    path("finance/payments/analyze-evidence/",
         PaymentViewSet.as_view({"post": "analyze_evidence"}),
         name="finance-payment-analyze-evidence"),
    path("finance/payments/select_rejection_reasons/",
         PaymentViewSet.as_view({"get": "select_rejection_reasons"}),
         name="finance-payment-select-rejection-reasons"),
    path("finance/payments/select_counterparty_types/",
         PaymentViewSet.as_view({"get": "select_counterparty_types"}),
         name="finance-payment-select-counterparty-types"),
    # detail=True (item-level)
    path("finance/payments/<uuid:pk>/reconcile/",
         PaymentViewSet.as_view({"patch": "reconcile"}),
         name="finance-payment-reconcile"),
    path("finance/payments/<uuid:pk>/release-credit/",
         PaymentViewSet.as_view({"patch": "release_credit"}),
         name="finance-payment-release-credit"),
    path("finance/payments/<uuid:pk>/reject/",
         PaymentViewSet.as_view({"patch": "reject"}),
         name="finance-payment-reject"),
    path("finance/payments/<uuid:pk>/delete/",
         PaymentViewSet.as_view({"delete": "delete_payment"}),
         name="finance-payment-delete"),
]

urlpatterns = monkey_payment_paths + list(router.urls)
