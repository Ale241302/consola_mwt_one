"""
=====================================================================
MWT.ONE · apps.email_templates.models
Agente responsable: [AG-BACKEND]
Tablas creadas por [AG-DATABASE] en backend/sql/91_email_templates.sql
=====================================================================
"""
from django.db import models


# ── Catálogos ────────────────────────────────────────────────
class LanguageCat(models.Model):
    codigo    = models.CharField(max_length=8, primary_key=True)
    label     = models.CharField(max_length=32)
    orden     = models.IntegerField(default=100)
    is_active = models.BooleanField(default=True)
    class Meta:
        managed  = False
        db_table = 'email_templates"."language_cat'
        ordering = ("orden", "label")


# ── Template ─────────────────────────────────────────────────
class Template(models.Model):
    id                 = models.UUIDField(primary_key=True)
    name               = models.CharField(max_length=128)
    template_key       = models.CharField(max_length=64)
    language           = models.CharField(max_length=8, default="ES")
    brand              = models.CharField(max_length=32, default="GLOBAL")
    brand_id           = models.UUIDField(null=True, blank=True)
    subject_template   = models.CharField(max_length=512)
    body_template      = models.TextField()
    variables_meta     = models.JSONField(default=list)
    sent_count_30d     = models.IntegerField(default=0)

    # BLOQUE 4 — status lifecycle
    status             = models.CharField(max_length=16, default="DRAFT")
    idempotence_token  = models.CharField(max_length=64, null=True, blank=True)
    last_test_send_at  = models.DateTimeField(null=True, blank=True)
    published_at       = models.DateTimeField(null=True, blank=True)
    published_by_id    = models.UUIDField(null=True, blank=True)
    archived_at        = models.DateTimeField(null=True, blank=True)
    archived_by_id     = models.UUIDField(null=True, blank=True)

    is_active          = models.BooleanField(default=True)
    created_at         = models.DateTimeField(auto_now_add=True)
    updated_at         = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'email_templates"."template'
        ordering = ("template_key", "language", "brand")


# ── TemplateStatusCat ────────────────────────────────────────
class TemplateStatusCat(models.Model):
    codigo           = models.CharField(max_length=16, primary_key=True)
    label            = models.CharField(max_length=64)
    color            = models.CharField(max_length=16, null=True, blank=True)
    orden            = models.IntegerField(default=100)
    permite_envio    = models.BooleanField(default=False)
    permite_edicion  = models.BooleanField(default=True)
    is_active        = models.BooleanField(default=True)

    class Meta:
        managed  = False
        db_table = 'email_templates"."template_status_cat'
        ordering = ("orden", "codigo")


# ── RenderPreviewLog (append-only) ───────────────────────────
class RenderPreviewLog(models.Model):
    id                = models.UUIDField(primary_key=True)
    template_id       = models.UUIDField()
    template_key      = models.CharField(max_length=64)
    language          = models.CharField(max_length=8)
    brand             = models.CharField(max_length=32, default="GLOBAL")
    payload_sample    = models.JSONField(default=dict)
    rendered_subject  = models.CharField(max_length=512, null=True, blank=True)
    rendered_body     = models.TextField(null=True, blank=True)
    render_ok         = models.BooleanField(default=True)
    error_code        = models.CharField(max_length=64, null=True, blank=True)
    error_message     = models.TextField(null=True, blank=True)
    duration_ms       = models.IntegerField(null=True, blank=True)
    triggered_by_id   = models.UUIDField(null=True, blank=True)
    triggered_by_name = models.CharField(max_length=128, null=True, blank=True)
    is_active         = models.BooleanField(default=True)
    created_at        = models.DateTimeField(auto_now_add=True)
    updated_at        = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'email_templates"."render_preview_log'
        ordering = ("-created_at",)


# ── Version (audit append-only) ──────────────────────────────
class Version(models.Model):
    id               = models.UUIDField(primary_key=True)
    template_id      = models.UUIDField()
    subject_template = models.CharField(max_length=512, null=True, blank=True)
    body_template    = models.TextField(null=True, blank=True)
    changed_by_id    = models.UUIDField(null=True, blank=True)
    changed_by_name  = models.CharField(max_length=128, null=True, blank=True)
    change_note      = models.CharField(max_length=512, null=True, blank=True)
    created_at       = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed  = False
        db_table = 'email_templates"."version'
        ordering = ("-created_at",)
