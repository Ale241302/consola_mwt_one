"""
=====================================================================
MWT.ONE · apps.users.models
Agente responsable: [AG-BACKEND]

Modelos Django (managed=False) sobre el schema `users` creado por
[AG-DATABASE] en backend/sql/A4_users_roles.sql.

Regla de oro MWT: cero FK físicas → todos los vínculos (user_id,
role_slug, legal_entity_id) son UUID/string planos con índices.
=====================================================================
"""
from django.db import models


class MwtUser(models.Model):
    """Usuario del ERP. Staff interno + clientes B2B del portal."""
    id                   = models.UUIDField(primary_key=True)

    email_plain          = models.CharField(max_length=255, unique=True)
    password_hash        = models.TextField(null=True, blank=True)
    password_changed_at  = models.DateTimeField(null=True, blank=True)

    full_name            = models.CharField(max_length=160, null=True, blank=True)
    contact_email        = models.CharField(max_length=255, null=True, blank=True)
    phone                = models.CharField(max_length=32,  null=True, blank=True)
    preferred_language   = models.CharField(max_length=8,  default="es")
    timezone             = models.CharField(max_length=64, default="America/Lima")
    avatar_url           = models.TextField(null=True, blank=True)

    legal_entity_id      = models.UUIDField(null=True, blank=True)

    role_default         = models.CharField(max_length=32, default="viewer")
    is_superuser         = models.BooleanField(default=False)

    is_api_user          = models.BooleanField(default=False)
    api_key_hash         = models.TextField(null=True, blank=True)

    last_login_at        = models.DateTimeField(null=True, blank=True)
    failed_login_count   = models.IntegerField(default=0)
    locked_until         = models.DateTimeField(null=True, blank=True)

    accepted_terms_at    = models.DateTimeField(null=True, blank=True)
    preferences          = models.JSONField(default=dict, blank=True)

    is_active            = models.BooleanField(default=True)
    created_at           = models.DateTimeField(auto_now_add=True)
    updated_at           = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'users"."mwtuser'


class RoleCat(models.Model):
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
    updated_by_id = models.UUIDField(null=True, blank=True)
    updated_at    = models.DateTimeField(auto_now=True)
    created_at    = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed  = False
        db_table = 'users"."role_permission'
        unique_together = (("role_slug", "module_slug"),)


class UserRoleBridge(models.Model):
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


class PasswordResetToken(models.Model):
    id          = models.UUIDField(primary_key=True)
    user_id     = models.UUIDField()
    token_hash  = models.CharField(max_length=128, unique=True)
    issued_by   = models.UUIDField(null=True, blank=True)
    expires_at  = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True, blank=True)
    ip_address  = models.CharField(max_length=64,  null=True, blank=True)
    user_agent  = models.CharField(max_length=255, null=True, blank=True)
    created_at  = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed  = False
        db_table = 'users"."password_reset_token'


class ActivityFeed(models.Model):
    """Notificaciones del header (campana 🔔)."""
    id           = models.UUIDField(primary_key=True)
    user_id      = models.UUIDField()
    kind         = models.CharField(max_length=48)
    title        = models.CharField(max_length=160)
    body         = models.TextField(null=True, blank=True)
    icon         = models.CharField(max_length=32, null=True, blank=True)
    severity     = models.CharField(max_length=16, default="INFO")
    deep_link    = models.TextField(null=True, blank=True)
    related_type = models.CharField(max_length=32, null=True, blank=True)
    related_id   = models.UUIDField(null=True, blank=True)
    read_at      = models.DateTimeField(null=True, blank=True)
    is_active    = models.BooleanField(default=True)
    created_at   = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed  = False
        db_table = 'users"."activity_feed'
        ordering = ("-created_at",)


class UserAddress(models.Model):
    """Direcciones múltiples por usuario (B2B). Sin FK física a mwtuser.

    Un usuario puede tener 1..N direcciones; exactamente UNA está marcada
    como `is_default=True` (unique index parcial en BD).
    """
    id             = models.UUIDField(primary_key=True)
    user_id        = models.UUIDField()             # FK lógica a users.mwtuser.id

    label          = models.CharField(max_length=96,  null=True, blank=True)
    kind           = models.CharField(max_length=16,  default="SHIPPING")

    contact_name   = models.CharField(max_length=160, null=True, blank=True)
    contact_phone  = models.CharField(max_length=32,  null=True, blank=True)

    address_line_1 = models.CharField(max_length=255)
    address_line_2 = models.CharField(max_length=255, null=True, blank=True)
    city           = models.CharField(max_length=96,  null=True, blank=True)
    state          = models.CharField(max_length=96,  null=True, blank=True)
    country        = models.CharField(max_length=64,  null=True, blank=True)
    zip_code       = models.CharField(max_length=32,  null=True, blank=True)

    latitude       = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    longitude      = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)

    is_default     = models.BooleanField(default=False)
    notes          = models.TextField(null=True, blank=True)

    is_active      = models.BooleanField(default=True)
    created_at     = models.DateTimeField(auto_now_add=True)
    updated_at     = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'users"."addresses'
        ordering = ("-is_default", "-created_at")
