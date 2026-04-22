// =====================================================================
// MWT.ONE · components/ai/AgentDrawer.jsx
// Agente: [AG-FRONTEND]
//
// Drawer lateral derecho para crear / editar un AiAgent.
// Backend: /api/ai/agents/  (POST | PATCH | GET).
//
// Campos editables (de los más comunes; tabla ai.agent):
//   - nombre               (req)
//   - slug                 (req, kebab/snake)
//   - role                 (CHAT | INTERNAL | CONNECTOR | TOOL)  default CHAT
//   - autonomy             (READ_ONLY | SUGGEST | EXECUTE | AUTO) default SUGGEST
//   - is_global            bool   (visible en todo /ai)
//   - default_model        (opt)  override por agente
//   - default_temperature  (opt)
//   - description          (markdown corto, system_prompt parcial)
//   - system_prompt        (system_prompt completo del agente)
//
// Diseño:
//   - Drawer 480px, slide-in derecha (framer-motion).
//   - Footer fijo con botones [Cancelar] / [Guardar].
//   - Validación inline simple (nombre + slug requeridos).
// =====================================================================
import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { aiAgentsApi } from "../../lib/api.js";
import { IconX } from "../../lib/icons.jsx";

const ROLE_OPTS = [
  { value: "CHAT",      label: "Chat (visible al usuario)" },
  { value: "INTERNAL",  label: "Internal (subagente)" },
  { value: "CONNECTOR", label: "Connector (MCP / SAP / ERP)" },
  { value: "TOOL",      label: "Tool (función pura)" },
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
  role: "CHAT",
  autonomy: "SUGGEST",
  is_global: true,
  default_model: "",
  default_temperature: "",
  description: "",
  system_prompt: "",
};

export default function AgentDrawer({ open, agentId, onClose, onSaved }) {
  const isEdit = Boolean(agentId);
  const [form, setForm]       = useState(EMPTY);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState(null);

  // Cargar al abrir
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (!isEdit) {
      setForm(EMPTY);
      return;
    }
    setLoading(true);
    aiAgentsApi.get(agentId)
      .then(d => setForm({ ...EMPTY, ...d, default_temperature: d.default_temperature ?? "" }))
      .catch(e => setError(e?.message || "No se pudo cargar"))
      .finally(() => setLoading(false));
  }, [open, agentId, isEdit]);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSave() {
    if (!form.nombre.trim()) { setError("Nombre es requerido"); return; }
    if (!form.slug.trim())   { setError("Slug es requerido"); return; }
    setSaving(true);
    setError(null);
    try {
      const body = {
        ...form,
        default_temperature: form.default_temperature === "" ? null : Number(form.default_temperature),
        default_model:       form.default_model || null,
      };
      const saved = isEdit
        ? await aiAgentsApi.update(agentId, body)
        : await aiAgentsApi.create(body);
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
          <motion.div
            key="overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            style={{
              position: "fixed", inset: 0, background: "rgba(11,30,58,0.30)", zIndex: 100,
            }}
          />
          <motion.aside
            key="drawer"
            initial={{ x: 480 }} animate={{ x: 0 }} exit={{ x: 480 }}
            transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
            role="dialog" aria-label={isEdit ? "Editar agente" : "Nuevo agente"}
            style={{
              position: "fixed", top: 0, right: 0, bottom: 0,
              width: 480, maxWidth: "100vw",
              background: "var(--surface-elevated, #fff)",
              boxShadow: "-12px 0 32px rgba(11,30,58,0.18)",
              zIndex: 101,
              display: "flex", flexDirection: "column",
            }}
          >
            {/* Header */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "16px 20px",
              borderBottom: "1px solid var(--border-default, #E5E7EB)",
            }}>
              <div>
                <div style={{ font: "700 15px/1.2 var(--font-body)", color: "var(--text-primary)" }}>
                  {isEdit ? "Editar Agente" : "Nuevo Agente"}
                </div>
                <div style={{ font: "500 11px/1 var(--font-body)", color: "var(--text-tertiary)", marginTop: 4 }}>
                  ai.agent · {isEdit ? agentId : "—"}
                </div>
              </div>
              <button onClick={onClose} aria-label="Cerrar" style={{
                width: 32, height: 32, border: "none", background: "transparent",
                color: "var(--text-tertiary)", cursor: "pointer",
              }}>
                <IconX size={18} />
              </button>
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
              {loading ? (
                <div style={{ padding: 40, textAlign: "center", color: "var(--text-tertiary)" }}>
                  Cargando…
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <Field label="Nombre">
                    <input value={form.nombre} onChange={e => set("nombre", e.target.value)} className="ai-input" />
                  </Field>
                  <Field label="Slug">
                    <input value={form.slug} onChange={e => set("slug", e.target.value.replaceAll(" ", "-").toLowerCase())} className="ai-input" />
                  </Field>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <Field label="Rol">
                      <select value={form.role} onChange={e => set("role", e.target.value)} className="ai-input">
                        {ROLE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </Field>
                    <Field label="Autonomía">
                      <select value={form.autonomy} onChange={e => set("autonomy", e.target.value)} className="ai-input">
                        {AUTONOMY_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </Field>
                  </div>
                  <Field label="Modelo (override)">
                    <input
                      value={form.default_model}
                      onChange={e => set("default_model", e.target.value)}
                      placeholder="claude-sonnet-4-6 / claude-haiku-4-5-20251001"
                      className="ai-input"
                    />
                  </Field>
                  <Field label="Temperatura">
                    <input
                      type="number" min="0" max="1" step="0.05"
                      value={form.default_temperature}
                      onChange={e => set("default_temperature", e.target.value)}
                      className="ai-input"
                    />
                  </Field>
                  <Field label="Descripción">
                    <textarea
                      rows={3}
                      value={form.description}
                      onChange={e => set("description", e.target.value)}
                      className="ai-input"
                    />
                  </Field>
                  <Field label="System Prompt">
                    <textarea
                      rows={8}
                      value={form.system_prompt}
                      onChange={e => set("system_prompt", e.target.value)}
                      className="ai-input"
                      style={{ font: "500 12.5px/1.45 var(--font-mono)" }}
                    />
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

            {/* Footer */}
            <div style={{
              display: "flex", justifyContent: "flex-end", gap: 8,
              padding: "12px 20px",
              borderTop: "1px solid var(--border-default, #E5E7EB)",
              background: "var(--surface-muted, #F8FAFC)",
            }}>
              <button onClick={onClose} className="ai-btn ai-btn-ghost" disabled={saving}>Cancelar</button>
              <button onClick={handleSave} className="ai-btn ai-btn-primary" disabled={saving || loading}>
                {saving ? "Guardando…" : (isEdit ? "Guardar cambios" : "Crear agente")}
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
