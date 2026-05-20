"""
=====================================================================
MWT.ONE · apps.commercial.models
Agente responsable: [AG-BACKEND]

Modelos ORM (Meta.managed=False) para la capa comercial del Módulo
de Marcas. La DB la materializa A2_commercial_pricing.sql; aquí solo
mapeamos.

Reglas MWT respetadas:
  · CERO ForeignKey (vínculos por UUIDField).
  · managed = False (Django nunca migra).
  · db_table usa el escape 'schema"."tabla' para schema-qualification.
  · Cada tabla tiene id / is_active / created_at / updated_at.
=====================================================================
"""
import uuid

from django.db import models


# =====================================================================
# SCHEMA pricing
# =====================================================================

class PriceListVersion(models.Model):
    """Una versión de lista de precios (puede haber múltiples activas por marca)."""

    SOURCE_CHOICES = (
        ("UPLOAD",    "Subida Excel"),
        ("MANUAL",    "Carga manual"),
        ("API",       "API externa"),
        ("MIGRATION", "Migración legacy"),
    )

    id              = models.UUIDField(primary_key=True)
    brand_id        = models.UUIDField()                          # ⛔ sin FK
    codigo          = models.CharField(max_length=64)
    nombre          = models.CharField(max_length=160)
    descripcion     = models.TextField(null=True, blank=True)
    currency        = models.CharField(max_length=3, default="USD")
    valid_from      = models.DateField()
    valid_to        = models.DateField(null=True, blank=True)
    storage_key     = models.CharField(max_length=512, null=True, blank=True)
    source          = models.CharField(
        max_length=24, choices=SOURCE_CHOICES, default="UPLOAD")
    uploaded_by_id  = models.UUIDField(null=True, blank=True)     # ⛔ sin FK
    metadata        = models.JSONField(default=dict)

    is_active       = models.BooleanField(default=True)
    created_at      = models.DateTimeField(auto_now_add=True)
    updated_at      = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'pricing"."pricelist_version'
        ordering = ("-valid_from", "codigo")

    def __str__(self) -> str:
        return f"PriceListVersion({self.codigo})"


class GradeItem(models.Model):
    """Ítem de una pricelist: SKU + precio + grade MOQ + curva de tallas."""

    id                   = models.UUIDField(primary_key=True)
    pricelist_version_id = models.UUIDField()                     # ⛔ sin FK
    brand_id             = models.UUIDField()                     # ⛔ sin FK (denormalizado)
    product_sku          = models.CharField(max_length=64)
    product_name         = models.CharField(max_length=240, null=True, blank=True)
    unit_price_usd       = models.DecimalField(max_digits=14, decimal_places=4)
    cost_usd             = models.DecimalField(
        max_digits=14, decimal_places=4, null=True, blank=True)  # CEO-ONLY
    grade_moq_total      = models.IntegerField(default=0)
    size_multipliers     = models.JSONField(default=dict)         # {"37":5,"38":10,...}
    tags                 = models.JSONField(default=list)
    metadata             = models.JSONField(default=dict)

    is_active            = models.BooleanField(default=True)
    created_at           = models.DateTimeField(auto_now_add=True)
    updated_at           = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'pricing"."grade_item'
        ordering = ("product_sku",)

    def __str__(self) -> str:
        return f"GradeItem({self.product_sku}={self.unit_price_usd})"


class ClientAssignment(models.Model):
    """CPA — Catálogo Personalizado Asignado. Precio override por cliente/SKU."""

    id                  = models.UUIDField(primary_key=True)
    client_id           = models.UUIDField()                      # ⛔ sin FK
    brand_id            = models.UUIDField()                      # ⛔ sin FK
    brand_sku           = models.CharField(max_length=64)
    cached_client_price = models.DecimalField(max_digits=14, decimal_places=4)
    currency            = models.CharField(max_length=3, default="USD")
    source_pricelist_id = models.UUIDField(null=True, blank=True) # ⛔ sin FK (audit)
    notes               = models.TextField(null=True, blank=True)
    valid_from          = models.DateField()
    valid_to            = models.DateField(null=True, blank=True)
    approved_by_id      = models.UUIDField(null=True, blank=True) # ⛔ sin FK
    approved_at         = models.DateTimeField(null=True, blank=True)
    metadata            = models.JSONField(default=dict)

    is_active           = models.BooleanField(default=True)
    created_at          = models.DateTimeField(auto_now_add=True)
    updated_at          = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'pricing"."client_assignment'
        ordering = ("brand_sku",)

    def __str__(self) -> str:
        return f"ClientAssignment({self.client_id}/{self.brand_sku})"


class CurrencyCat(models.Model):
    """Catálogo de monedas ISO 4217 — para dropdowns."""
    codigo    = models.CharField(max_length=3, primary_key=True)
    nombre    = models.CharField(max_length=80)
    symbol    = models.CharField(max_length=8, null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        managed  = False
        db_table = 'pricing"."currency_cat'
        ordering = ("codigo",)


class PriceListSourceCat(models.Model):
    """Catálogo de tipos de origen de pricelist."""
    codigo    = models.CharField(max_length=24, primary_key=True)
    nombre    = models.CharField(max_length=80)
    orden     = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        managed  = False
        db_table = 'pricing"."pricelist_source_cat'
        ordering = ("orden",)


# =====================================================================
# SCHEMA commercial
# =====================================================================

class EarlyPaymentPolicy(models.Model):
    """Política de pronto pago por (client_id, brand_id)."""

    id              = models.UUIDField(primary_key=True)
    client_id       = models.UUIDField()                          # ⛔ sin FK
    brand_id        = models.UUIDField()                          # ⛔ sin FK
    codigo          = models.CharField(max_length=64)
    nombre          = models.CharField(max_length=160)
    descripcion     = models.TextField(null=True, blank=True)
    valid_from      = models.DateField()
    valid_to        = models.DateField(null=True, blank=True)
    approved_by_id  = models.UUIDField(null=True, blank=True)     # ⛔ sin FK
    approved_at     = models.DateTimeField(null=True, blank=True)
    metadata        = models.JSONField(default=dict)

    is_active       = models.BooleanField(default=True)
    created_at      = models.DateTimeField(auto_now_add=True)
    updated_at      = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'commercial"."early_payment_policy'
        ordering = ("-valid_from", "codigo")

    def __str__(self) -> str:
        return f"EarlyPaymentPolicy({self.codigo})"


class EarlyPaymentTier(models.Model):
    """Tier dentro de una EarlyPaymentPolicy: payment_days + discount_pct."""

    id            = models.UUIDField(primary_key=True)
    policy_id     = models.UUIDField()                            # ⛔ sin FK
    payment_days  = models.IntegerField()
    discount_pct  = models.DecimalField(max_digits=6, decimal_places=3, default=0)
    tier_label    = models.CharField(max_length=64, null=True, blank=True)
    orden         = models.IntegerField(default=0)
    metadata      = models.JSONField(default=dict)

    is_active     = models.BooleanField(default=True)
    created_at    = models.DateTimeField(auto_now_add=True)
    updated_at    = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'commercial"."early_payment_tier'
        ordering = ("payment_days",)

    def __str__(self) -> str:
        return f"EarlyPaymentTier(d={self.payment_days},pct={self.discount_pct})"


class CommissionRule(models.Model):
    """Regla de comisión CEO-ONLY."""

    COMMISSION_BASE_CHOICES = (
        ("sale_price",   "Sobre precio de venta"),
        ("gross_margin", "Sobre margen bruto (CEO)"),
    )

    id              = models.UUIDField(primary_key=True)
    brand_id        = models.UUIDField()                          # ⛔ sin FK
    client_id       = models.UUIDField(null=True, blank=True)     # ⛔ sin FK (NULL = toda la marca)
    codigo          = models.CharField(max_length=64)
    nombre          = models.CharField(max_length=160)
    descripcion     = models.TextField(null=True, blank=True)
    commission_pct  = models.DecimalField(max_digits=6, decimal_places=3)
    commission_base = models.CharField(
        max_length=24, choices=COMMISSION_BASE_CHOICES, default="sale_price")
    min_sale_amount = models.DecimalField(
        max_digits=14, decimal_places=4, null=True, blank=True)
    valid_from      = models.DateField()
    valid_to        = models.DateField(null=True, blank=True)
    approved_by_id  = models.UUIDField(null=True, blank=True)     # ⛔ sin FK
    approved_at     = models.DateTimeField(null=True, blank=True)
    metadata        = models.JSONField(default=dict)

    is_active       = models.BooleanField(default=True)
    created_at      = models.DateTimeField(auto_now_add=True)
    updated_at      = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'commercial"."commission_rule'
        ordering = ("-valid_from", "codigo")

    def __str__(self) -> str:
        return f"CommissionRule({self.codigo})"


class CommissionBaseCat(models.Model):
    """Catálogo enum commission_base — para dropdowns."""
    codigo      = models.CharField(max_length=24, primary_key=True)
    nombre      = models.CharField(max_length=80)
    descripcion = models.TextField(null=True, blank=True)
    orden       = models.IntegerField(default=0)
    is_active   = models.BooleanField(default=True)

    class Meta:
        managed  = False
        db_table = 'commercial"."commission_base_cat'
        ordering = ("orden",)


# =====================================================================
# Pricing Waterfall COMEX · modelos de la calculadora Excel v6
# =====================================================================
class PricingConstant(models.Model):
    """Constantes globales de la fórmula COMEX.

    Seed canónico:
      · base_commission_rate = 1.0183  (base del exponencial del Excel v6)
      · default_markup_floor = 1.05
      · fx_usd_pen           = 3.70
    """
    slug          = models.CharField(max_length=48, primary_key=True)
    nombre        = models.CharField(max_length=128)
    descripcion   = models.TextField(null=True, blank=True)
    value         = models.DecimalField(max_digits=16, decimal_places=6)
    unit          = models.CharField(max_length=16, null=True, blank=True)
    is_active     = models.BooleanField(default=True)
    updated_by_id = models.UUIDField(null=True, blank=True)
    created_at    = models.DateTimeField(auto_now_add=True)
    updated_at    = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'pricing"."pricing_constants'
        ordering = ("slug",)


class BrandClientPricingAssignment(models.Model):
    """Asignación cliente-marca de precios + modificadores + archivo.

    Ver SQL A2c_brand_client_pricing.sql. Una fila por cada cliente
    que tiene precios activos para una marca. La UNIQUE parcial sobre
    (brand_id, cliente_id) WHERE is_active=TRUE garantiza que sólo
    exista una asignación vigente por par.

    El snapshot de términos financieros del cliente
    (`comision_pct_snapshot`, `credito_dias_snapshot`,
    `credito_limit_snapshot`) se copia en el momento de crear la
    asignación y NO se recalcula después — auditoría histórica.
    """
    id               = models.UUIDField(primary_key=True)
    brand_id         = models.UUIDField()         # ⛔ sin FK
    cliente_id       = models.UUIDField()         # ⛔ sin FK

    # Archivo
    file_object_key  = models.TextField(null=True, blank=True)
    file_name        = models.CharField(max_length=255, null=True, blank=True)
    file_size_bytes  = models.IntegerField(null=True, blank=True)
    file_mime        = models.CharField(max_length=64, null=True, blank=True)
    file_uploaded_at = models.DateTimeField(null=True, blank=True)
    file_uploaded_by = models.UUIDField(null=True, blank=True)

    # Vigencia
    fecha_inicio     = models.DateField()
    fecha_fin        = models.DateField(null=True, blank=True)

    # Modificadores (todos opcionales, decimal 0..1)
    sobre_precio_pct  = models.DecimalField(max_digits=6, decimal_places=4, null=True, blank=True)
    pronto_pago_dias  = models.IntegerField(null=True, blank=True)
    pronto_pago_pct   = models.DecimalField(max_digits=6, decimal_places=4, null=True, blank=True)
    volumen_pct       = models.DecimalField(max_digits=6, decimal_places=4, null=True, blank=True)
    volumen_min_units = models.IntegerField(null=True, blank=True)

    # Snapshot inmutable de términos financieros del cliente
    comision_pct_snapshot  = models.DecimalField(max_digits=6, decimal_places=4, null=True, blank=True)
    credito_dias_snapshot  = models.SmallIntegerField(null=True, blank=True)
    credito_limit_snapshot = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)

    # Meta
    notas             = models.TextField(null=True, blank=True)
    is_active         = models.BooleanField(default=True)
    created_by_id     = models.UUIDField(null=True, blank=True)
    updated_by_id     = models.UUIDField(null=True, blank=True)
    created_at        = models.DateTimeField(auto_now_add=True)
    updated_at        = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'commercial"."brand_client_pricing_assignment'
        ordering = ("-updated_at",)

    def __str__(self):
        return f"BCPA(brand={self.brand_id} client={self.cliente_id} active={self.is_active})"


class PaymentIndex(models.Model):
    """Índice de pago por plazo en días.

    Seed con los 34 valores del Excel 'Tabela de indices' (cols K-L-M).
    Para COMEX (exportación) el factor que importa es `factor_me`.
    """
    id          = models.UUIDField(primary_key=True)
    dias        = models.IntegerField(unique=True)
    factor_mi   = models.DecimalField(max_digits=10, decimal_places=6, default=1.0)
    factor_me   = models.DecimalField(max_digits=10, decimal_places=6, default=1.0)
    descripcion = models.CharField(max_length=255, null=True, blank=True)
    orden       = models.IntegerField(default=0)
    is_active   = models.BooleanField(default=True)
    created_at  = models.DateTimeField(auto_now_add=True)
    updated_at  = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'pricing"."payment_index'
        ordering = ("dias",)

    def __str__(self) -> str:
        return f"PaymentIndex({self.dias}d → MI={self.factor_mi} · ME={self.factor_me})"


class MarluvasClientSkuPricing(models.Model):
    """Override de precio por (brand, cliente, SKU) — específico para Marluvas.

    Propósito:
      Persistir overrides puntuales de precio por SKU dentro de una
      asignación cliente-marca (BCPA). Mientras la BCPA define los
      modificadores globales del par (brand, cliente), esta tabla baja
      al nivel de SKU individual: override en BRL, comisión, ajuste en
      USD y sobreprecio porcentual.

    Fuente del dato:
      Carga manual desde el panel BrandPricingConsole (vista Marluvas).
      El operador comercial fija valores SKU por SKU al pactar el
      contrato con el cliente.

    Relación con BCPA:
      `bcpa_id` apunta lógicamente (sin FK física) a
      commercial.brand_client_pricing_assignment.id. Es NULL-able para
      permitir cargar overrides antes de que la BCPA padre exista, o
      registrar overrides huérfanos (auditoría). Cuando `bcpa_id` está
      presente, las vigencias (fecha_inicio/fecha_fin) NULL se heredan
      de la BCPA padre en la capa de servicio.

    Invariante DB:
      UNIQUE parcial (brand_id, cliente_id, sku) WHERE is_active=TRUE
      — sólo un override vigente por triple. Para reemplazar, el
      backend marca is_active=FALSE el anterior y crea el nuevo dentro
      de transaction.atomic().

      Nota: `id` usa default=uuid.uuid4 (lado Python) en lugar de
      delegar al `DEFAULT gen_random_uuid()` del DDL. Razón: con
      bulk_create Django envía explícitamente la columna `id` con
      NULL si no tiene default Python — y un INSERT con NULL viola
      la NOT NULL constraint (el DEFAULT del DDL sólo se aplica cuando
      la columna se OMITE del INSERT, no cuando se manda NULL).
    """
    id                = models.UUIDField(
        primary_key=True, default=uuid.uuid4, editable=False)
    brand_id          = models.UUIDField()                          # ⛔ sin FK
    cliente_id        = models.UUIDField()                          # ⛔ sin FK
    sku               = models.CharField(max_length=64)

    brl_override      = models.DecimalField(
        max_digits=14, decimal_places=4, null=True, blank=True)
    com_pct           = models.DecimalField(
        max_digits=6, decimal_places=2, default=0)
    ajuste_usd        = models.DecimalField(
        max_digits=14, decimal_places=4, default=0)
    sobreprecio_pct   = models.DecimalField(
        max_digits=8, decimal_places=6, default=0)

    # Matriz 12 bandas × 4 plazos de precios USD calculados y CONGELADOS.
    # Shape: { "<banda_id>": {"<plazo_dias>": <precio>} } ej.:
    #   { "1": {"90": 25.25, "60": 24.99, "30": 24.80, "8": 24.55},
    #     "2": {"90": 24.06, ...}, ... "12": {...} }
    # Persistida como contrato: si cambian constantes downstream, los
    # precios ya cotizados no se recalculan (auditoría/disputas).
    prices_matrix     = models.JSONField(default=dict, blank=True)

    # Plazos personalizados por banda — Fase 4.
    # Shape: { "<bandaId>": [{"dias": <int>, "factor": <float>}, ...] }
    # Bandas SIN entrada → usan defaults [90/60/30/8d].
    # Bandas CON entrada → usan SOLO esa lista (materialización lazy).
    # El save-simulation guarda el MISMO valor en TODOS los rows del
    # par (brand, cliente) atómicamente — redundancia aceptada.
    custom_plazos     = models.JSONField(default=dict, blank=True)

    # Overrides de precio por talla (Fase 3). Shape:
    #   { "<talla_uuid>": {
    #         "matrix": { "<banda_id>": {"<plazo_dias>": <precio_usd>} },
    #         "anchor": { "bandaId": <int>, "plazoDias": <int> }
    #     } }
    # Talla SIN entrada → hereda de `prices_matrix` (SKU default).
    # BRL único por SKU — no varía por talla. Solo display por ahora
    # (no impacta proformas/OCs en Fase 3).
    sizes_pricing     = models.JSONField(default=dict, blank=True)

    bcpa_id           = models.UUIDField(null=True, blank=True)     # ⛔ sin FK (→ BCPA)
    fecha_inicio      = models.DateField(null=True, blank=True)
    fecha_fin         = models.DateField(null=True, blank=True)

    is_active         = models.BooleanField(default=True)
    created_at        = models.DateTimeField(auto_now_add=True)
    updated_at        = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'pricing"."marluvas_client_sku_pricing'
        ordering = ("brand_id", "cliente_id", "sku")

    def __str__(self) -> str:
        return f"MarluvasClientSkuPricing(brand={self.brand_id} cliente={self.cliente_id} sku={self.sku})"


# =====================================================================
# MarluvasPriceHistoryEvent + MarluvasPriceHistorySku
#
# F6 · Sprint 2026-05-20 · Bitácora histórica de cambios de precios.
# Una fila cabecera por click "Guardar" + N hijas por SKU del snapshot.
# Tablas creadas en backend/sql/A2h_marluvas_price_history.sql.
# Visibilidad: CEO-ONLY (enforce en views).
# =====================================================================
class MarluvasPriceHistoryEvent(models.Model):
    id                 = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    brand_id           = models.UUIDField()                                  # ⛔ sin FK (brands.*)
    cliente_id         = models.UUIDField()                                  # ⛔ sin FK (clientes.cliente)
    snapshot_at        = models.DateTimeField(auto_now_add=True)
    created_by_user_id = models.UUIDField(null=True, blank=True)             # ⛔ sin FK (core.user)
    fecha_inicio       = models.DateField(null=True, blank=True)
    fecha_fin          = models.DateField(null=True, blank=True)
    # Plazos custom por banda al momento del snapshot (idéntico shape al
    # current state). Permite recrear UX al ver entrada de historial.
    custom_plazos      = models.JSONField(default=dict, blank=True)
    sku_count          = models.IntegerField(default=0)
    cells_count        = models.IntegerField(default=0)
    notas              = models.TextField(null=True, blank=True)
    created_at         = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed  = False
        db_table = 'pricing"."marluvas_price_history_event'
        ordering = ("-snapshot_at",)

    def __str__(self) -> str:
        return (f"MarluvasPriceHistoryEvent(brand={self.brand_id} "
                f"cliente={self.cliente_id} at={self.snapshot_at})")


class MarluvasPriceHistorySku(models.Model):
    id              = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # FK lógica al event (lo declaramos como UUIDField — la integridad
    # vive en el constraint de la DB, no en el ORM, para mantener
    # managed=False simple).
    event_id        = models.UUIDField()
    sku             = models.CharField(max_length=64)
    brl_override    = models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True)
    com_pct         = models.DecimalField(max_digits=8,  decimal_places=4,  default=0)
    ajuste_usd      = models.DecimalField(max_digits=14, decimal_places=4,  default=0)
    sobreprecio_pct = models.DecimalField(max_digits=10, decimal_places=6,  default=0)
    # Anchor congelado al momento del save: { "bandaId": <int>, "plazoDias": <int> }
    # Puede ser null si el snapshot heredaba del ancla global del editor.
    anchor          = models.JSONField(null=True, blank=True)
    # Matriz completa congelada al momento del save. Mismo shape que en
    # MarluvasClientSkuPricing.prices_matrix.
    prices_matrix   = models.JSONField(default=dict, blank=True)
    # Overrides por talla congelados (Fase 3).
    sizes_pricing   = models.JSONField(default=dict, blank=True)
    activo          = models.BooleanField(default=True)
    created_at      = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed  = False
        db_table = 'pricing"."marluvas_price_history_sku'
        ordering = ("event_id", "sku")

    def __str__(self) -> str:
        return f"MarluvasPriceHistorySku(event={self.event_id} sku={self.sku})"
