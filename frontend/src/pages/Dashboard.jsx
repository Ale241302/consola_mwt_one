// =====================================================================
// MWT.ONE · Dashboard (Centro de Operaciones CEO)
// Rediseño 2026-05-20 — AG-03 Arquitecto Ejecutor Frontend.
// Sprint 2026-05-20 · "DEJA TODO CONECTADO" — todos los widgets cableados
// a endpoints reales del backend + selector FX USD↔BRL con localStorage.
//
// 4 bandas verticales (mandato CEO):
//   BANDA 1 — Hero "Estado del negocio hoy" (6 KPIs)
//   BANDA 2 — Comparador temporal Google-Finance-style
//   BANDA 3 — Operación (Pipeline marca · Top urgencia · Inventario nodo)
//   BANDA 4 — Análisis multidimensional (Top SKU · Top clientes · Heatmap · Scatter)
//
// REGLAS APLICADAS (CLAUDE.md §2):
//   R1 — Cero hex. Solo CSS vars MWT.
//   R3 — CEO-ONLY via useRole().can(...).
//   R5 — `tabular-nums` en toda métrica.
//   POL_CERO_DEMO — Si BE no responde, EmptyState honesto. Nunca $0/NaN%.
// =====================================================================
import React, { useMemo, useCallback, useState, useEffect } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { tr, fmtMoney, fmtDate } from "../lib/i18n.js";
import { Badge } from "../components/ui/primitives.jsx";
import { IconDownload, IconPlus, IconRefresh } from "../lib/icons.jsx";
import { useDashboardKpis } from "../hooks/useDashboardKpis.js";
import { useBrandsLight } from "../hooks/useBrandsLight.js";
import { useFxUsdBrl } from "../hooks/useFxUsdBrl.js";
import { useRole } from "../context/RoleContext.jsx";
import { OCS } from "../data/mockData.js";
import {
  KpiCard,
  TimeseriesChart,
  PipelineByBrandTimeline,
  UrgentExpedientesTable,
  MarginScatter,
  TopClientsTable,
  TopSkusTable,
  NodeInventoryGrid,
  FxToggle,
  GlobalFilters,
  DashboardCard,
  EmptyState,
} from "../components/dashboard/DashboardPrimitives.jsx";

// ─────────────────────────────────────────────────────────────────────
// SafeWidget — error boundary funcional por widget.
// Un widget caído NO debe tumbar la página.
// ─────────────────────────────────────────────────────────────────────
class SafeWidget extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) {
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
// Helpers
// ─────────────────────────────────────────────────────────────────────
function cashAtRisk(aging) {
  if (!aging) return null;
  return (aging.bucket_61_90 || 0) + (aging.bucket_90_plus || 0);
}

function cashflowToSeries(cashflow, accessor) {
  if (!Array.isArray(cashflow)) return [];
  return cashflow
    .filter((p) => p && p[accessor] != null && p.week)
    .map((p) => ({ date: p.week, value: Number(p[accessor]) || 0 }));
}

// Derivar pipeline por marca cruzando byStatusByBrand (cuando exista)
// con byStatus + by_brand (fallback consolidado).
function deriveBrandPipeline(byStatusByBrand, byBrandKpis, resolveBrand) {
  // Si el endpoint nuevo respondió con datos, usarlo directamente.
  if (Array.isArray(byStatusByBrand) && byStatusByBrand.length) {
    const grouped = new Map();
    for (const row of byStatusByBrand) {
      if (!row.brand_id) continue;
      if (!grouped.has(row.brand_id)) {
        const brand = resolveBrand(row.brand_id) || {};
        grouped.set(row.brand_id, {
          brandId:    row.brand_id,
          brandName:  brand.name || row.brand_id,
          brandColor: brand.color || "var(--brand-primary)",
          total:      0,
          byStatus:   {},
        });
      }
      const g = grouped.get(row.brand_id);
      const status = row.status || row.estado || "TRANSITO";
      const cnt = Number(row.count) || 0;
      g.byStatus[status] = (g.byStatus[status] || 0) + cnt;
      g.total += cnt;
    }
    return Array.from(grouped.values()).filter((r) => r.total > 0);
  }

  // Fallback: kpis.by_brand sin desglose por status — agrupamos como TRANSITO.
  if (!Array.isArray(byBrandKpis) || !byBrandKpis.length) return [];
  return byBrandKpis.map((b) => {
    const brand = resolveBrand(b.brand_id) || {};
    return {
      brandId:    b.brand_id,
      brandName:  brand.name || b.brand_id,
      brandColor: brand.color || "var(--border-strong)",
      total:      Number(b.count) || 0,
      byStatus:   { TRANSITO: Number(b.count) || 0 },
    };
  }).filter((r) => r.total > 0);
}

function FxFooter({ market, lang, fx }) {
  if (market === "BR") {
    if (fx?.rate != null) {
      return (
        <span className="tabular" style={{
          font: "var(--caption)", color: "var(--text-tertiary)",
        }}>
          {fx.source ? `${fx.source} · ` : ""}1 USD = R$ {fx.rate.toFixed(4)}
          {fx.fetchedAt && (
            <> · {new Date(fx.fetchedAt).toLocaleDateString(lang === "en" ? "en-US" : "es-PE")}</>
          )}
        </span>
      );
    }
    return (
      <span
        title={lang === "en" ? "Pending FX feed." : "Pendiente feed FX."}
        style={{
          font: "var(--caption)", color: "var(--warning)",
          background: "var(--warning-bg)",
          padding: "2px 8px", borderRadius: "var(--radius-sm)",
        }}
      >
        {lang === "en" ? "[Pending — FX not available]" : "[PENDIENTE — fuente FX no conectada]"}
      </span>
    );
  }
  return null;
}

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

const SHIMMER_KEYFRAMES = `
@keyframes mwt-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
`;

const LS_CCY = "mwt:dashboard-fx-display";

// =====================================================================
// COMPONENTE PRINCIPAL
// =====================================================================
export default function ScreenDashboard() {
  const navigate = useNavigate();
  const { lang } = useOutletContext();
  const { can, isAdmin } = useRole();

  // ── Display currency (persistido en LS) ─────
  const [displayCcy, setDisplayCcy] = useState(() => {
    try {
      const v = localStorage.getItem(LS_CCY);
      return v === "BRL" ? "BRL" : "USD";
    } catch { return "USD"; }
  });
  useEffect(() => {
    try { localStorage.setItem(LS_CCY, displayCcy); } catch {}
  }, [displayCcy]);

  // ── FX hook ─────
  const fx = useFxUsdBrl();

  // Si el usuario tenía BRL guardado pero la tasa no llegó nunca, degradar a USD
  // (no romper la promesa de "nunca inventar"). Se restaura BRL en cuanto haya tasa.
  useEffect(() => {
    if (displayCcy === "BRL" && fx.rate == null && !fx.loading) {
      // mantener visualmente USD sin tocar LS, así si la tasa vuelve, regresa.
    }
  }, [displayCcy, fx.rate, fx.loading]);

  const effectiveCcy = displayCcy === "BRL" && fx.rate != null ? "BRL" : "USD";

  // Helper para mostrar un monto USD en la moneda activa.
  const fmtAmount = useCallback((usd) => {
    if (usd == null) return "—";
    if (effectiveCcy === "BRL" && fx.rate != null) {
      return new Intl.NumberFormat(lang === "en" ? "en-US" : "es-PE", {
        style: "currency", currency: "BRL", maximumFractionDigits: 0,
      }).format(Number(usd) * fx.rate);
    }
    return fmtMoney(usd);
  }, [effectiveCcy, fx.rate, lang]);

  // Construye el secondary BRL para un monto USD (para mostrar debajo del valor).
  const secondaryBrl = useCallback((usd) => {
    if (usd == null || fx.rate == null) return null;
    return {
      value: Number(usd) * fx.rate,
      currency: "BRL",
      source: fx.source,
      fetchedAt: fx.fetchedAt,
    };
  }, [fx.rate, fx.source, fx.fetchedAt]);

  // ── Estado de filtros globales ─────
  const [filters, setFilters] = useState({
    period: "90d",
    brand: null,
    market: null,
    client: null,
    node: null,
  });

  // ── Data del backend ─────
  const {
    kpis, cashflow, aging, exposicion, margenMarcas, byStatus, urgent,
    creditClock, r1Ratio, byStatusByBrand, inventoryByNode, topSkus, marginScatter,
    loading, error, reload,
  } = useDashboardKpis();
  const { brands, resolveBrand } = useBrandsLight();

  // ── Navegación de drill-downs ─────
  const onOpenExpediente = useCallback((id) => {
    const oc = OCS.find((o) => Array.isArray(o.expedientes) && o.expedientes.includes(id));
    if (oc) navigate(`/expedientes/${oc.id}/exp/${id}`);
    else navigate("/expedientes");
  }, [navigate]);

  const resolveClient = useCallback((id) => {
    const fromExp = Array.isArray(exposicion)
      ? exposicion.find((e) => e.client_id === id)
      : null;
    if (fromExp?.client_name) return { name: fromExp.client_name, country: fromExp.country };
    return null;
  }, [exposicion]);

  // ── KPIs derivados ─────
  const k = kpis || {};
  const kpiActive          = k.active != null ? Number(k.active) : null;
  const kpiCashRisk        = cashAtRisk(aging);
  const kpiMarginPct       = k.margin_pct != null ? Number(k.margin_pct) : null;
  const kpiCreditAvgDays   = creditClock?.avg_days != null ? Number(creditClock.avg_days) : null;
  const kpiR1Ratio         = r1Ratio?.ratio != null ? Number(r1Ratio.ratio) : null;

  // ── Series Banda 2 ─────
  const cashflowSeriesReal       = useMemo(() => cashflowToSeries(cashflow, "real"),       [cashflow]);
  const cashflowSeriesProyectado = useMemo(() => cashflowToSeries(cashflow, "proyectado"), [cashflow]);
  const [chartSeriesKey, setChartSeriesKey] = useState("real");
  const chartSeries = chartSeriesKey === "real" ? cashflowSeriesReal : cashflowSeriesProyectado;

  // ── Pipeline por marca ─────
  const brandPipelineRows = useMemo(
    () => deriveBrandPipeline(byStatusByBrand, k.by_brand || [], resolveBrand),
    [byStatusByBrand, k.by_brand, resolveBrand]
  );

  // ── Scatter por expediente (preferido) o por marca (fallback) ─────
  const scatterPoints = useMemo(() => {
    // 1) Si el endpoint expediente_margin_scatter respondió, usar granularidad por expediente.
    if (Array.isArray(marginScatter) && marginScatter.length) {
      return marginScatter.map((m) => {
        const brand = resolveBrand(m.brand_id) || {};
        return {
          id:        m.id,
          label:     `${m.ref || m.id} · ${m.client_id || ""}`,
          projected: Number(m.projected_margin) || 0,
          real:      Number(m.real_margin) || 0,
          value:     Number(m.total_invoiced) || 0,
          color:     brand.color || "var(--brand-primary)",
        };
      }).filter((p) => p.projected > 0 || p.real > 0);
    }
    // 2) Fallback: un punto por marca (margenMarcas).
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
  }, [marginScatter, margenMarcas, resolveBrand]);

  // ── Filtros aplicados (cliente-side) ─────
  const filteredUrgent = useMemo(() => {
    if (!Array.isArray(urgent)) return [];
    if (!filters.brand) return urgent;
    return urgent.filter((u) => u.brand_id === filters.brand);
  }, [urgent, filters.brand]);

  const filteredTopSkus = useMemo(() => {
    if (!Array.isArray(topSkus)) return [];
    if (!filters.brand) return topSkus;
    return topSkus.filter((s) => s.brand_id === filters.brand);
  }, [topSkus, filters.brand]);

  // Granularidad scatter informativa para el subtítulo
  const scatterIsPerFile = Array.isArray(marginScatter) && marginScatter.length > 0;

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
        <div className="flex gap-2" style={{ alignItems: "center", flexWrap: "wrap" }}>
          <FxToggle
            currency={displayCcy}
            onChange={setDisplayCcy}
            rate={fx.rate}
            source={fx.source}
            fetchedAt={fx.fetchedAt}
            loading={fx.loading}
            error={fx.error}
            onRefresh={fx.refresh}
            lang={lang}
          />
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

      {/* Banner de error global */}
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
          BANDA 1 — 6 KPIs (cableados al backend)
          ────────────────────────────────────────────────────────────── */}
      <div
        className="grid gap-3 mb-6"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}
      >
        {/* 1 · Expedientes activos */}
        <SafeWidget lang={lang} endpoint="/api/analytics/dashboard_kpis/">
          {loading
            ? <div className="stat"><Skeleton height={120} /></div>
            : <KpiCard
                lang={lang}
                label={tr(lang, "active_exp")}
                value={kpiActive}
                valueFmt={(v) => v.toLocaleString(lang === "en" ? "en-US" : "es-PE")}
                sub={lang === "en"
                  ? "Open files (not closed/cancelled)"
                  : "Expedientes abiertos (no cerrados/cancelados)"}
                sparkColor="var(--brand-accent)"
                emptyEndpoint="/api/analytics/dashboard_kpis/"
              />}
        </SafeWidget>

        {/* 2 · Cash en riesgo */}
        <SafeWidget lang={lang} endpoint="/api/analytics/aging/">
          {loading
            ? <div className="stat"><Skeleton height={120} /></div>
            : <KpiCard
                lang={lang}
                label={lang === "en" ? "Cash at risk" : "Cash en riesgo"}
                value={kpiCashRisk}
                valueFmt={(v) => fmtAmount(v)}
                secondary={secondaryBrl(kpiCashRisk)}
                sub={lang === "en"
                  ? "Receivables 61–90d + 90d+"
                  : "Por cobrar 61–90d + 90d+"}
                sparkColor="var(--critical)"
                threshold={(kpiCashRisk || 0) > 0 ? "critical" : "success"}
                emptyEndpoint="/api/analytics/aging/"
              />}
        </SafeWidget>

        {/* 3 · Margen bruto ponderado */}
        <SafeWidget lang={lang} endpoint="/api/analytics/dashboard_kpis/">
          {loading
            ? <div className="stat"><Skeleton height={120} /></div>
            : <KpiCard
                lang={lang}
                label={lang === "en" ? "Weighted gross margin" : "Margen bruto ponderado"}
                value={kpiMarginPct != null && kpiMarginPct > 0 ? kpiMarginPct : null}
                valueFmt={(v) => `${(v * 100).toFixed(1)}%`}
                sub={lang === "en" ? "Closed files · last 90d" : "Cerrados · últimos 90d"}
                sparkColor="var(--info)"
                threshold={
                  kpiMarginPct == null ? undefined
                  : kpiMarginPct > 0.18 ? "success"
                  : kpiMarginPct > 0.12 ? "warning"
                  : "critical"
                }
                emptyEndpoint="/api/analytics/dashboard_kpis/"
                emptyHint={lang === "en"
                  ? "No closed files in last 90d."
                  : "No hay cerrados en últimos 90d."}
              />}
        </SafeWidget>

        {/* 4 · Reloj crédito promedio · cableado al endpoint nuevo */}
        <SafeWidget lang={lang} endpoint="/api/analytics/credit_clock_avg/">
          {loading
            ? <div className="stat"><Skeleton height={120} /></div>
            : <KpiCard
                lang={lang}
                label={lang === "en" ? "Avg. credit clock" : "Reloj crédito promedio"}
                value={kpiCreditAvgDays}
                valueFmt={(v) => `${v.toFixed(0)}d`}
                sub={creditClock?.n_files
                  ? (lang === "en"
                      ? `${creditClock.n_files} files · p90 ${creditClock.p90?.toFixed(0) ?? "—"}d`
                      : `${creditClock.n_files} exp. · p90 ${creditClock.p90?.toFixed(0) ?? "—"}d`)
                  : (lang === "en" ? "Last 90 days" : "Últimos 90 días")}
                sparkColor="var(--info)"
                threshold={
                  kpiCreditAvgDays == null ? undefined
                  : kpiCreditAvgDays <= 60 ? "success"
                  : kpiCreditAvgDays <= 80 ? "warning"
                  : "critical"
                }
                emptyEndpoint="/api/analytics/credit_clock_avg/"
                emptyHint={lang === "en"
                  ? "No paid receivables in last 90d to compute."
                  : "Sin cobranzas pagadas en últimos 90d para calcular."}
              />}
        </SafeWidget>

        {/* 5 · TACoS Amazon · pendiente (no hay schema Amazon en BD) */}
        <SafeWidget lang={lang}>
          <KpiCard
            lang={lang}
            label="TACoS Amazon · FBA-US"
            value={null}
            emptyEndpoint="/api/analytics/tacos_fba_us/"
            emptyHint={lang === "en"
              ? "Not implemented: no Amazon ads schema in DB."
              : "No implementado: no hay schema de Amazon Ads en BD."}
          />
        </SafeWidget>

        {/* 6 · % R1+ · cableado al endpoint nuevo */}
        <SafeWidget lang={lang} endpoint="/api/analytics/r1_correction_ratio/">
          {loading
            ? <div className="stat"><Skeleton height={120} /></div>
            : <KpiCard
                lang={lang}
                label={lang === "en"
                  ? "% files with R1+ correction"
                  : "% expedientes con corrección R1+"}
                value={kpiR1Ratio}
                valueFmt={(v) => `${(v * 100).toFixed(1)}%`}
                sub={r1Ratio?.total
                  ? (lang === "en"
                      ? `${r1Ratio.with_corrections}/${r1Ratio.total} files`
                      : `${r1Ratio.with_corrections}/${r1Ratio.total} expedientes`)
                  : null}
                sparkColor="var(--warning)"
                threshold={
                  kpiR1Ratio == null ? undefined
                  : kpiR1Ratio < 0.10 ? "success"
                  : kpiR1Ratio < 0.25 ? "warning"
                  : "critical"
                }
                emptyEndpoint="/api/analytics/r1_correction_ratio/"
                emptyHint={r1Ratio?._pending
                  ? (lang === "en"
                      ? "Pending DB column: expediente.corrections_count."
                      : "Pendiente columna BD: expediente.corrections_count.")
                  : (lang === "en" ? "No data." : "Sin datos.")}
              />}
        </SafeWidget>
      </div>

      {/* ──────────────────────────────────────────────────────────────
          BANDA 2 — Comparador temporal (cashflow)
          ────────────────────────────────────────────────────────────── */}
      <DashboardCard
        title={lang === "en" ? "Consolidated cashflow · USD" : "Cashflow consolidado · USD"}
        subtitle={lang === "en"
          ? "Source: /api/analytics/cashflow/ — series: projected / real"
          : "Fuente: /api/analytics/cashflow/ — series: proyectado / real"}
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

        <div className="flex ai-center gap-2 mt-3" style={{
          font: "var(--caption)", color: "var(--text-tertiary)", flexWrap: "wrap",
        }}>
          <span>
            {lang === "en" ? "Canonical currency: USD." : "Moneda canónica: USD."}
          </span>
          <FxFooter market={effectiveCcy === "BRL" ? "BR" : null} lang={lang} fx={fx} />
        </div>
      </DashboardCard>

      <div style={{ height: 16 }} />

      {/* ──────────────────────────────────────────────────────────────
          BANDA 3 — Operación
          ────────────────────────────────────────────────────────────── */}
      <div
        className="grid gap-3 mb-6"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}
      >
        {/* 3A · Pipeline por marca */}
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

        {/* 3B · Top 10 urgentes */}
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
                  isAdmin={isAdmin}
                  onOpen={onOpenExpediente}
                  lang={lang}
                  emptyEndpoint="/api/analytics/urgent/"
                />}
          </SafeWidget>
        </DashboardCard>

        {/* 3C · Inventario por nodo · cableado al endpoint nuevo */}
        <DashboardCard
          title={lang === "en" ? "Inventory by node" : "Inventario por nodo"}
          subtitle={lang === "en"
            ? "Coverage days · stock per active node"
            : "Días de cobertura · stock por nodo activo"}
        >
          <SafeWidget lang={lang} endpoint="/api/analytics/inventory_coverage_by_node/">
            {loading
              ? <Skeleton height={140} />
              : <NodeInventoryGrid
                  items={inventoryByNode}
                  lang={lang}
                  onOpenNode={(id) => navigate(`/nodos/${id}`)}
                  emptyEndpoint="/api/analytics/inventory_coverage_by_node/"
                />}
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
        {/* 4A · Top SKUs · cableado */}
        <DashboardCard
          title={lang === "en" ? "Top 10 SKUs by margin (90d)" : "Top 10 SKUs por margen (90d)"}
          subtitle={lang === "en"
            ? "Ranked by margin USD contribution"
            : "Rankeados por contribución de margen USD"}
          padding={0}
        >
          <SafeWidget lang={lang} endpoint="/api/analytics/top_skus_margen/">
            {loading
              ? <div style={{ padding: 20 }}><Skeleton height={220} /></div>
              : <TopSkusTable
                  items={filteredTopSkus}
                  resolveBrand={resolveBrand}
                  lang={lang}
                  emptyEndpoint="/api/analytics/top_skus_margen/"
                />}
          </SafeWidget>
        </DashboardCard>

        {/* 4B · Top 10 clientes */}
        <DashboardCard
          title={lang === "en" ? "Top 10 clients" : "Top 10 clientes"}
          subtitle={lang === "en" ? "By open exposure (USD)" : "Por exposición abierta (USD)"}
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

        {/* 4C · Heatmap tallas — sigue pendiente (sin schema de tallas) */}
        <DashboardCard
          title={lang === "en" ? "Size × market heatmap" : "Heatmap tallas × mercado"}
          subtitle={lang === "en"
            ? "Distribution vs expected curve S1–S6"
            : "Distribución vs curva esperada S1–S6"}
        >
          <SafeWidget lang={lang}>
            <EmptyState
              lang={lang}
              title={lang === "en" ? "No size data" : "Sin data de tallas"}
              hint={lang === "en"
                ? "Pending DB: ENT_OPS_TALLAS schema + sales-by-size aggregation."
                : "Pendiente BD: schema ENT_OPS_TALLAS + agregación ventas por talla."}
              endpoint="/api/analytics/size_market_distribution/"
            />
          </SafeWidget>
        </DashboardCard>

        {/* 4D · Scatter margen (CEO-ONLY) · cableado al endpoint nuevo o fallback */}
        {can("view_margin") ? (
          <DashboardCard
            title={lang === "en" ? "Real vs projected margin" : "Margen real vs proyectado"}
            subtitle={scatterIsPerFile
              ? (lang === "en"
                  ? "Per closed file · ±15% band marks ENT_GOB_KPI B2 threshold"
                  : "Por expediente cerrado · banda ±15% marca umbral ENT_GOB_KPI B2")
              : (lang === "en"
                  ? "By brand (fallback) · per-file granularity pending closed_at column"
                  : "Por marca (fallback) · granularidad por expediente pendiente columna closed_at")}
          >
            <SafeWidget lang={lang} endpoint="/api/analytics/expediente_margin_scatter/">
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
          <DashboardCard
            title={lang === "en" ? "Margin (aggregated)" : "Margen (agregado)"}
            subtitle={lang === "en"
              ? "Full breakdown is CEO-only"
              : "Desglose completo restringido a rol CEO"}
          >
            <EmptyState
              lang={lang}
              title={lang === "en" ? "Restricted view" : "Vista restringida"}
              hint={lang === "en"
                ? "CEO-ONLY content."
                : "Contenido CEO-ONLY."}
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
          {fx.rate != null
            ? `FX ${fx.source || "MWT"} · 1 USD = R$ ${fx.rate.toFixed(4)}`
            : (lang === "en" ? "FX: pending" : "FX: pendiente")}
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Helpers de estilo locales
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
