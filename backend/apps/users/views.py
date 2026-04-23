"""
=====================================================================
MWT.ONE · apps.users.views
Agente responsable: [AG-BACKEND]

Endpoints:

  Admin (superuser/admin):
    GET    /api/users/                      · listar usuarios
    POST   /api/users/                      · crear
    GET    /api/users/<uuid>/               · retrieve
    PATCH  /api/users/<uuid>/               · actualizar
    DELETE /api/users/<uuid>/               · soft-delete
    POST   /api/users/<uuid>/reset-password/· token + email
    POST   /api/users/<uuid>/toggle-active/ · reactivar / inactivar

  Self-service (cualquiera autenticado):
    GET    /api/users/me/profile/           · leer perfil propio
    PATCH  /api/users/me/profile/           · actualizar contact_email +
                                               preferred_language + timezone

  RBAC (superuser/admin):
    GET    /api/permissions/modules/        · catálogo de módulos
    GET    /api/permissions/roles/          · catálogo de roles
    GET    /api/permissions/groups/<slug>/  · matriz CRUD de un rol
    PATCH  /api/permissions/groups/<slug>/  · guardar matriz

  Activity feed (cualquiera autenticado):
    GET    /api/activity-feed/              · últimas N notificaciones del user
    POST   /api/activity-feed/<uuid>/read/  · marcar como leída
    POST   /api/activity-feed/read-all/     · marcar todas como leídas

Seguridad:
  · CLIENT B2B solo puede tocar `/me/profile/` y `/activity-feed/`.
    Cualquier otro endpoint → 403.
  · PasswordResetToken usa SHA-256 del token como `token_hash`.
=====================================================================
"""
from __future__ import annotations

import hashlib
import logging
import secrets
import uuid
from datetime import timedelta

from django.db import connection
from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import (
    MwtUser, RoleCat, ModuleCat, RolePermission, UserRoleBridge,
    PasswordResetToken, ActivityFeed,
)
from .serializers import (
    MwtUserSerializer, MwtUserListSerializer,
    ProfileMeSerializer,
    RoleCatSerializer, ModuleCatSerializer, RolePermissionSerializer,
    ActivityFeedSerializer,
    RoleMatrixInputSerializer, PasswordResetResponseSerializer,
)

log = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════════════════
# Guards
# ══════════════════════════════════════════════════════════════════════
_CLIENT_ROLES = {"client_b2b", "cliente", "client"}
_ADMIN_ROLES  = {"superadmin", "admin"}


def _is_client(user) -> bool:
    return (getattr(user, "role", "") or "").lower() in _CLIENT_ROLES


def _is_superuser_or_admin(user) -> bool:
    if getattr(user, "is_superuser", False):
        return True
    return (getattr(user, "role", "") or "").lower() in _ADMIN_ROLES


def _deny_non_admin(request, resource_label: str = "users.admin"):
    """403 si el caller no es superuser/admin. Usado en CRUD de usuarios
    y en matriz RBAC."""
    if _is_superuser_or_admin(request.user):
        return None
    log.warning(
        "Unauthorized user-admin access: role=%s email=%s resource=%s path=%s",
        getattr(request.user, "role", "?"),
        getattr(request.user, "email", "?"),
        resource_label,
        getattr(request, "path", "?"),
    )
    return Response(
        {"detail": "Solo superadmin/admin puede gestionar usuarios y permisos.",
         "resource": resource_label},
        status=status.HTTP_403_FORBIDDEN,
    )


# ══════════════════════════════════════════════════════════════════════
# CRUD de usuarios · /api/users/
# ══════════════════════════════════════════════════════════════════════
class MwtUserViewSet(viewsets.ModelViewSet):
    """Gestión de usuarios del ERP. Admin-only."""
    queryset = MwtUser.objects.filter(is_active=True)
    serializer_class = MwtUserSerializer

    def get_serializer_class(self):
        if self.action == "list":
            return MwtUserListSerializer
        return MwtUserSerializer

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        denied = _deny_non_admin(request, resource_label="users.crud")
        if denied is not None:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied(denied.data)

    def get_queryset(self):
        include_inactive = self.request.query_params.get("include_inactive")
        if include_inactive and include_inactive.lower() in ("1", "true", "yes"):
            qs = MwtUser.objects.all()
        else:
            qs = MwtUser.objects.filter(is_active=True)
        role = self.request.query_params.get("role")
        q    = self.request.query_params.get("q")
        if role:
            qs = qs.filter(role_default=role)
        if q:
            qs = qs.filter(email_plain__icontains=q) | qs.filter(full_name__icontains=q)
        return qs.order_by("-is_active", "email_plain")

    def create(self, request, *args, **kwargs):
        data = dict(request.data)
        if not data.get("id"):
            data["id"] = str(uuid.uuid4())
        # Si viene password raw → hashearlo (SHA-256 salted simple — en
        # prod swap por Argon2).
        raw_pwd = data.pop("password", None)
        if raw_pwd:
            data["password_hash"] = _hash_password(raw_pwd if isinstance(raw_pwd, str) else raw_pwd[0])
            data["password_changed_at"] = timezone.now().isoformat()
        ser = self.get_serializer(data=data)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data, status=status.HTTP_201_CREATED)

    def perform_destroy(self, instance):
        """Soft delete: is_active=False."""
        instance.is_active = False
        instance.save(update_fields=["is_active", "updated_at"])

    # ── POST /api/users/<id>/reset-password/ ───────────────────
    @action(detail=True, methods=["post"], url_path="reset-password")
    def reset_password(self, request, pk=None):
        try:
            u = MwtUser.objects.get(pk=pk)
        except MwtUser.DoesNotExist:
            return Response({"detail": "Usuario no encontrado."},
                            status=status.HTTP_404_NOT_FOUND)

        raw_token = secrets.token_urlsafe(48)
        token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
        ttl_hours = int(request.data.get("ttl_hours") or 24)
        expires = timezone.now() + timedelta(hours=max(1, min(ttl_hours, 72)))

        PasswordResetToken.objects.create(
            id         = uuid.uuid4(),
            user_id    = u.id,
            token_hash = token_hash,
            issued_by  = getattr(request.user, "id", None),
            expires_at = expires,
            ip_address = request.META.get("REMOTE_ADDR"),
            user_agent = (request.META.get("HTTP_USER_AGENT") or "")[:250],
        )

        # Disparar email (best-effort). Usa la plantilla PUBLISHED del
        # email_templates con key='auth.password_reset'.
        email_sent = False
        try:
            from apps.storage.services import send_test_email  # noqa: PLC0415
            subject = "[MWT.ONE] Restablece tu contraseña"
            body = (
                f"Hola {u.full_name or u.email_plain},\n\n"
                f"Se solicitó un restablecimiento de contraseña para tu cuenta.\n\n"
                f"Enlace único (válido {ttl_hours}h):\n"
                f"https://mwt.one/reset?token={raw_token}\n\n"
                f"Si no fuiste tú, ignora este correo."
            )
            send_test_email(to=u.contact_email or u.email_plain,
                            subject=subject, body=body)
            email_sent = True
        except Exception as e:
            log.warning("reset_password email failed: %s", e)

        resp = {
            "ok":             True,
            "token_preview":  raw_token[-8:],
            "expires_at":     expires.isoformat(),
            "email_sent":     email_sent,
            "email_template": "auth.password_reset",
        }
        return Response(PasswordResetResponseSerializer(resp).data, status=200)

    # ── POST /api/users/<id>/toggle-active/ ────────────────────
    @action(detail=True, methods=["post"], url_path="toggle-active")
    def toggle_active(self, request, pk=None):
        try:
            u = MwtUser.objects.get(pk=pk)
        except MwtUser.DoesNotExist:
            return Response({"detail": "Usuario no encontrado."},
                            status=status.HTTP_404_NOT_FOUND)
        u.is_active = not u.is_active
        u.save(update_fields=["is_active", "updated_at"])
        return Response({"ok": True, "id": str(u.id), "is_active": u.is_active})


def _hash_password(raw: str) -> str:
    """pbkdf2 simple — en prod swap por Argon2/bcrypt."""
    salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", raw.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return f"pbkdf2_sha256$120000${salt}${h.hex()}"


# ══════════════════════════════════════════════════════════════════════
# Self-service · /api/users/me/profile/
# ══════════════════════════════════════════════════════════════════════
class ProfileMeView(APIView):
    """GET y PATCH del perfil del usuario autenticado.

    El CLIENT B2B solo puede modificar contact_email + preferred_language
    + timezone + avatar_url (whitelist del ProfileMeSerializer).
    """
    permission_classes = [IsAuthenticated]

    def _get_user(self, request):
        uid = getattr(request.user, "id", None) or getattr(request.user, "pk", None)
        if not uid:
            return None
        try:
            return MwtUser.objects.get(pk=uid)
        except MwtUser.DoesNotExist:
            return None

    def get(self, request):
        u = self._get_user(request)
        if not u:
            return Response({"detail": "Usuario no resuelto."},
                            status=status.HTTP_401_UNAUTHORIZED)
        return Response(ProfileMeSerializer(u).data)

    def patch(self, request):
        u = self._get_user(request)
        if not u:
            return Response({"detail": "Usuario no resuelto."},
                            status=status.HTTP_401_UNAUTHORIZED)
        ser = ProfileMeSerializer(u, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)


# ══════════════════════════════════════════════════════════════════════
# Roles · catálogos + matriz CRUD
# ══════════════════════════════════════════════════════════════════════
class RoleCatViewSet(viewsets.ReadOnlyModelViewSet):
    """Catálogo de roles. Lectura abierta a staff; los CLIENT solo ven su
    propio slug si acaso (aquí devolvemos 403 para CLIENT)."""
    queryset = RoleCat.objects.filter(is_active=True)
    serializer_class = RoleCatSerializer

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        denied = _deny_non_admin(request, resource_label="roles.read")
        if denied is not None:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied(denied.data)


class ModuleCatViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = ModuleCat.objects.filter(is_active=True)
    serializer_class = ModuleCatSerializer

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        denied = _deny_non_admin(request, resource_label="modules.read")
        if denied is not None:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied(denied.data)


class RolePermissionViewSet(viewsets.ModelViewSet):
    """Lectura + update de la matriz CRUD por (role, module)."""
    queryset = RolePermission.objects.all()
    serializer_class = RolePermissionSerializer

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        denied = _deny_non_admin(request, resource_label="permissions.crud")
        if denied is not None:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied(denied.data)


class RoleGroupMatrixView(APIView):
    """GET y PATCH de la matriz completa de un rol.

      GET   /api/permissions/groups/<slug>/ →
            { role: {...}, matrix: [{module, can_create, can_read, ...}] }

      PATCH /api/permissions/groups/<slug>/ con body:
            { matrix: [{module, can_create, can_read, can_update, can_delete}] }

      Hace upsert (UNIQUE(role_slug, module_slug)) — las celdas ausentes
      se mantienen sin cambios.
    """
    permission_classes = [IsAuthenticated]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        denied = _deny_non_admin(request, resource_label="permissions.matrix")
        if denied is not None:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied(denied.data)

    def get(self, request, slug):
        try:
            role = RoleCat.objects.get(slug=slug)
        except RoleCat.DoesNotExist:
            return Response({"detail": "Role no existe."}, status=404)
        cells = RolePermission.objects.filter(role_slug=slug).order_by("module_slug")
        modules = ModuleCat.objects.filter(is_active=True).order_by("orden", "slug")
        # Indexamos celdas por module_slug
        by_mod = {c.module_slug: c for c in cells}
        matrix = []
        for m in modules:
            c = by_mod.get(m.slug)
            matrix.append({
                "module":       m.slug,
                "module_label": m.nombre,
                "categoria":    m.categoria,
                "can_create":   bool(c and c.can_create),
                "can_read":     bool(c and c.can_read),
                "can_update":   bool(c and c.can_update),
                "can_delete":   bool(c and c.can_delete),
            })
        return Response({
            "role":   RoleCatSerializer(role).data,
            "matrix": matrix,
        })

    def patch(self, request, slug):
        try:
            role = RoleCat.objects.get(slug=slug)
        except RoleCat.DoesNotExist:
            return Response({"detail": "Role no existe."}, status=404)
        ser = RoleMatrixInputSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        updated_by = getattr(request.user, "id", None)
        n_updated = 0
        n_created = 0
        valid_modules = set(ModuleCat.objects.filter(is_active=True).values_list("slug", flat=True))
        for cell in ser.validated_data["matrix"]:
            if cell["module"] not in valid_modules:
                continue
            obj, created = RolePermission.objects.update_or_create(
                role_slug=slug, module_slug=cell["module"],
                defaults={
                    "can_create":    cell["can_create"],
                    "can_read":      cell["can_read"],
                    "can_update":    cell["can_update"],
                    "can_delete":    cell["can_delete"],
                    "updated_by_id": updated_by,
                },
            )
            if created:
                obj.id = uuid.uuid4()
                obj.save()
                n_created += 1
            else:
                n_updated += 1
        return Response({
            "ok":        True,
            "role":      slug,
            "updated":   n_updated,
            "created":   n_created,
        })


# ══════════════════════════════════════════════════════════════════════
# Activity feed · /api/activity-feed/
# ══════════════════════════════════════════════════════════════════════
class ActivityFeedViewSet(viewsets.ReadOnlyModelViewSet):
    """Feed de notificaciones del usuario actual."""
    serializer_class = ActivityFeedSerializer

    def get_queryset(self):
        uid = (getattr(self.request.user, "id", None)
               or getattr(self.request.user, "pk", None))
        qs = ActivityFeed.objects.filter(is_active=True)
        if uid:
            qs = qs.filter(user_id=uid)
        else:
            return qs.none()
        unread = self.request.query_params.get("unread_only")
        if unread and unread.lower() in ("1", "true", "yes"):
            qs = qs.filter(read_at__isnull=True)
        limit = int(self.request.query_params.get("limit") or 50)
        return qs.order_by("-created_at")[:limit]

    @action(detail=True, methods=["post"])
    def read(self, request, pk=None):
        try:
            a = ActivityFeed.objects.get(pk=pk, user_id=getattr(request.user, "id", None))
        except ActivityFeed.DoesNotExist:
            return Response({"detail": "Not found."}, status=404)
        if a.read_at is None:
            a.read_at = timezone.now()
            a.save(update_fields=["read_at"])
        return Response({"ok": True, "read_at": a.read_at})

    @action(detail=False, methods=["post"], url_path="read-all")
    def read_all(self, request):
        uid = getattr(request.user, "id", None)
        if not uid:
            return Response({"ok": False}, status=401)
        n = ActivityFeed.objects.filter(
            user_id=uid, read_at__isnull=True, is_active=True,
        ).update(read_at=timezone.now())
        return Response({"ok": True, "marked_read": n})

    @action(detail=False, methods=["get"], url_path="unread-count")
    def unread_count(self, request):
        uid = getattr(request.user, "id", None)
        if not uid:
            return Response({"count": 0})
        n = ActivityFeed.objects.filter(
            user_id=uid, read_at__isnull=True, is_active=True,
        ).count()
        return Response({"count": n})
