// ─────────────────────────────────────────────────────────────
// CronogramaExtras — KPIs, Próximas entregas, Pipeline y Tabla
// Sprint 2026-06-10 · Agente responsable: [AG-03 FRONTEND]
//
// Vistas hermanas del Gantt en /cronograma (paridad con los tabs del
// antiguo Resumen .html), con animaciones framer-motion y role-aware:
// las etiquetas/los datos llegan ya filtrados desde la página.
// Cada componente recibe `enriched`: [{ it, segs, delivery }].
// ─────────────────────────────────────────────────────────────
import React from "react";
import { motion } from "framer-motion";
import {
  STAGES, STAGE_LABELS, STAGE_COLORS, fmtShort, today, dayDiff,
} from "../../lib/cronogramaData.js";

const fInt = (n) => Number(n || 0).toLocaleString("es-CR");
const stagger = {
  hidden: { opacity: 0, y: 8 },
  show: (i) => ({ opacity: 1, y: 0, transition: { delay: Math.min(i * 0.04, 0.4), duration: 0.25 } }),
};

/* ── KPIs ──────────────────────────────────────────────────── */
export function KpiStrip({ enriched, lang = "es" }) {
  const items = enriched.map((e) => e.it);
  const delivered = items.filter((it) => it.estado === "EN_DESTINO" || it.estado === "CERRADO").length;
  const transit = items.filter((it) => it.estado === "TRANSITO").length;
  const porSalir = items.filter((it) => ["REGISTRO", "PRODUCCION", "PREPARACION", "DESPACHO"].includes(it.estado)).length;
  const pares = items.reduce((a, it) => a + (it.volumen || 0), 0);
  const kpis = [
    [lang === "es" ? "Expedientes" : "Files", items.length],
    [lang === "es" ? "Entregados" : "Delivered", delivered],
    [lang === "es" ? "En tránsito" : "In transit", transit],
    [lang === "es" ? "Por salir" : "To ship", porSalir],
    [lang === "es" ? "Pares totales" : "Total pairs", fInt(pares)],
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
      {kpis.map(([label, value], i) => (
        <motion.div key={label} custom={i} variants={stagger} initial="hidden" animate="show"
                    whileHover={{ y: -2, boxShadow: "0 8px 20px rgba(1,58,87,0.10)" }}
                    className="card"
                    style={{ padding: "12px 16px", borderRadius: 12 }}>
          <div className="tabular-nums" style={{ fontSize: 20, fontWeight: 800, color: "#0B1E3A" }}>{value}</div>
          <div className="caption" style={{ color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: 0.5, fontSize: 10 }}>
            {label}
          </div>
        </motion.div>
      ))}
    </div>
  );
}

/* ── Próximas entregas ─────────────────────────────────────── */
export function UpcomingDeliveries({ enriched, lang = "es", labelOf, onOpen }) {
  const rows = enriched
    .filter((e) => e.delivery.date)
    .sort((a, b) => {
      if (a.delivery.done !== b.delivery.done) return a.delivery.done ? 1 : -1;
      return a.delivery.done
        ? b.delivery.date - a.delivery.date
        : a.delivery.date - b.delivery.date;
    });
  if (!rows.length) {
    return <div className="caption" style={{ padding: 18, textAlign: "center", color: "var(--text-tertiary)" }}>
      {lang === "es" ? "Sin fechas de entrega." : "No delivery dates."}
    </div>;
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 10 }}>
      {rows.map(({ it, delivery }, i) => {
        const dias = Math.round((delivery.date - today()) / 86400000);
        return (
          <motion.div key={it.id} custom={i} variants={stagger} initial="hidden" animate="show"
                      whileHover={{ y: -3, boxShadow: "0 10px 24px rgba(1,58,87,0.12)" }}
                      onClick={() => onOpen && onOpen(it)}
                      className="card"
                      style={{ padding: "12px 14px", borderRadius: 12, cursor: "pointer", borderTop: `3px solid ${delivery.done ? "#13B98A" : "#013A57"}` }}>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: "#0B1E3A" }}>
              {labelOf(it)}
              <span className="tabular-nums" style={{ fontWeight: 700, color: "var(--text-secondary, #475569)" }}>
                {" · "}{fmtShort(delivery.date, lang)}{delivery.est ? " (est.)" : ""}
              </span>
            </div>
            <div className="caption" style={{ color: "var(--text-tertiary)", marginTop: 3 }}>
              {fInt(it.volumen)} prs · {it.modo || (lang === "es" ? "Aéreo (sup.)" : "Air (assumed)")} · {it.operadoPorMwt ? "MWT" : (lang === "es" ? "Cliente" : "Client")}
            </div>
            <div style={{ marginTop: 7, fontSize: 11.5, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 99, background: delivery.done ? "#13B98A" : (dias <= 7 ? "#F59E0B" : "#0FA3A0") }}/>
              {delivery.done
                ? (lang === "es" ? "Entregado" : "Delivered")
                : (dias <= 0
                    ? (lang === "es" ? "entrega hoy/vencida" : "due today/overdue")
                    : (lang === "es" ? `en ${dias} días` : `in ${dias} days`))}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

/* ── Pipeline por estado (kanban) ──────────────────────────── */
export function PipelineBoard({ enriched, lang = "es", labelOf, onOpen }) {
  const L = STAGE_LABELS[lang] || STAGE_LABELS.es;
  const by = {};
  STAGES.forEach((s) => { by[s] = []; });
  enriched.forEach((e) => { (by[e.it.estado] || (by[e.it.estado] = [])).push(e); });
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${STAGES.length}, minmax(130px, 1fr))`, gap: 8, overflowX: "auto" }}>
      {STAGES.map((s) => (
        <div key={s} style={{ background: "var(--surface-alt, #F6F8FB)", borderRadius: 12, padding: 8, minHeight: 120 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, padding: "2px 4px" }}>
            <span style={{ width: 8, height: 8, borderRadius: 3, background: STAGE_COLORS[s] }}/>
            <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5, color: "var(--text-secondary, #475569)", textTransform: "uppercase" }}>{L[s]}</span>
            <span className="tabular-nums" style={{ marginLeft: "auto", fontSize: 10.5, fontWeight: 700, background: "#fff", borderRadius: 99, padding: "1px 7px", color: "var(--text-tertiary)" }}>
              {(by[s] || []).length}
            </span>
          </div>
          {(by[s] || []).map(({ it, delivery }, i) => (
            <motion.div key={it.id} custom={i} variants={stagger} initial="hidden" animate="show"
                        whileHover={{ y: -2, boxShadow: "0 8px 18px rgba(1,58,87,0.12)" }}
                        onClick={() => onOpen && onOpen(it)}
                        style={{ background: "#fff", borderRadius: 10, padding: "9px 10px", marginBottom: 7, cursor: "pointer", border: "1px solid var(--border-subtle, #E1E6ED)" }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#0B1E3A" }}>{labelOf(it)}</div>
              <div className="caption tabular-nums" style={{ color: "var(--text-tertiary)", marginTop: 2 }}>
                {fInt(it.volumen)} prs · {it.modo || (lang === "es" ? "Aéreo (sup.)" : "Air")}
              </div>
              {delivery.date && (
                <div className="caption tabular-nums" style={{ marginTop: 4, color: delivery.done ? "#13B98A" : "var(--text-secondary, #475569)", fontWeight: 700 }}>
                  {delivery.done ? (lang === "es" ? "Entregado " : "Delivered ") : (lang === "es" ? "Llega " : "ETA ")}
                  {fmtShort(delivery.date, lang)}{delivery.est ? " (est.)" : ""}
                </div>
              )}
            </motion.div>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ── Tabla de expedientes ──────────────────────────────────── */
export function ExpedientesTable({ enriched, lang = "es", labelOf, onOpen }) {
  const L = STAGE_LABELS[lang] || STAGE_LABELS.es;
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="table" style={{ fontSize: 12.5 }}>
        <thead>
          <tr>
            <th>{lang === "es" ? "Referencia" : "Reference"}</th>
            <th>{lang === "es" ? "Expediente" : "File"}</th>
            <th>{lang === "es" ? "Cliente" : "Client"}</th>
            <th>{lang === "es" ? "Operador" : "Operator"}</th>
            <th>{lang === "es" ? "Método" : "Mode"}</th>
            <th style={{ textAlign: "right" }}>{lang === "es" ? "Pares" : "Pairs"}</th>
            <th>{lang === "es" ? "Estado" : "State"}</th>
            <th style={{ textAlign: "right" }}>{lang === "es" ? "Llegada" : "Arrival"}</th>
          </tr>
        </thead>
        <tbody>
          {enriched.map(({ it, delivery }, i) => (
            <motion.tr key={it.id} custom={i} variants={stagger} initial="hidden" animate="show"
                       onClick={() => onOpen && onOpen(it)}
                       style={{ cursor: "pointer" }}>
              <td className="mono-sm" style={{ fontWeight: 700, color: "var(--brand-primary, #013A57)", textDecoration: "underline dotted", textUnderlineOffset: 3 }}>
                {labelOf(it)}
              </td>
              <td className="mono-sm">{it.expCodigo || "—"}</td>
              <td style={{ maxWidth: 160, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.cliente || "—"}</td>
              <td>{it.operadoPorMwt ? "MWT" : (lang === "es" ? "Cliente" : "Client")}</td>
              <td>{it.modo || (lang === "es" ? "Aéreo (sup.)" : "Air (assumed)")}</td>
              <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 700 }}>{fInt(it.volumen)}</td>
              <td>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 99, background: STAGE_COLORS[it.estado] || "#94A7B8" }}/>
                  {L[it.estado] || it.estado}
                </span>
              </td>
              <td className="tabular-nums" style={{ textAlign: "right", color: delivery.done ? "#13B98A" : "var(--text-secondary, #475569)", fontWeight: 600 }}>
                {delivery.date ? `${fmtShort(delivery.date, lang)}${delivery.est ? " (est.)" : ""}` : "—"}
              </td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
