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
from .views_matchmaker import (
    UploadMatchView, ResolveMatchView, MatchHistoryView,
)
from .views_builder_artifacts import (
    BuilderArtifactsListCreateView, BuilderArtifactDetailView,
    builder_templates_list, builder_template_detail,
)

router = DefaultRouter()
router.register(r"ocs",             OcViewSet,           basename="ocs")
router.register(r"expedientes",     ExpedienteViewSet,   basename="expedientes")
router.register(r"lineas",          LineaViewSet,        basename="lineas")
router.register(r"documentos",      DocumentoViewSet,    basename="documentos")
router.register(r"pipeline-transiciones", TransicionCatViewSet, basename="pipeline-transiciones")
router.register(r"pipeline-events",      EventLogViewSet,       basename="pipeline-events")
router.register(r"ocr-parsing-log",      OcrParsingLogViewSet,  basename="ocr-parsing-log")

# Sprint 2026-05-03 · ORDEN IMPORTANTE
# Los paths custom van ANTES de router.urls.
# Razón: `expedientes/parse-template/` matchea el pattern
# `expedientes/<pk>/` que el DefaultRouter genera para retrieve(),
# tratando "parse-template" como un pk. Eso provocaba 405 en POSTs.
# Listándolos primero garantizamos que Django los resuelva antes de
# delegar al router.
urlpatterns = [
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

    # Sprint Document Matchmaker (2026-04-29) — IA cross-check de
    # documentos (OC / Proforma / Confirmación SAP) contra líneas del
    # expediente. Genera log auditable en expedientes.document_match_log.
    path("expedientes/<uuid:expediente_id>/upload-match/",
         UploadMatchView.as_view(), name="expedientes-upload-match"),
    path("expedientes/<uuid:expediente_id>/resolve-match/",
         ResolveMatchView.as_view(), name="expedientes-resolve-match"),
    path("expedientes/<uuid:expediente_id>/match-history/",
         MatchHistoryView.as_view(), name="expedientes-match-history"),

    # ── Builder Artifacts (sprint 2026-05-01) ──────────────────
    # Instancias de artefactos cuyas plantillas vienen del Builder
    # externo (https://builder.muito.work). Permite agregar/editar/
    # eliminar instancias por etapa del flujo del expediente.
    #
    # Reglas server-side (no confiar sólo en frontend):
    #   · CLIENT_* → 403 (mismo guard que el resto del CRUD admin)
    #   · stage_index(target) ≤ stage_index(expediente.estado)
    path("expedientes/<uuid:expediente_id>/artifacts/",
         BuilderArtifactsListCreateView.as_view(),
         name="expedientes-builder-artifacts"),
    path("expedientes/<uuid:expediente_id>/artifacts/<uuid:artifact_id>/",
         BuilderArtifactDetailView.as_view(),
         name="expedientes-builder-artifact-detail"),

    # Proxy hacia Builder API (login server-side, token cacheado).
    path("builder/templates/",      builder_templates_list,
         name="builder-templates-list"),
    path("builder/templates/<int:template_id>/", builder_template_detail,
         name="builder-template-detail"),
] + router.urls
