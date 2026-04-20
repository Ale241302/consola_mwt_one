from rest_framework.routers import DefaultRouter
from .views import ProductoViewSet

router = DefaultRouter()
router.register(r"productos", ProductoViewSet, basename="productos")
urlpatterns = router.urls
