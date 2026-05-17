"""
=====================================================================
MWT.ONE · apps.finance.views
Agente responsable: [AG-BACKEND]

Expone:
  POST   /api/finance/payments/                  (multipart, drawer v2.0)
  GET    /api/finance/payments/                  (lista filtrable)
  GET    /api/finance/payments/<id>/             (detalle + aplicaciones + evidencia)
  GET    /api/finance/payments/select_metodos/   (catálogo TRANSFERENCIA / NOTA)
  GET    /api/finance/payments/select_tipos/     (catálogo PARCIAL / COMPLETO)
  GET    /api/finance/payments/select_estados/   (catálogo PENDIENTE_AI ... etc)

Reglas de Fase 2:
  - Estado fijo PENDIENTE_AI · sin pipeline IA todavía (Fase 3).
  - R3 (POL_VISIBILIDAD): bloqueamos el módulo para roles client_*.
  - R8: comprobante obligatorio (validado por el serializer).
=====================================================================
"""
from __future__ import annotations

import logging
import uuid

from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.parsers import JSONParser, MultiPartParser, FormParser
from rest_framework.response import Response

from .models import (
    Payment, PaymentApplication, PaymentEvidence,
    MetodoCat, TipoPagoCat, EstadoPagoCat, ApplicableTypeCat,
)
from .serializers import (
    PaymentDetailSerializer, PaymentRegisterSerializer,
)
from .services import (
    PaymentService,
    CreditEffectService, CounterpartyValidator, CounterpartyMismatchError,
    ExpedienteTermsUndefinedError, ActivityLogger,
)
# Sprint Registrar Pago (Fase 1)
from .enums import (
    PaymentRejectionReason, PaymentCounterpartyType, PaymentDirection,
    PaymentStatus, PaymentErrorCode,
    PAYMENT_STATES_RELEASABLE, PAYMENT_STATES_REJECTABLE,
)

log = logging.getLogger(__name__)


# ════════════════════════════════════════════════════════════
# PaymentViewSet
# ════════════════════════════════════════════════════════════
class PaymentViewSet(viewsets.ViewSet):
    """
    ViewSet manual (no ModelViewSet) para tener control fino sobre
    el flujo multipart. Sigue el patrón de apps.cobros.views.
    """
    parser_classes = (MultiPartParser, FormParser, JSONParser)
    required_module = "finance"

    # ── List ──────────────────────────────────────────────
    def list(self, request):
        qs = Payment.objects.filter(is_active=True)
        for param, field in (
            ("expediente_id", "expediente_id"),
            ("client_id",     "client_id"),
            ("estado",        "estado"),
            ("metodo",        "metodo"),
            ("tipo_pago",     "tipo_pago"),
            ("moneda",        "moneda"),
        ):
            v = request.query_params.get(param)
            if v:
                qs = qs.filter(**{field: v})

        q = request.query_params.get("q")
        if q:
            qs = qs.filter(referencia__icontains=q)

        qs = qs.order_by("-created_at")[:200]
        return Response(PaymentDetailSerializer(qs, many=True).data)

    # ── Retrieve ──────────────────────────────────────────
    def retrieve(self, request, pk=None):
        try:
            p = Payment.objects.get(pk=pk, is_active=True)
        except Payment.DoesNotExist:
            return Response({"detail": "Payment no existe"}, status=404)
        return Response(PaymentDetailSerializer(p).data)

    # ── Create (multipart, drawer v2.0) ───────────────────
    def create(self, request):
        s = PaymentRegisterSerializer(data=request.data)
        s.is_valid(raise_exception=True)

        # Resolver actor: el JWT trae el user_id en `request.user.id`
        # cuando JWTAuthentication se conecta a un user real; si está
        # en modo claim-only, lo leemos del payload.
        actor_id   = _safe_user_uuid(request)
        actor_role = (request.auth.get("role") if request.auth else None)

        try:
            result = PaymentService.register(
                validated  = s.validated_data,
                actor_id   = actor_id,
                actor_role = actor_role,
            )
        except RuntimeError as exc:
            log.error("PaymentService.register falló: %s", exc)
            return Response({"detail": str(exc)}, status=502)

        body = PaymentDetailSerializer(result.payment).data
        body["next_action"] = (
            "Pago registrado en estado PENDIENTE_AI. La validación IA "
            "del comprobante se conecta en Fase 3 (ai_analyzer_task)."
        )
        return Response(body, status=201)

    # ── Selects (catálogos) ───────────────────────────────
    @action(detail=False, methods=["get"], url_path="select_metodos")
    def select_metodos(self, request):
        return Response([
            {"codigo": m.codigo, "label": m.label,
             "requires_evidence": m.requires_evidence}
            for m in MetodoCat.objects.filter(is_active=True)
        ])

    @action(detail=False, methods=["get"], url_path="select_tipos")
    def select_tipos(self, request):
        return Response([
            {"codigo": t.codigo, "label": t.label}
            for t in TipoPagoCat.objects.filter(is_active=True)
        ])

    @action(detail=False, methods=["get"], url_path="select_estados")
    def select_estados(self, request):
        return Response([
            {"codigo": e.codigo, "label": e.label, "color": e.color}
            for e in EstadoPagoCat.objects.filter(is_active=True)
        ])

    @action(detail=False, methods=["get"], url_path="select_applicables")
    def select_applicable_types(self, request):
        return Response([
            {"codigo": a.codigo, "label": a.label}
            for a in ApplicableTypeCat.objects.filter(is_active=True)
        ])

    # ── Lista de items "Aplicar a" reales del expediente ──
    # GET /api/finance/payments/applicables/?expediente=<uuid>&type=PROFORMA|FACTURA|COSTO
    #
    # Reemplaza los mocks del drawer (`mockPaymentApplicables` en
    # ExpedienteDetail.jsx) con datos reales del expediente:
    #
    #   · PROFORMA / FACTURA → expedientes.documento (kind ignore-case),
    #     LEFT JOIN cobros.cobro por (oc_id, expediente_id) para sacar
    #     monto_pendiente. Si no hay cobro, fallback a oc.amount_total.
    #
    #   · COSTO → financiero.cost_line (raw SQL · sin modelo Django).
    #     Si la tabla no existe en este DB, devuelve [] sin crashear.
    #
    # Schema uniforme para el frontend:
    #   [{ id: uuid, code: str, label: str, balance: number,
    #      meta: { kind, fecha, cost_type, currency, ... } }]
    @action(detail=False, methods=["get"], url_path="applicables")
    def applicables(self, request):
        from django.db import connection

        exp_id = request.query_params.get("expediente")
        kind   = (request.query_params.get("type") or "").upper().strip()

        if not exp_id:
            return Response({"detail": "expediente requerido"}, status=400)
        if kind not in ("PROFORMA", "FACTURA", "COSTO"):
            return Response(
                {"detail": f"type inválido: {kind!r} (PROFORMA/FACTURA/COSTO)"},
                status=400,
            )

        items = []

        # Resolver OC y montos del expediente (best-effort, defensivo).
        # Los documentos suelen estar asociados a la OC, NO directamente
        # al expediente, así que necesitamos el oc_id para hacer match.
        # Hacemos 2 queries separadas para que si una columna no existe
        # (ej. balance/total_invoiced en algunos schemas viejos), la otra
        # siga funcionando.
        oc_id = None
        exp_balance_fallback = 0.0
        exp_total_fallback   = 0.0

        # Query 1: solo oc_id (mínimo absoluto). Si esto falla, las
        # tabs Proforma/Factura no van a poder hacer JOIN por OC.
        try:
            with connection.cursor() as cur:
                cur.execute(
                    "SELECT oc_id FROM expedientes.expediente WHERE id = %s LIMIT 1",
                    [exp_id],
                )
                row = cur.fetchone()
                if row and row[0]:
                    oc_id = row[0]
        except Exception as e:
            log.info("expediente.oc_id lookup falló: %s", e)

        # Query 2: balance/total como fallback opcional. Tolerante a
        # cualquier mismatch de columnas; si falla, queda en 0.
        try:
            with connection.cursor() as cur:
                cur.execute(
                    """
                    SELECT COALESCE(balance, 0),
                           COALESCE(total_invoiced, 0)
                      FROM expedientes.expediente
                     WHERE id = %s LIMIT 1
                    """,
                    [exp_id],
                )
                row = cur.fetchone()
                if row:
                    exp_balance_fallback = float(row[0] or 0)
                    exp_total_fallback   = float(row[1] or 0)
        except Exception as e:
            # Schema sin balance/total_invoiced — silenciar y seguir
            log.debug("expediente.balance/total_invoiced no disponibles: %s", e)

        log.info(
            "applicables · exp=%s · type=%s · oc_id=%s · exp_balance=%s",
            exp_id, kind, oc_id, exp_balance_fallback,
        )

        # ── PROFORMA / FACTURA ────────────────────────────────────
        if kind in ("PROFORMA", "FACTURA"):
            try:
                with connection.cursor() as cur:
                    cur.execute(
                        """
                        SELECT
                            d.id::text,
                            d.codigo,
                            d.kind,
                            d.fecha,
                            d.file_size_bytes,
                            d.author,
                            COALESCE(c.monto_pendiente, c.monto_total, 0) AS cobro_balance,
                            COALESCE(c.monto_total,                    0) AS cobro_total,
                            c.estado AS cobro_estado
                          FROM expedientes.documento d
                     LEFT JOIN cobros.cobro c
                            ON c.oc_id = d.oc_id
                           AND c.is_active = TRUE
                         WHERE UPPER(d.kind) = %s
                           AND d.is_active = TRUE
                           AND (d.expediente_id = %s
                                OR (%s::uuid IS NOT NULL AND d.oc_id = %s::uuid))
                         ORDER BY d.fecha DESC NULLS LAST, d.created_at DESC
                        """,
                        [kind, exp_id, str(oc_id) if oc_id else None,
                         str(oc_id) if oc_id else None],
                    )
                    rows = cur.fetchall()
            except Exception as e:
                log.warning("applicables(%s) query falló: %s", kind, e)
                # Fallback más permisivo: SOLO documentos, sin JOINs.
                try:
                    with connection.cursor() as cur:
                        cur.execute(
                            """
                            SELECT id::text, codigo, kind, fecha, file_size_bytes, author
                              FROM expedientes.documento
                             WHERE UPPER(kind) = %s
                               AND is_active = TRUE
                               AND (expediente_id = %s
                                    OR (%s::uuid IS NOT NULL AND oc_id = %s::uuid))
                             ORDER BY fecha DESC NULLS LAST, created_at DESC
                            """,
                            [kind, exp_id,
                             str(oc_id) if oc_id else None,
                             str(oc_id) if oc_id else None],
                        )
                        rows_simple = cur.fetchall()
                    rows = [(r[0], r[1], r[2], r[3], r[4], r[5], 0, 0, None)
                            for r in rows_simple]
                except Exception as e2:
                    log.error("applicables fallback falló: %s", e2)
                    rows = []

            for (doc_id, codigo, k, fecha, size_bytes, author,
                 cobro_balance, cobro_total, cobro_estado) in rows:
                # Balance prioritario:
                #   1. monto_pendiente del cobro asociado a la OC
                #   2. balance del expediente (suma de todas sus líneas)
                #   3. 0 si nada está poblado
                balance = float(cobro_balance or 0)
                total   = float(cobro_total or 0)
                if balance <= 0:
                    balance = exp_balance_fallback
                if total <= 0:
                    total = exp_total_fallback

                # Construye un código legible aún cuando `codigo` venga NULL
                code  = (codigo or "").strip()
                label = code or (k or "Documento")
                items.append({
                    "id":      str(doc_id),
                    "code":    code or label,
                    "label":   label,
                    "balance": balance,
                    "meta": {
                        "kind":         k,
                        "fecha":        fecha.isoformat() if fecha else None,
                        "size_bytes":   int(size_bytes) if size_bytes else None,
                        "author":       author,
                        "cobro_estado": cobro_estado,
                        "total":        total,
                    },
                })

        # ── COSTO ─────────────────────────────────────────────────
        elif kind == "COSTO":
            try:
                with connection.cursor() as cur:
                    # `financiero.cost_line` se crea en
                    # backend/sql/94_pipeline_financiero_portal.sql.
                    # Si la tabla no existe en este DB, devolvemos [] sin
                    # crashear (defensivo · permite ambientes nuevos).
                    cur.execute(
                        """
                        SELECT
                            id::text,
                            cost_type,
                            COALESCE(amount, 0)         AS amount,
                            currency,
                            COALESCE(amount_usd, 0)     AS amount_usd,
                            description,
                            created_at
                          FROM financiero.cost_line
                         WHERE expediente_id = %s
                           AND COALESCE(is_active, TRUE) = TRUE
                         ORDER BY created_at DESC NULLS LAST
                        """,
                        [exp_id],
                    )
                    rows = cur.fetchall()
            except Exception as e:
                # La tabla puede no existir en algunos environments.
                log.info("applicables(COSTO) query falló (probable schema): %s", e)
                rows = []

            for (cost_id, cost_type, amount, currency, amount_usd,
                 description, created_at) in rows:
                code  = (cost_type or "COSTO").upper()
                label = description or cost_type or "Costo"
                items.append({
                    "id":      str(cost_id),
                    "code":    code,
                    "label":   label,
                    "balance": float(amount_usd or amount or 0),
                    "meta": {
                        "cost_type": cost_type,
                        "currency":  currency,
                        "amount":    float(amount or 0),
                    },
                })

        return Response(items)

    # ── Re-analyze (Fase 3) ───────────────────────────────
    # Útil cuando el modelo se actualiza o el revisor humano quiere
    # un segundo pase del AIPaymentAnalyzer. Borra el verdict actual
    # (set is_current=FALSE) y encola un nuevo task. NO crea un Payment
    # nuevo: la audit log queda con dos verdicts ligados al mismo pago.
    @action(detail=True, methods=["post"], url_path="re-analyze")
    def re_analyze(self, request, pk=None):
        from .tasks import enqueue_ai_analyzer
        try:
            p = Payment.objects.get(pk=pk, is_active=True)
        except Payment.DoesNotExist:
            return Response({"detail": "Payment no existe"}, status=404)

        # Marcamos cualquier verdict previo como NO current — el task
        # va a insertar uno nuevo y el trigger desmarcaría igual, pero
        # lo hacemos explícito para que GET inmediato del FE no muestre
        # un verdict viejo si llega antes del INSERT del nuevo.
        from django.db import connection
        with connection.cursor() as cur:
            cur.execute(
                """
                UPDATE finance.payment_ai_verdict
                   SET is_current = FALSE
                 WHERE payment_id = %s
                   AND is_current = TRUE
                """,
                [str(p.id)],
            )

        outcome = enqueue_ai_analyzer(p.id)
        return Response({
            "ok": True,
            "payment_id": str(p.id),
            "outcome": outcome,  # queued / sync / skipped
        }, status=202)


# ════════════════════════════════════════════════════════════
# Helper · obtener UUID del actor desde el JWT
# ════════════════════════════════════════════════════════════
def _safe_user_uuid(request) -> uuid.UUID | None:
    """
    Devuelve `request.user.id` como UUID si es posible. Algunos JWT
    tienen `user_id` como str/int; otros llevan `sub`. Si nada es
    parseable a UUID, devolvemos None y dejamos `created_by=NULL`.
    """
    candidates = []
    user = getattr(request, "user", None)
    if user is not None:
        candidates.append(getattr(user, "id", None))
        candidates.append(getattr(user, "pk", None))
    if request.auth:
        candidates.append(request.auth.get("user_id"))
        candidates.append(request.auth.get("sub"))
    for c in candidates:
        if not c:
            continue
        try:
            return uuid.UUID(str(c))
        except (ValueError, AttributeError, TypeError):
            continue
    return None


# ════════════════════════════════════════════════════════════════════════
# Helper · Guard CEO-only para release-credit / reject
# ════════════════════════════════════════════════════════════════════════
def _require_ceo(request) -> Response | None:
    """Devuelve 403 Response si el actor no es CEO/ADMIN. None si pasa."""
    role = ""
    if request.auth:
        role = str(request.auth.get("role") or "")
    if not role:
        user = getattr(request, "user", None)
        role = str(getattr(user, "role_default", "") or
                   getattr(user, "role", "") or "")
    if str(role).upper() not in ("CEO", "ADMIN"):
        return Response(
            {"detail": "Esta accion requiere rol CEO o ADMIN.",
             "code": PaymentErrorCode.FORBIDDEN_NOT_CEO},
            status=403,
        )
    return None


# ════════════════════════════════════════════════════════════════════════
# Sprint Registrar Pago (Fase 1) — Endpoints nuevos en PaymentViewSet
# Se agregan via monkey-patch para mantener el archivo organizado por
# sprint. NO redefinen list/retrieve/create existentes.
# ════════════════════════════════════════════════════════════════════════

@action(detail=False, methods=["post"], url_path="dry-run")
def _payments_dry_run(self, request):
    """POST /api/finance/payments/dry-run

    Calcula el efecto sobre credito (matriz §2) sin persistir nada.
    Alimenta el Paso 4 del wizard de Registrar Pago.

    Payload minimo: { expediente_id, monto, aplicaciones: [{applicable_type, ...}] }
    Response 200: { credit_preview: {...}, validation_errors: [...] }
    """
    payload = request.data if isinstance(request.data, dict) else dict(request.data)
    applications = payload.get("aplicaciones") or payload.get("applications") or []
    if isinstance(applications, str):
        import json as _j
        try:
            applications = _j.loads(applications)
        except Exception:  # noqa: BLE001
            applications = []

    # Validacion ligera de contraparte (best-effort; el create real revalida).
    validation_errors = []
    try:
        CounterpartyValidator.assert_consistent(payload, applications)
    except CounterpartyMismatchError as exc:
        validation_errors.append({"code": exc.code, "detail": str(exc)})

    preview = CreditEffectService.dry_run(payload, applications)
    return Response({
        "validation_errors": validation_errors,
        "credit_preview": {
            "will_affect_credit":  preview.will_affect_credit,
            "target_client_id":    preview.target_client_id,
            "target_client_name":  preview.target_client_name,
            "delta_usd":           float(preview.delta_usd),
            "reason":              preview.reason,
            "blocking_error":      preview.blocking_error,
        },
    })

PaymentViewSet.dry_run = _payments_dry_run


@action(detail=True, methods=["patch"], url_path="reconcile")
def _payments_reconcile(self, request, pk=None):
    """PATCH /api/finance/payments/{id}/reconcile

    Marca reconciled_with_bank=True. No cambia el estado del pago.
    Payload opcional: { bank_reference, bank_statement_id }
    """
    try:
        p = Payment.objects.get(pk=pk, is_active=True)
    except Payment.DoesNotExist:
        return Response({"detail": "Payment no existe"}, status=404)

    bank_ref = (request.data.get("bank_reference") or "").strip()
    from django.db import connection
    with connection.cursor() as c:
        c.execute("""
            UPDATE finance.payment
               SET reconciled_with_bank = TRUE,
                   updated_at = NOW()
                   {ref_clause}
             WHERE id = %s::uuid
        """.format(ref_clause=", referencia = COALESCE(NULLIF(%s,''), referencia)"
                              if bank_ref else ""),
            ([bank_ref, str(pk)] if bank_ref else [str(pk)])
        )
    p.refresh_from_db()

    actor_id = _safe_user_uuid(request)
    ActivityLogger.log(
        action="payment.reconciled",
        target_type="payment", target_id=p.id,
        actor_id=actor_id,
        actor_role=(request.auth.get("role") if request.auth else None),
        payload_diff={"reconciled_with_bank": True},
        metadata={"bank_reference": bank_ref or None},
    )
    return Response(PaymentDetailSerializer(p).data)

PaymentViewSet.reconcile = _payments_reconcile


@action(detail=True, methods=["patch"], url_path="release-credit")
def _payments_release_credit(self, request, pk=None):
    """PATCH /api/finance/payments/{id}/release-credit

    CEO-only. Transiciona el pago a CONFIRMADO_HUMANO y dispara el
    efecto sobre credito (matriz §2) via CreditEffectService.apply().

    409 si el expediente vinculado tiene forma_pago NULL.
    """
    deny = _require_ceo(request)
    if deny is not None:
        return deny
    try:
        p = Payment.objects.get(pk=pk, is_active=True)
    except Payment.DoesNotExist:
        return Response({"detail": "Payment no existe"}, status=404)

    if p.estado not in [s.value for s in PAYMENT_STATES_RELEASABLE]:
        return Response(
            {"detail": f"No se puede liberar credito desde estado {p.estado}",
             "code": PaymentErrorCode.INVALID_STATE_TRANSITION},
            status=409,
        )

    from django.db import connection
    actor_id = _safe_user_uuid(request)
    prev_state = p.estado

    # Apply credit effect (puede lanzar ExpedienteTermsUndefinedError).
    try:
        CreditEffectService.apply(p, actor_id=actor_id)
    except ExpedienteTermsUndefinedError as exc:
        return Response(
            {"detail": str(exc), "code": exc.code},
            status=409,
        )

    # Transicion exitosa.
    with connection.cursor() as c:
        c.execute("""
            UPDATE finance.payment
               SET estado = %s,
                   confirmed_at = NOW(),
                   confirmed_by = %s::uuid,
                   updated_at = NOW()
             WHERE id = %s::uuid
        """, [PaymentStatus.CONFIRMADO_HUMANO.value,
              str(actor_id) if actor_id else None, str(pk)])
    p.refresh_from_db()

    ActivityLogger.log(
        action="payment.credit_released",
        target_type="payment", target_id=p.id,
        actor_id=actor_id,
        actor_role=(request.auth.get("role") if request.auth else None),
        payload_diff={"estado": {"from": prev_state, "to": p.estado}},
        metadata={"phase": "release"},
    )
    return Response(PaymentDetailSerializer(p).data)

PaymentViewSet.release_credit = _payments_release_credit


@action(detail=True, methods=["patch"], url_path="reject")
def _payments_reject(self, request, pk=None):
    """PATCH /api/finance/payments/{id}/reject

    CEO-only. Transiciona el pago a RECHAZADO.
    Payload: { rejection_reason, rejection_comment?, confirm_reversal? }

    Si rejection_reason='OTRO', rejection_comment es obligatorio.
    Si el estado actual es CONFIRMADO_HUMANO, requiere confirm_reversal=true
    y dispara revert() del credito.
    """
    deny = _require_ceo(request)
    if deny is not None:
        return deny
    try:
        p = Payment.objects.get(pk=pk, is_active=True)
    except Payment.DoesNotExist:
        return Response({"detail": "Payment no existe"}, status=404)

    if p.estado not in [s.value for s in PAYMENT_STATES_REJECTABLE]:
        return Response(
            {"detail": f"No se puede rechazar desde estado {p.estado}",
             "code": PaymentErrorCode.INVALID_STATE_TRANSITION},
            status=409,
        )

    reason = (request.data.get("rejection_reason") or "").strip().upper()
    comment = (request.data.get("rejection_comment") or "").strip()
    confirm_reversal = bool(request.data.get("confirm_reversal"))

    if reason not in PaymentRejectionReason.values:
        return Response(
            {"detail": f"rejection_reason invalido. Permitidos: "
                       f"{list(PaymentRejectionReason.values)}"},
            status=400,
        )
    if reason == PaymentRejectionReason.OTRO.value and not comment:
        return Response(
            {"detail": "rejection_comment es obligatorio cuando reason='OTRO'.",
             "code": PaymentErrorCode.REJECTION_COMMENT_REQUIRED},
            status=400,
        )

    prev_state = p.estado
    is_reversal = (prev_state == PaymentStatus.CONFIRMADO_HUMANO.value)
    if is_reversal and not confirm_reversal:
        return Response(
            {"detail": "Reversion de credito liberado requiere confirm_reversal=true.",
             "code": PaymentErrorCode.REVERSAL_CONFIRMATION_REQUIRED},
            status=409,
        )

    actor_id = _safe_user_uuid(request)
    from django.db import connection
    with connection.cursor() as c:
        c.execute("""
            UPDATE finance.payment
               SET estado = %s,
                   rejection_reason = %s,
                   rejection_comment = NULLIF(%s, ''),
                   reverted_at = CASE WHEN %s THEN NOW() ELSE reverted_at END,
                   reverted_by = CASE WHEN %s THEN %s::uuid ELSE reverted_by END,
                   reverted_reason = CASE WHEN %s
                                          THEN COALESCE(NULLIF(%s,''), %s)
                                          ELSE reverted_reason END,
                   updated_at = NOW()
             WHERE id = %s::uuid
        """, [PaymentStatus.RECHAZADO.value, reason, comment,
              is_reversal,
              is_reversal, str(actor_id) if actor_id else None,
              is_reversal, comment, reason,
              str(pk)])
    p.refresh_from_db()

    # Si era reversion, recomputar credit clock para que el monto vuelva.
    if is_reversal:
        try:
            CreditEffectService.revert(p, actor_id=actor_id)
        except Exception as exc:  # noqa: BLE001 — fail-soft
            log.warning("[reject] revert() fallo payment=%s err=%s", p.id, exc)

    ActivityLogger.log(
        action="payment.rejected",
        target_type="payment", target_id=p.id,
        actor_id=actor_id,
        actor_role=(request.auth.get("role") if request.auth else None),
        payload_diff={"estado": {"from": prev_state, "to": p.estado},
                      "rejection_reason": reason},
        metadata={"rejection_comment": comment or None,
                  "is_reversal": is_reversal},
    )
    return Response(PaymentDetailSerializer(p).data)

PaymentViewSet.reject = _payments_reject


@action(detail=False, methods=["get"], url_path="select_rejection_reasons")
def _payments_select_rejection_reasons(self, request):
    return Response([
        {"codigo": r.value, "label": r.label}
        for r in PaymentRejectionReason
    ])
PaymentViewSet.select_rejection_reasons = _payments_select_rejection_reasons


@action(detail=False, methods=["get"], url_path="select_counterparty_types")
def _payments_select_counterparty_types(self, request):
    return Response([
        {"codigo": t.value, "label": t.label}
        for t in PaymentCounterpartyType
    ])
PaymentViewSet.select_counterparty_types = _payments_select_counterparty_types


# ════════════════════════════════════════════════════════════════════════
# MwtAccountViewSet — CEO-ONLY. Cuentas bancarias propias MWT.
# ════════════════════════════════════════════════════════════════════════
class MwtAccountViewSet(viewsets.ViewSet):
    """CRUD basico de finance.mwt_account. CEO/ADMIN-only.
    Multi-tenancy via operating_company_id (consistente con resto del repo).
    """
    parser_classes = (JSONParser,)
    required_module = "finance"

    def list(self, request):
        deny = _require_ceo(request)
        if deny is not None:
            return deny
        from django.db import connection
        op_id = request.query_params.get("operating_company_id")
        params = []
        where = ["is_active = TRUE"]
        if op_id:
            where.append("operating_company_id = %s::uuid")
            params.append(op_id)
        where_sql = " AND ".join(where)
        with connection.cursor() as c:
            c.execute(f"""
                SELECT id, operating_company_id, bank_name, account_number,
                       account_alias, currency, country_iso2, swift_bic,
                       is_active, notes, created_at, updated_at
                  FROM finance.mwt_account
                 WHERE {where_sql}
                 ORDER BY bank_name, account_alias
            """, params)
            cols = [d[0] for d in c.description]
            rows = [dict(zip(cols, r)) for r in c.fetchall()]
        # Normalizar UUIDs y timestamps.
        for r in rows:
            r["id"] = str(r["id"]) if r["id"] else None
            r["operating_company_id"] = str(r["operating_company_id"]) if r["operating_company_id"] else None
        return Response(rows)

    def create(self, request):
        deny = _require_ceo(request)
        if deny is not None:
            return deny
        from django.db import connection
        d = request.data if isinstance(request.data, dict) else dict(request.data)
        required = ("operating_company_id", "bank_name", "account_number",
                    "currency", "country_iso2")
        missing = [f for f in required if not d.get(f)]
        if missing:
            return Response(
                {"detail": f"Campos requeridos: {missing}"}, status=400)
        new_id = uuid.uuid4()
        actor_id = _safe_user_uuid(request)
        with connection.cursor() as c:
            try:
                c.execute("""
                    INSERT INTO finance.mwt_account (
                        id, operating_company_id, bank_name, account_number,
                        account_alias, currency, country_iso2, swift_bic,
                        notes, created_by
                    ) VALUES (
                        %s::uuid, %s::uuid, %s, %s, %s, %s, %s, %s, %s,
                        %s::uuid
                    )
                """, [
                    str(new_id), str(d["operating_company_id"]),
                    d["bank_name"], d["account_number"],
                    d.get("account_alias"), d["currency"],
                    d["country_iso2"], d.get("swift_bic"),
                    d.get("notes"),
                    str(actor_id) if actor_id else None,
                ])
            except Exception as exc:  # noqa: BLE001
                return Response({"detail": f"Insert fallo: {exc}"}, status=400)
        return Response({"id": str(new_id), "ok": True}, status=201)


# ════════════════════════════════════════════════════════════════════════
# CounterpartyOpenDebtsViewSet — wrapper read-only para el Paso 2 del wizard
# GET /api/finance/counterparties/{type}/{id}/open-debts/?applicable_type=...
# ════════════════════════════════════════════════════════════════════════
class CounterpartyOpenDebtsViewSet(viewsets.ViewSet):
    """Lista obligaciones abiertas de una contraparte.

    Fase 1 — implementacion minima: filtra el endpoint existente
    `payments/applicables/` para los expedientes asociados a la contraparte.

    Si counterparty_type=CLIENTE: usa expedientes.client_id = counterparty_id.
    Si counterparty_type=PROVEEDOR/etc: usa oc.proveedor_id (via expediente.oc_id).

    Estructura de cada item devuelto:
      { obligation_id, applicable_type, expediente_id, expediente_codigo,
        proforma_codigo, sku, concepto, balance, currency,
        is_operated_by_mwt, payment_terms }
    """
    parser_classes = (JSONParser,)
    required_module = "finance"

    def list(self, request):
        # Listado generico no soportado (requiere {type}/{id} en URL custom).
        return Response({"detail": "Use /counterparties/{type}/{id}/open-debts/"}, status=400)

    @action(detail=False, methods=["get"],
            url_path=r"(?P<counterparty_type>[A-Z_]+)/(?P<counterparty_id>[0-9a-f-]+)/open-debts")
    def open_debts(self, request, counterparty_type=None, counterparty_id=None):
        from django.db import connection
        ct = (counterparty_type or "").strip().upper()
        if ct not in PaymentCounterpartyType.values:
            return Response({"detail": f"counterparty_type invalido: {ct}"}, status=400)
        applicable_type = (request.query_params.get("applicable_type") or "").upper().strip()

        # Resolver expediente_ids segun tipo de contraparte.
        if ct == "CLIENTE":
            exp_sql = """
                SELECT id, codigo, operating_company_id, forma_pago
                  FROM expedientes.expediente
                 WHERE client_id = %s::uuid AND is_active = TRUE
            """
        else:
            # Proveedor / Aduanero / Transportista / Agente / Distribuidor
            # Pasamos via expedientes.oc.proveedor_id (best-effort, sin FK).
            exp_sql = """
                SELECT e.id, e.codigo, e.operating_company_id, e.forma_pago
                  FROM expedientes.expediente e
                  LEFT JOIN expedientes.oc oc ON oc.id = e.oc_id
                 WHERE oc.proveedor_id = %s::uuid AND e.is_active = TRUE
            """
        try:
            with connection.cursor() as c:
                c.execute(exp_sql, [str(counterparty_id)])
                exps = [{"id": str(r[0]), "codigo": r[1],
                         "operating_company_id": str(r[2]) if r[2] else None,
                         "forma_pago": r[3]} for r in c.fetchall()]
        except Exception as exc:  # noqa: BLE001
            log.warning("open-debts query fallo type=%s id=%s err=%s",
                        ct, counterparty_id, exc)
            exps = []

        if not exps:
            return Response([])

        # Para cada expediente, reusamos la accion `applicables` existente.
        # Optimizacion: en Fase 1 hacemos un loop simple. Fase 2 puede
        # bucketizar todo en una unica query.
        out = []
        from .services import _is_operated_by_mwt as is_mwt_op
        for exp in exps:
            try:
                # Reusamos la accion del propio PaymentViewSet.
                pv = PaymentViewSet()
                pv.request = request
                fake_req = type("R", (), {"query_params": {
                    "expediente": exp["id"],
                    "type": applicable_type or "FACTURA",
                }})()
                resp = pv.applicables(fake_req)
                items = resp.data if hasattr(resp, "data") else []
            except Exception as exc:  # noqa: BLE001
                log.warning("applicables() reuse fallo exp=%s: %s", exp["id"], exc)
                items = []
            for it in items:
                out.append({
                    "obligation_id":      it.get("id"),
                    "applicable_type":    applicable_type or it.get("meta", {}).get("kind"),
                    "expediente_id":      exp["id"],
                    "expediente_codigo":  exp["codigo"],
                    "proforma_codigo":    (it.get("meta") or {}).get("proforma_codigo"),
                    "sku":                (it.get("meta") or {}).get("sku"),
                    "concepto":           it.get("label"),
                    "balance":            it.get("balance") or 0,
                    "currency":           (it.get("meta") or {}).get("currency") or "USD",
                    "is_operated_by_mwt": is_mwt_op(exp["operating_company_id"]),
                    "payment_terms":      exp["forma_pago"],
                })
        return Response(out)
