from rest_framework.routers import DefaultRouter

from .views import PaymentViewSet

router = DefaultRouter()
# Prefijo `finance/payments` para no colisionar con `apps.cobros.pagos`
# (que ya registró /api/pagos/ y maneja el modelo legacy de cobros).
router.register(r"finance/payments", PaymentViewSet, basename="finance-payments")

urlpatterns = router.urls
