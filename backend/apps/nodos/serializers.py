from rest_framework import serializers
from .models import Nodo


class NodoSerializer(serializers.ModelSerializer):
    class Meta:
        model = Nodo
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class NodoListSerializer(serializers.ModelSerializer):
    """Versión ligera para el grid de la lista."""
    class Meta:
        model = Nodo
        fields = (
            "id", "codigo", "nombre", "tipo", "pais_iso2", "ciudad",
            "responsable_id", "capacidad_m2", "is_active", "updated_at",
        )
