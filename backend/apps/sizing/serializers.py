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
import uuid

from rest_framework import serializers

from .models import Familia, Talla, TipoProductoCat, MedidaSistemaCat


# ── Cache simple en memoria para evitar N+1 al resolver marca_id → nombre.
#    Mismo patrón que apps.productos.serializers._marca_nombre (TTL 5s). ──
_MARCA_CACHE = {"data": {}, "ts": 0}
def _marca_nombre(marca_id):
    if not marca_id:
        return None
    import time
    from apps.brands.models import Marca
    if time.time() - _MARCA_CACHE["ts"] > 5:
        _MARCA_CACHE["data"] = {
            str(m.id): m.nombre
            for m in Marca.objects.filter(is_active=True).only("id", "nombre")
        }
        _MARCA_CACHE["ts"] = time.time()
    return _MARCA_CACHE["data"].get(str(marca_id))


def _familia_nombre(familia_id):
    """Resuelve familia_id → nombre SIN filtrar is_active (una talla
    conserva el nombre aunque la familia se haya desactivado)."""
    if not familia_id:
        return None
    try:
        return Familia.objects.only("nombre").get(pk=familia_id).nombre
    except Familia.DoesNotExist:
        return None


# ─────────────────────────────────────────────────────────────────────
# Familias de línea por marca (Sprint 2026-07-22 · G18)
# ─────────────────────────────────────────────────────────────────────
class FamiliaSerializer(serializers.ModelSerializer):
    id         = serializers.UUIDField(read_only=True)
    created_at = serializers.DateTimeField(read_only=True)
    updated_at = serializers.DateTimeField(read_only=True)

    is_active   = serializers.BooleanField(required=False, default=True)
    descripcion = serializers.CharField(
        required=False, allow_null=True, allow_blank=True,
        style={"base_template": "textarea.html"},
    )

    # Read-only: nombre de la marca derivado de marca_id (sin FK).
    marca_nombre = serializers.SerializerMethodField()
    def get_marca_nombre(self, obj):
        return _marca_nombre(obj.marca_id)

    class Meta:
        model  = Familia
        fields = (
            "id", "marca_id", "nombre", "descripcion",
            "is_active", "created_at", "updated_at", "marca_nombre",
        )

    def validate(self, attrs):
        # Duplicado (marca_id, nombre case-insensitive) entre ACTIVAS → 400.
        # En update se excluye la propia fila. Espejo del índice parcial
        # ux_marca_familia_marca_nombre_ci de G18.
        marca_id = attrs.get("marca_id",
                             getattr(self.instance, "marca_id", None))
        nombre   = attrs.get("nombre",
                             getattr(self.instance, "nombre", None))
        if marca_id and nombre and str(nombre).strip():
            qs = Familia.objects.filter(
                marca_id=marca_id, is_active=True,
                nombre__iexact=str(nombre).strip())
            if self.instance is not None:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError(
                    {"nombre": "Ya existe una familia activa con ese "
                               "nombre para esta marca."})
        return attrs


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

    # ── Medidas internas calzado (mm) — Sprint 2026-07-21 ─────────
    ancho_mm = serializers.DecimalField(
        required=False, allow_null=True, max_digits=5, decimal_places=1,
    )
    comprimento_mm = serializers.DecimalField(
        required=False, allow_null=True, max_digits=6, decimal_places=2,
    )

    metadata = serializers.JSONField(required=False, default=dict)

    # ── Clasificadores (Sprint 2026-07-22 · G18) ────────────────────
    # Vigente: marca_id + familia_id (single-valor). marca_ids queda
    # legacy y se sincroniza en validate(); tipos/familias: legacy inertes.
    marca_id   = serializers.UUIDField(required=False, allow_null=True)
    familia_id = serializers.UUIDField(required=False, allow_null=True)
    marca_ids = serializers.JSONField(required=False, default=list)
    tipos     = serializers.JSONField(required=False, default=list)
    familias  = serializers.JSONField(required=False, default=list)

    # Read-only: nombre de la familia (se resuelve aunque esté inactiva).
    familia_nombre = serializers.SerializerMethodField()
    def get_familia_nombre(self, obj):
        return _familia_nombre(getattr(obj, "familia_id", None))

    class Meta:
        model  = Talla
        fields = (
            "id", "is_active", "created_at", "updated_at",
            # clasificación / base
            "tipo_producto", "talla_base", "nombre", "descripcion",
            # clasificadores (G18: single-valor + legacy)
            "marca_id", "familia_id", "familia_nombre",
            "marca_ids", "tipos", "familias",
            # 15 sistemas
            *Talla.EQUIVALENCE_FIELDS,
            # dimensiones (sólo plantilla)
            *Talla.DIMENSION_FIELDS,
            # medidas internas calzado (mm)
            *Talla.MEDIDA_FIELDS,
            # libre
            "metadata",
        )

    # Normaliza los multi-valor: siempre lista de strings sin vacíos.
    @staticmethod
    def _clean_str_list(v, upper=False):
        if not isinstance(v, (list, tuple)):
            v = [v] if v else []
        out = []
        for x in v:
            s = str(x or "").strip()
            if not s:
                continue
            if upper:
                s = s.upper()
            if s not in out:
                out.append(s)
        return out

    def validate_marca_ids(self, v):
        return self._clean_str_list(v)

    def validate_tipos(self, v):
        return self._clean_str_list(v)

    def validate_familias(self, v):
        # Familias en MAYÚSCULAS para que el match por prefijo sea estable.
        return self._clean_str_list(v, upper=True)

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

    # ── Validación blanda + sincronización de clasificadores (G18) ──
    # No imponemos required=True nunca. Sólo ofrecemos hints suaves.
    def validate(self, attrs):
        # No bloqueamos si tipo_producto es null o desconocido.
        # No bloqueamos si faltan dimensiones en plantilla.
        initial = self.initial_data or {}

        # (a) Una talla = UNA marca: marca_ids con más de un elemento
        #     es un error (el modelo multi-marca de G1 quedó legacy).
        if "marca_ids" in initial:
            mids = attrs.get("marca_ids") or []
            if len(mids) > 1:
                raise serializers.ValidationError(
                    {"marca_ids": "Una talla solo puede tener una marca"})

        # (b) Sync marca_id ↔ marca_ids (el campo presente en el payload
        #     manda; el otro se deriva).
        if "marca_id" in initial:
            mid = attrs.get("marca_id")
            attrs["marca_ids"] = [str(mid)] if mid else []
        elif "marca_ids" in initial:
            raw = (attrs.get("marca_ids") or [None])[0]
            try:
                attrs["marca_id"] = uuid.UUID(str(raw)) if raw else None
            except (ValueError, AttributeError, TypeError):
                attrs["marca_id"] = None

        # (c) Sync familia_id → metadata.familia (el drawer legacy sigue
        #     leyendo metadata.familia; la fuente de verdad es familia_id).
        #     En PATCH se hace merge sobre la metadata previa del instance.
        if "familia_id" in initial:
            fid = attrs.get("familia_id")
            metadata = dict(
                attrs.get("metadata")
                or (getattr(self.instance, "metadata", None) or {})
            )
            if fid:
                try:
                    fam = Familia.objects.only("nombre").get(pk=fid)
                except Familia.DoesNotExist:
                    raise serializers.ValidationError(
                        {"familia_id": "La familia indicada no existe."})
                metadata["familia"] = fam.nombre
            else:
                metadata.pop("familia", None)
            attrs["metadata"] = metadata

        return attrs


class TallaListSerializer(serializers.ModelSerializer):
    """Versión compacta para la grilla principal del frontend."""

    id = serializers.UUIDField(read_only=True)

    # Read-only: nombre de la familia (resuelto aunque esté inactiva).
    familia_nombre = serializers.SerializerMethodField()
    def get_familia_nombre(self, obj):
        return _familia_nombre(getattr(obj, "familia_id", None))

    class Meta:
        model  = Talla
        fields = (
            "id", "is_active", "tipo_producto", "talla_base", "nombre",
            # Sprint 2026-07-21 · `descripcion` y las medidas internas
            # (mm) viajan en la lista: sin ellas el drawer las recibía
            # vacías y al guardar las NULABA (mismo bug que los 9
            # sistemas de equivalencias, ver abajo).
            "descripcion", "ancho_mm", "comprimento_mm",
            # metadata viaja en la lista: el drawer guarda ahí la
            # familia de línea (metadata.familia) y la necesita al editar.
            "metadata",
            # clasificadores (G18: marca_id/familia_id single-valor
            # vigentes + legacy multi-valor sincronizado)
            "marca_id", "familia_id", "familia_nombre",
            "marca_ids", "tipos", "familias",
            # Sprint 2026-07-18 · TODOS los 15 sistemas. Antes sólo 6
            # ("equivalencias rápidas") y el drawer de edición recibía la
            # talla INCOMPLETA: al guardar se nulaban los otros 9
            # (us_youth, uk_women, uk_youth, mx, ar, jp, cn, kr, alfa).
            *Talla.EQUIVALENCE_FIELDS,
            # dimensiones (informativo en lista)
            "grosor_antepie_mm", "grosor_talon_mm", "drop_mm", "peso_g",
            "created_at", "updated_at",
        )
