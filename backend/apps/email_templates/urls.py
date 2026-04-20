from rest_framework.routers import DefaultRouter
from .views import TemplateViewSet, VersionViewSet

router = DefaultRouter()
router.register(r"email-templates",          TemplateViewSet, basename="email-templates")
router.register(r"email-template-versions",  VersionViewSet,  basename="email-template-versions")
urlpatterns = router.urls
