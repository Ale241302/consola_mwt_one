// ─────────────────────────────────────────────────────────────
// DebtCaseDrawer — Detalle y gobernanza del caso de cobro
// Agente responsable: [AG-FRONTEND]
//
// Drawer ancho que se abre al hacer click en un expediente en
// mora. El sistema cobra solo (CollectionBot); este drawer es
// el único punto donde el CEO puede intervenir:
//   · Ver resumen de deuda (factura/proforma + balance + días).
//   · Ver timeline de C1/C2/C3 enviados por el bot.
//   · Pausar el cobro automático (toggle de emergencia).
//   · Ajustar payment_grace_days para ESTE expediente.
//   · Marcar como "Escalado" → sale del flujo automático.
//
// IMPORTANTE: las acciones disparan onUpdate() para que el
// padre persista el cambio (mock en dev, API en prod).
// ─────────────────────────────────────────────────────────────
import React, { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  IconX, IconShield, IconAlert, IconCheck, IconMail, IconClock,
  IconSparkle, IconLock, IconFileText, IconArrow,
} from "../../lib/icons.jsx";

function fmtMoney(v, cur = "USD") {
  if (v == null || isNaN(v)) return "—";
  return `${cur} ${Number(v).toLocaleString("en-US", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
}
function fmtDateTime(s) {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d)) return "—";
  return d.toLocaleString("es-PE", {
    day: "2-digit", month: "short", year: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

// Meta visual por trigger (T1 = recordatorio, T2 = solicitud, T3 = crítico)
const TIMELINE_META = {
  C1: { label: "C1 · Recordatorio suave",  color: "#3083FE", bg: "rgba(48,131,254,0.10)" },
  C2: { label: "C2 · Solicitud formal",    color: "#B45309", bg: "rgba(180,83,9,0.10)"   },
  C3: { label: "C3 · Aviso crítico",       color: "#DC2626", bg: "rgba(220,38,38,0.10)"  },
};

export default function DebtCaseDrawer({
  lang = "es",
  caseData,        // shape: ver OverduePortfolioTable
  timeline = [],   // [{id, ts, trigger, status, recipient_email, error}]
  onClose,
  onUpdate,        // (patch) => void  — patch de campos del caso
}) {
  const [paused, setPaused]      = useState(caseData?.case_state === "paused");
  const [escalated, setEscalated]= useState(caseData?.case_state === "escalated");
  const [graceExtra, setGE]      = useState(caseData?.grace_extra_days ?? 0);
  const [pauseReason, setPR]     = useState(caseData?.pause_reason || "");

  // scroll lock body
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const sortedTimeline = useMemo(
    () => [...timeline].sort((a, b) => (b.ts || "").localeCompare(a.ts || "")),
    [timeline]
  );

  if (!caseData) return null;

  function applyPause(next) {
    setPaused(next);
    onUpdate?.({
      case_state: next ? "paused" : (escalated ? "escalated" : "active"),
      pause_reason: next ? pauseReason : "",
    });
  }
  function applyEscalate() {
    const next = !escalated;
    setEscalated(next);
    onUpdate?.({
      case_state: next ? "escalated" : (paused ? "paused" : "active"),
    });
  }
  function applyGrace() {
    onUpdate?.({ grace_extra_days: Number(graceExtra) || 0 });
  }

  return (
    <>
      <div className="drawer-overlay" onClick={onClose}/>
      <motion.aside
        className="cobros-drawer"
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", stiffness: 260, damping: 30 }}
      >
        {/* ── HEAD ─────────────── */}
        <div className="cobros-drawer-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="micro" style={{ marginBottom: 4 }}>
              {lang === "es" ? "GOBERNANZA DEL CASO" : "CASE GOVERNANCE"}
            </div>
            <div className="heading-md" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="mono" style={{ color: "var(--brand-primary, #0B1E3A)" }}>
                {caseData.expediente_code || caseData.expediente_id}
              </span>
              <span
                className="cobros-stage-badge"
                data-stage={caseData.stage.key}
              >
                {caseData.stage.label}
              </span>
            </div>
            <div className="caption" style={{ marginTop: 4 }}>
              {caseData.client_name} · {caseData.proforma_id || "—"}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <IconX size={16}/>
          </button>
        </div>

        {/* ── BODY ─────────────── */}
        <div className="cobros-drawer-body">

          {/* Resumen de la deuda */}
          <section className="cobros-section">
            <div className="cobros-section-title">
              <IconFileText size={13}/>
              {lang === "es" ? "Resumen de la deuda" : "Debt summary"}
            </div>
            <div className="cobros-debt-grid">
              <div className="cobros-debt-cell">
                <div className="micro">{lang === "es" ? "MONTO VENCIDO" : "AMOUNT OVERDUE"}</div>
                <div className="cobros-debt-value tabular-nums" style={{ color: "#B45309" }}>
                  {fmtMoney(caseData.amount_overdue, caseData.currency)}
                </div>
              </div>
              <div className="cobros-debt-cell">
                <div className="micro">{lang === "es" ? "TOTAL FACTURADO" : "TOTAL INVOICED"}</div>
                <div className="cobros-debt-value tabular-nums">
                  {fmtMoney(caseData.total_invoiced, caseData.currency)}
                </div>
              </div>
              <div className="cobros-debt-cell">
                <div className="micro">{lang === "es" ? "DÍAS DE MORA" : "DAYS OVERDUE"}</div>
                <div className="cobros-debt-value tabular-nums" style={{ color: caseData.stage.color }}>
                  {caseData.days_overdue}
                </div>
              </div>
              <div className="cobros-debt-cell">
                <div className="micro">{lang === "es" ? "DÍAS DE GRACIA" : "GRACE DAYS"}</div>
                <div className="cobros-debt-value tabular-nums">
                  {caseData.payment_grace_days || 0}
                  {graceExtra ? (
                    <span style={{ color: "#00B286", fontSize: 13, marginLeft: 6 }}>
                      +{graceExtra}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          </section>

          {/* Timeline de interacciones */}
          <section className="cobros-section">
            <div className="cobros-section-title">
              <IconClock size={13}/>
              {lang === "es" ? "Historial de interacciones del bot" : "Bot interaction history"}
              <span className="cobros-timeline-count tabular-nums">
                {sortedTimeline.length}
              </span>
            </div>

            {sortedTimeline.length === 0 ? (
              <div className="cobros-empty-mini">
                <IconSparkle size={14} style={{ opacity: 0.4 }}/>
                {lang === "es"
                  ? "El bot todavía no ha enviado correos para este expediente."
                  : "The bot has not sent emails for this case yet."}
              </div>
            ) : (
              <div className="cobros-timeline">
                <AnimatePresence initial={false}>
                  {sortedTimeline.map((ev, i) => {
                    const meta = TIMELINE_META[ev.trigger] || { label: ev.trigger, color: "#6B7280", bg: "rgba(107,114,128,0.10)" };
                    const failed = ev.status === "Failed" || ev.status === "Exhausted";
                    return (
                      <motion.div
                        key={ev.id || i}
                        layout
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.18, delay: Math.min(i * 0.03, 0.18) }}
                        className="cobros-timeline-row"
                      >
                        <div
                          className="cobros-timeline-dot"
                          style={{ background: meta.color, boxShadow: `0 0 0 4px ${meta.bg}` }}
                        />
                        <div className="cobros-timeline-card">
                          <div className="cobros-timeline-card-head">
                            <span
                              className="cobros-timeline-tag"
                              style={{ color: meta.color, background: meta.bg, borderColor: meta.color }}
                            >
                              {meta.label}
                            </span>
                            <span className="micro tabular-nums text-sec">
                              {fmtDateTime(ev.ts)}
                            </span>
                          </div>
                          <div className="cobros-timeline-card-body">
                            <div className="caption">
                              <IconMail size={10} style={{ verticalAlign: "-1px", marginRight: 4 }}/>
                              <span className="mono">{ev.recipient_email || "—"}</span>
                            </div>
                            <span
                              className="cobros-timeline-status"
                              data-tone={failed ? "crit" : (ev.status === "Disabled" ? "warn" : "ok")}
                            >
                              {failed ? <IconAlert size={10}/> : <IconCheck size={10}/>}
                              {ev.status}
                            </span>
                          </div>
                          {ev.error && (
                            <div className="micro" style={{ color: "#DC2626", marginTop: 4 }}>
                              {ev.error}
                            </div>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            )}
          </section>

          {/* Intervención manual / Gobernanza */}
          <section className="cobros-section">
            <div className="cobros-section-title">
              <IconShield size={13}/>
              {lang === "es" ? "Intervención manual (gobernanza)" : "Manual intervention (governance)"}
            </div>

            {/* Pausar cobro automático */}
            <div className="cobros-action-card">
              <div className="cobros-action-card-head">
                <div>
                  <div className="heading-sm">
                    {lang === "es" ? "Pausar cobro automático" : "Pause automatic collection"}
                  </div>
                  <div className="caption">
                    {lang === "es"
                      ? "El bot deja de enviar C1/C2/C3 a este expediente hasta que se reactive."
                      : "Bot stops sending C1/C2/C3 to this case until reactivated."}
                  </div>
                </div>
                <label className="cobros-toggle">
                  <input
                    type="checkbox"
                    checked={paused}
                    onChange={(e) => applyPause(e.target.checked)}
                  />
                  <span className="cobros-toggle-track" data-on={paused}/>
                  <span
                    className="cobros-toggle-label"
                    style={{ color: paused ? "#3083FE" : "var(--text-tertiary)" }}
                  >
                    {paused ? (lang === "es" ? "Pausado" : "Paused") : (lang === "es" ? "Activo" : "Active")}
                  </span>
                </label>
              </div>
              {paused && (
                <input
                  type="text"
                  className="input"
                  placeholder={lang === "es"
                    ? "Motivo (ej. promesa de pago verbal · 5 días)"
                    : "Reason (e.g. verbal promise to pay · 5 days)"}
                  value={pauseReason}
                  onChange={(e) => setPR(e.target.value)}
                  onBlur={() => onUpdate?.({ pause_reason: pauseReason })}
                  style={{ marginTop: 10 }}
                />
              )}
            </div>

            {/* Ajustar grace days */}
            <div className="cobros-action-card">
              <div className="cobros-action-card-head">
                <div>
                  <div className="heading-sm">
                    {lang === "es" ? "Ajustar días de gracia" : "Adjust grace days"}
                  </div>
                  <div className="caption">
                    {lang === "es"
                      ? `Suma días extra a payment_grace_days = ${caseData.payment_grace_days || 0} solo para este expediente.`
                      : `Adds extra days to payment_grace_days = ${caseData.payment_grace_days || 0} for this case only.`}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="number"
                    className="input input-sm tabular-nums"
                    value={graceExtra}
                    onChange={(e) => setGE(e.target.value)}
                    style={{ width: 80, textAlign: "right" }}
                    min={0}
                    max={60}
                  />
                  <span className="caption">{lang === "es" ? "días extra" : "extra days"}</span>
                  <button className="btn btn-ghost btn-sm" onClick={applyGrace}>
                    <IconCheck size={11}/>
                    {lang === "es" ? "Aplicar" : "Apply"}
                  </button>
                </div>
              </div>
            </div>

            {/* Marcar como escalado */}
            <div className="cobros-action-card" data-danger={escalated || undefined}>
              <div className="cobros-action-card-head">
                <div>
                  <div className="heading-sm" style={{ color: escalated ? "#481EE3" : undefined }}>
                    {lang === "es" ? "Marcar como escalado" : "Mark as escalated"}
                  </div>
                  <div className="caption">
                    {lang === "es"
                      ? "Saca el expediente del flujo automático y lo deja a gestión legal/directa del CEO."
                      : "Removes the case from the automatic flow; CEO/legal takes over."}
                  </div>
                </div>
                <button
                  className={"btn btn-sm " + (escalated ? "btn-purple" : "btn-ghost")}
                  onClick={applyEscalate}
                >
                  {escalated ? <IconLock size={11}/> : <IconArrow size={11}/>}
                  {escalated
                    ? (lang === "es" ? "Devolver al bot" : "Return to bot")
                    : (lang === "es" ? "Escalar al CEO" : "Escalate to CEO")}
                </button>
              </div>
            </div>
          </section>
        </div>

        {/* ── FOOT ─────────────── */}
        <div className="cobros-drawer-foot">
          <div className="micro" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <IconShield size={11}/>
            {lang === "es"
              ? "Cualquier cambio queda registrado en CollectionEmailLog y respeta el kill-switch global."
              : "All changes are logged in CollectionEmailLog and respect the global kill-switch."}
          </div>
          <button className="btn btn-primary" onClick={onClose}>
            <IconCheck size={12}/>
            {lang === "es" ? "Cerrar" : "Close"}
          </button>
        </div>
      </motion.aside>
    </>
  );
}
