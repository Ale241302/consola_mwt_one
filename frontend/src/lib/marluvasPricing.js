// =====================================================================
// MWT.ONE · lib/marluvasPricing.js
// Agente responsable: [AG-03 FRONTEND]
//
// Funciones puras del simulador de precios Marluvas v7. Testeables sin
// React. Toda la matemática vive aquí — los componentes solo presentan.
//
// Modelo de modificadores INDEPENDIENTES (Ajuste $ y Sobreprecio % no se
// recalculan entre sí — cada uno lo edita el operador libremente):
//
//   P_base_USD(banda)     = (BRL / divisor[banda]) × 1.0183^com × 1.030
//   P_lista(banda)        = P_base(banda) + ajuste_$ + P_base(banda) × sobreprecio_%
//   P_final[banda,plazo]  = P_lista(banda) × factor_pp[plazo]
//
//   ajuste_$         → monto absoluto en USD que se suma en TODA banda
//                       (no se "diluye" — en banda piso pesa porcentualmente más).
//   sobreprecio_%    → factor relativo a la base de cada banda (escala con la banda).
//
// Decisión: en lugar de derramar el ajuste como % a las otras bandas
// (lo que acoplaba ajuste ↔ sobreprecio), tratamos los dos modificadores
// como aditivos puros e independientes. El operador decide qué semántica
// usar (dejar ajuste=0 + editar %, o al revés, o combinar ambos).
// =====================================================================
import {
  BANDAS_MARLUVAS, PLAZOS_MARLUVAS,
  INDICE_ME_90, FACTOR_COMISION,
} from "../constants/marluvas.js";

/**
 * Precio base USD para una banda dada.
 * @param {number} brl       Precio base BRL desde el Excel.
 * @param {number} divisor   Divisor cambial de la banda (ej. 4.07 para techo).
 * @param {number} comPct    Comisión [0..10] — entra como exponente.
 * @returns {number}
 */
export function precioBaseUSD(brl, divisor, comPct) {
  if (!divisor) return 0;
  const com = Number.isFinite(comPct) ? comPct : 0;
  return (Number(brl) / Number(divisor))
       * Math.pow(FACTOR_COMISION, com)
       * INDICE_ME_90;
}

/**
 * @typedef {Object} SkuInput
 * @property {string} sku
 * @property {string} ref
 * @property {number} brl
 * @property {number} com           Comisión [0..10]
 * @property {number} ajuste        Ajuste USD absoluto (se suma en TODA banda)
 * @property {number} sobreprecio   Sobreprecio fracción (0.05 = 5%) — relativo a base
 * @property {boolean} activo
 */

/**
 * @typedef {Object} MatrizCell
 * @property {{id:number, rango:string, div:number, techo?:boolean, piso?:boolean}} banda
 * @property {number} base       P_base USD en esa banda
 * @property {number} lista90    Base + Ajuste + Base × Sobreprecio (precio 90d)
 * @property {number[]} plazos   4 precios finales [90d, 60d, 30d, 8d]
 */

/**
 * @typedef {Object} SkuCalc
 * @property {number} baseUsdTecho
 * @property {number} listaTecho
 * @property {number} sobreprecioPct      Lo que ingresó el operador (fracción)
 * @property {number} sobreprecioEfectivo Lo que efectivamente sumó al precio
 *                                         contando ajuste + sobreprecio: útil para
 *                                         mostrar el "uplift real" sobre la base.
 * @property {MatrizCell[]} matriz        12 entradas, una por banda
 */

/**
 * Calcula todo el output del SKU. Los dos modificadores (ajuste $ y
 * sobreprecio %) son INDEPENDIENTES — editar uno no toca al otro.
 *
 * @param {SkuInput} sku
 * @returns {SkuCalc}
 */
export function calcSKU(sku) {
  const bandaTecho = BANDAS_MARLUVAS[0];
  const ajuste = Number(sku.ajuste || 0);
  const sobreprecio = Number(sku.sobreprecio || 0);

  const baseUsdTecho = precioBaseUSD(sku.brl, bandaTecho.div, sku.com);
  const listaTecho = baseUsdTecho + ajuste + baseUsdTecho * sobreprecio;

  const sobreprecioEfectivo = baseUsdTecho > 0
    ? (listaTecho - baseUsdTecho) / baseUsdTecho
    : 0;

  const matriz = BANDAS_MARLUVAS.map((b) => {
    const baseBanda = precioBaseUSD(sku.brl, b.div, sku.com);
    const lista90 = baseBanda + ajuste + baseBanda * sobreprecio;
    const plazos = PLAZOS_MARLUVAS.map((p) => lista90 * p.factor);
    return { banda: b, base: baseBanda, lista90, plazos };
  });

  return { baseUsdTecho, listaTecho, sobreprecioPct: sobreprecio, sobreprecioEfectivo, matriz };
}

/**
 * Normaliza string para matching de headers (lowercase, sin acentos, sin
 * caracteres no alfanuméricos). "Preço 26 v7 (R$)" → "preco 26 v7 r ".
 *
 * @param {*} s
 * @returns {string}
 */
function normalizeHeader(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Parser de Excel Marluvas COMEX 2026 v7.
 *
 * Estrategia (sin heurística, basada en headers):
 *   1. Para cada hoja, busca en las primeras filas un header que contenga
 *      una columna con "Preço … v7" o "Preço … R$" (columna del precio).
 *      Sólo procesa hojas que tengan ese header — eso descarta
 *      automáticamente "Calculadora", "Banda Cambial", etc.
 *   2. En la misma fila de header detecta:
 *        · skuCol  → primera columna con header "Material" o "SKU"
 *        · refCol  → primera columna con header "Descrição" o "Descricao"
 *        · priceCol → columna del header "Preço … v7" o "Preço … R$"
 *   3. Itera filas posteriores extrayendo (sku, ref, brl) usando esos índices.
 *
 * Por qué cambiar la heurística anterior:
 *   La versión vieja tomaba "primer número > 1 a la derecha del SKU", lo cual
 *   en este Excel agarraba la columna C ("Modelo Material" = 75) en vez de la
 *   columna M ("Preço 26 v7 (R$)" = 144.46). Además iteraba la hoja
 *   "Calculadora" donde los SKUs aparecen pero con valores tipo CA del MTE.
 *
 * @param {ArrayBuffer} arrayBuffer
 * @param {{ XLSX: any }} deps
 * @returns {Array<{sku:string, ref:string, brl:number}>}
 */
export function parseExcelMarluvas(arrayBuffer, { XLSX }) {
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  const seen = new Set();
  const result = [];
  const skuRe = /^[78]\d{5}$/;

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1, raw: true, defval: null,
    });
    if (!rows.length) continue;

    // 1) Detección del header row + columnas clave.
    let headerRowIdx = -1;
    let priceCol = -1, skuCol = -1, refCol = -1;

    for (let r = 0; r < Math.min(8, rows.length); r++) {
      const row = rows[r];
      if (!Array.isArray(row)) continue;
      let localPrice = -1, localSku = -1, localRef = -1;

      for (let c = 0; c < row.length; c++) {
        const n = normalizeHeader(row[c]);
        if (!n) continue;

        // "preco 26 v7 r" — exige "preco" + ("v7" o "r" de R$).
        if (localPrice < 0 && /\bpreco\b/.test(n) && (/\bv7\b/.test(n) || /\br\b/.test(n))) {
          localPrice = c;
        }
        // "material" o "sku" (primer match — hay dos cols "Material" en el Excel real)
        if (localSku < 0 && (/^material$/.test(n) || /^sku$/.test(n))) {
          localSku = c;
        }
        // "descricao" o "descricion"
        if (localRef < 0 && /^descric/.test(n)) {
          localRef = c;
        }
      }

      if (localPrice >= 0 && localSku >= 0) {
        headerRowIdx = r;
        priceCol = localPrice;
        skuCol   = localSku;
        refCol   = localRef;
        break;
      }
    }

    // Si la hoja no tiene un header reconocible, no la procesamos.
    if (priceCol < 0 || skuCol < 0) continue;

    // 2) Iterar filas de datos.
    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!Array.isArray(row)) continue;

      const skuRaw = row[skuCol];
      if (skuRaw == null) continue;
      const sku = String(skuRaw).trim();
      if (!skuRe.test(sku) || seen.has(sku)) continue;

      const priceRaw = row[priceCol];
      if (priceRaw == null) continue;
      const brl = Number(String(priceRaw).replace(",", "."));
      if (!Number.isFinite(brl) || brl <= 0) continue;

      const ref = refCol >= 0 && row[refCol] != null
        ? String(row[refCol]).trim()
        : "";

      seen.add(sku);
      result.push({ sku, ref, brl });
    }
  }

  return result;
}

/**
 * Estado inicial de un SKU recién parseado del Excel.
 *
 * IMPORTANTE: incluye `matrix` precalculada desde los inputs. La matriz
 * ahora es state principal (editable celda a celda), no derivada.
 *
 * El campo opcional `anchor` (por-SKU) override del ancla global del editor.
 * Si no se pasa, el SKU usa el ancla global como fallback (Fase 1).
 *
 * @param {{sku:string, ref:string, brl:number}} parsed
 * @param {{com?: number, activo?: boolean,
 *          anchor?: {bandaId:number, plazoDias:number}}} [defaults]
 * @returns {SkuInput & {matrix: Object, anchor?: object}}
 */
export function defaultSkuState(parsed, defaults = {}) {
  const com = Number.isFinite(defaults.com) ? defaults.com : 0;
  const activo = defaults.activo !== undefined ? !!defaults.activo : true;
  const base = {
    sku: parsed.sku,
    ref: parsed.ref,
    brl: parsed.brl,
    com,
    ajuste: 0,
    sobreprecio: 0,
    activo,
  };
  if (defaults.anchor
      && Number.isFinite(defaults.anchor.bandaId)
      && Number.isFinite(defaults.anchor.plazoDias)) {
    base.anchor = {
      bandaId:   defaults.anchor.bandaId,
      plazoDias: defaults.anchor.plazoDias,
    };
  }
  return { ...base, matrix: computeMatrixFromInputs(base) };
}

/**
 * Calcula la matriz N×M desde los 4 inputs (brl, com, ajuste, sobreprecio).
 * Útil al hidratar un SKU nuevo o al cambiar un input bulk (regenera todo).
 *
 * Fase 4: si se pasa `customPlazos`, cada banda usa sus plazos efectivos
 * (puede ser distinto a los 4 defaults). Bandas sin entrada usan defaults.
 *
 * Shape devuelto:
 *   { "1": {"90": 25.25, "60": 24.99, "30": 24.80, "8": 24.55},
 *     "2": {"90": 24.06, ...}, ..., "12": {...} }
 *
 * @param {SkuInput} sku
 * @param {Object} [customPlazos]  Fase 4 · { "<bandaId>": [{dias, factor}] }
 * @returns {Object<string, Object<string, number>>}
 */
export function computeMatrixFromInputs(sku, customPlazos = null) {
  const ajuste = Number(sku.ajuste || 0);
  const sobreprecio = Number(sku.sobreprecio || 0);
  const out = {};
  for (const b of BANDAS_MARLUVAS) {
    const baseBanda = precioBaseUSD(sku.brl, b.div, sku.com);
    const lista90 = baseBanda + ajuste + baseBanda * sobreprecio;
    const row = {};
    const bandPlazos = getBandPlazos(b.id, customPlazos);
    for (const p of bandPlazos) {
      row[String(p.dias)] = round4(lista90 * p.factor);
    }
    out[String(b.id)] = row;
  }
  return out;
}

/**
 * Aplica cascade jerárquico al editar UNA celda de UN row de banda.
 *
 * Jerarquía de plazos (descendente). Para defaults [90, 60, 30, 8]:
 *   · Editar 90d  → recalcula 60d, 30d y 8d con factores originales.
 *   · Editar 60d  → recalcula 30d y 8d con ratios relativos a 60d.
 *   · Editar 30d  → recalcula 8d con ratio 8d/30d.
 *   · Editar 8d   → no toca nada (terminal).
 *
 * Fase 4: si se pasa `bandPlazos`, usa esos plazos en orden descendente
 * por días en lugar de los defaults. Si el plazo editado no está en la
 * lista, devuelve el row con solo esa celda actualizada.
 *
 * @param {Object<string, number>} row    Row actual { "<plazoDias>": precio }
 * @param {number|string} plazoEdited     Plazo editado (días)
 * @param {number} newValue               Nuevo valor para esa celda
 * @param {Array<{dias:number,factor:number}>} [bandPlazos]  Fase 4
 * @returns {Object<string, number>}      Row con cascade aplicado
 */
export function cascadeRow(row, plazoEdited, newValue, bandPlazos = null) {
  // Orden descendente por días (ej. [120, 90, 60, 30, 8]).
  const plazosArr = (bandPlazos && bandPlazos.length > 0)
    ? [...bandPlazos].sort((a, b) => b.dias - a.dias)
    : [
        { dias: 90, factor: 1.0000 },
        { dias: 60, factor: 0.9900 },
        { dias: 30, factor: 0.9825 },
        { dias:  8, factor: 0.9725 },
      ];
  const edited = Number(plazoEdited);
  const editedIdx = plazosArr.findIndex((p) => p.dias === edited);
  if (editedIdx < 0) return { ...row, [String(edited)]: round4(newValue) };

  const out = { ...row };
  out[String(edited)] = round4(newValue);

  const editedFactor = plazosArr[editedIdx].factor;
  for (let i = editedIdx + 1; i < plazosArr.length; i++) {
    const p = plazosArr[i];
    const ratio = p.factor / editedFactor;
    out[String(p.dias)] = round4(newValue * ratio);
  }
  return out;
}

function round4(n) {
  return Math.round(Number(n) * 10000) / 10000;
}

/**
 * Plazos default — para bandas sin entrada en custom_plazos.
 * Fase 4: getBandPlazos(bandaId, customPlazos) devuelve esto si no hay override.
 * @returns {Array<{dias:number, factor:number, sub:string}>}
 */
export function defaultBandPlazos() {
  return PLAZOS_MARLUVAS.map((p) => ({
    dias:   p.dias,
    factor: p.factor,
    sub:    p.sub,
  }));
}

/**
 * Plazos efectivos para una banda — respeta overrides Fase 4.
 *
 * @param {number} bandaId
 * @param {Object} customPlazos   { "<bandaId>": [{dias, factor}] } o null/undefined
 * @returns {Array<{dias:number, factor:number, sub:string}>}
 *
 * Bandas SIN entrada → defaults [90/60/30/8].
 * Bandas CON entrada → SOLO esa lista (puede ser más larga o más corta).
 *
 * `sub` se calcula como `±X.XX%` desde el factor (para display).
 * El plazo cuyo factor es exactamente 1.0 se marca como "base".
 */
export function getBandPlazos(bandaId, customPlazos) {
  const entry = customPlazos && customPlazos[String(bandaId)];
  if (!Array.isArray(entry) || entry.length === 0) return defaultBandPlazos();
  const out = entry.map((p) => {
    const dias   = Number(p.dias);
    const factor = Number(p.factor);
    const pct = (factor - 1) * 100;
    let sub;
    if (Math.abs(pct) < 0.005) sub = "base";
    else sub = (pct > 0 ? "+" : "−") + Math.abs(pct).toFixed(2) + "%";
    return { dias, factor, sub };
  });
  // Display: ordenado descendente por días (120, 90, 60, ...).
  out.sort((a, b) => b.dias - a.dias);
  return out;
}

/** Convierte un porcentaje (ej. +2, -1.5) a factor (1.02, 0.985). */
export function pctToFactor(pct) {
  return 1 + Number(pct) / 100;
}

/** Convierte un factor (1.02, 0.985) a porcentaje (+2, -1.5). */
export function factorToPct(factor) {
  return (Number(factor) - 1) * 100;
}

/** Materializa los plazos default de UNA banda (clona el array). Útil para
 *  iniciar overrides — primera edición de una banda copia los defaults. */
export function materializeDefaultPlazos() {
  return PLAZOS_MARLUVAS.map((p) => ({ dias: p.dias, factor: p.factor }));
}

/**
 * Calcula el precio Base USD y Lista USD para una banda + plazo arbitrarios
 * (el "ancla" configurable del editor).
 *
 * Coincide al centavo con `matrix[anchor.bandaId][anchor.plazoDias]` cuando
 * el SKU no tiene overrides manuales por celda.
 *
 *   Base_ancla  = (BRL / div[banda]) × 1.0183^com × 1.030 × factor_plazo[plazo]
 *   Lista_ancla = (BRL/div × com × ME + Ajuste + BRL/div×com×ME × Sobreprecio)
 *                  × factor_plazo[plazo]
 *
 * Equivalentemente: Lista_ancla = (Base[banda][90d] × (1+sobreprecio) + ajuste)
 *                                  × factor_plazo[plazo]
 *
 * @param {SkuInput} sku
 * @param {{bandaId?: number, plazoDias?: number}} [anchor]   default {1, 90}
 * @returns {{ base:number, lista:number, banda:object, plazo:object }}
 */
export function anchorPrice(sku, anchor) {
  const bandaId   = anchor?.bandaId   ?? 1;
  const plazoDias = anchor?.plazoDias ?? 90;
  const banda = BANDAS_MARLUVAS.find((b) => b.id === bandaId) || BANDAS_MARLUVAS[0];
  const plazo = PLAZOS_MARLUVAS.find((p) => p.dias === plazoDias) || PLAZOS_MARLUVAS[0];

  const baseSinPlazo = precioBaseUSD(sku.brl, banda.div, sku.com);
  const ajuste       = Number(sku.ajuste || 0);
  const sobreprecio  = Number(sku.sobreprecio || 0);

  const base  = baseSinPlazo * plazo.factor;
  const lista = (baseSinPlazo + ajuste + baseSinPlazo * sobreprecio) * plazo.factor;

  return { base, lista, banda, plazo };
}

/**
 * Construye el array `skus` del payload de save-simulation a partir del
 * estado de SKUs del editor. Fuente ÚNICA para el guardado por-cliente
 * (BrandClientPricingForm) y la carga masiva por marca (BrandPricingConsole),
 * garantizando payloads idénticos.
 *
 * Para cada SKU reconstruye la matriz con shape canónico: para CADA banda
 * (1..12) incluye EXACTAMENTE los plazos efectivos (defaults + customPlazos).
 * Si el operador editó manualmente una celda (s.matrix), esa edición gana
 * sobre el cálculo base. El ancla efectiva por SKU = s.anchor || globalAnchor.
 *
 * @param {Array} skus            Estado de SKUs (con brl, com, ajuste, sobreprecio, matrix, anchor, activo)
 * @param {{bandaId:number, plazoDias:number}} [globalAnchor]  Ancla global del editor
 * @param {Object} [customPlazos] Fase 4 · { "<bandaId>": [{dias, factor}] } o null
 * @returns {Array} skus payload listo para POST
 */
export function buildSimSkusPayload(skus, globalAnchor = null, customPlazos = null) {
  return (skus || []).map((s) => {
    const baseMatrix = computeMatrixFromInputs(s, customPlazos);
    const userMatrix = (s.matrix && typeof s.matrix === "object") ? s.matrix : {};
    const prices_matrix = {};
    for (const banda of BANDAS_MARLUVAS) {
      const bid = String(banda.id);
      const baseRow = baseMatrix[bid] || {};
      const userRow = userMatrix[bid] || {};
      const plazos  = getBandPlazos(banda.id, customPlazos);
      const plazosObj = {};
      for (const p of plazos) {
        const dKey = String(p.dias);
        const candidate = Number.isFinite(Number(userRow[dKey]))
          ? Number(userRow[dKey])
          : Number(baseRow[dKey]);
        if (Number.isFinite(candidate)) {
          plazosObj[dKey] = Number(candidate.toFixed(4));
        }
      }
      prices_matrix[bid] = plazosObj;
    }
    const effectiveAnchor = (s.anchor
        && Number.isFinite(Number(s.anchor.bandaId))
        && Number.isFinite(Number(s.anchor.plazoDias)))
      ? { bandaId: Number(s.anchor.bandaId), plazoDias: Number(s.anchor.plazoDias) }
      : (globalAnchor
          && Number.isFinite(Number(globalAnchor.bandaId))
          && Number.isFinite(Number(globalAnchor.plazoDias))
          ? { bandaId: Number(globalAnchor.bandaId), plazoDias: Number(globalAnchor.plazoDias) }
          : null);
    return {
      sku:             String(s.sku),
      brl_override:    Number.isFinite(Number(s.brl)) ? Number(s.brl) : null,
      com_pct:         Number(s.com || 0),
      ajuste_usd:      Number(s.ajuste || 0),
      sobreprecio_pct: Number(s.sobreprecio || 0),
      prices_matrix,
      ...(effectiveAnchor ? { anchor: effectiveAnchor } : {}),
      ...(s.sizes_pricing && Object.keys(s.sizes_pricing).length > 0
          ? { sizes_pricing: s.sizes_pricing } : {}),
      activo:          !!s.activo,
    };
  });
}
