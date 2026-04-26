// =====================================================================
// MWT.ONE · components/proveedores/NewIsoEvaluationModal.jsx
// Agente responsable: [AG-FRONTEND]
//
// Modal "Registrar nueva auditoría ISO" — PLB_SUPPLIER_EVAL.
// El usuario califica 5 criterios del 1 al 5 con sliders. La preview
// del score total y la decisión se muestran en vivo (computadas en
// cliente) — pero la fuente de verdad es el backend, que recalcula y
// almacena los valores correctos. Por eso el FE NO envía score_total
// ni decision en el body.
// =====================================================================
import React, { useState, useMemo } from "react";
import { motion } from "framer-motion";
import FileUploader from "../common/FileUploader.jsx";

// Copia idéntica de los pesos del backend (PLB_SUPPLIER_EVAL).
// Si esto se desincroniza, la preview engaña al usuario — el backend
// igual graba el cálculo correcto.
const WEIGHTS = [
  { key: "score_calidad",      label_es: "Calidad",            label_en: "Quality",       w: 0.30 },
  { key: "score_entrega",      label_es: "Entrega",            label_en: "Delivery",      w: 0.25 },
  { key: "score_comunicacion", label_es: "Comunicación",       label_en: "Communication", w: 0.15 },
  { key: "score_tecnica",      label_es: "Capacidad técnica",  label_en: "Tech capacity", w: 0.15 },
  { key: "score_precio",       label_es: "Precio / valor",     label_en: "Price / value", w: 0.15 },
];

const DECISION_META = {
  MANTENER:     { es: "Mantener",       en: "Keep",          color: "#0E8A6D", soft: "rgba(14,138,109,0.14)" },
  MONITOREAR:   { es: "Monitorear",     en: "Monitor",       color: "#B45309", soft: "rgba(180,83,9,0.14)"  },
  PLAN_MEJORA:  { es: "Plan de mejora", en: "Improvement",   color: "#EA580C", soft: "rgba(234,88,12,0.14)" },
  DESCONTINUAR: { es: "Descontinuar",   en: "Discontinue",   color: "#DC2626", soft: "rgba(220,38,38,0.14)" },
};

function computePreview(scores) {
  let total = 0;
  for (const w of WEIGHTS) total += (Number(scores[w.key]) || 0) * w.w;
  total = Math.round(total * 100) / 100;
  let decision = "DESCONTINUAR";
  if (total >= 4.0)      decision = "MANTENER";
  else if (total >= 3.0) decision = "MONITOREAR";
  else if (total >= 2.0) decision = "PLAN_MEJORA";
  return { total, decision };
}

// Sugerir período del trimestre actual.
function defaultPeriodo() {
  const d = new Date();
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `Q${q}-${d.getFullYear()}`;
}

export default function NewIsoEvaluationModal({
  supplierName = "",
  lang         = "es",
  onClose,
  onSubmit,                  // async (body) => res
}) {
  const [periodo,      setPeriodo]      = useState(defaultPeriodo());
  const [scores,       setScores]       = useState({
    score_calidad: 4, score_entrega: 4, score_comunicacion: 4,
    score_tecnica: 4, score_precio: 4,
  });
  const [comentarios,  setComentarios]  = useState("");
  const [evidenceKey,  setEvidenceKey]  = useState("");   // storage key MinIO
  const [busy,         setBusy]         = useState(false);
  const [error,        setError]        = useState(null);

  const setScore = (k, v) => setScores(s => ({ ...s, [k]: Number(v) }));

  // Live preview — cálculo idéntico al backend
  const preview = useMemo(() => computePreview(scores), [scores]);
  const meta    = DECISION_META[preview.decision] || DECISION_META.DESCONTINUAR;

  const canSave = !!periodo.trim() && !busy;

  const handleConfirm = async () => {
    setError(null);
    setBusy(true);
    try {
      // ⚠ NO enviamos score_total ni decision — el backend los calcula.
      const body = {
        periodo: periodo.trim(),
        score_calidad:      scores.score_calidad,
        score_entrega:      scores.score_entrega,
        score_comunicacion: scores.score_comunicacion,
        score_tecnica:      scores.score_tecnica,
        score_precio:       scores.score_precio,
        comentarios:        comentarios || null,
        documento_evidencia: evidenceKey || null,
      };
      await onSubmit(body);
      onClose?.();
    } catch (e) {
      let msg = String(e?.message || e);
      try {
        const parsed = JSON.parse(msg);
        if (parsed && typeof parsed === "object") {
          msg = Object.entries(parsed)
            .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
            .join("  ·  ");
        }
      } catch (_) {}
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={busy ? undefined : onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 9000,
          background: "rgba(15,27,61,0.45)", backdropFilter: "blur(2px)",
        }}
      />
      {/* Tarjeta */}
      <motion.div
        initial={{ opacity: 0, y: -12, x: "-50%" }}
        animate={{ opacity: 1, y: 0,   x: "-50%", transition: { duration: 0.18 } }}
        exit   ={{ opacity: 0, y: -12, x: "-50%", transition: { duration: 0.12 } }}
        role="dialog" aria-modal="true"
        style={{
          position: "fixed", top: "6vh", left: "50%",
          width: "min(720px, 96vw)",
          maxHeight: "88vh",
          zIndex: 9001,
          background: "#FFFFFF", borderRadius: 14,
          boxShadow: "0 30px 60px -20px rgba(15,27,61,0.45)",
          fontFamily: "inherit",
          display: "flex", flexDirection: "column",
        }}
      >
        {/* Header */}
        <div style={{ padding: "22px 22px 12px" }}>
          <div style={{
            font: "600 11px/1 inherit", color: "#3083FE",
            letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8,
          }}>
            {lang === "es" ? "AUDITORÍA ISO 9001 §8.4" : "ISO 9001 §8.4 AUDIT"}
          </div>
          <div style={{ font: "700 17px/1.3 inherit", color: "#0F1B3D", marginBottom: 4 }}>
            {lang === "es" ? "Registrar nueva auditoría" : "New evaluation"}
          </div>
          <div style={{ font: "500 12.5px/1.4 inherit", color: "#64748B" }}>
            {(lang === "es" ? "Calificá cada eje del 1 al 5. Score total y decisión los calcula el backend (PLB_SUPPLIER_EVAL). " : "Rate each axis 1 to 5. Total score and decision are computed by backend. ")}
            {supplierName && <strong style={{ color: "#0F1B3D" }}>{supplierName}</strong>}
          </div>
        </div>

        {/* Body scrollable */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 22px 12px" }}>
          {/* Periodo */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", font: "600 11.5px/1 inherit", color: "#3D4A6B", marginBottom: 6 }}>
              {lang === "es" ? "Período" : "Period"} *
            </label>
            <input
              className="input mono-sm"
              type="text"
              placeholder="Q2-2026"
              value={periodo}
              onChange={(e) => setPeriodo(e.target.value)}
              disabled={busy}
              style={{ maxWidth: 200 }}
            />
          </div>

          {/* Sliders */}
          <div style={{ marginBottom: 16 }}>
            <div style={{
              font: "600 11.5px/1 inherit", color: "#3D4A6B",
              letterSpacing: "0.04em", marginBottom: 8,
            }}>
              {lang === "es" ? "Calificación por criterio (1=Pésimo · 5=Excelente)" : "Score per criterion (1=Bad · 5=Excellent)"}
            </div>
            {WEIGHTS.map(w => {
              const val = scores[w.key];
              return (
                <div key={w.key} style={{
                  display: "grid",
                  gridTemplateColumns: "180px 1fr 56px",
                  alignItems: "center", gap: 12,
                  padding: "8px 0", borderBottom: "1px solid #F1F5F9",
                }}>
                  <div>
                    <div style={{ font: "600 13px/1.3 inherit", color: "#0F1B3D" }}>
                      {lang === "es" ? w.label_es : w.label_en}
                    </div>
                    <div style={{ font: "500 11px/1 inherit", color: "#64748B" }}>
                      {lang === "es" ? "Peso" : "Weight"}: {(w.w * 100).toFixed(0)}%
                    </div>
                  </div>
                  <input
                    type="range" min="1" max="5" step="1"
                    value={val}
                    disabled={busy}
                    onChange={(e) => setScore(w.key, e.target.value)}
                    style={{ width: "100%", accentColor: "#3083FE" }}
                  />
                  <div style={{
                    font: "700 16px/1 ui-monospace, monospace",
                    color: val >= 4 ? "#0E8A6D" : val >= 3 ? "#B45309" : "#DC2626",
                    textAlign: "right", paddingRight: 6,
                  }}>
                    {val}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Live preview */}
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12,
            padding: 14, borderRadius: 10,
            background: "#F8FAFC", border: "1px solid #E5E7EB",
            marginBottom: 14,
          }}>
            <div>
              <div style={{ font: "500 11px/1 inherit", color: "#64748B", marginBottom: 4 }}>
                {lang === "es" ? "Score total (preview)" : "Total score (preview)"}
              </div>
              <div style={{
                font: "700 28px/1 ui-monospace, monospace",
                color: meta.color,
              }}>
                {preview.total.toFixed(2)}
              </div>
            </div>
            <div>
              <div style={{ font: "500 11px/1 inherit", color: "#64748B", marginBottom: 4 }}>
                {lang === "es" ? "Decisión sugerida" : "Suggested decision"}
              </div>
              <div style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "6px 12px", borderRadius: 999,
                background: meta.soft, color: meta.color,
                font: "700 12.5px/1 inherit",
              }}>
                <span style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: meta.color, display: "inline-block",
                }} />
                {lang === "es" ? meta.es : meta.en}
              </div>
              <div style={{ font: "500 11px/1.4 inherit", color: "#64748B", marginTop: 4 }}>
                {lang === "es"
                  ? "Calculado por el backend al guardar (PLB_SUPPLIER_EVAL)."
                  : "Final value computed server-side at save."}
              </div>
            </div>
          </div>

          {/* Comentarios */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", font: "600 11.5px/1 inherit", color: "#3D4A6B", marginBottom: 6 }}>
              {lang === "es" ? "Comentarios / hallazgos" : "Comments / findings"}
            </label>
            <textarea
              className="input" rows={3}
              placeholder={lang === "es"
                ? "Ej: lead time empeoró 8 días vs trimestre anterior; entrega Q1 con 12% rechazos."
                : "E.g. lead time slipped 8 days vs prior quarter; Q1 had 12% rejections."}
              value={comentarios}
              onChange={(e) => setComentarios(e.target.value)}
              disabled={busy}
              style={{ width: "100%", resize: "vertical" }}
            />
          </div>

          {/* Evidencia (PDF/imagen opcional via storage proxy) */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", font: "600 11.5px/1 inherit", color: "#3D4A6B", marginBottom: 6 }}>
              {lang === "es" ? "Documento de evidencia (PDF/imagen, opcional)" : "Evidence document (PDF/image, optional)"}
            </label>
            <FileUploader
              folder="iso_audits"
              accept="application/pdf,image/*"
              onUploaded={(key) => setEvidenceKey(key)}
              onError={(msg) => setError(msg)}
              disabled={busy}
            />
            {evidenceKey && (
              <div style={{
                marginTop: 6, padding: "6px 10px", borderRadius: 6,
                background: "#ECFDF5", border: "1px solid #A7F3D0",
                color: "#065F46", font: "500 12px ui-monospace, monospace",
                wordBreak: "break-all",
              }}>
                ✓ {evidenceKey}
              </div>
            )}
          </div>
        </div>

        {error && (
          <div style={{
            margin: "0 22px 8px", padding: "10px 12px", borderRadius: 8,
            background: "#FEE2E2", border: "1px solid #FCA5A5", color: "#991B1B",
            font: "500 12.5px/1.4 inherit",
          }}>
            {error}
          </div>
        )}

        {/* Footer */}
        <div style={{
          padding: "14px 22px 18px",
          display: "flex", gap: 10, justifyContent: "flex-end",
          borderTop: "1px solid #F1F5F9",
        }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            {lang === "es" ? "Cancelar" : "Cancel"}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canSave}
            style={{
              padding: "10px 18px", borderRadius: 9,
              background: canSave ? meta.color : "#94a3b888",
              color: "#FFFFFF", border: "none",
              cursor: canSave ? "pointer" : "not-allowed",
              font: "700 13.5px/1 inherit",
              boxShadow: canSave ? `0 4px 10px ${meta.color}55` : "none",
            }}
          >
            {busy
              ? (lang === "es" ? "Guardando…" : "Saving…")
              : (lang === "es" ? "Registrar auditoría" : "Save evaluation")}
          </button>
        </div>
      </motion.div>
    </>
  );
}
