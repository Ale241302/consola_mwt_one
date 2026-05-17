// =====================================================================
// MWT.ONE · lib/i18n/payments.js
// Sprint Registrar Pago (Fase 1) — labels i18n ES/EN para los enums
// del modulo finance.
//
// Cada enum mapea a una clave consultable por:
//   getLabel('PAYMENT_REJECTION_REASON', 'OTRO', 'es') -> 'Otro motivo'
//
// Espejo de los TextChoices en backend/apps/finance/enums.py.
// Cualquier cambio en el backend debe replicarse aqui.
// =====================================================================

export const PAYMENT_REJECTION_REASON_LABELS = {
  es: {
    REF_ERRONEA:            'Referencia errónea',
    MONTO_NO_COINCIDE:      'Monto no coincide',
    DUPLICADO:              'Pago duplicado',
    COMPROBANTE_INVALIDO:   'Comprobante inválido',
    FUERA_DE_PLAZO:         'Fuera de plazo',
    CONTRAPARTE_INCORRECTA: 'Contraparte incorrecta',
    OTRO:                   'Otro motivo',
  },
  en: {
    REF_ERRONEA:            'Wrong reference',
    MONTO_NO_COINCIDE:      'Amount mismatch',
    DUPLICADO:              'Duplicate payment',
    COMPROBANTE_INVALIDO:   'Invalid proof',
    FUERA_DE_PLAZO:         'Past due',
    CONTRAPARTE_INCORRECTA: 'Wrong counterparty',
    OTRO:                   'Other',
  },
};

export const PAYMENT_STATUS_LABELS = {
  es: {
    PENDIENTE_AI:      'Pendiente de verificación',
    CONFIRMADO_AI:     'Conciliado (esperando CEO)',
    NEEDS_REVIEW:      'Necesita revisión',
    CONFIRMADO_HUMANO: 'Crédito liberado',
    RECHAZADO:         'Rechazado',
    REVERTIDO:         'Revertido',
  },
  en: {
    PENDIENTE_AI:      'Pending verification',
    CONFIRMADO_AI:     'Reconciled (awaiting CEO)',
    NEEDS_REVIEW:      'Needs review',
    CONFIRMADO_HUMANO: 'Credit released',
    RECHAZADO:         'Rejected',
    REVERTIDO:         'Reverted',
  },
};

// Color hint por estado (tokens MWT — sin hex literales).
export const PAYMENT_STATUS_COLORS = {
  PENDIENTE_AI:      'var(--warning)',
  CONFIRMADO_AI:     'var(--brand-accent-dark)',
  NEEDS_REVIEW:      'var(--warning)',
  CONFIRMADO_HUMANO: 'var(--success)',
  RECHAZADO:         'var(--critical)',
  REVERTIDO:         'var(--text-tertiary)',
};

export const COUNTERPARTY_TYPE_LABELS = {
  es: {
    CLIENTE:       'Cliente',
    PROVEEDOR:     'Proveedor',
    ADUANERO:      'Aduanero',
    TRANSPORTISTA: 'Transportista',
    AGENTE:        'Agente',
    DISTRIBUIDOR:  'Distribuidor',
  },
  en: {
    CLIENTE:       'Client',
    PROVEEDOR:     'Supplier',
    ADUANERO:      'Customs broker',
    TRANSPORTISTA: 'Carrier',
    AGENTE:        'Agent',
    DISTRIBUIDOR:  'Distributor',
  },
};

export const PAYMENT_DIRECTION_LABELS = {
  es: {
    IN:  'Entrante (MWT cobra)',
    OUT: 'Saliente (MWT paga)',
  },
  en: {
    IN:  'Incoming (MWT receives)',
    OUT: 'Outgoing (MWT pays)',
  },
};

export const PAYMENT_APPLICABLE_TYPE_LABELS = {
  es: {
    COSTO:    'Costo',
    PRODUCTO: 'Producto',
    PROFORMA: 'Proforma',
    FACTURA:  'Factura',
  },
  en: {
    COSTO:    'Cost',
    PRODUCTO: 'Product',
    PROFORMA: 'Proforma',
    FACTURA:  'Invoice',
  },
};

// Mensajes de error mapeados por codigo (PaymentErrorCode).
// El backend devuelve { code, detail }; el front muestra estos labels
// como banner / inline en vez del detail crudo del backend.
export const PAYMENT_ERROR_LABELS = {
  es: {
    COUNTERPARTY_MISMATCH:
      'Las obligaciones tildadas pertenecen a contrapartes distintas. Selecciona obligaciones de una sola contraparte.',
    EXPEDIENTE_TERMS_UNDEFINED:
      'El expediente no tiene forma de pago definida (CREDITO/CONTADO). Define la forma de pago antes de liberar.',
    REJECTION_COMMENT_REQUIRED_FOR_OTRO:
      'Cuando el motivo de rechazo es "Otro", el comentario es obligatorio.',
    REVERSAL_CONFIRMATION_REQUIRED:
      'Estás rechazando un pago ya liberado. Confirma la reversión: el crédito del cliente volverá a subir.',
    INVALID_STATE_TRANSITION:
      'Esta transición de estado no es válida.',
    FORBIDDEN_NOT_CEO:
      'Esta acción requiere rol CEO o ADMIN.',
    APPLICATIONS_SUM_MISMATCH:
      'La suma de las aplicaciones no coincide con el monto del pago.',
    MIXED_APPLICATION_TYPES:
      'El wizard requiere que todas las obligaciones sean del mismo tipo (todas COSTO o todas PRODUCTO/PROFORMA/FACTURA).',
    EXPEDIENTE_NOT_FOUND:
      'El expediente vinculado al pago no existe.',
    TARGET_CLIENT_UNRESOLVED:
      'No se pudo resolver el cliente objetivo del crédito.',
  },
  en: {
    COUNTERPARTY_MISMATCH:
      'Selected obligations belong to different counterparties. Pick obligations from a single counterparty.',
    EXPEDIENTE_TERMS_UNDEFINED:
      'The file has no payment terms defined (CREDIT/CASH). Define payment terms before releasing.',
    REJECTION_COMMENT_REQUIRED_FOR_OTRO:
      'When the rejection reason is "Other", a comment is required.',
    REVERSAL_CONFIRMATION_REQUIRED:
      'You are rejecting an already-released payment. Confirm the reversal: client credit will go back up.',
    INVALID_STATE_TRANSITION:
      'This state transition is not allowed.',
    FORBIDDEN_NOT_CEO:
      'This action requires CEO or ADMIN role.',
    APPLICATIONS_SUM_MISMATCH:
      'The sum of applications does not match the payment amount.',
    MIXED_APPLICATION_TYPES:
      'The wizard requires all obligations to be the same type (all COST or all PRODUCT/PROFORMA/INVOICE).',
    EXPEDIENTE_NOT_FOUND:
      'The file linked to this payment does not exist.',
    TARGET_CLIENT_UNRESOLVED:
      'Could not resolve the target client for credit.',
  },
};

/**
 * Helper generico — devuelve el label para un valor de enum, con fallback
 * al valor crudo si no esta mapeado.
 *
 * @param {Record<string, Record<string,string>>} labelMap
 * @param {string} value
 * @param {'es'|'en'} lang
 * @returns {string}
 */
export function getEnumLabel(labelMap, value, lang = 'es') {
  if (!value) return '—';
  const map = labelMap?.[lang] || labelMap?.es || {};
  return map[value] || value;
}
