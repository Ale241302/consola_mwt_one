// =====================================================================
// MWT.ONE · TicketWidget — Flotante global de soporte (LOTE_SM_TICKETS)
// Agente responsable: [AG-03 · AG-FRONTEND]
//
// Esquina inferior derecha en TODAS las vistas autenticadas. Al abrirse:
//   - detecta la ruta actual del usuario (context_url)
//   - identifica al usuario logueado
//   - muestra select de motivo + textarea + dropzone (PDF/DOCX/JPG/PNG)
//   - al enviar: cierra y muestra toast de exito (con id corto del ticket)
//
// Reglas:
//   - Tokens MWT (R1): sin hex hardcodeados aqui (todo via CSS var en
//     styles/app.css → bloque .ticket-widget-*).
//   - Botones de accion con disabled + loading (R5).
//   - i18n via lang prop.
// =====================================================================
import React, { useState, useEffect, useRef, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";

import { useAuth } from "../../context/AuthContext.jsx";
import { ticketsApi } from "../../lib/api.js";

// Motivos de fallback si el endpoint /tickets/reasons/ no responde
// (BD recien levantada). El catalogo real lo manda el backend.
const FALLBACK_REASONS = [
  { codigo: "MEJORA",      label_es: "Mejoras de funcionamiento", label_en: "Functional improvements" },
  { codigo: "BUG",         label_es: "Reporte de bug",            label_en: "Bug report" },
  { codigo: "SOPORTE_OP",  label_es: "Soporte operativo",         label_en: "Operational support" },
  { codigo: "FACTURACION", label_es: "Duda de facturacion",       label_en: "Billing question" },
  { codigo: "OTRO",        label_es: "Otro",                       label_en: "Other" },
];

// Filtros de tipo de archivo (PDF, DOCX, JPG, PNG)
const ACCEPT = "application/pdf,.pdf,application/msword,.doc,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,.jpg,.jpeg,image/png,.png";
const MAX_BYTES = 25 * 1024 * 1024;

const TICKETS_PATH_RX = /^\/tickets(?:[/?]|$)/;

export default function TicketWidget({ lang = "es" }) {
  const location = useLocation();
  // accessToken (no "token") es la propiedad real expuesta por AuthContext.
  const { user, accessToken, isAuthenticated } = useAuth();

  // Si el usuario no esta logueado o ya esta en el modulo de tickets,
  // no mostramos el flotante (no tiene sentido superponerlo a la vista
  // del listado/detalle).
  const visible = useMemo(() => {
    if (!isAuthenticated && !user) return false;
    if (TICKETS_PATH_RX.test(location.pathname)) return false;
    return true;
  }, [isAuthenticated, user, location.pathname]);

  const [open, setOpen]         = useState(false);
  const [reasons, setReasons]   = useState(FALLBACK_REASONS);
  const [reason, setReason]     = useState("MEJORA");
  const [description, setDesc]  = useState("");
  const [files, setFiles]       = useState([]);
  const [submitting, setSubmit] = useState(false);
  const [errMsg, setErrMsg]     = useState(null);
  const [toast, setToast]       = useState(null);   // {id_short, type}

  const dropRef = useRef(null);

  // Carga catalogo de motivos al primer open
  useEffect(() => {
    if (!open) return;
    ticketsApi.reasons()
      .then(arr => {
        const list = Array.isArray(arr) ? arr : (arr?.results || []);
        if (list.length) setReasons(list);
      })
      .catch(() => { /* mantenemos fallback */ });
  }, [open]);

  // Cierra con ESC mientras esta abierto
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  // Sprint 2026-05-05: el FAB se removio y el panel ahora se abre desde
  // el icono de "Soporte" en el TopBar (al lado de la campana). El TopBar
  // dispara `window.dispatchEvent(new CustomEvent('mwt-tickets:open'))`
  // — escuchamos eso aqui para mostrar el modal sin acoplar contextos.
  useEffect(() => {
    const onOpen = () => {
      // Si la guardia visible esta apagada (no auth, o ya estamos en
      // /tickets), ignoramos. El boton del TopBar igual queda visible
      // por consistencia, pero no abre el panel.
      if (!visible) return;
      setOpen(true);
    };
    window.addEventListener("mwt-tickets:open", onOpen);
    return () => window.removeEventListener("mwt-tickets:open", onOpen);
  }, [visible]);

  const reset = () => {
    setReason("MEJORA");
    setDesc("");
    setFiles([]);
    setErrMsg(null);
    setSubmit(false);
  };

  const onClose = () => {
    if (submitting) return;
    setOpen(false);
    setTimeout(reset, 200);
  };

  const onAddFiles = (list) => {
    if (!list || !list.length) return;
    const arr = Array.from(list).slice(0, 6);
    const accepted = [];
    const rejected = [];
    for (const f of arr) {
      const okMime = /^(application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|image\/jpeg|image\/png)$/i.test(f.type)
                  || /\.(pdf|docx?|jpe?g|png)$/i.test(f.name);
      const okSize = f.size <= MAX_BYTES;
      if (okMime && okSize) accepted.push(f);
      else rejected.push(f.name + (okMime ? " (excede 25MB)" : " (formato no permitido)"));
    }
    if (accepted.length) {
      setFiles(prev => [...prev, ...accepted].slice(0, 6));
    }
    if (rejected.length) {
      setErrMsg(rejected.join(" · "));
      setTimeout(() => setErrMsg(null), 4000);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer?.files?.length) onAddFiles(e.dataTransfer.files);
  };

  const removeFile = (idx) => {
    setFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const onSubmit = async () => {
    setErrMsg(null);
    const txt = (description || "").trim();
    if (!txt) {
      setErrMsg(lang === "es" ? "Describe brevemente tu solicitud." : "Please describe your request.");
      return;
    }
    setSubmit(true);
    try {
      const body = {
        reason,
        description: txt,
        context_url: location.pathname + (location.search || ""),
      };
      const created = await ticketsApi.create(body);
      const ticketId = created?.id;
      // Subimos adjuntos en serie para que el backend pueda asociarlos
      // ordenadamente. Errores individuales no abortan el ticket.
      if (ticketId && files.length) {
        for (const f of files) {
          try {
            await ticketsApi.uploadAttachment(ticketId, f);
          } catch (e) {
            console.warn("[ticket widget] adjunto fallo:", f.name, e);
          }
        }
      }
      const idShort = String(ticketId || "").slice(0, 8);
      setToast({
        id_short: idShort,
        type:     "success",
        msg: lang === "es"
          ? `Ticket #${idShort} enviado. Te avisaremos por correo.`
          : `Ticket #${idShort} sent. We will email you back.`,
      });
      setOpen(false);
      setTimeout(reset, 200);
      setTimeout(() => setToast(null), 5500);
    } catch (e) {
      let m = String(e?.message || e || "");
      try {
        const parsed = JSON.parse(m);
        if (parsed && typeof parsed === "object") {
          m = Object.values(parsed).flat().join(" · ") || m;
        }
      } catch (_) { /* m ya es string */ }
      setErrMsg(m || (lang === "es" ? "No se pudo enviar el ticket." : "Could not send ticket."));
      setSubmit(false);
    }
  };

  if (!visible) return null;

  return (
    <>

      {/* Panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="ticket-overlay"
            className="ticket-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          >
            <motion.div
              className="ticket-panel"
              role="dialog"
              aria-modal="true"
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0,  scale: 1 }}
              exit={{ opacity: 0, y: 18, scale: 0.97 }}
              transition={{ duration: 0.22 }}
              onClick={(e) => e.stopPropagation()}
            >
              <header className="ticket-panel-head">
                <div>
                  <div className="micro" style={{letterSpacing:1}}>
                    {lang === "es" ? "SOPORTE MWT" : "MWT SUPPORT"}
                  </div>
                  <h3 className="heading-md" style={{margin:"4px 0 0"}}>
                    {lang === "es" ? "¿En que te ayudamos?" : "How can we help?"}
                  </h3>
                </div>
                <button type="button" className="btn-icon" onClick={onClose}
                        aria-label={lang === "es" ? "Cerrar" : "Close"}>
                  ×
                </button>
              </header>

              <div className="ticket-meta">
                <div className="ticket-meta-row">
                  <span className="ticket-meta-key">{lang === "es" ? "Usuario" : "User"}</span>
                  <span className="ticket-meta-val">
                    {user?.full_name || user?.email || "—"}
                  </span>
                </div>
                <div className="ticket-meta-row">
                  <span className="ticket-meta-key">{lang === "es" ? "Vista" : "Screen"}</span>
                  <code className="mono-sm ticket-meta-val">
                    {location.pathname || "/"}
                  </code>
                </div>
              </div>

              <div className="ticket-form">
                <label className="form-field">
                  <span>{lang === "es" ? "Motivo" : "Reason"}</span>
                  <select className="input" value={reason} onChange={e=>setReason(e.target.value)}>
                    {reasons.map(r => (
                      <option key={r.codigo} value={r.codigo}>
                        {lang === "es" ? r.label_es : (r.label_en || r.label_es)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="form-field">
                  <span>{lang === "es" ? "Descripcion" : "Description"}</span>
                  <textarea
                    className="input ticket-textarea"
                    rows={5}
                    maxLength={4000}
                    placeholder={lang === "es"
                      ? "Cuenta brevemente que paso, que esperabas y que viste."
                      : "Briefly describe what happened, what you expected, and what you saw."}
                    value={description}
                    onChange={e=>setDesc(e.target.value)}
                  />
                </label>

                <div className="form-field">
                  <span>{lang === "es" ? "Adjuntos (PDF, DOCX, JPG, PNG · max 25 MB c/u)" : "Attachments (PDF, DOCX, JPG, PNG · max 25 MB each)"}</span>
                  <div
                    ref={dropRef}
                    className="ticket-dropzone"
                    onDragOver={(e)=>{ e.preventDefault(); }}
                    onDrop={onDrop}
                    onClick={()=> dropRef.current?.querySelector("input")?.click() }
                    role="button"
                    tabIndex={0}
                  >
                    <div className="ticket-dropzone-cta">
                      <span className="ticket-dropzone-plus">+</span>
                      <span>
                        {lang === "es"
                          ? "Arrastra archivos o haz click para elegir"
                          : "Drag files or click to choose"}
                      </span>
                    </div>
                    <input
                      type="file"
                      multiple
                      accept={ACCEPT}
                      style={{ display: "none" }}
                      onChange={(e) => onAddFiles(e.target.files)}
                    />
                  </div>
                  {files.length > 0 && (
                    <ul className="ticket-files">
                      {files.map((f, i) => (
                        <li key={i}>
                          <span className="ticket-file-name truncate">{f.name}</span>
                          <span className="ticket-file-size tabular-nums">
                            {(f.size / 1024).toFixed(0)} KB
                          </span>
                          <button type="button" className="btn-icon-xs"
                                  aria-label="remove"
                                  onClick={(e) => { e.stopPropagation(); removeFile(i); }}>×</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {errMsg && (
                  <div className="ticket-err" role="alert">{errMsg}</div>
                )}
              </div>

              <footer className="ticket-panel-foot">
                <button type="button" className="btn" onClick={onClose} disabled={submitting}>
                  {lang === "es" ? "Cancelar" : "Cancel"}
                </button>
                <button
                  type="button"
                  className="btn btn-accent"
                  onClick={onSubmit}
                  disabled={submitting || !description.trim()}
                >
                  {submitting
                    ? (lang === "es" ? "Enviando…" : "Sending…")
                    : (lang === "es" ? "Enviar ticket" : "Send ticket")}
                </button>
              </footer>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast post-envio */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key="ticket-toast"
            className="ticket-toast"
            data-type={toast.type}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0  }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.22 }}
            role="status"
          >
            <span className="ticket-toast-dot" />
            <span>{toast.msg}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
