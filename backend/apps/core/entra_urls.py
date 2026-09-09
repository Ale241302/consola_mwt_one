"""apps.core.entra_urls — validación Entra ID (M365 Copilot MCP)."""
from django.urls import path

from . import entra_views

urlpatterns = [
    path("validate", entra_views.entra_validate, name="entra_validate"),
]
