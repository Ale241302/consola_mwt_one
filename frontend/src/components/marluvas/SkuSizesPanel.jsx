// =====================================================================
// MWT.ONE · components/marluvas/SkuSizesPanel.jsx
// Agente responsable: [AG-03 FRONTEND]
//
// Fase 3 · Panel de overrides por TALLA dentro de un SKU. Renderiza una
// card mini por cada talla asignada al SKU (vía useSkuTallas), cada una
// con su propio selector de ancla y una matriz 12×4 compacta editable.
//
// Estado de la talla:
//   · Sin override → matriz visualmente atenuada (heredada del SKU).
//                    Al editar CUALQUIER celda, se materializa el
//                    override (clona la matriz del SKU como punto de
//                    partida).
//   · Con override → matriz con colores normales + botón "Resetear".
//
// Props:
//   · sku                 SkuInput (con .matrix, .anchor opcional, .sizes_pricing opcional)
//   · skuIdx              índice del SKU en el state padre (para los callbacks)
//   · bandaVigente        banda activa según TC
//   · globalAnchor        ancla global del editor (fallback)
//   · onSizeMatrixCell    (skuIdx, tallaUuid, bandaId, plazoDias, value) => void
//   · onSizeAnchor        (skuIdx, tallaUuid, partial)                   => void
//   · onSizeReset         (skuIdx, tallaUuid)                            => void
//   · lang
// =====================================================================
import React from "react";
import { BANDAS_MARLUVAS, PLAZOS_MARLUVAS } from "../../constants/marluvas.js";
import PriceMatrixCompact from "./PriceMatrixCompact.jsx";
import { useSkuTallas } from "../../hooks/useSkuTallas.js";

const NAVY  = "#0B1E3A";
const AMBER = "#F59E0B";
const MUTED = "#64748B";
const INK   = "#334155";
const SOFT  = "#F8FAFC";

export default function SkuSizesPanel({
  sku,
  skuIdx,
  bandaVigente = null,
  globalAnchor = { bandaId: 1, plazoDias: 90 },
  onSizeMatrixCell,
  onSizeAnchor,
  onSizeReset,
  lang = "es",
}) {
  const { loading, error, tallas } = useSkuTallas(sku.sku, true);
  const sizesPricing = sku.sizes_pricing || {};
  const overrideCount = Object.keys(sizesPricing).length;

  const skuAnchor = (sku.anchor && Number.isFinite(sku.anchor.bandaId))
    ? sku.anchor : globalAnchor;

  return (
    <div style={{
      padding: "12px 16px 14px 16px",
      background: "#FAFBFC",
      borderTop: "1px solid #E5E7EB",
      borderBottom: "1px solid #E5E7EB",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        marginBottom: 10, flexWrap: "wrap",
      }}>
        <span style={{
          font: "700 11px/1 var(--font-body)", color: NAVY,
          textTransform: "uppercase", letterSpacing: 0.5,
        }}>
          {lang === "es" ? "Tallas asignadas al SKU" : "Sizes assigned to SKU"}
        </span>
        <span style={{ color: MUTED, font: "500 11px/1 var(--font-body)" }}>·</span>
        <span style={{ color: INK, font: "600 11px/1 var(--font-body)" }}>
          {loading
            ? (lang === "es" ? "cargando…" : "loading…")
            : `${tallas.length} ${lang === "es" ? "tallas" : "sizes"} (${overrideCount} ${lang === "es" ? "con override" : "with override"})`}
        </span>
        {error && (
          <span style={{
            padding: "3px 8px", borderRadius: 8,
            background: "#FEE2E2", color: "#991B1B",
            font: "600 10px/1 var(--font-body)",
          }}>
            {error === "PRODUCT_NOT_FOUND"
              ? (lang === "es" ? "Producto no encontrado en catálogo" : "Product not in catalog")
              : error}
          </span>
        )}
      </div>

      {!loading && tallas.length === 0 && !error && (
        <div style={{
          padding: 18, textAlign: "center",
          background: "#FFFFFF", border: "1px dashed #CBD5E1", borderRadius: 8,
          color: MUTED, font: "500 11.5px/1.4 var(--font-body)",
        }}>
          {lang === "es"
            ? "Este producto no tiene tallas asignadas en el catálogo."
            : "This product has no sizes assigned in the catalog."}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {tallas.map((t) => {
          const override = sizesPricing[t.uuid];
          const hasOverride = !!override;
          const matrixToRender = hasOverride ? override.matrix : (sku.matrix || {});
          const anchorToRender = hasOverride && override.anchor
            ? override.anchor
            : skuAnchor;

          return (
            <div key={t.uuid} style={{
              padding: "10px 12px",
              background: "#FFFFFF",
              border: `1px solid ${hasOverride ? `${AMBER}55` : "#E5E7EB"}`,
              borderLeft: `3px solid ${hasOverride ? AMBER : "#CBD5E1"}`,
              borderRadius: 8,
            }}>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                gap: 10, marginBottom: 8, flexWrap: "wrap",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ font: "700 13px/1 var(--font-body)", color: NAVY }}>
                    {lang === "es" ? "Talla" : "Size"} {t.label}
                  </span>
                  {t.tipo && (
                    <span style={{
                      padding: "2px 7px", borderRadius: 10,
                      background: SOFT, color: MUTED,
                      font: "700 9px/1 var(--font-body)",
                      textTransform: "uppercase", letterSpacing: 0.5,
                      border: "1px solid #E5E7EB",
                    }}>{t.tipo}</span>
                  )}
                </div>
                <span style={{
                  padding: "3px 9px", borderRadius: 10,
                  background: hasOverride ? `${AMBER}18` : "#F1F5F9",
                  color:      hasOverride ? "#92400E" : MUTED,
                  font: "700 9.5px/1 var(--font-body)",
                  border: `1px solid ${hasOverride ? `${AMBER}55` : "#E5E7EB"}`,
                  textTransform: "uppercase", letterSpacing: 0.4,
                }}>
                  {hasOverride
                    ? (lang === "es" ? "Con override" : "With override")
                    : (lang === "es" ? "Sin override" : "No override")}
                </span>
              </div>

              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                marginBottom: 10, flexWrap: "wrap",
              }}>
                <span style={{
                  font: "600 10px/1 var(--font-body)", color: MUTED,
                  textTransform: "uppercase", letterSpacing: 0.4,
                }}>
                  {lang === "es" ? "Ancla" : "Anchor"}
                </span>
                <select
                  value={anchorToRender.bandaId}
                  onChange={(e) => onSizeAnchor?.(skuIdx, t.uuid, { bandaId: Number(e.target.value) })}
                  style={selStyle(hasOverride)}>
                  {BANDAS_MARLUVAS.map((b) => (
                    <option key={b.id} value={b.id}>
                      #{b.id}{b.techo ? " T" : b.piso ? " P" : ""} · ÷{b.div.toFixed(2)}
                    </option>
                  ))}
                </select>
                <select
                  value={anchorToRender.plazoDias}
                  onChange={(e) => onSizeAnchor?.(skuIdx, t.uuid, { plazoDias: Number(e.target.value) })}
                  style={selStyle(hasOverride)}>
                  {PLAZOS_MARLUVAS.map((p) => (
                    <option key={p.dias} value={p.dias}>{p.dias}d</option>
                  ))}
                </select>
                {hasOverride && (
                  <button type="button"
                    onClick={() => onSizeReset?.(skuIdx, t.uuid)}
                    style={{
                      marginLeft: "auto",
                      padding: "4px 10px", borderRadius: 5,
                      border: "1px solid #E5E7EB", background: "#FFFFFF",
                      color: MUTED, font: "600 10.5px/1 var(--font-body)",
                      cursor: "pointer",
                    }}>
                    {lang === "es" ? "Resetear a default" : "Reset to default"}
                  </button>
                )}
              </div>

              <div title={!hasOverride
                ? (lang === "es"
                    ? "Valores heredados del SKU — editar cualquier celda crea el override"
                    : "Inherited from SKU — editing any cell creates the override")
                : undefined}>
                <PriceMatrixCompact
                  matrix={matrixToRender}
                  bandaVigente={bandaVigente}
                  defaultFilter="essentials"
                  maxHeight="38vh"
                  onCellChange={(bandaId, plazoDias, value) =>
                    onSizeMatrixCell?.(skuIdx, t.uuid, bandaId, plazoDias, value)
                  }
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function selStyle(active) {
  return {
    padding: "4px 6px", borderRadius: 5,
    border: `1px solid ${active ? `${AMBER}77` : "#CBD5E1"}`,
    background: active ? "#FFFBEB" : "#FFFFFF",
    color: NAVY, font: "600 10.5px/1 var(--font-body)",
    cursor: "pointer", outline: "none",
    fontVariantNumeric: "tabular-nums",
  };
}
