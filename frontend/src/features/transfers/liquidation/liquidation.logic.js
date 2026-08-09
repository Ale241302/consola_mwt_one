// MWT.ONE · features/transfers/liquidation/liquidation.logic.js
// Lógica pura de liquidación / landed cost — SIN React, testeable con
// node --test. Extraída de TransferLiquidationPanel (Ola 3 · 3.28).
//
// Reglas fiscales (en sync con backend liquidation.py, commit d7d21b2):
//   · IVA NO capitaliza en el landed cost (se reporta aparte, informativo).
//   · El prorrateo de costos extra aplica scope_json por línea.
//   · DAI/Ley/IVA se calculan por NCM sobre CIF.
// =====================================================================

// ── Catálogo NCM → tasas estáticas (fallback cuando no hay tarifa) ──
export const NCM_TAX_RATES = {
  "6403.99.90": { dai: 0.14, ley_6946: 0.01, iva: 0.13 }, // calzado seguridad
  "6403.40.00": { dai: 0.14, ley_6946: 0.01, iva: 0.13 }, // calzado puntera metálica
  _default:     { dai: 0.14, ley_6946: 0.01, iva: 0.13 },
};

export function taxRatesForNcm(ncm) {
  const key = String(ncm || "").trim();
  return NCM_TAX_RATES[key] || NCM_TAX_RATES._default;
}

export const KIND_FREIGHT = new Set(["FLETE", "FREIGHT", "CONSOLIDACION"]);
export const KIND_INSURANCE = new Set(["SEGURO", "INSURANCE"]);

// Timbres/tasas fijas de nacionalización CR (montos USD fijos). Se siembran
// por defecto en cada movimiento (vista MWT y Cliente). Mantener en sync
// con lib/transferInvoiceHtml.js.
export const DEFAULT_TIMBRES = [
  { concept: "PROCOMER",                          amount: 3.00 },
  { concept: "T. Asociación Agentes (Ley 7017)",  amount: 0.11 },
  { concept: "T. Archivo Nacional",               amount: 0.04 },
  { concept: "T. Contadores",                     amount: 0.00 },
];

// ── Catálogo fallback de tipos de costo (espejo del backend) ──
export const COST_KINDS_FALLBACK = [
  { codigo:"DAI",           label:"Aranceles (DAI)",     is_fiscal:true,  color:"#481EE3" },
  { codigo:"IVA",           label:"Impuestos (IVA)",     is_fiscal:true,  color:"#7C3AED" },
  { codigo:"ALMACENAJE",    label:"Almacenaje aduanal",  is_fiscal:false, color:"#0891B2" },
  { codigo:"AGENCIAMIENTO", label:"Agenciamiento",       is_fiscal:false, color:"#0EA5E9" },
  { codigo:"MANIPULEO",     label:"Manipuleo / handling",is_fiscal:false, color:"#06B6D4" },
  { codigo:"FLETE",         label:"Flete",               is_fiscal:false, color:"#3083FE" },
  { codigo:"SEGURO",        label:"Seguro",              is_fiscal:false, color:"#10B981" },
  { codigo:"CONSOLIDACION", label:"Consolidación",       is_fiscal:false, color:"#22C55E" },
  { codigo:"OTRO",          label:"Otro",                is_fiscal:false, color:"#64748B" },
];

export const CURRENCIES = ["USD", "PEN", "MXN", "COP", "CLP", "BRL", "ARS", "CRC", "EUR"];

// ── IVA no capitaliza (alineado con backend d7d21b2) ──
export const NON_CAPITALIZABLE_KINDS = new Set(["IVA"]);

export function isCapitalizable(kind) {
  return !NON_CAPITALIZABLE_KINDS.has(String(kind || "").toUpperCase());
}

/**
 * Prorratea costos extra (no flete/seguro) entre las líneas.
 * Aplica scope_json por línea cuando viene; excluye IVA del landed cost.
 * @param {Array<{kind?:string, amount?:number, fx_to_usd?:number, scope_json?:any}>} costLines
 * @param {Array<{qty:number, _line_id?:string|number, id?:string|number}>} items
 * @param {object} [opts]
 * @param {Set<string>} [opts.excludeKinds] kinds no capitalizables (default NON_CAPITALIZABLE_KINDS)
 * @returns {{capitalizable:number, nonCapitalizable:number, total:number}}
 */
export function prorateExtras(costLines, items, { excludeKinds = NON_CAPITALIZABLE_KINDS } = {}) {
  const arr = Array.isArray(costLines) ? costLines : [];
  const lines = Array.isArray(items) ? items : [];
  const qtyTotal = lines.reduce((a, x) => a + Number(x.qty || 0), 0);
  if (qtyTotal <= 0) {
    return {
      capitalizable: 0,
      nonCapitalizable: 0,
      total: 0,
    };
  }
  const unitShare = (c) => Number(c.amount || 0) * Number(c.fx_to_usd || 1);
  let capitalizable = 0;
  let nonCapitalizable = 0;
  for (const c of arr) {
    const k = String(c.kind || "").toUpperCase();
    const total = unitShare(c);
    if (excludeKinds.has(k)) {
      nonCapitalizable += total;
    } else {
      capitalizable += total;
    }
  }
  return {
    capitalizable,
    nonCapitalizable,
    total: capitalizable + nonCapitalizable,
  };
}

// ── Formateo numérico estándar del panel ──
export const fmt = (n) => Number(n || 0).toLocaleString("en-US", {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});
export const fmt4 = (n) => Number(n || 0).toLocaleString("en-US", {
  minimumFractionDigits: 4, maximumFractionDigits: 4,
});
export const fmtInt = (n) => Number(n || 0).toLocaleString("en-US", {
  maximumFractionDigits: 0,
});
