from rest_framework import serializers
from .models import Marca


class MarcaSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Marca
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class MarcaListSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Marca
        fields = (
            "id", "nombre", "slug", "pais_origen_iso2",
            "categoria_principal", "estado_comercial",
            "markup_default", "fecha_firma", "logo_url",
            "responsable_id", "is_active", "updated_at",
        )
