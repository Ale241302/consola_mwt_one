"""
=====================================================================
MWT.ONE · apps.expedientes.expediente_envio_backfill
Comando de backfill del artefacto de envío (AWB/BL) desde un CSV.

Uso:
  python manage.py expediente_envio_backfill --csv FECHAS_EMBARQUE_2026.csv [--dry-run]

CSV (header): expediente_id,tracking,carrier,etd,eta,origen,destino
  expediente_id: UUID del expediente (resuélvelo antes con expediente_buscar/proforma).
  · backfill actualiza el field-XXXX del ARTEFACTO de envío (fuente de verdad).
  · NO toca la cabecera del expediente.
  · Si el expediente no tiene artefacto de envío, lo marca en el reporte.
=====================================================================
"""
from __future__ import annotations

import csv
import sys

from django.core.management.base import BaseCommand, CommandError

from apps.expedientes.envio_backfill import backfill_envio, resolve_pf


class Command(BaseCommand):
    help = "Backfill del artefacto de envío (AWB/BL) desde un CSV."

    def add_arguments(self, parser):
        parser.add_argument("--csv", required=True, help="Ruta del CSV (expediente_id o pf, tracking,carrier,etd,eta,origen,destino)")
        parser.add_argument("--dry-run", action="store_true", help="Solo reporta; no escribe.")
        parser.add_argument("--emit-map", action="store_true", help="Imprime pf,expediente_id resueltos (para completar el mapeo).")

    def handle(self, *args, **opts):
        path = opts["csv"]
        ok = 0
        errors: list[str] = []
        unresolved: list[str] = []
        try:
            with open(path, encoding="utf-8-sig", newline="") as f:
                reader = csv.DictReader(f)
                for i, row in enumerate(reader, start=2):
                    pf = (row.get("pf") or "").strip()
                    eid = (row.get("expediente_id") or "").strip()
                    if not eid:
                        eid, why = resolve_pf(pf)
                        if not eid:
                            unresolved.append(f"{pf or '?'} (fila {i}): {why}")
                            continue
                        if opts["emit_map"]:
                            self.stdout.write(f"{pf},{eid}   # {why}")
                            continue
                    if opts["dry_run"]:
                        self.stdout.write(f"[dry] {eid} → { {k: row.get(k) for k in ('tracking','carrier','etd','eta','origen','destino') if (row.get(k) or '').strip()} }")
                        ok += 1
                        continue
                    res = backfill_envio(
                        eid,
                        tracking=(row.get("tracking") or "").strip() or None,
                        carrier=(row.get("carrier") or "").strip() or None,
                        etd=(row.get("etd") or "").strip() or None,
                        eta=(row.get("eta") or "").strip() or None,
                        origen=(row.get("origen") or "").strip() or None,
                        destino=(row.get("destino") or "").strip() or None,
                    )
                    if res.get("ok"):
                        ok += 1
                        self.stdout.write(self.style.SUCCESS(
                            f"[OK] {eid} · artefacto {res.get('artifact')} · updated {res.get('updated')}"))
                    else:
                        errors.append(f"{eid}: {res.get('detail')}")
        except FileNotFoundError as e:
            raise CommandError(f"CSV no encontrado: {path}") from e
        except Exception as e:
            raise CommandError(f"Error leyendo CSV: {e}") from e

        if opts["emit_map"]:
            if unresolved:
                self.stdout.write("\n== NO resueltos (completá expediente_id) ==")
                for u in unresolved:
                    self.stdout.write("  " + u)
            self.stdout.write("\n== Fin del mapa ==")
            return
        self.stdout.write(f"\n== Resumen ==\n  OK: {ok}\n  Con errores: {len(errors)}\n  No resueltos (sin expediente_id): {len(unresolved)}")
        for e in errors:
            self.stderr.write("  - " + e)
        if errors:
            sys.exit(1)
