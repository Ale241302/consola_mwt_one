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
from .services import PaymentService

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
                            COALESCE(c.monto_pendiente, c.monto_total, o.amount_total, 0) AS balance,
                            COALESCE(c.monto_total,    o.amount_total,                0) AS total,
                            c.estado AS cobro_estado
                          FROM expedientes.documento d
                     LEFT JOIN cobros.cobro c
                            ON c.oc_id = d.oc_id
                           AND c.is_active = TRUE
                     LEFT JOIN expedientes.files o
                            ON o.id = d.oc_id
                         WHERE d.expediente_id = %s
                           AND UPPER(d.kind) = %s
                           AND d.is_active = TRUE
                         ORDER BY d.fecha DESC NULLS LAST, d.created_at DESC
                        """,
                        [exp_id, kind],
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
                             WHERE expediente_id = %s
                               AND UPPER(kind) = %s
                               AND is_active = TRUE
                             ORDER BY fecha DESC NULLS LAST, created_at DESC
                            """,
                            [exp_id, kind],
                        )
                        rows_simple = cur.fetchall()
                    rows = [(r[0], r[1], r[2], r[3], r[4], r[5], 0, 0, None) for r in rows_simple]
                except Exception as e2:
                    log.error("applicables fallback falló: %s", e2)
                    rows = []

            for (doc_id, codigo, k, fecha, size_bytes, author,
                 balance, total, cobro_estado) in rows:
                # Construye un código legible aún cuando `codigo` venga NULL
                code  = (codigo or "").strip()
                label = code or (k or "Documento")
                items.append({
                    "id":      str(doc_id),
                    "code":    code or label,
                    "label":   label,
                    "balance": float(balance or 0),
                    "meta": {
                        "kind":         k,
                        "fecha":        fecha.isoformat() if fecha else None,
                        "size_bytes":   int(size_bytes) if size_bytes else None,
                        "author":       author,
                        "cobro_estado": cobro_estado,
                        "total":        float(total or 0),
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
