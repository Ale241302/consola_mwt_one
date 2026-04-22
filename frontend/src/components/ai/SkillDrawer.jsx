// =====================================================================
// MWT.ONE · components/ai/SkillDrawer.jsx
// Agente: [AG-FRONTEND]
//
// Drawer para crear / editar un AiSkill.
// Backend: /api/ai/skills/
//
// Campos editables (tabla ai.skill):
//   - nombre               (req)
//   - slug                 (req — usado en /-mention)
//   - scope                (READ | WRITE | DESTRUCTIVE | EXTERNAL)
//   - autonomy             (READ_ONLY | SUGGEST | EXECUTE | AUTO)
//   - is_global            bool
//   - description          (texto corto)
//   - system_prompt        (instrucción operativa, snippet a inyectar)
//   - tags                 (lista de strings)
// =====================================================================
import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { aiSkillsApi } from "../../lib/api.js";
import { IconX } from "../../lib/icons.jsx";

const SCOPE_OPTS = [
  { value: "READ",        label: "Read (consulta)" },
  { value: "WRITE",       label: "Write (modifica)" },
  { value: "DESTRUCTIVE", label: "Destructive (borra)" },
  { value: "EXTERNAL",    label: "External (toca APIs externas)" },
];
const AUTONOMY_OPTS = [
  { value: "READ_ONLY", label: "Read-only" },
  { value: "SUGGEST",   label: "Suggest (default)" },
  { value: "EXECUTE",   label: "Execute (con confirm)" },
  { value: "AUTO",      label: "Auto (sin confirm)" },
];

const EMPTY = {
  nombre: "",
  slug: "",
  scope: "READ",
  autonomy: "SUGGEST",
  is_global: false,
  description: "",
  system_prompt: "",
  tags: [],
};

export default function SkillDrawer({ open, skillId, onClose, onSaved }) {
  const isEdit = Boolean(skillId);
  const [form, setForm]       = useState(EMPTY);
  const [tagInput, setTagInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setTagInput("");
    if (!isEdit) {
      setForm(EMPTY);
      return;
    }
    setLoading(true);
    aiSkillsApi.get(skillId)
      .then(d => setForm({ ...EMPTY, ...d, tags: Array.isArray(d.tags) ? d.tags : [] }))
      .catch(e => setError(e?.message || "No se pudo cargar"))
      .finally(() => setLoading(false));
  }, [open, skillId, isEdit]);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  function addTag() {
    const t = tagInput.trim();
    if (!t) return;
    if (form.tags.includes(t)) { setTagInput(""); return; }
    set("tags", [...form.tags, t]);
    setTagInput("");
  }
  function removeTag(t) { set("tags", form.tags.filter(x => x !== t)); }

  async function handleSave() {
    if (!form.nombre.trim()) { setError("Nombre es requerido"); return; }
    if (!form.slug.trim())   { setError("Slug es requerido"); return; }
    setSaving(true);
    setError(null);
    try {
      const saved = isEdit
        ? await aiSkillsApi.update(skillId, form)
        : await aiSkillsApi.create(form);
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
            role="dialog" aria-label={isEdit ? "Editar skill" : "Nueva skill"}
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
                  {isEdit ? "Editar Skill" : "Nueva Skill"}
                </div>
                <div style={{ font: "500 11px/1 var(--font-body)", color: "var(--text-tertiary)", marginTop: 4 }}>
                  ai.skill · {isEdit ? skillId : "—"}
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
                  <Field label="Nombre">
                    <input value={form.nombre} onChange={e => set("nombre", e.target.value)} className="ai-input" />
                  </Field>
                  <Field label="Slug (usado como /skill)">
                    <input value={form.slug} onChange={e => set("slug", e.target.value.replaceAll(" ", "-").toLowerCase())} className="ai-input" />
                  </Field>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <Field label="Scope">
                      <select value={form.scope} onChange={e => set("scope", e.target.value)} className="ai-input">
                        {SCOPE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </Field>
                    <Field label="Autonomía">
                      <select value={form.autonomy} onChange={e => set("autonomy", e.target.value)} className="ai-input">
                        {AUTONOMY_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </Field>
                  </div>
                  <Field label="Descripción">
                    <textarea rows={3} value={form.description} onChange={e => set("description", e.target.value)} className="ai-input" />
                  </Field>
                  <Field label="System Prompt (snippet)">
                    <textarea rows={8} value={form.system_prompt} onChange={e => set("system_prompt", e.target.value)}
                      className="ai-input" style={{ font: "500 12.5px/1.45 var(--font-mono)" }}
                    />
                  </Field>
                  <Field label="Tags">
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
                      {form.tags.map(t => (
                        <span key={t} style={{
                          display: "inline-flex", alignItems: "center", gap: 4,
                          padding: "3px 8px", borderRadius: 999,
                          background: "rgba(0,178,134,0.10)", color: "#00B286",
                          font: "600 11px/1 var(--font-body)",
                        }}>
                          {t}
                          <button onClick={() => removeTag(t)} style={{
                            background: "none", border: "none", color: "#00B286",
                            cursor: "pointer", padding: 0, lineHeight: 1,
                          }}>×</button>
                        </span>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <input
                        value={tagInput}
                        onChange={e => setTagInput(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                        placeholder="añadir tag…"
                        className="ai-input"
                        style={{ flex: 1 }}
                      />
                      <button onClick={addTag} className="ai-btn ai-btn-ghost" type="button">+</button>
                    </div>
                  </Field>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, font: "500 13px/1 var(--font-body)" }}>
                    <input type="checkbox" checked={!!form.is_global} onChange={e => set("is_global", e.target.checked)} />
                    Global (auto-inyectar en todos los hilos)
                  </label>
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
                {saving ? "Guardando…" : (isEdit ? "Guardar cambios" : "Crear skill")}
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
