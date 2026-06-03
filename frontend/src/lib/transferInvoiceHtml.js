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

// Clasificación de cost_lines que entran al CIF (flete + seguro).
const KIND_FREIGHT = new Set(["FLETE", "FREIGHT", "CONSOLIDACION"]);
const KIND_INSURANCE = new Set(["SEGURO", "INSURANCE"]);

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

function buildDetailedLiquidationTable(n, costs, isClient, lang) {
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
          <td style="font-size:10px;color:var(--t2);">${n.totals.qty} pares</td>
        </tr>
        <tr>
          <td>2</td>
          <td>${lang === "es" ? "Flete aéreo internacional" : "International air freight"}</td>
          <td class="m">AWB / BL</td>
          <td class="r">&mdash;</td>
          <td class="r">${usd(freight)}</td>
          <td style="font-size:10px;color:var(--t2);">${lang === "es" ? "Costo real registrado" : "Registered cost"}</td>
        </tr>
        <tr>
          <td>3</td>
          <td>${lang === "es" ? "Seguro internacional" : "International insurance"}</td>
          <td class="m">Factura</td>
          <td class="r">&mdash;</td>
          <td class="r">${usd(insurance)}</td>
          <td style="font-size:10px;color:var(--t2);">${lang === "es" ? "Costo real registrado" : "Registered cost"}</td>
        </tr>
        <tr class="trow">
          <td colspan="4"><strong>CIF (base imponible aduana)</strong></td>
          <td class="r"><strong>${usd(n.totals.cif)}</strong></td>
          <td></td>
        </tr>
        <tr>
          <td>4</td>
          <td>DAI &mdash; Derecho Arancelario</td>
          <td class="m">CIF</td>
          <td class="r">14.00%</td>
          <td class="r">${usd(n.totals.dai)}</td>
          <td style="font-size:10px;color:var(--t2);">${lang === "es" ? "Régimen general calzado" : "General tariff rate"}</td>
        </tr>
        <tr>
          <td>5</td>
          <td>Ley 6946</td>
          <td class="m">CIF</td>
          <td class="r">1.00%</td>
          <td class="r">${usd(n.totals.ley)}</td>
          <td style="font-size:10px;color:var(--t2);">${lang === "es" ? "Tributo fijo" : "Fixed tax"}</td>
        </tr>
        <tr>
          <td>6</td>
          <td>IVA</td>
          <td class="m">CIF</td>
          <td class="r">13.00%</td>
          <td class="r">${usd(n.totals.iva)}</td>
          <td style="font-size:10px;color:var(--t2);">${lang === "es" ? "Acreditable — crédito fiscal" : "Creditable — tax credit"}</td>
        </tr>
        <tr class="trow">
          <td colspan="4"><strong>${lang === "es" ? "Subtotal impuestos (con IVA)" : "Subtotal taxes (incl. VAT)"}</strong></td>
          <td class="r"><strong>${usd(n.totals.dai + n.totals.ley + n.totals.iva)}</strong></td>
          <td></td>
        </tr>`;

  let idx = 7;
  otherCosts.forEach((c) => {
    html += `
      <tr>
        <td>${idx++}</td>
        <td>${esc(c.label || (lang === "es" ? "Otros costos" : "Other costs"))}</td>
        <td class="m">${esc(c.kind || "—")}</td>
        <td class="r">&mdash;</td>
        <td class="r">${usd(c.amount_usd)}</td>
        <td style="font-size:10px;color:var(--t2);">${lang === "es" ? "Costo en destino" : "Destination cost"}</td>
      </tr>`;
  });

  html += `
        <tr class="trow">
          <td colspan="4"><strong>${lang === "es" ? "Subtotal costos destino" : "Subtotal destination costs"}</strong></td>
          <td class="r"><strong>${usd(n.totals.dest)}</strong></td>
          <td></td>
        </tr>
        <tr style="background:var(--t2);color:white;">
          <td colspan="4" style="padding:10px 12px;"><strong style="color:white;font-size:12px;">${lang === "es" ? "Total con IVA (incluye crédito fiscal)" : "Total incl. VAT (includes tax credit)"}</strong></td>
          <td class="r" style="padding:10px 12px;"><strong style="color:white;font-size:13px;">${usd(n.totals.cif + n.totals.dai + n.totals.ley + n.totals.iva + n.totals.dest)}</strong></td>
          <td style="padding:10px 12px;color:rgba(255,255,255,.7);font-size:10px;">${lang === "es" ? "embarque completo" : "complete shipment"}</td>
        </tr>
        <tr style="background:var(--navy);color:white;">
          <td colspan="4" style="padding:12px;border-top:2px solid var(--navy);"><strong style="color:white;font-size:13px;">${
            isClient
              ? (lang === "es" ? "TOTAL SIN IVA — costo real de nacionalizar" : "TOTAL EXCL. VAT — real nationalization cost")
              : (lang === "es" ? "TOTAL SIN IVA — costo real de MWT" : "TOTAL EXCL. VAT — real MWT cost")
          }</strong></td>
          <td class="r" style="padding:12px;border-top:2px solid var(--navy);"><strong style="color:white;font-size:15px;">${usd(n.totals.total)}</strong></td>
          <td style="padding:12px;border-top:2px solid var(--navy);color:var(--ice);font-size:10px;">${lang === "es" ? "ver $/par por línea" : "see $/pair by line"}</td>
        </tr>
      </tbody>
    </table>`;

  return html;
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

function buildFacturarTable(n, skuGroups, lang) {
  const rowsHtml = n.rows.map((row, idx) => {
    const subtotal = row.qty * row.perPar;
    const r = taxRatesForNcm(row.ncm);
    const iva = subtotal * r.iva;
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
    const r = taxRatesForNcm(row.ncm);
    return a + (subtotal * r.iva);
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
export function buildTransferInvoiceHtml({ payload, audience, lang = "es" }) {
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
  const computeNac = (priceFn) => {
    const lineOverrides = t.context_data?.line_overrides || {};
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
      
      const override = lineOverrides[l.id] || {};

      const cif = override.cif !== undefined ? Number(override.cif) : (lt + extra);
      const dai = override.dai !== undefined ? Number(override.dai) : (cif * r.dai);
      const ley = override.ley !== undefined ? Number(override.ley) : (cif * r.ley_6946);
      const itemDest = override.dest !== undefined ? Number(override.dest) : dest;
      const iva = cif * r.iva;

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
  const nacReal = computeNac(unitClient);   // base cliente (valor declarado)
  const nacMwt = computeNac(unitMwt);       // base costo MWT (interno)
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
        ${buildDetailedLiquidationTable(nacAud, costs, isClient, lang)}
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
        ${buildFacturarTable(nacAud, skuGroups, lang)}
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
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{
  --navy:#013A57;--mint:#75CBB3;--mint-s:#E8F5F0;--bg:#F8FAFB;--srf:#FFFFFF;
  --raised:#F1F5F9;--brd:#E2E8F0;--brd2:#CBD5E1;--t1:#0F172A;--t2:#475569;
  --t3:#94A3B8;--ok:#0E8A6D;--info:#0369A1;--crit:#DC2626;--warn:#B45309;
  --purple:#7C3AED;
}
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Plus Jakarta Sans',system-ui,sans-serif;background:var(--bg);color:var(--t1);line-height:1.5;-webkit-font-smoothing:antialiased;padding:24px;}
.doc{max-width:1000px;margin:0 auto;}
.head{background:var(--srf);border:1px solid var(--brd);border-radius:12px;padding:22px 26px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:flex-start;border-top:4px solid var(--navy);}
.brand .logo{font-size:22px;font-weight:800;color:var(--navy);letter-spacing:1px;}
.brand .logo span{color:var(--mint);}
.brand .sub{font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.6px;margin-top:2px;}
.head .right{text-align:right;}
.kind{font-size:10px;font-weight:700;color:var(--mint);letter-spacing:1.5px;}
.folio{font-size:22px;font-weight:800;color:var(--navy);font-variant-numeric:tabular-nums;margin:2px 0 4px;}
.head .meta{font-size:11px;color:var(--t2);line-height:1.7;}
.aud-pill{display:inline-block;margin-top:6px;padding:4px 10px;border-radius:6px;font-size:10px;font-weight:700;letter-spacing:.4px;}
.aud-mwt{background:rgba(1,58,87,.08);color:var(--navy);}
.aud-client{background:rgba(3,105,161,.1);color:var(--info);}
.badge{display:inline-flex;padding:4px 10px;border-radius:6px;font-size:10px;font-weight:700;}
.bg-ceo{background:rgba(220,38,38,0.08);color:var(--crit);}
.bg-sondel{background:rgba(124,58,237,0.08);color:var(--purple);}
table.ct.dense{font-size:11px;}
table.ct.dense thead th, table.ct.dense tbody td{padding:6px 6px;}
.dual{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;}
.card{background:var(--srf);border:1px solid var(--brd);border-radius:12px;overflow:hidden;}
.card-h{padding:11px 18px;border-bottom:1px solid var(--brd);}
.card-h h3{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--navy);}
.card-b{padding:14px 18px;}
.sr{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--raised);font-size:12px;}
.sr:last-child{border-bottom:none;}
.sr .k{color:var(--t2);}
.sr .v{font-weight:700;font-variant-numeric:tabular-nums;}
.route{display:flex;align-items:center;gap:10px;margin-top:4px;}
.route .node{font-weight:700;color:var(--navy);}
.route .arrow{color:var(--mint);font-weight:700;font-size:18px;}
.sect{background:var(--srf);border:1px solid var(--brd);border-radius:12px;overflow:hidden;margin-bottom:16px;}
.sect-h{padding:12px 18px;border-bottom:1px solid var(--brd);}
.sect-h h3{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--navy);}
table.ct{width:100%;border-collapse:collapse;font-size:12px;}
table.ct thead th{padding:9px 12px;text-align:left;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--t3);background:var(--raised);border-bottom:2px solid var(--brd);}
table.ct thead th.r{text-align:right;}
table.ct tbody td{padding:8px 12px;border-bottom:1px solid #f1f5f9;}
table.ct tbody td.r{text-align:right;font-variant-numeric:tabular-nums;}
table.ct tbody td.m{font-family:'JetBrains Mono',monospace;font-size:11px;}
table.ct tbody td.cshare{color:var(--warn);}
table.ct tbody td.landed{color:var(--ok)!important;font-weight:700;}
table.ct .cb{background:rgba(1,58,87,.02);}
table.ct .rb{background:rgba(14,138,109,.03);}
table.ct .kind{display:inline-block;padding:1px 7px;border-radius:4px;background:var(--raised);color:var(--navy);font-size:10px;font-weight:700;font-family:'JetBrains Mono',monospace;}
table.ct .trow{background:var(--raised);font-weight:700;}
table.ct .trow td{border-top:2px solid var(--navy);font-variant-numeric:tabular-nums;}
.pills{display:flex;flex-wrap:wrap;gap:5px;padding:4px 0;}
.pill{display:inline-flex;flex-direction:column;align-items:center;padding:5px 9px;border:1px solid var(--brd);border-radius:6px;min-width:48px;background:var(--srf);}
.pill .s{font-size:9px;color:var(--t3);font-weight:600;}
.pill .q{font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;color:var(--navy);}
.tot{display:flex;justify-content:flex-end;margin-bottom:16px;}
.tot-card{width:340px;border:2px solid var(--navy);border-radius:10px;padding:14px 18px;background:#FAFBFD;}
.tot-row{display:flex;justify-content:space-between;align-items:baseline;padding:5px 0;font-size:12px;color:var(--t2);}
.tot-row strong{color:var(--navy);font-variant-numeric:tabular-nums;}
.tot-final{padding-top:8px;margin-top:6px;border-top:2px solid var(--mint);}
.tot-final span{font-size:13px;font-weight:700;color:var(--navy);}
.tot-final strong{font-size:20px;color:var(--ok);}
.notes-card{background:var(--raised);border:1px solid var(--brd);border-radius:8px;padding:14px 18px;font-size:11px;color:var(--t2);line-height:1.7;margin-bottom:16px;}
.notes-card strong{color:var(--t1);}
.sign{display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;margin:28px 0 14px;}
.sig{text-align:center;}
.sig .line{border-top:1px solid var(--navy);margin-bottom:6px;height:46px;}
.sig .lbl{font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;}
.sig .nm{font-size:12px;font-weight:700;color:var(--navy);}
.foot{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;font-size:9px;color:var(--t3);border-top:1px solid var(--brd);padding-top:12px;margin-top:8px;}
.foot code{font-family:'JetBrains Mono',monospace;}
.actions{display:flex;gap:8px;padding:16px 0;justify-content:flex-end;}
.btn{padding:9px 18px;border-radius:8px;font-size:12px;font-weight:700;border:none;cursor:pointer;}
.btn-p{background:var(--navy);color:#fff;}
.btn-o{background:none;border:1.5px solid var(--brd2);color:var(--t1);}
@media print{
  *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important;}
  @page{margin:10mm 12mm;size:letter;}
  body{background:#fff!important;padding:0;font-size:10.5px;}
  .actions{display:none!important;}
  .card,.sect,.head,.notes-card,.tot-card{break-inside:avoid;page-break-inside:avoid;border:1px solid #ccc!important;}
  table.ct thead{display:table-header-group;}
  table.ct tr{break-inside:avoid;page-break-inside:avoid;}
  table.ct thead th{background:#f1f5f9!important;}
  .head{border-top:4px solid var(--navy)!important;}
}
</style>
</head>
<body>
<div class="doc">

  <div class="head">
    <div class="brand">
      <div class="logo">MW<span>T</span>.ONE</div>
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
