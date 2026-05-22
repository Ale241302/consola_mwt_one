"""
=====================================================================
MWT.ONE · apps.roles.serializers
Agente responsable: [AG-BACKEND]
=====================================================================
"""
from rest_framework import serializers
from .models import RoleCat, ModuleCat, RolePermission, UserRoleBridge


# ─────────────────────────────────────────────────────────────────────
# Catálogos simples
# ─────────────────────────────────────────────────────────────────────
class RoleCatSerializer(serializers.ModelSerializer):
    class Meta:
        model  = RoleCat
        fields = "__all__"


class ModuleCatSerializer(serializers.ModelSerializer):
    class Meta:
        model  = ModuleCat
        fields = "__all__"


class RolePermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model  = RolePermission
        fields = "__all__"


class UserRoleBridgeSerializer(serializers.ModelSerializer):
    class Meta:
        model  = UserRoleBridge
        fields = "__all__"


# ─────────────────────────────────────────────────────────────────────
# Matriz RBAC · payload del endpoint /api/permissions/groups/<slug>/
#
# Shape del PATCH:
#   {
#     "matrix": [
#       { "module": "expedientes", "can_create": true, "can_read": true,
#         "can_update": true, "can_delete": false },
#       ...
#     ]
#   }
# ─────────────────────────────────────────────────────────────────────
class RoleMatrixCellSerializer(serializers.Serializer):
    module     = serializers.CharField(max_length=32)
    can_create = serializers.BooleanField(default=False)
    can_read   = serializers.BooleanField(default=False)
    can_update = serializers.BooleanField(default=False)
    can_delete = serializers.BooleanField(default=False)
    # Sprint 2026-05-21 · A5 RBAC redesign — acciones documentales
    can_upload_doc   = serializers.BooleanField(default=False)
    can_download_doc = serializers.BooleanField(default=False)
    can_view_doc     = serializers.BooleanField(default=False)


class RoleMatrixInputSerializer(serializers.Serializer):
    matrix = RoleMatrixCellSerializer(many=True)
