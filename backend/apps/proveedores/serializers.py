from rest_framework import serializers
from .models import (
    Proveedor,
    SupplierPromoCode,
    SupplierAuditEvent,
    SupplierImportLog,
    SupplierCertificacion,
    SupplierProductAssignment,
)


# Roles que pueden ver datos sensibles (POL_VISIBILIDAD CEO-ONLY).
# Cualquier otro role (cliente B2B, viewer, etc.) recibe payloads sin
# costos. La lista es conservadora — agregar aquí roles nuevos que
# deban ver costos.
_ADMIN_ROLES = {"admin", "ceo", "superadmin", "ops_admin"}


def _is_admin(request) -> bool:
    """True si el request.user puede ver datos sensibles (costos FOB)."""
    if request is None:
        return False
    user = getattr(request, "user", None)
    if not user or not getattr(user, "is_authenticated", False):
        return False
    role = (getattr(user, "role", "") or "").lower()
    return role in _ADMIN_ROLES or bool(getattr(user, "is_superuser", False))


class ProveedorListSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Proveedor
        fields = (
            "id", "codigo", "razon_social", "nombre_comercial", "tax_id",
            "tipo", "estado", "pais_iso2", "ciudad",
            "lead_time_dias", "incoterm_default", "rating",
            "clase", "score_iso", "producto_servicio",
            "is_active", "updated_at",
        )


class ProveedorSerializer(serializers.ModelSerializer):
    # Por decisión de producto: NINGÚN campo es obligatorio al crear/editar.
    # Permite guardar borradores sin razón social ni nombre.
    razon_social     = serializers.CharField(max_length=192, required=False, allow_blank=True, allow_null=True)
    nombre_comercial = serializers.CharField(max_length=160, required=False, allow_blank=True, allow_null=True)

    class Meta:
        model  = Proveedor
        fields = "__all__"
        # `id` debe ser read_only para que DRF no lo exija en el payload;
        # el ViewSet lo inyecta vía s.save(id=uuid.uuid4()) (mismo patrón
        # que nodos/clientes/marcas/productos).
        read_only_fields = ("id", "created_at", "updated_at")


class SupplierPromoCodeSerializer(serializers.ModelSerializer):
    class Meta:
        model  = SupplierPromoCode
        fields = "__all__"
        read_only_fields = ("id", "usos_actuales", "created_at", "updated_at")


class SupplierAuditEventSerializer(serializers.ModelSerializer):
    class Meta:
        model  = SupplierAuditEvent
        fields = "__all__"
        read_only_fields = ("id", "created_at")


class SupplierImportLogSerializer(serializers.ModelSerializer):
    class Meta:
        model  = SupplierImportLog
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class SupplierCertificacionSerializer(serializers.ModelSerializer):
    class Meta:
        model  = SupplierCertificacion
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class SupplierProductAssignmentSerializer(serializers.ModelSerializer):
    """Catálogo de abastecimiento (producto ↔ proveedor).

    Reglas:
      · `base_cost_usd` se OCULTA del payload si el request.user no es
        admin/CEO. Defensa en serializer (la UI también lo gatea).
      · `cantidad_12m` y `ultima_po_fecha` son anotaciones dinámicas
        inyectadas por la action GET — read-only.
      · `nombre_producto` se enriquece desde productos.producto en la
        action (no es un campo de la tabla).
    """
    # Anotaciones dinámicas (read-only, vienen de la action)
    cantidad_12m    = serializers.SerializerMethodField()
    ultima_po_fecha = serializers.SerializerMethodField()
    nombre_producto = serializers.SerializerMethodField()

    class Meta:
        model  = SupplierProductAssignment
        fields = (
            "id", "supplier_id", "product_sku",
            "supplier_sku_code", "moq", "base_cost_usd",
            "production_lead_time_days",
            "notas", "is_active", "created_at", "updated_at",
            # campos dinámicos
            "cantidad_12m", "ultima_po_fecha", "nombre_producto",
        )
        read_only_fields = ("id", "created_at", "updated_at")

    # --- Anotaciones --------------------------------------------------
    def get_cantidad_12m(self, obj):
        # La action precarga un dict {sku: qty} en context["qty_12m"].
        m = (self.context or {}).get("qty_12m") or {}
        return float(m.get(obj.product_sku, 0) or 0)

    def get_ultima_po_fecha(self, obj):
        m = (self.context or {}).get("ultima_po") or {}
        v = m.get(obj.product_sku)
        return v.isoformat() if v else None

    def get_nombre_producto(self, obj):
        m = (self.context or {}).get("nombres") or {}
        return m.get(obj.product_sku, "") or ""

    # --- POL_VISIBILIDAD ---------------------------------------------
    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = (self.context or {}).get("request")
        if not _is_admin(request):
            # Eliminación silenciosa del costo de fábrica (CEO-ONLY).
            data.pop("base_cost_usd", None)
        return data
