"""
=====================================================================
MWT.ONE · apps.portal.urls
Agente responsable: [AG-BACKEND]

Monta PortalViewSet en /api/portal/<action>/
=====================================================================
"""
from rest_framework.routers import DefaultRouter
from django.urls import path, include

from .views import PortalViewSet

router = DefaultRouter()
router.register(r"portal", PortalViewSet, basename="portal")

urlpatterns = [
    path("", include(router.urls)),
]
