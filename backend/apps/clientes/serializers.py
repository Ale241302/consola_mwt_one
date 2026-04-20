from rest_framework import serializers
from .models import Cliente


class ClienteSerializer(serializers.ModelSerializer):
    credito_disponible = serializers.SerializerMethodField()

    class Meta:
        model  = Cliente
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at", "credito_disponible")

    def get_credito_disponible(self, o):
        return float(o.credito_aprobado or 0) - float(o.credito_usado or 0)


class ClienteListSerializer(serializers.ModelSerializer):
    credito_disponible = serializers.SerializerMethodField()

    class Meta:
        model  = Cliente
        fields = (
            "id", "razon_social", "nombre_comercial", "tax_id", "tipo", "segmento",
            "pais_iso2", "ciudad", "estado", "credito_aprobado", "credito_usado",
            "credito_disponible", "nodo_asignado_id", "responsable_id", "updated_at",
        )

    def get_credito_disponible(self, o):
        return float(o.credito_aprobado or 0) - float(o.credito_usado or 0)
