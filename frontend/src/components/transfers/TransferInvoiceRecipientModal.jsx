// =====================================================================
// MWT.ONE · components/transfers/TransferInvoiceRecipientModal.jsx
// Agente responsable: [AG-03 FRONTEND]
//
// Modal que pregunta "¿Para quién es la factura?" antes de generar el
// documento de la transferencia. Dos audiencias:
//
//   · Muito Work Limitada (operador)  → precio interno  (unit_price_mwt)
//   · Cliente final                    → precio de venta (unit_price_client)
//
// La opción "Muito Work Limitada" se rotula como tal cuando el expediente
// está Operado por Muito Work Limitada (operated_by_mwt). Si no, esa rama
// usa la empresa operadora real (operating_company_label) pero igual mapea
// al precio interno (unit_price_mwt).
//
// Tokens MWT vía CSS variables (R1). Estados disabled/loading (R5/§4).
// =====================================================================
import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { INVOICE_AUDIENCE } from "../../lib/transferInvoiceHtml.js";

/**
 * @typedef {Object} TransferInvoiceRecipientModalProps
 * @property {boolean} open
 * @property {('es'|'en')} lang
 * @property {boolean} operatedByMwt        // operating_company.operated_by_mwt
 * @property {string}  operatingCompanyLabel
 * @property {string}  mwtOperatorName
 * @property {boolean} [loading]            // generando el documento
 * @property {(audience:('MWT'|'CLIENT'))=>void} onConfirm
 * @property {()=>void} onClose
 */

/** @param {TransferInvoiceRecipientModalProps} props */
export default function TransferInvoiceRecipientModal({
  open,
  lang = "es",
  operatedByMwt = false,
  operatingCompanyLabel = "",
  mwtOperatorName = "Muito Work Limitada",
  loading = false,
  onConfirm,
  onClose,
}) {
  const mwtLabel = operatedByMwt
    ? (mwtOperatorName || "Muito Work Limitada")
    : (operatingCompanyLabel || mwtOperatorName || "Muito Work Limitada");

  const options = [
    {
      audience: INVOICE_AUDIENCE.MWT,
      title: mwtLabel,
      sub: lang === "es"
        ? "Precio operador / interno (unit_price_mwt)"
        : "Operator / internal price (unit_price_mwt)",
      accent: "var(--brand-primary, #013A57)",
      tag: lang === "es" ? "INTERNO" : "INTERNAL",
    },
    {
      audience: INVOICE_AUDIENCE.CLIENT,
      title: lang === "es" ? "Cliente final" : "End client",
      sub: lang === "es"
        ? "Precio de venta al cliente (unit_price_client)"
        : "Client sale price (unit_price_client)",
      accent: "var(--info, #0369A1)",
      tag: lang === "es" ? "CLIENTE" : "CLIENT",
    },
  ];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={loading ? undefined : onClose}
          style={{
            position: "fixed", inset: 0, zIndex: 1100,
            background: "rgba(2,15,30,0.45)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 20,
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            onClick={(e) => e.stopPropagation()}
            className="card"
            style={{
              width: "100%", maxWidth: 520,
              background: "var(--surface-raised, #FFFFFF)",
              borderRadius: 14, overflow: "hidden",
              boxShadow: "0 24px 64px rgba(2,15,30,0.28)",
            }}
          >
            {/* Header */}
            <div style={{
              padding: "18px 22px",
              borderBottom: "1px solid var(--border-subtle, #E2E8F0)",
            }}>
              <div className="micro" style={{
                color: "var(--brand-accent, #0E8A6D)", letterSpacing: 1,
                fontWeight: 700, marginBottom: 4,
              }}>
                {lang === "es" ? "GENERAR FACTURA / REMISIÓN" : "GENERATE INVOICE / WAYBILL"}
              </div>
              <div className="heading-sm" style={{ margin: 0, color: "var(--text-primary, #0F172A)" }}>
                {lang === "es" ? "¿Para quién es la factura?" : "Who is this document for?"}
              </div>
              <div className="body-sm" style={{ color: "var(--text-secondary, #475569)", marginTop: 4 }}>
                {lang === "es"
                  ? "El precio de cada producto depende del destinatario elegido."
                  : "Each product price depends on the chosen recipient."}
              </div>
            </div>

            {/* Opciones */}
            <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
              {options.map((o) => (
                <button
                  key={o.audience}
                  type="button"
                  disabled={loading}
                  onClick={() => onConfirm && onConfirm(o.audience)}
                  style={{
                    textAlign: "left",
                    display: "flex", alignItems: "center", gap: 14,
                    padding: "14px 16px",
                    borderRadius: 10,
                    border: `1.5px solid var(--border-subtle, #E2E8F0)`,
                    borderLeft: `4px solid ${o.accent}`,
                    background: "var(--surface, #FFFFFF)",
                    cursor: loading ? "wait" : "pointer",
                    opacity: loading ? 0.6 : 1,
                    transition: "border-color .15s, background .15s",
                  }}
                  onMouseEnter={(e) => {
                    if (loading) return;
                    e.currentTarget.style.borderColor = o.accent;
                    e.currentTarget.style.background = "var(--surface-alt, #F1F5F9)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--border-subtle, #E2E8F0)";
                    e.currentTarget.style.borderLeftColor = o.accent;
                    e.currentTarget.style.background = "var(--surface, #FFFFFF)";
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{
                      fontWeight: 700, fontSize: 14,
                      color: "var(--text-primary, #0F172A)",
                    }}>
                      {o.title}
                    </div>
                    <div className="body-sm" style={{
                      color: "var(--text-secondary, #475569)", marginTop: 2,
                    }}>
                      {o.sub}
                    </div>
                  </div>
                  <span style={{
                    padding: "3px 9px", borderRadius: 999,
                    fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
                    background: "var(--surface-alt, #F1F5F9)",
                    color: o.accent,
                  }}>
                    {o.tag}
                  </span>
                </button>
              ))}
            </div>

            {/* Footer */}
            <div style={{
              padding: "12px 22px 18px",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <span className="caption" style={{ color: "var(--text-tertiary, #94A3B8)" }}>
                {loading
                  ? (lang === "es" ? "Generando documento…" : "Generating document…")
                  : (operatedByMwt
                      ? (lang === "es" ? "Expediente operado por Muito Work Limitada" : "File operated by Muito Work Limitada")
                      : (lang === "es" ? "Expediente operado por el cliente" : "File operated by the client"))}
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={loading}
                onClick={onClose}
              >
                {lang === "es" ? "Cancelar" : "Cancel"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
