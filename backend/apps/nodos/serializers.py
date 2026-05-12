from rest_framework import serializers
from .models import Nodo, NodoJerarquia, NodoArtefacto


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


# ─────────────────────────────────────────────────────────────────
# Sprint 2026-05-11 · Artefactos por nodo.
# El FE manda metadata + archivo_url (obtenida previamente desde
# /api/storage/upload-proxy/). El campo `metadata` es JSONField libre.
# Sólo `tipo` y `nombre` son requeridos — el resto es opcional para
# soportar artefactos "marcadores" sin archivo (ej: nota interna).
# ─────────────────────────────────────────────────────────────────
class NodoArtefactoSerializer(serializers.ModelSerializer):
    descripcion    = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    archivo_url    = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    archivo_nombre = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    archivo_size   = serializers.IntegerField(required=False, allow_null=True)
    archivo_mime   = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    metadata       = serializers.JSONField(required=False)
    estado         = serializers.CharField(required=False, allow_blank=True,
                                           allow_null=True, max_length=32)

    class Meta:
        model  = NodoArtefacto
        fields = "__all__"
        # nodo_id y uploaded_by_id los inyecta el ViewSet (no vienen del cliente).
        read_only_fields = ("id", "nodo_id", "uploaded_by_id",
                            "created_at", "updated_at")
