from rest_framework import serializers
from .models import Producto


class ProductoListSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Producto
        fields = (
            "id", "sku", "nombre", "marca_id", "categoria", "subcategoria",
            "unidad", "moneda", "costo_estandar", "precio_lista", "precio_distribuidor",
            "estado", "pais_origen_iso2", "is_active", "updated_at",
        )


class ProductoSerializer(serializers.ModelSerializer):
    # Por decisión de producto: NINGÚN campo es obligatorio al crear/editar.
    # Esto permite guardar borradores con sólo el SKU o sólo el nombre.
    sku    = serializers.CharField(max_length=64,  required=False, allow_blank=True, allow_null=True)
    nombre = serializers.CharField(max_length=160, required=False, allow_blank=True, allow_null=True)

    class Meta:
        model  = Producto
        fields = "__all__"
        # `id` debe ser read_only para que DRF no lo exija en el payload;
        # el ViewSet lo inyecta vía s.save(id=uuid.uuid4()) (mismo patrón
        # que nodos/clientes/marcas). created_at/updated_at son auto.
        read_only_fields = ("id", "created_at", "updated_at")
