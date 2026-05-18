// =====================================================================
// MWT.ONE · components/marluvas/PriceMatrixCompact.jsx
// Agente responsable: [AG-03 FRONTEND]
//
// Matriz de precios Marluvas — 12 bandas × 4 plazos para UN solo SKU.
// Por defecto muestra solo "Esenciales" (techo + piso, ≈ 8 columnas)
// para que CABE en la pantalla sin scroll horizontal global. Pills
// arriba para alternar a "Vigente" (solo banda activa) o "12 bandas"
// (matriz completa, activa scroll horizontal interno).
//
// Diseño consistente con la vista cliente-marca (BrandClientPricingForm).
//
// Cada celda es un input editable con cascade jerárquico:
//   90d → recalcula 60/30/8d con factores originales (0.99/0.9825/0.9725)
//   60d → recalcula 30/8d con ratios relativos (no toca 90d)
//   30d → recalcula 8d (no toca 90/60d)
//   8d  → terminal
//
// Props:
//   · matrix             { "<bandaId>": {"<plazoDias>": <precio>} }
//   · onCellChange       (bandaId, plazoDias, newValue) => void
//   · bandaVigente?      banda activa según TC (resaltada)
//   · readOnly?          si true, celdas no editables
//   · maxHeight?         altura máxima del scroll vertical (default '52vh')
//   · defaultFilter?     "essentials" | "current" | "all" (default "essentials")
// =====================================================================
import React, { useState, useRef, useMemo } from "react";
import { BANDAS_MARLUVAS, PLAZOS_MARLUVAS } from "../../constants/marluvas.js";

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

// ─── Componente principal ───
export default function PriceMatrixCompact({
  matrix,
  onCellChange,
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
    // essentials: techo + vigente (si no coincide con techo/piso) + piso.
    const out = [BANDAS_MARLUVAS[0]];
    if (bandaVigente && bandaVigente.id !== 1 && bandaVigente.id !== 12) {
      out.push(bandaVigente);
    }
    out.push(BANDAS_MARLUVAS[11]);
    return out;
  }, [bandFilter, bandaVigente]);

  return (
    // display:grid + grid-template-columns:minmax(0, 1fr) es la técnica
    // bulletproof para forzar a un hijo (el wrapper de la tabla con
    // overflow-x:auto) a respetar el ancho del padre. Sin esto, el
    // min-width:auto default permite que el hijo crezca según contenido
    // natural y arrastra todo el layout fuera del viewport.
    <div style={{
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr)",
      gap: 8,
      width: "100%", maxWidth: "100%", minWidth: 0,
    }}>
      {/* Toolbar de filtro */}
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
          font: "500 10.5px/1.4 var(--font-body)", color: MUTED,
          fontVariantNumeric: "tabular-nums",
        }}>
          <strong style={{ color: NAVY, fontWeight: 700 }}>{filteredBands.length}</strong>
          {" bandas · "}
          <strong style={{ color: NAVY, fontWeight: 700 }}>{filteredBands.length * 4}</strong>
          {" plazos"}
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
          // Si el filtro es "essentials" o "current" la tabla cabe naturalmente.
          // Si es "all", la tabla excede el wrapper y aparece scrollbar-X interno.
          borderCollapse: "separate", borderSpacing: 0,
          width: bandFilter === "all" ? "auto" : "100%",
        }}>
          <thead>
            <tr>
              {filteredBands.map((b) => {
                const isCurrent = bandaVigente?.id === b.id;
                const { bg, fg } = bandColors(b, isCurrent);
                return (
                  <th key={b.id} colSpan={4} style={{
                    position: "sticky", top: 0, zIndex: 4,
                    background: bg, color: fg,
                    padding: "8px 6px 6px 6px",
                    textAlign: "center",
                    borderLeft: `2px solid ${isCurrent ? AMBER : "#E5E7EB"}`,
                    borderBottom: "1px solid #E5E7EB",
                  }}>
                    <div style={{ font: "700 10.5px/1.2 var(--font-body)" }}>{b.rango}</div>
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
                  </th>
                );
              })}
            </tr>
            <tr>
              {filteredBands.flatMap((b) => {
                const isCurrent = bandaVigente?.id === b.id;
                const { bg } = bandColors(b, isCurrent);
                return PLAZOS_MARLUVAS.map((p, pi) => (
                  <th key={`${b.id}-${p.dias}`} style={{
                    position: "sticky", top: 56, zIndex: 4,
                    background: pi === 0 ? bg : "#FFFFFF",
                    color: NAVY,
                    padding: "5px 4px 6px 4px",
                    textAlign: "center",
                    minWidth: 58,
                    borderLeft: pi === 0
                      ? `2px solid ${isCurrent ? AMBER : "#E5E7EB"}`
                      : "1px solid transparent",
                    borderBottom: "1px solid #E5E7EB",
                  }}>
                    <div style={{ font: "700 10px/1 var(--font-body)" }}>{p.dias}d</div>
                    <div style={{
                      font: `${pi === 0 ? 600 : 500} 8.5px/1 var(--font-body)`,
                      opacity: 0.7, marginTop: 2,
                    }}>
                      {pi === 0 ? "base" : p.sub}
                    </div>
                  </th>
                ));
              })}
            </tr>
          </thead>
          <tbody>
            <tr>
              {filteredBands.flatMap((b) => {
                const isCurrent = bandaVigente?.id === b.id;
                const row = m[String(b.id)] || {};
                return PLAZOS_MARLUVAS.map((p, pi) => {
                  const price = Number(row[String(p.dias)] ?? 0);
                  const isBase = pi === 0;
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
                      borderLeft: isBase
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
