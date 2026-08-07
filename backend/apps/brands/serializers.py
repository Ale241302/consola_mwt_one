from rest_framework import serializers
from apps.storage.serializers import StorageNormalizeMixin
from .models import Marca, BrandDiscountCode, BrandImportLog


class MarcaSerializer(StorageNormalizeMixin, serializers.ModelSerializer):
    storage_normalize_fields = ("logo_url",)
    class Meta:
        model  = Marca
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class MarcaListSerializer(StorageNormalizeMixin, serializers.ModelSerializer):
    storage_normalize_fields = ("logo_url",)
    class Meta:
        model  = Marca
        fields = (
            "id", "nombre", "slug", "pais_origen_iso2",
            "categoria_principal", "estado_comercial",
            "markup_default", "fecha_firma", "logo_url",
            "responsable_id", "is_active", "updated_at",
            # extensiones
            "issuing_entity_id", "mercados_activos",
            "min_margin_alert_pct", "brand_code", "tipo",
            "feature_flags",
        )


class BrandDiscountCodeSerializer(serializers.ModelSerializer):
    class Meta:
        model  = BrandDiscountCode
        fields = "__all__"
        read_only_fields = ("id", "usos_actuales", "created_at", "updated_at")


class BrandImportLogSerializer(serializers.ModelSerializer):
    class Meta:
        model  = BrandImportLog
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")
