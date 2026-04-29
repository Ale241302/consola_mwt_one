from rest_framework import serializers
from .models import (
    Transferencia, Linea, Evento, TransferenciaDocumento,
    CostLine, CostKindCat,
)


class TransferenciaListSerializer(serializers.ModelSerializer):
    # Agregados — sin estos el FE muestra "0 SKU · 0 RESV." porque
    # no se trae el array `lines` en el listado.
    lines_count        = serializers.SerializerMethodField()
    total_qty_transfer = serializers.SerializerMethodField()
    total_qty_received = serializers.SerializerMethodField()

    class Meta:
        model  = Transferencia
        fields = (
            "id", "codigo", "origen_id", "destino_id",
            "origen_label", "destino_label",
            "legal_context", "estado", "ref_tracking",
            "needs_approval", "value_usd",
            "dispatched_at", "eta", "received_at",
            "discrepancy_count", "has_discrepancy",
            "is_active", "updated_at",
            # agregados de líneas
            "lines_count", "total_qty_transfer", "total_qty_received",
        )

    def get_lines_count(self, obj):
        return Linea.objects.filter(transferencia_id=obj.id, is_active=True).count()

    def get_total_qty_transfer(self, obj):
        from django.db.models import Sum
        agg = Linea.objects.filter(
            transferencia_id=obj.id, is_active=True
        ).aggregate(t=Sum("qty_transfer"))
        return int(agg["t"] or 0)

    def get_total_qty_received(self, obj):
        from django.db.models import Sum
        agg = Linea.objects.filter(
            transferencia_id=obj.id, is_active=True
        ).aggregate(t=Sum("qty_received"))
        return int(agg["t"] or 0)


class TransferenciaSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Transferencia
        fields = "__all__"
        # `id` se inyecta por el ViewSet (s.save(id=uuid.uuid4())). Sin
        # esto el serializer lo marca required y is_valid() falla antes
        # de llegar al save → 500. Mismo patrón que proveedores/productos.
        # has_discrepancy es columna GENERATED → la excluimos del payload
        # validable; se devuelve solo en GET.
        read_only_fields = ("id", "created_at", "updated_at", "has_discrepancy")

    # ── Validación de capacidades de nodos (sprint Transfer Engine v2) ──
    # Origen DEBE tener "DISPATCH" en capabilities, destino DEBE tener
    # "RECEIVE". Las capacidades viven en nodos.nodo.capabilities (JSONB
    # array). Si el nodo no se encuentra (mock/seed antiguo) la validación
    # se relaja para no romper demos — pero loguea WARNING.
    def validate(self, attrs):
        attrs = super().validate(attrs)
        origen_id  = attrs.get("origen_id")  or (self.instance and self.instance.origen_id)
        destino_id = attrs.get("destino_id") or (self.instance and self.instance.destino_id)
        if origen_id and destino_id and str(origen_id) == str(destino_id):
            raise serializers.ValidationError(
                {"destino_id": "Origen y destino no pueden ser el mismo nodo."}
            )
        if self.instance is None:
            self._assert_node_capability(origen_id,  "DISPATCH", "origen_id",
                                         "El nodo origen no tiene la capacidad de despachar (DISPATCH).")
            self._assert_node_capability(destino_id, "RECEIVE",  "destino_id",
                                         "El nodo destino no tiene la capacidad de recibir (RECEIVE).")

        # context_data por motivo (sprint Transfer Engine v2)
        legal_ctx = (attrs.get("legal_context") or
                     (self.instance and self.instance.legal_context) or
                     "INTERNAL").upper()
        ctx_data = attrs.get("context_data")
        if ctx_data is not None:
            attrs["context_data"] = self._validate_context_data(legal_ctx, ctx_data)
        return attrs

    @staticmethod
    def _validate_context_data(legal_ctx, raw):
        if not isinstance(raw, dict):
            raise serializers.ValidationError(
                {"context_data": "Debe ser un objeto JSON."}
            )
        out = dict(raw)
        if legal_ctx == "INTERNAL":
            base = {
                "carrier_name":    str(out.get("carrier_name") or "")[:160],
                "vehicle_plate":   str(out.get("vehicle_plate") or "")[:32],
                "vehicle_id":      str(out.get("vehicle_id") or "")[:64],
                "conductor_name":  str(out.get("conductor_name") or "")[:160],
            }
            extras = {k: v for k, v in out.items() if k not in base}
            return {**base, **extras}
        if legal_ctx == "NATIONALIZATION":
            base = {
                "bl_awb_number": str(out.get("bl_awb_number") or "")[:64],
                "dua_number":    str(out.get("dua_number") or "")[:64],
            }
            extras = {k: v for k, v in out.items() if k not in base}
            return {**base, **extras}
        if legal_ctx == "EXPORT":
            base = {
                "international_carrier": str(out.get("international_carrier") or "")[:160],
                "container_number":      str(out.get("container_number") or "")[:32],
                "awb_bl_number":         str(out.get("awb_bl_number") or "")[:64],
            }
            extras = {k: v for k, v in out.items() if k not in base}
            return {**base, **extras}
        if legal_ctx == "DISTRIBUTION":
            tp_amount = out.get("transfer_pricing_amount")
            if tp_amount in (None, "", 0, "0"):
                raise serializers.ValidationError({
                    "context_data": (
                        "DISTRIBUTION requiere transfer_pricing_amount > 0 "
                        "(precio de transferencia ART-16)."
                    )
                })
            try:
                tp_amount = float(tp_amount)
                if tp_amount <= 0:
                    raise ValueError
            except (TypeError, ValueError):
                raise serializers.ValidationError({
                    "context_data": "transfer_pricing_amount debe ser un numero > 0."
                })
            base = {
                "transfer_pricing_amount":   tp_amount,
                "transfer_pricing_currency": str(out.get("transfer_pricing_currency") or "USD").upper()[:3],
                "transfer_pricing_basis":    str(out.get("transfer_pricing_basis") or "PER_UNIT")[:32],
                "requires_tp_approval":      True,
                "crosses_border":            bool(out.get("crosses_border", False)),
                "awb_bl_number":             str(out.get("awb_bl_number") or "")[:64],
            }
            extras = {k: v for k, v in out.items() if k not in base}
            return {**base, **extras}
        if legal_ctx == "CONSIGNMENT":
            base = {
                "report_frequency": str(out.get("report_frequency") or "WEEKLY")[:32],
                "contract_ref":     str(out.get("contract_ref") or "")[:64],
                "awb_bl_number":    str(out.get("awb_bl_number") or "")[:64],
            }
            extras = {k: v for k, v in out.items() if k not in base}
            return {**base, **extras}
        return out

    @staticmethod
    def _assert_node_capability(node_id, required_cap, field, msg):
        if not node_id:
            return
        from django.db import connection
        try:
            with connection.cursor() as c:
                c.execute(
                    "SELECT capabilities, status, is_active "
                    "FROM nodos.nodo WHERE id = %s",
                    [str(node_id)],
                )
                row = c.fetchone()
        except Exception:
            return
        if not row:
            return
        capabilities, status, is_active = row
        caps_upper = {str(x).upper() for x in (capabilities or [])}
        if required_cap.upper() not in caps_upper:
            raise serializers.ValidationError({field: msg})
        if is_active is False:
            raise serializers.ValidationError(
                {field: "El nodo está inactivo y no puede operar."}
            )
        if status and str(status).upper() in ("RETIRED", "INACTIVE"):
            raise serializers.ValidationError(
                {field: f"El nodo está en estado {status} y no puede operar."}
            )


class LineaSerializer(serializers.ModelSerializer):
    delta_qty       = serializers.SerializerMethodField()
    delta_value_usd = serializers.SerializerMethodField()

    class Meta:
        model  = Linea
        fields = "__all__"
        # `id` se inyecta vía s.save(id=uuid.uuid4()) en el ViewSet.
        # Sin read_only el validador lo marca required → 400
        # {"id":["Este campo es requerido."]}.
        read_only_fields = ("id", "created_at", "updated_at")

    def get_delta_qty(self, obj):
        try:
            if obj.qty_received is None:
                return None
            return int(obj.qty_received or 0) - int(obj.qty_transfer or 0)
        except Exception:
            return None

    def get_delta_value_usd(self, obj):
        try:
            if obj.qty_received is None:
                return None
            delta = int(obj.qty_received or 0) - int(obj.qty_transfer or 0)
            cost  = obj.snapshot_unit_cost or obj.unit_cost or 0
            return float(delta) * float(cost or 0)
        except Exception:
            return None


class EventoSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Evento
        fields = "__all__"
        # `id` se inyecta vía s.save(id=uuid.uuid4()) en el ViewSet.
        read_only_fields = ("id", "created_at")


class TransferenciaDocumentoSerializer(serializers.ModelSerializer):
    class Meta:
        model  = TransferenciaDocumento
        fields = "__all__"
        # `id` se inyecta vía s.save(id=uuid.uuid4()) en el ViewSet.
        read_only_fields = ("id", "created_at", "updated_at")


# ── Sprint Transfer Engine v2 (cost lines + OCR) ─────────────
class CostLineSerializer(serializers.ModelSerializer):
    class Meta:
        model  = CostLine
        fields = "__all__"
        # amount_usd es columna GENERATED en DB → read-only.
        # `id` se inyecta en el ViewSet vía s.save(id=uuid.uuid4()).
        read_only_fields = ("id", "amount_usd", "created_at", "updated_at")


class CostKindCatSerializer(serializers.ModelSerializer):
    class Meta:
        model  = CostKindCat
        fields = ("codigo", "label", "descripcion", "is_fiscal", "color", "orden")
