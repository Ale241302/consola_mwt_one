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
from rest_framework.permissions import BasePermission

from django.db import connection


def _permissions_for_role(role_slug: str) -> dict:
    if not role_slug:
        return {}
    with connection.cursor() as cur:
        cur.execute(
            "SELECT permissions FROM core.roles WHERE slug = %s LIMIT 1",
            [role_slug],
        )
        row = cur.fetchone()
    if not row:
        return {"modules": ["*"]} if role_slug in ("admin", "superadmin") else {}
    return row[0] or {}


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

        role_slug = request.auth.get("role")
        perms = _permissions_for_role(role_slug)
        modules = perms.get("modules") or []
        actions = perms.get("actions") or []

        if "*" in modules:
            return True
        if required_module not in modules:
            return False
        if not actions or "*" in actions:
            return True
        return required_action in actions
