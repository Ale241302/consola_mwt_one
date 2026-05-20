"""
=====================================================================
MWT.ONE · apps.analytics.management.commands.diag_dashboard

Diagnóstico CLI del dashboard — ejecuta las queries críticas EN
AISLAMIENTO (con savepoint por query) y reporta para cada una:
  · count de filas
  · sample (primeras 3)
  · error con tipo si falla
  · timezone Django vs Postgres

Equivalente al endpoint /api/analytics/_diag/ pero accesible sin
autenticación JWT (útil cuando el browser no tiene cookies de sesión
o se quiere depurar desde la VPS sin tocar el navegador).

Uso:
    docker exec consola-mwt-one-django python manage.py diag_dashboard

Salida: bloque JSON-like legible (no JSON estricto) por stdout.
Para JSON: añadir --json.
=====================================================================
"""
from __future__ import annotations

import json

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import connection, transaction


QUERIES = {
    "top_skus_margen": """
        WITH lineas_efectivas AS (
          SELECT
            l.sku, l.producto_id, l.qty,
            COALESCE(NULLIF(l.unit_price_mwt,    0), l.unit_cost,  0) AS costo_efectivo,
            COALESCE(NULLIF(l.unit_price_client, 0), l.unit_price, 0) AS precio_efectivo
          FROM expedientes.linea     l
          JOIN expedientes.expediente e ON e.id = l.expediente_id
          WHERE l.is_active = TRUE
            AND e.is_active = TRUE
            AND l.sku IS NOT NULL
        )
        SELECT
          le.sku,
          SUM(le.qty)::float                              AS units,
          SUM(le.qty * le.precio_efectivo)::float         AS revenue_usd,
          SUM(le.qty * (le.precio_efectivo - le.costo_efectivo))::float AS margin_usd
        FROM lineas_efectivas le
        WHERE le.precio_efectivo > 0
        GROUP BY le.sku
        ORDER BY margin_usd DESC NULLS LAST
        LIMIT 10
    """,
    "exposicion_desde_lineas": """
        SELECT
          e.client_id,
          COUNT(DISTINCT e.id) AS expedientes,
          SUM(l.qty * COALESCE(NULLIF(l.unit_price_client,0), l.unit_price, 0))::float AS pendiente
        FROM expedientes.expediente e
        JOIN expedientes.linea     l ON l.expediente_id = e.id
        WHERE e.is_active = TRUE AND l.is_active = TRUE
          AND e.client_id IS NOT NULL
        GROUP BY e.client_id
        HAVING SUM(l.qty * COALESCE(NULLIF(l.unit_price_client,0), l.unit_price, 0)) > 0
        ORDER BY pendiente DESC
        LIMIT 10
    """,
    "scatter_margen_lineas": """
        SELECT
          e.id::text, e.codigo,
          SUM(l.qty * COALESCE(NULLIF(l.unit_price_client,0), l.unit_price, 0))::float AS revenue,
          SUM(l.qty * COALESCE(NULLIF(l.unit_price_mwt,   0), l.unit_cost,  0))::float AS cost
        FROM expedientes.expediente e
        JOIN expedientes.linea     l ON l.expediente_id = e.id
        WHERE e.is_active = TRUE AND l.is_active = TRUE
        GROUP BY e.id, e.codigo
        HAVING SUM(l.qty * COALESCE(NULLIF(l.unit_price_client,0), l.unit_price, 0)) > 0
        ORDER BY revenue DESC
        LIMIT 10
    """,
    "muestra_lineas_reales": """
        SELECT l.sku, l.qty, l.unit_cost, l.unit_price,
               l.unit_price_mwt, l.unit_price_client,
               e.codigo AS exp_codigo, e.estado, e.is_active AS exp_active,
               cli.razon_social AS cliente
        FROM expedientes.linea l
        JOIN expedientes.expediente e ON e.id = l.expediente_id
        LEFT JOIN clientes.cliente cli ON cli.id = e.client_id
        WHERE l.is_active = TRUE
        ORDER BY l.qty * COALESCE(NULLIF(l.unit_price_client,0), l.unit_price, 0) DESC
        LIMIT 5
    """,
    "totales_modelo": """
        SELECT
          (SELECT COUNT(*) FROM expedientes.expediente WHERE is_active=TRUE) AS exp_activos,
          (SELECT COUNT(*) FROM expedientes.linea      WHERE is_active=TRUE) AS lineas_activas,
          (SELECT COUNT(DISTINCT sku) FROM expedientes.linea WHERE is_active=TRUE AND sku IS NOT NULL) AS skus_distintos,
          (SELECT COUNT(*) FROM cobros.cobro           WHERE is_active=TRUE) AS cobros_activos,
          (SELECT COUNT(*) FROM clientes.cliente       WHERE is_active=TRUE) AS clientes_activos
    """,
    "now_y_tz": """
        SELECT NOW() AS now_ts,
               CURRENT_DATE AS today,
               CURRENT_SETTING('timezone') AS pg_tz
    """,
}


def _to_jsonable(value):
    """Convierte tipos no-JSON a string."""
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if hasattr(value, "as_tuple"):  # Decimal
        return float(value)
    return str(value)


class Command(BaseCommand):
    help = "Diagnóstico CLI de queries críticas del dashboard."

    def add_arguments(self, parser):
        parser.add_argument("--json", action="store_true",
                            help="Salida en JSON estricto (sin formateo amigable).")

    def handle(self, *args, **opts):
        as_json = bool(opts.get("json"))
        result = {}

        for name, sql in QUERIES.items():
            sid = transaction.savepoint()
            entry = {"count": 0, "sample": [], "error": None}
            try:
                with connection.cursor() as cur:
                    cur.execute(sql)
                    cols = [d[0] for d in cur.description] if cur.description else []
                    rows = cur.fetchall()
                    entry["count"] = len(rows)
                    entry["sample"] = [
                        {c: _to_jsonable(v) for c, v in zip(cols, row)}
                        for row in rows[:3]
                    ]
                transaction.savepoint_commit(sid)
            except Exception as exc:  # noqa: BLE001 — propósito del comando
                transaction.savepoint_rollback(sid)
                entry["error"] = f"{type(exc).__name__}: {str(exc)[:300]}"
            result[name] = entry

        result["meta"] = {
            "django_tz": settings.TIME_ZONE,
            "db_engine": settings.DATABASES["default"]["ENGINE"],
            "db_name":   settings.DATABASES["default"]["NAME"],
        }

        if as_json:
            self.stdout.write(json.dumps(result, indent=2, ensure_ascii=False))
            return

        # Salida formateada amigable
        self.stdout.write(self.style.MIGRATE_HEADING("=" * 64))
        self.stdout.write(self.style.MIGRATE_HEADING("MWT Dashboard · Diagnóstico de queries"))
        self.stdout.write(self.style.MIGRATE_HEADING("=" * 64))

        for name, entry in result.items():
            if name == "meta":
                continue
            self.stdout.write("")
            label = f"› {name}"
            if entry["error"]:
                self.stdout.write(self.style.ERROR(label))
                self.stdout.write(self.style.ERROR(f"   ERROR: {entry['error']}"))
            else:
                count = entry["count"]
                color = self.style.SUCCESS if count > 0 else self.style.WARNING
                self.stdout.write(color(f"{label}  count = {count}"))
                if entry["sample"]:
                    for i, row in enumerate(entry["sample"], 1):
                        self.stdout.write(f"   [{i}] {row}")

        self.stdout.write("")
        self.stdout.write(self.style.MIGRATE_HEADING("Meta:"))
        for k, v in result["meta"].items():
            self.stdout.write(f"   {k}: {v}")
        self.stdout.write("")

        # Diagnóstico interpretativo
        skus = result["top_skus_margen"]
        expo = result["exposicion_desde_lineas"]
        scat = result["scatter_margen_lineas"]
        if skus["error"]:
            self.stdout.write(self.style.ERROR(
                "DIAG: top_skus_margen FALLA con error. El endpoint devuelve [] por eso."
            ))
        elif skus["count"] == 0:
            self.stdout.write(self.style.WARNING(
                "DIAG: top_skus_margen sin filas — la BD NO tiene líneas activas con "
                "precio > 0. Si esperabas datos, revisa que expedientes.linea esté "
                "poblada con unit_price_mwt o unit_price_client."
            ))
        else:
            self.stdout.write(self.style.SUCCESS(
                f"DIAG: top_skus_margen OK · {skus['count']} SKUs. El endpoint "
                "/api/analytics/top_skus_margen/ debe devolver esto."
            ))
            self.stdout.write("DIAG: si el dashboard sigue vacío tras Ctrl+Shift+R,")
            self.stdout.write("DIAG: es bug del frontend al consumir la respuesta.")
            self.stdout.write("DIAG: chequear DevTools → Network → top_skus_margen → Response.")

        self.stdout.write("")
        self.stdout.write(self.style.MIGRATE_HEADING("=" * 64))
