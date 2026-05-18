// =====================================================================
// MWT.ONE · components/finance/RejectPaymentDialog.jsx
// Sprint Registrar Pago (Fase 3) — Modal de rechazo.
//
// Se abre desde PaymentDetailDrawer al click "Rechazar". CEO selecciona
// motivo (enum 7) y, si OTRO, comenta. Si el pago estaba en
// CONFIRMADO_HUMANO, requiere doble confirmacion (la reversion va
// a sumar credito de vuelta al cliente).
//
// Reglas honradas:
//   R1 — Cero hex literales
//   R5 — tabular-nums (no aplica aquí — no hay numeros)
// =====================================================================
import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRejectionReasons } from "../../data/payments.js";
import {
  PAYMENT_REJECTION_REASON_LABELS,
  getEnumLabel,
} from "../../lib/i18n/payments.js";

/**
 * @param {{
 *   open: boolean,
 *   onClose: () => void,
 *   onConfirm: (payload: {rejection_reason, rejection_comment?, confirm_reversal?}) => Promise<void>,
 *   isCurrentStateReleased: boolean,   // si estaba en CONFIRMADO_HUMANO
 *   submitting?: boolean,
 *   lang?: 'es'|'en',
 * }} props
 */
export default function RejectPaymentDialog({
  open,
  onClose,
  onConfirm,
  isCurrentStateReleased = false,
  submitting = false,
  lang = "es",
}) {
  const { data: reasons } = useRejectionReasons();

  const [reason, setReason]                   = useState("");
  const [comment, setComment]                 = useState("");
  const [confirmReversal, setConfirmReversal] = useState(false);

  // Reset state cuando se cierra.
  useEffect(() => {
    if (!open) {
      setReason(""); setComment(""); setConfirmReversal(false);
    }
  }, [open]);

  const isOtro = reason === "OTRO";
  const isCommentRequired = isOtro;
  const isCommentValid = !isCommentRequired || comment.trim().length > 0;
  const isReversalValid = !isCurrentStateReleased || confirmReversal;
  const canSubmit = !!reason && isCommentValid && isReversalValid && !submitting;

  const handleConfirm = async () => {
    if (!canSubmit) return;
    try {
      await onConfirm({
        rejection_reason:    reason,
        rejection_comment:   comment.trim() || undefined,
        confirm_reversal:    isCurrentStateReleased ? true : undefined,
      });
    } catch {
      // Error queda en el padre; no cerramos para que el usuario reintente.
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={submitting ? undefined : onClose}
            style={{
              position: "fixed", inset: 0, zIndex: 1299,
              background: "rgba(11, 30, 58, 0.55)",
              display: "grid", placeItems: "center",
            }}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              transition={{ duration: 0.16 }}
              onClick={(e) => e.stopPropagation()}
              style={{
                width: 520, maxWidth: "calc(100vw - 32px)",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-lg)",
                boxShadow: "var(--shadow-lg)",
                padding: "20px 22px",
                display: "flex", flexDirection: "column", gap: 16,
              }}
            >
              {/* Header */}
              <div>
                <div className="micro" style={{ color: "var(--critical)",
                                                 marginBottom: 4,
                                                 letterSpacing: "0.06em" }}>
                  {lang === "es" ? "RECHAZAR PAGO" : "REJECT PAYMENT"}
                </div>
                <h2 style={{ margin: 0, font: "var(--heading-md)",
                             color: "var(--text-primary)" }}>
                  {isCurrentStateReleased
                    ? (lang === "es"
                        ? "Reversión de pago liberado"
                        : "Reverse released payment")
                    : (lang === "es"
                        ? "¿Por qué se rechaza?"
                        : "Why is this rejected?")}
                </h2>
                {isCurrentStateReleased && (
                  <div style={{ marginTop: 8, padding: "10px 12px",
                                background: "color-mix(in oklab, var(--critical) 10%, transparent)",
                                border: "1px solid color-mix(in oklab, var(--critical) 36%, transparent)",
                                borderRadius: "var(--radius-sm)",
                                color: "var(--critical)", fontSize: 13 }}>
                    {lang === "es"
                      ? "Este pago YA estaba en estado “Crédito liberado”. Rechazarlo va a sumar el crédito de vuelta al cliente. Es una operación reversible pero deja huella en el activity log."
                      : "This payment was already in “Credit released” state. Rejecting it will add the credit back to the client. The operation is reversible but logged."}
                  </div>
                )}
              </div>

              {/* Motivo */}
              <div>
                <label style={{ display: "block", marginBottom: 6,
                                font: "var(--body-sm)", fontWeight: 600,
                                color: "var(--text-primary)" }}>
                  {lang === "es" ? "Motivo" : "Reason"}
                  <span style={{ color: "var(--critical)" }}> *</span>
                </label>
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={submitting}
                  style={{
                    width: "100%", padding: "8px 10px",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-sm)",
                    font: "var(--body-sm)",
                    background: "var(--surface)",
                    color: "var(--text-primary)", outline: "none",
                  }}
                >
                  <option value="">— {lang === "es" ? "Selecciona" : "Select"} —</option>
                  {(reasons || []).map((r) => (
                    <option key={r.codigo} value={r.codigo}>
                      {getEnumLabel(PAYMENT_REJECTION_REASON_LABELS, r.codigo, lang)
                        || r.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Comment cuando OTRO */}
              {isOtro && (
                <div>
                  <label style={{ display: "block", marginBottom: 6,
                                  font: "var(--body-sm)", fontWeight: 600,
                                  color: "var(--text-primary)" }}>
                    {lang === "es" ? "Comentario" : "Comment"}
                    <span style={{ color: "var(--critical)" }}> *</span>
                  </label>
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={3}
                    disabled={submitting}
                    placeholder={lang === "es"
                      ? "Describe el motivo del rechazo..."
                      : "Describe the rejection reason..."}
                    style={{
                      width: "100%", padding: "8px 10px",
                      border: `1px solid ${isCommentValid ? "var(--border)" : "var(--critical)"}`,
                      borderRadius: "var(--radius-sm)",
                      font: "var(--body-sm)",
                      background: "var(--surface)",
                      color: "var(--text-primary)", outline: "none",
                      resize: "vertical", minHeight: 72,
                    }}
                  />
                </div>
              )}

              {/* Confirm reversal */}
              {isCurrentStateReleased && (
                <label style={{ display: "flex", alignItems: "flex-start", gap: 8,
                                cursor: submitting ? "not-allowed" : "pointer",
                                font: "var(--body-sm)",
                                color: "var(--text-primary)" }}>
                  <input
                    type="checkbox"
                    checked={confirmReversal}
                    onChange={(e) => setConfirmReversal(e.target.checked)}
                    disabled={submitting}
                    style={{ marginTop: 3 }}
                  />
                  <span>
                    {lang === "es"
                      ? "Confirmo la reversión del crédito ya liberado."
                      : "I confirm the reversal of already released credit."}
                  </span>
                </label>
              )}

              {/* Acciones */}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8,
                            paddingTop: 8,
                            borderTop: "1px solid var(--divider)" }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={onClose}
                  disabled={submitting}
                >
                  {lang === "es" ? "Cancelar" : "Cancel"}
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={!canSubmit}
                  style={{
                    padding: "8px 16px",
                    background: canSubmit ? "var(--critical)" : "var(--bg-alt)",
                    color: canSubmit ? "var(--text-inverse)" : "var(--text-tertiary)",
                    border: 0, borderRadius: "var(--radius-sm)",
                    font: "var(--body-sm)", fontWeight: 600,
                    cursor: canSubmit ? "pointer" : "not-allowed",
                  }}
                >
                  {submitting
                    ? (lang === "es" ? "Rechazando..." : "Rejecting...")
                    : (lang === "es" ? "Rechazar pago" : "Reject payment")}
                </button>
              </div>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
