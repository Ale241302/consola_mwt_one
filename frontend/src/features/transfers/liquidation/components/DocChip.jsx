// MWT.ONE · features/transfers/liquidation/components/DocChip.jsx
// Chip de documento legal (DUA, BL/AWB). Ola 3 · 3.28.
import React from "react";
import { IconFileText } from "../../../../lib/icons.jsx";

export default function DocChip({ doc, fallbackLabel, kind }) {
  if (!doc) {
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px",
        borderRadius: 999, background: "rgba(100,116,139,0.08)",
        color: "var(--text-tertiary)", fontSize: 12, fontStyle: "italic",
      }}>
        <IconFileText size={11}/> {fallbackLabel} —
      </span>
    );
  }
  const url = doc.url || (doc.object_key ? `/api/storage/signed_url/?key=${encodeURIComponent(doc.object_key)}` : null);
  return (
    <a href={url || "#"} target="_blank" rel="noopener noreferrer"
       style={{
         display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px",
         borderRadius: 999, background: "rgba(0,178,134,0.10)",
         color: "var(--text-primary)", fontSize: 12, fontWeight: 600, textDecoration: "none",
         border: "1px solid rgba(0,178,134,0.25)",
       }}>
      <IconFileText size={11} style={{ color: "#00B286" }}/>
      {doc.titulo || fallbackLabel}
      {doc.numero_ref && <code className="mono-sm" style={{ color: "var(--text-tertiary)" }}>{doc.numero_ref}</code>}
    </a>
  );
}
