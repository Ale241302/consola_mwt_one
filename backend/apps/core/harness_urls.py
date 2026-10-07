"""MWT.ONE · apps.core.harness_urls — recursos, sesiones y contenido del harness."""
from rest_framework.routers import DefaultRouter

from .harness_share_views import HarnessShareViewSet
from .harness_session_views import HarnessSessionViewSet
from .harness_content_views import HarnessContentViewSet

router = DefaultRouter()
router.register(r"shares", HarnessShareViewSet, basename="harness-shares")
router.register(r"sessions", HarnessSessionViewSet, basename="harness-sessions")
router.register(r"contents", HarnessContentViewSet, basename="harness-contents")

urlpatterns = router.urls
