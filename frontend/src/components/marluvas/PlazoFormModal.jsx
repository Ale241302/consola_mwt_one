// =====================================================================
// MWT.ONE · components/marluvas/PlazoFormModal.jsx
// Agente responsable: [AG-03 FRONTEND]
//
// Fase 4 · Modal para agregar/editar un plazo personalizado en una o
// más bandas. Pregunta:
//   · Días (int > 0)
//   · % sobre 90d (puede ser negativo para descuento)
//   · Alcance: solo banda actual / todas las 12 / personalizar checkbox
//
// Submit emite onSubmit({dias, factor, bandasIds:[]}). El caller aplica
// el plazo a esas bandas — si la banda ya tenía custom, se agrega/
// reemplaza; si no, se materializa con defaults + este plazo.
//
// Modo "editar": si recibe `initial = {dias, factor, bandasIds}`, los
// inputs vienen pre-cargados (caller usa para edit, no para create).
// =====================================================================
import React, { useState, useEffect } from "react";
import { BANDAS_MARLUVAS } from "../../constants/marluvas.js";
import { pctToFactor, factorToPct } from "../../lib/marluvasPricing.js";

const NAVY  = "#0B1E3A";
const MINT  = "#00B286";
const AMBER = "#F59E0B";
const MUTED = "#64748B";
const INK   = "#334155";
const SOFT  = "#F8FAFC";

export default function PlazoFormModal({
  open,
  onClose,
  onSubmit,
  contextBandaId = null,   // banda desde la que se abrió (preselect en "solo esta")
  bandaVigente = null,
  initial = null,           // {dias, factor, bandasIds} para modo editar
  lang = "es",
}) {
  const [dias, setDias] = useState("");
  const [pct, setPct]   = useState("");
  const [alcance, setAlcance] = useState("one");  // "one" | "all" | "custom"
  const [bandasSel, setBandasSel] = useState(() => new Set());
  const [error, setError] = useState(null);

  // Inicializa el form cuando abre.
  useEffect(() => {
    if (!open) return;
    if (initial) {
      setDias(String(initial.dias ?? ""));
      setPct(initial.factor != null ? String(factorToPct(initial.factor).toFixed(2)) : "");
      // Modo editar siempre arranca en "personalizar" con las bandas que ya tiene
      setAlcance("custom");
      setBandasSel(new Set((initial.bandasIds || []).map(String)));
    } else {
      setDias("");
      setPct("");
      setAlcance(contextBandaId ? "one" : "all");
      setBandasSel(contextBandaId ? new Set([String(contextBandaId)]) : new Set());
    }
    setError(null);
  }, [open, initial, contextBandaId]);

  if (!open) return null;

  const isEdit = !!initial;

  const handleSubmit = (e) => {
    e?.preventDefault();
    const diasN = parseInt(dias, 10);
    const pctN  = Number(String(pct).replace(",", "."));
    if (!Number.isFinite(diasN) || diasN < 1 || diasN > 3650) {
      setError(lang === "es" ? "Días debe ser un entero entre 1 y 3650." : "Days must be 1-3650.");
      return;
    }
    if (!Number.isFinite(pctN) || pctN < -100 || pctN > 1000) {
      setError(lang === "es" ? "% debe ser un número entre −100 y 1000." : "% must be -100 to 1000.");
      return;
    }
    let bandasIds = [];
    if (alcance === "one") {
      if (!contextBandaId) {
        setError(lang === "es" ? "Falta banda de contexto." : "Missing context band.");
        return;
      }
      bandasIds = [Number(contextBandaId)];
    } else if (alcance === "all") {
      bandasIds = BANDAS_MARLUVAS.map((b) => b.id);
    } else {
      bandasIds = Array.from(bandasSel).map(Number);
      if (bandasIds.length === 0) {
        setError(lang === "es" ? "Selecciona al menos una banda." : "Select at least one band.");
        return;
      }
    }
    onSubmit?.({
      dias:      diasN,
      factor:    pctToFactor(pctN),
      bandasIds,
    });
    onClose?.();
  };

  const toggleBanda = (id) => setBandasSel((prev) => {
    const n = new Set(prev);
    const k = String(id);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });

  const contextBanda = contextBandaId
    ? BANDAS_MARLUVAS.find((b) => b.id === Number(contextBandaId))
    : null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(11,30,58,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        style={{
          background: "#FFFFFF", borderRadius: 12,
          width: "100%", maxWidth: 540,
          padding: "20px 22px",
          boxShadow: "0 24px 64px rgba(11,30,58,0.32)",
        }}>
        <div style={{ marginBottom: 14 }}>
          <div style={{ font: "700 16px/1.2 var(--font-body)", color: NAVY }}>
            {isEdit
              ? (lang === "es" ? "Editar plazo personalizado" : "Edit custom term")
              : (lang === "es" ? "Agregar plazo personalizado" : "Add custom term")}
          </div>
          <div style={{ font: "500 11.5px/1.4 var(--font-body)", color: MUTED, marginTop: 4 }}>
            {lang === "es"
              ? "Aplica un nuevo plazo (con su % de ajuste sobre 90d) a una o más bandas."
              : "Add a new term (with its % adjustment over 90d) to one or more bands."}
          </div>
        </div>

        {/* Días + % */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
          <div>
            <label style={lblStyle}>{lang === "es" ? "Días" : "Days"}</label>
            <input
              type="number" min={1} max={3650}
              value={dias}
              onChange={(e) => setDias(e.target.value)}
              autoFocus={!isEdit}
              placeholder="120"
              style={inputStyle}/>
            <div style={hintStyle}>{lang === "es" ? "1 – 3650 días" : "1–3650 days"}</div>
          </div>
          <div>
            <label style={lblStyle}>{lang === "es" ? "% sobre 90d" : "% over 90d"}</label>
            <input
              type="number" step="0.01"
              value={pct}
              onChange={(e) => setPct(e.target.value)}
              placeholder="2.00"
              style={inputStyle}/>
            <div style={hintStyle}>
              {lang === "es"
                ? "+ = premium · − = descuento (ej: −1.75)"
                : "+ = premium · − = discount (e.g. −1.75)"}
            </div>
          </div>
        </div>

        {/* Alcance */}
        <div style={{ marginBottom: 14 }}>
          <label style={lblStyle}>{lang === "es" ? "Aplicar a" : "Apply to"}</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {contextBanda && (
              <Radio
                checked={alcance === "one"}
                onChange={() => setAlcance("one")}
                label={lang === "es"
                  ? `Solo banda actual (#${contextBanda.id} · ${contextBanda.rango})`
                  : `Only current band (#${contextBanda.id} · ${contextBanda.rango})`}/>
            )}
            <Radio
              checked={alcance === "all"}
              onChange={() => setAlcance("all")}
              label={lang === "es"
                ? "Todas las 12 bandas"
                : "All 12 bands"}/>
            <Radio
              checked={alcance === "custom"}
              onChange={() => setAlcance("custom")}
              label={lang === "es" ? "Personalizar:" : "Customize:"}/>
          </div>

          {alcance === "custom" && (
            <div style={{
              marginTop: 8, padding: 10,
              background: SOFT, borderRadius: 6,
              display: "flex", flexWrap: "wrap", gap: 6,
            }}>
              {BANDAS_MARLUVAS.map((b) => {
                const checked = bandasSel.has(String(b.id));
                const isCurr = bandaVigente?.id === b.id;
                const tag = b.techo ? " T" : b.piso ? " P" : isCurr ? " V" : "";
                return (
                  <label key={b.id}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      padding: "3px 8px", borderRadius: 14,
                      background: checked ? `${MINT}18` : "#FFFFFF",
                      border: `1px solid ${checked ? MINT : "#CBD5E1"}`,
                      color: checked ? "#065F46" : INK,
                      font: "600 10.5px/1 var(--font-body)",
                      cursor: "pointer",
                      fontVariantNumeric: "tabular-nums",
                    }}>
                    <input
                      type="checkbox" checked={checked}
                      onChange={() => toggleBanda(b.id)}
                      style={{ margin: 0 }}/>
                    #{b.id}{tag}
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {error && (
          <div style={{
            padding: "8px 12px", marginBottom: 12,
            background: "#FEE2E2", color: "#991B1B",
            border: "1px solid #FCA5A5", borderRadius: 6,
            font: "500 12px/1.4 var(--font-body)",
          }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
          <button type="button" onClick={onClose}
            style={{
              padding: "8px 16px", borderRadius: 6,
              border: "1px solid #E5E7EB", background: "#FFFFFF",
              color: INK, font: "600 12px/1 var(--font-body)",
              cursor: "pointer",
            }}>
            {lang === "es" ? "Cancelar" : "Cancel"}
          </button>
          <button type="submit"
            style={{
              padding: "8px 18px", borderRadius: 6,
              border: "none", background: MINT, color: "#FFFFFF",
              font: "700 12px/1 var(--font-body)",
              cursor: "pointer",
            }}>
            {isEdit
              ? (lang === "es" ? "Guardar cambios" : "Save changes")
              : (lang === "es" ? "Agregar plazo" : "Add term")}
          </button>
        </div>
      </form>
    </div>
  );
}

function Radio({ checked, onChange, label }) {
  return (
    <label style={{
      display: "inline-flex", alignItems: "center", gap: 8,
      font: "500 12.5px/1.3 var(--font-body)", color: INK,
      cursor: "pointer",
    }}>
      <input type="radio" checked={checked} onChange={onChange} style={{ margin: 0 }}/>
      <span>{label}</span>
    </label>
  );
}

const lblStyle = {
  display: "block", marginBottom: 4,
  font: "700 10.5px/1 var(--font-body)", color: NAVY,
  textTransform: "uppercase", letterSpacing: 0.5,
};
const inputStyle = {
  width: "100%", padding: "8px 10px",
  border: "1px solid #CBD5E1", borderRadius: 5,
  font: "600 13px/1.2 var(--font-body)", color: NAVY,
  outline: "none", fontVariantNumeric: "tabular-nums",
};
const hintStyle = {
  marginTop: 3, font: "500 10px/1.3 var(--font-body)", color: MUTED,
};
