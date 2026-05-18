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
 * Parser de Excel Marluvas COMEX 2026 v7.
 *
 * Estrategia: el Excel tiene múltiples hojas y formato libre, así que
 * recorremos todas las celdas buscando filas que parezcan
 * `[SKU 6 dígitos, Referencia, ..., precio BRL]`.
 *
 * Heurística:
 *   · SKU         = primera columna que matchea /^7\d{5}$|^8\d{5}$/
 *   · Referencia  = siguiente columna no vacía y NO numérica
 *   · BRL         = primer número > 1 encontrado a la derecha
 *
 * Si el Excel cambia de formato, esta función es el único punto a tocar.
 *
 * @param {ArrayBuffer} arrayBuffer
 * @param {{ XLSX: any }} deps    Inyectamos SheetJS para que la función sea pura
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
    for (const row of rows) {
      if (!Array.isArray(row) || row.length === 0) continue;

      // Buscar el SKU en cualquier celda
      let skuIdx = -1;
      let sku = null;
      for (let i = 0; i < row.length; i++) {
        const v = row[i];
        if (v == null) continue;
        const s = String(v).trim();
        if (skuRe.test(s)) {
          sku = s;
          skuIdx = i;
          break;
        }
      }
      if (!sku || seen.has(sku)) continue;

      // Referencia: siguiente celda no vacía y no numérica
      let ref = "";
      for (let i = skuIdx + 1; i < row.length; i++) {
        const v = row[i];
        if (v == null) continue;
        const s = String(v).trim();
        if (s.length === 0) continue;
        if (Number.isFinite(Number(s)) && !/[A-Za-z]/.test(s)) continue;
        ref = s;
        break;
      }

      // Precio BRL: primer número > 1 a la derecha del SKU
      let brl = null;
      for (let i = skuIdx + 1; i < row.length; i++) {
        const v = row[i];
        if (v == null) continue;
        const n = Number(String(v).replace(",", "."));
        if (Number.isFinite(n) && n > 1) {
          brl = n;
          break;
        }
      }
      if (brl == null) continue;

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
