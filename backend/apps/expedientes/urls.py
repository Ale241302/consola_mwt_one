from rest_framework.routers import DefaultRouter
from .views import (
    OcViewSet, ExpedienteViewSet, LineaViewSet, DocumentoViewSet,
    TransicionCatViewSet, EventLogViewSet, OcrParsingLogViewSet,
)

router = DefaultRouter()
router.register(r"ocs",             OcViewSet,           basename="ocs")
router.register(r"expedientes",     ExpedienteViewSet,   basename="expedientes")
router.register(r"lineas",          LineaViewSet,        basename="lineas")
router.register(r"documentos",      DocumentoViewSet,    basename="documentos")
router.register(r"pipeline-transiciones", TransicionCatViewSet, basename="pipeline-transiciones")
router.register(r"pipeline-events",      EventLogViewSet,       basename="pipeline-events")
router.register(r"ocr-parsing-log",      OcrParsingLogViewSet,  basename="ocr-parsing-log")
urlpatterns = router.urls
