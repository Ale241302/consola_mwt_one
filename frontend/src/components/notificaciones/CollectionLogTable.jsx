// ─────────────────────────────────────────────────────────────
// CollectionLogTable — Auditoría de correos automáticos de cobranza
// Agente responsable: [AG-FRONTEND]
//
// Tabla dedicada al modelo CollectionEmailLog (read-only).
// Se alimenta del cron de cobranza (C1/C2/C3). Cada fila muestra
// el monto vencido, los días de gracia usados y el estado final.
//
// Columnas: fecha · expediente & proforma · monto vencido ·
//           grace days · destinatario · estado
// ─────────────────────────────────────────────────────────────
import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  IconSearch, IconX, IconSparkle, IconMail,
} from "../../lib/icons.jsx";
import NotificationStatusBadge from "./NotificationStatusBadge.jsx";

function fmtDate(s) {
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
  try { return new Date(s).toISOString().slice(0,10); } catch (e) { return ''; }
}
function fmtMoney(v, cur='USD') {
  if (v == null || isNaN(v)) return '—';
  return `${cur} ${Number(v).toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 })}`;
}

const TRIG_DOT = { C1:'#3083FE', C2:'#B45309', C3:'#DC2626' };

export default function CollectionLogTable({ lang='es', logs=[] }) {
  const navigate = useNavigate();
  const [q, setQ]       = useState('');
  const [from, setFrom] = useState('');
  const [to,   setTo]   = useState('');

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return logs
      .filter(c => {
        if (needle) {
          const hay = [c.expediente_id, c.proforma_id, c.recipient_email, c.to, c.trigger]
            .filter(Boolean).join(' ').toLowerCase();
          if (!hay.includes(needle)) return false;
        }
        if (from) { const d = toDateOnly(c.created_at || c.ts); if (d && d < from) return false; }
        if (to)   { const d = toDateOnly(c.created_at || c.ts); if (d && d > to)   return false; }
        return true;
      })
      .sort((a,b) => (b.created_at || '').localeCompare(a.created_at || ''));
  }, [logs, q, from, to]);

  const kpiTotal = rows.reduce((a, c) => a + (c.amount_overdue || 0), 0);
  const kpiC1 = rows.filter(c => c.trigger === 'C1').length;
  const kpiC2 = rows.filter(c => c.trigger === 'C2').length;
  const kpiC3 = rows.filter(c => c.trigger === 'C3').length;

  function clearFilters() { setQ(''); setFrom(''); setTo(''); }
  const hasFilters = q || from || to;

  return (
    <div className="nh-section">
      {/* Mini resumen cobranza */}
      <div className="nh-coll-summary">
        <div className="nh-coll-summary-item">
          <div className="micro">{lang==='es'?'MONTO VENCIDO TOTAL':'TOTAL OVERDUE'}</div>
          <div className="nh-coll-summary-value tabular-nums" style={{ color:'#B45309' }}>
            {fmtMoney(kpiTotal)}
          </div>
        </div>
        <div className="nh-coll-summary-item">
          <div className="micro">C1 · {lang==='es'?'PRIMER AVISO':'FIRST NOTICE'}</div>
          <div className="nh-coll-summary-value tabular-nums" style={{ color:'#3083FE' }}>{kpiC1}</div>
        </div>
        <div className="nh-coll-summary-item">
          <div className="micro">C2 · {lang==='es'?'SEGUNDO AVISO':'SECOND NOTICE'}</div>
          <div className="nh-coll-summary-value tabular-nums" style={{ color:'#B45309' }}>{kpiC2}</div>
        </div>
        <div className="nh-coll-summary-item">
          <div className="micro">C3 · {lang==='es'?'BLOQUEO':'BLOCK'}</div>
          <div className="nh-coll-summary-value tabular-nums" style={{ color:'#DC2626' }}>{kpiC3}</div>
        </div>
      </div>

      {/* Filtros */}
      <div className="nh-filters">
        <div className="search-wrap" style={{ maxWidth:340 }}>
          <IconSearch size={14} className="search-icon"/>
          <input
            className="input"
            placeholder={lang==='es'?'Buscar expediente, proforma, email…':'Search file, proforma, email…'}
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
        {hasFilters && (
          <button className="btn btn-ghost btn-sm" onClick={clearFilters}>
            <IconX size={12}/> {lang==='es'?'Limpiar':'Clear'}
          </button>
        )}
      </div>

      {/* Tabla */}
      <div className="card nh-coll-card">
        <div className="nh-coll-head">
          <div>{lang==='es'?'Fecha de envío':'Sent at'}</div>
          <div>{lang==='es'?'Expediente · Proforma':'File · Proforma'}</div>
          <div className="text-right">{lang==='es'?'Monto vencido':'Amount overdue'}</div>
          <div className="text-right">{lang==='es'?'Días de gracia':'Grace days'}</div>
          <div>{lang==='es'?'Destinatario':'Recipient'}</div>
          <div>{lang==='es'?'Estado':'Status'}</div>
        </div>

        <AnimatePresence mode="popLayout" initial={false}>
          {rows.map((c, idx) => (
            <motion.div
              key={c.id}
              layout
              initial={{ opacity:0, y:4 }}
              animate={{ opacity:1, y:0 }}
              exit={{ opacity:0 }}
              transition={{ duration:0.2, delay: Math.min(idx*0.012, 0.12) }}
              className="nh-coll-row"
            >
              <div className="nh-col-date">
                <div className="nh-date-main tabular-nums">{fmtDate(c.created_at || c.ts)}</div>
                <div className="nh-date-sub micro">
                  <span
                    className="nh-coll-trig-dot"
                    style={{ background: TRIG_DOT[c.trigger] || '#64748B' }}
                  />
                  {c.trigger}
                </div>
              </div>
              <div className="nh-col-refs">
                <button
                  type="button"
                  className="nh-exp-link mono"
                  onClick={() => navigate(`/expedientes/${c.expediente_id}`)}
                >
                  {c.expediente_id}
                </button>
                <div className="micro mono text-sec">{c.proforma_id || '—'}</div>
              </div>
              <div className="nh-col-amount tabular-nums text-right">
                {c.amount_overdue > 0 ? (
                  <span style={{ color:'#B45309', fontWeight:600 }}>{fmtMoney(c.amount_overdue, c.currency)}</span>
                ) : '—'}
              </div>
              <div className="nh-col-grace tabular-nums text-right">
                {c.grace_days_used != null ? (
                  <span
                    className="nh-grace-pill tabular-nums"
                    style={{
                      color: c.grace_days_used >= 10 ? '#DC2626' : c.grace_days_used >= 5 ? '#B45309' : '#0E8A6D',
                      borderColor: c.grace_days_used >= 10 ? 'rgba(220,38,38,0.35)' : c.grace_days_used >= 5 ? 'rgba(180,83,9,0.35)' : 'rgba(14,138,109,0.35)',
                      background: c.grace_days_used >= 10 ? 'rgba(220,38,38,0.10)' : c.grace_days_used >= 5 ? 'rgba(180,83,9,0.10)' : 'rgba(14,138,109,0.10)',
                    }}
                  >
                    {c.grace_days_used} d
                  </span>
                ) : '—'}
              </div>
              <div className="nh-col-to mono" title={c.recipient_email || c.to || '—'}>
                <IconMail size={10} style={{ opacity:0.6, marginRight:4, verticalAlign:'-1px' }}/>
                {c.recipient_email || c.to || '—'}
              </div>
              <div className="nh-col-status">
                <NotificationStatusBadge status={c.status}/>
                {c.error && (
                  <div className="micro" style={{ color:'var(--critical, #DC2626)', marginTop:4 }} title={c.error}>
                    {c.error.length > 50 ? c.error.slice(0,50) + '…' : c.error}
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {rows.length === 0 && (
          <div className="nh-empty">
            <IconSparkle size={20} style={{ opacity:0.35 }}/>
            <div className="heading-sm">
              {lang==='es'?'Sin cobranzas en el rango seleccionado':'No collections in range'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
