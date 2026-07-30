from rest_framework import serializers
from .models import Nodo, NodoJerarquia, NodoArtefacto, NodoBuilderArtifactInstance


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


# ─────────────────────────────────────────────────────────────────
# Sprint 2026-05-11 · Fase 4 · Builder artifacts en nodos.
# Espejo del BuilderArtifactInstanceSerializer del lado expediente,
# pero sin `stage` (los nodos no tienen máquina de estados).
# ─────────────────────────────────────────────────────────────────
class NodoBuilderArtifactInstanceSerializer(serializers.ModelSerializer):
    """Serializer canónico para crear/leer/editar instancias del
    Builder asociadas a un nodo. nodo_id y created_by_* los inyecta
    la View; el cliente solo manda template_id, template_title, data
    y structure_snapshot."""

    data               = serializers.JSONField(required=False)
    structure_snapshot = serializers.JSONField(required=False)

    class Meta:
        model  = NodoBuilderArtifactInstance
        fields = "__all__"
        read_only_fields = (
            "id", "nodo_id",
            "created_by_id", "created_by_name",
            "updated_by_id", "updated_by_name",
            "created_at", "updated_at",
        )


class NodoBuilderArtifactInstanceUpdateSerializer(serializers.ModelSerializer):
    """Serializer para PATCH — sólo permite cambiar `data`, el snapshot de
    estructura y el flag de visibilidad cliente. El template no se puede
    're-elegir' una vez creada la instancia."""

    data               = serializers.JSONField(required=False)
    structure_snapshot = serializers.JSONField(required=False)
    publicado          = serializers.BooleanField(required=False)

    class Meta:
        model  = NodoBuilderArtifactInstance
        fields = ("data", "structure_snapshot", "publicado")
