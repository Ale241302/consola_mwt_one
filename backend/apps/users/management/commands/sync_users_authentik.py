"""
=====================================================================
MWT.ONE · apps.users.management.commands.sync_users_authentik
Sync consola → Authentik (IdP del MCP) — backfill y reparación.

Uso (en el contenedor django del VPS):
    python manage.py sync_users_authentik
        · Crea/actualiza en Authentik todos los usuarios activos de la
          consola (metadata: name, is_active). NO toca passwords.

    python manage.py sync_users_authentik --set-password email=clave
        · Igual que arriba + setea esa password en claro en Authentik.
          Repetible para cada usuario cuyo password el admin conozca.

    python manage.py sync_users_authentik --email alejandro@muitowork.com
        · Solo un usuario (con o sin --set-password).

Fail-safe: si Authentik no está configurado (AUTHENTIK_API_URL/TOKEN),
informa y termina sin romper nada.
=====================================================================
"""
from __future__ import annotations

from django.core.management.base import BaseCommand

from apps.users import authentik_sync


class Command(BaseCommand):
    help = "Sincroniza usuarios de la consola hacia Authentik (IdP del MCP)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--email", default=None, help="Sincronizar solo este email.",
        )
        parser.add_argument(
            "--set-password", action="append", default=[],
            metavar="EMAIL=CLAVE",
            help="Setea esa password en claro en Authentik para ese usuario. "
                 "Se puede repetir (uno por usuario).",
        )
        parser.add_argument(
            "--dry-run", action="store_true",
            help="No llama a Authentik; solo muestra lo que haría.",
        )

    def handle(self, *args, **opts):
        from django.db import connection

        if not authentik_sync._enabled():
            self.stdout.write(self.style.WARNING(
                "AUTHENTIK_API_URL / AUTHENTIK_API_TOKEN no configurados. "
                "No se sincroniza nada."
            ))
            return

        dry = opts["dry_run"]
        pwd_map: dict[str, str] = {}
        for item in opts["set_password"]:
            if "=" not in item:
                self.stderr.write(f"Ignorando --set-password mal formado: {item!r}")
                continue
            email, _, clave = item.partition("=")
            pwd_map[email.strip().lower()] = clave

        # Cargar usuarios de la consola (core.users es la tabla de auth real;
        # mwtuser es el perfil rico. Tomamos email+full_name+is_active).
        rows = []
        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT u.email_plain, u.full_name, u.is_active, u.deleted_at
                  FROM core.users u
                 WHERE u.deleted_at IS NULL
                 ORDER BY u.email_plain
                """
            )
            rows = [
                {"email": r[0], "full_name": r[1] or "", "is_active": bool(r[2])}
                for r in cur.fetchall()
            ]
            # Perfil rico (nombre completo de mwtuser) cuando existe.
            try:
                cur.execute(
                    "SELECT email_plain, full_name FROM users.mwtuser WHERE is_active = TRUE"
                )
                for r in cur.fetchall():
                    for row in rows:
                        if row["email"].lower() == (r[0] or "").strip().lower() and r[1]:
                            row["full_name"] = r[1]
            except Exception:  # noqa: BLE001 - users.mwtuser puede no existir
                pass

        if opts["email"]:
            target = (opts["email"] or "").strip().lower()
            rows = [r for r in rows if r["email"].lower() == target]

        self.stdout.write(f"Sincronizando {len(rows)} usuarios hacia Authentik "
                          f"(dry_run={dry})...")

        for row in rows:
            email = row["email"].lower()
            pwd = pwd_map.get(email)
            if dry:
                self.stdout.write(f"  [dry] {email}: ensure_user(name={row['full_name']!r}, "
                                  f"is_active={row['is_active']})"
                                  + (f" + set_password" if pwd else ""))
                continue
            user = authentik_sync.ensure_user(
                email=email, full_name=row["full_name"], is_active=row["is_active"],
            )
            if pwd:
                ok = authentik_sync.set_password(email, pwd)
                self.stdout.write(f"  {email}: ensure={'OK' if user else 'FALLÓ'} "
                                  f"· set_password={'OK' if ok else 'FALLÓ'}")
            else:
                self.stdout.write(f"  {email}: ensure={'OK' if user else 'FALLÓ'}")

        # Emails que pidieron password pero no están en la consola.
        for email in pwd_map:
            if email not in {r["email"].lower() for r in rows}:
                self.stdout.write(self.style.WARNING(
                    f"  {email}: no está en core.users (no se sincroniza password)."
                ))

        self.stdout.write(self.style.SUCCESS("Sync completado."))
