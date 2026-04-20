from rest_framework.routers import DefaultRouter
from .views import TransferenciaViewSet, LineaViewSet, EventoViewSet

router = DefaultRouter()
router.register(r"transferencias",    TransferenciaViewSet, basename="transferencias")
router.register(r"transfer-lineas",   LineaViewSet,         basename="transfer-lineas")
router.register(r"transfer-eventos",  EventoViewSet,        basename="transfer-eventos")
urlpatterns = router.urls
