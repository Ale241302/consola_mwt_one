from decimal import Decimal, ROUND_HALF_UP
from rest_framework import serializers
from .models import (
    Proveedor,
    SupplierPromoCode,
    SupplierAuditEvent,
    SupplierImportLog,
    SupplierCertificacion,
    SupplierProductAssignment,
    SupplierIsoEvaluation,
)


# PLB_SUPPLIER_EVAL · pesos canónicos ISO 9001:2015 §8.4 — única fuente
# de verdad. El frontend puede previsualizarlos pero el cálculo
# definitivo se ejecuta acá.
EVAL_WEIGHTS = {
    "score_calidad":      Decimal("0.30"),
    "score_entrega":      Decimal("0.25"),
    "score_comunicacion": Decimal("0.15"),
    "score_tecnica":      Decimal("0.15"),
    "score_precio":       Decimal("0.15"),
}


def compute_eval_total_and_decision(scores: dict):
    """Devuelve (score_total: Decimal(3,2), decision: str) blindado.

    scores: dict con las 5 claves score_calidad..score_precio (ints 1..5).
    """
    total = Decimal("0")
    for field, weight in EVAL_WEIGHTS.items():
        v = Decimal(int(scores[field]))
        total += v * weight
    total = total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    if total >= Decimal("4.0"):
        decision = "MANTENER"
    elif total >= Decimal("3.0"):
        decision = "MONITOREAR"
    elif total >= Decimal("2.0"):
        decision = "PLAN_MEJORA"
    else:
        decision = "DESCONTINUAR"
    return total, decision


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


class SupplierIsoEvaluationSerializer(serializers.ModelSerializer):
    """PLB_SUPPLIER_EVAL — evaluación ISO 9001:2015 §8.4.

    Cada uno de los 5 score_* es entero 1..5 (validado). El backend
    CALCULA score_total y decision con los pesos canónicos
    (compute_eval_total_and_decision) — el frontend no puede inyectarlos.
    Eso vale por dos razones:
      1. evita que un cliente malicioso registre auditorías mintiendo el
         score total para evadir 'PLAN_MEJORA' / 'DESCONTINUAR';
      2. mantiene la fórmula en una sola fuente de verdad.

    Defensa: aún si el FE manda score_total/decision en el payload, los
    sobrescribimos en validate(). El cliente nunca puede ganarle al
    backend.
    """
    # Permitimos lectura pero no escritura — extra defensa además del override.
    score_total = serializers.DecimalField(
        max_digits=3, decimal_places=2, read_only=True,
    )
    decision = serializers.CharField(read_only=True)

    # Display helpers (read-only)
    evaluator_email = serializers.SerializerMethodField()

    class Meta:
        model  = SupplierIsoEvaluation
        fields = (
            "id", "supplier_id", "evaluator_id", "evaluator_email",
            "periodo",
            "score_calidad", "score_entrega", "score_comunicacion",
            "score_tecnica", "score_precio",
            "score_total", "decision",
            "comentarios", "documento_evidencia",
            "is_active", "created_at", "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at",
                            "score_total", "decision", "evaluator_email")

    # ── Validación: cada score 1..5 ───────────────────────────────
    def _validate_score(self, value, field):
        v = int(value)
        if v < 1 or v > 5:
            raise serializers.ValidationError(
                f"{field}: debe estar entre 1 y 5 (recibido {v})"
            )
        return v

    def validate(self, attrs):
        # Validar y normalizar los 5 scores
        for f in EVAL_WEIGHTS.keys():
            if f not in attrs:
                raise serializers.ValidationError({f: "Este campo es obligatorio."})
            attrs[f] = self._validate_score(attrs[f], f)

        # Cálculo blindado — sobrescribe cualquier intento del FE
        total, decision = compute_eval_total_and_decision({
            f: attrs[f] for f in EVAL_WEIGHTS.keys()
        })
        attrs["score_total"] = total
        attrs["decision"]    = decision

        if not attrs.get("periodo"):
            raise serializers.ValidationError({"periodo": "Este campo es obligatorio."})
        return attrs

    def get_evaluator_email(self, obj):
        m = (self.context or {}).get("evaluator_emails") or {}
        return m.get(str(obj.evaluator_id), "") if obj.evaluator_id else ""
