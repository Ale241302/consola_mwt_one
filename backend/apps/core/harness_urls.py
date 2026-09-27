"""MWT.ONE · apps.core.harness_urls — compartición de agentes/skills del harness."""
from rest_framework.routers import DefaultRouter

from .harness_share_views import HarnessShareViewSet

router = DefaultRouter()
router.register(r"shares", HarnessShareViewSet, basename="harness-shares")

urlpatterns = router.urls
