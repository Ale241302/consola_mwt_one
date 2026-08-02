// ─────────────────────────────────────────────────────────────────────
// widgetRegistry — Sprint 2026-08-02 · Dashboard personalizable CLIENT.
//
// Catálogo de widgets del dashboard B2B. Cada entrada:
//   { id, title_es, title_en, sub_es, sub_en,
//     size: 'sm'|'md'|'lg'|'full', bare?, render(ctx) }
//   · bare: el componente ya trae su propia card (no envolver en
//     DashboardCard).
//   · ctx = { enriched, items, avgs, skuStats, me, lang, labelOf, onOpen }
//
// Las gráficas de comparación (cmp_*) y las custom se computan
// client-side con lib/clientDashMetrics.js sobre datos ya scopeados por
// rol — cero endpoints nuevos (R3 intacta). SVG/CSS puro, sin librerías.
// ─────────────────────────────────────────────────────────────────────
import React from "react";
import {
  KpiStrip, PipelineBoard, UpcomingDeliveries, PairsTable, ReceptionSheet,
} from "../../cronograma/CronogramaExtras.jsx";
import PhaseStatsCards from "../../cronograma/PhaseStatsCards.jsx";
import { SizesChart, SkuMethodChart } from "../../cronograma/AnalisisCharts.jsx";
import { CreditBar } from "../../ui/primitives.jsx";
import { EmptyState } from "../DashboardPrimitives.jsx";
import {
  pairsByMonth, usdByPhase, pairsBySku, buildCustomSeries,
} from "../../../lib/clientDashMetrics.js";

const fInt = (n) => Number(n || 0).toLocaleString("es-CR");
const fmtUsd = (n) => "$" + Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
const NAVY = "var(--brand-primary)";
const MINT = "#13B98A";

// ─────────────────────────────────────────────────────────────────────
// Mini-charts propios (los primitives DualBar/BarChart formatean como
// moneda o crudo; aquí necesitamos pares/USD con formato correcto).
// ─────────────────────────────────────────────────────────────────────

/** Barras verticales agrupadas — 1 o 2 series. */
function MiniBars({ labels, series, money = false, height = 170 }) {
  const fmt = money ? fmtUsd : fInt;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${labels.length}, 1fr)`, gap: 10, height, alignItems: "end" }}>
        {labels.map((lbl, i) => (
          <div key={i} style={{ display: "flex", alignItems: "end", justifyContent: "center", gap: 5, height: "100%" }}>
            {series.map((s) => (
              <div key={s.name}
                   title={`${lbl} · ${s.name}: ${fmt(s.values[i] || 0)}`}
                   style={{
                     width: series.length > 1 ? "30%" : "46%",
                     height: `${((s.values[i] || 0) / max) * 100}%`,
                     minHeight: 4, background: s.color,
                     borderRadius: "4px 4px 0 0",
                   }}/>
            ))}
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${labels.length}, 1fr)`, gap: 10, marginTop: 6 }}>
        {labels.map((lbl, i) => (
          <div key={i} className="tabular-nums"
               style={{ textAlign: "center", font: "600 10.5px/1 var(--font-body)", color: "var(--text-tertiary)", overflow: "hidden", textOverflow: "ellipsis" }}>
            {String(lbl).slice(0, 10)}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 16, marginTop: 10, font: "500 11px/1 var(--font-body)", color: "var(--text-secondary)" }}>
        {series.map((s) => (
          <span key={s.name} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, background: s.color, borderRadius: 2 }}/>{s.name}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Donut SVG propio con leyenda (tipo "donut" del builder). */
function DonutChart({ labels, values, money = false }) {
  const fmt = money ? fmtUsd : fInt;
  const PALETTE = ["#013A57", "#075A78", "#0B7E8F", "#0FA3A0", "#13B98A", "#3C6E91", "#5A8FB0", "#2E8B7F", "#6FB3A6", "#94A7B8"];
  const total = values.reduce((a, v) => a + v, 0);
  if (!total) return <EmptyState compact lang="es"/>;
  const R = 15.9155; // circunferencia = 100
  let acc = 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
      <svg viewBox="0 0 42 42" style={{ width: 150, height: 150, flexShrink: 0 }}>
        <circle cx="21" cy="21" r={R} fill="none" stroke="var(--surface-alt, #F1F5F9)" strokeWidth="7"/>
        {values.map((v, i) => {
          const pct = (v / total) * 100;
          const el = (
            <circle key={i} cx="21" cy="21" r={R} fill="none"
                    stroke={PALETTE[i % PALETTE.length]} strokeWidth="7"
                    strokeDasharray={`${pct} ${100 - pct}`} strokeDashoffset={-acc}>
              <title>{`${labels[i]}: ${fmt(v)}`}</title>
            </circle>
          );
          acc += pct;
          return el;
        })}
        <text x="21" y="21" textAnchor="middle" dominantBaseline="central"
              style={{ font: "800 5px/1 var(--font-body)", fill: "var(--text-primary)" }}
              className="tabular-nums">{fmt(total)}</text>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
        {labels.map((lbl, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 7, font: "500 11.5px/1.2 var(--font-body)", color: "var(--text-secondary)" }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: PALETTE[i % PALETTE.length], flexShrink: 0 }}/>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }}>{lbl}</span>
            <span className="tabular-nums" style={{ marginLeft: "auto", fontWeight: 700, color: "var(--text-primary)", paddingLeft: 10 }}>
              {fmt(values[i])}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Línea SVG propia con puntos (tipo "linea" del builder). */
function LineChart({ labels, values, money = false }) {
  const fmt = money ? fmtUsd : fInt;
  const W = 640, H = 170, padL = 12, padR = 12, padT = 14, padB = 24;
  const max = Math.max(1, ...values);
  const n = values.length;
  const x = (i) => padL + (n <= 1 ? (W - padL - padR) / 2 : (i * (W - padL - padR)) / (n - 1));
  const y = (v) => padT + (1 - v / max) * (H - padT - padB);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }} role="img">
      <polyline points={pts} fill="none" stroke={NAVY} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round"/>
      {values.map((v, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(v)} r="3.4" fill={MINT} stroke="var(--surface)" strokeWidth="1.4">
            <title>{`${labels[i]}: ${fmt(v)}`}</title>
          </circle>
          <text x={x(i)} y={H - 8} textAnchor="middle" className="tabular-nums"
                style={{ font: "600 9.5px/1 var(--font-body)", fill: "var(--text-tertiary)" }}>
            {String(labels[i]).slice(0, 8)}
          </text>
        </g>
      ))}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Widgets nuevos (comparaciones + crédito + custom del builder)
// ─────────────────────────────────────────────────────────────────────

/** Crédito de la empresa primaria (GET /api/portal/me/). */
function CreditWidget({ me, lang }) {
  const es = lang === "es";
  const p = me?.primary;
  if (!p || !(Number(p.credito_limit_usd) > 0)) {
    return (
      <EmptyState compact lang={lang}
        title={es ? "Sin línea de crédito" : "No credit line"}
        hint={es ? "Tu empresa no tiene crédito aprobado registrado." : "Your company has no approved credit registered."}/>
    );
  }
  return (
    <div>
      <CreditBar limit={Number(p.credito_limit_usd) || 0} used={Number(p.credito_usado) || 0}/>
      <div className="tabular-nums" style={{ marginTop: 10, font: "600 12px/1.4 var(--font-mono)", color: "var(--text-secondary)" }}>
        {es ? "Disponible" : "Available"}:{" "}
        <span style={{ color: "var(--success)", fontWeight: 800 }}>{fmtUsd(p.credito_disponible)}</span>
        {" · "}{es ? "plazo" : "terms"} {p.credit_days || 0}d
      </div>
    </div>
  );
}

/** Pares pedidos vs entregados por mes (cmp_month). */
function CmpMonthChart({ enriched, lang }) {
  const es = lang === "es";
  const { labels, pedidos, entregados } = pairsByMonth(enriched, { lang });
  return (
    <MiniBars labels={labels} series={[
      { name: es ? "Pedidos" : "Ordered", color: NAVY, values: pedidos },
      { name: es ? "Entregados" : "Delivered", color: MINT, values: entregados },
    ]}/>
  );
}

/** USD cliente por fase visual (cmp_usd_fase). */
function CmpUsdFaseChart({ enriched, lang }) {
  const { labels, values } = usdByPhase(enriched, lang);
  return <MiniBars labels={labels} money series={[{ name: "USD", color: NAVY, values }]}/>;
}

/** Top SKUs por pares (cmp_pairs_sku). */
function CmpPairsSkuChart({ enriched, lang }) {
  const es = lang === "es";
  const { labels, values } = pairsBySku(enriched, 8);
  if (!labels.length) return <EmptyState compact lang={lang}/>;
  return <MiniBars labels={labels} series={[{ name: es ? "Pares" : "Pairs", color: NAVY, values }]}/>;
}

/** Gráfica custom del builder: métrica × dimensión × tipo. */
export function CustomChart({ config = {}, enriched, lang }) {
  const { labels, values } = buildCustomSeries(enriched, { ...config, lang });
  const money = config.metric === "usd";
  if (!labels.length) return <EmptyState compact lang={lang}/>;
  if (config.chart === "donut") return <DonutChart labels={labels} values={values} money={money}/>;
  if (config.chart === "linea") return <LineChart labels={labels} values={values} money={money}/>;
  return <MiniBars labels={labels} money={money}
                   series={[{ name: "·", color: NAVY, values }]}/>;
}

// ─────────────────────────────────────────────────────────────────────
// Catálogo
// ─────────────────────────────────────────────────────────────────────
export const WIDGETS = [
  {
    id: "kpis", size: "full", bare: true,
    title_es: "Indicadores", title_en: "KPIs",
    sub_es: "Expedientes, entregados, tránsito y pares de tu operación",
    sub_en: "Files, delivered, in-transit and pairs of your operation",
    render: (ctx) => <KpiStrip enriched={ctx.enriched} lang={ctx.lang}/>,
  },
  {
    id: "pipeline", size: "full",
    title_es: "Pipeline por fase", title_en: "Pipeline by phase",
    sub_es: "Dónde está cada pedido", sub_en: "Where each order stands",
    render: (ctx) => <PipelineBoard enriched={ctx.enriched} lang={ctx.lang} labelOf={ctx.labelOf} onOpen={ctx.onOpen}/>,
  },
  {
    id: "upcoming", size: "full",
    title_es: "Próximas entregas", title_en: "Upcoming deliveries",
    sub_es: "Fechas de entrega reales y estimadas", sub_en: "Real and estimated delivery dates",
    render: (ctx) => <UpcomingDeliveries enriched={ctx.enriched} lang={ctx.lang} labelOf={ctx.labelOf} onOpen={ctx.onOpen}/>,
  },
  {
    id: "sizes", size: "full", bare: true,
    title_es: "Pares por talla", title_en: "Pairs by size",
    sub_es: "Distribución de tallas con curva de demanda", sub_en: "Size distribution with demand curve",
    render: (ctx) => <SizesChart items={ctx.items} lang={ctx.lang} isClient/>,
  },
  {
    id: "sku_method", size: "full", bare: true,
    title_es: "SKU × método", title_en: "SKU × mode",
    sub_es: "Aéreo vs marítimo por SKU", sub_en: "Air vs sea by SKU",
    render: (ctx) => <SkuMethodChart items={ctx.items} lang={ctx.lang}/>,
  },
  {
    id: "phase_stats", size: "full", bare: true,
    title_es: "Tiempos por fase", title_en: "Phase timings",
    sub_es: "Promedios por método y por SKU", sub_en: "Averages by mode and by SKU",
    render: (ctx) => <PhaseStatsCards avgs={ctx.avgs} skuStats={ctx.skuStats} lang={ctx.lang}/>,
  },
  {
    id: "pairs_table", size: "full",
    title_es: "Entrada de pares", title_en: "Pairs intake",
    sub_es: "Tabla modelo × talla", sub_en: "Model × size table",
    render: (ctx) => <PairsTable enriched={ctx.enriched} lang={ctx.lang} labelOf={ctx.labelOf}/>,
  },
  {
    id: "reception", size: "full",
    title_es: "Hoja de recepción", title_en: "Reception sheet",
    sub_es: "Guía de recepción por pedido", sub_en: "Per-order reception guide",
    render: (ctx) => <ReceptionSheet enriched={ctx.enriched} lang={ctx.lang} labelOf={ctx.labelOf} onOpen={ctx.onOpen}/>,
  },
  {
    id: "credit", size: "md",
    title_es: "Crédito", title_en: "Credit",
    sub_es: "Límite, usado y disponible", sub_en: "Limit, used and available",
    render: (ctx) => <CreditWidget me={ctx.me} lang={ctx.lang}/>,
  },
  {
    id: "cmp_month", size: "md",
    title_es: "Pedidos vs entregados", title_en: "Ordered vs delivered",
    sub_es: "Pares por mes (últimos 8)", sub_en: "Pairs by month (last 8)",
    render: (ctx) => <CmpMonthChart enriched={ctx.enriched} lang={ctx.lang}/>,
  },
  {
    id: "cmp_usd_fase", size: "md",
    title_es: "USD por fase", title_en: "USD by phase",
    sub_es: "Valor de tu operación por etapa", sub_en: "Value of your operation by stage",
    render: (ctx) => <CmpUsdFaseChart enriched={ctx.enriched} lang={ctx.lang}/>,
  },
  {
    id: "cmp_pairs_sku", size: "md",
    title_es: "Pares por SKU", title_en: "Pairs by SKU",
    sub_es: "Top 8 SKUs por pares pedidos", sub_en: "Top 8 SKUs by ordered pairs",
    render: (ctx) => <CmpPairsSkuChart enriched={ctx.enriched} lang={ctx.lang}/>,
  },
];

const BY_ID = new Map(WIDGETS.map((w) => [w.id, w]));
export const widgetById = (id) => BY_ID.get(id) || null;
export const CATALOG_IDS = WIDGETS.map((w) => w.id);

/** Título visible de una entrada de layout (built-in o custom). */
export function titleOf(entry, lang) {
  if (entry.id.startsWith("custom:")) return entry.config?.title || "Custom";
  const w = BY_ID.get(entry.id);
  if (!w) return entry.id;
  return lang === "es" ? w.title_es : w.title_en;
}

/** Subtítulo visible de una entrada de layout. */
export function subtitleOf(entry, lang) {
  const w = BY_ID.get(entry.id);
  if (!w) return "";
  return lang === "es" ? w.sub_es : w.sub_en;
}

// Opciones del builder (i18n inline, patrón del repo).
export const BUILDER_OPTS = {
  metrics: [
    { id: "pares",   es: "Pares",      en: "Pairs" },
    { id: "usd",     es: "USD",        en: "USD" },
    { id: "pedidos", es: "Pedidos",    en: "Orders" },
  ],
  dims: [
    { id: "sku",   es: "SKU",   en: "SKU" },
    { id: "talla", es: "Talla", en: "Size" },
    { id: "fase",  es: "Fase",  en: "Phase" },
    { id: "mes",   es: "Mes",   en: "Month" },
  ],
  charts: [
    { id: "barras", es: "Barras", en: "Bars" },
    { id: "donut",  es: "Donut",  en: "Donut" },
    { id: "linea",  es: "Línea",  en: "Line" },
  ],
};

/** Título automático del builder: "Pares por SKU". */
export function autoTitle({ metric, dim }, lang) {
  const m = BUILDER_OPTS.metrics.find((x) => x.id === metric);
  const d = BUILDER_OPTS.dims.find((x) => x.id === dim);
  const ml = m ? (lang === "es" ? m.es : m.en) : metric;
  const dl = d ? (lang === "es" ? d.es : d.en) : dim;
  return `${ml} ${lang === "es" ? "por" : "by"} ${dl}`;
}
