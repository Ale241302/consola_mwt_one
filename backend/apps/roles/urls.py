"""
Routes del módulo apps.roles · M3-CORE independiente.

  /api/roles/                           → RoleCatViewSet (CRUD completo)
  /api/roles/<slug>/toggle-active/      → reactivar / inactivar
  /api/permissions/roles/               → alias legacy (mismo ViewSet)
  /api/permissions/modules/             → ModuleCatViewSet (read-only)
  /api/permissions/cells/               → RolePermissionViewSet (granular)
  /api/permissions/groups/<slug>/       → RoleGroupMatrixView (matriz completa)
"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    RoleCatViewSet, ModuleCatViewSet, RolePermissionViewSet,
    RoleGroupMatrixView,
)

router = DefaultRouter()
# Ruta canónica M3: /api/roles/
router.register(r"roles",                RoleCatViewSet,        basename="roles-crud")

# Alias legacy que consume el frontend actual (RolesPermissions.jsx).
router.register(r"permissions/roles",    RoleCatViewSet,        basename="perm-roles")
router.register(r"permissions/modules",  ModuleCatViewSet,      basename="perm-modules")
router.register(r"permissions/cells",    RolePermissionViewSet, basename="perm-cells")

urlpatterns = [
    # La matriz agregada va como path() dedicado porque NO es un ModelViewSet.
    path("permissions/groups/<slug:slug>/", RoleGroupMatrixView.as_view(), name="perm-group-matrix"),
    path("", include(router.urls)),
]
