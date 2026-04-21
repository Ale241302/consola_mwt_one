from rest_framework import serializers
from .models import (
    Oc, Expediente, Linea, Documento,
    TransicionCat, EventLog, OcrParsingLog,
)


class OcListSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Oc
        fields = (
            "id", "codigo", "client_id", "brand_id", "proforma", "sap",
            "estado", "moneda", "issued_at",
            "total_value", "total_invoiced", "total_paid", "balance",
            "coverage_pct", "lines_count", "lines_with_sap",
            "air_pct", "sea_pct", "credit_days_max", "credit_band",
            "is_active", "updated_at",
        )


class OcSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Oc
        fields = "__all__"


class ExpedienteListSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Expediente
        fields = (
            "id", "codigo", "oc_id", "client_id", "brand_id", "sap",
            "estado", "modo_operacion", "incoterm", "freight_mode", "dispatch_mode",
            "origin", "destination", "origin_country", "destination_country",
            "shipment_date", "eta",
            "moneda", "total_cost", "total_invoiced", "total_paid", "balance",
            "projected_margin", "real_margin", "margin_drift",
            "credit_days", "credit_band",
            "is_blocked", "block_reason", "block_cause", "factory_delay",
            "phase_ratio", "phase_signal",
            "is_active", "updated_at",
        )


class ExpedienteSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Expediente
        fields = "__all__"


class LineaSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Linea
        fields = "__all__"


class DocumentoSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Documento
        fields = "__all__"


class TransicionCatSerializer(serializers.ModelSerializer):
    class Meta:
        model  = TransicionCat
        fields = "__all__"


class EventLogSerializer(serializers.ModelSerializer):
    class Meta:
        model  = EventLog
        fields = "__all__"


class OcrParsingLogSerializer(serializers.ModelSerializer):
    class Meta:
        model  = OcrParsingLog
        fields = "__all__"
