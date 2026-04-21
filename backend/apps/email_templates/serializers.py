from rest_framework import serializers
from .models import Template, Version, TemplateStatusCat, RenderPreviewLog


class TemplateListSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Template
        fields = (
            "id", "name", "template_key", "language", "brand", "brand_id",
            "subject_template", "sent_count_30d",
            "status", "published_at", "archived_at", "last_test_send_at",
            "is_active", "updated_at",
        )


class TemplateSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Template
        fields = "__all__"


class VersionSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Version
        fields = "__all__"


class TemplateStatusCatSerializer(serializers.ModelSerializer):
    class Meta:
        model  = TemplateStatusCat
        fields = "__all__"


class RenderPreviewLogSerializer(serializers.ModelSerializer):
    class Meta:
        model  = RenderPreviewLog
        fields = "__all__"
