from rest_framework.routers import DefaultRouter
from .views import TemplateViewSet, VersionViewSet, RenderPreviewLogViewSet

router = DefaultRouter()
router.register(r"email-templates",         TemplateViewSet,         basename="email-templates")
router.register(r"email-template-versions", VersionViewSet,          basename="email-template-versions")
router.register(r"email-preview-log",       RenderPreviewLogViewSet, basename="email-preview-log")
urlpatterns = router.urls
