"""
=====================================================================
MWT.ONE · apps.core.management.commands.mint_mcp_token
Agente responsable: [AG-BACKEND]
Ola 1 — F3: emite un ServiceToken opaco para el MCP gateway u otros
servicios internos.

El token se guarda como SHA-256 en core.service_token; scopes y client_ids
como filas en core.service_token_scope. Revocar no requiere rotar
DJANGO_SECRET_KEY.

Uso:
    python manage.py mint_mcp_token --name mcp-gateway-prod --scopes mcp:read,mcp:token_exchange
    python manage.py mint_mcp_token --name mcp-gateway-prod --scopes mcp:* --client-ids <uuid1>,<uuid2>
    python manage.py mint_mcp_token --name mcp-gateway-prod --scopes mcp:* --expires-days 30

Salida:
    MWT_MCP_SERVICE_TOKEN=<token-opaco-64-hex>
=====================================================================
"""
from __future__ import annotations

import os
import secrets
import uuid
from datetime import timedelta

from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction
from django.utils import timezone


DEFAULT_SCOPES = "mcp:read,mcp:token_exchange"
DEFAULT_DAYS = 30
MAX_DAYS = 90


def _parse_uuid_list(s: str | None) -> list[str]:
    if not s:
        return []
    out = []
    for part in s.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            uuid.UUID(part)
        except ValueError as exc:
            raise CommandError(f"client-id no es UUID válido: {part}") from exc
        out.append(part.lower())
    return out


class Command(BaseCommand):
    help = "Emite un ServiceToken opaco para servicios MCP (gateway, etc.)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--name",
            required=True,
            help="Nombre descriptivo del token (ej. mcp-gateway-prod).",
        )
        parser.add_argument(
            "--scopes",
            default=DEFAULT_SCOPES,
            help=f"Scopes separados por coma (default: {DEFAULT_SCOPES}).",
        )
        parser.add_argument(
            "--client-ids",
            default=None,
            help="UUIDs de clientes permitidos separados por coma (default: todos).",
        )
        parser.add_argument(
            "--expires-days",
            type=int,
            default=DEFAULT_DAYS,
            help=f"Días de vida (default {DEFAULT_DAYS}, máximo {MAX_DAYS}).",
        )
        parser.add_argument(
            "--created-by",
            default=None,
            help="UUID del usuario que crea el token (opcional, para auditoría).",
        )
        parser.add_argument(
            "--quiet",
            action="store_true",
            help="Imprime solo MWT_MCP_SERVICE_TOKEN=<token>.",
        )

    def handle(self, *args, **opts):
        name = (opts["name"] or "").strip()
        if not name:
            raise CommandError("--name es obligatorio.")

        days = int(opts["expires_days"] or DEFAULT_DAYS)
        if days < 1 or days > MAX_DAYS:
            raise CommandError(f"--expires-days debe estar entre 1 y {MAX_DAYS}.")

        scopes = [s.strip() for s in (opts["scopes"] or "").split(",") if s.strip()]
        if not scopes:
            raise CommandError("Debes especificar al menos un scope.")

        client_ids = _parse_uuid_list(opts.get("client_ids"))
        created_by = _parse_uuid_list(opts.get("created_by") or "")
        created_by_uuid = created_by[0] if created_by else None

        # Token opaco de 64 caracteres hexadecimales (256 bits).
        token = secrets.token_hex(32)
        token_hash = _hash_token(token)
        expires_at = (timezone.now() + timedelta(days=days)).replace(microsecond=0)

        token_id = uuid.uuid4()
        with transaction.atomic():
            with connection.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO core.service_token
                        (id, name, token_hash, role_slug, is_active, expires_at, created_by_id, created_at, updated_at)
                    VALUES (%s, %s, %s, 'service', TRUE, %s, %s, NOW(), NOW())
                    """,
                    [token_id, name, token_hash, expires_at, created_by_uuid],
                )
                for scope in scopes:
                    if client_ids:
                        for cid in client_ids:
                            cur.execute(
                                """
                                INSERT INTO core.service_token_scope
                                    (id, service_token_id, scope, client_id)
                                VALUES (gen_random_uuid(), %s, %s, %s)
                                """,
                                [token_id, scope, cid],
                            )
                    else:
                        cur.execute(
                            """
                            INSERT INTO core.service_token_scope
                                (id, service_token_id, scope, client_id)
                            VALUES (gen_random_uuid(), %s, %s, NULL)
                            """,
                            [token_id, scope],
                        )

        if opts["quiet"]:
            self.stdout.write(f"MWT_MCP_SERVICE_TOKEN={token}")
            return

        self.stdout.write(self.style.SUCCESS("== MWT.ONE — ServiceToken emitido =="))
        self.stdout.write(f"  id         : {token_id}")
        self.stdout.write(f"  name       : {name}")
        self.stdout.write(f"  scopes     : {', '.join(scopes)}")
        self.stdout.write(f"  client_ids : {', '.join(client_ids) if client_ids else '(todos)'}")
        self.stdout.write(f"  expires_at : {expires_at.isoformat()}")
        self.stdout.write("")
        self.stdout.write("  TOKEN (guardalo como MWT_MCP_SERVICE_TOKEN en el .env del MCP):")
        self.stdout.write("")
        self.stdout.write(token)
        self.stdout.write("")
        self.stdout.write(
            self.style.WARNING(
                "  Trata este token como secreto. Para revocarlo: "
                "python manage.py revoke_service_token <id>"
            )
        )


def _hash_token(token: str) -> str:
    import hashlib
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
