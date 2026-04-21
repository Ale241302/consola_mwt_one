from rest_framework.routers import DefaultRouter
from .views import (
    CobroViewSet, PagoViewSet, ConciliacionViewSet,
    VencimientoViewSet, WithholdingLogViewSet,
    FxRateHistoryViewSet, CollectionEventViewSet,
)

router = DefaultRouter()
router.register(r"cobros",             CobroViewSet,           basename="cobros")
router.register(r"pagos",              PagoViewSet,            basename="pagos")
router.register(r"conciliaciones",     ConciliacionViewSet,    basename="conciliaciones")
router.register(r"vencimientos",       VencimientoViewSet,     basename="vencimientos")
router.register(r"withholding-log",    WithholdingLogViewSet,  basename="withholding-log")
router.register(r"fx-rate-history",    FxRateHistoryViewSet,   basename="fx-rate-history")
router.register(r"collection-events",  CollectionEventViewSet, basename="collection-events")
urlpatterns = router.urls
