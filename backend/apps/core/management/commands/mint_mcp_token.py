# backend/apps/core/management/commands/mint_mcp_token.py
"""
Emite un AccessToken JWT de larga vida (para el servidor MCP de MWT.ONE),
autenticado como un usuario CEO/ADMIN existente en `core.users`.

El token se firma con el mismo DJANGO_SECRET_KEY que corre el contenedor `django`,
por lo que es aceptado por `apps.core.jwt_auth.MwtJWTAuthentication` sin ningún
mecanismo extra. Como no hay blacklist de access tokens, la única forma de revocar
este token es: (a) rotar DJANGO_SECRET_KEY, o (b) desactivar / soft-delete el
usuario en core.users (is_active=FALSE o deleted_at).

Uso:
    python manage.py mint_mcp_token --email alejandro@muitowork.com
    python manage.py mint_mcp_token --email alejandro@muitowork.com --days 36500
    python manage.py mint_mcp_token --email alejandro@muitowork.com --quiet   # solo el token
"""
from __future__ import annotations

from datetime import timedelta

from django.core.management.base import BaseCommand, CommandError
from django.db import connection
from rest_framework_simplejwt.tokens import AccessToken


class Command(BaseCommand):
    help = "Emite un AccessToken JWT de larga vida (MCP) para un usuario CEO/ADMIN de core.users."

    def add_arguments(self, parser):
        parser.add_argument(
            "--email",
            required=True,
            help="email_plain del usuario en core.users (ej. alejandro@muitowork.com)",
        )
        parser.add_argument(
            "--days",
            type=int,
            default=36500,  # ~100 años => 'sin vencimiento' a efectos prácticos
            help="Vida del token en días (default 36500 ~ 100 años).",
        )
        parser.add_argument(
            "--quiet",
            action="store_true",
            help="Imprime SOLO el token (sin banner), útil para capturarlo en un .env.",
        )

    def handle(self, *args, **opts):
        email_low = (opts["email"] or "").strip().lower()
        if not email_low:
            raise CommandError("Debes pasar --email.")

        # 1) Resolver usuario en core.users (mismo patrón que apps.core.auth_views).
        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT u.id::text,
                       u.email_plain,
                       u.role,
                       u.is_active,
                       COALESCE(r.slug, u.role) AS role_slug
                  FROM core.users u
                  LEFT JOIN core.user_roles ur ON ur.user_uuid = u.id
                  LEFT JOIN core.roles      r  ON r.id          = ur.role_uuid
                 WHERE lower(u.email_plain) = %s
                   AND u.deleted_at IS NULL
                 ORDER BY ur.granted_at ASC NULLS LAST
                 LIMIT 1
                """,
                [email_low],
            )
            row = cur.fetchone()

        if not row:
            raise CommandError(
                f"Usuario '{email_low}' no existe en core.users o está borrado (deleted_at)."
            )

        uid, email, role_str, is_active, role_slug = row
        if not is_active:
            raise CommandError(f"Usuario '{email_low}' está inactivo (is_active=FALSE).")

        role = role_slug or role_str
        if role not in ("admin", "superadmin"):
            self.stderr.write(
                self.style.WARNING(
                    f"AVISO: el rol '{role}' NO es admin/superadmin; el token quedara "
                    f"limitado por RoleBasedPermission en vistas con required_module."
                )
            )

        # 2) Construir el AccessToken a mano (NO usar for_user: no hay auth.User en este repo).
        token = AccessToken()
        token["user_uuid"] = str(uid)   # claim obligatorio (USER_ID_CLAIM)
        token["email"] = email
        token["role"] = role            # leido por RoleBasedPermission
        token["mcp"] = True             # marca de origen (auditoria)
        token.set_exp(lifetime=timedelta(days=int(opts["days"])))

        token_str = str(token)

        if opts["quiet"]:
            self.stdout.write(token_str)
            return

        self.stdout.write(self.style.SUCCESS("== MWT.ONE — MCP service token =="))
        self.stdout.write(f"  usuario : {email}")
        self.stdout.write(f"  user_id : {uid}")
        self.stdout.write(f"  rol     : {role}")
        self.stdout.write(f"  vida    : {opts['days']} dias")
        self.stdout.write("")
        self.stdout.write("  TOKEN (guardalo como MWT_MCP_TOKEN en el .env del MCP):")
        self.stdout.write("")
        self.stdout.write(token_str)
        self.stdout.write("")
        self.stdout.write(
            self.style.WARNING(
                "  Trata este token como secreto. Para revocarlo: rota DJANGO_SECRET_KEY "
                "o desactiva el usuario en core.users."
            )
        )
