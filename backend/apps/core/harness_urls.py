"""MWT.ONE · apps.core.harness_urls — compartición de recursos y sesiones del harness."""
from rest_framework.routers import DefaultRouter

from .harness_share_views import HarnessShareViewSet
from .harness_session_views import HarnessSessionViewSet

router = DefaultRouter()
router.register(r"shares", HarnessShareViewSet, basename="harness-shares")
router.register(r"sessions", HarnessSessionViewSet, basename="harness-sessions")

urlpatterns = router.urls
