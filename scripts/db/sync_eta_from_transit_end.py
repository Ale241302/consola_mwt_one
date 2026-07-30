"""
=====================================================================
Sincroniza expediente.eta con phase_durations_json.TRANSITO.end.
Sprint 2026-07-30 · Uso:
  python scripts/db/sync_eta_from_transit_end.py --dry-run
  python scripts/db/sync_eta_from_transit_end.py
=====================================================================
"""
import argparse
import json
import os
import sys

import django

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "backend"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from apps.expedientes.models import Expediente


def parse_date(value):
    from datetime import date, datetime
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, str):
        try:
            return date.fromisoformat(value)
        except ValueError:
            return None
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    updated = 0
    for exp in Expediente.objects.filter(is_active=True, eta__isnull=True):
        pd = exp.phase_durations_json or {}
        if isinstance(pd, str):
            try:
                pd = json.loads(pd)
            except Exception:
                pd = {}
        transit = pd.get("TRANSITO") or {}
        end = parse_date(transit.get("end"))
        if not end:
            continue
        print(f"{exp.codigo} · eta NULL → {end.isoformat()}")
        if not args.dry_run:
            exp.eta = end
            exp.save(update_fields=["eta", "updated_at"])
        updated += 1

    print(f"\nTotal: {updated} expediente(s) {'(dry-run)' if args.dry_run else 'actualizados'}.")


if __name__ == "__main__":
    main()
