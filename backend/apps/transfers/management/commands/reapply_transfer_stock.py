"""
=====================================================================
MWT.ONE · transfers · reapply_transfer_stock
Agente: [AG-BACKEND]

Recorre las transferencias en estados terminales (IN_TRANSIT, RECEIVED,
DISCREPANCY, RECONCILED, CLOSED) y aplica los efectos de stock que NO
estuvieran ya registrados en `inventario.movimiento`.

Uso:
    docker compose exec django python manage.py reapply_transfer_stock
    docker compose exec django python manage.py reapply_transfer_stock --transfer-id <UUID>
    docker compose exec django python manage.py reapply_transfer_stock --dry-run

Idempotente — si los movimientos ya existen, no duplica.
=====================================================================
"""
from django.core.management.base import BaseCommand
from apps.transfers.models import Transferencia, Linea
from apps.transfers import services as transfer_services


class Command(BaseCommand):
    help = "Re-aplica los efectos de stock de transferencias ya cerradas (idempotente)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--transfer-id",
            type=str,
            default=None,
            help="UUID de una transferencia específica. Si se omite procesa todas.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="No escribe; solo reporta qué se aplicaría.",
        )

    # Estados desde los que se debe haber descontado del origen
    OUTBOUND_STATES = ("IN_TRANSIT", "RECEIVED", "DISCREPANCY", "RECONCILED", "CLOSED")
    # Estados desde los que se debe haber sumado al destino
    INBOUND_STATES  = ("RECEIVED", "DISCREPANCY", "RECONCILED", "CLOSED")

    def handle(self, *args, **opts):
        tid     = opts.get("transfer_id")
        dry_run = opts.get("dry_run", False)

        qs = Transferencia.objects.filter(is_active=True)
        if tid:
            qs = qs.filter(pk=tid)
        else:
            qs = qs.filter(estado__in=set(self.OUTBOUND_STATES))

        total_t   = 0
        total_out = 0
        total_in  = 0

        for t in qs:
            lineas = list(Linea.objects.filter(transferencia_id=t.id, is_active=True))
            if not lineas:
                self.stdout.write(f"  · {t.codigo} ({t.estado}): SIN LÍNEAS, skip")
                continue
            total_t += 1

            self.stdout.write(self.style.NOTICE(
                f"→ {t.codigo} [{t.estado}] origen={t.origen_label or t.origen_id} "
                f"destino={t.destino_label or t.destino_id} ({len(lineas)} líneas)"
            ))

            if dry_run:
                self.stdout.write("    (dry-run, no se escribe)")
                continue

            out_n = 0
            in_n  = 0
            if t.estado in self.OUTBOUND_STATES:
                out_n = transfer_services.apply_outbound_at_origin(t, lineas)
                total_out += out_n
            if t.estado in self.INBOUND_STATES:
                in_n = transfer_services.apply_inbound_at_destination(t, lineas)
                total_in += in_n

            if out_n == 0 and in_n == 0:
                self.stdout.write(self.style.WARNING(
                    "    YA ESTABA AL DÍA (idempotente — sin cambios)"
                ))
            else:
                self.stdout.write(self.style.SUCCESS(
                    f"    aplicadas: outbound={out_n}, inbound={in_n}"
                ))

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS(
            f"Resumen: {total_t} transferencia(s) procesada(s) · "
            f"{total_out} línea(s) outbound · {total_in} línea(s) inbound"
        ))
        if total_out == 0 and total_in == 0 and total_t > 0:
            self.stdout.write(self.style.WARNING(
                "Nada se aplicó. Causas comunes:\n"
                "  · Las líneas no tienen producto_id ni un SKU que matchee productos.producto.\n"
                "  · Los efectos ya estaban aplicados (idempotencia).\n"
                "Revisa los logs del container para ver warnings de '[transfer.inbound] producto sin resolver'."
            ))
