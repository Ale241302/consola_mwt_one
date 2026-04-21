"""apps.brands.models — tabla `brands.marca` (SQL puro, Meta.managed=False)."""
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
    valor_pct       = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    valor_fijo_usd  = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    vigente_desde   = models.DateField(null=True, blank=True)
    vigente_hasta   = models.DateField(null=True, blank=True)

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
        db_table = 'brands\".\"brand_import_log'
        ordering = ('-created_at',)
