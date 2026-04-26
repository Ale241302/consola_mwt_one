from rest_framework import serializers
from .models import Producto


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


class ProductoListSerializer(serializers.ModelSerializer):
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


class ProductoSerializer(serializers.ModelSerializer):
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
