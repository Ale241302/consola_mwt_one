"""
apps.nodos.urls — routers DRF para nodos + artefactos nested.

Sprint 2026-05-11 · Fase 2:
  Se agrega el sub-router `nodos/{nodo_pk}/artifacts/` usando el patrón
  nested estándar de DRF (manual, sin drf-nested-routers para no agregar
  dependencias). Lo montamos como list/detail aparte para evitar acoplar
  el NodoViewSet con un endpoint pesado.
"""
from django.urls import path
from rest_framework.routers import DefaultRouter
from .views import NodoViewSet, NodoArtefactoViewSet
# Sprint 2026-05-11 · Fase 4 — Builder artifacts en nodos.
from .views_builder_artifacts import (
    NodoBuilderArtifactsListCreateView,
    NodoBuilderArtifactDetailView,
    # Sprint 2026-05-11 · Fase 5 — saldo disponible por template +
    # expedientes con líneas pendientes para un template.
    NodoBuilderArtifactAvailableLinesView,
    NodoBuilderArtifactExpedientesView,
)

router = DefaultRouter()
router.register(r"nodos", NodoViewSet, basename="nodos")

# ── Endpoints nested para artefactos ──────────────────────────────
# /api/nodos/{nodo_pk}/artifacts/           (GET list · POST create)
# /api/nodos/{nodo_pk}/artifacts/{pk}/      (GET retrieve · PATCH · DELETE)
artifact_list = NodoArtefactoViewSet.as_view({
    "get":  "list",
    "post": "create",
})
artifact_detail = NodoArtefactoViewSet.as_view({
    "get":    "retrieve",
    "patch":  "partial_update",
    "delete": "destroy",
})

urlpatterns = router.urls + [
    # Legacy (Fase 2) — artefactos simples (URL + metadata). Se mantienen
    # las rutas para compat hacia atrás aunque la UI ya no las use.
    path(
        "nodos/<uuid:nodo_pk>/artifacts/",
        artifact_list,
        name="nodos-artifacts-list",
    ),
    path(
        "nodos/<uuid:nodo_pk>/artifacts/<uuid:pk>/",
        artifact_detail,
        name="nodos-artifacts-detail",
    ),
    # Sprint 2026-05-11 · Fase 4 — Builder artifacts (templates dinámicos
    # desde builder.muito.work, persistidos en nodos.builder_artifact_instance).
    path(
        "nodos/<uuid:nodo_id>/builder-artifacts/",
        NodoBuilderArtifactsListCreateView.as_view(),
        name="nodos-builder-artifacts-list-create",
    ),
    path(
        "nodos/<uuid:nodo_id>/builder-artifacts/<uuid:artifact_id>/",
        NodoBuilderArtifactDetailView.as_view(),
        name="nodos-builder-artifact-detail",
    ),
    # Sprint 2026-05-11 · Fase 5 — endpoints de alcance del artefacto.
    path(
        "nodos/<uuid:nodo_id>/builder-artifacts/available-lines/",
        NodoBuilderArtifactAvailableLinesView.as_view(),
        name="nodos-builder-artifact-available-lines",
    ),
    path(
        "nodos/<uuid:nodo_id>/builder-artifacts/expedientes/",
        NodoBuilderArtifactExpedientesView.as_view(),
        name="nodos-builder-artifact-expedientes",
    ),
]
