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
