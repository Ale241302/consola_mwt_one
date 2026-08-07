"""
=====================================================================
MWT.ONE · apps.core.permissions
Permiso DRF basado en el rol del JWT (claim `role`) y en la vista
(atributo `required_module` / `required_action`).

Ejemplo de uso en una vista:

    class ExpedientesListView(APIView):
        required_module = "expedientes"
        required_action = "view"

El permiso se activa a nivel global vía
REST_FRAMEWORK.DEFAULT_PERMISSION_CLASSES en settings.py.
=====================================================================
"""
import json
import logging

from rest_framework.permissions import BasePermission

from django.db import connection

log = logging.getLogger(__name__)

CLIENT_ROLE_ALIASES = {"client", "cliente", "client_b2b"}
CEO_ADMIN_ROLES = {"superadmin", "admin", "ceo"}


def normalize_role(role) -> str:
    return str(role or "").strip().lower()


def is_client_role(role) -> bool:
    r = normalize_role(role)
    return r.startswith("client_") or r in CLIENT_ROLE_ALIASES


def is_ceo_or_admin_role(role) -> bool:
    return normalize_role(role) in CEO_ADMIN_ROLES


def user_is_ceo_or_admin(user) -> bool:
    if not user or not getattr(user, "is_authenticated", False):
        return False
    if getattr(user, "is_superuser", False):
        return True
    return is_ceo_or_admin_role(
        getattr(user, "role_default", None) or getattr(user, "role", None)
    )


def _user_role(user) -> str:
    if not user or not getattr(user, "is_authenticated", False):
        return ""
    return str(
        getattr(user, "role_default", None) or getattr(user, "role", None) or ""
    ).strip().lower()


def _is_client_viewer(user) -> bool:
    """True si el usuario tiene un rol de cliente (incluye CLIENT_VIEWER)."""
    return is_client_role(_user_role(user))


def _is_admin_viewer(user) -> bool:
    """True si el usuario es un usuario interno (no cliente)."""
    if not user or not getattr(user, "is_authenticated", False):
        return False
    return not is_client_role(_user_role(user))


class IsCeoOrAdmin(BasePermission):
    """Permiso positivo para superficies CEO/Admin-only."""

    message = "Solo CEO/admin puede acceder a este recurso."

    def has_permission(self, request, view):
        return user_is_ceo_or_admin(getattr(request, "user", None))


def _normalize_perms(value) -> dict:
    """Convierte el valor de core.roles.permissions a dict canonico.

    Bug original (HTML 500 'str object has no attribute get'): la
    columna permissions esta declarada en algunos schemas como TEXT
    en vez de JSONB, asi que psycopg2 devuelve un string JSON sin
    parsear. En otros entornos viene como dict nativo (JSONB ->
    psycopg2 lo parsea automaticamente). Manejamos ambos casos.

    Casos cubiertos:
      - None / '' -> {}
      - dict -> tal cual
      - list (legacy de seeds antiguos) -> {'modules': list}
      - str JSON valido -> json.loads (acepta dict, list, escalar)
      - str JSON invalido o tipo raro -> {} con warning
    """
    if value is None or value == "":
        return {}
    if isinstance(value, dict):
        return value
    if isinstance(value, list):
        return {"modules": value}
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except (json.JSONDecodeError, ValueError) as exc:
            log.warning(
                "[_normalize_perms] permissions string no parseable "
                "como JSON (value[:80]=%r err=%s) -> fail-closed {}",
                value[:80], exc,
            )
            return {}
        if isinstance(parsed, dict):
            return parsed
        if isinstance(parsed, list):
            return {"modules": parsed}
        log.warning(
            "[_normalize_perms] permissions JSON de tipo inesperado %s -> {}",
            type(parsed).__name__,
        )
        return {}
    log.warning(
        "[_normalize_perms] permissions de tipo inesperado %s -> {}",
        type(value).__name__,
    )
    return {}


def _permissions_for_role(role_slug: str) -> dict:
    """Devuelve el JSONB permissions de core.roles para un slug.

    Sprint 2026-05-25 (defensivo): cualquier excepcion de DB se loguea
    con log.exception y devuelve {} para que el permission check caiga
    a un 403 JSON LIMPIO en lugar de propagar una excepcion sin manejar
    que Django convierte a HTML 500 generico (antes de que el
    EXCEPTION_HANDLER de DRF la pueda capturar).

    Causas reales que esto blinda:
      * ProgrammingError: schema core no existente (bootstrap incompleto).
      * OperationalError: timeout / connection refused / pool agotado.
      * DataError: row[0] mal estructurado en la BD.
    """
    if not role_slug:
        return {}
    try:
        with connection.cursor() as cur:
            cur.execute(
                "SELECT permissions FROM core.roles WHERE slug = %s LIMIT 1",
                [role_slug],
            )
            row = cur.fetchone()
        if not row:
            return {"modules": ["*"]} if role_slug in ("admin", "superadmin") else {}
        # row[0] puede venir como dict (JSONB) o str (TEXT) segun el
        # schema del entorno. _normalize_perms acepta ambos.
        return _normalize_perms(row[0])
    except Exception as exc:  # noqa: BLE001 - blindaje contra HTML 500
        log.exception(
            "[_permissions_for_role] DB query failed for role_slug=%r: %s",
            role_slug, exc,
        )
        # Fail-closed: si no podemos leer permisos, negamos acceso.
        # 403 JSON limpio en lugar de HTML 500.
        return {}


class RoleBasedPermission(BasePermission):
    """
    · Si la vista no declara `required_module`, solo se exige estar autenticado.
    · Si lo declara, se valida contra el permiso del rol del usuario.
    · Los roles 'admin' y 'superadmin' (o modules=['*']) pasan todo.
    """
    def has_permission(self, request, view):
        # Auth ya fue validada por JWTAuthentication
        if not request.user or not request.auth:
            return False

        required_module = getattr(view, "required_module", None)
        required_action = getattr(view, "required_action", "view")
        if not required_module:
            return True

        # request.auth puede ser dict (JWT decoded) o str (token raw).
        # En el segundo caso .get() rompe igual; defensivo:
        if isinstance(request.auth, dict):
            role_slug = request.auth.get("role")
        else:
            role_slug = (getattr(request.user, "role", None)
                         or getattr(request.user, "role_default", None))

        perms = _permissions_for_role(role_slug)
        # Defensa adicional: _permissions_for_role ya normaliza, pero
        # si algo raro pasara, garantizamos que .get() no explote.
        if not isinstance(perms, dict):
            log.warning(
                "[RoleBasedPermission] perms no es dict (tipo=%s) -> negando",
                type(perms).__name__,
            )
            return False

        modules = perms.get("modules") or []
        actions = perms.get("actions") or []

        if "*" in modules:
            return True
        if required_module not in modules:
            return False
        if not actions or "*" in actions:
            return True
        return required_action in actions
