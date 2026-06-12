"""
=====================================================================
MWT.ONE · apps.cobros.models
Agente responsable: [AG-BACKEND]
Tablas creadas por [AG-DATABASE] en backend/sql/80_cobros.sql
+ extensiones BLOQUE 3 en backend/sql/81_cobros_audit.sql

BLOQUE 3 añade:
  · Pago:        external_id (unique), bank_statement_id, fx_source,
                 fx_rate_date, withholding_usd, fees_bank_usd,
                 monto_neto_usd (generated).
  · Cobro:       dias_mora, bucket_mora, intereses_mora_usd,
                 tasa_mora_anual, collection_stage, last_reminder_at.
  · Conciliacion: external_ref, idempotence_token, auto_matched, match_score.
  · Vencimiento: plan de pago T1/T2/T3 con monto_pendiente_usd generada.
  · WithholdingLog  — retenciones append-only.
  · FxRateHistory   — TC snapshots inmutables.
  · CollectionEvent — log del CollectionBot append-only.
  · Catálogos bucket_mora_cat y collection_stage_cat.
=====================================================================
"""
from django.db import models
from django.db.models import F, Value
from django.db.models.functions import Coalesce, Greatest


# ── Catálogos ────────────────────────────────────────────────
class MetodoCat(models.Model):
    codigo    = models.CharField(max_length=32, primary_key=True)
    label     = models.CharField(max_length=64)
    direccion = models.CharField(max_length=1, default="=")
    orden     = models.IntegerField(default=100)
    is_active = models.BooleanField(default=True)
    class Meta:
        managed = False
        db_table = 'cobros"."metodo_cat'
        ordering = ("orden", "label")


class EstadoPagoCat(models.Model):
    codigo    = models.CharField(max_length=32, primary_key=True)
    label     = models.CharField(max_length=64)
    color     = models.CharField(max_length=16, null=True, blank=True)
    orden     = models.IntegerField(default=100)
    is_active = models.BooleanField(default=True)
    class Meta:
        managed = False
        db_table = 'cobros"."estado_pago_cat'
        ordering = ("orden", "label")


class DireccionCat(models.Model):
    codigo    = models.CharField(max_length=16, primary_key=True)
    label     = models.CharField(max_length=64)
    is_active = models.BooleanField(default=True)
    class Meta:
        managed = False
        db_table = 'cobros"."direccion_cat'
        ordering = ("label",)


class BucketMoraCat(models.Model):
    codigo    = models.CharField(max_length=8, primary_key=True)
    label     = models.CharField(max_length=64)
    dias_min  = models.IntegerField()
    dias_max  = models.IntegerField(null=True, blank=True)
    color     = models.CharField(max_length=16, null=True, blank=True)
    orden     = models.IntegerField(default=100)
    is_active = models.BooleanField(default=True)
    class Meta:
        managed  = False
        db_table = 'cobros"."bucket_mora_cat'
        ordering = ("orden",)


class CollectionStageCat(models.Model):
    codigo       = models.CharField(max_length=32, primary_key=True)
    label        = models.CharField(max_length=96)
    descripcion  = models.TextField(null=True, blank=True)
    dias_trigger = models.IntegerField(null=True, blank=True)
    color        = models.CharField(max_length=16, null=True, blank=True)
    orden        = models.IntegerField(default=100)
    is_active    = models.BooleanField(default=True)
    class Meta:
        managed  = False
        db_table = 'cobros"."collection_stage_cat'
        ordering = ("orden",)


# ── Cobro ────────────────────────────────────────────────────
class Cobro(models.Model):
    id                = models.UUIDField(primary_key=True)
    codigo            = models.CharField(max_length=32, unique=True)
    oc_id             = models.UUIDField(null=True, blank=True)
    expediente_id     = models.UUIDField(null=True, blank=True)
    client_id         = models.UUIDField(null=True, blank=True)
    moneda            = models.CharField(max_length=3, default="USD")
    monto_total       = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    monto_pagado      = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    # Fable5-QA 2026-06-11: GENERATED ALWAYS en la DB — el ORM no debe
    # escribirla (antes: 500 GeneratedAlways en todo POST/PATCH).
    monto_pendiente   = models.GeneratedField(
        expression=Greatest(F("monto_total") - F("monto_pagado"), Value(0)),
        output_field=models.DecimalField(max_digits=14, decimal_places=2), db_persist=True)
    fecha_vencimiento = models.DateField(null=True, blank=True)
    dias_credito      = models.IntegerField(default=0)
    estado            = models.CharField(max_length=32, default="PENDIENTE")
    notas             = models.TextField(null=True, blank=True)
    visibility_tier   = models.CharField(max_length=16, default="INTERNAL")

    # ── Extensiones BLOQUE 3 ──────────────────────────────
    dias_mora          = models.IntegerField(default=0)
    bucket_mora        = models.CharField(max_length=8, null=True, blank=True)
    intereses_mora_usd = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    tasa_mora_anual    = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    collection_stage   = models.CharField(max_length=32, default="NONE")
    last_reminder_at   = models.DateTimeField(null=True, blank=True)

    is_active         = models.BooleanField(default=True)
    created_at        = models.DateTimeField(auto_now_add=True)
    updated_at        = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = 'cobros"."cobro'


# ── Pago ─────────────────────────────────────────────────────
class Pago(models.Model):
    id                 = models.UUIDField(primary_key=True)
    codigo             = models.CharField(max_length=32, unique=True)
    direccion          = models.CharField(max_length=16, default="INGRESO")
    cobro_id           = models.UUIDField(null=True, blank=True)
    oc_id              = models.UUIDField(null=True, blank=True)
    expediente_id      = models.UUIDField(null=True, blank=True)
    client_id          = models.UUIDField(null=True, blank=True)
    proveedor_id       = models.UUIDField(null=True, blank=True)
    metodo             = models.CharField(max_length=32, default="TRANSFERENCIA")
    referencia_externa = models.CharField(max_length=128, null=True, blank=True)
    banco_origen       = models.CharField(max_length=96, null=True, blank=True)
    banco_destino      = models.CharField(max_length=96, null=True, blank=True)
    moneda             = models.CharField(max_length=3, default="USD")
    monto              = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    fx_rate            = models.DecimalField(max_digits=12, decimal_places=6, default=1)
    monto_usd          = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    estado             = models.CharField(max_length=32, default="PENDIENTE")
    fecha_operacion    = models.DateField(null=True, blank=True)
    fecha_acreditacion = models.DateField(null=True, blank=True)
    verificado_at      = models.DateTimeField(null=True, blank=True)
    verificado_by      = models.UUIDField(null=True, blank=True)
    liberado_at        = models.DateTimeField(null=True, blank=True)
    conciliado_at      = models.DateTimeField(null=True, blank=True)
    comprobante_url    = models.TextField(null=True, blank=True)
    notas              = models.TextField(null=True, blank=True)
    visibility_tier    = models.CharField(max_length=16, default="INTERNAL")

    # ── Extensiones BLOQUE 3 ──────────────────────────────
    external_id       = models.CharField(max_length=128, null=True, blank=True)
    bank_statement_id = models.CharField(max_length=64,  null=True, blank=True)
    fx_source         = models.CharField(max_length=32,  default="MANUAL")
    fx_rate_date      = models.DateField(null=True, blank=True)
    withholding_usd   = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    fees_bank_usd     = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    monto_neto_usd    = models.GeneratedField(  # GENERATED ALWAYS (Fable5-QA)
        expression=F("monto_usd") - Coalesce(F("withholding_usd"), Value(0))
                   - Coalesce(F("fees_bank_usd"), Value(0)),
        output_field=models.DecimalField(max_digits=14, decimal_places=2), db_persist=True)

    is_active          = models.BooleanField(default=True)
    created_at         = models.DateTimeField(auto_now_add=True)
    updated_at         = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = 'cobros"."pago'


# ── Conciliación ─────────────────────────────────────────────
class Conciliacion(models.Model):
    id                = models.UUIDField(primary_key=True)
    pago_ingreso_id   = models.UUIDField()
    pago_egreso_id    = models.UUIDField(null=True, blank=True)
    cobro_id          = models.UUIDField(null=True, blank=True)
    monto_matched     = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    moneda            = models.CharField(max_length=3, default="USD")
    notas             = models.TextField(null=True, blank=True)

    # ── Extensiones BLOQUE 3 ──────────────────────────────
    external_ref      = models.CharField(max_length=128, null=True, blank=True)
    idempotence_token = models.CharField(max_length=64,  null=True, blank=True)
    auto_matched      = models.BooleanField(default=False)
    match_score       = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)

    is_active       = models.BooleanField(default=True)
    created_at      = models.DateTimeField(auto_now_add=True)
    updated_at      = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = 'cobros"."conciliacion'


# ── Plan de pago (Vencimientos T1/T2/T3) ─────────────────────
class Vencimiento(models.Model):
    id                  = models.UUIDField(primary_key=True)
    cobro_id            = models.UUIDField()                             # ⛔ sin FK
    tramo               = models.CharField(max_length=8)                 # T1 / T2 / T3
    pct_monto           = models.DecimalField(max_digits=5, decimal_places=2)
    monto_usd           = models.DecimalField(max_digits=14, decimal_places=2)
    fecha_vencimiento   = models.DateField()
    monto_pagado_usd    = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    monto_pendiente_usd = models.GeneratedField(  # GENERATED ALWAYS (Fable5-QA)
        expression=F("monto_usd") - Coalesce(F("monto_pagado_usd"), Value(0)),
        output_field=models.DecimalField(max_digits=14, decimal_places=2), db_persist=True)
    dias_mora           = models.IntegerField(default=0)
    estado              = models.CharField(max_length=16, default="PENDIENTE")
    notas               = models.TextField(null=True, blank=True)

    is_active  = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'cobros"."vencimiento'
        ordering = ("fecha_vencimiento",)


# ── Withholding log (append-only) ────────────────────────────
class WithholdingLog(models.Model):
    id                = models.UUIDField(primary_key=True)
    pago_id           = models.UUIDField()
    cobro_id          = models.UUIDField(null=True, blank=True)
    tipo              = models.CharField(max_length=32)
    # IGV / ITF / RENTA / DETRACCION / PERCEPCION / OTRO
    tasa_pct          = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    base_usd          = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    monto_usd         = models.DecimalField(max_digits=14, decimal_places=2)
    referencia_certif = models.CharField(max_length=128, null=True, blank=True)
    notas             = models.TextField(null=True, blank=True)
    payload_json      = models.JSONField(default=dict, blank=True)

    is_active  = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed  = False
        db_table = 'cobros"."withholding_log'
        ordering = ("-created_at",)


# ── FX Rate history (append-only) ────────────────────────────
class FxRateHistory(models.Model):
    id          = models.UUIDField(primary_key=True)
    fecha       = models.DateField()
    moneda_from = models.CharField(max_length=3)
    moneda_to   = models.CharField(max_length=3, default="USD")
    rate        = models.DecimalField(max_digits=12, decimal_places=6)
    source      = models.CharField(max_length=32)   # MANUAL / BCR / SBS / FIXER / ECB
    source_ref  = models.CharField(max_length=128, null=True, blank=True)
    is_active   = models.BooleanField(default=True)
    created_at  = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed  = False
        db_table = 'cobros"."fx_rate_history'
        ordering = ("-fecha",)


# ── CollectionBot event log (append-only) ────────────────────
class CollectionEvent(models.Model):
    id                 = models.UUIDField(primary_key=True)
    cobro_id           = models.UUIDField()                              # ⛔ sin FK
    client_id          = models.UUIDField(null=True, blank=True)
    canal              = models.CharField(max_length=16)
    # EMAIL / SMS / WHATSAPP / CALL / LETTER / LEGAL
    stage              = models.CharField(max_length=32)
    outcome            = models.CharField(max_length=32, null=True, blank=True)
    dias_mora_at_event = models.IntegerField(null=True, blank=True)
    monto_usd_at_event = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)

    template_id     = models.UUIDField(null=True, blank=True)
    notification_id = models.UUIDField(null=True, blank=True)
    actor_type      = models.CharField(max_length=16, default="BOT")
    actor_id        = models.UUIDField(null=True, blank=True)
    payload_json    = models.JSONField(default=dict, blank=True)

    is_active  = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed  = False
        db_table = 'cobros"."collection_event'
        ordering = ("-created_at",)
