from django.db import connection
from rest_framework import serializers
from .models import (
    Transferencia, Linea, Evento, TransferenciaDocumento,
)


def _has_discrepancy_for(obj):
    """Lee la columna generada has_discrepancy con SQL puro (no está
    en el modelo Django para evitar que el ORM intente INSERTarla)."""
    try:
        with connection.cursor() as c:
            c.execute(
                "SELECT has_discrepancy FROM transfers.transferencia "
                "WHERE id = %s", [str(obj.id)]
            )
            row = c.fetchone()
            return bool(row[0]) if row else False
    except Exception:
        return False


class TransferenciaListSerializer(serializers.ModelSerializer):
    has_discrepancy = serializers.SerializerMethodField()

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

    def get_has_discrepancy(self, obj):
        return _has_discrepancy_for(obj)


class TransferenciaSerializer(serializers.ModelSerializer):
    has_discrepancy = serializers.SerializerMethodField()

    class Meta:
        model  = Transferencia
        fields = "__all__"

    def get_has_discrepancy(self, obj):
        return _has_discrepancy_for(obj)


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
