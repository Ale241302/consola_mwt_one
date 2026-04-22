"""
=====================================================================
MWT.ONE · apps.sizing.urls
Agente responsable: [AG-BACKEND]

Routes (montadas en /api/ por config/urls.py):
  · /api/sizing/tallas/                  CRUD + clone
  · /api/sizing/tipos-producto/          read-only
  · /api/sizing/sistemas-medida/         read-only
  · /api/sizing/options/                 alimenta selects del FE
=====================================================================
"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    TallaViewSet,
    TipoProductoCatViewSet,
    MedidaSistemaCatViewSet,
    SizingOptionsView,
)


router = DefaultRouter()
router.register(r"sizing/tallas",
                TallaViewSet, basename="sizing-tallas")
router.register(r"sizing/tipos-producto",
                TipoProductoCatViewSet, basename="sizing-tipos-producto")
router.register(r"sizing/sistemas-medida",
                MedidaSistemaCatViewSet, basename="sizing-sistemas-medida")

urlpatterns = [
    path("", include(router.urls)),
    path("sizing/options/", SizingOptionsView.as_view(),
         name="sizing-options"),
]
