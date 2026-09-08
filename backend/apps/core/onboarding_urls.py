"""MWT.ONE · apps.core.onboarding_urls — rutas del onboarding MCP (Fase 2)."""
from django.urls import path

from .onboarding_views import (
    EnviarCredencialesMCPView,
    OnboardingEmitGrantView,
    OnboardingValidateView,
    ReactivacionMCPView,
    RegistrableClientsView,
    RegistroMCPView,
    SolicitudesView,
    SolicitudResolverView,
    UsuarioEmpresasMCPView,
)

urlpatterns = [
    path("clientes", RegistrableClientsView.as_view(), name="onboarding-clientes"),
    path("registro", RegistroMCPView.as_view(), name="onboarding-registro"),
    # Usuario INACTIVO → solicitud de re-activación (pública).
    path("reactivacion", ReactivacionMCPView.as_view(), name="onboarding-reactivacion"),
    # Servicio (ServiceToken · mcp:token_exchange) — uso externo del pipeline.
    path("validate", OnboardingValidateView.as_view(), name="onboarding-validate"),
    path("emit-grant", OnboardingEmitGrantView.as_view(), name="onboarding-emit-grant"),
    path("solicitudes", SolicitudesView.as_view(), name="onboarding-solicitudes"),
    path("solicitudes/<uuid:pk>/aprobar",
         SolicitudResolverView.as_view(action="aprobar"), name="onboarding-aprobar"),
    path("solicitudes/<uuid:pk>/rechazar",
         SolicitudResolverView.as_view(action="rechazar"), name="onboarding-rechazar"),
    # Admin · envío manual de credenciales desde /usuarios/<id>.
    path("usuarios/<uuid:user_id>/empresas",
         UsuarioEmpresasMCPView.as_view(), name="onboarding-usuario-empresas"),
    path("usuarios/<uuid:user_id>/enviar-credenciales",
         EnviarCredencialesMCPView.as_view(), name="onboarding-enviar-credenciales"),
]
