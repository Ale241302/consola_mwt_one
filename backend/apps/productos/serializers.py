from rest_framework import serializers
from .models import Producto


class ProductoListSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Producto
        fields = (
            "id", "sku", "nombre", "marca_id", "categoria", "subcategoria",
            "unidad", "moneda", "costo_estandar", "precio_lista", "precio_distribuidor",
            "estado", "pais_origen_iso2", "is_active", "updated_at",
        )


class ProductoSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Producto
        fields = "__all__"
