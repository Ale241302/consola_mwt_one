"""
=====================================================================
MWT.ONE · apps.core.management.commands.revoke_service_token
Agente responsable: [AG-BACKEND]
Ola 1 — F3: revoca un ServiceToken sin rotar DJANGO_SECRET_KEY.

Uso:
    python manage.py revoke_service_token <id-uuid>
    python manage.py revoke_service_token --name mcp-gateway-prod
=====================================================================
"""
from __future__ import annotations

import uuid

from django.core.management.base import BaseCommand, CommandError
from django.db import connection


class Command(BaseCommand):
    help = "Revoca un ServiceToken por id o por nombre."

    def add_arguments(self, parser):
        parser.add_argument(
            "token_id",
            nargs="?",
            help="UUID del token a revocar.",
        )
        parser.add_argument(
            "--name",
            help="Revocar el token activo con este nombre (usa el más reciente).",
        )

    def handle(self, *args, **opts):
        token_id = opts.get("token_id")
        name = opts.get("name")

        if not token_id and not name:
            raise CommandError("Debes pasar un token_id o --name.")

        with connection.cursor() as cur:
            if token_id:
                try:
                    uuid.UUID(token_id)
                except ValueError as exc:
                    raise CommandError(f"token_id no es UUID: {token_id}") from exc
                cur.execute(
                    "UPDATE core.service_token SET revoked_at = NOW() WHERE id = %s AND revoked_at IS NULL",
                    [token_id],
                )
            else:
                cur.execute(
                    """
                    UPDATE core.service_token
                       SET revoked_at = NOW()
                     WHERE name = %s
                       AND is_active = TRUE
                       AND revoked_at IS NULL
                     ORDER BY created_at DESC
                     LIMIT 1
                    """,
                    [name],
                )
            count = cur.rowcount

        if count == 0:
            self.stdout.write(self.style.WARNING("No se revocó ningún token (ya estaba revocado o no existe)."))
        else:
            self.stdout.write(self.style.SUCCESS(f"Token revocado ({count} fila(s))."))
