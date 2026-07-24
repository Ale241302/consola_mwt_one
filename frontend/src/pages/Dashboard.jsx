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
// Sprint 2026-06-11 · resolver la OC real de un expediente para que el
// click en cualquier registro del dashboard abra el DETALLE de la OC.
import { expedientesApi } from "../lib/api.js";
// Sprint 2026-06-11 (CEO) · dashboard enriquecido para usuarios CLIENTE.
import ClientDashboard from "../components/dashboard/ClientDashboard.jsx";
import {
  KpiCard,
  TimeseriesChart,
  // PipelineByBrandTimeline removido 2026-05-26 (CEO) - widget Pipeline operativo retirado.
  UrgentExpedientesTable,
  MarginScatter,
  TopClientsTable,
  TopSkusTable,
  NodeInventoryGrid,
  SizeMarketHeatmap,
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

// Sprint 2026-05-26 (CEO) - deriveBrandPipeline removido junto con el
// widget "Pipeline operativo". Si en el futuro se reactiva, recuperarse
// del git history (commit del 2026-05-26).

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
    creditClock, r1Ratio, inventoryByNode, topSkus, marginScatter,
    sizeMarket, tacosFba,
    loading, error, reload,
  } = useDashboardKpis();
  // byStatusByBrand removido 2026-05-26 (CEO) - widget Pipeline operativo retirado.
  const { brands, resolveBrand } = useBrandsLight();

  // ── Navegación de drill-downs ─────
  const onOpenExpediente = useCallback(async (id) => {
    // 1) Mocks legacy (HERO scenario).
    const oc = OCS.find((o) => Array.isArray(o.expedientes) && o.expedientes.includes(id));
    if (oc) { navigate(`/expedientes/${oc.id}/exp/${id}`); return; }
    // 2) Sprint 2026-06-11 · datos reales: el click debe abrir el DETALLE
    //    de la OC del expediente (no el listado). Resolvemos oc_id en vivo.
    try {
      const exp = await expedientesApi.get(id);
      if (exp?.oc_id) { navigate(`/expedientes/${exp.oc_id}`); return; }
    } catch { /* fallthrough al listado */ }
    navigate("/expedientes");
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

  // Sprint 2026-05-22 · flags _source para etiquetar KPIs derivados.
  // El backend ahora pasa cascada de fallbacks; el card muestra
  // "· estimado" en el subtitulo cuando el dato NO es de fuente primaria.
  const marginSource = k.margin_source || null;
  const creditSource = creditClock?._source || null;
  const tacosSource  = tacosFba?._source  || null;
  const isDerived = (src) => src && src !== "primary" && src !== "no_data" && src !== "no_scope";
  const derivedTag = (src) =>
    isDerived(src) ? (lang === "en" ? " · estimated" : " · estimado") : "";

  // ── Series Banda 2 (legacy cashflow) ─────
  // Sprint 2026-05-22 · Cashflow card oculta hasta que haya datos reales en
  // cobros.cobro/pago. Las series se conservan para retomarse cuando el
  // módulo de cobranza esté poblado. ESLint ignore: variables intencionalmente
  // unused — quitarlas implicaría volver a recablear el feed completo.
  // eslint-disable-next-line no-unused-vars
  const _cashflowSeriesReal       = useMemo(() => cashflowToSeries(cashflow, "real"),       [cashflow]);
  // eslint-disable-next-line no-unused-vars
  const _cashflowSeriesProyectado = useMemo(() => cashflowToSeries(cashflow, "proyectado"), [cashflow]);

  // Pipeline por marca removido 2026-05-26 (CEO).

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
            {isAdmin
              ? (lang === "en" ? "OVERVIEW" : "VISTA GENERAL")
              : (lang === "en" ? "MY ORDERS" : "MIS PEDIDOS")}
          </div>
          <h1 className="page-title">{tr(lang, "dashboard")}</h1>
          <div className="page-subtitle">
            {isAdmin
              ? (lang === "en" ? "Operating cockpit · " : "Cockpit operativo · ")
              : (lang === "en" ? "Summary · " : "Resumen · ")}
            {new Date().toLocaleDateString(lang === "en" ? "en-US" : "es-PE", {
              weekday: "long", day: "2-digit", month: "long", year: "numeric",
            })}
          </div>
        </div>
        <div className="flex gap-2" style={{ alignItems: "center", flexWrap: "wrap" }}>
          {can("create_expediente") && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => navigate("/wizard")}
            >
              <IconPlus size={14} /> {tr(lang, "new_expediente")}
            </button>
          )}
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
        </div>
      </div>

      {/* Filtros globales · CEO-ONLY (marca/mercado/periodo son
          dimensiones internas que el cliente B2B no necesita) */}
      {isAdmin && <GlobalFilters value={filters} onChange={setFilters} brands={brands} lang={lang} />}

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
      {/* Sprint 2026-06-11 rev2 (CEO) · BANDA 1 ahora es CEO-ONLY: el
          cliente veía "Expedientes activos" cargar primero y luego su
          banda propia (doble carga escalonada). Su KpiStrip ya trae el
          conteo de expedientes — una sola carga, una sola fuente. */}
      {isAdmin && (
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

        {/* KPIs 2–6 son CEO-ONLY (exposicion financiera, margen,
            reloj credito, TACoS Amazon, % R1+). El cliente B2B solo
            ve "Expedientes activos" en esta banda. */}
        {isAdmin && (<>
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

        {/* 3 · Margen proyectado ponderado · SUM(margin*cost)/SUM(cost) */}
        <SafeWidget lang={lang} endpoint="/api/analytics/dashboard_kpis/">
          {loading
            ? <div className="stat"><Skeleton height={120} /></div>
            : <KpiCard
                lang={lang}
                label={lang === "en" ? "Weighted projected margin" : "Margen proyectado ponderado"}
                // Sprint 2026-05-22 · 0% es valor honesto cuando backend marca
                // margin_source distinto de no_data/no_scope (ej. no_invoicing_yet,
                // derived_invoiced_cost…). Antes el gate `> 0` lo escondia.
                value={
                  kpiMarginPct != null && (
                    kpiMarginPct > 0 ||
                    (marginSource && marginSource !== "no_data" && marginSource !== "no_scope")
                  ) ? kpiMarginPct : null
                }
                valueFmt={(v) => `${(v * 100).toFixed(1)}%`}
                sub={(lang === "en"
                  ? "Active files · cost-weighted"
                  : "Activos · ponderado por costo") + derivedTag(marginSource)}
                sparkColor="var(--info)"
                threshold={
                  kpiMarginPct == null ? undefined
                  : kpiMarginPct > 0.18 ? "success"
                  : kpiMarginPct > 0.12 ? "warning"
                  : "critical"
                }
                emptyEndpoint="/api/analytics/dashboard_kpis/"
                emptyHint={lang === "en"
                  ? "No active files with projected margin yet."
                  : "Sin expedientes activos con margen proyectado."}
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
                sub={(creditClock?.n_files
                  ? (lang === "en"
                      ? `${creditClock.n_files} files${creditClock.p90 != null ? ` · p90 ${creditClock.p90.toFixed(0)}d` : ""}`
                      : `${creditClock.n_files} exp.${creditClock.p90 != null ? ` · p90 ${creditClock.p90.toFixed(0)}d` : ""}`)
                  : (lang === "en" ? "Last 90 days" : "Últimos 90 días"))
                  + (creditSource === "derived_active_credit_days_concedido"
                       ? (lang === "en" ? " · concedido" : " · plazo concedido")
                       : "")
                  + derivedTag(creditSource)}
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

        {/* 5 · TACoS Amazon · FBA-US — cableado al endpoint nuevo */}
        <SafeWidget lang={lang} endpoint="/api/analytics/tacos_fba_us/">
          {loading
            ? <div className="stat"><Skeleton height={120} /></div>
            : <KpiCard
                lang={lang}
                label="TACoS Amazon · FBA-US"
                value={tacosFba?.tacos_pct != null ? Number(tacosFba.tacos_pct) : null}
                valueFmt={(v) => `${(v * 100).toFixed(1)}%`}
                sub={(tacosFba?.sales_usd > 0
                  ? (lang === "en"
                      ? `Spend $${(tacosFba.spend_usd || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })} · last 30d`
                      : `Gasto $${(tacosFba.spend_usd || 0).toLocaleString("es-PE", { maximumFractionDigits: 0 })} · últimos 30d`)
                  : (lang === "en" ? "Last 30 days" : "Últimos 30 días"))
                  + derivedTag(tacosSource)}
                sparkColor="var(--warning)"
                threshold={
                  tacosFba?.tacos_pct == null ? undefined
                  : tacosFba.tacos_pct <= 0.12 ? "success"
                  : tacosFba.tacos_pct <= 0.20 ? "warning"
                  : "critical"
                }
                emptyEndpoint="/api/analytics/tacos_fba_us/"
                emptyHint={tacosFba?._pending
                  ? (lang === "en"
                      ? "Amazon ads schema not migrated yet (run sql/D3)."
                      : "Schema amazon_ads no migrado (correr sql/D3).")
                  : (lang === "en"
                      ? "No Amazon FBA-US sales in last 30d."
                      : "Sin ventas Amazon FBA-US en últimos 30d.")}
              />}
        </SafeWidget>

        {/* 6 · % R1+ · cableado al endpoint (usa corrections_count tras D2) */}
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
                      ? `${r1Ratio.with_corrections ?? 0}/${r1Ratio.total} files · last 90d`
                      : `${r1Ratio.with_corrections ?? 0}/${r1Ratio.total} expedientes · 90d`)
                  : (lang === "en" ? "Last 90 days" : "Últimos 90 días")}
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
                      ? "Pending DB migration: run sql/D2 (corrections_count)."
                      : "Pendiente migración BD: correr sql/D2 (corrections_count).")
                  : (r1Ratio?.total
                      ? (lang === "en"
                          ? "No corrections recorded in last 90 days."
                          : "Sin correcciones registradas en últimos 90 días.")
                      : (lang === "en"
                          ? "No active files in last 90 days."
                          : "Sin expedientes activos en últimos 90 días."))}
              />}
        </SafeWidget>
        </>)}
      </div>
      )}

      {/* ──────────────────────────────────────────────────────────────
          BANDA CLIENTE — Sprint 2026-06-11 (CEO). El usuario B2B ve SU
          operación completa: KPIs, próximas entregas, pares por talla y
          pipeline por fase (scoped a sus legal_entity_ids, R3).
          ────────────────────────────────────────────────────────────── */}
      {!isAdmin && <ClientDashboard lang={lang}/>}

      {/* ──────────────────────────────────────────────────────────────
          BANDA 2 — Heatmap tallas × mercado (full-width)
          Sprint 2026-05-22 · CEO pidió reemplazar Cashflow (que está en $0
          porque no hay cobros/pagos cargados aún) por el histograma global
          de distribución de tallas. Cashflow queda OCULTO hasta que haya
          datos reales en cobros.cobro/pago. Heatmap muestra la curva
          agregada de TODOS los mercados (backend: ?market=ALL por default).
          ────────────────────────────────────────────────────────────── */}
      {isAdmin && (
      <DashboardCard
        title={lang === "en" ? "Size × market heatmap" : "Heatmap tallas × mercado"}
        subtitle={lang === "en"
          ? "Units sold by size — aggregated across markets (last 365d)"
          : "Unidades vendidas por talla — agregado global de mercados (últimos 365d)"}
      >
        <SafeWidget lang={lang} endpoint="/api/analytics/size_market_distribution/">
          {loading
            ? <Skeleton height={300} />
            : <SizeMarketHeatmap
                payload={sizeMarket}
                lang={lang}
                emptyEndpoint="/api/analytics/size_market_distribution/"
              />}
        </SafeWidget>
      </DashboardCard>
      )}

      <div style={{ height: 16 }} />

      {/* ──────────────────────────────────────────────────────────────
          BANDA 3 — Operación
          ────────────────────────────────────────────────────────────── */}
      {/* Sprint 2026-06-11 rev2 (CEO) · BANDA 3 entera CEO-ONLY: la
          tabla "Acciones urgentes" se retiró de la vista cliente (su
          banda propia ya muestra el estado de sus pedidos). */}
      {isAdmin && (
      <div
        className="grid gap-3 mb-6"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}
      >
        {/* 3A - Pipeline por marca removido 2026-05-26 (CEO):
            el widget mostraba siempre placeholder por brand_id NULL.
            Si se requiere reactivar, recuperar del git history. */}

        {/* 3B · Top urgentes (hasta 10) */}
        <DashboardCard
          title={tr(lang, "urgent_actions")}
          subtitle={(() => {
            const n = filteredUrgent.length;
            if (n === 0) return lang === "en" ? "No urgent files" : "Sin expedientes urgentes";
            if (n >= 10) return lang === "en"
              ? "Top 10 by urgency · blocked or credit > 70d"
              : "Top 10 por urgencia · bloqueados o crédito > 70d";
            return lang === "en"
              ? `${n} urgent · blocked or credit > 70d`
              : `${n} urgentes · bloqueados o crédito > 70d`;
          })()}
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

        {/* 3C · Inventario por nodo · CEO-ONLY (datos operativos
            de almacen interno; el cliente B2B solo necesita ver el
            estado de SUS pedidos en "Acciones urgentes") */}
        {isAdmin && (
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
        )}
      </div>
      )}

      {/* ──────────────────────────────────────────────────────────────
          BANDA 4 — Análisis multidimensional · CEO-ONLY entera
          (Top SKUs por margen, Top clientes por exposicion, Scatter
          margen real vs proyectado: todos son indicadores internos
          que NO se exponen al cliente B2B)
          ────────────────────────────────────────────────────────────── */}
      {isAdmin && (
      <div
        className="grid gap-3 mb-6"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))" }}
      >
        {/* 4A · Top SKUs · cableado */}
        <DashboardCard
          title={lang === "en" ? "Top 10 SKUs by margin" : "Top 10 SKUs por margen"}
          subtitle={lang === "en"
            ? "All active lines · ranked by (price_client − price_mwt) × qty"
            : "Todas las líneas activas · rankeadas por (precio_cliente − precio_mwt) × qty"}
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

        {/* 4B · Top clientes (hasta 10) */}
        <DashboardCard
          title={(() => {
            const n = (exposicion || []).length;
            const label = lang === "en" ? "Top clients" : "Top clientes";
            if (n === 0) return label;
            return n >= 10 ? `${label} · Top 10` : `${label}`;
          })()}
          subtitle={(() => {
            const n = (exposicion || []).length;
            if (n === 0) return lang === "en" ? "No client exposure" : "Sin exposición de clientes";
            return lang === "en"
              ? `${Math.min(n, 10)} of ${n} · by open exposure (USD)`
              : `${Math.min(n, 10)} de ${n} · por exposición abierta (USD)`;
          })()}
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

        {/* 4C · Heatmap promovido a BANDA 2 (full-width) en sprint 2026-05-22.
             Quedan solo Top SKUs (4A) + Top clientes (4B) en este grid. */}

        {/* 4D · Scatter margen (CEO-ONLY) · cableado al endpoint nuevo o fallback */}
        {can("view_margin") ? (
          <DashboardCard
            title={lang === "en" ? "Real vs projected margin" : "Margen real vs proyectado"}
            subtitle={lang === "en"
              ? "Per file with lines (last 365d) · margin from price_client − price_mwt · ±15% band marks alert threshold"
              : "Por expediente con líneas (últimos 365d) · margen calculado de precio_cliente − precio_mwt · banda ±15% marca umbral"}
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
      )}

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
