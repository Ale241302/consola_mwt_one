from rest_framework import serializers
from .models import NotificationLog


class NotificationLogListSerializer(serializers.ModelSerializer):
    class Meta:
        model  = NotificationLog
        fields = (
            "id", "ts", "completed_at",
            "expediente_id", "proforma_id",
            "template_key", "template_id",
            "recipient_email", "subject",
            "trigger", "status", "retries", "attempt_count",
            "amount_overdue", "grace_days_used", "currency",
            "is_active",
        )


class NotificationLogSerializer(serializers.ModelSerializer):
    class Meta:
        model  = NotificationLog
        fields = "__all__"
