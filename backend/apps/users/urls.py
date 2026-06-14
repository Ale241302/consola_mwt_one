"""
Routes del módulo apps.users · identidad (M3-CORE).

  /api/users/                           → MwtUserViewSet (CRUD usuarios, admin)
  /api/users/<uuid>/reset-password/     → token + email
  /api/users/<uuid>/toggle-active/      → inactivar/reactivar
  /api/users/me/profile/                → ProfileMeView (self-service GET/PATCH)
  /api/user-addresses/                  → UserAddressAdminViewSet
                                          (CRUD admin, filtro ?user_id=<uuid>)
  /api/activity-feed/                   → ActivityFeedViewSet (campana)

Las rutas de roles + matriz RBAC están registradas aparte en
apps.roles.urls (incluido desde config/urls.py):
  /api/roles/, /api/permissions/roles/, /api/permissions/modules/,
  /api/permissions/cells/, /api/permissions/groups/<slug>/.
"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    MwtUserViewSet, ProfileMeView, ProfileResetPasswordView,
    ActivityFeedViewSet, UserAddressAdminViewSet,
)

router = DefaultRouter()
router.register(r"users",             MwtUserViewSet,          basename="users-mwt")
# /user-addresses/ en lugar de /users/addresses/ para no colisionar
# con el detail path /api/users/<uuid>/ del router principal.
router.register(r"user-addresses",    UserAddressAdminViewSet, basename="user-addresses")
router.register(r"activity-feed",     ActivityFeedViewSet,     basename="activity-feed")

urlpatterns = [
    # /users/me/profile/ va ANTES del router para no chocar con el
    # detail path /api/users/<uuid>/.
    path("users/me/profile/", ProfileMeView.as_view(), name="users-me-profile"),
    path("users/me/reset-password/", ProfileResetPasswordView.as_view(), name="users-me-reset-password"),
    path("", include(router.urls)),
]
