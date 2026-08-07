from rest_framework import serializers
from apps.storage.serializers import StorageNormalizeMixin
from .models import MwtUser, PortalSessionLog, PortalAuditLog

# Importación tardía en los serializers del catálogo — evitamos acoplamiento
# fuerte entre apps.portal y apps.productos a nivel de módulo.
from apps.productos.models import Producto
from apps.expedientes.models import Expediente, Linea, Documento


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
class ProductPortalListSerializer(StorageNormalizeMixin, serializers.ModelSerializer):
    storage_normalize_fields = ("imagen_url", "ficha_url")
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


# ════════════════════════════════════════════════════════════════════
# EXPEDIENTE B2B · Strip-Down Serializers (Defensa en Profundidad)
#
# Regla de oro (POL_VISIBILIDAD):
#   Campos PROHIBIDOS en el payload del portal cliente:
#     · total_cost              (costo operativo interno — CEO-ONLY)
#     · commission_pct          (comisión MWT — CEO-ONLY)
#     · projected_margin        (margen proyectado — CEO-ONLY)
#     · real_margin             (margen realizado — CEO-ONLY)
#     · modo_operacion          (COMISION/FULL — decisión interna)
#     · freight_mode            (ruteo logístico — INTERNAL)
#     · transport_mode          (ruteo logístico — INTERNAL)
#     · dispatch_mode           (FCL/LCL — INTERNAL)
#     · price_basis             (incoterm interno — INTERNAL)
#     · credit_band             (band de riesgo — INTERNAL)
#     · credit_days             (política interna — INTERNAL)
#     · credit_clock_start_rule (gobernanza financiera — INTERNAL)
#     · factory_delay           (flag ops — INTERNAL)
#     · is_blocked              (flag ops — INTERNAL)
#     · phase_signal            (semáforo CEO — INTERNAL)
#     · cost_lines (relación)   (composición de costos — CEO-ONLY)
#     · margins (relación)      (cálculo de rentabilidad — CEO-ONLY)
#     · available_transitions   (próximas acciones del pipeline — INTERNAL)
#     · submitted_by_*          (auditoría interna — INTERNAL)
#     · supplier_id             (fábrica — INTERNAL)
#
# Campos EXPUESTOS (whitelist):
#   id, codigo, oc_id, brand_id, client_id, estado (traducido),
#   origin, destination, freight público simplificado,
#   eta, last_event_at, total_invoiced, total_paid, balance,
#   coverage_pct, currency, created_at, updated_at.
# ════════════════════════════════════════════════════════════════════

# Mapa de estado técnico → etiqueta pública (estado_cliente)
# (replicado de apps.portal.views.CLIENT_STATE_MAP para que el serializer
#  no dependa del módulo views)
_CLIENT_STATE_LABELS = {
    "REGISTRO":    {"es": "Confirmado",     "en": "Confirmed",     "step": 0},
    "PRODUCCION":  {"es": "En fabricación", "en": "Manufacturing", "step": 1},
    "PREPARACION": {"es": "Preparación",    "en": "Preparing",     "step": 2},
    "DESPACHO":    {"es": "Despachado",     "en": "Dispatched",    "step": 3},
    "TRANSITO":    {"es": "En tránsito",    "en": "In transit",    "step": 3},
    "EN_DESTINO":  {"es": "En aduana",      "en": "In customs",    "step": 4},
    "CERRADO":     {"es": "Listo",          "en": "Ready",         "step": 5},
}


class ExpedientePortalListSerializer(serializers.ModelSerializer):
    """Shape mínimo para listados — un expediente por fila.

    Excluye TODO lo sensible por diseño (fields= es whitelist explícita).
    """
    estado_cliente_es   = serializers.SerializerMethodField()
    estado_cliente_en   = serializers.SerializerMethodField()
    estado_cliente_step = serializers.SerializerMethodField()

    class Meta:
        model  = Expediente
        fields = (
            "id",
            "codigo",
            "oc_id",
            "brand_id",
            "client_id",
            "estado",              # técnico — la UI puede ocultarlo si quiere
            "estado_cliente_es",
            "estado_cliente_en",
            "estado_cliente_step",
            "origin",
            "destination",
            "eta",
            "last_event_at",
            "total_invoiced",
            "total_paid",
            "balance",
            "coverage_pct",
            "moneda",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields

    def _map(self, obj):
        return _CLIENT_STATE_LABELS.get(obj.estado or "", {})

    def get_estado_cliente_es(self, obj):   return self._map(obj).get("es", obj.estado or "—")
    def get_estado_cliente_en(self, obj):   return self._map(obj).get("en", obj.estado or "—")
    def get_estado_cliente_step(self, obj): return self._map(obj).get("step", 0)


class ExpedientePortalLineaSerializer(serializers.ModelSerializer):
    """Líneas del expediente visibles al cliente: SKU, qty, precio final.

    NUNCA incluye `cost_usd`, `margen_*`, `sap`, `supplier_id`.
    """
    class Meta:
        model  = Linea
        fields = (
            "id",
            "oc_id",
            "expediente_id",
            "producto_id",
            "sku",
            "size",
            "qty",
            "unit_price",
            "total_price",
            "estado",
        )
        read_only_fields = fields


class ExpedientePortalDocumentoSerializer(StorageNormalizeMixin, serializers.ModelSerializer):
    storage_normalize_fields = ("storage_url",)
    """Documentos expuestos al cliente (solo artefactos públicos:
    proforma, BL/AWB, factura, packing list).

    NUNCA incluye documentos INTERNAL/CEO-ONLY (ART-03 Decisión de Modo,
    ART-08 Pricing interno, ART-11 Costos operativos, etc.) — el
    filtrado por whitelist de `kind` lo hace el ViewSet, no el serializer.
    """
    class Meta:
        model  = Documento
        fields = (
            "id",
            "oc_id",
            "expediente_id",
            "kind",
            "codigo",
            "fecha",
            "storage_url",     # el ViewSet la reemplaza por signed URL
            "created_at",
        )
        read_only_fields = fields


class ExpedientePortalDetailSerializer(ExpedientePortalListSerializer):
    """Detalle completo para /api/portal/expedientes/{id}/.

    Incluye `lineas` y `documentos` (whitelisted). Sigue EXCLUYENDO
    cost_lines, margins, supplier, modo_operacion, freight/transport/
    dispatch, credit_*, phase_signal, available_transitions.
    """
    lineas     = serializers.SerializerMethodField()
    documentos = serializers.SerializerMethodField()

    class Meta(ExpedientePortalListSerializer.Meta):
        fields = ExpedientePortalListSerializer.Meta.fields + (
            "lineas",
            "documentos",
        )
        read_only_fields = fields

    def get_lineas(self, obj):
        qs = Linea.objects.filter(expediente_id=obj.id, is_active=True).order_by("sku", "size")
        return ExpedientePortalLineaSerializer(qs, many=True).data

    def get_documentos(self, obj):
        # Whitelist de kinds públicos para el cliente
        PUBLIC_KINDS = [
            "Proforma", "Proforma MWT",
            "BL", "AWB", "Bill of Lading", "Airway Bill",
            "Factura", "Invoice", "Packing List", "Certificado",
            "Confirmación SAP",   # visible como comprobante de fabricación
        ]
        qs = Documento.objects.filter(
            expediente_id=obj.id,
            is_active=True,
            kind__in=PUBLIC_KINDS,
        ).order_by("-fecha", "-created_at")
        return ExpedientePortalDocumentoSerializer(qs, many=True).data
