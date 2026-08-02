// ─────────────────────────────────────────────────────────────────────
// admin/widgetRegistry — Sprint 2026-08-02 · Dashboard personalizable
// ADMIN/CEO. Mismo patrón que client/widgetRegistry.jsx: una entrada por
// sección del viejo Dashboard.jsx (bandas 1-4) + widgets ocultos por
// defecto (cashflow, pipeline_brand).
//
// Diferencia admin: cada entrada declara `scopeable: { client, brand }`
// y el grid inyecta `ctx.scope` ("general" | "cliente:<id>" | "marca:<id>").
//   · Endpoints con dimensión server-side (kpis, aging, cashflow,
//     credit_clock, r1, size_market) → scopeToParams() → ?client_id /
//     ?brand_id (backend los intersecta con el scope multitenant, R3).
//   · Endpoints cuya fila ya trae la dimensión (urgent, top_skus,
//     margin_scatter, exposicion, by_status_brand) → se fetchea el scope
//     general UNA vez (cache SWR compartida) y se filtra client-side.
//   · tacos / inventory_nodes NO son scopeables (sin dimensión en el
//     schema): el chip se muestra deshabilitado ("Solo general").
//
// ctx = { lang, scope, refreshNonce, fmtAmount, secondaryBrl,
//         resolveBrand, resolveClient, onOpenExpediente, onOpenNode }
// ─────────────────────────────────────────────────────────────────────
import React, { useMemo } from "react";
import { tr } from "../../../lib/i18n.js";
import { useAdminWidgetData } from "../../../hooks/useAdminWidgetData.js";
import {
  KpiCard,
  TimeseriesChart,
  PipelineByBrandTimeline,
  UrgentExpedientesTable,
  MarginScatter,
  TopClientsTable,
  TopSkusTable,
  NodeInventoryGrid,
  SizeMarketHeatmap,
} from "../DashboardPrimitives.jsx";

// ─────────────────────────────────────────────────────────────────────
// Scope por widget — helpers puros
// ─────────────────────────────────────────────────────────────────────
export const scopeClientId = (scope) =>
  String(scope || "").startsWith("cliente:") ? String(scope).slice("cliente:".length) : null;
export const scopeBrandId = (scope) =>
  String(scope || "").startsWith("marca:") ? String(scope).slice("marca:".length) : null;

/** scope → query params del endpoint (server-side). null = general. */
export function scopeToParams(scope) {
  const cid = scopeClientId(scope);
  if (cid) return { client_id: cid };
  const bid = scopeBrandId(scope);
  if (bid) return { brand_id: bid };
  return null;
}

const sameId = (a, b) => a != null && b != null && String(a) === String(b);

/** Filtro client-side para datasets que ya traen client_id / brand_id. */
function applyScope(rows, scope, { clientKey = "client_id", brandKey = "brand_id" } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const cid = scopeClientId(scope);
  const bid = scopeBrandId(scope);
  if (!cid && !bid) return list;
  return list.filter((r) => {
    if (cid && !sameId(r?.[clientKey], cid)) return false;
    if (bid && !sameId(r?.[brandKey], bid)) return false;
    return true;
  });
}

// ─────────────────────────────────────────────────────────────────────
// Helpers visuales (copiados del viejo Dashboard.jsx)
// ─────────────────────────────────────────────────────────────────────
const SHIMMER_KEYFRAMES = `
@keyframes mwt-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
`;

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

// Flags _source del backend (Sprint 2026-05-22): etiqueta "· estimado"
// cuando el dato NO es de fuente primaria.
const isDerivedSrc = (src) => src && src !== "primary" && src !== "no_data" && src !== "no_scope";
const derivedTag = (src, lang) =>
  isDerivedSrc(src) ? (lang === "en" ? " · estimated" : " · estimado") : "";

// ─────────────────────────────────────────────────────────────────────
// ScopeChip — selector de scope en el header de cada widget.
// ─────────────────────────────────────────────────────────────────────
const chipStyle = {
  font: "500 11.5px/1 var(--font-body)",
  color: "var(--text-secondary)",
  background: "var(--surface)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-sm)",
  padding: "4px 6px",
  maxWidth: 180,
  outline: "none",
};

export function ScopeChip({ scope = "general", scopeable = {}, clients = [], brands = [], lang = "es", onChange }) {
  const es = lang === "es";
  const canClient = !!scopeable.client;
  const canBrand = !!scopeable.brand;
  if (!canClient && !canBrand) {
    return (
      <span
        title={es
          ? "Este widget no tiene dimensión cliente/marca en el backend."
          : "This widget has no client/brand dimension in the backend."}
        style={{
          font: "600 10px/1 var(--font-body)",
          color: "var(--text-tertiary)",
          border: "1px dashed var(--border-strong)",
          borderRadius: "var(--radius-sm)",
          padding: "4px 8px",
          whiteSpace: "nowrap",
        }}
      >
        {es ? "Solo general" : "General only"}
      </span>
    );
  }
  return (
    <select
      value={scope}
      onChange={(e) => onChange(e.target.value)}
      aria-label={es ? "Scope del widget" : "Widget scope"}
      style={chipStyle}
    >
      <option value="general">{es ? "General" : "General"}</option>
      {canClient && clients.length > 0 && (
        <optgroup label={es ? "Cliente" : "Client"}>
          {clients.map((c) => (
            <option key={c.id} value={`cliente:${c.id}`}>
              {(es ? "Cliente: " : "Client: ") + (c.name || c.id)}
            </option>
          ))}
        </optgroup>
      )}
      {canBrand && brands.length > 0 && (
        <optgroup label={es ? "Marca" : "Brand"}>
          {brands.map((b) => (
            <option key={b.id} value={`marca:${b.id}`}>
              {(es ? "Marca: " : "Brand: ") + (b.name || b.id)}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Widgets — BANDA 1 (KPIs individuales)
// ─────────────────────────────────────────────────────────────────────

function KpiActiveWidget({ ctx }) {
  const { lang, scope, refreshNonce } = ctx;
  const { data, loading } = useAdminWidgetData("kpis", scopeToParams(scope), refreshNonce);
  if (loading) return <Skeleton height={120} />;
  const v = data?.active != null ? Number(data.active) : null;
  return (
    <KpiCard
      lang={lang}
      label={tr(lang, "active_exp")}
      value={v}
      valueFmt={(x) => x.toLocaleString(lang === "en" ? "en-US" : "es-PE")}
      sub={lang === "en"
        ? "Open files (not closed/cancelled)"
        : "Expedientes abiertos (no cerrados/cancelados)"}
      sparkColor="var(--brand-accent)"
      emptyEndpoint="/api/analytics/dashboard_kpis/"
    />
  );
}

function KpiCashRiskWidget({ ctx }) {
  const { lang, scope, refreshNonce, fmtAmount, secondaryBrl } = ctx;
  const { data, loading } = useAdminWidgetData("aging", scopeToParams(scope), refreshNonce);
  if (loading) return <Skeleton height={120} />;
  const v = cashAtRisk(data);
  return (
    <KpiCard
      lang={lang}
      label={lang === "en" ? "Cash at risk" : "Cash en riesgo"}
      value={v}
      valueFmt={(x) => fmtAmount(x)}
      secondary={secondaryBrl(v)}
      sub={lang === "en" ? "Receivables 61–90d + 90d+" : "Por cobrar 61–90d + 90d+"}
      sparkColor="var(--critical)"
      threshold={(v || 0) > 0 ? "critical" : "success"}
      emptyEndpoint="/api/analytics/aging/"
    />
  );
}

function KpiMarginWidget({ ctx }) {
  const { lang, scope, refreshNonce } = ctx;
  const { data, loading } = useAdminWidgetData("kpis", scopeToParams(scope), refreshNonce);
  if (loading) return <Skeleton height={120} />;
  const marginSource = data?.margin_source || null;
  const pct = data?.margin_pct != null ? Number(data.margin_pct) : null;
  // Sprint 2026-05-22 · 0% es valor honesto cuando backend marca
  // margin_source distinto de no_data/no_scope.
  const v = pct != null && (
    pct > 0 || (marginSource && marginSource !== "no_data" && marginSource !== "no_scope")
  ) ? pct : null;
  return (
    <KpiCard
      lang={lang}
      label={lang === "en" ? "Weighted projected margin" : "Margen proyectado ponderado"}
      value={v}
      valueFmt={(x) => `${(x * 100).toFixed(1)}%`}
      sub={(lang === "en"
        ? "Active files · cost-weighted"
        : "Activos · ponderado por costo") + derivedTag(marginSource, lang)}
      sparkColor="var(--info)"
      threshold={
        v == null ? undefined
        : v > 0.18 ? "success"
        : v > 0.12 ? "warning"
        : "critical"
      }
      emptyEndpoint="/api/analytics/dashboard_kpis/"
      emptyHint={lang === "en"
        ? "No active files with projected margin yet."
        : "Sin expedientes activos con margen proyectado."}
    />
  );
}

function KpiCreditClockWidget({ ctx }) {
  const { lang, scope, refreshNonce } = ctx;
  const { data, loading } = useAdminWidgetData("credit_clock", scopeToParams(scope), refreshNonce);
  if (loading) return <Skeleton height={120} />;
  const v = data?.avg_days != null ? Number(data.avg_days) : null;
  const creditSource = data?._source || null;
  return (
    <KpiCard
      lang={lang}
      label={lang === "en" ? "Avg. credit clock" : "Reloj crédito promedio"}
      value={v}
      valueFmt={(x) => `${x.toFixed(0)}d`}
      sub={(data?.n_files
        ? (lang === "en"
            ? `${data.n_files} files${data.p90 != null ? ` · p90 ${Number(data.p90).toFixed(0)}d` : ""}`
            : `${data.n_files} exp.${data.p90 != null ? ` · p90 ${Number(data.p90).toFixed(0)}d` : ""}`)
        : (lang === "en" ? "Last 90 days" : "Últimos 90 días"))
        + (creditSource === "derived_active_credit_days_concedido"
             ? (lang === "en" ? " · concedido" : " · plazo concedido")
             : "")
        + derivedTag(creditSource, lang)}
      sparkColor="var(--info)"
      threshold={
        v == null ? undefined
        : v <= 60 ? "success"
        : v <= 80 ? "warning"
        : "critical"
      }
      emptyEndpoint="/api/analytics/credit_clock_avg/"
      emptyHint={lang === "en"
        ? "No paid receivables in last 90d to compute."
        : "Sin cobranzas pagadas en últimos 90d para calcular."}
    />
  );
}

function KpiTacosWidget({ ctx }) {
  const { lang, refreshNonce } = ctx;
  // General-only: amazon_ads.account no tiene client_id/brand_id (sql/D3).
  const { data, loading } = useAdminWidgetData("tacos", null, refreshNonce);
  if (loading) return <Skeleton height={120} />;
  const tacosSource = data?._source || null;
  const v = data?.tacos_pct != null ? Number(data.tacos_pct) : null;
  return (
    <KpiCard
      lang={lang}
      label="TACoS Amazon · FBA-US"
      value={v}
      valueFmt={(x) => `${(x * 100).toFixed(1)}%`}
      sub={(data?.sales_usd > 0
        ? (lang === "en"
            ? `Spend $${(data.spend_usd || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })} · last 30d`
            : `Gasto $${(data.spend_usd || 0).toLocaleString("es-PE", { maximumFractionDigits: 0 })} · últimos 30d`)
        : (lang === "en" ? "Last 30 days" : "Últimos 30 días"))
        + derivedTag(tacosSource, lang)}
      sparkColor="var(--warning)"
      threshold={
        v == null ? undefined
        : v <= 0.12 ? "success"
        : v <= 0.20 ? "warning"
        : "critical"
      }
      emptyEndpoint="/api/analytics/tacos_fba_us/"
      emptyHint={data?._pending
        ? (lang === "en"
            ? "Amazon ads schema not migrated yet (run sql/D3)."
            : "Schema amazon_ads no migrado (correr sql/D3).")
        : (lang === "en"
            ? "No Amazon FBA-US sales in last 30d."
            : "Sin ventas Amazon FBA-US en últimos 30d.")}
    />
  );
}

function KpiR1Widget({ ctx }) {
  const { lang, scope, refreshNonce } = ctx;
  const { data, loading } = useAdminWidgetData("r1", scopeToParams(scope), refreshNonce);
  if (loading) return <Skeleton height={120} />;
  const v = data?.ratio != null ? Number(data.ratio) : null;
  return (
    <KpiCard
      lang={lang}
      label={lang === "en" ? "% files with R1+ correction" : "% expedientes con corrección R1+"}
      value={v}
      valueFmt={(x) => `${(x * 100).toFixed(1)}%`}
      sub={data?.total
        ? (lang === "en"
            ? `${data.with_corrections ?? 0}/${data.total} files · last 90d`
            : `${data.with_corrections ?? 0}/${data.total} expedientes · 90d`)
        : (lang === "en" ? "Last 90 days" : "Últimos 90 días")}
      sparkColor="var(--warning)"
      threshold={
        v == null ? undefined
        : v < 0.10 ? "success"
        : v < 0.25 ? "warning"
        : "critical"
      }
      emptyEndpoint="/api/analytics/r1_correction_ratio/"
      emptyHint={data?._pending
        ? (lang === "en"
            ? "Pending DB migration: run sql/D2 (corrections_count)."
            : "Pendiente migración BD: correr sql/D2 (corrections_count).")
        : (data?.total
            ? (lang === "en"
                ? "No corrections recorded in last 90 days."
                : "Sin correcciones registradas en últimos 90 días.")
            : (lang === "en"
                ? "No active files in last 90 days."
                : "Sin expedientes activos en últimos 90 días."))}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────
// Widgets — BANDAS 2-4 (grids / tablas / charts)
// ─────────────────────────────────────────────────────────────────────

function HeatmapWidget({ ctx }) {
  const { lang, scope, refreshNonce } = ctx;
  const { data, loading } = useAdminWidgetData("size_market", scopeToParams(scope), refreshNonce);
  if (loading) return <Skeleton height={300} />;
  return (
    <SizeMarketHeatmap
      payload={data}
      lang={lang}
      emptyEndpoint="/api/analytics/size_market_distribution/"
    />
  );
}

function UrgentWidget({ ctx }) {
  const { lang, scope, refreshNonce, resolveBrand, resolveClient, onOpenExpediente } = ctx;
  // La fila ya trae client_id/brand_id → fetch general compartido (SWR)
  // y filtro client-side por scope.
  const { data, loading } = useAdminWidgetData("urgent", null, refreshNonce);
  const items = useMemo(() => applyScope(data, scope), [data, scope]);
  if (loading) return <div style={{ padding: 20 }}><Skeleton height={200} /></div>;
  return (
    <UrgentExpedientesTable
      items={items}
      resolveBrand={resolveBrand}
      resolveClient={resolveClient}
      isAdmin
      onOpen={onOpenExpediente}
      lang={lang}
      emptyEndpoint="/api/analytics/urgent/"
    />
  );
}

function InventoryNodesWidget({ ctx }) {
  const { lang, refreshNonce, onOpenNode } = ctx;
  // General-only: stock por nodo, sin dimensión cliente/marca.
  const { data, loading } = useAdminWidgetData("inventory_nodes", null, refreshNonce);
  if (loading) return <Skeleton height={140} />;
  return (
    <NodeInventoryGrid
      items={Array.isArray(data) ? data : []}
      lang={lang}
      onOpenNode={onOpenNode}
      emptyEndpoint="/api/analytics/inventory_coverage_by_node/"
    />
  );
}

function TopSkusWidget({ ctx }) {
  const { lang, scope, refreshNonce, resolveBrand } = ctx;
  const { data, loading } = useAdminWidgetData("top_skus", null, refreshNonce);
  const items = useMemo(() => applyScope(data, scope), [data, scope]);
  if (loading) return <div style={{ padding: 20 }}><Skeleton height={220} /></div>;
  return (
    <TopSkusTable
      items={items}
      resolveBrand={resolveBrand}
      lang={lang}
      emptyEndpoint="/api/analytics/top_skus_margen/"
    />
  );
}

function TopClientsWidget({ ctx }) {
  const { lang, scope, refreshNonce, resolveClient } = ctx;
  const { data, loading } = useAdminWidgetData("exposicion", null, refreshNonce);
  const items = useMemo(() => applyScope(data, scope), [data, scope]);
  if (loading) return <div style={{ padding: 20 }}><Skeleton height={220} /></div>;
  return (
    <TopClientsTable
      items={items}
      resolveClient={resolveClient}
      lang={lang}
      emptyEndpoint="/api/analytics/exposicion_clientes/"
    />
  );
}

function MarginScatterWidget({ ctx }) {
  const { lang, scope, refreshNonce, resolveBrand } = ctx;
  const { data: scatter, loading: loadingScatter } =
    useAdminWidgetData("margin_scatter", null, refreshNonce);
  // Fallback por marca cuando el scatter por expediente viene vacío.
  const { data: margenMarcas } = useAdminWidgetData("margen_marcas", null, refreshNonce);
  const points = useMemo(() => {
    const rows = applyScope(scatter, scope);
    if (rows.length) {
      return rows.map((m) => {
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
    // El fallback por marca solo aplica en scope general o de marca
    // (margen_marcas no trae dimensión cliente).
    if (scopeClientId(scope)) return [];
    return applyScope(margenMarcas, scope).map((m) => {
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
  }, [scatter, margenMarcas, scope, resolveBrand]);
  if (loadingScatter) return <Skeleton height={280} />;
  return (
    <MarginScatter
      points={points}
      driftThreshold={0.15}
      lang={lang}
      emptyEndpoint="/api/analytics/expediente_margin_scatter/"
    />
  );
}

function CashflowWidget({ ctx }) {
  const { lang, scope, refreshNonce } = ctx;
  const { data, loading } = useAdminWidgetData("cashflow", scopeToParams(scope), refreshNonce);
  const seriesReal = useMemo(() => cashflowToSeries(data, "real"), [data]);
  const seriesProy = useMemo(() => cashflowToSeries(data, "proyectado"), [data]);
  if (loading) return <Skeleton height={240} />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <TimeseriesChart
        data={seriesReal}
        label={lang === "en" ? "Collected (real)" : "Cobrado (real)"}
        color="var(--success)"
        lang={lang}
        emptyEndpoint="/api/analytics/cashflow/"
      />
      <TimeseriesChart
        data={seriesProy}
        label={lang === "en" ? "Projected (due)" : "Proyectado (vencimientos)"}
        color="var(--brand-primary)"
        lang={lang}
        emptyEndpoint="/api/analytics/cashflow/"
      />
    </div>
  );
}

function PipelineBrandWidget({ ctx }) {
  const { lang, scope, refreshNonce, resolveBrand } = ctx;
  const { data, loading } = useAdminWidgetData("by_status_brand", null, refreshNonce);
  const rows = useMemo(() => {
    const filtered = applyScope(data, scope);
    const byBrand = new Map();
    filtered.forEach((r) => {
      const bid = r.brand_id;
      if (!bid) return;
      if (!byBrand.has(bid)) {
        const b = resolveBrand(bid) || {};
        byBrand.set(bid, {
          brandId: bid,
          brandName: b.name || bid,
          brandColor: b.color || "var(--brand-primary)",
          byStatus: {},
          total: 0,
        });
      }
      const agg = byBrand.get(bid);
      const n = Number(r.count) || 0;
      agg.byStatus[r.status] = (agg.byStatus[r.status] || 0) + n;
      agg.total += n;
    });
    return Array.from(byBrand.values());
  }, [data, scope, resolveBrand]);
  if (loading) return <Skeleton height={180} />;
  return (
    <PipelineByBrandTimeline
      rows={rows}
      lang={lang}
      emptyEndpoint="/api/analytics/by_status_by_brand/"
    />
  );
}

// ─────────────────────────────────────────────────────────────────────
// Catálogo ADMIN
// ─────────────────────────────────────────────────────────────────────
const KPI = { size: "xs", bare: true };

export const ADMIN_WIDGETS = [
  {
    id: "kpi_active", ...KPI,
    endpoint: "/api/analytics/dashboard_kpis/",
    scopeable: { client: true, brand: true },
    title_es: "Expedientes activos", title_en: "Active files",
    sub_es: "Expedientes abiertos (no cerrados/cancelados)",
    sub_en: "Open files (not closed/cancelled)",
    render: (ctx) => <KpiActiveWidget ctx={ctx} />,
  },
  {
    id: "kpi_cash_risk", ...KPI,
    endpoint: "/api/analytics/aging/",
    scopeable: { client: true, brand: false },
    title_es: "Cash en riesgo", title_en: "Cash at risk",
    sub_es: "Por cobrar 61–90d + 90d+", sub_en: "Receivables 61–90d + 90d+",
    render: (ctx) => <KpiCashRiskWidget ctx={ctx} />,
  },
  {
    id: "kpi_margin", ...KPI,
    endpoint: "/api/analytics/dashboard_kpis/",
    scopeable: { client: true, brand: true },
    title_es: "Margen proyectado ponderado", title_en: "Weighted projected margin",
    sub_es: "Activos · ponderado por costo", sub_en: "Active files · cost-weighted",
    render: (ctx) => <KpiMarginWidget ctx={ctx} />,
  },
  {
    id: "kpi_credit", ...KPI,
    endpoint: "/api/analytics/credit_clock_avg/",
    scopeable: { client: true, brand: false },
    title_es: "Reloj crédito promedio", title_en: "Avg. credit clock",
    sub_es: "Días emisión → pago (últimos 90d)", sub_en: "Days invoice → payment (last 90d)",
    render: (ctx) => <KpiCreditClockWidget ctx={ctx} />,
  },
  {
    id: "kpi_tacos", ...KPI,
    endpoint: "/api/analytics/tacos_fba_us/",
    scopeable: { client: false, brand: false }, // general-only (sql/D3 sin client_id)
    title_es: "TACoS Amazon · FBA-US", title_en: "TACoS Amazon · FBA-US",
    sub_es: "Ad spend / ventas · últimos 30d", sub_en: "Ad spend / sales · last 30d",
    render: (ctx) => <KpiTacosWidget ctx={ctx} />,
  },
  {
    id: "kpi_r1", ...KPI,
    endpoint: "/api/analytics/r1_correction_ratio/",
    scopeable: { client: true, brand: true },
    title_es: "% corrección R1+", title_en: "% R1+ correction",
    sub_es: "Expedientes con corrección · 90d", sub_en: "Files with correction · 90d",
    render: (ctx) => <KpiR1Widget ctx={ctx} />,
  },
  {
    id: "heatmap", size: "full",
    endpoint: "/api/analytics/size_market_distribution/",
    scopeable: { client: true, brand: true },
    title_es: "Heatmap tallas × mercado", title_en: "Size × market heatmap",
    sub_es: "Unidades vendidas por talla — agregado global (últimos 365d)",
    sub_en: "Units sold by size — aggregated across markets (last 365d)",
    render: (ctx) => <HeatmapWidget ctx={ctx} />,
  },
  {
    id: "urgent", size: "md",
    endpoint: "/api/analytics/urgent/",
    scopeable: { client: true, brand: true },
    title_es: "Acciones urgentes", title_en: "Urgent actions",
    sub_es: "Bloqueados o crédito > 70d", sub_en: "Blocked or credit > 70d",
    render: (ctx) => <UrgentWidget ctx={ctx} />,
  },
  {
    id: "inventory_nodes", size: "md",
    endpoint: "/api/analytics/inventory_coverage_by_node/",
    scopeable: { client: false, brand: false }, // general-only (stock por nodo)
    title_es: "Inventario por nodo", title_en: "Inventory by node",
    sub_es: "Días de cobertura · stock por nodo activo",
    sub_en: "Coverage days · stock per active node",
    render: (ctx) => <InventoryNodesWidget ctx={ctx} />,
  },
  {
    id: "top_skus", size: "md",
    endpoint: "/api/analytics/top_skus_margen/",
    scopeable: { client: false, brand: true },
    title_es: "Top 10 SKUs por margen", title_en: "Top 10 SKUs by margin",
    sub_es: "Rankeados por (precio_cliente − precio_mwt) × qty",
    sub_en: "Ranked by (price_client − price_mwt) × qty",
    render: (ctx) => <TopSkusWidget ctx={ctx} />,
  },
  {
    id: "top_clients", size: "md",
    endpoint: "/api/analytics/exposicion_clientes/",
    scopeable: { client: true, brand: false },
    title_es: "Top clientes", title_en: "Top clients",
    sub_es: "Por exposición abierta (USD)", sub_en: "By open exposure (USD)",
    render: (ctx) => <TopClientsWidget ctx={ctx} />,
  },
  {
    id: "margin_scatter", size: "md",
    endpoint: "/api/analytics/expediente_margin_scatter/",
    scopeable: { client: true, brand: true },
    title_es: "Margen real vs proyectado", title_en: "Real vs projected margin",
    sub_es: "Por expediente (últimos 365d) · banda ±15% marca umbral",
    sub_en: "Per file (last 365d) · ±15% band marks alert threshold",
    render: (ctx) => <MarginScatterWidget ctx={ctx} />,
  },
  {
    id: "cashflow", size: "full",
    endpoint: "/api/analytics/cashflow/",
    scopeable: { client: true, brand: false },
    defaultVisible: false, // oculto desde 2026-05-22 (cobros sin poblar)
    title_es: "Cashflow semanal", title_en: "Weekly cashflow",
    sub_es: "Proyectado (vencimientos) vs real (pagos) · 12 semanas",
    sub_en: "Projected (due) vs real (payments) · 12 weeks",
    render: (ctx) => <CashflowWidget ctx={ctx} />,
  },
  {
    id: "pipeline_brand", size: "full",
    endpoint: "/api/analytics/by_status_by_brand/",
    scopeable: { client: false, brand: true },
    defaultVisible: false, // endpoint vivo; entra al catálogo oculto
    title_es: "Pipeline por marca", title_en: "Pipeline by brand",
    sub_es: "Expedientes por estado × marca", sub_en: "Files by status × brand",
    render: (ctx) => <PipelineBrandWidget ctx={ctx} />,
  },
];

const BY_ID = new Map(ADMIN_WIDGETS.map((w) => [w.id, w]));
export const adminWidgetById = (id) => BY_ID.get(id) || null;
export const ADMIN_CATALOG_IDS = ADMIN_WIDGETS.map((w) => w.id);

/** Layout por defecto ADMIN: todo visible salvo los defaultVisible:false. */
export const ADMIN_DEFAULT_LAYOUT = {
  widgets: ADMIN_WIDGETS.map((w) => ({ id: w.id, visible: w.defaultVisible !== false })),
};

export function adminTitleOf(entry, lang) {
  const w = BY_ID.get(entry.id);
  if (!w) return entry.id;
  return lang === "es" ? w.title_es : w.title_en;
}

export function adminSubtitleOf(entry, lang) {
  const w = BY_ID.get(entry.id);
  if (!w) return "";
  return lang === "es" ? w.sub_es : w.sub_en;
}

export { SHIMMER_KEYFRAMES };
