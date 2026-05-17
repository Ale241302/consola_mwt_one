// =====================================================================
// MWT.ONE · lib/types/payments.js
// Sprint Registrar Pago (Fase 1) — typedefs JSDoc compartidos para el
// modulo `apps/finance` y el wizard de Registrar Pago.
//
// Estos typedefs sirven como contrato single-source-of-truth para los
// componentes del wizard (RegisterPaymentWizard, PaymentDetailDrawer,
// RejectPaymentDialog, CreditEffectPreview). Espejo de los enums en:
//   backend/apps/finance/enums.py
//
// Cualquier cambio aqui debe replicarse alli (y viceversa).
// =====================================================================

/**
 * @typedef {'IN'|'OUT'} PaymentDirection
 *
 * @typedef {'CLIENTE'|'PROVEEDOR'|'ADUANERO'|'TRANSPORTISTA'|'AGENTE'|'DISTRIBUIDOR'} CounterpartyType
 *
 * @typedef {'COSTO'|'PRODUCTO'|'PROFORMA'|'FACTURA'} PaymentApplicableType
 *
 * @typedef {'PENDIENTE_AI'|'CONFIRMADO_AI'|'NEEDS_REVIEW'|'CONFIRMADO_HUMANO'|'RECHAZADO'|'REVERTIDO'} PaymentStatus
 *
 * @typedef {'REF_ERRONEA'|'MONTO_NO_COINCIDE'|'DUPLICADO'|'COMPROBANTE_INVALIDO'|'FUERA_DE_PLAZO'|'CONTRAPARTE_INCORRECTA'|'OTRO'} PaymentRejectionReason
 *
 * @typedef {'TRANSFERENCIA_BANCARIA'|'NOTA_CREDITO'} PaymentMethod
 *
 * @typedef {'PARCIAL'|'COMPLETO'} PaymentType
 */

/**
 * Codigos de error retornados por el backend que el frontend interpreta
 * para mostrar banners especificos. Espejo de PaymentErrorCode en enums.py.
 *
 * @typedef {'COUNTERPARTY_MISMATCH'|'EXPEDIENTE_TERMS_UNDEFINED'|'REJECTION_COMMENT_REQUIRED_FOR_OTRO'|'REVERSAL_CONFIRMATION_REQUIRED'|'INVALID_STATE_TRANSITION'|'FORBIDDEN_NOT_CEO'|'APPLICATIONS_SUM_MISMATCH'|'MIXED_APPLICATION_TYPES'|'EXPEDIENTE_NOT_FOUND'|'TARGET_CLIENT_UNRESOLVED'} PaymentErrorCode
 */

/**
 * Aplicacion de un Payment a una obligacion especifica (factura, proforma,
 * costo o producto). Equivalente al modelo PaymentApplication del backend.
 *
 * @typedef {Object} PaymentApplicationPayload
 * @property {PaymentApplicableType} applicable_type  Tipo de obligacion
 * @property {string} applicable_id                   UUID de la obligacion (doc/cost/producto)
 * @property {string} applicable_code                 Texto legible (ej. "FAC-2026-00123")
 * @property {number} monto_aplicado                  Monto USD aplicado a esta obligacion
 * @property {number} [cantidad_producto]             Solo si applicable_type=PRODUCTO
 */

/**
 * Payload completo para el endpoint POST /api/finance/payments
 * (wizard de 4 pasos). Va como multipart/form-data porque incluye
 * el archivo de evidencia.
 *
 * @typedef {Object} CreatePaymentPayload
 * @property {PaymentDirection} direction              IN = MWT cobra, OUT = MWT paga
 * @property {CounterpartyType} counterparty_type      Tipo de contraparte
 * @property {string} counterparty_id                  UUID de la contraparte
 * @property {string} expediente_id                    UUID del expediente
 * @property {number} monto                            Monto en la moneda de la transaccion
 * @property {string} moneda                           ISO 4217 (USD/COP/BRL/CRC/MXN/EUR/PEN/...)
 * @property {number} [tasa_cambio_a_usd]              Requerido si moneda != USD
 * @property {string} fecha                            ISO 8601 (YYYY-MM-DD)
 * @property {PaymentMethod} metodo                    Metodo de pago
 * @property {PaymentType} tipo_pago                   PARCIAL | COMPLETO
 * @property {string} [referencia]                     Nº transferencia, SWIFT, etc.
 * @property {string} [notas]                          Texto libre
 * @property {string} [source_mwt_account_id]          UUID cuenta MWT (solo si direction=OUT)
 * @property {string} [destination_mwt_account_id]     UUID cuenta MWT (solo si direction=IN)
 * @property {PaymentApplicationPayload[]} aplicaciones Aplicaciones del pago (Paso 2)
 * @property {File} evidencia                          Archivo PDF/imagen del comprobante
 * @property {string} [event_id]                       UUID para idempotencia (opcional)
 */

/**
 * Preview del efecto que tendra un Payment sobre el credito al ser
 * liberado por CEO. Devuelto por POST /api/finance/payments/dry-run.
 * Alimenta el Paso 4 del wizard.
 *
 * @typedef {Object} CreditEffectPreview
 * @property {boolean} will_affect_credit
 * @property {string|null} target_client_id            UUID del cliente cuyo credito se afecta
 * @property {string|null} target_client_name          Razon social legible
 * @property {number} delta_usd                        Monto a liberar (positivo)
 * @property {string} reason                           Explicacion human-readable
 * @property {PaymentErrorCode|null} blocking_error    NULL si todo OK
 */

/**
 * Response del endpoint dry-run.
 *
 * @typedef {Object} DryRunResponse
 * @property {Array<{code: PaymentErrorCode, detail: string}>} validation_errors
 * @property {CreditEffectPreview} credit_preview
 */

/**
 * Payload para rechazar un pago.
 *
 * @typedef {Object} RejectPaymentPayload
 * @property {PaymentRejectionReason} rejection_reason
 * @property {string} [rejection_comment]              Obligatorio si reason='OTRO'
 * @property {boolean} [confirm_reversal]              Requerido si estado actual = CONFIRMADO_HUMANO
 */

/**
 * Obligacion abierta devuelta por
 * GET /api/finance/counterparties/{type}/{id}/open-debts
 * Alimenta el Paso 2 del wizard.
 *
 * @typedef {Object} OpenDebt
 * @property {string} obligation_id
 * @property {PaymentApplicableType} applicable_type
 * @property {string} expediente_id
 * @property {string} expediente_codigo
 * @property {string|null} proforma_codigo
 * @property {string|null} sku
 * @property {string} concepto
 * @property {number} balance
 * @property {string} currency
 * @property {boolean} is_operated_by_mwt
 * @property {'CREDITO'|'CONTADO'|null} payment_terms
 */

/**
 * Cuenta bancaria propia MWT (finance.mwt_account). CEO-ONLY.
 *
 * @typedef {Object} MwtAccount
 * @property {string} id
 * @property {string} operating_company_id
 * @property {string} bank_name
 * @property {string} account_number
 * @property {string|null} account_alias
 * @property {string} currency
 * @property {string} country_iso2
 * @property {string|null} swift_bic
 * @property {boolean} is_active
 * @property {string|null} notes
 * @property {string} created_at
 * @property {string} updated_at
 */

// Marker export para que ESM no se queje (este modulo es solo JSDoc).
export const __PAYMENTS_TYPES_VERSION__ = "1.0.0-fase1";
