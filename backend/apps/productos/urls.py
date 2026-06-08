from rest_framework.routers import DefaultRouter
from .views import ProductoViewSet, NcmCodeViewSet

router = DefaultRouter()
router.register(r"productos", ProductoViewSet, basename="productos")
router.register(r"ncm", NcmCodeViewSet, basename="ncm")
urlpatterns = router.urls
