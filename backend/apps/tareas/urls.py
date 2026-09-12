from rest_framework.routers import DefaultRouter

from .views import TareaCatalogoViewSet, TareaViewSet

router = DefaultRouter()
# El catálogo se registra ANTES que "tareas" para que su ruta no sea
# capturada por el detalle de tarea (pk="catalogo").
router.register(r"tareas/catalogo", TareaCatalogoViewSet, basename="tareas-catalogo")
router.register(r"tareas", TareaViewSet, basename="tareas")

urlpatterns = router.urls
