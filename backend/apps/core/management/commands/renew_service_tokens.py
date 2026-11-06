"""
=====================================================================
MWT.ONE · apps.core.management.commands.renew_service_tokens

Corre la vigencia de los ServiceToken con `auto_renew = TRUE`.

Uso:
    python manage.py renew_service_tokens                 # barrido (lo que hace Celery)
    python manage.py renew_service_tokens --dry-run       # sólo lista
    python manage.py renew_service_tokens --token-id <uuid>
    python manage.py renew_service_tokens --days 120 --ahead-days 15

No emite secretos nuevos: sólo mueve `expires_at`. Para revocar un token
está `revoke_service_token`; para emitir uno nuevo, `mint_mcp_token`.
=====================================================================
"""
from __future__ import annotations

import uuid

from django.core.management.base import BaseCommand, CommandError
from django.db import connection

from apps.core.service_tokens import (
    DEFAULT_RENEW_DAYS,
    RENEW_AHEAD_DAYS,
    renew_due,
    renew_token,
)


class Command(BaseCommand):
    help = "Renueva la vigencia de los ServiceToken auto-renovables."

    def add_arguments(self, parser):
        parser.add_argument(
            "--token-id",
            default=None,
            help="Renueva sólo este token (UUID). Sin esto, barre todos los que vencen pronto.",
        )
        parser.add_argument(
            "--days",
            type=int,
            default=DEFAULT_RENEW_DAYS,
            help=f"Días de vigencia que se otorgan (default {DEFAULT_RENEW_DAYS}).",
        )
        parser.add_argument(
            "--ahead-days",
            type=int,
            default=RENEW_AHEAD_DAYS,
            help=f"Renueva los que vencen en menos de N días (default {RENEW_AHEAD_DAYS}).",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="No escribe: sólo muestra qué se renovaría.",
        )

    def handle(self, *args, **opts):
        days = int(opts["days"])
        ahead = int(opts["ahead_days"])
        if days < 1 or ahead < 0:
            raise CommandError("--days debe ser >= 1 y --ahead-days >= 0.")

        if opts["dry_run"]:
            self._dry_run(opts.get("token_id"), ahead)
            return

        token_id = opts.get("token_id")
        if token_id:
            try:
                uuid.UUID(str(token_id))
            except ValueError as exc:
                raise CommandError(f"--token-id no es UUID válido: {token_id}") from exc
            result = renew_token(token_id, days=days)
            if result["renewed"]:
                self.stdout.write(self.style.SUCCESS(
                    f"  renovado: {token_id} → expira {result['expires_at']}"
                ))
            else:
                raise CommandError(f"No renovable: {result['reason']}")
            return

        renewed = renew_due(days=days, ahead_days=ahead)
        if not renewed:
            self.stdout.write("  nada por renovar.")
            return
        for item in renewed:
            self.stdout.write(self.style.SUCCESS(
                f"  renovado: {item['name']} → expira {item['expires_at']}"
            ))
        self.stdout.write(self.style.SUCCESS(f"  total: {len(renewed)}"))

    def _dry_run(self, token_id, ahead):
        sql = """
            SELECT id, name, expires_at, auto_renew
              FROM core.service_token
             WHERE is_active = TRUE AND revoked_at IS NULL
               AND expires_at > now()
               AND expires_at < now() + make_interval(days => %s)
        """
        params = [ahead]
        if token_id:
            sql += " AND id = %s"
            params.append(token_id)
        sql += " ORDER BY expires_at"

        with connection.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall() or []

        if not rows:
            self.stdout.write("  nada por renovar.")
            return
        for row in rows:
            flag = "" if row[3] else "  (auto_renew=FALSE → NO se renueva)"
            self.stdout.write(f"  {row[1]}  vence {row[2]}{flag}")
