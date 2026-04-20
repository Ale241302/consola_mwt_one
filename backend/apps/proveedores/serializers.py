from rest_framework import serializers
from .models import Proveedor


class ProveedorListSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Proveedor
        fields = (
            "id", "codigo", "razon_social", "nombre_comercial", "tax_id",
            "tipo", "estado", "pais_iso2", "ciudad",
            "lead_time_dias", "incoterm_default", "rating",
            "is_active", "updated_at",
        )


class ProveedorSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Proveedor
        fields = "__all__"
