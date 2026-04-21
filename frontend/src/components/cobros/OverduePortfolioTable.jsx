// ─────────────────────────────────────────────────────────────
// OverduePortfolioTable — Cartera en mora (Tab 1 · Cobros)
// Agente responsable: [AG-FRONTEND]
//
// Tabla densa sobre expedientes con balance > 0 cuyos días de
// mora superaron el payment_grace_days del cliente. Clasifica
// cada caso automáticamente en T1 / T2 / T3 según antigüedad:
//   T1 (1-15 días)  → recordatorio suave  (warning)
//   T2 (16-45 días) → solicitud formal    (warning oscuro)
//   T3 (45+ días)   → escalación crítica  (critical)
//
// El sistema (CollectionBot) es el que manda los correos; el
// humano solo audita y abre el drawer para gobernar excepciones.
// ─────────────────────────────────────────────────────────────
import React, { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  IconSearch, IconX, IconFilter, IconAlert, IconSparkle,
  IconChevRight, IconLock, IconShield,
} from "../../lib/icons.jsx";

function fmtMoney(v, cur = "USD") {
  if (v == null || isNaN(v)) return "—";
  return `${cur} ${Number(v).toLocaleString("en-US", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
}
function fmtDate(s) {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d)) return "—";
  return d.toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "2-digit" });
}

// Clasificación automática T1/T2/T3 basada en días de mora
export function stageFromDays(daysOverdue) {
  if (daysOverdue <= 0)  return { key: "ok", label: "Al día",      color: "#0E8A6D" };
  if (daysOverdue <= 15) return { key: "T1", label: "T1 · Recordatorio", color: "#B45309" };
  if (daysOverdue <= 45) return { key: "T2", label: "T2 · Solicitud",    color: "#C2410C" };
  return                     { key: "T3", label: "T3 · Crítico",     color: "#DC2626" };
}

const CASE_STATE_META = {
  active:    { label: "Activo",   color: "#00B286", icon: IconSparkle,
               hint: "El bot está cobrando automáticamente" },
  paused:    { label: "Pausado",  color: "#3083FE", icon: IconShield,
               hint: "Cobro automático detenido (promesa de pago / negociación)" },
  blocked:   { label: "Bloqueado",color: "#6B7280", icon: IconLock,
               hint: "Litigio / no contactar" },
  escalated: { label: "Escalado", color: "#481EE3", icon: IconAlert,
               hint: "Requiere gestión humana del CEO" },
};

export default function OverduePortfolioTable({
  lang = "es",
  cases = [],
  onOpenCase,
}) {
  const [q, setQ]           = useState("");
  const [stageFilter, setSF]= useState("all");      // all | T1 | T2 | T3
  const [minAmount, setMin] = useState("");
  const [maxAmount, setMax] = useState("");

  // Universo de clientes para filtro rápido
  const uniqueClients = useMemo(() => {
    const set = new Map();
    cases.forEach(c => { if (c.client_id) set.set(c.client_id, c.client_name); });
    return Array.from(set.entries()).map(([id, name]) => ({ id, name }));
  }, [cases]);
  const [clientFilter, setCF] = useState("all");

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const mn = minAmount ? Number(minAmount) : null;
    const mx = maxAmount ? Number(maxAmount) : null;
    return cases
      .filter(c => {
        if (clientFilter !== "all" && c.client_id !== clientFilter) return false;
        if (stageFilter !== "all" && c.stage.key !== stageFilter)    return false;
        if (mn != null && c.amount_overdue < mn) return false;
        if (mx != null && c.amount_overdue > mx) return false;
        if (needle) {
          const hay = [c.expediente_id, c.expediente_code, c.client_name, c.proforma_id]
            .filter(Boolean).join(" ").toLowerCase();
          if (!hay.includes(needle)) return false;
        }
        return true;
      })
      .sort((a, b) => b.days_overdue - a.days_overdue);
  }, [cases, q, clientFilter, stageFilter, minAmount, maxAmount]);

  function clearFilters() {
    setQ(""); setCF("all"); setSF("all"); setMin(""); setMax("");
  }
  const hasFilters = q || clientFilter !== "all" || stageFilter !== "all" || minAmount || maxAmount;

  return (
    <div className="cobros-portfolio">
      {/* ── Filtros ─────────────── */}
      <div className="cobros-filters">
        <div className="search-wrap" style={{ maxWidth: 320 }}>
          <IconSearch size={14} className="search-icon"/>
          <input
            className="input"
            placeholder={lang === "es" ? "Buscar expediente, cliente, proforma…" : "Search file, client, proforma…"}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q && <button className="search-clear" onClick={() => setQ("")}><IconX size={12}/></button>}
        </div>

        <select
          className="input input-sm"
          value={clientFilter}
          onChange={(e) => setCF(e.target.value)}
          style={{ maxWidth: 180 }}
        >
          <option value="all">{lang === "es" ? "Todos los clientes" : "All clients"}</option>
          {uniqueClients.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        <div className="cobros-stage-tabs">
          {[
            { k: "all", label: lang === "es" ? "Todas" : "All" },
            { k: "T1",  label: "T1" },
            { k: "T2",  label: "T2" },
            { k: "T3",  label: "T3" },
          ].map(t => (
            <button
              key={t.k}
              className="cobros-stage-tab"
              data-active={stageFilter === t.k}
              data-stage={t.k}
              onClick={() => setSF(t.k)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="cobros-amount-range">
          <IconFilter size={12} style={{ opacity: 0.6 }}/>
          <input
            type="number"
            className="input input-sm tabular-nums"
            placeholder={lang === "es" ? "Monto mín." : "Min amount"}
            value={minAmount}
            onChange={(e) => setMin(e.target.value)}
            style={{ width: 100 }}
          />
          <span className="micro">–</span>
          <input
            type="number"
            className="input input-sm tabular-nums"
            placeholder={lang === "es" ? "Monto máx." : "Max amount"}
            value={maxAmount}
            onChange={(e) => setMax(e.target.value)}
            style={{ width: 100 }}
          />
        </div>

        {hasFilters && (
          <button className="btn btn-ghost btn-sm" onClick={clearFilters}>
            <IconX size={12}/> {lang === "es" ? "Limpiar" : "Clear"}
          </button>
        )}

        <div className="cobros-filter-count">
          <span className="tabular-nums" style={{ fontWeight: 700 }}>{rows.length}</span>
          <span className="micro">{lang === "es" ? "CASOS" : "CASES"}</span>
        </div>
      </div>

      {/* ── Tabla ─────────────── */}
      <div className="card cobros-portfolio-card">
        <div className="cobros-portfolio-head">
          <div>{lang === "es" ? "Expediente · Cliente" : "File · Client"}</div>
          <div className="text-right">{lang === "es" ? "Monto vencido" : "Amount overdue"}</div>
          <div className="text-right">{lang === "es" ? "Días de mora" : "Days overdue"}</div>
          <div>{lang === "es" ? "Etapa de cobro" : "Collection stage"}</div>
          <div>{lang === "es" ? "Última acción" : "Last action"}</div>
          <div>{lang === "es" ? "Estado" : "Case state"}</div>
          <div/>
        </div>

        <AnimatePresence mode="popLayout" initial={false}>
          {rows.map((c, idx) => {
            const stMeta = CASE_STATE_META[c.case_state] || CASE_STATE_META.active;
            const StIcon = stMeta.icon;
            return (
              <motion.div
                key={c.id}
                layout
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18, delay: Math.min(idx * 0.01, 0.12) }}
                className="cobros-portfolio-row"
                onClick={() => onOpenCase?.(c)}
              >
                <div className="cobros-col-refs">
                  <div className="mono" style={{ font: "700 12px/1.2 var(--font-mono)", color: "var(--brand-primary, #0B1E3A)" }}>
                    {c.expediente_code || c.expediente_id}
                  </div>
                  <div className="micro text-sec" style={{ marginTop: 2 }}>
                    {c.client_name}
                  </div>
                </div>

                <div className="cobros-col-amount tabular-nums text-right">
                  <div style={{ color: "#B45309", fontWeight: 700, fontSize: 13 }}>
                    {fmtMoney(c.amount_overdue, c.currency)}
                  </div>
                  <div className="micro text-sec" style={{ marginTop: 2 }}>
                    {c.proforma_id || "—"}
                  </div>
                </div>

                <div className="cobros-col-days tabular-nums text-right">
                  <span
                    className="cobros-days-pill tabular-nums"
                    data-tone={c.stage.key}
                  >
                    {c.days_overdue}{lang === "es" ? " d" : "d"}
                  </span>
                </div>

                <div className="cobros-col-stage">
                  <span className="cobros-stage-badge" data-stage={c.stage.key}>
                    {c.stage.label}
                  </span>
                </div>

                <div className="cobros-col-last">
                  <div style={{ font: "500 12px/1.2 var(--font-body)" }}>
                    {c.last_action_template || "—"}
                  </div>
                  <div className="micro text-sec tabular-nums" style={{ marginTop: 2 }}>
                    {fmtDate(c.last_action_at)}
                  </div>
                </div>

                <div className="cobros-col-state">
                  <span
                    className="cobros-case-state"
                    data-state={c.case_state}
                    title={stMeta.hint}
                  >
                    <StIcon size={11}/>
                    {stMeta.label}
                  </span>
                </div>

                <div className="cobros-col-chev">
                  <IconChevRight size={14} style={{ color: "var(--text-tertiary)" }}/>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {rows.length === 0 && (
          <div className="cobros-empty">
            <IconSparkle size={20} style={{ opacity: 0.35 }}/>
            <div className="heading-sm">
              {lang === "es" ? "No hay casos en mora con estos filtros" : "No overdue cases match the filters"}
            </div>
            <div className="caption">
              {lang === "es"
                ? "Si todos tus filtros están vacíos, significa que el CollectionBot tiene la cartera al día."
                : "If all filters are empty, it means the CollectionBot keeps the portfolio clean."}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
