// =====================================================================
// MWT.ONE · pages/AIChat.jsx
// Agente: [AG-FRONTEND]
//
// Vista de un hilo de conversación.
//   - GET /api/ai/threads/<id>/             → metadata del hilo
//   - GET /api/ai/threads/<id>/context/     → anchors (agents/skills/instr)
//   - GET /api/ai/threads/<id>/messages/    → historial
//   - POST /api/ai/chat/send/               → enviar mensaje
//   - POST /api/ai/threads/<id>/anchor/     → @agent / /skill agregados desde el chat
//
// Layout:
//   ┌──────────────────────────────────────────────────────────────┐
//   │ Header (titulo, botón gobernanza, pin/archive, refresh)      │
//   ├──────────────────────────────────────────────────────────────┤
//   │ Mensajes (scroll, autoscroll al fondo)                        │
//   ├──────────────────────────────────────────────────────────────┤
//   │ ChatInput (chips + textarea + clip + enviar)                  │
//   └──────────────────────────────────────────────────────────────┘
// =====================================================================
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { aiThreadsApi, aiChatApi } from "../lib/api.js";
import { useAuth } from "../context/AuthContext.jsx";
import {
  MOCK_AI_THREADS,
  MOCK_AI_MESSAGES_BY_THREAD,
  MOCK_AI_CONTEXT_BY_THREAD,
} from "../data/mockData.js";
import {
  IconChevLeft, IconRefresh, IconPin, IconArchive, IconBrain, IconBot,
} from "../lib/icons.jsx";
import MessageBubble from "../components/ai/MessageBubble.jsx";
import ChatInput     from "../components/ai/ChatInput.jsx";

// Util — ¿Este threadId pertenece a un hilo mock?
const _isMockThread = (id) => typeof id === "string" && id.startsWith("mock-th-");

// Plantilla de respuesta del asistente cuando estamos en modo demo.
function _buildMockAssistantReply(userText, threadId) {
  const t = (userText || "").toLowerCase();
  let body;
  if (t.includes("precio") || t.includes("margen") || t.includes("lista")) {
    body = `Recibido. Reviso la lista en cuestión y te traigo:\n\n• Margen promedio actual.\n• SKUs por debajo del piso 50%.\n• Recomendación de ajuste por SKU.\n\n*(Esto es una respuesta simulada en modo demo — cuando el backend de IA esté conectado, ejecuto el cálculo real con \`commercial.pricelist.aggregate\`.)*`;
  } else if (t.includes("talla") || t.includes("plantilla") || t.includes("sizing")) {
    body = `Listo. Construyo la tabla de tallas pedida con la fórmula vigente y la cargo en \`Motor de Tallas\`.\n\n*(Demo — al conectar el backend, llamo a \`sizing.build_table\` con los parámetros que me pasaste.)*`;
  } else if (t.includes("mlv") || t.includes("mercado libre") || t.includes("amazon") || t.includes("marketplace")) {
    body = `Tomo nota. Bajo el reporte de marketplace y propongo una acción en 3 pasos:\n\n1. Top SKUs con conversión < 0.5%.\n2. Comparativa de precio vs. top-3 del canal.\n3. Cupón / promo recomendado.\n\n*(Demo — el llamado real va a \`marketplace.conversion.bottom\`.)*`;
  } else if (t.includes("compliance") || t.includes("ce") || t.includes("norma") || t.includes("doc")) {
    body = `Perfecto. Reviso la normativa aplicable y te dejo el checklist + plantilla de **DoC** lista para firmar.\n\n*(Demo — backend desconectado.)*`;
  } else {
    body = `Recibido, Alejandro. Tomo nota y te respondo con datos en cuanto el backend de IA esté conectado a este hilo.\n\n*(Esta es una respuesta simulada en modo demo para que veas cómo se ve la interacción.)*`;
  }
  return {
    id: `local-asst-${Date.now()}`,
    thread_id: threadId,
    sender: "ASSISTANT",
    content_text: body,
    created_at: new Date().toISOString(),
    attachment_ids: [],
    from_agent_id: "mock-ag-precios",
    tool_name: null,
    tokens_in: Math.round(40 + Math.random() * 200),
    tokens_out: Math.round(120 + Math.random() * 380),
    cost_usd: Number((0.0015 + Math.random() * 0.008).toFixed(4)),
    mock_only: true,
  };
}

export default function AIChat() {
  const { threadId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const userId = user?.user_uuid || user?.id || user?.uuid || null;

  const [thread,   setThread]   = useState(null);
  const [messages, setMessages] = useState([]);
  const [context,  setContext]  = useState({ agents: [], skills: [], instructions: [] });
  const [usingMock, setUsingMock] = useState(false);

  const [loadingMeta,   setLoadingMeta]   = useState(true);
  const [loadingMsgs,   setLoadingMsgs]   = useState(true);
  const [sending,       setSending]       = useState(false);
  const [error,         setError]         = useState(null);

  const scrollRef = useRef(null);

  // Carga el hilo desde el dataset mock — se usa cuando el threadId
  // empieza con "mock-th-" o cuando el backend devuelve 404 / 401.
  function loadFromMock() {
    const t = MOCK_AI_THREADS.find(x => x.id === threadId) || {
      id: threadId,
      titulo: "Nueva conversación (demo)",
      message_count: 0,
      tokens_in_total: 0,
      tokens_out_total: 0,
      mock_only: true,
    };
    setThread(t);
    setMessages(MOCK_AI_MESSAGES_BY_THREAD[threadId] || []);
    const ctx = MOCK_AI_CONTEXT_BY_THREAD[threadId] || { agents: [], skills: [], instructions: [] };
    setContext({
      agents:       ctx.agents       || [],
      skills:       ctx.skills       || [],
      instructions: ctx.instructions || [],
    });
    setUsingMock(true);
    setError(null);
    setLoadingMeta(false);
    setLoadingMsgs(false);
  }

  async function loadAll() {
    // Atajo: si el id ya es un thread mock, no llamamos al backend.
    if (_isMockThread(threadId)) {
      loadFromMock();
      return;
    }
    setLoadingMeta(true);
    setLoadingMsgs(true);
    setError(null);
    try {
      const [t, m, ctx] = await Promise.all([
        aiThreadsApi.get(threadId),
        aiChatApi.threadMessages(threadId, { ordering: "created_at" }),
        aiChatApi.threadContext(threadId).catch(() => ({ agents: [], skills: [], instructions: [] })),
      ]);
      setThread(t);
      const msgs = Array.isArray(m) ? m : (m?.results || []);
      setMessages(msgs);
      setContext({
        agents:        Array.isArray(ctx?.agents)       ? ctx.agents       : [],
        skills:        Array.isArray(ctx?.skills)       ? ctx.skills       : [],
        instructions:  Array.isArray(ctx?.instructions) ? ctx.instructions : [],
      });
      setUsingMock(false);
    } catch (e) {
      // Fail-soft: si el hilo no existe en backend, lo servimos como demo.
      loadFromMock();
    } finally {
      setLoadingMeta(false);
      setLoadingMsgs(false);
    }
  }
  useEffect(() => { if (threadId) loadAll(); /* eslint-disable-next-line */ }, [threadId]);

  // Autoscroll al fondo cuando llegan mensajes nuevos
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  async function handleSend(payload) {
    setSending(true);
    setError(null);
    // Optimistic: agregar el mensaje del usuario inmediatamente
    const optimistic = {
      id: `local-${Date.now()}`,
      thread_id: threadId,
      sender: "USER",
      content_text: payload.user_text,
      created_at: new Date().toISOString(),
      attachment_ids: payload.attachment_ids || [],
      _optimistic: true,
    };
    setMessages(arr => [...arr, optimistic]);

    // ── Modo demo: simulamos la respuesta del asistente sin tocar backend ──
    if (usingMock || _isMockThread(threadId)) {
      const userPersisted = { ...optimistic, _optimistic: false, mock_only: true };
      // Pequeño delay para que se vea el typing indicator
      setTimeout(() => {
        const assistant = _buildMockAssistantReply(payload.user_text, threadId);
        setMessages(arr => {
          const filtered = arr.filter(m => m.id !== optimistic.id);
          return [...filtered, userPersisted, assistant];
        });
        setThread(t => t ? {
          ...t,
          message_count: (t.message_count || 0) + 2,
          last_message_at: new Date().toISOString(),
          last_user_text: payload.user_text,
          tokens_in_total:  (t.tokens_in_total  || 0) + (assistant.tokens_in  || 0),
          tokens_out_total: (t.tokens_out_total || 0) + (assistant.tokens_out || 0),
        } : t);
        setSending(false);
      }, 900);
      return;
    }

    try {
      const resp = await aiChatApi.send(payload);
      // Reemplazar el optimistic con el user real + agregar el assistant
      setMessages(arr => {
        const filtered = arr.filter(m => m.id !== optimistic.id);
        const next = [...filtered];
        if (resp?.user) next.push(resp.user);
        if (resp?.assistant) next.push(resp.assistant);
        return next;
      });
      if (!resp?.ok && resp?.error_message) {
        setError(`LLM: ${resp.error_message}`);
      }
      // Persistir agentes/skills mencionados como anchors del hilo
      if ((payload.agent_ids || []).length > 0) {
        for (const aid of payload.agent_ids) {
          aiChatApi.anchor(threadId, { ref_type: "AGENT", ref_id: aid }).catch(() => {});
        }
      }
      if ((payload.skill_ids || []).length > 0) {
        for (const sid of payload.skill_ids) {
          aiChatApi.anchor(threadId, { ref_type: "SKILL", ref_id: sid }).catch(() => {});
        }
      }
      // Refrescar metadata + context (no bloqueante)
      aiThreadsApi.get(threadId).then(setThread).catch(() => {});
      aiChatApi.threadContext(threadId).then(c => setContext({
        agents: c?.agents || [], skills: c?.skills || [], instructions: c?.instructions || [],
      })).catch(() => {});
    } catch (e) {
      setError(e?.body?.detail || e?.message || "No se pudo enviar");
      // Remover el optimistic en caso de error duro
      setMessages(arr => arr.filter(m => m.id !== optimistic.id));
    } finally {
      setSending(false);
    }
  }

  async function togglePin() {
    if (!thread) return;
    if (usingMock || _isMockThread(thread.id)) {
      setThread(t => ({ ...t, pinned_at: t.pinned_at ? null : new Date().toISOString() }));
      return;
    }
    try {
      if (thread.pinned_at) await aiChatApi.unpinThread(thread.id);
      else                  await aiChatApi.pinThread(thread.id);
      const t = await aiThreadsApi.get(threadId);
      setThread(t);
    } catch (_) {
      setThread(t => ({ ...t, pinned_at: t.pinned_at ? null : new Date().toISOString() }));
    }
  }
  async function toggleArchive() {
    if (!thread) return;
    if (usingMock || _isMockThread(thread.id)) {
      setThread(t => ({ ...t, archived_at: t.archived_at ? null : new Date().toISOString() }));
      return;
    }
    try {
      if (thread.archived_at) await aiChatApi.unarchiveThread(thread.id);
      else                    await aiChatApi.archiveThread(thread.id);
      const t = await aiThreadsApi.get(threadId);
      setThread(t);
    } catch (_) {
      setThread(t => ({ ...t, archived_at: t.archived_at ? null : new Date().toISOString() }));
    }
  }

  const titulo = thread?.titulo || "Conversación";

  return (
    <div className="page ai-chat-page" style={{
      display: "flex", flexDirection: "column", height: "calc(100vh - var(--app-header-h, 0px))",
      background: "var(--surface-default, #F8FAFC)",
    }}>
      {/* Header */}
      <div className="ai-chat-header" style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "12px 20px",
        background: "var(--surface-elevated, #fff)",
        borderBottom: "1px solid var(--border-default, #E5E7EB)",
      }}>
        <button onClick={() => navigate("/ai")} className="ai-btn ai-btn-icon-ghost" title="Volver al hub">
          <IconChevLeft size={16} />
        </button>
        <span style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 32, height: 32, borderRadius: 8,
          background: "linear-gradient(135deg, rgba(72,30,227,0.10), rgba(48,131,254,0.10))",
          color: "#481EE3",
        }}>
          <IconBot size={16} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            font: "700 14.5px/1.2 var(--font-body)",
            color: "var(--text-primary)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{titulo}</div>
          <div style={{ font: "500 11px/1 var(--font-body)", color: "var(--text-tertiary)", marginTop: 3 }}>
            {(thread?.message_count || messages.length)} mensajes ·
            {' '}{context.agents.length}@ · {context.skills.length}/ · {context.instructions.length}⚙
            {thread?.tokens_in_total != null && (
              <> · <span className="tabular">tok {thread.tokens_in_total}↓ / {thread.tokens_out_total || 0}↑</span></>
            )}
          </div>
        </div>
        <button onClick={togglePin} className="ai-btn ai-btn-icon-ghost" title={thread?.pinned_at ? "Desanclar" : "Anclar"}>
          <IconPin size={16} />
        </button>
        <button onClick={toggleArchive} className="ai-btn ai-btn-icon-ghost" title={thread?.archived_at ? "Restaurar" : "Archivar"}>
          <IconArchive size={16} />
        </button>
        <button onClick={loadAll} className="ai-btn ai-btn-icon-ghost" title="Recargar">
          <IconRefresh size={16} />
        </button>
        <button onClick={() => navigate("/ai/governance")} className="ai-btn ai-btn-ghost">
          <IconBrain size={14} /> Gobernanza
        </button>
      </div>

      {/* Banner Demo */}
      {usingMock && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "8px 20px",
          background: "rgba(180,83,9,0.10)", color: "#B45309",
          borderBottom: "1px solid rgba(180,83,9,0.18)",
          font: "500 12.5px/1.4 var(--font-body)",
        }}>
          <span style={{
            display: "inline-flex", width: 7, height: 7, borderRadius: 999,
            background: "#B45309", flex: "0 0 7px",
          }}/>
          <span>
            <strong>Modo demo:</strong> esta conversación es un ejemplo.
            Tus mensajes generan respuestas simuladas hasta que el backend de IA esté conectado.
          </span>
        </div>
      )}

      {/* Stream de mensajes */}
      <div ref={scrollRef} className="ai-chat-stream" style={{
        flex: 1, overflowY: "auto",
        padding: "20px 24px",
        display: "flex", flexDirection: "column", gap: 12,
      }}>
        {loadingMsgs ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-tertiary)" }}>
            Cargando mensajes…
          </div>
        ) : messages.length === 0 ? (
          <div style={{
            padding: 40, textAlign: "center",
            font: "500 13px/1.5 var(--font-body)",
            color: "var(--text-tertiary)",
          }}>
            <IconBot size={36} />
            <div style={{ marginTop: 12, fontWeight: 600 }}>Empieza la conversación</div>
            <div>Escribe abajo, menciona agentes con <code>@</code> o invoca skills con <code>/</code>.</div>
          </div>
        ) : (
          messages.map(m => <MessageBubble key={m.id} message={m} />)
        )}
        {sending && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            font: "500 12px/1 var(--font-body)",
            color: "var(--text-tertiary)",
          }}>
            <span className="ai-typing-dot" />
            <span className="ai-typing-dot" />
            <span className="ai-typing-dot" />
            <span style={{ marginLeft: 4 }}>El asistente está pensando…</span>
          </div>
        )}
      </div>

      {/* Error global */}
      {error && (
        <div style={{
          padding: "8px 16px",
          background: "rgba(239,68,68,0.08)",
          color: "#B91C1C",
          font: "500 12.5px/1.4 var(--font-body)",
          borderTop: "1px solid rgba(239,68,68,0.20)",
        }}>
          ⚠ {error}
        </div>
      )}

      {/* Input footer */}
      <div className="ai-chat-footer" style={{
        padding: "12px 20px 18px",
        background: "var(--surface-elevated, #fff)",
        borderTop: "1px solid var(--border-default, #E5E7EB)",
      }}>
        <ChatInput
          threadId={threadId}
          userId={userId}
          defaultAgents={context.agents}
          defaultSkills={context.skills}
          defaultInstructions={context.instructions}
          onSend={handleSend}
          sending={sending}
        />
      </div>
    </div>
  );
}
