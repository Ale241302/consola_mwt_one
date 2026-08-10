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
from rest_framework.decorators import action, throttle_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .models import DashboardSnapshot, WidgetCat
from .serializers import (
    DashboardSnapshotSerializer, DashboardSnapshotListSerializer,
    WidgetCatSerializer,
)
# Sprint 2026-05-22 · scope multi-tenant en KPIs de dashboard.
from apps.core.scoped_querysets import (
    filter_by_user_clients_sql,
    is_bypass,
)
from apps.core.permissions import RoleBasedPermission, user_is_ceo_or_admin

log = logging.getLogger(__name__)


def _deny_unless_ceo_admin(request):
    """Devuelve Response 403 si el caller no es CEO/Admin; None si autorizado.

    Usado en endpoints que exponen margenes/costos/diagnostico (CEO-ONLY).
    """
    if user_is_ceo_or_admin(getattr(request, "user", None)):
        return None
    return Response(
        {"detail": "CEO/Admin only"},
        status=status.HTTP_403_FORBIDDEN,
    )


def _scope_hash(payload) -> str:
    """SHA-256 corto de un dict para scope_hash (64 hex chars)."""
    try:
        s = json.dumps(payload, sort_keys=True, default=str)
    except Exception:
        s = str(payload)
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def _parse_widget_scope(request):
    """Sprint 2026-08-02 · scope por widget del dashboard ADMIN/CEO.

    Parsea `?client_id=<uuid>` y `?brand_id=<uuid>`. Son filtros
    ADICIONALES que solo ESTRECHAN lo que el rol ya puede ver (nunca
    amplían): se concatenan al WHERE igual que el scope multitenant.
    Si el caller no es bypass, el scope multitenant existente sigue
    aplicando (intersección — defense in depth).

    Devuelve (client_id, brand_id, error_response):
      · client_id / brand_id: str UUID validado o None.
      · error_response: Response 400 si algún param no es UUID válido.
    """
    client_id = (request.query_params.get("client_id") or "").strip() or None
    brand_id = (request.query_params.get("brand_id") or "").strip() or None
    for name, val in (("client_id", client_id), ("brand_id", brand_id)):
        if val is not None:
            try:
                uuid.UUID(val)
            except (ValueError, AttributeError, TypeError):
                return None, None, Response(
                    {"detail": f"{name} inválido: se esperaba un UUID"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
    return client_id, brand_id, None


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


# Ola 3.10 · throttle específico del render de charts (scope chart_render).
class _ChartRenderThrottle(ScopedRateThrottle):
    scope = "chart_render"


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
    required_module = "analytics"

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
            "margin_source":  "no_data",
            "by_status":      [],
            "by_brand":       [],
            "urgent":         [],
            "cash_90":        [],
        }

        # Sprint 2026-05-22 · scope multi-tenant (R3 · POL_VISIBILIDAD).
        # superadmin/admin ven todo; resto se limita a su pool de
        # legal_entity_ids contra (client_id ∪ operating_company_id).
        scope_sql, scope_params = filter_by_user_clients_sql(
            request.user, column="client_id",
            extra_columns=("operating_company_id",),
        )
        if scope_sql == "FALSE":
            out["margin_source"] = "no_scope"
            return Response(out)
        exp_where = " AND (" + scope_sql + ")" if scope_sql else ""

        # Sprint 2026-08-02 · scope por widget (?client_id / ?brand_id).
        # Se aplica al query principal de KPIs; brand_id matchea la marca
        # del expediente o la heredada de su OC (misma regla que
        # by_status_by_brand, sprint 2026-05-26).
        client_id, brand_id, scope_err = _parse_widget_scope(request)
        if scope_err is not None:
            return scope_err
        widget_where = ""
        widget_params = []
        if client_id:
            widget_where += " AND client_id = %s"
            widget_params.append(client_id)
        if brand_id:
            widget_where += (
                " AND (brand_id = %s OR oc_id IN ("
                "SELECT id FROM expedientes.oc WHERE brand_id = %s))"
            )
            widget_params.extend([brand_id, brand_id])

        # — KPIs base con CASCADA DE FALLBACKS para margin_pct —
        # Orden de preferencia:
        #   (a) primary:                 projected_margin × total_cost (ponderado)
        #   (b) derived_invoiced_cost:   (total_invoiced - total_cost) / total_cost ponderado
        #   (c) derived_lineas_client:   SUM((unit_price_client - unit_cost) * qty) / SUM(unit_cost * qty)
        #                                desde expedientes.linea joineado por expediente_id
        #   (d) derived_flat:            AVG((total_invoiced - total_cost) / total_invoiced) no-ponderado
        # Si TODO está vacío -> margin_pct=0, margin_source='no_data'.
        # Clamp [-0.99, 5.0] para evitar valores absurdos en la UI.
        sql_kpis = f"""
            WITH scope AS (
              SELECT id, client_id, operating_company_id, total_cost,
                     total_invoiced, total_paid, balance, projected_margin, estado
                FROM expedientes.expediente
               WHERE is_active = TRUE{exp_where}{widget_where}
            ),
            agg AS (
              SELECT
                COUNT(*) FILTER (WHERE estado NOT IN ('CERRADO','CANCELADA'))   AS active,
                COALESCE(SUM(total_cost), 0)                                     AS total_cost,
                COALESCE(SUM(total_invoiced), 0)                                 AS total_invoiced,
                COALESCE(SUM(total_paid), 0)                                     AS total_paid,
                COALESCE(SUM(balance), 0)                                        AS receivables,
                CASE WHEN SUM(total_cost) FILTER (
                          WHERE projected_margin > 0 AND total_cost > 0) > 0
                     THEN SUM(projected_margin * total_cost) FILTER (
                          WHERE projected_margin > 0 AND total_cost > 0)
                          / NULLIF(SUM(total_cost) FILTER (
                            WHERE projected_margin > 0 AND total_cost > 0), 0)
                END AS m_primary,
                CASE WHEN SUM(total_cost) FILTER (
                          WHERE total_cost > 0 AND total_invoiced > 0) > 0
                     THEN SUM((total_invoiced - total_cost)) FILTER (
                          WHERE total_cost > 0 AND total_invoiced > 0)
                          / NULLIF(SUM(total_cost) FILTER (
                            WHERE total_cost > 0 AND total_invoiced > 0), 0)
                END AS m_derived_invoiced,
                AVG((total_invoiced - total_cost) / NULLIF(total_invoiced, 0))
                  FILTER (WHERE total_invoiced > 0 AND total_cost > 0)
                  AS m_derived_flat
              FROM scope
            ),
            lineas_agg AS (
              SELECT
                CASE WHEN SUM(l.unit_cost * l.qty) FILTER (
                          WHERE l.unit_cost > 0 AND l.qty > 0
                            AND COALESCE(l.unit_price_client, 0) > 0) > 0
                     THEN SUM((l.unit_price_client - l.unit_cost) * l.qty) FILTER (
                          WHERE l.unit_cost > 0 AND l.qty > 0
                            AND COALESCE(l.unit_price_client, 0) > 0)
                          / NULLIF(SUM(l.unit_cost * l.qty) FILTER (
                            WHERE l.unit_cost > 0 AND l.qty > 0
                              AND COALESCE(l.unit_price_client, 0) > 0), 0)
                END AS m_derived_lineas
              FROM expedientes.linea l
              JOIN scope e ON e.id = l.expediente_id
              WHERE l.is_active = TRUE
            )
            SELECT a.active, a.total_cost, a.total_invoiced, a.total_paid,
                   a.receivables,
                   COALESCE(a.m_primary, a.m_derived_invoiced,
                            la.m_derived_lineas, a.m_derived_flat, 0)::float AS margin_pct,
                   CASE
                     WHEN a.m_primary           IS NOT NULL THEN 'primary'
                     WHEN a.m_derived_invoiced  IS NOT NULL THEN 'derived_invoiced_cost'
                     WHEN la.m_derived_lineas   IS NOT NULL THEN 'derived_lineas_client_price'
                     WHEN a.m_derived_flat      IS NOT NULL THEN 'derived_flat'
                     ELSE 'no_data'
                   END AS margin_source
              FROM agg a CROSS JOIN lineas_agg la
        """
        r = _fetchone(sql_kpis, scope_params + widget_params)
        if r:
            margin_raw = float(r[5] or 0)
            # Clamp: evita -8000% por outliers o factura mal cargada.
            margin_clamped = max(-0.99, min(5.0, margin_raw))
            out["active"]         = r[0] or 0
            out["total_cost"]     = float(r[1] or 0)
            out["total_invoiced"] = float(r[2] or 0)
            out["total_paid"]     = float(r[3] or 0)
            out["receivables"]    = float(r[4] or 0)
            out["margin_pct"]     = margin_clamped
            raw_source = r[6] or "no_data"
            # Sprint 2026-05-22 · si todos los buckets dieron 0 pero hay
            # expedientes activos, marcar 'no_invoicing_yet' para que el
            # frontend pinte 0.0% (honesto) en vez de "Sin datos".
            if raw_source == "no_data" and (out["active"] or 0) > 0:
                raw_source = "no_invoicing_yet"
            out["margin_source"]  = raw_source

        # — Conteo por estado —
        out["by_status"] = _fetchall("""
            SELECT estado AS status, COUNT(*) AS count
            FROM expedientes.expediente
            WHERE is_active = TRUE
            GROUP BY estado
            ORDER BY count DESC
        """)

        # — Agregado por marca —
        # Sprint 2026-05-26 (CEO) - mismo fix que by_status_by_brand:
        # heredar brand_id de la OC padre cuando el expediente lo tenga NULL.
        out["by_brand"] = _fetchall("""
            SELECT
              COALESCE(e.brand_id, o.brand_id)  AS brand_id,
              COUNT(*)                          AS count,
              COALESCE(SUM(e.total_cost),0)     AS total_cost,
              COALESCE(SUM(e.total_invoiced),0) AS total_invoiced,
              COALESCE(SUM(e.total_paid),0)     AS total_paid
            FROM expedientes.expediente e
            LEFT JOIN expedientes.oc o ON o.id = e.oc_id
            WHERE e.is_active = TRUE
              AND COALESCE(e.brand_id, o.brand_id) IS NOT NULL
            GROUP BY COALESCE(e.brand_id, o.brand_id)
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
        """Últimas 12 semanas: proyectado (vencimientos) vs real (pagos).

        Sprint 2026-08-02 · `?client_id=` (scope por widget). cobros no
        tiene dimensión marca: brand_id se valida pero no filtra aquí.
        """
        client_id, _brand_id, scope_err = _parse_widget_scope(request)
        if scope_err is not None:
            return scope_err
        proy_where = " AND client_id = %s" if client_id else ""
        real_where = (
            " AND cobro_id IN (SELECT id FROM cobros.cobro WHERE client_id = %s)"
            if client_id else ""
        )
        params = [client_id, client_id] if client_id else []
        rows = _fetchall(f"""
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
              WHERE is_active = TRUE{proy_where}
              GROUP BY 1
            ),
            real AS (
              SELECT date_trunc('week', fecha_acreditacion) AS semana,
                     COALESCE(SUM(monto),0) AS monto
              FROM cobros.pago
              WHERE is_active = TRUE
                AND estado IN ('VERIFICADO','LIBERADO','CONCILIADO')
                AND direccion = 'INGRESO'
                AND fecha_acreditacion IS NOT NULL{real_where}
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
        """, params)
        return Response(rows)

    # ── Aging buckets de cuentas por cobrar ───────────────────
    @action(detail=False, methods=["get"])
    def aging(self, request):
        """Buckets: 0-30, 31-60, 61-90, 90+ en monto_pendiente.

        Sprint 2026-08-02 · `?client_id=` (scope por widget). cobros no
        tiene dimensión marca: brand_id se valida pero no filtra aquí.
        """
        client_id, _brand_id, scope_err = _parse_widget_scope(request)
        if scope_err is not None:
            return scope_err
        client_where = " AND client_id = %s" if client_id else ""
        params = [client_id] if client_id else []
        r = _fetchone(f"""
            SELECT
              COALESCE(SUM(CASE WHEN (CURRENT_DATE - fecha_vencimiento) <= 30 THEN monto_pendiente END),0),
              COALESCE(SUM(CASE WHEN (CURRENT_DATE - fecha_vencimiento) BETWEEN 31 AND 60 THEN monto_pendiente END),0),
              COALESCE(SUM(CASE WHEN (CURRENT_DATE - fecha_vencimiento) BETWEEN 61 AND 90 THEN monto_pendiente END),0),
              COALESCE(SUM(CASE WHEN (CURRENT_DATE - fecha_vencimiento) > 90 THEN monto_pendiente END),0),
              COALESCE(SUM(monto_pendiente),0)
            FROM cobros.cobro
            WHERE is_active = TRUE AND monto_pendiente > 0{client_where}
        """, params)
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
        denied = _deny_unless_ceo_admin(request)
        if denied is not None:
            return denied
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
              -- Sprint 2026-05-31 · consistente con ExpedienteSerializer.get_oc_codigos:
              -- el PO real es el codigo del documento OC que subio el cliente;
              -- el codigo auto de commercial.oc ('PO-2026-000NN') es solo fallback.
              COALESCE(ocdoc.codigo, o.codigo)               AS oc_codigo,
              o.proforma                                     AS proforma,
              e.client_id,
              e.operating_company_id,
              COALESCE(cli.nombre_comercial, cli.razon_social) AS client_name,
              e.brand_id,
              m.nombre                                       AS brand_name,
              e.credit_days,
              e.is_blocked,
              COALESCE(lines_tot.total_client, o.total_value, e.total_invoiced, 0) AS total_client,
              CASE WHEN e.operating_company_id IS NOT NULL AND e.operating_company_id <> e.client_id
                   THEN COALESCE(lines_tot.total_mwt, e.total_cost, 0)
                   ELSE 0
              END                                            AS total_mwt,
              CASE WHEN e.is_blocked THEN 'high' ELSE 'medium' END AS urgency,
              CASE WHEN e.is_blocked
                   THEN 'Resolver bloqueo de crédito'
                   ELSE 'Confirmar arribo antes del vencimiento'
              END                                            AS action
            FROM expedientes.expediente e
            LEFT JOIN expedientes.oc       o   ON o.id = e.oc_id
            LEFT JOIN clientes.cliente     cli ON cli.id = e.client_id
            LEFT JOIN brands.marca         m   ON m.id   = e.brand_id
            LEFT JOIN LATERAL (
              SELECT
                SUM(l.qty * COALESCE(l.unit_price_client, l.unit_price, 0)) AS total_client,
                SUM(l.qty * COALESCE(l.unit_price_mwt, l.unit_price, 0))    AS total_mwt
              FROM expedientes.linea l
              WHERE l.expediente_id = e.id AND l.is_active = TRUE
            ) lines_tot ON TRUE
            LEFT JOIN LATERAL (
              SELECT d.codigo
                FROM expedientes.documento d
               WHERE d.expediente_id = e.id
                 AND d.is_active = TRUE
                 AND d.kind ~* '^OC( |_|$)'
                 AND d.codigo IS NOT NULL
                 AND d.codigo <> ''
               ORDER BY d.audience ASC, d.created_at DESC
               LIMIT 1
            ) ocdoc ON TRUE
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
            "_source":     "no_data",
        }

        # Sprint 2026-05-22 · scope multi-tenant + cascada de fallbacks.
        # Para cobros usamos client_id directo; para expedientes scope dual.
        scope_c_sql, scope_c_params = filter_by_user_clients_sql(
            request.user, column="c.client_id",
        )
        scope_cc_sql, scope_cc_params = filter_by_user_clients_sql(
            request.user, column="client_id",
        )
        scope_e_sql, scope_e_params = filter_by_user_clients_sql(
            request.user, column="client_id",
            extra_columns=("operating_company_id",),
        )
        if "FALSE" in (scope_c_sql, scope_cc_sql, scope_e_sql):
            return Response({**empty, "_source": "no_scope"})
        scope_c_where  = " AND (" + scope_c_sql  + ")" if scope_c_sql  else ""
        scope_cc_where = " AND (" + scope_cc_sql + ")" if scope_cc_sql else ""
        scope_e_where  = " AND (" + scope_e_sql  + ")" if scope_e_sql  else ""

        # Sprint 2026-08-02 · scope por widget (?client_id). Se aplica a
        # los 5 buckets (cobros y expedientes). brand_id se valida pero
        # no filtra: la dimensión marca no existe en cobros y aplicarla
        # solo a los buckets fallback de expediente sería inconsistente.
        client_id, _brand_id, scope_err = _parse_widget_scope(request)
        if scope_err is not None:
            return scope_err
        widget_c_where  = " AND c.client_id = %s" if client_id else ""
        widget_cc_where = " AND client_id = %s" if client_id else ""
        widget_e_where  = " AND client_id = %s" if client_id else ""
        widget_params = (
            [client_id, client_id, client_id, client_id, client_id]
            if client_id else []
        )

        # Cascada (en orden de honestidad):
        #   (a) primary:                   90d de pagos verificados, cobros cerrados
        #   (b) derived_180d:              misma logica con ventana ampliada
        #   (c) derived_mora_live:         dias_mora promedio de cobros en mora HOY
        #   (d) derived_expediente_credit_days: AVG(credit_days) de expedientes CERRADOS
        sql_cc = f"""
            WITH paid_90 AS (
              SELECT c.expediente_id,
                     GREATEST(
                       EXTRACT(DAY FROM (MAX(p.fecha_acreditacion)::timestamp
                                       - MIN(c.created_at)::timestamp)),
                       0
                     )::numeric AS dias
                FROM cobros.cobro c
                JOIN cobros.pago  p ON p.cobro_id = c.id
               WHERE c.is_active = TRUE AND p.is_active = TRUE
                 AND p.direccion = 'INGRESO'
                 AND p.estado IN ('VERIFICADO','LIBERADO','CONCILIADO')
                 AND p.fecha_acreditacion IS NOT NULL
                 AND p.fecha_acreditacion >= CURRENT_DATE - INTERVAL '90 days'
                 AND c.expediente_id IS NOT NULL{scope_c_where}{widget_c_where}
               GROUP BY c.expediente_id
              HAVING SUM(c.monto_pendiente) <= 0
            ),
            paid_180 AS (
              SELECT c.expediente_id,
                     GREATEST(
                       EXTRACT(DAY FROM (MAX(p.fecha_acreditacion)::timestamp
                                       - MIN(c.created_at)::timestamp)),
                       0
                     )::numeric AS dias
                FROM cobros.cobro c
                JOIN cobros.pago  p ON p.cobro_id = c.id
               WHERE c.is_active = TRUE AND p.is_active = TRUE
                 AND p.direccion = 'INGRESO'
                 AND p.estado IN ('VERIFICADO','LIBERADO','CONCILIADO')
                 AND p.fecha_acreditacion IS NOT NULL
                 AND p.fecha_acreditacion >= CURRENT_DATE - INTERVAL '180 days'
                 AND c.expediente_id IS NOT NULL{scope_c_where}{widget_c_where}
               GROUP BY c.expediente_id
              HAVING SUM(c.monto_pendiente) <= 0
            ),
            mora_live AS (
              SELECT GREATEST(
                       (CURRENT_DATE - fecha_vencimiento),
                       0
                     )::numeric AS dias
                FROM cobros.cobro
               WHERE is_active = TRUE
                 AND monto_pendiente > 0
                 AND fecha_vencimiento IS NOT NULL
                 AND fecha_vencimiento < CURRENT_DATE{scope_cc_where}{widget_cc_where}
            ),
            exp_cerrados AS (
              SELECT credit_days::numeric AS dias
                FROM expedientes.expediente
               WHERE is_active = TRUE
                 AND estado = 'CERRADO'
                 AND credit_days IS NOT NULL AND credit_days > 0
                 AND updated_at >= CURRENT_DATE - INTERVAL '180 days'{scope_e_where}{widget_e_where}
            ),
            exp_activos AS (
              -- Sprint 2026-05-22 · bucket (e) ultimo recurso: cualquier
              -- expediente activo con credit_days poblado (plazo concedido).
              -- Es el menos honesto (no es plazo consumido) pero evita
              -- "Sin datos" cuando el negocio recien arranca.
              SELECT credit_days::numeric AS dias
                FROM expedientes.expediente
               WHERE is_active = TRUE
                 AND credit_days IS NOT NULL AND credit_days > 0{scope_e_where}{widget_e_where}
            )
            SELECT
              (SELECT COUNT(*) FROM paid_90)                                           AS n_a,
              (SELECT AVG(dias)::float FROM paid_90)                                   AS avg_a,
              (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY dias)::float FROM paid_90) AS p50_a,
              (SELECT percentile_cont(0.9) WITHIN GROUP (ORDER BY dias)::float FROM paid_90) AS p90_a,
              (SELECT COUNT(*) FROM paid_180)                                          AS n_b,
              (SELECT AVG(dias)::float FROM paid_180)                                  AS avg_b,
              (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY dias)::float FROM paid_180) AS p50_b,
              (SELECT percentile_cont(0.9) WITHIN GROUP (ORDER BY dias)::float FROM paid_180) AS p90_b,
              (SELECT COUNT(*) FROM mora_live)                                         AS n_c,
              (SELECT AVG(dias)::float FROM mora_live)                                 AS avg_c,
              (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY dias)::float FROM mora_live) AS p50_c,
              (SELECT percentile_cont(0.9) WITHIN GROUP (ORDER BY dias)::float FROM mora_live) AS p90_c,
              (SELECT COUNT(*) FROM exp_cerrados)                                      AS n_d,
              (SELECT AVG(dias)::float FROM exp_cerrados)                              AS avg_d,
              (SELECT COUNT(*) FROM exp_activos)                                       AS n_e,
              (SELECT AVG(dias)::float FROM exp_activos)                               AS avg_e
        """
        params = (
            scope_c_params + scope_c_params
            + scope_cc_params + scope_e_params + scope_e_params
            + widget_params
        )
        r = _fetchone(sql_cc, params)
        if not r:
            return Response(empty)
        # Buckets: (source, n_idx, avg_idx, p50_idx, p90_idx, window)
        buckets = [
            ("primary",                              r[0],  r[1],  r[2],  r[3],  90),
            ("derived_180d",                         r[4],  r[5],  r[6],  r[7],  180),
            ("derived_mora_live",                    r[8],  r[9],  r[10], r[11], None),
            ("derived_expediente_credit_days",       r[12], r[13], None,  None,  180),
            ("derived_active_credit_days_concedido", r[14], r[15], None,  None,  None),
        ]
        for src, n, avg, p50, p90, window in buckets:
            if n and int(n) > 0 and avg is not None:
                return Response({
                    "avg_days":    float(avg),
                    "p50":         float(p50) if p50 is not None else None,
                    "p90":         float(p90) if p90 is not None else None,
                    "n_files":     int(n),
                    "period_days": window or period_days,
                    "_source":     src,
                })
        return Response(empty)

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
        # Sprint 2026-08-02 · scope por widget (?client_id / ?brand_id).
        # brand_id matchea la marca del expediente o la heredada de su OC.
        client_id, brand_id, scope_err = _parse_widget_scope(request)
        if scope_err is not None:
            return scope_err
        widget_where = ""
        widget_params = []
        if client_id:
            widget_where += " AND client_id = %s"
            widget_params.append(client_id)
        if brand_id:
            widget_where += (
                " AND (brand_id = %s OR oc_id IN ("
                "SELECT id FROM expedientes.oc WHERE brand_id = %s))"
            )
            widget_params.extend([brand_id, brand_id])
        # Primer intento: nueva columna corrections_count
        r = _fetchone(f"""
            SELECT
              COUNT(*)                                              AS total,
              COUNT(*) FILTER (WHERE corrections_count >= 1)        AS with_corr
            FROM expedientes.expediente
            WHERE is_active = TRUE
              AND created_at >= CURRENT_DATE - INTERVAL '90 days'{widget_where}
        """, widget_params)
        if r is None:
            # Fallback al boolean cost_corrections (pre-D2)
            r = _fetchone(f"""
                SELECT
                  COUNT(*)                                          AS total,
                  COUNT(*) FILTER (WHERE cost_corrections = TRUE)   AS with_corr
                FROM expedientes.expediente
                WHERE is_active = TRUE
                  AND created_at >= CURRENT_DATE - INTERVAL '90 days'{widget_where}
            """, widget_params)
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
            "tacos_pct":   0.0,
            "period_days": period_days,
            "spend_usd":   0.0,
            "sales_usd":   0.0,
            "n_days":      0,
            "_source":     "no_data",
        }

        # Sprint 2026-05-22 · amazon_ads.account NO tiene client_id ni
        # operating_company_id (sql/D3 no contempla scope todavia). Por
        # ahora el TACoS es admin-only de facto. Users non-bypass reciben
        # ceros con _source='no_scope' — el frontend muestra hint honesto.
        if not is_bypass(request.user):
            return Response({**empty, "_source": "no_scope"})

        # Verificacion barata del schema (evita rollback en tx atomicas
        # upstream si amazon_ads no existe).
        with connection.cursor() as cur:
            try:
                cur.execute("SELECT to_regclass('amazon_ads.spend_daily')")
                if not cur.fetchone()[0]:
                    return Response({**empty, "_source": "no_data"})
            except Exception:
                connection.rollback()
                return Response({**empty, "_source": "no_data"})

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
            return Response({**empty, "_source": "no_data"})

        spend, sales, n_days = (
            float(r[0] or 0),
            float(r[1] or 0),
            int(r[2] or 0),
        )
        if n_days == 0 and sales <= 0:
            # Schema existe pero sin filas en la ventana.
            return Response({**empty, "_source": "no_activity"})
        tacos = (spend / sales) if sales > 0 else 0.0
        return Response({
            "tacos_pct":   float(tacos),
            "period_days": period_days,
            "spend_usd":   spend,
            "sales_usd":   sales,
            "n_days":      n_days,
            "_source":     "primary" if sales > 0 else "no_activity",
        })

        # ── Crosstab status × brand_id ────────────────────────────
    @action(detail=False, methods=["get"], url_path="by_status_by_brand")
    def by_status_by_brand(self, request):
        """Crosstab estado x brand (heredada de OC si el expediente no la tiene).

        Sprint 2026-05-26 (CEO) - fix dashboard "Pipeline operativo":
        el wizard de creacion de expediente NO popula brand_id en
        expedientes.expediente; solo lo guarda en expedientes.oc.
        Resultado: con el SQL anterior (filtro brand_id IS NOT NULL
        sobre expediente) el endpoint devolvia [] y el widget mostraba
        el placeholder "Sin pipeline por marca".

        Fix: LEFT JOIN con expedientes.oc y COALESCE para derivar la
        marca del expediente desde la OC padre cuando expediente.brand_id
        es NULL. Tambien se aplican Cache-Control headers para evitar
        cache stale en el navegador.

        Shape:
          [{ brand_id, status, count, total_invoiced }]
        """
        rows = _fetchall("""
            SELECT
              COALESCE(e.brand_id, o.brand_id)  AS brand_id,
              e.estado                          AS status,
              COUNT(*)                          AS count,
              COALESCE(SUM(e.total_invoiced),0) AS total_invoiced
            FROM expedientes.expediente e
            LEFT JOIN expedientes.oc o ON o.id = e.oc_id
            WHERE e.is_active = TRUE
              AND COALESCE(e.brand_id, o.brand_id) IS NOT NULL
            GROUP BY COALESCE(e.brand_id, o.brand_id), e.estado
            ORDER BY COALESCE(e.brand_id, o.brand_id), count DESC
        """)
        resp = Response(rows)
        # Anti-cache: el dashboard cambia con cada nuevo expediente.
        resp["Cache-Control"] = "no-cache, no-store, must-revalidate"
        resp["Pragma"]        = "no-cache"
        return resp

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
        # Sprint 2026-05-26 (CEO) - fix dashboard "Inventario por nodo":
        # inventario.stock.cantidad_disponible esta vacio en produccion
        # (tabla legacy, nunca se popula). Los datos reales viven en
        # inventario.expediente_nodo_assignment.qty_asignada, que el
        # endpoint /api/nodos/<id>/inventory-allocated ya usa con exito.
        # Para no romper compatibilidad: sumamos desde
        # expediente_nodo_assignment como fuente principal; si existiera
        # algo en stock (cuando se pueble), nos quedamos con el mayor.
        rows = _fetchall("""
            WITH stock_por_nodo AS (
              SELECT
                a.nodo_id,
                COALESCE(SUM(a.qty_asignada), 0)::float AS total_units
              FROM inventario.expediente_nodo_assignment a
              WHERE a.is_active = TRUE
              GROUP BY a.nodo_id
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
        denied = _deny_unless_ceo_admin(request)
        if denied is not None:
            return denied
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
        denied = _deny_unless_ceo_admin(request)
        if denied is not None:
            return denied
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

        # Sprint 2026-08-02 · scope por widget (?client_id / ?brand_id).
        client_id, brand_id, scope_err = _parse_widget_scope(request)
        if scope_err is not None:
            return scope_err
        widget_where = ""
        widget_params = []
        if client_id:
            widget_where += " AND e.client_id = %s"
            widget_params.append(client_id)
        if brand_id:
            widget_where += (
                " AND (e.brand_id = %s OR e.oc_id IN ("
                "SELECT id FROM expedientes.oc WHERE brand_id = %s))"
            )
            widget_params.extend([brand_id, brand_id])

        market_names = {
            "CR": "Costa Rica", "BR": "Brasil",    "US": "USA",
            "MX": "México",     "CO": "Colombia",  "PE": "Perú",
            "CL": "Chile",      "AR": "Argentina", "EC": "Ecuador",
            "DO": "R. Dominicana",
            "ZZ": "Sin país",
        }

        if is_aggregate:
            # Sumar todas las unidades por talla (sin separar por país)
            rows = _fetchall(f"""
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
                  AND e.updated_at >= CURRENT_DATE - INTERVAL '365 days'{widget_where}
                GROUP BY l.size
                ORDER BY l.size
            """, widget_params)
            size_set = sorted({r["size"] for r in rows if r.get("size")},
                              key=lambda s: (len(s), s))
            markets = [{"code": "GLOBAL", "name": "Global"}] if rows else []
        else:
            # Filtrar a un mercado específico
            rows = _fetchall(f"""
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
                  AND COALESCE(cli.pais_iso2, 'ZZ') = %s{widget_where}
                GROUP BY l.size, COALESCE(cli.pais_iso2, 'ZZ')
                ORDER BY l.size
            """, [market_param] + widget_params)
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
        denied = _deny_unless_ceo_admin(request)
        if denied is not None:
            return denied
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

    # ── Fable5 · Observabilidad self-hosted (equivalente Sentry) ──────
    # POST: el frontend (ErrorBoundary + window.onerror) reporta crashes
    #       de render y promesas no manejadas. Best-effort: NUNCA rompe
    #       al caller. Tabla: analytics.client_error_log (E6).
    # GET : listado de errores recientes — staff only.
    @action(detail=False, methods=["post", "get"], url_path="client-errors")
    def client_errors(self, request):
        if request.method.upper() == "POST":
            d = request.data if isinstance(request.data, dict) else {}
            msg = str(d.get("message") or "")[:2000]
            stack = str(d.get("stack") or "")[:8000]
            path = str(d.get("path") or "")[:512]
            ua = str(request.META.get("HTTP_USER_AGENT") or "")[:512]
            uid = getattr(request.user, "id", None)
            if not msg:
                return Response({"ok": False, "detail": "message requerido"}, status=400)
            try:
                with connection.cursor() as c:
                    c.execute("""
                        INSERT INTO analytics.client_error_log
                               (user_id, path, message, stack, user_agent)
                        VALUES (%s::uuid, %s, %s, %s, %s)
                    """, [str(uid) if uid else None, path, msg, stack, ua])
            except Exception:  # noqa: BLE001 — reporter best-effort
                return Response({"ok": False}, status=202)
            return Response({"ok": True}, status=201)
        # GET — staff only (los stacks pueden contener datos internos).
        role = str(getattr(request.user, "role_default", "")
                   or getattr(request.user, "role", "") or "").upper()
        if not (getattr(request.user, "is_superuser", False)
                or role in ("ADMIN", "CEO")):
            return Response({"detail": "forbidden"}, status=403)
        try:
            limit = min(int(request.query_params.get("limit", 100) or 100), 500)
        except ValueError:
            limit = 100
        with connection.cursor() as c:
            c.execute("""
                SELECT id::text, user_id::text, path, message,
                       created_at
                  FROM analytics.client_error_log
                 ORDER BY created_at DESC
                 LIMIT %s
            """, [limit])
            cols = [x[0] for x in c.description]
            rows = [dict(zip(cols, r)) for r in c.fetchall()]
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
    required_module = "analytics"
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
    required_module = "analytics"
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


# ══════════════════════════════════════════════════════════════
# Ola 3.10 · ChartRenderView — render de charts server-side (SVG)
#
# Vista DEDICADA (APIView) en lugar de un @action del AnalyticsViewSet:
#   · POST → el enforcement MCP derivaría la acción "create" (POST→create),
#     pero generar un chart es SOLO LECTURA. Al declarar
#     required_action="view" el RoleBasedPermission valida analytics.view
#     (la matriz de los roles staff lo tiene tras F5_mcp_charts_rbac.sql).
#   · Recibe SOLO datos puros (números y labels), nunca URLs/HTML (sin SSRF).
#   · El SVG se sube a MinIO y se devuelve URL firmada TTL 5 min.
# ══════════════════════════════════════════════════════════════
class ChartRenderView(APIView):
    """POST /api/analytics/chart-render/ — genera un chart SVG (Ola 3.10)."""

    required_module = "analytics"
    required_action = "view"
    permission_classes = [IsAuthenticated, RoleBasedPermission]
    throttle_classes = [_ChartRenderThrottle]

    @method_decorator(never_cache)
    def post(self, request):
        from apps.storage.services import (
            generate_signed_url,
            put_object_stream,
        )
        from .chart_svg import CHART_TYPES, render_chart

        tipo = (request.data.get("tipo") or "").strip().lower()
        data = request.data.get("data")
        opciones = request.data.get("opciones") or {}
        if tipo not in CHART_TYPES:
            return Response(
                {"detail": f"tipo inválido. Válidos: {', '.join(CHART_TYPES)}"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not isinstance(data, list) or not data:
            return Response(
                {"detail": "data debe ser un array no vacío de filas."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if len(data) > 5000:
            return Response(
                {"detail": "data excede 5000 filas."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # opciones: whitelist de claves (nunca se interpolan en HTML/URL).
        allowed_opts = {"x", "y", "category", "value", "titulo", "width",
                        "height", "palette"}
        opciones = {k: v for k, v in (opciones or {}).items() if k in allowed_opts}

        try:
            svg = render_chart(tipo, data, opciones)
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        # Subir a MinIO + URL firmada TTL 5 min.
        key = f"charts/{uuid.uuid4()}.svg"
        try:
            svg_bytes = svg.encode("utf-8")
            up = put_object_stream(key, __import__("io").BytesIO(svg_bytes),
                                   content_type="image/svg+xml",
                                   length=len(svg_bytes))
        except Exception as e:  # noqa: BLE001 - diagnóstico
            log.error("[chart_render] upload falló: %s", e)
            up = {"ok": False, "error": str(e)}
        if not up.get("ok"):
            return Response(
                {"detail": "No se pudo almacenar el chart: "
                           f"{up.get('error', 'storage_unavailable')}"},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        signed = generate_signed_url(key, kind="get", ttl=300)
        return Response({
            "success": True,
            "tipo": tipo,
            "image_url": signed.get("url"),
            "expires_at": signed.get("expires_at"),
            "errorMessage": None,
        })
