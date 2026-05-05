// =====================================================================
// MWT.ONE · TicketDetail — Vista de chat (LOTE_SM_TICKETS)
// Agente responsable: [AG-03 · AG-FRONTEND]
//
// Layout:
//   Header (ref + estado + motivo + contexto)
//   Mensaje original (descripcion del usuario que abrio el ticket)
//   Hilo de mensajes
//   Input inferior (texto + adjuntar)
//
// Reglas:
//   - Si is_finalized: input deshabilitado + banner "ticket cerrado".
//   - Admin tiene dropdown de estado en el header.
//   - Adjuntos via /attachments/<id>/download/ → signed URL al click.
// =====================================================================
import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useOutletContext, useParams, Link } from "react-router-dom";

import { useRole } from "../context/RoleContext.jsx";
import { ticketsApi } from "../lib/api.js";

const STATUS_LABELS = {
  ABIERTO:     { es: "Abierto",     en: "Open",       color: "amber" },
  EN_REVISION: { es: "En revision", en: "In review",  color: "blue"  },
  RESUELTO:    { es: "Resuelto",    en: "Resolved",   color: "green" },
  FINALIZADO:  { es: "Finalizado",  en: "Finalized",  color: "gray"  },
};

const REASON_LABELS = {
  MEJORA:      { es: "Mejora",       en: "Improvement"     },
  BUG:         { es: "Bug",          en: "Bug"             },
  SOPORTE_OP:  { es: "Operativo",    en: "Operational"     },
  FACTURACION: { es: "Facturacion",  en: "Billing"         },
  OTRO:        { es: "Otro",         en: "Other"           },
};

const ACCEPT_INPUT = "application/pdf,.pdf,application/msword,.doc,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,.jpg,.jpeg,image/png,.png";

export default function ScreenTicketDetail() {
  const navigate = useNavigate();
  const { lang } = useOutletContext();
  const { ticketId } = useParams();
  const { isAdmin } = useRole();

  const [ticket, setTicket]     = useState(null);
  const [loading, setLoading]   = useState(true);
  const [errMsg, setErrMsg]     = useState(null);

  const [draft, setDraft]       = useState("");
  const [pending, setPending]   = useState([]);     // archivos a subir junto con el mensaje
  const [sending, setSending]   = useState(false);

  const fileInputRef = useRef(null);
  const threadEndRef = useRef(null);

  const reload = async () => {
    setLoading(true);
    setErrMsg(null);
    try {
      const t = await ticketsApi.get(ticketId);
      setTicket(t);
    } catch (e) {
      setErrMsg(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [ticketId]);

  // Auto-scroll al final del hilo cuando llegan mensajes nuevos
  useEffect(() => {
    if (threadEndRef.current) {
      threadEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [ticket?.messages?.length]);

  const finalized = !!ticket?.is_finalized;

  const onTransition = async (target) => {
    if (finalized) return;
    if (target === "FINALIZADO") {
      const ok = window.confirm(lang === "es"
        ? "¿Finalizar ticket? Esta accion es irreversible."
        : "Finalize ticket? This is irreversible.");
      if (!ok) return;
    }
    try {
      const updated = await ticketsApi.transition(ticketId, target);
      setTicket(updated);
    } catch (e) { alert(String(e?.message || e)); }
  };

  const onAddFiles = (list) => {
    if (!list || !list.length) return;
    const arr = Array.from(list).slice(0, 6);
    setPending(prev => [...prev, ...arr].slice(0, 6));
  };

  const removePending = (idx) => {
    setPending(prev => prev.filter((_, i) => i !== idx));
  };

  const onSend = async () => {
    if (finalized) return;
    const txt = (draft || "").trim();
    if (!txt && pending.length === 0) return;
    setSending(true);
    try {
      let messageId = null;
      if (txt) {
        const m = await ticketsApi.postMessage(ticketId, txt);
        messageId = m?.id || null;
      }
      // Subimos los adjuntos vinculados al mensaje (si lo creamos) o al
      // ticket si solo se mando un archivo sin texto.
      for (const f of pending) {
        try {
          await ticketsApi.uploadAttachment(ticketId, f, { messageId });
        } catch (e) {
          console.warn("[ticket detail] adjunto fallo:", f.name, e);
        }
      }
      setDraft("");
      setPending([]);
      await reload();
    } catch (e) {
      alert(String(e?.message || e));
    } finally {
      setSending(false);
    }
  };

  const onDownload = async (att) => {
    try {
      const r = await ticketsApi.attachmentDownloadUrl(ticketId, att.id);
      if (r?.url) window.open(r.url, "_blank", "noopener,noreferrer");
    } catch (e) { alert(String(e?.message || e)); }
  };

  if (loading && !ticket) {
    return (
      <div className="page">
        <div className="card card-pad-lg" style={{color:"var(--text-tertiary)"}}>
          {lang === "es" ? "Cargando ticket…" : "Loading ticket…"}
        </div>
      </div>
    );
  }
  if (errMsg && !ticket) {
    return (
      <div className="page">
        <div className="card card-pad-lg" style={{color:"var(--state-critical)"}}>
          {errMsg}
        </div>
      </div>
    );
  }
  if (!ticket) return null;

  const status = STATUS_LABELS[ticket.status] || STATUS_LABELS.ABIERTO;
  const reason = REASON_LABELS[ticket.reason] || REASON_LABELS.OTRO;
  const messages = ticket.messages || [];
  const headerAttachments = ticket.attachments || [];

  return (
    <div className="page ticket-detail-page" data-screen-label="Ticket detail">
      <div className="page-header">
        <div style={{display:"flex", alignItems:"center", gap:12}}>
          <button className="btn btn-sm btn-ghost" onClick={() => navigate("/tickets")}>
            ←
          </button>
          <div>
            <div className="micro" style={{marginBottom:4}}>
              {lang === "es" ? "TICKET" : "TICKET"}
            </div>
            <h1 className="page-title mono-sm">#{String(ticket.id).slice(0, 8)}</h1>
            <div className="page-subtitle">
              {ticket.user_full_name || ticket.user_email}
              {ticket.user_email && ticket.user_full_name && (
                <span style={{color:"var(--text-tertiary)"}}> · {ticket.user_email}</span>
              )}
            </div>
          </div>
        </div>
        <div style={{display:"flex", alignItems:"center", gap:10}}>
          <span className="ticket-pill ticket-pill-reason">{reason[lang] || reason.es}</span>
          <span className="ticket-pill" data-color={status.color}>{status[lang] || status.es}</span>
          {isAdmin && !finalized && (
            <select
              className="select select-sm"
              value={ticket.status}
              onChange={(e) => onTransition(e.target.value)}
            >
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v[lang] || v.es}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="ticket-detail-meta">
        <div>
          <span className="micro">{lang === "es" ? "VISTA" : "SCREEN"}</span>
          <code className="mono-sm">{ticket.context_url || "—"}</code>
        </div>
        <div>
          <span className="micro">{lang === "es" ? "CREADO" : "CREATED"}</span>
          <span className="tabular-nums">
            {ticket.created_at
              ? new Date(ticket.created_at).toLocaleString(lang === "es" ? "es-MX" : "en-US")
              : "—"}
          </span>
        </div>
        {ticket.first_response_at && (
          <div>
            <span className="micro">{lang === "es" ? "1RA RESPUESTA" : "FIRST REPLY"}</span>
            <span className="tabular-nums">
              {new Date(ticket.first_response_at).toLocaleString(lang === "es" ? "es-MX" : "en-US")}
            </span>
          </div>
        )}
      </div>

      {/* Hilo */}
      <div className="ticket-thread">
        {/* Mensaje 0: descripcion original del ticket */}
        <ChatBubble
          mine={false}
          name={ticket.user_full_name || ticket.user_email || "—"}
          email={ticket.user_email}
          isOriginal
          time={ticket.created_at}
          content={ticket.description}
          attachments={headerAttachments}
          onDownload={onDownload}
          lang={lang}
        />

        {messages.map(m => (
          <ChatBubble
            key={m.id}
            mine={(m.sender_role || "").toLowerCase() && (
              isAdmin
                ? ["admin","superadmin","ceo","manager"].includes((m.sender_role || "").toLowerCase())
                : !["admin","superadmin","ceo","manager"].includes((m.sender_role || "").toLowerCase())
            )}
            name={m.sender_email}
            email={m.sender_email}
            role={m.sender_role}
            time={m.created_at}
            content={m.content}
            attachments={m.attachments || []}
            onDownload={onDownload}
            lang={lang}
          />
        ))}
        <div ref={threadEndRef}/>
      </div>

      {/* Composer */}
      {finalized ? (
        <div className="ticket-finalized-banner">
          <strong>
            {lang === "es" ? "Ticket finalizado." : "Ticket finalized."}
          </strong>{" "}
          {lang === "es"
            ? "No se aceptan mas mensajes ni cambios."
            : "No more messages or edits accepted."}
        </div>
      ) : (
        <div className="ticket-composer">
          <textarea
            className="input ticket-composer-textarea"
            rows={2}
            placeholder={lang === "es"
              ? "Escribe tu respuesta…"
              : "Write your reply…"}
            value={draft}
            onChange={e=>setDraft(e.target.value)}
            disabled={sending}
            onKeyDown={e=>{
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) onSend();
            }}
          />
          <div className="ticket-composer-actions">
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending}
              title={lang === "es" ? "Adjuntar" : "Attach"}
            >
              📎 {lang === "es" ? "Adjuntar" : "Attach"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPT_INPUT}
              style={{ display: "none" }}
              onChange={e => onAddFiles(e.target.files)}
            />
            <div style={{flex:1}}/>
            <button
              className="btn btn-accent"
              onClick={onSend}
              disabled={sending || (!draft.trim() && pending.length === 0)}
            >
              {sending ? (lang === "es" ? "Enviando…" : "Sending…")
                       : (lang === "es" ? "Enviar"   : "Send")}
            </button>
          </div>
          {pending.length > 0 && (
            <ul className="ticket-files">
              {pending.map((f, i) => (
                <li key={i}>
                  <span className="ticket-file-name truncate">{f.name}</span>
                  <span className="ticket-file-size tabular-nums">
                    {(f.size / 1024).toFixed(0)} KB
                  </span>
                  <button type="button" className="btn-icon-xs"
                          onClick={() => removePending(i)}>×</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Chat bubble ────────────────────────────────────────
function ChatBubble({ mine, name, email, role, time, content, attachments = [], onDownload, isOriginal, lang }) {
  const t = time ? new Date(time) : null;
  return (
    <div className="ticket-bubble" data-mine={mine || undefined} data-original={isOriginal || undefined}>
      <div className="ticket-bubble-head">
        <span className="heading-sm">{name || (lang === "es" ? "Anónimo" : "Anonymous")}</span>
        {role && (
          <span className="ticket-bubble-role">{role}</span>
        )}
        {isOriginal && (
          <span className="ticket-pill ticket-pill-reason" style={{marginLeft:6}}>
            {lang === "es" ? "Mensaje inicial" : "Original message"}
          </span>
        )}
        {t && (
          <span className="ticket-bubble-time tabular-nums">
            {t.toLocaleString(lang === "es" ? "es-MX" : "en-US",
              { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" })}
          </span>
        )}
      </div>
      <div className="ticket-bubble-body">{content}</div>
      {attachments.length > 0 && (
        <ul className="ticket-bubble-atts">
          {attachments.map(a => (
            <li key={a.id}>
              <button type="button" className="btn btn-sm btn-ghost"
                      onClick={() => onDownload(a)}>
                📎 {a.file_name}
                <span className="caption" style={{marginLeft:6, color:"var(--text-tertiary)"}}>
                  ({a.file_kind})
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
