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
from apps.core.scoped_querysets import (
    filter_by_user_clients,
    _is_bypass,
)
from apps.core.fx_service import get_fx_to_usd

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
        """List payments con filtros multi-tenant + cross-transfers.

        Sprint 2026-05-25 (defensivo): cada bloque está envuelto en
        try/except específico que loguea el traceback completo y
        devuelve JSON {"detail": "..."} en lugar del HTML 500 genérico
        de Django. Esto facilita diagnosticar en producción (el HTML
        500 oculta la causa raíz tras el proxy de Cloudflare).
        """
        from django.db import connection

        try:
            qs = Payment.objects.filter(is_active=True)
            # Sprint 2026-05-22 · scope multi-tenant por client_id.
            qs = filter_by_user_clients(qs, request.user, client_field="client_id")
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
        except Exception as exc:  # noqa: BLE001 — defensa contra 500 genérico
            log.exception("[PaymentViewSet.list] base filter failed: %s", exc)
            return Response(
                {"detail": "Base filter failed", "error": f"{type(exc).__name__}: {exc}"},
                status=500,
            )

        # ── Sprint 2026-05-25 · filtros cross-transfers ──────────
        # nodo_id / transferencia_id / oc_id → filtra por pagos que
        # tienen al menos una application de tipo COSTO a una cost_line
        # de transfers.cost_line cuya transferencia tocó ese nodo/OC/exp.
        transferencia_id = request.query_params.get("transferencia_id")
        nodo_id          = request.query_params.get("nodo_id")
        oc_id            = request.query_params.get("oc_id")

        if transferencia_id or nodo_id or oc_id:
            try:
                cost_line_ids = _resolve_cost_line_ids(
                    connection,
                    transferencia_id=transferencia_id,
                    nodo_id=nodo_id,
                    oc_id=oc_id,
                )
                # PaymentApplication.payment_id es UUIDField (no FK), así
                # que NO existe la relación inversa `payment.applications`.
                # Subquery explícito sobre payment_id.
                if cost_line_ids:
                    payment_ids = list(
                        PaymentApplication.objects.filter(
                            applicable_type="COSTO",
                            applicable_id__in=cost_line_ids,
                        ).values_list("payment_id", flat=True).distinct()
                    )
                else:
                    payment_ids = []
                qs = qs.filter(id__in=payment_ids)
            except Exception as exc:  # noqa: BLE001
                log.exception(
                    "[PaymentViewSet.list] cross-transfers filter failed: "
                    "transferencia_id=%s nodo_id=%s oc_id=%s err=%s",
                    transferencia_id, nodo_id, oc_id, exc,
                )
                return Response(
                    {"detail": "Cross-transfers filter failed",
                     "error":  f"{type(exc).__name__}: {exc}",
                     "scope":  {"transferencia_id": transferencia_id,
                                "nodo_id": nodo_id,
                                "oc_id": oc_id}},
                    status=500,
                )

        # Sprint 2026-05-25 · filtro por tipo de aplicación (COSTO/PRODUCTO/…)
        payment_target_type = request.query_params.get("payment_target_type")
        if payment_target_type:
            try:
                payment_ids_by_type = list(
                    PaymentApplication.objects.filter(
                        applicable_type=payment_target_type.upper(),
                    ).values_list("payment_id", flat=True).distinct()
                )
                qs = qs.filter(id__in=payment_ids_by_type)
            except Exception as exc:  # noqa: BLE001
                log.exception(
                    "[PaymentViewSet.list] payment_target_type filter failed: %s",
                    exc,
                )
                return Response(
                    {"detail": "payment_target_type filter failed",
                     "error":  f"{type(exc).__name__}: {exc}"},
                    status=500,
                )

        try:
            qs = qs.order_by("-created_at")[:200]
            return Response(PaymentDetailSerializer(qs, many=True).data)
        except Exception as exc:  # noqa: BLE001
            log.exception("[PaymentViewSet.list] serializer/render failed: %s", exc)
            return Response(
                {"detail": "Serializer failed", "error": f"{type(exc).__name__}: {exc}"},
                status=500,
            )

    # ── Retrieve ──────────────────────────────────────────
    def retrieve(self, request, pk=None):
        try:
            p = Payment.objects.get(pk=pk, is_active=True)
        except Payment.DoesNotExist:
            return Response({"detail": "Payment no existe"}, status=404)
        # Sprint 2026-05-22 · scope guard cross-tenant.
        if not _is_bypass(request.user):
            scope = [str(x).lower() for x in (getattr(request.user, "legal_entity_ids", None) or [])]
            if not scope or str(p.client_id).lower() not in scope:
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

        # Feature C: si viene pre_verdict del análisis previo, pasarlo a register()
        pre_verdict = s.validated_data.get("pre_verdict") or None

        try:
            result = PaymentService.register(
                validated   = s.validated_data,
                actor_id    = actor_id,
                actor_role  = actor_role,
                pre_verdict = pre_verdict,
            )
        except RuntimeError as exc:
            log.error("PaymentService.register falló: %s", exc)
            return Response({"detail": str(exc)}, status=502)

        body = PaymentDetailSerializer(result.payment).data
        # Ajustar next_action según el estado resultante del pago.
        _estado = body.get("estado") or ""
        if _estado == "CONFIRMADO_AI":
            body["next_action"] = (
                "Pago creado y confirmado por IA (confianza alta del comprobante previo)."
            )
        elif _estado == "NEEDS_REVIEW":
            body["next_action"] = (
                "Pago creado en revisión humana (comprobante pre-analizado con confianza baja)."
            )
        else:
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
        """Lista de items con saldo pendiente para asignar a un pago.

        Sprint 2026-05-25 (defensivo): TODO el body envuelto en
        try/except superior que captura excepciones inesperadas y
        devuelve JSON {"detail": ..., "error": ...} en lugar de HTML
        500 generico de Django. Mantiene los try/except internos para
        granularidad de errores.
        """
        from django.db import connection

        try:
            resp = self._applicables_impl(request, connection)
        except Exception as exc:  # noqa: BLE001 - blindaje contra HTML 500
            log.exception(
                "[PaymentViewSet.applicables] uncaught error params=%s err=%s",
                dict(request.query_params), exc,
            )
            resp = Response(
                {"applicables": [],
                 "detail": "applicables failed",
                 "error":  f"{type(exc).__name__}: {exc}"},
                status=500,
            )
        # Sprint 2026-05-25 - anti-cache: Cloudflare/proxies estaban
        # sirviendo respuestas viejas con el bug del fx=1.0 incluso
        # despues del deploy. Forzar no-store en este endpoint
        # dinamico (cada cost_line cambia con pagos, no cachear).
        resp["Cache-Control"] = "no-store, no-cache, must-revalidate, private"
        resp["Pragma"] = "no-cache"
        resp["Expires"] = "0"
        return resp

    def _applicables_impl(self, request, connection):
        exp_id           = request.query_params.get("expediente")
        kind             = (request.query_params.get("type") or "").upper().strip()
        nodo_id          = request.query_params.get("nodo_id")
        transferencia_id = request.query_params.get("transferencia_id")
        oc_id_param      = request.query_params.get("oc_id")

        # Para PROFORMA/FACTURA expediente sigue siendo obligatorio.
        # Para COSTO/PRODUCTO se acepta cualquiera de los 4 filtros.
        has_scope = bool(exp_id or nodo_id or transferencia_id or oc_id_param)
        if kind in ("PROFORMA", "FACTURA") and not exp_id:
            return Response({"detail": "expediente requerido para PROFORMA/FACTURA"}, status=400)
        if kind in ("COSTO", "PRODUCTO") and not has_scope:
            return Response(
                {"detail": "Se requiere al menos uno de: expediente, nodo_id, transferencia_id, oc_id"},
                status=400,
            )
        if kind not in ("PROFORMA", "FACTURA", "COSTO", "PRODUCTO"):
            return Response(
                {"detail": f"type invalido: {kind!r} (PROFORMA/FACTURA/COSTO/PRODUCTO)"},
                status=400,
            )

        items = []

        # Resolver OC y montos del expediente (best-effort, defensivo).
        # IMPORTANTE: oc_id como variable local se usa para 2 cosas:
        #   1. El query param explicito (oc_id_param) -> scope filter.
        #   2. El oc_id derivado del expediente (cuando exp_id viene)
        #      para hacer JOIN con cobros.cobro en PROFORMA/FACTURA.
        # Antes esto era una sola variable que se sobrescribia a None,
        # borrando el query param. Ahora separamos:
        #   - oc_id_param  = lo que vino por URL (no se modifica nunca).
        #   - oc_id_lookup = derivado del expediente para JOIN docs.
        # Para la rama COSTO/PRODUCTO usamos oc_id_param como scope.
        oc_id_lookup = None
        exp_balance_fallback = 0.0
        exp_total_fallback   = 0.0

        # Query 1: solo oc_id (minimo absoluto). Si esto falla, las
        # tabs Proforma/Factura no van a poder hacer JOIN por OC.
        # Solo tiene sentido si exp_id vino por URL.
        if exp_id:
            try:
                with connection.cursor() as cur:
                    cur.execute(
                        "SELECT oc_id FROM expedientes.expediente WHERE id = %s LIMIT 1",
                        [exp_id],
                    )
                    row = cur.fetchone()
                    if row and row[0]:
                        oc_id_lookup = row[0]
            except Exception as e:
                log.info("expediente.oc_id lookup fallo: %s", e)

        # Query 2: balance/total como fallback opcional. Tolerante a
        # cualquier mismatch de columnas; si falla, queda en 0.
        if exp_id:
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
                # Schema sin balance/total_invoiced - silenciar y seguir
                log.debug("expediente.balance/total_invoiced no disponibles: %s", e)

        log.info(
            "applicables type=%s exp=%s nodo=%s trf=%s oc=%s",
            kind, exp_id, nodo_id, transferencia_id, oc_id_param,
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
                        [kind, exp_id, str(oc_id_lookup) if oc_id_lookup else None,
                         str(oc_id_lookup) if oc_id_lookup else None],
                    )
                    rows = cur.fetchall()
            except Exception as e:
                log.warning("applicables(%s) query fallo: %s", kind, e)
                # Fallback mas permisivo: SOLO documentos, sin JOINs.
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
                             str(oc_id_lookup) if oc_id_lookup else None,
                             str(oc_id_lookup) if oc_id_lookup else None],
                        )
                        rows_simple = cur.fetchall()
                    rows = [(r[0], r[1], r[2], r[3], r[4], r[5], 0, 0, None)
                            for r in rows_simple]
                except Exception as e2:
                    log.error("applicables fallback fallo: %s", e2)
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
        # Sprint 2026-05-25: soporta 4 filtros mutuamente excluyentes.
        # Si se pasa expediente= (y nada más), combinamos:
        #   1. financiero.cost_line legacy (backward-compat)
        #   2. transfers.cost_line cuya transferencia tocó ese expediente
        # Si se pasa nodo_id / transferencia_id / oc_id: solo transfers.cost_line.
        elif kind == "COSTO":
            use_new_only = bool(nodo_id or transferencia_id or oc_id_param)

            # ── 1. Legacy financiero.cost_line (solo si filtramos por expediente) ──
            if exp_id and not use_new_only:
                try:
                    with connection.cursor() as cur:
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
                        legacy_rows = cur.fetchall()
                except Exception as e:
                    log.info("applicables(COSTO) legacy query falló: %s", e)
                    legacy_rows = []

                for (cost_id, cost_type, amount, currency, amount_usd,
                     description, created_at) in legacy_rows:
                    code  = (cost_type or "COSTO").upper()
                    label = description or cost_type or "Costo"
                    items.append({
                        "id":      str(cost_id),
                        "type":    "COSTO",
                        "kind":    code,
                        "code":    code,
                        "label":   label,
                        "amount":  str(amount or 0),
                        "currency": currency or "USD",
                        "amount_usd": str(amount_usd or amount or 0),
                        "paid_usd":  "0.00",
                        "saldo_usd": str(amount_usd or amount or 0),
                        "balance": float(amount_usd or amount or 0),
                        "transferencia_id": None,
                        "transferencia_codigo": None,
                        "scope_summary": None,
                        "meta": {
                            "cost_type": cost_type,
                            "currency":  currency,
                            "amount":    float(amount or 0),
                        },
                    })

            # ── 2. transfers.cost_line (real) ────────────────────────────────
            # Construye el CTE de filtro segun el scope pasado.
            if use_new_only:
                scope_cte, scope_params = _build_transfers_scope_cte(
                    nodo_id=nodo_id,
                    transferencia_id=transferencia_id,
                    oc_id=oc_id_param,
                    exp_id=None,
                )
            else:
                # expediente= → añadimos cost_lines de transfers.cost_line
                # que tocaron ese expediente (via nodo_assignment O scope_json).
                scope_cte, scope_params = _build_transfers_scope_cte(
                    nodo_id=None,
                    transferencia_id=None,
                    oc_id=None,
                    exp_id=exp_id,
                )

            trf_sql = scope_cte + """
            SELECT
                cl.id::text                                       AS id,
                cl.kind,
                COALESCE(ck.label, cl.kind)                       AS kind_label,
                COALESCE(cl.label, cl.kind, 'Costo')              AS label,
                cl.amount::text                                   AS amount,
                cl.currency,
                COALESCE(cl.amount_usd, cl.amount, 0)::text      AS amount_usd,
                cl.scope_json,
                cl.transferencia_id::text                         AS transferencia_id,
                t.codigo                                          AS transferencia_codigo,
                COALESCE(
                    SUM(pa.monto_aplicado) FILTER (
                        WHERE pa.applicable_type = 'COSTO'
                          AND pa.applicable_id   = cl.id
                    ), 0
                )::text                                           AS paid_usd
            FROM transfers.cost_line cl
            JOIN transfers.transferencia t        ON t.id = cl.transferencia_id
            JOIN _scope_trf s                     ON s.transferencia_id = cl.transferencia_id
            LEFT JOIN transfers.cost_kind_cat ck  ON ck.codigo = cl.kind
            LEFT JOIN finance.payment_application pa
                   ON pa.applicable_id   = cl.id
                  AND pa.applicable_type = 'COSTO'
            WHERE cl.is_active = TRUE
            GROUP BY
                cl.id, cl.kind, ck.label, cl.label,
                cl.amount, cl.currency, cl.amount_usd,
                cl.scope_json, cl.transferencia_id, t.codigo
            ORDER BY cl.transferencia_id, cl.kind
            """

            try:
                with connection.cursor() as cur:
                    cur.execute(trf_sql, scope_params)
                    trf_cols = [d[0] for d in cur.description]
                    trf_rows = [dict(zip(trf_cols, r)) for r in cur.fetchall()]
            except Exception as e:
                log.exception("applicables(COSTO) transfers.cost_line query falló: %s", e)
                trf_rows = []

            # Sprint 2026-05-25 - Bug detectado: muchas cost_lines
            # historicas tienen fx_to_usd=1.0 y currency != USD, asi
            # que amount_usd (columna persistida) es igual al amount
            # local (CRC, BRL, etc.) tratado como USD. El frontend
            # mostraba "$1,422,888.96 USD" para un DUA de 1.4M CRC
            # (real ~$3,107 USD). Aqui detectamos ese caso y
            # recalculamos amount_usd y saldo_usd con la tasa real
            # de Frankfurter (cacheada 1h en Redis).
            from decimal import Decimal

            # Cache local del FX rate por currency dentro de este request
            _fx_cache = {}
            def _resolve_fx(ccy):
                if ccy in _fx_cache:
                    return _fx_cache[ccy]
                fx = get_fx_to_usd(ccy)
                _fx_cache[ccy] = fx
                return fx

            for row in trf_rows:
                # Sprint 2026-05-25 - scope_json puede venir como str
                # (columna TEXT) o dict (JSONB). Parsear defensivo.
                scope_j_raw = row.get("scope_json")
                if isinstance(scope_j_raw, str) and scope_j_raw.strip():
                    try:
                        import json as _json
                        scope_j = _json.loads(scope_j_raw)
                    except (ValueError, TypeError):
                        scope_j = None
                elif isinstance(scope_j_raw, dict):
                    scope_j = scope_j_raw
                else:
                    scope_j = None

                if scope_j is None or (isinstance(scope_j, dict) and scope_j.get("applies_to_all", True)):
                    scope_summary = "Toda la transferencia"
                elif isinstance(scope_j, dict):
                    exp_ids = scope_j.get("expediente_ids") or []
                    n = len(exp_ids)
                    scope_summary = f"{n} expediente{'s' if n != 1 else ''}"
                else:
                    scope_summary = "Toda la transferencia"

                amount_local = Decimal(str(row.get("amount") or "0"))
                currency     = (row.get("currency") or "USD").upper()
                amount_usd_persisted = Decimal(str(row.get("amount_usd") or "0"))
                paid_usd_persisted   = Decimal(str(row.get("paid_usd")   or "0"))

                # Heuristica de deteccion del bug:
                #   currency != USD AND amount_usd == amount (ratio 1.0)
                # significa que se persistio sin convertir. Recalculamos
                # con tasa Frankfurter en vivo.
                needs_recalc = (
                    currency != "USD"
                    and amount_local > 0
                    and abs(amount_usd_persisted - amount_local) < Decimal("0.01")
                )

                fx_real = None
                if needs_recalc:
                    fx_real = _resolve_fx(currency)
                    if fx_real and fx_real > 0:
                        amount_usd_val = (amount_local * Decimal(str(fx_real))).quantize(Decimal("0.01"))
                        # paid_usd persistido tambien podria estar mal;
                        # asumimos que SI esta correcto en USD ya que el
                        # registro de pago siempre normaliza a USD (no
                        # arrastra el bug del cost_line). Si en el futuro
                        # se detectara que tampoco, aplicar misma heuristica.
                        paid_usd_val = paid_usd_persisted
                    else:
                        # FX no disponible -> dejamos los valores como estan,
                        # marcamos en meta para que el FE pueda warning.
                        amount_usd_val = amount_usd_persisted
                        paid_usd_val   = paid_usd_persisted
                else:
                    amount_usd_val = amount_usd_persisted
                    paid_usd_val   = paid_usd_persisted

                saldo = amount_usd_val - paid_usd_val

                # Sprint 2026-05-25 - exponer expediente_id derivado
                # de scope_json para que el wizard arme bien el POST.
                # Si scope_json.applies_to_all=true o no hay expediente_ids,
                # cae a None (el wizard buscara otra fuente).
                derived_exp_id = None
                derived_exp_ids = []
                if isinstance(scope_j, dict):
                    exp_ids = scope_j.get("expediente_ids") or []
                    if exp_ids:
                        derived_exp_ids = [str(x) for x in exp_ids]
                        derived_exp_id = derived_exp_ids[0]

                items.append({
                    "id":                   row["id"],
                    "type":                 "COSTO",
                    "kind":                 row.get("kind") or "COSTO",
                    "code":                 row.get("kind") or "COSTO",
                    "label":                row.get("label") or "Costo",
                    "amount":               str(amount_local),
                    "currency":             currency,
                    "amount_usd":           str(amount_usd_val),
                    "paid_usd":             str(paid_usd_val),
                    "saldo_usd":            str(saldo),
                    "balance":              float(saldo),
                    "transferencia_id":     row.get("transferencia_id"),
                    "transferencia_codigo": row.get("transferencia_codigo"),
                    "scope_summary":        scope_summary,
                    "scope_json":           scope_j,  # dict parseado (no str)
                    "expediente_id":        derived_exp_id,
                    "expediente_ids":       derived_exp_ids,
                    "fx_to_usd":            fx_real if fx_real else (1.0 if currency == "USD" else None),
                    "fx_recalculated":      bool(needs_recalc and fx_real),
                    "fx_source":            "frankfurter" if (needs_recalc and fx_real) else "persisted",
                    # kept for backward compat with legacy consumers
                    "meta": {
                        "cost_type": row.get("kind"),
                        "currency":  currency,
                        "amount":    float(amount_local),
                        "fx_warning": (currency != "USD" and not fx_real and needs_recalc),
                    },
                })

        # ── PRODUCTO ──────────────────────────────────────────────────
        # Sprint 2026-05-25: multi-select de productos con qty pagada y saldo.
        # applicable_id = expedientes.linea.id (donde se trackea el pago).
        # Soporta 4 scopes: expediente, nodo_id, transferencia_id, oc_id.
        # Devuelve solo items con saldo_qty > 0 salvo ?include_paid=true.
        elif kind == "PRODUCTO":
            include_paid = (
                request.query_params.get("include_paid", "").lower()
                in ("1", "true", "yes")
            )
            from .services import _is_operated_by_mwt as _mwt_check

            try:
                items = _build_producto_applicables(
                    connection=connection,
                    exp_id=exp_id,
                    nodo_id=nodo_id,
                    transferencia_id=transferencia_id,
                    oc_id=oc_id_param,
                    include_paid=include_paid,
                    is_operated_by_mwt_fn=_mwt_check,
                )
            except Exception as exc:
                log.exception("applicables(PRODUCTO) falló: %s", exc)
                return Response({"applicables": [], "error_detail": str(exc)})

            return Response({"applicables": items})

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
# Helpers · resolución de cost_line ids para filtros cross-transfers
# ════════════════════════════════════════════════════════════

def _build_transfers_scope_cte(*, nodo_id, transferencia_id, oc_id, exp_id):
    """
    Construye el CTE SQL `_scope_trf (transferencia_id)` y la lista de
    params para filtrar transfers.cost_line según el filtro activo.

    Retorna (cte_sql_str, params_list).
    El CTE se llama `_scope_trf` y tiene una sola columna `transferencia_id`.
    """
    if transferencia_id:
        cte = """
        WITH _scope_trf AS (
            SELECT id AS transferencia_id
              FROM transfers.transferencia
             WHERE id = %s::uuid
               AND is_active = TRUE
        )
        """
        params = [str(transferencia_id)]

    elif nodo_id:
        # Transferencias que asignaron mercancía a este nodo.
        cte = """
        WITH _scope_trf AS (
            SELECT DISTINCT transferencia_id
              FROM inventario.expediente_nodo_assignment
             WHERE nodo_id          = %s::uuid
               AND transferencia_id IS NOT NULL
               AND is_active        = TRUE
        )
        """
        params = [str(nodo_id)]

    elif oc_id:
        # Transferencias que tocaron algún expediente de esta OC.
        cte = """
        WITH _scope_trf AS (
            SELECT DISTINCT a.transferencia_id
              FROM inventario.expediente_nodo_assignment a
              JOIN expedientes.expediente e
                ON e.id       = a.expediente_id
               AND e.oc_id    = %s::uuid
               AND e.is_active = TRUE
             WHERE a.transferencia_id IS NOT NULL
               AND a.is_active        = TRUE
        )
        """
        params = [str(oc_id)]

    elif exp_id:
        # Transferencias que tocaron este expediente vía nodo_assignment.
        cte = """
        WITH _scope_trf AS (
            SELECT DISTINCT transferencia_id
              FROM inventario.expediente_nodo_assignment
             WHERE expediente_id    = %s::uuid
               AND transferencia_id IS NOT NULL
               AND is_active        = TRUE
        )
        """
        params = [str(exp_id)]

    else:
        # Sin scope → CTE vacío (ningún cost_line).
        cte = """
        WITH _scope_trf AS (
            SELECT NULL::uuid AS transferencia_id WHERE FALSE
        )
        """
        params = []

    return cte, params


def _resolve_cost_line_ids(connection, *, transferencia_id, nodo_id, oc_id):
    """
    Devuelve una lista (posiblemente vacía) de UUIDs de transfers.cost_line
    que pertenecen al scope pedido (nodo/transferencia/OC).

    Retorna [] (lista vacía) si el UUID es inválido o hay un error SQL,
    para que el caller nunca reciba None y nunca levante una excepción 500.
    Loguea el error internamente con log.exception.
    """
    # Validación defensiva de UUIDs antes de tocar la DB.
    import uuid as _uuid_mod
    for label, val in (("transferencia_id", transferencia_id),
                        ("nodo_id", nodo_id), ("oc_id", oc_id)):
        if val is not None:
            try:
                _uuid_mod.UUID(str(val))
            except (ValueError, AttributeError, TypeError):
                log.warning("_resolve_cost_line_ids: %s UUID inválido=%r → []", label, val)
                return []

    cte, params = _build_transfers_scope_cte(
        nodo_id=nodo_id,
        transferencia_id=transferencia_id,
        oc_id=oc_id,
        exp_id=None,
    )
    sql = cte + """
    SELECT cl.id
      FROM transfers.cost_line cl
      JOIN _scope_trf s ON s.transferencia_id = cl.transferencia_id
     WHERE cl.is_active = TRUE
    """
    try:
        with connection.cursor() as cur:
            cur.execute(sql, params)
            return [row[0] for row in cur.fetchall()]
    except Exception as exc:
        log.exception("_resolve_cost_line_ids SQL failed: %s", exc)
        return []


# ════════════════════════════════════════════════════════════
# Helper · construir lista de applicables tipo PRODUCTO
# ════════════════════════════════════════════════════════════
def _build_producto_applicables(
    *,
    connection,
    exp_id,
    nodo_id,
    transferencia_id,
    oc_id,
    include_paid: bool,
    is_operated_by_mwt_fn,
) -> list:
    """
    Construye la lista de items de tipo PRODUCTO para el endpoint
    GET /api/finance/payments/applicables/?type=PRODUCTO.

    Cada item representa una línea de expedientes.linea.
    applicable_id = expedientes.linea.id (donde se trackea el pago).

    Scopes soportados (mutuamente excluyentes, primer match gana):
      1. nodo_id         → via inventario.expediente_nodo_assignment
      2. transferencia_id → via inventario.expediente_nodo_assignment
      3. oc_id           → expedientes.linea JOIN expedientes.expediente
      4. exp_id          → expedientes.linea directamente

    Devuelve [] (lista vacía) ante cualquier error SQL (fail-soft).
    """
    from decimal import Decimal, InvalidOperation

    items: list = []

    # ── Determinar qué SQL usar según el scope ────────────────────
    #
    # Para scopes nodo_id y transferencia_id: usamos
    # inventario.expediente_nodo_assignment para obtener
    # (expediente_id, producto_id, talla, nodo_id, transferencia_id,
    #  qty_asignada), luego JOINamos expedientes.linea para obtener
    # el applicable_id canónico (linea.id) y los precios.
    #
    # Para scopes oc_id y exp_id: leemos expedientes.linea directamente.

    if nodo_id or transferencia_id:
        # Validación previa de UUID
        import uuid as _uuid_mod
        _scope_label = "nodo_id" if nodo_id else "transferencia_id"
        _scope_val   = nodo_id   if nodo_id else transferencia_id
        try:
            _uuid_mod.UUID(str(_scope_val))
        except (ValueError, AttributeError, TypeError):
            log.warning(
                "_build_producto_applicables: %s UUID inválido=%r → []",
                _scope_label, _scope_val,
            )
            return []

        # Filtro de assignment
        if nodo_id:
            assign_filter_sql  = "a.nodo_id = %s::uuid"
            assign_filter_param = str(nodo_id)
        else:
            assign_filter_sql  = "a.transferencia_id = %s::uuid"
            assign_filter_param = str(transferencia_id)

        sql = f"""
        WITH agg AS (
            -- Suma qty_asignada por (expediente_id, producto_id, talla, nodo_id, transferencia_id).
            -- Varios registros de assignment (append-only) se colapsan aquí.
            SELECT
                a.expediente_id,
                a.producto_id,
                a.talla,
                a.nodo_id,
                a.transferencia_id,
                SUM(a.qty_asignada)   AS qty_asignada
            FROM inventario.expediente_nodo_assignment a
            WHERE {assign_filter_sql}
              AND a.is_active = TRUE
            GROUP BY a.expediente_id, a.producto_id, a.talla, a.nodo_id, a.transferencia_id
        )
        SELECT
            l.id::text                                      AS linea_id,
            l.expediente_id::text                           AS expediente_id,
            e.codigo                                        AS expediente_codigo,
            e.operating_company_id::text                    AS operating_company_id,
            l.producto_id::text                             AS producto_id,
            l.sku,
            l.size                                          AS talla,
            agg.qty_asignada                                AS cantidad_total,
            l.unit_price,
            l.unit_price_mwt,
            l.unit_price_client,
            e.moneda                                        AS currency,
            COALESCE(agg.nodo_id::text,      '')            AS nodo_id,
            COALESCE(nd.codigo,              '')            AS nodo_codigo,
            COALESCE(agg.transferencia_id::text, '')        AS transferencia_id,
            COALESCE(t.codigo,               '')            AS transferencia_codigo,
            COALESCE(
                SUM(pa.cantidad_producto) FILTER (
                    WHERE pa.applicable_type = 'PRODUCTO'
                      AND pa.applicable_id   = l.id
                ), 0
            )                                               AS paid_qty
        FROM agg
        JOIN expedientes.linea l
          ON l.expediente_id = agg.expediente_id
         AND l.producto_id   = agg.producto_id
         AND COALESCE(l.size, '') = COALESCE(agg.talla, '')
         AND l.is_active = TRUE
        JOIN expedientes.expediente e
          ON e.id = l.expediente_id
         AND e.is_active = TRUE
        LEFT JOIN nodos.nodo nd
          ON nd.id = agg.nodo_id
        LEFT JOIN transfers.transferencia t
          ON t.id = agg.transferencia_id
        LEFT JOIN finance.payment_application pa
          ON pa.applicable_id   = l.id
         AND pa.applicable_type = 'PRODUCTO'
        GROUP BY
            l.id, l.expediente_id, e.codigo, e.operating_company_id,
            l.producto_id, l.sku, l.size,
            agg.qty_asignada, l.unit_price, l.unit_price_mwt,
            l.unit_price_client, e.moneda,
            agg.nodo_id, nd.codigo, agg.transferencia_id, t.codigo
        ORDER BY e.codigo, l.sku, l.size
        """
        params = [assign_filter_param]

    elif oc_id:
        # Todas las líneas de todos los expedientes de la OC
        import uuid as _uuid_mod
        try:
            _uuid_mod.UUID(str(oc_id))
        except (ValueError, AttributeError, TypeError):
            log.warning("_build_producto_applicables: oc_id UUID inválido=%r → []", oc_id)
            return []

        sql = """
        SELECT
            l.id::text                                      AS linea_id,
            l.expediente_id::text                           AS expediente_id,
            e.codigo                                        AS expediente_codigo,
            e.operating_company_id::text                    AS operating_company_id,
            l.producto_id::text                             AS producto_id,
            l.sku,
            l.size                                          AS talla,
            l.qty::integer                                  AS cantidad_total,
            l.unit_price,
            l.unit_price_mwt,
            l.unit_price_client,
            e.moneda                                        AS currency,
            NULL::text                                      AS nodo_id,
            NULL::text                                      AS nodo_codigo,
            NULL::text                                      AS transferencia_id,
            NULL::text                                      AS transferencia_codigo,
            COALESCE(
                SUM(pa.cantidad_producto) FILTER (
                    WHERE pa.applicable_type = 'PRODUCTO'
                      AND pa.applicable_id   = l.id
                ), 0
            )                                               AS paid_qty
        FROM expedientes.linea l
        JOIN expedientes.expediente e
          ON e.id       = l.expediente_id
         AND e.oc_id    = %s::uuid
         AND e.is_active = TRUE
        LEFT JOIN finance.payment_application pa
          ON pa.applicable_id   = l.id
         AND pa.applicable_type = 'PRODUCTO'
        WHERE l.is_active = TRUE
        GROUP BY
            l.id, l.expediente_id, e.codigo, e.operating_company_id,
            l.producto_id, l.sku, l.size, l.qty, l.unit_price,
            l.unit_price_mwt, l.unit_price_client, e.moneda
        ORDER BY e.codigo, l.sku, l.size
        """
        params = [str(oc_id)]

    else:
        # exp_id scope — líneas directas del expediente
        import uuid as _uuid_mod
        try:
            _uuid_mod.UUID(str(exp_id))
        except (ValueError, AttributeError, TypeError):
            log.warning("_build_producto_applicables: exp_id UUID inválido=%r → []", exp_id)
            return []

        sql = """
        SELECT
            l.id::text                                      AS linea_id,
            l.expediente_id::text                           AS expediente_id,
            e.codigo                                        AS expediente_codigo,
            e.operating_company_id::text                    AS operating_company_id,
            l.producto_id::text                             AS producto_id,
            l.sku,
            l.size                                          AS talla,
            l.qty::integer                                  AS cantidad_total,
            l.unit_price,
            l.unit_price_mwt,
            l.unit_price_client,
            e.moneda                                        AS currency,
            NULL::text                                      AS nodo_id,
            NULL::text                                      AS nodo_codigo,
            NULL::text                                      AS transferencia_id,
            NULL::text                                      AS transferencia_codigo,
            COALESCE(
                SUM(pa.cantidad_producto) FILTER (
                    WHERE pa.applicable_type = 'PRODUCTO'
                      AND pa.applicable_id   = l.id
                ), 0
            )                                               AS paid_qty
        FROM expedientes.linea l
        JOIN expedientes.expediente e
          ON e.id        = l.expediente_id
         AND e.id        = %s::uuid
         AND e.is_active = TRUE
        LEFT JOIN finance.payment_application pa
          ON pa.applicable_id   = l.id
         AND pa.applicable_type = 'PRODUCTO'
        WHERE l.is_active = TRUE
        GROUP BY
            l.id, l.expediente_id, e.codigo, e.operating_company_id,
            l.producto_id, l.sku, l.size, l.qty, l.unit_price,
            l.unit_price_mwt, l.unit_price_client, e.moneda
        ORDER BY l.sku, l.size
        """
        params = [str(exp_id)]

    # ── Ejecutar query ────────────────────────────────────────────
    try:
        with connection.cursor() as cur:
            cur.execute(sql, params)
            cols  = [d[0] for d in cur.description]
            rows  = [dict(zip(cols, row)) for row in cur.fetchall()]
    except Exception as exc:
        log.exception("_build_producto_applicables SQL failed: %s", exc)
        return []

    # ── Serializar filas → items ──────────────────────────────────
    for row in rows:
        try:
            op_co_id = row.get("operating_company_id")
            operated = is_operated_by_mwt_fn(op_co_id)

            cantidad_total = int(row.get("cantidad_total") or 0)
            paid_qty       = int(row.get("paid_qty") or 0)
            saldo_qty      = cantidad_total - paid_qty

            # Respetar include_paid: filtrar filas con saldo agotado.
            if not include_paid and saldo_qty <= 0:
                continue

            try:
                unit_price = Decimal(str(row.get("unit_price") or 0))
            except InvalidOperation:
                unit_price = Decimal("0")

            try:
                unit_price_mwt = Decimal(str(row.get("unit_price_mwt") or 0))
            except InvalidOperation:
                unit_price_mwt = Decimal("0")

            try:
                unit_price_client = Decimal(str(row.get("unit_price_client") or 0))
            except InvalidOperation:
                unit_price_client = Decimal("0")

            subtotal_pendiente = unit_price * saldo_qty

            item = {
                "id":                  row.get("linea_id"),
                "type":                "PRODUCTO",
                "expediente_id":       row.get("expediente_id"),
                "expediente_codigo":   row.get("expediente_codigo"),
                "producto_id":         row.get("producto_id"),
                "sku":                 row.get("sku") or "",
                "nombre":              row.get("sku") or "",  # nombre = sku snapshot
                "talla":               row.get("talla") or "",
                "cantidad_total":      cantidad_total,
                "paid_qty":            paid_qty,
                "saldo_qty":           saldo_qty,
                "precio_unitario":     str(unit_price),
                "currency":            row.get("currency") or "USD",
                # Precios duales MWT: solo visibles cuando operated_by_mwt
                "precio_mwt":    str(unit_price_mwt)    if operated else None,
                "precio_cliente": str(unit_price_client) if operated else None,
                "operated_by_mwt":     operated,
                "subtotal_pendiente_usd": str(subtotal_pendiente),
                # Contexto de nodo/transferencia (null cuando scope es exp/oc)
                "nodo_id":             row.get("nodo_id") or None,
                "nodo_codigo":         row.get("nodo_codigo") or None,
                "transferencia_id":    row.get("transferencia_id") or None,
                "transferencia_codigo": row.get("transferencia_codigo") or None,
            }
            items.append(item)
        except Exception as exc:
            log.warning("_build_producto_applicables: error serializando fila: %s", exc)
            continue

    return items


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

# DRF chequea __name__ == attr_name en get_extra_actions(); el monkey-patch
# requiere ese fix-up antes del setattr para no romper el router.
_payments_dry_run.__name__ = "dry_run"
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

_payments_reconcile.__name__ = "reconcile"
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

_payments_release_credit.__name__ = "release_credit"
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

_payments_reject.__name__ = "reject"
PaymentViewSet.reject = _payments_reject


@action(detail=False, methods=["get"], url_path="select_rejection_reasons")
def _payments_select_rejection_reasons(self, request):
    return Response([
        {"codigo": r.value, "label": r.label}
        for r in PaymentRejectionReason
    ])
_payments_select_rejection_reasons.__name__ = "select_rejection_reasons"
PaymentViewSet.select_rejection_reasons = _payments_select_rejection_reasons




@action(detail=True, methods=["delete"], url_path="delete")
def _payments_delete(self, request, pk=None):
    """DELETE /api/finance/payments/{id}/delete/

    CEO-only. Soft-delete de un pago:
      · is_active = FALSE
      · estado   = REVERTIDO
      · reverted_at/reverted_by/reverted_reason poblados
    
    Si el pago estaba en CONFIRMADO_HUMANO, primero devuelve el credito
    al cliente via CreditEffectService.revert() antes de marcar REVERTIDO.
    Si ya esta REVERTIDO → 409 idempotente.
    Si esta RECHAZADO    → 409 (usar /reject para pagos rechazados).
    """
    deny = _require_ceo(request)
    if deny is not None:
        return deny

    try:
        p = Payment.objects.get(pk=pk)
    except Payment.DoesNotExist:
        return Response({"detail": "Payment no existe"}, status=404)

    # Idempotencia: ya revertido → 409 limpio (segunda llamada no rompe).
    if p.estado == PaymentStatus.REVERTIDO.value:
        return Response(
            {"detail": "Pago ya está revertido.",
             "code": PaymentErrorCode.INVALID_STATE_TRANSITION},
            status=409,
        )
    if p.estado == PaymentStatus.RECHAZADO.value:
        return Response(
            {"detail": "Pago rechazado — no se puede eliminar. Usa /reject para gestionar rechazos.",
             "code": PaymentErrorCode.INVALID_STATE_TRANSITION},
            status=409,
        )

    actor_id  = _safe_user_uuid(request)
    prev_state = p.estado
    reason    = (request.data.get("reason") or "").strip() or "Eliminado por CEO"

    from django.db import connection, transaction as db_tx

    with db_tx.atomic():
        # Si tenía crédito liberado, revertirlo PRIMERO (dentro de la tx,
        # el revert encola un Celery task vía on_commit para que el
        # recompute sea ACID con el UPDATE que sigue).
        if prev_state == PaymentStatus.CONFIRMADO_HUMANO.value:
            try:
                CreditEffectService.revert(p, actor_id=actor_id)
            except Exception as exc:  # noqa: BLE001 — fail-soft
                log.warning("[delete] revert() fallo payment=%s err=%s", p.id, exc)

        with connection.cursor() as c:
            c.execute("""
                UPDATE finance.payment
                   SET is_active      = FALSE,
                       estado         = %s,
                       reverted_at    = NOW(),
                       reverted_by    = %s::uuid,
                       reverted_reason = %s,
                       updated_at     = NOW()
                 WHERE id = %s::uuid
            """, [PaymentStatus.REVERTIDO.value,
                  str(actor_id) if actor_id else None,
                  reason[:500],
                  str(pk)])

    p.refresh_from_db()

    ActivityLogger.log(
        action="payment.deleted",
        target_type="payment", target_id=p.id,
        actor_id=actor_id,
        actor_role=(request.auth.get("role") if request.auth else None),
        payload_diff={"estado": {"from": prev_state, "to": p.estado},
                      "is_active": False},
        metadata={"reverted_reason": reason,
                  "was_credit_released": (prev_state == PaymentStatus.CONFIRMADO_HUMANO.value)},
    )
    return Response(status=204)

_payments_delete.__name__ = "delete_payment"
PaymentViewSet.delete_payment = _payments_delete


@action(detail=False, methods=["post"], url_path="analyze-evidence",
        parser_classes=[MultiPartParser, FormParser])
def _payments_analyze_evidence(self, request):
    """POST /api/finance/payments/analyze-evidence/

    Analiza un comprobante con IA SIN persistir nada (pre-creación).
    Alimenta el wizard para pre-rellenar campos antes del POST definitivo.

    Multipart form fields:
      · evidencia   (File, requerido) — PDF/PNG/JPG/WEBP ≤ 10 MB
      · monto       (decimal, opcional)
      · moneda      (str 3 chars, opcional)
      · fecha       (YYYY-MM-DD, opcional)
      · referencia  (str, opcional)
      · metodo      (str, opcional)
      · tipo_pago   (str, opcional)

    Returns 200 con el dict de AIPaymentAnalyzer.analyze_bytes().
    Returns 400 si el archivo falla validación de tipo/tamaño.
    """
    from .enums import EVIDENCE_ALLOWED_MIMES, EVIDENCE_MAX_BYTES
    from apps.ai_hub.payment_analyzer import AIPaymentAnalyzer

    # ── Validar archivo ───────────────────────────────────────
    evidencia = request.FILES.get("evidencia")
    if not evidencia:
        return Response({"detail": "Campo 'evidencia' requerido (file)."}, status=400)

    mime = (getattr(evidencia, "content_type", "") or "").lower()
    if mime not in EVIDENCE_ALLOWED_MIMES:
        return Response(
            {"detail": f"Tipo de archivo no permitido: {mime!r}. "
                       f"Permitidos: {list(EVIDENCE_ALLOWED_MIMES)}"},
            status=400,
        )
    size = getattr(evidencia, "size", 0) or 0
    if size > EVIDENCE_MAX_BYTES:
        return Response(
            {"detail": f"Archivo demasiado grande ({size} bytes). "
                       f"Máximo {EVIDENCE_MAX_BYTES // (1024*1024)} MB."},
            status=400,
        )

    # ── Leer bytes ─────────────────────────────────────────────
    evidencia.seek(0)
    file_bytes = evidencia.read()

    # ── Construir declared dict desde POST data ────────────────
    data = request.data
    declared: dict | None = None
    declared_keys = ("monto", "moneda", "fecha", "referencia", "metodo", "tipo_pago")
    if any(data.get(k) for k in declared_keys):
        declared = {k: data.get(k) for k in declared_keys if data.get(k)}

    # ── Llamar al analyzer (no persiste nada) ─────────────────
    verdict = AIPaymentAnalyzer.analyze_bytes(file_bytes, mime, declared)
    return Response(verdict)

_payments_analyze_evidence.__name__ = "analyze_evidence"
PaymentViewSet.analyze_evidence = _payments_analyze_evidence


@action(detail=False, methods=["get"], url_path="select_counterparty_types")
def _payments_select_counterparty_types(self, request):
    return Response([
        {"codigo": t.value, "label": t.label}
        for t in PaymentCounterpartyType
    ])
_payments_select_counterparty_types.__name__ = "select_counterparty_types"
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
