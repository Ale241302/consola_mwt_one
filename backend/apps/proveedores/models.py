"""
=====================================================================
MWT.ONE · apps.proveedores.models
Agente responsable: [AG-BACKEND]
Tabla creada por [AG-DATABASE] en backend/sql/50_proveedores.sql
Extensiones + satélites creados por 51_proveedores_audit.sql.
=====================================================================
"""
from django.db import models


class Proveedor(models.Model):
    id                = models.UUIDField(primary_key=True)
    codigo            = models.CharField(max_length=32, null=True, blank=True, unique=True)
    razon_social      = models.CharField(max_length=192)
    nombre_comercial  = models.CharField(max_length=160, null=True, blank=True)
    tax_id            = models.CharField(max_length=48,  null=True, blank=True)
    tipo              = models.CharField(max_length=24,  default="FABRICANTE")
    estado            = models.CharField(max_length=16,  default="PROSPECTO")

    pais_iso2         = models.CharField(max_length=2, null=True, blank=True)
    ciudad            = models.CharField(max_length=96, null=True, blank=True)
    direccion         = models.TextField(null=True, blank=True)
    zona_horaria      = models.CharField(max_length=64, null=True, blank=True)

    contacto_nombre   = models.CharField(max_length=96,  null=True, blank=True)
    contacto_email    = models.CharField(max_length=254, null=True, blank=True)
    contacto_tel      = models.CharField(max_length=32,  null=True, blank=True)
    web               = models.CharField(max_length=160, null=True, blank=True)

    moneda_default    = models.CharField(max_length=3, default="USD")
    incoterm_default  = models.CharField(max_length=8, default="EXW")
    lead_time_dias    = models.IntegerField(default=0)
    moq               = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    condiciones_pago  = models.CharField(max_length=96, null=True, blank=True)
    dias_credito      = models.IntegerField(default=0)

    rating            = models.DecimalField(max_digits=3, decimal_places=2, default=0)
    nps               = models.IntegerField(null=True, blank=True)
    notas_internas    = models.TextField(null=True, blank=True)
    categorias        = models.JSONField(default=list, blank=True)
    certificaciones   = models.JSONField(default=list, blank=True)

    responsable_id    = models.UUIDField(null=True, blank=True)    # ⛔ sin FK
    visibility_tier   = models.CharField(max_length=16, default="INTERNAL")

    # Extensiones 51_proveedores_audit.sql §1:
    clase             = models.CharField(max_length=16, null=True, blank=True)
                         # CRITICO / NORMAL / EVENTUAL
    score_iso         = models.DecimalField(max_digits=3, decimal_places=1, null=True, blank=True)
    producto_servicio = models.TextField(null=True, blank=True)

    is_active         = models.BooleanField(default=True)
    created_at        = models.DateTimeField(auto_now_add=True)
    updated_at        = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = 'proveedores"."proveedor'


class TipoCat(models.Model):
    codigo    = models.CharField(max_length=24, primary_key=True)
    label     = models.CharField(max_length=48)
    color     = models.CharField(max_length=16, null=True, blank=True)
    orden     = models.IntegerField(default=100)
    is_active = models.BooleanField(default=True)
    class Meta:
        managed = False
        db_table = 'proveedores"."tipo_cat'
        ordering = ("orden", "label")


class EstadoCat(models.Model):
    codigo    = models.CharField(max_length=16, primary_key=True)
    label     = models.CharField(max_length=48)
    color     = models.CharField(max_length=16, null=True, blank=True)
    orden     = models.IntegerField(default=100)
    is_active = models.BooleanField(default=True)
    class Meta:
        managed = False
        db_table = 'proveedores"."estado_cat'
        ordering = ("orden", "label")


class IncotermCat(models.Model):
    codigo      = models.CharField(max_length=8, primary_key=True)
    label       = models.CharField(max_length=64)
    descripcion = models.TextField(null=True, blank=True)
    orden       = models.IntegerField(default=100)
    is_active   = models.BooleanField(default=True)
    class Meta:
        managed = False
        db_table = 'proveedores"."incoterm_cat'
        ordering = ("orden", "label")


class ClaseCat(models.Model):
    """CRITICO / NORMAL / EVENTUAL — 51_proveedores_audit.sql."""
    codigo    = models.CharField(max_length=16, primary_key=True)
    label     = models.CharField(max_length=48)
    color     = models.CharField(max_length=16, null=True, blank=True)
    orden     = models.IntegerField(default=100)
    is_active = models.BooleanField(default=True)
    class Meta:
        managed = False
        db_table = 'proveedores"."clase_cat'
        ordering = ("orden", "label")


class ScoreIsoCat(models.Model):
    """Escala 0.0 — 5.0 con label narrativo — 51_proveedores_audit.sql."""
    codigo = models.DecimalField(max_digits=3, decimal_places=1, primary_key=True)
    label  = models.CharField(max_length=48)
    orden  = models.IntegerField(default=100)
    class Meta:
        managed = False
        db_table = 'proveedores"."score_iso_cat'
        ordering = ("codigo",)


class SupplierPromoCode(models.Model):
    """Códigos promocionales (por volumen / vigencia) — 51_proveedores_audit.sql."""
    id              = models.UUIDField(primary_key=True)
    proveedor_id    = models.UUIDField()                            # ⛔ sin FK
    codigo          = models.CharField(max_length=32)
    descripcion     = models.TextField(null=True, blank=True)

    tipo_descuento  = models.CharField(max_length=16, default='PCT')
                        # PCT / FIXED / VOLUMEN / COMBO
    valor_pct       = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    valor_fijo_usd  = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    min_volumen     = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    max_volumen     = models.DecimalField(max_digits=14, decimal_places=3, null=True, blank=True)

    vigente_desde   = models.DateField(null=True, blank=True)
    vigente_hasta   = models.DateField(null=True, blank=True)

    max_usos        = models.IntegerField(null=True, blank=True)
    usos_actuales   = models.IntegerField(default=0)

    scope           = models.CharField(max_length=16, default='GLOBAL')
                        # GLOBAL / CATEGORIA / PRODUCTO / CLIENTE
    scope_ids       = models.JSONField(default=list, blank=True)
    reglas_json     = models.JSONField(default=dict, blank=True)

    is_active       = models.BooleanField(default=True)
    created_by      = models.UUIDField(null=True, blank=True)      # ⛔ sin FK
    created_at      = models.DateTimeField(auto_now_add=True)
    updated_at      = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'proveedores"."supplier_promo_code'
        ordering = ("-created_at",)


class SupplierAuditEvent(models.Model):
    """Log append-only de eventos relevantes del proveedor — 51_proveedores_audit.sql."""
    id                  = models.UUIDField(primary_key=True)
    proveedor_id        = models.UUIDField()                        # ⛔ sin FK
    evento_tipo         = models.CharField(max_length=32)
                           # PRICE_CHANGE / LEADTIME_CHANGE / MOQ_CHANGE / ISO_CHANGE /
                           # CONTACT_CHANGE / STATUS_CHANGE / NOTE / OTHER
    entidad_afectada    = models.CharField(max_length=64, null=True, blank=True)
    entidad_id          = models.UUIDField(null=True, blank=True)   # ⛔ sin FK
    valor_anterior      = models.TextField(null=True, blank=True)
    valor_nuevo         = models.TextField(null=True, blank=True)
    descripcion         = models.TextField(null=True, blank=True)
    payload_json        = models.JSONField(default=dict, blank=True)

    actor_id            = models.UUIDField(null=True, blank=True)   # ⛔ sin FK
    actor_type          = models.CharField(max_length=16, default='USER')
                           # USER / BOT / SYSTEM

    is_active           = models.BooleanField(default=True)
    created_at          = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed  = False
        db_table = 'proveedores"."supplier_audit_event'
        ordering = ("-created_at",)


class SupplierImportLog(models.Model):
    """Subida masiva de catálogo de proveedor — 2-step preview/commit."""
    id                = models.UUIDField(primary_key=True)
    proveedor_id      = models.UUIDField()                          # ⛔ sin FK
    filename          = models.CharField(max_length=255, null=True, blank=True)
    total_rows        = models.IntegerField(default=0)
    valid_rows        = models.IntegerField(default=0)
    invalid_rows      = models.IntegerField(default=0)

    mapping_json      = models.JSONField(default=dict, blank=True)
    preview_json      = models.JSONField(default=list, blank=True)
    errors_json       = models.JSONField(default=list, blank=True)

    status            = models.CharField(max_length=16, default='VALIDATING')
                         # VALIDATING / VALID / PARTIAL / COMMITTED / REJECTED / FAILED
    committed_rows    = models.IntegerField(default=0)
    idempotence_token = models.CharField(max_length=64, null=True, blank=True)

    started_by        = models.UUIDField(null=True, blank=True)     # ⛔ sin FK
    committed_at      = models.DateTimeField(null=True, blank=True)
    is_active         = models.BooleanField(default=True)
    created_at        = models.DateTimeField(auto_now_add=True)
    updated_at        = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'proveedores"."supplier_import_log'
        ordering = ("-created_at",)


class SupplierCertificacion(models.Model):
    """Certificaciones ISO con vencimientos — 51_proveedores_audit.sql."""
    id                = models.UUIDField(primary_key=True)
    proveedor_id      = models.UUIDField()                          # ⛔ sin FK
    tipo              = models.CharField(max_length=32)
                         # ISO_9001 / ISO_14001 / ISO_45001 / ISO_20345 / OTHER
    descripcion       = models.TextField(null=True, blank=True)
    numero_certif     = models.CharField(max_length=64, null=True, blank=True)
    fecha_emision     = models.DateField(null=True, blank=True)
    fecha_vencimiento = models.DateField(null=True, blank=True)
    alert_dias_antes  = models.IntegerField(default=60)
    documento_url     = models.CharField(max_length=500, null=True, blank=True)

    is_active         = models.BooleanField(default=True)
    created_at        = models.DateTimeField(auto_now_add=True)
    updated_at        = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'proveedores"."supplier_certificacion'
        ordering = ("-fecha_vencimiento",)
