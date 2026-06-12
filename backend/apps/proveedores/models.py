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
    razon_social      = models.CharField(max_length=192, null=True, blank=True)
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
    """Códigos promocionales (por volumen / vigencia) — 51_proveedores_audit.sql.

    OJO: el SQL real usa los nombres `descuento_pct`, `descuento_monto`,
    `vigencia_inicio`, `vigencia_fin`. Mantenemos los nombres Python que
    el frontend espera (valor_pct, vigente_desde, …) y mapeamos a la
    columna real con db_column=. Sin esto, el SELECT trona con 500.
    """
    id              = models.UUIDField(primary_key=True)
    proveedor_id    = models.UUIDField()                            # ⛔ sin FK
    codigo          = models.CharField(max_length=32)
    descripcion     = models.TextField(null=True, blank=True)

    tipo_descuento  = models.CharField(max_length=16, default='PCT')
                        # PCT / FIXED / VOLUMEN / COMBO
    valor_pct       = models.DecimalField(max_digits=5, decimal_places=2,
                                           null=True, blank=True,
                                           db_column='descuento_pct')
    valor_fijo_usd  = models.DecimalField(max_digits=14, decimal_places=2,
                                           null=True, blank=True,
                                           db_column='descuento_monto')
    moneda          = models.CharField(max_length=3, default='USD')
    min_volumen     = models.DecimalField(max_digits=14, decimal_places=3,
                                           null=True, blank=True)
    max_volumen     = models.DecimalField(max_digits=14, decimal_places=3,
                                           null=True, blank=True)

    vigente_desde   = models.DateField(null=True, blank=True,
                                        db_column='vigencia_inicio')
    vigente_hasta   = models.DateField(null=True, blank=True,
                                        db_column='vigencia_fin')

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
    campo               = models.CharField(max_length=64, null=True, blank=True)
    # NAMING FIX (QA): columnas reales = delta_resumen (text) y contexto_json
    # (jsonb); valor_anterior / valor_nuevo son jsonb (no text) en la DB.
    # Ningun consumidor de frontend usa /audit_log/, asi que renombramos el
    # atributo Python al nombre real de la columna en vez de mapear db_column=.
    valor_anterior      = models.JSONField(null=True, blank=True)
    valor_nuevo         = models.JSONField(null=True, blank=True)
    delta_resumen       = models.TextField(null=True, blank=True)
    contexto_json       = models.JSONField(default=dict, blank=True)

    actor_id            = models.UUIDField(null=True, blank=True)   # ⛔ sin FK
    actor_type          = models.CharField(max_length=16, default='USER')
                           # USER / BOT / SYSTEM
    ip_address          = models.CharField(max_length=64, null=True, blank=True)

    is_active           = models.BooleanField(default=True)
    created_at          = models.DateTimeField(auto_now_add=True)
    updated_at          = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'proveedores"."supplier_audit_event'
        ordering = ("-created_at",)


class SupplierImportLog(models.Model):
    """Subida masiva de catálogo de proveedor — 2-step preview/commit."""
    id                = models.UUIDField(primary_key=True)
    proveedor_id      = models.UUIDField()                          # ⛔ sin FK
    # NAMING FIX (QA): mismo drift que brands.BrandImportLog — columnas reales
    # rows_total/rows_valid/rows_invalid/rows_inserted/rows_updated + user_id/
    # committed_by/summary_json. idempotence_token NO existe como columna:
    # se persiste dentro de summary_json (jsonb) desde upload_catalogo_commit.
    filename          = models.CharField(max_length=255, null=True, blank=True)
    content_type      = models.CharField(max_length=128, null=True, blank=True)
    source_url        = models.TextField(null=True, blank=True)
    rows_total        = models.IntegerField(default=0)
    rows_valid        = models.IntegerField(default=0)
    rows_invalid      = models.IntegerField(default=0)
    rows_inserted     = models.IntegerField(default=0)
    rows_updated      = models.IntegerField(default=0)

    mapping_json      = models.JSONField(default=dict, blank=True)
    preview_json      = models.JSONField(default=list, blank=True)
    errors_json       = models.JSONField(default=list, blank=True)
    summary_json      = models.JSONField(default=dict, blank=True)

    status            = models.CharField(max_length=16, default='VALIDATING')
                         # VALIDATING / VALID / PARTIAL / COMMITTED / REJECTED / FAILED

    user_id           = models.UUIDField(null=True, blank=True)     # ⛔ sin FK
    committed_by      = models.UUIDField(null=True, blank=True)     # ⛔ sin FK
    committed_at      = models.DateTimeField(null=True, blank=True)
    is_active         = models.BooleanField(default=True)
    created_at        = models.DateTimeField(auto_now_add=True)
    updated_at        = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'proveedores"."supplier_import_log'
        ordering = ("-created_at",)


class SupplierIsoEvaluation(models.Model):
    """Auditoría ISO 9001:2015 §8.4 — evaluación periódica del proveedor.
    Tabla: 54_suppliers_iso_evaluations.sql.

    Los 5 score_* son ingresados por el evaluador (1..5).
    score_total y decision son CALCULADOS por el backend en el serializer
    (PLB_SUPPLIER_EVAL — el frontend NO puede setearlos).
    """
    id                  = models.UUIDField(primary_key=True)
    supplier_id         = models.UUIDField()                            # ⛔ sin FK
    evaluator_id        = models.UUIDField(null=True, blank=True)       # ⛔ sin FK

    periodo             = models.CharField(max_length=16)               # "Q2-2026"

    score_calidad       = models.SmallIntegerField()
    score_entrega       = models.SmallIntegerField()
    score_comunicacion  = models.SmallIntegerField()
    score_tecnica       = models.SmallIntegerField()
    score_precio        = models.SmallIntegerField()

    score_total         = models.DecimalField(max_digits=3, decimal_places=2)
    decision            = models.CharField(max_length=16)
                            # MANTENER / MONITOREAR / PLAN_MEJORA / DESCONTINUAR

    comentarios         = models.TextField(null=True, blank=True)
    documento_evidencia = models.CharField(max_length=500, null=True, blank=True)

    is_active           = models.BooleanField(default=True)
    created_at          = models.DateTimeField(auto_now_add=True)
    updated_at          = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'proveedores"."suppliers_iso_evaluations'
        ordering = ("-created_at",)


class SupplierProductAssignment(models.Model):
    """Catálogo de abastecimiento — qué SKUs MWT le compramos a este
    proveedor, con el precio FOB negociado, MOQ y código que la fábrica
    usa para el SKU. Tabla: 53_suppliers_product_assignments.sql.

    base_cost_usd es CEO-ONLY (oculto por el serializer si no admin).
    """
    id                        = models.UUIDField(primary_key=True)
    supplier_id               = models.UUIDField()                          # ⛔ sin FK
    product_sku               = models.CharField(max_length=64)             # SKU canónico MWT

    supplier_sku_code         = models.CharField(max_length=64, null=True, blank=True)
    moq                       = models.IntegerField(default=0)
    base_cost_usd             = models.DecimalField(max_digits=14, decimal_places=4,
                                                     null=True, blank=True)
    production_lead_time_days = models.IntegerField(default=0)

    notas                     = models.TextField(null=True, blank=True)
    is_active                 = models.BooleanField(default=True)
    created_by                = models.UUIDField(null=True, blank=True)     # ⛔ sin FK
    created_at                = models.DateTimeField(auto_now_add=True)
    updated_at                = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'proveedores"."suppliers_product_assignments'
        ordering = ("product_sku",)


class SupplierCertificacion(models.Model):
    """Certificaciones ISO con vencimientos — 51_proveedores_audit.sql."""
    id                = models.UUIDField(primary_key=True)
    proveedor_id      = models.UUIDField()                          # ⛔ sin FK
    # NAMING FIX (QA): columnas reales = tipo_certificacion / numero_certificado /
    # archivo_url (+ organismo_certificador / alcance / score / notas). NO existe
    # `descripcion` en la tabla. El campo `certificaciones` que usa la UI es el
    # JSONField del Proveedor, no este satelite, asi que renombramos el atributo
    # Python al nombre real de la columna en vez de mapear con db_column=.
    tipo_certificacion     = models.CharField(max_length=32)
                              # ISO_9001 / ISO_14001 / ISO_45001 / ISO_20345 / OTHER
    numero_certificado     = models.CharField(max_length=64, null=True, blank=True)
    fecha_emision          = models.DateField(null=True, blank=True)
    fecha_vencimiento      = models.DateField(null=True, blank=True)
    organismo_certificador = models.CharField(max_length=128, null=True, blank=True)
    alcance                = models.TextField(null=True, blank=True)
    archivo_url            = models.TextField(null=True, blank=True)
    alert_dias_antes       = models.IntegerField(default=60)
    score                  = models.DecimalField(max_digits=5, decimal_places=2,
                                                  null=True, blank=True)
    notas                  = models.TextField(null=True, blank=True)

    is_active         = models.BooleanField(default=True)
    created_at        = models.DateTimeField(auto_now_add=True)
    updated_at        = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'proveedores"."supplier_certificacion'
        ordering = ("-fecha_vencimiento",)
