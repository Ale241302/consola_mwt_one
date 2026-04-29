// ─────────────────────────────────────────────────────────────
// ConsolidateToggle — Switch para alternar la vista entre
// "solo este cliente" vs "padre + subsidiarias" en las tabs
// Expedientes / Pagos / Productos.
// Agente responsable: [AG-FRONTEND]
//
// Solo debe renderizarse cuando el cliente actual es PADRE
// (is_parent === true). Las subsidiarias no tienen consolidación.
//
// Tokens visuales:
//   ON  → Mint #00B286   (consumiendo del pool)
//   OFF → Slate          (vista individual)
// ─────────────────────────────────────────────────────────────
import React from "react";

export default function ConsolidateToggle({ value, onChange, lang = "es", disabled = false }) {
  return (
    <label
      className="consolidate-toggle"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        cursor: disabled ? "not-allowed" : "pointer",
        userSelect: "none",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <span
        className="caption"
        style={{
          fontWeight: 600,
          color: "var(--text-secondary, #3D4A6B)",
          textTransform: "none",
        }}
      >
        {lang === "es" ? "Consolidar subsidiarias" : "Consolidate subsidiaries"}
      </span>
      <span
        style={{
          position: "relative",
          width: 36,
          height: 20,
          borderRadius: 999,
          background: value ? "#00B286" : "#CBD5E1",
          transition: "background 0.18s ease",
          flexShrink: 0,
        }}
      >
        <input
          type="checkbox"
          checked={!!value}
          disabled={disabled}
          onChange={(e) => onChange?.(e.target.checked)}
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0,
            cursor: disabled ? "not-allowed" : "pointer",
            margin: 0,
          }}
        />
        <span
          style={{
            position: "absolute",
            top: 2,
            left: value ? 18 : 2,
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: "#FFFFFF",
            boxShadow: "0 1px 3px rgba(15,27,61,0.20)",
            transition: "left 0.18s ease",
          }}
        />
      </span>
    </label>
  );
}
