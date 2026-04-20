from rest_framework.routers import DefaultRouter
from .views import StockViewSet, MovimientoViewSet

router = DefaultRouter()
router.register(r"stock",        StockViewSet,       basename="stock")
router.register(r"movimientos",  MovimientoViewSet,  basename="movimientos")
urlpatterns = router.urls
