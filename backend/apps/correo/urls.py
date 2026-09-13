from rest_framework.routers import DefaultRouter

from .views import (ContactoViewSet, EnvioViewSet, EstiloViewSet, ExtraccionViewSet,
                    GrupoViewSet, MensajeViewSet)

router = DefaultRouter()
router.register(r"correo/mensajes", MensajeViewSet, basename="correo-mensajes")
router.register(r"correo/extracciones", ExtraccionViewSet, basename="correo-extracciones")
router.register(r"correo/contactos", ContactoViewSet, basename="correo-contactos")
router.register(r"correo/grupos", GrupoViewSet, basename="correo-grupos")
router.register(r"correo/estilos", EstiloViewSet, basename="correo-estilos")
router.register(r"correo/envios", EnvioViewSet, basename="correo-envios")

urlpatterns = router.urls
