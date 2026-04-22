// =====================================================================
// MWT.ONE · components/ai/ContextChip.jsx
// Agente: [AG-FRONTEND]
//
// Chip removible que representa un anchor de hilo (agente / skill /
// instrucción / archivo / oc / cliente / etc.).  El acento de color
// se deriva del ref_type para que el usuario distinga visualmente:
//
//   AGENT       → indigo  (#481EE3)   prefix '@'
//   SKILL       → mint    (#00B286)   prefix '/'
//   INSTRUCTION → cyan    (#1EE3D7)   prefix '⚙'
//   ATTACHMENT  → blue    (#3083FE)   prefix '📎'
//   OC / EXP    → navy    (#0B1E3A)   prefix '#'
//
// Uso:
//   <ContextChip kind="AGENT" label="@AnalistaSAP" onRemove={...}/>
// =====================================================================
import React from "react";
import { IconX } from "../../lib/icons.jsx";

const KIND_TOKENS = {
  AGENT:       { color: "#481EE3", bg: "rgba(72,30,227,0.10)",  prefix: "@" },
  SKILL:       { color: "#00B286", bg: "rgba(0,178,134,0.12)",  prefix: "/" },
  INSTRUCTION: { color: "#1EE3D7", bg: "rgba(30,227,215,0.12)", prefix: "⚙" },
  ATTACHMENT:  { color: "#3083FE", bg: "rgba(48,131,254,0.12)", prefix: "📎" },
  OC:          { color: "#0B1E3A", bg: "rgba(11,30,58,0.10)",   prefix: "#" },
  EXPEDIENTE:  { color: "#0B1E3A", bg: "rgba(11,30,58,0.10)",   prefix: "#" },
  CLIENTE:     { color: "#0B1E3A", bg: "rgba(11,30,58,0.10)",   prefix: "#" },
  PRODUCTO:    { color: "#0B1E3A", bg: "rgba(11,30,58,0.10)",   prefix: "#" },
  GENERIC:     { color: "#475569", bg: "rgba(71,85,105,0.10)",  prefix: "•" },
};

export default function ContextChip({
  kind = "GENERIC",
  label,
  onRemove,
  removable = true,
  size = "md",
  title,
}) {
  const tk = KIND_TOKENS[kind] || KIND_TOKENS.GENERIC;
  const isSm = size === "sm";
  return (
    <span
      className="ai-chip"
      title={title || label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: isSm ? "2px 8px" : "4px 10px",
        borderRadius: 999,
        background: tk.bg,
        color: tk.color,
        font: isSm ? "600 11px/1 var(--font-body)" : "600 12px/1 var(--font-body)",
        border: `1px solid ${tk.color}33`,
        whiteSpace: "nowrap",
        maxWidth: 220,
      }}
    >
      <span style={{ opacity: 0.8 }}>{tk.prefix}</span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      {removable && onRemove && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          aria-label={`Quitar ${label}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 14,
            height: 14,
            border: "none",
            background: "transparent",
            color: tk.color,
            cursor: "pointer",
            padding: 0,
            opacity: 0.7,
          }}
        >
          <IconX size={12} />
        </button>
      )}
    </span>
  );
}
