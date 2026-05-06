from rest_framework import serializers
from .models import (
    Oc, Expediente, Linea, Documento,
    TransicionCat, EventLog, OcrParsingLog,
    BuilderArtifactInstance,
)


class OcListSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Oc
        fields = (
            "id", "codigo", "client_id", "brand_id", "proforma", "sap",
            "estado", "moneda", "issued_at",
            "total_value", "total_invoiced", "total_paid", "balance",
            "coverage_pct", "lines_count", "lines_with_sap",
            "air_pct", "sea_pct", "credit_days_max", "credit_band",
            "is_active", "updated_at",
        )


class OcSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Oc
        fields = "__all__"


class ExpedienteListSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Expediente
        fields = (
            "id", "codigo", "oc_id", "client_id", "brand_id", "sap",
            "estado", "modo_operacion", "incoterm", "freight_mode", "dispatch_mode",
            "origin", "destination", "origin_country", "destination_country",
            "shipment_date", "eta",
            "moneda", "total_cost", "total_invoiced", "total_paid", "balance",
            "projected_margin", "real_margin", "margin_drift",
            "credit_days", "credit_band",
            "is_blocked", "block_reason", "block_cause", "factory_delay",
            "phase_ratio", "phase_signal",
            "is_active", "updated_at",
        )


class ExpedienteSerializer(serializers.ModelSerializer):
    """Serializer principal del Expediente.

    Sprint Wizard Simplificado (2026-04-29):
      Los campos comerciales/logisticos pasan a OPCIONALES en el create.
      El expediente nace en estado REGISTRO sin esos datos; el OPERATOR
      los completa en el detalle antes de la transicion T2 (REGISTRO ->
      PRODUCCION). El frontend NO debe pedirlos en el wizard.

      Adicionalmente, `id` y `codigo` se vuelven opcionales en input:
      el ViewSet inyecta UUID y autogenera codigo (EXP-YYYY-NNNN) si
      no vienen en el payload. Asi el wizard puede hacer un POST minimo
      con solo client_id + estado.
    """
    # id es PK pero el view lo inyecta vía s.save(id=uuid.uuid4()).
    # Marcarlo read_only impide que DRF lo exija en el body.
    id              = serializers.UUIDField(read_only=True)
    codigo          = serializers.CharField(max_length=32, required=False,
                                            allow_blank=True, allow_null=True)
    brand_id        = serializers.UUIDField(required=False, allow_null=True)
    modo_operacion  = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    moneda          = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    incoterm        = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    freight_mode    = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    dispatch_mode   = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    # Sprint 2026-05-06 · términos de pago del expediente.
    # CREDITO: el monto cuenta contra credito_usado del cliente.
    # CONTADO: pago al momento, no afecta crédito.
    forma_pago      = serializers.ChoiceField(
        choices=[('CREDITO', 'Crédito'), ('CONTADO', 'Contado')],
        required=False, allow_null=True, default=None,
    )

    # Permitimos que el wizard incluya `lines` en el payload — el ViewSet
    # las pop()-ea antes de validar y las crea como Linea aparte. Aqui
    # solo aceptamos el campo para que DRF no falle con "extra fields".
    lines           = serializers.ListField(child=serializers.DictField(),
                                            required=False, write_only=True)

    class Meta:
        model  = Expediente
        fields = "__all__"


class LineaSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Linea
        fields = "__all__"


class DocumentoSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Documento
        fields = "__all__"


class TransicionCatSerializer(serializers.ModelSerializer):
    class Meta:
        model  = TransicionCat
        fields = "__all__"


class EventLogSerializer(serializers.ModelSerializer):
    class Meta:
        model  = EventLog
        fields = "__all__"


class OcrParsingLogSerializer(serializers.ModelSerializer):
    class Meta:
        model  = OcrParsingLog
        fields = "__all__"


# ════════════════════════════════════════════════════════════
# Builder Artifacts (instancias de artefactos llenadas por el
# usuario, anclados al expediente y a una etapa del flujo).
# ════════════════════════════════════════════════════════════
class BuilderArtifactInstanceSerializer(serializers.ModelSerializer):
    """Serializer principal del builder_artifact_instance.

    `id` es PK auto-generada; el ViewSet la inyecta vía save(id=uuid4).
    """
    id              = serializers.UUIDField(read_only=True)
    expediente_id   = serializers.UUIDField(read_only=True)
    template_id     = serializers.IntegerField(required=True)
    template_title  = serializers.CharField(max_length=2048, required=True,
                                            allow_blank=False)
    stage           = serializers.ChoiceField(
        choices=[c[0] for c in BuilderArtifactInstance.STAGE_CHOICES],
        required=True,
    )
    data               = serializers.JSONField(required=False)
    structure_snapshot = serializers.JSONField(required=True)

    created_by_id      = serializers.UUIDField(read_only=True)
    created_by_name    = serializers.CharField(read_only=True)
    updated_by_id      = serializers.UUIDField(read_only=True)
    updated_by_name    = serializers.CharField(read_only=True)
    created_at         = serializers.DateTimeField(read_only=True)
    updated_at         = serializers.DateTimeField(read_only=True)

    class Meta:
        model  = BuilderArtifactInstance
        fields = (
            "id", "expediente_id", "stage",
            "template_id", "template_title",
            "data", "structure_snapshot",
            "created_by_id", "created_by_name",
            "updated_by_id", "updated_by_name",
            "is_active", "created_at", "updated_at",
        )


class BuilderArtifactInstanceUpdateSerializer(serializers.ModelSerializer):
    """Serializer reducido para PATCH: sólo permite mutar `data` y `stage`.

    `template_id`, `template_title` y `structure_snapshot` son inmutables
    una vez creados (snapshot principle).
    """
    data  = serializers.JSONField(required=False)
    stage = serializers.ChoiceField(
        choices=[c[0] for c in BuilderArtifactInstance.STAGE_CHOICES],
        required=False,
    )

    class Meta:
        model  = BuilderArtifactInstance
        fields = ("data", "stage")
