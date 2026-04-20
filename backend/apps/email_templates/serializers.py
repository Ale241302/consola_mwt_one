from rest_framework import serializers
from .models import Template, Version


class TemplateListSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Template
        fields = (
            "id", "name", "template_key", "language", "brand", "brand_id",
            "subject_template", "sent_count_30d",
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
