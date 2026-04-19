"""MWT.ONE · config.urls — entry point del router DRF."""
from django.urls import path, include


urlpatterns = [
    path("api/auth/", include("apps.core.auth_urls")),
]
