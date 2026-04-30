from rest_framework import serializers
from .models import (
    Stock, Movimiento,
    StockSnapshot, StockUbicacion, InventoryImportLog,
)


class StockListSerializer(serializers.ModelSerializer):
    valor_disponible_usd = serializers.SerializerMethodField()
    bajo_minimo          = serializers.SerializerMethodField()
    # Enriquecimiento desde el view (context) — evita N+1 en el FE.
    producto_sku    = serializers.SerializerMethodField()
    producto_nombre = serializers.SerializerMethodField()
    nodo_codigo     = serializers.SerializerMethodField()
    nodo_nombre     = serializers.SerializerMethodField()

    class Meta:
        model  = Stock
        fields = (
            "id", "nodo_id", "producto_id", "lote",
            # Sprint Inbound v2 — talla del lote
            "size",
            "fecha_vencimiento",
            "cantidad_disponible", "cantidad_reservada", "cantidad_en_transito",
            "costo_unitario_usd", "costo_actual_usd",
            "cantidad_minima", "cantidad_maxima", "dias_stock_minimo",
            "dias_para_vencimiento", "rotacion_dias",
            "ubicacion_fisica", "last_movement_at",
            "is_active", "updated_at",
            "valor_disponible_usd", "bajo_minimo",
            # Anotaciones (read-only)
            "producto_sku", "producto_nombre",
            "nodo_codigo",  "nodo_nombre",
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

    # ── Enriquecimiento via context ──
    # El view precarga dicts {uuid → {sku, nombre}} y {uuid → {codigo, nombre}}
    # con DOS queries totales en vez de N+1. Si no hay context, vuelve "—".
    def get_producto_sku(self, obj):
        m = (self.context or {}).get("productos") or {}
        return (m.get(str(obj.producto_id)) or {}).get("sku", "") or ""

    def get_producto_nombre(self, obj):
        m = (self.context or {}).get("productos") or {}
        return (m.get(str(obj.producto_id)) or {}).get("nombre", "") or ""

    def get_nodo_codigo(self, obj):
        m = (self.context or {}).get("nodos") or {}
        return (m.get(str(obj.nodo_id)) or {}).get("codigo", "") or ""

    def get_nodo_nombre(self, obj):
        m = (self.context or {}).get("nodos") or {}
        return (m.get(str(obj.nodo_id)) or {}).get("nombre", "") or ""


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
