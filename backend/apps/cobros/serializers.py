from rest_framework import serializers
from .models import Cobro, Pago, Conciliacion


class CobroListSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Cobro
        fields = (
            "id", "codigo", "oc_id", "expediente_id", "client_id",
            "moneda", "monto_total", "monto_pagado", "monto_pendiente",
            "fecha_vencimiento", "dias_credito", "estado",
            "is_active", "updated_at",
        )


class CobroSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Cobro
        fields = "__all__"
        read_only_fields = ("monto_pendiente",)


class PagoListSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Pago
        fields = (
            "id", "codigo", "direccion", "cobro_id",
            "oc_id", "expediente_id", "client_id", "proveedor_id",
            "metodo", "referencia_externa",
            "moneda", "monto", "fx_rate", "monto_usd",
            "estado", "fecha_operacion", "fecha_acreditacion",
            "verificado_at", "liberado_at", "conciliado_at",
            "is_active", "updated_at",
        )


class PagoSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Pago
        fields = "__all__"


class ConciliacionSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Conciliacion
        fields = "__all__"
