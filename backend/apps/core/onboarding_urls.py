"""MWT.ONE · apps.core.onboarding_urls — rutas del onboarding MCP (Fase 2)."""
from django.urls import path

from .onboarding_views import (
    OnboardingEmitGrantView,
    OnboardingValidateView,
    RegistrableClientsView,
    RegistroMCPView,
    SolicitudesView,
    SolicitudResolverView,
)

urlpatterns = [
    path("clientes", RegistrableClientsView.as_view(), name="onboarding-clientes"),
    path("registro", RegistroMCPView.as_view(), name="onboarding-registro"),
    # Servicio (ServiceToken · mcp:token_exchange) — uso externo del pipeline.
    path("validate", OnboardingValidateView.as_view(), name="onboarding-validate"),
    path("emit-grant", OnboardingEmitGrantView.as_view(), name="onboarding-emit-grant"),
    path("solicitudes", SolicitudesView.as_view(), name="onboarding-solicitudes"),
    path("solicitudes/<uuid:pk>/aprobar",
         SolicitudResolverView.as_view(action="aprobar"), name="onboarding-aprobar"),
    path("solicitudes/<uuid:pk>/rechazar",
         SolicitudResolverView.as_view(action="rechazar"), name="onboarding-rechazar"),
]
