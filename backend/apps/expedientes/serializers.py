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
    # Sprint 2026-05-26 (CEO) · Total facturado REAL de la OC,
    # computado desde los artefactos ART-13 (Factura Comercial,
    # template_id=13) de TODOS los expedientes vinculados a esta OC.
    # field-0118 del JSONB contiene el monto en USD.
    #
    # Visibility (POL_VISIBILIDAD R3):
    #   · bypass (admin/CEO/staff)              -> ve el valor
    #   · user cuyos client_ids incluyen el     -> ve el valor (es del operador)
    #     operating_company_id de algun expediente
    #   · cliente final del expediente          -> ve null (no expone metricas internas)
    total_invoiced_real = serializers.SerializerMethodField()

    class Meta:
        model  = Oc
        fields = "__all__"

    def get_total_invoiced_real(self, obj):
        from django.db import connection as _conn
        try:
            from apps.core.scoped_querysets import _is_bypass, _scope_ids
        except ImportError:
            return None
        # Sprint 2026-05-26 (CEO) - mismo defensive fallback que
        # ExpedienteSerializer.get_total_invoiced: sin request -> trust.
        request = self.context.get("request") if hasattr(self, "context") else None
        user = getattr(request, "user", None) if request else None
        allowed = True
        if user is not None:
            allowed = False
            try:
                if _is_bypass(user):
                    allowed = True
                else:
                    scope = _scope_ids(user) or []
                    if scope:
                        with _conn.cursor() as c:
                            c.execute("""
                                SELECT 1
                                FROM expedientes.expediente e
                                WHERE e.oc_id = %s::uuid
                                  AND e.is_active = TRUE
                                  AND e.operating_company_id::text = ANY(%s::text[])
                                LIMIT 1
                            """, [str(obj.id), [str(s) for s in scope]])
                            if c.fetchone():
                                allowed = True
            except Exception:  # noqa: BLE001
                return None
        if not allowed:
            return None
        try:
            with _conn.cursor() as c:
                c.execute("""
                    SELECT COALESCE(SUM(
                        COALESCE(NULLIF(bai.data->>'field-0118','')::numeric, 0)
                    ), 0)
                    FROM nodos.builder_artifact_instance bai
                    WHERE bai.template_id = 13
                      AND bai.is_active   = TRUE
                      AND EXISTS (
                          SELECT 1
                          FROM nodos.builder_artifact_line bal
                          JOIN expedientes.expediente e
                            ON e.id = bal.expediente_id
                          WHERE bal.builder_artifact_instance_id = bai.id
                            AND bal.is_active = TRUE
                            AND e.oc_id       = %s::uuid
                            AND e.is_active   = TRUE
                      )
                """, [str(obj.id)])
                r = c.fetchone()
                return float(r[0] or 0) if r else 0
        except Exception:  # noqa: BLE001
            return None


# ─────────────────────────────────────────────────────────────────────
# Sprint 2026-06-11 · Auditoría Fable5 (sprint 03 · N+1 del listado).
# GET /api/expedientes/ ejecutaba 4-5 queries POR FILA dentro de los
# SerializerMethodField (proforma, proformas[], ocs[] ×2, saps[]) →
# ~5N queries por listado. Este builder precomputa los tres mapas con
# 3-4 queries TOTALES; el ViewSet.list los inyecta en el context y los
# getters los usan con fallback al query por-fila (compatibilidad con
# usos del serializer fuera del list).
# ─────────────────────────────────────────────────────────────────────
def _viewer_is_client(user):
    """True si el usuario autenticado tiene rol cliente (CLIENT_* / CLIENT_B2B)."""
    if user is None or not getattr(user, "is_authenticated", False):
        return False
    role = (getattr(user, "role_default", "") or
            getattr(user, "role", "") or "")
    r = str(role).upper()
    return r.startswith("CLIENT_") or r in ("CLIENT", "CLIENTE", "CLIENT_B2B")


def build_expediente_ref_batches(expedientes, *, is_client=False):
    exp_ids = [e.id for e in expedientes]
    out = {"batch_proformas": {}, "batch_ocs": {}, "batch_saps": {}}
    if not exp_ids:
        return out
    proformas = out["batch_proformas"]
    ocs_docs  = out["batch_ocs"]
    saps      = out["batch_saps"]

    pf_rows = (Documento.objects
               .filter(expediente_id__in=exp_ids, kind="PROFORMA", is_active=True)
               .exclude(codigo__isnull=True).exclude(codigo__exact="")
               .order_by("-created_at")
               .values_list("expediente_id", "codigo"))
    for eid, cod in pf_rows:
        lst = proformas.setdefault(str(eid), [])
        if cod not in lst:
            lst.append(cod)

    # Listado / kanban: mostrar UNA sola OC por expediente — la primera
    # que se subió (más antigua). Las OCs adicionales se ven en el
    # detalle del expediente. Fix 2026-07-28.
    oc_qs = (Documento.objects
             .filter(expediente_id__in=exp_ids, is_active=True)
             .filter(kind__iregex=r"^OC(\s|_|$)")
             .exclude(codigo__isnull=True).exclude(codigo__exact=""))
    # R3 · clientes solo ven documentos OC con audience=CLIENT.
    if is_client:
        oc_qs = oc_qs.filter(audience="CLIENT")
    oc_rows = oc_qs.order_by("expediente_id", "created_at").values_list("expediente_id", "codigo")
    seen_eid = set()
    for eid, cod in oc_rows:
        eid_str = str(eid)
        if eid_str in seen_eid:
            continue
        ocs_docs[eid_str] = [cod]
        seen_eid.add(eid_str)

    # Fallback del código interno (commercial.oc) SOLO para expedientes
    # sin documento OC subido — misma política que el getter por-fila.
    missing = {str(e.id): e.oc_id for e in expedientes
               if str(e.id) not in ocs_docs and e.oc_id}
    if missing:
        oc_map = {
            str(i): c for i, c in
            Oc.objects.filter(id__in=set(missing.values()), is_active=True)
            .exclude(codigo__isnull=True).exclude(codigo__exact="")
            .values_list("id", "codigo")
        }
        for eid, ocid in missing.items():
            cod = oc_map.get(str(ocid))
            if cod:
                ocs_docs[eid] = [cod]

    sap_rows = (Linea.objects
                .filter(expediente_id__in=exp_ids, is_active=True)
                .exclude(sap__isnull=True).exclude(sap__exact="")
                .values_list("expediente_id", "sap")
                .distinct())
    for eid, sap in sap_rows:
        lst = saps.setdefault(str(eid), [])
        if sap not in lst:
            lst.append(sap)
    return out


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
    # Sprint 2026-05-31 · flag autoritativo de OPERADOR (server-side).
    viewer_is_operator = serializers.SerializerMethodField()

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
        # R3 (POL_VISIBILIDAD): el codigo de proforma es CEO/ADMIN-only.
        # Fix Fable5-QA 2026-06-11: este campo legacy no tenia el gate
        # _is_client() que si tienen proforma_codigos[]/sap_codigos[] —
        # el codigo llegaba al rol cliente en el listado (leak R3).
        if self._is_client():
            return None
        # Fable5 · atajo batch (un query para todo el listado).
        pre = (self.context or {}).get("batch_proformas")
        if pre is not None:
            lst = pre.get(str(obj.id), [])
            return lst[0] if lst else None
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
        # Fable5 · atajo batch.
        pre = (self.context or {}).get("batch_proformas")
        if pre is not None:
            return pre.get(str(obj.id), [])
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
        """OCs del expediente. Audience-aware: clientes solo ven docs CLIENT.

        Política (Sprint 2026-05-25): el código del documento PDF que
        el cliente subió (kind ∈ {OC, OC Cliente}) es la fuente de
        verdad y va PRIMERO en la lista — el frontend muestra el [0].
        El código auto-generado por el wizard (tabla commercial.oc,
        ej. 'PO-2026-00004') queda como fallback al final para
        reconciliación interna, no como label primario.

        Fix 2026-07-28: en rol CLIENT_* se filtran documentos con
        audience='CLIENT'; MWT_INTERNAL/ADMIN_ONLY no se exponen en B2B.
        """
        # Fable5 · atajo batch (incluye el fallback de OC principal,
        # resuelto en lote por build_expediente_ref_batches).
        pre = (self.context or {}).get("batch_ocs")
        if pre is not None:
            return pre.get(str(obj.id), [])
        try:
            # Listado / kanban: una sola OC por expediente — la primera que
            # se subió (más antigua). Las demás se ven en el detalle.
            doc_qs = (
                Documento.objects
                .filter(expediente_id=obj.id, is_active=True)
                .filter(kind__iregex=r"^OC(\s|_|$)")
                .exclude(codigo__isnull=True)
                .exclude(codigo__exact="")
            )
            if self._is_client():
                doc_qs = doc_qs.filter(audience="CLIENT")
            doc_code = doc_qs.order_by("created_at").values_list("codigo", flat=True).first()

            # OC principal (FK directa al expediente) — codigo auto-
            # generado por el wizard. Solo como fallback.
            principal_codes = list(
                Oc.objects.filter(id=obj.oc_id, is_active=True)
                .exclude(codigo__isnull=True)
                .exclude(codigo__exact="")
                .values_list("codigo", flat=True)
            ) if obj.oc_id else []

            codes_to_use = [doc_code] if doc_code else principal_codes
            return [c for c in codes_to_use if c]
        except Exception:  # noqa: BLE001
            return []

    # ── saps[] ─────────────────────────────────────────────────
    def get_sap_codigos(self, obj):
        """Todos los SAPs distintos de las líneas. CEO-ONLY (R3)."""
        if self._is_client():
            return []
        # Fable5 · atajo batch (con el mismo fallback al sap legacy).
        pre = (self.context or {}).get("batch_saps")
        if pre is not None:
            lst = pre.get(str(obj.id), [])
            return lst if lst else ([obj.sap] if obj.sap else [])
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

    # ── viewer_is_operator ─────────────────────────────────────
    def get_viewer_is_operator(self, obj):
        """True si el viewer puede ver el costo/precio MWT de este expediente.

        Autoritativo (server-side): admin/CEO/superuser, o usuario cuyo
        `legal_entity_ids` (leido FRESCO de users.mwtuser en cada request
        por MwtJWTAuthentication) contiene el operating_company_id del
        expediente — i.e. es el OPERADOR. El frontend usa este flag en
        lugar del legal_entity_ids cacheado en localStorage, que puede
        quedar desactualizado si el usuario fue asignado a la empresa
        operadora DESPUES de su ultimo login.
        """
        request = self.context.get("request") if hasattr(self, "context") else None
        user = getattr(request, "user", None) if request else None
        if user is None or not getattr(user, "is_authenticated", False):
            return False
        if getattr(user, "is_superuser", False):
            return True
        if self._viewer_role() in ("ADMIN", "CEO"):
            return True
        op = str(getattr(obj, "operating_company_id", "") or "").strip().lower()
        if not op:
            return False
        leis = {
            str(x).strip().lower()
            for x in (getattr(user, "legal_entity_ids", None) or [])
        }
        return op in leis

    class Meta:
        model  = Expediente
        fields = (
            "id", "codigo", "oc_id", "client_id", "operating_company_id",
            "brand_id", "sap",
            "estado", "modo_operacion", "incoterm", "freight_mode", "dispatch_mode",
            "origin", "destination", "origin_country", "destination_country",
            "shipment_date", "eta", "product_count",
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
            # Sprint 2026-06-10 · created_at = inicio de REGISTRO en el
            # Cronograma del export (expedientes sin eventos todavía).
            "is_active", "created_at", "updated_at",
            # Legacy compat (Sprint 2026-05-10)
            "proforma_codigo",
            # Sprint 2026-05-17 · arrays role-aware
            "proforma_codigos", "oc_codigos", "sap_codigos",
            # Sprint 2026-05-31 · flag de operador (visibilidad de costo MWT)
            "viewer_is_operator",
            # Sprint 2026-06-11 · fusión visual de expedientes (E3). No es
            # dato sensible: solo agrupa filas en el listado.
            "fusion_id", "fusion_label",
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

    Sprint 2026-05-26 (CEO):
      Las columnas total_cost, total_invoiced, total_paid, balance del
      modelo Expediente nunca se actualizan automaticamente y siempre
      estan en 0. Esto hace que las cards "Resumen de costos" y
      "Avance de cobro" muestren $0 incluso cuando el expediente tiene
      facturas y costos reales registrados via Builder/transferencias.

      Fix: override de los 4 campos con SerializerMethodField que
      computan en tiempo real:
        · total_invoiced -> SUM(field-0118) de ART-13 Factura Comercial
        · total_cost     -> SUM(amount_usd) de transfers.cost_line
                            cuyo scope incluya este expediente
        · total_paid     -> SUM(monto_usd) de finance.payment confirmados
        · balance        -> total_invoiced - total_paid (no menor a 0)
    """
    # Sprint 2026-05-26 (CEO) - override totales con valores computados.
    # Declarados antes que `id` para que DRF los reconozca como
    # SerializerMethodField y no como columnas del modelo.
    total_invoiced  = serializers.SerializerMethodField()
    total_cost      = serializers.SerializerMethodField()
    total_paid      = serializers.SerializerMethodField()
    balance         = serializers.SerializerMethodField()

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

    # ── Sprint 2026-05-26 (CEO) · totales computados ──────────
    def _safe_uuid(self, val):
        try:
            import uuid as _u
            return str(_u.UUID(str(val)))
        except (ValueError, TypeError, AttributeError):
            return None

    def get_total_invoiced(self, obj):
        """SUM(field-0118) de ART-13 Factura Comercial vinculados.

        Sprint 2026-05-26 (CEO) - visibility POL_R3:
          · bypass (admin/CEO/staff)          -> ve el valor
          · user cuyo scope incluye           -> ve el valor (es del operador)
            obj.operating_company_id
          · cliente final del expediente      -> recibe 0 (no expone)
        """
        from django.db import connection as _conn
        try:
            from apps.core.scoped_querysets import _is_bypass, _scope_ids
        except ImportError:
            _is_bypass = None
            _scope_ids = None
        # Visibility check
        # Sprint 2026-05-26 (CEO) - cuando el serializer se invoca sin
        # context (ej. Serializer(o).data desde un view custom), no hay
        # request. En ese caso, TRUST y devolver el valor real (la auth
        # ya se hizo en la capa HTTP). Si hay request, aplicamos la
        # regla de operating_company.
        request = self.context.get("request") if hasattr(self, "context") else None
        user = getattr(request, "user", None) if request else None
        allowed = True
        if user is not None:
            allowed = False
            if _is_bypass and _is_bypass(user):
                allowed = True
            elif _scope_ids:
                op_id = getattr(obj, "operating_company_id", None)
                if op_id:
                    scope = _scope_ids(user) or []
                    if str(op_id) in [str(s) for s in scope]:
                        allowed = True
        if not allowed:
            return 0
        eid = self._safe_uuid(getattr(obj, "id", None))
        if not eid:
            return 0
        try:
            with _conn.cursor() as c:
                c.execute("""
                    SELECT COALESCE(SUM(
                        COALESCE(NULLIF(bai.data->>'field-0118','')::numeric, 0)
                    ), 0)
                    FROM nodos.builder_artifact_instance bai
                    WHERE bai.template_id = 13
                      AND bai.is_active   = TRUE
                      AND EXISTS (
                          SELECT 1
                          FROM nodos.builder_artifact_line bal
                          WHERE bal.builder_artifact_instance_id = bai.id
                            AND bal.expediente_id = %s::uuid
                            AND bal.is_active = TRUE
                      )
                """, [eid])
                r = c.fetchone()
                return float(r[0] or 0) if r else 0
        except Exception:  # noqa: BLE001
            return float(getattr(obj, "total_invoiced", 0) or 0)

    def get_total_cost(self, obj):
        """SUM amount_usd de transfers.cost_line en scope de este exp,
        recalculando FX cuando currency!=USD y fx==1.0."""
        from django.db import connection as _conn
        eid = self._safe_uuid(getattr(obj, "id", None))
        if not eid:
            return 0
        try:
            from apps.core.fx_service import get_fx_to_usd
        except ImportError:
            get_fx_to_usd = None
        try:
            with _conn.cursor() as c:
                c.execute("""
                    SELECT cl.amount, cl.currency, cl.fx_to_usd, cl.amount_usd
                    FROM transfers.cost_line cl
                    WHERE cl.is_active = TRUE
                      AND EXISTS (
                          SELECT 1
                          FROM inventario.expediente_nodo_assignment a
                          WHERE a.transferencia_id = cl.transferencia_id
                            AND a.expediente_id   = %s::uuid
                            AND a.is_active = TRUE
                      )
                      AND (
                        cl.scope_json IS NULL
                        OR (cl.scope_json->>'applies_to_all')::bool = TRUE
                        OR cl.scope_json->'expediente_ids' ? %s
                      )
                """, [eid, eid])
                rows = c.fetchall()
            total = 0.0
            fx_cache = {}
            for (amount, currency, fx_stored, amount_usd) in rows:
                ccy = (currency or "USD").upper()
                amt = float(amount or 0)
                fx_s = float(fx_stored or 1)
                aus = float(amount_usd or 0)
                if ccy != "USD" and abs(fx_s - 1.0) < 1e-9 and amt > 0 and get_fx_to_usd:
                    if ccy not in fx_cache:
                        try: fx_cache[ccy] = float(get_fx_to_usd(ccy) or 1)
                        except Exception: fx_cache[ccy] = 1.0
                    total += amt * fx_cache[ccy]
                else:
                    total += aus
            return round(total, 2)
        except Exception:  # noqa: BLE001
            return float(getattr(obj, "total_cost", 0) or 0)

    def get_total_paid(self, obj):
        """SUM monto_usd de finance.payment confirmados para este exp."""
        from django.db import connection as _conn
        eid = self._safe_uuid(getattr(obj, "id", None))
        if not eid:
            return 0
        try:
            with _conn.cursor() as c:
                c.execute("""
                    SELECT COALESCE(SUM(p.monto_usd), 0)
                    FROM finance.payment p
                    WHERE p.expediente_id = %s::uuid
                      AND p.is_active     = TRUE
                      AND p.estado IN ('CONFIRMADO_AI', 'CONFIRMADO_HUMANO')
                """, [eid])
                r = c.fetchone()
                return float(r[0] or 0) if r else 0
        except Exception:  # noqa: BLE001
            return float(getattr(obj, "total_paid", 0) or 0)

    def get_balance(self, obj):
        """total_invoiced - total_paid (clamp >= 0)."""
        try:
            inv  = float(self.get_total_invoiced(obj) or 0)
            paid = float(self.get_total_paid(obj) or 0)
            return round(max(inv - paid, 0), 2)
        except Exception:  # noqa: BLE001
            return float(getattr(obj, "balance", 0) or 0)

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
