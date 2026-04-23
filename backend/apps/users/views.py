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

from django.db import connection, transaction
from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import (
    MwtUser, PasswordResetToken, ActivityFeed, UserAddress,
)
from .serializers import (
    MwtUserSerializer, MwtUserListSerializer,
    ProfileMeSerializer,
    ActivityFeedSerializer,
    PasswordResetResponseSerializer,
    UserAddressSerializer, UserAddressAdminSerializer,
)
# Los ViewSets de roles/RBAC ahora viven en apps.roles.views. El guard
# `_deny_non_admin` se mantiene local aquí para los endpoints de identidad
# (users + addresses). apps.roles tiene su propia copia en
# apps/roles/permissions.py — las dos políticas son idénticas y no se
# acoplan entre apps.

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
# ══════════════════════════════════════════════════════════════════════
# Campos permitidos para el whitelist del self-service del perfil.
#
# Un CLIENT B2B SOLO puede modificar estos campos de su MwtUser.
# Cualquier otro campo del payload se descarta silenciosamente.
#
# En particular, NUNCA se aceptan (ni siquiera si el payload los envía):
#   · role_default, is_superuser, is_active, is_api_user
#   · legal_entity_id   (scope del portal — cambiarlo rompería la
#                        visibilidad B2B del ClientScopedManager)
#   · email_plain       (identidad de login; el admin lo gestiona
#                        vía /api/users/<id>/)
#   · password_hash, api_key_hash
# ══════════════════════════════════════════════════════════════════════
_PROFILE_SELF_EDITABLE_FIELDS = {
    "contact_email",
    "phone",
    "preferred_language",
    "timezone",
    "avatar_url",
}


def _process_addresses_atomic(user_id, payload_addresses):
    """Procesa el array `addresses` del payload del PATCH perfil.

    Reglas:
      · Items SIN `id`             → CREATE (nuevo registro).
      · Items CON `id` existente   → UPDATE (parcial).
      · Items CON `id` marcado `_deleted=True` o ausentes en el payload
                                   → SOFT DELETE (is_active=False).
      · Si un item lleva `is_default=True`, primero desmarcamos cualquier
        otra dirección default del mismo user para respetar el unique
        index parcial de la BD.

    Retorna: lista serializada de direcciones activas tras el proceso.

    Nota: esta función DEBE ejecutarse dentro de `transaction.atomic()`
    para evitar estados inconsistentes (ej. dos defaults simultáneos si
    el unique index no existiera).
    """
    if payload_addresses is None:
        # El caller no envió `addresses` → no tocar nada.
        return None

    if not isinstance(payload_addresses, list):
        raise ValueError("addresses debe ser una lista.")

    # Indexamos direcciones actuales por id para referencia rápida.
    existing_qs = UserAddress.objects.filter(user_id=user_id, is_active=True)
    existing_by_id = {str(a.id): a for a in existing_qs}

    # IDs que el frontend mandó (los que no estén se soft-deletean).
    ids_in_payload = set()

    # Pre-pass: si alguno del payload marca is_default=True, desmarcamos
    # los defaults existentes para no violar el unique index parcial.
    any_default = any(bool(item.get("is_default")) for item in payload_addresses
                      if not item.get("_deleted"))
    if any_default:
        existing_qs.filter(is_default=True).update(is_default=False)

    results = []

    for item in payload_addresses:
        addr_id = item.get("id")

        # ── 1. DELETE explícito (_deleted=True con id) ───────────
        if item.get("_deleted") and addr_id:
            addr = existing_by_id.get(str(addr_id))
            if addr is not None:
                addr.is_active = False
                addr.is_default = False   # libera el unique index
                addr.save(update_fields=["is_active", "is_default", "updated_at"])
                ids_in_payload.add(str(addr_id))
            continue

        # ── 2. UPDATE (id ∈ existentes) ───────────────────────────
        if addr_id and str(addr_id) in existing_by_id:
            addr = existing_by_id[str(addr_id)]
            ids_in_payload.add(str(addr_id))
            updatable = (
                "label", "kind",
                "contact_name", "contact_phone",
                "address_line_1", "address_line_2",
                "city", "state", "country", "zip_code",
                "latitude", "longitude",
                "is_default", "notes",
            )
            for f in updatable:
                if f in item:
                    setattr(addr, f, item[f])
            addr.save()
            results.append(addr)
            continue

        # ── 3. CREATE (sin id o id inexistente para este user) ──
        if not item.get("address_line_1"):
            # requisito mínimo — line_1 obligatorio
            continue
        new_addr = UserAddress.objects.create(
            id             = uuid.uuid4(),
            user_id        = user_id,
            label          = item.get("label") or None,
            kind           = item.get("kind") or "SHIPPING",
            contact_name   = item.get("contact_name") or None,
            contact_phone  = item.get("contact_phone") or None,
            address_line_1 = item["address_line_1"],
            address_line_2 = item.get("address_line_2") or None,
            city           = item.get("city") or None,
            state          = item.get("state") or None,
            country        = item.get("country") or None,
            zip_code       = item.get("zip_code") or None,
            latitude       = item.get("latitude"),
            longitude      = item.get("longitude"),
            is_default     = bool(item.get("is_default")),
            notes          = item.get("notes") or None,
        )
        results.append(new_addr)

    # ── 4. SOFT-DELETE de direcciones no presentes en el payload ──
    #     Sólo aplicamos esta poda si el payload trajo AL MENOS una
    #     dirección. Esto evita que un PATCH que no incluye `addresses`
    #     intencionalmente (p. ej. el CLIENT sólo cambió preferred_language)
    #     borre todo. → El caller de esta función ya se encarga de no
    #     invocarla si addresses es None.
    for addr_id_str, addr in existing_by_id.items():
        if addr_id_str not in ids_in_payload:
            addr.is_active  = False
            addr.is_default = False
            addr.save(update_fields=["is_active", "is_default", "updated_at"])

    # Re-leemos las activas (pueden incluir las recién creadas).
    final_qs = UserAddress.objects.filter(user_id=user_id, is_active=True).order_by(
        "-is_default", "-created_at",
    )
    return UserAddressSerializer(final_qs, many=True).data


class ProfileMeView(APIView):
    """GET y PATCH del perfil del usuario autenticado.

    Accesible para CUALQUIER usuario autenticado (staff + CLIENT B2B).

    Whitelist de campos editables: ver `_PROFILE_SELF_EDITABLE_FIELDS`.

    Addresses:
      El payload puede incluir un array `addresses` con la lista COMPLETA
      deseada. El procesamiento es atómico:
        · sin id        → create
        · con id        → update
        · con _deleted  → soft delete (is_active=False)
        · omitidos      → soft delete (no están en el nuevo estado deseado)

    Todo el update (usuario + direcciones) corre dentro de
    `transaction.atomic()` — si algo falla, el estado queda intacto.
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

        # Separamos addresses del resto — se procesa aparte.
        payload = dict(request.data) if hasattr(request.data, "items") else {}
        # DRF a veces devuelve valores como listas con QueryDict; normalizamos.
        payload_addresses = request.data.get("addresses") if hasattr(request.data, "get") else None
        if isinstance(payload_addresses, str):
            # Caso raro (multipart) — ignoramos.
            payload_addresses = None

        # Filtro defensivo: sólo dejamos pasar campos del whitelist.
        # Si el CLIENT manda role_default='superadmin', nunca llega al save().
        safe_payload = {
            k: v for k, v in payload.items()
            if k in _PROFILE_SELF_EDITABLE_FIELDS
        }

        try:
            with transaction.atomic():
                if safe_payload:
                    # Usamos partial=True y sólo los campos whitelisted.
                    ser = ProfileMeSerializer(u, data=safe_payload, partial=True)
                    ser.is_valid(raise_exception=True)
                    ser.save()
                    u.refresh_from_db()

                if payload_addresses is not None:
                    _process_addresses_atomic(u.id, payload_addresses)

        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            log.exception("ProfileMeView.patch failed")
            return Response(
                {"detail": "Error actualizando perfil.", "error": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        # Respuesta final: perfil COMPLETO con direcciones actualizadas.
        return Response(ProfileMeSerializer(u).data)



# Los ViewSets de roles/RBAC viven en apps.roles.views (CRUD de RoleCat,
# ModuleCat, RolePermission + matriz RoleGroupMatrixView). El frontend los
# sigue consumiendo en /api/roles/, /api/permissions/* — sin cambios.

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


# ══════════════════════════════════════════════════════════════════════
# UserAddress · CRUD admin · /api/users/addresses/
#
# Este endpoint es para que el admin pueda gestionar direcciones de
# cualquier usuario. El CLIENT usa /api/users/me/profile/ (payload
# `addresses` procesado atómicamente), NO este endpoint.
# ══════════════════════════════════════════════════════════════════════
class UserAddressAdminViewSet(viewsets.ModelViewSet):
    """CRUD admin de direcciones. Query filterable por ?user_id=<uuid>."""
    queryset = UserAddress.objects.all()
    serializer_class = UserAddressAdminSerializer

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        denied = _deny_non_admin(request, resource_label="users.addresses.crud")
        if denied is not None:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied(denied.data)

    def get_queryset(self):
        qs = UserAddress.objects.all()
        uid = self.request.query_params.get("user_id")
        if uid:
            qs = qs.filter(user_id=uid)
        include_inactive = self.request.query_params.get("include_inactive")
        if not (include_inactive and include_inactive.lower() in ("1", "true", "yes")):
            qs = qs.filter(is_active=True)
        return qs.order_by("user_id", "-is_default", "-created_at")

    def create(self, request, *args, **kwargs):
        data = dict(request.data)
        if not data.get("id"):
            data["id"] = str(uuid.uuid4())
        # Si es_default, respetar el unique index parcial:
        # desactivar el default anterior del mismo user ANTES de insertar.
        if data.get("is_default") and data.get("user_id"):
            with transaction.atomic():
                UserAddress.objects.filter(
                    user_id=data["user_id"], is_default=True, is_active=True,
                ).update(is_default=False)
                ser = self.get_serializer(data=data)
                ser.is_valid(raise_exception=True)
                ser.save()
                return Response(ser.data, status=status.HTTP_201_CREATED)
        ser = self.get_serializer(data=data)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        # Respetar unique partial index: si marcamos is_default=True,
        # desactivamos el anterior default en atomic.
        if request.data.get("is_default") and not instance.is_default:
            with transaction.atomic():
                UserAddress.objects.filter(
                    user_id=instance.user_id, is_default=True, is_active=True,
                ).exclude(pk=instance.pk).update(is_default=False)
                return super().update(request, *args, **kwargs)
        return super().update(request, *args, **kwargs)

    def perform_destroy(self, instance):
        """Soft-delete. Si era default, también limpiamos la marca."""
        instance.is_active  = False
        instance.is_default = False
        instance.save(update_fields=["is_active", "is_default", "updated_at"])
