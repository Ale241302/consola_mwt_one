from rest_framework.routers import DefaultRouter
from .views import MarcaViewSet

router = DefaultRouter()
router.register(r"marcas", MarcaViewSet, basename="marcas")
urlpatterns = router.urls
