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

// Tasas tributarias de importación (régimen calzado CR) aplicadas sobre el
// CIF. Única fuente de verdad — ajustar aquí si cambia la política fiscal.
//   · ARANCEL (DAI) = 14% s/CIF
//   · VENTA   (IVA) = 12% s/CIF
export const CR_TAX_RATES = Object.freeze({ ARANCEL: 0.14, VENTA: 0.12 });

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
        name: oc.operating_company_label && !oc.operated_by_mwt
          ? oc.operating_company_label
          : "Cliente final",
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

  // ── CIF dual + impuestos (solo si el expediente es operado por MWT) ──
  // Dos CIF: el "aprox" sobre costo Muito Work Limitada y el "real" sobre
  // costo cliente. CIF = (suma por par) + flete + seguro. Impuestos sobre
  // el CIF: Arancel 14% + Impuesto de venta 12%.
  const kindUp = (c) => String(c.kind || "").toUpperCase();
  const freight = costs.reduce((a, c) => a + (KIND_FREIGHT.has(kindUp(c)) ? Number(c.amount_usd || 0) : 0), 0);
  const insurance = costs.reduce((a, c) => a + (KIND_INSURANCE.has(kindUp(c)) ? Number(c.amount_usd || 0) : 0), 0);
  const mwtGoods = lineas.reduce((a, l) => a + lineQty(l) * (l.unit_price_mwt != null ? Number(l.unit_price_mwt) : Number(l.unit_value_usd || 0)), 0);
  const clientGoods = lineas.reduce((a, l) => a + lineQty(l) * (l.unit_price_client != null ? Number(l.unit_price_client) : Number(l.unit_value_usd || 0)), 0);
  const cifMwt = mwtGoods + freight + insurance;
  const cifClient = clientGoods + freight + insurance;
  const cifCard = (title, sub, goods, cif) => `
    <div class="card">
      <div class="card-h"><h3>${esc(title)}</h3></div>
      <div class="card-b">
        <div class="sr"><span class="k">${esc(sub)}</span><span class="v"></span></div>
        <div class="sr"><span class="k">${lang === "es" ? "Suma por par" : "Sum per pair"}</span><span class="v">${usd(goods)}</span></div>
        <div class="sr"><span class="k">${lang === "es" ? "Flete" : "Freight"}</span><span class="v">${usd(freight)}</span></div>
        <div class="sr"><span class="k">${lang === "es" ? "Seguro" : "Insurance"}</span><span class="v">${usd(insurance)}</span></div>
        <div class="sr" style="border-top:2px solid var(--navy);"><span class="k" style="font-weight:700;">CIF</span><span class="v" style="font-size:14px;">${usd(cif)}</span></div>
        <div class="sr"><span class="k">${lang === "es" ? "Arancel" : "Duty"} (${(CR_TAX_RATES.ARANCEL * 100).toFixed(0)}%)</span><span class="v">${usd(cif * CR_TAX_RATES.ARANCEL)}</span></div>
        <div class="sr"><span class="k">${lang === "es" ? "Impuesto venta" : "Sales tax"} (${(CR_TAX_RATES.VENTA * 100).toFixed(0)}%)</span><span class="v">${usd(cif * CR_TAX_RATES.VENTA)}</span></div>
        <div class="sr"><span class="k" style="font-weight:700;">${lang === "es" ? "Total impuestos" : "Total taxes"}</span><span class="v">${usd(cif * (CR_TAX_RATES.ARANCEL + CR_TAX_RATES.VENTA))}</span></div>
        <div class="sr" style="border-top:2px solid var(--mint);"><span class="k" style="font-weight:700;">${lang === "es" ? "Total con impuestos" : "Total with taxes"}</span><span class="v" style="color:var(--ok);">${usd(cif * (1 + CR_TAX_RATES.ARANCEL + CR_TAX_RATES.VENTA))}</span></div>
      </div>
    </div>`;
  const cifSection = oc.operated_by_mwt ? `
  <div class="sect">
    <div class="sect-h"><h3>${lang === "es" ? "CIF e impuestos · doble base (operado por Muito Work Limitada)" : "CIF & taxes · dual base"}</h3></div>
    <div class="card-b">
      <div class="dual">
        ${cifCard(lang === "es" ? "CIF Muito Work Limitada (aprox.)" : "CIF MWT (approx.)", lang === "es" ? "Base: costo operador" : "Operator cost basis", mwtGoods, cifMwt)}
        ${cifCard(lang === "es" ? "CIF Cliente (real)" : "CIF Client (real)", lang === "es" ? "Base: costo cliente" : "Client cost basis", clientGoods, cifClient)}
      </div>
    </div>
  </div>` : "";

  // ── Resumen por talla ──
  const bySize = {};
  lineas.forEach((l) => {
    const k = l.size || "—";
    bySize[k] = (bySize[k] || 0) + lineQty(l);
  });
  const sizePills = Object.keys(bySize)
    .sort((a, b) => Number(a) - Number(b))
    .map((sz) => `<div class="pill"><span class="s">${esc(sz)}</span><span class="q">${fmtInt(bySize[sz])}</span></div>`)
    .join("");

  const docKind = isClient
    ? (lang === "es" ? "FACTURA" : "INVOICE")
    : (lang === "es" ? "REMISIÓN INTERNA" : "INTERNAL WAYBILL");
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
table.ct tbody td.landed{color:var(--ok);font-weight:600;}
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
    </div>
    <div class="right">
      <div class="kind">${esc(docKind)}</div>
      <div class="folio">${esc(t.codigo || "—")}</div>
      <div class="meta">
        ${lang === "es" ? "Emisión" : "Issued"}: <strong>${esc(fmtDate(fechas.dispatched_at || fechas.created_at, lang))}</strong><br>
        ${lang === "es" ? "Motivo" : "Reason"}: <strong>${esc(LEGAL_LABEL[t.legal_context] || t.legal_context || "—")}</strong>
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

  <div class="sect">
    <div class="sect-h">
      <h3>${lang === "es" ? "Detalle de mercadería" : "Merchandise detail"} · ${esc(priceColLabel)}</h3>
    </div>
    <div class="card-b" style="padding:0;">
      <div style="padding:10px 18px;font-size:11px;color:var(--t2);">
        <span class="route">
          <span class="node">${esc((payload.origen && payload.origen.label) || "—")}</span>
          <span class="arrow">→</span>
          <span class="node">${esc((payload.destino && payload.destino.label) || "—")}</span>
          ${t.ref_tracking ? `<span style="margin-left:auto;font-family:'JetBrains Mono';font-size:10px;color:var(--t3);">Tracking: ${esc(t.ref_tracking)}</span>` : ""}
        </span>
      </div>
      <table class="ct">
        <thead>
          <tr>
            <th>#</th>
            <th>${lang === "es" ? "Expediente" : "File"}</th>
            <th>SKU</th>
            <th>${lang === "es" ? "Producto" : "Product"}</th>
            <th class="r">${lang === "es" ? "Talla" : "Size"}</th>
            <th class="r">${lang === "es" ? "Cantidad" : "Qty"}</th>
            <th class="r">${esc(priceColLabel)}</th>
            <th class="r">${lang === "es" ? "Subtotal" : "Subtotal"}</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
          <tr class="trow">
            <td colspan="5">${lang === "es" ? "TOTAL" : "TOTAL"}</td>
            <td class="r">${fmtInt(unitsTotal)}</td>
            <td></td>
            <td class="r">${usd(grandTotal)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <div class="tot">
    <div class="tot-card">
      <div class="tot-row"><span>${lang === "es" ? "Unidades totales" : "Total units"}</span><strong>${fmtInt(unitsTotal)}</strong></div>
      <div class="tot-row"><span>${lang === "es" ? "Líneas" : "Lines"}</span><strong>${fmtInt(lineas.length)}</strong></div>
      <div class="tot-row"><span>${lang === "es" ? "Subtotal mercadería" : "Merchandise subtotal"}</span><strong>${usd(grandTotal)}</strong></div>
      ${costs.length > 0 ? `<div class="tot-row"><span>${lang === "es" ? "Total costos registrados" : "Registered costs total"}</span><strong>${usd(costsTotal)}</strong></div>` : ""}
      <div class="tot-row tot-final"><span>${lang === "es" ? "TOTAL (mercadería + costos)" : "TOTAL (merchandise + costs)"} USD</span><strong>${usd(grandTotal + costsTotal)}</strong></div>
    </div>
  </div>

  ${costs.length > 0 ? `
  <div class="sect">
    <div class="sect-h"><h3>${lang === "es" ? "Costos registrados del movimiento" : "Registered transfer costs"}</h3></div>
    <div class="card-b" style="padding:0;">
      <table class="ct">
        <thead>
          <tr>
            <th>${lang === "es" ? "Tipo" : "Kind"}</th>
            <th>${lang === "es" ? "Descripción del costo" : "Cost description"}</th>
            <th class="r">${lang === "es" ? "Monto" : "Amount"}</th>
            <th>${lang === "es" ? "Mon." : "Curr."}</th>
            <th class="r">FX→USD</th>
            <th class="r">USD</th>
          </tr>
        </thead>
        <tbody>
          ${costRows}
          <tr class="trow"><td colspan="5">${lang === "es" ? "Total costos USD" : "Total costs USD"}</td><td class="r"><strong>${usd(costsTotal)}</strong></td></tr>
        </tbody>
      </table>
    </div>
  </div>` : ""}

  ${cifSection}

  ${sizePills ? `
  <div class="sect">
    <div class="sect-h"><h3>${lang === "es" ? "Resumen por talla" : "Size summary"}</h3></div>
    <div class="card-b"><div class="pills">${sizePills}</div></div>
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
  const codigo = (payload && payload.transferencia && payload.transferencia.codigo) || "TRF";
  const tag = audience === INVOICE_AUDIENCE.CLIENT ? "CLIENTE" : "MWT";
  const safe = String(codigo).replace(/[^A-Za-z0-9_-]+/g, "_");
  return `Factura_${safe}_${tag}.html`;
}
