"""
=====================================================================
MWT.ONE · apps.transfers.models
Agente responsable: [AG-BACKEND]
Tablas creadas por [AG-DATABASE] en backend/sql/90_transfers.sql
+ extensiones BLOQUE 3 en backend/sql/91_transfers_audit.sql

BLOQUE 3 añade:
  · Estados CLOSED / DISCREPANCY en el catálogo.
  · TransicionCat: state machine explícita (estado_from → estado_to).
  · Extensiones en Linea: tolerancia_pct, estado_discrepancia,
    snapshot_unit_cost, snapshot_created_at.
  · Extensiones en Transferencia: reconciled_by_*, reconciled_at,
    reconciled_note, snapshot_created_at, discrepancy_count,
    has_discrepancy (generated).
  · TransferenciaDocumento (remisiones, BLs, DUAs, actas).
  · Evento.idempotence_token para prevenir transiciones duplicadas.
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


class TransicionCat(models.Model):
    """State machine explícita para transfers (quién puede ir de dónde a dónde)."""
    id             = models.UUIDField(primary_key=True)
    estado_from    = models.CharField(max_length=32)
    estado_to      = models.CharField(max_length=32)
    needs_approval = models.BooleanField(default=False)
    legal_context  = models.CharField(max_length=32, null=True, blank=True)
    descripcion    = models.TextField(null=True, blank=True)
    orden          = models.IntegerField(default=100)
    is_active      = models.BooleanField(default=True)
    created_at     = models.DateTimeField(auto_now_add=True)
    class Meta:
        managed  = False
        db_table = 'transfers"."transicion_cat'
        ordering = ("orden",)


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

    # ── Extensiones BLOQUE 3 ──────────────────────────────
    reconciled_by_id    = models.UUIDField(null=True, blank=True)
    reconciled_by_name  = models.CharField(max_length=128, null=True, blank=True)
    reconciled_at       = models.DateTimeField(null=True, blank=True)
    reconciled_note     = models.TextField(null=True, blank=True)
    snapshot_created_at = models.DateTimeField(null=True, blank=True)
    discrepancy_count   = models.IntegerField(default=0)
    has_discrepancy     = models.BooleanField(default=False)  # columna GENERATED en DB

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

    # ── Extensiones BLOQUE 3 ──────────────────────────────
    tolerancia_pct       = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    estado_discrepancia  = models.CharField(max_length=32, null=True, blank=True)
    snapshot_unit_cost   = models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True)
    snapshot_created_at  = models.DateTimeField(null=True, blank=True)

    is_active        = models.BooleanField(default=True)
    created_at       = models.DateTimeField(auto_now_add=True)
    updated_at       = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'transfers"."linea'


# ── Evento (audit trail) ─────────────────────────────────────
class Evento(models.Model):
    id                = models.UUIDField(primary_key=True)
    transferencia_id  = models.UUIDField()
    estado_prev       = models.CharField(max_length=32, null=True, blank=True)
    estado_nuevo      = models.CharField(max_length=32)
    actor_id          = models.UUIDField(null=True, blank=True)
    actor_name        = models.CharField(max_length=128, null=True, blank=True)
    notes             = models.TextField(null=True, blank=True)
    idempotence_token = models.CharField(max_length=64, null=True, blank=True)
    is_active         = models.BooleanField(default=True)
    created_at        = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed  = False
        db_table = 'transfers"."evento'
        ordering = ("-created_at",)


# ── Documento de transporte (BLOQUE 3) ───────────────────────
class TransferenciaDocumento(models.Model):
    id                = models.UUIDField(primary_key=True)
    transferencia_id  = models.UUIDField()                              # ⛔ sin FK
    tipo              = models.CharField(max_length=32)
    # REMISION / BL / DUA / FACTURA / ACTA_RECEPCION / FOTO / OTRO
    titulo            = models.CharField(max_length=255, null=True, blank=True)
    url               = models.TextField(null=True, blank=True)
    bucket            = models.CharField(max_length=64, null=True, blank=True)
    object_key        = models.CharField(max_length=512, null=True, blank=True)
    content_type      = models.CharField(max_length=64, null=True, blank=True)
    size_bytes        = models.BigIntegerField(null=True, blank=True)

    numero_ref        = models.CharField(max_length=64, null=True, blank=True)
    fecha_emision     = models.DateField(null=True, blank=True)
    descripcion       = models.TextField(null=True, blank=True)

    uploaded_by       = models.UUIDField(null=True, blank=True)         # ⛔ sin FK
    uploaded_by_name  = models.CharField(max_length=128, null=True, blank=True)

    is_active         = models.BooleanField(default=True)
    created_at        = models.DateTimeField(auto_now_add=True)
    updated_at        = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'transfers"."transferencia_documento'
        ordering = ("-created_at",)
