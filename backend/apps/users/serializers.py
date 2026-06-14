"""
=====================================================================
MWT.ONE · apps.users.serializers
Agente responsable: [AG-BACKEND]

Reglas:
  · password_hash + api_key_hash SIEMPRE write_only.
  · contact_email y preferred_language son los UNICOS campos que el
    CLIENT puede modificar vía /api/users/me/profile/ (ProfileMeSerializer).
  · El staff admin ve todo el modelo vía MwtUserSerializer.
=====================================================================
"""
from rest_framework import serializers
from .models import (
    MwtUser, PasswordResetToken, ActivityFeed, UserAddress,
)
# Los serializers de RoleCat/ModuleCat/RolePermission/matriz RBAC se
# movieron a apps.roles.serializers. Aquí solo quedan los de identidad.


# ─────────────────────────────────────────────────────────────────────
# UserAddress · direcciones múltiples del usuario
#
# Nota de seguridad:
#   · `user_id` NO está en `fields` para el serializer público. Se setea
#     siempre desde el backend (request.user.id o pk path), NUNCA desde
#     el payload — esto impide que un cliente pueda sembrar direcciones
#     bajo otro usuario cambiando el user_id del body.
# ─────────────────────────────────────────────────────────────────────
class UserAddressSerializer(serializers.ModelSerializer):
    class Meta:
        model  = UserAddress
        fields = (
            "id",
            "label", "kind",
            "contact_name", "contact_phone",
            "address_line_1", "address_line_2",
            "city", "state", "country", "zip_code",
            "latitude", "longitude",
            "is_default", "notes",
            "is_active",
            "created_at", "updated_at",
        )
        read_only_fields = ("id", "is_active", "created_at", "updated_at")


class UserAddressAdminSerializer(serializers.ModelSerializer):
    """Variante ADMIN: incluye `user_id` para listar direcciones de cualquier usuario."""
    class Meta:
        model  = UserAddress
        fields = "__all__"
        read_only_fields = ("created_at", "updated_at")


# ─────────────────────────────────────────────────────────────────────
# MwtUser · CRUD para el admin
# ─────────────────────────────────────────────────────────────────────
class MwtUserListSerializer(serializers.ModelSerializer):
    class Meta:
        model  = MwtUser
        fields = (
            "id", "email_plain", "full_name", "contact_email", "phone",
            "preferred_language", "timezone", "avatar_url",
            "legal_entity_id", "legal_entity_ids",
            "role_default", "is_superuser",
            "last_login_at", "failed_login_count", "locked_until",
            "is_active", "created_at", "updated_at",
        )
        read_only_fields = (
            "id", "last_login_at", "failed_login_count", "locked_until",
            "created_at", "updated_at",
        )


class MwtUserSerializer(serializers.ModelSerializer):
    """Serializer admin · CRUD completo + addresses anidadas read-only.

    El PATCH/POST puede recibir `addresses[]` en el payload, pero la
    persistencia la hace `_process_addresses_atomic()` en el ViewSet
    (transaction.atomic con create/update/soft-delete por id).

    Sprint Usuarios multi-empresa (2026-04-29):
      · `legal_entity_ids` (array) es el campo CANÓNICO de scope.
      · `legal_entity_id`  (singular) se sincroniza al primer elemento
        del array (retrocompat con Portal / Wizard / código legacy
        que solo lee el campo singular).
    """
    addresses = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model  = MwtUser
        fields = "__all__"
        extra_kwargs = {
            "password_hash": {"write_only": True, "required": False},
            "api_key_hash":  {"write_only": True, "required": False},
        }

    def get_addresses(self, obj):
        from .models import UserAddress
        qs = UserAddress.objects.filter(user_id=obj.id, is_active=True).order_by(
            "-is_default", "-created_at",
        )
        return UserAddressSerializer(qs, many=True).data

    # ── Sincronización legal_entity_id ↔ legal_entity_ids ──────────
    # Los dos campos quedan acoplados en write para que código legacy
    # (Portal B2B, Wizard) que solo lee el singular siga funcionando.
    def _sync_entity_fields(self, attrs):
        ids   = attrs.get("legal_entity_ids", None)
        prim  = attrs.get("legal_entity_id",  None)
        # Caso 1: viene array → primario = primer elemento
        if isinstance(ids, list):
            ids = [str(x) for x in ids if x]   # normalizar a str y dropear falsy
            attrs["legal_entity_ids"] = ids
            attrs["legal_entity_id"]  = ids[0] if ids else None
            return
        # Caso 2: viene solo singular → array = [singular]
        if prim is not None and "legal_entity_ids" not in attrs:
            attrs["legal_entity_ids"] = [str(prim)] if prim else []
            return

    def validate(self, attrs):
        attrs = super().validate(attrs)
        self._sync_entity_fields(attrs)
        return attrs


# ─────────────────────────────────────────────────────────────────────
# Profile self-service (CLIENT) — /api/users/me/profile/
#
# Whitelist ESTRICTA: sólo contact_email + preferred_language.
# Si un CLIENT intenta mandar role_default='superadmin' o legal_entity_id
# distinto, esos campos simplemente se ignoran (no están en `fields`).
# ─────────────────────────────────────────────────────────────────────
class ProfileMeSerializer(serializers.ModelSerializer):
    """Whitelist del self-service.

    Campos escribibles por un CLIENT B2B:
      · contact_email
      · phone
      · preferred_language
      · timezone
      · avatar_url

    Campos BLINDADOS (read_only_fields) — un CLIENT NUNCA puede cambiarlos:
      · role_default        → permisos
      · legal_entity_id     → scope del portal
      · is_superuser, is_active, is_api_user
      · email_plain         → login identity
      · full_name           → lo cambia el admin (gobernanza de identidad)
    """

    # Las direcciones se exponen como nested read-only en GET.
    # El PATCH procesa `addresses` como lista aparte en la vista
    # (transaction.atomic), no por este campo.
    addresses = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model  = MwtUser
        fields = (
            "id",
            "email_plain", "full_name",
            "contact_email",
            "phone",
            "preferred_language",
            "timezone",
            "avatar_url",
            "role_default",
            "legal_entity_id",
            "is_active",
            "addresses",
        )
        read_only_fields = (
            "id",
            "email_plain",
            # full_name: self-editable desde /perfil (2026-06-14). El admin lo
            # sigue gestionando vía /users/<id>/; aquí el propio usuario puede
            # corregir su nombre. role_default/email_plain SIGUEN blindados.
            "role_default",
            "legal_entity_id",
            "is_active",
            "addresses",
        )

    def get_addresses(self, obj):
        qs = UserAddress.objects.filter(user_id=obj.id, is_active=True).order_by(
            "-is_default", "-created_at",
        )
        return UserAddressSerializer(qs, many=True).data


# ─────────────────────────────────────────────────────────────────────
# Activity feed (campana)
# ─────────────────────────────────────────────────────────────────────
class ActivityFeedSerializer(serializers.ModelSerializer):
    class Meta:
        model  = ActivityFeed
        fields = (
            "id", "user_id", "kind", "title", "body", "icon", "severity",
            "deep_link", "related_type", "related_id",
            "read_at", "is_active", "created_at",
        )
        read_only_fields = fields


# ─────────────────────────────────────────────────────────────────────
# Reset password · payload genérico
# ─────────────────────────────────────────────────────────────────────
class PasswordResetResponseSerializer(serializers.Serializer):
    ok              = serializers.BooleanField()
    token_preview   = serializers.CharField()   # últimos 8 chars (auditoría)
    expires_at      = serializers.DateTimeField()
    email_sent      = serializers.BooleanField()
    email_template  = serializers.CharField()
