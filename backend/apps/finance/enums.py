"""
Enums canónicos del módulo finance.

Espejo de los catálogos en `finance.metodo_cat`, `finance.tipo_pago_cat`,
`finance.estado_pago_cat` y `finance.applicable_type_cat`. Cualquier
cambio aquí debe replicarse en `backend/sql/B6_finance_v2.sql`.
"""
from django.db import models


class PaymentMethod(models.TextChoices):
    TRANSFERENCIA_BANCARIA = "TRANSFERENCIA_BANCARIA", "Transferencia bancaria"
    NOTA_CREDITO           = "NOTA_CREDITO",           "Nota de crédito"


class PaymentType(models.TextChoices):
    PARCIAL  = "PARCIAL",  "Pago parcial"
    COMPLETO = "COMPLETO", "Pago completo"


class PaymentStatus(models.TextChoices):
    PENDIENTE_AI       = "PENDIENTE_AI",       "Pendiente análisis IA"
    CONFIRMADO_AI      = "CONFIRMADO_AI",      "Confirmado por IA"
    NEEDS_REVIEW       = "NEEDS_REVIEW",       "Requiere revisión humana"
    CONFIRMADO_HUMANO  = "CONFIRMADO_HUMANO",  "Confirmado por revisor"
    RECHAZADO          = "RECHAZADO",          "Rechazado"
    REVERTIDO          = "REVERTIDO",          "Revertido"


class PaymentApplicableType(models.TextChoices):
    COSTO    = "COSTO",    "Costo"
    PRODUCTO = "PRODUCTO", "Producto"
    PROFORMA = "PROFORMA", "Proforma"
    FACTURA  = "FACTURA",  "Factura"


class AIVerdictStatus(models.TextChoices):
    MATCH      = "MATCH",      "Match — todo coincide"
    PARTIAL    = "PARTIAL",    "Match parcial — campos secundarios divergen"
    MISMATCH   = "MISMATCH",   "Mismatch — campos clave divergen"
    UNREADABLE = "UNREADABLE", "Comprobante ilegible"
    SUSPICIOUS = "SUSPICIOUS", "Sospechoso — posible fraude"


# Umbral de confianza para auto-confirmar (status=MATCH AND confianza >= UMBRAL).
# Bajo este umbral el pago va a NEEDS_REVIEW, sin importar el status.
AI_AUTO_CONFIRM_MIN_CONFIDENCE = 90.0


# MIME types aceptados como evidencia. Espejo del frontend en
# `pages/ExpedienteDetail.jsx::PAY_EVIDENCE_MIMES`.
EVIDENCE_ALLOWED_MIMES = (
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/webp",
)
EVIDENCE_MAX_BYTES = 10 * 1024 * 1024  # 10 MB
