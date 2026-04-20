from rest_framework import serializers
from .models import Stock, Movimiento


class StockListSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Stock
        fields = (
            "id", "nodo_id", "producto_id", "lote", "fecha_vencimiento",
            "cantidad_disponible", "cantidad_reservada", "cantidad_en_transito",
            "costo_unitario_usd", "ubicacion_fisica",
            "last_movement_at", "is_active", "updated_at",
        )


class StockSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Stock
        fields = "__all__"


class MovimientoSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Movimiento
        fields = "__all__"
