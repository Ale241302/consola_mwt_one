"""
=====================================================================
MWT.ONE · apps.storage · AppConfig
Agente responsable: [AG-BACKEND]
Propósito:
  Gateway central a MinIO / S3 + Paperless-ngx. Toda subida o descarga
  de documentos (facturas, guías, BL, contratos) pasa por este módulo
  para garantizar:
    - URLs firmadas con TTL corto (15 min por defecto)
    - Bucket + key consistentes
    - Trazabilidad del proxy de OCR (Paperless) por expediente
  No expone ningún dato de dominio: es infra pura.
=====================================================================
"""
from django.apps import AppConfig


class StorageConfig(AppConfig):
    name          = "apps.storage"
    verbose_name  = "Almacenamiento (MinIO · Paperless)"
    default_auto_field = "django.db.models.BigAutoField"
