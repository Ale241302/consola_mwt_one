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
 * @param {{sku:string, ref:string, brl:number}} parsed
 * @param {{com?: number, activo?: boolean}} [defaults]   Defaults inyectables
 *   (típicamente com = client.comision_pct * 100).
 * @returns {SkuInput}
 */
export function defaultSkuState(parsed, defaults = {}) {
  const com = Number.isFinite(defaults.com) ? defaults.com : 0;
  const activo = defaults.activo !== undefined ? !!defaults.activo : true;
  return {
    sku: parsed.sku,
    ref: parsed.ref,
    brl: parsed.brl,
    com,
    ajuste: 0,
    sobreprecio: 0,   // fracción, ej. 0.05 = 5%
    activo,
  };
}
