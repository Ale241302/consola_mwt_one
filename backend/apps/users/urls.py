"""
Routes del módulo M3 CORE · users + roles + permissions + addresses.

  /api/users/                         → MwtUserViewSet (admin: CRUD usuarios)
  /api/users/<uuid>/reset-password/   → reset token + email
  /api/users/<uuid>/toggle-active/    → inactivar / reactivar
  /api/users/me/profile/              → ProfileMeView (self-service GET/PATCH)
  /api/user-addresses/                → UserAddressAdminViewSet (CRUD admin)
                                         filtrable por ?user_id=<uuid>

  /api/roles/                         → RoleCatViewSet (CRUD roles — superadmin)
  /api/permissions/roles/             → RoleCatViewSet read-only (alias
                                         histórico para el front)
  /api/permissions/modules/           → ModuleCatViewSet
  /api/permissions/cells/             → RolePermissionViewSet (celdas sueltas)
  /api/permissions/groups/<slug>/     → RoleGroupMatrixView (matriz completa)

  /api/activity-feed/                 → ActivityFeedViewSet

Nota: `/api/roles/` y `/api/permissions/roles/` apuntan al MISMO viewset.
El alias `permissions/roles` se mantiene para no romper el frontend actual
(RolesPermissions.jsx lo consume); el nuevo `/api/roles/` es la ruta
canónica pedida por la especificación de M3.
"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    MwtUserViewSet, ProfileMeView,
    RoleCatViewSet, ModuleCatViewSet, RolePermissionViewSet,
    RoleGroupMatrixView, ActivityFeedViewSet,
    UserAddressAdminViewSet,
)

router = DefaultRouter()
router.register(r"users",                MwtUserViewSet,            basename="users-mwt")
# Registrado bajo /api/user-addresses/ para evitar la colisión con
# /api/users/<uuid>/ del router principal (DRF hashea el primer match).
# El front puede usar ?user_id=<uuid> para filtrar.
router.register(r"user-addresses",       UserAddressAdminViewSet,   basename="user-addresses")
router.register(r"activity-feed",        ActivityFeedViewSet,       basename="activity-feed")

# Roles: ruta canónica CRUD (para M3 spec).
router.register(r"roles",                RoleCatViewSet,            basename="roles-crud")

# Alias histórico que consume el front actual — apunta al mismo viewset
# registrado con otro basename para no colisionar con el router.
router.register(r"permissions/roles",    RoleCatViewSet,            basename="perm-roles")
router.register(r"permissions/modules",  ModuleCatViewSet,          basename="perm-modules")
router.register(r"permissions/cells",    RolePermissionViewSet,     basename="perm-cells")

urlpatterns = [
    # /users/me/profile/ debe ir ANTES del router `users/` para no
    # colisionar con el detail path /api/users/<uuid>/ del ViewSet.
    path("users/me/profile/",               ProfileMeView.as_view(),       name="users-me-profile"),
    path("permissions/groups/<slug:slug>/", RoleGroupMatrixView.as_view(), name="perm-group-matrix"),
    path("", include(router.urls)),
]
