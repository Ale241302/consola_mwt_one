"""
Routes:
  /api/users/                         → MwtUserViewSet (admin)
  /api/users/me/profile/              → ProfileMeView (self-service)
  /api/activity-feed/                 → ActivityFeedViewSet
  /api/permissions/roles/             → RoleCatViewSet
  /api/permissions/modules/           → ModuleCatViewSet
  /api/permissions/cells/             → RolePermissionViewSet (celdas sueltas)
  /api/permissions/groups/<slug>/     → RoleGroupMatrixView (matriz completa)
"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    MwtUserViewSet, ProfileMeView,
    RoleCatViewSet, ModuleCatViewSet, RolePermissionViewSet,
    RoleGroupMatrixView, ActivityFeedViewSet,
)

router = DefaultRouter()
router.register(r"users",                MwtUserViewSet,        basename="users-mwt")
router.register(r"activity-feed",        ActivityFeedViewSet,   basename="activity-feed")
router.register(r"permissions/roles",    RoleCatViewSet,        basename="perm-roles")
router.register(r"permissions/modules",  ModuleCatViewSet,      basename="perm-modules")
router.register(r"permissions/cells",    RolePermissionViewSet, basename="perm-cells")

urlpatterns = [
    # Self-service va ANTES del router `users/` para que no colisione
    # con el path /api/users/<uuid>/ del ViewSet.
    path("users/me/profile/",              ProfileMeView.as_view(),    name="users-me-profile"),
    path("permissions/groups/<slug:slug>/", RoleGroupMatrixView.as_view(), name="perm-group-matrix"),
    path("", include(router.urls)),
]
