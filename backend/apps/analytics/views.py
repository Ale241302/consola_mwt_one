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
from django.db import connection
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response


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
