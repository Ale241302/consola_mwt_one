"""
=====================================================================
MWT.ONE · apps.sizing.serializers
Agente responsable: [AG-BACKEND]
Sprint: SIZING ENGINE v1

Regla MWT estricta — flexibilidad total:
  · TODOS los campos del Talla son required=False, allow_null=True
    y, donde aplica, allow_blank=True.
  · El usuario puede crear borradores vacíos: POST con `{}` debe
    aceptarse y devolver una fila con sólo `id` + auditoría.
=====================================================================
"""
from rest_framework import serializers

from .models import Talla, TipoProductoCat, MedidaSistemaCat


# ─────────────────────────────────────────────────────────────────────
# Catálogos (read-only — alimentan /api/sizing/options/)
# ─────────────────────────────────────────────────────────────────────
class TipoProductoCatSerializer(serializers.ModelSerializer):
    class Meta:
        model  = TipoProductoCat
        fields = (
            "codigo", "label", "descripcion", "icon",
            "requiere_dimensiones", "orden", "is_active",
        )


class MedidaSistemaCatSerializer(serializers.ModelSerializer):
    class Meta:
        model  = MedidaSistemaCat
        fields = (
            "codigo", "label", "region", "descripcion",
            "grupo", "orden", "is_active",
        )


# ─────────────────────────────────────────────────────────────────────
# Maestro: Talla — TODO opcional
# ─────────────────────────────────────────────────────────────────────
class TallaSerializer(serializers.ModelSerializer):
    """
    Serializer maximalmente permisivo:

      · Todos los campos de negocio son opcionales.
      · `tipo_producto` y campos de equivalencia aceptan blank/null.
      · Las dimensiones físicas aceptan null (si vienen como string
        vacío "" se normalizan a None en `to_internal_value`).
    """

    # ── Identificador (read-only desde fuera) ─────────────────
    id         = serializers.UUIDField(read_only=True)
    created_at = serializers.DateTimeField(read_only=True)
    updated_at = serializers.DateTimeField(read_only=True)

    # ── Clasificación + base ─────────────────────────────────
    is_active     = serializers.BooleanField(required=False, default=True)
    tipo_producto = serializers.CharField(
        required=False, allow_null=True, allow_blank=True, max_length=32,
    )
    talla_base    = serializers.CharField(
        required=False, allow_null=True, allow_blank=True, max_length=40,
    )
    nombre        = serializers.CharField(
        required=False, allow_null=True, allow_blank=True, max_length=120,
    )
    descripcion   = serializers.CharField(
        required=False, allow_null=True, allow_blank=True,
        style={"base_template": "textarea.html"},
    )

    # ── Dimensionales — DecimalField con allow_null ─────────────
    grosor_antepie_mm = serializers.DecimalField(
        required=False, allow_null=True, max_digits=6, decimal_places=2,
    )
    grosor_talon_mm = serializers.DecimalField(
        required=False, allow_null=True, max_digits=6, decimal_places=2,
    )
    drop_mm = serializers.DecimalField(
        required=False, allow_null=True, max_digits=6, decimal_places=2,
    )
    peso_g = serializers.DecimalField(
        required=False, allow_null=True, max_digits=7, decimal_places=2,
    )

    metadata = serializers.JSONField(required=False, default=dict)

    class Meta:
        model  = Talla
        fields = (
            "id", "is_active", "created_at", "updated_at",
            # clasificación / base
            "tipo_producto", "talla_base", "nombre", "descripcion",
            # 15 sistemas
            *Talla.EQUIVALENCE_FIELDS,
            # dimensiones (sólo plantilla)
            *Talla.DIMENSION_FIELDS,
            # libre
            "metadata",
        )

    # ── Construye dinámicamente los campos de equivalencia ──────
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for fname in Talla.EQUIVALENCE_FIELDS:
            self.fields[fname] = serializers.CharField(
                required=False, allow_null=True, allow_blank=True, max_length=20,
            )

    # ── Normalización: "" → None para no contaminar la DB ──────
    def to_internal_value(self, data):
        if isinstance(data, dict):
            data = {**data}  # copia defensiva
            for k, v in list(data.items()):
                if isinstance(v, str) and v.strip() == "":
                    data[k] = None
        return super().to_internal_value(data)

    # ── Validación blanda ──────────────────────────────────────
    # No imponemos required=True nunca. Sólo ofrecemos hints suaves.
    def validate(self, attrs):
        # No bloqueamos si tipo_producto es null o desconocido.
        # No bloqueamos si faltan dimensiones en plantilla.
        return attrs


class TallaListSerializer(serializers.ModelSerializer):
    """Versión compacta para la grilla principal del frontend."""
    id = serializers.UUIDField(read_only=True)

    class Meta:
        model  = Talla
        fields = (
            "id", "is_active", "tipo_producto", "talla_base", "nombre",
            # equivalencias rápidas — el FE muestra las más universales
            "eu", "us_men", "us_women", "uk_men", "br", "cm",
            # dimensiones (informativo en lista)
            "grosor_antepie_mm", "grosor_talon_mm", "drop_mm", "peso_g",
            "created_at", "updated_at",
        )
