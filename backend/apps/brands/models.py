"""apps.brands.models — tabla `brands.marca` (SQL puro, Meta.managed=False)."""
from datetime import date

from django.db import models


class Marca(models.Model):
    id                  = models.UUIDField(primary_key=True)
    nombre              = models.CharField(max_length=128)
    slug                = models.CharField(max_length=64, unique=True)
    pais_origen_iso2    = models.CharField(max_length=2)
    categoria_principal = models.CharField(max_length=32)
    descripcion         = models.TextField(null=True, blank=True)
    logo_url            = models.CharField(max_length=500, null=True, blank=True)
    website             = models.CharField(max_length=200, null=True, blank=True)
    estado_comercial    = models.CharField(max_length=16, default="PROSPECTO")
    fecha_firma         = models.DateField(null=True, blank=True)
    responsable_id      = models.UUIDField(null=True, blank=True)      # sin FK
    territorios         = models.JSONField(default=list)
    markup_default      = models.DecimalField(max_digits=5, decimal_places=2, default=2.5)
    dias_pago_default   = models.SmallIntegerField(default=30)
    moneda_default      = models.CharField(max_length=3, default="USD")
    visibility_tier     = models.CharField(max_length=16, default="INTERNAL")

    # Extensiones 93_schema_extensions.sql §3:
    issuing_entity_id      = models.UUIDField(null=True, blank=True)    # ⛔ sin FK
    mercados_activos       = models.JSONField(default=list, blank=True)
    min_margin_alert_pct   = models.DecimalField(max_digits=5, decimal_places=2, default=25)
    brand_code             = models.CharField(max_length=16, null=True, blank=True)
    tipo                   = models.CharField(max_length=16, null=True, blank=True)
                              # PROPIA / EXCLUSIVA / TERCEROS

    # Sprint 2026-07-20 · correlativo de proformas de la marca (C4).
    # PRÓXIMO número PF (<n>-<año actual>); generate-proforma lo consume
    # e incrementa atómicamente. NULL → secuencial global.
    pf_correlativo         = models.IntegerField(null=True, blank=True)

    # Extensión 21b_brands_feature_flags.sql — toggles persistentes de
    # capacidades por marca (storefront / B2B / expedientes / scanner).
    feature_flags          = models.JSONField(default=dict, blank=True)

    is_active           = models.BooleanField(default=True)
    created_at          = models.DateTimeField(auto_now_add=True)
    updated_at          = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'brands\".\"marca'


class CategoriaCat(models.Model):
    codigo = models.CharField(max_length=32, primary_key=True)
    label  = models.CharField(max_length=64)
    orden  = models.SmallIntegerField(default=0)

    class Meta:
        managed  = False
        db_table = 'brands\".\"categoria_cat'
        ordering = ('orden',)


class EstadoCat(models.Model):
    codigo = models.CharField(max_length=16, primary_key=True)
    label  = models.CharField(max_length=64)
    color  = models.CharField(max_length=16, null=True, blank=True)
    orden  = models.SmallIntegerField(default=0)

    class Meta:
        managed  = False
        db_table = 'brands\".\"estado_cat'
        ordering = ('orden',)


class TipoMarcaCat(models.Model):
    """Catálogo PROPIA/EXCLUSIVA/TERCEROS — creado por 21_brands_audit.sql."""
    codigo    = models.CharField(max_length=16, primary_key=True)
    label     = models.CharField(max_length=64)
    orden     = models.IntegerField(default=100)
    is_active = models.BooleanField(default=True)

    class Meta:
        managed  = False
        db_table = 'brands\".\"tipo_marca_cat'
        ordering = ('orden',)


class BrandDiscountCode(models.Model):
    """Códigos de descuento — 21_brands_audit.sql."""
    id              = models.UUIDField(primary_key=True)
    marca_id        = models.UUIDField()                            # ⛔ sin FK
    codigo          = models.CharField(max_length=32)
    descripcion     = models.TextField(null=True, blank=True)

    tipo_descuento  = models.CharField(max_length=16, default='PCT')
                        # PCT / FIXED / COMBO
    # NAMING FIX (QA): la tabla real brands.brand_discount_code usa
    # descuento_pct / descuento_monto / moneda / vigencia_inicio / vigencia_fin.
    # Ningun consumidor de frontend usa aun este endpoint (el Promo Engine del
    # front es de proveedores.SupplierPromoCode, que si mapea con db_column=),
    # asi que renombramos el atributo Python al nombre real de la columna:
    # contrato API = schema SQL.
    descuento_pct   = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    descuento_monto = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    moneda          = models.CharField(max_length=3, default='USD')

    # vigencia_inicio es NOT NULL sin default en la DB — default app-side:
    # un codigo creado sin fecha explicita queda vigente desde hoy.
    vigencia_inicio = models.DateField(default=date.today)
    vigencia_fin    = models.DateField(null=True, blank=True)

    max_usos        = models.IntegerField(null=True, blank=True)
    usos_actuales   = models.IntegerField(default=0)

    scope           = models.CharField(max_length=16, default='GLOBAL')
                        # GLOBAL / CANAL / CLIENTE / PRODUCTO
    scope_ids       = models.JSONField(default=list, blank=True)
    reglas_json     = models.JSONField(default=dict, blank=True)

    is_active       = models.BooleanField(default=True)
    created_by      = models.UUIDField(null=True, blank=True)      # ⛔ sin FK
    created_at      = models.DateTimeField(auto_now_add=True)
    updated_at      = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'brands\".\"brand_discount_code'
        ordering = ('-created_at',)


class BrandImportLog(models.Model):
    """Subidas masivas de productos — 2-step preview/commit."""
    id                = models.UUIDField(primary_key=True)
    marca_id          = models.UUIDField()                          # ⛔ sin FK
    # NAMING FIX (QA): columnas reales = rows_total/rows_valid/rows_invalid/
    # rows_inserted/rows_updated + user_id/committed_by/summary_json.
    # NO existe idempotence_token en la tabla: el token se persiste dentro de
    # summary_json (jsonb) desde views.upload_productos_commit. El frontend
    # (ProductMassiveUpload.jsx) solo consume las keys de la respuesta del view
    # (total/valid/invalid/committed_rows), no los nombres del modelo, asi que
    # renombramos al nombre real de la DB.
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
        db_table = 'brands\".\"brand_import_log'
        ordering = ('-created_at',)
