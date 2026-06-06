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
  const daiRate = crr.dai != null ? Number(crr.dai) : 0.14;
  const leyRate = crr.ley != null ? Number(crr.ley) : 0.01;
  const ivaRate = crr.iva != null ? Number(crr.iva) : 0.13;
  const dai = exc.dai ? 0 : cif * daiRate;
  const ley = exc.ley ? 0 : cif * leyRate;
  const iva = exc.iva ? 0 : cif * ivaRate;
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
    document.getElementById("kpis").innerHTML = cards.map(function (c) { return '<div class="kpi"><div class="n">' + c[1] + '</div><div class="l">' + c[0] + "</div></div>"; }).join("");
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
      var d3 = p.done
        ? '<span class="sem ok"></span>Entregado'
        : '<span class="sem ' + sem(e) + '"></span>' + (dias <= 0 ? "entrega hoy/vencida" : "en " + dias + " días");
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
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin:0; background:#f6f7f9; color:#1c2430; font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
.wrap { max-width:1180px; margin:0 auto; padding:18px 20px 60px; }
h1 { font-size:19px; margin:0 0 2px; }
.sub { color:#6b7785; font-size:12.5px; margin-bottom:14px; }
.recip { display:inline-block; padding:3px 10px; border-radius:999px; font-size:11px; font-weight:700; background:#e3f0ff; color:#1a5fb4; }
.bar { display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-bottom:14px; }
.bar .spacer { flex:1; }
label.lbl { font-size:12px; color:#6b7785; margin-right:4px; }
select { font:inherit; border:1px solid #d2d8e0; border-radius:7px; padding:7px 9px; background:#fff; color:#1c2430; }
.chips { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px; }
.chip { background:#eef3fb; border:1px solid #dbe6f5; border-radius:999px; padding:3px 10px; font-size:11px; color:#1a5fb4; font-weight:600; }
.kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; margin-bottom:16px; }
.kpi { background:#fff; border:1px solid #e6e9ee; border-radius:10px; padding:11px 13px; }
.kpi .n { font-size:19px; font-weight:700; }
.kpi .l { font-size:11px; color:#6b7785; text-transform:uppercase; letter-spacing:.03em; }
.tabs { display:flex; gap:4px; border-bottom:2px solid #e6e9ee; margin-bottom:16px; flex-wrap:wrap; }
.tab { border:none; background:none; padding:9px 15px; font-size:13.5px; font-weight:600; color:#6b7785; border-bottom:2px solid transparent; margin-bottom:-2px; border-radius:0; cursor:pointer; }
.tab.on { color:#1f6feb; border-bottom-color:#1f6feb; }
.panel.hide { display:none; }
.sec-h { font-size:13px; font-weight:700; margin:4px 0 10px; color:#1c2430; }
.proj { background:#fff; border:1px solid #e6e9ee; border-radius:10px; padding:14px 16px 18px; margin-bottom:20px; }
.gantt { position:relative; }
.grow { display:grid; grid-template-columns:200px 1fr; align-items:center; height:30px; }
.glabel { font-size:11.5px; font-weight:600; color:#43505f; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; padding-right:8px; }
.gtrack { position:relative; height:30px; }
.gbar { position:absolute; top:7px; height:16px; border-radius:8px; font-size:10px; color:#fff; font-weight:700; line-height:16px; padding:0 6px; white-space:nowrap; }
.gbar.aereo { background:#1a7f48; } .gbar.maritimo { background:#1a6a8f; } .gbar.done { background:#2da44e; }
.gbar.est { background:repeating-linear-gradient(45deg,#9aa3b0,#9aa3b0 5px,#b3bac4 5px,#b3bac4 10px); }
.gdot { position:absolute; top:7px; width:16px; height:16px; border-radius:50%; background:#2da44e; border:2px solid #fff; box-shadow:0 0 0 1px #2da44e; }
.gbar, .gdot { cursor:help; }
.gbar[data-tip]:hover::after, .gdot[data-tip]:hover::after { content:attr(data-tip); position:absolute; left:50%; bottom:140%; transform:translateX(-50%); background:#1c2430; color:#fff; padding:3px 8px; border-radius:5px; font-size:10px; font-weight:600; white-space:nowrap; z-index:20; pointer-events:none; box-shadow:0 2px 8px rgba(0,0,0,.25); }
.goverlay { position:absolute; left:200px; right:0; top:0; bottom:22px; pointer-events:none; }
.gaxis { position:relative; height:18px; margin-left:200px; border-top:1px solid #e6e9ee; margin-top:4px; }
.gtick { position:absolute; top:2px; font-size:9.5px; color:#8a93a0; transform:translateX(-50%); }
.gtline { position:absolute; top:0; bottom:0; width:1px; background:#eef1f5; }
.gtoday { position:absolute; top:0; bottom:0; width:2px; background:#cf222e; opacity:.55; }
.gtoday .lab { position:absolute; top:-2px; left:3px; font-size:9px; color:#cf222e; font-weight:700; }
.nodate { color:#b3804b; font-size:11px; font-style:italic; }
.upnext { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:10px; margin-bottom:20px; }
.up { border:1px solid #e6e9ee; border-radius:9px; padding:10px 12px; background:#fff; }
.up .d1 { font-size:13px; font-weight:700; } .up .d2 { font-size:11.5px; color:#6b7785; margin-top:2px; } .up .d3 { font-size:11.5px; margin-top:5px; font-weight:600; }
.glegend { font-size:10.5px; color:#8a93a0; margin-top:8px; } .glegend span { margin-right:12px; }
.dotL { display:inline-block; width:9px; height:9px; border-radius:3px; vertical-align:middle; margin-right:3px; }
.pipeline { display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:10px; }
.col { background:#fff; border:1px solid #e6e9ee; border-radius:10px; padding:8px; min-height:70px; }
.col h3 { font-size:11.5px; margin:2px 4px 8px; color:#43505f; text-transform:uppercase; letter-spacing:.03em; display:flex; justify-content:space-between; }
.col h3 .c { background:#eef1f5; border-radius:10px; padding:0 7px; font-weight:700; color:#43505f; }
.card { border-radius:8px; padding:8px 9px; margin-bottom:7px; border:1px solid #e6e9ee; cursor:pointer; background:#fbfcfe; }
.card:hover { border-color:#1f6feb; }
.card .exp { font-weight:700; font-size:13.5px; } .card .meta { font-size:11.5px; color:#6b7785; margin-top:2px; }
.card .tags { margin-top:5px; display:flex; gap:4px; flex-wrap:wrap; }
.tag { font-size:10.5px; padding:1px 6px; border-radius:10px; font-weight:600; }
.tag.mwt { background:#e3f0ff; color:#1a5fb4; } .tag.sondel { background:#efe6ff; color:#6b3fb0; }
.tag.aereo { background:#e6f7ee; color:#1a7f48; } .tag.maritimo { background:#e6f1f7; color:#1a6a8f; }
.eta { font-size:11.5px; margin-top:4px; font-weight:600; }
.sem { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:5px; vertical-align:middle; }
.sem.ok { background:#2da44e; } .sem.warn { background:#d4a72c; } .sem.late { background:#cf222e; } .sem.none { background:#c8ced6; }
table { width:100%; border-collapse:collapse; background:#fff; border:1px solid #e6e9ee; border-radius:10px; overflow:hidden; }
th, td { text-align:left; padding:8px 10px; border-bottom:1px solid #eef1f5; font-size:12.5px; }
th { background:#f0f3f7; font-size:11px; text-transform:uppercase; letter-spacing:.03em; color:#5a6675; }
tr:last-child td { border-bottom:none; }
.grp td { background:#eef3fb; font-weight:700; color:#1a5fb4; font-size:12px; }
.muted { color:#9aa3b0; font-style:italic; }
.detrow td { background:#f7f9fc; padding:12px 14px; }
.det { border:1px solid #e1e6ee; border-radius:8px; background:#fff; margin-bottom:8px; }
.det th, .det td { font-size:11.5px; padding:6px 9px; } .det th { background:#eef2f7; text-transform:none; letter-spacing:0; }
.det tr.mtot td { background:#f7f9fc; font-weight:700; border-top:2px solid #d6dde6; }
.blk-h { font-size:11px; font-weight:700; color:#1a5fb4; text-transform:uppercase; letter-spacing:.04em; margin:6px 0 4px; }
.artbox { margin-bottom:8px; } .art-h { font-size:12px; font-weight:700; color:#1c2430; margin-bottom:3px; }
.afile { color:#1f6feb; text-decoration:none; font-weight:600; }
.tch { display:inline-block; background:#eef3fb; border-radius:6px; padding:1px 7px; margin:2px 3px 0 0; font-size:11px; } .tch b { color:#1a5fb4; }
.entbar { display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-bottom:14px; }
.arrcard { background:#fff; border:1px solid #e6e9ee; border-radius:11px; padding:14px 16px; margin-bottom:14px; } .arrcard.done { opacity:.62; }
.arrh { font-size:14.5px; display:flex; flex-wrap:wrap; align-items:baseline; gap:8px; }
.arrh .when { margin-left:auto; font-size:13px; font-weight:700; padding:2px 10px; border-radius:7px; background:#eef3fb; color:#1a5fb4; }
.arrh .when.done { background:#e6f7ee; color:#1a7f48; } .arrh .when.soon { background:#fff4e5; color:#b45309; }
.arrsub { font-size:11.5px; color:#6b7785; margin:3px 0 12px; }
.mtx { font-size:11.5px; } .mtx th, .mtx td { padding:5px 8px; text-align:center; border-bottom:1px solid #eef1f5; }
.mtx th:first-child, .mtx td:first-child { text-align:left; font-weight:600; white-space:nowrap; }
.mtx thead th { background:#f0f3f7; } .mtx td.z { color:#cfd6df; }
.mtx tr.mtot td { background:#f7f9fc; font-weight:700; border-top:2px solid #d6dde6; }
.mtx td.tot, .mtx th.tot { background:#eef3fb; font-weight:700; }
.foot { font-size:11.5px; color:#8a93a0; margin-top:18px; line-height:1.5; }
@media print { .tabs,.bar,.entbar { display:none !important; } .panel.hide { display:block !important; } body { background:#fff; } * { -webkit-print-color-adjust:exact; print-color-adjust:exact; } }
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
<style>${DASHBOARD_CSS}</style>
</head>
<body>
<div class="wrap">
  <h1>MWT.ONE · Resumen de Exportación</h1>
  <div class="sub">${esc(fecha)}${generatedBy ? " · " + esc(generatedBy) : ""} &nbsp; <span class="recip">${esc(recipientLabel)}</span></div>
  ${chipsHtml ? `<div class="chips">${chipsHtml}</div>` : ""}

  <div class="bar">
    <label class="lbl">Operador</label>
    <select id="fOp"><option value="">Todos</option><option>MWT</option><option>Cliente</option></select>
    <label class="lbl">Modo</label>
    <select id="fModo"><option value="">Todos</option><option>Aereo</option><option>Maritimo</option></select>
  </div>

  <div class="kpis" id="kpis"></div>

  <div class="tabs">
    <button class="tab on" data-tab="crono">Cronograma</button>
    <button class="tab" data-tab="tabla">Entrada de pares</button>
    <button class="tab" data-tab="matriz">Hoja de recepción</button>
    <button class="tab" data-tab="exped">Expedientes</button>
  </div>

  <div class="panel" id="p-crono">
    <div class="sec-h">Proyección de atención de entregas</div>
    <div class="proj"><div class="gantt" id="gantt"></div>
      <div class="glegend">
        <span><i class="dotL" style="background:#1a7f48"></i>Aéreo (~10d)</span>
        <span><i class="dotL" style="background:#1a6a8f"></i>Marítimo (~5 sem)</span>
        <span><i class="dotL" style="background:#9aa3b0"></i>Estimado</span>
        <span style="color:#2da44e">entregado</span>
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
      <label class="lbl">Ordenar</label><select id="ft_sort"><option value="modelo">Modelo / talla</option><option value="fecha">Fecha de llegada</option></select>
    </div>
    <table id="fa_tbl"><thead><tr>
      <th>Modelo</th><th>Talla</th><th>Pares</th><th>Llega</th><th>Estado</th><th>Exped (OC)</th>
    </tr></thead><tbody id="fa_body"></tbody></table>
  </div>

  <div class="panel hide" id="p-matriz">
    <div class="entbar">
      <label class="lbl">Mostrar</label>
      <select id="hr_show"><option value="all">Todos</option><option value="pend">Por llegar</option><option value="done">Entregados</option></select>
      <label class="lbl">Modelo</label><select id="hr_model"><option value="">Todos</option></select>
    </div>
    <div id="recep"></div>
  </div>

  <div class="panel hide" id="p-exped">
    <div class="bar">
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
