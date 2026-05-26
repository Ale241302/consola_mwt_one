"""
Serializers de finance v2.0.

`PaymentRegisterSerializer` ingiere el payload multipart del drawer
"Registrar pago" v2.0 (frontend/src/pages/ExpedienteDetail.jsx).
Acepta JSON-stringified `aplicaciones`, valida el File adjunto y
delega la persistencia atómica a `services.PaymentService.register`.
"""
from __future__ import annotations

import json
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List

from rest_framework import serializers

from .enums import (
    EVIDENCE_ALLOWED_MIMES, EVIDENCE_MAX_BYTES,
    PaymentApplicableType, PaymentMethod, PaymentType,
)
from .models import (
    Payment, PaymentApplication, PaymentEvidence, FinanceActivityLog,
    PaymentAIVerdict,
)


# ════════════════════════════════════════════════════════════
# Read serializers (responses)
# ════════════════════════════════════════════════════════════
class PaymentEvidenceSerializer(serializers.ModelSerializer):
    archivo_url = serializers.SerializerMethodField()

    class Meta:
        model  = PaymentEvidence
        fields = (
            "id", "payment_id", "bucket", "object_key",
            "mime_type", "size_bytes", "sha256", "original_name",
            "uploaded_by", "uploaded_at", "archivo_url",
        )

    def get_archivo_url(self, obj: PaymentEvidence) -> str | None:
        # URL firmada (15 min) — el FE la usa para preview/embed
        try:
            from apps.storage.services import generate_signed_url
        except Exception:
            return None
        result = generate_signed_url(
            obj.object_key, kind="get", ttl=900, bucket=obj.bucket,
        )
        return result.get("url") if result.get("available") else None


class PaymentApplicationSerializer(serializers.ModelSerializer):
    class Meta:
        model  = PaymentApplication
        fields = (
            "id", "payment_id",
            "applicable_type", "applicable_id", "applicable_code",
            "cantidad_producto", "monto_aplicado",
            "metadata", "created_at",
        )


class PaymentAIVerdictSerializer(serializers.ModelSerializer):
    class Meta:
        model  = PaymentAIVerdict
        # Excluimos `raw_claude_response` por defecto (puede ser largo y
        # filtrar tokens internos del modelo). Si se requiere para
        # debugging, query-param `?include_raw=1` en el view lo incluye.
        fields = (
            "id", "payment_id", "is_current", "status", "confianza",
            "monto_extraido", "moneda_extraida", "fecha_extraida",
            "referencia_extraida", "beneficiario_extraido",
            "ordenante_extraido", "banco_emisor", "banco_receptor",
            "concepto",
            "mismatch_fields", "razon_humana", "alertas_fraude",
            "model_version", "skill_version",
            "duration_ms", "tokens_input", "tokens_output", "cost_usd",
            "error_code", "error_message",
            "analyzed_at",
        )


class PaymentDetailSerializer(serializers.ModelSerializer):
    aplicaciones = serializers.SerializerMethodField()
    evidencia    = serializers.SerializerMethodField()
    ai_verdict   = serializers.SerializerMethodField()

    class Meta:
        model  = Payment
        fields = (
            "id", "codigo", "expediente_id", "client_id",
            "monto", "moneda", "tasa_cambio_a_usd", "monto_usd",
            "fecha", "metodo", "tipo_pago", "referencia",
            "estado", "notas",
            "created_by", "created_at", "updated_at",
            "confirmed_at", "confirmed_by",
            "reverted_at", "reverted_by", "reverted_reason",
            "event_id", "metadata", "is_active",
            "aplicaciones", "evidencia", "ai_verdict",
        )

    def get_aplicaciones(self, obj: Payment):
        qs = PaymentApplication.objects.filter(payment_id=obj.id).order_by("created_at")
        return PaymentApplicationSerializer(qs, many=True).data

    def get_evidencia(self, obj: Payment):
        ev = PaymentEvidence.objects.filter(payment_id=obj.id).first()
        return PaymentEvidenceSerializer(ev).data if ev else None

    def get_ai_verdict(self, obj: Payment):
        v = (PaymentAIVerdict.objects
             .filter(payment_id=obj.id, is_current=True)
             .order_by("-analyzed_at")
             .first())
        return PaymentAIVerdictSerializer(v).data if v else None


# ════════════════════════════════════════════════════════════
# Write serializer · multipart payload del drawer
# ════════════════════════════════════════════════════════════
class _ApplicationItemSerializer(serializers.Serializer):
    """Forma de cada elemento dentro del array `aplicaciones`."""
    applicable_type   = serializers.ChoiceField(choices=PaymentApplicableType.choices)
    applicable_id     = serializers.UUIDField()
    applicable_code   = serializers.CharField(max_length=64, required=False, allow_blank=True)
    cantidad_producto = serializers.IntegerField(required=False, min_value=1, allow_null=True)
    monto_aplicado    = serializers.DecimalField(max_digits=14, decimal_places=2)

    def validate(self, attrs):
        if attrs["applicable_type"] == PaymentApplicableType.PRODUCTO and not attrs.get("cantidad_producto"):
            raise serializers.ValidationError({
                "cantidad_producto": "Requerido cuando applicable_type=PRODUCTO",
            })
        if attrs["applicable_type"] != PaymentApplicableType.PRODUCTO and attrs.get("cantidad_producto"):
            attrs["cantidad_producto"] = None
        if Decimal(attrs["monto_aplicado"]) <= 0:
            raise serializers.ValidationError({
                "monto_aplicado": "Debe ser mayor a cero",
            })
        return attrs


class PaymentRegisterSerializer(serializers.Serializer):
    """
    Multipart input del drawer. La ruta es:
        POST /api/finance/payments/

    Form fields:
      · expediente_id (uuid)
      · monto (decimal)            · moneda (USD/EUR/COP/MXN/PEN)
      · fecha (YYYY-MM-DD)
      · metodo (TRANSFERENCIA_BANCARIA | NOTA_CREDITO)
      · tipo_pago (PARCIAL | COMPLETO)
      · referencia (str ≥ 3)
      · notas (str ≤ 500, opcional)
      · aplicaciones (JSON-string, array ≥ 1 item)
      · evidencia (file ≤ 10 MB, mime ∈ pdf/png/jpg/webp)
      · event_id (uuid, opcional — idempotencia)
    """
    expediente_id = serializers.UUIDField()
    monto         = serializers.DecimalField(max_digits=14, decimal_places=2)
    moneda        = serializers.CharField(min_length=3, max_length=3)
    fecha         = serializers.DateField()
    metodo        = serializers.ChoiceField(choices=PaymentMethod.choices)
    tipo_pago     = serializers.ChoiceField(choices=PaymentType.choices)
    referencia    = serializers.CharField(min_length=3, max_length=64)
    notas         = serializers.CharField(required=False, allow_blank=True, max_length=500)
    aplicaciones  = serializers.CharField()  # JSON string, validado en validate()
    evidencia     = serializers.FileField()
    event_id      = serializers.UUIDField(required=False)
    pre_verdict   = serializers.CharField(required=False, allow_blank=True,
                                          help_text=(
                                              "JSON string del resultado de /analyze-evidence. "
                                              "Si viene con status=MATCH y confianza>=90, el pago "
                                              "se crea directamente en CONFIRMADO_AI."
                                          ))

    # ── Validators de campo ────────────────────────────────
    def validate_monto(self, value):
        if Decimal(value) <= 0:
            raise serializers.ValidationError("El monto debe ser mayor a cero")
        return value

    def validate_moneda(self, value):
        v = (value or "").upper()
        if v not in {"USD", "EUR", "COP", "MXN", "PEN"}:
            raise serializers.ValidationError(
                "Moneda no soportada. Usa USD, EUR, COP, MXN o PEN.",
            )
        return v

    def validate_evidencia(self, file):
        size = getattr(file, "size", None) or 0
        if size > EVIDENCE_MAX_BYTES:
            raise serializers.ValidationError(
                f"El archivo supera el máximo de {EVIDENCE_MAX_BYTES // (1024 * 1024)} MB",
            )
        mime = (getattr(file, "content_type", "") or "").lower()
        if mime not in EVIDENCE_ALLOWED_MIMES:
            raise serializers.ValidationError(
                "Sólo se permiten PDF, PNG, JPG o WEBP como comprobante.",
            )
        return file

    def validate_aplicaciones(self, raw: str) -> List[Dict[str, Any]]:
        try:
            parsed = json.loads(raw) if isinstance(raw, str) else raw
        except json.JSONDecodeError:
            raise serializers.ValidationError("aplicaciones debe ser JSON válido")
        if not isinstance(parsed, list) or len(parsed) < 1:
            raise serializers.ValidationError("Debe haber al menos una aplicación")
        # Validar cada item con el sub-serializer
        cleaned: List[Dict[str, Any]] = []
        for idx, item in enumerate(parsed):
            sub = _ApplicationItemSerializer(data=item)
            if not sub.is_valid():
                raise serializers.ValidationError({
                    f"aplicaciones[{idx}]": sub.errors,
                })
            cleaned.append(sub.validated_data)
        return cleaned

    def validate_pre_verdict(self, raw: str) -> "dict | None":
        """Parsea y valida mínimamente el JSON de pre_verdict.
        
        Si viene vacío/None → devuelve None (se ignorará en register()).
        Si viene pero es JSON inválido → ValidationError.
        Si el dict no tiene status/confianza → ValidationError.
        """
        if not raw or not raw.strip():
            return None
        try:
            obj = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise serializers.ValidationError(
                f"pre_verdict debe ser JSON válido: {exc}"
            )
        if not isinstance(obj, dict):
            raise serializers.ValidationError("pre_verdict debe ser un objeto JSON")
        status = (obj.get("status") or "").strip().upper()
        if status not in {"MATCH", "PARTIAL", "MISMATCH", "UNREADABLE", "SUSPICIOUS"}:
            raise serializers.ValidationError(
                f"pre_verdict.status inválido: {status!r}. "
                f"Permitidos: MATCH, PARTIAL, MISMATCH, UNREADABLE, SUSPICIOUS"
            )
        try:
            float(obj.get("confianza", 0))
        except (TypeError, ValueError):
            raise serializers.ValidationError("pre_verdict.confianza debe ser numérico")
        return obj

    # ── Cross-field validation ─────────────────────────────
    def validate(self, attrs):
        # Sprint 2026-05-25 (CEO) - la validacion Σ aplicaciones == monto
        # fue REMOVIDA. El CEO necesita registrar pagos donde:
        #   - el monto del comprobante es mayor que la deuda
        #     (overpayment / saldo a favor del cliente)
        #   - el monto es menor (pago parcial)
        #   - hay diferencias por redondeo de FX (CRC->USD)
        # En todos estos casos el pago se persiste y la diferencia
        # queda como saldo libre asociado al payment, util para
        # conciliacion posterior.
        # Solo validamos formato numerico para evitar 500 downstream.
        try:
            Decimal(str(attrs.get("monto", 0)))
            for a in attrs.get("aplicaciones", []) or []:
                Decimal(str(a.get("monto_aplicado", 0)))
        except (InvalidOperation, KeyError, TypeError):
            raise serializers.ValidationError("Montos numéricos inválidos")
        return attrs
