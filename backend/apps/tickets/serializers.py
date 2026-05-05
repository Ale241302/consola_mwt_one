"""
=====================================================================
MWT.ONE · apps.tickets.serializers
Agente responsable: [AG-02 · AG-BACKEND]
=====================================================================
"""
from rest_framework import serializers

from .models import (
    Ticket, TicketMessage, TicketAttachment,
    ReasonCat, StatusCat,
)


class ReasonCatSerializer(serializers.ModelSerializer):
    class Meta:
        model  = ReasonCat
        fields = ("codigo", "label_es", "label_en", "orden")


class StatusCatSerializer(serializers.ModelSerializer):
    class Meta:
        model  = StatusCat
        fields = ("codigo", "label_es", "label_en", "color",
                  "orden", "admin_only", "estado_final")


class TicketAttachmentSerializer(serializers.ModelSerializer):
    """Adjunto. download_url se resuelve fuera (signed URL on demand)."""
    class Meta:
        model  = TicketAttachment
        fields = (
            "id", "ticket_id", "message_id",
            "file_object_key", "file_name", "file_size_bytes",
            "file_mime", "file_kind",
            "uploaded_by_id", "is_active", "created_at",
        )
        read_only_fields = ("id", "created_at", "is_active")


class TicketMessageSerializer(serializers.ModelSerializer):
    attachments = serializers.SerializerMethodField()

    class Meta:
        model  = TicketMessage
        fields = (
            "id", "ticket_id", "sender_id", "sender_email", "sender_role",
            "content", "is_active", "created_at", "updated_at",
            "attachments",
        )
        read_only_fields = ("id", "ticket_id", "sender_id", "sender_email",
                            "sender_role", "is_active",
                            "created_at", "updated_at")

    def get_attachments(self, obj):
        qs = TicketAttachment.objects.filter(message_id=obj.id, is_active=True)
        return TicketAttachmentSerializer(qs, many=True).data

    def validate_content(self, v):
        v = (v or "").strip()
        if not v:
            raise serializers.ValidationError("El mensaje no puede estar vacio.")
        return v


class TicketSerializer(serializers.ModelSerializer):
    """Detalle: incluye mensajes + adjuntos del ticket."""
    messages    = serializers.SerializerMethodField()
    attachments = serializers.SerializerMethodField()
    is_finalized = serializers.SerializerMethodField()
    reason_label = serializers.SerializerMethodField()
    status_label = serializers.SerializerMethodField()

    class Meta:
        model  = Ticket
        fields = (
            "id", "user_id", "user_email", "user_full_name",
            "context_url", "reason", "reason_label",
            "description", "status", "status_label",
            "finalized_at", "finalized_by_id", "first_response_at",
            "is_active", "is_finalized",
            "created_at", "updated_at",
            "messages", "attachments",
        )
        read_only_fields = (
            "id", "user_id", "user_email", "user_full_name",
            "finalized_at", "finalized_by_id", "first_response_at",
            "is_active", "is_finalized",
            "created_at", "updated_at",
            "messages", "attachments",
            "reason_label", "status_label",
        )

    def get_messages(self, obj):
        qs = TicketMessage.objects.filter(ticket_id=obj.id, is_active=True).order_by("created_at")
        return TicketMessageSerializer(qs, many=True).data

    def get_attachments(self, obj):
        # Adjuntos directos del ticket (no de mensajes)
        qs = TicketAttachment.objects.filter(ticket_id=obj.id, is_active=True).order_by("created_at")
        return TicketAttachmentSerializer(qs, many=True).data

    def get_is_finalized(self, obj):
        return obj.status == "FINALIZADO"

    def get_reason_label(self, obj):
        try:
            r = ReasonCat.objects.get(pk=obj.reason)
            return r.label_es
        except ReasonCat.DoesNotExist:
            return obj.reason

    def get_status_label(self, obj):
        try:
            s = StatusCat.objects.get(pk=obj.status)
            return s.label_es
        except StatusCat.DoesNotExist:
            return obj.status

    def validate_description(self, v):
        v = (v or "").strip()
        if not v:
            raise serializers.ValidationError("La descripcion es obligatoria.")
        return v


class TicketListSerializer(serializers.ModelSerializer):
    """Shape compacto para listados (sin hilo ni adjuntos)."""
    reason_label  = serializers.SerializerMethodField()
    status_label  = serializers.SerializerMethodField()
    message_count = serializers.SerializerMethodField()
    is_finalized  = serializers.SerializerMethodField()

    class Meta:
        model  = Ticket
        fields = (
            "id", "user_id", "user_email", "user_full_name",
            "context_url", "reason", "reason_label",
            "status", "status_label", "is_finalized",
            "description",
            "created_at", "updated_at",
            "message_count",
        )

    def get_reason_label(self, obj):
        try:
            return ReasonCat.objects.get(pk=obj.reason).label_es
        except ReasonCat.DoesNotExist:
            return obj.reason

    def get_status_label(self, obj):
        try:
            return StatusCat.objects.get(pk=obj.status).label_es
        except StatusCat.DoesNotExist:
            return obj.status

    def get_message_count(self, obj):
        return TicketMessage.objects.filter(ticket_id=obj.id, is_active=True).count()

    def get_is_finalized(self, obj):
        return obj.status == "FINALIZADO"
