// =====================================================================
// MWT.ONE · components/ai/ChatInput.jsx
// Agente: [AG-FRONTEND]
//
// Barra de entrada del Chat AI Hub.
//
// Funcionalidad:
//   1. Textarea autoexpandible (max 8 líneas).
//   2. Detección de '@' y '/' para abrir <MentionPopover/> con
//      autocomplete contra /api/ai/agents/select y /api/ai/skills/select.
//   3. Cuando el usuario selecciona una mención:
//        · se inserta el texto "@nombre" / "/slug" en el caret
//        · se agrega al estado `pendingAgents` / `pendingSkills`
//          → estos se envían como `agent_ids[]` / `skill_ids[]`
//            en el POST /api/ai/chat/send/.
//   4. Botón clip (📎) → file picker → POST /api/ai/chat/upload/
//      → agrega attachment_ids al payload del próximo send.
//   5. Botón Enviar (→) o Enter (sin Shift) → onSend(payload).
//
// Props:
//   threadId          (req)
//   userId            (opt — si JWT lo provee no es necesario)
//   defaultAgents     ([{id, nombre, slug}])  → anclados ya al hilo
//   defaultSkills     idem
//   defaultInstructions idem
//   onSend(payload)   → handler externo (lo llamará AIChat.jsx)
//   sending           bool (deshabilita input cuando se envía)
//   lang
// =====================================================================
import React, { useEffect, useMemo, useRef, useState } from "react";
import { aiAgentsApi, aiSkillsApi, aiChatApi } from "../../lib/api.js";
import { IconPaperclip, IconSend } from "../../lib/icons.jsx";
import ContextChip from "./ContextChip.jsx";
import FileAttachmentPreview from "./FileAttachmentPreview.jsx";
import MentionPopover from "./MentionPopover.jsx";

const MAX_TEXTAREA_HEIGHT = 200;

export default function ChatInput({
  threadId,
  userId,
  defaultAgents = [],
  defaultSkills = [],
  defaultInstructions = [],
  onSend,
  sending = false,
  lang = "es",
}) {
  const [text, setText] = useState("");
  const [pendingAgents, setPendingAgents] = useState(defaultAgents);
  const [pendingSkills, setPendingSkills] = useState(defaultSkills);
  const [pendingAttachments, setPendingAttachments] = useState([]);   // [{id, filename, size_bytes, mime}]
  const [uploadingFiles,    setUploadingFiles]    = useState([]);     // [File]
  const [uploadError,       setUploadError]       = useState(null);

  // Mention popover state
  const [popover, setPopover] = useState({ open: false, kind: null, query: "", anchor: { x: 0, y: 0 } });
  const [agentList, setAgentList] = useState([]);
  const [skillList, setSkillList] = useState([]);
  const taRef   = useRef(null);
  const fileRef = useRef(null);

  // Hidratar selects una vez (catalogos chicos: < 50 items normalmente)
  useEffect(() => {
    let alive = true;
    aiAgentsApi.action("select").then(d => alive && setAgentList(Array.isArray(d) ? d : (d?.results || [])))
      .catch(() => alive && setAgentList([]));
    aiSkillsApi.action("select").then(d => alive && setSkillList(Array.isArray(d) ? d : (d?.results || [])))
      .catch(() => alive && setSkillList([]));
    return () => { alive = false; };
  }, []);

  // Sincronizar defaults si cambian (cambio de hilo)
  useEffect(() => { setPendingAgents(defaultAgents); }, [defaultAgents]);
  useEffect(() => { setPendingSkills(defaultSkills); }, [defaultSkills]);

  // Auto-resize textarea
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(MAX_TEXTAREA_HEIGHT, el.scrollHeight) + "px";
  }, [text]);

  // Detectar @ o / al escribir → abrir popover
  function handleChange(e) {
    const newText = e.target.value;
    setText(newText);

    const caret = e.target.selectionStart || newText.length;
    const before = newText.slice(0, caret);
    const lastAt = before.lastIndexOf("@");
    const lastSl = before.lastIndexOf("/");
    const lastSp = Math.max(
      before.lastIndexOf(" "),
      before.lastIndexOf("\n"),
      before.lastIndexOf("\t"),
    );

    let trigger = null;
    let triggerIdx = -1;
    if (lastAt > lastSl && lastAt > lastSp) { trigger = "AGENT"; triggerIdx = lastAt; }
    else if (lastSl > lastAt && lastSl > lastSp) { trigger = "SKILL"; triggerIdx = lastSl; }

    if (trigger != null && triggerIdx >= 0) {
      const query = before.slice(triggerIdx + 1);
      // Si query tiene un espacio o salto de línea, cerrar popover
      if (/\s/.test(query)) {
        setPopover(p => ({ ...p, open: false }));
        return;
      }
      setPopover({
        open: true, kind: trigger, query,
        anchor: { x: 18, y: 76 },  // posición fija sobre el input (CSS)
        triggerIdx,
      });
    } else {
      setPopover(p => ({ ...p, open: false }));
    }
  }

  function handleSelectMention(item, kind) {
    const prefix = kind === "AGENT" ? "@" : "/";
    const display = (item.nombre || item.name || item.slug || "");
    // Reemplazar desde triggerIdx hasta caret por '@nombre ' (o '/slug ')
    const ta = taRef.current;
    if (!ta) return;
    const caret = ta.selectionStart || text.length;
    const before = text.slice(0, popover.triggerIdx);
    const after  = text.slice(caret);
    const inserted = `${prefix}${display.replaceAll(" ", "_")} `;
    const newText = `${before}${inserted}${after}`;
    setText(newText);
    setPopover(p => ({ ...p, open: false }));

    // Agregar a pendingAgents / pendingSkills (sin duplicar por id)
    if (kind === "AGENT") {
      setPendingAgents(arr => arr.find(a => a.id === item.id) ? arr : [...arr, item]);
    } else if (kind === "SKILL") {
      setPendingSkills(arr => arr.find(s => s.id === item.id) ? arr : [...arr, item]);
    }

    // Devolver foco y caret tras la mención
    setTimeout(() => {
      ta.focus();
      const pos = before.length + inserted.length;
      ta.setSelectionRange(pos, pos);
    }, 0);
  }

  function removeAgent(id)  { setPendingAgents(arr => arr.filter(a => a.id !== id)); }
  function removeSkill(id)  { setPendingSkills(arr => arr.filter(s => s.id !== id)); }
  function removeAttachment(id) {
    setPendingAttachments(arr => arr.filter(a => a.id !== id));
  }

  async function handleFiles(fileList) {
    setUploadError(null);
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setUploadingFiles(files);
    try {
      const uploaded = [];
      for (const f of files) {
        const att = await aiChatApi.upload({ file: f, threadId, userId });
        if (att && att.id) uploaded.push(att);
      }
      setPendingAttachments(arr => [...arr, ...uploaded]);
    } catch (e) {
      setUploadError(e?.message || "No se pudo subir");
    } finally {
      setUploadingFiles([]);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function canSend() {
    if (sending) return false;
    if (pendingAttachments.length > 0) return true;
    return (text || "").trim().length > 0;
  }

  function doSend() {
    if (!canSend()) return;
    const payload = {
      thread_id:      threadId,
      user_id:        userId,
      user_text:      text,
      agent_ids:      pendingAgents.map(a => a.id).filter(Boolean),
      skill_ids:      pendingSkills.map(s => s.id).filter(Boolean),
      attachment_ids: pendingAttachments.map(a => a.id).filter(Boolean),
      idempotence_token: `chat-${threadId}-${Date.now()}`,
    };
    onSend && onSend(payload);
    setText("");
    setPendingAttachments([]);
    // mantenemos pendingAgents/Skills (ancla persistente del hilo)
  }

  function handleKeyDown(e) {
    if (popover.open) return;  // las flechas/Enter las maneja MentionPopover
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  }

  const allChips = useMemo(() => [
    ...defaultInstructions.map(i => ({ kind: "INSTRUCTION", id: `inst-${i.id}`, label: i.titulo || i.slug || i.id, raw: i, removable: false })),
    ...pendingAgents.map(a       => ({ kind: "AGENT",       id: `ag-${a.id}`,   label: a.nombre || a.slug || a.id, raw: a, removable: true,  onRemove: () => removeAgent(a.id) })),
    ...pendingSkills.map(s       => ({ kind: "SKILL",       id: `sk-${s.id}`,   label: s.nombre || s.slug || s.id, raw: s, removable: true,  onRemove: () => removeSkill(s.id) })),
  ], [defaultInstructions, pendingAgents, pendingSkills]);

  return (
    <div className="ai-chat-input-wrap" style={{ position: "relative" }}>
      {/* Chips de contexto (above textarea) */}
      {allChips.length > 0 && (
        <div className="ai-chat-chips" style={{
          display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8,
        }}>
          {allChips.map(c => (
            <ContextChip
              key={c.id}
              kind={c.kind}
              label={c.label}
              removable={c.removable}
              onRemove={c.onRemove}
              size="sm"
            />
          ))}
        </div>
      )}

      {/* Mention popover */}
      <MentionPopover
        open={popover.open}
        kind={popover.kind}
        query={popover.query}
        items={popover.kind === "SKILL" ? skillList : agentList}
        anchor={popover.anchor}
        onSelect={handleSelectMention}
        onClose={() => setPopover(p => ({ ...p, open: false }))}
      />

      {/* Caja del input */}
      <div
        className="ai-chat-input-box"
        style={{
          display: "flex", alignItems: "flex-end", gap: 8,
          padding: "10px 12px",
          background: "var(--surface-elevated, #fff)",
          border: "1px solid var(--border-default, #E5E7EB)",
          borderRadius: 14,
          boxShadow: "0 1px 4px rgba(11,30,58,0.06)",
        }}
      >
        {/* Botón Clip (file upload) */}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          aria-label="Adjuntar archivo"
          disabled={sending || uploadingFiles.length > 0}
          style={{
            flex: "0 0 auto",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 34, height: 34, borderRadius: 8,
            border: "none", background: "transparent",
            color: "var(--text-tertiary)", cursor: "pointer",
          }}
        >
          <IconPaperclip size={18} />
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={(e) => handleFiles(e.target.files)}
        />

        {/* Textarea */}
        <textarea
          ref={taRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Escribe un mensaje. Usa @ para agentes, / para skills…"
          rows={1}
          disabled={sending}
          style={{
            flex: 1,
            resize: "none",
            border: "none", outline: "none",
            background: "transparent",
            font: "500 13.5px/1.45 var(--font-body)",
            color: "var(--text-primary)",
            maxHeight: MAX_TEXTAREA_HEIGHT,
            overflow: "auto",
          }}
        />

        {/* Botón enviar */}
        <button
          type="button"
          onClick={doSend}
          disabled={!canSend()}
          aria-label="Enviar"
          style={{
            flex: "0 0 auto",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 36, height: 36, borderRadius: 10,
            border: "none",
            background: canSend()
              ? "linear-gradient(135deg, #481EE3 0%, #3083FE 100%)"
              : "var(--surface-muted, #E5E7EB)",
            color: canSend() ? "#FFFFFF" : "var(--text-tertiary)",
            cursor: canSend() ? "pointer" : "not-allowed",
            transition: "all 120ms ease",
          }}
        >
          <IconSend size={16} />
        </button>
      </div>

      {/* Attachments en cola */}
      {(pendingAttachments.length > 0 || uploadingFiles.length > 0 || uploadError) && (
        <div className="ai-chat-attachments-row" style={{
          display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8,
        }}>
          {pendingAttachments.map(att => (
            <FileAttachmentPreview
              key={att.id}
              attachment={att}
              onRemove={() => removeAttachment(att.id)}
            />
          ))}
          {uploadingFiles.map((f, i) => (
            <FileAttachmentPreview
              key={`up-${i}`}
              file={f}
              uploading
            />
          ))}
          {uploadError && (
            <span style={{
              alignSelf: "center",
              font: "500 11.5px/1 var(--font-body)",
              color: "#EF4444",
            }}>
              ⚠ {uploadError}
            </span>
          )}
        </div>
      )}

      <div style={{
        marginTop: 6,
        font: "500 10.5px/1 var(--font-body)",
        color: "var(--text-tertiary)",
        textAlign: "right",
      }}>
        Enter envía · Shift+Enter salto de línea · @agente · /skill
      </div>
    </div>
  );
}
