// =====================================================================
// MWT.ONE · lib/transferInvoiceHtml.js
// Agente responsable: [AG-03 FRONTEND]
//
// Genera el HTML standalone descargable de la "Factura / Remisión" de una
// transferencia inter-nodos, con el mismo lenguaje visual que la Proforma:
// navy + mint, Plus Jakarta Sans, JetBrains Mono, tabular-nums y bloque
// @media print canónico (POL_PRINT).
//
// SECCIONES
//   1. Cabecera + emisor / facturado-a (según audiencia).
//   2. Detalle de mercadería al precio de la audiencia (MWT vs Cliente).
//   3. Costos registrados del movimiento (cost_lines reales: descripción
//        del costo + valor — Flete, Seguro, etc.).
//   4. Resumen por talla.
//
// NOTA: NO se calculan impuestos de nacionalización (DAI/IVA/Ley 6946). El
// documento refleja únicamente datos reales del movimiento (precios y
// cost_lines cargadas). Si en el futuro se requiere un análisis DDP con
// liquidación tributaria, debe alimentarse de líneas fiscales reales, no
// de estimaciones.
//
// PRECIO POR AUDIENCIA (la regla del CEO):
//   · audience === 'MWT'    → unit_price_mwt    (precio operador / interno)
//   · audience === 'CLIENT' → unit_price_client (precio de venta al cliente)
//
// NOTA R1: este archivo produce un DOCUMENTO HTML autónomo (no es UI de la
// app), por lo que sus colores hex viven embebidos en el <style> del doc,
// igual que proforma_renderer.py y TransferInvoicePrintView.
// =====================================================================

import { MWT_LOGO_DATA_URI, MWT_FAVICON_DATA_URI } from "./mwtBrandAssets.js";

/** Audiencias soportadas por el documento. */
export const INVOICE_AUDIENCE = Object.freeze({
  MWT: "MWT",
  CLIENT: "CLIENT",
});

// Tasas tributarias de importación POR NCM (partida arancelaria). Cada
// producto trae su `ncm` (productos.producto.especificaciones->>'ncm'); el
// backend lo propaga por línea en invoice_payload. Modelo CR:
//   · DAI       = % s/CIF
//   · LEY_6946  = % s/CIF (Seguridad Ciudadana)
//   · IVA       = % s/(CIF + DAI + LEY_6946)   (acreditable)
// Única fuente de verdad — agregar/ajustar NCMs aquí. `_default` aplica a
// cualquier NCM no listado.
export const NCM_TAX_RATES = Object.freeze({
  "6403.99.90": { dai: 0.14, ley_6946: 0.01, iva: 0.13 }, // calzado seguridad
  "6403.40.00": { dai: 0.14, ley_6946: 0.01, iva: 0.13 }, // calzado puntera metálica
  _default:     { dai: 0.14, ley_6946: 0.01, iva: 0.13 },
});

/** Devuelve las tasas para un NCM (normaliza separadores; cae a _default). */
export function taxRatesForNcm(ncm) {
  const key = String(ncm || "").trim();
  return NCM_TAX_RATES[key] || NCM_TAX_RATES._default;
}

// Timbres/tasas fijas estándar de nacionalización CR (montos USD fijos).
// Se siembran por defecto en cada movimiento (vista MWT y Cliente) y se
// muestran en la liquidación de la factura. Editables/eliminables por el CEO.
// Mantener en sync con el panel (TransferLiquidationPanel.jsx).
export const DEFAULT_TIMBRES = Object.freeze([
  { concept: "PROCOMER",                          amount: 3.00, fixed: true },
  { concept: "T. Asociación Agentes (Ley 7017)",  amount: 0.11, fixed: true },
  { concept: "T. Archivo Nacional",               amount: 0.04, fixed: true },
  { concept: "T. Contadores",                     amount: 0.00, fixed: true },
]);

/** Lista de impuestos TAX de un bucket. Los timbres por defecto los siembra
 *  el panel (gateado por país destino = CR); aquí sólo se renderiza lo que
 *  quedó guardado en el bucket de la vista. */
function resolveTaxRows(bucket) {
  return (bucket.custom_taxes || []).filter((x) => x && x.type === "TAX");
}

/** Monto efectivo de una fila de impuesto TAX: fijo si trae amount, si no CIF×tasa. */
function taxRowAmount(x, cif) {
  if (x.amount != null && x.amount !== "") return Number(x.amount) || 0;
  return Number(cif) * (Number(x.rate || 0) / 100);
}

// Clasificación de cost_lines que entran al CIF (flete + seguro).
const KIND_FREIGHT = new Set(["FLETE", "FREIGHT", "CONSOLIDACION"]);
const KIND_INSURANCE = new Set(["SEGURO", "INSURANCE"]);

// Sprint 2026-06-03 — bucket de overrides por vista (MWT|CLIENT). El panel
// guarda tasas/overrides/impuestos custom en context_data.views[view]; la
// factura debe leer los de su audiencia. Fallback a las claves legacy de
// nivel superior para transferencias previas a la vista dual.
function viewBucket(ctx, audience) {
  const b = ctx?.views?.[audience];
  if (b && typeof b === "object") return b;
  return {
    line_overrides: ctx?.line_overrides,
    custom_taxes:   ctx?.custom_taxes,
    custom_rates:   ctx?.custom_rates,
  };
}

/** Escapa texto para insertarlo seguro en HTML. */
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** $#,###.## con tabular-nums. */
function usd(n) {
  return "$" + Number(n || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

/** $#,###.#### (hasta 4 decimales) para precios unitarios finos. */
function usd4(n) {
  return "$" + Number(n || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2, maximumFractionDigits: 4,
  });
}

function fmtInt(n) {
  return Number(n || 0).toLocaleString("en-US");
}

function fmtDate(s, lang) {
  if (!s) return "—";
  const isDateOnly = typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const d = new Date(isDateOnly ? `${s}T12:00:00` : s);
  if (isNaN(d.getTime())) return String(s);
  return d.toLocaleDateString(lang === "es" ? "es-PE" : "en-US", {
    day: "2-digit", month: "long", year: "numeric",
  });
}

function buildDetailedLiquidationTable(n, costs, isClient, lang, t = {}, bucket = {}, crcRate = 0) {
  // Conversión a colones (CRC) en vivo. Si no hay tasa, columna muestra "—".
  const crc = (v) => (crcRate > 0 ? "₡" + Math.round(Number(v || 0) * crcRate).toLocaleString("es-CR") : "&mdash;");
  // Tasas mostradas según la vista (custom_rates) con fallback a NCM.
  const cr = bucket.custom_rates || {};
  const daiPct = ((cr.dai != null ? Number(cr.dai) : 0.14) * 100).toFixed(2);
  const leyPct = ((cr.ley != null ? Number(cr.ley) : 0.01) * 100).toFixed(2);
  const ivaPct = ((cr.iva != null ? Number(cr.iva) : 0.13) * 100).toFixed(2);
  const freight = costs.reduce((a, c) => a + (KIND_FREIGHT.has(String(c.kind || "").toUpperCase()) ? Number(c.amount_usd || 0) : 0), 0);
  const insurance = costs.reduce((a, c) => a + (KIND_INSURANCE.has(String(c.kind || "").toUpperCase()) ? Number(c.amount_usd || 0) : 0), 0);
  const otherCosts = costs.filter(c => {
    const k = String(c.kind || "").toUpperCase();
    return !KIND_FREIGHT.has(k) && !KIND_INSURANCE.has(k);
  });
  
  const labelFob = isClient
    ? (lang === "es" ? "FOB declarado (precio orden SN)" : "Declared FOB (SN price)")
    : (lang === "es" ? "FOB Marluvas (UF v5)" : "Marluvas FOB (UF v5)");
    
  const refFob = isClient
    ? (lang === "es" ? "Precio de la orden (precio cliente)" : "Order price (client price)")
    : (lang === "es" ? "Factura Marluvas / pedido" : "Marluvas invoice / order");

  let html = `
    <table class="ct">
      <thead>
        <tr>
          <th>#</th>
          <th>${lang === "es" ? "Concepto" : "Concept"}</th>
          <th>${lang === "es" ? "Base" : "Basis"}</th>
          <th class="r">${lang === "es" ? "Tasa" : "Rate"}</th>
          <th class="r">${lang === "es" ? "Monto USD" : "Amount USD"}</th>
          <th class="r">${lang === "es" ? "Monto ₡" : "Amount ₡"}</th>
          <th>${lang === "es" ? "Notas" : "Notes"}</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>1</td>
          <td><strong>${esc(labelFob)}</strong></td>
          <td class="m">${esc(refFob)}</td>
          <td class="r">&mdash;</td>
          <td class="r">${usd(n.totals.goods)}</td>
          <td class="r" style="color:var(--t2);">${crc(n.totals.goods)}</td>
          <td style="font-size:10px;color:var(--t2);">${n.totals.qty} pares</td>
        </tr>
        <tr>
          <td>2</td>
          <td>${lang === "es" ? "Flete aéreo internacional" : "International air freight"}</td>
          <td class="m">AWB / BL</td>
          <td class="r">&mdash;</td>
          <td class="r">${usd(freight)}</td>
          <td class="r" style="color:var(--t2);">${crc(freight)}</td>
          <td style="font-size:10px;color:var(--t2);">${lang === "es" ? "Costo real registrado" : "Registered cost"}</td>
        </tr>
        <tr>
          <td>3</td>
          <td>${lang === "es" ? "Seguro internacional" : "International insurance"}</td>
          <td class="m">Factura</td>
          <td class="r">&mdash;</td>
          <td class="r">${usd(insurance)}</td>
          <td class="r" style="color:var(--t2);">${crc(insurance)}</td>
          <td style="font-size:10px;color:var(--t2);">${lang === "es" ? "Costo real registrado" : "Registered cost"}</td>
        </tr>
        <tr class="trow">
          <td colspan="4"><strong>CIF (base imponible aduana)</strong></td>
          <td class="r"><strong>${usd(n.totals.cif)}</strong></td>
          <td class="r"><strong>${crc(n.totals.cif)}</strong></td>
          <td></td>
        </tr>`;

  // Exclusiones de impuestos núcleo (trash en el panel) y montos por vista.
  const excluded = bucket.excluded || {};
  const cifTot = Number(n.totals.cif);
  const daiT = excluded.dai ? 0 : Number(n.totals.dai);
  const leyT = excluded.ley ? 0 : Number(n.totals.ley);
  const ivaT = excluded.iva ? 0 : Number(n.totals.iva);

  // DAI: agrupado por NCM con su tasa VIVA (igual que el panel). Si el operador
  // hizo un override EXPLÍCITO (dai_overridden), se muestra una sola fila a esa
  // tasa; si no, una fila por NCM con tasa = dai/cif del grupo.
  const daiOverridden = cr.dai_overridden === true;
  let daiRows = [];
  if (!excluded.dai) {
    if (daiOverridden) {
      daiRows = [{
        label: "DAI &mdash; Derecho Arancelario",
        basis: "CIF",
        ratePct: daiPct,
        amount: daiT,
        note: lang === "es" ? "Override manual" : "Manual override",
      }];
    } else {
      const byNcm = new Map();
      (n.rows || []).forEach((row) => {
        const code = (row.ncm && row.ncm !== "—") ? row.ncm : "—";
        const g = byNcm.get(code) || { code, cif: 0, dai: 0 };
        g.cif += Number(row.cif || 0);
        g.dai += Number(row.dai || 0);
        byNcm.set(code, g);
      });
      daiRows = Array.from(byNcm.values()).map((g) => ({
        label: `DAI &mdash; Derecho Arancelario${g.code !== "—" ? ` (${esc(g.code)})` : ""}`,
        basis: g.code !== "—" ? `CIF (${esc(g.code)})` : "CIF",
        ratePct: (g.cif > 0 ? (g.dai / g.cif * 100) : 0).toFixed(2),
        amount: g.dai,
        note: g.code !== "—" ? esc(g.code) : (lang === "es" ? "Régimen general" : "General tariff"),
      }));
    }
  }

  // Numeración continua de filas núcleo (FOB/Flete/Seguro = 1-3).
  let coreIdx = 3;
  daiRows.forEach((dr) => {
    coreIdx++;
    html += `
        <tr>
          <td>${coreIdx}</td>
          <td>${dr.label}</td>
          <td class="m">${dr.basis}</td>
          <td class="r">${dr.ratePct}%</td>
          <td class="r">${usd(dr.amount)}</td>
          <td class="r" style="color:var(--t2);">${crc(dr.amount)}</td>
          <td style="font-size:10px;color:var(--t2);">${dr.note}</td>
        </tr>`;
  });
  if (!excluded.ley) {
    coreIdx++;
    html += `
        <tr>
          <td>${coreIdx}</td>
          <td>Ley 6946</td>
          <td class="m">CIF</td>
          <td class="r">${leyPct}%</td>
          <td class="r">${usd(leyT)}</td>
          <td class="r" style="color:var(--t2);">${crc(leyT)}</td>
          <td style="font-size:10px;color:var(--t2);">${lang === "es" ? "Tributo fijo" : "Fixed tax"}</td>
        </tr>`;
  }
  if (!excluded.iva) {
    coreIdx++;
    html += `
        <tr>
          <td>${coreIdx}</td>
          <td>IVA (Ley 9635)</td>
          <td class="m">CIF + DAI + Ley</td>
          <td class="r">${ivaPct}%</td>
          <td class="r">${usd(ivaT)}</td>
          <td class="r" style="color:var(--t2);">${crc(ivaT)}</td>
          <td style="font-size:10px;color:var(--t2);">${lang === "es" ? "Acreditable — crédito fiscal" : "Creditable — tax credit"}</td>
        </tr>`;
  }

  // Timbres + impuestos custom (monto fijo, o % sobre CIF). Timbres por
  // defecto si el movimiento aún no fue sembrado en el panel.
  const taxRows = resolveTaxRows(bucket);
  let customTaxesSum = 0;
  // Numeración continua desde la última fila núcleo (coreIdx ya contó DAI por
  // grupo + Ley + IVA presentes).
  let rowN = coreIdx;
  taxRows.forEach((x) => {
    const amount = taxRowAmount(x, cifTot);
    customTaxesSum += amount;
    const rowNum = `${++rowN}`;
    const hasAmount = x.amount != null && x.amount !== "";
    const rateNum = Number(x.rate || 0);
    const rateCell = (hasAmount && !rateNum) ? "&mdash;" : rateNum.toFixed(2) + "%";
    const notes = x.notes || ((hasAmount && !rateNum)
      ? (lang === "es" ? "Timbre / tasa" : "Stamp / fee")
      : (lang === "es" ? "Impuesto específico" : "Specific tax"));
    html += `
      <tr>
        <td>${rowNum}</td>
        <td>${esc(x.concept || (lang === "es" ? "Impuesto adicional" : "Additional tax"))}</td>
        <td class="m">CIF</td>
        <td class="r">${rateCell}</td>
        <td class="r">${usd(amount)}</td>
        <td class="r" style="color:var(--t2);">${crc(amount)}</td>
        <td style="font-size:10px;color:var(--t2);">${esc(notes)}</td>
      </tr>`;
  });

  const subtotalTaxes = daiT + leyT + ivaT + customTaxesSum;

  html += `
        <tr class="trow">
          <td colspan="4"><strong>${lang === "es" ? "Subtotal tributos+timbres (con IVA)" : "Subtotal taxes+stamps (incl. VAT)"}</strong></td>
          <td class="r"><strong>${usd(subtotalTaxes)}</strong></td>
          <td class="r"><strong>${crc(subtotalTaxes)}</strong></td>
          <td></td>
        </tr>`;

  otherCosts.forEach((c) => {
    html += `
      <tr>
        <td>${++rowN}</td>
        <td>${esc(c.label || (lang === "es" ? "Otros costos" : "Other costs"))}</td>
        <td class="m">${esc(c.kind || "—")}</td>
        <td class="r">&mdash;</td>
        <td class="r">${usd(c.amount_usd)}</td>
        <td class="r" style="color:var(--t2);">${crc(c.amount_usd)}</td>
        <td style="font-size:10px;color:var(--t2);">${lang === "es" ? "Costo en destino" : "Destination cost"}</td>
      </tr>`;
  });

  let customCostsSum = 0;
  (bucket.custom_taxes || []).filter((x) => x.type === "COST").forEach((x) => {
    const amt = Number(x.amount || 0);
    customCostsSum += amt;
    html += `
      <tr>
        <td>${++rowN}</td>
        <td>${esc(x.concept || (lang === "es" ? "Gasto adicional" : "Additional charge"))}</td>
        <td class="m">OTRO</td>
        <td class="r">&mdash;</td>
        <td class="r">${usd(amt)}</td>
        <td class="r" style="color:var(--t2);">${crc(amt)}</td>
        <td style="font-size:10px;color:var(--t2);">${esc(x.notes || (lang === "es" ? "Costo en destino" : "Destination cost"))}</td>
      </tr>`;
  });

  const destTot = Number(n.totals.dest) + customCostsSum;
  const totalSinIva = cifTot + daiT + leyT + customTaxesSum + destTot;
  const totalConIva = totalSinIva + ivaT;

  html += `
        <tr class="trow">
          <td colspan="4"><strong>${lang === "es" ? "Subtotal costos destino" : "Subtotal destination costs"}</strong></td>
          <td class="r"><strong>${usd(destTot)}</strong></td>
          <td class="r"><strong>${crc(destTot)}</strong></td>
          <td></td>
        </tr>
        <tr style="background:var(--t2);color:white;">
          <td colspan="4" style="padding:10px 12px;"><strong style="color:white;font-size:12px;">${lang === "es" ? "Total con IVA (incluye crédito fiscal)" : "Total incl. VAT (includes tax credit)"}</strong></td>
          <td class="r" style="padding:10px 12px;"><strong style="color:white;font-size:13px;">${usd(totalConIva)}</strong></td>
          <td class="r" style="padding:10px 12px;"><strong style="color:white;font-size:13px;">${crc(totalConIva)}</strong></td>
          <td style="padding:10px 12px;color:rgba(255,255,255,.7);font-size:10px;">${lang === "es" ? "embarque completo" : "complete shipment"}</td>
        </tr>
        <tr style="background:var(--navy);color:white;">
          <td colspan="4" style="padding:12px;border-top:2px solid var(--navy);"><strong style="color:white;font-size:13px;">${
            isClient
              ? (lang === "es" ? "TOTAL SIN IVA — costo real de nacionalizar" : "TOTAL EXCL. VAT — real nationalization cost")
              : (lang === "es" ? "TOTAL SIN IVA — costo real de MWT" : "TOTAL EXCL. VAT — real MWT cost")
          }</strong></td>
          <td class="r" style="padding:12px;border-top:2px solid var(--navy);"><strong style="color:white;font-size:15px;">${usd(totalSinIva)}</strong></td>
          <td class="r" style="padding:12px;border-top:2px solid var(--navy);"><strong style="color:var(--ice);font-size:14px;">${crc(totalSinIva)}</strong></td>
          <td style="padding:12px;border-top:2px solid var(--navy);color:var(--ice);font-size:10px;">${lang === "es" ? "ver $/par por línea" : "see $/pair by line"}</td>
        </tr>
      </tbody>
    </table>`;

  return html;
}

// Sprint 2026-06-09 — Desglose de la liquidación por NCM o por SKU.
// computeNac ya entrega filas por SKU con DAI/Ley/IVA propios de su NCM
// (aditivos por línea: el IVA de cada grupo sólo incluye el DAI de SU
// subconjunto). Aquí se agrupan las filas y se prorratean: timbres fijos y
// gastos custom por pares, impuestos % sobre el CIF del grupo — misma regla
// que el panel y que los totales de la tabla "Liquidación detallada".
function buildLiquidationBreakdownTable(n, bucket, lang, crcRate, groupBy) {
  const crc = (v) => (crcRate > 0 ? "₡" + Math.round(Number(v || 0) * crcRate).toLocaleString("es-CR") : "&mdash;");
  const excluded = bucket.excluded || {};
  const taxRows = resolveTaxRows(bucket);
  const customCosts = (bucket.custom_taxes || []).filter((x) => x && x.type === "COST");
  const qtyAll = Number(n.totals.qty) || 0;

  const map = new Map();
  (n.rows || []).forEach((r) => {
    const key = groupBy === "NCM"
      ? ((r.ncm && r.ncm !== "—") ? r.ncm : "—")
      : (r.sku || "—");
    const g = map.get(key) || {
      key, qty: 0, goods: 0, extra: 0, cif: 0, dai: 0, ley: 0, iva: 0, dest: 0,
      skus: new Set(), ncms: new Set(), product: r.product_label || "",
    };
    g.qty += Number(r.qty || 0);
    g.goods += Number(r.goods || 0);
    g.extra += Number(r.extra || 0);
    g.cif += Number(r.cif || 0);
    g.dai += excluded.dai ? 0 : Number(r.dai || 0);
    g.ley += excluded.ley ? 0 : Number(r.ley || 0);
    g.iva += excluded.iva ? 0 : Number(r.iva || 0);
    g.dest += Number(r.dest || 0);
    if (r.sku) g.skus.add(r.sku);
    if (r.ncm && r.ncm !== "—") g.ncms.add(r.ncm);
    map.set(key, g);
  });

  const groups = Array.from(map.values()).map((g) => {
    const share = qtyAll > 0 ? g.qty / qtyAll : 0;
    const customTax = taxRows.reduce((sum, x) => {
      const hasAmt = x.amount != null && x.amount !== "";
      return sum + (hasAmt ? (Number(x.amount) || 0) * share : g.cif * (Number(x.rate || 0) / 100));
    }, 0);
    const customCost = customCosts.reduce((sum, x) => sum + (Number(x.amount) || 0) * share, 0);
    const sinIva = g.cif + g.dai + g.ley + customTax + g.dest + customCost;
    return {
      ...g,
      customTax, customCost, sinIva,
      conIva: sinIva + g.iva,
      daiRatePct: g.cif > 0 ? (g.dai / g.cif) * 100 : 0,
    };
  });

  const sumG = (k) => groups.reduce((a, x) => a + x[k], 0);

  // Celda de grupo: NCM → código + chips de SKUs (wrap); SKU → código +
  // producto + NCM mono. Una sola columna de identidad = más aire para los
  // montos sin scroll horizontal (doc 1200px).
  const groupCell = (g) => {
    if (groupBy === "NCM") {
      const chips = Array.from(g.skus)
        .map((s) => `<span class="kind" style="font-size:9px;padding:1px 7px;">${esc(s)}</span>`)
        .join("");
      return `<strong style="font-size:12px;color:var(--navy);">${esc(g.key)}</strong>
        ${chips ? `<div style="margin-top:5px;display:flex;flex-wrap:wrap;gap:3px;">${chips}</div>` : ""}`;
    }
    const ncmTag = Array.from(g.ncms).join(", ");
    return `<strong style="font-size:12px;color:var(--navy);">${esc(g.key)}</strong>
      <div style="margin-top:3px;font-size:9.5px;color:var(--t2);">${esc(g.product || "")}${ncmTag ? ` &middot; <span style="font-family:'JetBrains Mono',monospace;">${esc(ncmTag)}</span>` : ""}</div>`;
  };

  const nw = 'style="white-space:nowrap;"';
  const bodyRows = groups.map((g, i) => `
      <tr${i % 2 === 1 ? ' class="cb"' : ""}>
        <td style="min-width:170px;">${groupCell(g)}</td>
        <td class="r" ${nw}>${fmtInt(g.qty)}</td>
        <td class="r" ${nw}>${usd(g.goods)}</td>
        <td class="r" ${nw}><strong>${usd(g.cif)}</strong></td>
        <td class="r" ${nw}>${usd(g.dai)}<br><span style="font-size:9px;color:var(--t2);">${g.daiRatePct.toFixed(2)}%</span></td>
        <td class="r" ${nw}>${usd(g.ley)}</td>
        <td class="r" ${nw}>${usd(g.customTax)}</td>
        <td class="r" style="white-space:nowrap;color:var(--t2);">${usd(g.iva)}</td>
        <td class="r" ${nw}>${usd(g.dest + g.customCost)}</td>
        <td class="r" ${nw}><strong style="color:var(--ok);">${usd(g.sinIva)}</strong>${crcRate > 0 ? `<br><span style="font-size:9px;color:var(--t2);">${crc(g.sinIva)}</span>` : ""}</td>
        <td class="r" ${nw}><strong>${usd(g.conIva)}</strong></td>
      </tr>`).join("");

  return `
    <table class="ct">
      <thead>
        <tr>
          <th ${nw}>${groupBy === "NCM" ? (lang === "es" ? "NCM · SKUs incluidos" : "NCM · Included SKUs") : (lang === "es" ? "SKU · Producto" : "SKU · Product")}</th>
          <th class="r" ${nw}>${lang === "es" ? "Pares" : "Pairs"}</th>
          <th class="r" ${nw}>FOB</th>
          <th class="r" ${nw}>CIF</th>
          <th class="r" ${nw}>DAI</th>
          <th class="r" ${nw}>${lang === "es" ? "Ley 6946" : "Law 6946"}</th>
          <th class="r" ${nw}>${lang === "es" ? "Timbres" : "Stamps"}</th>
          <th class="r" ${nw}>IVA</th>
          <th class="r" ${nw}>${lang === "es" ? "C. destino" : "Dest. costs"}</th>
          <th class="r" ${nw}>${lang === "es" ? "Total sin IVA" : "Total excl. VAT"}</th>
          <th class="r" ${nw}>${lang === "es" ? "Total con IVA" : "Total incl. VAT"}</th>
        </tr>
      </thead>
      <tbody>
        ${bodyRows}
        <tr style="background:var(--navy);color:white;">
          <td style="padding:10px 14px;"><strong style="color:white;">${lang === "es" ? "TOTALES (= liquidación general)" : "TOTALS (= general liquidation)"}</strong></td>
          <td class="r" style="color:white;white-space:nowrap;">${fmtInt(sumG("qty"))}</td>
          <td class="r" style="color:white;white-space:nowrap;">${usd(sumG("goods"))}</td>
          <td class="r" style="color:white;white-space:nowrap;"><strong>${usd(sumG("cif"))}</strong></td>
          <td class="r" style="color:white;white-space:nowrap;">${usd(sumG("dai"))}</td>
          <td class="r" style="color:white;white-space:nowrap;">${usd(sumG("ley"))}</td>
          <td class="r" style="color:white;white-space:nowrap;">${usd(sumG("customTax"))}</td>
          <td class="r" style="color:rgba(255,255,255,.7);white-space:nowrap;">${usd(sumG("iva"))}</td>
          <td class="r" style="color:white;white-space:nowrap;">${usd(groups.reduce((a, x) => a + x.dest + x.customCost, 0))}</td>
          <td class="r" style="color:var(--ice);white-space:nowrap;"><strong>${usd(sumG("sinIva"))}</strong>${crcRate > 0 ? `<br><span style="font-size:9px;color:var(--ice);opacity:.85;">${crc(sumG("sinIva"))}</span>` : ""}</td>
          <td class="r" style="color:white;white-space:nowrap;"><strong>${usd(sumG("conIva"))}</strong></td>
        </tr>
      </tbody>
    </table>`;
}

function buildLandedCostTable(n, isClient, lang) {
  const labelFob = isClient
    ? (lang === "es" ? "FOB SN" : "FOB SN")
    : (lang === "es" ? "FOB UF" : "FOB UF");
    
  const labelPerPar = isClient
    ? (lang === "es" ? "Nac/par" : "Nac/pair")
    : (lang === "es" ? "$/par" : "$/pair");

  const showFobParAndCifPar = isClient; // Only show FOB/par and CIF/par for client to match proforma exactly

  const thead = showFobParAndCifPar
    ? `<thead>
        <tr>
          <th>${lang === "es" ? "Modelo" : "Model"}</th>
          <th class="r">${lang === "es" ? "Pares" : "Pairs"}</th>
          <th class="r">${esc(labelFob)}</th>
          <th class="r cb">${lang === "es" ? "FOB/par" : "FOB/pair"}</th>
          <th class="r">CIF</th>
          <th class="r cb">${lang === "es" ? "CIF/par" : "CIF/pair"}</th>
          <th class="r">DAI</th>
          <th class="r">L6946</th>
          <th class="r">${lang === "es" ? "Aduana+Transp" : "Customs+Transp"}</th>
          <th class="r">${lang === "es" ? "Nac. s/IVA" : "Nac. excl.VAT"}</th>
          <th class="r cb">${esc(labelPerPar)}</th>
        </tr>
      </thead>`
    : `<thead>
        <tr>
          <th>${lang === "es" ? "Modelo" : "Model"}</th>
          <th class="r">${lang === "es" ? "Pares" : "Pairs"}</th>
          <th class="r">${esc(labelFob)}</th>
          <th class="r">CIF</th>
          <th class="r">DAI</th>
          <th class="r">L6946</th>
          <th class="r">${lang === "es" ? "Aduana+Transp" : "Customs+Transp"}</th>
          <th class="r">${lang === "es" ? "Nac. s/IVA" : "Nac. excl.VAT"}</th>
          <th class="r cb">${esc(labelPerPar)}</th>
        </tr>
      </thead>`;

  const rowsHtml = n.rows.map((row) => {
    const fobPar = row.qty > 0 ? row.goods / row.qty : 0;
    const cifPar = row.qty > 0 ? row.cif / row.qty : 0;
    
    return showFobParAndCifPar
      ? `<tr>
          <td class="m">${esc(row.product_label || "—")}</td>
          <td class="r">${fmtInt(row.qty)}</td>
          <td class="r">${usd(row.goods)}</td>
          <td class="r cb">${usd(fobPar)}</td>
          <td class="r">${usd(row.cif)}</td>
          <td class="r cb">${usd(cifPar)}</td>
          <td class="r">${usd(row.dai)}</td>
          <td class="r">${usd(row.ley)}</td>
          <td class="r">${usd(row.dest)}</td>
          <td class="r">${usd(row.total)}</td>
          <td class="r cb landed"><strong>${usd(row.perPar)}</strong></td>
        </tr>`
      : `<tr>
          <td class="m">${esc(row.product_label || "—")}</td>
          <td class="r">${fmtInt(row.qty)}</td>
          <td class="r">${usd(row.goods)}</td>
          <td class="r">${usd(row.cif)}</td>
          <td class="r">${usd(row.dai)}</td>
          <td class="r">${usd(row.ley)}</td>
          <td class="r">${usd(row.dest)}</td>
          <td class="r">${usd(row.total)}</td>
          <td class="r cb landed"><strong>${usd(row.perPar)}</strong></td>
        </tr>`;
  }).join("");

  const footerHtml = showFobParAndCifPar
    ? `<tr class="trow">
        <td><strong>TOTAL</strong></td>
        <td class="r"><strong>${fmtInt(n.totals.qty)}</strong></td>
        <td class="r"><strong>${usd(n.totals.goods)}</strong></td>
        <td class="r cb"><strong>&mdash;</strong></td>
        <td class="r"><strong>${usd(n.totals.cif)}</strong></td>
        <td class="r cb"><strong>&mdash;</strong></td>
        <td class="r"><strong>${usd(n.totals.dai)}</strong></td>
        <td class="r"><strong>${usd(n.totals.ley)}</strong></td>
        <td class="r"><strong>${usd(n.totals.dest)}</strong></td>
        <td class="r"><strong>${usd(n.totals.total)}</strong></td>
        <td class="r cb"><strong>&mdash;</strong></td>
      </tr>`
    : `<tr class="trow">
        <td><strong>TOTAL</strong></td>
        <td class="r"><strong>${fmtInt(n.totals.qty)}</strong></td>
        <td class="r"><strong>${usd(n.totals.goods)}</strong></td>
        <td class="r"><strong>${usd(n.totals.cif)}</strong></td>
        <td class="r"><strong>${usd(n.totals.dai)}</strong></td>
        <td class="r"><strong>${usd(n.totals.ley)}</strong></td>
        <td class="r"><strong>${usd(n.totals.dest)}</strong></td>
        <td class="r"><strong>${usd(n.totals.total)}</strong></td>
        <td class="r cb"><strong>&mdash;</strong></td>
      </tr>`;

  return `
    <table class="ct">
      ${thead}
      <tbody>
        ${rowsHtml}
        ${footerHtml}
      </tbody>
    </table>`;
}

function buildFacturarTable(n, skuGroups, lang, bucket = {}) {
  const crIva = bucket.custom_rates?.iva;
  const ivaRateFor = (ncm) => (crIva != null ? Number(crIva) : taxRatesForNcm(ncm).iva);
  const rowsHtml = n.rows.map((row, idx) => {
    const subtotal = row.qty * row.perPar;
    const iva = subtotal * ivaRateFor(row.ncm);
    const totalConIva = subtotal + iva;
    
    const sortedSizes = Object.keys(skuGroups[row.sku]?.sizes || {}).sort((a, b) => Number(a) - Number(b));
    const sizesHtml = sortedSizes.map((sz) => `${sz}:${skuGroups[row.sku].sizes[sz]}`).join(" &middot; ");

    return `
      <tr>
        <td>${idx + 1}</td>
        <td>
          <strong>${esc(row.sku)} &middot; ${esc(row.product_label || "—")}</strong>
          <div style="font-size:10px;color:var(--t2);margin-top:2px;">${sizesHtml}</div>
        </td>
        <td class="r">${fmtInt(row.qty)}</td>
        <td class="r landed"><strong>${usd4(row.perPar)}</strong></td>
        <td class="r">${usd(subtotal)}</td>
        <td class="r">${usd(iva)}</td>
        <td class="r" style="color:var(--purple);font-weight:700;">${usd(totalConIva)}</td>
      </tr>`;
  }).join("");

  const totalIva = n.rows.reduce((a, row) => {
    const subtotal = row.qty * row.perPar;
    return a + (subtotal * ivaRateFor(row.ncm));
  }, 0);
  const totalConIvaAll = n.totals.total + totalIva;

  return `
    <table class="ct">
      <thead>
        <tr>
          <th style="width: 40px;">#</th>
          <th>${lang === "es" ? "Referencia / Tallas Entregadas" : "Reference / Delivered Sizes"}</th>
          <th class="r" style="width: 80px;">${lang === "es" ? "Cant." : "Qty."}</th>
          <th class="r" style="width: 110px;">${lang === "es" ? "Costo/par nac." : "Landed unit price"}</th>
          <th class="r" style="width: 110px;">Subtotal</th>
          <th class="r" style="width: 110px;">IVA</th>
          <th class="r" style="width: 120px; color: var(--purple);">${lang === "es" ? "Total c/IVA" : "Total incl. VAT"}</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
        <tr class="trow" style="background:rgba(124,58,237,0.06);">
          <td><strong>TOTAL A FACTURAR</strong></td>
          <td></td>
          <td class="r"><strong>${fmtInt(n.totals.qty)}</strong></td>
          <td class="r"><strong>&mdash;</strong></td>
          <td class="r"><strong>${usd(n.totals.total)}</strong></td>
          <td class="r"><strong>${usd(totalIva)}</strong></td>
          <td class="r" style="color:var(--purple);font-size:14px;"><strong>${usd(totalConIvaAll)}</strong></td>
        </tr>
      </tbody>
    </table>`;
}

const LEGAL_LABEL = {
  INTERNAL: "Interno / Redistribución",
  NATIONALIZATION: "Nacionalización",
  EXPORT: "Reexportación",
  DISTRIBUTION: "Distribución",
  CONSIGNMENT: "Consignación",
};

/**
 * Resuelve el precio unitario de una línea según la audiencia elegida.
 * @param {object} l   línea del payload
 * @param {('MWT'|'CLIENT')} audience
 * @returns {number}
 */
export function unitPriceForAudience(l, audience) {
  const mwt = l.unit_price_mwt;
  const client = l.unit_price_client;
  const snapshot = l.unit_value_usd;
  if (audience === INVOICE_AUDIENCE.CLIENT) {
    return Number(client != null ? client : (snapshot != null ? snapshot : 0));
  }
  return Number(mwt != null ? mwt : (snapshot != null ? snapshot : 0));
}

/** Cantidad efectiva de la línea (recibido > despachado > planificado). */
function lineQty(l) {
  if (l.qty_received != null) return Number(l.qty_received);
  if (l.qty_dispatched != null) return Number(l.qty_dispatched);
  return Number(l.qty_planned || 0);
}

/**
 * Construye el HTML completo de la Factura / Remisión.
 * @param {object} args
 * @param {object} args.payload    respuesta de invoice_payload
 * @param {('MWT'|'CLIENT')} args.audience
 * @param {('es'|'en')} [args.lang='es']
 * @returns {string} HTML autónomo
 */
export function buildTransferInvoiceHtml({ payload, audience, lang = "es", crcRate = 0 }) {
  const t = (payload && payload.transferencia) || {};
  const oc = (payload && payload.operating_company) || {};
  const lineas = (payload && payload.lineas) || [];
  const costs = (payload && payload.cost_breakdown) || [];
  const totales = (payload && payload.totales) || {};
  const fechas = (payload && payload.fechas) || {};
  const personas = (payload && payload.personas) || {};
  const isClient = audience === INVOICE_AUDIENCE.CLIENT;

  const billTo = isClient
    ? {
        name: oc.client_name || oc.operating_company_label || "Cliente final",
        sub: lang === "es" ? "Precio de venta (cliente)" : "Sale price (client)",
        ruc: "",
      }
    : {
        name: oc.mwt_operator_name || "Muito Work Limitada",
        sub: lang === "es" ? "Precio operador (interno)" : "Operator price (internal)",
        ruc: "3-102-751710",
      };

  const priceColLabel = isClient
    ? (lang === "es" ? "Precio cliente" : "Client price")
    : (lang === "es" ? "Precio MWT" : "MWT price");

  // ── Datos de envío (AWB/BL) y empaque (Packing) desde builder-artifacts ──
  const ship = (payload && payload.shipping) || {};
  const pack = (payload && payload.packing) || {};
  const has = (v) => v != null && v !== "" && v !== [];
  const shipItems = [];
  if (has(ship.tracking)) shipItems.push([ship.doc_type ? String(ship.doc_type).toUpperCase() : "AWB/BL", ship.tracking]);
  if (has(ship.carrier)) shipItems.push(["Carrier", ship.carrier]);
  if (has(ship.transport_mode)) shipItems.push([lang === "es" ? "Transporte" : "Transport", ship.transport_mode]);
  if (has(ship.dispatch_date)) shipItems.push([lang === "es" ? "Despacho" : "Dispatched", fmtDate(ship.dispatch_date, lang)]);
  if (has(ship.arrival_date)) shipItems.push([lang === "es" ? "Arribo" : "Arrival", fmtDate(ship.arrival_date, lang)]);
  if (has(ship.consolidation)) shipItems.push([lang === "es" ? "Consolidación" : "Consolidation", ship.consolidation]);
  if (has(pack.cajas)) shipItems.push([lang === "es" ? "Cajas" : "Boxes", pack.cajas]);
  if (has(pack.peso_bruto)) shipItems.push([lang === "es" ? "Peso bruto" : "Gross wt", `${pack.peso_bruto} kg`]);
  if (has(pack.peso_neto)) shipItems.push([lang === "es" ? "Peso neto" : "Net wt", `${pack.peso_neto} kg`]);
  if (has(pack.m3)) shipItems.push(["m³", pack.m3]);
  const shippingSection = "";

  // ── Desglose por talla por SKU ──
  const skuOrderedList = [];
  const skuGroups = {};
  lineas.forEach((l) => {
    const sku = l.sku || "—";
    if (!skuGroups[sku]) {
      skuGroups[sku] = {
        sku: sku,
        product_label: l.product_label || "—",
        sizes: {},
        totalQty: 0
      };
      skuOrderedList.push(sku);
    }
    const size = l.size || "—";
    const qty = lineQty(l);
    skuGroups[sku].sizes[size] = (skuGroups[sku].sizes[size] || 0) + qty;
    skuGroups[sku].totalQty += qty;
  });

  // ── Líneas de mercadería (precio de la audiencia) ──
  let grandTotal = 0;
  let unitsTotal = 0;
  const rows = lineas.map((l, i) => {
    const qty = lineQty(l);
    const unit = unitPriceForAudience(l, audience);
    const sub = qty * unit;
    grandTotal += sub;
    unitsTotal += qty;
    return `
      <tr>
        <td>${i + 1}</td>
        <td class="m">${esc(l.proforma_codigo || l.expediente_codigo || "—")}</td>
        <td class="m">${esc(l.sku || "—")}</td>
        <td class="m">${esc(l.ncm || "—")}</td>
        <td>${esc(l.product_label || "—")}</td>
        <td class="r">${esc(l.size || "—")}</td>
        <td class="r">${fmtInt(qty)}</td>
        <td class="r">${usd4(unit)}</td>
        <td class="r">${usd(sub)}</td>
      </tr>`;
  }).join("");

  // ── Costos registrados (cost_lines reales) ──
  const costRows = costs.map((c) => `
      <tr>
        <td><span class="kind">${esc(c.kind || "—")}</span></td>
        <td>${esc(c.label || "—")}</td>
        <td class="r">${usd(c.amount)}</td>
        <td class="m">${esc(c.currency || "USD")}</td>
        <td class="r">${Number(c.fx_to_usd || 1).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</td>
        <td class="r"><strong>${usd(c.amount_usd)}</strong></td>
      </tr>`).join("");
  const costsTotal = costs.reduce((a, c) => a + Number(c.amount_usd || 0), 0);

  // ── Nacionalización · impuestos dinámicos por NCM ──
  // Flete + seguro y Aduana + transporte se prorratean por cantidad (pares) → CIF y Costos locales por línea;
  // cada línea aplica las tasas de SU NCM (DAI + Ley 6946 sobre CIF, IVA sobre
  // CIF+DAI+Ley6946). Se computan dos bases:
  //   · "real"  = precio cliente (valor declarado en aduana)
  //   · "aprox" = costo Muito Work Limitada (referencia interna, CEO-ONLY)
  const kindUp = (c) => String(c.kind || "").toUpperCase();
  const freight = costs.reduce((a, c) => a + (KIND_FREIGHT.has(kindUp(c)) ? Number(c.amount_usd || 0) : 0), 0);
  const insurance = costs.reduce((a, c) => a + (KIND_INSURANCE.has(kindUp(c)) ? Number(c.amount_usd || 0) : 0), 0);
  const extraTotal = freight + insurance;
  const destTotal = costs.reduce((a, c) => {
    const k = kindUp(c);
    if (!KIND_FREIGHT.has(k) && !KIND_INSURANCE.has(k)) {
      return a + Number(c.amount_usd || 0);
    }
    return a;
  }, 0);
  const unitMwt = (l) => Number(l.unit_price_mwt != null ? l.unit_price_mwt : (l.unit_value_usd || 0));
  const unitClient = (l) => Number(l.unit_price_client != null ? l.unit_price_client : (l.unit_value_usd || 0));
  const computeNac = (priceFn, bucket = {}) => {
    const lineOverrides = bucket.line_overrides || {};
    const cr = bucket.custom_rates || {};
    const groups = new Map();
    
    // Calculate total quantity across all lines first to do proration
    const qtyTotalAll = lineas.reduce((a, l) => a + lineQty(l), 0) || 0;

    lineas.forEach((l) => {
      const sku = l.sku || "—";
      const g = groups.get(sku) || {
        sku, ncm: l.ncm || "—", product_label: l.product_label || "", qty: 0, goods: 0,
        extra: 0, cif: 0, dai: 0, ley: 0, dest: 0, iva: 0, total: 0,
      };

      const qty = lineQty(l);
      const lt = qty * priceFn(l);
      const extra = qtyTotalAll > 0 ? extraTotal * (qty / qtyTotalAll) : 0;
      const dest = qtyTotalAll > 0 ? destTotal * (qty / qtyTotalAll) : 0;

      const r = taxRatesForNcm(l.ncm);
      // DAI: tasa VIVA del NCM (l.dai_rate, resuelta en backend por origen→
      // destino). Sólo un override EXPLÍCITO del operador (dai_overridden) la
      // reemplaza. Antes usaba cr.dai stale o el hardcode 0.14 → mostraba 14%.
      const _liveDai = (l.dai_rate != null) ? Number(l.dai_rate) : r.dai;
      const daiRate = (cr.dai_overridden === true && cr.dai != null) ? Number(cr.dai) : _liveDai;
      const leyRate = cr.ley != null ? Number(cr.ley) : r.ley_6946;
      const ivaRate = cr.iva != null ? Number(cr.iva) : r.iva;

      const override = lineOverrides[l.id] || {};

      const cif = override.cif !== undefined ? Number(override.cif) : (lt + extra);
      const dai = override.dai !== undefined ? Number(override.dai) : (cif * daiRate);
      const ley = override.ley !== undefined ? Number(override.ley) : (cif * leyRate);
      const itemDest = override.dest !== undefined ? Number(override.dest) : dest;
      // IVA acreditable: base CIF + DAI + Ley 6946 (igual que el panel).
      const iva = (cif + dai + ley) * ivaRate;

      let itemTotal = cif + dai + ley + itemDest;
      if (override.landed_total_usd !== undefined) {
        itemTotal = Number(override.landed_total_usd);
      } else if (override.landed_unit_usd !== undefined) {
        itemTotal = Number(override.landed_unit_usd) * qty;
      }

      g.qty += qty;
      g.goods += lt;
      g.extra += extra;
      g.cif += cif;
      g.dai += dai;
      g.ley += ley;
      g.dest += itemDest;
      g.iva += iva;
      g.total += itemTotal;

      if ((!g.ncm || g.ncm === "—") && l.ncm) g.ncm = l.ncm;
      groups.set(sku, g);
    });

    const rows = Array.from(groups.values()).map((g) => {
      const perPar = g.qty > 0 ? g.total / g.qty : 0;
      return {
        sku: g.sku, ncm: g.ncm, product_label: g.product_label,
        qty: g.qty, goods: g.goods, extra: g.extra, cif: g.cif,
        dai: g.dai, ley: g.ley, dest: g.dest, iva: g.iva, total: g.total, perPar,
      };
    });

    const sum = (k) => rows.reduce((a, x) => a + x[k], 0);
    const totalAll = sum("total");
    const qtyAll = sum("qty");
    return {
      rows,
      totals: {
        goods: sum("goods"), extra: sum("extra"), cif: sum("cif"),
        dai: sum("dai"), ley: sum("ley"), dest: sum("dest"), iva: sum("iva"),
        total: totalAll, qty: qtyAll, perPar: qtyAll > 0 ? totalAll / qtyAll : 0,
      },
    };
  };
  // Cada base usa los overrides/tasas guardados en SU vista:
  //   · cliente (precio declarado)  → context_data.views.CLIENT
  //   · MWT (costo interno)         → context_data.views.MWT
  const nacReal = computeNac(unitClient, viewBucket(t.context_data, INVOICE_AUDIENCE.CLIENT));
  const nacMwt = computeNac(unitMwt, viewBucket(t.context_data, INVOICE_AUDIENCE.MWT));
  // El desglose usa la base de la AUDIENCIA del documento: la factura MWT
  // muestra valores a precio MWT (consistente con "Precio MWT"); la del
  // cliente, a precio cliente.
  const nacAud = isClient ? nacReal : nacMwt;
  const baseTag = isClient
    ? (lang === "es" ? "base cliente" : "client base")
    : (lang === "es" ? "base MWT (aprox.)" : "MWT base (approx.)");

  // Resolve dynamic metadata from resolved shipping/packing
  const refPO = payload.oc_codigo || payload.proforma_codigo || t.oc_codigo || "—";
  
  // Destinatario / Cliente final: name of the client assigned to the expediente
  const clientName = oc.client_name || oc.operating_company_label || billTo.name;
  
  const awbVal = ship.tracking || "—";
  const carrierVal = ship.carrier || "—";
  const routeVal = ship.route || ship.origin_destination || (ship.origin_country && ship.destination_country ? `${ship.origin_country}→${ship.destination_country}` : "—");
  
  // First line NCM or fallback
  const firstNcm = lineas.length > 0 ? (lineas[0].ncm || "6403.99.90") : "6403.99.90";
  const cajasVal = pack.cajas || "—";
  const pesoBrutoVal = pack.peso_bruto || "—";
  const pesoNetoVal = pack.peso_neto || "—";
  
  let m3Val = pack.m3;
  if (!m3Val && unitsTotal > 0) {
    m3Val = (unitsTotal * 0.007238).toFixed(3);
  }
  const m3Str = m3Val ? `${m3Val} m³` : "—";
  
  const dueVal = ship.due || "—";

  const nacRows = nacAud.rows.map((x, i) => `
      <tr>
        <td>${i + 1}</td>
        <td class="m">${esc(x.sku || "—")}</td>
        <td class="m">${esc(x.ncm)}</td>
        <td class="r">${fmtInt(x.qty)}</td>
        <td class="r">${usd(x.goods)}</td>
        <td class="r">${usd(x.extra)}</td>
        <td class="r"><strong>${usd(x.cif)}</strong></td>
        <td class="r">${usd(x.dai)}</td>
        <td class="r">${usd(x.ley)}</td>
        <td class="r">${usd(x.dest)}</td>
        <td class="r">${usd(x.iva)}</td>
        <td class="r"><strong>${usd(x.total)}</strong></td>
        <td class="r landed"><strong>${usd4(x.perPar)}</strong></td>
      </tr>`).join("");
  const nacCard = (title, sub, n) => `
    <div class="card">
      <div class="card-h"><h3>${esc(title)}</h3></div>
      <div class="card-b">
        <div class="sr"><span class="k">${esc(sub)}</span><span class="v"></span></div>
        <div class="sr"><span class="k">${lang === "es" ? "Suma mercadería" : "Goods total"}</span><span class="v">${usd(n.totals.goods)}</span></div>
        <div class="sr"><span class="k">${lang === "es" ? "Flete + seguro" : "Freight + insurance"}</span><span class="v">${usd(n.totals.extra)}</span></div>
        <div class="sr" style="border-top:2px solid var(--navy);"><span class="k" style="font-weight:700;">CIF</span><span class="v" style="font-size:14px;">${usd(n.totals.cif)}</span></div>
        <div class="sr"><span class="k">DAI</span><span class="v">${usd(n.totals.dai)}</span></div>
        <div class="sr"><span class="k">Ley 6946</span><span class="v">${usd(n.totals.ley)}</span></div>
        <div class="sr"><span class="k">${lang === "es" ? "Aduana + transporte" : "Customs + transport"}</span><span class="v">${usd(n.totals.dest)}</span></div>
        <div class="sr"><span class="k" style="color:var(--t3);">${lang === "es" ? "IVA (acreditable · no suma)" : "VAT (creditable · excluded)"}</span><span class="v" style="color:var(--t3);">${usd(n.totals.iva)}</span></div>
        <div class="sr" style="border-top:2px solid var(--mint);"><span class="k" style="font-weight:700;">${lang === "es" ? "Total nacionalizado (sin IVA)" : "Nationalized total (excl. VAT)"}</span><span class="v" style="color:var(--ok);">${usd(n.totals.total)}</span></div>
        <div class="sr"><span class="k" style="font-weight:700;">${lang === "es" ? "Costo por par (sin IVA)" : "Cost per pair (excl. VAT)"}</span><span class="v" style="color:var(--ok);font-weight:700;">${usd4(n.totals.perPar)}</span></div>
      </div>
    </div>`;

  const cifTitle = isClient
    ? (lang === "es" ? "SONDEL · Nacionalización DDP (referencia)" : "SONDEL · DDP Nationalization (reference)")
    : (lang === "es" ? "MWT · DDP camino real (contable)" : "MWT · DDP contable (real)");
  const badgeClass = isClient ? "bg-sondel" : "bg-ceo";
  const badgeLabel = isClient
    ? (lang === "es" ? "REPORTE CLIENTE" : "CLIENT REPORT")
    : (lang === "es" ? "CEO-ONLY · INTERNAL" : "CEO-ONLY · INTERNAL");
    
  const metaHtml = `
    <strong>${lang === "es" ? "Ref. PO" : "Ref. PO"}:</strong> ${esc(refPO)} &middot; 
    <strong>${lang === "es" ? "Cliente" : "Client"}:</strong> ${esc(clientName)} &middot; 
    <strong>AWB:</strong> ${esc(awbVal)} &middot; ${esc(carrierVal)} &middot; ${esc(routeVal)}<br>
    <strong>NCM:</strong> ${esc(firstNcm)} &middot; ${cajasVal} ${lang === "es" ? "cajas" : "boxes"} &middot; 
    ${pesoBrutoVal} kg ${lang === "es" ? "bruto" : "gross"} / ${pesoNetoVal} ${lang === "es" ? "neto" : "net"} &middot; 
    ${m3Str} &middot; DU-E ${esc(dueVal)}
  `;

  const noteBlock = isClient
    ? `<div style="padding:10px 14px;background:var(--raised);border-radius:8px;font-size:11px;color:var(--t2);line-height:1.7;margin-bottom:16px;">
        <strong style="color:var(--navy);">${lang === "es" ? "Qué muestra:" : "What this shows:"}</strong> 
        ${lang === "es"
          ? `lo que le costaría a ${esc(clientName)} <strong>nacionalizar por su cuenta</strong> declarando al precio de la orden (SN), por línea. Flete ${usd(freight)}, seguro ${usd(insurance)}, costos de aduana y transporte de ${usd(destTotal)} prorrateados por pares. <strong>IVA 13% se muestra pero no suma</strong> (crédito fiscal acreditable). Comparado contra el precio al que MWT se lo entrega.`
          : `what it would cost ${esc(clientName)} to <strong>nationalize on their own</strong> declaring at order price (SN), line by line. Freight ${usd(freight)}, insurance ${usd(insurance)}, customs and transport costs of ${usd(destTotal)} prorrated by pairs. <strong>13% VAT is shown but not added</strong> (creditable tax credit).`}
      </div>`
    : ``;

  const bottomNote = isClient
    ? `<div style="padding:12px 16px;background:var(--mint-s);border:1px solid var(--mint);border-radius:8px;font-size:11px;color:var(--t1);line-height:1.7;margin-bottom:16px;">
        <strong style="color:var(--navy);">${lang === "es" ? "MWT entrega DDP en bodega:" : "MWT delivers DDP to warehouse:"}</strong> 
        ${lang === "es"
          ? `nacionalizar por cuenta propia tendría un costo de <strong>${usd(nacReal.totals.total)} sin IVA</strong> (ver costo por par de cada línea arriba) — DAI, Ley 6946, gestión aduanal y transporte incluidos. Comprando a MWT ese proceso y su costo quedan absorbidos. IVA acreditable como crédito fiscal.`
          : `nationalizing on your own would have a cost of <strong>${usd(nacReal.totals.total)} excl. VAT</strong> (see cost per pair for each line above) — DAI, Law 6946, customs management, and transport included. Buying from MWT absorbs this process and its cost. VAT is creditable.`}
      </div>`
    : ``;

  // R3 POL_VISIBILIDAD: el CIF/base MWT (costo interno) NO se muestra al cliente.
  const cifSection = oc.operated_by_mwt ? `
  <div style="margin-top: 24px; break-inside: avoid; page-break-inside: avoid;">
    <div class="head" style="margin-bottom: 12px; border-top: 4px solid ${isClient ? "var(--purple)" : "var(--navy)"};">
      <div>
        <h2 style="font-size: 18px; font-weight: 800; color: var(--navy); letter-spacing: -.4px;">${esc(cifTitle)}</h2>
      </div>
    </div>
    
    <div class="sect">
      <div class="sect-h">
        <h3>${isClient 
          ? (lang === "es" ? `Liquidación detallada — ${esc(clientName)} nacionaliza al precio de la orden (DUA referencial)` : `Detailed liquidation — ${esc(clientName)} nationalizes at order price (referential DUA)`)
          : (lang === "es" ? "Liquidación detallada — MWT nacionaliza al precio Marluvas (UF)" : "Detailed liquidation — MWT nationalizes at Marluvas price (UF)")
        }</h3>
      </div>
      <div class="card-b" style="padding:0; overflow-x: auto;">
        ${buildDetailedLiquidationTable(nacAud, costs, isClient, lang, t, viewBucket(t.context_data, audience), crcRate)}
      </div>
    </div>

    <div class="sect">
      <div class="sect-h">
        <h3>${lang === "es" ? "Liquidación por NCM — impuestos del subconjunto" : "Liquidation by NCM — subset taxes"}</h3>
        <div style="font-size:9.5px;color:var(--t3);margin-top:3px;letter-spacing:.3px;">${lang === "es" ? "DAI del grupo · IVA sobre CIF+DAI+Ley del grupo · timbres y gastos prorrateados por pares" : "Group DAI · VAT on group CIF+DAI+Law · stamps and charges prorated by pairs"}</div>
      </div>
      <div class="card-b" style="padding:0; overflow-x: auto;">
        ${buildLiquidationBreakdownTable(nacAud, viewBucket(t.context_data, audience), lang, crcRate, "NCM")}
      </div>
    </div>

    <div class="sect">
      <div class="sect-h">
        <h3>${lang === "es" ? "Liquidación por SKU — impuestos del subconjunto" : "Liquidation by SKU — subset taxes"}</h3>
        <div style="font-size:9.5px;color:var(--t3);margin-top:3px;letter-spacing:.3px;">${lang === "es" ? "DAI del grupo · IVA sobre CIF+DAI+Ley del grupo · timbres y gastos prorrateados por pares" : "Group DAI · VAT on group CIF+DAI+Law · stamps and charges prorated by pairs"}</div>
      </div>
      <div class="card-b" style="padding:0; overflow-x: auto;">
        ${buildLiquidationBreakdownTable(nacAud, viewBucket(t.context_data, audience), lang, crcRate, "SKU")}
      </div>
    </div>

    <div class="sect">
      <div class="sect-h">
        <h3>${isClient
          ? (lang === "es" ? `Costo nacionalizado por línea (base precio orden SN, sin IVA)` : `Nationalized cost by line (SN base, excl. VAT)`)
          : (lang === "es" ? "Costo nacionalizado por línea (base UF, sin IVA)" : "Nationalized cost by line (UF base, excl. VAT)")
        }</h3>
      </div>
      <div class="card-b" style="padding:0; overflow-x: auto;">
        ${buildLandedCostTable(nacAud, isClient, lang)}
      </div>
    </div>

    <div class="sect">
      <div class="sect-h">
        <h3>${lang === "es" ? "Líneas a facturar — precio nacionalizado + IVA (tallas entregadas)" : "Lines to invoice — landed cost + VAT (delivered sizes)"}</h3>
      </div>
      <div class="card-b" style="padding:0; overflow-x: auto;">
        ${buildFacturarTable(nacAud, skuGroups, lang, viewBucket(t.context_data, audience))}
      </div>
    </div>
  </div>` : "";

  const breakdownTitle = lang === "es" ? "Desglose por talla" : "Size breakdown";

  const breakdownGroupsHtml = skuOrderedList.map((sku) => {
    const group = skuGroups[sku];
    const sortedSizes = Object.keys(group.sizes).sort((a, b) => Number(a) - Number(b));
    const pillsHtml = sortedSizes.map((sz) => {
      const qty = group.sizes[sz];
      return `<div class="pill"><span class="s">${esc(sz)}</span><span class="q">${fmtInt(qty)}</span></div>`;
    }).join("");

    return `
      <div class="sku-size-group" style="margin-bottom: 16px; break-inside: avoid; page-break-inside: avoid;">
        <div style="font-size: 11px; font-weight: 700; color: var(--t2); text-transform: uppercase; margin-bottom: 8px; letter-spacing: .5px;">
          ${esc(group.sku)} &middot; ${esc(group.product_label)} &middot; ${fmtInt(group.totalQty)} ${lang === "es" ? "PARES" : "PAIRS"}
        </div>
        <div class="pills">
          ${pillsHtml}
        </div>
      </div>`;
  }).join("");

  // doc_kind_label permite que un caller (ej. factura comercial de expediente)
  // fuerce el rótulo del documento; si no, se infiere por audiencia.
  const docKind = (payload && payload.doc_kind_label)
    ? payload.doc_kind_label
    : (isClient
        ? (lang === "es" ? "FACTURA" : "INVOICE")
        : (lang === "es" ? "REMISIÓN INTERNA" : "INTERNAL WAYBILL"));
  const title = `MWT — ${docKind} ${esc(t.codigo || "")}`;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<link rel="icon" type="image/png" href="${MWT_FAVICON_DATA_URI}">
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{
  --navy:#013A57;--navy-deep:#06283A;--teal:#13B98A;--mint:#75CBB3;--mint-s:#E9F6F1;
  --ice:#EAF4FB;--bg:#F4F6F9;--srf:#FFFFFF;--raised:#F6F8FB;--brd:#ECEFF3;
  --brd2:#DCE2EA;--t1:#0C1B26;--t2:#5B6B78;--t3:#9AA8B4;--ok:#0E9F6E;
  --info:#0369A1;--crit:#DC2626;--warn:#B45309;--purple:#7C3AED;
  --sh:0 1px 2px rgba(13,38,59,.04),0 6px 22px rgba(13,38,59,.05);
  --sh-sm:0 1px 2px rgba(13,38,59,.05);
}
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Plus Jakarta Sans',system-ui,sans-serif;background:var(--bg);color:var(--t1);line-height:1.55;-webkit-font-smoothing:antialiased;padding:32px 24px;}
.doc{max-width:1200px;margin:0 auto;}
.head{position:relative;overflow:hidden;background:var(--srf);border:1px solid var(--brd);border-radius:18px;padding:30px 32px;margin-bottom:18px;display:flex;justify-content:space-between;align-items:flex-start;box-shadow:var(--sh);}
.head::before{content:"";position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,var(--navy) 0%,var(--teal) 100%);}
.brand .logo-img{height:34px;width:auto;display:block;}
.brand .sub{font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:1.4px;margin-top:12px;font-weight:600;}
.head .right{text-align:right;}
.kind{font-size:10px;font-weight:800;color:var(--teal);letter-spacing:2px;text-transform:uppercase;}
.folio{font-size:25px;font-weight:800;color:var(--navy);font-variant-numeric:tabular-nums;letter-spacing:-.5px;margin:4px 0 6px;}
.head .meta{font-size:11px;color:var(--t2);line-height:1.8;}
.aud-pill{display:inline-block;margin-top:10px;padding:5px 12px;border-radius:999px;font-size:10px;font-weight:700;letter-spacing:.4px;border:1px solid transparent;}
.aud-mwt{background:var(--mint-s);color:#0B7A5C;border-color:color-mix(in oklab,var(--teal) 28%,transparent);}
.aud-client{background:var(--ice);color:var(--info);border-color:color-mix(in oklab,var(--info) 22%,transparent);}
.badge{display:inline-flex;padding:4px 10px;border-radius:999px;font-size:10px;font-weight:700;}
.bg-ceo{background:rgba(220,38,38,0.08);color:var(--crit);}
.bg-sondel{background:rgba(124,58,237,0.08);color:var(--purple);}
table.ct.dense{font-size:11px;}
table.ct.dense thead th, table.ct.dense tbody td{padding:7px 8px;}
.dual{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:18px;}
.card{background:var(--srf);border:1px solid var(--brd);border-radius:16px;overflow:hidden;box-shadow:var(--sh-sm);}
.card-h{padding:13px 20px;border-bottom:1px solid var(--brd);background:var(--raised);}
.card-h h3{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:var(--t2);}
.card-b{padding:16px 20px;}
.sr{display:flex;justify-content:space-between;gap:14px;padding:8px 0;border-bottom:1px solid var(--brd);font-size:12px;}
.sr:last-child{border-bottom:none;}
.sr .k{color:var(--t2);}
.sr .v{font-weight:700;font-variant-numeric:tabular-nums;color:var(--t1);text-align:right;}
.route{display:flex;align-items:center;gap:10px;margin-top:4px;}
.route .node{font-weight:700;color:var(--navy);}
.route .arrow{color:var(--teal);font-weight:700;font-size:18px;}
.sect{background:var(--srf);border:1px solid var(--brd);border-radius:16px;overflow:hidden;margin-bottom:18px;box-shadow:var(--sh-sm);}
.sect-h{padding:14px 20px;border-bottom:1px solid var(--brd);background:var(--raised);}
.sect-h h3{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:var(--navy);}
table.ct{width:100%;border-collapse:collapse;font-size:12px;}
table.ct thead th{padding:11px 14px;text-align:left;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--t3);background:var(--srf);border-bottom:1px solid var(--brd2);}
table.ct thead th.r{text-align:right;}
table.ct tbody td{padding:10px 14px;border-bottom:1px solid var(--brd);}
table.ct tbody tr:last-child td{border-bottom:none;}
table.ct tbody td.r{text-align:right;font-variant-numeric:tabular-nums;}
table.ct tbody td.m{font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--t2);}
table.ct tbody td.cshare{color:var(--warn);}
table.ct tbody td.landed{color:var(--ok)!important;font-weight:700;}
table.ct .cb{background:color-mix(in oklab,var(--navy) 3%,transparent);}
table.ct .rb{background:color-mix(in oklab,var(--teal) 4%,transparent);}
table.ct .kind{display:inline-block;padding:2px 8px;border-radius:999px;background:var(--mint-s);color:#0B7A5C;font-size:10px;font-weight:700;font-family:'JetBrains Mono',monospace;}
table.ct .trow{background:var(--raised);font-weight:700;}
table.ct .trow td{border-top:1.5px solid var(--brd2);border-bottom:1px solid var(--brd);color:var(--navy);font-variant-numeric:tabular-nums;}
.pills{display:flex;flex-wrap:wrap;gap:6px;padding:4px 0;}
.pill{display:inline-flex;flex-direction:column;align-items:center;padding:6px 11px;border:1px solid var(--brd);border-radius:10px;min-width:50px;background:var(--raised);}
.pill .s{font-size:9px;color:var(--t3);font-weight:600;}
.pill .q{font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;color:var(--navy);}
.tot{display:flex;justify-content:flex-end;margin-bottom:18px;}
.tot-card{width:360px;border:1px solid var(--brd);border-radius:16px;padding:18px 22px;background:var(--srf);box-shadow:var(--sh);position:relative;overflow:hidden;}
.tot-card::before{content:"";position:absolute;top:0;left:0;bottom:0;width:4px;background:linear-gradient(180deg,var(--navy),var(--teal));}
.tot-row{display:flex;justify-content:space-between;align-items:baseline;padding:6px 0;font-size:12px;color:var(--t2);}
.tot-row strong{color:var(--navy);font-variant-numeric:tabular-nums;}
.tot-final{padding-top:12px;margin-top:8px;border-top:1px solid var(--brd);display:flex;justify-content:space-between;align-items:baseline;}
.tot-final span{font-size:12px;font-weight:700;color:var(--navy);text-transform:uppercase;letter-spacing:.6px;}
.tot-final strong{font-size:22px;color:var(--ok);font-variant-numeric:tabular-nums;letter-spacing:-.5px;}
.notes-card{background:var(--raised);border:1px solid var(--brd);border-radius:14px;padding:16px 20px;font-size:11px;color:var(--t2);line-height:1.75;margin-bottom:18px;}
.notes-card strong{color:var(--t1);}
.sign{display:grid;grid-template-columns:1fr 1fr 1fr;gap:28px;margin:32px 0 16px;}
.sig{text-align:center;}
.sig .line{border-top:1.5px solid var(--brd2);margin-bottom:8px;height:48px;}
.sig .lbl{font-size:9px;color:var(--t3);text-transform:uppercase;letter-spacing:.8px;}
.sig .nm{font-size:12px;font-weight:700;color:var(--navy);margin-top:2px;}
.foot{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;font-size:9px;color:var(--t3);border-top:1px solid var(--brd);padding-top:14px;margin-top:10px;}
.foot code{font-family:'JetBrains Mono',monospace;}
.actions{display:flex;gap:10px;padding:18px 0;justify-content:flex-end;}
.btn{padding:11px 22px;border-radius:10px;font-size:12px;font-weight:700;border:none;cursor:pointer;transition:transform .12s ease,box-shadow .12s ease,background .12s ease;}
.btn-p{background:var(--navy);color:#fff;box-shadow:0 2px 10px rgba(1,58,87,.22);}
.btn-p:hover{background:var(--navy-deep);transform:translateY(-1px);box-shadow:0 6px 18px rgba(1,58,87,.28);}
.btn-o{background:var(--srf);border:1.5px solid var(--brd2);color:var(--t1);}
.btn-o:hover{border-color:var(--navy);color:var(--navy);}
@media print{
  *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important;}
  @page{margin:10mm 12mm;size:letter;}
  body{background:#fff!important;padding:0;font-size:10.5px;}
  .actions{display:none!important;}
  .card,.sect,.head,.notes-card,.tot-card{break-inside:avoid;page-break-inside:avoid;box-shadow:none!important;border:1px solid #d9dee5!important;}
  table.ct thead{display:table-header-group;}
  table.ct tr{break-inside:avoid;page-break-inside:avoid;}
  table.ct thead th{background:#f3f6f9!important;}
}
</style>
</head>
<body>
<div class="doc">

  <div class="head">
    <div class="brand">
      <img class="logo-img" src="${MWT_LOGO_DATA_URI}" alt="MWT ONE" />
      <div class="sub">Muito Work · Worldwide Trade</div>
      ${(has(ship.tracking) || has(ship.carrier) || has(pack.cajas)) ? `
      <div style="margin-top: 14px; font-size: 11px; color: var(--t2); border-top: 1px dashed var(--brd); padding-top: 10px; display: flex; flex-direction: column; gap: 4px; line-height: 1.5; text-align: left;">
        ${has(ship.tracking) ? `<div><strong>AWB:</strong> <span style="font-family:'JetBrains Mono';font-size:11px;">${esc(ship.tracking)}</span></div>` : ""}
        ${has(ship.carrier) ? `<div><strong>Carrier:</strong> ${esc(ship.carrier)}</div>` : ""}
        <div style="display: flex; gap: 10px; margin-top: 2px; font-size: 10px; color: var(--t2);">
          ${has(pack.cajas) ? `<span><strong>Cajas:</strong> ${esc(pack.cajas)}</span>` : ""}
          ${has(pack.peso_bruto) ? `<span><strong>P. bruto:</strong> ${esc(pack.peso_bruto)} kg</span>` : ""}
          ${has(pack.peso_neto) ? `<span><strong>P. neto:</strong> ${esc(pack.peso_neto)} kg</span>` : ""}
        </div>
      </div>
      ` : ""}
    </div>
    <div class="right">
      <div class="kind">${esc(docKind)}</div>
      <div class="folio">${esc(t.codigo || "—")}</div>
      <div class="meta">
        ${lang === "es" ? "Emisión" : "Issued"}: <strong>${esc(fmtDate(fechas.dispatched_at || fechas.created_at, lang))}</strong><br>
        ${lang === "es" ? "Motivo" : "Reason"}: <strong>${esc(LEGAL_LABEL[t.legal_context] || t.legal_context || "—")}</strong>${
          (isClient ? (payload.oc_codigo || payload.proforma_codigo) : (payload.proforma_codigo || payload.oc_codigo))
            ? `<br>${isClient ? "OC" : "Proforma"}: <strong>${esc(isClient ? (payload.oc_codigo || payload.proforma_codigo) : (payload.proforma_codigo || payload.oc_codigo))}</strong>`
            : ""}
      </div>
      <div class="aud-pill ${isClient ? "aud-client" : "aud-mwt"}">
        ${lang === "es" ? "Facturado a" : "Billed to"}: ${esc(billTo.name)}
      </div>
    </div>
  </div>

  <div class="dual">
    <div class="card">
      <div class="card-h"><h3>${lang === "es" ? "Emisor" : "Issuer"}</h3></div>
      <div class="card-b">
        <div class="sr"><span class="k">${lang === "es" ? "Empresa" : "Company"}</span><span class="v">Muito Work Limitada</span></div>
        <div class="sr"><span class="k">${lang === "es" ? "Cédula Jurídica" : "Tax ID"}</span><span class="v" style="font-family:'JetBrains Mono';font-size:11px;">3-102-751710</span></div>
        <div class="sr"><span class="k">${lang === "es" ? "Origen" : "Origin"}</span><span class="v">${esc((payload.origen && payload.origen.label) || "—")}</span></div>
        <div class="sr"><span class="k">${lang === "es" ? "Despachado" : "Dispatched"}</span><span class="v" style="font-size:11px;">${esc(fmtDate(fechas.dispatched_at, lang))}</span></div>
      </div>
    </div>
    <div class="card">
      <div class="card-h"><h3>${lang === "es" ? "Facturado a" : "Bill To"}</h3></div>
      <div class="card-b">
        <div class="sr"><span class="k">${lang === "es" ? "Destinatario" : "Recipient"}</span><span class="v">${esc(billTo.name)}</span></div>
        ${billTo.ruc ? `<div class="sr"><span class="k">${lang === "es" ? "Cédula Jurídica" : "Tax ID"}</span><span class="v" style="font-family:'JetBrains Mono';font-size:11px;">${esc(billTo.ruc)}</span></div>` : ""}
        <div class="sr"><span class="k">${lang === "es" ? "Base de precio" : "Price basis"}</span><span class="v" style="font-size:11px;">${esc(billTo.sub)}</span></div>
        <div class="sr"><span class="k">${lang === "es" ? "Destino" : "Destination"}</span><span class="v">${esc((payload.destino && payload.destino.label) || "—")}</span></div>
        <div class="sr"><span class="k">${lang === "es" ? "Recibido" : "Received"}</span><span class="v" style="font-size:11px;">${esc(fmtDate(fechas.received_at, lang))}</span></div>
      </div>
    </div>
  </div>

  ${shippingSection}

  ${cifSection}

  ${breakdownGroupsHtml ? `
  <div class="sect" style="break-inside: avoid; page-break-inside: avoid;">
    <div class="sect-h"><h3>${esc(breakdownTitle)}</h3></div>
    <div class="card-b" style="padding: 16px 18px 4px 18px;">${breakdownGroupsHtml}</div>
  </div>` : ""}

  <div class="notes-card">
    <strong>${lang === "es" ? "Documento" : "Document"}:</strong>
    ${isClient
      ? (lang === "es"
          ? "Factura emitida al cliente final con precio de venta. Valores en USD, sin IVA (crédito fiscal acreditable)."
          : "Invoice issued to end client at sale price. Values in USD, tax excluded.")
      : (lang === "es"
          ? "Remisión interna a nombre de Muito Work Limitada (operador) a precio interno. Valores en USD, sin IVA."
          : "Internal waybill to Muito Work Limitada (operator) at internal price. Values in USD, tax excluded.")}
    <br>
    <strong>${lang === "es" ? "Movimiento" : "Transfer"}:</strong> ${esc(t.codigo || "")} ·
    <strong>${lang === "es" ? "Estado" : "Status"}:</strong> ${esc(t.estado || "")}
  </div>

  <div class="sign">
    <div class="sig"><div class="line"></div><div class="lbl">${lang === "es" ? "Origen (despacha)" : "Origin (ships)"}</div><div class="nm">${esc(personas.created_by_name || "—")}</div></div>
    <div class="sig"><div class="line"></div><div class="lbl">${lang === "es" ? "Destino (recibe)" : "Destination (receives)"}</div><div class="nm">${esc(personas.received_by_name || "—")}</div></div>
    <div class="sig"><div class="line"></div><div class="lbl">${lang === "es" ? "Autoriza" : "Authorizes"}</div><div class="nm">${esc(personas.reconciled_by_name || personas.approved_by_name || "—")}</div></div>
  </div>

  <div class="actions">
    <button class="btn btn-o" onclick="window.close()">${lang === "es" ? "Cerrar" : "Close"}</button>
    <button class="btn btn-p" onclick="window.print()">${lang === "es" ? "Imprimir / Guardar PDF" : "Print / Save PDF"}</button>
  </div>

  <div class="foot">
    <span>UUID: <code>${esc(t.id || "")}</code></span>
    <span>·</span>
    <span>${lang === "es" ? "Generado" : "Generated"}: ${esc(new Date().toLocaleString())}</span>
    <span>·</span>
    <span>MWT.ONE — ${isClient ? "CLIENT" : "INTERNAL/CEO-ONLY"}</span>
  </div>

</div>
</body>
</html>`;
}

/**
 * Dispara la descarga del HTML como archivo .html.
 * @param {string} html
 * @param {string} filename
 */
export function downloadTransferInvoice(html, filename) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Nombre de archivo sugerido para la descarga.
 * @param {object} payload
 * @param {('MWT'|'CLIENT')} audience
 */
export function invoiceFilename(payload, audience) {
  const t = (payload && payload.transferencia) || {};
  const proforma = (payload && payload.proforma_codigo) || t.proforma_codigo || "";
  const oc = (payload && payload.oc_codigo) || t.oc_codigo || "";
  const isClient = audience === INVOICE_AUDIENCE.CLIENT;
  // MWT → número de proforma; Cliente → número de OC. Con fallbacks.
  const ref = isClient
    ? (oc || proforma || t.codigo || "FACTURA")
    : (proforma || oc || t.codigo || "FACTURA");
  const tag = isClient ? "CLIENTE" : "MWT";
  const safe = String(ref).replace(/[^A-Za-z0-9_-]+/g, "_");
  return `Factura_${safe}_${tag}.html`;
}
