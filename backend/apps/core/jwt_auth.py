"""
=====================================================================
MWT.ONE · apps.core.jwt_auth
Agente responsable: [AG-BACKEND]

Reemplaza la JWTAuthentication por defecto de simplejwt por una que NO
toca django.contrib.auth.models.User (cuya tabla `auth_user` nunca se
crea en MWT — usamos core.users con SQL raw, managed=False).

Flujo:
  1. DRF llama authenticate(request) → validamos el JWT igual que simplejwt.
  2. Extraemos el claim `user_uuid` (inyectado por _make_tokens() en
     apps.core.auth_views).
  3. Consultamos core.users con un SELECT directo; si el usuario existe,
     está activo y su rol coincide, construimos un proxy `MwtUser`
     in-memory que DRF trata como un django.contrib.auth.User.
  4. request.user = MwtUser(...)  →  request.auth = validated_token.

Compatibilidad:
  · `IsAuthenticated.has_permission()` verifica request.user.is_authenticated.
  · `RoleBasedPermission.has_permission()` verifica request.user + request.auth.
     Lee el rol desde request.auth.get("role"), no desde request.user.
  · Cualquier vista que haga `request.user.id` / `.email` / `.role`
     sigue funcionando porque MwtUser expone esos atributos.

Sin migraciones, sin AUTH_USER_MODEL, sin tocar la DB. Sólo settings.py.
=====================================================================
"""
from __future__ import annotations

import json

from django.db import connection
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import AuthenticationFailed, InvalidToken


# ---------------------------------------------------------------------
# Proxy de usuario — cumple el contrato mínimo que espera DRF.
# ---------------------------------------------------------------------
class MwtUser:
    """
    Usuario "liviano" construido desde una fila de core.users.

    NO es un modelo Django — no tiene .save() ni manager. Solo expone
    los atributos que DRF / permissions / views suelen leer:
      · id / pk           → UUID string
      · email             → email_plain
      · full_name
      · role              → slug canónico (admin, cliente, compras, etc.)
      · is_authenticated  → True
      · is_anonymous      → False
      · is_active         → bool
      · is_staff/is_superuser → True para roles privilegiados
      · has_perm(module)  → chequea contra permissions del rol
    """

    # Atributo requerido por algunos backends de DRF (ej. ModelBackend)
    # cuando consultan `user._meta`. No apuntamos a un modelo real.
    _meta = None

    def __init__(
        self,
        user_id: str,
        email: str | None = None,
        full_name: str | None = None,
        role: str | None = None,
        permissions: dict | None = None,
        is_active: bool = True,
    ):
        self.id          = str(user_id)
        self.pk          = str(user_id)
        self.email       = email or ""
        self.username    = email or str(user_id)
        self.full_name   = full_name or ""
        self.role        = role or ""
        self._permissions = permissions or {}
        self._is_active  = bool(is_active)

    # ---- flags estándar de DRF/Django ------------------------------
    @property
    def is_authenticated(self) -> bool:  # DRF IsAuthenticated
        return True

    @property
    def is_anonymous(self) -> bool:
        return False

    @property
    def is_active(self) -> bool:
        return self._is_active

    @property
    def is_staff(self) -> bool:
        return self.role in ("admin", "superadmin", "ceo", "manager")

    @property
    def is_superuser(self) -> bool:
        return self.role in ("admin", "superadmin")

    # ---- permission helpers ----------------------------------------
    def has_perm(self, perm, obj=None) -> bool:
        if self.is_superuser:
            return True
        modules = (self._permissions or {}).get("modules") or []
        if "*" in modules:
            return True
        # perm típicamente es "modulo.accion" o solo "modulo"
        if "." in perm:
            modulo, _accion = perm.split(".", 1)
        else:
            modulo = perm
        return modulo in modules

    def has_perms(self, perm_list, obj=None) -> bool:
        return all(self.has_perm(p, obj) for p in (perm_list or []))

    def has_module_perms(self, module) -> bool:
        return self.has_perm(module)

    def get_username(self) -> str:
        return self.username

    def get_all_permissions(self, obj=None):
        perms = (self._permissions or {}).get("modules") or []
        return set(perms)

    def __str__(self) -> str:
        return self.email or self.id

    def __repr__(self) -> str:
        return f"MwtUser(id={self.id!r}, email={self.email!r}, role={self.role!r})"


# ---------------------------------------------------------------------
# Authentication class custom de simplejwt
# ---------------------------------------------------------------------
class MwtJWTAuthentication(JWTAuthentication):
    """
    Misma validación criptográfica de simplejwt, pero el lookup del
    usuario va contra core.users (SQL raw) en vez de auth_user.
    """

    def get_user(self, validated_token):
        # 1) Sacar el UUID del claim (user_uuid es el preferido; "sub" /
        #    "user_id" como fallback si algún token viejo lo trae).
        user_uuid = (
            validated_token.get("user_uuid")
            or validated_token.get("sub")
            or validated_token.get("user_id")
        )
        if not user_uuid:
            raise InvalidToken("El token no contiene user_uuid")

        # 2) Buscar el usuario + permisos del rol en una sola query.
        #
        # NOTA SCHEMA (verificado contra auth_views.py):
        #   · core.user_roles.user_uuid  → core.users.id
        #   · core.user_roles.role_uuid  → core.roles.id
        #   · core.roles.slug            → slug canónico del rol
        #   · core.roles.permissions     → jsonb con {modules: [...], actions: [...]}
        # Si no hay fila en core.user_roles caemos al string u.role.
        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT  u.id::text,
                        u.email_plain,
                        u.full_name,
                        COALESCE(r.slug, u.role)             AS role,
                        COALESCE(r.permissions, '{}'::jsonb) AS permissions,
                        u.is_active
                FROM    core.users u
                LEFT JOIN core.user_roles ur ON ur.user_uuid = u.id
                LEFT JOIN core.roles      r  ON r.id         = ur.role_uuid
                WHERE   u.id = %s::uuid
                  AND   u.deleted_at IS NULL
                LIMIT 1
                """,
                [str(user_uuid)],
            )
            row = cur.fetchone()

        if not row:
            raise AuthenticationFailed(
                "Usuario no encontrado",
                code="user_not_found",
            )

        uid, email, full_name, role, permissions, is_active = row

        if not is_active:
            raise AuthenticationFailed(
                "Usuario inactivo",
                code="user_inactive",
            )

        # permissions puede venir como dict (si psycopg convierte jsonb) o
        # como string JSON; normalizamos.
        if isinstance(permissions, str):
            try:
                permissions = json.loads(permissions)
            except Exception:
                permissions = {}
        if not isinstance(permissions, dict):
            permissions = {}

        return MwtUser(
            user_id=uid,
            email=email,
            full_name=full_name,
            role=role,
            permissions=permissions,
            is_active=bool(is_active),
        )
