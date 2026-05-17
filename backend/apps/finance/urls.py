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

urlpatterns = router.urls
