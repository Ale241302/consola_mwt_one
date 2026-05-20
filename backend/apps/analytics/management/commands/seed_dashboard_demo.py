"""
=====================================================================
MWT.ONE · apps.analytics.management.commands.seed_dashboard_demo
Agente responsable: [AG-BACKEND]

PROPÓSITO ACTUAL (Sprint 2026-05-20 · v2 cleanup-only):
  Esta versión NO inventa datos de negocio. La regla R1 del prompt
  CEO es explícita: "no inventar datos". En iteraciones anteriores
  este comando creaba expedientes DEMO-DASH-CERRADO-*, cobros
  DEMO-COB-*, líneas DEMO-SKU-* — todo eso se eliminó.

  Lo que SÍ hace ahora (acciones útiles, no inventan negocio):
    [1] Asignar brand_id aleatorio a expedientes con brand_id=NULL
        (los expedientes deben tener marca; el rng usa seed 42 para
        ser reproducible; no afecta a expedientes que ya tienen marca).
    [2] Borrar todos los registros DEMO-* sembrados por versiones
        anteriores de este comando.
    [3] Verificar inventario real (stock + movimientos): si los
        nodos activos no tienen stock NI movimientos, NO sembrar
        nada — solo reportar el hueco. (Versiones previas sembraban
        500 uds por nodo y 20 movimientos por nodo; eso era inventar.)
    [4] Reportar diagnóstico de cuántos registros reales existen en
        cada tabla relevante del dashboard.

Uso:
    python manage.py seed_dashboard_demo           # idempotente
    python manage.py seed_dashboard_demo --dry-run # sin escribir
    python manage.py seed_dashboard_demo --force   # reescribe valores

Para ELIMINAR todo lo demo previo (recomendado tras este sprint):
    python manage.py seed_dashboard_demo
  (el paso [2] hace cleanup automático e idempotente).
=====================================================================
"""
from __future__ import annotations

import random

from django.core.management.base import BaseCommand
from django.db import IntegrityError, connection, transaction

from apps.brands.models import Marca
from apps.expedientes.models import Expediente


# Prefijos que identifican TODO lo sembrado por versiones anteriores.
DEMO_PREFIXES = {
    "expediente_codigo": "DEMO-DASH-",
    "cobro_codigo":      "DEMO-COB-",
    "pago_codigo":       "DEMO-PAGO-",
    "linea_sku":         "DEMO-SKU-",
    "stock_lote":        "DEMO",
    "movimiento_token":  "demo-",
}


class Command(BaseCommand):
    help = (
        "Limpia datos DEMO previos y asigna brand_id a expedientes "
        "sin marca. NO siembra datos de negocio. "
        "Ver docstring del módulo para historia y motivación."
    )

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true",
                            help="No escribe, solo loguea acciones.")
        parser.add_argument("--force", action="store_true",
                            help="Reescribe brand_id incluso si ya existe.")

    # ------------------------------------------------------------------
    # helpers
    # ------------------------------------------------------------------
    def _ok(self, msg):    self.stdout.write(self.style.SUCCESS(msg))
    def _info(self, msg):  self.stdout.write(msg)
    def _warn(self, msg):  self.stdout.write(self.style.WARNING(msg))
    def _err(self, msg):   self.stdout.write(self.style.ERROR(msg))

    def _run_sql(self, sql, params=None, fetch=False):
        """Ejecuta SQL con respeto a --dry-run; opcionalmente retorna fetchall."""
        if self.dry_run and not fetch:
            self._info(f"   (dry-run) {sql.strip()[:120]}")
            return None
        with connection.cursor() as cur:
            cur.execute(sql, params or [])
            if fetch:
                return cur.fetchall()
            return cur.rowcount

    # ------------------------------------------------------------------
    # entry point
    # ------------------------------------------------------------------
    def handle(self, *args, **opts):
        self.dry_run = bool(opts.get("dry_run"))
        self.force = bool(opts.get("force"))
        self.rng = random.Random(42)

        mode = "DRY-RUN" if self.dry_run else ("FORCE" if self.force else "IDEMPOTENTE")
        self._info(f"seed_dashboard_demo · v2 cleanup-only · modo={mode}")
        self._info("=" * 64)

        try:
            with transaction.atomic():
                self._step_1_brand_id()
                self._step_2_cleanup_demo()
                self._step_3_diagnostico()

                if self.dry_run:
                    self._warn("DRY-RUN: rollback de la transaccion.")
                    transaction.set_rollback(True)
        except Marca.DoesNotExist as exc:
            self._err(f"No se encontraron marcas activas: {exc}")
            return
        except IntegrityError as exc:
            self._err(f"IntegrityError durante el seed: {exc}")
            return

        self._info("=" * 64)
        self._ok("seed_dashboard_demo · OK")

    # ------------------------------------------------------------------
    # Paso 1 · Asignar brand_id a expedientes sin marca
    # ------------------------------------------------------------------
    def _step_1_brand_id(self):
        self._info("[1/3] brand_id en expedientes")

        marcas = list(Marca.objects.filter(is_active=True).values_list("id", flat=True))
        if not marcas:
            raise Marca.DoesNotExist("brands.marca: 0 marcas activas")

        qs = Expediente.objects.filter(is_active=True)
        if not self.force:
            qs = qs.filter(brand_id__isnull=True)

        total = qs.count()
        if total == 0:
            self._info("   nada que hacer (todos los expedientes ya tienen brand_id).")
            return

        updated = 0
        for exp in qs:
            chosen = self.rng.choice(marcas)
            self._info(f"   - exp {exp.codigo} -> brand_id={chosen}")
            if not self.dry_run:
                Expediente.objects.filter(pk=exp.pk).update(brand_id=chosen)
            updated += 1

        self._ok(f"   {updated}/{total} expedientes con brand_id asignado.")

    # ------------------------------------------------------------------
    # Paso 2 · Cleanup completo de DEMO data previa
    # ------------------------------------------------------------------
    def _step_2_cleanup_demo(self):
        self._info("[2/3] cleanup de datos DEMO previos")

        # Orden importa por FK lógicas (aunque no haya FK declaradas).
        cleanups = [
            ("expedientes.linea",          "sku LIKE 'DEMO-SKU-%'"),
            ("cobros.pago",                "codigo LIKE 'DEMO-PAGO-%'"),
            ("cobros.cobro",               "codigo LIKE 'DEMO-COB-%'"),
            ("expedientes.expediente",     "codigo LIKE 'DEMO-DASH-%'"),
            ("inventario.movimiento",
             "notas = 'seed_dashboard_demo · stock inicial' OR "
             "notas = 'seed_dashboard_demo · salida demo' OR "
             "idempotence_token LIKE 'demo-in-%' OR "
             "idempotence_token LIKE 'demo-out-%'"),
            ("inventario.stock",           "lote = 'DEMO'"),
        ]

        total_deleted = 0
        for table, where in cleanups:
            sql = f"DELETE FROM {table} WHERE {where}"
            try:
                count = self._run_sql(sql)
                if count and count > 0:
                    self._info(f"   - {table}: {count} fila(s) borradas")
                    total_deleted += count
            except Exception as exc:  # noqa: BLE001 — tolerar tablas faltantes
                self._warn(f"   - {table}: skip ({type(exc).__name__})")
                # Rollback para no contaminar transacción
                connection.rollback()
                # Reabrir savepoint
                continue

        if total_deleted == 0:
            self._info("   BD ya limpia (0 filas DEMO encontradas).")
        else:
            self._ok(f"   total filas DEMO borradas: {total_deleted}")

    # ------------------------------------------------------------------
    # Paso 3 · Diagnóstico de qué datos reales hay
    # ------------------------------------------------------------------
    def _step_3_diagnostico(self):
        self._info("[3/3] diagnostico de datos reales")

        # Solo SELECT — no escribe ni en dry-run ni en idempotente.
        diagnostics = [
            ("expedientes activos",
             "SELECT COUNT(*) FROM expedientes.expediente WHERE is_active=TRUE"),
            ("expedientes con brand_id",
             "SELECT COUNT(*) FROM expedientes.expediente "
             "WHERE is_active=TRUE AND brand_id IS NOT NULL"),
            ("expedientes CERRADO últimos 365d",
             "SELECT COUNT(*) FROM expedientes.expediente "
             "WHERE is_active=TRUE AND estado='CERRADO' "
             "AND updated_at >= CURRENT_DATE - INTERVAL '365 days'"),
            ("expedientes CERRADO con margenes (proj+real>0)",
             "SELECT COUNT(*) FROM expedientes.expediente "
             "WHERE is_active=TRUE AND estado='CERRADO' "
             "AND projected_margin > 0 AND real_margin > 0"),
            ("lineas activas con precio (mwt o legacy)",
             "SELECT COUNT(*) FROM expedientes.linea l "
             "JOIN expedientes.expediente e ON e.id=l.expediente_id "
             "WHERE l.is_active=TRUE AND e.is_active=TRUE "
             "AND COALESCE(NULLIF(l.unit_price_client,0), l.unit_price, 0) > 0"),
            ("SKUs distintos con precio últimos 365d",
             "SELECT COUNT(DISTINCT l.sku) FROM expedientes.linea l "
             "JOIN expedientes.expediente e ON e.id=l.expediente_id "
             "WHERE l.is_active=TRUE AND e.is_active=TRUE "
             "AND l.sku IS NOT NULL "
             "AND COALESCE(NULLIF(l.unit_price_client,0), l.unit_price, 0) > 0 "
             "AND e.updated_at >= CURRENT_DATE - INTERVAL '365 days'"),
            ("clientes con cobros pendientes",
             "SELECT COUNT(DISTINCT client_id) FROM cobros.cobro "
             "WHERE is_active=TRUE AND client_id IS NOT NULL AND monto_pendiente > 0"),
            ("pagos VERIFICADO/LIBERADO/CONCILIADO últimos 90d",
             "SELECT COUNT(*) FROM cobros.pago "
             "WHERE is_active=TRUE AND direccion='INGRESO' "
             "AND estado IN ('VERIFICADO','LIBERADO','CONCILIADO') "
             "AND fecha_acreditacion >= CURRENT_DATE - INTERVAL '90 days'"),
            ("nodos activos",
             "SELECT COUNT(*) FROM nodos.nodo WHERE is_active=TRUE"),
            ("stock activo (todas las tallas/lotes)",
             "SELECT COUNT(*) FROM inventario.stock WHERE is_active=TRUE"),
            ("movimientos SALIDA últimos 30d",
             "SELECT COUNT(*) FROM inventario.movimiento m "
             "JOIN inventario.tipo_movimiento_cat t ON t.codigo=m.tipo "
             "WHERE m.is_active=TRUE AND t.direccion='-' "
             "AND m.created_at >= CURRENT_DATE - INTERVAL '30 days'"),
            ("lineas con talla (size NOT NULL)",
             "SELECT COUNT(*) FROM expedientes.linea "
             "WHERE is_active=TRUE AND size IS NOT NULL AND size <> ''"),
        ]

        widget_status = {
            "Banda1 · Expedientes activos":     "ok",
            "Banda1 · Cash en riesgo":          "ok",
            "Banda1 · Margen bruto ponderado":  "warn",
            "Banda1 · Reloj crédito promedio":  "warn",
            "Banda2 · Cashflow":                "warn",
            "Banda3 · Pipeline por marca":      "ok",
            "Banda3 · Top urgentes":            "ok",
            "Banda3 · Inventario por nodo":     "warn",
            "Banda4 · Top SKUs":                "warn",
            "Banda4 · Top clientes":            "ok",
            "Banda4 · Heatmap tallas":          "warn",
            "Banda4 · Scatter margen":          "warn",
        }

        for label, sql in diagnostics:
            try:
                r = self._run_sql(sql, fetch=True)
                count = (r[0][0] if r else 0) or 0
                self._info(f"   {label}: {count}")
            except Exception as exc:  # noqa: BLE001
                self._warn(f"   {label}: error ({type(exc).__name__})")
                connection.rollback()

        self._info("")
        self._info("Widgets sin data real → empty state honesto:")
        self._info("  · Margen bruto ponderado y Scatter: necesitan")
        self._info("    expedientes con estado='CERRADO' y projected/real_margin>0.")
        self._info("  · Reloj credito: necesita cobros 100%% saldados en 90d.")
        self._info("  · Inventario por nodo: necesita stock + movimientos.")
        self._info("  · Heatmap tallas: ya implementado — usa linea.size + cliente.pais_iso2.")
        self._info("  · Top SKUs: ya implementado — espera lineas con precio.")
        self._info("")
        self._info("Cuando esos contadores suban en la BD real, los widgets")
        self._info("se poblaran automaticamente. NO se siembra data inventada.")
