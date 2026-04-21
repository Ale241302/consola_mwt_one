"""
=====================================================================
MWT.ONE · apps.portal.models
Agente responsable: [AG-BACKEND]

Portal B2B — modelos propios (BLOQUE 4).

Tablas creadas por [AG-DATABASE] en:
  · 94_pipeline_financiero_portal.sql   (portal.mwt_user)
  · 94b_portal_analytics_audit.sql      (portal.mwt_user extensions,
                                         portal.portal_session_log,
                                         portal.portal_audit_log)

Sin Foreign Keys gestionadas por Postgres — vínculos por UUID lógico.
=====================================================================
"""
from django.db import models


# ── MwtUser ──────────────────────────────────────────────────
class MwtUser(models.Model):
    id                   = models.UUIDField(primary_key=True)
    email                = models.EmailField(max_length=255, unique=True)
    full_name            = models.CharField(max_length=180)
    role                 = models.CharField(max_length=32, default="b2b_client")
    legal_entity_id      = models.UUIDField(null=True, blank=True)
    phone                = models.CharField(max_length=40, null=True, blank=True)
    locale               = models.CharField(max_length=8, default="es")
    timezone             = models.CharField(max_length=48, default="America/Lima")
    is_api_user          = models.BooleanField(default=False)
    api_key_hash         = models.CharField(max_length=255, null=True, blank=True)
    last_login_at        = models.DateTimeField(null=True, blank=True)
    invited_by_id        = models.UUIDField(null=True, blank=True)
    accepted_at          = models.DateTimeField(null=True, blank=True)
    metadata             = models.JSONField(default=dict)
    # BLOQUE 4 extensions
    idempotence_token    = models.CharField(max_length=64, null=True, blank=True)
    preferences          = models.JSONField(default=dict)
    invite_token         = models.CharField(max_length=128, null=True, blank=True)
    invite_expires_at    = models.DateTimeField(null=True, blank=True)
    password_hash        = models.CharField(max_length=255, null=True, blank=True)
    password_changed_at  = models.DateTimeField(null=True, blank=True)
    failed_login_count   = models.IntegerField(default=0)
    locked_until         = models.DateTimeField(null=True, blank=True)
    scope_ids            = models.JSONField(default=list)

    is_active            = models.BooleanField(default=True)
    created_at           = models.DateTimeField(auto_now_add=True)
    updated_at           = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'portal"."mwt_user'
        ordering = ("email",)


# ── PortalSessionLog ─────────────────────────────────────────
class PortalSessionLog(models.Model):
    id               = models.UUIDField(primary_key=True)
    mwt_user_id      = models.UUIDField()
    email            = models.EmailField(max_length=255, null=True, blank=True)
    event_type       = models.CharField(max_length=16)
    # event_type ∈ {LOGIN, LOGOUT, REFRESH, LOGIN_FAILED, LOCKED, PWD_RESET}
    session_token_id = models.CharField(max_length=128, null=True, blank=True)
    ip_address       = models.GenericIPAddressField(null=True, blank=True)
    user_agent       = models.TextField(null=True, blank=True)
    locale           = models.CharField(max_length=8, null=True, blank=True)
    timezone         = models.CharField(max_length=48, null=True, blank=True)
    success          = models.BooleanField(default=True)
    error_code       = models.CharField(max_length=64, null=True, blank=True)
    error_message    = models.TextField(null=True, blank=True)
    is_active        = models.BooleanField(default=True)
    created_at       = models.DateTimeField(auto_now_add=True)
    updated_at       = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'portal"."portal_session_log'
        ordering = ("-created_at",)


# ── PortalAuditLog ───────────────────────────────────────────
class PortalAuditLog(models.Model):
    id              = models.UUIDField(primary_key=True)
    mwt_user_id     = models.UUIDField()
    email           = models.EmailField(max_length=255, null=True, blank=True)
    action          = models.CharField(max_length=32)
    # action ∈ {VIEW, DOWNLOAD, EXPORT, CREATE, UPDATE, DELETE, UPLOAD}
    resource_type   = models.CharField(max_length=32)
    # resource_type ∈ {expediente, documento, pago, proforma, cliente, perfil}
    resource_id     = models.UUIDField(null=True, blank=True)
    resource_label  = models.CharField(max_length=255, null=True, blank=True)
    ip_address      = models.GenericIPAddressField(null=True, blank=True)
    user_agent      = models.TextField(null=True, blank=True)
    status_code     = models.IntegerField(null=True, blank=True)
    duration_ms     = models.IntegerField(null=True, blank=True)
    payload         = models.JSONField(default=dict)
    is_active       = models.BooleanField(default=True)
    created_at      = models.DateTimeField(auto_now_add=True)
    updated_at      = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'portal"."portal_audit_log'
        ordering = ("-created_at",)
