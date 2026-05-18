// =====================================================================
// MWT.ONE · components/finance/CreditEffectPreview.jsx
// Sprint Registrar Pago (Fase 2) — Paso 4 del wizard.
//
// Card que invoca POST /api/finance/payments/dry-run con debounce
// (400ms via usePaymentDryRun) y renderiza el resultado.
//
// Tres estados visuales:
//   · VERDE  — will_affect_credit=true (liberara $X de credito del cliente Y)
//   · GRIS   — will_affect_credit=false (no afecta credito)
//   · ROJO   — blocking_error != null (EXPEDIENTE_TERMS_UNDEFINED u otro)
//
// El boton "Registrar pago" del Paso 4 NO se deshabilita cuando hay
// blocking_error — el pago se puede crear en PENDIENTE_AI igual. El
// banner es informativo: el bloqueo real es al LIBERAR credito
// (PATCH /release-credit).
//
// Reglas honradas:
//   R1 — Cero hex literales
//   R5 — tabular-nums en montos
// =====================================================================
import React from "react";
import { usePaymentDryRun } from "../../data/payments.js";
import {
  PAYMENT_ERROR_LABELS,
  getEnumLabel,
} from "../../lib/i18n/payments.js";

/**
 * @param {{
 *   payload: object|null,         // payload del wizard (paso 1+2+3)
 *   lang?: 'es'|'en',
 * }} props
 */
export default function CreditEffectPreview({ payload, lang = "es" }) {
  const { data, loading, error } = usePaymentDryRun(payload, {
    debounceMs: 400,
    enabled:    !!payload,
  });

  // Estado inicial / sin payload.
  if (!payload) {
    return (
      <_Card kind="neutral">
        <div style={{ color: "var(--text-tertiary)" }}>
          {lang === "es"
            ? "Completa los pasos anteriores para ver el efecto sobre crédito."
            : "Complete previous steps to see the credit effect."}
        </div>
      </_Card>
    );
  }

  // Loading: skeleton minimalista para no parpadear.
  if (loading) {
    return (
      <_Card kind="neutral">
        <div style={{ display: "flex", alignItems: "center", gap: 10,
                      color: "var(--text-tertiary)" }}>
          <_Spinner />
          {lang === "es" ? "Calculando efecto sobre crédito..." : "Computing credit effect..."}
        </div>
      </_Card>
    );
  }

  // Error de red (no de validation_errors — ese viene en data).
  if (error && !data) {
    return (
      <_Card kind="critical">
        <div style={{ fontWeight: 600, marginBottom: 6 }}>
          {lang === "es" ? "Error al calcular preview" : "Preview computation failed"}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{error}</div>
      </_Card>
    );
  }

  const preview = data?.credit_preview;
  const validationErrors = Array.isArray(data?.validation_errors)
    ? data.validation_errors
    : [];

  // No preview: shouldn't happen, but safe-guard.
  if (!preview) {
    return (
      <_Card kind="neutral">
        <div style={{ color: "var(--text-tertiary)" }}>
          {lang === "es" ? "Sin información de preview." : "No preview data."}
        </div>
      </_Card>
    );
  }

  // Rojo: blocking_error presente.
  if (preview.blocking_error) {
    const code = preview.blocking_error;
    const label = getEnumLabel(PAYMENT_ERROR_LABELS, code, lang);
    return (
      <_Card kind="critical">
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <span style={{ fontSize: 20, lineHeight: 1 }} aria-hidden>⚠</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, marginBottom: 4,
                          color: "var(--critical)" }}>
              {label}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-primary)",
                          marginBottom: 8 }}>
              {preview.reason}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)",
                          fontStyle: "italic" }}>
              {lang === "es"
                ? "Puedes registrar el pago igual: quedará en estado “Pendiente de verificación”. " +
                  "El bloqueo se aplica solo al momento de liberar crédito."
                : "You can register the payment anyway: it will be in “Pending verification” state. " +
                  "The block only applies at credit release time."}
            </div>
            {validationErrors.length > 0 && (
              <ul style={{ marginTop: 8, paddingLeft: 18,
                           color: "var(--text-secondary)", fontSize: 12 }}>
                {validationErrors.map((v, i) => (
                  <li key={i}>
                    {getEnumLabel(PAYMENT_ERROR_LABELS, v.code, lang)
                      || v.detail || v.code}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </_Card>
    );
  }

  // Gris: no afecta credito.
  if (!preview.will_affect_credit) {
    return (
      <_Card kind="neutral">
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <span style={{ fontSize: 18, lineHeight: 1, opacity: 0.6 }} aria-hidden>○</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              {lang === "es"
                ? "Este pago no afecta el crédito de ningún cliente"
                : "This payment does not affect any client's credit"}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              {preview.reason}
            </div>
          </div>
        </div>
      </_Card>
    );
  }

  // Verde: libera credito.
  const delta = Number(preview.delta_usd || 0);
  return (
    <_Card kind="success">
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span style={{ fontSize: 18, lineHeight: 1, color: "var(--success)" }} aria-hidden>✓</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, marginBottom: 6, color: "var(--success)" }}>
            {lang === "es"
              ? "Al liberar este pago, decrementará el crédito utilizado:"
              : "Releasing this payment will decrement used credit:"}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12,
                        marginBottom: 6, flexWrap: "wrap" }}>
            <span className="tabular-nums" style={{
              fontSize: 22, fontWeight: 800,
              color: "var(--success)",
              fontFamily: "var(--font-mono)",
            }}>
              −${delta.toLocaleString("en-US", {
                minimumFractionDigits: 2, maximumFractionDigits: 2,
              })}
            </span>
            <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>
              {lang === "es" ? "de crédito utilizado de" : "from used credit of"}
            </span>
            <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>
              {preview.target_client_name || preview.target_client_id || "—"}
            </span>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            {preview.reason}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-tertiary)",
                        marginTop: 8, fontStyle: "italic" }}>
            {lang === "es"
              ? "El efecto se aplica recién cuando el CEO presione “Liberar crédito”."
              : "The effect applies only when the CEO clicks “Release credit”."}
          </div>
        </div>
      </div>
    </_Card>
  );
}


// ── Subcomponentes internos ──────────────────────────────────────────
function _Card({ kind = "neutral", children }) {
  const styles = {
    neutral:  {
      background: "var(--bg-alt)",
      border:     "1px solid var(--border)",
    },
    success:  {
      background: "color-mix(in oklab, var(--success) 8%, transparent)",
      border:     "1px solid color-mix(in oklab, var(--success) 36%, transparent)",
    },
    critical: {
      background: "color-mix(in oklab, var(--critical) 8%, transparent)",
      border:     "1px solid color-mix(in oklab, var(--critical) 36%, transparent)",
    },
  };
  return (
    <div
      style={{
        padding: "14px 16px",
        borderRadius: "var(--radius-md)",
        transition: "background 180ms ease, border-color 180ms ease",
        ...styles[kind],
      }}
    >
      {children}
    </div>
  );
}

function _Spinner() {
  return (
    <span
      style={{
        display: "inline-block",
        width: 14,
        height: 14,
        border: "2px solid var(--border)",
        borderTopColor: "var(--brand-primary)",
        borderRadius: "50%",
        animation: "cep-spin 0.8s linear infinite",
      }}
    >
      <style>{`@keyframes cep-spin { to { transform: rotate(360deg); } }`}</style>
    </span>
  );
}
