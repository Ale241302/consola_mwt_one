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
import logging

from django.db import connection
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import AuthenticationFailed, InvalidToken

from .permissions import is_ceo_or_admin_role, is_client_role, normalize_role

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------
# Ola 1 · 1.1 — clientes ACTIVOS para el scope del JWT MCP.
# ---------------------------------------------------------------------
def _active_client_ids(ids) -> list[str]:
    """Filtra una lista de UUIDs de cliente a los que están ACTIVOS.

    Regla de negocio (multi-tenancy): un JWT del MCP cuyo cliente fue
    desactivado (is_active=False o estado != 'ACTIVO') NO debe poder leer
    nada. Esta validación corre en `get_user` (capa auth) y de nuevo en el
    mint (auth_views.McpTokenView).

    Fail-safe: si la query falla, se devuelven los ids sin filtrar y se
    loguea un warning (la capa de scoping por legal_entity_ids sigue
    limitando; no romper operación por un error de DB transitorio).
    """
    ids = [str(x) for x in (ids or []) if x]
    if not ids:
        return []
    try:
        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT id::text
                  FROM clientes.cliente
                 WHERE id::text = ANY(%s)
                   AND is_active = TRUE
                   AND estado = 'ACTIVO'
                """,
                [ids],
            )
            return [row[0] for row in cur.fetchall()]
    except Exception as e:  # noqa: BLE001
        log.warning("jwt_auth._active_client_ids falló (fail-open con log): %s", e)
        return ids


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
        legal_entity_ids: list | None = None,
        mcp_scoped: bool = False,
        tenant_id: str | None = None,
    ):
        self.id          = str(user_id)
        self.pk          = str(user_id)
        self.email       = email or ""
        self.username    = email or str(user_id)
        self.full_name   = full_name or ""
        self.role        = normalize_role(role)
        self._permissions = permissions or {}
        self._is_active  = bool(is_active)
        # Sprint 2026-05-21 · Portal multi-empresa.
        # Array de UUIDs de empresas (clientes.cliente.id) asignadas al
        # usuario vía `users.mwtuser.legal_entity_ids`. Lo lee
        # MwtJWTAuthentication.get_user con join por email a users.mwtuser.
        # `[]` si es staff interno sin restricción de empresa.
        self.legal_entity_ids = list(legal_entity_ids or [])
        # Ola 1 · 1.1/1.2 — scope forzado por el token MCP.
        #   · mcp_scoped=True → el JWT vino del MCP con legal_entity_ids del
        #     claim; el guard anti-bypass desactiva BYPASS_ROLES.
        #   · tenant_id → cliente quemado de la app MCP (si viene).
        self.mcp_scoped = bool(mcp_scoped)
        self.tenant_id = str(tenant_id) if tenant_id else None
        # Compat: `role_default` se usa en algunos endpoints
        # (apps.expedientes._viewer_role_upper) — espejo de `role`.
        self.role_default = self.role
        # Flags expl?citos para no reimplementar heur?sticas en vistas.
        self.is_client = is_client_role(self.role)
        self.is_ceo_admin = is_ceo_or_admin_role(self.role)

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

    def get_validated_token(self, raw_token):
        validated = super().get_validated_token(raw_token)
        try:
            jti = validated.get("jti")
            if jti:
                with connection.cursor() as cur:
                    cur.execute(
                        "SELECT 1 FROM core.token_denylist WHERE jti = %s LIMIT 1",
                        [jti],
                    )
                    if cur.fetchone():
                        raise InvalidToken("Token revocado")
        except InvalidToken:
            raise
        except Exception as e:
            log.warning("Denylist check falló: %s", e)
        return validated

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

        # ── Ola 1 · 1.1 — Modo MCP: scope desde el CLAIM del token ─────────
        # Los JWT emitidos por McpTokenView (mcp=True) llevan `legal_entity_ids`
        # (= intersección usuario ∩ ServiceToken, ya acotada) y opcionalmente
        # `tenant_id` (= cliente quemado de la app). Para estos tokens el scope
        # del JWT es la FUENTE CANÓNICA — NO se rehidrata por email (P1-1):
        #   · Un drift de email entre core.users y users.mwtuser ya no amplía
        #     el scope: el claim es lo que el mint decidió.
        #   · El claim NUNCA amplía tenants; solo restringe (auth_views
        #     ya intersecta con el ServiceToken antes de emitir).
        # Se valida además que los clientes del claim estén ACTIVOS (P0-7).
        is_mcp_token = bool(validated_token.get("mcp"))
        token_legal_ids = validated_token.get("legal_entity_ids")
        token_tenant_id = validated_token.get("tenant_id")

        legal_entity_ids: list[str] = []
        if is_mcp_token and token_legal_ids is not None:
            claim_scope = [token_tenant_id] if token_tenant_id else list(token_legal_ids)
            legal_entity_ids = _active_client_ids(claim_scope)
            if claim_scope and not legal_entity_ids:
                # Todos los clientes del claim están inactivos/borrados → el
                # acceso MCP se corta (fail-closed) aunque el usuario exista.
                raise AuthenticationFailed(
                    "Cliente(s) desactivados para este acceso MCP",
                    code="client_inactive",
                )
        else:
            legal_entity_ids = self._rehydrate_legal_ids(email, uid, role)

        # Normalizar a lowercase — `client_id::text` de PG es lowercase
        # y comparaciones case-sensitive en TEXT generan mismatch.
        legal_entity_ids = [s.lower() for s in legal_entity_ids if s]

        return MwtUser(
            user_id=uid,
            email=email,
            full_name=full_name,
            role=role,
            permissions=permissions,
            is_active=bool(is_active),
            legal_entity_ids=legal_entity_ids,
            # Ola 1 · 1.1/1.2 — el guard anti-bypass necesita saber si el
            # token es del MCP y si trae un tenant quemado.
            # Fix 2026-08-20 · `mcp_scoped` SOLO cuando hay `tenant_id` (cliente
            # quemado de una app MCP por cliente). El server global (Operador/
            # app admin 1290625…) NO trae tenant_id y NO debe forzar scope:
            # un admin MCP global ve todos los clientes (bypass), aunque su
            # users.mwtuser.legal_entity_ids tenga empresas. Antes `mcp_scoped`
            # se activaba con cualquier legal_entity_ids → el Operador global
            # no podía ver clientes fuera de su pool (creaba pero el GET daba
            # 404 "Cliente no existe").
            mcp_scoped=bool(is_mcp_token and token_tenant_id),
            tenant_id=token_tenant_id,
        )

    def _rehydrate_legal_ids(self, email: str | None, uid: str, role: str = "") -> list[str]:
        """Sprint 2026-05-21 · Portal multi-empresa (login normal de consola).

        `core.users` (login) y `users.mwtuser` (donde vive legal_entity_ids)
        son tablas independientes con UUIDs distintos. Joineamos por EMAIL
        (canónico) con fallback por id. Sin este lookup, todos los filtros por
        scope de cliente colapsan a `.none()`.
        """
        legal_entity_ids: list[str] = []
        try:
            email_low = (email or "").strip().lower()
            with connection.cursor() as cur:
                if email_low:
                    cur.execute(
                        """
                        SELECT COALESCE(legal_entity_ids, '{}'::TEXT[]) AS ids
                          FROM users.mwtuser
                         WHERE lower(trim(email_plain)) = %s
                            OR lower(trim(COALESCE(contact_email, ''))) = %s
                         ORDER BY (CASE WHEN is_active THEN 0 ELSE 1 END),
                                  cardinality(COALESCE(legal_entity_ids, '{}'::TEXT[])) DESC,
                                  updated_at DESC NULLS LAST
                         LIMIT 1
                        """,
                        [email_low, email_low],
                    )
                    r2 = cur.fetchone()
                    if r2 and r2[0]:
                        legal_entity_ids = [str(x) for x in r2[0] if x]
                # Fallback por id (ambientes con UUIDs sincronizados)
                if not legal_entity_ids:
                    cur.execute(
                        """
                        SELECT COALESCE(legal_entity_ids, '{}'::TEXT[]) AS ids
                          FROM users.mwtuser
                         WHERE lower(id::text) = lower(%s)
                         LIMIT 1
                        """,
                        [str(uid)],
                    )
                    r3 = cur.fetchone()
                    if r3 and r3[0]:
                        legal_entity_ids = [str(x) for x in r3[0] if x]
        except Exception as e:
            # users.mwtuser puede no existir en ambientes legacy.
            log.warning(
                "MwtJWTAuthentication: lookup de legal_entity_ids fallo "
                "(uid=%s email=%s): %s",
                uid, email, e,
            )
            legal_entity_ids = []

        # Sprint 2026-05-21 · Observabilidad de drift core.users ↔ users.mwtuser.
        # Si el role del usuario es CLIENT_* / cliente / client_b2b y no se
        # encontro ningun legal_entity_id, eso significa que el portal y los
        # endpoints scopeados van a quedar vacios para este user — typicamente
        # por drift entre los emails de las dos tablas. Logueamos un warning
        # estructurado para que el CEO pueda greparlo en docker logs django.
        try:
            if is_client_role(role) and not legal_entity_ids:
                log.warning(
                    "MwtJWTAuthentication: CLIENT sin legal_entity_ids — "
                    "probable drift core.users vs users.mwtuser.",
                )
        except Exception:
            pass
        return legal_entity_ids
