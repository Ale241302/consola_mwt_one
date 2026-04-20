from rest_framework.routers import DefaultRouter
from .views import CobroViewSet, PagoViewSet, ConciliacionViewSet

router = DefaultRouter()
router.register(r"cobros",         CobroViewSet,        basename="cobros")
router.register(r"pagos",          PagoViewSet,         basename="pagos")
router.register(r"conciliaciones", ConciliacionViewSet, basename="conciliaciones")
urlpatterns = router.urls
