"""
=====================================================================
MWT.ONE · apps.finance.models
Agente responsable: [AG-BACKEND]
Tablas creadas por [AG-DATABASE] en backend/sql/B6_finance_v2.sql

Convenciones del repo:
  · `managed = False` (la DB la gestiona AG-DATABASE con SQL crudo)
  · `db_table = 'schema"."tabla'` (notar las dobles comillas para
    que Django no escape el dot del schema)
  · Sin FKs reales · vínculos por UUIDField sin to=

Modelos:
  · Payment             — transacción contable atómica
  · PaymentApplication  — descomposición (Σ aplicado == Payment.monto)
  · PaymentEvidence     — comprobante (PDF/imagen) en MinIO
  · FinanceActivityLog  — audit append-only (UPDATE/DELETE bloqueados
                          por trigger en Postgres)
=====================================================================
"""
from django.db import models

from .enums import (
    PaymentMethod, PaymentType, PaymentStatus, PaymentApplicableType,
    AIVerdictStatus,
)


# ════════════════════════════════════════════════════════════
# Catálogos (espejo de finance.*_cat)
# ════════════════════════════════════════════════════════════
class MetodoCat(models.Model):
    codigo            = models.CharField(max_length=32, primary_key=True)
    label             = models.CharField(max_length=64)
    requires_evidence = models.BooleanField(default=True)
    orden             = models.IntegerField(default=100)
    is_active         = models.BooleanField(default=True)

    class Meta:
        managed  = False
        db_table = 'finance"."metodo_cat'
        ordering = ("orden", "label")


class TipoPagoCat(models.Model):
    codigo    = models.CharField(max_length=16, primary_key=True)
    label     = models.CharField(max_length=64)
    orden     = models.IntegerField(default=100)
    is_active = models.BooleanField(default=True)

    class Meta:
        managed  = False
        db_table = 'finance"."tipo_pago_cat'
        ordering = ("orden", "label")


class EstadoPagoCat(models.Model):
    codigo    = models.CharField(max_length=32, primary_key=True)
    label     = models.CharField(max_length=64)
    color     = models.CharField(max_length=16, null=True, blank=True)
    orden     = models.IntegerField(default=100)
    is_active = models.BooleanField(default=True)

    class Meta:
        managed  = False
        db_table = 'finance"."estado_pago_cat'
        ordering = ("orden", "label")


class ApplicableTypeCat(models.Model):
    codigo    = models.CharField(max_length=16, primary_key=True)
    label     = models.CharField(max_length=64)
    orden     = models.IntegerField(default=100)
    is_active = models.BooleanField(default=True)

    class Meta:
        managed  = False
        db_table = 'finance"."applicable_type_cat'
        ordering = ("orden", "label")


# ════════════════════════════════════════════════════════════
# Payment
# ════════════════════════════════════════════════════════════
class Payment(models.Model):
    id                 = models.UUIDField(primary_key=True)
    codigo             = models.CharField(max_length=32, unique=True)
    expediente_id      = models.UUIDField(null=True, blank=True)
    client_id          = models.UUIDField(null=True, blank=True)
    monto              = models.DecimalField(max_digits=14, decimal_places=2)
    moneda             = models.CharField(max_length=3, default="USD")
    tasa_cambio_a_usd  = models.DecimalField(max_digits=12, decimal_places=6, default=1)
    monto_usd          = models.DecimalField(max_digits=14, decimal_places=2, default=0)  # GENERATED en DB
    fecha              = models.DateField()
    metodo             = models.CharField(max_length=32, choices=PaymentMethod.choices)
    tipo_pago          = models.CharField(max_length=16, choices=PaymentType.choices)
    referencia         = models.CharField(max_length=64)
    estado             = models.CharField(
        max_length=32, choices=PaymentStatus.choices,
        default=PaymentStatus.PENDIENTE_AI,
    )
    notas              = models.TextField(null=True, blank=True)
    created_by         = models.UUIDField(null=True, blank=True)
    confirmed_at       = models.DateTimeField(null=True, blank=True)
    confirmed_by       = models.UUIDField(null=True, blank=True)
    reverted_at        = models.DateTimeField(null=True, blank=True)
    reverted_by        = models.UUIDField(null=True, blank=True)
    reverted_reason    = models.TextField(null=True, blank=True)
    event_id           = models.UUIDField(unique=True)
    metadata           = models.JSONField(default=dict, blank=True)
    is_active          = models.BooleanField(default=True)
    created_at         = models.DateTimeField(auto_now_add=False)
    updated_at         = models.DateTimeField(auto_now=False)

    class Meta:
        managed  = False
        db_table = 'finance"."payment'
        ordering = ("-created_at",)


# ════════════════════════════════════════════════════════════
# PaymentApplication
# ════════════════════════════════════════════════════════════
class PaymentApplication(models.Model):
    id                = models.UUIDField(primary_key=True)
    payment_id        = models.UUIDField()
    applicable_type   = models.CharField(max_length=16, choices=PaymentApplicableType.choices)
    applicable_id     = models.UUIDField()
    applicable_code   = models.CharField(max_length=64, null=True, blank=True)
    cantidad_producto = models.IntegerField(null=True, blank=True)
    monto_aplicado    = models.DecimalField(max_digits=14, decimal_places=2)
    metadata          = models.JSONField(default=dict, blank=True)
    created_at        = models.DateTimeField(auto_now_add=False)

    class Meta:
        managed  = False
        db_table = 'finance"."payment_application'
        ordering = ("created_at",)


# ════════════════════════════════════════════════════════════
# PaymentEvidence
# ════════════════════════════════════════════════════════════
class PaymentEvidence(models.Model):
    id            = models.UUIDField(primary_key=True)
    payment_id    = models.UUIDField(unique=True)
    bucket        = models.CharField(max_length=64, default="mwt-one")
    object_key    = models.TextField()
    mime_type     = models.CharField(max_length=64)
    size_bytes    = models.BigIntegerField()
    sha256        = models.CharField(max_length=64, null=True, blank=True)
    original_name = models.CharField(max_length=255, null=True, blank=True)
    uploaded_by   = models.UUIDField(null=True, blank=True)
    uploaded_at   = models.DateTimeField(auto_now_add=False)

    class Meta:
        managed  = False
        db_table = 'finance"."payment_evidence'


# ════════════════════════════════════════════════════════════
# AIVerdictStatusCat (catálogo)
# ════════════════════════════════════════════════════════════
class AIVerdictStatusCat(models.Model):
    codigo    = models.CharField(max_length=16, primary_key=True)
    label     = models.CharField(max_length=96)
    color     = models.CharField(max_length=16, null=True, blank=True)
    severity  = models.IntegerField(default=0)
    orden     = models.IntegerField(default=100)
    is_active = models.BooleanField(default=True)

    class Meta:
        managed  = False
        db_table = 'finance"."ai_verdict_status_cat'
        ordering = ("orden", "label")


# ════════════════════════════════════════════════════════════
# PaymentAIVerdict · resultado del AIPaymentAnalyzer (Fase 3)
# Append-only de hecho: cada re-análisis crea una fila nueva
# y un trigger Postgres desmarca el `is_current` anterior.
# ════════════════════════════════════════════════════════════
class PaymentAIVerdict(models.Model):
    id                    = models.UUIDField(primary_key=True)
    payment_id            = models.UUIDField()
    is_current            = models.BooleanField(default=True)
    status                = models.CharField(max_length=16, choices=AIVerdictStatus.choices)
    confianza             = models.DecimalField(max_digits=5, decimal_places=2)
    monto_extraido        = models.DecimalField(max_digits=14, decimal_places=2,
                                                null=True, blank=True)
    moneda_extraida       = models.CharField(max_length=3, null=True, blank=True)
    fecha_extraida        = models.DateField(null=True, blank=True)
    referencia_extraida   = models.CharField(max_length=128, null=True, blank=True)
    beneficiario_extraido = models.CharField(max_length=255, null=True, blank=True)
    ordenante_extraido    = models.CharField(max_length=255, null=True, blank=True)
    banco_emisor          = models.CharField(max_length=255, null=True, blank=True)
    banco_receptor        = models.CharField(max_length=255, null=True, blank=True)
    concepto              = models.TextField(null=True, blank=True)
    mismatch_fields       = models.JSONField(default=list, blank=True)
    razon_humana          = models.TextField()
    alertas_fraude        = models.JSONField(default=list, blank=True)
    raw_claude_response   = models.JSONField(default=dict, blank=True)
    model_version         = models.CharField(max_length=64)
    skill_version         = models.CharField(max_length=16, null=True, blank=True)
    duration_ms           = models.IntegerField(null=True, blank=True)
    tokens_input          = models.IntegerField(null=True, blank=True)
    tokens_output         = models.IntegerField(null=True, blank=True)
    cost_usd              = models.DecimalField(max_digits=10, decimal_places=6,
                                                null=True, blank=True)
    error_code            = models.CharField(max_length=64, null=True, blank=True)
    error_message         = models.TextField(null=True, blank=True)
    analyzed_at           = models.DateTimeField()

    class Meta:
        managed  = False
        db_table = 'finance"."payment_ai_verdict'
        ordering = ("-analyzed_at",)


# ════════════════════════════════════════════════════════════
# FinanceActivityLog · APPEND-ONLY (UPDATE/DELETE bloqueados)
# ════════════════════════════════════════════════════════════
class FinanceActivityLog(models.Model):
    id           = models.UUIDField(primary_key=True)
    actor_id     = models.UUIDField(null=True, blank=True)
    actor_role   = models.CharField(max_length=32, null=True, blank=True)
    action       = models.CharField(max_length=64)
    target_type  = models.CharField(max_length=32)
    target_id    = models.UUIDField()
    payload_diff = models.JSONField(default=dict, blank=True)
    metadata     = models.JSONField(default=dict, blank=True)
    created_at   = models.DateTimeField(auto_now_add=False)

    class Meta:
        managed  = False
        db_table = 'finance"."activity_log'
        ordering = ("-created_at",)
