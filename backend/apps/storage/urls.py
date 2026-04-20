"""MWT.ONE · apps.storage.urls — sólo @actions (sin CRUD)."""
from rest_framework.routers import DefaultRouter
from .views import StorageViewSet


router = DefaultRouter()
router.register(r"storage", StorageViewSet, basename="storage")

urlpatterns = router.urls
