"""
=====================================================================
MWT.ONE · apps.roles.views
Agente responsable: [AG-BACKEND]

Endpoints:

  CRUD de roles · superadmin/admin only
    GET    /api/roles/                        · listar
    POST   /api/roles/                        · crear
    GET    /api/roles/<slug>/                 · detalle
    PATCH  /api/roles/<slug>/                 · editar (bloquea is_system)
    DELETE /api/roles/<slug>/                 · soft-delete (409 si is_system)
    POST   /api/roles/<slug>/toggle-active/

  Catálogo de módulos · read-only para admin
    GET    /api/permissions/modules/

  Matriz RBAC
    GET    /api/permissions/cells/            · celdas sueltas (ModelViewSet)
    GET    /api/permissions/groups/<slug>/    · matriz completa del rol
    PATCH  /api/permissions/groups/<slug>/    · upsert de la matriz

  Alias legacy (compat con el frontend actual):
    GET    /api/permissions/roles/            · mismo RoleCatViewSet
=====================================================================
"""
from __future__ import annotations

import uuid

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import RoleCat, ModuleCat, RolePermission
from .serializers import (
    RoleCatSerializer, ModuleCatSerializer, RolePermissionSerializer,
    RoleMatrixInputSerializer,
)
from .permissions import deny_non_admin


# ══════════════════════════════════════════════════════════════════════
# RoleCat · CRUD completo (superadmin/admin)
# ══════════════════════════════════════════════════════════════════════
class RoleCatViewSet(viewsets.ModelViewSet):
    """CRUD del catálogo de roles.

    DELETE fuerza soft-delete (is_active=False). Mutaciones sobre roles
    `is_system=True` (superadmin, admin, client_b2b) están BLOQUEADAS
    con HTTP 409 CONFLICT — son roles canónicos del sistema.
    """
    required_module = "roles"
    queryset = RoleCat.objects.all()
    serializer_class = RoleCatSerializer
    lookup_field = "slug"

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        denied = deny_non_admin(request, resource_label="roles.crud")
        if denied is not None:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied(denied.data)

    def get_queryset(self):
        qs = RoleCat.objects.all()
        include_inactive = self.request.query_params.get("include_inactive")
        if not (include_inactive and include_inactive.lower() in ("1", "true", "yes")):
            qs = qs.filter(is_active=True)
        return qs.order_by("orden", "slug")

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        # No se puede flipear is_system de un rol canónico.
        if "is_system" in request.data and instance.is_system:
            return Response(
                {"detail": "No se puede modificar el flag is_system de un rol canónico."},
                status=status.HTTP_409_CONFLICT,
            )
        # No se puede cambiar el slug de un rol canónico.
        if instance.is_system and request.data.get("slug") and request.data["slug"] != instance.slug:
            return Response(
                {"detail": "No se puede cambiar el slug de un rol de sistema."},
                status=status.HTTP_409_CONFLICT,
            )
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.is_system:
            return Response(
                {"detail": f"No se puede inactivar el rol de sistema '{instance.slug}'.",
                 "slug":   instance.slug},
                status=status.HTTP_409_CONFLICT,
            )
        return super().destroy(request, *args, **kwargs)

    def perform_destroy(self, instance):
        """Soft-delete."""
        instance.is_active = False
        instance.save(update_fields=["is_active", "updated_at"])

    @action(detail=True, methods=["post"], url_path="toggle-active")
    def toggle_active(self, request, slug=None):
        role = self.get_object()
        if role.is_system and role.is_active:
            return Response(
                {"detail": f"No se puede inactivar el rol de sistema '{role.slug}'."},
                status=status.HTTP_409_CONFLICT,
            )
        role.is_active = not role.is_active
        role.save(update_fields=["is_active", "updated_at"])
        return Response({"ok": True, "slug": role.slug, "is_active": role.is_active})


# ══════════════════════════════════════════════════════════════════════
# ModuleCat · read-only
# ══════════════════════════════════════════════════════════════════════
class ModuleCatViewSet(viewsets.ReadOnlyModelViewSet):
    required_module = "roles"
    queryset = ModuleCat.objects.filter(is_active=True)
    serializer_class = ModuleCatSerializer

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        denied = deny_non_admin(request, resource_label="modules.read")
        if denied is not None:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied(denied.data)


# ══════════════════════════════════════════════════════════════════════
# RolePermission · celdas granulares
# ══════════════════════════════════════════════════════════════════════
class RolePermissionViewSet(viewsets.ModelViewSet):
    """Lectura + update de celdas RBAC individuales (role, module).

    Para bulk upsert usar RoleGroupMatrixView (PATCH /permissions/groups/<slug>/).
    """
    required_module = "roles"
    queryset = RolePermission.objects.all()
    serializer_class = RolePermissionSerializer

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        denied = deny_non_admin(request, resource_label="permissions.crud")
        if denied is not None:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied(denied.data)


# ══════════════════════════════════════════════════════════════════════
# RoleGroupMatrixView · matriz completa de un rol (GET + PATCH upsert)
# ══════════════════════════════════════════════════════════════════════
class RoleGroupMatrixView(APIView):
    """GET y PATCH de la matriz completa de un rol.

      GET   /api/permissions/groups/<slug>/ →
            { role: {...}, matrix: [{module, can_create, can_read, ...}] }

      PATCH /api/permissions/groups/<slug>/ con body:
            { matrix: [{module, can_create, can_read, can_update, can_delete}] }

      Hace upsert (UNIQUE(role_slug, module_slug)) — las celdas ausentes
      se mantienen sin cambios.
    """
    permission_classes = [IsAuthenticated]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        denied = deny_non_admin(request, resource_label="permissions.matrix")
        if denied is not None:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied(denied.data)

    def get(self, request, slug):
        try:
            role = RoleCat.objects.get(slug=slug)
        except RoleCat.DoesNotExist:
            return Response({"detail": "Role no existe."}, status=404)
        cells   = RolePermission.objects.filter(role_slug=slug).order_by("module_slug")
        modules = ModuleCat.objects.filter(is_active=True).order_by("orden", "slug")
        by_mod = {c.module_slug: c for c in cells}
        matrix = []
        for m in modules:
            c = by_mod.get(m.slug)
            matrix.append({
                "module":       m.slug,
                "module_label": m.nombre,
                "categoria":    m.categoria,
                "can_create":       bool(c and c.can_create),
                "can_read":         bool(c and c.can_read),
                "can_update":       bool(c and c.can_update),
                "can_delete":       bool(c and c.can_delete),
                "can_upload_doc":   bool(c and c.can_upload_doc),
                "can_download_doc": bool(c and c.can_download_doc),
                "can_view_doc":     bool(c and c.can_view_doc),
            })
        return Response({
            "role":   RoleCatSerializer(role).data,
            "matrix": matrix,
        })

    def patch(self, request, slug):
        try:
            role = RoleCat.objects.get(slug=slug)
        except RoleCat.DoesNotExist:
            return Response({"detail": "Role no existe."}, status=404)
        ser = RoleMatrixInputSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        updated_by = getattr(request.user, "id", None)
        n_updated = 0
        n_created = 0
        valid_modules = set(ModuleCat.objects.filter(is_active=True).values_list("slug", flat=True))
        for cell in ser.validated_data["matrix"]:
            if cell["module"] not in valid_modules:
                continue
            obj, created = RolePermission.objects.update_or_create(
                role_slug=slug, module_slug=cell["module"],
                defaults={
                    "can_create":       cell["can_create"],
                    "can_read":         cell["can_read"],
                    "can_update":       cell["can_update"],
                    "can_delete":       cell["can_delete"],
                    "can_upload_doc":   cell.get("can_upload_doc", False),
                    "can_download_doc": cell.get("can_download_doc", False),
                    "can_view_doc":     cell.get("can_view_doc", False),
                    "updated_by_id":    updated_by,
                },
            )
            if created:
                obj.id = uuid.uuid4()
                obj.save()
                n_created += 1
            else:
                n_updated += 1
        return Response({
            "ok":        True,
            "role":      slug,
            "updated":   n_updated,
            "created":   n_created,
        })
