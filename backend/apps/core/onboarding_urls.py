"""MWT.ONE · apps.core.onboarding_urls — rutas del onboarding MCP (Fase 2)."""
from django.urls import path

from .onboarding_views import (
    RegistrableClientsView,
    RegistroMCPView,
    SolicitudesView,
    SolicitudResolverView,
)

urlpatterns = [
    path("clientes", RegistrableClientsView.as_view(), name="onboarding-clientes"),
    path("registro", RegistroMCPView.as_view(), name="onboarding-registro"),
    path("solicitudes", SolicitudesView.as_view(), name="onboarding-solicitudes"),
    path("solicitudes/<uuid:pk>/aprobar",
         SolicitudResolverView.as_view(action="aprobar"), name="onboarding-aprobar"),
    path("solicitudes/<uuid:pk>/rechazar",
         SolicitudResolverView.as_view(action="rechazar"), name="onboarding-rechazar"),
]
