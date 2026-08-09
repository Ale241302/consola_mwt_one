// MWT.ONE · features/transfers/liquidation/components/ConfirmModal.jsx
// Modal de confirmación de liquidación (summary preview).
// Migrado a ui/Modal.jsx (Ola 3 · 3.25) — trae focus trap + Escape + restore.
import React from "react";
import Modal from "../../../../components/ui/Modal.jsx";
import { fmt } from "../liquidation.logic.js";

export default function ConfirmModal({ lang, summary, onCancel, onConfirm, busy }) {
  return (
    <Modal open onClose={busy ? undefined : onCancel} title={
      lang === "es" ? "¿Liquidar y transferir inventario?" : "Liquidate and transfer inventory?"
    } footer={
      <>
        <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          {lang === "es" ? "Cancelar" : "Cancel"}
        </button>
        <button className="btn btn-accent" onClick={onConfirm} disabled={busy}
                style={{
                  minWidth: 200, fontWeight: 700,
                  background: "var(--btn-primary, #00B286)",
                  borderColor: "var(--btn-primary, #00B286)",
                }}>
          {busy
            ? (lang === "es" ? "Liquidando…" : "Liquidating…")
            : (lang === "es" ? "Sí, liquidar" : "Yes, liquidate")}
        </button>
      </>
    }>
      <div className="micro" style={{ color: "#00B286", letterSpacing: 1, marginBottom: 6 }}>
        {lang === "es" ? "CONFIRMAR LIQUIDACIÓN" : "CONFIRM LIQUIDATION"}
      </div>
      <div className="caption" style={{ color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: 14 }}>
        {lang === "es"
          ? "Esta acción congelará el landed cost por línea y dejará el inventario listo para impactar al nodo destino con su costo real. La acción es auditable pero no totalmente reversible."
          : "This will freeze the landed cost per line and prepare inventory to land at the destination node with its real cost. Auditable but not fully reversible."}
      </div>
      <div style={{ padding: 14, borderRadius: 10, background: "rgba(0,178,134,0.06)", marginBottom: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span className="caption">FOB</span>
          <span className="tabular-nums" style={{ fontWeight: 600 }}>${fmt(summary.fobTotal)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span className="caption">{lang === "es" ? "Costos extra" : "Extra costs"}</span>
          <span className="tabular-nums" style={{ fontWeight: 600, color: "#F59E0B" }}>+${fmt(summary.extraUsd)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 8, borderTop: "1px solid rgba(0,178,134,0.20)" }}>
          <span style={{ fontWeight: 700, color: "var(--text-primary)" }}>Landed</span>
          <span className="tabular-nums" style={{ fontWeight: 700, color: "#00B286", fontSize: 16 }}>
            ${fmt(summary.landedTotal)}
          </span>
        </div>
      </div>
    </Modal>
  );
}
