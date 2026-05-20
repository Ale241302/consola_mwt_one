"""
=====================================================================
MWT.ONE · apps.analytics.management.commands.seed_dashboard_demo
Agente responsable: [AG-BACKEND]

ATENCION — DEMO DATA, NO PRODUCCION.
Este comando rellena los campos NULL que los endpoints del dashboard
CEO esperan, para que la UI deje de mostrar estados vacios mientras
el pipeline real de ingestion termina de cargar datos.

Comportamiento:
  · Idempotente por defecto: solo escribe campos que estan en NULL o
    crea filas que no existen (matchea por codigo / referencias).
  · --dry-run  : no escribe, solo loguea cada accion.
  · --force    : reescribe valores incluso si ya tienen datos.

Para PRODUCCION REAL se requiere:
  · Migraciones de columnas faltantes (si las hay) sobre los SQL puros.
  · Ingestion real desde OCs cerradas, conciliaciones bancarias y el
    motor de inventario (movimientos OUT validados).
  · Borrar / archivar las filas que este comando genera (estan
    marcadas con codigos prefijados DEMO- para facilitar el cleanup).

Uso:
    python manage.py seed_dashboard_demo
    python manage.py seed_dashboard_demo --dry-run
    python manage.py seed_dashboard_demo --force
=====================================================================
"""
from __future__ import annotations

import random
import uuid
from datetime import timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import IntegrityError, connection, transaction
from django.utils import timezone

from apps.brands.models import Marca
from apps.clientes.models import Cliente
from apps.cobros.models import Cobro, Pago
from apps.expedientes.models import Expediente
from apps.inventario.models import Movimiento
from apps.nodos.models import Nodo


# ─────────────────────────────────────────────────────────────────────
# Helpers · INSERT/UPDATE de Cobro y Pago con SQL crudo.
# Razón: `cobros.cobro.monto_pendiente` y `cobros.pago.monto_neto_usd`
# son columnas GENERATED ALWAYS AS ... STORED en Postgres (ver
# backend/sql/80_cobros.sql:78 y 81_cobros_audit.sql:47). El ORM de
# Django incluye esas columnas en el INSERT a partir del default del
# modelo, lo que rompe la inserción con
#   "cannot insert a non-DEFAULT value into column 'monto_pendiente'".
# Por eso bypassamos el ORM para estas dos tablas.
# ─────────────────────────────────────────────────────────────────────
COBRO_COLUMNS = [
    "id", "codigo", "oc_id", "expediente_id", "client_id", "moneda",
    "monto_total", "monto_pagado",
    "fecha_vencimiento", "dias_credito", "estado", "notas", "visibility_tier",
    "dias_mora", "bucket_mora", "intereses_mora_usd", "tasa_mora_anual",
    "collection_stage", "last_reminder_at",
    "is_active", "created_at", "updated_at",
]

PAGO_COLUMNS = [
    "id", "codigo", "direccion", "cobro_id", "oc_id", "expediente_id",
    "client_id", "proveedor_id", "metodo", "referencia_externa",
    "banco_origen", "banco_destino", "moneda", "monto", "fx_rate",
    "monto_usd", "estado", "fecha_operacion", "fecha_acreditacion",
    "verificado_at", "verificado_by", "liberado_at", "conciliado_at",
    "comprobante_url", "notas", "visibility_tier",
    "external_id", "bank_statement_id", "fx_source", "fx_rate_date",
    "withholding_usd", "fees_bank_usd",
    "is_active", "created_at", "updated_at",
]


def _raw_upsert(table: str, columns: list, payload: dict, key_col: str = "codigo") -> None:
    """INSERT con ON CONFLICT (key_col) DO UPDATE para evitar las columnas generadas.

    Postgres maneja la columna generada automáticamente al recalcular sobre
    los valores nuevos de monto_total/monto_pagado.
    """
    cols = [c for c in columns if c in payload]
    placeholders = ", ".join(["%s"] * len(cols))
    col_list = ", ".join(f'"{c}"' for c in cols)
    update_set = ", ".join(f'"{c}" = EXCLUDED."{c}"' for c in cols if c != key_col and c != "id")
    sql = (
        f'INSERT INTO {table} ({col_list}) VALUES ({placeholders}) '
        f'ON CONFLICT ("{key_col}") DO UPDATE SET {update_set}'
    )
    values = [payload[c] for c in cols]
    with connection.cursor() as cur:
        cur.execute(sql, values)


def _raw_exists(table: str, key_col: str, key_val) -> bool:
    with connection.cursor() as cur:
        cur.execute(f'SELECT 1 FROM {table} WHERE "{key_col}" = %s LIMIT 1', [key_val])
        return cur.fetchone() is not None


DEMO_CODIGO_PREFIX = "DEMO-DASH-"
DEMO_COBRO_PREFIX = "DEMO-COB-"
DEMO_PAGO_PREFIX = "DEMO-PAGO-"


class Command(BaseCommand):
    help = (
        "Rellena campos NULL en expedientes/cobros/inventario para que "
        "el dashboard CEO deje de mostrar estados vacios. DEMO DATA."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="No escribe, solo loguea las acciones.",
        )
        parser.add_argument(
            "--force",
            action="store_true",
            help="Reescribe valores incluso si no son NULL.",
        )

    # ------------------------------------------------------------------
    # helpers
    # ------------------------------------------------------------------
    def _ok(self, msg: str) -> None:
        self.stdout.write(self.style.SUCCESS(msg))

    def _info(self, msg: str) -> None:
        self.stdout.write(msg)

    def _warn(self, msg: str) -> None:
        self.stdout.write(self.style.WARNING(msg))

    def _err(self, msg: str) -> None:
        self.stdout.write(self.style.ERROR(msg))

    def _has_field(self, model, field_name: str) -> bool:
        return field_name in {f.name for f in model._meta.get_fields() if hasattr(f, "name")}

    # ------------------------------------------------------------------
    # entry point
    # ------------------------------------------------------------------
    def handle(self, *args, **opts):
        self.dry_run: bool = bool(opts.get("dry_run"))
        self.force: bool = bool(opts.get("force"))
        self.rng = random.Random(42)

        mode = "DRY-RUN" if self.dry_run else ("FORCE" if self.force else "IDEMPOTENTE")
        self._info(f"seed_dashboard_demo · modo={mode}")
        self._info("=" * 64)

        try:
            with transaction.atomic():
                self._step_1_brand_id()
                cerrados = self._step_2_expedientes_cerrados()
                self._step_3_cobros_pagados(cerrados)
                self._step_4_top_clientes()
                self._step_5_inventario_movimientos()
                self._step_6_skus_ranking()

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
    def _step_1_brand_id(self) -> None:
        self._info("[1/6] brand_id en expedientes")

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
    # Paso 2 · Expedientes CERRADOs para margen ponderado / scatter
    # ------------------------------------------------------------------
    def _step_2_expedientes_cerrados(self) -> list[Expediente]:
        self._info("[2/6] expedientes CERRADO con margen real/proyectado")

        required = ["estado", "total_cost", "total_invoiced", "projected_margin", "real_margin", "updated_at"]
        missing = [f for f in required if not self._has_field(Expediente, f)]
        if missing:
            self._warn(f"   WARNING: Expediente no tiene columnas {missing}. paso omitido.")
            return []

        marcas = list(Marca.objects.filter(is_active=True).values_list("id", flat=True))
        if not marcas:
            self._warn("   WARNING: no hay marcas activas. paso omitido.")
            return []

        now = timezone.now()
        targets = [
            {
                "codigo": f"{DEMO_CODIGO_PREFIX}CERRADO-001",
                "real_margin": Decimal("0.18"),
                "delta_days": 30,
            },
            {
                "codigo": f"{DEMO_CODIGO_PREFIX}CERRADO-002",
                "real_margin": Decimal("0.22"),
                "delta_days": 60,
            },
        ]

        cerrados: list[Expediente] = []
        for spec in targets:
            exp = Expediente.objects.filter(codigo=spec["codigo"]).first()
            updated_at_target = now - timedelta(days=spec["delta_days"])

            values = {
                "estado": "CERRADO",
                "brand_id": self.rng.choice(marcas),
                "total_cost": Decimal("80000.00"),
                "total_invoiced": Decimal("100000.00"),
                "projected_margin": Decimal("0.20"),
                "real_margin": spec["real_margin"],
                "moneda": "USD",
                "is_active": True,
                "updated_at": updated_at_target,
            }

            if exp is None:
                values["id"] = uuid.uuid4()
                values["codigo"] = spec["codigo"]
                self._info(f"   - CREATE {spec['codigo']} (cerrado, margen={spec['real_margin']})")
                if not self.dry_run:
                    exp = Expediente.objects.create(**values)
                else:
                    exp = Expediente(**values)
            else:
                self._info(f"   - UPDATE {spec['codigo']} (cerrado, margen={spec['real_margin']})")
                if self.force or exp.real_margin is None or exp.projected_margin is None:
                    if not self.dry_run:
                        Expediente.objects.filter(pk=exp.pk).update(**values)

            cerrados.append(exp)

        self._ok(f"   {len(cerrados)} expedientes CERRADO listos.")
        return cerrados

    # ------------------------------------------------------------------
    # Paso 3 · Cobros + Pagos para "Reloj credito promedio"
    # ------------------------------------------------------------------
    def _step_3_cobros_pagados(self, cerrados: list[Expediente]) -> None:
        self._info("[3/6] cobros pagados (reloj de credito)")

        if not cerrados:
            self._warn("   sin expedientes CERRADO previos. paso omitido.")
            return

        now = timezone.now()
        created_cobros = 0
        created_pagos = 0

        for exp in cerrados:
            cobro_codigo = f"{DEMO_COBRO_PREFIX}{exp.codigo[-10:]}"
            cobro_existed = _raw_exists('cobros.cobro', 'codigo', cobro_codigo)
            cobro_created_at = (exp.updated_at or now) - timedelta(days=45)
            cobro_id = uuid.uuid4()

            cobro_payload = {
                "id": cobro_id,
                "codigo": cobro_codigo,
                "expediente_id": exp.id,
                "moneda": "USD",
                "monto_total": Decimal("10000.00"),
                "monto_pagado": Decimal("10000.00"),
                "estado": "PAGADO",
                "fecha_vencimiento": cobro_created_at.date() + timedelta(days=30),
                "dias_credito": 30,
                "is_active": True,
                "created_at": cobro_created_at,
                "updated_at": cobro_created_at,
                "visibility_tier": "INTERNAL",
                "dias_mora": 0,
                "intereses_mora_usd": Decimal("0.00"),
                "tasa_mora_anual": Decimal("0.00"),
                "collection_stage": "NONE",
            }

            if not cobro_existed:
                self._info(f"   - CREATE cobro {cobro_codigo}")
                if not self.dry_run:
                    _raw_upsert('cobros.cobro', COBRO_COLUMNS, cobro_payload)
                created_cobros += 1
            elif self.force:
                self._info(f"   - UPDATE cobro {cobro_codigo} (--force)")
                if not self.dry_run:
                    _raw_upsert('cobros.cobro', COBRO_COLUMNS, cobro_payload)
            else:
                self._info(f"   - skip cobro {cobro_codigo} (ya existe)")

            # Resolver el id real del cobro recién upserteado para enlazar el pago.
            if not self.dry_run:
                with connection.cursor() as cur:
                    cur.execute(
                        'SELECT id FROM cobros.cobro WHERE codigo = %s LIMIT 1',
                        [cobro_codigo],
                    )
                    row = cur.fetchone()
                    real_cobro_id = row[0] if row else cobro_id
            else:
                real_cobro_id = cobro_id

            pago_codigo = f"{DEMO_PAGO_PREFIX}{exp.codigo[-10:]}"
            pago_existed = _raw_exists('cobros.pago', 'codigo', pago_codigo)
            fecha_acred = (cobro_created_at + timedelta(days=30)).date()

            pago_payload = {
                "id": uuid.uuid4(),
                "codigo": pago_codigo,
                "direccion": "INGRESO",
                "cobro_id": real_cobro_id,
                "expediente_id": exp.id,
                "metodo": "TRANSFERENCIA",
                "moneda": "USD",
                "monto": Decimal("10000.00"),
                "monto_usd": Decimal("10000.00"),
                "fx_rate": Decimal("1.000000"),
                "estado": "VERIFICADO",
                "fecha_operacion": fecha_acred,
                "fecha_acreditacion": fecha_acred,
                "verificado_at": cobro_created_at + timedelta(days=30),
                "is_active": True,
                "created_at": cobro_created_at + timedelta(days=30),
                "updated_at": cobro_created_at + timedelta(days=30),
                "visibility_tier": "INTERNAL",
                "fx_source": "MANUAL",
                "withholding_usd": Decimal("0.00"),
                "fees_bank_usd": Decimal("0.00"),
            }

            if not pago_existed:
                self._info(f"   - CREATE pago {pago_codigo}")
                if not self.dry_run:
                    _raw_upsert('cobros.pago', PAGO_COLUMNS, pago_payload)
                created_pagos += 1
            elif self.force:
                self._info(f"   - UPDATE pago {pago_codigo} (--force)")
                if not self.dry_run:
                    _raw_upsert('cobros.pago', PAGO_COLUMNS, pago_payload)
            else:
                self._info(f"   - skip pago {pago_codigo} (ya existe)")

        self._ok(f"   cobros nuevos={created_cobros}, pagos nuevos={created_pagos}.")

    # ------------------------------------------------------------------
    # Paso 4 · Top 10 clientes / exposicion
    # ------------------------------------------------------------------
    def _step_4_top_clientes(self) -> None:
        self._info("[4/6] cobros con saldo para Top clientes")

        clientes = list(Cliente.objects.filter(is_active=True)[:5])
        if not clientes:
            self._warn("   WARNING: no hay clientes activos. paso omitido.")
            return

        now = timezone.now()
        created = 0
        for idx, cli in enumerate(clientes):
            n_cobros = self.rng.randint(1, 2)
            for j in range(n_cobros):
                codigo = f"{DEMO_COBRO_PREFIX}CLI-{idx:02d}-{j:02d}"
                existing = _raw_exists('cobros.cobro', 'codigo', codigo)

                monto = Decimal(self.rng.randint(5_000, 50_000))
                offset_days = self.rng.randint(10, 80)
                created_at = now - timedelta(days=offset_days)
                vencimiento = (created_at + timedelta(days=30)).date()

                payload = {
                    "id": uuid.uuid4(),
                    "codigo": codigo,
                    "client_id": cli.id,
                    "moneda": "USD",
                    "monto_total": monto,
                    "monto_pagado": Decimal("0.00"),
                    "estado": "PENDIENTE",
                    "fecha_vencimiento": vencimiento,
                    "dias_credito": 30,
                    "is_active": True,
                    "created_at": created_at,
                    "updated_at": created_at,
                    "visibility_tier": "INTERNAL",
                    "dias_mora": 0,
                    "intereses_mora_usd": Decimal("0.00"),
                    "tasa_mora_anual": Decimal("0.00"),
                    "collection_stage": "NONE",
                }

                if not existing:
                    self._info(f"   - CREATE cobro {codigo} cliente={cli.id} monto={monto}")
                    if not self.dry_run:
                        _raw_upsert('cobros.cobro', COBRO_COLUMNS, payload)
                    created += 1
                elif self.force:
                    self._info(f"   - UPDATE cobro {codigo} (--force)")
                    if not self.dry_run:
                        _raw_upsert('cobros.cobro', COBRO_COLUMNS, payload)
                else:
                    self._info(f"   - skip cobro {codigo} (ya existe)")

        self._ok(f"   {created} cobros nuevos con saldo pendiente.")

    # ------------------------------------------------------------------
    # Paso 5 · Movimientos de inventario por nodo (velocity_30d)
    # ------------------------------------------------------------------
    def _step_5_inventario_movimientos(self) -> None:
        self._info("[5/6] movimientos de inventario por nodo")

        required = ["tipo", "producto_id", "nodo_origen_id", "nodo_destino_id", "cantidad", "idempotence_token"]
        missing = [f for f in required if not self._has_field(Movimiento, f)]
        if missing:
            self._warn(f"   WARNING: Movimiento sin columnas {missing}. paso omitido.")
            return

        nodos = list(Nodo.objects.filter(is_active=True)[:5])
        if not nodos:
            self._warn("   WARNING: no hay nodos activos. paso omitido.")
            return

        now = timezone.now()
        producto_demo = uuid.UUID("00000000-0000-0000-0000-00000000d3m0")
        created_in = 0
        created_out = 0

        for nodo in nodos:
            # Movimiento IN inicial (stock ~500) — idempotente por token
            token_in = f"demo-in-{nodo.id}"
            existing_in = Movimiento.objects.filter(idempotence_token=token_in).first()
            if existing_in is None:
                self._info(f"   - CREATE IN nodo={nodo.codigo} qty=500")
                if not self.dry_run:
                    Movimiento.objects.create(
                        id=uuid.uuid4(),
                        tipo="ENTRADA",
                        motivo="RECEPCION",
                        producto_id=producto_demo,
                        nodo_destino_id=nodo.id,
                        lote="DEMO",
                        cantidad=Decimal("500.000"),
                        costo_unitario_usd=Decimal("10.0000"),
                        idempotence_token=token_in,
                        contexto_legal="DEMO",
                        notas="seed_dashboard_demo · stock inicial",
                        is_active=True,
                        created_at=now - timedelta(days=35),
                    )
                created_in += 1
            elif self.force:
                self._info(f"   - skip IN nodo={nodo.codigo} (ya existe; --force no recrea)")

            # ~20 movimientos OUT en los ultimos 30d
            for k in range(20):
                token_out = f"demo-out-{nodo.id}-{k:02d}"
                existing_out = Movimiento.objects.filter(idempotence_token=token_out).first()
                if existing_out is not None:
                    continue
                qty = Decimal(self.rng.randint(5, 15))
                offset = self.rng.randint(0, 29)
                created_at = now - timedelta(days=offset)
                self._info(f"   - CREATE OUT nodo={nodo.codigo} qty={qty} d-{offset}")
                if not self.dry_run:
                    Movimiento.objects.create(
                        id=uuid.uuid4(),
                        tipo="SALIDA",
                        motivo="VENTA",
                        producto_id=producto_demo,
                        nodo_origen_id=nodo.id,
                        lote="DEMO",
                        cantidad=qty,
                        costo_unitario_usd=Decimal("10.0000"),
                        idempotence_token=token_out,
                        contexto_legal="DEMO",
                        notas="seed_dashboard_demo · salida demo",
                        is_active=True,
                        created_at=created_at,
                    )
                created_out += 1

        self._ok(f"   movimientos IN={created_in}, OUT={created_out}.")

    # ------------------------------------------------------------------
    # Paso 6 · SKUs ranking (omitido por diseno)
    # ------------------------------------------------------------------
    def _step_6_skus_ranking(self) -> None:
        self._info("[6/6] SKUs ranking")
        self._warn(
            "   SKIP por diseno: requiere lineas de expediente con unit_cost/"
            "unit_price reales. Sembrar lineas falsas distorsiona el motor "
            "de margen. Documentar en CLAUDE.md cuando se cargue data real."
        )
