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
    """
    Serializer del listado de expedientes — `GET /api/expedientes/`.

    Sprint 2026-05-17 (CEO request):
      Soporta múltiples proformas/OCs/SAPs por expediente para la columna REF
      de la pantalla `/expedientes`. POL_VISIBILIDAD (R3):
        · ADMIN/CEO/staff → ve proformas[] + ocs[] + saps[]
        · CLIENT_*        → ve solo ocs[] (sus propias OCs); proformas y saps
                            devuelven listas vacías (no se filtra el endpoint
                            entero por compat — el front aplica role gating).

    Legacy: `proforma_codigo` (1 string) se conserva para compatibilidad con
    consumidores antiguos. `sap` (legacy varchar) idem.
    """
    # Legacy — string único, compat hacia atrás (Sprint 2026-05-10).
    proforma_codigo = serializers.SerializerMethodField()

    # Nuevos arrays role-aware (Sprint 2026-05-17).
    proforma_codigos = serializers.SerializerMethodField()
    oc_codigos       = serializers.SerializerMethodField()
    sap_codigos      = serializers.SerializerMethodField()

    # ── role helpers ───────────────────────────────────────────
    def _viewer_role(self):
        request = self.context.get("request") if hasattr(self, "context") else None
        user    = getattr(request, "user", None) if request else None
        if not user or not getattr(user, "is_authenticated", False):
            return ""
        role = (getattr(user, "role_default", "") or
                getattr(user, "role", "") or "")
        try:
            return str(role).upper()
        except (TypeError, ValueError):
            return ""

    def _is_client(self):
        r = self._viewer_role()
        return r.startswith("CLIENT_") or r in ("CLIENT", "CLIENTE", "CLIENT_B2B")

    # ── legacy proforma_codigo (string único, el más reciente) ─
    def get_proforma_codigo(self, obj):
        try:
            doc = (
                Documento.objects
                .filter(expediente_id=obj.id, kind="PROFORMA", is_active=True)
                .exclude(codigo__isnull=True)
                .exclude(codigo__exact="")
                # Preferimos PDFs (subidos por el admin con un codigo
                # tipeado). El HTML auto-generado (file_ext='html', marker
                # dynamic://) tambien tiene codigo pero suele venir del
                # mismo string, asi que cualquiera sirve — el orden por
                # created_at desc deja arriba el más reciente.
                .order_by("-created_at")
                .values_list("codigo", flat=True)
                .first()
            )
            return doc or None
        except Exception:  # noqa: BLE001 — defensivo en serializer de listado
            return None

    # ── proformas[] ────────────────────────────────────────────
    def get_proforma_codigos(self, obj):
        """Todas las proformas (kind=PROFORMA). CLIENT_* → []."""
        if self._is_client():
            return []
        try:
            codes = list(
                Documento.objects
                .filter(expediente_id=obj.id, kind="PROFORMA", is_active=True)
                .exclude(codigo__isnull=True)
                .exclude(codigo__exact="")
                .order_by("-created_at")
                .values_list("codigo", flat=True)
            )
            seen, out = set(), []
            for c in codes:
                if c and c not in seen:
                    out.append(c); seen.add(c)
            return out
        except Exception:  # noqa: BLE001
            return []

    # ── ocs[] ──────────────────────────────────────────────────
    def get_oc_codigos(self, obj):
        """OCs del cliente. Visible a todos los roles.

        Política (Sprint 2026-05-25): el código del documento PDF que
        el cliente subió (kind ∈ {OC, OC Cliente}) es la fuente de
        verdad y va PRIMERO en la lista — el frontend muestra el [0].
        El código auto-generado por el wizard (tabla commercial.oc,
        ej. 'PO-2026-00004') queda como fallback al final para
        reconciliación interna, no como label primario.
        """
        try:
            # OCs subidas como documentos — preferimos audience=CLIENT,
            # caemos a ADMIN_ONLY si no hay versión cliente. Aceptamos
            # cualquier variante de kind que empiece por 'OC' para
            # tolerar 'OC', 'OC Cliente', 'OC_CLIENTE', etc.
            doc_qs = (
                Documento.objects
                .filter(expediente_id=obj.id, is_active=True)
                .filter(kind__iregex=r"^OC(\s|_|$)")
                .exclude(codigo__isnull=True)
                .exclude(codigo__exact="")
                .order_by(
                    # CLIENT primero, luego ADMIN_ONLY, luego otros
                    "audience", "-created_at",
                )
                .values_list("codigo", flat=True)
            )
            doc_codes = list(doc_qs)

            # OC principal (FK directa al expediente) — codigo auto-
            # generado por el wizard. Solo como fallback.
            principal_codes = list(
                Oc.objects.filter(id=obj.oc_id, is_active=True)
                .exclude(codigo__isnull=True)
                .exclude(codigo__exact="")
                .values_list("codigo", flat=True)
            ) if obj.oc_id else []

            # Sprint 2026-05-26 (CEO) - cuando el cliente SI subio un
            # documento OC, el codigo auto-generado por el wizard
            # ('PO-2026-XXXXX') es ruido visual. Mostramos UNICAMENTE
            # los codigos del cliente. Solo cuando no hay doc subido
            # caemos al codigo principal interno como fallback.
            codes_to_use = doc_codes if doc_codes else principal_codes
            seen, out = set(), []
            for c in codes_to_use:
                if c and c not in seen:
                    out.append(c); seen.add(c)
            return out
        except Exception:  # noqa: BLE001
            return []

    # ── saps[] ─────────────────────────────────────────────────
    def get_sap_codigos(self, obj):
        """Todos los SAPs distintos de las líneas. CEO-ONLY (R3)."""
        if self._is_client():
            return []
        try:
            saps = list(
                Linea.objects
                .filter(expediente_id=obj.id, is_active=True)
                .exclude(sap__isnull=True)
                .exclude(sap__exact="")
                .values_list("sap", flat=True)
                .distinct()
            )
            # Fallback: si no hay sap por línea pero el expediente tiene
            # el campo legacy `sap`, lo usamos como único elemento.
            if not saps and obj.sap:
                return [obj.sap]
            return saps
        except Exception:  # noqa: BLE001
            return []

    class Meta:
        model  = Expediente
        fields = (
            "id", "codigo", "oc_id", "client_id", "operating_company_id",
            "brand_id", "sap",
            "estado", "modo_operacion", "incoterm", "freight_mode", "dispatch_mode",
            "origin", "destination", "origin_country", "destination_country",
            "shipment_date", "eta",
            "moneda", "total_cost", "total_invoiced", "total_paid", "balance",
            "projected_margin", "real_margin", "margin_drift",
            # Sprint 2026-05-10 · `forma_pago` necesario para que el
            # frontend filtre expedientes CONTADO al proyectar uso
            # de credito (CreateExpedienteWizardLite). `payment_days` no
            # existe en el modelo (se usa credit_days).
            "forma_pago",
            "credit_days", "credit_days_mwt", "credit_days_cliente", "credit_band",
            "is_blocked", "block_reason", "block_cause", "factory_delay",
            "phase_ratio", "phase_signal",
            "is_active", "updated_at",
            # Legacy compat (Sprint 2026-05-10)
            "proforma_codigo",
            # Sprint 2026-05-17 · arrays role-aware
            "proforma_codigos", "oc_codigos", "sap_codigos",
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
    # Sprint 2026-05-06 · operador del expediente (default MWT).
    operating_company_id = serializers.UUIDField(required=False, allow_null=True)
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
    """Serializer de líneas con resolución dual de precio por viewer.

    Sprint 2026-05-06:
      · `unit_price`        → legacy, precio del OPERADOR (compat).
      · `unit_price_mwt`    → snapshot precio MWT.
      · `unit_price_client` → snapshot precio cliente final.
      · `unit_price_for_viewer` (read-only) → precio resuelto según
        el rol del request.user:
            CLIENT_*       → unit_price_client
            Admin/CEO/staff→ unit_price_mwt
            sin contexto   → unit_price (compat)
    """
    unit_price_for_viewer = serializers.SerializerMethodField()

    class Meta:
        model  = Linea
        fields = "__all__"

    def get_unit_price_for_viewer(self, obj):
        request = self.context.get("request") if hasattr(self, "context") else None
        user    = getattr(request, "user", None) if request is not None else None
        if user is None or not getattr(user, "is_authenticated", False):
            return obj.unit_price
        role = (getattr(user, "role_default", "") or
                getattr(user, "role", "") or "")
        try:
            role_upper = str(role).upper()
        except (TypeError, ValueError):
            role_upper = ""
        if role_upper.startswith("CLIENT_") or role_upper in ("CLIENT", "CLIENTE", "CLIENT_B2B"):
            return obj.unit_price_client or obj.unit_price
        return obj.unit_price_mwt or obj.unit_price


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
