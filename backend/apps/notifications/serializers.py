from rest_framework import serializers
from .models import NotificationLog, GraceDaysCat, EmailQueueLog


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
            "idempotence_token", "retry_of", "queue_id", "celery_task_id",
            "bounced_at", "bounce_reason",
            "is_active",
        )


class NotificationLogSerializer(serializers.ModelSerializer):
    class Meta:
        model  = NotificationLog
        fields = "__all__"


class GraceDaysCatSerializer(serializers.ModelSerializer):
    class Meta:
        model  = GraceDaysCat
        fields = "__all__"


class EmailQueueLogSerializer(serializers.ModelSerializer):
    class Meta:
        model  = EmailQueueLog
        fields = "__all__"
