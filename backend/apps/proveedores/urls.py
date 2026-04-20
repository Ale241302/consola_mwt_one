from rest_framework.routers import DefaultRouter
from .views import ProveedorViewSet

router = DefaultRouter()
router.register(r"proveedores", ProveedorViewSet, basename="proveedores")
urlpatterns = router.urls
