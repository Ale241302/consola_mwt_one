// =====================================================================
// MWT.ONE · lib/expedienteExportHtml.js
// Agente responsable: [AG-03 FRONTEND]
//
// Genera el HTML del "Resumen de Exportación" de uno o varios
// expedientes. Cada expediente se alimenta del payload de
// GET /api/expedientes/{id}/factura-payload/ (el MISMO que la factura
// comercial / remisión de transferencia), por lo que el diseño y los
// tokens MWT coinciden con buildTransferInvoiceHtml.
//
// Contenido por expediente:
//   · Cabecera (codigo, estado, cliente, OC, SAP, operador).
//   · Desglose SKU → tallas → cantidad por talla (lo pedido por el CEO).
//   · Precio unitario + total según la MATRIZ DE PRECIO (ver abajo).
//   · Costos del MOVIMIENTO ligado (FLETE/SEGURO/aduana) — sólo en la
//     audiencia interna (MWT), nunca para el cliente (R3 · POL_VISIBILIDAD).
//
// MATRIZ DE PRECIO (resuelta por expediente):
//   audiencia CLIENTE  ............................ unit_price_client
//   audiencia ADMIN/MWT  + operado por MWT  ....... unit_price_mwt
//   audiencia ADMIN/MWT  + operado por cliente  ... unit_price_client
//
// R1 (cero hex en el código de la app — el HTML exportado es un
// documento standalone autocontenido, sus colores viven en su <style>).
// R5 (tabular-nums en todas las métricas). R6 (@media print canónico).
// =====================================================================
import {
  INVOICE_AUDIENCE,
  unitPriceForAudience,
  downloadTransferInvoice,
} from "./transferInvoiceHtml.js";

// Re-export para que el orquestador no tenga que importar de dos sitios.
export { INVOICE_AUDIENCE, downloadTransferInvoice };

// ── helpers ──────────────────────────────────────────────────────────
const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const fmtInt = (n) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
    Number(n) || 0,
  );

const fmtMoney = (n) =>
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);

/** Cantidad de la línea: recibida → despachada → planificada → qty. */
function lineQty(l) {
  const v =
    l.qty_received != null
      ? l.qty_received
      : l.qty_dispatched != null
        ? l.qty_dispatched
        : l.qty_planned != null
          ? l.qty_planned
          : l.qty;
  return Number(v) || 0;
}

/** ¿El expediente está operado por Muito Work Limitada? */
function operatedByMwt(payload) {
  const oc = (payload && payload.operating_company) || {};
  return !!oc.operated_by_mwt;
}

/**
 * Resuelve la audiencia EFECTIVA de precio para un expediente concreto,
 * aplicando la matriz. `recipient` es lo que eligió el usuario en el modal.
 * @param {('MWT'|'CLIENT')} recipient
 * @param {object} payload
 * @returns {('MWT'|'CLIENT')}
 */
export function effectiveAudienceFor(recipient, payload) {
  if (recipient === INVOICE_AUDIENCE.MWT && operatedByMwt(payload)) {
    return INVOICE_AUDIENCE.MWT;
  }
  return INVOICE_AUDIENCE.CLIENT;
}

// ── render de un expediente ──────────────────────────────────────────
function renderExpediente(item, recipient, lang) {
  const payload = item.payload || {};
  const t = payload.transferencia || {};
  const oc = payload.operating_company || {};
  const lineas = Array.isArray(payload.lineas) ? payload.lineas : [];
  const costs = Array.isArray(payload.cost_breakdown) ? payload.cost_breakdown : [];

  const eff = effectiveAudienceFor(recipient, payload);
  // R3 · POL_VISIBILIDAD: los costos internos del movimiento se muestran sólo
  // cuando el destinatario es Admin/Interno (MWT). El cliente NUNCA los ve,
  // independientemente del precio aplicado por la matriz.
  const showCosts = recipient === INVOICE_AUDIENCE.MWT;

  const codigo =
    item.codigo || payload.proforma_codigo || t.codigo || "—";
  const cliente = oc.operating_company_label || (payload.destino || {}).label || "—";
  const estado = item.estado || t.estado || "—";
  const ocCodigo = payload.oc_codigo || item.oc_codigo || "—";
  const sap = item.sap || "—";
  const operadorLabel = operatedByMwt(payload)
    ? (oc.mwt_operator_name || "Muito Work Limitada")
    : (lang === "es" ? "Cliente" : "Client");

  // Agrupar por SKU → tallas.
  const order = [];
  const groups = {};
  let unitsTotal = 0;
  let goodsTotal = 0;
  lineas.forEach((l) => {
    const sku = l.sku || "—";
    if (!groups[sku]) {
      groups[sku] = {
        sku,
        label: l.product_label || "—",
        sizes: {},
        qty: 0,
        unit: unitPriceForAudience(l, eff),
        amount: 0,
      };
      order.push(sku);
    }
    const g = groups[sku];
    const size = l.size || "—";
    const q = lineQty(l);
    const unit = unitPriceForAudience(l, eff);
    g.sizes[size] = (g.sizes[size] || 0) + q;
    g.qty += q;
    g.unit = unit; // mismo precio por SKU en estos expedientes
    g.amount += q * unit;
    unitsTotal += q;
    goodsTotal += q * unit;
  });

  const pares = lang === "es" ? "PARES" : "PAIRS";
  const groupsHtml = order
    .map((sku) => {
      const g = groups[sku];
      const sizes = Object.keys(g.sizes).sort((a, b) => Number(a) - Number(b));
      const pills = sizes
        .map(
          (sz) =>
            `<div class="pill"><span class="s">${esc(sz)}</span><span class="q num">${fmtInt(
              g.sizes[sz],
            )}</span></div>`,
        )
        .join("");
      return `
      <div class="sku">
        <div class="sku-head">
          <span class="sku-code">${esc(g.sku)}</span>
          <span class="sku-name">${esc(g.label)}</span>
          <span class="sku-tot num">${fmtInt(g.qty)} ${pares}</span>
        </div>
        <div class="pills">${pills}</div>
        <table class="lt">
          <thead>
            <tr>
              <th>${lang === "es" ? "Talla" : "Size"}</th>
              <th class="r">${lang === "es" ? "Cantidad" : "Qty"}</th>
              <th class="r">${lang === "es" ? "Precio U." : "Unit"}</th>
              <th class="r">${lang === "es" ? "Total" : "Total"}</th>
            </tr>
          </thead>
          <tbody>
            ${sizes
              .map((sz) => {
                const q = g.sizes[sz];
                return `<tr>
                  <td class="mono">${esc(sz)}</td>
                  <td class="r num">${fmtInt(q)}</td>
                  <td class="r num">$${fmtMoney(g.unit)}</td>
                  <td class="r num">$${fmtMoney(q * g.unit)}</td>
                </tr>`;
              })
              .join("")}
          </tbody>
          <tfoot>
            <tr>
              <td>${esc(g.sku)}</td>
              <td class="r num">${fmtInt(g.qty)}</td>
              <td class="r"></td>
              <td class="r num">$${fmtMoney(g.amount)}</td>
            </tr>
          </tfoot>
        </table>
      </div>`;
    })
    .join("");

  // Costos del movimiento (sólo audiencia interna).
  let costsTotal = 0;
  costs.forEach((c) => (costsTotal += Number(c.amount_usd) || 0));
  const costsHtml = showCosts && costs.length
    ? `
      <div class="costs">
        <div class="costs-title">${lang === "es" ? "COSTOS DEL MOVIMIENTO" : "MOVEMENT COSTS"}</div>
        <table class="lt">
          <thead><tr><th>${lang === "es" ? "Concepto" : "Concept"}</th><th class="r">USD</th></tr></thead>
          <tbody>
            ${costs
              .map(
                (c) =>
                  `<tr><td>${esc(c.label || c.kind)}</td><td class="r num">$${fmtMoney(
                    c.amount_usd,
                  )}</td></tr>`,
              )
              .join("")}
          </tbody>
          <tfoot><tr><td>${lang === "es" ? "Total costos" : "Total costs"}</td><td class="r num">$${fmtMoney(
            costsTotal,
          )}</td></tr></tfoot>
        </table>
      </div>`
    : "";

  const landed = goodsTotal + (showCosts ? costsTotal : 0);
  const priceTag =
    eff === INVOICE_AUDIENCE.MWT
      ? lang === "es"
        ? "Precio MWT (interno)"
        : "MWT price (internal)"
      : lang === "es"
        ? "Precio cliente"
        : "Client price";

  return `
  <section class="exp">
    <div class="exp-head">
      <div>
        <span class="exp-code mono">${esc(codigo)}</span>
        <span class="badge">${esc(estado)}</span>
      </div>
      <div class="exp-meta">
        <span><b>${lang === "es" ? "Cliente" : "Client"}:</b> ${esc(cliente)}</span>
        <span><b>OC:</b> <span class="mono">${esc(ocCodigo)}</span></span>
        <span><b>SAP:</b> <span class="mono">${esc(sap)}</span></span>
        <span><b>${lang === "es" ? "Operado por" : "Operated by"}:</b> ${esc(operadorLabel)}</span>
        <span class="ptag">${esc(priceTag)}</span>
      </div>
    </div>
    ${groupsHtml || `<div class="empty">${lang === "es" ? "Sin líneas." : "No lines."}</div>`}
    ${costsHtml}
    <div class="exp-tot">
      <div><span>${lang === "es" ? "Unidades" : "Units"}</span><b class="num">${fmtInt(unitsTotal)}</b></div>
      <div><span>${lang === "es" ? "Valor mercadería" : "Goods value"}</span><b class="num">$${fmtMoney(goodsTotal)}</b></div>
      ${showCosts ? `<div><span>${lang === "es" ? "Costos movimiento" : "Movement costs"}</span><b class="num">$${fmtMoney(costsTotal)}</b></div>` : ""}
      <div class="grand"><span>${showCosts ? (lang === "es" ? "Landed total" : "Landed total") : (lang === "es" ? "Total" : "Total")}</span><b class="num">$${fmtMoney(landed)}</b></div>
    </div>
  </section>`;
}

/**
 * Construye el documento HTML completo.
 * @param {Object} args
 * @param {Array<{payload:object, codigo?:string, estado?:string, sap?:string, oc_codigo?:string}>} args.items
 * @param {('MWT'|'CLIENT')} args.audience  destinatario elegido en el modal
 * @param {('es'|'en')} [args.lang='es']
 * @param {Object} [args.filters]   { clienteLabel, estadoLabel, expedienteLabel }
 * @param {string} [args.generatedBy]
 * @returns {string} HTML standalone
 */
export function buildExpedientesExportHtml({
  items = [],
  audience = INVOICE_AUDIENCE.MWT,
  lang = "es",
  filters = {},
  generatedBy = "",
}) {
  const now = new Date();
  const fecha = now.toLocaleString(lang === "es" ? "es-CR" : "en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  // Totales globales (sólo unidades + valor mercadería; los costos varían
  // por audiencia/visibilidad y se muestran por expediente).
  let gUnits = 0;
  let gGoods = 0;
  items.forEach((it) => {
    const p = it.payload || {};
    const eff = effectiveAudienceFor(audience, p);
    (p.lineas || []).forEach((l) => {
      const q = lineQty(l);
      gUnits += q;
      gGoods += q * unitPriceForAudience(l, eff);
    });
  });

  const recipientLabel =
    audience === INVOICE_AUDIENCE.MWT
      ? lang === "es"
        ? "Admin / Interno (MWT)"
        : "Admin / Internal (MWT)"
      : lang === "es"
        ? "Cliente"
        : "Client";

  const chips = [];
  if (filters.clienteLabel) chips.push(`${lang === "es" ? "Cliente" : "Client"}: ${esc(filters.clienteLabel)}`);
  if (filters.estadoLabel) chips.push(`${lang === "es" ? "Estado" : "State"}: ${esc(filters.estadoLabel)}`);
  if (filters.expedienteLabel) chips.push(`${lang === "es" ? "Expediente" : "File"}: ${esc(filters.expedienteLabel)}`);
  const chipsHtml = chips
    .map((c) => `<span class="chip">${c}</span>`)
    .join("");

  const body = items.map((it) => renderExpediente(it, audience, lang)).join("");

  const title = lang === "es" ? "Resumen de Exportación" : "Export Summary";

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title} · MWT.ONE</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root{
    --navy:#013A57;--mint:#75CBB3;--mint-s:#E8F5F0;--bg:#F8FAFB;--srf:#FFFFFF;
    --raised:#F1F5F9;--brd:#E2E8F0;--brd2:#CBD5E1;--t1:#0F172A;--t2:#475569;
    --t3:#94A3B8;--ok:#0E8A6D;--info:#0369A1;--purple:#7C3AED;
  }
  *{box-sizing:border-box;}
  body{margin:0;background:var(--bg);color:var(--t1);font-family:'Plus Jakarta Sans',system-ui,sans-serif;font-size:12px;line-height:1.45;padding:24px;}
  .num{font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1;}
  .mono{font-family:'JetBrains Mono',monospace;}
  .wrap{max-width:980px;margin:0 auto;}
  .head{background:var(--srf);border:1px solid var(--brd);border-top:4px solid var(--navy);border-radius:12px;padding:20px 22px;margin-bottom:18px;display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;}
  .brand{font-family:'Plus Jakarta Sans';font-weight:800;font-size:20px;color:var(--navy);letter-spacing:-.4px;}
  .brand small{display:block;font-weight:600;font-size:11px;color:var(--mint);letter-spacing:2px;margin-top:2px;}
  .doc-title{font-weight:800;font-size:16px;color:var(--t1);text-align:right;}
  .doc-sub{font-size:11px;color:var(--t2);text-align:right;margin-top:4px;}
  .recip{display:inline-block;margin-top:6px;padding:3px 10px;border-radius:999px;font-size:10px;font-weight:700;letter-spacing:.5px;background:var(--mint-s);color:var(--navy);}
  .chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;}
  .chip{background:var(--raised);border:1px solid var(--brd);border-radius:999px;padding:4px 11px;font-size:11px;color:var(--t2);font-weight:600;}
  .exp{background:var(--srf);border:1px solid var(--brd);border-radius:12px;padding:18px 20px;margin-bottom:16px;break-inside:avoid;}
  .exp-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;border-bottom:1px solid var(--brd);padding-bottom:12px;margin-bottom:14px;}
  .exp-code{font-weight:700;font-size:15px;color:var(--navy);}
  .badge{margin-left:10px;display:inline-block;padding:2px 9px;border-radius:999px;font-size:10px;font-weight:700;background:var(--mint-s);color:var(--navy);letter-spacing:.5px;}
  .exp-meta{display:flex;gap:16px;flex-wrap:wrap;font-size:11px;color:var(--t2);align-items:center;}
  .exp-meta b{color:var(--t1);font-weight:600;}
  .ptag{padding:2px 9px;border-radius:999px;background:var(--raised);color:var(--info);font-weight:700;font-size:10px;}
  .sku{margin-bottom:14px;break-inside:avoid;}
  .sku-head{display:flex;align-items:baseline;gap:10px;margin-bottom:8px;}
  .sku-code{font-family:'JetBrains Mono',monospace;font-weight:600;font-size:12px;color:var(--navy);}
  .sku-name{font-size:11px;color:var(--t2);text-transform:uppercase;letter-spacing:.4px;flex:1;}
  .sku-tot{font-weight:700;font-size:11px;color:var(--t1);}
  .pills{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;}
  .pill{display:flex;flex-direction:column;align-items:center;min-width:42px;border:1px solid var(--brd);border-radius:8px;overflow:hidden;}
  .pill .s{background:var(--raised);color:var(--t2);font-size:10px;font-weight:600;padding:2px 0;width:100%;text-align:center;font-family:'JetBrains Mono',monospace;}
  .pill .q{color:var(--t1);font-size:12px;font-weight:700;padding:3px 0;width:100%;text-align:center;}
  table.lt{width:100%;border-collapse:collapse;font-size:11px;margin-top:4px;}
  table.lt th{background:var(--raised);color:var(--t2);text-align:left;padding:6px 9px;font-size:10px;text-transform:uppercase;letter-spacing:.4px;border-bottom:1px solid var(--brd);}
  table.lt td{padding:6px 9px;border-bottom:1px solid var(--brd);}
  table.lt tbody tr:nth-child(even){background:var(--bg);}
  table.lt .r{text-align:right;}
  table.lt tfoot td{font-weight:700;background:var(--mint-s);color:var(--navy);border-top:2px solid var(--mint);}
  .costs{margin-top:12px;}
  .costs-title{font-size:10px;font-weight:700;color:var(--purple);letter-spacing:.6px;margin-bottom:6px;}
  .exp-tot{display:flex;gap:24px;flex-wrap:wrap;justify-content:flex-end;margin-top:14px;padding-top:12px;border-top:1px dashed var(--brd2);}
  .exp-tot > div{text-align:right;}
  .exp-tot span{display:block;font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.4px;}
  .exp-tot b{font-size:15px;color:var(--t1);}
  .exp-tot .grand b{color:var(--navy);}
  .empty{color:var(--t3);font-size:12px;padding:12px 0;}
  .gtot{background:var(--navy);color:#fff;border-radius:12px;padding:16px 22px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:18px;}
  .gtot .lbl{font-size:11px;color:var(--mint);text-transform:uppercase;letter-spacing:1px;}
  .gtot .val{font-size:20px;font-weight:800;}
  .foot{margin-top:16px;font-size:10px;color:var(--t3);text-align:center;}
  @media print{
    *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important;}
    @page{margin:10mm 12mm;size:letter;}
    body{background:#fff!important;padding:0;font-size:10.5px;}
    .actions,[data-no-print]{display:none!important;}
    .head,.exp,.gtot{break-inside:avoid;page-break-inside:avoid;border:1px solid #ccc!important;}
    .head{border-top:4px solid var(--navy)!important;}
    table.lt thead{display:table-header-group;}
    table.lt tr{break-inside:avoid;page-break-inside:avoid;}
  }
</style>
</head>
<body>
  <div class="wrap">
    <div class="head">
      <div class="brand">Muito Work Trading<small>MWT.ONE</small></div>
      <div>
        <div class="doc-title">${title}</div>
        <div class="doc-sub">${fecha}${generatedBy ? " · " + esc(generatedBy) : ""}</div>
        <span class="recip">${recipientLabel}</span>
      </div>
    </div>
    ${chipsHtml ? `<div class="chips">${chipsHtml}</div>` : ""}
    ${body || `<div class="exp"><div class="empty">${lang === "es" ? "No hay expedientes que coincidan con los filtros." : "No files match the filters."}</div></div>`}
    <div class="gtot">
      <div><div class="lbl">${lang === "es" ? "Expedientes" : "Files"}</div><div class="val num">${fmtInt(items.length)}</div></div>
      <div><div class="lbl">${lang === "es" ? "Unidades totales" : "Total units"}</div><div class="val num">${fmtInt(gUnits)}</div></div>
      <div><div class="lbl">${lang === "es" ? "Valor mercadería" : "Goods value"}</div><div class="val num">$${fmtMoney(gGoods)}</div></div>
    </div>
    <div class="foot">MWT.ONE · ${title} · ${esc(recipientLabel)} · ${fecha}</div>
  </div>
</body>
</html>`;
}
