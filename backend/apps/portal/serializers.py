from rest_framework import serializers
from .models import MwtUser, PortalSessionLog, PortalAuditLog


class MwtUserListSerializer(serializers.ModelSerializer):
    class Meta:
        model  = MwtUser
        fields = (
            "id", "email", "full_name", "role",
            "legal_entity_id", "phone", "locale", "timezone",
            "is_api_user", "last_login_at", "accepted_at",
            "failed_login_count", "locked_until",
            "is_active", "updated_at",
        )


class MwtUserSerializer(serializers.ModelSerializer):
    class Meta:
        model  = MwtUser
        fields = "__all__"
        # Nunca devolver password_hash ni api_key_hash en responses
        extra_kwargs = {
            "password_hash": {"write_only": True},
            "api_key_hash":  {"write_only": True},
        }


class PortalSessionLogSerializer(serializers.ModelSerializer):
    class Meta:
        model  = PortalSessionLog
        fields = "__all__"


class PortalAuditLogSerializer(serializers.ModelSerializer):
    class Meta:
        model  = PortalAuditLog
        fields = "__all__"
