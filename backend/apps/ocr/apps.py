from django.apps import AppConfig


class OcrConfig(AppConfig):
    """Wizard OCR · ingiere PDFs de OC vía Paperless-ngx y devuelve
    un payload estructurado que el Step 1 del wizard auto-llena."""
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.ocr"
    label = "ocr"
