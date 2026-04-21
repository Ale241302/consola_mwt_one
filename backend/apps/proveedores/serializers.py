from rest_framework import serializers
from .models import (
    Proveedor,
    SupplierPromoCode,
    SupplierAuditEvent,
    SupplierImportLog,
    SupplierCertificacion,
)


class ProveedorListSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Proveedor
        fields = (
            "id", "codigo", "razon_social", "nombre_comercial", "tax_id",
            "tipo", "estado", "pais_iso2", "ciudad",
            "lead_time_dias", "incoterm_default", "rating",
            "clase", "score_iso", "producto_servicio",
            "is_active", "updated_at",
        )


class ProveedorSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Proveedor
        fields = "__all__"


class SupplierPromoCodeSerializer(serializers.ModelSerializer):
    class Meta:
        model  = SupplierPromoCode
        fields = "__all__"
        read_only_fields = ("id", "usos_actuales", "created_at", "updated_at")


class SupplierAuditEventSerializer(serializers.ModelSerializer):
    class Meta:
        model  = SupplierAuditEvent
        fields = "__all__"
        read_only_fields = ("id", "created_at")


class SupplierImportLogSerializer(serializers.ModelSerializer):
    class Meta:
        model  = SupplierImportLog
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class SupplierCertificacionSerializer(serializers.ModelSerializer):
    class Meta:
        model  = SupplierCertificacion
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")
