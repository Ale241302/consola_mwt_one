// Pipeline kanban — drag-and-drop, rich cards per Módulo/Artefacto spec
//
// Each card shows:
//  1. Identifiers: Ref (mono, clickable), Cliente, Marca, Modo B/C badge
//  2. Mini artifact timeline: 6 dots (done ✅ / active 🔵 / future ⚪ / blocked 🔴)
//  3. SLA traffic-light: days in phase vs baseline (green/amber/red dot)
//  4. Alerts: blocked badge, credit clock (>60d amber, >75d red)
// Cards are drag-droppable between columns to advance state.
import React, { useState, useRef } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { tr, fmtMoney } from "../lib/i18n.js";
import { CountryFlag } from "../components/ui/primitives.jsx";
import {
  IconRefresh, IconPlus, IconAlert, IconLock, IconClock, IconArrow, IconKanban,
} from "../lib/icons.jsx";
import { STATES, EXPEDIENTES, BRANDS, OCS } from "../data/mockData.js";

export default function ScreenPipeline() {
  const navigate = useNavigate();
  const { lang } = useOutletContext();
  const onNavigate = (key) => {
    const map = { wizard: '/wizard' };
    if (map[key]) navigate(map[key]);
  };
  const onOpenExpediente = (id) => {
    const oc = OCS.find(o => o.expedientes.includes(id));
    if (oc) navigate(`/expedientes/${oc.id}/exp/${id}`);
    else navigate('/expedientes');
  };

  const [brandFilter, setBrandFilter] = useState('ALL');
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [blockedOnly, setBlockedOnly] = useState(false);
  // Local overrides on state so drag-drop feels real
  const [stateOverrides, setStateOverrides] = useState({});
  const [draggingId, setDraggingId] = useState(null);
  const [dropTargetCol, setDropTargetCol] = useState(null);

  const cols = STATES.slice(0, 7); // REGISTRO → CERRADO

  const effectiveStatus = (e) => stateOverrides[e.id] || e.status;

  const baseCards = EXPEDIENTES.filter(e => {
    if (brandFilter !== 'ALL' && e.brand_id !== brandFilter) return false;
    if (urgentOnly && e.phase_signal !== 'red') return false;
    if (blockedOnly && !e.is_blocked) return false;
    return true;
  });

  const getCards = (state) => baseCards.filter(e => effectiveStatus(e) === state);

  const handleDragStart = (e, id) => {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = 'move';
    // Firefox needs some data
    try { e.dataTransfer.setData('text/plain', id); } catch(_) {}
  };
  const handleDragEnd = () => { setDraggingId(null); setDropTargetCol(null); };
  const handleDragOver = (e, state) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dropTargetCol !== state) setDropTargetCol(state);
  };
  const handleDrop = (e, state) => {
    e.preventDefault();
    if (draggingId) {
      setStateOverrides(prev => ({ ...prev, [draggingId]: state }));
    }
    setDraggingId(null);
    setDropTargetCol(null);
  };

  const activeCount = baseCards.filter(e => cols.includes(effectiveStatus(e))).length;

  return (
    <div className="page" data-screen-label="Pipeline · Kanban">
      <div className="page-header">
        <div>
          <div className="micro" style={{marginBottom:6}}>{lang==='es' ? 'FLUJO OPERATIVO' : 'OPERATIONAL FLOW'}</div>
          <h1 className="page-title">{tr(lang,'pipeline')}</h1>
          <div className="page-subtitle">{lang==='es' ? 'Arrastra tarjetas entre columnas para avanzar estado' : 'Drag cards between columns to advance state'}</div>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary"><IconRefresh size={13}/>{tr(lang,'refresh')}</button>
          <button className="btn btn-primary" onClick={() => onNavigate('wizard')}><IconPlus size={14}/>{tr(lang,'new_expediente')}</button>
        </div>
      </div>

      <div className="toolbar">
        <select className="select" style={{ width: 180 }} value={brandFilter} onChange={e=>setBrandFilter(e.target.value)}>
          <option value="ALL">{tr(lang,'all_brands')}</option>
          {BRANDS.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <button className="filter-chip" data-active={urgentOnly} onClick={()=>setUrgentOnly(!urgentOnly)}>
          <IconAlert size={12}/>{lang==='es' ? 'Solo urgentes' : 'Urgent only'}
        </button>
        <button className="filter-chip" data-active={blockedOnly} onClick={()=>setBlockedOnly(!blockedOnly)}>
          <IconLock size={12}/>{tr(lang,'blocked')}
        </button>
        {/* Legend */}
        <div style={{marginLeft:20, display:'flex', alignItems:'center', gap:12, paddingLeft:16, borderLeft:'1px solid var(--divider)'}}>
          <div className="legend-it"><span className="timeline-dot" data-state="done"/>{lang==='es'?'Completado':'Done'}</div>
          <div className="legend-it"><span className="timeline-dot" data-state="active"/>{lang==='es'?'Activo':'Active'}</div>
          <div className="legend-it"><span className="timeline-dot" data-state="future"/>{lang==='es'?'Pendiente':'Pending'}</div>
          <div className="legend-it"><span className="timeline-dot" data-state="blocked"/>{lang==='es'?'Bloqueado':'Blocked'}</div>
        </div>
        <div style={{ marginLeft:'auto' }}/>
        <span className="caption">{lang==='es' ? 'Mostrando' : 'Showing'} {activeCount} {lang==='es'?'expedientes':'files'}</span>
      </div>

      <div className="kanban">
        {cols.map(state => {
          const cards = getCards(state);
          const totalMoney = cards.reduce((a,c)=>a+c.total_invoiced, 0);
          const urgentCount = cards.filter(c => c.phase_signal === 'red').length;
          return (
            <div key={state}
                 className="k-col"
                 data-drop-target={dropTargetCol === state}
                 onDragOver={(e)=>handleDragOver(e, state)}
                 onDragLeave={()=>dropTargetCol===state && setDropTargetCol(null)}
                 onDrop={(e)=>handleDrop(e, state)}>
              <div className="k-col-head">
                <div className="k-col-title">
                  <span className="ab-state-dot" data-state={state}/>
                  <span className="k-col-title-text">{tr(lang, state)}</span>
                  <span className="pill k-col-count">{cards.length}</span>
                  {urgentCount > 0 && (
                    <span className="k-col-urgent" title={lang==='es'?'Urgentes':'Urgent'}>
                      <IconAlert size={10}/>{urgentCount}
                    </span>
                  )}
                </div>
                <div className="k-col-money">{fmtMoney(totalMoney)}</div>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '2px 2px 12px' }}>
                {cards.map(e => (
                  <PipelineCard
                    key={e.id}
                    exp={e}
                    currentState={state}
                    lang={lang}
                    dragging={draggingId === e.id}
                    onOpen={() => onOpenExpediente(e.id)}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                  />
                ))}
                {cards.length === 0 && (
                  <div className="k-col-empty">
                    {dropTargetCol === state
                      ? <><IconArrow size={16}/><span>{lang==='es'?'Soltar aquí para mover':'Drop here to move'}</span></>
                      : <><IconKanban size={16}/><span className="caption">{lang==='es' ? 'Sin expedientes' : 'No files'}</span></>
                    }
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Rich pipeline card ────────────────────────
function PipelineCard({ exp, currentState, lang, dragging, onOpen, onDragStart, onDragEnd }) {
  const brand = BRANDS.find(b => b.id === exp.brand_id);
  const stateIdx = STATES.indexOf(currentState);
  // Track whether a real drag started, so mouseup-on-same-card still opens detail
  const dragStartedRef = useRef(false);

  // Credit clock severity
  const creditSeverity =
    exp.credit_days > 75 ? 'critical' :
    exp.credit_days > 60 ? 'warning'  : null;

  // SLA traffic light text
  const slaLabel = exp.phase_signal === 'green'
    ? (lang==='es'?'En plazo':'On SLA')
    : exp.phase_signal === 'amber'
    ? (lang==='es'?'Atención':'Watch')
    : (lang==='es'?'Retrasado':'Delayed');

  return (
    <div
      className="k-card-pro"
      data-blocked={exp.is_blocked}
      data-dragging={dragging}
      draggable
      onDragStart={(e) => { dragStartedRef.current = true; onDragStart(e, exp.id); }}
      onDragEnd={(e) => { onDragEnd(e); setTimeout(() => { dragStartedRef.current = false; }, 50); }}
      onClick={(e) => { if (!dragStartedRef.current && !dragging) onOpen(); }}
    >
      {/* Drag handle hint on left edge — visual indicator */}
      <div className="k-card-dragbar" title={lang==='es'?'Arrastra para mover':'Drag to move'}>⋮⋮</div>

      {/* Row 1: Ref + operation mode + block/credit alerts */}
      <div className="k-card-row1">
        <span className="k-card-ref-mono" onClick={(e)=>{ e.stopPropagation(); onOpen(); }}>
          {exp.ref}
        </span>
        <span className={`op-mode-badge op-${exp.op_mode}`} title={
          exp.op_mode === 'B'
            ? (lang==='es' ? 'Modo B · Comisión' : 'Mode B · Commission')
            : (lang==='es' ? 'Modo C · FULL'     : 'Mode C · FULL')
        }>
          {exp.op_mode}
        </span>
        <div style={{marginLeft:'auto', display:'flex', gap:5, alignItems:'center'}}>
          {exp.is_blocked && (
            <span className="card-alert card-alert-critical" title={exp.block_reason || 'Bloqueado'}>
              <IconLock size={10}/>
            </span>
          )}
          {creditSeverity && (
            <span className={`card-alert card-alert-${creditSeverity}`} title={
              (lang==='es'?'Crédito ':'Credit ') + exp.credit_days + 'd'
            }>
              <IconClock size={10}/>{exp.credit_days}d
            </span>
          )}
        </div>
      </div>

      {/* Row 2: Client + brand */}
      <div className="k-card-row2">
        <div className="k-card-client-pro" title={exp.client}>
          <CountryFlag country={exp.client_country}/>
          <span className="truncate">{exp.client}</span>
        </div>
        <div className="k-card-brand-pro">
          <span className="brand-dot" style={{ background: brand?.color }}/>
          <span className="truncate">{exp.brand}</span>
          <span className="caption" style={{color:'var(--text-tertiary)'}}>·</span>
          <span className="mono caption">{exp.mode}</span>
        </div>
      </div>

      {/* Row 3: Mini artifact timeline */}
      <div className="k-card-timeline" title={`${exp.artifacts_done}/${exp.artifacts_total} ${lang==='es'?'artefactos completos':'artifacts complete'}`}>
        {Array.from({length: exp.artifacts_total}).map((_, i) => {
          let s = 'future';
          if (i < exp.artifacts_done) s = 'done';
          else if (i === exp.artifacts_done) s = exp.is_blocked ? 'blocked' : 'active';
          return (
            <div key={i} className="timeline-segment">
              <span className="timeline-dot" data-state={s}/>
              {i < exp.artifacts_total - 1 && (
                <span className="timeline-line" data-done={i < exp.artifacts_done - 1}/>
              )}
            </div>
          );
        })}
      </div>

      {/* Row 4: SLA + money (stacked) */}
      <div className="k-card-row4">
        <div className="sla-chip" data-signal={exp.phase_signal} title={
          `${exp.time_in_phase}d / ${exp.baseline_days}d ${lang==='es'?'baseline':'baseline'} · ${slaLabel}`
        }>
          <span className="sla-dot" data-signal={exp.phase_signal}/>
          <span className="sla-days">{exp.time_in_phase}<span className="sla-unit">d</span></span>
          <span className="sla-sep">/</span>
          <span className="sla-baseline">{exp.baseline_days}<span className="sla-unit">d</span></span>
          <span className="sla-label">{slaLabel}</span>
        </div>
        <span className="k-card-money-pro">{fmtMoney(exp.total_invoiced)}</span>
      </div>
    </div>
  );
}
