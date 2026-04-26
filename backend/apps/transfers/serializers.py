from rest_framework import serializers
from .models import (
    Transferencia, Linea, Evento, TransferenciaDocumento,
)


class TransferenciaListSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Transferencia
        fields = (
            "id", "codigo", "origen_id", "destino_id",
            "origen_label", "destino_label",
            "legal_context", "estado", "ref_tracking",
            "needs_approval", "value_usd",
            "dispatched_at", "eta", "received_at",
            "discrepancy_count", "has_discrepancy",
            "is_active", "updated_at",
        )


class TransferenciaSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Transferencia
        fields = "__all__"
        # `id` se inyecta por el ViewSet (s.save(id=uuid.uuid4())). Sin
        # esto el serializer lo marca required y is_valid() falla antes
        # de llegar al save → 500. Mismo patrón que proveedores/productos.
        # has_discrepancy es columna GENERATED → la excluimos del payload
        # validable; se devuelve solo en GET.
        read_only_fields = ("id", "created_at", "updated_at", "has_discrepancy")


class LineaSerializer(serializers.ModelSerializer):
    delta_qty       = serializers.SerializerMethodField()
    delta_value_usd = serializers.SerializerMethodField()

    class Meta:
        model  = Linea
        fields = "__all__"

    def get_delta_qty(self, obj):
        try:
            if obj.qty_received is None:
                return None
            return int(obj.qty_received or 0) - int(obj.qty_transfer or 0)
        except Exception:
            return None

    def get_delta_value_usd(self, obj):
        try:
            if obj.qty_received is None:
                return None
            delta = int(obj.qty_received or 0) - int(obj.qty_transfer or 0)
            cost  = obj.snapshot_unit_cost or obj.unit_cost or 0
            return float(delta) * float(cost or 0)
        except Exception:
            return None


class EventoSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Evento
        fields = "__all__"


class TransferenciaDocumentoSerializer(serializers.ModelSerializer):
    class Meta:
        model  = TransferenciaDocumento
        fields = "__all__"
