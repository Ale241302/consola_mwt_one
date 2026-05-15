from django.urls import path
from rest_framework.routers import DefaultRouter
from .views import (
    TransferenciaViewSet, LineaViewSet, EventoViewSet,
    TransferenciaDocumentoViewSet,
)
# Sprint 2026-05-14 · Fase 16 — Builder artifacts ligados a una transferencia.
from .views_builder_artifacts import (
    TransferBuilderArtifactsListCreateView,
    TransferBuilderArtifactDetailView,
    TransferBuilderArtifactAvailableLinesView,
    TransferBuilderArtifactExpedientesView,
)

router = DefaultRouter()
router.register(r"transferencias",       TransferenciaViewSet,          basename="transferencias")
router.register(r"transfer-lineas",      LineaViewSet,                  basename="transfer-lineas")
router.register(r"transfer-eventos",     EventoViewSet,                 basename="transfer-eventos")
router.register(r"transfer-documentos",  TransferenciaDocumentoViewSet, basename="transfer-documentos")

urlpatterns = router.urls + [
    # Sprint 2026-05-14 · Fase 16 — Builder artifacts en una transferencia.
    path("transferencias/<uuid:trf_id>/builder-artifacts/",
         TransferBuilderArtifactsListCreateView.as_view(),
         name="trf-artifacts-list"),
    path("transferencias/<uuid:trf_id>/builder-artifacts/available-lines/",
         TransferBuilderArtifactAvailableLinesView.as_view(),
         name="trf-artifacts-available-lines"),
    path("transferencias/<uuid:trf_id>/builder-artifacts/expedientes/",
         TransferBuilderArtifactExpedientesView.as_view(),
         name="trf-artifacts-expedientes"),
    path("transferencias/<uuid:trf_id>/builder-artifacts/<uuid:art_id>/",
         TransferBuilderArtifactDetailView.as_view(),
         name="trf-artifacts-detail"),
]
