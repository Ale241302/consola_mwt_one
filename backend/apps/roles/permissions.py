"""
=====================================================================
MWT.ONE · apps.roles.permissions
Agente responsable: [AG-BACKEND]

Guard helpers reutilizables. Se exponen aquí (en lugar de dejarlos
en apps.users) para que apps.roles sea autónoma.
=====================================================================
"""
import logging
from rest_framework import status
from rest_framework.response import Response

log = logging.getLogger(__name__)


_CLIENT_ROLES = {"client_b2b", "cliente", "client"}
_ADMIN_ROLES  = {"superadmin", "admin"}


def is_client(user) -> bool:
    role = (getattr(user, "role", "") or "").lower().strip()
    return role.startswith("client_") or role in _CLIENT_ROLES


def is_superuser_or_admin(user) -> bool:
    if getattr(user, "is_superuser", False):
        return True
    return (getattr(user, "role", "") or "").lower() in _ADMIN_ROLES


def deny_non_admin(request, resource_label: str = "roles.admin"):
    """Retorna Response 403 si el caller no es superuser/admin, o None.

    Usado como guard en ViewSet.initial() antes de cualquier mutación
    sobre roles o matriz RBAC.
    """
    if is_superuser_or_admin(request.user):
        return None
    log.warning(
        "Unauthorized roles/rbac access: role=%s email=%s resource=%s path=%s",
        getattr(request.user, "role", "?"),
        getattr(request.user, "email", "?"),
        resource_label,
        getattr(request, "path", "?"),
    )
    return Response(
        {"detail": "Solo superadmin/admin puede gestionar roles y permisos.",
         "resource": resource_label},
        status=status.HTTP_403_FORBIDDEN,
    )
