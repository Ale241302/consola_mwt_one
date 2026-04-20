"""
=====================================================================
MWT.ONE · apps.transfers.models
Agente responsable: [AG-BACKEND]
Tablas creadas por [AG-DATABASE] en backend/sql/90_transfers.sql
=====================================================================
"""
from django.db import models


# ── Catálogos ────────────────────────────────────────────────
class EstadoTransferCat(models.Model):
    codigo    = models.CharField(max_length=32, primary_key=True)
    label     = models.CharField(max_length=64)
    color     = models.CharField(max_length=16, null=True, blank=True)
    orden     = models.IntegerField(default=100)
    is_active = models.BooleanField(default=True)
    class Meta:
        managed  = False
        db_table = 'transfers"."estado_transfer_cat'
        ordering = ("orden", "label")


class LegalContextCat(models.Model):
    codigo      = models.CharField(max_length=32, primary_key=True)
    label       = models.CharField(max_length=64)
    descripcion = models.TextField(null=True, blank=True)
    is_active   = models.BooleanField(default=True)
    class Meta:
        managed  = False
        db_table = 'transfers"."legal_context_cat'
        ordering = ("label",)


# ── Transferencia ────────────────────────────────────────────
class Transferencia(models.Model):
    id               = models.UUIDField(primary_key=True)
    codigo           = models.CharField(max_length=32, unique=True)
    origen_id        = models.UUIDField(null=True, blank=True)
    destino_id       = models.UUIDField(null=True, blank=True)
    origen_label     = models.CharField(max_length=128, null=True, blank=True)
    destino_label    = models.CharField(max_length=128, null=True, blank=True)
    legal_context    = models.CharField(max_length=32, default="INTERNAL")
    estado           = models.CharField(max_length=32, default="PLANNED")
    ref_tracking     = models.CharField(max_length=64, null=True, blank=True)
    needs_approval   = models.BooleanField(default=False)
    value_usd        = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    notes            = models.TextField(null=True, blank=True)
    created_by_id    = models.UUIDField(null=True, blank=True)
    created_by_name  = models.CharField(max_length=128, null=True, blank=True)
    approved_by_id   = models.UUIDField(null=True, blank=True)
    approved_by_name = models.CharField(max_length=128, null=True, blank=True)
    received_by_id   = models.UUIDField(null=True, blank=True)
    received_by_name = models.CharField(max_length=128, null=True, blank=True)
    dispatched_at    = models.DateField(null=True, blank=True)
    eta              = models.DateField(null=True, blank=True)
    received_at      = models.DateField(null=True, blank=True)
    is_active        = models.BooleanField(default=True)
    created_at       = models.DateTimeField(auto_now_add=True)
    updated_at       = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'transfers"."transferencia'


# ── Línea ────────────────────────────────────────────────────
class Linea(models.Model):
    id               = models.UUIDField(primary_key=True)
    transferencia_id = models.UUIDField()
    producto_id      = models.UUIDField(null=True, blank=True)
    sku              = models.CharField(max_length=64, null=True, blank=True)
    product_label    = models.CharField(max_length=255, null=True, blank=True)
    size             = models.CharField(max_length=16, null=True, blank=True)
    qty_transfer     = models.IntegerField(default=0)
    qty_reserve      = models.IntegerField(default=0)
    qty_received     = models.IntegerField(null=True, blank=True)
    unit_cost        = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    unit_value       = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    is_active        = models.BooleanField(default=True)
    created_at       = models.DateTimeField(auto_now_add=True)
    updated_at       = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'transfers"."linea'


# ── Evento (audit trail) ─────────────────────────────────────
class Evento(models.Model):
    id               = models.UUIDField(primary_key=True)
    transferencia_id = models.UUIDField()
    estado_prev      = models.CharField(max_length=32, null=True, blank=True)
    estado_nuevo     = models.CharField(max_length=32)
    actor_id         = models.UUIDField(null=True, blank=True)
    actor_name       = models.CharField(max_length=128, null=True, blank=True)
    notes            = models.TextField(null=True, blank=True)
    created_at       = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed  = False
        db_table = 'transfers"."evento'
        ordering = ("-created_at",)
