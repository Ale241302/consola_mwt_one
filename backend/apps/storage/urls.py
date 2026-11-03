"""MWT.ONE · apps.storage.urls — sólo @actions (sin CRUD)."""
from django.urls import path
from rest_framework.routers import DefaultRouter
from .views import StorageViewSet, StorageDownloadLinkView


router = DefaultRouter()
router.register(r"storage", StorageViewSet, basename="storage")

urlpatterns = [
    # Antes del router: si no, `storage/download-link/` se interpretaría como
    # el detalle `storage/<pk>/` (pk="download-link").
    path("storage/download-link/", StorageDownloadLinkView.as_view(),
         name="storage-download-link"),
] + router.urls
