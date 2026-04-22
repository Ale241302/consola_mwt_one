// =====================================================================
// MWT.ONE · components/ai/MentionPopover.jsx
// Agente: [AG-FRONTEND]
//
// Popover flotante para autocompletar @-agents y /-skills.
//   - Se posiciona sobre el caret del ChatInput (anchor x/y).
//   - Filtrado client-side por `query` (después del @ o /).
//   - Navegación con flechas + Enter para seleccionar.
//   - Esc o click fuera → onClose().
//
// Datos vienen pre-cargados (props.items): el padre los hidrata desde
// /api/ai/agents/select/  o  /api/ai/skills/select/
// =====================================================================
import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const KIND_META = {
  AGENT: { color: "#481EE3", prefix: "@" },
  SKILL: { color: "#00B286", prefix: "/" },
  INSTRUCTION: { color: "#1EE3D7", prefix: "⚙" },
};

export default function MentionPopover({
  open, kind = "AGENT", query = "",
  items = [], anchor = { x: 0, y: 0 },
  onSelect, onClose,
}) {
  const tk = KIND_META[kind] || KIND_META.AGENT;
  const [active, setActive] = useState(0);
  const listRef = useRef(null);

  // Filtrar items según query (case-insensitive sobre nombre + slug)
  const q = (query || "").trim().toLowerCase();
  const filtered = items.filter(it => {
    if (!q) return true;
    const name = (it.nombre || it.name || "").toLowerCase();
    const slug = (it.slug || "").toLowerCase();
    return name.includes(q) || slug.includes(q);
  }).slice(0, 8);

  useEffect(() => { setActive(0); }, [query, kind]);

  // Listener de teclado global mientras está abierto
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (e.key === "Escape") { e.preventDefault(); onClose && onClose(); return; }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive(a => Math.min(filtered.length - 1, a + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive(a => Math.max(0, a - 1));
      } else if (e.key === "Enter" || e.key === "Tab") {
        if (filtered.length > 0) {
          e.preventDefault();
          onSelect && onSelect(filtered[active], kind);
        }
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [open, filtered, active, kind, onSelect, onClose]);

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        ref={listRef}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 4 }}
        transition={{ duration: 0.12 }}
        role="listbox"
        aria-label={`Mencionar ${kind.toLowerCase()}`}
        style={{
          position: "absolute",
          left: anchor.x, bottom: anchor.y,
          minWidth: 280, maxWidth: 360,
          background: "var(--surface-elevated, #fff)",
          border: `1px solid ${tk.color}33`,
          borderRadius: 10,
          boxShadow: "0 10px 30px rgba(11,30,58,0.18)",
          padding: 4,
          zIndex: 50,
        }}
      >
        <div style={{
          padding: "6px 10px 4px",
          font: "600 10.5px/1 var(--font-body)",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: tk.color,
        }}>
          {tk.prefix}  {kind === "AGENT" ? "Agentes" : kind === "SKILL" ? "Skills" : "Instrucciones"}
          {q && <span style={{ color: "var(--text-tertiary)", marginLeft: 6 }}>· "{q}"</span>}
        </div>

        {filtered.length === 0 && (
          <div style={{
            padding: "10px 12px",
            font: "500 12px/1.4 var(--font-body)",
            color: "var(--text-tertiary)",
          }}>
            Sin resultados.
          </div>
        )}

        {filtered.map((it, idx) => {
          const isActive = idx === active;
          const name = it.nombre || it.name || it.slug || "—";
          const sub  = it.slug || it.role || it.descripcion_corta || "";
          return (
            <button
              key={it.id || it.slug || idx}
              type="button"
              role="option"
              aria-selected={isActive}
              onMouseEnter={() => setActive(idx)}
              onClick={() => onSelect && onSelect(it, kind)}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                width: "100%", textAlign: "left",
                padding: "8px 10px",
                border: "none",
                borderRadius: 6,
                background: isActive ? `${tk.color}14` : "transparent",
                color: "var(--text-primary)",
                cursor: "pointer",
                font: "500 13px/1.3 var(--font-body)",
              }}
            >
              <span style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 22, height: 22, borderRadius: 6,
                background: `${tk.color}22`, color: tk.color,
                font: "700 12px/1 var(--font-mono)",
              }}>
                {tk.prefix}
              </span>
              <span style={{ flex: 1, overflow: "hidden" }}>
                <div style={{ fontWeight: 600 }}>{name}</div>
                {sub && (
                  <div style={{
                    font: "500 11px/1.2 var(--font-body)",
                    color: "var(--text-tertiary)",
                    marginTop: 2,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {sub}
                  </div>
                )}
              </span>
            </button>
          );
        })}
      </motion.div>
    </AnimatePresence>
  );
}
