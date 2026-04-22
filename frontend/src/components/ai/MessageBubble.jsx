// =====================================================================
// MWT.ONE · components/ai/MessageBubble.jsx
// Agente: [AG-FRONTEND]
//
// Render de un mensaje del thread:
//   sender = USER       → burbuja Navy a la derecha
//   sender = ASSISTANT  → burbuja Mint/Light Green a la izquierda
//   sender = SYSTEM     → caja gris centrada (system_prompt snapshot)
//   sender = TOOL       → caja con borde dashed (tool_use / tool_result)
//
// Animación con framer-motion (entrada suave). Soporta Markdown muy
// básico (negritas con **) sin dependencias externas.
// =====================================================================
import React from "react";
import { motion } from "framer-motion";
import { fmtShortDate } from "../../lib/i18n.js";

const COLORS = {
  USER:      { bg: "#0B1E3A", color: "#FFFFFF", align: "flex-end",   accent: "#3083FE" },
  ASSISTANT: { bg: "linear-gradient(135deg, rgba(0,178,134,0.10), rgba(29,227,148,0.10))",
               color: "var(--text-primary)", align: "flex-start", accent: "#00B286" },
  SYSTEM:    { bg: "rgba(71,85,105,0.08)", color: "var(--text-secondary)", align: "center", accent: "#475569" },
  TOOL:      { bg: "rgba(48,131,254,0.05)", color: "var(--text-secondary)", align: "flex-start", accent: "#3083FE" },
};

// Markdown muy minimal: ** negritas **, ` `inline code`
function renderInline(text) {
  if (!text) return null;
  // Split por ** y `
  const parts = [];
  let buf = "";
  let i = 0;
  while (i < text.length) {
    if (text.slice(i, i + 2) === "**") {
      const close = text.indexOf("**", i + 2);
      if (close > -1) {
        if (buf) { parts.push(buf); buf = ""; }
        parts.push(<strong key={`b${i}`}>{text.slice(i + 2, close)}</strong>);
        i = close + 2;
        continue;
      }
    }
    if (text[i] === "`") {
      const close = text.indexOf("`", i + 1);
      if (close > -1) {
        if (buf) { parts.push(buf); buf = ""; }
        parts.push(
          <code key={`c${i}`} style={{
            background: "rgba(0,0,0,0.08)", padding: "1px 5px", borderRadius: 4,
            font: "500 12.5px/1.4 var(--font-mono)",
          }}>{text.slice(i + 1, close)}</code>
        );
        i = close + 1;
        continue;
      }
    }
    buf += text[i];
    i += 1;
  }
  if (buf) parts.push(buf);
  return parts;
}

function renderBody(content_text) {
  if (!content_text) return null;
  // Split en líneas / párrafos
  const blocks = content_text.split(/\n\n+/);
  return blocks.map((blk, bi) => {
    const lines = blk.split("\n");
    return (
      <p key={bi} style={{ margin: bi === 0 ? "0" : "8px 0 0", whiteSpace: "pre-wrap", lineHeight: 1.55 }}>
        {lines.map((ln, li) => (
          <React.Fragment key={li}>
            {renderInline(ln)}
            {li < lines.length - 1 && <br />}
          </React.Fragment>
        ))}
      </p>
    );
  });
}

export default function MessageBubble({ message, lang = "es" }) {
  const sender = (message.sender || "USER").toUpperCase();
  const tk = COLORS[sender] || COLORS.USER;
  const isUser = sender === "USER";
  const isSystem = sender === "SYSTEM";

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
      style={{ display: "flex", justifyContent: tk.align, width: "100%" }}
    >
      <div
        style={{
          maxWidth: isSystem ? "90%" : "78%",
          background: tk.bg,
          color: tk.color,
          padding: "10px 14px",
          borderRadius: isUser ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
          borderLeft: isUser ? "none" : `3px solid ${tk.accent}`,
          borderRight: isUser ? `3px solid ${tk.accent}` : "none",
          boxShadow: "0 1px 3px rgba(11,30,58,0.06)",
          font: "500 13.5px/1.55 var(--font-body)",
        }}
      >
        {/* Header pequeño con metadata */}
        <div style={{
          display: "flex", justifyContent: "space-between", gap: 12,
          marginBottom: 6,
          font: "600 10.5px/1 var(--font-body)",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          opacity: 0.75,
        }}>
          <span style={{ color: isUser ? "rgba(255,255,255,0.85)" : tk.accent }}>
            {sender}
            {message.from_agent_id && " · agent"}
            {message.tool_name && ` · ${message.tool_name}`}
          </span>
          <span className="tabular" style={{ color: isUser ? "rgba(255,255,255,0.65)" : "var(--text-tertiary)" }}>
            {message.created_at ? fmtShortDate(message.created_at, lang) : ""}
          </span>
        </div>

        {renderBody(message.content_text)}

        {Array.isArray(message.attachment_ids) && message.attachment_ids.length > 0 && (
          <div style={{
            marginTop: 8, paddingTop: 8,
            borderTop: `1px dashed ${isUser ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.12)"}`,
            font: "500 11.5px/1.3 var(--font-body)", opacity: 0.85,
          }}>
            📎 {message.attachment_ids.length} adjunto{message.attachment_ids.length === 1 ? "" : "s"}
          </div>
        )}

        {message.tokens_in != null && message.tokens_out != null && (
          <div style={{
            marginTop: 6,
            font: "500 10.5px/1 var(--font-mono)",
            opacity: 0.6,
            color: isUser ? "rgba(255,255,255,0.7)" : "var(--text-tertiary)",
          }}>
            tok in:{message.tokens_in} · out:{message.tokens_out}
            {message.cost_usd != null && ` · $${Number(message.cost_usd).toFixed(4)}`}
          </div>
        )}
      </div>
    </motion.div>
  );
}
