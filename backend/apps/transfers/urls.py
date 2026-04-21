from rest_framework.routers import DefaultRouter
from .views import (
    TransferenciaViewSet, LineaViewSet, EventoViewSet,
    TransferenciaDocumentoViewSet,
)

router = DefaultRouter()
router.register(r"transferencias",       TransferenciaViewSet,          basename="transferencias")
router.register(r"transfer-lineas",      LineaViewSet,                  basename="transfer-lineas")
router.register(r"transfer-eventos",     EventoViewSet,                 basename="transfer-eventos")
router.register(r"transfer-documentos",  TransferenciaDocumentoViewSet, basename="transfer-documentos")
urlpatterns = router.urls
