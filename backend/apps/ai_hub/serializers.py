"""
=====================================================================
MWT.ONE · apps.ai_hub.serializers
Agente responsable: [AG-BACKEND-API]

Tres familias por cada modelo de catálogo (Agent/Skill/Instruction):
  · FullSerializer     → usado en retrieve/create/update (todos los campos).
  · ListSerializer     → usado en list (evita `prompt_base`/`contenido` pesados).
  · SelectSerializer   → usado por los endpoints `_select` que alimentan
                         el MentionPopover (@/ autocomplete del chat).

Threads / Messages / Attachments / UsageLog usan full + list.
=====================================================================
"""
from rest_framework import serializers

from .models import (
    AiAgent, AiSkill, AiInstruction,
    AiThread, AiThreadContext, AiMessage,
    AiAttachment, AiUsageLog,
)


# =====================================================================
# Agent
# =====================================================================
class AiAgentSerializer(serializers.ModelSerializer):
    class Meta:
        model  = AiAgent
        fields = "__all__"
        read_only_fields = ("created_at", "updated_at")


class AiAgentListSerializer(serializers.ModelSerializer):
    class Meta:
        model  = AiAgent
        fields = (
            "id", "codigo", "nombre", "rol", "descripcion",
            "autonomy_ceiling", "avatar_emoji", "accent_color",
            "model_default", "tags",
            "is_active", "created_at", "updated_at",
        )


class AiAgentSelectSerializer(serializers.ModelSerializer):
    """Lightweight payload para el MentionPopover (@).
    Debe ser pequeño y barato de serializar — cientos por autocomplete.
    """
    class Meta:
        model  = AiAgent
        fields = (
            "id", "codigo", "nombre", "rol",
            "avatar_emoji", "accent_color", "descripcion",
        )


# =====================================================================
# Skill
# =====================================================================
class AiSkillSerializer(serializers.ModelSerializer):
    class Meta:
        model  = AiSkill
        fields = "__all__"
        read_only_fields = ("created_at", "updated_at")


class AiSkillListSerializer(serializers.ModelSerializer):
    class Meta:
        model  = AiSkill
        fields = (
            "id", "codigo", "nombre", "descripcion", "category",
            "icon", "accent_color", "requires_files", "supports_multimodal",
            "tags", "is_active", "created_at", "updated_at",
        )


class AiSkillSelectSerializer(serializers.ModelSerializer):
    """Lightweight payload para el MentionPopover (/)."""
    class Meta:
        model  = AiSkill
        fields = (
            "id", "codigo", "nombre", "category",
            "icon", "accent_color", "descripcion",
            "requires_files", "supports_multimodal",
        )


# =====================================================================
# Instruction
# =====================================================================
class AiInstructionSerializer(serializers.ModelSerializer):
    class Meta:
        model  = AiInstruction
        fields = "__all__"
        read_only_fields = ("created_at", "updated_at")


class AiInstructionListSerializer(serializers.ModelSerializer):
    class Meta:
        model  = AiInstruction
        fields = (
            "id", "codigo", "titulo", "scope", "domain",
            "target_role", "target_agent_id",
            "prioridad", "auto_inject",
            "is_active", "created_at", "updated_at",
        )


class AiInstructionSelectSerializer(serializers.ModelSerializer):
    class Meta:
        model  = AiInstruction
        fields = (
            "id", "codigo", "titulo", "scope", "prioridad", "auto_inject",
        )


# =====================================================================
# Thread
# =====================================================================
class AiThreadSerializer(serializers.ModelSerializer):
    class Meta:
        model  = AiThread
        fields = "__all__"
        read_only_fields = (
            "message_count", "total_tokens_in", "total_tokens_out",
            "last_message_at", "created_at", "updated_at",
        )


class AiThreadListSerializer(serializers.ModelSerializer):
    class Meta:
        model  = AiThread
        fields = (
            "id", "titulo", "user_id", "user_email",
            "summary", "pinned", "archived",
            "last_message_at", "message_count",
            "total_tokens_in", "total_tokens_out",
            "is_active", "created_at", "updated_at",
        )


# =====================================================================
# ThreadContext
# =====================================================================
class AiThreadContextSerializer(serializers.ModelSerializer):
    class Meta:
        model  = AiThreadContext
        fields = "__all__"
        read_only_fields = ("pinned_at", "created_at", "updated_at")


# =====================================================================
# Message
# =====================================================================
class AiMessageSerializer(serializers.ModelSerializer):
    class Meta:
        model  = AiMessage
        fields = "__all__"
        read_only_fields = ("created_at", "updated_at")


class AiMessageListSerializer(serializers.ModelSerializer):
    """Omitimos `content_snapshot` y `metadata` en list para no inflar payload."""
    class Meta:
        model  = AiMessage
        fields = (
            "id", "thread_id", "sender", "user_id", "role_label",
            "content", "content_format", "attachments",
            "model", "tokens_in", "tokens_out", "latency_ms",
            "finish_reason", "error_code", "error_message",
            "parent_message_id", "idempotence_token",
            "is_active", "created_at", "updated_at",
        )


# =====================================================================
# Attachment
# =====================================================================
class AiAttachmentSerializer(serializers.ModelSerializer):
    class Meta:
        model  = AiAttachment
        fields = "__all__"
        read_only_fields = (
            "extracted_text", "extracted_chars", "extracted_pages",
            "processing_status", "processing_error",
            "sha256", "is_image", "image_width", "image_height",
            "created_at", "updated_at",
        )


class AiAttachmentListSerializer(serializers.ModelSerializer):
    """Sin `extracted_text` (puede ser MB).  El full sí lo incluye."""
    class Meta:
        model  = AiAttachment
        fields = (
            "id", "thread_id", "message_id", "user_id",
            "filename", "mime_type", "size_bytes",
            "storage_backend", "storage_url",
            "extracted_chars", "extracted_pages",
            "is_image", "image_width", "image_height",
            "processing_status", "processing_error",
            "is_active", "created_at", "updated_at",
        )


# =====================================================================
# UsageLog — append-only, read-only para el API público
# =====================================================================
class AiUsageLogSerializer(serializers.ModelSerializer):
    class Meta:
        model  = AiUsageLog
        fields = "__all__"
        read_only_fields = fields  # todo read-only
