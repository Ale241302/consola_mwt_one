"""
apps.finanzas · permissions
Sprint 2026-05-24

POL_VISIBILIDAD R3: Finanzas es CEO-ONLY. Cualquier rol CLIENT_* recibe 403.
Roles aceptados: superadmin, admin, ceo (ceo = alias logico, usualmente
mapeado a admin en el JWT).
"""
from rest_framework.permissions import BasePermission


_CEO_ROLES = {"superadmin", "admin", "ceo"}


class IsCeoOrAdmin(BasePermission):
    """Acceso solo a roles administrativos. Nunca a CLIENT_*."""

    message = "Solo CEO/admin pueden acceder al modulo Finanzas."

    def has_permission(self, request, view):
        u = getattr(request, "user", None)
        if not u or not getattr(u, "is_authenticated", False):
            return False
        role = (getattr(u, "role", "") or "").lower().strip()
        if role in _CEO_ROLES:
            return True
        # Fallback: is_superuser/is_staff de Django si role no esta poblado
        if getattr(u, "is_superuser", False) or getattr(u, "is_staff", False):
            return True
        return False
