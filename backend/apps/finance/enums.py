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


# =====================================================================
# Sprint Registrar Pago (Fase 1) — D1_finance_payments_wizard.sql
# Enums espejo de las nuevas columnas / CHECK constraints en finance.payment.
# =====================================================================

class PaymentRejectionReason(models.TextChoices):
    """Motivos de rechazo CEO de un pago.

    Si rejection_reason == OTRO, el campo rejection_comment es obligatorio
    (validado tanto en model.clean() como en serializer + CHECK SQL).
    """
    REF_ERRONEA            = "REF_ERRONEA",            "Referencia errónea"
    MONTO_NO_COINCIDE      = "MONTO_NO_COINCIDE",      "Monto no coincide"
    DUPLICADO              = "DUPLICADO",              "Pago duplicado"
    COMPROBANTE_INVALIDO   = "COMPROBANTE_INVALIDO",   "Comprobante inválido"
    FUERA_DE_PLAZO         = "FUERA_DE_PLAZO",         "Fuera de plazo"
    CONTRAPARTE_INCORRECTA = "CONTRAPARTE_INCORRECTA", "Contraparte incorrecta"
    OTRO                   = "OTRO",                   "Otro"


class PaymentCounterpartyType(models.TextChoices):
    """Tipo de contraparte de un pago — discriminator que indica a qué
    tabla apunta `counterparty_id` (FK lógica, sin FK física).

    CLIENTE      -> apps.clientes.cliente
    PROVEEDOR    -> apps.proveedores.proveedor
    ADUANERO     -> apps.proveedores.proveedor (tipo ADUANERO)
    TRANSPORTISTA-> apps.proveedores.proveedor (tipo TRANSPORTISTA)
    AGENTE       -> apps.proveedores.proveedor (tipo AGENTE)
    DISTRIBUIDOR -> apps.clientes.cliente (tipo DISTRIBUIDOR)
    """
    CLIENTE       = "CLIENTE",       "Cliente"
    PROVEEDOR     = "PROVEEDOR",     "Proveedor"
    ADUANERO      = "ADUANERO",      "Aduanero"
    TRANSPORTISTA = "TRANSPORTISTA", "Transportista"
    AGENTE        = "AGENTE",        "Agente"
    DISTRIBUIDOR  = "DISTRIBUIDOR",  "Distribuidor"


class PaymentDirection(models.TextChoices):
    """IN = MWT cobra (entrante) — destination_mwt_account_id requerido.
    OUT = MWT paga (saliente) — source_mwt_account_id requerido.
    Default IN para backward-compat con pagos legacy."""
    IN  = "IN",  "Entrante (MWT cobra)"
    OUT = "OUT", "Saliente (MWT paga)"


# Estados del Payment que cuentan como "candidatos a liberar crédito" —
# es decir, el CEO puede ejecutar PATCH /release-credit estando en uno
# de estos. Permite que tanto CONFIRMADO_AI como NEEDS_REVIEW lleguen
# manualmente a CONFIRMADO_HUMANO via decisión CEO.
PAYMENT_STATES_RELEASABLE = (
    PaymentStatus.PENDIENTE_AI,
    PaymentStatus.CONFIRMADO_AI,
    PaymentStatus.NEEDS_REVIEW,
)

# Estados del Payment desde los que se puede rechazar.
PAYMENT_STATES_REJECTABLE = (
    PaymentStatus.PENDIENTE_AI,
    PaymentStatus.CONFIRMADO_AI,
    PaymentStatus.NEEDS_REVIEW,
    PaymentStatus.CONFIRMADO_HUMANO,   # reversión desde liberado
)

# Códigos de error que el frontend interpreta para mostrar banners
# específicos. Cualquier cambio aquí se replica en
# frontend/src/lib/types/payments.js + i18n.
class PaymentErrorCode:
    COUNTERPARTY_MISMATCH        = "COUNTERPARTY_MISMATCH"
    EXPEDIENTE_TERMS_UNDEFINED   = "EXPEDIENTE_TERMS_UNDEFINED"
    REJECTION_COMMENT_REQUIRED   = "REJECTION_COMMENT_REQUIRED_FOR_OTRO"
    REVERSAL_CONFIRMATION_REQUIRED = "REVERSAL_CONFIRMATION_REQUIRED"
    INVALID_STATE_TRANSITION     = "INVALID_STATE_TRANSITION"
    FORBIDDEN_NOT_CEO            = "FORBIDDEN_NOT_CEO"
    APPLICATIONS_SUM_MISMATCH    = "APPLICATIONS_SUM_MISMATCH"
