"""
=====================================================================
MWT.ONE · apps.core.management.commands.list_service_tokens
Agente responsable: [AG-BACKEND]
Ola 1 — F3: lista ServiceTokens activos/no revocados.

Uso:
    python manage.py list_service_tokens
    python manage.py list_service_tokens --revoked
    python manage.py list_service_tokens --name mcp-gateway-prod
=====================================================================
"""
from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db import connection


class Command(BaseCommand):
    help = "Lista ServiceTokens."

    def add_arguments(self, parser):
        parser.add_argument(
            "--revoked",
            action="store_true",
            help="Incluir tokens revocados.",
        )
        parser.add_argument(
            "--name",
            help="Filtrar por nombre.",
        )

    def handle(self, *args, **opts):
        where = []
        params = []
        if not opts["revoked"]:
            where.append("revoked_at IS NULL")
        if opts["name"]:
            where.append("name = %s")
            params.append(opts["name"])

        sql = """
            SELECT t.id, t.name, t.role_slug, t.expires_at, t.revoked_at,
                   t.last_used_at, t.created_at,
                   COALESCE(array_agg(DISTINCT s.scope) FILTER (WHERE s.scope IS NOT NULL), '{}') AS scopes,
                   COALESCE(array_agg(DISTINCT s.client_id) FILTER (WHERE s.client_id IS NOT NULL), '{}') AS client_ids
            FROM core.service_token t
            LEFT JOIN core.service_token_scope s ON s.service_token_id = t.id
        """
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " GROUP BY t.id ORDER BY t.created_at DESC"

        with connection.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()

        if not rows:
            self.stdout.write("No hay tokens." if not opts["revoked"] else "No hay tokens (incluyendo revocados).")
            return

        for row in rows:
            tid, name, role, exp, rev, used, created, scopes, client_ids = row
            status = "REVOKED" if rev else ("EXPIRED" if exp and exp < __import__('datetime').datetime.now(__import__('datetime').timezone.utc) else "ACTIVE")
            self.stdout.write(
                f"{status:<8} | {name:<30} | {role:<10} | exp={exp:%Y-%m-%d} | "
                f"scopes={', '.join(scopes)} | clients={len(client_ids)} | id={tid}"
            )
