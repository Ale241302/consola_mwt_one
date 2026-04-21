"""
=====================================================================
MWT.ONE · apps.analytics.serializers
Agente responsable: [AG-BACKEND]
=====================================================================
"""
from rest_framework import serializers
from .models import DashboardSnapshot, WidgetCat


class DashboardSnapshotSerializer(serializers.ModelSerializer):
    class Meta:
        model  = DashboardSnapshot
        fields = "__all__"


class DashboardSnapshotListSerializer(serializers.ModelSerializer):
    class Meta:
        model  = DashboardSnapshot
        fields = (
            "id", "user_id", "snapshot_type", "label",
            "period_start", "period_end", "is_pinned",
            "generated_by", "generated_at", "expires_at",
            "scope_hash", "idempotence_token",
            "is_active", "created_at", "updated_at",
        )


class WidgetCatSerializer(serializers.ModelSerializer):
    class Meta:
        model  = WidgetCat
        fields = "__all__"
