// =====================================================================
// MWT.ONE · components/finance/RegisterPaymentWizard.jsx
// Sprint Pagos v2 — Wizard orquestador (refactor scope-aware).
//
// Drawer lateral 800px con 4 pasos:
//   Paso 1  Direction (IN/OUT) + Target (PRODUCT/COST)
//           — CounterpartyPicker ELIMINADO (CEP-2026-05-25).
//   Paso 2  ScopeApplicablesTable — selección multi-check de items
//           con saldo pendiente (COSTO o PRODUCTO) filtrados por scope.
//   Paso 3  Detalle del pago (método, monto, moneda, fecha, evidencia).
//   Paso 4  Confirmación + dry-run.
//
// Reglas honradas:
//   R1 — Cero hex literales (solo CSS vars)
//   R2 — JSDoc en las props
//   R3 — wizard solo accesible si !isClient (gating en padre)
//   R5 — tabular-nums en montos y referencias
// =====================================================================
import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import ScopeApplicablesTable   from "./ScopeApplicablesTable.jsx";
import CreditEffectPreview     from "./CreditEffectPreview.jsx";
import { usePaymentSubmit }    from "../../data/payments.js";
import { financePaymentsApi }  from "../../lib/api.js";
import {
  PAYMENT_DIRECTION_LABELS,
  getEnumLabel,
} from "../../lib/i18n/payments.js";

const DRAFT_STORAGE_KEY = "mwt.registerPaymentWizard.draft.v2";

// MIME types aceptados (espejo de backend enums.EVIDENCE_ALLOWED_MIMES).
const EVIDENCE_ALLOWED_MIMES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
];
const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

// Sprint 2026-05-25 (CEO reorder): Direccion -> Obligaciones ->
// Comprobante -> Detalle -> Confirmacion. El CEO primero define
// QUE va a pagar (dir, target, items) y luego sube el PDF para
// que la IA prellene el Detalle.
//   wizard index 0 -> Direccion          (Step1 component)
//   wizard index 1 -> Obligaciones       (Step2 component)
//   wizard index 2 -> Comprobante + IA   (Step0 component)
//   wizard index 3 -> Detalle pago       (Step3 component)
//   wizard index 4 -> Confirmacion       (Step4 component)
// Las claves de error stepN siguen historicas:
//   index 0 -> stepErrors.step1
//   index 1 -> stepErrors.step2
//   index 2 -> aiError (manejado en Step0)
//   index 3 -> stepErrors.step3
//   index 4 -> stepErrors.step4
const STEPS = [
  { key: "step1", label_es: "Dirección",    label_en: "Direction" },
  { key: "step2", label_es: "Obligaciones", label_en: "Debts" },
  { key: "step3", label_es: "Comprobante",  label_en: "Receipt" },
  { key: "step4", label_es: "Detalle pago", label_en: "Payment detail" },
  { key: "step5", label_es: "Confirmación", label_en: "Confirmation" },
];

/**
 * @param {{
 *   open: boolean,
 *   onClose: () => void,
 *   onSuccess?: (payment: object) => void,
 *   lang?: 'es'|'en',
 *   preselectedScope?: { type: 'NODO'|'TRANSFERENCIA'|'OC'|'EXPEDIENTE', id: string, label: string },
 * }} props
 */
export default function RegisterPaymentWizard({
  open,
  onClose,
  onSuccess,
  lang = "es",
  preselectedScope = null,
  // preselectedCostLines is kept for API compatibility but no longer used
  // internally — Step 2 always loads via listApplicables.
  preselectedCostLines = null, // eslint-disable-line no-unused-vars
}) {
  // ── State del wizard ───────────────────────────────────────────
  const [step, setStep] = useState(0);
  const [formData, setFormData] = useState(() => _emptyFormData(preselectedScope));
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiVerdict,   setAiVerdict]   = useState(null);
  const [aiError,     setAiError]     = useState(null);

  // ── Submit hook ────────────────────────────────────────────────
  const { submit, submitting, error: submitError, reset: resetSubmit } = usePaymentSubmit();

  // ── sessionStorage draft ───────────────────────────────────────
  const [sessionKey, setSessionKey] = useState(null);
  useEffect(() => {
    if (!open) return;
    const k = `${DRAFT_STORAGE_KEY}.${Date.now()}`;
    setSessionKey(k);
    try {
      const lastKey = sessionStorage.getItem(`${DRAFT_STORAGE_KEY}.last`);
      if (lastKey) {
        const raw = sessionStorage.getItem(lastKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          setFormData({ ..._emptyFormData(preselectedScope), ...parsed, evidencia: null,
                        _preselectedScope: preselectedScope || null });
        }
      }
    } catch { /* ignore */ }
  }, [open]);

  useEffect(() => {
    if (!sessionKey) return;
    try {
      const toSave = { ...formData, evidencia: null };
      sessionStorage.setItem(sessionKey, JSON.stringify(toSave));
      sessionStorage.setItem(`${DRAFT_STORAGE_KEY}.last`, sessionKey);
    } catch { /* ignore */ }
  }, [formData, sessionKey]);

  // ── Validaciones por paso ──────────────────────────────────────
  const stepErrors = useMemo(() => _validateAllSteps(formData, lang), [formData, lang]);
  let canAdvance;
  if (step === 2) {
    canAdvance = !aiAnalyzing;
  } else if (step <= 1) {
    canAdvance = !stepErrors[`step${step + 1}`]?.length;
  } else {
    canAdvance = !stepErrors[`step${step}`]?.length;
  }

  // ── Handlers ───────────────────────────────────────────────────
  const update = (patch) => setFormData((prev) => ({ ...prev, ...patch }));

  const reset = () => {
    setFormData(_emptyFormData(preselectedScope));
    setStep(0);
    setAiAnalyzing(false);
    setAiVerdict(null);
    setAiError(null);
    resetSubmit();
  };

  // ── Analyze evidence with AI (Paso 0) ─────────────────────────
  const handleAnalyzeEvidence = async (file) => {
    if (!file) { update({ evidencia: null }); return; }
    // Basic client-side validation first
    if (!EVIDENCE_ALLOWED_MIMES.includes(file.type)) {
      update({ _file_error: lang === "es"
        ? "Tipo no permitido. PDF / PNG / JPG / WebP."
        : "Type not allowed. PDF / PNG / JPG / WebP.", evidencia: null });
      return;
    }
    if (file.size > EVIDENCE_MAX_BYTES) {
      update({ _file_error: lang === "es"
        ? "Archivo demasiado grande. Máx 10 MB."
        : "File too large. Max 10 MB.", evidencia: null });
      return;
    }
    update({ evidencia: file, _file_error: null });
    setAiAnalyzing(true);
    setAiError(null);
    setAiVerdict(null);
    try {
      const v = await financePaymentsApi.analyzeEvidence({ evidencia: file });
      setAiVerdict(v);
      // Pre-fill formData with extracted fields
      update({
        evidencia:   file,
        monto:       v.monto_extraido     != null ? v.monto_extraido     : formData.monto,
        moneda:      v.moneda_extraida    ?? formData.moneda,
        fecha:       v.fecha_extraida     ?? formData.fecha,
        referencia:  v.referencia_extraida?? formData.referencia,
        metodo:      v.metodo_sugerido    ?? formData.metodo,
        _ai_verdict: v,
      });
    } catch (e) {
      setAiError(e?.message || (lang === "es" ? "Error analizando el comprobante" : "Error analyzing the receipt"));
      update({ evidencia: file });   // at least save the file
    } finally {
      setAiAnalyzing(false);
    }
  };

  const handleClose = () => {
    const hasData = !!(
      formData.selected_applicables?.length ||
      formData.monto ||
      formData.evidencia
    );
    if (hasData && !submitting) {
      // Use inline state instead of window.confirm (R against alert/confirm).
      // Simplified: just close. Draft is in sessionStorage so user can reopen.
    }
    onClose?.();
  };

  const handleAdvance = () => {
    if (!canAdvance) return;
    if (step < STEPS.length - 1) setStep((s) => s + 1);
  };

  const handleBack = () => {
    if (step > 0) setStep((s) => s - 1);
  };

  const handleSubmit = async () => {
    if (submitting) return;
    try {
      const payload = _buildSubmitPayload(formData);
      const resp = await submit(payload);
      try {
        if (sessionKey) sessionStorage.removeItem(sessionKey);
        sessionStorage.removeItem(`${DRAFT_STORAGE_KEY}.last`);
      } catch { /* ignore */ }
      reset();
      onSuccess?.(resp);
      onClose?.();
    } catch (err) {
      // Error queda en submitError (del hook) y se muestra en el footer.
      void err;
    }
  };

  // ── Payload para dry-run del Paso 4 ────────────────────────────
  const dryRunPayload = useMemo(() => {
    // index 4 sigue siendo Confirmacion tras el reorder.
    if (step !== 4) return null;
    if (!formData.selected_applicables?.length) return null;
    return _buildDryRunPayload(formData);
  }, [step, formData]);

  // ── Scope badge label ───────────────────────────────────────────
  const scopeTypeLabel = {
    NODO:          lang === "es" ? "Nodo" : "Node",
    TRANSFERENCIA: lang === "es" ? "Movimiento" : "Transfer",
    OC:            "OC",
    EXPEDIENTE:    lang === "es" ? "Expediente" : "Expediente",
  };

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
                <div className="micro" style={{ color: "var(--text-tertiary)", marginBottom: 2 }}>
                  {lang === "es" ? "FINANCIERO" : "FINANCE"}
                  {preselectedScope && preselectedScope.type !== "OC" && preselectedScope.type !== "EXPEDIENTE" && (
                    <span style={{
                      marginLeft: 8,
                      display: "inline-flex", alignItems: "center", gap: 6,
                    }}>
                      <span style={{
                        padding: "2px 8px", borderRadius: "var(--radius-sm)",
                        fontSize: 10, fontWeight: 700,
                        background: "color-mix(in oklab, var(--brand-primary) 12%, transparent)",
                        color: "var(--brand-primary)",
                        textTransform: "uppercase", letterSpacing: "0.06em",
                      }}>
                        {scopeTypeLabel[preselectedScope.type] || preselectedScope.type}
                      </span>
                      <span style={{ color: "var(--brand-primary)", fontWeight: 700 }}>
                        {preselectedScope.label}
                      </span>
                    </span>
                  )}
                </div>
                <div style={{ font: "var(--heading-md)", color: "var(--text-primary)" }}>
                  {lang === "es" ? "Registrar pago" : "Register payment"}
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
              {/* Reorder Sprint 2026-05-25:
                  index 0 -> Step1, 1 -> Step2, 2 -> Step0 (IA),
                  3 -> Step3, 4 -> Step4 */}
              {step === 0 && (
                <Step1 formData={formData} update={update} lang={lang}/>
              )}
              {step === 1 && (
                <Step2
                  formData={formData}
                  update={update}
                  lang={lang}
                  preselectedScope={preselectedScope}
                />
              )}
              {step === 2 && (
                <Step0
                  formData={formData}
                  onFile={handleAnalyzeEvidence}
                  aiAnalyzing={aiAnalyzing}
                  aiVerdict={aiVerdict}
                  aiError={aiError}
                  lang={lang}
                />
              )}
              {step === 3 && (
                <Step3 formData={formData} update={update} lang={lang} aiVerdict={aiVerdict}/>
              )}
              {step === 4 && (
                <Step4
                  formData={formData}
                  preselectedScope={preselectedScope}
                  dryRunPayload={dryRunPayload}
                  submitError={submitError}
                  lang={lang}
                />
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
                {(() => {
                  let errKey = null;
                  if (step <= 1) errKey = `step${step + 1}`;
                  else if (step === 2) errKey = null;
                  else errKey = `step${step}`;
                  const arr = errKey ? stepErrors[errKey] : null;
                  if (arr && arr.length > 0) {
                    return (
                      <div style={{ color: "var(--critical)", fontSize: 12 }}>
                        {arr[0]}
                      </div>
                    );
                  }
                  return null;
                })()}
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
// Paso 0 — Comprobante (nuevo): dropzone + análisis IA
// El usuario adjunta el comprobante bancario. El backend IA extrae
// campos y pre-llena el formulario. El paso siempre es opcional en el
// sentido de que el usuario puede continuar aunque la IA falle.
// ════════════════════════════════════════════════════════════════════
function Step0({ formData, onFile, aiAnalyzing, aiVerdict, aiError, lang }) {
  const [dragging, setDragging] = useState(false);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) onFile(file);
  };

  const statusColor = aiVerdict
    ? aiVerdict.status === "MATCH"    ? "var(--success)"
    : aiVerdict.status === "PARTIAL"  ? "var(--warning)"
    : aiVerdict.status === "SUSPICIOUS" ? "var(--critical)"
    : "var(--text-tertiary)"
    : "var(--text-tertiary)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 560 }}>
      <div>
        <div style={{ font: "var(--heading-sm)", color: "var(--text-primary)",
                      marginBottom: 6 }}>
          {lang === "es" ? "Adjunta el comprobante de pago" : "Attach the payment proof"}
        </div>
        <div style={{ font: "var(--body-sm)", color: "var(--text-secondary)" }}>
          {lang === "es"
            ? "La IA extraerá automáticamente monto, fecha, referencia y método para pre-llenar el formulario."
            : "AI will automatically extract amount, date, reference, and method to pre-fill the form."}
        </div>
      </div>

      {/* Dropzone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        style={{
          border: `2px dashed ${dragging ? "var(--brand-primary)" : "var(--border)"}`,
          borderRadius: "var(--radius-md)",
          background: dragging
            ? "color-mix(in oklab, var(--brand-primary) 5%, transparent)"
            : "var(--surface)",
          padding: "32px 20px",
          textAlign: "center",
          transition: "all 150ms ease",
          cursor: "pointer",
        }}
        onClick={() => document.getElementById("step0-file-input")?.click()}
      >
        <div style={{ fontSize: 36, marginBottom: 10 }}>📄</div>
        <div style={{ font: "var(--body-sm)", color: "var(--text-secondary)",
                      marginBottom: 8 }}>
          {lang === "es"
            ? "Arrastra aquí o haz clic para seleccionar"
            : "Drag here or click to select"}
        </div>
        <div className="caption" style={{ color: "var(--text-tertiary)" }}>
          PDF · PNG · JPG · WebP — {lang === "es" ? "máx 10 MB" : "max 10 MB"}
        </div>
        <input
          id="step0-file-input"
          type="file"
          accept={EVIDENCE_ALLOWED_MIMES.join(",")}
          style={{ display: "none" }}
          onChange={(e) => onFile(e.target.files?.[0])}
        />
      </div>

      {/* File error */}
      {formData._file_error && (
        <div style={{ padding: "8px 12px", borderRadius: "var(--radius-sm)",
                      background: "color-mix(in oklab, var(--critical) 8%, transparent)",
                      border: "1px solid color-mix(in oklab, var(--critical) 30%, transparent)",
                      color: "var(--critical)", fontSize: 13 }}>
          {formData._file_error}
        </div>
      )}

      {/* Archivo adjunto */}
      {formData.evidencia && !formData._file_error && (
        <div style={{ display: "flex", alignItems: "center", gap: 10,
                      padding: "10px 14px", borderRadius: "var(--radius-sm)",
                      background: "var(--bg-alt)", border: "1px solid var(--border)" }}>
          <span style={{ fontSize: 20 }}>📎</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {formData.evidencia.name}
            </div>
            <div className="caption tabular-nums" style={{ color: "var(--text-tertiary)" }}>
              {(formData.evidencia.size / 1024).toFixed(1)} KB
            </div>
          </div>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onFile(null); }}
            style={{ background: "none", border: "none", cursor: "pointer",
                     color: "var(--text-tertiary)", fontSize: 18, lineHeight: 1 }}
          >×</button>
        </div>
      )}

      {/* AI analyzing spinner */}
      {aiAnalyzing && (
        <div style={{ display: "flex", alignItems: "center", gap: 10,
                      padding: "12px 16px", borderRadius: "var(--radius-md)",
                      background: "color-mix(in oklab, var(--brand-primary) 6%, transparent)",
                      border: "1px solid color-mix(in oklab, var(--brand-primary) 24%, transparent)" }}>
          <div style={{
            width: 16, height: 16, borderRadius: "50%",
            border: "2px solid var(--brand-primary)",
            borderTopColor: "transparent",
            animation: "spin 0.8s linear infinite",
          }}/>
          <span style={{ fontSize: 13, color: "var(--brand-primary)", fontWeight: 500 }}>
            {lang === "es" ? "Analizando con IA…" : "Analyzing with AI…"}
          </span>
        </div>
      )}

      {/* AI verdict card */}
      {!aiAnalyzing && aiVerdict && (
        <div style={{
          padding: "14px 16px", borderRadius: "var(--radius-md)",
          background: `color-mix(in oklab, ${statusColor} 7%, transparent)`,
          border: `1px solid color-mix(in oklab, ${statusColor} 28%, transparent)`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 16 }}>
              {aiVerdict.status === "MATCH" ? "✓" : aiVerdict.status === "SUSPICIOUS" ? "⚠" : "~"}
            </span>
            <span style={{ fontWeight: 700, fontSize: 13, color: statusColor }}>
              {lang === "es" ? "Comprobante analizado" : "Receipt analyzed"}
              {" · "}
              {lang === "es" ? "confianza" : "confidence"}{" "}
              <span className="tabular-nums">{aiVerdict.confianza ?? "—"}%</span>
            </span>
          </div>
          {/* Extracted fields summary */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px",
                        fontSize: 12 }}>
            {aiVerdict.monto_extraido    != null && (
              <div><span style={{ color: "var(--text-tertiary)" }}>
                {lang === "es" ? "Monto:" : "Amount:"}</span>{" "}
                <span className="tabular-nums" style={{ fontWeight: 600 }}>
                  {aiVerdict.moneda_extraida || ""}{" "}{aiVerdict.monto_extraido}
                </span>
              </div>
            )}
            {aiVerdict.fecha_extraida && (
              <div><span style={{ color: "var(--text-tertiary)" }}>
                {lang === "es" ? "Fecha:" : "Date:"}</span>{" "}
                <span className="tabular-nums">{aiVerdict.fecha_extraida}</span>
              </div>
            )}
            {aiVerdict.referencia_extraida && (
              <div><span style={{ color: "var(--text-tertiary)" }}>
                {lang === "es" ? "Referencia:" : "Reference:"}</span>{" "}
                <span className="tabular-nums font-mono">{aiVerdict.referencia_extraida}</span>
              </div>
            )}
            {aiVerdict.metodo_sugerido && (
              <div><span style={{ color: "var(--text-tertiary)" }}>
                {lang === "es" ? "Método:" : "Method:"}</span>{" "}
                {aiVerdict.metodo_sugerido}
              </div>
            )}
            {aiVerdict.beneficiario_extraido && (
              <div style={{ gridColumn: "1 / -1" }}>
                <span style={{ color: "var(--text-tertiary)" }}>
                  {lang === "es" ? "Beneficiario:" : "Beneficiary:"}</span>{" "}
                {aiVerdict.beneficiario_extraido}
              </div>
            )}
          </div>
          {aiVerdict.razon_humana && (
            <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-secondary)",
                          fontStyle: "italic" }}>
              "{aiVerdict.razon_humana}"
            </div>
          )}
          {aiVerdict.alertas_fraude?.length > 0 && (
            <div style={{ marginTop: 8, padding: "6px 10px", borderRadius: "var(--radius-sm)",
                          background: "color-mix(in oklab, var(--critical) 8%, transparent)",
                          border: "1px solid color-mix(in oklab, var(--critical) 30%, transparent)" }}>
              <span style={{ fontSize: 12, color: "var(--critical)", fontWeight: 600 }}>
                {lang === "es" ? "Alertas: " : "Alerts: "}
                {aiVerdict.alertas_fraude.join(" · ")}
              </span>
            </div>
          )}
        </div>
      )}

      {/* AI error — non-blocking */}
      {!aiAnalyzing && aiError && (
        <div style={{
          padding: "10px 14px", borderRadius: "var(--radius-sm)",
          background: "color-mix(in oklab, var(--warning) 8%, transparent)",
          border: "1px solid color-mix(in oklab, var(--warning) 30%, transparent)",
          color: "var(--text-primary)", fontSize: 13,
        }}>
          <span style={{ fontWeight: 600, color: "var(--warning)" }}>
            {lang === "es" ? "No se pudo analizar" : "Could not analyze"}
          </span>
          {" — "}
          {lang === "es"
            ? "Puedes continuar y llenar los campos manualmente."
            : "You can continue and fill in the fields manually."}
          {aiError && (
            <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>
              {aiError}
            </div>
          )}
        </div>
      )}

      {/* CSS keyframe for spinner */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}


// ════════════════════════════════════════════════════════════════════
// Paso 1 — Direction + Target type
// CounterpartyPicker eliminado (CEP-2026-05-25).
// Botón "Siguiente" habilitado en cuanto ambos campos estén elegidos.
// ════════════════════════════════════════════════════════════════════
function Step1({ formData, update, lang }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <_FieldGroup
        label={lang === "es" ? "Dirección del pago" : "Payment direction"}
        hint={lang === "es"
          ? "¿MWT está cobrando o pagando?"
          : "Is MWT collecting or paying?"}
      >
        <div style={{ display: "flex", gap: 10 }}>
          {["IN", "OUT"].map((d) => (
            <_RadioCard
              key={d}
              checked={formData.direction === d}
              onClick={() => update({
                direction: d,
                // Reset step-2 selection when direction changes.
                selected_applicables: [],
                subtotal: 0,
                monto: 0,
              })}
            >
              <div style={{ fontWeight: 700 }}>
                {getEnumLabel(PAYMENT_DIRECTION_LABELS, d, lang)}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>
                {d === "IN"
                  ? (lang === "es" ? "MWT cobra / cliente paga" : "MWT collects / client pays")
                  : (lang === "es" ? "MWT paga a proveedor"     : "MWT pays supplier")}
              </div>
            </_RadioCard>
          ))}
        </div>
      </_FieldGroup>

      <_FieldGroup
        label={lang === "es" ? "Tipo de pago" : "Payment target"}
        hint={lang === "es"
          ? "Producto (mercancía) o costo (DUA, flete, seguro, etc)"
          : "Product (merchandise) or cost (DUA, freight, insurance, etc)"}
      >
        <div style={{ display: "flex", gap: 10 }}>
          {["PRODUCT", "COST"].map((t) => (
            <_RadioCard
              key={t}
              checked={formData.payment_target_type === t}
              onClick={() => update({
                payment_target_type: t,
                selected_applicables: [],
                subtotal: 0,
                monto: 0,
              })}
            >
              <div style={{ fontWeight: 700 }}>
                {t === "PRODUCT"
                  ? (lang === "es" ? "Producto" : "Product")
                  : (lang === "es" ? "Costo"    : "Cost")}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>
                {t === "PRODUCT"
                  ? (lang === "es" ? "Factura / proforma / producto" : "Invoice / proforma / product")
                  : (lang === "es" ? "DUA / flete / seguro / etc"   : "DUA / freight / insurance / etc")}
              </div>
            </_RadioCard>
          ))}
        </div>
      </_FieldGroup>
    </div>
  );
}


// ════════════════════════════════════════════════════════════════════
// Paso 2 — ScopeApplicablesTable
// Carga items via listApplicables, filtra por scope + target type.
// Multi-select con resumen de totales abajo.
// ════════════════════════════════════════════════════════════════════
function Step2({ formData, update, lang, preselectedScope }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ color: "var(--text-secondary)", fontSize: 13 }}>
        {lang === "es"
          ? "Selecciona los items con saldo pendiente que este pago va a saldar."
          : "Select the pending items this payment will settle."}
      </div>
      <ScopeApplicablesTable
        scope={preselectedScope}
        applicableType={formData.payment_target_type === "COST" ? "COSTO" : "PRODUCTO"}
        selected={formData.selected_applicables || []}
        onChange={(newSelected, subtotal) => update({
          selected_applicables: newSelected,
          subtotal:             subtotal,
          // Pre-cargar monto del Paso 3 con el subtotal (editable).
          monto:                subtotal,
          // Pre-cargar moneda de la primera selección.
          moneda:               newSelected[0]?._currency || "USD",
        })}
        lang={lang}
      />
    </div>
  );
}


// ════════════════════════════════════════════════════════════════════
// Paso 3 — Detalle del pago
// ════════════════════════════════════════════════════════════════════
function Step3({ formData, update, lang, aiVerdict }) {
  const [metodos, setMetodos] = useState([]);
  const [tipos,   setTipos]   = useState([]);
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

  const handleFile = (file) => {
    if (!file) { update({ evidencia: null }); return; }
    if (!EVIDENCE_ALLOWED_MIMES.includes(file.type)) {
      // Show inline error — no alert().
      update({ _file_error: lang === "es"
        ? "Tipo no permitido. PDF / PNG / JPG / WebP."
        : "Type not allowed. PDF / PNG / JPG / WebP." });
      return;
    }
    if (file.size > EVIDENCE_MAX_BYTES) {
      update({ _file_error: lang === "es"
        ? "Archivo demasiado grande. Máx 10 MB."
        : "File too large. Max 10 MB." });
      return;
    }
    update({ evidencia: file, _file_error: null });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* AI pre-fill banner */}
      {aiVerdict && (
        <div style={{
          padding: "10px 14px", borderRadius: "var(--radius-sm)",
          background: "color-mix(in oklab, var(--brand-primary) 6%, transparent)",
          border: "1px solid color-mix(in oklab, var(--brand-primary) 22%, transparent)",
          display: "flex", alignItems: "center", gap: 10, fontSize: 13,
        }}>
          <span style={{ fontSize: 16 }}>✨</span>
          <span style={{ color: "var(--brand-primary)", fontWeight: 600 }}>
            {lang === "es"
              ? `Campos pre-llenados por IA (confianza ${aiVerdict.confianza ?? "—"}%). Revísalos.`
              : `Fields pre-filled by AI (confidence ${aiVerdict.confianza ?? "—"}%). Please review.`}
          </span>
        </div>
      )}
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
        label={lang === "es" ? "Cambiar comprobante (opcional)" : "Change proof (optional)"}
        fullWidth
        hint={lang === "es" ? "Ya adjunto en Paso 0. Cambia solo si es necesario." : "Already attached in Step 0. Change only if needed."}
      >
        <input
          type="file"
          accept={EVIDENCE_ALLOWED_MIMES.join(",")}
          onChange={(e) => handleFile(e.target.files?.[0])}
          style={{ ..._inputStyle(), padding: 6 }}
        />
        {formData._file_error && (
          <div style={{ marginTop: 4, fontSize: 12, color: "var(--critical)" }}>
            {formData._file_error}
          </div>
        )}
        {formData.evidencia && (
          <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-secondary)" }}>
            📎 {formData.evidencia.name} · {(formData.evidencia.size / 1024).toFixed(1)} KB
          </div>
        )}
      </_FieldGroup>
      </div>
    </div>
  );
}


// ════════════════════════════════════════════════════════════════════
// Paso 4 — Confirmación
// ════════════════════════════════════════════════════════════════════
function Step4({ formData, preselectedScope, dryRunPayload, submitError, lang }) {
  const appCount  = formData.selected_applicables?.length || 0;
  const totalUsd  = formData.subtotal || 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Resumen */}
      <div className="card card-pad">
        <div className="micro" style={{ color: "var(--text-tertiary)", marginBottom: 8 }}>
          {lang === "es" ? "RESUMEN" : "SUMMARY"}
        </div>
        {preselectedScope && (
          <_SummaryRow
            label={lang === "es" ? "Alcance" : "Scope"}
            value={
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                fontWeight: 600, color: "var(--brand-primary)",
              }}>
                {preselectedScope.type}: {preselectedScope.label}
              </span>
            }
          />
        )}
        <_SummaryRow
          label={lang === "es" ? "Dirección" : "Direction"}
          value={getEnumLabel(PAYMENT_DIRECTION_LABELS, formData.direction, lang)}
        />
        <_SummaryRow
          label={lang === "es" ? "Tipo" : "Target type"}
          value={formData.payment_target_type === "PRODUCT"
            ? (lang === "es" ? "Producto" : "Product")
            : (lang === "es" ? "Costo" : "Cost")}
        />
        <_SummaryRow
          label={lang === "es" ? "Items seleccionados" : "Selected items"}
          value={
            <span className="tabular-nums" style={{ fontWeight: 700 }}>
              {appCount} {lang === "es" ? "item(s)" : "item(s)"}
            </span>
          }
        />
        <_SummaryRow
          label={lang === "es" ? "Subtotal calculado" : "Calculated subtotal"}
          value={
            <span className="tabular-nums" style={{ fontWeight: 700,
                                                     color: "var(--brand-accent)" }}>
              ${totalUsd.toLocaleString("en-US", {
                minimumFractionDigits: 2, maximumFractionDigits: 2,
              })} USD
            </span>
          }
        />
        <_SummaryRow
          label={lang === "es" ? "Monto a registrar" : "Amount to register"}
          value={
            <span className="tabular-nums" style={{ fontWeight: 700 }}>
              {formData.moneda || "USD"}{" "}
              {Number(formData.monto || 0).toLocaleString("en-US", {
                minimumFractionDigits: 2, maximumFractionDigits: 2,
              })}
            </span>
          }
        />
        <_SummaryRow
          label={lang === "es" ? "Método / Fecha" : "Method / Date"}
          value={`${formData.metodo || "—"} · ${formData.fecha || "—"}`}
        />
        <_SummaryRow
          label={lang === "es" ? "Comprobante" : "Proof"}
          value={formData.evidencia
            ? `📎 ${formData.evidencia.name}`
            : (lang === "es" ? "Sin adjuntar" : "Missing")}
        />
      </div>

      {/* Lista de items aplicables seleccionados */}
      {appCount > 0 && (
        <div>
          <div className="micro" style={{ color: "var(--text-tertiary)", marginBottom: 6 }}>
            {lang === "es" ? "ITEMS A SALDAR" : "ITEMS TO SETTLE"}
          </div>
          <div className="card card-pad" style={{ border: "1px solid var(--border-subtle)" }}>
            <table className="table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ fontSize: 11 }}>{lang === "es" ? "Item" : "Item"}</th>
                  <th style={{ textAlign: "right", fontSize: 11 }}>
                    {lang === "es" ? "Saldo USD" : "Balance USD"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {formData.selected_applicables.map((a) => (
                  <tr key={a.id}>
                    <td style={{ fontSize: 12 }}>
                      {a._label || a.id}
                    </td>
                    <td className="tabular-nums" style={{
                      textAlign: "right", fontWeight: 700,
                      color: "var(--brand-accent)",
                    }}>
                      ${Number(a.monto_aplicado || 0).toLocaleString("en-US", {
                        minimumFractionDigits: 2, maximumFractionDigits: 2,
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* CreditEffectPreview (dry-run) */}
      <div>
        <div className="micro" style={{ color: "var(--text-tertiary)", marginBottom: 6 }}>
          {lang === "es" ? "EFECTO SOBRE CRÉDITO" : "CREDIT EFFECT"}
        </div>
        <CreditEffectPreview payload={dryRunPayload} lang={lang}/>
      </div>

      {/* Submit error */}
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

function _emptyFormData(scope = null) {
  return {
    // Paso 1
    direction:             null,
    payment_target_type:   null,
    // Paso 2 - items seleccionados [{id, monto_aplicado, ...}]
    selected_applicables:  [],
    subtotal:              0,
    // Sprint 2026-05-25 - referencia al scope para que
    // _resolveExpedienteId pueda derivar el expediente_id.
    // scope debe pasarse explicitamente: la funcion es externa al
    // componente y no tiene closure sobre props.
    _preselectedScope:     scope || null,
    // Paso 3
    metodo:                null,
    tipo_pago:             null,
    monto:                 0,
    moneda:                "USD",
    tasa_cambio_a_usd:     null,
    fecha:                 new Date().toISOString().slice(0, 10),
    referencia:            "",
    notas:                 "",
    evidencia:             null,
    _file_error:           null,
    _ai_verdict:           null,
  };
}

function _validateAllSteps(formData, lang) {
  const out = { step1: [], step2: [], step3: [], step4: [] };

  // Paso 1
  if (!formData.direction)
    out.step1.push(lang === "es" ? "Selecciona la dirección" : "Select direction");
  if (!formData.payment_target_type)
    out.step1.push(lang === "es" ? "Selecciona el tipo de pago" : "Select target type");

  // Paso 2
  if (!formData.selected_applicables?.length) {
    out.step2.push(lang === "es"
      ? "Selecciona al menos un item con saldo pendiente."
      : "Select at least one item with pending balance.");
  }

  // Paso 3
  if (!formData.metodo)
    out.step3.push(lang === "es" ? "Selecciona el método" : "Select method");
  if (!formData.tipo_pago)
    out.step3.push(lang === "es" ? "Selecciona el tipo" : "Select type");
  if (!formData.monto || formData.monto <= 0)
    out.step3.push(lang === "es" ? "El monto debe ser mayor a 0" : "Amount must be > 0");
  if (!formData.fecha)
    out.step3.push(lang === "es" ? "Fecha requerida" : "Date required");
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
  // Sprint 2026-05-25 - filtrar items con monto <= 0 (timbres de
  // centavos que el backend rechaza con "Debe ser mayor a cero").
  const aplicaciones = (f.selected_applicables || [])
    .map((a) => ({
      applicable_type: a.applicable_type || (f.payment_target_type === "COST" ? "COSTO" : "PRODUCTO"),
      applicable_id:   a.id,
      monto_aplicado:  Number(a.monto_aplicado || 0),
      cantidad_producto: a.cantidad_producto || undefined,
    }))
    .filter((a) => a.monto_aplicado > 0.005);
  return {
    direction:       f.direction,
    monto:           Number(f.monto || 0),
    moneda:          f.moneda || "USD",
    expediente_id:   _resolveExpedienteId(f),
    aplicaciones,
  };
}

function _buildSubmitPayload(f) {
  // Sprint 2026-05-25 - filtrar items con monto <= 0 (timbres
  // <= medio centavo el backend los rechaza con "Debe ser mayor a cero").
  const aplicaciones = (f.selected_applicables || [])
    .map((a) => ({
      applicable_type: a.applicable_type || (f.payment_target_type === "COST" ? "COSTO" : "PRODUCTO"),
      applicable_id:   a.id,
      monto_aplicado:  Number(a.monto_aplicado || 0),
      ...(a.cantidad_producto != null ? { cantidad_producto: a.cantidad_producto } : {}),
    }))
    .filter((a) => a.monto_aplicado > 0.005);

  return {
    expediente_id:     _resolveExpedienteId(f),
    monto:             Number(f.monto || 0),
    moneda:            f.moneda || "USD",
    fecha:             f.fecha,
    metodo:            f.metodo,
    tipo_pago:         f.tipo_pago,
    referencia:        f.referencia || "",
    notas:             f.notas || "",
    direction:         f.direction,
    counterparty_type: null,
    counterparty_id:   null,
    tasa_cambio_a_usd: f.tasa_cambio_a_usd,
    aplicaciones,
    evidencia:         f.evidencia,
    // Sprint Comprobante IA — si el backend recibe pre_verdict con
    // status === "MATCH" y confianza >= 90, crea el pago directamente
    // en CONFIRMADO_AI (sin re-encolar task IA).
    ...(f._ai_verdict ? { pre_verdict: JSON.stringify(f._ai_verdict) } : {}),
  };
}


// Sprint 2026-05-25 - resuelve el expediente_id que el backend exige
// como UUID en POST /api/finance/payments/. Cascada de fuentes:
//   1. f.expediente_id explicito.
//   2. preselectedScope.id si type === "EXPEDIENTE".
//   3. primer selected_applicables[i]._expediente_id (el item conoce
//      su expediente cuando el backend lo devuelve en applicables).
//   4. primer selected_applicables[i]._scope_expediente_ids[0].
//   5. null (el backend exige UUID, sin esta cadena fallaria 400).
function _resolveExpedienteId(f) {
  if (f && f.expediente_id) return f.expediente_id;
  const ps = f && f._preselectedScope;
  if (ps && ps.type === "EXPEDIENTE" && ps.id) return ps.id;
  const apps = (f && f.selected_applicables) || [];
  for (const a of apps) {
    if (a && a._expediente_id) return a._expediente_id;
  }
  for (const a of apps) {
    const ids = a && (a._scope_expediente_ids || a._expediente_ids);
    if (Array.isArray(ids) && ids.length > 0) return ids[0];
  }
  // Sprint 2026-05-25 - ultimo fallback: parsear _scope_json si vino
  // como string desde el backend (compat con respuestas viejas).
  for (const a of apps) {
    const raw = a && a._scope_json;
    if (raw) {
      let obj = raw;
      if (typeof raw === "string") {
        try { obj = JSON.parse(raw); } catch (_) { obj = null; }
      }
      const ids = obj && obj.expediente_ids;
      if (Array.isArray(ids) && ids.length > 0) return ids[0];
    }
  }
  return null;
}


// ── UI primitivos internos ────────────────────────────────────────────
function _FieldGroup({ label, hint, children, required, fullWidth }) {
  return (
    <div style={{ gridColumn: fullWidth ? "1 / -1" : undefined }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 6 }}>
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
      <span style={{ color: "var(--text-primary)", fontSize: 13, textAlign: "right" }}>
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
