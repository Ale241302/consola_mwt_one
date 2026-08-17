from rest_framework import serializers
from apps.storage.serializers import StorageNormalizeMixin
from .models import Producto, ProductClientAlias, NcmCode


# ── Cache simple en memoria para evitar N+1 al resolver marca_id → nombre.
#    Se rellena la primera vez que se serializa una lista; se invalida
#    cada vez que el ViewSet hace list/retrieve (5 segundos TTL). ──
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


class ProductoListSerializer(StorageNormalizeMixin, serializers.ModelSerializer):
    storage_normalize_fields = ("imagen_url", "ficha_url")
    # Nombre de la marca derivado de marca_id (UUID). Sin FK, así que
    # lookup vía cache compartido. El FE usa marca_id para la lógica
    # interna (selectores, edits) y marca_nombre para mostrar.
    marca_nombre = serializers.SerializerMethodField()
    def get_marca_nombre(self, obj):
        return _marca_nombre(obj.marca_id)

    class Meta:
        model  = Producto
        fields = (
            "id", "sku", "nombre", "marca_id", "marca_nombre",
            "categoria", "subcategoria",
            "unidad", "moneda", "costo_estandar", "precio_lista", "precio_distribuidor",
            "estado", "pais_origen_iso2", "is_active", "updated_at",
            # Imagen principal (gallery[0]). El FE la renderiza como thumb
            # en el grid; viene como key MinIO para usar con /api/storage/download/
            "imagen_url",
            # Ficha técnica (JSON) — necesaria para que el card del listado
            # de productos en BrandDetail muestre capellada/suela/color/etc.
            # Sin esto el frontend pintaba todas las specs como "—" porque
            # esos campos viven dentro de `especificaciones`, no como columnas.
            "especificaciones",
        )

    # Ola 6 · 6.8 — POL_VISIBILIDAD: `costo_estandar` es dato interno (costo
    # MWT). Solo se entrega a staff (admin/superadmin/ceo/manager); cualquier
    # rol cliente (client_b2b, portal, MCP) NO debe recibirlo. El MCP ya lo
    # redacta en capa MCP (redact.py), pero el backend no debe exponerlo crudo.
    def to_representation(self, instance):
        data = super().to_representation(instance)
        from apps.core.permissions import is_ceo_or_admin_role

        request = self.context.get("request") if self.context else None
        user = getattr(request, "user", None) if request else None
        role = (getattr(user, "role", "") or "").lower()
        if not (is_ceo_or_admin_role(role) or getattr(user, "is_superuser", False)):
            data.pop("costo_estandar", None)
        return data


class ProductoSerializer(StorageNormalizeMixin, serializers.ModelSerializer):
    storage_normalize_fields = ("imagen_url", "ficha_url")
    # Por decisión de producto: NINGÚN campo es obligatorio al crear/editar.
    # Esto permite guardar borradores con sólo el SKU o sólo el nombre.
    sku    = serializers.CharField(max_length=64,  required=False, allow_blank=True, allow_null=True)
    nombre = serializers.CharField(max_length=160, required=False, allow_blank=True, allow_null=True)

    # Read-only: nombre de la marca derivado de marca_id.
    marca_nombre = serializers.SerializerMethodField()
    def get_marca_nombre(self, obj):
        return _marca_nombre(obj.marca_id)

    class Meta:
        model  = Producto
        fields = "__all__"
        # `id` debe ser read_only para que DRF no lo exija en el payload;
        # el ViewSet lo inyecta vía s.save(id=uuid.uuid4()) (mismo patrón
        # que nodos/clientes/marcas). created_at/updated_at son auto.
        read_only_fields = ("id", "created_at", "updated_at", "marca_nombre")

    # Ola 6 · 6.8 — POL_VISIBILIDAD: mismo gate que ProductoListSerializer.
    # Un rol cliente no debe recibir costo_estandar (costo interno MWT).
    def to_representation(self, instance):
        data = super().to_representation(instance)
        from apps.core.permissions import is_ceo_or_admin_role

        request = self.context.get("request") if self.context else None
        user = getattr(request, "user", None) if request else None
        role = (getattr(user, "role", "") or "").lower()
        if not (is_ceo_or_admin_role(role) or getattr(user, "is_superuser", False)):
            data.pop("costo_estandar", None)
        return data

class ProductClientAliasSerializer(serializers.ModelSerializer):
    """
    Alias por cliente para un producto. Endpoint expuesto en
    /api/productos/<producto_id>/aliases/. CEO/ADMIN-only para escritura.
    """
    class Meta:
        model  = ProductClientAlias
        fields = (
            "id", "producto_id", "cliente_id",
            "alias", "cliente_sku", "notas",
            "is_active",
            "created_at", "updated_at",
        )
        read_only_fields = ("id", "producto_id", "is_active",
                            "created_at", "updated_at")

    def validate_alias(self, v):
        v = (v or "").strip()
        if not v:
            raise serializers.ValidationError("El alias no puede estar vacio.")
        return v


class NcmCodeSerializer(serializers.ModelSerializer):
    productos_asociados = serializers.SerializerMethodField()

    class Meta:
        model  = NcmCode
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")

    def get_productos_asociados(self, obj):
        from apps.productos.models import Producto
        from django.db.models import Q
        qs = Producto.objects.filter(
            Q(hs_code=obj.code) | Q(especificaciones__ncm=obj.code),
            is_active=True
        ).only("sku", "nombre").order_by("sku")
        return [{"sku": p.sku, "nombre": p.nombre} for p in qs]


