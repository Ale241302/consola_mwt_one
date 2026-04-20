// ─────────────────────────────────────────────────────────────
// TestSendModal — Enviar correo de prueba (test-send)
// Agente responsable: [AG-FRONTEND]
//
// Modal centrado que exige sample_expediente_id y renderiza las
// variables Jinja2 con los datos reales del expediente seleccionado.
// El correo se envía al email del CEO para validar el render.
//
// Para la key "proforma.sent" el modo es Send Proforma (dedup 1h).
// ─────────────────────────────────────────────────────────────
import React, { useState, useMemo, useEffect } from "react";
import { motion } from "framer-motion";
import {
  IconX, IconSearch, IconCheck, IconAlert, IconEye, IconSparkle,
  IconPaperclip, IconFileText,
} from "../../lib/icons.jsx";
import { EXPEDIENTES } from "../../data/mockData.js";

// Email del CEO destino de las pruebas (en producción viene de settings)
const CEO_EMAIL = 'alejandro@muitowork.com';

// ── Render helper ───────────────────────────────────
// Sustituye {{ var }} con ctx[var]. Si no existe, deja un marcador visible.
function renderTemplate(src, ctx) {
  if (!src) return { out:'', missing: [] };
  const missing = new Set();
  const out = src.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*(\|\s*[^}]+)?\}\}/g, (full, key) => {
    const v = ctx[key];
    if (v == null) { missing.add(key); return `⟨${key}⟩`; }
    return String(v);
  }).replace(/\{%[^%]+%\}/g, '');
  return { out, missing: Array.from(missing) };
}

function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d)) return s;
  return d.toLocaleDateString('es-PE', { day:'2-digit', month:'short', year:'numeric' });
}

function ctxFromExpediente(exp) {
  if (!exp) return {};
  const due = new Date(exp.eta || Date.now());
  const daysOverdue = Math.max(0, Math.floor((Date.now() - due.getTime()) / 86400000));
  const daysToDue   = Math.max(0, Math.floor((due.getTime() - Date.now()) / 86400000));
  return {
    expediente_code:  exp.ref,
    client_name:      exp.client,
    operator_name:    'A. Mendoza',
    dispatch_date:    fmtDate(exp.shipment_date),
    eta_date:         fmtDate(exp.eta),
    freight_mode:     exp.freight_mode,
    invoice_code:     'INV-' + String(2500 + (parseInt(exp.ref.replace(/\D/g,'')) % 200)).padStart(4,'0'),
    proforma_code:    exp.proforma,
    total_amount:     (exp.total_invoiced || 0).toLocaleString('en-US'),
    amount:           Math.round((exp.total_paid || 0) / 2).toLocaleString('en-US'),
    balance:          (exp.balance || 0).toLocaleString('en-US'),
    currency:         exp.currency,
    advance_pct:      50,
    days_to_due:      daysToDue,
    days_overdue:     daysOverdue,
    due_date:         fmtDate(exp.eta),
  };
}

export default function TestSendModal({ lang='es', template, mode='test', onClose, onSent }) {
  const [q, setQ]         = useState('');
  const [expId, setExpId] = useState('');
  const [step, setStep]   = useState(1); // 1=pick · 2=preview · 3=done
  const [cc, setCc]       = useState('');
  const isProforma = mode === 'proforma' || template?.template_key === 'proforma.sent';

  // scroll lock
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Dedup visual mock — simula que la proforma ya se envió hace 18 minutos
  const [alreadySentRecent] = useState(() =>
    isProforma && Math.random() < 0.45
  );

  const expedientes = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return EXPEDIENTES
      .filter(e => !needle || [e.ref, e.client, e.brand, e.proforma || ''].join(' ').toLowerCase().includes(needle))
      .slice(0, 60);
  }, [q]);

  const expSel = useMemo(() => EXPEDIENTES.find(e => e.id === expId), [expId]);
  const ctx    = useMemo(() => ctxFromExpediente(expSel), [expSel]);

  const rSubject = useMemo(
    () => renderTemplate(template?.subject_template || '', ctx),
    [template, ctx]
  );
  const rBody = useMemo(
    () => renderTemplate(template?.body_template || '', ctx),
    [template, ctx]
  );

  const allMissing = Array.from(new Set([...rSubject.missing, ...rBody.missing]));
  const canSend = !!expSel && allMissing.length === 0;

  function doSend() {
    setStep(3);
    onSent?.({
      template_key: template?.template_key,
      expediente_id: expSel?.id,
      to: isProforma ? (expSel?.client_country || '') : CEO_EMAIL,
      mode,
    });
  }

  return (
    <>
      <div className="modal-overlay" onClick={onClose}/>
      <motion.div
        className="modal-card tpl-test-modal"
        initial={{ opacity:0, y:18, scale:0.97 }}
        animate={{ opacity:1, y:0,  scale:1 }}
        exit={{ opacity:0, scale:0.97 }}
        transition={{ type:'spring', stiffness:280, damping:28 }}
      >
        <div className="modal-head">
          <div className="flex ai-center gap-2">
            <div
              className="tpl-test-icon"
              style={{
                background: isProforma ? 'rgba(72,30,227,0.12)' : 'rgba(0,178,134,0.12)',
                color: isProforma ? '#481EE3' : '#00B286',
              }}
            >
              {isProforma ? <IconPaperclip size={14}/> : <IconSparkle size={14}/>}
            </div>
            <div>
              <div className="micro" style={{ marginBottom:2 }}>
                {isProforma
                  ? (lang==='es'?'ENVÍO MANUAL DE PROFORMA':'MANUAL PROFORMA SEND')
                  : (lang==='es'?'ENVÍO DE PRUEBA':'TEST SEND')}
              </div>
              <div className="heading-md">{template?.name || '—'}</div>
              <div className="micro text-sec mono">{template?.template_key}</div>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <IconX size={16}/>
          </button>
        </div>

        {/* ── Step 3 · Done ───── */}
        {step === 3 && (
          <motion.div
            initial={{ opacity:0 }}
            animate={{ opacity:1 }}
            className="tpl-test-done"
          >
            <div className="tpl-test-done-icon">
              <IconCheck size={22}/>
            </div>
            <div className="heading-md">
              {isProforma
                ? (lang==='es'?'Proforma enviada':'Proforma sent')
                : (lang==='es'?'Correo de prueba enviado':'Test email dispatched')}
            </div>
            <div className="body-sm text-sec">
              {isProforma
                ? (lang==='es'
                    ? `Enviada a ${expSel?.client || '—'} con datos reales de ${expSel?.ref || '—'}.`
                    : `Sent to ${expSel?.client || '—'} using real data from ${expSel?.ref || '—'}.`)
                : (lang==='es'
                    ? `Enviado a ${CEO_EMAIL} · render con variables de ${expSel?.ref || '—'}.`
                    : `Sent to ${CEO_EMAIL} · rendered with vars from ${expSel?.ref || '—'}.`)}
            </div>
            <div className="flex ai-center gap-2" style={{ marginTop:14 }}>
              <button className="btn btn-accent" onClick={onClose}>
                <IconCheck size={12}/> {lang==='es'?'Cerrar':'Close'}
              </button>
            </div>
          </motion.div>
        )}

        {/* ── Step 1/2 · contenido ───── */}
        {step !== 3 && (
          <>
            {/* Dedup warn (solo proforma) */}
            {isProforma && alreadySentRecent && (
              <div className="tpl-test-dedup">
                <IconAlert size={14}/>
                <div>
                  <div className="heading-sm" style={{ color:'var(--warning, #B45309)' }}>
                    {lang==='es'?'Proforma enviada hace <1 h':'Proforma sent <1 h ago'}
                  </div>
                  <div className="micro">
                    {lang==='es'
                      ? 'Revisa con el cliente si necesitas reenviarla para evitar duplicidad.'
                      : 'Double-check with the client before resending to avoid duplication.'}
                  </div>
                </div>
              </div>
            )}

            {/* Step 1 · Pick expediente */}
            <div className="tpl-test-body">
              <div className="tpl-test-field">
                <label className="tpl-label">
                  <span className="mono" style={{ fontSize:11 }}>sample_expediente_id</span>
                  <span className="tpl-hint micro">
                    {lang==='es'?'Expediente real para renderizar variables':'Real file to render variables'}
                  </span>
                </label>
                <div className="search-wrap">
                  <IconSearch size={14} className="search-icon"/>
                  <input
                    className="input"
                    placeholder={lang==='es'?'Buscar por ID, cliente, proforma…':'Search by ID, client, proforma…'}
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                  />
                  {q && <button className="search-clear" onClick={() => setQ('')}><IconX size={12}/></button>}
                </div>
                <div className="tpl-test-exp-list">
                  {expedientes.map(e => (
                    <button
                      key={e.id}
                      className={`tpl-test-exp ${expId === e.id ? 'is-sel' : ''}`}
                      onClick={() => setExpId(e.id)}
                    >
                      <div className="tpl-test-exp-id mono">{e.ref}</div>
                      <div className="tpl-test-exp-name">{e.client}</div>
                      <div className="tpl-test-exp-meta micro">
                        {e.client_country} · {e.brand} · {e.proforma || '—'}
                      </div>
                    </button>
                  ))}
                  {expedientes.length === 0 && (
                    <div className="tpl-test-exp-empty text-sec body-sm">
                      {lang==='es'?'Sin expedientes con esos filtros':'No files match these filters'}
                    </div>
                  )}
                </div>
              </div>

              {/* Preview render con variables resueltas */}
              {expSel && (
                <motion.div
                  className="tpl-test-preview"
                  initial={{ opacity:0, y:4 }}
                  animate={{ opacity:1, y:0 }}
                  transition={{ duration:0.2 }}
                >
                  <div className="tpl-test-preview-head">
                    <div className="flex ai-center gap-2">
                      <IconEye size={13} style={{ color:'var(--brand-accent, #00B286)' }}/>
                      <div className="heading-sm" style={{ margin:0 }}>
                        {lang==='es'?'Preview renderizado':'Rendered preview'}
                      </div>
                    </div>
                    <div className="tpl-test-preview-meta micro">
                      {lang==='es'?'con datos de':'using data from'} <strong className="mono">{expSel.ref}</strong>
                    </div>
                  </div>

                  <div className="tpl-test-preview-subject">
                    <div className="micro">{lang==='es'?'ASUNTO':'SUBJECT'}</div>
                    <div className="body-sm">{rSubject.out || '—'}</div>
                  </div>

                  <div className="tpl-test-preview-body">
                    <pre className="tpl-preview-pre">{rBody.out}</pre>
                  </div>

                  {allMissing.length > 0 && (
                    <div className="tpl-test-missing">
                      <IconAlert size={13}/>
                      <div>
                        <div className="heading-sm" style={{ color:'var(--critical, #DC2626)' }}>
                          {lang==='es'?'Variables sin resolver':'Unresolved variables'}
                        </div>
                        <div className="tpl-vars-chips">
                          {allMissing.map(v => (
                            <span key={v} className="jinja-chip mono is-err">{v}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </div>

            {/* Footer */}
            <div className="modal-foot">
              <div className="micro text-sec">
                {isProforma
                  ? (lang==='es'
                      ? <>Se enviará al cliente del expediente seleccionado.</>
                      : <>Will be sent to the client of the selected file.</>)
                  : (lang==='es'
                      ? <>Se enviará a <span className="mono">{CEO_EMAIL}</span> para validar render.</>
                      : <>Will be sent to <span className="mono">{CEO_EMAIL}</span> for render validation.</>)}
              </div>
              <div className="flex ai-center gap-2">
                <button className="btn btn-ghost" onClick={onClose}>
                  {lang==='es'?'Cancelar':'Cancel'}
                </button>
                <button
                  className={`btn ${isProforma ? 'btn-brand' : 'btn-accent'}`}
                  disabled={!canSend}
                  onClick={doSend}
                >
                  <IconCheck size={12}/>
                  {isProforma
                    ? (lang==='es'?'Enviar proforma':'Send proforma')
                    : (lang==='es'?'Enviar correo de prueba':'Send test email')}
                </button>
              </div>
            </div>
          </>
        )}
      </motion.div>
    </>
  );
}
