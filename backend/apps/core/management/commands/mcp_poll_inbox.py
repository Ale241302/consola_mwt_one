"""
=====================================================================
MWT.ONE · apps.core.mcp_poll_inbox
Command para correr UNA pasada del pipeline de correo de onboarding MCP
a mano (dev/tests/cron): `python manage.py mcp_poll_inbox`.

Con --dry-run procesa pero NO mueve mensajes ni los marca como vistos.
=====================================================================
"""
from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError

from apps.core.mcp_mailbox import poll_once


class Command(BaseCommand):
    help = "Procesa los correos de mcp@mwt.one (una pasada)."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true",
                            help="Procesa sin marcar/mover mensajes.")
        parser.add_argument("--max", type=int, default=25,
                            help="Máximo de mensajes a procesar por pasada.")

    def handle(self, *args, **opts):
        try:
            summary = poll_once(max_messages=opts["max"], dry_run=opts["dry_run"])
        except Exception as exc:  # noqa: BLE001
            raise CommandError(f"mcp_poll_inbox falló: {exc}")

        self.stdout.write(f"[mcp_poll_inbox] {summary}")
        if summary.get("errors"):
            self.stderr.write(f"[mcp_poll_inbox] errores: {summary['errors']}")
        if summary.get("skipped"):
            self.stdout.write(self.style.WARNING(
                "Buzón no configurado: define MCP_MAILBOX_USER/PASSWORD."))
