"""apps.core.entra_urls — validación Entra ID (M365 Copilot MCP)."""
from django.urls import path

from . import entra_views

urlpatterns = [
    path("validate", entra_views.entra_validate, name="entra_validate"),
    path(".well-known/oauth-authorization-server",
         entra_views.oauth_metadata, name="entra_oauth_metadata"),
    path("oauth/authorize", entra_views.oauth_authorize, name="entra_oauth_authorize"),
    path("oauth/callback", entra_views.oauth_callback, name="entra_oauth_callback"),
]
