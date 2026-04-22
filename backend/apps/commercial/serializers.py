"""
=====================================================================
MWT.ONE · apps.commercial.serializers
Agente responsable: [AG-BACKEND]

Serializers DRF para los 6 recursos comerciales + 3 catálogos.

Política de visibilidad CEO-ONLY (enforcement a nivel ViewSet/endpoint):
  · GradeItem.cost_usd         → NUNCA se retorna si el caller no es CEO/ADMIN.
  · CommissionRule (completa)  → solo CEO/ADMIN puede CRUD.
  · Los campos `margen_*` solo se calculan si can_see_margins=True.

Este archivo define el serializer FULL. El masking lo hace el ViewSet
vía GradeItemPublicSerializer / CommissionRuleSerializer + permissions.
=====================================================================
"""
from rest_framework import serializers

from .models import (
    # pricing
    PriceListVersion, GradeItem, ClientAssignment,
    CurrencyCat, PriceListSourceCat,
    # commercial
    EarlyPaymentPolicy, EarlyPaymentTier, CommissionRule,
    CommissionBaseCat,
)


# =====================================================================
# PriceListVersion
# =====================================================================
class PriceListVersionSerializer(serializers.ModelSerializer):
    class Meta:
        model  = PriceListVersion
        fields = "__all__"


class PriceListVersionListSerializer(serializers.ModelSerializer):
    items_count = serializers.SerializerMethodField()

    class Meta:
        model  = PriceListVersion
        fields = (
            "id", "brand_id", "codigo", "nombre", "currency",
            "valid_from", "valid_to", "source", "storage_key",
            "is_active", "created_at", "updated_at", "items_count",
        )

    def get_items_count(self, obj):
        return GradeItem.objects.filter(
            pricelist_version_id=obj.id, is_active=True).count()


# =====================================================================
# GradeItem
# =====================================================================
class GradeItemSerializer(serializers.ModelSerializer):
    """Full serializer (CEO-ONLY consumer). Incluye cost_usd + margen calculado."""

    margen_usd = serializers.SerializerMethodField()
    margen_pct = serializers.SerializerMethodField()

    class Meta:
        model  = GradeItem
        fields = (
            "id", "pricelist_version_id", "brand_id",
            "product_sku", "product_name",
            "unit_price_usd", "cost_usd",
            "margen_usd", "margen_pct",
            "grade_moq_total", "size_multipliers",
            "tags", "metadata",
            "is_active", "created_at", "updated_at",
        )

    def get_margen_usd(self, obj):
        if obj.cost_usd is None:
            return None
        try:
            return float(obj.unit_price_usd) - float(obj.cost_usd)
        except (TypeError, ValueError):
            return None

    def get_margen_pct(self, obj):
        if obj.cost_usd is None or not obj.unit_price_usd:
            return None
        try:
            price = float(obj.unit_price_usd)
            if price == 0:
                return None
            return round((price - float(obj.cost_usd)) / price * 100, 3)
        except (TypeError, ValueError):
            return None


class GradeItemPublicSerializer(serializers.ModelSerializer):
    """Serializer PUBLIC (no-CEO). Sin cost_usd, sin margen."""

    class Meta:
        model  = GradeItem
        fields = (
            "id", "pricelist_version_id", "brand_id",
            "product_sku", "product_name", "unit_price_usd",
            "grade_moq_total", "size_multipliers",
            "tags", "is_active", "created_at", "updated_at",
        )


# =====================================================================
# ClientAssignment (CPA)
# =====================================================================
class ClientAssignmentSerializer(serializers.ModelSerializer):
    class Meta:
        model  = ClientAssignment
        fields = "__all__"


# =====================================================================
# EarlyPaymentPolicy + EarlyPaymentTier
# =====================================================================
class EarlyPaymentTierSerializer(serializers.ModelSerializer):
    class Meta:
        model  = EarlyPaymentTier
        fields = "__all__"


class EarlyPaymentPolicySerializer(serializers.ModelSerializer):
    tiers = serializers.SerializerMethodField()

    class Meta:
        model  = EarlyPaymentPolicy
        fields = (
            "id", "client_id", "brand_id", "codigo", "nombre", "descripcion",
            "valid_from", "valid_to", "approved_by_id", "approved_at",
            "metadata", "is_active", "created_at", "updated_at",
            "tiers",
        )

    def get_tiers(self, obj):
        qs = EarlyPaymentTier.objects.filter(
            policy_id=obj.id, is_active=True).order_by("payment_days")
        return EarlyPaymentTierSerializer(qs, many=True).data


# =====================================================================
# CommissionRule            [CEO-ONLY]
# =====================================================================
class CommissionRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model  = CommissionRule
        fields = "__all__"


# =====================================================================
# Catálogos
# =====================================================================
class CurrencyCatSerializer(serializers.ModelSerializer):
    class Meta:
        model  = CurrencyCat
        fields = ("codigo", "nombre", "symbol", "is_active")


class PriceListSourceCatSerializer(serializers.ModelSerializer):
    class Meta:
        model  = PriceListSourceCat
        fields = ("codigo", "nombre", "orden", "is_active")


class CommissionBaseCatSerializer(serializers.ModelSerializer):
    class Meta:
        model  = CommissionBaseCat
        fields = ("codigo", "nombre", "descripcion", "orden", "is_active")


# =====================================================================
# Payloads específicos
# =====================================================================
class ResolveClientPriceInputSerializer(serializers.Serializer):
    """Payload de POST /api/commercial/resolve_client_price/."""
    client_id             = serializers.UUIDField()
    brand_id              = serializers.UUIDField()
    product_sku           = serializers.CharField(max_length=64)
    requested_payment_days = serializers.IntegerField(
        required=False, min_value=0, default=0)
    quantity              = serializers.IntegerField(
        required=False, min_value=0, default=1)
    currency              = serializers.CharField(
        required=False, max_length=3, default="USD")


class ResolveClientPriceOutputSerializer(serializers.Serializer):
    """Respuesta del waterfall. Los campos CEO-ONLY se omiten si not CEO."""
    ok                  = serializers.BooleanField()
    client_id           = serializers.UUIDField()
    brand_id            = serializers.UUIDField()
    product_sku         = serializers.CharField()
    currency            = serializers.CharField()
    base_price          = serializers.DecimalField(max_digits=14, decimal_places=4, allow_null=True)
    discount_applied    = serializers.DecimalField(max_digits=6,  decimal_places=3)
    final_price         = serializers.DecimalField(max_digits=14, decimal_places=4, allow_null=True)
    grade_moq           = serializers.IntegerField(allow_null=True)
    size_multipliers    = serializers.JSONField()
    source              = serializers.CharField()
    # CEO-ONLY (el ViewSet omite estos campos si not CEO)
    cost_usd            = serializers.DecimalField(
        max_digits=14, decimal_places=4, allow_null=True, required=False)
    margen_usd          = serializers.DecimalField(
        max_digits=14, decimal_places=4, allow_null=True, required=False)
    margen_pct          = serializers.DecimalField(
        max_digits=6,  decimal_places=3, allow_null=True, required=False)
    commission_pct      = serializers.DecimalField(
        max_digits=6,  decimal_places=3, allow_null=True, required=False)
    commission_base     = serializers.CharField(allow_null=True, required=False)
    notes               = serializers.ListField(
        child=serializers.CharField(), required=False)
