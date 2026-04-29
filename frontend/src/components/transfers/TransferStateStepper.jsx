// ─────────────────────────────────────────────────────────────
// TransferStateStepper — Timeline de estados de transferencia
// Sprint Transfer Engine v4 · 2026-04-29
// Agente responsable: [AG-FRONTEND]
//
// Render visual del ciclo de vida:
//   Planificada → Aprobada → En Tránsito → Recibida → Reconciliada
//
// El usuario puede AVANZAR el estado (POST /advance/) si:
//   · Tiene permisos (read-only para CLIENT B2B).
//   · La transferencia no está cancelada/cerrada.
//
// Tokens: Navy #0B1E3A · Mint #00B286 · tabular-nums.
// ─────────────────────────────────────────────────────────────
import React, { useMemo } from "react";
import { IconCheck, IconClipboard, IconTruck, IconPackage, IconAlert } from "../../lib/icons.jsx";

const STEPS = [
  { code: "PLANNED",    es: "Planificada",   en: "Planned",      icon: IconClipboard },
  { code: "APPROVED",   es: "Aprobada",      en: "Approved",     icon: IconCheck },
  { code: "IN_TRANSIT", es: "En tránsito",   en: "In transit",   icon: IconTruck },
  { code: "RECEIVED",   es: "Recibida",      en: "Received",     icon: IconPackage },
  { code: "RECONCILED", es: "Reconciliada",  en: "Reconciled",   icon: IconCheck },
];
const FINAL = ["RECONCILED", "CLOSED", "CANCELLED"];

const NEXT_LABEL_ES = {
  PLANNED:    "Aprobar",
  APPROVED:   "Despachar",
  IN_TRANSIT: "Recibir",
  RECEIVED:   "Reconciliar",
  RECONCILED: "Cerrar",
};
const NEXT_LABEL_EN = {
  PLANNED:    "Approve",
  APPROVED:   "Dispatch",
  IN_TRANSIT: "Receive",
  RECEIVED:   "Reconcile",
  RECONCILED: "Close",
};

const MOCK_TO_API = {
  planned: "PLANNED", approved: "APPROVED", in_transit: "IN_TRANSIT",
  received: "RECEIVED", reconciled: "RECONCILED", closed: "CLOSED", cancelled: "CANCELLED",
};

export default function TransferStateStepper({
  currentStatus,        // 'planned' | 'approved' | …  o  'PLANNED' | 'APPROVED' | …
  hasDiscrepancy = false,
  onAdvance,            // () => void · ejecuta POST /advance/
  busy = false,
  lang = "es",
  canAdvance = true,
  blockReason = null,
}) {
  const status = useMemo(() => {
    if (!currentStatus) return "PLANNED";
    const upper = String(currentStatus).toUpperCase();
    return MOCK_TO_API[currentStatus] || (STEPS.find(s => s.code === upper) ? upper : upper);
  }, [currentStatus]);

  const currentIdx = STEPS.findIndex((s) => s.code === status);
  const isFinal = FINAL.includes(status);
  const isCancelled = status === "CANCELLED";
  const nextLabel = (lang === "es" ? NEXT_LABEL_ES : NEXT_LABEL_EN)[status] || (lang === "es" ? "Avanzar" : "Advance");

  return (
    <div className="card card-pad-md" style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
        <div className="micro" style={{ color: "#00B286", letterSpacing: 1 }}>
          {lang === "es" ? "CICLO DE VIDA" : "LIFECYCLE"}
        </div>
        {!isFinal && !isCancelled && (
          <button
            type="button"
            disabled={busy || !canAdvance}
            onClick={onAdvance}
            className="btn btn-accent"
            style={{
              minWidth: 180, fontWeight: 700,
              background: canAdvance ? "var(--btn-primary, #00B286)" : "#94A3B8",
              borderColor: canAdvance ? "var(--btn-primary, #00B286)" : "#94A3B8",
            }}>
            {busy ? (lang === "es" ? "Procesando…" : "Processing…") : <>→ {nextLabel}</>}
          </button>
        )}
        {isCancelled && (
          <span style={{
            padding: "4px 12px", borderRadius: 999, fontSize: 11, fontWeight: 700,
            background: "#FEE2E2", color: "#991B1B", letterSpacing: 0.5,
          }}>
            ✕ {lang === "es" ? "CANCELADA" : "CANCELLED"}
          </span>
        )}
        {status === "CLOSED" && (
          <span style={{
            padding: "4px 12px", borderRadius: 999, fontSize: 11, fontWeight: 700,
            background: "rgba(0,178,134,0.10)", color: "#00B286",
          }}>
            ✓ {lang === "es" ? "CERRADA" : "CLOSED"}
          </span>
        )}
      </div>

      {/* Timeline horizontal */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 0 }}>
        {STEPS.map((step, idx) => {
          const Icon = step.icon;
          const isDone = idx < currentIdx || (status === "CLOSED" && idx <= STEPS.length - 1);
          const isCurrent = idx === currentIdx;
          const isFuture = idx > currentIdx;
          const showGap = isCurrent && hasDiscrepancy && step.code === "RECEIVED";

          const dotBg = isDone ? "#00B286" :
                        isCurrent ? (showGap ? "#F59E0B" : "#00B286") :
                        "#E1E6ED";
          const dotColor = isDone || isCurrent ? "#fff" : "#64748B";
          const labelColor = isCurrent ? "#0B1E3A" : (isDone ? "#0B1E3A" : "#94A3B8");

          return (
            <React.Fragment key={step.code}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 90 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: "50%",
                  background: dotBg, color: dotColor,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontWeight: 700, fontSize: 14,
                  boxShadow: isCurrent ? `0 0 0 4px ${showGap ? "rgba(245,158,11,0.20)" : "rgba(0,178,134,0.20)"}` : "none",
                  transition: "all 0.18s ease",
                }}>
                  {isDone ? <IconCheck size={16}/> : (isCurrent ? <Icon size={16}/> : (idx + 1))}
                </div>
                <div style={{ fontSize: 12, fontWeight: isCurrent ? 700 : 600, color: labelColor, textAlign: "center", whiteSpace: "nowrap" }}>
                  {lang === "es" ? step.es : step.en}
                </div>
                {showGap && (
                  <div style={{ fontSize: 10, color: "#92400E", fontWeight: 700, display: "flex", alignItems: "center", gap: 3 }}>
                    <IconAlert size={9}/> GAP
                  </div>
                )}
              </div>
              {idx < STEPS.length - 1 && (
                <div style={{
                  flex: 1, height: 2, margin: "0 4px",
                  background: idx < currentIdx ? "#00B286" : "#E1E6ED",
                  transition: "background 0.18s ease",
                  minWidth: 30,
                }}/>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {blockReason && (
        <div style={{
          marginTop: 14, padding: "10px 14px", borderRadius: 8,
          background: "#FEF3C7", border: "1px solid #FDE68A",
          color: "#92400E", fontSize: 13,
        }}>
          <IconAlert size={11} style={{ verticalAlign: -1, marginRight: 6 }}/>
          {blockReason}
        </div>
      )}
    </div>
  );
}
