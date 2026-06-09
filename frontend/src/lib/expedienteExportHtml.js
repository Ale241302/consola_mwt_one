// =====================================================================
// MWT.ONE · lib/expedienteExportHtml.js
// Agente responsable: [AG-03 FRONTEND]
//
// Genera el "Resumen de Exportación" de uno o varios expedientes como un
// DASHBOARD con tabs, replicando los estilos/clases de tracking_expedientes.html:
//
//   · Cronograma  → Proyección de atención de entregas (gantt),
//                   Próximas entregas (cards), Pipeline por estado.
//   · Entrada de pares  → tabla plana modelo × talla × cantidad.
//   · Hoja de recepción → matriz modelo × talla por expediente.
//   · Expedientes → tabla con expand: líneas (precio), costos, artefactos.
//
// Datos por expediente desde GET /api/expedientes/{id}/factura-payload/
// (precio dual + operated_by_mwt + costos del movimiento) + artefactos
// (GET /api/inventario/expedientes/{id}/artifacts/ + builder-artifacts).
//
// MATRIZ DE PRECIO (por expediente):
//   audiencia CLIENTE  ............................ unit_price_client
//   audiencia ADMIN/MWT  + operado por MWT  ....... unit_price_mwt
//   audiencia ADMIN/MWT  + operado por cliente  ... unit_price_client
//
// VISIBILIDAD (R3):
//   · Costos del movimiento → sólo audiencia ADMIN/MWT.
//   · Artefacto "Factura Comercial" → oculto al CLIENTE cuando el
//     expediente lo opera Muito Work Limitada.
// =====================================================================
import {
  INVOICE_AUDIENCE,
  unitPriceForAudience,
  downloadTransferInvoice,
} from "./transferInvoiceHtml.js";
import { MWT_LOGO_DATA_URI, MWT_FAVICON_DATA_URI } from "./mwtBrandAssets.js";

export { INVOICE_AUDIENCE, downloadTransferInvoice };

// ── helpers de construcción (server-side) ────────────────────────────
const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

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

function operatedByMwt(payload) {
  const oc = (payload && payload.operating_company) || {};
  return !!oc.operated_by_mwt;
}

export function effectiveAudienceFor(recipient, payload) {
  if (recipient === INVOICE_AUDIENCE.MWT && operatedByMwt(payload)) {
    return INVOICE_AUDIENCE.MWT;
  }
  return INVOICE_AUDIENCE.CLIENT;
}

function isFacturaComercial(a) {
  return (
    /factura\s*comercial/i.test(String((a && a.template_title) || "")) ||
    Number(a && a.template_id) === 13
  );
}

function fieldVisibleTo(field, recipient) {
  if (recipient !== INVOICE_AUDIENCE.CLIENT) return true;
  const v = String((field && field.permissions && field.permissions.view) || "").toLowerCase();
  return v === "" || v === "todos" || v === "all";
}

const ESTADO_LABEL = {
  REGISTRO: "Registro",
  PRODUCCION: "Producción",
  PREPARACION: "Preparación",
  DESPACHO: "Despacho",
  TRANSITO: "En tránsito",
  EN_DESTINO: "En destino",
  CERRADO: "Cerrado",
};

/** Extrae filas legibles de un artefacto (respetando visibilidad). */
function artifactRows(a, recipient, fileBase) {
  const data = a.data || {};
  const out = [];
  ((a.structure_snapshot || {}).sections || []).forEach((sec) => {
    (sec.columns || []).forEach((col) => {
      (col.fields || []).forEach((f) => {
        if (!f || f.type === "code") return;
        if (!fieldVisibleTo(f, recipient)) return;
        const v = data[f.id];
        if (v == null || v === "") return;
        if (f.type === "file" && typeof v === "object" && v.url) {
          out.push({ label: f.label || f.id, file: { name: v.name || "Archivo", href: (fileBase || "") + v.url } });
        } else if (typeof v === "object") {
          if (v.name) out.push({ label: f.label || f.id, value: String(v.name) });
        } else {
          out.push({ label: f.label || f.id, value: String(v) });
        }
      });
    });
  });
  return out;
}

/** Deriva modo/embarque/entrega/tracking/carrier desde los artefactos. */
function deriveLogistics(artifacts) {
  let modo = "", embarque = "", entrega = "", tracking = "", carrier = "";
  (artifacts || []).forEach((a) => {
    const data = a.data || {};
    ((a.structure_snapshot || {}).sections || []).forEach((sec) => {
      (sec.columns || []).forEach((col) => {
        (col.fields || []).forEach((f) => {
          const lab = String((f && f.label) || "").toLowerCase();
          const v = data[f && f.id];
          if (v == null || v === "") return;
          if (/modo de transporte/.test(lab)) {
            const s = String(v).toLowerCase();
            modo = (s.indexOf("aér") >= 0 || s.indexOf("aere") >= 0)
              ? "Aereo"
              : (s.indexOf("marít") >= 0 || s.indexOf("marit") >= 0) ? "Maritimo" : "";
          } else if (/fecha de despacho/.test(lab)) {
            embarque = String(v);
          } else if (/arrivo|arribo|fecha de arr|llegada/.test(lab)) {
            entrega = String(v);
          } else if (/tracking/.test(lab) && !tracking) {
            tracking = String(v);
          } else if (/carrier/.test(lab) && !carrier) {
            carrier = String(v);
          }
        });
      });
    });
  });
  return { modo, embarque, entrega, tracking, carrier };
}

/** Normaliza un item (payload+artefactos) a la forma del dashboard. */
function buildNormalized(item, recipient, lang, fileBase) {
  const payload = item.payload || {};
  const oc = payload.operating_company || {};
  const lineasRaw = Array.isArray(payload.lineas) ? payload.lineas : [];
  const costLinesRaw = Array.isArray(item.costLines) ? item.costLines : [];
  const opByMwt = operatedByMwt(payload);
  const eff = effectiveAudienceFor(recipient, payload);
  // Ambas vistas muestran su propio landed cost (cada una con sus tasas/valores
  // de context_data.views[vista]); la del cliente trae sus propios montos.
  const showCosts = true;

  // Artefactos (regla Factura Comercial + visibilidad de campos).
  const artifacts = (item.artifacts || [])
    .filter((a) => !(recipient === INVOICE_AUDIENCE.CLIENT && opByMwt && isFacturaComercial(a)))
    .map((a) => ({
      title: a.template_title || "Artefacto",
      nodo: a.nodo_codigo || "",
      rows: artifactRows(a, recipient, fileBase),
    }))
    .filter((a) => a.rows.length);

  const log = deriveLogistics(item.artifacts || []);

  // Agrupar líneas por SKU → tallas.
  const order = [];
  const groups = {};
  let volumen = 0;
  let goods = 0;
  lineasRaw.forEach((l) => {
    const sku = l.sku || "—";
    if (!groups[sku]) {
      groups[sku] = { cod: sku, modelo: l.product_label || "—", sizes: {}, total: 0, unit: unitPriceForAudience(l, eff), amount: 0 };
      order.push(sku);
    }
    const g = groups[sku];
    const size = l.size || "—";
    const q = lineQty(l);
    const unit = unitPriceForAudience(l, eff);
    g.sizes[size] = (g.sizes[size] || 0) + q;
    g.total += q;
    g.unit = unit;
    g.amount += q * unit;
    volumen += q;
    goods += q * unit;
  });
  const lineas = order.map((sku) => {
    const g = groups[sku];
    const tallas = Object.keys(g.sizes)
      .sort((a, b) => Number(a) - Number(b))
      .map((sz) => sz + ":" + g.sizes[sz])
      .join(" ");
    return { cod: g.cod, modelo: g.modelo, total: g.total, unit: g.unit, amount: g.amount, tallas };
  });

  // Liquidación landed = MISMA fórmula que la sección 3 (TransferLiquidationPanel):
  // CIF (FOB+flete+seguro) + DAI + Ley 6946 + costos destino + timbres/impuestos
  // custom, con tasas/exclusiones de context_data por vista. IVA es acreditable
  // (no suma). Sólo se expone a la audiencia interna (showCosts · R3).
  const ctxAll = (payload.transferencia || {}).context_data || {};
  const bucket = (ctxAll.views && ctxAll.views[recipient]) || ctxAll || {};
  const crr = bucket.custom_rates || {};
  const exc = bucket.excluded || {};
  const FREIGHTK = { FLETE: 1, FREIGHT: 1, CONSOLIDACION: 1 };
  const INSK = { SEGURO: 1, INSURANCE: 1 };
  let freight = 0, insurance = 0;
  const destLines = [];
  costLinesRaw.forEach((c) => {
    const k = String(c.kind || "").toUpperCase();
    const amt = Number(c.amount_usd != null ? c.amount_usd : (Number(c.amount || 0) * Number(c.fx_to_usd || 1))) || 0;
    if (FREIGHTK[k]) freight += amt;
    else if (INSK[k]) insurance += amt;
    else destLines.push({ label: c.label || c.kind || "Otro", usd: amt });
  });
  const destCosts = destLines.reduce((a, c) => a + c.usd, 0);
  const cif = goods + freight + insurance;
  const leyRate = crr.ley != null ? Number(crr.ley) : 0.01;
  const ivaRate = crr.iva != null ? Number(crr.iva) : 0.13;
  // DAI con la tasa VIVA del NCM por línea (payload.dai_rate, resuelta en el
  // backend por origen→destino), respetando un override EXPLÍCITO
  // (dai_overridden) — IDÉNTICO a la factura. Antes usaba crr.dai stale o el
  // hardcode 0.14 → mostraba 14% aunque el NCM fuera 10%.
  const daiOverridden = crr.dai_overridden === true;
  const extraTotal = freight + insurance;
  const qtyTotalAll = lineasRaw.reduce((a, l) => a + lineQty(l), 0) || 0;
  let dai = 0;
  if (!exc.dai) {
    lineasRaw.forEach((l) => {
      const q = lineQty(l);
      const lt = q * unitPriceForAudience(l, eff);
      const extra = qtyTotalAll > 0 ? extraTotal * (q / qtyTotalAll) : 0;
      const cifLine = lt + extra;
      const liveDai = (l.dai_rate != null) ? Number(l.dai_rate) : 0.14;
      const rate = (daiOverridden && crr.dai != null) ? Number(crr.dai) : liveDai;
      dai += cifLine * rate;
    });
  }
  const daiRate = cif > 0 ? dai / cif : ((daiOverridden && crr.dai != null) ? Number(crr.dai) : 0);
  const ley = exc.ley ? 0 : cif * leyRate;
  // IVA acreditable sobre CIF + DAI + Ley (igual que la factura), no sólo CIF.
  const iva = exc.iva ? 0 : (cif + dai + ley) * ivaRate;
  let timbresSum = 0;
  const timbres = (bucket.custom_taxes || []).filter((x) => x && x.type === "TAX").map((x) => {
    const has = x.amount != null && x.amount !== "";
    const amt = has ? (Number(x.amount) || 0) : cif * (Number(x.rate || 0) / 100);
    timbresSum += amt;
    return { label: x.concept || (lang === "es" ? "Timbre" : "Stamp"), usd: amt };
  });
  let customCostsSum = 0;
  const customCostRows = (bucket.custom_taxes || []).filter((x) => x && x.type === "COST").map((x) => {
    const amt = Number(x.amount || 0); customCostsSum += amt;
    return { label: x.concept || (lang === "es" ? "Gasto" : "Charge"), usd: amt };
  });
  const landed = cif + dai + ley + destCosts + timbresSum + customCostsSum; // sin IVA
  const costsTotal = landed - goods; // costos extra (flete+seguro+impuestos+destino+timbres)
  const costs = showCosts ? [
    { label: lang === "es" ? "Flete" : "Freight", usd: freight },
    { label: lang === "es" ? "Seguro" : "Insurance", usd: insurance },
    { label: "CIF", usd: cif, bold: true },
    { label: "DAI " + (daiRate * 100).toFixed(2) + "%", usd: dai },
    { label: "Ley 6946 " + (leyRate * 100).toFixed(2) + "%", usd: ley },
    { label: "IVA " + (ivaRate * 100).toFixed(2) + "%" + (lang === "es" ? " (acreditable, no suma)" : " (creditable)"), usd: iva, info: true },
  ].concat(timbres, destLines, customCostRows).filter((r) => r.bold || r.info || Math.abs(r.usd) > 0.0001) : [];

  const estado = item.estado || (payload.transferencia || {}).estado || "—";
  const trfId = (payload.transferencia || {}).id || "";

  // Etiqueta del expediente: MWT → número de proforma; Cliente → número de OC.
  const codeMwt = payload.proforma_codigo || item.codigo || "—";
  const codeClient = item.oc_codigo || payload.oc_codigo || item.codigo || "—";

  return {
    expediente: recipient === INVOICE_AUDIENCE.MWT ? codeMwt : codeClient,
    oc: item.oc_codigo || payload.oc_codigo || "",
    cliente: oc.operating_company_label || (payload.destino || {}).label || "—",
    operador: opByMwt ? "MWT" : "Cliente",
    modo: log.modo || "",
    tracking: log.tracking || "",
    carrier: log.carrier || "",
    estado,
    estadoLabel: ESTADO_LABEL[estado] || estado,
    trfId,
    embarque: log.embarque || "",
    entrega: log.entrega || "",
    volumen,
    priceTag: eff === INVOICE_AUDIENCE.MWT ? "Precio MWT (interno)" : "Precio cliente",
    goods,
    showCosts,
    costs,
    costsTotal,
    landed,
    lineas,
    artifacts,
  };
}

// ── runtime embebido en el HTML (se serializa con toString) ──────────
// Lee window.__EXP / __AUD / __META. Vanilla JS, sin dependencias.
function clientRuntime() {
  var DATA = window.__EXP || [];
  var AUD = window.__AUD || "MWT";
  var META = window.__META || {};
  var STAGES = ["REGISTRO", "PRODUCCION", "PREPARACION", "DESPACHO", "TRANSITO", "EN_DESTINO", "CERRADO"];
  var SLAB = { REGISTRO: "Registro", PRODUCCION: "Producción", PREPARACION: "Preparación", DESPACHO: "Despacho", TRANSITO: "Tránsito", EN_DESTINO: "En destino", CERRADO: "Cerrado" };
  var TRANSIT = { Aereo: 10, Maritimo: 35 };
  var MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  var showCosts = AUD === "MWT";

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function fInt(n) { return (Number(n) || 0).toLocaleString("es-CR"); }
  function fUsd(n) { return "$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function today() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function parseD(s) { if (!s) return null; var d = new Date(s + "T00:00:00"); return isNaN(d) ? null : d; }
  function fmt(d) { return d ? d.toISOString().slice(0, 10) : ""; }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function shortD(d) { return d ? d.getDate() + " " + MES[d.getMonth()] : ""; }
  function delivered(e) { return e.estado === "EN_DESTINO" || e.estado === "CERRADO"; }

  function etaOf(e) {
    if (e.entrega) { var d = parseD(e.entrega); if (d) return d; }
    if (delivered(e)) return null;
    if (!e.embarque || !(e.modo in TRANSIT)) return null;
    var emb = parseD(e.embarque); if (!emb) return null;
    return addDays(emb, TRANSIT[e.modo]);
  }
  function projectedDelivery(e) {
    if (e.entrega) { var d = parseD(e.entrega); if (d) return { date: d, done: delivered(e), est: false }; }
    var eta = etaOf(e);
    if (eta) return { date: eta, done: delivered(e), est: false };
    return { date: null, done: delivered(e), est: true };
  }
  function startOf(e) { var emb = parseD(e.embarque); return emb || null; }
  function sem(e) {
    if (delivered(e)) return "ok";
    var eta = etaOf(e); if (!eta) return "none";
    var dias = Math.round((eta - today()) / 86400000);
    if (dias < 0) return "late"; if (dias <= 7) return "warn"; return "ok";
  }

  function filtered() {
    var op = document.getElementById("fOp").value;
    var mo = document.getElementById("fModo").value;
    return DATA.filter(function (e) { return (!op || e.operador === op) && (!mo || e.modo === mo); });
  }
  function fillModel(selId, list) {
    var sel = document.getElementById(selId);
    var models = []; list.forEach(function (e) { (e.lineas || []).forEach(function (l) { if (models.indexOf(l.modelo) < 0) models.push(l.modelo); }); });
    models.sort();
    var cur = sel.value;
    sel.innerHTML = '<option value="">Todos</option>' + models.map(function (m) { return '<option' + (m === cur ? " selected" : "") + ">" + esc(m) + "</option>"; }).join("");
    return sel.value;
  }

  function arrivalRows(list) {
    var out = [];
    list.forEach(function (e) {
      var p = projectedDelivery(e);
      (e.lineas || []).forEach(function (l) {
        (l.tallas || "").split(" ").filter(Boolean).forEach(function (t) {
          var a = t.split(":");
          out.push({ modelo: l.modelo, talla: a[0], qty: +a[1] || 0, date: p.date, est: p.est, done: p.done, estado: e.estadoLabel, exp: e.expediente, oc: e.oc });
        });
      });
    });
    return out;
  }
  function sizeMatrix(lineas) {
    if (!lineas.length) return '<div class="muted">Sin desglose.</div>';
    var sizes = [];
    lineas.forEach(function (l) { (l.tallas || "").split(" ").filter(Boolean).forEach(function (p) { var s = +p.split(":")[0]; if (sizes.indexOf(s) < 0) sizes.push(s); }); });
    sizes.sort(function (a, b) { return a - b; });
    var colTot = {}; sizes.forEach(function (s) { colTot[s] = 0; }); var grand = 0;
    var th = "<th>Modelo</th>" + sizes.map(function (s) { return "<th>" + s + "</th>"; }).join("") + '<th class="tot">Total</th>';
    var body = lineas.map(function (l) {
      var map = {}; (l.tallas || "").split(" ").filter(Boolean).forEach(function (p) { var a = p.split(":"); map[+a[0]] = +a[1]; });
      var rt = 0;
      var cells = sizes.map(function (s) { var q = map[s] || 0; if (q) { colTot[s] += q; rt += q; } return q ? "<td>" + q + "</td>" : '<td class="z">.</td>'; }).join("");
      grand += rt;
      return "<tr><td>" + esc(l.modelo) + "</td>" + cells + '<td class="tot">' + rt + "</td></tr>";
    }).join("");
    var foot = '<tr class="mtot"><td>Total</td>' + sizes.map(function (s) { return "<td>" + (colTot[s] || "") + "</td>"; }).join("") + '<td class="tot">' + grand + "</td></tr>";
    return '<div style="overflow-x:auto"><table class="mtx"><thead><tr>' + th + "</tr></thead><tbody>" + body + foot + "</tbody></table></div>";
  }

  function renderKpis(list) {
    var total = list.length;
    var entreg = list.filter(delivered).length;
    var transito = list.filter(function (e) { return e.estado === "TRANSITO"; }).length;
    var porsalir = list.filter(function (e) { return ["REGISTRO", "PRODUCCION", "PREPARACION", "DESPACHO"].indexOf(e.estado) >= 0; }).length;
    var vol = list.reduce(function (a, e) { return a + (e.volumen || 0); }, 0);
    var goods = list.reduce(function (a, e) { return a + (e.goods || 0); }, 0);
    var cards = [
      ["Expedientes", total], ["Entregados", entreg], ["En tránsito", transito],
      ["Por salir", porsalir], ["Pares totales", fInt(vol)], ["Valor mercadería", fUsd(goods)],
    ];
    if (showCosts) {
      var seen = {}, costSum = 0;
      list.forEach(function (e) { var k = e.trfId || e.expediente; if (!seen[k]) { seen[k] = 1; costSum += (e.costsTotal || 0); } });
      cards.push(["Costos movimiento", fUsd(costSum)]);
    }
    var icons = {
      "Expedientes": '<svg class="kpi-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>',
      "Entregados": '<svg class="kpi-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>',
      "En tránsito": '<svg class="kpi-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0zM13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 011-1v-4a1 1 0 01.816-.983L18 8.5V13a1 1 0 001 1h2a1 1 0 001-1v-4a1 1 0 00-.316-.725l-4-3.858A1 1 0 0013.92 3H12" /></svg>',
      "Por salir": '<svg class="kpi-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>',
      "Pares totales": '<svg class="kpi-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>',
      "Valor mercadería": '<svg class="kpi-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>',
      "Costos movimiento": '<svg class="kpi-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 002 2h2a2 2 0 002-2z" /></svg>'
    };
    document.getElementById("kpis").innerHTML = cards.map(function (c) {
      var icon = icons[c[0]] || "";
      return '<div class="kpi"><div class="kpi-icon-wrapper">' + icon + '</div><div class="kpi-content"><div class="n">' + c[1] + '</div><div class="l">' + c[0] + '</div></div></div>';
    }).join("");
  }

  function renderProjection(list) {
    var rows = list.map(function (e) { return { e: e, p: projectedDelivery(e), s: startOf(e) }; });
    var dated = rows.filter(function (r) { return r.p.date || r.s; });
    var undated = rows.filter(function (r) { return !r.p.date && !r.s; });
    var g = document.getElementById("gantt");
    if (!dated.length) { g.innerHTML = '<div class="nodate">Sin fechas suficientes para proyectar.</div>'; }
    else {
      var ds = [today()];
      dated.forEach(function (r) { if (r.p.date) ds.push(r.p.date); if (r.s) ds.push(r.s); });
      var min = addDays(new Date(Math.min.apply(null, ds.map(function (d) { return d.getTime(); }))), -3);
      var max = addDays(new Date(Math.max.apply(null, ds.map(function (d) { return d.getTime(); }))), 5);
      var span = Math.max(1, (max - min) / 86400000);
      var pct = function (d) { return ((d - min) / 86400000) / span * 100; };
      dated.sort(function (a, b) { return (a.p.date ? a.p.date.getTime() : Infinity) - (b.p.date ? b.p.date.getTime() : Infinity); });
      var grid = "", axis = "";
      var t = new Date(min); t.setDate(t.getDate() + ((1 - t.getDay() + 7) % 7));
      for (; t <= max; t = addDays(t, 7)) { var x = pct(t); grid += '<div class="gtline" style="left:' + x + '%"></div>'; axis += '<div class="gtick" style="left:' + x + '%">' + shortD(t) + "</div>"; }
      grid += '<div class="gtoday" style="left:' + pct(today()) + '%"><span class="lab">hoy</span></div>';
      var html = '<div class="goverlay">' + grid + "</div>";
      dated.forEach(function (r) {
        var e = r.e, p = r.p, s = r.s, bar = "";
        if (s && p.date && pct(p.date) > pct(s)) {
          var l = pct(s), end = pct(p.date), w = Math.max(2, end - l);
          var cls = p.done ? "done" : (p.est ? "est" : (e.modo === "Aereo" ? "aereo" : (e.modo === "Maritimo" ? "maritimo" : "est")));
          var tip = shortD(p.date) + (p.est ? " (est.)" : "") + (p.done ? " · entregado" : "");
          bar += '<div class="gbar ' + cls + '" data-tip="' + esc(tip) + '" style="left:' + l + "%;width:" + w + '%"></div>';
        } else if (p.date) {
          var x = pct(p.date);
          var tip2 = shortD(p.date) + (p.done ? " · entregado" : (p.est ? " (est.)" : ""));
          bar += '<div class="gdot" data-tip="' + esc(tip2) + '" style="left:' + x + '%"></div>';
        }
        html += '<div class="grow"><div class="glabel">' + esc(e.expediente) + " · " + fInt(e.volumen) + " prs · " + esc(e.operador) + '</div><div class="gtrack">' + bar + "</div></div>";
      });
      html += '<div class="gaxis">' + axis + "</div>";
      g.innerHTML = html;
    }
    if (undated.length) g.innerHTML += '<div class="nodate" style="margin-top:8px">Sin fecha: ' + undated.map(function (r) { return esc(r.e.expediente); }).join(", ") + "</div>";
  }
  function renderUpnext(list) {
    var rows = list.map(function (e) { return { e: e, p: projectedDelivery(e) }; }).filter(function (r) { return r.p.date; });
    rows.sort(function (a, b) {
      if (a.p.done !== b.p.done) return a.p.done ? 1 : -1; // pendientes primero
      return a.p.done ? (b.p.date - a.p.date) : (a.p.date - b.p.date);
    });
    var box = document.getElementById("upnext");
    if (!rows.length) { box.innerHTML = '<div class="nodate">Sin fechas de entrega.</div>'; return; }
    box.innerHTML = rows.map(function (r) {
      var e = r.e, p = r.p, dias = Math.round((p.date - today()) / 86400000);
      var pulseClass = p.done ? 'ok' : sem(e);
      var d3 = p.done
        ? '<span class="sem ok"></span>Entregado'
        : '<span class="sem ' + pulseClass + '"></span>' + (dias <= 0 ? "entrega hoy/vencida" : "en " + dias + " días");
      return '<div class="up"><div class="d1">' + esc(e.expediente) + " · " + shortD(p.date) + (p.est ? " (est.)" : "") + '</div><div class="d2">' + fInt(e.volumen) + " prs · " + esc(e.modo || "modo?") + " · " + esc(e.operador) + (e.oc && e.oc !== e.expediente ? " · OC " + esc(e.oc) : "") + '</div><div class="d3">' + d3 + "</div></div>";
    }).join("");
  }
  function renderPipeline(list) {
    var by = {}; STAGES.forEach(function (s) { by[s] = []; });
    list.forEach(function (e) { (by[e.estado] || (by[e.estado] = [])).push(e); });
    document.getElementById("pipeline").innerHTML = STAGES.map(function (s) {
      var items = by[s] || [];
      return '<div class="col"><h3>' + (SLAB[s] || s) + '<span class="c">' + items.length + "</span></h3>" + items.map(cardHtml).join("") + "</div>";
    }).join("");
    Array.prototype.forEach.call(document.querySelectorAll(".card"), function (c) { c.onclick = function () { gotoExp(c.getAttribute("data-exp")); }; });
  }
  function cardHtml(e) {
    var opTag = '<span class="tag ' + (e.operador === "MWT" ? "mwt" : "sondel") + '">' + esc(e.operador) + "</span>";
    var moTag = e.modo ? '<span class="tag ' + (e.modo === "Aereo" ? "aereo" : "maritimo") + '">' + esc(e.modo) + "</span>" : "";
    var eta = etaOf(e);
    return '<div class="card" data-exp="' + esc(e.expediente) + '"><div class="exp">' + esc(e.expediente) + ' <span style="font-weight:400;color:#6b7785">' + fInt(e.volumen) + ' prs</span></div><div class="meta">' + (e.oc ? "OC " + esc(e.oc) : '<span class="muted">OC pendiente</span>') + '</div><div class="tags">' + opTag + moTag + "</div>" + (eta ? '<div class="eta"><span class="sem ' + sem(e) + '"></span>' + (e.entrega ? "Entrega " : "ETA ") + fmt(eta) + "</div>" : "") + "</div>";
  }

  function renderFlat(list) {
    var fm = fillModel("ft_model", list);
    var rows = arrivalRows(list);
    if (fm) rows = rows.filter(function (r) { return r.modelo === fm; });
    var sort = document.getElementById("ft_sort").value;
    rows.sort(function (a, b) {
      return sort === "fecha"
        ? ((a.date ? a.date.getTime() : Infinity) - (b.date ? b.date.getTime() : Infinity)) || a.modelo.localeCompare(b.modelo) || (+a.talla - +b.talla)
        : a.modelo.localeCompare(b.modelo) || (+a.talla - +b.talla);
    });
    document.getElementById("fa_body").innerHTML = rows.map(function (r) {
      var fecha = r.done ? '<span style="color:#2da44e;font-weight:600">entregado</span>' : (r.date ? (shortD(r.date) + (r.est ? " (est)" : "")) : '<span class="muted">sin fecha</span>');
      return "<tr><td>" + esc(r.modelo) + "</td><td><b>" + esc(r.talla) + "</b></td><td>" + r.qty + "</td><td>" + fecha + "</td><td>" + esc(r.estado) + "</td><td>" + esc(r.exp) + (r.oc ? " / " + esc(r.oc) : "") + "</td></tr>";
    }).join("") || '<tr><td colspan="6" class="muted" style="text-align:center;padding:14px">Sin datos.</td></tr>';
  }
  function renderRecep(list) {
    var fm = fillModel("hr_model", list);
    var show = document.getElementById("hr_show").value;
    var items = list.map(function (e) { return { e: e, p: projectedDelivery(e) }; });
    if (show === "pend") items = items.filter(function (x) { return !x.p.done; });
    else if (show === "done") items = items.filter(function (x) { return x.p.done; });
    items.sort(function (a, b) { var ad = a.p.date ? a.p.date.getTime() : (a.p.done ? -1 : Infinity); var bd = b.p.date ? b.p.date.getTime() : (b.p.done ? -1 : Infinity); return ad - bd; });
    document.getElementById("recep").innerHTML = items.map(function (x) {
      var e = x.e, p = x.p, lineas = e.lineas || [];
      if (fm) lineas = lineas.filter(function (l) { return l.modelo === fm; });
      if (fm && !lineas.length) return "";
      var dias = p.date ? Math.round((p.date - today()) / 86400000) : null;
      var whenCls = "", whenTxt;
      if (p.done) { whenCls = "done"; whenTxt = "Entregado"; }
      else if (p.date) { whenTxt = "Llega " + shortD(p.date) + (p.est ? " (est)" : "") + (dias != null ? (dias <= 0 ? " · hoy/vencida" : " · en " + dias + "d") : ""); if (dias != null && dias <= 7) whenCls = "soon"; }
      else whenTxt = "Sin fecha";
      var totVis = lineas.reduce(function (a, l) { return a + (+l.total || 0); }, 0);
      return '<div class="arrcard' + (p.done ? " done" : "") + '"><div class="arrh"><b>' + esc(e.expediente) + '</b> <span class="muted" style="font-weight:400">' + (e.oc && e.oc !== e.expediente ? "OC " + esc(e.oc) : "") + "</span> · " + fInt(totVis) + ' prs<span class="when ' + whenCls + '">' + whenTxt + '</span></div><div class="arrsub">' + esc(e.operador) + " · " + esc(e.modo || "modo?") + " · " + esc(e.estadoLabel) + (e.embarque ? " · sale " + esc(e.embarque) : "") + "</div>" + sizeMatrix(lineas) + "</div>";
    }).join("") || '<div class="nodate">Sin llegadas con este filtro.</div>';
  }

  var expanded = {};
  function detailHtml(e) {
    var t = '<table class="det"><thead><tr><th>Código</th><th>Modelo</th><th>Pares</th><th>Precio U.</th><th>Total</th><th>Tallas</th></tr></thead><tbody>';
    (e.lineas || []).forEach(function (l) {
      var chips = (l.tallas || "").split(" ").filter(Boolean).map(function (p) { var a = p.split(":"); return '<span class="tch"><b>' + a[0] + "</b> " + a[1] + "</span>"; }).join("");
      t += "<tr><td>" + esc(l.cod) + "</td><td>" + esc(l.modelo) + "</td><td><b>" + fInt(l.total) + "</b></td><td>" + fUsd(l.unit) + "</td><td>" + fUsd(l.amount) + "</td><td>" + (chips || "-") + "</td></tr>";
    });
    t += '<tr class="mtot"><td colspan="2">Total</td><td><b>' + fInt(e.volumen) + "</b></td><td></td><td><b>" + fUsd(e.goods) + "</b></td><td></td></tr>";
    t += "</tbody></table>";
    if (e.showCosts && e.costs && e.costs.length) {
      t += '<div class="blk-h">Costos del movimiento</div><table class="det"><tbody>';
      e.costs.forEach(function (c) { t += "<tr><td>" + esc(c.label) + '</td><td style="text-align:right">' + fUsd(c.usd) + "</td></tr>"; });
      t += '<tr class="mtot"><td>Landed total</td><td style="text-align:right"><b>' + fUsd(e.landed) + "</b></td></tr></tbody></table>";
    }
    if (e.artifacts && e.artifacts.length) {
      t += '<div class="blk-h">Artefactos</div>';
      e.artifacts.forEach(function (a) {
        t += '<div class="artbox"><div class="art-h">' + esc(a.title) + (a.nodo ? ' <span class="muted">' + esc(a.nodo) + "</span>" : "") + "</div><table class=\"det\"><tbody>";
        a.rows.forEach(function (r) {
          var val = r.file ? '<a class="afile" href="' + esc(r.file.href) + '" target="_blank" rel="noopener">📎 ' + esc(r.file.name) + "</a>" : esc(r.value);
          t += "<tr><td>" + esc(r.label) + '</td><td style="text-align:right">' + val + "</td></tr>";
        });
        t += "</tbody></table></div>";
      });
    }
    return t;
  }
  function renderTable(list) {
    var grp = document.getElementById("groupBy").value;
    var tb = document.getElementById("tbody");
    var cell = function (v) { return v ? esc(v) : '<span class="muted">-</span>'; };
    function rowHtml(e) {
      var eta = etaOf(e), op = !!expanded[e.expediente];
      var h = '<tr class="exprow" data-exp="' + esc(e.expediente) + '" style="cursor:pointer"><td><b>' + (op ? "▾ " : "▸ ") + cell(e.expediente) + "</b></td><td>" + cell(e.oc) + "</td><td>" + cell(e.cliente) + '</td><td><span class="tag ' + (e.operador === "MWT" ? "mwt" : "sondel") + '">' + esc(e.operador) + "</span></td><td>" + (e.modo ? '<span class="tag ' + (e.modo === "Aereo" ? "aereo" : "maritimo") + '">' + esc(e.modo) + "</span>" : '<span class="muted">-</span>') + "</td><td><b>" + fInt(e.volumen) + "</b></td><td>" + esc(e.estadoLabel) + "</td><td>" + cell(e.embarque) + "</td><td>" + (eta ? fmt(eta) + (e.entrega ? ' <span style="color:#2da44e">OK</span>' : "") : '<span class="muted">-</span>') + "</td></tr>";
      if (op) h += '<tr class="detrow"><td colspan="9">' + detailHtml(e) + "</td></tr>";
      return h;
    }
    var html = "";
    if (grp === "none") html = list.map(rowHtml).join("");
    else {
      var groups = {};
      list.forEach(function (e) { var k = e[grp] || "(sin asignar)"; (groups[k] || (groups[k] = [])).push(e); });
      Object.keys(groups).sort().forEach(function (k) {
        var gp = groups[k].reduce(function (a, e) { return a + (e.volumen || 0); }, 0);
        html += '<tr class="grp"><td colspan="9">' + esc(String(grp).toUpperCase()) + ": " + esc(k) + " · " + groups[k].length + " exped. · " + fInt(gp) + " pares</td></tr>";
        html += groups[k].map(rowHtml).join("");
      });
    }
    tb.innerHTML = html || '<tr><td colspan="9" class="muted" style="padding:18px;text-align:center">Sin expedientes.</td></tr>';
    Array.prototype.forEach.call(tb.querySelectorAll("tr.exprow"), function (r) {
      r.onclick = function () { var i = r.getAttribute("data-exp"); expanded[i] = !expanded[i]; render(); };
    });
  }

  function gotoExp(code) {
    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (x) { x.classList.remove("on"); });
    document.querySelector('.tab[data-tab="exped"]').classList.add("on");
    Array.prototype.forEach.call(document.querySelectorAll(".panel"), function (p) { p.classList.add("hide"); });
    document.getElementById("p-exped").classList.remove("hide");
    expanded[code] = true; render();
  }

  function render() {
    var list = filtered();
    renderKpis(list); renderProjection(list); renderUpnext(list); renderPipeline(list); renderFlat(list); renderRecep(list); renderTable(list);
  }

  Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (tb) {
    tb.onclick = function () {
      Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (x) { x.classList.remove("on"); });
      tb.classList.add("on");
      Array.prototype.forEach.call(document.querySelectorAll(".panel"), function (p) { p.classList.add("hide"); });
      document.getElementById("p-" + tb.getAttribute("data-tab")).classList.remove("hide");
    };
  });
  ["fOp", "fModo", "groupBy", "ft_model", "ft_sort", "hr_show", "hr_model"].forEach(function (idn) { var el = document.getElementById(idn); if (el) el.onchange = render; });
  render();
}

const DASHBOARD_CSS = `
:root {
  --bg-main: #f8fafc;
  --surface-card: #ffffff;
  --text-title: #0f172a;
  --text-body: #334155;
  --text-muted: #64748b;
  --primary-indigo: #013A57;
  --primary-blue: #13B98A;
  --success: #10b981;
  --success-bg: #d1fae5;
  --success-text: #065f46;
  --warning: #f59e0b;
  --warning-bg: #fef3c7;
  --warning-text: #92400e;
  --danger: #ef4444;
  --danger-bg: #fee2e2;
  --danger-text: #991b1b;
  --info-aereo: #3b82f6;
  --info-aereo-bg: #dbeafe;
  --info-aereo-text: #1e40af;
  --info-maritimo: #0284c7;
  --info-maritimo-bg: #e0f2fe;
  --info-maritimo-text: #0369a1;
  --border-color: #e2e8f0;
  --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.05), 0 2px 4px -2px rgb(0 0 0 / 0.05);
  --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.04), 0 4px 6px -4px rgb(0 0 0 / 0.04);
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg-main);
  color: var(--text-body);
  font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
.wrap {
  max-width: 1200px;
  margin: 0 auto;
  padding: 32px 24px 80px;
}
.header-container {
  background: linear-gradient(135deg, #013A57 0%, #06283A 100%);
  border-radius: 20px;
  padding: 26px 32px 28px;
  color: #ffffff;
  margin-bottom: 28px;
  box-shadow: var(--shadow-lg);
  position: relative;
  overflow: hidden;
}
.header-container::after {
  content: "";
  position: absolute;
  top: -55%;
  right: -15%;
  width: 340px;
  height: 340px;
  background: radial-gradient(circle, rgba(19,185,138,0.22) 0%, rgba(0,0,0,0) 70%);
  border-radius: 50%;
  pointer-events: none;
}
.header-container .hc-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}
.header-container .logo-img {
  height: 30px;
  width: auto;
  display: block;
  filter: brightness(0) invert(1);
}
.header-container h1 {
  font-size: 24px;
  font-weight: 800;
  margin: 0 0 8px;
  letter-spacing: -0.025em;
  display: flex;
  align-items: center;
  gap: 10px;
}
.header-container h1 .brand-badge,
.header-container .hc-top .brand-badge {
  background: linear-gradient(90deg, #13B98A, #75CBB3);
  color: #012b41;
  font-size: 10px;
  font-weight: 800;
  padding: 4px 10px;
  border-radius: 999px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  box-shadow: 0 2px 8px rgba(19,185,138,0.35);
}
.header-container .sub {
  color: #94a3b8;
  font-size: 13px;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.header-container .recip {
  background: rgba(255, 255, 255, 0.1);
  color: #f1f5f9;
  border: 1px solid rgba(255, 255, 255, 0.15);
  padding: 3px 12px;
  border-radius: 99px;
  font-size: 11px;
  font-weight: 600;
  backdrop-filter: blur(4px);
}
.chips {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 14px;
}
.chip {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 99px;
  padding: 4px 12px;
  font-size: 11.5px;
  color: #cbd5e1;
  font-weight: 500;
}
.filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: center;
  background: #ffffff;
  padding: 16px 20px;
  border-radius: 12px;
  border: 1px solid var(--border-color);
  margin-bottom: 24px;
  box-shadow: var(--shadow-sm);
}
label.lbl {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
select {
  font-family: inherit;
  font-size: 13px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 8px 12px;
  background: #ffffff;
  color: var(--text-title);
  outline: none;
  min-width: 140px;
  transition: all 0.2s;
  cursor: pointer;
}
select:focus {
  border-color: var(--primary-indigo);
  box-shadow: 0 0 0 3px rgba(79,70,229,0.15);
}
.kpis {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 28px;
}
.kpi {
  flex: 1 1 auto;
  min-width: max-content;
  background: var(--surface-card);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 16px 20px;
  box-shadow: var(--shadow-sm);
  display: flex;
  align-items: center;
  gap: 14px;
  transition: transform 0.2s, box-shadow 0.2s;
}
.kpi:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}
.kpi-icon-wrapper {
  background: #f1f5f9;
  color: var(--text-muted);
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.kpi:hover .kpi-icon-wrapper {
  background: var(--primary-indigo);
  color: #ffffff;
}
.kpi-icon {
  width: 20px;
  height: 20px;
}
.kpi-content {
  display: flex;
  flex-direction: column;
}
.kpi .n {
  font-size: 20px;
  font-weight: 800;
  color: var(--text-title);
  line-height: 1.2;
  white-space: nowrap;
}
.kpi .l {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-top: 2px;
}
.tabs-container {
  background: #e2e8f0;
  border-radius: 10px;
  padding: 4px;
  display: inline-flex;
  gap: 2px;
  margin-bottom: 28px;
  box-shadow: inset 0 1px 2px rgba(0,0,0,0.05);
}
.tab {
  border: none;
  background: none;
  padding: 8px 18px;
  font-family: inherit;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-body);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}
.tab:hover {
  color: var(--text-title);
}
.tab.on {
  background: var(--surface-card);
  color: var(--primary-indigo);
  box-shadow: var(--shadow-sm);
}
.panel.hide { display: none; }
.sec-h {
  font-size: 15px;
  font-weight: 800;
  margin: 24px 0 12px;
  color: var(--text-title);
  letter-spacing: -0.01em;
  display: flex;
  align-items: center;
  gap: 8px;
}
.sec-h::before {
  content: "";
  display: inline-block;
  width: 4px;
  height: 16px;
  background: var(--primary-indigo);
  border-radius: 2px;
}
.proj {
  background: var(--surface-card);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 24px;
  box-shadow: var(--shadow-sm);
  overflow-x: auto;
}
.gantt {
  position: relative;
  min-width: 600px;
}
.grow {
  display: grid;
  grid-template-columns: 180px 1fr;
  align-items: center;
  height: 36px;
  border-bottom: 1px dashed #f1f5f9;
}
.grow:hover {
  background: #f8fafc;
}
.glabel {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-body);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding-right: 12px;
}
.gtrack {
  position: relative;
  height: 36px;
}
.gbar {
  position: absolute;
  top: 9px;
  height: 18px;
  border-radius: 9px;
  font-size: 10px;
  color: #ffffff;
  font-weight: 700;
  line-height: 18px;
  padding: 0 8px;
  white-space: nowrap;
  box-shadow: var(--shadow-sm);
  transition: opacity 0.2s;
}
.gbar.aereo {
  background: linear-gradient(90deg, #3b82f6, #2563eb);
}
.gbar.maritimo {
  background: linear-gradient(90deg, #0ea5e9, #0284c7);
}
.gbar.done {
  background: linear-gradient(90deg, #10b981, #059669);
}
.gbar.est {
  background: repeating-linear-gradient(45deg, #cbd5e1, #cbd5e1 5px, #94a3b8 5px, #94a3b8 10px);
}
.gdot {
  position: absolute;
  top: 9px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #10b981;
  border: 2px solid #ffffff;
  box-shadow: 0 0 0 2px #10b981;
  transition: transform 0.2s;
}
.gdot:hover {
  transform: scale(1.2);
}
.gbar, .gdot { cursor: help; }
.gbar[data-tip]:hover::after, .gdot[data-tip]:hover::after {
  content: attr(data-tip);
  position: absolute;
  left: 50%;
  bottom: 150%;
  transform: translateX(-50%);
  background: #0f172a;
  color: #ffffff;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 10.5px;
  font-weight: 600;
  white-space: nowrap;
  z-index: 50;
  pointer-events: none;
  box-shadow: var(--shadow-lg);
  opacity: 0.95;
}
.goverlay {
  position: absolute;
  left: 180px;
  right: 0;
  top: 0;
  bottom: 24px;
  pointer-events: none;
}
.gaxis {
  position: relative;
  height: 20px;
  margin-left: 180px;
  border-top: 1px solid var(--border-color);
  margin-top: 6px;
}
.gtick {
  position: absolute;
  top: 4px;
  font-size: 9.5px;
  font-weight: 600;
  color: var(--text-muted);
  transform: translateX(-50%);
}
.gtline {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: #e2e8f0;
}
.gtoday {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--danger);
  box-shadow: 0 0 4px rgba(220,38,38,0.4);
}
.gtoday .lab {
  position: absolute;
  top: -3px;
  left: 5px;
  font-size: 9px;
  color: var(--danger);
  font-weight: 800;
  text-transform: uppercase;
  background: var(--bg-main);
  padding: 1px 3px;
  border-radius: 3px;
  border: 1px solid rgba(220,38,38,0.2);
}
.nodate {
  color: var(--warning-text);
  background: var(--warning-bg);
  border: 1px solid rgba(217,119,6,0.15);
  font-size: 11.5px;
  padding: 6px 12px;
  border-radius: 6px;
  font-weight: 500;
  display: inline-block;
}
.upnext {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}
.up {
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 16px;
  background: var(--surface-card);
  box-shadow: var(--shadow-sm);
  transition: transform 0.2s, box-shadow 0.2s;
}
.up:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}
.up .d1 {
  font-size: 14px;
  font-weight: 800;
  color: var(--text-title);
}
.up .d2 {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 4px;
}
.up .d3 {
  font-size: 12px;
  margin-top: 10px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 6px;
}
.glegend {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  margin-top: 14px;
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}
.glegend span {
  display: flex;
  align-items: center;
  gap: 6px;
}
.dotL {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 3px;
}
.pipeline {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 14px;
}
.col {
  background: #f1f5f9;
  border-radius: 12px;
  padding: 12px;
  min-height: 200px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.col h3 {
  font-size: 11.5px;
  font-weight: 800;
  margin: 0 0 4px;
  color: var(--text-title);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.col h3 .c {
  background: #ffffff;
  border-radius: 20px;
  padding: 2px 8px;
  font-weight: 700;
  font-size: 10.5px;
  color: var(--text-title);
  box-shadow: var(--shadow-sm);
}
.card {
  border-radius: 10px;
  padding: 12px;
  border: 1px solid var(--border-color);
  cursor: pointer;
  background: var(--surface-card);
  box-shadow: var(--shadow-sm);
  transition: border-color 0.2s, box-shadow 0.2s;
}
.card:hover {
  border-color: var(--primary-indigo);
  box-shadow: var(--shadow-md);
}
.card .exp {
  font-weight: 800;
  font-size: 13.5px;
  color: var(--text-title);
}
.card .meta {
  font-size: 11.5px;
  color: var(--text-muted);
  margin-top: 4px;
}
.card .tags {
  margin-top: 8px;
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.tag {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 6px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}
.tag.mwt {
  background: var(--info-aereo-bg);
  color: var(--info-aereo-text);
}
.tag.sondel {
  background: #efe6ff;
  color: #6b3fb0;
}
.tag.aereo {
  background: var(--info-aereo-bg);
  color: var(--info-aereo-text);
}
.tag.maritimo {
  background: var(--info-maritimo-bg);
  color: var(--info-maritimo-text);
}
.eta {
  font-size: 11px;
  margin-top: 8px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 5px;
}
.sem {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  position: relative;
}
.sem::after {
  content: "";
  position: absolute;
  inset: -2px;
  border-radius: 50%;
  border: 1px solid currentColor;
  opacity: 0;
  animation: pulse-ring 1.5s infinite;
}
.sem.ok {
  background: var(--success);
  color: var(--success);
}
.sem.warn {
  background: var(--warning);
  color: var(--warning);
}
.sem.warn::after { opacity: 1; }
.sem.late {
  background: var(--danger);
  color: var(--danger);
}
.sem.late::after { opacity: 1; }
.sem.none {
  background: var(--text-muted);
  color: var(--text-muted);
}
@keyframes pulse-ring {
  0% { transform: scale(1); opacity: 0.8; }
  100% { transform: scale(2.2); opacity: 0; }
}

table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  background: var(--surface-card);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: var(--shadow-sm);
}
th, td {
  text-align: left;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
  font-size: 13px;
}
th {
  background: #f8fafc;
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  user-select: none;
}
tr:last-child td {
  border-bottom: none;
}
tbody tr:hover td {
  background: #f8fafc;
}
.grp td {
  background: #f1f5f9;
  font-weight: 800;
  color: var(--text-title);
  font-size: 12px;
  border-top: 1px solid var(--border-color);
}
.muted {
  color: var(--text-muted);
  font-style: italic;
}
.detrow td {
  background: #f8fafc;
  padding: 20px;
  border-top: inset 1px var(--border-color);
}
.det {
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--surface-card);
  margin-bottom: 16px;
  box-shadow: var(--shadow-sm);
}
.det th, .det td {
  font-size: 12px;
  padding: 10px 14px;
}
.det th {
  background: #f1f5f9;
  text-transform: none;
  letter-spacing: 0;
}
.det tr.mtot td {
  background: #f8fafc;
  font-weight: 800;
  border-top: 2px solid var(--border-color);
}
.blk-h {
  font-size: 11px;
  font-weight: 800;
  color: var(--primary-indigo);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin: 18px 0 8px;
}
.artbox {
  margin-bottom: 12px;
}
.art-h {
  font-size: 13px;
  font-weight: 800;
  color: var(--text-title);
  margin-bottom: 6px;
}
.afile {
  color: var(--primary-indigo);
  text-decoration: none;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.afile:hover {
  text-decoration: underline;
}
.tch {
  display: inline-block;
  background: #f1f5f9;
  border-radius: 6px;
  padding: 2px 8px;
  margin: 2px 4px 2px 0;
  font-size: 11.5px;
  color: var(--text-body);
}
.tch b {
  color: var(--primary-indigo);
}
.entbar {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: center;
  background: #ffffff;
  padding: 16px 20px;
  border-radius: 12px;
  border: 1px solid var(--border-color);
  margin-bottom: 20px;
  box-shadow: var(--shadow-sm);
}
.arrcard {
  background: var(--surface-card);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 16px;
  box-shadow: var(--shadow-sm);
}
.arrcard.done {
  opacity: 0.7;
}
.arrh {
  font-size: 15px;
  font-weight: 800;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  color: var(--text-title);
}
.arrh .when {
  margin-left: auto;
  font-size: 12px;
  font-weight: 700;
  padding: 4px 12px;
  border-radius: 8px;
  background: #f1f5f9;
  color: var(--text-body);
}
.arrh .when.done {
  background: var(--success-bg);
  color: var(--success-text);
}
.arrh .when.soon {
  background: var(--warning-bg);
  color: var(--warning-text);
}
.arrsub {
  font-size: 12px;
  color: var(--text-muted);
  margin: 4px 0 16px;
}
.mtx {
  font-size: 12px;
}
.mtx th, .mtx td {
  padding: 8px 10px;
  text-align: center;
  border-bottom: 1px solid var(--border-color);
}
.mtx th:first-child, .mtx td:first-child {
  text-align: left;
  font-weight: 700;
  white-space: nowrap;
}
.mtx thead th {
  background: #f8fafc;
}
.mtx td.z {
  color: var(--border-color);
}
.mtx tr.mtot td {
  background: #f8fafc;
  font-weight: 800;
  border-top: 2px solid var(--border-color);
}
.mtx td.tot, .mtx th.tot {
  background: #f1f5f9;
  font-weight: 800;
}
.foot {
  font-size: 11.5px;
  color: var(--text-muted);
  margin-top: 32px;
  line-height: 1.6;
  text-align: center;
  border-top: 1px solid var(--border-color);
  padding-top: 20px;
}
@media print {
  .tabs-container, .filter-bar, .entbar { display: none !important; }
  .panel.hide { display: block !important; }
  body { background: #ffffff; }
  .wrap { padding: 0; }
  .header-container {
    background: #ffffff;
    color: var(--text-title);
    border: 1px solid var(--border-color);
    box-shadow: none;
    padding: 20px;
  }
  .header-container .sub, .header-container .recip {
    color: var(--text-body);
  }
  .header-container .recip {
    border-color: var(--border-color);
  }
  .chip {
    border-color: var(--border-color);
    color: var(--text-body);
  }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;

/**
 * Construye el documento HTML (dashboard con tabs).
 * @param {Object} args
 * @param {Array<{payload:object, artifacts?:Array, codigo?:string, estado?:string, sap?:string, oc_codigo?:string}>} args.items
 * @param {('MWT'|'CLIENT')} args.audience
 * @param {('es'|'en')} [args.lang='es']
 * @param {Object} [args.filters]
 * @param {string} [args.fileBase]
 * @param {string} [args.generatedBy]
 * @returns {string} HTML standalone
 */
export function buildExpedientesExportHtml({
  items = [],
  audience = INVOICE_AUDIENCE.MWT,
  lang = "es",
  filters = {},
  fileBase = "",
  generatedBy = "",
}) {
  const data = items.map((it) => buildNormalized(it, audience, lang, fileBase));
  const dataJson = JSON.stringify(data).replace(/</g, "\\u003c");
  const recipientLabel = audience === INVOICE_AUDIENCE.MWT ? "Admin / Interno (MWT)" : "Cliente";
  const meta = { recipient: recipientLabel };
  const now = new Date();
  const fecha = now.toLocaleString("es-CR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

  const chips = [];
  if (filters.clienteLabel) chips.push("Cliente: " + esc(filters.clienteLabel));
  if (filters.estadoLabel) chips.push("Estado: " + esc(filters.estadoLabel));
  if (filters.expedienteLabel) chips.push("Expediente: " + esc(filters.expedienteLabel));
  const chipsHtml = chips.map((c) => '<span class="chip">' + c + "</span>").join("");

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Resumen de Exportación · MWT.ONE</title>
<link rel="icon" type="image/png" href="${MWT_FAVICON_DATA_URI}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,300..800;1,300..800&display=swap" rel="stylesheet">
<style>${DASHBOARD_CSS}</style>
</head>
<body>
<div class="wrap">
  <div class="header-container">
    <div class="hc-top">
      <img class="logo-img" src="${MWT_LOGO_DATA_URI}" alt="MWT ONE" />
      <span class="brand-badge">Control Center</span>
    </div>
    <h1>Resumen de Exportación</h1>
    <div class="sub">${esc(fecha)}${generatedBy ? " · " + esc(generatedBy) : ""} &nbsp; <span class="recip">${esc(recipientLabel)}</span></div>
    ${chipsHtml ? `<div class="chips">${chipsHtml}</div>` : ""}
  </div>

  <div class="filter-bar">
    <label class="lbl">Operador</label>
    <select id="fOp"><option value="">Todos</option><option>MWT</option><option>Cliente</option></select>
    <label class="lbl" style="margin-left: 10px;">Modo</label>
    <select id="fModo"><option value="">Todos</option><option>Aereo</option><option>Maritimo</option></select>
  </div>

  <div class="kpis" id="kpis"></div>

  <div class="tabs-container">
    <button class="tab on" data-tab="crono">Cronograma</button>
    <button class="tab" data-tab="tabla">Entrada de pares</button>
    <button class="tab" data-tab="matriz">Hoja de recepción</button>
    <button class="tab" data-tab="exped">Expedientes</button>
  </div>

  <div class="panel" id="p-crono">
    <div class="sec-h">Proyección de atención de entregas</div>
    <div class="proj"><div class="gantt" id="gantt"></div>
      <div class="glegend">
        <span><i class="dotL" style="background:#3b82f6"></i>Aéreo (~10d)</span>
        <span><i class="dotL" style="background:#0ea5e9"></i>Marítimo (~5 sem)</span>
        <span><i class="dotL" style="background:#cbd5e1"></i>Estimado</span>
        <span style="color:#10b981">entregado</span>
      </div>
    </div>
    <div class="sec-h">Próximas entregas</div>
    <div class="upnext" id="upnext"></div>
    <div class="sec-h" style="margin-top:8px">Pipeline por estado</div>
    <div class="pipeline" id="pipeline"></div>
  </div>

  <div class="panel hide" id="p-tabla">
    <div class="entbar">
      <label class="lbl">Modelo</label><select id="ft_model"><option value="">Todos</option></select>
      <label class="lbl" style="margin-left: 10px;">Ordenar</label><select id="ft_sort"><option value="modelo">Modelo / talla</option><option value="fecha">Fecha de llegada</option></select>
    </div>
    <table id="fa_tbl"><thead><tr>
      <th>Modelo</th><th>Talla</th><th>Pares</th><th>Llega</th><th>Estado</th><th>Exped (OC)</th>
    </tr></thead><tbody id="fa_body"></tbody></table>
  </div>

  <div class="panel hide" id="p-matriz">
    <div class="entbar">
      <label class="lbl">Mostrar</label>
      <select id="hr_show"><option value="all">Todos</option><option value="pend">Por llegar</option><option value="done">Entregados</option></select>
      <label class="lbl" style="margin-left: 10px;">Modelo</label><select id="hr_model"><option value="">Todos</option></select>
    </div>
    <div id="recep"></div>
  </div>

  <div class="panel hide" id="p-exped">
    <div class="filter-bar" style="margin-bottom: 16px;">
      <label class="lbl">Agrupar por</label>
      <select id="groupBy"><option value="none">Sin agrupar</option><option value="oc">OC</option><option value="operador">Operador</option><option value="estadoLabel">Estado</option></select>
    </div>
    <table id="tbl">
      <thead><tr>
        <th>Exped.</th><th>OC</th><th>Cliente</th><th>Operador</th><th>Modo</th>
        <th>Pares</th><th>Estado</th><th>Embarque</th><th>Entrega / ETA</th>
      </tr></thead>
      <tbody id="tbody"></tbody>
    </table>
  </div>

  <div class="foot">Cronograma: cuándo llega cada expediente. Tránsito: Aéreo ~10 días, Marítimo ~5 semanas. La entrega real manda sobre el ETA. Documento generado por MWT.ONE.</div>
</div>
<script>window.__EXP=${dataJson};window.__AUD=${JSON.stringify(audience)};window.__META=${JSON.stringify(meta)};</script>
<script>(${clientRuntime.toString()})();</script>
</body>
</html>`;
}
