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
    if (parsed.start && (!cur.start || parsed.start < cur.start)) cur.start = parsed.start;
    if (parsed.end && (!cur.end || parsed.end > cur.end)) cur.end = parsed.end;
    // Solo acumulamos días sueltos cuando no tengamos un rango completo
    // para la fase fusionada; si hay rango, recalculamos days al final.
    if ((cur.start == null || cur.end == null) && parsed.days != null) {
      cur.days = (cur.days || 0) + parsed.days;
    }
    cur._fromTech.push(techKey);
  }
  // La fase fusionada se representa con el rango más amplio disponible.
  // Siempre que haya start+end, recalculamos days desde ese rango.
  const merged = out[MERGED_VISUAL_STAGE];
  if (merged && merged.start && merged.end) {
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
 * Dado el estado técnico actual, determina la siguiente fase a transicionar:
 * - Si es REGISTRO -> PRODUCCION
 * - Si es PRODUCCION -> PREPARACION (visual: PREPARACION_DESPACHO "Preparación de despacho")
 * - Si es PREPARACION o DESPACHO (fases fusionadas) -> TRANSITO
 * - Si es TRANSITO -> EN_DESTINO
 * - Si es EN_DESTINO -> CERRADO
 *
 * Retorna { nextTech, currentDisplay, nextDisplay }
 */
export function getNextStageForTransition(currentTech) {
  const currentDisplay = displayStage(currentTech);
  const visualIdx = DISPLAY_STAGES.indexOf(currentDisplay);
  if (visualIdx < 0 || visualIdx >= DISPLAY_STAGES.length - 1) {
    return { nextTech: null, currentDisplay, nextDisplay: null };
  }
  const nextDisplay = DISPLAY_STAGES[visualIdx + 1];
  const nextTech = nextDisplay === MERGED_VISUAL_STAGE ? "PREPARACION" : nextDisplay;
  return { nextTech, currentDisplay, nextDisplay };
}

export function nextTechAndVisual(currentTech) {
  const { nextTech, nextDisplay } = getNextStageForTransition(currentTech);
  return { nextTech, visualNext: nextDisplay };
}

/**
 * Para renderizar el progreso en la timeline: índice de la fase visual
 * correspondiente al estado técnico actual.
 */
export function displayStageIndex(techStage) {
  return DISPLAY_STAGES.indexOf(displayStage(techStage));
}
