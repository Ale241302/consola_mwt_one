// =====================================================================
// MWT.ONE · lib/clientDashMetrics.js
// Sprint 2026-08-02 · Dashboard personalizable CLIENT (B2B).
//
// Métricas PURAS (sin fetch, sin React) computadas client-side sobre el
// array `enriched` del cronograma ([{ it, segs, delivery }]) — alimentan
// los widgets de comparación del dashboard del cliente y el builder de
// gráficas custom. Todo deriva de endpoints ya scopeados por rol
// (timeline-bundle); aquí no se pide ni se recibe dato nuevo.
//
// R3 · POL_VISIBILIDAD: solo se usa unit_price_client; el precio MWT y
// el código EXP interno nunca entran a estas agregaciones.
// =====================================================================
import {
  DISPLAY_STAGES, DISPLAY_STAGE_LABELS, displayStage,
} from "./cronogramaData.js";

const qtyOf = (l) => Number(l.qty_planned != null ? l.qty_planned : l.qty) || 0;
const usdOf = (l) => qtyOf(l) * (Number(l.unit_price_client) || 0);

const MONTHS = {
  es: ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"],
  en: ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"],
};

/** Clave de bucket mensual "YYYY-MM" de un Date. */
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/** Los últimos `n` buckets mensuales terminando en el mes actual. */
function lastMonths(n, lang) {
  const names = MONTHS[lang] || MONTHS.es;
  const now = new Date();
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1, 12);
    out.push({ key: monthKey(d), label: names[d.getMonth()] });
  }
  return out;
}

/** created_at del expediente (fila cruda) como Date local, o null. */
function createdAtOf(it) {
  const raw = it?._row?.created_at;
  if (!raw) return null;
  const d = new Date(String(raw).slice(0, 10) + "T12:00:00");
  return isNaN(d.getTime()) ? null : d;
}

// ─────────────────────────────────────────────────────────────────────
// pairsByMonth — comparación pares PEDIDOS (created_at) vs ENTREGADOS
// (delivery real) por mes, últimos `months` meses. Alimenta cmp_month.
// ─────────────────────────────────────────────────────────────────────
export function pairsByMonth(enriched, { months = 8, lang = "es" } = {}) {
  const buckets = lastMonths(months, lang);
  const idx = new Map(buckets.map((b, i) => [b.key, i]));
  const pedidos = buckets.map(() => 0);
  const entregados = buckets.map(() => 0);
  (enriched || []).forEach((e) => {
    const vol = Number(e?.it?.volumen) || 0;
    const c = createdAtOf(e?.it);
    if (c && idx.has(monthKey(c))) pedidos[idx.get(monthKey(c))] += vol;
    const del = e?.delivery;
    if (del && del.done && del.date instanceof Date && !isNaN(del.date)) {
      const k = monthKey(del.date);
      if (idx.has(k)) entregados[idx.get(k)] += vol;
    }
  });
  return { labels: buckets.map((b) => b.label), pedidos, entregados };
}

// ─────────────────────────────────────────────────────────────────────
// usdByPhase — USD cliente (Σ qty × unit_price_client) por fase VISUAL.
// Alimenta cmp_usd_fase.
// ─────────────────────────────────────────────────────────────────────
export function usdByPhase(enriched, lang = "es") {
  const L = DISPLAY_STAGE_LABELS[lang] || DISPLAY_STAGE_LABELS.es;
  const totals = new Map(DISPLAY_STAGES.map((s) => [s, 0]));
  (enriched || []).forEach((e) => {
    const stage = displayStage(e?.it?.estado || "REGISTRO");
    const usd = (e?.it?.lineas || []).reduce((a, l) => a + usdOf(l), 0);
    totals.set(stage, (totals.get(stage) || 0) + usd);
  });
  return {
    labels: DISPLAY_STAGES.map((s) => L[s] || s),
    values: DISPLAY_STAGES.map((s) => Math.round(totals.get(s) || 0)),
  };
}

// ─────────────────────────────────────────────────────────────────────
// pairsBySku — top SKUs por pares pedidos. Alimenta cmp_pairs_sku y el
// builder de gráficas custom.
// ─────────────────────────────────────────────────────────────────────
export function pairsBySku(enriched, limit = 8) {
  const bySku = new Map();
  (enriched || []).forEach((e) => {
    (e?.it?.lineas || []).forEach((l) => {
      if (!l.sku) return;
      bySku.set(l.sku, (bySku.get(l.sku) || 0) + qtyOf(l));
    });
  });
  const top = Array.from(bySku.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
  return { labels: top.map(([sku]) => sku), values: top.map(([, v]) => v) };
}

// ─────────────────────────────────────────────────────────────────────
// buildCustomSeries — núcleo del builder: métrica × dimensión.
//   config.metric: "pares" | "usd" | "pedidos"
//   config.dim:    "sku" | "talla" | "fase" | "mes"
// Devuelve { labels, values } listo para barras / donut / línea.
// ─────────────────────────────────────────────────────────────────────
export function buildCustomSeries(enriched, config = {}) {
  const { metric = "pares", dim = "sku", limit = 10, lang = "es" } = config;
  const list = enriched || [];

  // Valor de una línea según la métrica (para dims a nivel línea).
  const lineValue = (l) => (metric === "usd" ? usdOf(l) : qtyOf(l));
  // Valor de un expediente completo (para dims a nivel expediente).
  const itemValue = (it) => (metric === "pedidos"
    ? 1
    : (it.lineas || []).reduce((a, l) => a + lineValue(l), 0));

  if (dim === "mes") {
    const buckets = lastMonths(8, lang);
    const idx = new Map(buckets.map((b, i) => [b.key, i]));
    const values = buckets.map(() => 0);
    list.forEach((e) => {
      const c = createdAtOf(e?.it);
      if (!c) return;
      const i = idx.get(monthKey(c));
      if (i != null) values[i] += itemValue(e.it);
    });
    return { labels: buckets.map((b) => b.label), values };
  }

  const acc = new Map();
  if (dim === "fase") {
    const L = DISPLAY_STAGE_LABELS[lang] || DISPLAY_STAGE_LABELS.es;
    DISPLAY_STAGES.forEach((s) => acc.set(s, 0));
    list.forEach((e) => {
      const s = displayStage(e?.it?.estado || "REGISTRO");
      acc.set(s, (acc.get(s) || 0) + itemValue(e.it));
    });
    // La fase respeta el orden del pipeline (no se ordena por valor).
    return {
      labels: DISPLAY_STAGES.map((s) => L[s] || s),
      values: DISPLAY_STAGES.map((s) => Math.round((acc.get(s) || 0) * 100) / 100),
    };
  }

  // sku | talla — agregado a nivel línea, top N por valor.
  // Sprint 2026-08-02 (ADMIN) · dims extra a nivel expediente:
  //   cliente → it.cliente (nombre) o it.clienteId
  //   marca   → it._row.brand_id, con label opcional vía config.brandNameOf
  if (dim === "cliente" || dim === "marca") {
    const brandNameOf = typeof config.brandNameOf === "function"
      ? config.brandNameOf : null;
    list.forEach((e) => {
      const it = e?.it;
      if (!it) return;
      let key = null;
      if (dim === "cliente") {
        key = it.cliente || it.clienteId || null;
      } else {
        const bid = it._row?.brand_id;
        key = bid ? (brandNameOf?.(bid) || bid) : null;
      }
      if (!key) return;
      acc.set(key, (acc.get(key) || 0) + itemValue(it));
    });
    const top = Array.from(acc.entries())
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);
    return {
      labels: top.map(([k]) => String(k)),
      values: top.map(([, v]) => Math.round(v * 100) / 100),
    };
  }

  list.forEach((e) => {
    (e?.it?.lineas || []).forEach((l) => {
      const key = dim === "talla"
        ? ((l.size && String(l.size).trim()) || "—")
        : l.sku;
      if (!key) return;
      acc.set(key, (acc.get(key) || 0) + lineValue(l));
    });
  });
  const top = Array.from(acc.entries())
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
  return {
    labels: top.map(([k]) => k),
    values: top.map(([, v]) => Math.round(v * 100) / 100),
  };
}
