// =====================================================================
// MWT.ONE · DashboardPrimitives
// Componentes de visualización para el Centro de Operaciones (CEO).
// Rediseño 2026-05-20 — Reemplaza el dashboard de 6 KPIs simples por
// 4 bandas verticales (KPIs · Timeseries · Operación · Análisis).
//
// REGLAS APLICADAS (CLAUDE.md §2):
//   R1 — Cero hex literales: solo CSS vars MWT.
//   R3 — Aislamiento de visibilidad: CEO-ONLY se inyecta vía useRole().can(...)
//        desde el padre (este archivo asume que el padre ya filtró).
//   R5 — `tabular-nums` en cualquier dato numérico.
//
// Importante: NO importa mock data. Toda fuente es prop. Si el padre no
// le pasa datos, cada componente renderiza <EmptyState/> honesto.
// =====================================================================
import React, { useMemo, useRef, useState, useCallback } from "react";
import { fmtMoney, fmtShortDate, tr } from "../../lib/i18n.js";
import { Sparkline, Badge } from "../ui/primitives.jsx";
import { IconAlert, IconClock, IconChevRight } from "../../lib/icons.jsx";

// ─────────────────────────────────────────────────────────────────────
// EmptyState — el "enchufe desconectado" honesto.
// Se renderiza cuando un widget no tiene endpoint en backend o devolvió vacío.
// Comunica EXACTAMENTE qué falta para que el CEO sepa qué solicitar.
// ─────────────────────────────────────────────────────────────────────
export function EmptyState({
  title,
  hint,
  endpoint,
  lang = "es",
  compact = false,
  onConfigure,
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: compact ? "20px 12px" : "32px 16px",
        background: "var(--surface-hover)",
        border: "1px dashed var(--border-strong)",
        borderRadius: "var(--radius-lg)",
        color: "var(--text-tertiary)",
        textAlign: "center",
        minHeight: compact ? 80 : 120,
      }}
    >
      <div
        aria-hidden
        style={{
          width: 36, height: 36, borderRadius: "var(--radius-full)",
          background: "var(--bg-alt)",
          display: "grid", placeItems: "center",
          color: "var(--text-secondary)",
        }}
      >
        <IconAlert size={18} />
      </div>
      <div style={{ font: "var(--heading-sm)", color: "var(--text-secondary)" }}>
        {title || (lang === "es" ? "Sin datos" : "No data")}
      </div>
      {hint && (
        <div style={{ font: "var(--caption)", color: "var(--text-tertiary)", maxWidth: 360 }}>
          {hint}
        </div>
      )}
      {endpoint && (
        <code
          title={endpoint}
          style={{
            font: "500 10.5px/1.4 var(--font-mono)",
            color: "var(--text-secondary)",
            background: "var(--bg-alt)",
            padding: "2px 8px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border)",
            // R1 fix · sin esto los paths largos rompían el ancho del card
            maxWidth: "100%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            boxSizing: "border-box",
            wordBreak: "break-all",
          }}
        >
          {endpoint}
        </code>
      )}
      {onConfigure && (
        <button
          type="button"
          onClick={onConfigure}
          className="btn btn-ghost btn-sm"
          style={{ marginTop: 4 }}
        >
          {lang === "es" ? "Solicitar a backend" : "Request from backend"}
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// KpiCard — tarjeta de KPI con sparkline + delta opcional.
// Si `value === null/undefined` muestra EmptyState compacto.
//
// secondary: equivalente en moneda local cuando hay tasa FX disponible.
//   { value: number, currency: 'BRL'|'CRC', source: string, fetchedAt: ISO }
// Si la tasa FX no está disponible, NO se renderiza nada (mandato R1).
// ─────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────
// SafeWidget — error boundary funcional por widget.
// Un widget caído NO debe tumbar la página.
// Sprint 2026-08-02 · movido desde pages/Dashboard.jsx para compartirlo
// entre el dashboard CLIENT y el nuevo grid personalizable ADMIN/CEO.
// ─────────────────────────────────────────────────────────────────────
export class SafeWidget extends React.Component {
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
// KpiCard — tarjeta KPI con sparkline, delta y semáforo.
// ─────────────────────────────────────────────────────────────────────
export function KpiCard({
  label,
  value,
  valueFmt = (v) => v,
  sub,
  spark,                 // array de números para sparkline (90d)
  sparkColor = "var(--brand-accent)",
  delta,                 // { abs?: number, pct?: number, dir: 'up' | 'down' | 'flat', label?: string }
  threshold,             // 'success' | 'warning' | 'critical' — pinta borde superior
  emptyEndpoint,         // path del endpoint que falta
  emptyHint,
  secondary,             // { value, currency, source, fetchedAt }
  lang = "es",
  onClick,
}) {
  const isEmpty = value === null || value === undefined;

  // Semáforo aplicado solo al borde superior, sin invadir el contenido.
  const semColor = threshold === "critical" ? "var(--critical)"
                : threshold === "warning"  ? "var(--warning)"
                : threshold === "success"  ? "var(--success)"
                : "transparent";

  return (
    <button
      type="button"
      onClick={onClick}
      className="stat"
      style={{
        position: "relative",
        cursor: onClick ? "pointer" : "default",
        textAlign: "left",
        background: "var(--surface-raised)",
        borderTop: `2px solid ${semColor}`,
        // Reset de algunos resets de <button>
        font: "inherit",
        color: "inherit",
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        boxSizing: "border-box",
      }}
      aria-label={label}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
        <div className="stat-label">{label}</div>
        {isEmpty ? (
          <div style={{ marginTop: 4 }}>
            <EmptyState
              compact
              lang={lang}
              title={lang === "es" ? "Sin datos" : "No data"}
              hint={emptyHint || (lang === "es"
                ? "El backend aún no entrega esta métrica."
                : "Backend does not deliver this metric yet.")}
              endpoint={emptyEndpoint}
            />
          </div>
        ) : (
          <>
            <div className="stat-row">
              <div className="stat-value tabular">{valueFmt(value)}</div>
              {delta && delta.dir && delta.dir !== "flat" && (
                <span className={`stat-delta ${delta.dir === "up" ? "up" : "down"}`}>
                  {delta.label
                    ? delta.label
                    : (delta.pct != null
                        ? `${delta.pct > 0 ? "+" : ""}${delta.pct.toFixed(1)}%`
                        : delta.abs != null
                          ? `${delta.abs > 0 ? "+" : ""}${delta.abs}`
                          : "")}
                </span>
              )}
            </div>
            {sub && <div className="stat-sub">{sub}</div>}
            {/* Equivalente en moneda local (regla #4 del prompt CEO).
                Solo se renderiza si hay tasa FX viva — nunca inventa. */}
            {secondary && secondary.value != null && (
              <div
                className="tabular"
                title={secondary.source && secondary.fetchedAt
                  ? `${secondary.source} · ${new Date(secondary.fetchedAt).toLocaleString(lang === "es" ? "es-PE" : "en-US")}`
                  : ""}
                style={{
                  font: "500 12px/1.4 var(--font-mono)",
                  color: "var(--text-tertiary)",
                  marginTop: 2,
                }}
              >
                ≈ {new Intl.NumberFormat(lang === "es" ? "es-PE" : "en-US", {
                    style: "currency", currency: secondary.currency, maximumFractionDigits: 0,
                  }).format(secondary.value)}
              </div>
            )}
          </>
        )}
      </div>
      <div className="stat-spark" style={{ marginTop: "auto", paddingTop: 8, width: "100%" }}>
        {Array.isArray(spark) && spark.length > 1
          ? <Sparkline values={spark} color={sparkColor} width={260} height={32} />
          : <span style={{ font: "var(--caption)", color: "var(--text-tertiary)" }}>
              {lang === "es" ? "Sin serie histórica" : "No historical series"}
            </span>}
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────
// TimeseriesChart — gráfico tipo Google Finance.
//   - Hover line vertical + tooltip (valor + fecha)
//   - Selectores 1D / 5D / 1M / 3M / 1A / Max
//   - Eje Y dinámico (no fuerza al 0)
//   - Delta absoluto + porcentual del rango seleccionado
//
// Props:
//   data: [{ date: ISO string, value: number }, ...]
//   label: nombre de la serie (ej. "Cash neto USD")
//   currency: 'USD' | 'BRL' | 'CRC' (solo display)
//   color: CSS var
// ─────────────────────────────────────────────────────────────────────
const HORIZONS = [
  { key: "1D",  days: 1   },
  { key: "5D",  days: 5   },
  { key: "1M",  days: 30  },
  { key: "3M",  days: 90  },
  { key: "1A",  days: 365 },
  { key: "MAX", days: null },
];

export function TimeseriesChart({
  data,
  label,
  currency = "USD",
  color = "var(--brand-primary)",
  height = 240,
  lang = "es",
  emptyEndpoint = "/api/analytics/cashflow/",
}) {
  const [horizon, setHorizon] = useState("3M");
  const [hover, setHover] = useState(null); // { x, y, point }
  const svgRef = useRef(null);

  const series = useMemo(() => {
    const arr = Array.isArray(data) ? data.filter((d) => d && d.date != null && d.value != null) : [];
    arr.sort((a, b) => new Date(a.date) - new Date(b.date));
    if (!arr.length) return [];
    const h = HORIZONS.find((x) => x.key === horizon);
    if (!h || h.days == null) return arr;
    const cutoff = new Date(arr[arr.length - 1].date).getTime() - h.days * 86400000;
    return arr.filter((d) => new Date(d.date).getTime() >= cutoff);
  }, [data, horizon]);

  if (!series.length) {
    return (
      <EmptyState
        lang={lang}
        title={lang === "es" ? "Sin serie temporal" : "No timeseries"}
        hint={lang === "es"
          ? "El backend no devolvió puntos para esta serie."
          : "Backend returned no points for this series."}
        endpoint={emptyEndpoint}
      />
    );
  }

  const W = 880, H = height, padL = 56, padR = 16, padT = 16, padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const ys = series.map((d) => d.value);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const ySpread = yMax - yMin || Math.abs(yMax) || 1;
  // Eje Y dinámico — padding 8% arriba/abajo, sin forzar al 0.
  const y0 = yMin - ySpread * 0.08;
  const y1 = yMax + ySpread * 0.08;
  const yRange = y1 - y0 || 1;

  const x = (i) => padL + (i * innerW) / Math.max(1, series.length - 1);
  const y = (v) => padT + innerH - ((v - y0) / yRange) * innerH;

  const pathD = series.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(" ");
  const areaD = `${pathD} L${x(series.length - 1).toFixed(1)},${padT + innerH} L${x(0).toFixed(1)},${padT + innerH} Z`;

  const first = series[0].value;
  const last  = series[series.length - 1].value;
  const deltaAbs = last - first;
  const deltaPct = first !== 0 ? (deltaAbs / Math.abs(first)) * 100 : null;
  const goingUp  = deltaAbs >= 0;

  // Ticks Y — 4 niveles legibles.
  const ticks = useMemo(() => {
    const steps = 4;
    const out = [];
    for (let i = 0; i <= steps; i++) {
      const v = y0 + (yRange * i) / steps;
      out.push(v);
    }
    return out;
  }, [y0, yRange]);

  const onMove = useCallback((e) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    // Mapear a índice más cercano.
    const i = Math.round(((px - padL) / innerW) * (series.length - 1));
    const ix = Math.max(0, Math.min(series.length - 1, i));
    const pt = series[ix];
    setHover({ x: x(ix), y: y(pt.value), point: pt, index: ix });
  }, [series, innerW]);

  const onLeave = useCallback(() => setHover(null), []);

  const fmtVal = (v) => {
    if (currency === "USD") return fmtMoney(v, "USD");
    // BRL/CRC se aceptan como display-only — el backend siempre persiste USD.
    return new Intl.NumberFormat(lang === "es" ? "es-PE" : "en-US", {
      style: "currency", currency, maximumFractionDigits: 0,
    }).format(v);
  };

  const fmtDateShort = (iso) => {
    const d = new Date(iso);
    return d.toLocaleDateString(lang === "es" ? "es-PE" : "en-US", {
      weekday: "short", day: "2-digit", month: "short",
    });
  };

  return (
    <div>
      {/* Pill superior con valor actual + delta del rango */}
      <div className="flex ai-center jc-between" style={{ marginBottom: 12, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ font: "var(--caption)", color: "var(--text-tertiary)", marginBottom: 2 }}>
            {label}
          </div>
          <div className="flex ai-center gap-3" style={{ flexWrap: "wrap" }}>
            <span className="tabular" style={{ font: "var(--display-md)", color: "var(--text-primary)" }}>
              {fmtVal(last)}
            </span>
            {deltaPct != null && (
              <span
                className="tabular"
                style={{
                  font: "600 13px/1 var(--font-body)",
                  color: goingUp ? "var(--success)" : "var(--critical)",
                  background: goingUp ? "var(--success-bg)" : "var(--critical-bg)",
                  padding: "4px 8px", borderRadius: "var(--radius-sm)",
                }}
              >
                {goingUp ? "▲" : "▼"} {fmtVal(Math.abs(deltaAbs))} ({deltaPct >= 0 ? "+" : ""}{deltaPct.toFixed(1)}%)
              </span>
            )}
            <span style={{ font: "var(--caption)", color: "var(--text-tertiary)" }}>
              {lang === "es" ? "en" : "in"} {horizon}
            </span>
          </div>
        </div>

        {/* Selectores Google-style */}
        <div className="seg" style={{ display: "inline-flex", gap: 2 }}>
          {HORIZONS.map((h) => (
            <button
              key={h.key}
              type="button"
              data-active={horizon === h.key}
              onClick={() => setHorizon(h.key)}
              style={{
                font: "600 12px/1 var(--font-body)",
                padding: "6px 10px",
                background: horizon === h.key ? "var(--brand-primary)" : "transparent",
                color: horizon === h.key ? "var(--text-on-navy)" : "var(--text-secondary)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                cursor: "pointer",
              }}
            >
              {h.key}
            </button>
          ))}
        </div>
      </div>

      {/* SVG */}
      <div style={{ position: "relative", width: "100%" }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          width="100%" height={H}
          preserveAspectRatio="none"
          onMouseMove={onMove}
          onMouseLeave={onLeave}
          style={{ display: "block", touchAction: "none" }}
          role="img"
          aria-label={label}
        >
          {/* Grid Y */}
          {ticks.map((t, i) => (
            <g key={i}>
              <line
                x1={padL} x2={W - padR}
                y1={y(t)} y2={y(t)}
                stroke="var(--divider)" strokeWidth="1"
              />
              <text
                x={padL - 8} y={y(t) + 3}
                textAnchor="end"
                style={{ font: "500 10.5px/1 var(--font-mono)", fill: "var(--text-tertiary)" }}
              >
                {fmtVal(t).replace(/\s/g, "")}
              </text>
            </g>
          ))}

          {/* Área */}
          <path d={areaD} fill={color} fillOpacity="0.08" />
          {/* Línea */}
          <path d={pathD} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />

          {/* Hover */}
          {hover && (
            <g>
              <line
                x1={hover.x} x2={hover.x}
                y1={padT} y2={padT + innerH}
                stroke="var(--text-tertiary)" strokeWidth="1" strokeDasharray="4 3"
              />
              <circle cx={hover.x} cy={hover.y} r="4" fill={color} stroke="var(--surface)" strokeWidth="2" />
            </g>
          )}
        </svg>

        {/* Tooltip flotante */}
        {hover && (
          <div
            style={{
              position: "absolute",
              left: `${(hover.x / W) * 100}%`,
              top: 8,
              transform: "translateX(-50%)",
              background: "var(--surface-raised)",
              border: "1px solid var(--border-strong)",
              boxShadow: "var(--shadow-md)",
              padding: "8px 10px",
              borderRadius: "var(--radius-md)",
              pointerEvents: "none",
              whiteSpace: "nowrap",
              zIndex: 5,
            }}
          >
            <div className="tabular" style={{ font: "var(--heading-sm)", color: "var(--text-primary)" }}>
              {fmtVal(hover.point.value)}
            </div>
            <div style={{ font: "var(--caption)", color: "var(--text-tertiary)", marginTop: 2 }}>
              {fmtDateShort(hover.point.date)}
            </div>
          </div>
        )}
      </div>

      {/* Footer con rango efectivo */}
      <div className="flex ai-center jc-between" style={{ marginTop: 6, font: "var(--caption)", color: "var(--text-tertiary)" }}>
        <span>{fmtShortDate(series[0].date, lang)}</span>
        <span>{fmtShortDate(series[series.length - 1].date, lang)}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// PipelineByBrandTimeline — timeline horizontal apilado por marca.
// Por mandato CEO: NO kanban. Cada marca = una fila con segmentos por estado.
// Click en segmento → callback con (brandId, status).
//
// Props:
//   rows: [{ brandId, brandName, brandColor, total, byStatus: {REGISTRO:..} }]
//   statuses: ['REGISTRO','PRODUCCION','PREPARACION','DESPACHO','TRANSITO','EN_DESTINO','CERRADO']
//   onClick: (brandId, status) => void
// ─────────────────────────────────────────────────────────────────────
const STATUS_COLORS = {
  REGISTRO:    "var(--info)",
  PRODUCCION:  "var(--warning)",
  PREPARACION: "var(--brand-primary-light)",
  DESPACHO:    "var(--brand-accent-dark)",
  TRANSITO:    "var(--brand-primary)",
  EN_DESTINO:  "var(--success)",
  CERRADO:     "var(--text-tertiary)",
};

export function PipelineByBrandTimeline({
  rows,
  statuses = ["REGISTRO","PRODUCCION","PREPARACION","DESPACHO","TRANSITO","EN_DESTINO","CERRADO"],
  lang = "es",
  onClick,
  emptyEndpoint = "/api/analytics/by_status_by_brand/",
}) {
  if (!Array.isArray(rows) || !rows.length) {
    return (
      <EmptyState
        lang={lang}
        title={lang === "es" ? "Sin pipeline por marca" : "No brand pipeline"}
        hint={lang === "es"
          ? "El endpoint actual /by_status/ agrega solo a nivel global. Pendiente endpoint con dimensión marca."
          : "Current /by_status/ aggregates only globally. Need brand-dimension endpoint."}
        endpoint={emptyEndpoint}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Leyenda */}
      <div className="flex" style={{ gap: 12, flexWrap: "wrap", font: "var(--caption)", color: "var(--text-tertiary)" }}>
        {statuses.map((s) => (
          <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, background: STATUS_COLORS[s] || "var(--border-strong)", borderRadius: 2 }} />
            {tr(lang, s)}
          </span>
        ))}
      </div>

      {rows.map((r) => {
        const total = r.total || statuses.reduce((a, s) => a + (r.byStatus?.[s] || 0), 0);
        return (
          <div key={r.brandId}>
            <div className="flex ai-center jc-between" style={{ marginBottom: 6 }}>
              <div className="flex ai-center gap-2">
                <span style={{ width: 10, height: 10, background: r.brandColor || "var(--brand-primary)", borderRadius: 3 }} />
                <span className="heading-sm" style={{ color: "var(--text-primary)" }}>{r.brandName}</span>
                <Badge kind="neutral">{total}</Badge>
              </div>
              <span className="tabular" style={{ font: "500 11px/1 var(--font-mono)", color: "var(--text-tertiary)" }}>
                {total} {lang === "es" ? "expedientes" : "files"}
              </span>
            </div>
            <div
              style={{
                position: "relative",
                display: "flex",
                height: 16,
                borderRadius: "var(--radius-full)",
                overflow: "hidden",
                background: "var(--bg-alt)",
              }}
              role="group"
              aria-label={`${r.brandName} pipeline`}
            >
              {statuses.map((s) => {
                const count = r.byStatus?.[s] || 0;
                if (!count || !total) return null;
                const widthPct = (count / total) * 100;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => onClick && onClick(r.brandId, s)}
                    title={`${tr(lang, s)} · ${count}`}
                    style={{
                      width: `${widthPct}%`,
                      background: STATUS_COLORS[s] || "var(--border-strong)",
                      border: "none",
                      padding: 0,
                      cursor: onClick ? "pointer" : "default",
                      transition: "filter 200ms",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.filter = "brightness(1.1)")}
                    onMouseLeave={(e) => (e.currentTarget.style.filter = "none")}
                    aria-label={`${tr(lang, s)}: ${count}`}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// UrgentExpedientesTable — Top 10 por score de urgencia.
// Reemplaza el listado actual de 3 IDs idénticos con UUIDs truncados.
//
// Score de urgencia (cliente-side, pendiente endpoint dedicado):
//   urgencyScore = creditRatio*0.4 + valueRatio*0.3 + ageRatio*0.3
// El backend devuelve `urgent` ya pre-filtrado por bloqueado/crédito>70d.
//
// Visibilidad por rol (mandato CEO):
//   · isAdmin === true  → muestra `proforma` (número MWT interno)
//   · isAdmin === false → muestra `oc_codigo` (número de OC del cliente)
// Si ambos faltan, degrada a `ref` (codigo del expediente · EXP-XXXX).
//
// Props:
//   items: [{ id, ref, oc_codigo, proforma, client_id, client_name,
//             brand_id, brand_name, urgency, action, credit_days }]
//   resolveBrand(id) → { name, color }  (fallback si brand_name viene null)
//   resolveClient(id) → { name, country } (fallback si client_name viene null)
//   isAdmin: boolean (de useRole().isAdmin) — decide qué número mostrar
//   onOpen(id)
// ─────────────────────────────────────────────────────────────────────
export function UrgentExpedientesTable({
  items,
  resolveBrand = () => null,
  resolveClient = () => null,
  isAdmin = true,
  onOpen,
  lang = "es",
  emptyEndpoint = "/api/analytics/urgent/",
}) {
  if (!Array.isArray(items) || !items.length) {
    return (
      <EmptyState
        lang={lang}
        title={lang === "es" ? "Sin acciones urgentes" : "No urgent actions"}
        hint={lang === "es"
          ? "El backend no reportó expedientes con bloqueos ni crédito > 70d."
          : "Backend reports no blocked files or credit > 70d."}
        endpoint={emptyEndpoint}
        compact
      />
    );
  }

  // Ordenamiento por urgencia conocida (high primero) y luego alfabético del ref.
  const sorted = [...items].sort((a, b) => {
    const w = (u) => (u === "high" ? 0 : u === "medium" ? 1 : 2);
    const dw = w(a.urgency) - w(b.urgency);
    if (dw !== 0) return dw;
    return String(a.ref || "").localeCompare(String(b.ref || ""));
  }).slice(0, 10);

  return (
    <div role="table" aria-label={tr(lang, "urgent_actions")}>
      {/* Header — layout compacto de 4 columnas + chevron.
          Eliminamos "Acción" porque el texto del backend es genérico
          ("Resolver bloqueo de crédito" / "Confirmar arribo...") y el
          icono de urgencia al inicio de cada fila ya lo transmite.
          Cada fila lleva un badge PF/OC/EXP que indica el tipo de ref. */}
      {/* Header — layout compacto.
          Reemplaza Marca por dos columnas: Total Cliente y Total MWT (solo admin/ceo). */}
      <div
        role="row"
        style={{
          display: "grid",
          gridTemplateColumns: isAdmin
            ? "minmax(0, 1.2fr) minmax(0, 1.2fr) minmax(0, 0.9fr) minmax(0, 0.9fr) 48px 18px"
            : "minmax(0, 1.2fr) minmax(0, 1.4fr) minmax(0, 1fr) 48px 18px",
          gap: 8,
          padding: "8px 12px",
          font: "var(--micro)",
          color: "var(--text-tertiary)",
          letterSpacing: "0.06em",
          borderBottom: "1px solid var(--divider)",
        }}
      >
        <span>{lang === "en" ? "Reference" : "Referencia"}</span>
        <span>{tr(lang, "client")}</span>
        <span style={{ textAlign: "right" }}>{lang === "en" ? "Client Total" : "Total Cliente"}</span>
        {isAdmin && <span style={{ textAlign: "right" }}>{lang === "en" ? "MWT Total" : "Total MWT"}</span>}
        <span style={{ textAlign: "right" }}>{lang === "en" ? "Days" : "Días"}</span>
        <span />
      </div>

      {sorted.map((u) => {
        // Cliente: razón_social del backend, fallback al resolver o UUID.
        const clientName = u.client_name
          || resolveClient(u.client_id)?.name
          || (u.client_id ? `${String(u.client_id).slice(0, 8)}…` : "—");

        // Número visible según rol.
        const primaryRef = isAdmin
          ? (u.proforma || u.oc_codigo || u.ref || u.id || "")
          : (u.oc_codigo || u.ref || u.id || "");
        const refLabel = primaryRef.length <= 24
          ? primaryRef
          : String(primaryRef).slice(0, 18) + "…";

        const refKind = isAdmin
          ? (u.proforma ? "PF" : (u.oc_codigo ? "OC" : "EXP"))
          : (u.oc_codigo ? "OC" : "EXP");

        const totalClientVal = Number(u.total_client || u.order_value || u.total_invoiced || u.value || 0);
        const totalMwtVal = Number(u.total_mwt || u.total_cost || 0);

        const isHigh = u.urgency === "high";
        return (
          <button
            key={u.id}
            type="button"
            onClick={() => onOpen && onOpen(u.id)}
            role="row"
            title={u.action || ""}
            style={{
              width: "100%",
              display: "grid",
              gridTemplateColumns: isAdmin
                ? "minmax(0, 1.2fr) minmax(0, 1.2fr) minmax(0, 0.9fr) minmax(0, 0.9fr) 48px 18px"
                : "minmax(0, 1.2fr) minmax(0, 1.4fr) minmax(0, 1fr) 48px 18px",
              gap: 8,
              padding: "10px 12px",
              alignItems: "center",
              background: "transparent",
              border: "none",
              borderBottom: "1px solid var(--divider)",
              borderLeft: `2px solid ${isHigh ? "var(--critical)" : "var(--warning)"}`,
              textAlign: "left",
              cursor: "pointer",
              transition: "background 120ms",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <span
              className="flex ai-center gap-2"
              title={`${refKind === "PF" ? "Proforma" : refKind === "OC" ? "OC" : "Expediente"}: ${primaryRef}${u.action ? " · " + u.action : ""}`}
              style={{ minWidth: 0, overflow: "hidden" }}
            >
              <span
                style={{
                  font: "600 9px/1 var(--font-body)",
                  letterSpacing: "0.05em",
                  color: "var(--text-tertiary)",
                  background: "var(--bg-alt)",
                  padding: "2px 5px",
                  borderRadius: "var(--radius-sm)",
                  flexShrink: 0,
                }}
              >
                {refKind}
              </span>
              <span
                className="mono-sm tabular"
                style={{
                  font: "600 11.5px/1.2 var(--font-mono)",
                  color: "var(--interactive)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  minWidth: 0,
                }}
              >
                {refLabel || "—"}
              </span>
            </span>
            <span
              title={clientName}
              style={{
                font: "var(--body-sm)", color: "var(--text-primary)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}
            >
              {clientName}
            </span>

            {/* Total Cliente */}
            <span
              className="tabular-nums"
              style={{
                font: "600 12px/1 var(--font-mono)",
                color: "var(--text-primary)",
                textAlign: "right",
                whiteSpace: "nowrap",
              }}
            >
              {fmtMoney(totalClientVal)}
            </span>

            {/* Total MWT (solo admin) */}
            {isAdmin && (
              <span
                className="tabular-nums"
                style={{
                  font: "600 12px/1 var(--font-mono)",
                  color: totalMwtVal > 0 ? "var(--text-secondary)" : "var(--text-tertiary)",
                  textAlign: "right",
                  whiteSpace: "nowrap",
                }}
              >
                {totalMwtVal > 0 ? fmtMoney(totalMwtVal) : "$0"}
              </span>
            )}

            <span className="tabular" style={{
              font: "600 12.5px/1 var(--font-mono)",
              color: (u.credit_days || 0) > 75 ? "var(--critical)"
                   : (u.credit_days || 0) > 60 ? "var(--warning)"
                   : "var(--text-secondary)",
              textAlign: "right",
              whiteSpace: "nowrap",
            }}>
              {u.credit_days != null ? `${u.credit_days}d` : "—"}
            </span>
            <IconChevRight size={14} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// MarginScatter — scatter de margen real vs proyectado.
// Hoy el backend agrega POR MARCA (no por expediente). Documentamos la
// limitación en el subtítulo y cuando exista /api/analytics/expediente_margin_scatter/
// el componente acepta tanto puntos por marca como por expediente.
//
// Props:
//   points: [{ id, label, projected, real, value, color }]
//   driftThreshold: ±0.15 según ENT_GOB_KPI B2
// ─────────────────────────────────────────────────────────────────────
export function MarginScatter({
  points,
  driftThreshold = 0.15,
  lang = "es",
  emptyEndpoint = "/api/analytics/expediente_margin_scatter/",
}) {
  if (!Array.isArray(points) || !points.length) {
    return (
      <EmptyState
        lang={lang}
        title={lang === "es" ? "Sin puntos de margen" : "No margin points"}
        hint={lang === "es"
          ? "Cuando exista el endpoint con un punto por expediente cerrado, este scatter renderiza márgenes reales vs proyectados."
          : "When per-closed-file endpoint exists, this scatter plots real vs projected margins."}
        endpoint={emptyEndpoint}
      />
    );
  }

  const W = 480, H = 260, padL = 40, padR = 16, padT = 16, padB = 36;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  // Eje 0..50% — suficiente para márgenes de calzado de importación.
  const max = Math.max(0.5, ...points.flatMap((p) => [p.projected, p.real]));
  const min = 0;

  const xScale = (v) => padL + ((v - min) / (max - min)) * innerW;
  const yScale = (v) => padT + innerH - ((v - min) / (max - min)) * innerH;

  // Tamaño del círculo por valor (sqrt para que no domine visualmente).
  const maxValue = Math.max(1, ...points.map((p) => Math.abs(p.value || 0)));
  const rScale = (v) => 4 + Math.sqrt(Math.abs(v || 0) / maxValue) * 10;

  const ticks = [0, 0.1, 0.2, 0.3, 0.4, 0.5].filter((t) => t <= max + 0.01);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img"
           aria-label={lang === "es" ? "Margen real vs proyectado" : "Real vs projected margin"}>
        {/* Grid */}
        {ticks.map((t) => (
          <g key={`gy${t}`}>
            <line x1={padL} x2={W - padR} y1={yScale(t)} y2={yScale(t)} stroke="var(--divider)" strokeWidth="1" />
            <text x={padL - 6} y={yScale(t) + 3} textAnchor="end"
                  style={{ font: "500 10px/1 var(--font-mono)", fill: "var(--text-tertiary)" }}>
              {(t * 100).toFixed(0)}%
            </text>
          </g>
        ))}
        {ticks.map((t) => (
          <g key={`gx${t}`}>
            <line x1={xScale(t)} x2={xScale(t)} y1={padT} y2={padT + innerH} stroke="var(--divider)" strokeWidth="1" />
            <text x={xScale(t)} y={padT + innerH + 16} textAnchor="middle"
                  style={{ font: "500 10px/1 var(--font-mono)", fill: "var(--text-tertiary)" }}>
              {(t * 100).toFixed(0)}%
            </text>
          </g>
        ))}

        {/* Diagonal y=x (ideal) */}
        <line
          x1={xScale(min)} y1={yScale(min)}
          x2={xScale(max)} y2={yScale(max)}
          stroke="var(--text-tertiary)" strokeWidth="1" strokeDasharray="4 4"
        />

        {/* Banda ±driftThreshold */}
        <line
          x1={xScale(min)} y1={yScale(min + driftThreshold)}
          x2={xScale(max - driftThreshold)} y2={yScale(max)}
          stroke="var(--warning)" strokeWidth="1" strokeDasharray="2 4" opacity="0.6"
        />
        <line
          x1={xScale(min + driftThreshold)} y1={yScale(min)}
          x2={xScale(max)} y2={yScale(max - driftThreshold)}
          stroke="var(--warning)" strokeWidth="1" strokeDasharray="2 4" opacity="0.6"
        />

        {/* Puntos */}
        {points.map((p) => {
          const drift = (p.real || 0) - (p.projected || 0);
          const outsideBand = Math.abs(drift) > driftThreshold;
          return (
            <g key={p.id}>
              <circle
                cx={xScale(p.projected || 0)}
                cy={yScale(p.real || 0)}
                r={rScale(p.value)}
                fill={p.color || "var(--brand-primary)"}
                fillOpacity={outsideBand ? 0.85 : 0.55}
                stroke={outsideBand ? "var(--critical)" : "var(--surface)"}
                strokeWidth={outsideBand ? 1.5 : 1}
              >
                <title>
                  {`${p.label || p.id} · ${lang === "es" ? "Proy" : "Proj"}: ${((p.projected || 0) * 100).toFixed(1)}% · ${lang === "es" ? "Real" : "Real"}: ${((p.real || 0) * 100).toFixed(1)}%${p.value ? ` · ${fmtMoney(p.value)}` : ""}`}
                </title>
              </circle>
            </g>
          );
        })}

        {/* Labels ejes */}
        <text x={padL + innerW / 2} y={H - 4} textAnchor="middle"
              style={{ font: "var(--caption)", fill: "var(--text-secondary)" }}>
          {lang === "es" ? "Margen proyectado" : "Projected margin"}
        </text>
        <text x={14} y={padT + innerH / 2} textAnchor="middle" transform={`rotate(-90, 14, ${padT + innerH / 2})`}
              style={{ font: "var(--caption)", fill: "var(--text-secondary)" }}>
          {lang === "es" ? "Margen real" : "Real margin"}
        </text>
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// TopClientsTable — Top 10 clientes por exposición.
// Lee /api/analytics/exposicion_clientes/.
// ─────────────────────────────────────────────────────────────────────
export function TopClientsTable({
  items,
  resolveClient = () => null,
  lang = "es",
  emptyEndpoint = "/api/analytics/exposicion_clientes/",
}) {
  if (!Array.isArray(items) || !items.length) {
    return (
      <EmptyState
        lang={lang}
        title={lang === "es" ? "Sin exposición de clientes" : "No client exposure"}
        endpoint={emptyEndpoint}
        compact
      />
    );
  }
  const sorted = [...items]
    .sort((a, b) => (b.monto_pendiente || b.monto_total || 0) - (a.monto_pendiente || a.monto_total || 0))
    .slice(0, 10);

  // Compacto: Cliente | # | Saldo | Venc 60d
  // Eliminamos "Venc. 30d" porque "Venc. 60d" ya es alerta crítica y
  // ambas columnas se salían del ancho de la card en banda 4.
  const grid = "minmax(0, 1.6fr) 38px minmax(0, 0.9fr) minmax(0, 0.85fr)";
  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: grid,
          gap: 8,
          padding: "8px 12px",
          font: "var(--micro)",
          color: "var(--text-tertiary)",
          letterSpacing: "0.06em",
          borderBottom: "1px solid var(--divider)",
        }}
      >
        <span>{tr(lang, "client")}</span>
        <span style={{ textAlign: "right" }}>#</span>
        <span style={{ textAlign: "right" }}>{tr(lang, "balance")}</span>
        <span style={{ textAlign: "right" }}>{lang === "en" ? "Past 60d" : "Venc. 60d"}</span>
      </div>
      {sorted.map((c, i) => {
        const clientName = c.client_name
          || resolveClient(c.client_id)?.name
          || (c.client_id ? `${String(c.client_id).slice(0, 8)}…` : "—");
        return (
          <div
            key={c.client_id || i}
            style={{
              display: "grid",
              gridTemplateColumns: grid,
              gap: 8,
              padding: "10px 12px",
              alignItems: "center",
              borderBottom: "1px solid var(--divider)",
            }}
          >
            <span
              title={clientName + (c.country ? ` (${c.country})` : "")}
              style={{
                font: "var(--body-sm)", color: "var(--text-primary)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                minWidth: 0,
              }}
            >
              {clientName}
            </span>
            <span
              className="tabular"
              title={lang === "en" ? "Open receivables" : "Cobros abiertos"}
              style={{
                textAlign: "right", font: "600 12px/1 var(--font-mono)",
                color: "var(--text-secondary)",
              }}
            >
              {c.cobros_abiertos != null ? c.cobros_abiertos : "—"}
            </span>
            <span
              className="tabular"
              title={c.monto_pendiente != null ? fmtMoney(c.monto_pendiente) : ""}
              style={{
                textAlign: "right", font: "600 12px/1 var(--font-mono)",
                color: "var(--text-primary)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                minWidth: 0,
              }}
            >
              {c.monto_pendiente != null ? fmtMoney(c.monto_pendiente) : "—"}
            </span>
            <span
              className="tabular"
              style={{
                textAlign: "right", font: "600 12px/1 var(--font-mono)",
                color: (c.vencidos_60 || 0) > 0 ? "var(--critical)" : "var(--text-tertiary)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                minWidth: 0,
              }}
            >
              {c.vencidos_60 != null ? fmtMoney(c.vencidos_60) : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// GlobalFilters — sticky bar bajo el page-header.
// Cambia el estado del padre. Marca con badge `pending` los filtros
// que aún no son respetados por el backend.
// ─────────────────────────────────────────────────────────────────────
export function GlobalFilters({
  value,
  onChange,
  brands = [],
  lang = "es",
}) {
  const set = (k, v) => onChange({ ...value, [k]: v });

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        background: "var(--surface-raised)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        marginBottom: 16,
        flexWrap: "wrap",
        // Sprint 2026-06-22 · El TopBar usa position:relative (ancla su
        // dropdown de notificaciones), por lo que NO queda fijo al scrollear.
        // Con top:56 la barra se anclaba 56px abajo dejando un hueco por el
        // que el contenido (heatmap) se veía por encima → parecía "no fija".
        // Fijamos a top:0 del viewport; z-index 15 la mantiene sobre las cards.
        position: "sticky",
        top: 0,
        zIndex: 15,
        boxShadow: "0 2px 8px rgba(15, 23, 42, 0.04)",
      }}
    >
      <span style={{ font: "var(--micro)", color: "var(--text-tertiary)", letterSpacing: "0.06em" }}>
        {lang === "es" ? "FILTROS" : "FILTERS"}
      </span>

      {/* Período */}
      <label className="flex ai-center gap-2" style={{ font: "var(--caption)" }}>
        <span style={{ color: "var(--text-secondary)" }}>{lang === "es" ? "Período" : "Period"}</span>
        <select
          value={value.period}
          onChange={(e) => set("period", e.target.value)}
          style={selectStyle}
        >
          <option value="30d">30d</option>
          <option value="90d">90d</option>
          <option value="1y">1A</option>
        </select>
      </label>

      {/* Marca */}
      <label className="flex ai-center gap-2" style={{ font: "var(--caption)" }}>
        <span style={{ color: "var(--text-secondary)" }}>{lang === "es" ? "Marca" : "Brand"}</span>
        <select
          value={value.brand || ""}
          onChange={(e) => set("brand", e.target.value || null)}
          style={selectStyle}
        >
          <option value="">{lang === "es" ? "Todas" : "All"}</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </label>

      {/* Mercado — badge pending */}
      <label className="flex ai-center gap-2" style={{ font: "var(--caption)" }}>
        <span style={{ color: "var(--text-secondary)" }}>{lang === "es" ? "Mercado" : "Market"}</span>
        <select
          value={value.market || ""}
          onChange={(e) => set("market", e.target.value || null)}
          style={{ ...selectStyle, opacity: 0.7 }}
          disabled
          title={lang === "es"
            ? "Pendiente: backend aún no segmenta por mercado destino."
            : "Pending: backend does not segment by destination market yet."}
        >
          <option value="">{lang === "es" ? "Todos" : "All"}</option>
        </select>
        <Badge kind="warning" style={{ fontSize: 10 }}>
          {lang === "es" ? "BE pend." : "BE pend."}
        </Badge>
      </label>
    </div>
  );
}

const selectStyle = {
  font: "500 12.5px/1 var(--font-body)",
  color: "var(--text-primary)",
  background: "var(--surface)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-sm)",
  padding: "5px 8px",
  outline: "none",
};

// ─────────────────────────────────────────────────────────────────────
// SizeMarketHeatmap — distribución de unidades vendidas por talla × mercado.
// Renderiza un histograma SVG por talla con una curva de Gauss ajustada
// superpuesta (μ y σ se calculan sobre el índice ordinal de talla). Cuando
// hay varios mercados se dibuja una serie barra+curva por mercado, con
// colores tomados de SERIES_PALETTE (tokens MWT).
//
// Shape esperado del backend (`/api/analytics/size_market_distribution/`):
//   {
//     sizes:   ["38","39","40",...],
//     markets: [{ code: "CR", name: "Costa Rica" }, ...],
//     data:    [{ size, market, units }],
//     curve:   [{ size, pct_target }] | null
//   }
// ─────────────────────────────────────────────────────────────────────

// Paleta para series por mercado (hasta 5; >5 se cicla). Usamos variables
// CSS de tokens MWT para respetar R1 (cero hex hardcoded en el JSX).
const SIZE_SERIES_PALETTE = [
  "var(--info, #0369A1)",
  "var(--success, #0E8A6D)",
  "var(--warning, #B45309)",
  "var(--critical, #DC2626)",
  "var(--brand-primary, #013A57)",
];

/** Ajuste gaussiano sobre el índice ordinal de talla.
 *  Devuelve { mu, sigma, total, peak } o null si no hay unidades. */
function fitGaussianBySize(unitsBySizeIdx, sizesCount) {
  let total = 0, sumX = 0, peak = 0;
  for (let i = 0; i < sizesCount; i++) {
    const u = unitsBySizeIdx[i] || 0;
    total += u;
    sumX  += i * u;
    if (u > peak) peak = u;
  }
  if (total <= 0) return null;
  const mu = sumX / total;
  let sumVar = 0;
  for (let i = 0; i < sizesCount; i++) {
    const u = unitsBySizeIdx[i] || 0;
    sumVar += (i - mu) ** 2 * u;
  }
  // Floor en sigma para evitar picos infinitos cuando todo está en una talla.
  const sigma = Math.max(0.6, Math.sqrt(sumVar / total));
  return { mu, sigma, total, peak };
}

/** Densidad gaussiana clásica · sin normalizar a 1. */
function gaussDensity(x, mu, sigma) {
  return Math.exp(-0.5 * ((x - mu) / sigma) ** 2) / (sigma * Math.SQRT2 * Math.sqrt(Math.PI));
}

export function SizeMarketHeatmap({
  payload,
  lang = "es",
  emptyEndpoint = "/api/analytics/size_market_distribution/",
}) {
  const sizes   = Array.isArray(payload?.sizes)   ? payload.sizes   : [];
  const markets = Array.isArray(payload?.markets) ? payload.markets : [];
  const data    = Array.isArray(payload?.data)    ? payload.data    : [];

  if (!sizes.length || !markets.length || !data.length) {
    return (
      <EmptyState
        lang={lang}
        title={lang === "es" ? "Sin distribución de tallas" : "No size distribution"}
        hint={lang === "es"
          ? "No hay líneas con talla (size) registradas en últimos 365d, o ningún cliente tiene país asignado."
          : "No lines with size in last 365d, or no clients with country."}
        endpoint={emptyEndpoint}
      />
    );
  }

  // ── Series por mercado · agrupa unidades por índice de talla ──────────
  const series = useMemo(() => {
    const sizeIdx = new Map(sizes.map((s, i) => [s, i]));
    return markets.map((m, mi) => {
      const units = new Array(sizes.length).fill(0);
      for (const row of data) {
        if (row.market !== m.code) continue;
        const idx = sizeIdx.get(row.size);
        if (idx == null) continue;
        units[idx] += Number(row.units) || 0;
      }
      return {
        code:  m.code,
        name:  m.name,
        color: SIZE_SERIES_PALETTE[mi % SIZE_SERIES_PALETTE.length],
        units,
        fit:   fitGaussianBySize(units, sizes.length),
      };
    });
  }, [sizes, markets, data]);

  const maxUnits = useMemo(() => {
    let max = 0;
    for (const s of series) for (const u of s.units) if (u > max) max = u;
    return Math.max(1, max);
  }, [series]);

  const grandTotal = useMemo(
    () => data.reduce((a, d) => a + (Number(d.units) || 0), 0),
    [data],
  );

  // ── Geometría SVG ───────────────────────────────────────────────────
  // viewBox fijo; el SVG escala al ancho del card con width 100%.
  const VB_W = 640;
  const VB_H = 280;
  const PAD_T = 16;
  const PAD_R = 16;
  const PAD_B = 36;   // espacio para labels de talla
  const PAD_L = 40;   // espacio para eje Y
  const plotW = VB_W - PAD_L - PAD_R;
  const plotH = VB_H - PAD_T - PAD_B;
  const bandW = plotW / sizes.length;            // ancho asignado por talla
  const seriesCount = Math.max(1, series.length);
  const barGap = 2;
  // Cada barra ocupa una franja dentro de la banda de la talla.
  const barW = Math.max(2, (bandW - barGap * (seriesCount + 1)) / seriesCount);

  const xCenterOf = (idx) => PAD_L + bandW * (idx + 0.5);
  const xBarOf    = (idx, si) => PAD_L + bandW * idx + barGap + si * (barW + barGap);
  const yOf       = (u)        => PAD_T + plotH * (1 - Math.min(1, u / maxUnits));

  // Curva: muestreamos 160 puntos por mercado entre x=-0.5 y x=sizes.length-0.5.
  // Escalamos cada curva para que su pico coincida con el `peak` de unidades
  // de ese mercado → la curva queda "abrazando" el histograma.
  const curvePathOf = (s) => {
    if (!s.fit) return "";
    const { mu, sigma, peak } = s.fit;
    const densAtMu = gaussDensity(mu, mu, sigma);
    if (!densAtMu) return "";
    const N = 160;
    const x0 = -0.5, x1 = sizes.length - 0.5;
    let d = "";
    for (let k = 0; k <= N; k++) {
      const xv = x0 + (x1 - x0) * (k / N);
      const dens = gaussDensity(xv, mu, sigma);
      const u = (dens / densAtMu) * peak;
      const px = PAD_L + bandW * (xv + 0.5);
      const py = yOf(u);
      d += (k === 0 ? "M" : "L") + px.toFixed(2) + "," + py.toFixed(2) + " ";
    }
    return d.trim();
  };

  // Ticks Y: 0 y maxUnits (suficiente para densidad ejecutiva).
  const yMax = maxUnits;

  // ── Tooltip simple controlado por hover ─────────────────────────────
  const [tip, setTip] = useState(null); // { x, y, label }

  return (
    <div>
      {/* Leyenda de mercados (solo si hay > 1 mercado) */}
      {series.length > 1 && (
        <div style={{
          display: "flex", flexWrap: "wrap", gap: 12,
          padding: "0 0 6px 0",
          font: "var(--micro)", color: "var(--text-secondary)",
        }}>
          {series.map((s) => (
            <span key={s.code}
                  title={s.name}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{
                width: 10, height: 10, borderRadius: 2,
                background: s.color,
                border: "1px solid color-mix(in oklab, var(--text-secondary), transparent 70%)",
              }}/>
              <span className="tabular" style={{ font: "600 11px/1 var(--font-mono)" }}>
                {s.code}
              </span>
            </span>
          ))}
        </div>
      )}

      {/* Histograma + curvas */}
      <div style={{ position: "relative", width: "100%" }}>
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={lang === "es"
            ? `Histograma de tallas con curva de Gauss ajustada por mercado`
            : `Histogram of sizes with fitted Gaussian curve per market`}
          style={{
            width: "100%", height: "auto",
            display: "block",
            font: "500 10.5px/1 var(--font-mono)",
            color: "var(--text-tertiary)",
          }}
        >
          {/* Eje Y · solo dos ticks limpios */}
          <line
            x1={PAD_L} x2={PAD_L}
            y1={PAD_T} y2={PAD_T + plotH}
            stroke="color-mix(in oklab, var(--text-tertiary), transparent 70%)"
            strokeWidth="1"
          />
          <text
            x={PAD_L - 6}
            y={PAD_T + 4}
            textAnchor="end"
            fill="var(--text-tertiary)"
            className="tabular"
          >
            {yMax.toLocaleString(lang === "en" ? "en-US" : "es-PE")}
          </text>
          <text
            x={PAD_L - 6}
            y={PAD_T + plotH}
            textAnchor="end"
            fill="var(--text-tertiary)"
            className="tabular"
          >
            0
          </text>

          {/* Eje X · baseline */}
          <line
            x1={PAD_L} x2={PAD_L + plotW}
            y1={PAD_T + plotH} y2={PAD_T + plotH}
            stroke="color-mix(in oklab, var(--text-tertiary), transparent 60%)"
            strokeWidth="1"
          />

          {/* Barras agrupadas por talla, una serie por mercado */}
          {sizes.map((size, idx) => (
            <g key={`g-${size}`}>
              {series.map((s, si) => {
                const u = s.units[idx] || 0;
                if (u <= 0) return null;
                const x = xBarOf(idx, si);
                const y = yOf(u);
                const h = PAD_T + plotH - y;
                return (
                  <rect
                    key={`b-${size}-${s.code}`}
                    x={x} y={y}
                    width={barW} height={h}
                    fill={s.color}
                    fillOpacity={0.28}
                    stroke={s.color}
                    strokeOpacity={0.55}
                    strokeWidth={0.75}
                    rx={2}
                    onMouseEnter={() => setTip({
                      x: x + barW / 2,
                      y,
                      label: `${size} · ${s.name}: ${u.toLocaleString(lang === "en" ? "en-US" : "es-PE")} uds`,
                    })}
                    onMouseLeave={() => setTip(null)}
                  />
                );
              })}
            </g>
          ))}

          {/* Curvas de Gauss ajustadas (una por mercado, encima de las barras) */}
          {series.map((s) => {
            const d = curvePathOf(s);
            if (!d) return null;
            return (
              <path
                key={`c-${s.code}`}
                d={d}
                fill="none"
                stroke={s.color}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.95}
              />
            );
          })}

          {/* Línea vertical punteada en μ (solo si una sola serie · evita ruido) */}
          {series.length === 1 && series[0].fit && (
            <line
              x1={xCenterOf(series[0].fit.mu)}
              x2={xCenterOf(series[0].fit.mu)}
              y1={PAD_T}
              y2={PAD_T + plotH}
              stroke={series[0].color}
              strokeOpacity={0.55}
              strokeWidth={1}
              strokeDasharray="3 4"
            />
          )}

          {/* Etiquetas de tallas en eje X */}
          {sizes.map((size, idx) => (
            <text
              key={`xl-${size}`}
              x={xCenterOf(idx)}
              y={PAD_T + plotH + 16}
              textAnchor="middle"
              fill="var(--text-secondary)"
              className="tabular"
              style={{ font: "600 10.5px/1 var(--font-mono)" }}
            >
              {size}
            </text>
          ))}
        </svg>

        {/* Tooltip flotante (HTML, no SVG, para tipografía mejor) */}
        {tip && (
          <div style={{
            position: "absolute",
            left: `calc(${(tip.x / VB_W) * 100}% )`,
            top:  `calc(${(tip.y / VB_H) * 100}% - 30px)`,
            transform: "translate(-50%, -100%)",
            background: "var(--surface-raised, #FFFFFF)",
            color: "var(--text-primary)",
            border: "1px solid var(--border-subtle, #E5E7EB)",
            borderRadius: "var(--radius-sm, 6px)",
            padding: "5px 8px",
            font: "600 11px/1.2 var(--font-body)",
            boxShadow: "0 4px 16px rgba(11,30,58,0.16)",
            whiteSpace: "nowrap",
            pointerEvents: "none",
            zIndex: 2,
          }}>
            {tip.label}
          </div>
        )}
      </div>

      {/* Footer · resumen + estado de curva esperada */}
      <div style={{
        marginTop: 12,
        font: "var(--caption)",
        color: "var(--text-tertiary)",
      }}>
        {(() => {
          const isGlobal = markets.length === 1 && (markets[0]?.code === "GLOBAL");
          if (isGlobal) {
            return lang === "es"
              ? `Total ${grandTotal.toLocaleString("es-PE")} uds en ${sizes.length} tallas · agregado global.`
              : `Total ${grandTotal.toLocaleString("en-US")} units across ${sizes.length} sizes · global aggregate.`;
          }
          return lang === "es"
            ? `Total ${grandTotal.toLocaleString("es-PE")} uds en ${sizes.length} tallas × ${markets.length} mercado${markets.length === 1 ? "" : "s"}.`
            : `Total ${grandTotal.toLocaleString("en-US")} units across ${sizes.length} sizes × ${markets.length} market${markets.length === 1 ? "" : "s"}.`;
        })()}
        {series.length === 1 && series[0].fit && (
          <span style={{ marginLeft: 6 }}>
            · μ ≈ <span className="tabular">{sizes[Math.round(series[0].fit.mu)] ?? "?"}</span>
            {" · σ ≈ "}
            <span className="tabular">{series[0].fit.sigma.toFixed(2)}</span>
          </span>
        )}
        {!payload?.curve && (
          <span style={{ marginLeft: 6 }}>
            · {lang === "es"
                ? "Curva esperada S1-S6 pendiente: requiere productos.size_distribution_curve."
                : "Expected curve S1-S6 pending: needs productos.size_distribution_curve."}
          </span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// CardWithEmpty — wrapper de tarjeta con título + subtítulo + slot vacío.
// Mantiene el estilo del .card existente.
// ─────────────────────────────────────────────────────────────────────
export function DashboardCard({ title, subtitle, action, children, padding = 20 }) {
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">{title}</div>
          {subtitle && <div className="card-subtitle">{subtitle}</div>}
        </div>
        {action}
      </div>
      <div style={{ padding }}>{children}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// FxToggle — selector USD ↔ BRL con tasa, fuente y fecha visibles.
// Replica el patrón de BrandClientPricingForm (la tasa viene del backend,
// nunca se inventa; si no hay tasa, BRL queda deshabilitado).
// Persiste en localStorage `mwt:dashboard-fx-display` la moneda elegida.
//
// Props:
//   currency: 'USD' | 'BRL'
//   onChange(next): callback que recibe la nueva moneda
//   rate: number | null
//   source: string | null
//   fetchedAt: ISO | null
//   loading: boolean
//   error: string | null
//   onRefresh(): force refresh
// ─────────────────────────────────────────────────────────────────────
export function FxToggle({
  currency = "USD",
  onChange,
  rate,
  source,
  fetchedAt,
  loading,
  error,
  onRefresh,
  lang = "es",
}) {
  const brlAvailable = rate != null && rate > 0;
  const setCcy = (c) => {
    if (c === "BRL" && !brlAvailable) return; // No permitir BRL sin tasa
    onChange && onChange(c);
  };

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: "4px 8px",
        background: "var(--surface)",
        border: "1px solid var(--border-strong)",
        borderRadius: "var(--radius-md)",
      }}
    >
      {/* Toggle */}
      <div style={{ display: "inline-flex", gap: 2 }}>
        <button
          type="button"
          onClick={() => setCcy("USD")}
          aria-pressed={currency === "USD"}
          style={fxBtnStyle(currency === "USD")}
          title={lang === "es" ? "Display en USD (canónico)" : "Display in USD (canonical)"}
        >
          USD
        </button>
        <button
          type="button"
          onClick={() => setCcy("BRL")}
          aria-pressed={currency === "BRL"}
          disabled={!brlAvailable}
          style={{
            ...fxBtnStyle(currency === "BRL"),
            opacity: brlAvailable ? 1 : 0.5,
            cursor: brlAvailable ? "pointer" : "not-allowed",
          }}
          title={brlAvailable
            ? `1 USD = R$ ${rate.toFixed(4)} · ${source || ""}`
            : (lang === "es" ? "Tasa FX no disponible" : "FX rate not available")}
        >
          BRL
        </button>
      </div>

      {/* Tasa actual */}
      {brlAvailable ? (
        <span
          className="tabular"
          style={{ font: "500 11.5px/1 var(--font-mono)", color: "var(--text-secondary)" }}
        >
          1 USD = R$ {rate.toFixed(4)}
        </span>
      ) : (
        <span
          style={{
            font: "var(--caption)",
            color: "var(--warning)",
            background: "var(--warning-bg)",
            padding: "2px 6px",
            borderRadius: "var(--radius-sm)",
          }}
          title={error || (lang === "es" ? "Pendiente FX" : "Pending FX")}
        >
          {lang === "es" ? "[PENDIENTE FX]" : "[PENDING FX]"}
        </span>
      )}

      {/* Refresh */}
      <button
        type="button"
        onClick={onRefresh}
        disabled={loading}
        className="btn btn-ghost btn-sm"
        title={lang === "es" ? "Actualizar tasa" : "Refresh rate"}
        style={{ padding: "2px 8px", font: "500 11px/1 var(--font-body)" }}
      >
        {loading ? "…" : "↻"}
      </button>
    </div>
  );
}

function fxBtnStyle(active) {
  return {
    font: "600 11px/1 var(--font-body)",
    padding: "5px 10px",
    background: active ? "var(--brand-primary)" : "transparent",
    color: active ? "var(--text-on-navy)" : "var(--text-secondary)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
  };
}

// ─────────────────────────────────────────────────────────────────────
// TopSkusTable — Top 10 SKUs por contribución de margen USD (90d).
// Endpoint: /api/analytics/top_skus_margen/
// Shape esperado: [{ sku, product_name, brand_id, units_sold_90d,
//                    revenue_usd, margin_usd, margin_pct }]
// ─────────────────────────────────────────────────────────────────────
export function TopSkusTable({
  items,
  resolveBrand = () => null,
  lang = "es",
  emptyEndpoint = "/api/analytics/top_skus_margen/",
}) {
  if (!Array.isArray(items) || !items.length) {
    return (
      <EmptyState
        lang={lang}
        title={lang === "es" ? "Sin ranking de SKUs" : "No SKU ranking"}
        hint={lang === "es"
          ? "Sin ventas registradas en los últimos 90 días, o sin líneas con costo y precio unitarios."
          : "No sales in last 90 days, or no lines with unit cost/price."}
        endpoint={emptyEndpoint}
        compact
      />
    );
  }

  const sorted = [...items]
    .sort((a, b) => (b.margin_usd || 0) - (a.margin_usd || 0))
    .slice(0, 10);

  // Layout compacto para banda 4 (~350px de ancho cuando hay 3 cards):
  // SKU+producto · Marca · Unidades · Margen($+%) — 4 columnas con minmax(0, fr).
  // Revenue se mueve a tooltip de la columna Margen.
  const grid = "minmax(0, 1.3fr) minmax(0, 0.9fr) minmax(0, 0.55fr) minmax(0, 0.75fr)";

  return (
    <div>
      <div
        role="row"
        style={{
          display: "grid",
          gridTemplateColumns: grid,
          gap: 8,
          padding: "8px 12px",
          font: "var(--micro)",
          color: "var(--text-tertiary)",
          letterSpacing: "0.06em",
          borderBottom: "1px solid var(--divider)",
        }}
      >
        <span>SKU</span>
        <span>{tr(lang, "brand")}</span>
        <span style={{ textAlign: "right" }}>{lang === "es" ? "Unid." : "Units"}</span>
        <span style={{ textAlign: "right" }}>{lang === "es" ? "Margen" : "Margin"}</span>
      </div>

      {sorted.map((s, i) => {
        const brand = resolveBrand(s.brand_id);
        const marginPct = s.margin_pct != null ? Number(s.margin_pct) : null;
        const tooltip = [
          s.sku,
          s.product_name,
          s.revenue_usd != null ? `Revenue: ${fmtMoney(s.revenue_usd)}` : null,
          s.margin_usd != null ? `Margen USD: ${fmtMoney(s.margin_usd)}` : null,
        ].filter(Boolean).join(" · ");

        return (
          <div
            key={s.sku || i}
            role="row"
            title={tooltip}
            style={{
              display: "grid",
              gridTemplateColumns: grid,
              gap: 8,
              padding: "10px 12px",
              alignItems: "center",
              borderBottom: "1px solid var(--divider)",
            }}
          >
            <span style={{ minWidth: 0, overflow: "hidden" }}>
              <span className="mono-sm tabular" style={{
                font: "600 12px/1.2 var(--font-mono)",
                color: "var(--text-primary)",
                display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {s.sku || "—"}
              </span>
              {s.product_name && (
                <span style={{
                  font: "var(--caption)",
                  color: "var(--text-tertiary)",
                  display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {s.product_name}
                </span>
              )}
            </span>
            <span className="flex ai-center gap-2" style={{ minWidth: 0, overflow: "hidden" }}>
              <span style={{ width: 8, height: 8, background: brand?.color || "var(--border-strong)", borderRadius: 2, flexShrink: 0 }} />
              <span style={{
                font: "var(--caption)", color: "var(--text-secondary)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {brand?.name || "—"}
              </span>
            </span>
            <span
              className="tabular"
              title={lang === "es"
                ? `${s.units_sold_90d} unidades`
                : `${s.units_sold_90d} units`}
              style={{
                textAlign: "right",
                font: "600 12px/1 var(--font-mono)",
                color: "var(--text-secondary)",
                whiteSpace: "nowrap",
              }}
            >
              {s.units_sold_90d != null
                ? Number(s.units_sold_90d).toLocaleString(lang === "es" ? "es-PE" : "en-US")
                : "—"}
            </span>
            {/* Columna combinada: margen USD arriba, margen % debajo */}
            <span style={{ textAlign: "right", minWidth: 0, overflow: "hidden" }}>
              <span className="tabular" style={{
                font: "600 12px/1.2 var(--font-mono)",
                color: (s.margin_usd || 0) > 0 ? "var(--success)" : "var(--text-tertiary)",
                display: "block",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {s.margin_usd != null ? fmtMoney(s.margin_usd) : "—"}
              </span>
              <span className="tabular" style={{
                font: "500 10.5px/1.2 var(--font-mono)",
                color: marginPct == null ? "var(--text-tertiary)"
                     : marginPct >= 25 ? "var(--success)"
                     : marginPct >= 15 ? "var(--warning)"
                     : "var(--critical)",
                display: "block",
              }}>
                {marginPct != null ? `${marginPct.toFixed(1)}%` : ""}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// NodeInventoryGrid — tarjetas por nodo con cobertura en días.
// Endpoint: /api/analytics/inventory_coverage_by_node/
// Shape: [{ node_id, node_name, total_units, velocity_30d, coverage_days, status }]
// status: 'critical' (<21d) · 'warning' (21–45d) · 'ok' (>45d) · 'unknown'
// ─────────────────────────────────────────────────────────────────────
export function NodeInventoryGrid({
  items,
  lang = "es",
  emptyEndpoint = "/api/analytics/inventory_coverage_by_node/",
  onOpenNode,
}) {
  if (!Array.isArray(items) || !items.length) {
    return (
      <EmptyState
        lang={lang}
        title={lang === "es" ? "Sin inventario por nodo" : "No node inventory"}
        hint={lang === "es"
          ? "Ningún nodo activo con stock o sin movimientos en últimos 30 días."
          : "No active nodes with stock, or no out-movements in last 30 days."}
        endpoint={emptyEndpoint}
        compact
      />
    );
  }

  const colorByStatus = (s) =>
      s === "critical" ? "var(--critical)"
    : s === "warning"  ? "var(--warning)"
    : s === "ok"       ? "var(--success)"
    : "var(--text-tertiary)";

  return (
    <div style={{
      display: "grid",
      gap: 8,
      gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    }}>
      {items.map((n) => {
        const color = colorByStatus(n.status);
        return (
          <button
            key={n.node_id}
            type="button"
            onClick={() => onOpenNode && onOpenNode(n.node_id)}
            style={{
              textAlign: "left",
              padding: 12,
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border)",
              borderTop: `3px solid ${color}`,
              background: "var(--surface)",
              cursor: onOpenNode ? "pointer" : "default",
              font: "inherit",
              color: "inherit",
            }}
          >
            <div style={{
              font: "600 12px/1.2 var(--font-mono)",
              color: "var(--text-primary)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              marginBottom: 4,
            }}>
              {n.node_name || n.node_id}
            </div>
            <div className="tabular" style={{
              font: "700 18px/1 var(--font-display)",
              color: "var(--text-primary)",
              letterSpacing: "-0.01em",
            }}>
              {n.total_units != null
                ? Number(n.total_units).toLocaleString(lang === "es" ? "es-PE" : "en-US")
                : "—"}
              <span style={{ font: "var(--caption)", color: "var(--text-tertiary)", marginLeft: 4 }}>
                {lang === "es" ? "uds." : "units"}
              </span>
            </div>
            <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
              <span className="tabular" style={{
                font: "600 11px/1 var(--font-mono)",
                color,
              }}>
                {n.coverage_days != null
                  ? `${Number(n.coverage_days).toFixed(0)}d`
                  : (lang === "es" ? "s/cobertura" : "n/coverage")}
              </span>
              <span style={{ font: "var(--caption)", color: "var(--text-tertiary)" }}>
                · {lang === "es" ? "vel. 30d" : "30d vel."}: {n.velocity_30d != null
                  ? Number(n.velocity_30d).toFixed(1)
                  : "—"}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
