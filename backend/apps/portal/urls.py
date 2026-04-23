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
    PortalProductViewSet,
    PortalExpedienteViewSet,
)

router = DefaultRouter()
router.register(r"portal",          PortalViewSet,           basename="portal")
router.register(r"mwt-users",       MwtUserViewSet,          basename="mwt-users")
router.register(r"portal-sessions", PortalSessionLogViewSet, basename="portal-sessions")
router.register(r"portal-audit",    PortalAuditLogViewSet,   basename="portal-audit")

# PortalProductViewSet se monta con path explícito para que la URL sea
# exactamente /api/portal/products/ (nested bajo `portal/`, no al mismo
# nivel que los demás viewsets — eso respeta el contrato del frontend
# y mantiene el namespace semántico del portal B2B).
portal_product_list = PortalProductViewSet.as_view({"get": "list"})
portal_product_detail = PortalProductViewSet.as_view({"get": "retrieve"})

portal_expediente_list   = PortalExpedienteViewSet.as_view({"get": "list"})
portal_expediente_detail = PortalExpedienteViewSet.as_view({"get": "retrieve"})

urlpatterns = [
    path("", include(router.urls)),
    path("portal/products/",              portal_product_list,      name="portal-products-list"),
    path("portal/products/<uuid:pk>/",    portal_product_detail,    name="portal-products-detail"),
    path("portal/expedientes/",           portal_expediente_list,   name="portal-expedientes-list"),
    path("portal/expedientes/<uuid:pk>/", portal_expediente_detail, name="portal-expedientes-detail"),
]
