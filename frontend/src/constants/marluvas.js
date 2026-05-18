// =====================================================================
// MWT.ONE · constants/marluvas.js
// Agente responsable: [AG-03 FRONTEND]
//
// Fuente única de verdad para el simulador de precios Marluvas v7.
// Cualquier cambio en bandas/plazos/factores DEBE pasar por aquí — el
// frontend no debe hardcodear divisores ni factores en componentes.
//
// Origen de los números:
//   · BANDAS         → calibradas por COMEX 2026 v7 (no son punto medio
//                       del rango: 4,00–4,20 ÷ 4.07, no ÷ 4.10).
//   · FACTOR_COMISION → 1.0183^com_pct (curva exponencial; com=10 ≈ +19.9%).
//   · INDICE_ME_90    → 3% plano sobre toda banda y SKU (costo financiero 90d).
//   · PLAZOS          → factores multiplicativos sobre el precio 90d.
// =====================================================================

/** @type {Array<{id:number, rango:string, div:number, techo?:boolean, piso?:boolean}>} */
export const BANDAS_MARLUVAS = [
  { id: 1,  rango: "4,00 – 4,20", div: 4.07, techo: true },
  { id: 2,  rango: "4,20 – 4,40", div: 4.27 },
  { id: 3,  rango: "4,40 – 4,60", div: 4.46 },
  { id: 4,  rango: "4,60 – 4,80", div: 4.66 },
  { id: 5,  rango: "4,80 – 5,00", div: 4.85 },
  { id: 6,  rango: "5,00 – 5,20", div: 5.04 },
  { id: 7,  rango: "5,20 – 5,40", div: 5.24 },
  { id: 8,  rango: "5,40 – 5,60", div: 5.43 },
  { id: 9,  rango: "5,60 – 5,80", div: 5.63 },
  { id: 10, rango: "5,80 – 6,00", div: 5.82 },
  { id: 11, rango: "6,00 – 6,20", div: 6.01 },
  { id: 12, rango: "6,20 – 6,40", div: 6.21, piso: true },
];

/** @type {Array<{dias:number, factor:number, label:string, sub:string}>} */
export const PLAZOS_MARLUVAS = [
  { dias: 90, factor: 1.0000, label: "90 días", sub: "base" },
  { dias: 60, factor: 0.9900, label: "60 días", sub: "−1.00%" },
  { dias: 30, factor: 0.9825, label: "30 días", sub: "−1.75%" },
  { dias:  8, factor: 0.9725, label:  "8 días", sub: "−2.75%" },
];

/** Índice mercado externo a 90 días. Plano. */
export const INDICE_ME_90 = 1.030;

/** Base exponencial de la comisión: factor^com_pct. */
export const FACTOR_COMISION = 1.0183;

/**
 * Dado un tipo de cambio USD/BRL, devuelve la banda en la que cae.
 * Retorna `null` si está fuera del rango 4.00–6.40.
 * @param {number} tc
 * @returns {{id:number, rango:string, div:number, techo?:boolean, piso?:boolean} | null}
 */
export function bandaForTC(tc) {
  if (tc == null || Number.isNaN(tc)) return null;
  const n = Number(tc);
  if (n < 4.00 || n >= 6.40) return null;
  // Buckets de 0.20: id = floor((tc - 4.00) / 0.20) + 1, clamp 1..12
  const idx = Math.min(11, Math.max(0, Math.floor((n - 4.00) / 0.20)));
  return BANDAS_MARLUVAS[idx];
}

/**
 * Formato monetario USD con 2 decimales y tabular-nums.
 * @param {number} n
 */
export function fmtUSD(n) {
  return "$" + Number(n || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

/**
 * Formato porcentual con 2 decimales.
 * @param {number} n   Fracción (0.0656 = 6.56%)
 */
export function fmtPct(n) {
  return (Number(n || 0) * 100).toFixed(2) + "%";
}
