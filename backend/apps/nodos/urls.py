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
]
