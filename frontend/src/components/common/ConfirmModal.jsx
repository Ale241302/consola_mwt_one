// =====================================================================
// MWT.ONE · components/common/ConfirmModal.jsx
// Agente responsable: [AG-FRONTEND]
//
// Modal genérico de confirmación — reemplaza window.confirm con un
// diálogo MWT consistente. Centrado en pantalla vía createPortal por
// el llamador (para evitar overflow:hidden de ancestros).
//
// Uso:
//   {open && createPortal(
//     <ConfirmModal
//        eyebrow="ACCIÓN DESTRUCTIVA"
//        title="¿Eliminar esta talla?"
//        body={<>El registro <strong>EU 42</strong> se borrará de BD.</>}
//        actionLabel="Sí, eliminar"
//        actionColor="#DC2626"
//        cancelLabel="Cancelar"
//        busy={busy}
//        error={error}
//        onCancel={...}
//        onConfirm={...}
//     />, document.body)}
// =====================================================================
import React from "react";
import { motion } from "framer-motion";

export default function ConfirmModal({
  eyebrow,
  title,
  body,
  actionLabel = "Confirmar",
  actionColor = "#DC2626",
  cancelLabel = "Cancelar",
  busy = false,
  error = null,
  onCancel,
  onConfirm,
}) {
  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={busy ? undefined : onCancel}
        style={{
          position: "fixed", inset: 0, zIndex: 9000,
          background: "rgba(15,27,61,0.45)", backdropFilter: "blur(2px)",
        }}
      />
      {/* Tarjeta — anclada a 12vh para verse alto, no en el centro vertical */}
      <motion.div
        initial={{ opacity: 0, y: -12, x: "-50%" }}
        animate={{ opacity: 1, y: 0,   x: "-50%", transition: { duration: 0.18 } }}
        exit   ={{ opacity: 0, y: -12, x: "-50%", transition: { duration: 0.12 } }}
        role="dialog" aria-modal="true"
        style={{
          position: "fixed", top: "12vh", left: "50%",
          width: "min(440px, 92vw)", zIndex: 9001,
          background: "#FFFFFF", borderRadius: 14,
          boxShadow: "0 30px 60px -20px rgba(15,27,61,0.45)",
          fontFamily: "inherit",
        }}
      >
        <div style={{ padding: "22px 22px 12px" }}>
          {eyebrow && (
            <div style={{
              font: "600 11px/1 inherit", color: actionColor,
              letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8,
            }}>
              {eyebrow}
            </div>
          )}
          {title && (
            <div style={{ font: "700 17px/1.3 inherit", color: "#0F1B3D", marginBottom: 8 }}>
              {title}
            </div>
          )}
          {body && (
            <div style={{ font: "500 13.5px/1.5 inherit", color: "#3D4A6B" }}>
              {body}
            </div>
          )}
          {error && (
            <div style={{
              marginTop: 14, padding: "10px 12px", borderRadius: 8,
              background: "#FEE2E2", border: "1px solid #FCA5A5", color: "#991B1B",
              font: "500 12.5px/1.4 inherit",
            }}>
              {error}
            </div>
          )}
        </div>
        <div style={{
          padding: "14px 22px 18px",
          display: "flex", gap: 10, justifyContent: "flex-end",
        }}>
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button type="button" onClick={onConfirm} disabled={busy}
                  style={{
                    padding: "10px 16px", borderRadius: 9,
                    background: busy ? `${actionColor}88` : actionColor,
                    color: "#FFFFFF", border: "none",
                    cursor: busy ? "not-allowed" : "pointer",
                    font: "700 13.5px/1 inherit",
                    boxShadow: busy ? "none" : `0 4px 10px ${actionColor}40`,
                  }}>
            {busy ? "Procesando…" : actionLabel}
          </button>
        </div>
      </motion.div>
    </>
  );
}
