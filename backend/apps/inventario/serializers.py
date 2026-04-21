from rest_framework import serializers
from .models import (
    Stock, Movimiento,
    StockSnapshot, StockUbicacion, InventoryImportLog,
)


class StockListSerializer(serializers.ModelSerializer):
    valor_disponible_usd = serializers.SerializerMethodField()
    bajo_minimo          = serializers.SerializerMethodField()

    class Meta:
        model  = Stock
        fields = (
            "id", "nodo_id", "producto_id", "lote", "fecha_vencimiento",
            "cantidad_disponible", "cantidad_reservada", "cantidad_en_transito",
            "costo_unitario_usd", "costo_actual_usd",
            "cantidad_minima", "cantidad_maxima", "dias_stock_minimo",
            "dias_para_vencimiento", "rotacion_dias",
            "ubicacion_fisica", "last_movement_at",
            "is_active", "updated_at",
            "valor_disponible_usd", "bajo_minimo",
        )

    def get_valor_disponible_usd(self, obj):
        costo = obj.costo_actual_usd or obj.costo_unitario_usd or 0
        try:
            return float(obj.cantidad_disponible or 0) * float(costo or 0)
        except Exception:
            return 0.0

    def get_bajo_minimo(self, obj):
        try:
            return float(obj.cantidad_disponible or 0) < float(obj.cantidad_minima or 0)
        except Exception:
            return False


class StockSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Stock
        fields = "__all__"


class MovimientoSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Movimiento
        fields = "__all__"


class StockSnapshotSerializer(serializers.ModelSerializer):
    class Meta:
        model  = StockSnapshot
        fields = "__all__"


class StockUbicacionSerializer(serializers.ModelSerializer):
    class Meta:
        model  = StockUbicacion
        fields = "__all__"


class InventoryImportLogSerializer(serializers.ModelSerializer):
    class Meta:
        model  = InventoryImportLog
        fields = "__all__"
