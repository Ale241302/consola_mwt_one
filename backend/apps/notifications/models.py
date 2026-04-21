"""
=====================================================================
MWT.ONE · apps.notifications.models
Agente responsable: [AG-BACKEND]
Tablas creadas por [AG-DATABASE] en backend/sql/92_notifications.sql
=====================================================================
"""
from django.db import models


# ── Catálogos ────────────────────────────────────────────────
class EstadoEnvioCat(models.Model):
    codigo    = models.CharField(max_length=32, primary_key=True)
    label     = models.CharField(max_length=64)
    color     = models.CharField(max_length=16, null=True, blank=True)
    orden     = models.IntegerField(default=100)
    is_active = models.BooleanField(default=True)
    class Meta:
        managed  = False
        db_table = 'notifications"."estado_envio_cat'
        ordering = ("orden", "label")


class TriggerCat(models.Model):
    codigo    = models.CharField(max_length=32, primary_key=True)
    label     = models.CharField(max_length=64)
    is_active = models.BooleanField(default=True)
    class Meta:
        managed  = False
        db_table = 'notifications"."trigger_cat'
        ordering = ("codigo",)


# ── NotificationLog ──────────────────────────────────────────
class NotificationLog(models.Model):
    id                = models.UUIDField(primary_key=True)
    ts                = models.DateTimeField()
    completed_at      = models.DateTimeField(null=True, blank=True)
    expediente_id     = models.UUIDField(null=True, blank=True)
    proforma_id       = models.UUIDField(null=True, blank=True)
    template_key      = models.CharField(max_length=64, null=True, blank=True)
    template_id       = models.UUIDField(null=True, blank=True)
    recipient_email   = models.CharField(max_length=255, null=True, blank=True)
    subject           = models.CharField(max_length=512, null=True, blank=True)
    body_preview      = models.TextField(null=True, blank=True)
    trigger           = models.CharField(max_length=32, null=True, blank=True)
    status            = models.CharField(max_length=32, default="Sent")
    retries           = models.IntegerField(default=0)
    attempt_count     = models.IntegerField(default=1)
    error             = models.CharField(max_length=512, null=True, blank=True)
    skip_reason       = models.CharField(max_length=255, null=True, blank=True)
    # Enriquecidos de cobranza
    amount_overdue    = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    grace_days_used   = models.IntegerField(null=True, blank=True)
    currency          = models.CharField(max_length=8, null=True, blank=True)
    # BLOQUE 4 — idempotencia, retry, queue
    idempotence_token = models.CharField(max_length=64, null=True, blank=True)
    retry_of          = models.UUIDField(null=True, blank=True)
    retry_of_token    = models.CharField(max_length=64, null=True, blank=True)
    queue_id          = models.UUIDField(null=True, blank=True)
    celery_task_id    = models.CharField(max_length=128, null=True, blank=True)
    bounced_at        = models.DateTimeField(null=True, blank=True)
    bounce_reason     = models.CharField(max_length=255, null=True, blank=True)

    is_active         = models.BooleanField(default=True)
    created_at        = models.DateTimeField(auto_now_add=True)
    updated_at        = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'notifications"."notification_log'
        ordering = ("-ts",)


# ── GraceDaysCat ─────────────────────────────────────────────
class GraceDaysCat(models.Model):
    codigo    = models.CharField(max_length=16, primary_key=True)
    label     = models.CharField(max_length=64)
    dias      = models.IntegerField(default=0)
    escalar_a = models.CharField(max_length=16, null=True, blank=True)
    orden     = models.IntegerField(default=100)
    is_active = models.BooleanField(default=True)

    class Meta:
        managed  = False
        db_table = 'notifications"."grace_days_cat'
        ordering = ("orden", "codigo")


# ── EmailQueueLog ────────────────────────────────────────────
class EmailQueueLog(models.Model):
    id              = models.UUIDField(primary_key=True)
    celery_task_id  = models.CharField(max_length=128, null=True, blank=True, unique=True)
    notification_id = models.UUIDField(null=True, blank=True)
    template_key    = models.CharField(max_length=64, null=True, blank=True)
    recipient_email = models.CharField(max_length=255, null=True, blank=True)
    status          = models.CharField(max_length=16, default="QUEUED")
    retries         = models.IntegerField(default=0)
    max_retries     = models.IntegerField(default=5)
    last_error      = models.TextField(null=True, blank=True)
    next_retry_at   = models.DateTimeField(null=True, blank=True)
    enqueued_at     = models.DateTimeField(auto_now_add=True)
    started_at      = models.DateTimeField(null=True, blank=True)
    finished_at     = models.DateTimeField(null=True, blank=True)
    duration_ms     = models.IntegerField(null=True, blank=True)
    payload         = models.JSONField(default=dict)
    is_active       = models.BooleanField(default=True)
    created_at      = models.DateTimeField(auto_now_add=True)
    updated_at      = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'notifications"."email_queue_log'
        ordering = ("-enqueued_at",)
