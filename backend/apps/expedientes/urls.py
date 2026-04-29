from django.urls import path
from rest_framework.routers import DefaultRouter
from .views import (
    OcViewSet, ExpedienteViewSet, LineaViewSet, DocumentoViewSet,
    TransicionCatViewSet, EventLogViewSet, OcrParsingLogViewSet,
)
from .views_wizard import create_from_oc
from .views_simplified_wizard import (
    ParseTemplateView, CatalogRequestAssignmentView,
)

router = DefaultRouter()
router.register(r"ocs",             OcViewSet,           basename="ocs")
router.register(r"expedientes",     ExpedienteViewSet,   basename="expedientes")
router.register(r"lineas",          LineaViewSet,        basename="lineas")
router.register(r"documentos",      DocumentoViewSet,    basename="documentos")
router.register(r"pipeline-transiciones", TransicionCatViewSet, basename="pipeline-transiciones")
router.register(r"pipeline-events",      EventLogViewSet,       basename="pipeline-events")
router.register(r"ocr-parsing-log",      OcrParsingLogViewSet,  basename="ocr-parsing-log")

urlpatterns = router.urls + [
    # Orchestrator atómico del Wizard de Creación de Expedientes
    # Reglas B2B (ver apps/expedientes/views_wizard.py): si role=CLIENT,
    # client_id se fuerza al del JWT (ignora payload), y mode/freight/transport
    # se setean a NULL para esperar review del CEO.
    path("expedientes/create-from-oc/", create_from_oc, name="expedientes-create-from-oc"),
    # Sprint Wizard Simplificado (2026-04-29)
    path("expedientes/parse-template/", ParseTemplateView.as_view(),
         name="expedientes-parse-template"),
    path("catalog/request-assignment/", CatalogRequestAssignmentView.as_view(),
         name="catalog-request-assignment"),
]
