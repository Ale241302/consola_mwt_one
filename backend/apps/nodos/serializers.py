from rest_framework import serializers
from .models import Nodo, NodoJerarquia


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
            "zona_horaria", "responsable_id", "capacidad_m2",
            "legal_entity_owner_id", "operator_id",
            "capabilities", "status",
            "is_active", "updated_at",
        )


class NodoJerarquiaSerializer(serializers.ModelSerializer):
    class Meta:
        model = NodoJerarquia
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")
