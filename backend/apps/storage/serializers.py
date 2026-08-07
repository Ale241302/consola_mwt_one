"""
=====================================================================
MWT.ONE · apps.storage.serializers

Mixins para normalizar campos de storage en los serializers DRF.
=====================================================================
"""
from apps.storage.helpers import normalize_storage_key


class StorageNormalizeMixin:
    """Normaliza campos que contienen URLs firmadas de MinIO a object keys.

    Uso:
        class MiSerializer(StorageNormalizeMixin, serializers.ModelSerializer):
            storage_normalize_fields = ("imagen_url", "ficha_url", "logo_url")

    Los campos listados se pasan por `normalize_storage_key()` en
    `to_representation`, devolviendo siempre una key relativa para los activos
    internos y preservando URLs externas (CDN) tal cual.
    """

    storage_normalize_fields = ()

    def to_representation(self, instance):
        data = super().to_representation(instance)
        for field in getattr(self, "storage_normalize_fields", ()):
            if field in data:
                data[field] = normalize_storage_key(data[field])
        return data
