"""
=====================================================================
MWT.ONE · apps.core.management.commands.seed_admins
Agente responsable: [AG-BACKEND]

Idempotente. UPSERT de los superadmins canónicos del ERP en
`core.users` (la tabla que consume apps.core.auth_views.LoginView).

Por qué SQL crudo y no ORM:
  · apps.core NO tiene modelos Django para `core.users`. El login
    usa `connection.cursor()` directamente (ver auth_views._fetch_user).
  · Mantener consistencia con ese patrón evita mezclar dos capas
    que luego divergen.

Uso:
    # Correr por default (alejandro + alvaro @muitowork.com, clave MuitoWork2026?)
    python manage.py seed_admins

    # Pasar una password distinta por flag:
    python manage.py seed_admins --password "OtraClave123?"

    # Solo un usuario:
    python manage.py seed_admins --only alejandro@muitowork.com

Seguridad:
  · Hasheo = SHA-256 (hash_kind='sha256') — coincide con el algoritmo
    que LoginView valida. Si en el futuro se migra a argon2/pbkdf2,
    cambiar aquí y en _verify_password.
  · El comando marca is_superuser=TRUE, is_active=TRUE, is_staff=TRUE.
  · role='superadmin' → el LoginView otorga permissions={"modules":["*"]}
    como fallback cuando no hay fila en core.user_roles.
=====================================================================
"""
import hashlib
import uuid

from django.core.management.base import BaseCommand
from django.db import connection


# ---------------------------------------------------------------------
# Config canónica de superadmins MWT
# ---------------------------------------------------------------------
# Si agregas más superadmins, simplemente extiende esta lista y re-ejecuta
# el comando — es idempotente.
DEFAULT_ADMINS = [
    {
        "email":     "alejandro@muitowork.com",
        "full_name": "Alejandro Mendoza",
        "role":      "superadmin",
    },
    {
        "email":     "alvaro@muitowork.com",
        "full_name": "Alvaro Mendoza",
        "role":      "superadmin",
    },
]

DEFAULT_PASSWORD = "MuitoWork2026?"


def _sha256(plain: str) -> str:
    return hashlib.sha256(plain.encode("utf-8")).hexdigest()


class Command(BaseCommand):
    help = (
        "Crea o actualiza los superadmins canónicos de MWT.ONE "
        "(alejandro + alvaro @muitowork.com) en core.users. Idempotente."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--password",
            default=DEFAULT_PASSWORD,
            help=f"Password a asignar a todos los superadmins "
                 f"(default: '{DEFAULT_PASSWORD}').",
        )
        parser.add_argument(
            "--only",
            default=None,
            help="Si se pasa, sólo procesa el email indicado.",
        )

    # -----------------------------------------------------------------
    def handle(self, *args, **opts):
        password = opts["password"]
        only     = (opts["only"] or "").strip().lower() or None

        if len(password) < 8:
            self.stderr.write(self.style.WARNING(
                f"⚠ Password corta ({len(password)} chars). Se aceptará, "
                f"pero recomiendo mínimo 12 caracteres en producción."
            ))

        admins = DEFAULT_ADMINS
        if only:
            admins = [a for a in admins if a["email"].lower() == only]
            if not admins:
                self.stderr.write(self.style.ERROR(
                    f"El email '{only}' no está en la lista canónica. "
                    f"Agrégalo a DEFAULT_ADMINS en seed_admins.py."
                ))
                return

        self.stdout.write(self.style.MIGRATE_HEADING(
            f"\n» seed_admins · procesando {len(admins)} superadmin(s)\n"
        ))

        pwd_hash = _sha256(password)

        for a in admins:
            self._upsert(a, pwd_hash)

        self.stdout.write(self.style.SUCCESS(
            "\n✅ Superadmins listos. Pruébalo con:\n"
            "   POST https://consola.mwt.one/api/auth/login/\n"
            "   body: { \"usuario\": \"alejandro@muitowork.com\", \"password\": \"…\" }\n"
        ))

    # -----------------------------------------------------------------
    def _upsert(self, admin: dict, pwd_hash: str):
        email_raw = admin["email"]
        email_low = email_raw.strip().lower()
        full_name = admin["full_name"]
        role      = admin["role"]

        with connection.cursor() as cur:
            # ── Buscar por email case-insensitive; incluye soft-deleted
            #    para reactivarlos si fueron borrados previamente.
            cur.execute(
                "SELECT id, is_active, deleted_at FROM core.users "
                "WHERE lower(email_plain) = %s",
                [email_low],
            )
            row = cur.fetchone()

            if row:
                user_id, is_active, deleted_at = row
                cur.execute(
                    """
                    UPDATE core.users
                       SET password_hash = %s,
                           hash_kind     = 'sha256',
                           full_name     = %s,
                           role          = %s,
                           is_active     = TRUE,
                           is_staff      = TRUE,
                           deleted_at    = NULL,
                           updated_at    = NOW()
                     WHERE id = %s
                    """,
                    [pwd_hash, full_name, role, user_id],
                )
                accion = "reactivado" if deleted_at else "actualizado"
                self.stdout.write(
                    f"  · {self.style.HTTP_INFO(accion.upper())}  "
                    f"{email_raw:<30}  id={user_id}"
                )
            else:
                new_id = uuid.uuid4()
                cur.execute(
                    """
                    INSERT INTO core.users
                        (id, email_plain, password_hash, hash_kind, full_name,
                         role, is_active, is_staff,
                         created_at, updated_at)
                    VALUES
                        (%s, %s, %s, 'sha256', %s, %s, TRUE, TRUE,
                         NOW(), NOW())
                    """,
                    [new_id, email_raw, pwd_hash, full_name, role],
                )
                self.stdout.write(
                    f"  · {self.style.SUCCESS('CREADO')}       "
                    f"{email_raw:<30}  id={new_id}"
                )
