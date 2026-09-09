"""apps.core.skills_urls — Skills-MCP públicas (manifest + descarga por rol)."""
from django.urls import path

from . import skills_views

urlpatterns = [
    path("", skills_views.skills_manifest, name="skills_manifest"),
    path("<str:rol>/download", skills_views.skills_role_download, name="skills_role_download"),
]
