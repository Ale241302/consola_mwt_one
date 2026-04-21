"""
=====================================================================
MWT.ONE · apps.analytics.views
Agente responsable: [AG-BACKEND]

Read-only cross-schema aggregations. No models (raw SQL with try/except
to tolerate schemas/tables that aún no han sido creadas en el ambiente
de destino).

Endpoints:
  GET /api/analytics/dashboard_kpis/
  GET /api/analytics/cashflow/
  GET /api/analytics/aging/
  GET /api/analytics/exposicion_clientes/
  GET /api/analytics/margen_marcas/
  GET /api/analytics/by_status/
  GET /api/analytics/urgent/
=====================================================================
"""
import hashlib
import json
import logging
import uuid
from django.db import connection
from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import DashboardSnapshot, WidgetCat
from .serializers import (
    DashboardSnapshotSerializer, DashboardSnapshotListSerializer,
    WidgetCatSerializer,
)

log = logging.getLogger(__name__)


def _scope_hash(payload) -> str:
    """SHA-256 corto de un dict para scope_hash (64 hex chars)."""
    try:
        s = json.dumps(payload, sort_keys=True, default=str)
    except Exception:
        s = str(payload)
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def _fetchone(sql, params=None):
    """Ejecuta SELECT que devuelve una fila; si falla, retorna None."""
    try:
        with connection.cursor() as c:
            c.execute(sql, params or [])
            return c.fetchone()
    except Exception:
        return None


def _fetchall(sql, params=None):
    """Ejecuta SELECT que devuelve múltiples filas; si falla, retorna []."""
    try:
        with connection.cursor() as c:
            c.execute(sql, params or [])
            cols = [d[0] for d in c.description]
            return [dict(zip(cols, r)) for r in c.fetchall()]
    except Exception:
        return []


class AnalyticsViewSet(viewsets.ViewSet):
    """Ruteador de vistas analíticas agregadas."""

    # ── Dashboard KPIs ────────────────────────────────────────
    @action(detail=False, methods=["get"])
    def dashboard_kpis(self, request):
        """KPIs consolidados cross-schema.

        Shape:
        {
          active, total_cost, total_invoiced, total_paid,
          receivables, margin_pct,
          by_status: [{status, count}, ...],
          by_brand:  [{brand_id, count, total_cost, total_invoiced}, ...],
          urgent:    [{id, ref, client_id, action, urgency}, ...],
          cash_90:   [{month, invoiced, paid}, ...],
        }
        """
        out = {
            "active":         0,
            "total_cost":     0.0,
            "total_invoiced": 0.0,
            "total_paid":     0.0,
            "receivables":    0.0,
            "margin_pct":     0.0,
            "by_status":      [],
            "by_brand":       [],
            "urgent":         [],
            "cash_90":        [],
        }

        # — KPIs base sobre expedientes —
        r = _fetchone("""
            SELECT
              COUNT(*) FILTER (WHERE estado NOT IN ('CERRADO','CANCELADA')),
              COALESCE(SUM(total_cost),0),
              COALESCE(SUM(total_invoiced),0),
              COALESCE(SUM(total_paid),0),
              COALESCE(SUM(balance),0),
              AVG(CASE WHEN total_invoiced > 0
                       THEN (projected_margin / NULLIF(total_invoiced,0))
                       ELSE NULL END)
            FROM expedientes.expediente
            WHERE is_active = TRUE
        """)
        if r:
            out["active"]         = r[0] or 0
            out["total_cost"]     = float(r[1] or 0)
            out["total_invoiced"] = float(r[2] or 0)
            out["total_paid"]     = float(r[3] or 0)
            out["receivables"]    = float(r[4] or 0)
            out["margin_pct"]     = float(r[5] or 0)

        # — Conteo por estado —
        out["by_status"] = _fetchall("""
            SELECT estado AS status, COUNT(*) AS count
            FROM expedientes.expediente
            WHERE is_active = TRUE
            GROUP BY estado
            ORDER BY count DESC
        """)

        # — Agregado por marca —
        out["by_brand"] = _fetchall("""
            SELECT
              brand_id,
              COUNT(*)                        AS count,
              COALESCE(SUM(total_cost),0)     AS total_cost,
              COALESCE(SUM(total_invoiced),0) AS total_invoiced,
              COALESCE(SUM(total_paid),0)     AS total_paid
            FROM expedientes.expediente
            WHERE is_active = TRUE AND brand_id IS NOT NULL
            GROUP BY brand_id
            ORDER BY total_invoiced DESC
        """)

        # — Urgentes (bloqueados o con crédito > 70 días) —
        out["urgent"] = _fetchall("""
            SELECT id, codigo AS ref, client_id,
                   CASE WHEN is_blocked THEN 'high' ELSE 'medium' END AS urgency,
                   CASE WHEN is_blocked
                        THEN 'Resolver bloqueo de crédito'
                        ELSE 'Confirmar arribo antes del vencimiento'
                   END AS action
            FROM expedientes.expediente
            WHERE is_active = TRUE
              AND (is_blocked = TRUE OR credit_days > 70)
            ORDER BY is_blocked DESC, credit_days DESC
            LIMIT 5
        """)

        # — Cash flow 90 días (cobros) —
        out["cash_90"] = _fetchall("""
            SELECT
              to_char(date_trunc('month', fecha_vencimiento), 'Mon') AS month,
              COALESCE(SUM(monto_total),0)  AS invoiced,
              COALESCE(SUM(monto_pagado),0) AS paid
            FROM cobros.cobro
            WHERE is_active = TRUE
              AND fecha_vencimiento >= CURRENT_DATE - INTERVAL '90 days'
            GROUP BY date_trunc('month', fecha_vencimiento)
            ORDER BY date_trunc('month', fecha_vencimiento)
        """)

        return Response(out)

    # ── Cash-flow proyectado vs real por semana ───────────────
    @action(detail=False, methods=["get"])
    def cashflow(self, request):
        """Últimas 12 semanas: proyectado (vencimientos) vs real (pagos)."""
        rows = _fetchall("""
            WITH semanas AS (
              SELECT generate_series(
                date_trunc('week', CURRENT_DATE) - INTERVAL '11 weeks',
                date_trunc('week', CURRENT_DATE),
                INTERVAL '1 week'
              ) AS semana
            ),
            proy AS (
              SELECT date_trunc('week', fecha_vencimiento) AS semana,
                     COALESCE(SUM(monto_pendiente),0) AS monto
              FROM cobros.cobro
              WHERE is_active = TRUE
              GROUP BY 1
            ),
            real AS (
              SELECT date_trunc('week', fecha_acreditacion) AS semana,
                     COALESCE(SUM(monto),0) AS monto
              FROM cobros.pago
              WHERE is_active = TRUE
                AND estado IN ('VERIFICADO','LIBERADO','CONCILIADO')
                AND direccion = 'INGRESO'
                AND fecha_acreditacion IS NOT NULL
              GROUP BY 1
            )
            SELECT
              to_char(s.semana, 'YYYY-MM-DD') AS week,
              COALESCE(proy.monto, 0)         AS proyectado,
              COALESCE(real.monto, 0)         AS real
            FROM semanas s
            LEFT JOIN proy ON proy.semana = s.semana
            LEFT JOIN real ON real.semana = s.semana
            ORDER BY s.semana
        """)
        return Response(rows)

    # ── Aging buckets de cuentas por cobrar ───────────────────
    @action(detail=False, methods=["get"])
    def aging(self, request):
        """Buckets: 0-30, 31-60, 61-90, 90+ en monto_pendiente."""
        r = _fetchone("""
            SELECT
              COALESCE(SUM(CASE WHEN (CURRENT_DATE - fecha_vencimiento) <= 30 THEN monto_pendiente END),0),
              COALESCE(SUM(CASE WHEN (CURRENT_DATE - fecha_vencimiento) BETWEEN 31 AND 60 THEN monto_pendiente END),0),
              COALESCE(SUM(CASE WHEN (CURRENT_DATE - fecha_vencimiento) BETWEEN 61 AND 90 THEN monto_pendiente END),0),
              COALESCE(SUM(CASE WHEN (CURRENT_DATE - fecha_vencimiento) > 90 THEN monto_pendiente END),0),
              COALESCE(SUM(monto_pendiente),0)
            FROM cobros.cobro
            WHERE is_active = TRUE AND monto_pendiente > 0
        """)
        if not r:
            return Response({
                "bucket_0_30": 0, "bucket_31_60": 0,
                "bucket_61_90": 0, "bucket_90_plus": 0, "total": 0,
            })
        return Response({
            "bucket_0_30":    float(r[0]),
            "bucket_31_60":   float(r[1]),
            "bucket_61_90":   float(r[2]),
            "bucket_90_plus": float(r[3]),
            "total":          float(r[4]),
        })

    # ── Exposición por cliente ────────────────────────────────
    @action(detail=False, methods=["get"])
    def exposicion_clientes(self, request):
        """Saldo pendiente agrupado por client_id, orden DESC."""
        rows = _fetchall("""
            SELECT
              client_id,
              COUNT(*)                                AS cobros_abiertos,
              COALESCE(SUM(monto_total),0)            AS monto_total,
              COALESCE(SUM(monto_pagado),0)           AS monto_pagado,
              COALESCE(SUM(monto_pendiente),0)        AS monto_pendiente,
              COUNT(*) FILTER (WHERE (CURRENT_DATE - fecha_vencimiento) > 30
                               AND monto_pendiente > 0) AS vencidos_30,
              COUNT(*) FILTER (WHERE (CURRENT_DATE - fecha_vencimiento) > 60
                               AND monto_pendiente > 0) AS vencidos_60
            FROM cobros.cobro
            WHERE is_active = TRUE AND client_id IS NOT NULL
            GROUP BY client_id
            ORDER BY monto_pendiente DESC
            LIMIT 20
        """)
        return Response(rows)

    # ── Margen por marca ──────────────────────────────────────
    @action(detail=False, methods=["get"])
    def margen_marcas(self, request):
        """Margen proyectado vs real agrupado por brand_id."""
        rows = _fetchall("""
            SELECT
              brand_id,
              COUNT(*)                                    AS expedientes,
              COALESCE(SUM(total_cost),0)                 AS total_cost,
              COALESCE(SUM(total_invoiced),0)             AS total_invoiced,
              COALESCE(SUM(projected_margin),0)           AS projected_margin,
              COALESCE(SUM(real_margin),0)                AS real_margin,
              AVG(CASE WHEN total_invoiced > 0
                       THEN (projected_margin / NULLIF(total_invoiced,0))
                       ELSE NULL END)                     AS margin_pct_avg
            FROM expedientes.expediente
            WHERE is_active = TRUE AND brand_id IS NOT NULL
            GROUP BY brand_id
            ORDER BY projected_margin DESC
        """)
        return Response(rows)

    # ── By status (conteo + monto) ───────────────────────────
    @action(detail=False, methods=["get"])
    def by_status(self, request):
        rows = _fetchall("""
            SELECT
              estado                       AS status,
              COUNT(*)                     AS count,
              COALESCE(SUM(total_invoiced),0) AS total_invoiced,
              COALESCE(SUM(balance),0)     AS balance
            FROM expedientes.expediente
            WHERE is_active = TRUE
            GROUP BY estado
            ORDER BY count DESC
        """)
        return Response(rows)

    # ── Urgent standalone ────────────────────────────────────
    @action(detail=False, methods=["get"])
    def urgent(self, request):
        rows = _fetchall("""
            SELECT id, codigo AS ref, client_id, brand_id, credit_days,
                   is_blocked,
                   CASE WHEN is_blocked THEN 'high' ELSE 'medium' END AS urgency,
                   CASE WHEN is_blocked
                        THEN 'Resolver bloqueo de crédito'
                        ELSE 'Confirmar arribo antes del vencimiento'
                   END AS action
            FROM expedientes.expediente
            WHERE is_active = TRUE
              AND (is_blocked = TRUE OR credit_days > 70)
            ORDER BY is_blocked DESC, credit_days DESC
            LIMIT 20
        """)
        return Response(rows)


# ══════════════════════════════════════════════════════════════
# DashboardSnapshotViewSet — CRUD con idempotencia
# ══════════════════════════════════════════════════════════════
class DashboardSnapshotViewSet(viewsets.ModelViewSet):
    """CRUD sobre `dashboard.snapshot`.

    · Idempotente por `idempotence_token` (early-return).
    · `scope_hash` se deriva automáticamente del payload (filters/user_id)
      si no se provee explícitamente.
    · Filtros de listado: user_id, snapshot_type, is_pinned, generated_by,
      period_start/end.
    """
    queryset = DashboardSnapshot.objects.filter(is_active=True)
    serializer_class = DashboardSnapshotSerializer

    def get_serializer_class(self):
        if self.action == "list":
            return DashboardSnapshotListSerializer
        return DashboardSnapshotSerializer

    def get_queryset(self):
        qs = DashboardSnapshot.objects.filter(is_active=True)
        user_id = self.request.query_params.get("user_id")
        stype = self.request.query_params.get("snapshot_type")
        pinned = self.request.query_params.get("is_pinned")
        gen_by = self.request.query_params.get("generated_by")
        p_start = self.request.query_params.get("period_start")
        p_end = self.request.query_params.get("period_end")
        scope_hash = self.request.query_params.get("scope_hash")
        if user_id:
            qs = qs.filter(user_id=user_id)
        if stype:
            qs = qs.filter(snapshot_type=stype)
        if pinned is not None:
            qs = qs.filter(is_pinned=(pinned.lower() in ("1", "true", "yes")))
        if gen_by:
            qs = qs.filter(generated_by=gen_by)
        if p_start:
            qs = qs.filter(period_start__gte=p_start)
        if p_end:
            qs = qs.filter(period_end__lte=p_end)
        if scope_hash:
            qs = qs.filter(scope_hash=scope_hash)
        return qs.order_by("-is_pinned", "-created_at")

    def create(self, request, *args, **kwargs):
        data = request.data.copy() if hasattr(request.data, "copy") else dict(request.data)
        token = data.get("idempotence_token")
        if token:
            existing = DashboardSnapshot.objects.filter(
                idempotence_token=token, is_active=True).first()
            if existing:
                return Response(
                    DashboardSnapshotSerializer(existing).data,
                    status=status.HTTP_200_OK,
                    headers={"X-Idempotent-Replay": "true"},
                )
        if not data.get("id"):
            data["id"] = str(uuid.uuid4())
        # scope_hash auto-derivación
        if not data.get("scope_hash"):
            scope_payload = {
                "user_id":       data.get("user_id"),
                "snapshot_type": data.get("snapshot_type"),
                "period_start":  data.get("period_start"),
                "period_end":    data.get("period_end"),
                "filters":       (data.get("snapshot_data") or {}).get("filters"),
            }
            data["scope_hash"] = _scope_hash(scope_payload)
        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    # ── POST /api/dashboard-snapshots/<id>/pin/ ───────────────
    @action(detail=True, methods=["post"])
    def pin(self, request, pk=None):
        try:
            snap = DashboardSnapshot.objects.get(pk=pk, is_active=True)
        except DashboardSnapshot.DoesNotExist:
            return Response({"detail": "Snapshot no encontrado."},
                            status=status.HTTP_404_NOT_FOUND)
        snap.is_pinned = True
        snap.save(update_fields=["is_pinned", "updated_at"])
        return Response({"ok": True, "id": str(snap.id), "is_pinned": True})

    # ── POST /api/dashboard-snapshots/<id>/unpin/ ─────────────
    @action(detail=True, methods=["post"])
    def unpin(self, request, pk=None):
        try:
            snap = DashboardSnapshot.objects.get(pk=pk, is_active=True)
        except DashboardSnapshot.DoesNotExist:
            return Response({"detail": "Snapshot no encontrado."},
                            status=status.HTTP_404_NOT_FOUND)
        snap.is_pinned = False
        snap.save(update_fields=["is_pinned", "updated_at"])
        return Response({"ok": True, "id": str(snap.id), "is_pinned": False})

    # ── GET /api/dashboard-snapshots/latest/?user_id=... ──────
    @action(detail=False, methods=["get"])
    def latest(self, request):
        """Último snapshot no-expirado para un (user_id, snapshot_type)."""
        user_id = request.query_params.get("user_id")
        stype = request.query_params.get("snapshot_type", "preferences")
        qs = DashboardSnapshot.objects.filter(is_active=True, snapshot_type=stype)
        if user_id:
            qs = qs.filter(user_id=user_id)
        # filtrar expirados
        now = timezone.now()
        qs = qs.filter(models_Q_or_null(now))
        snap = qs.order_by("-created_at").first()
        if not snap:
            return Response({"detail": "No hay snapshots."},
                            status=status.HTTP_404_NOT_FOUND)
        return Response(DashboardSnapshotSerializer(snap).data)

    # ── POST /api/dashboard-snapshots/purge_expired/ ──────────
    @action(detail=False, methods=["post"], url_path="purge_expired")
    def purge_expired(self, request):
        """Soft-delete de snapshots con expires_at < NOW()."""
        now = timezone.now()
        updated = 0
        try:
            with connection.cursor() as c:
                c.execute("""
                    UPDATE dashboard.snapshot
                    SET is_active = FALSE, updated_at = NOW()
                    WHERE is_active = TRUE
                      AND expires_at IS NOT NULL
                      AND expires_at < %s
                """, [now])
                updated = c.rowcount or 0
        except Exception as e:
            log.warning("purge_expired falló: %s", e)
            return Response({"detail": str(e)},
                            status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        return Response({"ok": True, "purged": updated})


def models_Q_or_null(now):
    """Helper: expires_at IS NULL OR expires_at > now."""
    from django.db.models import Q
    return Q(expires_at__isnull=True) | Q(expires_at__gt=now)


# ══════════════════════════════════════════════════════════════
# WidgetCatViewSet — catálogo cerrado, read-only
# ══════════════════════════════════════════════════════════════
class WidgetCatViewSet(viewsets.ReadOnlyModelViewSet):
    """Catálogo de widgets del dashboard (read-only, seed en 94b SQL)."""
    queryset = WidgetCat.objects.filter(is_active=True)
    serializer_class = WidgetCatSerializer

    def get_queryset(self):
        qs = WidgetCat.objects.filter(is_active=True)
        category = self.request.query_params.get("category")
        min_role = self.request.query_params.get("min_role")
        if category:
            qs = qs.filter(category=category)
        if min_role:
            qs = qs.filter(min_role=min_role)
        return qs.order_by("orden", "codigo")
