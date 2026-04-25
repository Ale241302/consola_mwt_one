from rest_framework import serializers
from .models import Nodo, NodoJerarquia


class NodoSerializer(serializers.ModelSerializer):
    # ── Campos opcionales explícitos ────────────────────────────────
    # El form "Nuevo nodo" del FE no pregunta por estos. La filosofía
    # MWT es: si no se pide al humano, no puede ser requerido en BD/API.
    # (Se completan luego en el detalle / edición si hace falta.)
    ciudad    = serializers.CharField(max_length=96,  required=False, allow_blank=True, allow_null=True)
    direccion = serializers.CharField(               required=False, allow_blank=True, allow_null=True)

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
