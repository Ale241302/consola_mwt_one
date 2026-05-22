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
  GET /api/analytics/credit_clock_avg/           (Sprint widgets 2026-05-20)
  GET /api/analytics/r1_correction_ratio/
  GET /api/analytics/by_status_by_brand/
  GET /api/analytics/inventory_coverage_by_node/
  GET /api/analytics/top_skus_margen/
  GET /api/analytics/expediente_margin_scatter/
  GET /api/analytics/tacos_fba_us/               (Sprint dashboard 2026-05-21)
=====================================================================
"""
import hashlib
import json
import logging
import uuid
from django.db import connection
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.cache import never_cache
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
    """Ejecuta SELECT que devuelve una fila; si falla, loguea y retorna None.

    Sprint 2026-05-20 · Antes este helper tragaba TODOS los errores con
    `except Exception: return None`, lo que hacía indistinguible una BD
    sin datos de una query rota. Causó que el dashboard mostrara
    EmptyState honesto durante horas mientras la causa real era un
    InFailedSqlTransaction o un statement_timeout. Ahora logueamos con
    contexto (primeros 200 chars del SQL) y mantenemos el fallback
    silencioso para no tumbar la respuesta HTTP.
    """
    try:
        with connection.cursor() as c:
            c.execute(sql, params or [])
            return c.fetchone()
    except Exception as exc:
        log.exception(
            "[analytics._fetchone] SQL failed (%s): %s",
            type(exc).__name__, (sql or "").strip()[:200],
        )
        # Si la transacción quedó en estado de fallo, hay que abortarla
        # para que las queries subsiguientes del mismo request no caigan
        # también con InFailedSqlTransaction.
        try:
            connection.rollback()
        except Exception:
            pass
        return None


def _fetchall(sql, params=None):
    """Ejecuta SELECT que devuelve múltiples filas; si falla, loguea y retorna []."""
    try:
        with connection.cursor() as c:
            c.execute(sql, params or [])
            cols = [d[0] for d in c.description]
            return [dict(zip(cols, r)) for r in c.fetchall()]
    except Exception as exc:
        log.exception(
            "[analytics._fetchall] SQL failed (%s): %s",
            type(exc).__name__, (sql or "").strip()[:200],
        )
        try:
            connection.rollback()
        except Exception:
            pass
        return []


@method_decorator(never_cache, name="dispatch")
class AnalyticsViewSet(viewsets.ViewSet):
    """Ruteador de vistas analíticas agregadas.

    `@never_cache` aplicado a nivel de clase para que TODAS las respuestas
    lleven headers `Cache-Control: max-age=0, no-cache, no-store,
    must-revalidate, private` + `Expires: 0` + `Pragma: no-cache`.
    Sin esto, Cloudflare/CDN/browser puede cachear una respuesta vacía
    (ej. cuando había filtros que devolvían []) y servirla durante el TTL
    incluso después de que el backend ya devuelve datos correctos.
    """

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
        # NB · `margin_pct` ahora es el MARGEN PROYECTADO PONDERADO POR COSTO:
        #   weighted_margin = Σ(projected_margin × total_cost) / Σ(total_cost)
        # Es decir: cuánto de cada USD invertido en costos vuelve como
        # margen proyectado, ponderando por tamaño del expediente. Funciona
        # incluso cuando `total_invoiced` = 0 (todavía no se factura), siempre
        # que existan expedientes activos con costo y projected_margin
        # poblado por el orquestador comercial.
        r = _fetchone("""
            SELECT
              COUNT(*) FILTER (WHERE estado NOT IN ('CERRADO','CANCELADA')),
              COALESCE(SUM(total_cost),0),
              COALESCE(SUM(total_invoiced),0),
              COALESCE(SUM(total_paid),0),
              COALESCE(SUM(balance),0),
              CASE
                WHEN COALESCE(SUM(total_cost), 0) > 0
                THEN COALESCE(SUM(projected_margin * total_cost), 0)
                     / NULLIF(SUM(total_cost), 0)
                ELSE NULL
              END
            FROM expedientes.expediente
            WHERE is_active = TRUE
        """)
        if r:
            out["active"]         = r[0] or 0
            out["total_cost"]     = float(r[1] or 0)
            out["total_invoiced"] = float(r[2] or 0)
            out["total_paid"]     = float(r[3] or 0)
            out["receivables"]    = float(r[4] or 0)
            out["margin_pct"]     = float(r[5]) if r[5] is not None else 0.0

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
        """Top clientes por exposición (saldo pendiente).

        Fuente DUAL (Sprint 2026-05-20):
          1. Primero intenta `cobros.cobro` (modelo formal de cobranza).
          2. Si está vacía, deriva de `expedientes.expediente` + líneas.
             Esto refleja la realidad operativa: aunque no haya cobros
             formalizados, los expedientes activos con líneas SÍ
             representan exposición real al cliente.

        Cálculo desde líneas:
          monto_total     = Σ qty × precio_cliente (todas las líneas activas)
          monto_pagado    = 0 (no hay flujo de pagos contra líneas todavía)
          monto_pendiente = monto_total
          cobros_abiertos = # expedientes activos del cliente

        Cuando exista flujo formal de cobranza y `cobros.cobro` se
        popule automáticamente al emitir factura, este endpoint
        prioriza esa fuente.
        """
        # Fuente 1: cobros formales
        rows_cobros = _fetchall("""
            WITH agg AS (
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
              WHERE is_active = TRUE
                AND client_id IS NOT NULL
                AND monto_pendiente > 0
              GROUP BY client_id
            )
            SELECT
              a.client_id,
              COALESCE(c.nombre_comercial, c.razon_social) AS client_name,
              c.pais_iso2                                  AS country,
              a.cobros_abiertos,
              a.monto_total::float                         AS monto_total,
              a.monto_pagado::float                        AS monto_pagado,
              a.monto_pendiente::float                     AS monto_pendiente,
              a.vencidos_30,
              a.vencidos_60
            FROM agg a
            LEFT JOIN clientes.cliente c ON c.id = a.client_id
            ORDER BY a.monto_pendiente DESC
            LIMIT 20
        """)
        if rows_cobros:
            return Response(rows_cobros)

        # Fuente 2 (fallback): derivar de líneas reales.
        rows_lineas = _fetchall("""
            SELECT
              e.client_id,
              COALESCE(c.nombre_comercial, c.razon_social)        AS client_name,
              c.pais_iso2                                         AS country,
              COUNT(DISTINCT e.id)                                AS cobros_abiertos,
              COALESCE(SUM(
                l.qty * COALESCE(NULLIF(l.unit_price_client,0), l.unit_price, 0)
              ), 0)::float                                        AS monto_total,
              0::float                                            AS monto_pagado,
              COALESCE(SUM(
                l.qty * COALESCE(NULLIF(l.unit_price_client,0), l.unit_price, 0)
              ), 0)::float                                        AS monto_pendiente,
              0                                                   AS vencidos_30,
              0                                                   AS vencidos_60
            FROM expedientes.expediente e
            JOIN expedientes.linea     l ON l.expediente_id = e.id
            LEFT JOIN clientes.cliente c  ON c.id = e.client_id
            WHERE e.is_active = TRUE
              AND l.is_active = TRUE
              AND e.client_id IS NOT NULL
            GROUP BY e.client_id, c.nombre_comercial, c.razon_social, c.pais_iso2
            HAVING SUM(
              l.qty * COALESCE(NULLIF(l.unit_price_client,0), l.unit_price, 0)
            ) > 0
            ORDER BY monto_pendiente DESC
            LIMIT 20
        """)
        return Response(rows_lineas)

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
        """Expedientes urgentes con info enriquecida para la UI.

        Devuelve por cada expediente:
          · id, ref (expediente.codigo · "EXP-XXXX")
          · oc_codigo  (número de OC del cliente — visible para CLIENT B2B)
          · proforma   (número de proforma MWT — visible para ADMIN/CEO)
          · client_id, client_name (razon_social, fallback nombre_comercial)
          · brand_id,  brand_name  (marca.nombre)
          · credit_days, is_blocked, urgency, action

        El frontend elige qué número mostrar según useRole().isAdmin:
          · admin → proforma
          · client → oc_codigo

        Mantiene `ref = expediente.codigo` por compatibilidad — si los
        otros campos vienen null, la UI degrada a `ref`.
        """
        rows = _fetchall("""
            SELECT
              e.id,
              e.codigo                                       AS ref,
              o.codigo                                       AS oc_codigo,
              o.proforma                                     AS proforma,
              e.client_id,
              COALESCE(cli.nombre_comercial, cli.razon_social) AS client_name,
              e.brand_id,
              m.nombre                                       AS brand_name,
              e.credit_days,
              e.is_blocked,
              CASE WHEN e.is_blocked THEN 'high' ELSE 'medium' END AS urgency,
              CASE WHEN e.is_blocked
                   THEN 'Resolver bloqueo de crédito'
                   ELSE 'Confirmar arribo antes del vencimiento'
              END                                            AS action
            FROM expedientes.expediente e
            LEFT JOIN expedientes.oc       o   ON o.id = e.oc_id
            LEFT JOIN clientes.cliente     cli ON cli.id = e.client_id
            LEFT JOIN brands.marca         m   ON m.id   = e.brand_id
            WHERE e.is_active = TRUE
              AND (e.is_blocked = TRUE OR e.credit_days > 70)
            ORDER BY e.is_blocked DESC, e.credit_days DESC
            LIMIT 20
        """)
        return Response(rows)

    # ══════════════════════════════════════════════════════════
    # Sprint 2026-05-20 · 6 widgets nuevos del dashboard rediseñado.
    # Notas globales:
    #   · Read-only, JWT vía DEFAULT_PERMISSION_CLASSES (settings.py).
    #   · Raw SQL cross-schema (estilo consistente con el resto del
    #     archivo; los modelos relevantes son `managed=False`).
    #   · _fetchall/_fetchone retornan [] / None si la tabla o columna
    #     no existe en el ambiente de destino.
    #   · NO se inventan columnas: cuando la BD real no expone el dato
    #     pedido (ej. `corrections_count`, `closed_at`,
    #     `dias_hasta_pago`) se documenta en el docstring del endpoint
    #     y se devuelve estado vacío honesto.
    # ══════════════════════════════════════════════════════════

    # ── Credit clock: días promedio hasta pago ────────────────
    @action(detail=False, methods=["get"], url_path="credit_clock_avg")
    def credit_clock_avg(self, request):
        """AVG / p50 / p90 de días entre emisión y pago, últimos 90d.

        Shape:
          { avg_days, p50, p90, n_files, period_days }

        Fuente: cobros.cobro + cobros.pago. Por expediente cerrado en
        los últimos 90 días, calculamos la diferencia en días entre la
        creación del cobro (created_at) y la fecha de acreditación más
        reciente de un pago verificado/conciliado.

        ⚠ No existe columna `dias_hasta_pago` ni `fecha_cierre` en
        `expedientes.expediente`. Se aproxima vía el ledger de pagos.
        Si el ambiente no tiene cobros.pago o no hay datos, retorna
        `avg_days/p50/p90 = null, n_files = 0`.
        """
        period_days = 90
        empty = {
            "avg_days":    None,
            "p50":         None,
            "p90":         None,
            "n_files":     0,
            "period_days": period_days,
        }
        r = _fetchone("""
            WITH paid AS (
              SELECT
                c.expediente_id,
                EXTRACT(DAY FROM (MAX(p.fecha_acreditacion)::timestamp
                                  - MIN(c.created_at)::timestamp)) AS dias
              FROM cobros.cobro  c
              JOIN cobros.pago   p ON p.cobro_id = c.id
              WHERE c.is_active = TRUE
                AND p.is_active = TRUE
                AND p.direccion = 'INGRESO'
                AND p.estado IN ('VERIFICADO','LIBERADO','CONCILIADO')
                AND p.fecha_acreditacion IS NOT NULL
                AND p.fecha_acreditacion >= CURRENT_DATE - INTERVAL '90 days'
                AND c.expediente_id IS NOT NULL
              GROUP BY c.expediente_id
              HAVING SUM(c.monto_pendiente) <= 0
            )
            SELECT
              AVG(dias)::float                                       AS avg_days,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY dias)::float AS p50,
              percentile_cont(0.9) WITHIN GROUP (ORDER BY dias)::float AS p90,
              COUNT(*)                                               AS n_files
            FROM paid
        """)
        if not r:
            return Response(empty)
        avg_days, p50, p90, n_files = r
        if not n_files:
            return Response(empty)
        return Response({
            "avg_days":    float(avg_days) if avg_days is not None else None,
            "p50":         float(p50)      if p50      is not None else None,
            "p90":         float(p90)      if p90      is not None else None,
            "n_files":     int(n_files),
            "period_days": period_days,
        })

    # ── Ratio de expedientes con corrección R1+ ───────────────
    @action(detail=False, methods=["get"], url_path="r1_correction_ratio")
    def r1_correction_ratio(self, request):
        """count(expedientes con corrección R1+) / total, últimos 90d.

        Shape:
          { ratio, with_corrections, total, period_days }

        Fuente: `expedientes.expediente.corrections_count`
        (creada por backend/sql/D2_expedientes_corrections_count.sql).
        Si la migración D2 no se ha aplicado en el ambiente, el SELECT
        cae al fallback sobre `cost_corrections` BOOLEAN, que es lo más
        cercano que existía antes del sprint.

        El campo `_pending` se devuelve únicamente si AMBAS columnas
        son inaccesibles (lo que implica que el schema todavía está sin
        migrar) — así el frontend mostrar empty state honesto.
        """
        period_days = 90
        out = {
            "ratio":            None,
            "with_corrections": None,
            "total":            0,
            "period_days":      period_days,
        }
        # Primer intento: nueva columna corrections_count
        r = _fetchone("""
            SELECT
              COUNT(*)                                              AS total,
              COUNT(*) FILTER (WHERE corrections_count >= 1)        AS with_corr
            FROM expedientes.expediente
            WHERE is_active = TRUE
              AND created_at >= CURRENT_DATE - INTERVAL '90 days'
        """)
        if r is None:
            # Fallback al boolean cost_corrections (pre-D2)
            r = _fetchone("""
                SELECT
                  COUNT(*)                                          AS total,
                  COUNT(*) FILTER (WHERE cost_corrections = TRUE)   AS with_corr
                FROM expedientes.expediente
                WHERE is_active = TRUE
                  AND created_at >= CURRENT_DATE - INTERVAL '90 days'
            """)
            if r is None:
                out["_pending"] = (
                    "missing column expedientes.expediente.corrections_count "
                    "and cost_corrections (run sql/D2)"
                )
                return Response(out)

        total, with_corr = int(r[0] or 0), int(r[1] or 0)
        out["total"]            = total
        out["with_corrections"] = with_corr
        out["ratio"]            = (with_corr / total) if total > 0 else None
        return Response(out)

    # ── TACoS Amazon FBA-US (ad spend / total sales) ─────────
    @action(detail=False, methods=["get"], url_path="tacos_fba_us")
    def tacos_fba_us(self, request):
        """TACoS = ad_spend / total_sales (incluye ventas orgánicas).

        Ventana: últimos 30 días móviles. Solo cuentas activas con
        marketplace = 'US' (Amazon US, FBA).

        Shape:
          {
            tacos_pct:    float | null,   # razón 0..1 (ej. 0.085 = 8.5%)
            period_days:  int,
            spend_usd:    float,
            sales_usd:    float,
            n_days:       int,            # días con datos en la ventana
          }

        Fuente: tablas amazon_ads.spend_daily +
        amazon_ads.attributed_sales_daily (creadas por sql/D3). Si el
        schema aún no existe en el ambiente, _fetchone() retorna None y
        respondemos estado empty con `_pending` para que el frontend
        muestre hint honesto.
        """
        period_days = 30
        empty = {
            "tacos_pct":   None,
            "period_days": period_days,
            "spend_usd":   0.0,
            "sales_usd":   0.0,
            "n_days":      0,
        }
        r = _fetchone("""
            WITH spend AS (
              SELECT COALESCE(SUM(s.spend_usd), 0)::float AS total_spend,
                     COUNT(DISTINCT s.date)               AS days_spend
                FROM amazon_ads.spend_daily s
                JOIN amazon_ads.account    a ON a.id = s.account_id
               WHERE a.is_active   = TRUE
                 AND a.marketplace = 'US'
                 AND s.is_active   = TRUE
                 AND s.date >= CURRENT_DATE - INTERVAL '30 days'
            ),
            sales AS (
              SELECT COALESCE(SUM(x.total_sales_usd), 0)::float AS total_sales,
                     COUNT(DISTINCT x.date)                     AS days_sales
                FROM amazon_ads.attributed_sales_daily x
                JOIN amazon_ads.account                a ON a.id = x.account_id
               WHERE a.is_active   = TRUE
                 AND a.marketplace = 'US'
                 AND x.is_active   = TRUE
                 AND x.date >= CURRENT_DATE - INTERVAL '30 days'
            )
            SELECT spend.total_spend,
                   sales.total_sales,
                   GREATEST(spend.days_spend, sales.days_sales) AS n_days
              FROM spend, sales
        """)
        if r is None:
            # Schema amazon_ads no existe todavía (sql/D3 no aplicado)
            empty["_pending"] = "amazon_ads schema missing (run sql/D3)"
            return Response(empty)

        spend, sales, n_days = (
            float(r[0] or 0),
            float(r[1] or 0),
            int(r[2] or 0),
        )
        tacos = (spend / sales) if sales > 0 else None
        return Response({
            "tacos_pct":   float(tacos) if tacos is not None else None,
            "period_days": period_days,
            "spend_usd":   spend,
            "sales_usd":   sales,
            "n_days":      n_days,
        })

        # ── Crosstab status × brand_id ────────────────────────────
    @action(detail=False, methods=["get"], url_path="by_status_by_brand")
    def by_status_by_brand(self, request):
        """Crosstab estado × brand_id.

        Shape:
          [{ brand_id, status, count, total_invoiced }]
        """
        rows = _fetchall("""
            SELECT
              brand_id,
              estado                          AS status,
              COUNT(*)                        AS count,
              COALESCE(SUM(total_invoiced),0) AS total_invoiced
            FROM expedientes.expediente
            WHERE is_active = TRUE
              AND brand_id IS NOT NULL
            GROUP BY brand_id, estado
            ORDER BY brand_id, count DESC
        """)
        return Response(rows)

    # ── Cobertura de inventario por nodo ──────────────────────
    @action(detail=False, methods=["get"], url_path="inventory_coverage_by_node")
    def inventory_coverage_by_node(self, request):
        """Cobertura de stock por nodo activo.

        Shape:
          [{ node_id, node_name, total_units, velocity_30d,
             coverage_days, status }]

        · total_units    = SUM(stock.cantidad_disponible) por nodo.
        · velocity_30d   = movimientos de salida (tipo_movimiento_cat.direccion='-')
                           de los últimos 30 días / 30.
        · coverage_days  = total_units / velocity_30d (null si velocity=0).
        · status         = 'critical' (<21d) / 'warning' (21-45d) / 'ok' (>45d) /
                           'unknown' si velocity_30d es null o 0.

        Si no existen tablas `inventario.movimiento` o
        `inventario.tipo_movimiento_cat`, velocity / coverage quedan en null.

        Nota: realiza una sola query con LEFT JOIN agregado por nodo,
        evitando N+1 sobre nodos.
        """
        rows = _fetchall("""
            WITH stock_por_nodo AS (
              SELECT
                s.nodo_id,
                COALESCE(SUM(s.cantidad_disponible),0)::float AS total_units
              FROM inventario.stock s
              WHERE s.is_active = TRUE
              GROUP BY s.nodo_id
            ),
            outs_30d AS (
              SELECT
                m.nodo_origen_id AS nodo_id,
                COUNT(*)         AS movs
              FROM inventario.movimiento     m
              JOIN inventario.tipo_movimiento_cat t
                   ON t.codigo = m.tipo
              WHERE m.is_active = TRUE
                AND t.direccion = '-'
                AND m.nodo_origen_id IS NOT NULL
                AND m.created_at >= CURRENT_DATE - INTERVAL '30 days'
              GROUP BY m.nodo_origen_id
            )
            SELECT
              n.id                                            AS node_id,
              n.nombre                                        AS node_name,
              COALESCE(sp.total_units, 0)::float              AS total_units,
              CASE WHEN o.movs IS NULL THEN NULL
                   ELSE (o.movs::float / 30.0) END            AS velocity_30d,
              CASE WHEN o.movs IS NULL OR o.movs = 0 THEN NULL
                   ELSE COALESCE(sp.total_units, 0)::float
                        / (o.movs::float / 30.0) END          AS coverage_days
            FROM nodos.nodo n
            LEFT JOIN stock_por_nodo sp ON sp.nodo_id = n.id
            LEFT JOIN outs_30d       o  ON o.nodo_id  = n.id
            WHERE n.is_active = TRUE
            ORDER BY n.nombre
        """)
        out = []
        for r in rows:
            cov = r.get("coverage_days")
            if cov is None:
                status_lbl = "unknown"
            elif cov < 21:
                status_lbl = "critical"
            elif cov <= 45:
                status_lbl = "warning"
            else:
                status_lbl = "ok"
            r["status"] = status_lbl
            out.append(r)
        return Response(out)

    # ── Top SKUs por margen ───────────────────────────────────
    @action(detail=False, methods=["get"], url_path="top_skus_margen")
    def top_skus_margen(self, request):
        """Top 10 SKUs por margen USD de líneas activas.

        Sprint 2026-05-20 v3 · Query partida en DOS pasos:
          Antes una sola query con `LEFT JOIN productos.producto` causaba
          que `_fetchall` cayera silenciosamente (probablemente search_path
          o cast falla cuando el endpoint corre vía HTTP pero NO cuando
          corre vía management command). El diag CLI mostraba 8 SKUs pero
          el endpoint HTTP devolvía [].
          Solución: query 1 simple (sólo expedientes.linea, sin JOIN externo)
          + query 2 separada para enriquecer brand_id desde productos.producto.
          Si la query 2 falla, brand_id queda NULL — el frontend igual
          muestra el SKU y los números (no rompe la UI).

        Modelo de precios (C0_expedientes_operating_company.sql):
          costo_efectivo  = COALESCE(NULLIF(unit_price_mwt,    0), unit_cost,  0)
          precio_efectivo = COALESCE(NULLIF(unit_price_client, 0), unit_price, 0)

        · Sin filtro temporal: muestra TODOS los SKUs activos con precio > 0.
        · margin_usd = SUM((precio_efectivo - costo_efectivo) × qty).
        """
        # PASO 1: query simple sin JOIN externo (idéntica a la del diag CLI
        # que confirmamos funciona en producción).
        sql_main = """
            WITH lineas_efectivas AS (
              SELECT
                l.sku,
                l.producto_id,
                l.qty,
                COALESCE(NULLIF(l.unit_price_mwt,    0), l.unit_cost,  0) AS costo_efectivo,
                COALESCE(NULLIF(l.unit_price_client, 0), l.unit_price, 0) AS precio_efectivo
              FROM expedientes.linea     l
              JOIN expedientes.expediente e ON e.id = l.expediente_id
              WHERE l.is_active = TRUE
                AND e.is_active = TRUE
                AND l.sku IS NOT NULL
            )
            SELECT
              le.sku                                                        AS sku,
              (ARRAY_AGG(le.producto_id) FILTER (WHERE le.producto_id IS NOT NULL))[1]::text AS producto_id_str,
              COALESCE(SUM(le.qty), 0)::float                               AS units_sold_90d,
              COALESCE(SUM(le.qty * le.precio_efectivo), 0)::float          AS revenue_usd,
              COALESCE(SUM(le.qty * (le.precio_efectivo - le.costo_efectivo)), 0)::float
                                                                            AS margin_usd,
              CASE WHEN SUM(le.qty * le.precio_efectivo) > 0
                   THEN (SUM(le.qty * (le.precio_efectivo - le.costo_efectivo))
                         / NULLIF(SUM(le.qty * le.precio_efectivo), 0))::float
                   ELSE NULL END                                            AS margin_pct
            FROM lineas_efectivas le
            WHERE le.precio_efectivo > 0
            GROUP BY le.sku
            ORDER BY margin_usd DESC NULLS LAST
            LIMIT 10
        """
        rows = _fetchall(sql_main)
        log.info("[top_skus_margen] paso 1: %d SKUs", len(rows))

        # PASO 2: enriquecer con nombre de producto y brand_id.
        # Best-effort: si la tabla productos.producto no responde,
        # el endpoint igual devuelve los SKUs con datos numéricos.
        producto_ids = [r["producto_id_str"] for r in rows if r.get("producto_id_str")]
        producto_lookup = {}
        if producto_ids:
            try:
                placeholders = ",".join(["%s"] * len(producto_ids))
                lookup_rows = _fetchall(
                    f"SELECT id::text AS id, nombre, marca_id::text AS marca_id "
                    f"FROM productos.producto WHERE id::text IN ({placeholders})",
                    producto_ids,
                )
                for lr in lookup_rows:
                    producto_lookup[lr["id"]] = {
                        "nombre":   lr.get("nombre"),
                        "marca_id": lr.get("marca_id"),
                    }
                log.info("[top_skus_margen] paso 2: %d productos enriquecidos", len(lookup_rows))
            except Exception as exc:  # noqa: BLE001
                log.warning("[top_skus_margen] enriquecimiento falló: %s", exc)

        # Salida final con shape esperado por el frontend.
        out = []
        for r in rows:
            pid = r.get("producto_id_str")
            enriched = producto_lookup.get(pid, {}) if pid else {}
            out.append({
                "sku":            r["sku"],
                "product_name":   enriched.get("nombre"),
                "brand_id":       enriched.get("marca_id"),
                "units_sold_90d": r["units_sold_90d"],
                "revenue_usd":    r["revenue_usd"],
                "margin_usd":     r["margin_usd"],
                "margin_pct":     r["margin_pct"],
            })

        log.info("[top_skus_margen] FINAL: %d filas devueltas al cliente", len(out))
        return Response(out)

    # ── Scatter de margen proyectado vs real por expediente ───
    @action(detail=False, methods=["get"], url_path="expediente_margin_scatter")
    def expediente_margin_scatter(self, request):
        """Scatter plot: un punto por expediente con líneas en últimos 365d.

        Shape:
          [{ id, ref, client_id, brand_id,
             projected_margin, real_margin,
             total_invoiced, closed_at }]

        Sprint 2026-05-20 · Cambio de fuente:
          Antes: solo expedientes `estado='CERRADO'` con `projected_margin`
                 y `real_margin` poblados manualmente en BD.
          Ahora: cualquier expediente activo con líneas en últimos 365d.
                 - `total_invoiced` = Σ qty × unit_price_client (de líneas)
                 - `real_margin`    = (revenue − cost) / revenue (de líneas)
                 - `projected_margin` = el guardado en BD (si > 0) o
                                        igual al real (fallback: scatter sobre la diagonal)
                 - `closed_at`      = `updated_at` (proxy mientras no haya
                                       columna real)

        Esto refleja la realidad operativa: aunque ningún expediente
        esté en estado `CERRADO`, los expedientes activos tienen un
        margen "real" calculable desde las líneas (precio cliente vs
        precio MWT). Los puntos fuera de la banda ±15% son los que
        merecen revisión.
        """
        rows = _fetchall("""
            WITH per_exp AS (
              SELECT
                e.id,
                e.codigo                          AS ref,
                e.client_id,
                e.brand_id,
                e.projected_margin,
                e.updated_at,
                SUM(l.qty * COALESCE(NULLIF(l.unit_price_client, 0), l.unit_price, 0))::float AS revenue,
                SUM(l.qty * COALESCE(NULLIF(l.unit_price_mwt,    0), l.unit_cost,  0))::float AS cost
              FROM expedientes.expediente e
              JOIN expedientes.linea     l ON l.expediente_id = e.id
              WHERE e.is_active = TRUE
                AND l.is_active = TRUE
                AND e.updated_at >= CURRENT_DATE - INTERVAL '365 days'
              GROUP BY e.id, e.codigo, e.client_id, e.brand_id,
                       e.projected_margin, e.updated_at
              HAVING SUM(l.qty * COALESCE(NULLIF(l.unit_price_client, 0), l.unit_price, 0)) > 0
            )
            SELECT
              id,
              ref,
              client_id,
              brand_id,
              CASE WHEN COALESCE(projected_margin, 0) > 0
                   THEN projected_margin::float
                   ELSE ((revenue - cost) / NULLIF(revenue, 0))::float
              END                                        AS projected_margin,
              ((revenue - cost) / NULLIF(revenue, 0))::float AS real_margin,
              revenue                                    AS total_invoiced,
              updated_at                                 AS closed_at
            FROM per_exp
            ORDER BY revenue DESC
            LIMIT 50
        """)
        return Response(rows)

    # ── Heatmap tallas × mercado ──────────────────────────────
    @action(detail=False, methods=["get"], url_path="size_market_distribution")
    def size_market_distribution(self, request):
        """Distribución de unidades vendidas por talla × mercado.

        Query params:
          ?market=CR|BR|US|...   filtra a un mercado específico
          ?market=ALL  (default) AGREGA todos los mercados en UNA sola
                       serie llamada "Global" — es lo que el dashboard
                       muestra cuando el filtro Mercado='Todos'.

        Shape:
          {
            sizes:   ["38","39","40","41","42","43","44"],  // ordenadas
            markets: [{ code: "GLOBAL"|"CR"|..., name: "Global"|... }],
            data:    [{ size, market, units }],
            curve:   [{ size, pct_target }] | null
          }

        · Fuente:
            expedientes.linea.size (string EU '34'..'49')
            clientes.cliente.pais_iso2 (mercado destino del cliente)
            expedientes.linea.qty (unidades)
        · Filtro: líneas activas con tallas válidas en últimos 365d
          (proxy de cierre vía expediente.updated_at).
        · Sprint 2026-05-22 · Cuando el CEO selecciona Mercado='Todos'
          NO queremos pintar N curvas separadas (1 por mercado), sino
          UNA sola curva agregada — eso refleja la pregunta real
          "¿cómo se distribuyen las tallas en todo el portafolio?".
          Por defecto market=ALL → agregamos por talla únicamente.
        """
        # Detectar si schema/cols existen — evita 500 si BD es muy vieja
        check = _fetchone("""
            SELECT EXISTS (
              SELECT 1 FROM information_schema.columns
              WHERE table_schema='expedientes' AND table_name='linea'
                AND column_name='size'
            )
        """)
        if not check or not check[0]:
            return Response({"sizes": [], "markets": [], "data": [], "curve": None})

        # Parse param market — uppercase, vacío/"ALL"/"TODOS"/"GLOBAL" = agregado
        market_param = (request.query_params.get("market") or "").strip().upper()
        is_aggregate = market_param in ("", "ALL", "TODOS", "GLOBAL")

        market_names = {
            "CR": "Costa Rica", "BR": "Brasil",    "US": "USA",
            "MX": "México",     "CO": "Colombia",  "PE": "Perú",
            "CL": "Chile",      "AR": "Argentina", "EC": "Ecuador",
            "DO": "R. Dominicana",
            "ZZ": "Sin país",
        }

        if is_aggregate:
            # Sumar todas las unidades por talla (sin separar por país)
            rows = _fetchall("""
                SELECT
                  l.size                AS size,
                  'GLOBAL'              AS market,
                  SUM(l.qty)::float     AS units
                FROM expedientes.linea     l
                JOIN expedientes.expediente e ON e.id = l.expediente_id
                LEFT JOIN clientes.cliente cli  ON cli.id = e.client_id
                WHERE l.is_active = TRUE
                  AND e.is_active = TRUE
                  AND l.size IS NOT NULL
                  AND l.size <> ''
                  AND l.qty > 0
                  AND e.updated_at >= CURRENT_DATE - INTERVAL '365 days'
                GROUP BY l.size
                ORDER BY l.size
            """)
            size_set = sorted({r["size"] for r in rows if r.get("size")},
                              key=lambda s: (len(s), s))
            markets = [{"code": "GLOBAL", "name": "Global"}] if rows else []
        else:
            # Filtrar a un mercado específico
            rows = _fetchall("""
                SELECT
                  l.size                                       AS size,
                  COALESCE(cli.pais_iso2, 'ZZ')                AS market,
                  SUM(l.qty)::float                            AS units
                FROM expedientes.linea     l
                JOIN expedientes.expediente e ON e.id = l.expediente_id
                LEFT JOIN clientes.cliente cli  ON cli.id = e.client_id
                WHERE l.is_active = TRUE
                  AND e.is_active = TRUE
                  AND l.size IS NOT NULL
                  AND l.size <> ''
                  AND l.qty > 0
                  AND e.updated_at >= CURRENT_DATE - INTERVAL '365 days'
                  AND COALESCE(cli.pais_iso2, 'ZZ') = %s
                GROUP BY l.size, COALESCE(cli.pais_iso2, 'ZZ')
                ORDER BY l.size
            """, [market_param])
            size_set = sorted({r["size"] for r in rows if r.get("size")},
                              key=lambda s: (len(s), s))
            markets = [{
                "code": market_param,
                "name": market_names.get(market_param, market_param),
            }] if rows else []

        return Response({
            "sizes":   size_set,
            "markets": markets,
            "data":    rows,
            "curve":   None,  # Pendiente productos.size_distribution_curve
        })

    # ── Diagnóstico (DEBUG-ONLY visible en navegador) ─────────
    @action(detail=False, methods=["get"], url_path="_diag")
    def _diag(self, request):
        """Endpoint de auto-diagnóstico para depurar widgets vacíos.

        Ejecuta cada query crítica del dashboard EN AISLAMIENTO (con
        savepoint por query) y devuelve para cada una:
          { count: int, sample: [...], error: str | null, sql_preview: str }

        Diseñado para resolver "Top SKUs vacío" cuando la BD SÍ tiene
        datos: revela si la query falla con error específico (qué tipo)
        o devuelve [] legítimamente.

        Visible en https://consola.mwt.one/api/analytics/_diag/
        protegido por mismo JWT que el resto de analytics.

        Marcado con prefijo `_` para indicar uso interno. Cuando se
        estabilice la situación, este endpoint puede borrarse.
        """
        from django.db import transaction as _txn

        queries = {
            "top_skus_margen": """
                WITH lineas_efectivas AS (
                  SELECT
                    l.sku,
                    l.producto_id,
                    l.qty,
                    COALESCE(NULLIF(l.unit_price_mwt,    0), l.unit_cost,  0) AS costo_efectivo,
                    COALESCE(NULLIF(l.unit_price_client, 0), l.unit_price, 0) AS precio_efectivo
                  FROM expedientes.linea     l
                  JOIN expedientes.expediente e ON e.id = l.expediente_id
                  WHERE l.is_active = TRUE
                    AND e.is_active = TRUE
                    AND e.updated_at >= CURRENT_DATE - INTERVAL '365 days'
                    AND l.sku IS NOT NULL
                )
                SELECT
                  le.sku,
                  SUM(le.qty)::float                                   AS units,
                  SUM(le.qty * le.precio_efectivo)::float              AS revenue_usd,
                  SUM(le.qty * (le.precio_efectivo - le.costo_efectivo))::float
                                                                       AS margin_usd
                FROM lineas_efectivas le
                WHERE le.precio_efectivo > 0
                GROUP BY le.sku
                ORDER BY margin_usd DESC NULLS LAST
                LIMIT 5
            """,
            "exposicion_clientes": """
                SELECT client_id, COUNT(*) AS n,
                       COALESCE(SUM(monto_pendiente), 0)::float AS pendiente
                FROM cobros.cobro
                WHERE is_active = TRUE AND client_id IS NOT NULL
                GROUP BY client_id
                ORDER BY pendiente DESC
                LIMIT 5
            """,
            "expediente_margin_scatter": """
                SELECT id, codigo, estado, projected_margin, real_margin, total_invoiced
                FROM expedientes.expediente
                WHERE is_active = TRUE
                  AND estado = 'CERRADO'
                  AND updated_at >= CURRENT_DATE - INTERVAL '365 days'
                LIMIT 5
            """,
            "any_cerrado_no_filter": """
                SELECT id, codigo, estado, projected_margin, real_margin
                FROM expedientes.expediente
                WHERE is_active = TRUE AND estado = 'CERRADO'
                LIMIT 5
            """,
            "any_cobros": """
                SELECT id, codigo, client_id, monto_total, monto_pagado, monto_pendiente
                FROM cobros.cobro
                WHERE is_active = TRUE
                LIMIT 5
            """,
            "any_lineas_con_precio": """
                SELECT l.sku, l.qty, l.unit_cost, l.unit_price,
                       l.unit_price_mwt, l.unit_price_client,
                       e.codigo AS exp_codigo, e.updated_at AS exp_updated_at,
                       e.estado AS exp_estado, e.is_active AS exp_active
                FROM expedientes.linea l
                JOIN expedientes.expediente e ON e.id = l.expediente_id
                WHERE l.is_active = TRUE
                  AND COALESCE(NULLIF(l.unit_price_client, 0), l.unit_price, 0) > 0
                LIMIT 5
            """,
            "now_and_tz": """
                SELECT NOW() AS now_ts,
                       CURRENT_DATE AS today,
                       CURRENT_DATE - INTERVAL '365 days' AS cutoff_365d,
                       CURRENT_SETTING('timezone') AS tz
            """,
        }

        out = {}
        for name, sql in queries.items():
            sid = _txn.savepoint()
            entry = {"count": 0, "sample": [], "error": None, "sql_preview": sql.strip()[:200]}
            try:
                with connection.cursor() as cur:
                    cur.execute(sql)
                    cols = [d[0] for d in cur.description] if cur.description else []
                    rows = cur.fetchall()
                    entry["count"] = len(rows)
                    entry["sample"] = [
                        {c: (v.isoformat() if hasattr(v, "isoformat") else
                             float(v) if hasattr(v, "as_tuple") else
                             str(v) if not isinstance(v, (int, float, str, bool, type(None))) else v)
                         for c, v in zip(cols, row)}
                        for row in rows[:5]
                    ]
                _txn.savepoint_commit(sid)
            except Exception as exc:  # noqa: BLE001 — propósito del endpoint
                _txn.savepoint_rollback(sid)
                entry["error"] = f"{type(exc).__name__}: {str(exc)[:300]}"
            out[name] = entry

        return Response(out)


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
