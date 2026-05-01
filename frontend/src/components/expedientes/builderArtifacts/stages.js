// =====================================================================
// MWT.ONE · stages.js — orden canónico de etapas del expediente.
// Debe coincidir con backend/apps/expedientes/views_builder_artifacts.py
// =====================================================================

export const STAGE_ORDER = [
  "REGISTRO",
  "PRODUCCION",
  "PREPARACION",
  "DESPACHO",
  "TRANSITO",
  "EN_DESTINO",
  "CERRADO",
];

export const STAGE_LABELS = {
  es: {
    REGISTRO:    "Registro",
    PRODUCCION:  "Producción",
    PREPARACION: "Preparación",
    DESPACHO:    "Despacho",
    TRANSITO:    "Tránsito",
    EN_DESTINO:  "En destino",
    CERRADO:     "Cerrado",
  },
  en: {
    REGISTRO:    "Registration",
    PRODUCCION:  "Production",
    PREPARACION: "Preparation",
    DESPACHO:    "Dispatch",
    TRANSITO:    "In transit",
    EN_DESTINO:  "At destination",
    CERRADO:     "Closed",
  },
};

// Tokens de color (NO hex hardcodeados — fallback al token MWT).
export const STAGE_COLOR = {
  REGISTRO:    "var(--text-tertiary, #64748B)",
  PRODUCCION:  "var(--brand-purple, #481EE3)",
  PREPARACION: "var(--warning, #F59E0B)",
  DESPACHO:    "var(--text-primary, #0B1E3A)",
  TRANSITO:    "var(--info, #0EA5E9)",
  EN_DESTINO:  "var(--brand-primary, #06B6D4)",
  CERRADO:     "var(--success, #1DE394)",
};

export function stageIndex(stage) {
  return STAGE_ORDER.indexOf(stage);
}

/**
 * Regla: sólo se puede agregar artefactos en etapas cuyo índice ≤
 * estado actual del expediente.
 *
 * Ejemplo: expediente en PRODUCCION → permitido REGISTRO + PRODUCCION;
 * NO permitido PREPARACION/DESPACHO/etc.
 */
export function canAddArtifactToStage(currentStage, targetStage) {
  const a = stageIndex(currentStage);
  const b = stageIndex(targetStage);
  if (a < 0 || b < 0) return false;
  return b <= a;
}

export function stageLabel(lang, stage) {
  return (STAGE_LABELS[lang] || STAGE_LABELS.es)[stage] || stage;
}
