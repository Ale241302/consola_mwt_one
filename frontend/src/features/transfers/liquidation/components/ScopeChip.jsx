// MWT.ONE · features/transfers/liquidation/components/ScopeChip.jsx
// Chip de alcance (scope_json) de un costo. Ola 3 · 3.28.
import React from "react";

export default function ScopeChip({ scope, transferItems, disabled, onOpen, lang }) {
  let label = lang === "es" ? "Todo" : "All";
  let restricted = false;
  if (scope && scope.applies_to_all === false) {
    restricted = true;
    const nExp   = Array.isArray(scope.expediente_ids) ? scope.expediente_ids.length : 0;
    const nLines = Array.isArray(scope.lines)          ? scope.lines.length          : 0;
    if (nLines > 0) {
      label = lang === "es" ? `${nExp} exp · ${nLines} líneas`
                            : `${nExp} exp · ${nLines} lines`;
    } else if (nExp > 0) {
      label = `${nExp} ${lang === "es"
        ? (nExp === 1 ? "expediente" : "expedientes")
        : (nExp === 1 ? "expediente" : "expedientes")}`;
    }
  }
  const noItems = !transferItems || transferItems.length === 0;
  const realDisabled = !!disabled || noItems;
  return (
    <button type="button"
            onClick={onOpen}
            disabled={realDisabled}
            title={noItems
              ? (lang === "es" ? "No hay líneas en el movimiento" : "No transfer lines")
              : (lang === "es" ? "Configurar alcance del costo" : "Set cost scope")}
            style={{
              padding: "4px 10px", borderRadius: 999,
              border: restricted
                ? "1.5px solid var(--brand-accent, #0E8A6D)"
                : "1px solid var(--border-subtle, #E1E6ED)",
              background: restricted
                ? "color-mix(in oklab, var(--brand-accent, #0E8A6D) 10%, transparent)"
                : "var(--surface, white)",
              color: restricted ? "var(--brand-accent, #0E8A6D)" : "var(--text-secondary, #475467)",
              fontSize: 11, fontWeight: 700, letterSpacing: 0.3,
              cursor: realDisabled ? "not-allowed" : "pointer",
              opacity: realDisabled ? 0.5 : 1,
            }}>
      {label}
    </button>
  );
}
