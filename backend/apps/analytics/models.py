"""
=====================================================================
MWT.ONE · apps.analytics.models
Agente responsable: [AG-BACKEND]

Modelos read-through de los schemas `dashboard.*` creados por:
  · 94_pipeline_financiero_portal.sql   (dashboard.snapshot)
  · 94b_portal_analytics_audit.sql      (dashboard.snapshot ext + widget_cat)

Sin Foreign Keys. Vínculos por UUID lógico (user_id).
Esta app sigue leyendo read-only KPIs cross-schema vía raw SQL;
los modelos abajo sólo modelan las tablas propias del schema `dashboard`.
=====================================================================
"""
from django.db import models


# ── DashboardSnapshot ────────────────────────────────────────
class DashboardSnapshot(models.Model):
    id               = models.UUIDField(primary_key=True)
    user_id          = models.UUIDField(null=True, blank=True)
    snapshot_type    = models.CharField(max_length=32, default="preferences")
    # snapshot_type ∈ { preferences, kpi_monthly, kpi_weekly, kpi_daily, custom }
    label            = models.CharField(max_length=120, null=True, blank=True)
    period_start     = models.DateField(null=True, blank=True)
    period_end       = models.DateField(null=True, blank=True)
    snapshot_data    = models.JSONField(default=dict)
    is_pinned        = models.BooleanField(default=False)

    # 94b extensions
    idempotence_token = models.CharField(max_length=64, null=True, blank=True)
    scope_hash        = models.CharField(max_length=64, null=True, blank=True)
    generated_by      = models.CharField(max_length=16, default="user")
    # generated_by ∈ { user, cron, system, api }
    generated_at      = models.DateTimeField(auto_now_add=True)
    expires_at        = models.DateTimeField(null=True, blank=True)

    is_active        = models.BooleanField(default=True)
    created_at       = models.DateTimeField(auto_now_add=True)
    updated_at       = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'dashboard"."snapshot'
        ordering = ("-created_at",)


# ── WidgetCat ────────────────────────────────────────────────
class WidgetCat(models.Model):
    codigo         = models.CharField(max_length=32, primary_key=True)
    label          = models.CharField(max_length=96)
    category       = models.CharField(max_length=32, null=True, blank=True)
    min_role       = models.CharField(max_length=32, default="ops")
    default_layout = models.JSONField(default=dict)
    orden          = models.IntegerField(default=100)
    is_active      = models.BooleanField(default=True)

    class Meta:
        managed  = False
        db_table = 'dashboard"."widget_cat'
        ordering = ("orden", "codigo")
