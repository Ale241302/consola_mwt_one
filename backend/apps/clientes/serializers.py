from rest_framework import serializers
from .models import Cliente, ClienteCreditSnapshot


class ClienteSerializer(serializers.ModelSerializer):
    credito_disponible = serializers.SerializerMethodField()
    tasa_utilizacion   = serializers.SerializerMethodField()

    class Meta:
        model  = Cliente
        fields = "__all__"
        read_only_fields = (
            "id", "created_at", "updated_at",
            "credito_disponible", "tasa_utilizacion",
        )

    def get_credito_disponible(self, o):
        return float(o.credito_aprobado or 0) - float(o.credito_usado or 0)

    def get_tasa_utilizacion(self, o):
        aprobado = float(o.credito_aprobado or 0)
        usado    = float(o.credito_usado    or 0)
        return round((usado / aprobado) * 100, 2) if aprobado > 0 else 0.0


class ClienteListSerializer(serializers.ModelSerializer):
    """Versión ligera para el grid — incluye extensiones comerciales."""
    credito_disponible = serializers.SerializerMethodField()
    tasa_utilizacion   = serializers.SerializerMethodField()

    class Meta:
        model  = Cliente
        fields = (
            "id", "razon_social", "nombre_comercial", "tax_id",
            "tipo", "segmento", "pais_iso2", "ciudad", "estado",
            "credito_aprobado", "credito_usado", "credito_disponible",
            "tasa_utilizacion", "dias_credito",
            "nodo_asignado_id", "responsable_id",
            "codigo_marluvas", "canal", "incoterm", "medio_pago",
            "is_active", "updated_at",
        )

    def get_credito_disponible(self, o):
        return float(o.credito_aprobado or 0) - float(o.credito_usado or 0)

    def get_tasa_utilizacion(self, o):
        aprobado = float(o.credito_aprobado or 0)
        usado    = float(o.credito_usado    or 0)
        return round((usado / aprobado) * 100, 2) if aprobado > 0 else 0.0


class ClienteCreditSnapshotSerializer(serializers.ModelSerializer):
    class Meta:
        model  = ClienteCreditSnapshot
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")
