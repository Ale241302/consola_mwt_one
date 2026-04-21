from rest_framework import serializers
from .models import (
    Cobro, Pago, Conciliacion,
    Vencimiento, WithholdingLog, FxRateHistory, CollectionEvent,
)


class CobroListSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Cobro
        fields = (
            "id", "codigo", "oc_id", "expediente_id", "client_id",
            "moneda", "monto_total", "monto_pagado", "monto_pendiente",
            "fecha_vencimiento", "dias_credito", "estado",
            "dias_mora", "bucket_mora", "intereses_mora_usd",
            "collection_stage", "last_reminder_at",
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
            "metodo", "referencia_externa", "external_id", "bank_statement_id",
            "moneda", "monto", "fx_rate", "monto_usd",
            "withholding_usd", "fees_bank_usd", "monto_neto_usd",
            "fx_source", "fx_rate_date",
            "estado", "fecha_operacion", "fecha_acreditacion",
            "verificado_at", "liberado_at", "conciliado_at",
            "is_active", "updated_at",
        )


class PagoSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Pago
        fields = "__all__"
        read_only_fields = ("monto_neto_usd",)


class ConciliacionSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Conciliacion
        fields = "__all__"


class VencimientoSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Vencimiento
        fields = "__all__"
        read_only_fields = ("monto_pendiente_usd",)


class WithholdingLogSerializer(serializers.ModelSerializer):
    class Meta:
        model  = WithholdingLog
        fields = "__all__"


class FxRateHistorySerializer(serializers.ModelSerializer):
    class Meta:
        model  = FxRateHistory
        fields = "__all__"


class CollectionEventSerializer(serializers.ModelSerializer):
    class Meta:
        model  = CollectionEvent
        fields = "__all__"
