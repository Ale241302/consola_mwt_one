// =====================================================================
// MWT.ONE · lib/cronogramaData.js
// Agente responsable: [AG-03 FRONTEND]
//
// Capa de datos del CRONOGRAMA en React (página /cronograma) — misma
// matemática que el Resumen de Exportación .html:
//   · hist por expediente desde pipeline.event_log (REGISTRO sintético
//     desde el evento más antiguo o created_at de la fila).
//   · overrides manuales (phase_durations_json: días o rangos {start,end})
//     priorizan; los rangos colocan la barra en fechas exactas.
//   · promedios con jerarquía: stats del CLIENTE → stats GLOBALES del
//     modo → agregado "_ALL" (fases no dependientes del modo; Tránsito
//     excluido) → estándar por defecto.
//   · sin método de envío definido → se asume Aéreo (etiquetado "sup.").
// =====================================================================
import { getToken } from "./api.js";

const API_BASE =
  (import.meta && import.meta.env && import.meta.env.VITE_API_BASE) || "/api";
const DAY = 86400000;

export const STAGES = ["REGISTRO", "PRODUCCION", "PREPARACION", "DESPACHO", "TRANSITO", "EN_DESTINO", "CERRADO"];
export const STAGE_LABELS = {
  es: { REGISTRO: "Registro", PRODUCCION: "Producción", PREPARACION: "Preparación", DESPACHO: "Despacho", TRANSITO: "Tránsito", EN_DESTINO: "En destino", CERRADO: "Cerrado" },
  en: { REGISTRO: "Registry", PRODUCCION: "Production", PREPARACION: "Preparation", DESPACHO: "Dispatch", TRANSITO: "Transit", EN_DESTINO: "At destination", CERRADO: "Closed" },
};
// Paleta de marca navy → mint según avanza el pipeline (igual que el .html).
export const STAGE_COLORS = {
  REGISTRO: "#94A7B8", PRODUCCION: "#013A57", PREPARACION: "#075A78",
  DESPACHO: "#0B7E8F", TRANSITO: "#0FA3A0", EN_DESTINO: "#13B98A", CERRADO: "#334155",
};
export const DEF_DUR = {
  Aereo:    { REGISTRO: 3, PRODUCCION: 15, PREPARACION: 5, DESPACHO: 2, TRANSITO: 10, EN_DESTINO: 5 },
  Maritimo: { REGISTRO: 3, PRODUCCION: 20, PREPARACION: 7, DESPACHO: 3, TRANSITO: 35, EN_DESTINO: 7 },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(path, attempt = 0) {
  const token = getToken();
  const resp = await fetch(`${API_BASE}${path}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  // 429 (rate limit nginx/DRF): backoff exponencial suave, hasta 3 reintentos.
  if (resp.status === 429 && attempt < 3) {
    await sleep(700 * (attempt + 1));
    return fetchJson(path, attempt + 1);
  }
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${path}`);
  return resp.json();
}

export function parseD(s) {
  if (!s) return null;
  const d = new Date(String(s).slice(0, 10) + "T12:00:00");
  return isNaN(d.getTime()) ? null : d;
}
export function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
export function today() { const d = new Date(); d.setHours(12, 0, 0, 0); return d; }
export function dayDiff(a, b) { return Math.max(0, Math.round((b - a) / DAY)); }
export function fmtShort(d, lang = "es") {
  if (!d) return "";
  const MES = lang === "es"
    ? ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]
    : ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  return d.getDate() + " " + MES[d.getMonth()];
}

/** Override guardado: número legacy (días) u objeto {start, end, days}. */
function parseOverride(ov) {
  if (ov == null || ov === "") return null;
  if (typeof ov === "object") {
    const days = Number(ov.days);
    return { days: isFinite(days) ? days : null, start: ov.start || null, end: ov.end || null };
  }
  const n = Number(ov);
  return isFinite(n) ? { days: n, start: null, end: null } : null;
}

function normalizeItem(r, payload, events, overrides) {
  // Historial: primera entrada a cada fase; REGISTRO sintético desde el
  // evento más antiguo o created_at de la fila (expedientes nuevos).
  const stageAt = {};
  let minEv = null;
  (events || []).forEach((ev) => {
    if (!ev || !ev.created_at) return;
    const d = String(ev.created_at).slice(0, 10);
    if (!minEv || d < minEv) minEv = d;
    const st = String(ev.phase_to || "").toUpperCase();
    if (STAGES.indexOf(st) >= 0 && (!stageAt[st] || d < stageAt[st])) stageAt[st] = d;
  });
  if (!stageAt.REGISTRO && minEv) stageAt.REGISTRO = minEv;
  const hist = STAGES.filter((s) => stageAt[s]).map((s) => ({ s, at: stageAt[s] }));
  if (!hist.length && r.created_at) {
    hist.push({ s: "REGISTRO", at: String(r.created_at).slice(0, 10) });
  }

  const phaseOver = {};
  const phaseOverRange = {};
  Object.keys(overrides || {}).forEach((k) => {
    const o = parseOverride(overrides[k]);
    if (o && o.days != null && o.days >= 0) {
      const K = String(k).toUpperCase();
      phaseOver[K] = o.days;
      if (o.start && o.end) phaseOverRange[K] = { a: o.start, b: o.end };
    }
  });

  const fm = String(r.freight_mode || "").toUpperCase();
  const modo = fm === "AIR" ? "Aereo" : (fm === "SEA" ? "Maritimo" : "");
  const lineas = payload && Array.isArray(payload.lineas) ? payload.lineas : [];
  const volumen = lineas.reduce((a, l) => a + (Number(l.qty_planned != null ? l.qty_planned : l.qty) || 0), 0);
  const oc = (payload && payload.operating_company) || {};

  return {
    id: r.id,
    estado: String(r.estado || "REGISTRO").toUpperCase(),
    proforma: (payload && payload.proforma_codigo)
      || (Array.isArray(r.proforma_codigos) && r.proforma_codigos[0]) || r.codigo || "",
    ocCodigo: (payload && payload.oc_codigo)
      || (Array.isArray(r.oc_codigos) && r.oc_codigos[0]) || "",
    expCodigo: r.codigo || "",
    cliente: oc.client_name || "",
    clienteId: r.client_id || null,
    operadoPorMwt: !!oc.operated_by_mwt,
    modo,
    modoSupuesto: !modo,
    etaHint: r.eta ? String(r.eta).slice(0, 10) : "",
    embarque: r.shipment_date ? String(r.shipment_date).slice(0, 10) : "",
    hist,
    phaseOver,
    phaseOverRange,
    lineas,
    volumen,
    skus: Array.from(new Set(lineas.map((l) => l.sku).filter(Boolean))),
  };
}

/** Carga listado + payload/eventos/overrides por expediente + stats globales. */
export async function loadCronograma() {
  const list = await fetchJson("/expedientes/");
  const rows = (Array.isArray(list) ? list : (list && list.results) || [])
    .filter((r) => r && r.is_active !== false);
  // Carga por LOTES (3 expedientes a la vez = máx. 9 requests paralelos)
  // para no disparar el rate-limit (429) con muchos expedientes.
  const items = [];
  const BATCH = 3;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const part = await Promise.all(slice.map(async (r) => {
      const [payload, events, pd] = await Promise.all([
        fetchJson(`/expedientes/${r.id}/factura-payload/`).catch(() => null),
        fetchJson(`/expedientes/${r.id}/events/?limit=200`)
          .then((v) => (Array.isArray(v) ? v : (v && v.results) || [])).catch(() => []),
        fetchJson(`/expedientes/${r.id}/phase-durations/`)
          .then((v) => (v && v.phase_durations) || {}).catch(() => ({})),
      ]);
      return normalizeItem(r, payload, events, pd);
    }));
    items.push(...part);
  }
  const statsGlobal = await fetchJson("/expedientes/phase-stats/")
    .then((v) => (v && v.phase_stats) || null).catch(() => null);
  return { items, statsGlobal };
}

export async function loadClientStats(clienteId) {
  if (!clienteId || clienteId === "ALL") return null;
  return fetchJson(`/expedientes/phase-stats/?client=${encodeURIComponent(clienteId)}`)
    .then((v) => (v && v.phase_stats) || null).catch(() => null);
}

/** Jerarquía: cliente[modo] → global[modo] → _ALL (fases ≠ TRANSITO) → null. */
export function buildAvgs(cliStats, gloStats) {
  const pick = (m, s) => {
    const srcs = [];
    if (cliStats) srcs.push((cliStats[m] || {})[s]);
    if (gloStats) srcs.push((gloStats[m] || {})[s]);
    if (s !== "TRANSITO") {
      if (cliStats) srcs.push((cliStats._ALL || {})[s]);
      if (gloStats) srcs.push((gloStats._ALL || {})[s]);
    }
    for (let i = 0; i < srcs.length; i++) {
      const g = srcs[i];
      if (g && g.avg != null && isFinite(Number(g.avg))) {
        return { avg: Number(g.avg), n: Number(g.n) || 0 };
      }
    }
    return null;
  };
  const out = { Aereo: {}, Maritimo: {} };
  ["Aereo", "Maritimo"].forEach((m) => STAGES.forEach((s) => { out[m][s] = pick(m, s); }));
  return out;
}

/** Promedio efectivo de una fase: real (con n) o estándar (est:true). */
export function avgFor(avgs, modo, s) {
  const m = modo === "Maritimo" ? "Maritimo" : "Aereo";
  const a = avgs && avgs[m] && avgs[m][s];
  if (a) return { avg: a.avg, n: a.n, est: false };
  return { avg: DEF_DUR[m][s] || 5, n: 0, est: true };
}

/** Segmentos del expediente: reales (fechas event_log / rangos manuales) +
 *  estimados (promedios). Misma semántica que el .html. */
export function computeSegments(item, avgs) {
  const delivered = item.estado === "EN_DESTINO" || item.estado === "CERRADO";
  let real = [];
  const h = item.hist || [];
  for (let i = 0; i < h.length; i++) {
    const a = parseD(h[i].at);
    if (!a) continue;
    let b = i + 1 < h.length ? parseD(h[i + 1].at) : null;
    let open = false;
    if (!b) {
      if (item.estado === "CERRADO") b = addDays(a, 1);
      else { b = today(); open = !delivered; }
    }
    if (b < a) b = a;
    real.push({ s: h[i].s, a, b, open: open && i === h.length - 1 });
  }
  if (!real.length) return { real: [], est: [] };

  // Cascada manual: rangos exactos → fechas; sólo-días → encadena; sin
  // override → fechas reales. Fases saltadas con override entran.
  const ovAll = item.phaseOver || {};
  const ovRng = item.phaseOverRange || {};
  if (Object.keys(ovAll).length) {
    const byStage = {};
    real.forEach((sg) => { byStage[sg.s] = sg; });
    const maxIdx = Math.max(
      STAGES.indexOf(real[real.length - 1].s),
      STAGES.indexOf(item.estado)
    );
    let cursor = null;
    const rebuilt = [];
    for (let q = 0; q <= maxIdx; q++) {
      const sName = STAGES[q];
      const rs = byStage[sName];
      const rng = ovRng[sName];
      let aq = null, bq = null;
      if (rng) {
        aq = parseD(rng.a); bq = parseD(rng.b);
        if (!aq || !bq || bq < aq) { aq = null; bq = null; }
      }
      if (!aq) {
        if (ovAll[sName] != null) {
          aq = cursor || (rs ? rs.a : real[0].a);
          bq = addDays(aq, Math.max(0, Math.round(Number(ovAll[sName]))));
        } else if (rs) {
          aq = rs.a; bq = rs.b;
        } else {
          continue;
        }
      }
      rebuilt.push({ s: sName, a: aq, b: bq, open: false });
      if (!cursor || bq > cursor) cursor = bq;
    }
    if (rebuilt.length) {
      rebuilt[rebuilt.length - 1].open =
        !delivered && rebuilt[rebuilt.length - 1].s === item.estado;
      real = rebuilt;
    }
  }

  const est = [];
  if (!delivered) {
    const lastReal = real[real.length - 1];
    let cur = lastReal.b;
    if (lastReal.open && ovAll[lastReal.s] != null) {
      const pe = addDays(lastReal.a, Math.max(0, Math.round(Number(ovAll[lastReal.s]))));
      if (pe > cur) cur = pe;
    }
    const curIdx = STAGES.indexOf(lastReal.s);
    for (let j = curIdx + 1; j <= STAGES.indexOf("EN_DESTINO"); j++) {
      const s2 = STAGES[j];
      const a2 = avgFor(avgs, item.modo, s2);
      const dur = ovAll[s2] != null ? Number(ovAll[s2]) : a2.avg;
      let nb = addDays(cur, Math.max(1, Math.round(dur)));
      if (s2 === "TRANSITO" && ovAll[s2] == null && item.etaHint) {
        const e2 = parseD(item.etaHint);
        if (e2 && e2 > cur) nb = e2;
      }
      est.push({ s: s2, a: cur, b: nb });
      cur = nb;
    }
  }
  return { real, est };
}

/** Duración conocida de una fase del item: override ?? transición cerrada. */
export function itemPhaseDur(item, s) {
  if (item.phaseOver && item.phaseOver[s] != null) {
    return { days: Number(item.phaseOver[s]), manual: true };
  }
  const h = item.hist || [];
  const i = h.findIndex((x) => x.s === s);
  if (i >= 0 && i + 1 < h.length) {
    const a = parseD(h[i].at), b = parseD(h[i + 1].at);
    if (a && b) return { days: dayDiff(a, b), manual: false };
  }
  return null;
}

/** Entrega proyectada: llegada real (entrada a EN_DESTINO) o estimada
 *  (inicio proyectado de EN_DESTINO en la cadena de estimación). */
export function projectedDelivery(item, segs) {
  const delivered = item.estado === "EN_DESTINO" || item.estado === "CERRADO";
  if (delivered) {
    const ed = (segs.real || []).find((x) => x.s === "EN_DESTINO");
    const date = ed ? ed.a : (segs.real.length ? segs.real[segs.real.length - 1].b : null);
    return { date, est: false, done: true };
  }
  const ed = (segs.est || []).find((x) => x.s === "EN_DESTINO");
  if (ed) return { date: ed.a, est: true, done: false };
  if (segs.est && segs.est.length) return { date: segs.est[segs.est.length - 1].b, est: true, done: false };
  return { date: null, est: true, done: false };
}

/** Promedios por SKU: cada fase promedia los expedientes que contienen el SKU. */
export function buildSkuStats(items) {
  const map = new Map();
  (items || []).forEach((it) => {
    (it.skus || []).forEach((sku) => {
      const g = map.get(sku) || {
        sku,
        product: ((it.lineas || []).find((l) => l.sku === sku) || {}).product_label || "",
        phases: {},
        n: 0,
      };
      g.n++;
      STAGES.slice(0, 6).forEach((s) => {
        const d = itemPhaseDur(it, s);
        if (d) (g.phases[s] || (g.phases[s] = [])).push(d.days);
      });
      map.set(sku, g);
    });
  });
  return Array.from(map.values())
    .sort((a, b) => a.sku.localeCompare(b.sku))
    .map((g) => ({
      sku: g.sku,
      product: g.product,
      n: g.n,
      phases: Object.fromEntries(STAGES.slice(0, 6).map((s) => {
        const arr = g.phases[s] || [];
        return [s, arr.length
          ? { avg: arr.reduce((x, y) => x + y, 0) / arr.length, n: arr.length }
          : null];
      })),
    }));
}
