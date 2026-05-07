// =====================================================================
// MWT.ONE · components/expedientes/EditSapDrawer.jsx
// Sprint 2026-05-06 (Fase 2.C MVP) — Editor de metadata SAP-level.
//
// Drawer lateral que permite al ADMIN cambiar:
//   · Operador del SAP  (Muito Work Limitada vs cliente final)
//   · Forma de pago     (Crédito / Contado)
//   · Días de crédito
//
// NO cubre todavía:
//   · Cambio de cliente con split del expediente (Fase 2.D)
//   · Edición de productos del SAP / CSV bulk      (Fase 2.E)
//
// Endpoint: PATCH /api/expedientes/{exp_id}/sap/{sap_id}/
//
// Tokens: NAVY #0B1E3A · MINT #00B286 · CSS vars MWT.
// =====================================================================
import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { IconX, IconCheck, IconAlert } from "../../lib/icons.jsx";
import { getToken } from "../../lib/api.js";
import { useRole } from "../../context/RoleContext.jsx";
import {
  MWT_OPERATING_CLIENT_ID, MWT_OPERATOR_NAME,
} from "../../lib/operatingCompany.js";

const API_BASE = (import.meta && import.meta.env && import.meta.env.VITE_API_BASE) || "/api";

/**
 * @typedef {Object} EditSapDrawerProps
 * @property {boolean} open
 * @property {() => void} onClose
 * @property {(payload: object) => void} [onSaved]
 * @property {string} expedienteId
 * @property {string} sapId
 * @property {{operating_company_id?:string, forma_pago?:string, payment_days?:number, sap_value?:number}} [current]
 * @property {string} [clientName]
 * @property {string} [clientId]
 * @property {string} [lang]
 */

/**
 * Drawer "Editar SAP" — Fase 2.C MVP.
 * @param {EditSapDrawerProps} props
 */
export default function EditSapDrawer({
  open,
  onClose,
  onSaved,
  expedienteId,
  sapId,
  current = {},
  clientName,
  clientId,
  lang = "es",
}) {
  const { isAdmin } = useRole();

  const [operatingMode, setOperatingMode] = useState("mwt");
  const [formaPago, setFormaPago]         = useState("CREDITO");
  const [paymentDays, setPaymentDays]     = useState(0);
  const [submitting, setSubmitting]       = useState(false);
  const [apiError, setApiError]           = useState(null);

  // Reset al abrir
  useEffect(() => {
    if (!open) return;
    const opId = String(current.operating_company_id || "").toLowerCase();
    setOperatingMode(opId === MWT_OPERATING_CLIENT_ID.toLowerCase() ? "mwt" : "client");
    setFormaPago(current.forma_pago || "CREDITO");
    setPaymentDays(Number(current.payment_days || 0));
    setApiError(null);
    setSubmitting(false);
  }, [open, current.operating_company_id, current.forma_pago, current.payment_days]);

  if (!open) return null;
  if (!isAdmin) return null;  // hard-shield: solo ADMIN edita SAP-level

  const operatorEffectiveId = operatingMode === "mwt"
    ? MWT_OPERATING_CLIENT_ID
    : (clientId || null);

  const onSubmit = async () => {
    if (!expedienteId || !sapId) {
      setApiError(lang === "es" ? "Faltan IDs" : "Missing IDs");
      return;
    }
    if (operatingMode === "client" && !clientId) {
      setApiError(lang === "es"
        ? "El expediente no tiene cliente asignado — no se puede operar por cliente."
        : "Expediente has no client — cannot operate by client.");
      return;
    }
    setSubmitting(true);
    setApiError(null);
    try {
      const token = getToken();
      const resp = await fetch(
        `${API_BASE}/expedientes/${expedienteId}/sap/${encodeURIComponent(sapId)}/`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            operating_company_id: operatorEffectiveId,
            forma_pago:           formaPago,
            payment_days:         paymentDays,
          }),
        }
      );
      const text = await resp.text();
      let data = null;
      if (text) { try { data = JSON.parse(text); } catch { data = { raw: text }; } }
      if (!resp.ok) {
        throw new Error(data?.detail || data?.error || `HTTP ${resp.status}`);
      }
      onSaved?.(data);
      onClose?.();
    } catch (e) {
      setApiError(e.message || (lang === "es" ? "Error guardando" : "Save error"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        style={{
          position: "fixed", inset: 0, zIndex: 60,
          background: "rgba(11,30,58,0.45)",
          display: "flex", justifyContent: "flex-end",
        }}
        onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      >
        <motion.div
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{ type: "spring", stiffness: 320, damping: 36 }}
          style={{
            width: "min(560px, 100%)",
            background: "var(--surface-raised, #fff)",
            display: "flex", flexDirection: "column",
            boxShadow: "0 0 40px rgba(11,30,58,0.30)",
          }}
        >
          <header style={{
            padding: "18px 22px",
            borderBottom: "1px solid var(--border, #E1E6ED)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <div>
              <div className="caption" style={{ color: "var(--text-tertiary)" }}>
                {lang === "es" ? "Editar SAP" : "Edit SAP"}
              </div>
              <div className="heading-md mono" style={{ marginTop: 2 }}>
                {sapId}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="btn btn-ghost"
              aria-label="Cerrar"
              disabled={submitting}
            >
              <IconX size={16}/>
            </button>
          </header>

          <div style={{ flex: 1, overflowY: "auto", padding: "20px 22px" }}>
            {apiError && (
              <div style={{
                marginBottom: 16, padding: "10px 14px",
                background: "color-mix(in oklab, var(--danger, #DC2626) 8%, transparent)",
                border: "1px solid color-mix(in oklab, var(--danger, #DC2626) 32%, transparent)",
                borderRadius: 8,
                color: "var(--danger, #DC2626)", fontSize: 13,
              }}>
                <IconAlert size={12}/> {apiError}
              </div>
            )}

            {/* ── Step 0 · Operador ── */}
            <section style={{ marginBottom: 22 }}>
              <div className="heading-sm" style={{ marginBottom: 4 }}>
                {lang === "es" ? "Operador del SAP" : "SAP operator"}
              </div>
              <div className="caption" style={{ color: "var(--text-tertiary)", marginBottom: 12 }}>
                {lang === "es"
                  ? "Define a qué empresa se aplica el crédito de este SAP. Puede ser distinto del operador del expediente."
                  : "Defines which company gets the credit of this SAP. Can differ from the expediente operator."}
              </div>
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, 1fr)",
                gap: 10,
              }}>
                {[
                  {
                    id: "mwt",
                    title: MWT_OPERATOR_NAME,
                    sub: lang === "es" ? "El crédito impacta a MWT" : "Credit hits MWT",
                  },
                  {
                    id: "client",
                    title: clientName || (lang === "es" ? "Cliente del expediente" : "Expediente client"),
                    sub: lang === "es" ? "El crédito impacta al cliente final" : "Credit hits the client",
                    disabled: !clientId,
                  },
                ].map((opt) => {
                  const active = operatingMode === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={submitting || opt.disabled}
                      onClick={() => setOperatingMode(opt.id)}
                      style={{
                        padding: "12px 14px",
                        textAlign: "left",
                        border: active
                          ? "1.5px solid var(--brand-accent, #00B286)"
                          : "1px solid var(--border, #E1E6ED)",
                        borderRadius: 10,
                        background: active
                          ? "color-mix(in oklab, var(--brand-accent, #00B286) 6%, transparent)"
                          : "var(--surface-raised, #fff)",
                        cursor: (submitting || opt.disabled) ? "not-allowed" : "pointer",
                        opacity: opt.disabled ? 0.5 : 1,
                        display: "flex", flexDirection: "column", gap: 4,
                      }}
                    >
                      <span style={{ fontWeight: 700, fontSize: 14, color: "var(--text-primary)" }}>
                        {opt.title}
                      </span>
                      <span className="caption" style={{ color: "var(--text-tertiary)" }}>
                        {opt.sub}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* ── Step 3 · Forma de pago + días ── */}
            <section>
              <div className="heading-sm" style={{ marginBottom: 4 }}>
                {lang === "es" ? "Términos de pago" : "Payment terms"}
              </div>
              <div className="caption" style={{ color: "var(--text-tertiary)", marginBottom: 12 }}>
                {lang === "es"
                  ? "Si CONTADO, el SAP no consume crédito. Si CRÉDITO, el valor del SAP impacta al operador elegido."
                  : "If cash, the SAP does not consume credit. If credit, the SAP value impacts the chosen operator."}
              </div>
              <div style={{
                display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14,
              }}>
                <label className="sap-field">
                  <span className="sap-label">
                    {lang === "es" ? "Forma de pago" : "Payment method"}
                  </span>
                  <select
                    className="input"
                    disabled={submitting}
                    value={formaPago}
                    onChange={(e) => setFormaPago(e.target.value)}
                  >
                    <option value="CREDITO">{lang === "es" ? "Crédito" : "Credit"}</option>
                    <option value="CONTADO">{lang === "es" ? "Contado" : "Cash"}</option>
                  </select>
                </label>
                <label className="sap-field">
                  <span className="sap-label">
                    {lang === "es" ? "Días de crédito" : "Credit days"}
                  </span>
                  <input
                    type="number"
                    className="input tabular-nums"
                    min={0}
                    max={365}
                    disabled={submitting || formaPago === "CONTADO"}
                    value={paymentDays}
                    onChange={(e) => setPaymentDays(Number(e.target.value || 0))}
                  />
                </label>
              </div>
            </section>
          </div>

          <footer style={{
            padding: "14px 22px",
            borderTop: "1px solid var(--border, #E1E6ED)",
            display: "flex", justifyContent: "flex-end", gap: 10,
          }}>
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
              className="btn btn-accent"
              onClick={onSubmit}
              disabled={submitting}
              style={{ minWidth: 160, fontWeight: 700 }}
            >
              {submitting
                ? (lang === "es" ? "Guardando…" : "Saving…")
                : (<><IconCheck size={12}/> <span style={{ marginLeft: 6 }}>
                    {lang === "es" ? "Guardar cambios" : "Save changes"}
                  </span></>)}
            </button>
          </footer>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
