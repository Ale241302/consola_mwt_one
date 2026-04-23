from rest_framework import serializers
from .models import MwtUser, PortalSessionLog, PortalAuditLog

# Importación tardía en los serializers del catálogo — evitamos acoplamiento
# fuerte entre apps.portal y apps.productos a nivel de módulo.
from apps.productos.models import Producto


class MwtUserListSerializer(serializers.ModelSerializer):
    class Meta:
        model  = MwtUser
        fields = (
            "id", "email", "full_name", "role",
            "legal_entity_id", "phone", "locale", "timezone",
            "is_api_user", "last_login_at", "accepted_at",
            "failed_login_count", "locked_until",
            "is_active", "updated_at",
        )


class MwtUserSerializer(serializers.ModelSerializer):
    class Meta:
        model  = MwtUser
        fields = "__all__"
        # Nunca devolver password_hash ni api_key_hash en responses
        extra_kwargs = {
            "password_hash": {"write_only": True},
            "api_key_hash":  {"write_only": True},
        }


class PortalSessionLogSerializer(serializers.ModelSerializer):
    class Meta:
        model  = PortalSessionLog
        fields = "__all__"


class PortalAuditLogSerializer(serializers.ModelSerializer):
    class Meta:
        model  = PortalAuditLog
        fields = "__all__"


# ════════════════════════════════════════════════════════════════════
# CATÁLOGO B2B · Strip-Down Serializers (Defensa en Profundidad)
#
# Regla de oro (POL_VISIBILIDAD):
#   Los siguientes campos NUNCA deben viajar al portal del cliente:
#     · costo_estandar          (costo interno — CEO-ONLY)
#     · precio_mwt              (precio comercial interno MWT — CEO-ONLY)
#     · precio_lista            (tarifa maestra — CEO-ONLY)
#     · precio_distribuidor     (se expone RENOMBRADO como precio_venta
#                                o se sustituye por resolve_client_price)
#     · proveedor_principal_id  (trazabilidad de fábrica — INTERNAL)
#     · stock_minimo            (política ops — INTERNAL)
#     · stock_maximo            (política ops — INTERNAL)
#     · visibility_tier         (flag operativo interno)
#     · hs_code                 (clasificación arancelaria interna)
#
# Para mantener la garantía en defensa-en-profundidad usamos un
# ModelSerializer con `fields=` explícito (whitelist). Cualquier campo
# nuevo que [AG-DATABASE] agregue a productos.producto queda OCULTO
# por default hasta que lo añadamos conscientemente acá.
# ════════════════════════════════════════════════════════════════════
class ProductPortalListSerializer(serializers.ModelSerializer):
    """
    Serializer del Catálogo B2B (list view). Payload mínimo: lo
    indispensable para renderizar la ProductCatalogGrid del portal.
    """
    precio_venta = serializers.SerializerMethodField()
    marca_label  = serializers.SerializerMethodField()

    class Meta:
        model  = Producto
        fields = (
            "id",
            "sku",
            "nombre",
            "descripcion",
            "marca_id",
            "marca_label",
            "categoria",
            "subcategoria",
            "unidad",
            "moneda",
            "imagen_url",
            "estado",
            "precio_venta",
        )
        read_only_fields = fields  # API read-only 100%

    def get_precio_venta(self, obj) -> float:
        """Expone el precio destinado al cliente como un solo número.

        Orden de precedencia:
          1. `precio_venta_resolved` (set por el ViewSet si llamó a
             apps.commercial.resolve_client_price con el client_id del
             JWT para este SKU).
          2. fallback: `precio_distribuidor` del catálogo (no es el
             tope-of-tree comercial pero es el menos sensible de los
             campos de precio y funciona como anchor para el grid).
        """
        resolved = getattr(obj, "precio_venta_resolved", None)
        if resolved is not None:
            try:
                return float(resolved)
            except (TypeError, ValueError):
                pass
        try:
            return float(obj.precio_distribuidor or 0)
        except (TypeError, ValueError):
            return 0.0

    def get_marca_label(self, obj) -> str | None:
        """Atributo inyectado por el ViewSet (LEFT JOIN en SQL)."""
        return getattr(obj, "_marca_label", None)


class ProductPortalDetailSerializer(ProductPortalListSerializer):
    """
    Serializer de la pestaña "Detalles y Especificaciones".
    Extiende el list con los campos de ficha técnica (especificaciones,
    tallas, colores, pesos/volúmenes). SIGUE EXCLUYENDO costos, márgenes,
    proveedor y stock.
    """

    class Meta(ProductPortalListSerializer.Meta):
        fields = ProductPortalListSerializer.Meta.fields + (
            "especificaciones",
            "tallas",
            "colores",
            "peso_kg",
            "volumen_m3",
            "pais_origen_iso2",
            "ficha_url",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields
