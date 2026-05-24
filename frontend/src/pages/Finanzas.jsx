// frontend/src/pages/Finanzas.jsx
// =====================================================================
// MWT.ONE · Modulo Finanzas (CEO-ONLY)
// Sprint 2026-05-24 · Decision CEO (Alejandro) · Agente AG-FRONTEND
//
// MVP focused: KPIs hero + tabla de comisiones por expediente operado
// por MWT. Reutiliza tokens MWT (--brand-*, --surface-*) y patron de
// tabla densa estilo Cobros/OCDetail.
//
// Deuda diferida (ver docs/finanzas/SPEC_FINANZAS_MODULE_v1.md):
//   - Graficos (BarChart mensual, Top clientes, Scatter SKU, Heatmap):
//     requiere instalar recharts. No incluido en este sprint.
//   - Subpaginas /finanzas/margen y /finanzas/devengo: estructura
//     preparada (router state), implementacion en siguiente sprint.
//   - Export CSV/XLSX: pendiente.
//
// Visibilidad: el item del sidebar se filtra en 04_shell.jsx por
// can("view_financiero_full_dashboard"). El backend ademas hace 403
// si no es admin/ceo (defense in depth).
// =====================================================================
import React, { useEffect, useMemo, useState } from "react";
import { apiFetch, getToken } from "../lib/api.js";

// ---------------------------------------------------------------------
// Helpers de presentacion (centralizados para no multiplicar/dividir
// por 100 en cada componente — punto §10 del spec).
// ---------------------------------------------------------------------
function formatPct(decValue, digits = 2) {
  if (decValue === null || decValue === undefined || decValue === "") return "—";
  const n = typeof decValue === "string" ? parseFloat(decValue) : Number(decValue);
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

function formatMoney(v, currency = "USD") {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function formatExpedienteId(item) {
  return item?.display_id || item?.proforma_codigo || item?.codigo || "—";
}

function formatDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("es-CR", {
      day: "2-digit", month: "2-digit", year: "numeric",
    });
  } catch { return iso; }
}

// ---------------------------------------------------------------------
// Badge de estado de devengo
// ---------------------------------------------------------------------
const DEVENGO_STYLE = {
  PROYECTADA:  { bg: "rgba(168, 216, 234, 0.18)", color: "#036398", label_es: "PROYECTADA",  label_en: "PROJECTED" },
  DEVENGABLE:  { bg: "rgba(117, 203, 179, 0.18)", color: "#0E8A6D", label_es: "DEVENGABLE",  label_en: "ACCRUABLE" },
  DEVENGADA:   { bg: "rgba(0, 178, 134, 0.22)",   color: "#00734F", label_es: "DEVENGADA",   label_en: "ACCRUED"   },
  VENCIDA:     { bg: "rgba(220, 38, 38, 0.16)",   color: "#991B1B", label_es: "VENCIDA",     label_en: "OVERDUE"   },
  MIXTO:       { bg: "rgba(180, 83, 9, 0.18)",    color: "#92400E", label_es: "MIXTO",       label_en: "MIXED"     },
  SIN_TASA:    { bg: "rgba(100, 116, 139, 0.16)", color: "#475569", label_es: "SIN TASA",    label_en: "NO RATE"   },
};
function DevengoBadge({ estado, lang }) {
  const s = DEVENGO_STYLE[estado] || DEVENGO_STYLE.PROYECTADA;
  const label = lang === "en" ? s.label_en : s.label_es;
  return (
    <span style={{
      display: "inline-block", padding: "3px 8px", borderRadius: 6,
      fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
      background: s.bg, color: s.color,
    }}>{label}</span>
  );
}

// ---------------------------------------------------------------------
// KPI card
// ---------------------------------------------------------------------
function KpiCard({ label, value, sub, accent = "var(--brand-primary, #013A57)" }) {
  return (
    <div style={{
      background: "var(--surface, #fff)",
      border: "1px solid var(--border-subtle, #E2E8F0)",
      borderRadius: 12, padding: "18px 20px",
      display: "flex", flexDirection: "column", gap: 4,
    }}>
      <div style={{
        fontSize: 11, fontWeight: 700, textTransform: "uppercase",
        letterSpacing: 0.5, color: "var(--text-tertiary, #94A3B8)",
      }}>{label}</div>
      <div className="tabular-nums" style={{
        fontSize: 24, fontWeight: 800, color: accent, lineHeight: 1.1,
      }}>{value}</div>
      {sub && (
        <div style={{ fontSize: 12, color: "var(--text-secondary, #475569)" }}>
          {sub}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Pagina principal
// ---------------------------------------------------------------------
export default function Finanzas({ lang = "es" }) {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filtroEstado, setFiltroEstado] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch("/finanzas/overview/", { token: getToken() })
      .then(d => { if (!cancelled) setOverview(d); })
      .catch(e => {
        if (!cancelled) {
          const msg = e?.body?.detail || e?.message || String(e);
          setError(msg.includes("403")
            ? (lang === "es"
                ? "No tienes permiso para ver Finanzas (CEO/admin only)."
                : "You do not have permission to view Finanzas (CEO/admin only).")
            : msg);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [lang]);

  const items = useMemo(() => {
    const arr = overview?.items || [];
    if (!filtroEstado) return arr;
    return arr.filter(it => it.devengo_estado === filtroEstado);
  }, [overview, filtroEstado]);

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--text-secondary, #475569)" }}>
        {lang === "es" ? "Cargando Finanzas…" : "Loading Finanzas…"}
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 40 }}>
        <div style={{
          padding: "14px 18px", borderRadius: 8,
          background: "color-mix(in oklab, var(--danger, #DC2626) 12%, transparent)",
          color: "var(--danger, #991B1B)",
          border: "1px solid color-mix(in oklab, var(--danger, #DC2626) 30%, transparent)",
          fontSize: 14,
        }}>{error}</div>
      </div>
    );
  }

  const k = overview?.kpis || {};

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1400, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div className="micro" style={{
          fontSize: 11, fontWeight: 700, letterSpacing: 1,
          color: "var(--text-tertiary, #94A3B8)", textTransform: "uppercase",
        }}>
          {lang === "es" ? "CEO-ONLY · INTERNAL" : "CEO-ONLY · INTERNAL"}
        </div>
        <h1 style={{
          fontSize: 28, fontWeight: 800, color: "var(--brand-primary, #013A57)",
          letterSpacing: "-0.5px", margin: "4px 0 6px",
        }}>{lang === "es" ? "Finanzas" : "Finance"}</h1>
        <p style={{ color: "var(--text-secondary, #475569)", fontSize: 14, margin: 0 }}>
          {lang === "es"
            ? "Comisiones MWT, margen ponderado y calendario de devengo. Datos calculados en tiempo real desde expedientes operados por Muito Work Limitada."
            : "MWT commissions, weighted margin and accrual calendar. Real-time data from expedientes operated by Muito Work Limitada."}
        </p>
      </div>

      {/* KPIs hero */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        gap: 14, marginBottom: 24,
      }}>
        <KpiCard
          label={lang === "es" ? "Comisión total devengable" : "Total accruable commission"}
          value={formatMoney(k.comision_total_devengable)}
          sub={lang === "es"
            ? `${k.expedientes_count || 0} expedientes`
            : `${k.expedientes_count || 0} files`}
        />
        <KpiCard
          label={lang === "es" ? "Comisión devengada" : "Accrued commission"}
          value={formatMoney(k.comision_devengada)}
          accent="var(--success, #00B286)"
          sub={lang === "es" ? "ya cobrada por MWT" : "already collected by MWT"}
        />
        <KpiCard
          label={lang === "es" ? "Comisión pendiente" : "Pending commission"}
          value={formatMoney(k.comision_pendiente)}
          accent="var(--warning, #B45309)"
          sub={lang === "es" ? "devengable + vencida" : "accruable + overdue"}
        />
        <KpiCard
          label={lang === "es" ? "Margen total · Margen %" : "Total margin · Margin %"}
          value={`${formatMoney(k.margen_total_usd)}`}
          sub={`${lang === "es" ? "Pond." : "Wgt."} ${formatPct(k.margen_pct_ponderado)}`}
        />
      </div>

      {/* Aviso si hay expedientes sin tasa */}
      {Number(k.expedientes_sin_tasa_count || 0) > 0 && (
        <div style={{
          marginBottom: 16, padding: "10px 14px", borderRadius: 8,
          background: "rgba(180, 83, 9, 0.10)",
          border: "1px solid rgba(180, 83, 9, 0.30)",
          color: "#92400E", fontSize: 13, fontWeight: 600,
        }}>
          {lang === "es"
            ? `Hay ${k.expedientes_sin_tasa_count} expediente(s) sin tasa de comisión configurada. Revisa el campo comision_pct del cliente.`
            : `${k.expedientes_sin_tasa_count} file(s) without commission rate configured. Check the client's comision_pct.`}
        </div>
      )}

      {/* Filtro */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12, marginBottom: 12,
      }}>
        <div style={{
          fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
          color: "var(--text-tertiary, #94A3B8)", textTransform: "uppercase",
        }}>{lang === "es" ? "Filtrar por devengo:" : "Filter by accrual:"}</div>
        <select
          value={filtroEstado}
          onChange={(e) => setFiltroEstado(e.target.value)}
          style={{
            padding: "6px 10px", border: "1px solid var(--border, #CBD5E1)",
            borderRadius: 6, fontSize: 12, fontWeight: 600,
            background: "var(--surface, #fff)",
          }}
        >
          <option value="">{lang === "es" ? "Todos" : "All"}</option>
          {Object.keys(DEVENGO_STYLE).map(k0 => (
            <option key={k0} value={k0}>
              {lang === "es" ? DEVENGO_STYLE[k0].label_es : DEVENGO_STYLE[k0].label_en}
            </option>
          ))}
        </select>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-tertiary, #94A3B8)" }}>
          {items.length} {lang === "es" ? "resultados" : "results"}
        </span>
      </div>

      {/* Tabla de comisiones */}
      <div style={{
        background: "var(--surface, #fff)",
        border: "1px solid var(--border-subtle, #E2E8F0)",
        borderRadius: 12, overflow: "hidden",
      }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{
              background: "var(--surface-alt, #F1F5F9)",
              borderBottom: "2px solid var(--border, #CBD5E1)",
            }}>
              <Th>{lang === "es" ? "ID" : "ID"}</Th>
              <Th>{lang === "es" ? "Cliente" : "Client"}</Th>
              <Th right>{lang === "es" ? "Tasa" : "Rate"}</Th>
              <Th right>{lang === "es" ? "Total MWT" : "MWT total"}</Th>
              <Th right>{lang === "es" ? "Total cliente" : "Client total"}</Th>
              <Th right>{lang === "es" ? "Δ $" : "Δ $"}</Th>
              <Th right>{lang === "es" ? "Comisión $" : "Commission $"}</Th>
              <Th right>{lang === "es" ? "Margen %" : "Margin %"}</Th>
              <Th>{lang === "es" ? "Plazos (MWT/Cli)" : "Terms (MWT/Cli)"}</Th>
              <Th>{lang === "es" ? "Fecha devengo" : "Accrual date"}</Th>
              <Th>{lang === "es" ? "Estado" : "Status"}</Th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={11} style={{
                  padding: "32px 16px", textAlign: "center",
                  color: "var(--text-tertiary, #94A3B8)", fontSize: 13,
                }}>
                  {lang === "es"
                    ? "No hay expedientes operados por MWT que coincidan con el filtro."
                    : "No MWT-operated files match the filter."}
                </td>
              </tr>
            )}
            {items.map((it, i) => (
              <tr key={it.expediente_id} style={{
                borderBottom: "1px solid var(--border-subtle, #F1F5F9)",
                background: i % 2 === 1 ? "rgba(241, 245, 249, 0.4)" : "transparent",
              }}>
                <Td mono>{formatExpedienteId(it)}</Td>
                <Td>
                  <div style={{ fontWeight: 600, color: "var(--text-primary, #0F172A)" }}>
                    {it.cliente_razon_social}
                  </div>
                  {it.cliente_segmento && (
                    <div style={{ fontSize: 10, color: "var(--text-tertiary, #94A3B8)", marginTop: 2 }}>
                      {lang === "es" ? "Segmento" : "Segment"} {it.cliente_segmento}
                    </div>
                  )}
                </Td>
                <Td right>
                  {formatPct(it.commission_rate)}
                  {it.commission_rate_source === "expediente.commission_pct" && (
                    <span title={lang === "es" ? "Override del expediente" : "Expediente override"}
                          style={{ marginLeft: 4, color: "var(--brand-accent, #75CBB3)", fontWeight: 700 }}>
                      *
                    </span>
                  )}
                </Td>
                <Td right mono>{formatMoney(it.total_mwt)}</Td>
                <Td right mono>{formatMoney(it.total_client)}</Td>
                <Td right mono style={{ fontWeight: 700, color: "var(--brand-primary, #013A57)" }}>
                  {formatMoney(it.delta_total)}
                </Td>
                <Td right mono style={{ fontWeight: 700, color: "var(--success, #00B286)" }}>
                  {it.commission_amount === null ? "—" : formatMoney(it.commission_amount)}
                </Td>
                <Td right>{formatPct(it.margen_pct)}</Td>
                <Td>
                  <span className="tabular-nums" style={{ fontSize: 11 }}>
                    {it.credit_days_mwt || "—"} / {it.credit_days_cliente || "—"}d
                  </span>
                </Td>
                <Td>{formatDate(it.fecha_devengo_esperada)}</Td>
                <Td><DevengoBadge estado={it.devengo_estado} lang={lang}/></Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer · deuda diferida */}
      <div style={{
        marginTop: 18, padding: "10px 14px", borderRadius: 8,
        background: "rgba(48, 131, 254, 0.06)",
        border: "1px solid rgba(48, 131, 254, 0.20)",
        fontSize: 11, color: "var(--text-secondary, #475569)", lineHeight: 1.5,
      }}>
        <strong style={{ color: "var(--brand-primary, #013A57)" }}>
          {lang === "es" ? "Próximos sprints:" : "Coming sprints:"}
        </strong>{" "}
        {lang === "es"
          ? "gráficos (comisión por mes, top clientes, scatter SKU, heatmap), subpáginas /finanzas/margen y /finanzas/devengo, export CSV/XLSX, vista materializada mv_linea_finanzas con refresh por Celery. Ver docs/finanzas/SPEC_FINANZAS_MODULE_v1.md."
          : "charts (commission by month, top clients, SKU scatter, heatmap), /finanzas/margen and /finanzas/devengo subpages, CSV/XLSX export, mv_linea_finanzas materialized view with Celery refresh. See docs/finanzas/SPEC_FINANZAS_MODULE_v1.md."}
      </div>
    </div>
  );
}

// Helpers de celda
function Th({ children, right }) {
  return (
    <th style={{
      padding: "10px 12px",
      textAlign: right ? "right" : "left",
      fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
      color: "var(--text-tertiary, #94A3B8)", textTransform: "uppercase",
      whiteSpace: "nowrap",
    }}>{children}</th>
  );
}
function Td({ children, right, mono, style }) {
  return (
    <td className={mono ? "tabular-nums" : ""} style={{
      padding: "9px 12px",
      textAlign: right ? "right" : "left",
      color: "var(--text-primary, #0F172A)",
      fontFamily: mono ? "'JetBrains Mono', monospace" : undefined,
      whiteSpace: "nowrap",
      ...(style || {}),
    }}>{children}</td>
  );
}
