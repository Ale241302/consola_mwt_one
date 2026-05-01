"""
=====================================================================
MWT.ONE · apps.expedientes.models
Agente responsable: [AG-BACKEND]
Tablas creadas por [AG-DATABASE] en backend/sql/70_expedientes.sql
Sin Foreign Keys gestionadas por Postgres — vínculos por UUID.
=====================================================================
"""
from django.db import models


# ── Catálogos ────────────────────────────────────────────────
class EstadoOcCat(models.Model):
    codigo    = models.CharField(max_length=32, primary_key=True)
    label     = models.CharField(max_length=64)
    color     = models.CharField(max_length=16, null=True, blank=True)
    orden     = models.IntegerField(default=100)
    is_active = models.BooleanField(default=True)
    class Meta:
        managed = False
        db_table = 'expedientes"."estado_oc_cat'
        ordering = ("orden", "label")


class EstadoExpedienteCat(models.Model):
    codigo        = models.CharField(max_length=32, primary_key=True)
    label         = models.CharField(max_length=64)
    color         = models.CharField(max_length=16, null=True, blank=True)
    orden         = models.IntegerField(default=100)
    baseline_dias = models.IntegerField(default=10)
    is_active     = models.BooleanField(default=True)
    class Meta:
        managed = False
        db_table = 'expedientes"."estado_expediente_cat'
        ordering = ("orden", "label")


class ModoOperacionCat(models.Model):
    codigo      = models.CharField(max_length=16, primary_key=True)
    label       = models.CharField(max_length=64)
    descripcion = models.TextField(null=True, blank=True)
    is_active   = models.BooleanField(default=True)
    class Meta:
        managed = False
        db_table = 'expedientes"."modo_operacion_cat'
        ordering = ("label",)


class IncotermCat(models.Model):
    codigo      = models.CharField(max_length=8, primary_key=True)
    label       = models.CharField(max_length=64)
    descripcion = models.TextField(null=True, blank=True)
    orden       = models.IntegerField(default=100)
    is_active   = models.BooleanField(default=True)
    class Meta:
        managed = False
        db_table = 'expedientes"."incoterm_cat'
        ordering = ("orden", "label")


# ── OC ───────────────────────────────────────────────────────
class Oc(models.Model):
    id              = models.UUIDField(primary_key=True)
    codigo          = models.CharField(max_length=32, unique=True)
    client_id       = models.UUIDField(null=True, blank=True)
    brand_id        = models.UUIDField(null=True, blank=True)
    proveedor_id    = models.UUIDField(null=True, blank=True)   # ⛔ sin FK (71_oc_proveedor.sql)
    proforma        = models.CharField(max_length=32, null=True, blank=True)
    sap             = models.CharField(max_length=32, null=True, blank=True)
    estado          = models.CharField(max_length=32, default="EMITIDA")
    moneda          = models.CharField(max_length=3,  default="USD")
    issued_at       = models.DateField(null=True, blank=True)

    total_value     = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total_invoiced  = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total_paid      = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    balance         = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    coverage_pct    = models.DecimalField(max_digits=5,  decimal_places=4, default=0)
    lines_count     = models.IntegerField(default=0)
    lines_with_sap  = models.IntegerField(default=0)
    air_pct         = models.DecimalField(max_digits=5, decimal_places=4, default=0)
    sea_pct         = models.DecimalField(max_digits=5, decimal_places=4, default=0)
    credit_days_max = models.IntegerField(default=0)
    credit_band     = models.CharField(max_length=16, null=True, blank=True)
    notas           = models.TextField(null=True, blank=True)
    visibility_tier = models.CharField(max_length=16, default="INTERNAL")

    is_active       = models.BooleanField(default=True)
    created_at      = models.DateTimeField(auto_now_add=True)
    updated_at      = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = 'expedientes"."oc'


# ── Expediente ───────────────────────────────────────────────
class Expediente(models.Model):
    id                  = models.UUIDField(primary_key=True)
    codigo              = models.CharField(max_length=32, unique=True)
    oc_id               = models.UUIDField(null=True, blank=True)
    client_id           = models.UUIDField(null=True, blank=True)
    brand_id            = models.UUIDField(null=True, blank=True)
    sap                 = models.CharField(max_length=32, null=True, blank=True)
    estado              = models.CharField(max_length=32, default="REGISTRO")
    modo_operacion      = models.CharField(max_length=16, default="FULL")
    incoterm            = models.CharField(max_length=8, null=True, blank=True)
    freight_mode        = models.CharField(max_length=8, null=True, blank=True)
    dispatch_mode       = models.CharField(max_length=8, null=True, blank=True)
    origin              = models.CharField(max_length=128, null=True, blank=True)
    destination         = models.CharField(max_length=128, null=True, blank=True)
    origin_country      = models.CharField(max_length=2,   null=True, blank=True)
    destination_country = models.CharField(max_length=2,   null=True, blank=True)
    shipment_date       = models.DateField(null=True, blank=True)
    eta                 = models.DateField(null=True, blank=True)
    container_count     = models.IntegerField(default=0)
    product_count       = models.IntegerField(default=0)

    moneda              = models.CharField(max_length=3, default="USD")
    total_cost          = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total_invoiced      = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total_paid          = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    balance             = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    commission_pct      = models.DecimalField(max_digits=5,  decimal_places=4, null=True, blank=True)
    dai_pct             = models.DecimalField(max_digits=5,  decimal_places=4, null=True, blank=True)
    iva_pct             = models.DecimalField(max_digits=5,  decimal_places=4, null=True, blank=True)
    dai_amount          = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    iva_amount          = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    logistic_cost       = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    base_price          = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    deferred_total_price= models.DecimalField(max_digits=14, decimal_places=2, default=0)
    show_deferred_to_client = models.BooleanField(default=False)
    projected_margin    = models.DecimalField(max_digits=6, decimal_places=4, null=True, blank=True)
    real_margin         = models.DecimalField(max_digits=6, decimal_places=4, null=True, blank=True)
    margin_drift        = models.DecimalField(max_digits=6, decimal_places=4, null=True, blank=True)

    pg_verified         = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    pg_released         = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    pg_pending          = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    pg_rejected         = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    credit_days         = models.IntegerField(default=0)
    credit_band         = models.CharField(max_length=16, null=True, blank=True)
    is_blocked          = models.BooleanField(default=False)
    block_reason        = models.CharField(max_length=128, null=True, blank=True)
    block_cause         = models.CharField(max_length=32, null=True, blank=True)
    factory_delay       = models.BooleanField(default=False)
    artifacts_done      = models.IntegerField(default=0)
    artifacts_total     = models.IntegerField(default=6)

    baseline_days       = models.IntegerField(default=10)
    time_in_phase       = models.IntegerField(default=0)
    phase_ratio         = models.DecimalField(max_digits=6, decimal_places=3, default=0)
    phase_signal        = models.CharField(max_length=16, null=True, blank=True)
    last_event_at       = models.DateTimeField(null=True, blank=True)

    cost_corrections    = models.BooleanField(default=False)
    proforma_reviewed   = models.BooleanField(default=False)
    notas               = models.TextField(null=True, blank=True)
    visibility_tier     = models.CharField(max_length=16, default="INTERNAL")

    is_active           = models.BooleanField(default=True)
    created_at          = models.DateTimeField(auto_now_add=True)
    updated_at          = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = 'expedientes"."expediente'


# ── Línea de OC ──────────────────────────────────────────────
class Linea(models.Model):
    id                      = models.UUIDField(primary_key=True)
    oc_id                   = models.UUIDField()
    expediente_id           = models.UUIDField(null=True, blank=True)
    producto_id             = models.UUIDField(null=True, blank=True)
    sku                     = models.CharField(max_length=64, null=True, blank=True)
    size                    = models.CharField(max_length=16, null=True, blank=True)
    qty                     = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    unit_cost               = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    unit_price              = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    total_price             = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    sap                     = models.CharField(max_length=32, null=True, blank=True)
    transport_mode          = models.CharField(max_length=16, null=True, blank=True)
    production_date         = models.DateField(null=True, blank=True)
    estado                  = models.CharField(max_length=32, default="PENDIENTE_SAP")
    deferred_qty            = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    deferred_unit_price     = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    show_deferred_to_client = models.BooleanField(default=False)
    notas                   = models.TextField(null=True, blank=True)

    is_active               = models.BooleanField(default=True)
    created_at              = models.DateTimeField(auto_now_add=True)
    updated_at              = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = 'expedientes"."linea'


# ── Documento ────────────────────────────────────────────────
class Documento(models.Model):
    id               = models.UUIDField(primary_key=True)
    oc_id            = models.UUIDField(null=True, blank=True)
    expediente_id    = models.UUIDField(null=True, blank=True)
    kind             = models.CharField(max_length=64)
    codigo           = models.CharField(max_length=96, null=True, blank=True)
    file_ext         = models.CharField(max_length=16, null=True, blank=True)
    file_size_bytes  = models.BigIntegerField(default=0)
    storage_url      = models.TextField(null=True, blank=True)
    author           = models.CharField(max_length=128, null=True, blank=True)
    fecha            = models.DateField(null=True, blank=True)

    is_active        = models.BooleanField(default=True)
    created_at       = models.DateTimeField(auto_now_add=True)
    updated_at       = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = 'expedientes"."documento'


# ══════════════════════════════════════════════════════════════
# PIPELINE (BLOQUE 4) · schema "pipeline"
#   Tablas creadas por 94_pipeline_financiero_portal.sql +
#   96b_pipeline_audit.sql. Expuestas desde expedientes app
#   porque el motor de fases vive del lado de expedientes.
# ══════════════════════════════════════════════════════════════
class TransicionCat(models.Model):
    id                 = models.UUIDField(primary_key=True)
    fase_from          = models.CharField(max_length=32)
    fase_to            = models.CharField(max_length=32)
    label              = models.CharField(max_length=128)
    requiere_rol       = models.CharField(max_length=32, null=True, blank=True)
    requiere_documento = models.CharField(max_length=32, null=True, blank=True)
    is_rollback        = models.BooleanField(default=False)
    orden              = models.IntegerField(default=100)
    is_active          = models.BooleanField(default=True)

    class Meta:
        managed = False
        db_table = 'pipeline"."transicion_cat'
        ordering = ("orden", "fase_from", "fase_to")


class EventLog(models.Model):
    id                = models.UUIDField(primary_key=True)
    correlation_id    = models.UUIDField(null=True, blank=True)
    event_type        = models.CharField(max_length=64)
    aggregate_type    = models.CharField(max_length=32)
    aggregate_id      = models.UUIDField()
    action_source     = models.CharField(max_length=16, null=True, blank=True)
    previous_status   = models.CharField(max_length=32, null=True, blank=True)
    new_status        = models.CharField(max_length=32, null=True, blank=True)
    phase_from        = models.CharField(max_length=32, null=True, blank=True)
    phase_to          = models.CharField(max_length=32, null=True, blank=True)
    payload           = models.JSONField(default=dict)
    emitted_by_id     = models.UUIDField(null=True, blank=True)
    emitted_by_role   = models.CharField(max_length=32, null=True, blank=True)
    ip_address        = models.GenericIPAddressField(null=True, blank=True)
    user_agent        = models.TextField(null=True, blank=True)
    idempotence_token = models.CharField(max_length=64, null=True, blank=True)
    is_active         = models.BooleanField(default=True)
    created_at        = models.DateTimeField(auto_now_add=True)
    updated_at        = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = 'pipeline"."event_log'
        ordering = ("-created_at",)


class OcrParsingLog(models.Model):
    id                  = models.UUIDField(primary_key=True)
    expediente_id       = models.UUIDField()
    artifact_id         = models.UUIDField()
    artifact_tipo       = models.CharField(max_length=32)
    engine              = models.CharField(max_length=32, default="PAPERLESS_TIKA")
    engine_version      = models.CharField(max_length=32, null=True, blank=True)
    source_url          = models.TextField(null=True, blank=True)
    status              = models.CharField(max_length=16, default="QUEUED")
    started_at          = models.DateTimeField(null=True, blank=True)
    finished_at         = models.DateTimeField(null=True, blank=True)
    duration_ms         = models.IntegerField(null=True, blank=True)
    raw_text            = models.TextField(null=True, blank=True)
    parsed_payload      = models.JSONField(default=dict)
    confidence_score    = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    needs_human_review  = models.BooleanField(default=False)
    error_code          = models.CharField(max_length=64, null=True, blank=True)
    error_message       = models.TextField(null=True, blank=True)
    triggered_by        = models.UUIDField(null=True, blank=True)
    reviewed_by         = models.UUIDField(null=True, blank=True)
    reviewed_at         = models.DateTimeField(null=True, blank=True)
    is_active           = models.BooleanField(default=True)
    created_at          = models.DateTimeField(auto_now_add=True)
    updated_at          = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = 'expedientes"."ocr_parsing_log'
        ordering = ("-created_at",)


# ══════════════════════════════════════════════════════════════
# BUILDER ARTIFACTS · schema "expedientes"
#   Tabla creada por sql/B0_builder_artifacts.sql
#   Instancias de artefactos llenadas por el usuario, alimentadas
#   con templates dinámicos del Builder externo
#   (https://builder.muito.work).
#
#   Modelo simple:
#     · expediente_id  → vínculo con el expediente
#     · stage          → REGISTRO / PRODUCCION / … / CERRADO
#     · template_id    → ID del template en el Builder
#     · template_title → snapshot del título
#     · data           → JSONB con valores ingresados (key=field.id)
#     · structure_snapshot → snapshot de structure_json al crear
# ══════════════════════════════════════════════════════════════
class BuilderArtifactInstance(models.Model):
    STAGE_CHOICES = (
        ("REGISTRO",     "Registro"),
        ("PRODUCCION",   "Producción"),
        ("PREPARACION",  "Preparación"),
        ("DESPACHO",     "Despacho"),
        ("TRANSITO",     "Tránsito"),
        ("EN_DESTINO",   "En destino"),
        ("CERRADO",      "Cerrado"),
    )

    id                  = models.UUIDField(primary_key=True)
    expediente_id       = models.UUIDField()
    stage               = models.CharField(max_length=32, choices=STAGE_CHOICES)
    template_id         = models.IntegerField()
    template_title      = models.TextField()
    data                = models.JSONField(default=dict)
    structure_snapshot  = models.JSONField(default=dict)

    created_by_id       = models.UUIDField(null=True, blank=True)
    created_by_name     = models.CharField(max_length=128, null=True, blank=True)
    updated_by_id       = models.UUIDField(null=True, blank=True)
    updated_by_name     = models.CharField(max_length=128, null=True, blank=True)

    is_active           = models.BooleanField(default=True)
    created_at          = models.DateTimeField(auto_now_add=True)
    updated_at          = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'expedientes"."builder_artifact_instance'
        ordering = ("-created_at",)
