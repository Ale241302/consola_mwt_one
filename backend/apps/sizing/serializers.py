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

from .models import Familia, Talla, TipoProductoCat, MedidaSistemaCat, TipoProductoMatriz


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


def _slugify_codigo(label):
    """Slug lower alfanumérico+guión_bajo a partir del label.
    'Camiseta Manga Larga' → 'camiseta_manga_larga' (sin acentos)."""
    import re
    import unicodedata
    base = (unicodedata.normalize("NFKD", label or "")
            .encode("ascii", "ignore").decode("ascii"))
    return re.sub(r"_+", "_",
                  re.sub(r"[^a-z0-9]+", "_", base.lower())).strip("_")


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
# Catálogos · CRUD (Sprint 2026-07-22 · G19 · matriz dinámica)
#   · codigo: si no viene en el POST se genera del label (slug); es
#     INMUTABLE en update (si viene distinto, se ignora).
#   · label: único campo obligatorio real.
# ─────────────────────────────────────────────────────────────────────
class TipoProductoCatSerializer(serializers.ModelSerializer):
    codigo     = serializers.CharField(required=False, allow_blank=True,
                                       max_length=32, validators=[])
    sistemas   = serializers.JSONField(required=False, default=list)
    created_at = serializers.DateTimeField(read_only=True)
    updated_at = serializers.DateTimeField(read_only=True)

    class Meta:
        model  = TipoProductoCat
        fields = (
            "codigo", "label", "descripcion", "icon",
            "sistemas", "talla_base_label",
            # legacy del FE actual (SizingEngine lo usa para el gating de
            # dimensiones); no hace parte del contrato G19 pero conservarlo
            # no rompe el item shape.
            "requiere_dimensiones",
            "orden", "is_active", "created_at", "updated_at",
        )

    def validate_sistemas(self, v):
        # Lista de códigos de unidad (strings). NO se valida existencia:
        # las unidades pueden borrarse después y el FE filtra.
        if not isinstance(v, (list, tuple)) or \
                not all(isinstance(x, str) for x in v):
            raise serializers.ValidationError(
                "sistemas debe ser una lista de strings (códigos de unidad).")
        return list(v)

    def validate(self, attrs):
        if self.instance is None:
            codigo = (attrs.get("codigo") or "").strip()
            if not codigo:
                codigo = _slugify_codigo(attrs.get("label"))
            if not codigo:
                raise serializers.ValidationError(
                    {"codigo": "No se pudo generar el código desde el label."})
            if TipoProductoCat.objects.filter(pk=codigo).exists():
                raise serializers.ValidationError(
                    {"codigo": f"Ya existe un tipo de producto '{codigo}'."})
            attrs["codigo"] = codigo
        else:
            attrs.pop("codigo", None)  # codigo inmutable en update
        return attrs


class MedidaSistemaCatSerializer(serializers.ModelSerializer):
    codigo = serializers.CharField(required=False, allow_blank=True,
                                   max_length=24, validators=[])

    class Meta:
        model  = MedidaSistemaCat
        fields = (
            "codigo", "label", "region", "descripcion",
            "grupo", "orden", "is_active",
        )

    def validate(self, attrs):
        if self.instance is None:
            codigo = (attrs.get("codigo") or "").strip()
            if not codigo:
                codigo = _slugify_codigo(attrs.get("label"))
            if not codigo:
                raise serializers.ValidationError(
                    {"codigo": "No se pudo generar el código desde el label."})
            if MedidaSistemaCat.objects.filter(pk=codigo).exists():
                raise serializers.ValidationError(
                    {"codigo": f"Ya existe una unidad de medida '{codigo}'."})
            attrs["codigo"] = codigo
        else:
            attrs.pop("codigo", None)  # codigo inmutable en update
        return attrs


# ─────────────────────────────────────────────────────────────────────
# Sprint 2026-07-23 · G23 · Matriz de equivalencias por
# (tipo_producto, marca_id, familia_id)
# ─────────────────────────────────────────────────────────────────────
class TipoProductoMatrizSerializer(serializers.ModelSerializer):
    id         = serializers.UUIDField(read_only=True)
    created_at = serializers.DateTimeField(read_only=True)
    updated_at = serializers.DateTimeField(read_only=True)

    tipo_producto = serializers.CharField(max_length=32)
    marca_id    = serializers.UUIDField(required=False, allow_null=True)
    familia_id  = serializers.UUIDField(required=False, allow_null=True)
    sistemas    = serializers.JSONField(required=False, default=list)
    defaults    = serializers.JSONField(required=False, default=dict, allow_null=True)
    is_active   = serializers.BooleanField(required=False, default=True)

    # Read-only: nombres derivados
    marca_nombre   = serializers.SerializerMethodField()
    familia_nombre = serializers.SerializerMethodField()

    def get_marca_nombre(self, obj):
        return _marca_nombre(getattr(obj, "marca_id", None))

    def get_familia_nombre(self, obj):
        return _familia_nombre(getattr(obj, "familia_id", None))

    class Meta:
        model  = TipoProductoMatriz
        fields = (
            "id", "tipo_producto", "marca_id", "familia_id",
            "sistemas", "defaults", "is_active",
            "created_at", "updated_at", "marca_nombre", "familia_nombre",
        )

    def validate_tipo_producto(self, v):
        if not v:
            raise serializers.ValidationError("El tipo de producto es obligatorio.")
        v = str(v).strip().lower()
        if not TipoProductoCat.objects.filter(pk=v).exists():
            raise serializers.ValidationError(
                f"No existe el tipo de producto '{v}'.")
        return v

    def validate_sistemas(self, v):
        if not isinstance(v, (list, tuple)) or \
                not all(isinstance(x, str) for x in v):
            raise serializers.ValidationError(
                "sistemas debe ser una lista de strings (códigos de unidad).")
        return list(v)

    def validate_defaults(self, v):
        if v is None:
            return None
        if not isinstance(v, dict):
            raise serializers.ValidationError("defaults debe ser un objeto JSON.")
        return v

    def validate(self, attrs):
        # El constraint único de G23 se deja a la DB ( índice parcial ).
        # Django no puede expresar el COALESCE del índice, así que lo
        # validamos manualmente aquí para dar un mensaje claro.
        tipo = attrs.get("tipo_producto")
        marca = attrs.get("marca_id") or None
        familia = attrs.get("familia_id") or None
        if self.instance is not None:
            # En update, usar valores actuales para los campos no enviados.
            tipo = tipo or self.instance.tipo_producto
            marca = marca if "marca_id" in attrs else self.instance.marca_id
            familia = familia if "familia_id" in attrs else self.instance.familia_id
        qs = TipoProductoMatriz.objects.filter(
            tipo_producto=tipo,
            marca_id=marca,
            familia_id=familia,
        )
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError(
                "Ya existe una matriz para esta combinación de tipo, marca y grupo.")
        return attrs


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

    # ── Matriz dinámica de equivalencias (Sprint 2026-07-22 · G19) ──
    # Fuente de verdad: {codigo_unidad: valor}. Las 16 columnas char
    # (EQUIVALENCE_FIELDS) son espejo legacy — se sincronizan en validate().
    equivalencias = serializers.JSONField(required=False, default=dict)

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
            # matriz dinámica (G19) — fuente de verdad
            "equivalencias",
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

        # (d) Sync matriz dinámica (G19): `equivalencias` (JSONB) es la
        #     fuente de verdad; las 16 columnas char son espejo legacy.
        if "equivalencias" in initial:
            # El dict completo se reemplaza tal cual vino. Las claves
            # conocidas se ESPEJAN en su columna (None si no vienen);
            # las desconocidas viven sólo en el JSONB.
            eq = attrs.get("equivalencias") or {}
            for fname in Talla.EQUIVALENCE_FIELDS:
                v = eq.get(fname)
                attrs[fname] = str(v) if v not in (None, "") else None
        elif any(f in initial for f in Talla.EQUIVALENCE_FIELDS):
            # Cliente legacy: columnas sueltas (eu=..., br=...) → merge
            # de esas claves dentro del `equivalencias` existente (del
            # instance en PATCH; del default {} en create). Las columnas
            # quedan como vinieron (ya están en attrs).
            eq = dict(getattr(self.instance, "equivalencias", None) or {})
            for fname in Talla.EQUIVALENCE_FIELDS:
                if fname in initial:
                    v = attrs.get(fname)
                    if v in (None, ""):
                        eq.pop(fname, None)
                    else:
                        eq[fname] = str(v)
            attrs["equivalencias"] = eq

        # (e) Regla de negocio MX (México): siempre deriva de CM
        #     redondeado al 0.5 más cercano.  Se aplica tras el sync de
        #     equivalencias para que la fuente de verdad JSON y el espejo
        #     legacy coincidan (G24).
        cm_val = attrs.get("cm") or (attrs.get("equivalencias") or {}).get("cm")
        if cm_val not in (None, ""):
            try:
                cm_num = float(cm_val)
                mx_new = str(round(cm_num * 2) / 2).replace(".0", "")
                attrs["mx"] = mx_new
                eq = dict(attrs.get("equivalencias") or {})
                eq["mx"] = mx_new
                attrs["equivalencias"] = eq
            except (ValueError, TypeError):
                pass
        elif "cm" in initial or ("equivalencias" in initial and "cm" in (attrs.get("equivalencias") or {})):
            # CM fue enviado explícitamente vacío → limpiar MX derivado.
            attrs["mx"] = None
            eq = dict(attrs.get("equivalencias") or {})
            eq.pop("mx", None)
            attrs["equivalencias"] = eq

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
            # matriz dinámica (G19) — fuente de verdad de equivalencias
            "equivalencias",
            # Sprint 2026-07-18 · TODOS los 15 sistemas. Antes sólo 6
            # ("equivalencias rápidas") y el drawer de edición recibía la
            # talla INCOMPLETA: al guardar se nulaban los otros 9
            # (us_youth, uk_women, uk_youth, mx, ar, jp, cn, kr, alfa).
            *Talla.EQUIVALENCE_FIELDS,
            # dimensiones (informativo en lista)
            "grosor_antepie_mm", "grosor_talon_mm", "drop_mm", "peso_g",
            "created_at", "updated_at",
        )
