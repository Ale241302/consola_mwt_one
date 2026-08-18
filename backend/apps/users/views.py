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


def _client_names_map(leids: list | None = None) -> dict[str, str]:
    """Ola 6 · mapa cliente_id → razon_social para los slugs de grupo MCP.

    `authentik_sync.sync_groups` necesita el nombre de cada cliente para
    derivar el slug del grupo `mcp-cliente-<slug>`. Se resuelve en batch con
    una query (sin N+1). Fail-safe: dict vacío si la tabla no existe.
    """
    from apps.clientes.models import Cliente

    try:
        qs = Cliente.objects.filter(id__in=[x for x in (leids or []) if x])
        return {str(c.id): (c.razon_social or "") for c in qs}
    except Exception:  # noqa: BLE001 - tabla puede no existir en legacy
        return {}


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
    required_module = "usuarios"
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
        # Extraer addresses para procesarlas aparte (transaction.atomic).
        payload_addresses = data.pop("addresses", None)
        # Si viene password raw → hashearlo (SHA-256 salted simple — en
        # prod swap por Argon2).
        raw_pwd = data.pop("password", None)
        if raw_pwd:
            raw_pwd = raw_pwd if isinstance(raw_pwd, str) else raw_pwd[0]
            data["password_hash"] = _hash_password(raw_pwd)
            data["password_changed_at"] = timezone.now().isoformat()

        try:
            with transaction.atomic():
                ser = self.get_serializer(data=data)
                ser.is_valid(raise_exception=True)
                ser.save()

                # Procesar direcciones (si vinieron) en la misma TX.
                if payload_addresses is not None:
                    _process_addresses_atomic(data["id"], payload_addresses)
        except ValueError as e:
            return Response({"detail": str(e)}, status=400)

        # AUTO-SYNC con core.users · sin esto el user no puede loguearse.
        # Toda persona creada via /api/users/ debe poder hacer login
        # inmediatamente — esto upsertea en la tabla que valida el JWT.
        if raw_pwd:
            _sync_to_core_users(
                email      = data.get("email_plain") or "",
                full_name  = data.get("full_name") or "",
                role       = data.get("role_default") or "viewer",
                raw_pwd    = raw_pwd,
                user_uuid  = data["id"],
            )

        # AUTO-SYNC con Authentik (IdP del MCP) · la consola es la fuente de
        # verdad: mismo usuario, mismo password, is_active. Fail-safe: si no
        # está configurado (AUTHENTIK_API_URL/TOKEN) no rompe el create.
        try:
            from .authentik_sync import ensure_user, sync_groups  # noqa: PLC0415
            email = data.get("email_plain") or ""
            ensure_user(
                email     = email,
                full_name = data.get("full_name") or "",
                is_active = True,
                password  = raw_pwd,
            )
            # AUTO-SYNC de grupos por cliente (Ola 6 · app MCP): el usuario se
            # añade/remueve del grupo mcp-cliente-<slug> de cada empresa en su
            # legal_entity_ids. Sin esto, el MCP del cliente no reconocería su
            # pertenencia y el conector fallaría con TENANT_MISMATCH.
            leids = data.get("legal_entity_ids") or []
            if leids:
                sync_groups(email, leids, client_names=_client_names_map())
        except Exception as e:  # noqa: BLE001 - nunca romper el create
            log.exception("authentik sync on create failed: %s", e)

        # Re-leer la instancia para que la respuesta incluya addresses.
        instance = MwtUser.objects.get(pk=data["id"])
        out = self.get_serializer(instance).data
        return Response(out, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        """Misma sincronización si en un PATCH viene password nuevo + addresses."""
        instance = self.get_object()
        data = dict(request.data)
        # Extraer addresses para procesar aparte.
        payload_addresses = data.pop("addresses", None)
        raw_pwd = data.pop("password", None)
        if raw_pwd:
            raw_pwd = raw_pwd if isinstance(raw_pwd, str) else raw_pwd[0]
            data["password_hash"] = _hash_password(raw_pwd)
            data["password_changed_at"] = timezone.now().isoformat()

        try:
            with transaction.atomic():
                ser = self.get_serializer(instance, data=data, partial=True)
                ser.is_valid(raise_exception=True)
                ser.save()

                if payload_addresses is not None:
                    _process_addresses_atomic(instance.id, payload_addresses)
        except ValueError as e:
            return Response({"detail": str(e)}, status=400)

        if raw_pwd:
            _sync_to_core_users(
                email      = ser.data.get("email_plain") or instance.email_plain,
                full_name  = ser.data.get("full_name") or instance.full_name or "",
                role       = ser.data.get("role_default") or instance.role_default,
                raw_pwd    = raw_pwd,
                user_uuid  = str(instance.id),
            )
        # Si hubo cambio de email/nombre/role pero no de password, también
        # actualizamos los campos no-sensibles en core.users (sin tocar el hash).
        elif any(k in data for k in ("email_plain", "full_name", "role_default")):
            _sync_to_core_users_meta(
                old_email = instance.email_plain,
                new_email = ser.data.get("email_plain") or instance.email_plain,
                full_name = ser.data.get("full_name") or instance.full_name or "",
                role      = ser.data.get("role_default") or instance.role_default,
                user_uuid = str(instance.id),
            )

        # AUTO-SYNC con Authentik (IdP del MCP). Fail-safe: nunca rompe el update.
        try:
            from .authentik_sync import ensure_user, set_active, set_password, sync_groups  # noqa: PLC0415
            new_email = ser.data.get("email_plain") or instance.email_plain
            new_name  = ser.data.get("full_name") or instance.full_name or ""
            if raw_pwd:
                # Password nueva → replicar en Authentik (misma password).
                set_password(new_email, raw_pwd)
            else:
                # Sin password: asegurar existencia + name/is_active (el is_active
                # ya se manejó en toggle/soft-delete si cambió por ahí).
                ensure_user(
                    email     = new_email,
                    full_name = new_name,
                    is_active = instance.is_active,
                )
            # AUTO-SYNC de grupos por cliente (Ola 6): al cambiar legal_entity_ids
            # el usuario se añade/remueve del grupo mcp-cliente-<slug> de cada
            # empresa. El MCP del cliente usa ese grupo para validar pertenencia.
            leids = instance.legal_entity_ids or []
            if leids:
                sync_groups(new_email, leids, client_names=_client_names_map())
        except Exception as e:  # noqa: BLE001 - nunca romper el update
            log.exception("authentik sync on update failed: %s", e)

        # Re-leer para devolver addresses actualizadas (las del SerializerMethodField).
        instance.refresh_from_db()
        return Response(self.get_serializer(instance).data)
    partial_update = update

    def perform_destroy(self, instance):
        """Soft delete · sync con core.users.

        Marca is_active=FALSE en mwtuser y replica el cambio a core.users
        (set is_active=FALSE + deleted_at=NOW()). El siguiente request del
        user con su JWT actual recibirá 401 (MwtJWTAuthentication chequea
        deleted_at IS NULL + is_active en cada llamada).
        """
        instance.is_active = False
        instance.save(update_fields=["is_active", "updated_at"])
        _sync_active_to_core_users(
            email     = instance.email_plain,
            user_uuid = str(instance.id),
            is_active = False,
            soft_delete = True,
        )
        # Deshabilitar en Authentik (IdP MCP) · fail-safe.
        try:
            from .authentik_sync import set_active  # noqa: PLC0415
            set_active(instance.email_plain, False)
        except Exception as e:  # noqa: BLE001
            log.exception("authentik disable on delete failed: %s", e)

    # ── POST /api/users/<id>/reset-password/ ───────────────────
    @action(detail=True, methods=["post"], url_path="reset-password")
    def reset_password(self, request, pk=None):
        try:
            u = MwtUser.objects.get(pk=pk)
        except MwtUser.DoesNotExist:
            return Response({"detail": "Usuario no encontrado."},
                            status=status.HTTP_404_NOT_FOUND)

        return Response(
            _issue_password_reset(u, request, request.data.get("ttl_hours")),
            status=200,
        )

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

        # Sync a core.users · si lo inactivamos, el JWT actual queda
        # invalidado en el próximo request (auth chequea is_active).
        # Si lo reactivamos, vuelve a poder loguearse.
        _sync_active_to_core_users(
            email       = u.email_plain,
            user_uuid   = str(u.id),
            is_active   = u.is_active,
            soft_delete = not u.is_active,   # al desactivar, marcamos deleted_at
        )

        # Replicar el estado a Authentik (IdP del MCP) · fail-safe.
        try:
            from .authentik_sync import set_active  # noqa: PLC0415
            set_active(u.email_plain, u.is_active)
        except Exception as e:  # noqa: BLE001
            log.exception("authentik toggle_active failed: %s", e)

        return Response({"ok": True, "id": str(u.id), "is_active": u.is_active})


def _hash_password(raw: str) -> str:
    """pbkdf2 simple — en prod swap por Argon2/bcrypt."""
    salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", raw.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return f"pbkdf2_sha256$120000${salt}${h.hex()}"


# ══════════════════════════════════════════════════════════════════════
# Sync con core.users
#
# El login (apps.core.auth_views.LoginView) valida contra `core.users`
# con SHA-256 (hash_kind='sha256'). El módulo M3-CORE persiste usuarios
# en `users.mwtuser` con un schema más rico (legal_entity_id, addresses,
# etc.). Para que cualquier user creado vía /api/users/ pueda loguearse
# inmediatamente, mantenemos AMBAS tablas sincronizadas:
#
#   · Mismo UUID en ambas (la id del mwtuser se usa también en core.users).
#   · email_plain idéntico.
#   · password_hash en core.users = SHA-256(raw_pwd) · hash_kind='sha256'.
#   · role congruente (superadmin/admin/manager/operator/viewer/client_b2b).
# ══════════════════════════════════════════════════════════════════════
def _sha256(plain: str) -> str:
    return hashlib.sha256(plain.encode("utf-8")).hexdigest()


def _sync_to_core_users(*, email: str, full_name: str, role: str,
                       raw_pwd: str, user_uuid: str) -> None:
    """UPSERT en core.users con password SHA-256.

    Usa el mismo UUID que `users.mwtuser` para que ambas tablas
    referencien al mismo usuario. Si el email ya existe en core.users
    con OTRO id, lo actualizamos (mismo email = misma persona).
    """
    if not email or not raw_pwd:
        return
    email_low = email.strip().lower()
    pwd_hash  = _sha256(raw_pwd)

    try:
        with connection.cursor() as cur:
            cur.execute(
                "SELECT id FROM core.users WHERE lower(email_plain) = %s LIMIT 1",
                [email_low],
            )
            row = cur.fetchone()

            if row:
                # Update — mismo email, sólo refrescamos password + role.
                cur.execute("""
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
                """, [pwd_hash, full_name or "", role, row[0]])
                log.info("core.users · ACTUALIZADO %s (id=%s)", email, row[0])
            else:
                # Insert — usamos el mismo UUID que mwtuser para que las dos
                # tablas referencien al mismo usuario.
                cur.execute("""
                    INSERT INTO core.users
                        (id, email_plain, password_hash, hash_kind, full_name,
                         role, is_active, is_staff, created_at, updated_at)
                    VALUES
                        (%s, %s, %s, 'sha256', %s, %s, TRUE, TRUE, NOW(), NOW())
                """, [user_uuid, email, pwd_hash, full_name or "", role])
                log.info("core.users · CREADO %s (id=%s)", email, user_uuid)
    except Exception as e:
        # Crítico — si falla, el user de mwtuser quedará sin login.
        # No abortamos el create del mwtuser (ya está commiteado), pero
        # registramos error visible para que se pueda corregir manualmente.
        log.exception("core.users sync FAILED for %s: %s", email, e)


def _sync_to_core_users_meta(*, old_email: str, new_email: str,
                              full_name: str, role: str, user_uuid: str) -> None:
    """Actualiza datos no-sensibles en core.users (sin tocar password).

    Útil cuando el admin edita un user para cambiar nombre/role pero
    no cambia su contraseña.
    """
    if not new_email:
        return
    try:
        with connection.cursor() as cur:
            # Buscar por email viejo o por UUID — lo que coincida primero.
            cur.execute("""
                SELECT id FROM core.users
                 WHERE lower(email_plain) = %s OR id = %s
                 LIMIT 1
            """, [(old_email or "").strip().lower(), user_uuid])
            row = cur.fetchone()
            if not row:
                return
            cur.execute("""
                UPDATE core.users
                   SET email_plain = %s,
                       full_name   = %s,
                       role        = %s,
                       updated_at  = NOW()
                 WHERE id = %s
            """, [new_email, full_name or "", role, row[0]])
    except Exception as e:
        log.exception("core.users meta-sync FAILED for %s: %s", new_email, e)


def _sync_active_to_core_users(*, email: str, user_uuid: str,
                                is_active: bool, soft_delete: bool = False) -> None:
    """Replica el estado is_active a core.users.

    Cuando soft_delete=True, también setea deleted_at=NOW() — eso hace que
    MwtJWTAuthentication.get_user() rechace el token con 401 inmediatamente
    (la query incluye `WHERE deleted_at IS NULL`).

    Cuando soft_delete=False y is_active=True (reactivación), limpia
    deleted_at para que el user vuelva a poder loguearse.
    """
    if not (email or user_uuid):
        return
    try:
        with connection.cursor() as cur:
            # Buscar por UUID primero (ambas tablas comparten id), email como fallback.
            cur.execute("""
                SELECT id FROM core.users
                 WHERE id = %s OR lower(email_plain) = %s
                 LIMIT 1
            """, [user_uuid, (email or "").strip().lower()])
            row = cur.fetchone()
            if not row:
                log.info("core.users sync_active: no row found for %s/%s",
                         email, user_uuid)
                return

            if soft_delete:
                cur.execute("""
                    UPDATE core.users
                       SET is_active  = FALSE,
                           deleted_at = NOW(),
                           updated_at = NOW()
                     WHERE id = %s
                """, [row[0]])
                log.info("core.users · DESACTIVADO + soft-delete %s (id=%s)", email, row[0])
            elif is_active:
                cur.execute("""
                    UPDATE core.users
                       SET is_active  = TRUE,
                           deleted_at = NULL,
                           updated_at = NOW()
                     WHERE id = %s
                """, [row[0]])
                log.info("core.users · REACTIVADO %s (id=%s)", email, row[0])
            else:
                cur.execute("""
                    UPDATE core.users
                       SET is_active  = FALSE,
                           updated_at = NOW()
                     WHERE id = %s
                """, [row[0]])
                log.info("core.users · DESACTIVADO %s (id=%s)", email, row[0])
    except Exception as e:
        log.exception("core.users sync_active FAILED for %s: %s", email, e)


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
    "full_name",          # self-editable desde /perfil (2026-06-14)
    "contact_email",
    "phone",
    "preferred_language",
    "timezone",
    "avatar_url",
}


def _issue_password_reset(u, request, ttl_hours=24):
    """Crea token de reset + envía email. Compartido por el reset admin
    (/users/<id>/reset-password/) y el self-service (/users/me/reset-password/).
    Devuelve el shape de respuesta (dict) listo para Response()."""
    raw_token = secrets.token_urlsafe(48)
    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    ttl_hours = int(ttl_hours or 24)
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

    # Disparar email · usa templates Django (HTML + texto plano).
    from django.template.loader import render_to_string  # noqa: PLC0415
    from django.utils import timezone as _tz             # noqa: PLC0415
    from apps.storage.services import send_test_email    # noqa: PLC0415

    reset_url = f"https://consola.mwt.one/reset?token={raw_token}"
    ctx = {
        "full_name":     u.full_name or "",
        "email":         u.email_plain,
        "reset_url":     reset_url,
        "ttl_hours":     ttl_hours,
        "support_email": "info@mwt.one",
        "header_title":  "Restablecimiento de contraseña",
        "preheader":     f"Solicitud de restablecimiento de contraseña — válida por {ttl_hours} horas.",
        "year":          _tz.now().year,
    }
    subject = "[MWT·ONE] Restablece tu contraseña"
    try:
        html_body = render_to_string("users/email/password_reset.html", ctx)
        text_body = render_to_string("users/email/password_reset.txt",  ctx)
    except Exception as e:
        log.exception("render_to_string falló para password_reset: %s", e)
        html_body = None
        text_body = (
            f"Hola {u.full_name or u.email_plain},\n\n"
            f"Para restablecer tu contraseña entra a:\n{reset_url}\n\n"
            f"Válido {ttl_hours} horas."
        )

    result = send_test_email(
        to=u.contact_email or u.email_plain,
        subject=subject,
        body=text_body,
        html_body=html_body,
    )
    return {
        "ok":             True,
        "token_preview":  raw_token[-8:],
        "expires_at":     expires.isoformat(),
        "email_sent":     bool(result.get("ok")),
        "email_template": "auth.password_reset",
        "email_to":       result.get("to"),
        "email_from":     result.get("from"),
        "email_backend":  result.get("backend"),
        "email_error":    result.get("error"),
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
        # NINGÚN campo es obligatorio · permitimos crear direcciones
        # con todos los campos vacíos (caso "guardo solo el label como
        # placeholder mientras consigo el resto").
        new_addr = UserAddress.objects.create(
            id             = uuid.uuid4(),
            user_id        = user_id,
            label          = item.get("label") or None,
            kind           = item.get("kind") or "SHIPPING",
            contact_name   = item.get("contact_name") or None,
            contact_phone  = item.get("contact_phone") or None,
            address_line_1 = item.get("address_line_1") or None,
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
        """Resuelve el perfil de mwtuser para el JWT del request.

        Estrategia de búsqueda en cascada (autoprovisión lazy):
          1) Por UUID exacto (caso normal — el JWT trae el id de mwtuser).
          2) Por email_plain (caso histórico — usuario creado por
             seed_admins en core.users sin fila correspondiente en mwtuser).
          3) Auto-create — si tampoco está por email, crea la fila en
             mwtuser con los datos del JWT + core.users. Así cualquier
             usuario que pueda hacer login obtiene perfil al primer
             acceso a /me/profile/, sin tener que correr comandos.
        """
        uid   = getattr(request.user, "id",    None) or getattr(request.user, "pk", None)
        email = getattr(request.user, "email", None)
        role  = getattr(request.user, "role",  None) or "viewer"
        full  = getattr(request.user, "full_name", None) or ""

        if not (uid or email):
            return None

        # 1) Lookup por UUID
        if uid:
            try:
                return MwtUser.objects.get(pk=uid)
            except MwtUser.DoesNotExist:
                pass

        # 2) Lookup por email
        if email:
            existing = MwtUser.objects.filter(email_plain__iexact=email).first()
            if existing:
                return existing

        # 3) Auto-provision · creamos la fila usando el id del JWT (mismo
        #    UUID que core.users → ambas tablas referencian al mismo user).
        if not (uid and email):
            return None

        try:
            new_user = MwtUser.objects.create(
                id                 = uid,
                email_plain        = email,
                full_name          = full,
                role_default       = role,
                preferred_language = "es",
                timezone           = "America/Lima",
                is_active          = True,
                is_superuser       = role in ("superadmin", "admin"),
            )
            log.info("mwtuser autoprovision · creado %s (id=%s, role=%s)",
                     email, uid, role)
            return new_user
        except Exception as e:
            log.exception("mwtuser autoprovision FAILED for %s/%s: %s",
                          email, uid, e)
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
                    # Si cambió el nombre, lo replicamos a core.users (tabla de
                    # auth) para que login/JWT y mwtuser no diverjan. Mismo UUID
                    # en ambas tablas. Best-effort: no rompe el PATCH si falla.
                    if "full_name" in safe_payload:
                        try:
                            with connection.cursor() as _c:
                                _c.execute(
                                    "UPDATE core.users SET full_name = %s WHERE id = %s",
                                    [u.full_name or "", str(u.id)],
                                )
                        except Exception:
                            log.warning("sync full_name -> core.users falló para %s", u.id)

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


class ProfileResetPasswordView(APIView):
    """POST /api/users/me/reset-password/ — el propio usuario pide un enlace
    de restablecimiento de contraseña a su email de contacto.

    Accesible para CUALQUIER usuario autenticado (staff + CLIENT B2B). Reusa
    la misma lógica de token+email que el reset admin (_issue_password_reset).
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        uid   = getattr(request.user, "id", None) or getattr(request.user, "pk", None)
        email = getattr(request.user, "email", None)
        u = None
        if uid:
            u = MwtUser.objects.filter(pk=uid).first()
        if u is None and email:
            u = MwtUser.objects.filter(email_plain__iexact=email).first()
        if u is None:
            return Response({"detail": "Usuario no resuelto."},
                            status=status.HTTP_401_UNAUTHORIZED)
        return Response(_issue_password_reset(u, request, 24), status=200)



# Los ViewSets de roles/RBAC viven en apps.roles.views (CRUD de RoleCat,
# ModuleCat, RolePermission + matriz RoleGroupMatrixView). El frontend los
# sigue consumiendo en /api/roles/, /api/permissions/* — sin cambios.

# ══════════════════════════════════════════════════════════════════════
# Activity feed · /api/activity-feed/
# ══════════════════════════════════════════════════════════════════════
class ActivityFeedViewSet(viewsets.ReadOnlyModelViewSet):
    """Feed de notificaciones del usuario actual."""
    required_module = "usuarios"
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
    required_module = "usuarios"
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
