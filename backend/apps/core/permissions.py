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
import os

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


def permissions_for_role_exact(role_slug: str) -> dict:
    """Devuelve el JSONB `permissions` de core.roles tal cual está en la BD.

    A diferencia de `_permissions_for_role`, NO fuerza `modules=["*"]` para
    admin/superadmin: respeta la matriz real que el CEO configura en
    /roles (users.role_permission → sync → core.roles.permissions).

    Usado por McpTokenView (JWT del MCP) para que el filtrado de tools del
    MCP refleje EXACTAMENTE lo que la matriz de roles permite — si el CEO
    deshabilita `clientes.create`, la tool `cliente_crear` deja de aparecer
    aunque el usuario sea admin.

    Fail-closed: si el rol no existe o hay error de DB → {} (sin wildcard).
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
            return {}
        return _normalize_perms(row[0])
    except Exception as exc:  # noqa: BLE001 - blindaje contra HTML 500
        log.exception(
            "[permissions_for_role_exact] DB query failed for role_slug=%r: %s",
            role_slug, exc,
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
        perms = _normalize_perms(row[0])
        # Los roles admin/superadmin deben tener acceso total. Si el JSON
        # de core.roles no incluye modules (caso post-A6 con solo actions),
        # forzamos wildcard para no bloquear a usuarios administrativos.
        if role_slug in ("admin", "superadmin"):
            perms["modules"] = ["*"]
        return perms
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
    · Si la vista declara `required_module`, se valida contra el permiso del rol.
    · Si NO lo declara:
        - Por defecto se permite y se loguea (transición log-only).
        - En modo estricto (MWT_RBAC_STRICT=1) se niega el acceso (fail-closed).
    · Los roles 'admin' y 'superadmin' (o modules=['*']) pasan todo en la
      CONSOLA (wildcard a propósito para no romper la operación).
    · MCP (request.auth['mcp']==True): valida contra la MATRIZ REAL de
      core.roles.permissions (permissions_for_role_exact) — si el CEO
      deshabilitó clientes.create en /roles, la tool cliente_crear devuelve
      403 aunque el usuario sea admin. La consola no cambia.
    · ServiceTokenUser aporta sus permisos directos.
    """

    _METHOD_TO_ACTION = {
        "GET": "view",
        "HEAD": "view",
        "OPTIONS": "view",
        "POST": "create",
        "PUT": "update",
        "PATCH": "update",
        "DELETE": "delete",
    }

    def _effective_action(self, request, view) -> str:
        """Acción requerida: la declarada en la vista o derivada del método HTTP."""
        declared = getattr(view, "required_action", None)
        if declared:
            return declared
        return self._METHOD_TO_ACTION.get((request.method or "GET").upper(), "view")

    def has_permission(self, request, view):
        # Auth ya fue validada por JWTAuthentication / ServiceTokenAuthentication
        if not request.user or not request.auth:
            return False

        required_module = getattr(view, "required_module", None)
        view_name = f"{view.__class__.__module__}.{view.__class__.__name__}"

        # ── Vista sin required_module ────────────────────────────────────
        # Durante la transición de RBAC, permitimos por defecto para no
        # romper módulos que aún no declaran módulo. Activar strict cuando
        # todos los viewsets estén poblados.
        if not required_module:
            strict = os.environ.get("MWT_RBAC_STRICT", "0").strip().lower() in ("1", "true", "yes")
            if strict:
                log.warning(
                    "[RoleBasedPermission] Vista sin required_module denegada: %s",
                    view_name,
                )
                return False
            log.warning(
                "[RoleBasedPermission][LOG-ONLY] Vista sin required_module: %s",
                view_name,
            )
            return True

        # ── ¿Es una llamada del MCP? ─────────────────────────────────────
        # El JWT mint por McpTokenView lleva claim mcp=True. Para el MCP
        # SIEMPRE validamos contra la matriz REAL (permissions_for_role_exact)
        # y la acción derivada del método HTTP, de modo que lo configurado en
        # /roles se respete (ej. clientes.create=false -> cliente_crear 403).
        # La consola (sin claim mcp) conserva el wildcard admin/superadmin.
        # Nota: request.auth es un AccessToken de simplejwt (dict-like con
        # .get(), NO un dict) — se detecta con hasattr/get, no isinstance.
        try:
            is_mcp = bool(getattr(request.auth, "get", lambda k: None)("mcp"))
        except Exception:  # noqa: BLE001
            is_mcp = False

        # ── Permisos del usuario ───────────────────────────────────────
        if getattr(request.user, "is_service_token", False):
            perms = getattr(request.user, "_permissions", {}) or {}
            modules = perms.get("modules") or []
            actions = perms.get("actions") or []
            if "*" in modules:
                return True
            if required_module not in modules:
                return False
            if not actions or "*" in actions:
                return True
            required_action = self._effective_action(request, view)
            # Igual que consola: actions son "<modulo>.<accion>".
            return f"{required_module}.{required_action}" in actions

        if isinstance(request.auth, dict):
            role_slug = request.auth.get("role")
        elif hasattr(request.auth, "get"):
            role_slug = request.auth.get("role")
        else:
            role_slug = (getattr(request.user, "role", None)
                         or getattr(request.user, "role_default", None))

        if is_mcp:
            perms = permissions_for_role_exact(role_slug)
            modules = perms.get("modules") or []
            actions = perms.get("actions") or []
            required_action = self._effective_action(request, view)
            # MCP: sin wildcard. modules=['*'] explícito -> acceso total.
            if "*" in modules:
                return True
            if required_module not in modules:
                log.info(
                    "[RoleBasedPermission][MCP] módulo %r denegado para rol %r (action=%s)",
                    required_module, role_slug, required_action,
                )
                return False
            if not actions or "*" in actions:
                return True
            ok = f"{required_module}.{required_action}" in actions
            if not ok:
                log.info(
                    "[RoleBasedPermission][MCP] action %s.%s denegado para rol %r",
                    required_module, required_action, role_slug,
                )
            return ok

        # ── Consola: wildcard admin/superadmin (comportamiento actual) ──
        perms = _permissions_for_role(role_slug)

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
        required_action = self._effective_action(request, view)
        # Las actions se guardan como "<modulo>.<accion>" (ej. "portal.view").
        # Comparar SOLO la acción ("view" in actions) era un bug: nunca coincide.
        return f"{required_module}.{required_action}" in actions
