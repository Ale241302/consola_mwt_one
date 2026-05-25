// =====================================================================
// MWT.ONE · components/finance/RegisterPaymentWizard.jsx
// Sprint Registrar Pago (Fase 2) — Wizard orquestador.
//
// Drawer lateral 800px que ensambla los 4 pasos del flujo:
//   Paso 1  Direction + payment_target_type + Counterparty
//   Paso 2  OpenDebtsTable (obligaciones a saldar)
//   Paso 3  Detalle del pago (metodo, monto, moneda, fecha, evidencia)
//   Paso 4  CreditEffectPreview (dry-run) + boton Registrar pago
//
// Decisiones (del Brief Fase 2 confirmado):
//   - Drawer 800px (no fullscreen).
//   - useState local + un solo objeto formData. Sin Redux, sin RHF.
//   - Validacion por paso antes de avanzar.
//   - sessionStorage borrador con clave por timestamp de apertura
//     (evita pisarse entre tabs simultaneas).
//   - usePaymentSubmit con event_id auto-generado (idempotencia).
//
// Reglas honradas:
//   R1 — Cero hex literales
//   R2 — JSDoc en todas las props
//   R3 — Wizard solo accesible si !isClient (gating en padre, /financiero)
//   R5 — tabular-nums en montos y referencias
// =====================================================================
import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import CounterpartyPicker     from "./CounterpartyPicker.jsx";
import OpenDebtsTable         from "./OpenDebtsTable.jsx";
import CreditEffectPreview    from "./CreditEffectPreview.jsx";
import { usePaymentSubmit }   from "../../data/payments.js";
import { financePaymentsApi } from "../../lib/api.js";
import {
  PAYMENT_APPLICABLE_TYPE_LABELS,
  COUNTERPARTY_TYPE_LABELS,
  PAYMENT_DIRECTION_LABELS,
  PAYMENT_ERROR_LABELS,
  getEnumLabel,
} from "../../lib/i18n/payments.js";

const DRAFT_STORAGE_KEY = "mwt.registerPaymentWizard.draft";

// MIME types aceptados (espejo de backend enums.EVIDENCE_ALLOWED_MIMES).
const EVIDENCE_ALLOWED_MIMES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
];
const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;  // 10 MB

const STEPS = [
  { key: "step1", label_es: "Contraparte",   label_en: "Counterparty" },
  { key: "step2", label_es: "Obligaciones",  label_en: "Debts" },
  { key: "step3", label_es: "Detalle pago",  label_en: "Payment detail" },
  { key: "step4", label_es: "Confirmación",  label_en: "Confirmation" },
];

/**
 * @param {{
 *   open: boolean,
 *   onClose: () => void,
 *   onSuccess?: (payment: object) => void,
 *   lang?: 'es'|'en',
 *   preselectedScope?: { type: 'NODO'|'TRANSFERENCIA'|'OC'|'EXPEDIENTE', id: string, label: string },
 *   preselectedCostLines?: Array<{ id: string, label: string, amount_usd: number, saldo_usd: number, currency: string, transferencia_codigo?: string }>,
 * }} props
 */
export default function RegisterPaymentWizard({
  open,
  onClose,
  onSuccess,
  lang = "es",
  preselectedScope = null,
  preselectedCostLines = null,
}) {
  // ── Preload de cost-lines ──────────────────────────────────────
  // Cuando el padre pasa preselectedCostLines, el wizard arranca
  // en el paso 1 con direction=OUT y counterparty tipo PROVEEDOR.
  // Las cost_lines se tratan como obligation_ids en el paso 2.
  const hasPreload = Array.isArray(preselectedCostLines) && preselectedCostLines.length > 0;
  const preloadSubtotal = hasPreload
    ? preselectedCostLines.reduce((s, cl) => s + Number(cl.saldo_usd || cl.amount_usd || 0), 0)
    : 0;

  // ── State del wizard ───────────────────────────────────────────
  // Si hay preload comenzamos en el paso 1 (el usuario aún debe elegir
  // contraparte), pero con direction=OUT y payment_target_type=COST
  // pre-rellenados para reducir clicks.
  const [step, setStep] = useState(0);
  // formData unico para todo el wizard. Cada Paso lee y escribe sus
  // campos. Mantenemos shape plano (sin nested) para facilitar la
  // serializacion a sessionStorage y al backend.
  const [formData, setFormData] = useState(() => {
    const empty = _emptyFormData();
    if (Array.isArray(preselectedCostLines) && preselectedCostLines.length > 0) {
      const sub = preselectedCostLines.reduce((s, cl) => s + Number(cl.saldo_usd || cl.amount_usd || 0), 0);
      return {
        ...empty,
        direction:           "OUT",
        payment_target_type: "COST",
        obligation_ids:      preselectedCostLines.map((cl) => cl.id),
        subtotal:            sub,
        monto:               sub,
        _preloaded_cost_lines: preselectedCostLines,
      };
    }
    return empty;
  });

  // ── Submit hook ────────────────────────────────────────────────
  const { submit, submitting, error: submitError, lastResult, reset: resetSubmit } = usePaymentSubmit();

  // ── sessionStorage draft (clave por timestamp de apertura) ─────
  const [sessionKey, setSessionKey] = useState(null);
  useEffect(() => {
    if (!open) return;
    // Nueva apertura → key unica para evitar colision con otras tabs.
    const k = `${DRAFT_STORAGE_KEY}.${Date.now()}`;
    setSessionKey(k);
    // Cargar el draft mas reciente si existe.
    try {
      const lastKey = sessionStorage.getItem(`${DRAFT_STORAGE_KEY}.last`);
      if (lastKey) {
        const raw = sessionStorage.getItem(lastKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          // Evidencia no se persiste en sessionStorage (es File, no serializable).
          // Si habia evidencia, la perdemos al recuperar.
          setFormData({ ..._emptyFormData(), ...parsed, evidencia: null });
        }
      }
    } catch { /* ignore */ }
  }, [open]);

  // Persistir formData cada vez que cambia.
  useEffect(() => {
    if (!sessionKey) return;
    try {
      const toSave = { ...formData, evidencia: null };  // no serializable
      sessionStorage.setItem(sessionKey, JSON.stringify(toSave));
      sessionStorage.setItem(`${DRAFT_STORAGE_KEY}.last`, sessionKey);
    } catch { /* ignore */ }
  }, [formData, sessionKey]);

  // ── Validaciones por paso ──────────────────────────────────────
  const stepErrors = useMemo(() => _validateAllSteps(formData, lang), [formData, lang]);
  const canAdvance = !stepErrors[`step${step + 1}`]?.length;

  // ── Handlers ───────────────────────────────────────────────────
  const update = (patch) => setFormData((prev) => ({ ...prev, ...patch }));

  const reset = () => {
    if (hasPreload) {
      setFormData({
        ..._emptyFormData(),
        direction:           "OUT",
        payment_target_type: "COST",
        obligation_ids:      preselectedCostLines.map((cl) => cl.id),
        subtotal:            preloadSubtotal,
        monto:               preloadSubtotal,
        _preloaded_cost_lines: preselectedCostLines,
      });
    } else {
      setFormData(_emptyFormData());
    }
    setStep(0);
    resetSubmit();
  };

  const handleClose = () => {
    // Si hay datos no triviales, pedimos confirmacion.
    const hasData = !!(formData.counterparty_id
                    || formData.obligation_ids?.length
                    || formData.monto
                    || formData.evidencia);
    if (hasData && !submitting) {
      const ok = window.confirm(lang === "es"
        ? "¿Cerrar el wizard? Se conservará el borrador para reabrir."
        : "Close the wizard? Draft will be kept for re-opening.");
      if (!ok) return;
    }
    onClose?.();
  };

  const handleAdvance = () => {
    if (!canAdvance) return;
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
    }
  };

  const handleBack = () => {
    if (step > 0) setStep((s) => s - 1);
  };

  const handleSubmit = async () => {
    if (submitting) return;
    try {
      const payload = _buildSubmitPayload(formData);
      const resp = await submit(payload);
      // Limpiar draft solo si tuvo exito.
      try {
        if (sessionKey) sessionStorage.removeItem(sessionKey);
        sessionStorage.removeItem(`${DRAFT_STORAGE_KEY}.last`);
      } catch { /* ignore */ }
      reset();
      onSuccess?.(resp);
      onClose?.();
    } catch (err) {
      // El error queda en submitError (del hook) y se muestra abajo.
      // eslint-disable-next-line no-console
      console.error("[RegisterPaymentWizard] submit fallo:", err);
    }
  };

  // ── Payload para dry-run del Paso 4 ────────────────────────────
  const dryRunPayload = useMemo(() => {
    if (step !== 3) return null;
    if (!formData.counterparty_id || !formData.obligation_ids?.length) return null;
    // Reusamos el shape del submit pero sin evidencia (no se manda en dry-run).
    return _buildDryRunPayload(formData);
  }, [step, formData]);

  // ── Render ─────────────────────────────────────────────────────
  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={handleClose}
            style={{
              position: "fixed", inset: 0, zIndex: 1199,
              background: "rgba(11, 30, 58, 0.45)",
            }}
          />
          {/* Drawer 800px */}
          <motion.aside
            initial={{ x: 800 }} animate={{ x: 0 }} exit={{ x: 800 }}
            transition={{ type: "spring", damping: 30, stiffness: 280 }}
            style={{
              position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 1200,
              width: 800, maxWidth: "100vw",
              background: "var(--surface)",
              boxShadow: "var(--shadow-lg)",
              display: "flex", flexDirection: "column",
            }}
          >
            {/* Header */}
            <header style={{
              padding: "16px 20px",
              borderBottom: "1px solid var(--divider)",
              display: "flex", alignItems: "center", justifyContent: "space-between",
              flexShrink: 0,
            }}>
              <div>
                <div className="micro" style={{ color: "var(--text-tertiary)",
                                                 marginBottom: 2 }}>
                  {lang === "es" ? "FINANCIERO" : "FINANCE"}
                  {preselectedScope && (
                    <span style={{ marginLeft: 8, color: "var(--brand-primary)",
                                   fontWeight: 700 }}>
                      · {preselectedScope.type}: {preselectedScope.label}
                    </span>
                  )}
                </div>
                <div style={{ font: "var(--heading-md)", color: "var(--text-primary)" }}>
                  {lang === "es" ? "Registrar pago" : "Register payment"}
                  {hasPreload && (
                    <span style={{ marginLeft: 8, fontSize: 13, fontWeight: 500,
                                   color: "var(--text-secondary)" }}>
                      — {preselectedCostLines.length} {lang === "es" ? "costo(s) preseleccionado(s)" : "cost(s) preselected"}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={handleClose}
                disabled={submitting}
                aria-label={lang === "es" ? "Cerrar" : "Close"}
                style={{
                  width: 32, height: 32,
                  border: 0, background: "transparent",
                  fontSize: 22, color: "var(--text-tertiary)",
                  cursor: submitting ? "not-allowed" : "pointer",
                  borderRadius: "var(--radius-sm)",
                }}
              >×</button>
            </header>

            {/* Stepper */}
            <div style={{
              padding: "12px 20px",
              borderBottom: "1px solid var(--divider)",
              display: "flex", alignItems: "center", gap: 8,
              flexShrink: 0,
            }}>
              {STEPS.map((s, i) => {
                const isActive = i === step;
                const isDone   = i < step;
                return (
                  <React.Fragment key={s.key}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{
                        width: 22, height: 22, borderRadius: "50%",
                        display: "inline-grid", placeItems: "center",
                        fontSize: 11, fontWeight: 700,
                        background: isActive ? "var(--brand-primary)"
                                  : isDone   ? "var(--success)"
                                  : "var(--bg-alt)",
                        color:      isActive || isDone ? "var(--text-on-navy)"
                                  : "var(--text-tertiary)",
                      }}>
                        {isDone ? "✓" : i + 1}
                      </span>
                      <span style={{
                        font: "var(--body-sm)",
                        fontWeight: isActive ? 700 : 500,
                        color: isActive ? "var(--brand-primary)"
                             : isDone   ? "var(--text-secondary)"
                             : "var(--text-tertiary)",
                      }}>
                        {lang === "es" ? s.label_es : s.label_en}
                      </span>
                    </div>
                    {i < STEPS.length - 1 && (
                      <div style={{
                        flex: 1, height: 1,
                        background: i < step ? "var(--success)" : "var(--border)",
                      }}/>
                    )}
                  </React.Fragment>
                );
              })}
            </div>

            {/* Body — paso activo */}
            <div style={{
              flex: 1, overflowY: "auto",
              padding: "20px",
              background: "var(--bg)",
            }}>
              {step === 0 && (
                <Step1 formData={formData} update={update} lang={lang} hasPreload={hasPreload}/>
              )}
              {step === 1 && (
                hasPreload
                  ? <Step2Preloaded formData={formData} lang={lang}/>
                  : <Step2 formData={formData} update={update} lang={lang}/>
              )}
              {step === 2 && (
                <Step3 formData={formData} update={update} lang={lang}/>
              )}
              {step === 3 && (
                <Step4 formData={formData}
                       dryRunPayload={dryRunPayload}
                       submitError={submitError}
                       lang={lang}/>
              )}
            </div>

            {/* Footer — nav + submit */}
            <footer style={{
              padding: "14px 20px",
              borderTop: "1px solid var(--divider)",
              display: "flex", alignItems: "center", justifyContent: "space-between",
              gap: 12, flexShrink: 0,
              background: "var(--surface)",
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {stepErrors[`step${step + 1}`]?.length > 0 && (
                  <div style={{ color: "var(--critical)", fontSize: 12 }}>
                    {stepErrors[`step${step + 1}`][0]}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={step === 0 ? handleClose : handleBack}
                  disabled={submitting}
                >
                  {step === 0
                    ? (lang === "es" ? "Cancelar" : "Cancel")
                    : (lang === "es" ? "Atrás"    : "Back")}
                </button>
                {step < STEPS.length - 1 ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleAdvance}
                    disabled={!canAdvance}
                  >
                    {lang === "es" ? "Siguiente" : "Next"} →
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleSubmit}
                    disabled={submitting || !canAdvance}
                    style={{ minWidth: 160 }}
                  >
                    {submitting
                      ? (lang === "es" ? "Registrando..." : "Registering...")
                      : (lang === "es" ? "Registrar pago" : "Register payment")}
                  </button>
                )}
              </div>
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}


// ════════════════════════════════════════════════════════════════════
// Paso 1 — Direction + Target type + Counterparty
// ════════════════════════════════════════════════════════════════════
function Step1({ formData, update, lang, hasPreload = false }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <_FieldGroup
        label={lang === "es" ? "Dirección del pago" : "Payment direction"}
        hint={lang === "es"
          ? "¿MWT está cobrando o pagando?"
          : "Is MWT collecting or paying?"}
      >
        {hasPreload ? (
          /* Preloaded: direction bloqueada en OUT */
          <div style={{
            padding: "10px 14px", borderRadius: "var(--radius-md)",
            border: "2px solid var(--brand-primary)",
            background: "color-mix(in oklab, var(--brand-primary) 6%, transparent)",
            display: "inline-flex", alignItems: "center", gap: 8,
            fontSize: 13, fontWeight: 700, color: "var(--brand-primary)",
          }}>
            {getEnumLabel(PAYMENT_DIRECTION_LABELS, "OUT", lang)}
            <span style={{ fontSize: 11, fontWeight: 400,
                           color: "var(--text-secondary)" }}>
              ({lang === "es" ? "preseleccionada" : "preselected"})
            </span>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 10 }}>
            {["IN", "OUT"].map((d) => (
              <_RadioCard
                key={d}
                checked={formData.direction === d}
                onClick={() => update({
                  direction: d,
                  // Reset counterparty al cambiar direction
                  counterparty_id: null,
                  counterparty_type: null,
                  counterparty_label: null,
                  // Reset obligation_ids
                  obligation_ids: [],
                  subtotal: 0,
                })}
              >
                <div style={{ fontWeight: 700 }}>
                  {getEnumLabel(PAYMENT_DIRECTION_LABELS, d, lang)}
                </div>
              </_RadioCard>
            ))}
          </div>
        )}
      </_FieldGroup>

      <_FieldGroup
        label={lang === "es" ? "Tipo de pago (payment target)" : "Payment target"}
        hint={lang === "es"
          ? "Producto (mercancía) o costo (DUA, flete, seguro, etc)"
          : "Product (merchandise) or cost (DUA, freight, insurance, etc)"}
      >
        {hasPreload ? (
          /* Preloaded: tipo bloqueado en COSTO */
          <div style={{
            padding: "10px 14px", borderRadius: "var(--radius-md)",
            border: "2px solid var(--brand-primary)",
            background: "color-mix(in oklab, var(--brand-primary) 6%, transparent)",
            display: "inline-flex", alignItems: "center", gap: 8,
          }}>
            <div>
              <div style={{ fontWeight: 700, color: "var(--brand-primary)" }}>
                {lang === "es" ? "Costo" : "Cost"}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>
                {lang === "es" ? "preseleccionado" : "preselected"}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 10 }}>
            {["PRODUCT", "COST"].map((t) => (
              <_RadioCard
                key={t}
                checked={formData.payment_target_type === t}
                onClick={() => update({
                  payment_target_type: t,
                  obligation_ids: [],
                  subtotal: 0,
                })}
              >
                <div style={{ fontWeight: 700 }}>
                  {t === "PRODUCT"
                    ? (lang === "es" ? "Producto" : "Product")
                    : (lang === "es" ? "Costo"    : "Cost")}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-secondary)",
                              marginTop: 2 }}>
                  {t === "PRODUCT"
                    ? (lang === "es" ? "Factura / proforma / producto" : "Invoice / proforma / product")
                    : (lang === "es" ? "DUA / flete / seguro / etc"   : "DUA / freight / insurance / etc")}
                </div>
              </_RadioCard>
            ))}
          </div>
        )}
      </_FieldGroup>

      <_FieldGroup
        label={lang === "es" ? "Contraparte" : "Counterparty"}
        hint={lang === "es"
          ? "Se filtran las contrapartes válidas según la dirección elegida."
          : "Valid counterparties are filtered by direction."}
      >
        <CounterpartyPicker
          direction={formData.direction}
          disabled={!formData.direction}
          value={formData.counterparty_id ? {
            id:                 formData.counterparty_id,
            counterparty_type:  formData.counterparty_type,
            label:              formData.counterparty_label,
            subtitle:           formData.counterparty_subtitle,
            country_iso2:       formData.counterparty_country,
            tax_id:             formData.counterparty_tax_id,
            _raw:               {},
          } : null}
          onChange={(v) => {
            if (!v) {
              update({
                counterparty_id: null, counterparty_type: null,
                counterparty_label: null, counterparty_subtitle: null,
                counterparty_country: null, counterparty_tax_id: null,
                obligation_ids: [], subtotal: 0,
              });
              return;
            }
            update({
              counterparty_id:       v.id,
              counterparty_type:     v.counterparty_type,
              counterparty_label:    v.label,
              counterparty_subtitle: v.subtitle,
              counterparty_country:  v.country_iso2,
              counterparty_tax_id:   v.tax_id,
              obligation_ids:        [],
              subtotal:              0,
            });
          }}
          lang={lang}
        />
      </_FieldGroup>
    </div>
  );
}


// ════════════════════════════════════════════════════════════════════
// Paso 2 — OpenDebtsTable
// ════════════════════════════════════════════════════════════════════
function Step2({ formData, update, lang }) {
  return (
    <div>
      <div style={{ marginBottom: 14, color: "var(--text-secondary)",
                    fontSize: 13 }}>
        {lang === "es"
          ? "Tilda las obligaciones que este pago va a saldar. El subtotal calculado abajo se traerá al Paso 3."
          : "Check the debts this payment will settle. The subtotal will be carried to Step 3."}
      </div>
      <OpenDebtsTable
        payment_target_type={formData.payment_target_type}
        counterparty_type={formData.counterparty_type}
        counterparty_id={formData.counterparty_id}
        value={formData.obligation_ids}
        onChange={(ids, subtotal) => update({
          obligation_ids: ids,
          subtotal,
          // Pre-cargar monto del Paso 3 con el subtotal (editable).
          monto: subtotal,
        })}
        lang={lang}
      />
    </div>
  );
}


// ════════════════════════════════════════════════════════════════════
// Paso 2 (preloaded) — Cost-lines fijas, sin tabla genérica
// ════════════════════════════════════════════════════════════════════
function Step2Preloaded({ formData, lang }) {
  const lines = formData._preloaded_cost_lines || [];
  const total = lines.reduce((s, cl) => s + Number(cl.saldo_usd || cl.amount_usd || 0), 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ color: "var(--text-secondary)", fontSize: 13, marginBottom: 4 }}>
        {lang === "es"
          ? "Costos preseleccionados que este pago va a saldar:"
          : "Preselected costs this payment will settle:"}
      </div>
      <div className="card card-pad"
           style={{ border: "1px solid var(--border-subtle)" }}>
        <table className="table" style={{ width: "100%" }}>
          <thead>
            <tr>
              {lines[0]?.transferencia_codigo !== undefined && (
                <th style={{ fontSize: 11 }}>
                  {lang === "es" ? "Transferencia" : "Transfer"}
                </th>
              )}
              <th style={{ fontSize: 11 }}>{lang === "es" ? "Detalle" : "Detail"}</th>
              <th style={{ textAlign: "right", fontSize: 11 }}>
                {lang === "es" ? "Saldo USD" : "Balance USD"}
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((cl) => (
              <tr key={cl.id}>
                {cl.transferencia_codigo !== undefined && (
                  <td className="mono-sm" style={{ fontWeight: 600,
                                                    color: "var(--brand-accent)" }}>
                    {cl.transferencia_codigo || "\u2014"}
                  </td>
                )}
                <td>{cl.label || "\u2014"}</td>
                <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 700,
                                                       color: "var(--brand-accent)" }}>
                  ${Number(cl.saldo_usd ?? cl.amount_usd ?? 0).toLocaleString("en-US",
                    { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{
          marginTop: 10, paddingTop: 10,
          borderTop: "1px dashed var(--divider)",
          display: "flex", justifyContent: "flex-end", alignItems: "center",
          gap: 10,
        }}>
          <span style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500 }}>
            TOTAL
          </span>
          <span className="tabular-nums" style={{ fontWeight: 700, fontSize: 15,
                                                   color: "var(--brand-accent)" }}>
            ${total.toLocaleString("en-US",
              { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
          </span>
        </div>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
        {lang === "es"
          ? "El monto sugerido en el Paso 3 es la suma de los saldos arriba. Puedes editarlo."
          : "The suggested amount in Step 3 is the sum of the balances above. You can edit it."}
      </div>
    </div>
  );
}


// ════════════════════════════════════════════════════════════════════
// Paso 3 — Detalle del pago
// ════════════════════════════════════════════════════════════════════
function Step3({ formData, update, lang }) {
  // Catalogos
  const [metodos, setMetodos] = useState([]);
  const [tipos, setTipos]     = useState([]);
  useEffect(() => {
    let alive = true;
    financePaymentsApi.selectMetodos().then((r) => {
      if (alive) setMetodos(Array.isArray(r) ? r : (r?.results || []));
    });
    financePaymentsApi.selectTipos().then((r) => {
      if (alive) setTipos(Array.isArray(r) ? r : (r?.results || []));
    });
    return () => { alive = false; };
  }, []);

  // Upload evidencia handler
  const handleFile = (file) => {
    if (!file) { update({ evidencia: null }); return; }
    if (!EVIDENCE_ALLOWED_MIMES.includes(file.type)) {
      window.alert(lang === "es"
        ? "Tipo de archivo no permitido. PDF / PNG / JPG / WebP."
        : "File type not allowed. PDF / PNG / JPG / WebP.");
      return;
    }
    if (file.size > EVIDENCE_MAX_BYTES) {
      window.alert(lang === "es"
        ? "Archivo demasiado grande. Máx 10 MB."
        : "File too large. Max 10 MB.");
      return;
    }
    update({ evidencia: file });
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      <_FieldGroup label={lang === "es" ? "Método" : "Method"} required>
        <select
          className="select"
          value={formData.metodo || ""}
          onChange={(e) => update({ metodo: e.target.value })}
          style={_inputStyle()}
        >
          <option value="">— {lang === "es" ? "Selecciona" : "Select"} —</option>
          {metodos.map((m) => (
            <option key={m.codigo} value={m.codigo}>{m.label}</option>
          ))}
        </select>
      </_FieldGroup>

      <_FieldGroup label={lang === "es" ? "Tipo" : "Type"} required>
        <select
          className="select"
          value={formData.tipo_pago || ""}
          onChange={(e) => update({ tipo_pago: e.target.value })}
          style={_inputStyle()}
        >
          <option value="">— {lang === "es" ? "Selecciona" : "Select"} —</option>
          {tipos.map((t) => (
            <option key={t.codigo} value={t.codigo}>{t.label}</option>
          ))}
        </select>
      </_FieldGroup>

      <_FieldGroup label={lang === "es" ? "Monto" : "Amount"} required>
        <input
          type="number"
          step="0.01"
          min="0"
          value={formData.monto ?? ""}
          onChange={(e) => update({ monto: Number(e.target.value) })}
          className="tabular-nums"
          style={_inputStyle()}
          placeholder={formData.subtotal > 0
            ? `${lang === "es" ? "Subtotal" : "Subtotal"} = ${formData.subtotal.toFixed(2)}`
            : "0.00"}
        />
      </_FieldGroup>

      <_FieldGroup label={lang === "es" ? "Moneda" : "Currency"} required>
        <select
          className="select"
          value={formData.moneda || "USD"}
          onChange={(e) => update({ moneda: e.target.value })}
          style={_inputStyle()}
        >
          {["USD","COP","BRL","CRC","MXN","EUR","PEN","ARS","CLP"].map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </_FieldGroup>

      <_FieldGroup label={lang === "es" ? "Fecha" : "Date"} required>
        <input
          type="date"
          value={formData.fecha || ""}
          onChange={(e) => update({ fecha: e.target.value })}
          style={_inputStyle()}
        />
      </_FieldGroup>

      <_FieldGroup label={lang === "es" ? "Referencia bancaria" : "Bank reference"}>
        <input
          type="text"
          value={formData.referencia || ""}
          onChange={(e) => update({ referencia: e.target.value })}
          placeholder={lang === "es"
            ? "Nº de transferencia, SWIFT, etc"
            : "Transfer no, SWIFT, etc"}
          style={_inputStyle()}
        />
      </_FieldGroup>

      {formData.moneda && formData.moneda !== "USD" && (
        <_FieldGroup
          label={lang === "es" ? "Tasa de cambio a USD" : "FX rate to USD"}
          required
          hint={lang === "es"
            ? `Obligatorio si la moneda no es USD (ahora: ${formData.moneda}).`
            : `Required if currency is not USD (now: ${formData.moneda}).`}
        >
          <input
            type="number"
            step="0.000001"
            min="0"
            value={formData.tasa_cambio_a_usd ?? ""}
            onChange={(e) => update({ tasa_cambio_a_usd: Number(e.target.value) })}
            className="tabular-nums"
            style={_inputStyle()}
          />
        </_FieldGroup>
      )}

      <_FieldGroup label={lang === "es" ? "Notas" : "Notes"} fullWidth>
        <textarea
          value={formData.notas || ""}
          onChange={(e) => update({ notas: e.target.value })}
          rows={2}
          style={{ ..._inputStyle(), resize: "vertical", minHeight: 56 }}
        />
      </_FieldGroup>

      <_FieldGroup
        label={lang === "es" ? "Comprobante (PDF/imagen)" : "Proof (PDF/image)"}
        required
        fullWidth
        hint={lang === "es" ? "Máx 10 MB. PDF / PNG / JPG / WebP." : "Max 10 MB."}
      >
        <input
          type="file"
          accept={EVIDENCE_ALLOWED_MIMES.join(",")}
          onChange={(e) => handleFile(e.target.files?.[0])}
          style={{ ..._inputStyle(), padding: 6 }}
        />
        {formData.evidencia && (
          <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-secondary)" }}>
            📎 {formData.evidencia.name} · {(formData.evidencia.size / 1024).toFixed(1)} KB
          </div>
        )}
      </_FieldGroup>
    </div>
  );
}


// ════════════════════════════════════════════════════════════════════
// Paso 4 — Confirmación
// ════════════════════════════════════════════════════════════════════
function Step4({ formData, dryRunPayload, submitError, lang }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Resumen */}
      <div className="card card-pad">
        <div className="micro" style={{ color: "var(--text-tertiary)",
                                         marginBottom: 8 }}>
          {lang === "es" ? "RESUMEN" : "SUMMARY"}
        </div>
        <_SummaryRow label={lang === "es" ? "Dirección" : "Direction"}
                     value={getEnumLabel(PAYMENT_DIRECTION_LABELS, formData.direction, lang)}/>
        <_SummaryRow label={lang === "es" ? "Tipo" : "Target type"}
                     value={formData.payment_target_type === "PRODUCT"
                       ? (lang === "es" ? "Producto" : "Product")
                       : (lang === "es" ? "Costo" : "Cost")}/>
        <_SummaryRow label={lang === "es" ? "Contraparte" : "Counterparty"}
                     value={<>
                       <span style={{ fontSize: 10, fontWeight: 700,
                                       textTransform: "uppercase",
                                       letterSpacing: "0.04em",
                                       padding: "2px 6px", borderRadius: 4,
                                       background: "var(--bg-alt)",
                                       color: "var(--brand-primary)",
                                       marginRight: 6 }}>
                         {getEnumLabel(COUNTERPARTY_TYPE_LABELS,
                                       formData.counterparty_type, lang)}
                       </span>
                       <span style={{ fontWeight: 600 }}>{formData.counterparty_label}</span>
                     </>}/>
        <_SummaryRow label={lang === "es" ? "Obligaciones" : "Debts"}
                     value={`${formData.obligation_ids?.length || 0} ${lang === "es" ? "líneas" : "lines"}`}/>
        <_SummaryRow label={lang === "es" ? "Monto" : "Amount"}
                     value={
                       <span className="tabular-nums" style={{ fontWeight: 700 }}>
                         {formData.moneda || "USD"}{" "}
                         {Number(formData.monto || 0).toLocaleString("en-US", {
                           minimumFractionDigits: 2, maximumFractionDigits: 2,
                         })}
                       </span>
                     }/>
        <_SummaryRow label={lang === "es" ? "Método / Fecha" : "Method / Date"}
                     value={`${formData.metodo || "—"} · ${formData.fecha || "—"}`}/>
        <_SummaryRow label={lang === "es" ? "Comprobante" : "Proof"}
                     value={formData.evidencia
                       ? `📎 ${formData.evidencia.name}`
                       : (lang === "es" ? "Sin adjuntar" : "Missing")}/>
      </div>

      {/* CreditEffectPreview (dry-run) */}
      <div>
        <div className="micro" style={{ color: "var(--text-tertiary)",
                                         marginBottom: 6 }}>
          {lang === "es" ? "EFECTO SOBRE CRÉDITO" : "CREDIT EFFECT"}
        </div>
        <CreditEffectPreview payload={dryRunPayload} lang={lang}/>
      </div>

      {/* Submit error si lo hubo */}
      {submitError && (
        <div style={{
          padding: "10px 14px",
          background: "color-mix(in oklab, var(--critical) 8%, transparent)",
          border: "1px solid color-mix(in oklab, var(--critical) 36%, transparent)",
          borderRadius: "var(--radius-md)",
          color: "var(--critical)",
          fontSize: 13,
        }}>
          {submitError}
        </div>
      )}
    </div>
  );
}


// ════════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════════

function _emptyFormData() {
  return {
    // Paso 1
    direction:             null,
    payment_target_type:   null,
    counterparty_id:       null,
    counterparty_type:     null,
    counterparty_label:    null,
    counterparty_subtitle: null,
    counterparty_country:  null,
    counterparty_tax_id:   null,
    // Paso 2
    obligation_ids:        [],
    subtotal:              0,
    // Paso 3
    metodo:                null,
    tipo_pago:              null,
    monto:                 0,
    moneda:                "USD",
    tasa_cambio_a_usd:     null,
    fecha:                 new Date().toISOString().slice(0, 10),
    referencia:            "",
    notas:                 "",
    evidencia:             null,
    // futuro: source_mwt_account_id / destination_mwt_account_id
  };
}

function _validateAllSteps(formData, lang) {
  const out = { step1: [], step2: [], step3: [], step4: [] };

  // Paso 1
  if (!formData.direction)           out.step1.push(lang === "es" ? "Selecciona la dirección" : "Select direction");
  if (!formData.payment_target_type) out.step1.push(lang === "es" ? "Selecciona el tipo de pago" : "Select target type");
  if (!formData.counterparty_id)     out.step1.push(lang === "es" ? "Selecciona la contraparte" : "Select counterparty");

  // Paso 2
  if (!formData.obligation_ids?.length) {
    out.step2.push(lang === "es"
      ? "Tilda al menos una obligación a saldar."
      : "Check at least one debt to settle.");
  }

  // Paso 3
  if (!formData.metodo)              out.step3.push(lang === "es" ? "Selecciona el método" : "Select method");
  if (!formData.tipo_pago)            out.step3.push(lang === "es" ? "Selecciona el tipo" : "Select type");
  if (!formData.monto || formData.monto <= 0)
    out.step3.push(lang === "es" ? "El monto debe ser mayor a 0" : "Amount must be > 0");
  if (!formData.fecha)               out.step3.push(lang === "es" ? "Fecha requerida" : "Date required");
  if (!formData.evidencia)           out.step3.push(lang === "es" ? "Comprobante obligatorio" : "Proof required");
  if (formData.moneda && formData.moneda !== "USD"
      && (!formData.tasa_cambio_a_usd || formData.tasa_cambio_a_usd <= 0)) {
    out.step3.push(lang === "es"
      ? "Tasa de cambio requerida cuando moneda ≠ USD"
      : "FX rate required when currency ≠ USD");
  }

  // Paso 4 — todos los pasos anteriores deben pasar.
  out.step4 = [...out.step1, ...out.step2, ...out.step3];

  return out;
}

function _buildDryRunPayload(f) {
  // Las aplicaciones reales necesitan applicable_type + applicable_id por
  // cada obligation_id. En el dry-run alcanza con un placeholder porque el
  // backend solo evalua la matriz §2 sobre target_type + counterparty +
  // expediente. Como cada obligation_id viene de OpenDebtsTable y trae
  // metadata, en una iteracion futura podemos enviar el shape rico.
  // Por ahora enviamos un payload minimo con el primer expediente
  // inferido a partir del subtotal del Paso 2.
  return {
    direction:           f.direction,
    counterparty_type:   f.counterparty_type,
    counterparty_id:     f.counterparty_id,
    monto:               Number(f.monto || 0),
    moneda:              f.moneda || "USD",
    // Aplicaciones: un placeholder con el target_type para que el backend
    // sepa de que tipo se trata. Cuando OpenDebtsTable propague el detalle
    // completo (issue futuro), reemplazamos por el array real.
    aplicaciones: f.obligation_ids.map((id) => ({
      applicable_type:
        f.payment_target_type === "COST" ? "COSTO" : "FACTURA",  // best-effort
      applicable_id:    id,
      monto_aplicado:   0,  // backend ignora monto en dry-run
    })),
  };
}

function _buildSubmitPayload(f) {
  // Payload para POST /api/finance/payments/ (multipart).
  // financePaymentsApi.register se encarga de construir el FormData.
  //
  // Si _preloaded_cost_lines existe (flujo preseleccionado desde nodo/OC/trf),
  // las aplicaciones son siempre tipo COSTO con monto_aplicado = saldo_usd.
  const aplicaciones = f._preloaded_cost_lines
    ? f._preloaded_cost_lines.map((cl) => ({
        applicable_type: "COSTO",
        applicable_id:   cl.id,
        monto_aplicado:  Number(cl.saldo_usd ?? cl.amount_usd ?? 0),
      }))
    : f.obligation_ids.map((id) => ({
        applicable_type:
          f.payment_target_type === "COST" ? "COSTO" : "FACTURA",
        applicable_id:    id,
        monto_aplicado:   0,  // TODO: distribuir cuando OpenDebtsTable
                              //       devuelva monto por obligation
      }));

  return {
    expediente_id:  null,  // se infiere de la primera obligation_id en backend
    monto:          Number(f.monto || 0),
    moneda:         f.moneda || "USD",
    fecha:          f.fecha,
    metodo:         f.metodo,
    tipo_pago:      f.tipo_pago,
    referencia:     f.referencia || "",
    notas:          f.notas || "",
    direction:      f.direction,
    counterparty_type: f.counterparty_type,
    counterparty_id:   f.counterparty_id,
    tasa_cambio_a_usd: f.tasa_cambio_a_usd,
    aplicaciones,
    evidencia: f.evidencia,
  };
}


// ── UI primitives internos ───────────────────────────────────────────
function _FieldGroup({ label, hint, children, required, fullWidth }) {
  return (
    <div style={{ gridColumn: fullWidth ? "1 / -1" : undefined }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6,
                    marginBottom: 6 }}>
        <label style={{ font: "var(--body-sm)", fontWeight: 600,
                         color: "var(--text-primary)" }}>
          {label}{required && <span style={{ color: "var(--critical)" }}> *</span>}
        </label>
        {hint && (
          <span style={{ font: "var(--caption)", color: "var(--text-tertiary)" }}>
            {hint}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function _RadioCard({ checked, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        padding: "12px 14px",
        border: `2px solid ${checked ? "var(--brand-primary)" : "var(--border)"}`,
        borderRadius: "var(--radius-md)",
        background: checked
          ? "color-mix(in oklab, var(--brand-primary) 6%, transparent)"
          : "var(--surface)",
        color: "var(--text-primary)",
        cursor: "pointer",
        textAlign: "left",
        transition: "all 120ms ease",
      }}
    >
      {children}
    </button>
  );
}

function _SummaryRow({ label, value }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "6px 0",
      borderBottom: "1px dashed var(--divider)",
      gap: 12,
    }}>
      <span style={{ color: "var(--text-secondary)", fontSize: 12,
                     textTransform: "uppercase", letterSpacing: "0.04em",
                     fontWeight: 500 }}>
        {label}
      </span>
      <span style={{ color: "var(--text-primary)", fontSize: 13,
                     textAlign: "right" }}>
        {value || "—"}
      </span>
    </div>
  );
}

function _inputStyle() {
  return {
    width: "100%",
    padding: "8px 10px",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    font: "var(--body-sm)",
    color: "var(--text-primary)",
    background: "var(--surface)",
    outline: "none",
  };
}
