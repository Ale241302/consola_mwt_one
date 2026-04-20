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
    id               = models.UUIDField(primary_key=True)
    name             = models.CharField(max_length=128)
    template_key     = models.CharField(max_length=64)
    language         = models.CharField(max_length=8, default="ES")
    brand            = models.CharField(max_length=32, default="GLOBAL")
    brand_id         = models.UUIDField(null=True, blank=True)
    subject_template = models.CharField(max_length=512)
    body_template    = models.TextField()
    variables_meta   = models.JSONField(default=list)
    sent_count_30d   = models.IntegerField(default=0)
    is_active        = models.BooleanField(default=True)
    created_at       = models.DateTimeField(auto_now_add=True)
    updated_at       = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'email_templates"."template'
        ordering = ("template_key", "language", "brand")


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
