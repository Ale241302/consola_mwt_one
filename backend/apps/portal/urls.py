"""
=====================================================================
MWT.ONE · apps.portal.urls
Agente responsable: [AG-BACKEND]

Monta:
  · PortalViewSet           → /api/portal/<action>/  (read-only B2B)
  · MwtUserViewSet          → /api/mwt-users/        (CRUD + invitaciones)
  · PortalSessionLogViewSet → /api/portal-sessions/  (read-only)
  · PortalAuditLogViewSet   → /api/portal-audit/     (read-only)
=====================================================================
"""
from rest_framework.routers import DefaultRouter
from django.urls import path, include

from .views import (
    PortalViewSet,
    MwtUserViewSet,
    PortalSessionLogViewSet,
    PortalAuditLogViewSet,
)

router = DefaultRouter()
router.register(r"portal",          PortalViewSet,           basename="portal")
router.register(r"mwt-users",       MwtUserViewSet,          basename="mwt-users")
router.register(r"portal-sessions", PortalSessionLogViewSet, basename="portal-sessions")
router.register(r"portal-audit",    PortalAuditLogViewSet,   basename="portal-audit")

urlpatterns = [
    path("", include(router.urls)),
]
