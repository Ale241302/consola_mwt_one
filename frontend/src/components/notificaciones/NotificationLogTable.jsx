// ─────────────────────────────────────────────────────────────
// NotificationLogTable — Tabla transaccional (NotificationLog)
// Agente responsable: [AG-FRONTEND]
//
// Tabla read-only, alta densidad, con:
//   · Filtros: expediente · fecha desde/hasta · estado
//   · Columnas: fecha · expediente · destinatario · trigger ·
//               template · intentos · estado
//   · Fila expandible (AnimatePresence) con subject, body_preview
//     y error técnico cuando status === 'Exhausted' | 'Failed'
// ─────────────────────────────────────────────────────────────
import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  IconSearch, IconX, IconChevDown, IconChevUp, IconAlert, IconMail,
  IconFileText, IconSparkle,
} from "../../lib/icons.jsx";
import { NOTIFICATION_TRIGGER_META } from "../../data/mockData.js";
import NotificationStatusBadge from "./NotificationStatusBadge.jsx";

const STATUS_FILTERS = ['ALL','Sent','Skipped','Disabled','Exhausted','Failed'];

function fmtDateTime(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d)) return '—';
  return d.toLocaleString('es-PE', {
    day:'2-digit', month:'short', year:'2-digit',
    hour:'2-digit', minute:'2-digit', hour12:false,
  });
}

function toDateOnly(s) {
  if (!s) return '';
  try { return new Date(s).toISOString().slice(0,10); }
  catch (e) { return ''; }
}

export default function NotificationLogTable({ lang='es', logs=[] }) {
  const navigate = useNavigate();

  const [q, setQ]           = useState('');
  const [statusF, setStatus]= useState('ALL');
  const [from, setFrom]     = useState('');
  const [to,   setTo]       = useState('');
  const [openId, setOpenId] = useState(null);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return logs
      .filter(n => {
        if (statusF !== 'ALL' && n.status !== statusF) return false;
        if (needle) {
          const hay = [
            n.expediente_id, n.to, n.recipient_email, n.subject,
            n.template_key, n.trigger, n.id,
          ].join(' ').toLowerCase();
          if (!hay.includes(needle)) return false;
        }
        if (from) {
          const d = toDateOnly(n.ts);
          if (d && d < from) return false;
        }
        if (to) {
          const d = toDateOnly(n.ts);
          if (d && d > to) return false;
        }
        return true;
      })
      .sort((a,b) => (b.ts || '').localeCompare(a.ts || ''));
  }, [logs, q, statusF, from, to]);

  const statusCounts = useMemo(() => {
    const c = { ALL: logs.length };
    for (const s of STATUS_FILTERS) {
      if (s === 'ALL') continue;
      c[s] = logs.filter(n => n.status === s).length;
    }
    return c;
  }, [logs]);

  function clearFilters() {
    setQ(''); setStatus('ALL'); setFrom(''); setTo('');
  }
  const hasFilters = q || statusF !== 'ALL' || from || to;

  return (
    <div className="nh-section">
      {/* Filtros */}
      <div className="nh-filters">
        <div className="search-wrap" style={{ maxWidth:320 }}>
          <IconSearch size={14} className="search-icon"/>
          <input
            className="input"
            placeholder={lang==='es'?'Buscar expediente, email, trigger…':'Search file, email, trigger…'}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q && <button className="search-clear" onClick={() => setQ('')}><IconX size={12}/></button>}
        </div>

        <div className="nh-date-range">
          <span className="micro">{lang==='es'?'Desde':'From'}</span>
          <input type="date" className="input input-sm" value={from} onChange={(e) => setFrom(e.target.value)}/>
          <span className="micro">{lang==='es'?'Hasta':'To'}</span>
          <input type="date" className="input input-sm" value={to}   onChange={(e) => setTo(e.target.value)}/>
        </div>

        <div className="nh-status-chips">
          {STATUS_FILTERS.map(s => (
            <button
              key={s}
              type="button"
              className={`nh-chip ${statusF === s ? 'is-active' : ''}`}
              onClick={() => setStatus(s)}
            >
              <span className="nh-chip-label">
                {s === 'ALL' ? (lang==='es'?'Todos':'All') : s}
              </span>
              <span className="nh-chip-count tabular-nums">
                {s === 'ALL' ? statusCounts.ALL : (statusCounts[s] || 0)}
              </span>
            </button>
          ))}
        </div>

        {hasFilters && (
          <button className="btn btn-ghost btn-sm" onClick={clearFilters}>
            <IconX size={12}/> {lang==='es'?'Limpiar':'Clear'}
          </button>
        )}
      </div>

      {/* Tabla */}
      <div className="card nh-table-card">
        <div className="nh-table-head">
          <div>{lang==='es'?'Fecha y hora':'Date & time'}</div>
          <div>{lang==='es'?'Expediente':'File'}</div>
          <div>{lang==='es'?'Destinatario':'Recipient'}</div>
          <div>{lang==='es'?'Trigger':'Trigger'}</div>
          <div>{lang==='es'?'Template':'Template'}</div>
          <div className="text-right">{lang==='es'?'Intentos':'Attempts'}</div>
          <div>{lang==='es'?'Estado':'Status'}</div>
          <div/>
        </div>

        <AnimatePresence mode="popLayout" initial={false}>
          {rows.map((n, idx) => {
            const tMeta = NOTIFICATION_TRIGGER_META[n.trigger] || { label: n.trigger, color:'#64748B' };
            const isOpen = openId === n.id;
            const hasErr = (n.status === 'Exhausted' || n.status === 'Failed') && n.error;
            const attempts = n.attempt_count != null ? n.attempt_count : ((n.retries || 0) + (n.status === 'Sent' || n.status === 'Failed' ? 1 : 0));

            return (
              <motion.div
                key={n.id}
                layout
                initial={{ opacity:0, y:4 }}
                animate={{ opacity:1, y:0 }}
                exit={{ opacity:0 }}
                transition={{ duration:0.2, delay: Math.min(idx*0.012, 0.12) }}
                className={`nh-row ${isOpen ? 'is-open' : ''} ${hasErr ? 'has-err' : ''}`}
              >
                <div className="nh-row-main" onClick={() => setOpenId(isOpen ? null : n.id)}>
                  <div className="nh-col-date">
                    <div className="nh-date-main tabular-nums">{fmtDateTime(n.completed_at || n.ts)}</div>
                    <div className="nh-date-sub micro">id {n.id}</div>
                  </div>
                  <div className="nh-col-exp">
                    <button
                      type="button"
                      className="nh-exp-link mono"
                      onClick={(e) => { e.stopPropagation(); navigate(`/expedientes/${n.expediente_id}`); }}
                    >
                      {n.expediente_id}
                    </button>
                  </div>
                  <div className="nh-col-to mono" title={n.recipient_email || n.to || '—'}>
                    {n.recipient_email || n.to || '—'}
                  </div>
                  <div className="nh-col-trig">
                    <span
                      className="nh-trigger-pill mono"
                      style={{ '--trig-color': tMeta.color }}
                    >
                      {tMeta.label}
                    </span>
                  </div>
                  <div className="nh-col-tpl mono">{n.template_key}</div>
                  <div className="nh-col-att tabular-nums text-right">{attempts}</div>
                  <div className="nh-col-status">
                    <NotificationStatusBadge status={n.status}/>
                  </div>
                  <div className="nh-col-caret">
                    {isOpen
                      ? <IconChevUp size={14}/>
                      : <IconChevDown size={14}/>}
                  </div>
                </div>

                {/* Fila expandida */}
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      key="exp"
                      initial={{ height:0, opacity:0 }}
                      animate={{ height:'auto', opacity:1 }}
                      exit={{ height:0, opacity:0 }}
                      transition={{ duration:0.22, ease:'easeOut' }}
                      className="nh-row-expand"
                    >
                      <div className="nh-expand-inner">
                        <div className="nh-expand-grid">
                          <div className="nh-expand-block">
                            <div className="micro">{lang==='es'?'ASUNTO':'SUBJECT'}</div>
                            <div className="body-md" style={{ fontWeight:500 }}>
                              {n.subject && n.subject !== '—' ? n.subject : (lang==='es'?'— sin asunto —':'— no subject —')}
                            </div>
                          </div>
                          <div className="nh-expand-block">
                            <div className="micro">{lang==='es'?'CUERPO (PREVIEW)':'BODY PREVIEW'}</div>
                            <pre className="nh-body-preview">{n.body_preview || '—'}</pre>
                          </div>

                          {n.skip_reason && (
                            <div className="nh-expand-block is-warn">
                              <div className="micro" style={{ color:'var(--warning, #B45309)' }}>
                                {lang==='es'?'RAZÓN DE OMISIÓN':'SKIP REASON'}
                              </div>
                              <div className="body-sm" style={{ color:'var(--warning, #B45309)' }}>
                                {n.skip_reason}
                              </div>
                            </div>
                          )}

                          {hasErr && (
                            <div className="nh-expand-block is-err">
                              <div className="micro" style={{ color:'var(--critical, #DC2626)' }}>
                                <IconAlert size={11} style={{ verticalAlign:'-1px', marginRight:3 }}/>
                                {lang==='es'?'ERROR TÉCNICO':'TECHNICAL ERROR'}
                              </div>
                              <pre className="nh-body-preview nh-body-err">{n.error}</pre>
                            </div>
                          )}
                        </div>

                        <div className="nh-expand-meta">
                          <span className="micro">
                            <IconFileText size={10}/> {n.template_key}
                          </span>
                          <span className="micro">
                            <IconMail size={10}/> {n.recipient_email || n.to || '—'}
                          </span>
                          <span className="micro tabular-nums">
                            {lang==='es'?'Intentos':'Attempts'}: {attempts}
                          </span>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {rows.length === 0 && (
          <div className="nh-empty">
            <IconSparkle size={20} style={{ opacity:0.35 }}/>
            <div className="heading-sm">
              {lang==='es'?'Sin registros con esos filtros':'No records match these filters'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
