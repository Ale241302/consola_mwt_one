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
