from rest_framework.routers import DefaultRouter
from .views import NodoViewSet

router = DefaultRouter()
router.register(r"nodos", NodoViewSet, basename="nodos")

urlpatterns = router.urls
