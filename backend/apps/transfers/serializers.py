from rest_framework import serializers
from .models import Transferencia, Linea, Evento


class TransferenciaListSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Transferencia
        fields = (
            "id", "codigo", "origen_id", "destino_id",
            "origen_label", "destino_label",
            "legal_context", "estado", "ref_tracking",
            "needs_approval", "value_usd",
            "dispatched_at", "eta", "received_at",
            "is_active", "updated_at",
        )


class TransferenciaSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Transferencia
        fields = "__all__"


class LineaSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Linea
        fields = "__all__"


class EventoSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Evento
        fields = "__all__"
