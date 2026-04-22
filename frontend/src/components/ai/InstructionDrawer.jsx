// =====================================================================
// MWT.ONE · components/ai/InstructionDrawer.jsx
// Agente: [AG-FRONTEND]
//
// Drawer para crear / editar una AiInstruction (a.k.a. "context rule").
// Backend: /api/ai/instructions/
//
// Campos editables (tabla ai.instruction):
//   - titulo               (req)
//   - slug                 (req)
//   - priority             int  (mayor → más cerca del top del system_prompt)
//   - is_global            bool (auto-inject en todos los hilos)
//   - auto_inject          bool (alias semántico — algunas instrucciones se anclan caso a caso)
//   - body                 (markdown / texto plano del fragmento)
// =====================================================================
import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { aiInstructionsApi } from "../../lib/api.js";
import { IconX } from "../../lib/icons.jsx";

const EMPTY = {
  titulo: "",
  slug: "",
  priority: 50,
  is_global: false,
  auto_inject: true,
  body: "",
};

export default function InstructionDrawer({ open, instructionId, onClose, onSaved }) {
  const isEdit = Boolean(instructionId);
  const [form, setForm]       = useState(EMPTY);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (!isEdit) { setForm(EMPTY); return; }
    setLoading(true);
    aiInstructionsApi.get(instructionId)
      .then(d => setForm({ ...EMPTY, ...d, priority: d.priority ?? 50 }))
      .catch(e => setError(e?.message || "No se pudo cargar"))
      .finally(() => setLoading(false));
  }, [open, instructionId, isEdit]);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSave() {
    if (!form.titulo.trim()) { setError("Título es requerido"); return; }
    if (!form.slug.trim())   { setError("Slug es requerido"); return; }
    setSaving(true);
    setError(null);
    try {
      const body = { ...form, priority: Number(form.priority) || 0 };
      const saved = isEdit
        ? await aiInstructionsApi.update(instructionId, body)
        : await aiInstructionsApi.create(body);
      onSaved && onSaved(saved);
      onClose && onClose();
    } catch (e) {
      setError(e?.body?.detail || e?.message || "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            style={{ position: "fixed", inset: 0, background: "rgba(11,30,58,0.30)", zIndex: 100 }}
          />
          <motion.aside key="drawer"
            initial={{ x: 480 }} animate={{ x: 0 }} exit={{ x: 480 }}
            transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
            role="dialog" aria-label={isEdit ? "Editar instrucción" : "Nueva instrucción"}
            style={{
              position: "fixed", top: 0, right: 0, bottom: 0,
              width: 480, maxWidth: "100vw",
              background: "var(--surface-elevated, #fff)",
              boxShadow: "-12px 0 32px rgba(11,30,58,0.18)",
              zIndex: 101, display: "flex", flexDirection: "column",
            }}
          >
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "16px 20px",
              borderBottom: "1px solid var(--border-default, #E5E7EB)",
            }}>
              <div>
                <div style={{ font: "700 15px/1.2 var(--font-body)" }}>
                  {isEdit ? "Editar Instrucción" : "Nueva Instrucción"}
                </div>
                <div style={{ font: "500 11px/1 var(--font-body)", color: "var(--text-tertiary)", marginTop: 4 }}>
                  ai.instruction · {isEdit ? instructionId : "—"}
                </div>
              </div>
              <button onClick={onClose} aria-label="Cerrar" style={{
                width: 32, height: 32, border: "none", background: "transparent",
                color: "var(--text-tertiary)", cursor: "pointer",
              }}><IconX size={18} /></button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
              {loading ? (
                <div style={{ padding: 40, textAlign: "center", color: "var(--text-tertiary)" }}>Cargando…</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <Field label="Título">
                    <input value={form.titulo} onChange={e => set("titulo", e.target.value)} className="ai-input" />
                  </Field>
                  <Field label="Slug">
                    <input value={form.slug} onChange={e => set("slug", e.target.value.replaceAll(" ", "-").toLowerCase())} className="ai-input" />
                  </Field>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <Field label="Prioridad (0–100)">
                      <input type="number" min="0" max="100" value={form.priority}
                        onChange={e => set("priority", e.target.value)} className="ai-input" />
                    </Field>
                    <Field label=" ">
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 4 }}>
                        <label style={{ display: "flex", alignItems: "center", gap: 6, font: "500 12.5px/1 var(--font-body)" }}>
                          <input type="checkbox" checked={!!form.is_global}
                            onChange={e => set("is_global", e.target.checked)} />
                          Global
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: 6, font: "500 12.5px/1 var(--font-body)" }}>
                          <input type="checkbox" checked={!!form.auto_inject}
                            onChange={e => set("auto_inject", e.target.checked)} />
                          Auto-inyectar
                        </label>
                      </div>
                    </Field>
                  </div>
                  <Field label="Body (Markdown)">
                    <textarea rows={12} value={form.body} onChange={e => set("body", e.target.value)}
                      className="ai-input" style={{ font: "500 12.5px/1.45 var(--font-mono)" }}
                    />
                  </Field>
                  {error && (
                    <div style={{
                      padding: "8px 10px", borderRadius: 6,
                      background: "rgba(239,68,68,0.10)", color: "#B91C1C",
                      font: "500 12.5px/1.4 var(--font-body)",
                    }}>
                      {error}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={{
              display: "flex", justifyContent: "flex-end", gap: 8,
              padding: "12px 20px",
              borderTop: "1px solid var(--border-default, #E5E7EB)",
              background: "var(--surface-muted, #F8FAFC)",
            }}>
              <button onClick={onClose} className="ai-btn ai-btn-ghost" disabled={saving}>Cancelar</button>
              <button onClick={handleSave} className="ai-btn ai-btn-primary" disabled={saving || loading}>
                {saving ? "Guardando…" : (isEdit ? "Guardar cambios" : "Crear instrucción")}
              </button>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{
        font: "600 11px/1 var(--font-body)",
        color: "var(--text-secondary)",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
      }}>{label}</span>
      {children}
    </label>
  );
}
