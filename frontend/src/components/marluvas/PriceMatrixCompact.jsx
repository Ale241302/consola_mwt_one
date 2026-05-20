// =====================================================================
// MWT.ONE · components/marluvas/PriceMatrixCompact.jsx
// Agente responsable: [AG-03 FRONTEND]
//
// Matriz de precios Marluvas — N bandas × M plazos POR BANDA (variable).
// Fase 4: cada banda puede tener sus propios plazos (custom o defaults).
// Bandas sin entrada en `customPlazos` usan defaults [90/60/30/8d].
//
// Pills arriba para filtrar bandas:
//   · Esenciales  → techo + (vigente si aplica) + piso (~3 bandas)
//   · Vigente     → solo banda activa según TC
//   · 12 bandas   → matriz completa con scroll-X interno
//
// Cada celda es editable con cascade jerárquico (heredado de Fase 2):
//   90d (factor=1.0) → "ancla": recalcula otros plazos con factores.
//   plazo no-ancla    → cascade lateral local (solo plazos más cortos).
//
// Props:
//   · matrix             { "<bandaId>": {"<plazoDias>": <precio>} }
//   · onCellChange       (bandaId, plazoDias, newValue) => void
//   · customPlazos       { "<bandaId>": [{dias, factor}] } — Fase 4
//   · onRemovePlazo?     (bandaId, plazoDias) => void  — Fase 4
//   · onAddPlazoBanda?   (bandaId) => void             — Fase 4 (botón + por banda)
//   · onResetBandPlazos? (bandaId) => void             — Fase 4 (botón ↺ por banda)
//   · onAddPlazoGlobal?  () => void                    — Fase 4 (botón + en toolbar)
//   · bandaVigente?      banda activa según TC (resaltada)
//   · readOnly?          si true, celdas no editables y ✕/↺ ocultos
//   · maxHeight?         altura máxima del scroll vertical (default '52vh')
//   · defaultFilter?     "essentials" | "current" | "all" (default "essentials")
// =====================================================================
import React, { useState, useRef, useMemo } from "react";
import { BANDAS_MARLUVAS, PLAZOS_MARLUVAS } from "../../constants/marluvas.js";
import { getBandPlazos } from "../../lib/marluvasPricing.js";

// ─── Design tokens ───
const NAVY = "#0B1E3A";
const INK = "#475569";
const MUTED = "#64748B";
const AMBER = "#F59E0B";
const MINT = "#00B286";
const SOFT = "#F8FAFC";

const BAND_BG_TECHO = "#FEF3E7";
const BAND_BG_PISO = "#ECFDF5";
const BAND_BG_CURRENT = "#FEF3C7";
const BAND_BG_NEUTRAL = "#F8FAFC";

const BAND_FG_TECHO = "#9A4A1D";
const BAND_FG_PISO = "#065F46";
const BAND_FG_CURRENT = "#92400E";

function bandColors(b, isCurrent) {
  if (b.techo)   return { bg: BAND_BG_TECHO,   fg: BAND_FG_TECHO   };
  if (b.piso)    return { bg: BAND_BG_PISO,    fg: BAND_FG_PISO    };
  if (isCurrent) return { bg: BAND_BG_CURRENT, fg: BAND_FG_CURRENT };
  return { bg: BAND_BG_NEUTRAL, fg: NAVY };
}

const isBaseFactor = (factor) => Math.abs(Number(factor) - 1) < 0.0001;

// ─── Componente principal ───
export default function PriceMatrixCompact({
  matrix,
  onCellChange,
  customPlazos = null,
  onRemovePlazo = null,
  onAddPlazoBanda = null,
  onResetBandPlazos = null,
  onAddPlazoGlobal = null,
  bandaVigente = null,
  readOnly = false,
  maxHeight = "52vh",
  defaultFilter = "essentials",
}) {
  const m = matrix || {};
  const [bandFilter, setBandFilter] = useState(defaultFilter);

  // Bandas filtradas — mismo criterio que BrandClientPricingForm.
  const filteredBands = useMemo(() => {
    if (bandFilter === "all") return BANDAS_MARLUVAS;
    if (bandFilter === "current") {
      return bandaVigente ? [bandaVigente] : [BANDAS_MARLUVAS[0]];
    }
    const out = [BANDAS_MARLUVAS[0]];
    if (bandaVigente && bandaVigente.id !== 1 && bandaVigente.id !== 12) {
      out.push(bandaVigente);
    }
    out.push(BANDAS_MARLUVAS[11]);
    return out;
  }, [bandFilter, bandaVigente]);

  // Plazos efectivos por banda. customPlazos puede mover el total de cols.
  const plazosPorBanda = useMemo(() => {
    const map = new Map();
    for (const b of filteredBands) {
      map.set(b.id, getBandPlazos(b.id, customPlazos));
    }
    return map;
  }, [filteredBands, customPlazos]);

  const totalPlazos = useMemo(() => {
    let n = 0;
    for (const arr of plazosPorBanda.values()) n += arr.length;
    return n;
  }, [plazosPorBanda]);

  const hasAnyCustom = customPlazos
    && Object.keys(customPlazos).length > 0;

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr)",
      gap: 8,
      width: "100%", maxWidth: "100%", minWidth: 0,
    }}>
      {/* Toolbar: filtro de bandas + contador + botón + Agregar plazo */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        gap: 10, flexWrap: "wrap",
      }}>
        <div style={{
          display: "inline-flex", gap: 2, padding: 3,
          background: SOFT, borderRadius: 7, border: "1px solid #E5E7EB",
        }}>
          {[
            { v: "essentials", l: "Esenciales" },
            { v: "current",    l: "Vigente"    },
            { v: "all",        l: "12 bandas"  },
          ].map((opt) => {
            const on = bandFilter === opt.v;
            return (
              <button key={opt.v} type="button"
                onClick={() => setBandFilter(opt.v)}
                style={{
                  padding: "4px 10px",
                  background: on ? "#FFFFFF" : "transparent",
                  border: on ? "1px solid #E5E7EB" : "1px solid transparent",
                  color: on ? NAVY : MUTED,
                  font: `${on ? 700 : 600} 10.5px/1 var(--font-body)`,
                  borderRadius: 5, cursor: "pointer",
                  boxShadow: on ? "0 1px 2px rgba(11,30,58,0.06)" : "none",
                  transition: "all 120ms ease",
                }}>{opt.l}</button>
            );
          })}
        </div>
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          font: "500 10.5px/1.4 var(--font-body)", color: MUTED,
          fontVariantNumeric: "tabular-nums", flexWrap: "wrap",
        }}>
          <span>
            <strong style={{ color: NAVY, fontWeight: 700 }}>{filteredBands.length}</strong>
            {" bandas · "}
            <strong style={{ color: NAVY, fontWeight: 700 }}>{totalPlazos}</strong>
            {" plazos"}
          </span>
          {hasAnyCustom && (
            <span style={{
              padding: "2px 8px", borderRadius: 10,
              background: `${AMBER}18`, color: "#92400E",
              font: "700 9px/1 var(--font-body)",
              border: `1px solid ${AMBER}55`,
              textTransform: "uppercase", letterSpacing: 0.4,
            }} title="Hay bandas con plazos custom">
              {Object.keys(customPlazos).length} con custom
            </span>
          )}
          {!readOnly && onAddPlazoGlobal && (
            <button type="button"
              onClick={() => onAddPlazoGlobal()}
              style={{
                padding: "5px 11px", borderRadius: 5,
                border: `1px solid ${MINT}`, background: `${MINT}10`,
                color: "#065F46",
                font: "700 10.5px/1 var(--font-body)",
                cursor: "pointer",
                display: "inline-flex", alignItems: "center", gap: 4,
              }}
              title="Agregar plazo personalizado a una o más bandas">
              + Agregar plazo
            </button>
          )}
        </div>
      </div>

      {/* Tabla con scroll-X interno */}
      <div style={{
        overflowX: "auto", maxHeight,
        width: "100%", maxWidth: "100%", minWidth: 0,
        border: "1px solid #E5E7EB", borderRadius: 8,
        background: "#FFFFFF",
        boxSizing: "border-box",
      }}>
        <table style={{
          borderCollapse: "separate", borderSpacing: 0,
          // Width policy:
          //   · "all" filter → auto (12 bandas × 4+ plazos no caben → scroll-X)
          //   · resto (essentials/current con ≤ ~6 bandas) → 100% incluso con
          //     plazos custom, así las columnas se distribuyen uniformemente.
          //     min-width 64 por <th> garantiza legibilidad sin overflow.
          width: bandFilter === "all" ? "auto" : "100%",
        }}>
          <thead>
            {/* Header row 1: bandas (colspan = #plazos de esa banda) */}
            <tr>
              {filteredBands.map((b) => {
                const isCurrent = bandaVigente?.id === b.id;
                const { bg, fg } = bandColors(b, isCurrent);
                const bandPlazos = plazosPorBanda.get(b.id) || [];
                const hasCustom = !!(customPlazos && customPlazos[String(b.id)]);
                return (
                  <th key={b.id} colSpan={bandPlazos.length || 1} style={{
                    position: "sticky", top: 0, zIndex: 4,
                    background: bg, color: fg,
                    padding: "8px 6px 6px 6px",
                    textAlign: "center",
                    borderLeft: `2px solid ${isCurrent ? AMBER : "#E5E7EB"}`,
                    borderBottom: "1px solid #E5E7EB",
                  }}>
                    <div style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      font: "700 10.5px/1.2 var(--font-body)",
                    }}>
                      {b.rango}
                      {!readOnly && hasCustom && onResetBandPlazos && (
                        <button type="button"
                          onClick={() => {
                            if (window.confirm(
                              `¿Resetear plazos de banda ${b.rango} a defaults [90/60/30/8d]?`
                            )) onResetBandPlazos(b.id);
                          }}
                          style={miniBtn(fg)}
                          title="Resetear plazos de esta banda a defaults">↺</button>
                      )}
                      {!readOnly && onAddPlazoBanda && (
                        <button type="button"
                          onClick={() => onAddPlazoBanda(b.id)}
                          style={miniBtn(fg)}
                          title="Agregar plazo a esta banda">+</button>
                      )}
                    </div>
                    <div style={{
                      font: "500 9px/1 var(--font-mono, ui-monospace)",
                      opacity: 0.75, marginTop: 2, fontVariantNumeric: "tabular-nums",
                    }}>÷{b.div.toFixed(2)}</div>
                    {(b.techo || b.piso || isCurrent) && (
                      <div style={{
                        display: "inline-block", marginTop: 3,
                        padding: "1px 6px", borderRadius: 8,
                        background: "rgba(255,255,255,0.55)",
                        font: "700 8px/1 var(--font-body)",
                        textTransform: "uppercase", letterSpacing: 0.5,
                      }}>
                        {b.techo ? "techo" : b.piso ? "piso" : "vigente"}
                      </div>
                    )}
                    {hasCustom && (
                      <div style={{
                        display: "inline-block", marginTop: 3, marginLeft: 4,
                        padding: "1px 6px", borderRadius: 8,
                        background: `${AMBER}25`, color: "#92400E",
                        font: "700 7.5px/1 var(--font-body)",
                        textTransform: "uppercase", letterSpacing: 0.5,
                      }} title="Plazos custom">
                        {bandPlazos.length} plazos
                      </div>
                    )}
                  </th>
                );
              })}
            </tr>
            {/* Header row 2: plazos individuales por banda */}
            <tr>
              {filteredBands.flatMap((b) => {
                const isCurrent = bandaVigente?.id === b.id;
                const { bg } = bandColors(b, isCurrent);
                const bandPlazos = plazosPorBanda.get(b.id) || [];
                return bandPlazos.map((p, pi) => {
                  const isBase = isBaseFactor(p.factor);
                  return (
                    <th key={`${b.id}-${p.dias}`} style={{
                      position: "sticky", top: 56, zIndex: 4,
                      background: isBase ? bg : "#FFFFFF",
                      color: NAVY,
                      padding: "5px 4px 6px 4px",
                      textAlign: "center",
                      minWidth: 64,
                      borderLeft: pi === 0
                        ? `2px solid ${isCurrent ? AMBER : "#E5E7EB"}`
                        : "1px solid transparent",
                      borderBottom: "1px solid #E5E7EB",
                    }}>
                      <div style={{
                        display: "inline-flex", alignItems: "center", gap: 3,
                        font: "700 10px/1 var(--font-body)",
                      }}>
                        {p.dias}d
                        {!readOnly && onRemovePlazo && (
                          <button type="button"
                            onClick={() => onRemovePlazo(b.id, p.dias)}
                            style={{
                              width: 14, height: 14, padding: 0, borderRadius: 3,
                              border: "1px solid transparent", background: "transparent",
                              color: MUTED, cursor: "pointer",
                              font: "700 10px/1 var(--font-body)",
                              display: "inline-flex", alignItems: "center", justifyContent: "center",
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = "#FEE2E2";
                              e.currentTarget.style.color = "#991B1B";
                              e.currentTarget.style.borderColor = "#FCA5A5";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = "transparent";
                              e.currentTarget.style.color = MUTED;
                              e.currentTarget.style.borderColor = "transparent";
                            }}
                            title={`Quitar ${p.dias}d de esta banda`}>✕</button>
                        )}
                      </div>
                      <div style={{
                        font: `${isBase ? 600 : 500} 8.5px/1 var(--font-body)`,
                        opacity: 0.7, marginTop: 2,
                      }}>
                        {p.sub}
                      </div>
                    </th>
                  );
                });
              })}
            </tr>
          </thead>
          <tbody>
            <tr>
              {filteredBands.flatMap((b) => {
                const isCurrent = bandaVigente?.id === b.id;
                const row = m[String(b.id)] || {};
                const bandPlazos = plazosPorBanda.get(b.id) || [];
                return bandPlazos.map((p, pi) => {
                  let price = Number(row[String(p.dias)]);
                  // Si no está en matrix (plazo custom recién agregado),
                  // lo calculamos on-the-fly: lista90 × factor.
                  if (!Number.isFinite(price)) {
                    const lista90 = Number(row["90"]);
                    if (Number.isFinite(lista90)) {
                      price = lista90 * Number(p.factor);
                    } else {
                      price = 0;
                    }
                  }
                  const isBase = isBaseFactor(p.factor);
                  return (
                    <td key={`${b.id}-${p.dias}`} style={{
                      padding: "8px 6px",
                      textAlign: "right",
                      fontFamily: "var(--font-mono, ui-monospace)",
                      fontVariantNumeric: "tabular-nums",
                      fontSize: 11.5,
                      fontWeight: isBase ? 700 : 500,
                      color: isBase ? NAVY : INK,
                      background: isBase ? "#FFFFFF" : "#FAFBFC",
                      borderLeft: pi === 0
                        ? `2px solid ${isCurrent ? AMBER : "#E5E7EB"}`
                        : "1px solid transparent",
                      borderBottom: "1px solid #F1F5F9",
                    }}>
                      {readOnly ? (
                        <span>{formatCellValue(price)}</span>
                      ) : (
                        <MtxCellInput
                          value={price}
                          onCommit={(v) => onCellChange?.(b.id, p.dias, v)}
                          isBase={isBase}
                        />
                      )}
                    </td>
                  );
                });
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Estilo mini-botón en header de banda ───
function miniBtn(fg) {
  return {
    width: 16, height: 16, padding: 0, borderRadius: 3,
    border: `1px solid ${fg}33`,
    background: "rgba(255,255,255,0.6)",
    color: fg, cursor: "pointer",
    font: "700 10px/1 var(--font-body)",
    display: "inline-flex", alignItems: "center", justifyContent: "center",
  };
}

// ─── MtxCellInput · plano hasta hover, input al click ───
function MtxCellInput({ value, onCommit, isBase }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef(null);

  const display = formatCellValue(value);

  const startEdit = () => {
    setDraft(Number(value || 0).toFixed(4).replace(/\.?0+$/, ""));
    setEditing(true);
    setTimeout(() => inputRef.current?.select?.(), 0);
  };
  const commit = () => {
    const n = Number(String(draft).replace(",", "."));
    setEditing(false);
    if (Number.isFinite(n) && Math.abs(n - Number(value)) > 0.001) onCommit(n);
  };
  const cancel = () => setEditing(false);

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number" step="0.01" min={0}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") { e.preventDefault(); cancel(); }
        }}
        style={{
          width: "100%", padding: "3px 4px",
          border: `1.5px solid ${MINT}`, borderRadius: 4, outline: "none",
          background: "#FFFFFF", color: NAVY,
          fontFamily: "var(--font-mono, ui-monospace)",
          fontVariantNumeric: "tabular-nums",
          fontSize: 11.5, fontWeight: isBase ? 700 : 500,
          textAlign: "right",
        }}/>
    );
  }
  return (
    <button type="button" onClick={startEdit}
      style={{
        width: "100%", padding: "3px 4px",
        border: "1px solid transparent", background: "transparent",
        color: "inherit", cursor: "text",
        fontFamily: "var(--font-mono, ui-monospace)",
        fontVariantNumeric: "tabular-nums",
        fontSize: 11.5, fontWeight: isBase ? 700 : 500,
        textAlign: "right", borderRadius: 4,
        transition: "background 100ms, border 100ms",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(0,176,134,0.06)";
        e.currentTarget.style.border = "1px solid rgba(0,176,134,0.25)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.border = "1px solid transparent";
      }}>
      {display}
    </button>
  );
}

function formatCellValue(n) {
  const v = Number(n || 0);
  if (v >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return v.toFixed(2);
}

export { MtxCellInput, formatCellValue };
