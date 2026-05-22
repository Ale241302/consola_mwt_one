"""
=====================================================================
MWT.ONE · apps.roles.models
Agente responsable: [AG-BACKEND]

Modelos Django (managed=False) sobre el schema `users` creado por
[AG-DATABASE] en backend/sql/A4_users_roles.sql.

Tablas cubiertas aquí:
  · users.role_cat          → RoleCat
  · users.module_cat        → ModuleCat
  · users.role_permission   → RolePermission
  · users.user_role_bridge  → UserRoleBridge

Nota arquitectónica:
  · Las tablas de roles permanecen en el SCHEMA `users.*` de Postgres
    (no se renombran) porque comparten migración con `users.mwtuser`
    y el SQL es fuente única de verdad.
  · La SEPARACIÓN es al nivel de app Django para modularidad/testing.
  · CERO FK físicas — todas las relaciones son UUID / slug strings.
=====================================================================
"""
from django.db import models


class RoleCat(models.Model):
    """Catálogo canónico de roles.

    is_system=TRUE bloquea mutaciones vía API (superadmin, admin,
    client_b2b son roles de sistema y no se pueden borrar).
    """
    slug         = models.CharField(max_length=32, primary_key=True)
    nombre       = models.CharField(max_length=96)
    descripcion  = models.TextField(null=True, blank=True)
    color        = models.CharField(max_length=16, default="#64748B")
    orden        = models.IntegerField(default=100)
    is_system    = models.BooleanField(default=False)
    is_active    = models.BooleanField(default=True)
    created_at   = models.DateTimeField(auto_now_add=True)
    updated_at   = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'users"."role_cat'
        ordering = ("orden", "slug")


class ModuleCat(models.Model):
    """Catálogo de módulos del ERP usados por la matriz RBAC."""
    slug         = models.CharField(max_length=32, primary_key=True)
    nombre       = models.CharField(max_length=96)
    descripcion  = models.TextField(null=True, blank=True)
    icon         = models.CharField(max_length=32, null=True, blank=True)
    categoria    = models.CharField(max_length=32, default="OPERACIONAL")
    orden        = models.IntegerField(default=100)
    is_active    = models.BooleanField(default=True)

    class Meta:
        managed  = False
        db_table = 'users"."module_cat'
        ordering = ("orden", "slug")


class RolePermission(models.Model):
    """Matriz CRUD por (role_slug, module_slug). Un row por celda."""
    id            = models.UUIDField(primary_key=True)
    role_slug     = models.CharField(max_length=32)
    module_slug   = models.CharField(max_length=32)
    can_create    = models.BooleanField(default=False)
    can_read      = models.BooleanField(default=False)
    can_update    = models.BooleanField(default=False)
    can_delete    = models.BooleanField(default=False)
    # Sprint 2026-05-21 · A5 RBAC redesign · gestion documental
    can_upload_doc   = models.BooleanField(default=False)
    can_download_doc = models.BooleanField(default=False)
    can_view_doc     = models.BooleanField(default=False)
    updated_by_id = models.UUIDField(null=True, blank=True)
    updated_at    = models.DateTimeField(auto_now=True)
    created_at    = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed  = False
        db_table = 'users"."role_permission'
        unique_together = (("role_slug", "module_slug"),)


class UserRoleBridge(models.Model):
    """N:M de roles adicionales por usuario (además del role_default)."""
    id         = models.UUIDField(primary_key=True)
    user_id    = models.UUIDField()
    role_slug  = models.CharField(max_length=32)
    granted_by = models.UUIDField(null=True, blank=True)
    granted_at = models.DateTimeField(auto_now_add=True)
    is_active  = models.BooleanField(default=True)

    class Meta:
        managed  = False
        db_table = 'users"."user_role_bridge'
        unique_together = (("user_id", "role_slug"),)
