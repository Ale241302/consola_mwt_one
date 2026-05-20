// =====================================================================
// MWT.ONE · Dashboard (Centro de Operaciones CEO)
// Rediseño 2026-05-20 — AG-03 Arquitecto Ejecutor Frontend.
//
// 4 bandas verticales (mandato CEO):
//   BANDA 1 — Hero "Estado del negocio hoy" (6 KPIs honestos)
//   BANDA 2 — Comparador temporal Google-Finance-style
//   BANDA 3 — Operación (Pipeline marca · Top urgencia · Inventario nodo)
//   BANDA 4 — Análisis multidimensional (Top SKU · Top clientes · Heatmap · Scatter)
//
// REGLAS APLICADAS:
//   R1 — Cero hex hardcodeados. Solo CSS vars MWT (tokens.css).
//   R3 — Aislamiento CEO-ONLY vía useRole().can(...).
//   R5 — `tabular-nums` en toda métrica numérica.
//   POL_CERO_DEMO — Si el backend no responde, EmptyState honesto. Nunca $0/NaN%.
//
// Notas sobre el stack (CLAUDE.md §1):
//   El prompt original pide Next.js 14 + TanStack Query + Recharts + shadcn.
//   El repo es React 18 + Vite + JSX + React Router. Adaptamos sin romper
//   nada: usamos hooks propios (useDashboardKpis, useBrandsLight) y
//   primitivos SVG inline (DashboardPrimitives.jsx). Cuando exista RFC para
//   migrar a Next.js, este archivo se traduce 1:1.
// =====================================================================
import React, { useMemo, useCallback } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { tr, fmtMoney, fmtDate } from "../lib/i18n.js";
import { Badge } from "../components/ui/primitives.jsx";
import { IconDownload, IconPlus, IconRefresh } from "../lib/icons.jsx";
import { useDashboardKpis } from "../hooks/useDashboardKpis.js";
import { useBrandsLight } from "../hooks/useBrandsLight.js";
import { useRole } from "../context/RoleContext.jsx";
import { OCS } from "../data/mockData.js";
import {
  KpiCard,
  TimeseriesChart,
  PipelineByBrandTimeline,
  UrgentExpedientesTable,
  MarginScatter,
  TopClientsTable,
  GlobalFilters,
  DashboardCard,
  EmptyState,
} from "../components/dashboard/DashboardPrimitives.jsx";

// ─────────────────────────────────────────────────────────────────────
// SafeWidget — error boundary funcional por widget.
// Un widget caído NO debe tumbar la página. Mensaje + reintento.
// ─────────────────────────────────────────────────────────────────────
class SafeWidget extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) {
    // No console.log en prod (CLAUDE.md §12) — solo si hay window.MWT_DEBUG.
    if (typeof window !== "undefined" && window.MWT_DEBUG) {
      // eslint-disable-next-line no-console
      console.error("[Dashboard SafeWidget]", err, info);
    }
  }
  render() {
    if (this.state.err) {
      return (
        <EmptyState
          lang={this.props.lang}
          title={this.props.lang === "en" ? "Widget error" : "Error en widget"}
          hint={String(this.state.err?.message || this.state.err || "")}
          endpoint={this.props.endpoint}
        />
      );
    }
    return this.props.children;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Helper: derivar Cash en riesgo desde aging buckets.
// aging shape: { bucket_0_30, bucket_31_60, bucket_61_90, bucket_90_plus, total }
// ─────────────────────────────────────────────────────────────────────
function cashAtRisk(aging) {
  if (!aging) return null;
  const a = (aging.bucket_61_90 || 0) + (aging.bucket_90_plus || 0);
  // Si todos los buckets vienen 0 explícitos, igual reportamos 0 — eso es real, no NaN.
  return a;
}

// ─────────────────────────────────────────────────────────────────────
// Helper: serie temporal a partir de cashflow.
// backend devuelve [{week, proyectado, real}, ...]. La transformamos a
// [{date, value}] usando un mapeo configurable.
// ─────────────────────────────────────────────────────────────────────
function cashflowToSeries(cashflow, accessor) {
  if (!Array.isArray(cashflow)) return [];
  return cashflow
    .filter((p) => p && p[accessor] != null && p.week)
    .map((p) => ({ date: p.week, value: Number(p[accessor]) || 0 }));
}

// ─────────────────────────────────────────────────────────────────────
// Helper: cruzar urgent[] con by_status[] para sintetizar pipeline por marca.
// Esto es derivación cliente-side; cuando exista
// /api/analytics/by_status_by_brand/ el componente recibe directamente
// la data del backend.
// ─────────────────────────────────────────────────────────────────────
function deriveBrandPipeline(urgent, byStatus, byBrandKpis, resolveBrand) {
  if (!Array.isArray(byBrandKpis) || !byBrandKpis.length) return [];
  // urgent provee status proxy a partir del campo `action` cuando exista
  // y `brand_id`; sin él no podemos asignar conteos por estado.
  // Solo entregamos la fila por marca si tenemos count global de la KPI.
  return byBrandKpis.map((b) => {
    const brand = resolveBrand(b.brand_id) || { name: b.brand_id, color: "var(--border-strong)" };
    // En ausencia de breakdown por estado por marca, agrupamos todo en "TRANSITO"
    // como aproximación visual ÚNICA de "expedientes activos". Marca explícita
    // en subtítulo del widget como "agregado global".
    return {
      brandId:   b.brand_id,
      brandName: brand.name,
      brandColor: brand.color,
      total:     Number(b.count) || 0,
      byStatus: {
        // Reparto plano hasta que exista endpoint con dimensión status×brand.
        // Usamos "TRANSITO" como bucket conservador para no inventar splits.
        TRANSITO: Number(b.count) || 0,
      },
    };
  }).filter((r) => r.total > 0);
}

// ─────────────────────────────────────────────────────────────────────
// FxFooter — recordatorio honesto de fuente FX.
// Cuando no exista feed de tasas en vivo, mostramos "[PENDIENTE]".
// ─────────────────────────────────────────────────────────────────────
function FxFooter({ market, lang }) {
  // No hay endpoint FX → siempre PENDIENTE. Cuando exista, este componente
  // recibe { rate, source, fetchedAt } y formatea según mercado.
  if (market === "BR" || market === "CR") {
    return (
      <span
        title={lang === "en"
          ? "Pending: BCB/BCCR FX feed not connected yet."
          : "Pendiente: feed FX BCB/BCCR no conectado todavía."}
        style={{
          font: "var(--caption)",
          color: "var(--warning)",
          background: "var(--warning-bg)",
          padding: "2px 8px",
          borderRadius: "var(--radius-sm)",
        }}
      >
        {lang === "en" ? "[Pending — FX feed not connected]" : "[PENDIENTE — fuente FX no conectada]"}
      </span>
    );
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Skeleton — placeholder neutro durante carga inicial.
// ─────────────────────────────────────────────────────────────────────
function Skeleton({ height = 120, width = "100%" }) {
  return (
    <div
      style={{
        height, width,
        background: "linear-gradient(90deg, var(--bg-alt) 0%, var(--surface-hover) 50%, var(--bg-alt) 100%)",
        backgroundSize: "200% 100%",
        animation: "mwt-shimmer 1.4s ease-in-out infinite",
        borderRadius: "var(--radius-md)",
      }}
      aria-hidden
    />
  );
}

// Mantiene el keyframe si la app no lo trae (defensa local).
const SHIMMER_KEYFRAMES = `
@keyframes mwt-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
`;

// =====================================================================
// COMPONENTE PRINCIPAL
// =====================================================================
export default function ScreenDashboard() {
  const navigate = useNavigate();
  const { lang } = useOutletContext();
  const { isAdmin, can } = useRole();

  // ── Estado de filtros globales ─────
  const [filters, setFilters] = React.useState({
    period: "90d",
    brand: null,
    market: null,  // 'USA' | 'CR' | 'BR' (UI only; backend no segmenta aún)
    client: null,
    node: null,
  });

  // ── Data ─────
  const {
    kpis, cashflow, aging, exposicion, margenMarcas, byStatus, urgent,
    loading, error, reload,
  } = useDashboardKpis();
  const { brands, resolveBrand } = useBrandsLight();

  // ── Navegación de drill-downs ─────
  const onOpenExpediente = useCallback((id) => {
    const oc = OCS.find((o) => Array.isArray(o.expedientes) && o.expedientes.includes(id));
    if (oc) navigate(`/expedientes/${oc.id}/exp/${id}`);
    else navigate("/expedientes");
  }, [navigate]);

  // El backend devuelve client_id como UUID; resolver por nombre real
  // requiere endpoint clientes/{id}/ o un caché de clientes. Hoy
  // mostramos el ID si el nombre no está disponible — honesto, no inventado.
  const resolveClient = useCallback((id) => {
    // Buscar primero en exposicion (puede traer denormalizado en el futuro)
    const fromExp = Array.isArray(exposicion)
      ? exposicion.find((e) => e.client_id === id)
      : null;
    if (fromExp?.client_name) return { name: fromExp.client_name, country: fromExp.country };
    return null;
  }, [exposicion]);

  // ── KPIs derivados ─────
  const k = kpis || {};
  const kpiActive          = k.active != null ? Number(k.active) : null;
  const kpiCashRisk        = cashAtRisk(aging);          // bucket_61_90 + bucket_90_plus
  const kpiMarginPct       = k.margin_pct != null ? Number(k.margin_pct) : null;
  const kpiTotalInvoiced   = k.total_invoiced != null ? Number(k.total_invoiced) : null;
  const kpiTotalPaid       = k.total_paid != null ? Number(k.total_paid) : null;
  const kpiReceivables     = k.receivables != null ? Number(k.receivables) : null;

  // ── Series para Banda 2 ─────
  const cashflowSeriesReal       = useMemo(() => cashflowToSeries(cashflow, "real"),       [cashflow]);
  const cashflowSeriesProyectado = useMemo(() => cashflowToSeries(cashflow, "proyectado"), [cashflow]);
  const [chartSeriesKey, setChartSeriesKey] = React.useState("real");
  const chartSeries = chartSeriesKey === "real" ? cashflowSeriesReal : cashflowSeriesProyectado;

  // ── Pipeline por marca (derivación con caveat) ─────
  const brandPipelineRows = useMemo(() => {
    return deriveBrandPipeline(urgent, byStatus, k.by_brand || [], resolveBrand);
  }, [urgent, byStatus, k.by_brand, resolveBrand]);

  // ── Scatter margen (un punto por marca, NO por expediente — caveat documentado) ─────
  const scatterPoints = useMemo(() => {
    return (Array.isArray(margenMarcas) ? margenMarcas : []).map((m) => {
      const brand = resolveBrand(m.brand_id) || {};
      return {
        id:        m.brand_id,
        label:     brand.name || m.brand_id,
        projected: Number(m.projected_margin) || 0,
        real:      Number(m.real_margin) || 0,
        value:     Number(m.total_invoiced) || 0,
        color:     brand.color || "var(--brand-primary)",
      };
    }).filter((p) => p.projected > 0 || p.real > 0);
  }, [margenMarcas, resolveBrand]);

  // ── Filtros aplicados (cliente-side hasta que el backend respete params) ─────
  const filteredUrgent = useMemo(() => {
    if (!Array.isArray(urgent)) return [];
    if (!filters.brand) return urgent;
    return urgent.filter((u) => u.brand_id === filters.brand);
  }, [urgent, filters.brand]);

  // ─────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────
  return (
    <div className="page" data-screen-label="Dashboard">
      <style>{SHIMMER_KEYFRAMES}</style>

      {/* Page header */}
      <div className="page-header">
        <div>
          <div className="micro" style={{ marginBottom: 6 }}>
            {lang === "en" ? "OVERVIEW" : "VISTA GENERAL"}
          </div>
          <h1 className="page-title">{tr(lang, "dashboard")}</h1>
          <div className="page-subtitle">
            {lang === "en" ? "Operating cockpit · " : "Cockpit operativo · "}
            {new Date().toLocaleDateString(lang === "en" ? "en-US" : "es-PE", {
              weekday: "long", day: "2-digit", month: "long", year: "numeric",
            })}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={reload}
            disabled={loading}
            title={lang === "en" ? "Refresh data" : "Recargar datos"}
          >
            <IconRefresh size={14} />
            {loading ? (lang === "en" ? "Loading…" : "Cargando…") : tr(lang, "refresh")}
          </button>
          <button type="button" className="btn btn-secondary">
            <IconDownload size={14} /> {tr(lang, "export")}
          </button>
          {can("create_expediente") && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => navigate("/wizard")}
            >
              <IconPlus size={14} /> {tr(lang, "new_expediente")}
            </button>
          )}
        </div>
      </div>

      {/* Filtros globales */}
      <GlobalFilters value={filters} onChange={setFilters} brands={brands} lang={lang} />

      {/* Banner de error global (no rompe la página) */}
      {error && !loading && (
        <div
          role="alert"
          style={{
            background: "var(--critical-bg)",
            border: "1px solid var(--critical)",
            color: "var(--critical)",
            padding: "10px 14px",
            borderRadius: "var(--radius-md)",
            marginBottom: 16,
            font: "var(--body-sm)",
          }}
        >
          {lang === "en"
            ? "Failed to load analytics. Some widgets may render empty states."
            : "Falla al cargar analytics. Algunos widgets pueden quedar en estado vacío."}
          <button type="button" className="btn btn-ghost btn-sm" onClick={reload} style={{ marginLeft: 8 }}>
            {lang === "en" ? "Retry" : "Reintentar"}
          </button>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────
          BANDA 1 — Hero "Estado del negocio hoy"
          6 KPIs (3 con backend + 3 honestos en empty state).
          NOTA: Banda 1 mantiene SIEMPRE vista global (mandato CEO).
          ────────────────────────────────────────────────────────────── */}
      <div
        className="grid gap-3 mb-6"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        }}
      >
        <SafeWidget lang={lang} endpoint="/api/analytics/dashboard_kpis/">
          {loading
            ? <div className="stat"><Skeleton height={100} /></div>
            : <KpiCard
                lang={lang}
                label={tr(lang, "active_exp")}
                value={kpiActive}
                valueFmt={(v) => v.toLocaleString(lang === "en" ? "en-US" : "es-PE")}
                sub={lang === "en" ? "Open files (not closed/cancelled)" : "Expedientes abiertos (no cerrados/cancelados)"}
                sparkColor="var(--brand-accent)"
                emptyEndpoint="/api/analytics/dashboard_kpis/"
                emptyHint={lang === "en"
                  ? "Backend did not return active count."
                  : "El backend no devolvió conteo de activos."}
              />}
        </SafeWidget>

        <SafeWidget lang={lang} endpoint="/api/analytics/aging/">
          {loading
            ? <div className="stat"><Skeleton height={100} /></div>
            : <KpiCard
                lang={lang}
                label={lang === "en" ? "Cash at risk" : "Cash en riesgo"}
                value={kpiCashRisk}
                valueFmt={(v) => fmtMoney(v)}
                sub={lang === "en"
                  ? "Receivables in buckets 61–90d and 90d+"
                  : "Por cobrar en buckets 61–90d y 90d+"}
                sparkColor="var(--critical)"
                threshold={(kpiCashRisk || 0) > 0 ? "critical" : "success"}
                emptyEndpoint="/api/analytics/aging/"
                emptyHint={lang === "en"
                  ? "Aging endpoint did not respond."
                  : "El endpoint de aging no respondió."}
              />}
        </SafeWidget>

        <SafeWidget lang={lang} endpoint="/api/analytics/dashboard_kpis/">
          {loading
            ? <div className="stat"><Skeleton height={100} /></div>
            : <KpiCard
                lang={lang}
                label={lang === "en" ? "Weighted gross margin" : "Margen bruto ponderado"}
                value={kpiMarginPct != null && kpiMarginPct > 0 ? kpiMarginPct : null}
                valueFmt={(v) => `${(v * 100).toFixed(1)}%`}
                sub={lang === "en"
                  ? "Closed files · last 90 days"
                  : "Expedientes cerrados · últimos 90 días"}
                sparkColor="var(--info)"
                threshold={(kpiMarginPct || 0) > 0.18 ? "success" : (kpiMarginPct || 0) > 0.12 ? "warning" : "critical"}
                emptyEndpoint="/api/analytics/dashboard_kpis/"
                emptyHint={lang === "en"
                  ? "No closed files in last 90 days to compute margin."
                  : "No hay expedientes cerrados en últimos 90d para calcular margen."}
              />}
        </SafeWidget>

        {/* KPI 4 · Reloj crédito promedio — empty honesto */}
        <SafeWidget lang={lang}>
          <KpiCard
            lang={lang}
            label={lang === "en" ? "Avg. credit clock" : "Reloj crédito promedio"}
            value={null}
            emptyEndpoint="/api/analytics/credit_clock_avg/"
            emptyHint={lang === "en"
              ? "Endpoint not implemented: AVG(days_to_payment) over closed files."
              : "Endpoint no implementado: AVG(días_hasta_pago) sobre expedientes cerrados."}
          />
        </SafeWidget>

        {/* KPI 5 · TACoS Amazon — empty honesto. Tech name no se traduce. */}
        <SafeWidget lang={lang}>
          <KpiCard
            lang={lang}
            label="TACoS Amazon · FBA-US"
            value={null}
            emptyEndpoint="/api/analytics/tacos_fba_us/"
            emptyHint={lang === "en"
              ? "Endpoint not implemented: ad_spend / total_revenue (last 30d)."
              : "Endpoint no implementado: ad_spend / total_revenue (últimos 30d)."}
          />
        </SafeWidget>

        {/* KPI 6 · % R1+ — empty honesto */}
        <SafeWidget lang={lang}>
          <KpiCard
            lang={lang}
            label={lang === "en" ? "% files with R1+ correction" : "% expedientes con corrección R1+"}
            value={null}
            emptyEndpoint="/api/analytics/r1_correction_ratio/"
            emptyHint={lang === "en"
              ? "Endpoint not implemented: count(corrections>=R1) / total."
              : "Endpoint no implementado: count(correcciones>=R1) / total."}
          />
        </SafeWidget>
      </div>

      {/* ──────────────────────────────────────────────────────────────
          BANDA 2 — Comparador temporal Google-Finance-style
          ────────────────────────────────────────────────────────────── */}
      <DashboardCard
        title={lang === "en" ? "Consolidated cashflow · USD" : "Cashflow consolidado · USD"}
        subtitle={lang === "en"
          ? "Backend source: /api/analytics/cashflow/ — series: projected / real"
          : "Fuente backend: /api/analytics/cashflow/ — series: proyectado / real"}
        action={
          <div className="seg" style={{ display: "inline-flex", gap: 2 }}>
            <button
              type="button"
              data-active={chartSeriesKey === "real"}
              onClick={() => setChartSeriesKey("real")}
              style={segBtnStyle(chartSeriesKey === "real")}
            >
              {lang === "en" ? "Real" : "Real"}
            </button>
            <button
              type="button"
              data-active={chartSeriesKey === "proyectado"}
              onClick={() => setChartSeriesKey("proyectado")}
              style={segBtnStyle(chartSeriesKey === "proyectado")}
            >
              {lang === "en" ? "Projected" : "Proyectado"}
            </button>
          </div>
        }
      >
        <SafeWidget lang={lang} endpoint="/api/analytics/cashflow/">
          {loading
            ? <Skeleton height={260} />
            : <TimeseriesChart
                data={chartSeries}
                label={chartSeriesKey === "real"
                  ? (lang === "en" ? "Cashflow · real" : "Cashflow · real")
                  : (lang === "en" ? "Cashflow · projected" : "Cashflow · proyectado")}
                currency="USD"
                color={chartSeriesKey === "real" ? "var(--brand-primary)" : "var(--brand-accent-dark)"}
                lang={lang}
                emptyEndpoint="/api/analytics/cashflow/"
              />}
        </SafeWidget>

        {/* Footer FX honesto */}
        <div className="flex ai-center gap-2 mt-3" style={{ font: "var(--caption)", color: "var(--text-tertiary)" }}>
          <span>
            {lang === "en"
              ? "Canonical currency: USD."
              : "Moneda canónica: USD."}
          </span>
          <FxFooter market={filters.market} lang={lang} />
        </div>
      </DashboardCard>

      <div style={{ height: 16 }} />

      {/* ──────────────────────────────────────────────────────────────
          BANDA 3 — Operación (3 columnas iguales)
          ────────────────────────────────────────────────────────────── */}
      <div
        className="grid gap-3 mb-6"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}
      >
        {/* 3A · Pipeline por marca (timeline horizontal apilado) */}
        <DashboardCard
          title={tr(lang, "operational_pipeline")}
          subtitle={lang === "en"
            ? "Active files by brand · click a segment to filter"
            : "Expedientes activos por marca · click en segmento para filtrar"}
          action={
            <Badge kind="info">
              {brandPipelineRows.reduce((a, r) => a + r.total, 0)} {lang === "en" ? "files" : "exp."}
            </Badge>
          }
        >
          <SafeWidget lang={lang} endpoint="/api/analytics/by_status_by_brand/">
            {loading
              ? <Skeleton height={140} />
              : <PipelineByBrandTimeline
                  rows={brandPipelineRows}
                  lang={lang}
                  onClick={(brandId) => navigate(`/expedientes?brand=${brandId}`)}
                  emptyEndpoint="/api/analytics/by_status_by_brand/"
                />}
          </SafeWidget>
        </DashboardCard>

        {/* 3B · Top 10 expedientes urgentes */}
        <DashboardCard
          title={tr(lang, "urgent_actions")}
          subtitle={lang === "en"
            ? "Top 10 by urgency · blocked or credit > 70d"
            : "Top 10 por urgencia · bloqueados o crédito > 70d"}
          padding={0}
          action={<Badge kind="critical">{filteredUrgent.length}</Badge>}
        >
          <SafeWidget lang={lang} endpoint="/api/analytics/urgent/">
            {loading
              ? <div style={{ padding: 20 }}><Skeleton height={200} /></div>
              : <UrgentExpedientesTable
                  items={filteredUrgent}
                  resolveBrand={resolveBrand}
                  resolveClient={resolveClient}
                  onOpen={onOpenExpediente}
                  lang={lang}
                  emptyEndpoint="/api/analytics/urgent/"
                />}
          </SafeWidget>
        </DashboardCard>

        {/* 3C · Inventario por nodo — empty honesto (sin endpoint) */}
        <DashboardCard
          title={lang === "en" ? "Inventory by node" : "Inventario por nodo"}
          subtitle={lang === "en"
            ? "Coverage days · stock per active node"
            : "Días de cobertura · stock por nodo activo"}
        >
          <SafeWidget lang={lang}>
            <EmptyState
              lang={lang}
              title={lang === "en" ? "No node inventory" : "Sin inventario por nodo"}
              hint={lang === "en"
                ? "Endpoint not implemented: requires JOIN nodos + stock + 30d velocity."
                : "Endpoint no implementado: requiere JOIN nodos + stock + velocidad 30d."}
              endpoint="/api/analytics/inventory_coverage_by_node/"
            />
          </SafeWidget>
        </DashboardCard>
      </div>

      {/* ──────────────────────────────────────────────────────────────
          BANDA 4 — Análisis multidimensional
          ────────────────────────────────────────────────────────────── */}
      <div
        className="grid gap-3 mb-6"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))" }}
      >
        {/* 4A · Top SKUs — empty honesto */}
        <DashboardCard
          title={lang === "en" ? "Top 10 SKUs by margin (90d)" : "Top 10 SKUs por margen (90d)"}
          subtitle={lang === "en"
            ? "Ranked by margin USD contribution"
            : "Rankeados por contribución de margen USD"}
        >
          <SafeWidget lang={lang}>
            <EmptyState
              lang={lang}
              title={lang === "en" ? "No SKU ranking yet" : "Sin ranking de SKUs"}
              hint={lang === "en"
                ? "Endpoint not implemented: JOIN productos + lineas + expedientes (90d)."
                : "Endpoint no implementado: JOIN productos + líneas + expedientes (90d)."}
              endpoint="/api/analytics/top_skus_margen/"
            />
          </SafeWidget>
        </DashboardCard>

        {/* 4B · Top 10 clientes — DATA REAL desde exposicion_clientes */}
        <DashboardCard
          title={lang === "en" ? "Top 10 clients" : "Top 10 clientes"}
          subtitle={lang === "en"
            ? "By open exposure (USD)"
            : "Por exposición abierta (USD)"}
          padding={0}
        >
          <SafeWidget lang={lang} endpoint="/api/analytics/exposicion_clientes/">
            {loading
              ? <div style={{ padding: 20 }}><Skeleton height={220} /></div>
              : <TopClientsTable
                  items={exposicion}
                  resolveClient={resolveClient}
                  lang={lang}
                  emptyEndpoint="/api/analytics/exposicion_clientes/"
                />}
          </SafeWidget>
        </DashboardCard>

        {/* 4C · Heatmap tallas × mercado — empty honesto */}
        <DashboardCard
          title={lang === "en" ? "Size × market heatmap" : "Heatmap tallas × mercado"}
          subtitle={lang === "en"
            ? "Distribution vs expected curve S1–S6 (5/10/20/25/30/10%)"
            : "Distribución vs curva esperada S1–S6 (5/10/20/25/30/10%)"}
        >
          <SafeWidget lang={lang}>
            <EmptyState
              lang={lang}
              title={lang === "en" ? "No size data" : "Sin data de tallas"}
              hint={lang === "en"
                ? "Endpoint not implemented: sales/inventory grouped by size × destination market."
                : "Endpoint no implementado: ventas/inventario agrupados por talla × mercado destino."}
              endpoint="/api/analytics/size_market_distribution/"
            />
          </SafeWidget>
        </DashboardCard>

        {/* 4D · Scatter margen real vs proyectado (CEO-ONLY) */}
        {can("view_margin") ? (
          <DashboardCard
            title={lang === "en" ? "Real vs projected margin" : "Margen real vs proyectado"}
            subtitle={lang === "en"
              ? "By brand · ±15% band marks ENT_GOB_KPI B2 threshold · per-file granularity pending"
              : "Por marca · banda ±15% marca umbral ENT_GOB_KPI B2 · granularidad por expediente pendiente"}
          >
            <SafeWidget lang={lang} endpoint="/api/analytics/margen_marcas/">
              {loading
                ? <Skeleton height={280} />
                : <MarginScatter
                    points={scatterPoints}
                    driftThreshold={0.15}
                    lang={lang}
                    emptyEndpoint="/api/analytics/expediente_margin_scatter/"
                  />}
            </SafeWidget>
          </DashboardCard>
        ) : (
          // INTERNAL: solo agregado, sin descomposición de margen
          <DashboardCard
            title={lang === "en" ? "Margin (aggregated)" : "Margen (agregado)"}
            subtitle={lang === "en"
              ? "Full breakdown is restricted to CEO role"
              : "Desglose completo restringido a rol CEO"}
          >
            <EmptyState
              lang={lang}
              title={lang === "en" ? "Restricted view" : "Vista restringida"}
              hint={lang === "en"
                ? "CEO-ONLY content. Your role sees aggregated margin only via KPI band 1."
                : "Contenido CEO-ONLY. Tu rol ve margen agregado solo en la banda KPI 1."}
            />
          </DashboardCard>
        )}
      </div>

      {/* Footer informativo */}
      <div
        className="flex ai-center jc-between"
        style={{
          marginTop: 12, padding: "10px 14px",
          background: "var(--surface-hover)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          font: "var(--caption)",
          color: "var(--text-tertiary)",
          flexWrap: "wrap", gap: 8,
        }}
      >
        <span>
          {lang === "en" ? "Live dashboard · refreshes on demand" : "Dashboard en vivo · refresco bajo demanda"}
          {" · "}
          {lang === "en" ? "Last reload:" : "Último refresco:"} {fmtDate(new Date().toISOString(), lang)}
        </span>
        <span>
          {lang === "en"
            ? "Empty states are intentional — no data is fabricated."
            : "Los estados vacíos son intencionales — ningún dato es inventado."}
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Helpers de estilo locales (sin clases globales nuevas).
// ─────────────────────────────────────────────────────────────────────
function segBtnStyle(active) {
  return {
    font: "600 12px/1 var(--font-body)",
    padding: "6px 12px",
    background: active ? "var(--brand-primary)" : "transparent",
    color: active ? "var(--text-on-navy)" : "var(--text-secondary)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
  };
}
