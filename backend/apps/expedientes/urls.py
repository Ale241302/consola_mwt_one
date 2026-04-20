from rest_framework.routers import DefaultRouter
from .views import OcViewSet, ExpedienteViewSet, LineaViewSet, DocumentoViewSet

router = DefaultRouter()
router.register(r"ocs",         OcViewSet,         basename="ocs")
router.register(r"expedientes", ExpedienteViewSet, basename="expedientes")
router.register(r"lineas",      LineaViewSet,      basename="lineas")
router.register(r"documentos",  DocumentoViewSet,  basename="documentos")
urlpatterns = router.urls
