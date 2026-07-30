// =====================================================================
// MWT.ONE · lib/phaseDisplay.js
// Sprint 2026-07-30 · Fusión visual PREPARACION + DESPACHO
//
// Las fases técnicas de la máquina de estados siguen siendo 7:
//   REGISTRO → PRODUCCION → PREPARACION → DESPACHO → TRANSITO → EN_DESTINO → CERRADO
//
// A pedido de operaciones, PREPARACION y DESPACHO se muestran como una
// sola fase visual: "Preparación de despacho". Este módulo centraliza
// el mapeo técnico↔visual y el merge/expand de duraciones.
// =====================================================================

/** Orden de fases que ve el usuario (6 pasos). */
export const DISPLAY_STAGES = [
  "REGISTRO",
  "PRODUCCION",
  "PREPARACION_DESPACHO",
  "TRANSITO",
  "EN_DESTINO",
  "CERRADO",
];

/** Fases técnicas que se agrupan visualmente. */
const MERGED_TECH_STAGES = ["PREPARACION", "DESPACHO"];
const MERGED_VISUAL_STAGE = "PREPARACION_DESPACHO";

/** Traduce una fase técnica a su fase visual. */
export function displayStage(techStage) {
  if (MERGED_TECH_STAGES.includes(techStage)) return MERGED_VISUAL_STAGE;
  return techStage;
}

/** Traduce una fase visual a las fases técnicas que la componen. */
export function techStagesFor(displayStage) {
  if (displayStage === MERGED_VISUAL_STAGE) return MERGED_TECH_STAGES;
  return [displayStage];
}

/** Indica si dos fases técnicas pertenecen a la misma fase visual. */
export function sameDisplayStage(a, b) {
  return displayStage(a) === displayStage(b);
}

/** Override: número legacy (días) u objeto {start, end, days}. */
function parseOverride(ov) {
  if (ov == null || ov === "") return { days: null, start: null, end: null };
  if (typeof ov === "object") {
    const days = Number(ov.days);
    return {
      days: isFinite(days) ? days : null,
      start: ov.start || null,
      end: ov.end || null,
    };
  }
  const n = Number(ov);
  return isFinite(n) ? { days: n, start: null, end: null } : { days: null, start: null, end: null };
}

/**
 * Mergea un objeto `phase_durations_json` (claves técnicas) en un objeto
 * con claves visuales. La fase fusionada suma días y toma el rango más
 * amplio disponible (start mínimo, end máximo).
 */
export function mergePhaseDurations(durations) {
  const out = {};
  for (const [techKey, raw] of Object.entries(durations || {})) {
    const visualKey = displayStage(techKey);
    const parsed = parseOverride(raw);
    if (!out[visualKey]) {
      out[visualKey] = { ...parsed, _fromTech: [techKey] };
      continue;
    }
    const cur = out[visualKey];
    if (parsed.days != null) cur.days = (cur.days || 0) + parsed.days;
    if (parsed.start && (!cur.start || parsed.start < cur.start)) cur.start = parsed.start;
    if (parsed.end && (!cur.end || parsed.end > cur.end)) cur.end = parsed.end;
    cur._fromTech.push(techKey);
  }
  // Si la fase fusionada solo tiene start y end pero no days, calcularlos.
  const merged = out[MERGED_VISUAL_STAGE];
  if (merged && merged.start && merged.end && (merged.days == null || merged.days === 0)) {
    const a = new Date(merged.start + "T12:00:00");
    const b = new Date(merged.end + "T12:00:00");
    if (!isNaN(a.getTime()) && !isNaN(b.getTime()) && b >= a) {
      merged.days = Math.round((b - a) / 86400000);
    }
  }
  return out;
}

/**
 * Expande un override de fase visual a las claves técnicas que se deben
 * persistir. Para la fase fusionada guarda el rango completo bajo la
 * clave visual y también deja las técnicas en null para limpiar overrides
 * antiguos.
 */
export function expandPhaseDuration(displayKey, value) {
  if (displayKey !== MERGED_VISUAL_STAGE) return { [displayKey]: value };
  // value = {start, end, days}
  return {
    [MERGED_VISUAL_STAGE]: value,
    PREPARACION: null,
    DESPACHO: null,
  };
}

/**
 * Dado un estado técnico actual, devuelve la siguiente fase técnica en la
 * máquina de estados y su etiqueta visual para mostrar al usuario.
 */
const TECH_ORDER = [
  "REGISTRO", "PRODUCCION", "PREPARACION", "DESPACHO",
  "TRANSITO", "EN_DESTINO", "CERRADO",
];

export function nextTechAndVisual(currentTech) {
  const idx = TECH_ORDER.indexOf(currentTech);
  const nextTech = idx >= 0 && idx < TECH_ORDER.length - 1 ? TECH_ORDER[idx + 1] : null;
  return { nextTech, visualNext: nextTech ? displayStage(nextTech) : null };
}

/**
 * Para renderizar el progreso en la timeline: índice de la fase visual
 * correspondiente al estado técnico actual.
 */
export function displayStageIndex(techStage) {
  return DISPLAY_STAGES.indexOf(displayStage(techStage));
}
