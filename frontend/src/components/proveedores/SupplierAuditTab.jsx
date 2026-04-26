// ─────────────────────────────────────────────────────────────
// SupplierAuditTab — Tab 3 del detalle proveedor · ISO 9001 §8.4
// Agente responsable: [AG-FRONTEND]
//
// Modo BACKEND (UUID): muestra el historial real de auditorías
//   (proveedoresApi.action('evaluations', supplierId)) con tabla
//   ordenada por fecha + botón "Registrar nueva auditoría" que abre
//   NewIsoEvaluationModal. Score y decisión vienen calculados por el
//   backend (PLB_SUPPLIER_EVAL).
//
// Modo MOCK (SUP-XXX legacy): mantiene el dashboard radar + sparkline
//   + NC log original sobre SUPPLIER_AUDIT_SCORES / SUPPLIER_INCIDENTS.
// ─────────────────────────────────────────────────────────────
import React, { useMemo, useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  IconShield, IconAlert, IconCheck, IconFileText, IconPlus, IconTrash,
} from "../../lib/icons.jsx";
import {
  SUPPLIER_AUDIT_SCORES, SUPPLIER_INCIDENTS,
} from "../../data/mockData.js";
import { proveedoresApi, apiFetch, getToken } from "../../lib/api.js";
import NewIsoEvaluationModal from "./NewIsoEvaluationModal.jsx";

const DIMENSIONS = [
  { key:'calidad',      label:'Calidad',      labelEn:'Quality',       weight: 30, color:'#00B286' },
  { key:'entregas',     label:'Entregas',     labelEn:'Delivery',      weight: 25, color:'#3083FE' },
  { key:'comunicacion', label:'Comunicación', labelEn:'Communication', weight: 15, color:'#481EE3' },
  { key:'tecnica',      label:'Técnica',      labelEn:'Technical',     weight: 15, color:'#1EE3D7' },
  { key:'precio',       label:'Precio',       labelEn:'Price',         weight: 15, color:'#B45309' },
];

const IMPACTO_META = {
  BAJO:    { label:'Bajo',    color:'#0E8A6D', soft:'rgba(14,138,109,0.12)' },
  MEDIO:   { label:'Medio',   color:'#B45309', soft:'rgba(180,83,9,0.12)' },
  ALTO:    { label:'Alto',    color:'#DC2626', soft:'rgba(220,38,38,0.12)' },
  CRITICO: { label:'Crítico', color:'#7F1D1D', soft:'rgba(127,29,29,0.15)' },
};

// PLB_SUPPLIER_EVAL · decisiones canónicas (ESPEJO del backend)
const DECISION_META = {
  MANTENER:     { es:'Mantener',       en:'Keep',         color:'#0E8A6D', soft:'rgba(14,138,109,0.14)' },
  MONITOREAR:   { es:'Monitorear',     en:'Monitor',      color:'#B45309', soft:'rgba(180,83,9,0.14)'  },
  PLAN_MEJORA:  { es:'Plan de mejora', en:'Improvement',  color:'#EA580C', soft:'rgba(234,88,12,0.14)' },
  DESCONTINUAR: { es:'Descontinuar',   en:'Discontinue',  color:'#DC2626', soft:'rgba(220,38,38,0.14)' },
};

function scoreTier(s) {
  if (s >= 4.0) return { color:'#00B286', label:'Sólido' };
  if (s >= 3.0) return { color:'#B45309', label:'Vigilado' };
  return { color:'#DC2626', label:'Riesgo' };
}

// Radar SVG — 5 ejes (legacy mock view)
function Radar({ values, size = 280 }) {
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 50;
  const n = values.length;
  const angle = (i) => (-Math.PI / 2) + (i * (2 * Math.PI) / n);
  const points = values.map((v, i) => {
    const r = radius * (Math.max(0, Math.min(5, v)) / 5);
    return [cx + r * Math.cos(angle(i)), cy + r * Math.sin(angle(i))];
  });
  const polyStr = points.map(p => p.join(',')).join(' ');
  const rings = [1, 2, 3, 4, 5].map(v => {
    const pts = Array.from({length: n}, (_, i) => {
      const r = (radius * v) / 5;
      return [cx + r * Math.cos(angle(i)), cy + r * Math.sin(angle(i))];
    });
    return pts.map(p => p.join(',')).join(' ');
  });
  return (
    <svg width={size} height={size} className="audit-radar-svg">
      {rings.map((r, i) => (
        <polygon key={i} points={r} fill="none"
          stroke="var(--border-subtle)" strokeWidth={i === 4 ? 1.5 : 0.8} opacity={0.6}/>
      ))}
      {Array.from({length:n}, (_, i) => {
        const [x, y] = [cx + radius * Math.cos(angle(i)), cy + radius * Math.sin(angle(i))];
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y}
                     stroke="var(--border-subtle)" strokeWidth={0.8} opacity={0.5}/>;
      })}
      <motion.polygon
        initial={{ opacity:0, scale:0.7 }}
        animate={{ opacity:1, scale:1, transition:{ duration:0.4, type:'spring', stiffness:200, damping:20 } }}
        style={{ transformOrigin: `${cx}px ${cy}px` }}
        points={polyStr}
        fill="rgba(0,178,134,0.18)" stroke="#00B286" strokeWidth={1.8}/>
      {points.map((p, i) => (
        <motion.circle key={i}
          initial={{ opacity:0 }}
          animate={{ opacity:1, transition:{ delay:0.15 + i*0.05 } }}
          cx={p[0]} cy={p[1]} r={3.5} fill="#00B286" stroke="#fff" strokeWidth={1.5}/>
      ))}
      {DIMENSIONS.map((d, i) => {
        const lr = radius + 14;
        const [x, y] = [cx + lr * Math.cos(angle(i)), cy + lr * Math.sin(angle(i))];
        return (
          <text key={d.key} x={x} y={y}
                textAnchor={Math.abs(Math.cos(angle(i))) < 0.2 ? 'middle' : (Math.cos(angle(i)) > 0 ? 'start' : 'end')}
                dominantBaseline="middle" fontSize="10"
                fill="var(--text-secondary)"
                style={{ fontWeight: 600, letterSpacing: 0.3 }}>
            {d.label.toUpperCase()}
          </text>
        );
      })}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────
// VIEW BACKEND — Auditoría ISO real (PLB_SUPPLIER_EVAL)
// ─────────────────────────────────────────────────────────────
function BackendAuditView({ lang, supplierId, supplierName }) {
  const [evaluations, setEvaluations] = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);
  const [openModal,   setOpenModal]   = useState(false);

  const reload = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const list = await proveedoresApi.action('evaluations', supplierId);
      setEvaluations(Array.isArray(list) ? list : []);
    } catch (e) {
      setError(String(e?.message || e));
      setEvaluations([]);
    } finally {
      setLoading(false);
    }
  }, [supplierId]);

  useEffect(() => { reload(); }, [reload]);

  const handleSubmit = async (body) => {
    await proveedoresApi.action('evaluations', supplierId, body);
    await reload();
  };

  const handleDelete = async (ev) => {
    if (!window.confirm(
      (lang==='es' ? '¿Eliminar la auditoría ' : 'Delete evaluation ') + ev.periodo + '?'
    )) return;
    try {
      await apiFetch(`/proveedores/${supplierId}/evaluations/${ev.id}/`, {
        method: 'DELETE', token: getToken(),
      });
      await reload();
    } catch (e) {
      alert((lang==='es' ? 'No se pudo eliminar: ' : 'Could not delete: ') + (e?.message || e));
    }
  };

  // KPIs derivados de la lista
  const stats = useMemo(() => {
    if (!evaluations.length) return null;
    const last = evaluations[0];   // backend ordena -created_at
    const avg  = evaluations.reduce((a,e) => a + Number(e.score_total || 0), 0) / evaluations.length;
    const counts = { MANTENER:0, MONITOREAR:0, PLAN_MEJORA:0, DESCONTINUAR:0 };
    evaluations.forEach(e => { counts[e.decision] = (counts[e.decision] || 0) + 1; });
    return { last, avg, counts, total: evaluations.length };
  }, [evaluations]);

  return (
    <div className="audit-tab">
      {/* Header con botón + KPIs */}
      <div className="card card-pad-md" style={{marginTop:14}}>
        <div className="form-card-head" style={{justifyContent:'space-between'}}>
          <div style={{display:'flex', alignItems:'center', gap:10}}>
            <IconShield size={16} style={{color:'var(--brand-accent)'}}/>
            <div>
              <div className="heading-md">
                {lang==='es'?'Auditoría ISO 9001 §8.4':'ISO 9001 §8.4 Audit'}
              </div>
              <div className="caption" style={{color:'var(--text-tertiary)'}}>
                {lang==='es'
                  ? 'Evaluación periódica del proveedor según PLB_SUPPLIER_EVAL'
                  : 'Periodic supplier evaluation per PLB_SUPPLIER_EVAL'}
                {loading && <> · {lang==='es'?'cargando…':'loading…'}</>}
                {error   && <span style={{color:'var(--critical)'}}> · {error}</span>}
              </div>
            </div>
          </div>
          <button className="btn btn-accent" onClick={()=>setOpenModal(true)}>
            <IconPlus size={14}/> {lang==='es'?'Registrar nueva auditoría':'New evaluation'}
          </button>
        </div>

        {stats && (
          <div className="nodes-kpis" style={{marginTop:14}}>
            <div className="kpi-tile">
              <div className="k-label">{lang==='es'?'Último score':'Latest score'}</div>
              <div className="k-value tabular-nums"
                   style={{color: scoreTier(Number(stats.last.score_total)).color}}>
                {Number(stats.last.score_total).toFixed(2)}
              </div>
              <div className="k-sub">
                {stats.last.periodo} · {(stats.last.created_at || '').slice(0,10)}
              </div>
            </div>
            <div className="kpi-tile">
              <div className="k-label">{lang==='es'?'Promedio histórico':'Historical avg'}</div>
              <div className="k-value tabular-nums"
                   style={{color: scoreTier(stats.avg).color}}>
                {stats.avg.toFixed(2)}
              </div>
              <div className="k-sub">
                {stats.total} {lang==='es'?'auditorías registradas':'audits recorded'}
              </div>
            </div>
            <div className="kpi-tile">
              <div className="k-label">{lang==='es'?'Decisión vigente':'Current decision'}</div>
              <div className="k-value" style={{fontSize:18}}>
                <span className="phase-pill"
                      style={{
                        '--phase-color': (DECISION_META[stats.last.decision]||{}).color,
                        '--phase-soft':  (DECISION_META[stats.last.decision]||{}).soft,
                      }}>
                  <span className="dot"/>
                  {(DECISION_META[stats.last.decision]||{})[lang] || stats.last.decision}
                </span>
              </div>
              <div className="k-sub">
                {lang==='es'?'Auto-derivada del último score':'Auto-derived from latest score'}
              </div>
            </div>
            <div className="kpi-tile">
              <div className="k-label">{lang==='es'?'Distribución':'Distribution'}</div>
              <div style={{display:'flex', flexDirection:'column', gap:2, marginTop:4}}>
                {Object.entries(stats.counts).filter(([_,n]) => n > 0).map(([k,n]) => {
                  const m = DECISION_META[k] || {};
                  return (
                    <div key={k} style={{
                      display:'flex', justifyContent:'space-between',
                      font:'500 11.5px inherit', color: m.color,
                    }}>
                      <span>{m[lang] || k}</span>
                      <span className="tabular-nums" style={{fontWeight:700}}>{n}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Tabla histórica */}
      <div className="card card-pad-sm supplier-table-wrap" style={{marginTop:14}}>
        <div className="supplier-table-head">
          <div>
            <div className="heading-md">
              {lang==='es'?'Historial de evaluaciones':'Evaluation history'}
            </div>
            <div className="caption" style={{color:'var(--text-tertiary)'}}>
              {lang==='es'
                ? 'Cada fila es una auditoría ISO 9001 §8.4 — score y decisión inmutables'
                : 'Each row is an ISO 9001 §8.4 audit — score and decision immutable'}
            </div>
          </div>
          <span className="mono-sm">{evaluations.length}</span>
        </div>

        {evaluations.length === 0 ? (
          <div className="empty-state" style={{padding:'30px 12px'}}>
            <IconShield size={22} style={{color:'var(--text-tertiary)'}}/>
            <div className="caption">
              {loading
                ? (lang==='es'?'Cargando auditorías…':'Loading audits…')
                : (lang==='es'?'Sin auditorías registradas para este proveedor.':'No audits recorded for this supplier yet.')}
            </div>
            {!loading && (
              <button className="btn btn-accent" style={{marginTop:10}}
                      onClick={()=>setOpenModal(true)}>
                <IconPlus size={14}/> {lang==='es'?'Registrar la primera':'Record the first one'}
              </button>
            )}
          </div>
        ) : (
          <table className="supplier-products-table">
            <thead>
              <tr>
                <th>{lang==='es'?'Período':'Period'}</th>
                <th>{lang==='es'?'Evaluador':'Evaluator'}</th>
                <th className="ta-right">{lang==='es'?'Calidad':'Quality'}</th>
                <th className="ta-right">{lang==='es'?'Entrega':'Delivery'}</th>
                <th className="ta-right">{lang==='es'?'Com.':'Comm.'}</th>
                <th className="ta-right">{lang==='es'?'Téc.':'Tech.'}</th>
                <th className="ta-right">{lang==='es'?'Precio':'Price'}</th>
                <th className="ta-right">{lang==='es'?'Score Total':'Total Score'}</th>
                <th>{lang==='es'?'Decisión':'Decision'}</th>
                <th className="ta-right" style={{width:48}}></th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence mode="popLayout">
                {evaluations.map((e, idx) => {
                  const m = DECISION_META[e.decision] || {};
                  const t = scoreTier(Number(e.score_total));
                  return (
                    <motion.tr key={e.id}
                      layout
                      initial={{ opacity:0, y:4 }}
                      animate={{ opacity:1, y:0, transition:{ delay: idx*0.03, duration:0.22 } }}
                      exit={{ opacity:0, y:-4, transition:{ duration:0.1 } }}
                      className="supplier-product-row"
                    >
                      <td>
                        <div className="mono-sm" style={{fontWeight:700}}>{e.periodo}</div>
                        <div className="caption mono-sm" style={{color:'var(--text-tertiary)'}}>
                          {(e.created_at || '').slice(0, 10)}
                        </div>
                      </td>
                      <td className="caption">
                        {e.evaluator_email || (lang==='es' ? '— sin evaluador —' : '— no evaluator —')}
                      </td>
                      <td className="ta-right tabular-nums">{e.score_calidad}</td>
                      <td className="ta-right tabular-nums">{e.score_entrega}</td>
                      <td className="ta-right tabular-nums">{e.score_comunicacion}</td>
                      <td className="ta-right tabular-nums">{e.score_tecnica}</td>
                      <td className="ta-right tabular-nums">{e.score_precio}</td>
                      <td className="ta-right tabular-nums"
                          style={{fontWeight:700, color: t.color, fontSize:15}}>
                        {Number(e.score_total).toFixed(2)}
                      </td>
                      <td>
                        <span className="phase-pill"
                              style={{'--phase-color': m.color, '--phase-soft': m.soft}}>
                          <span className="dot"/>{m[lang] || e.decision}
                        </span>
                        {e.documento_evidencia && (
                          <div className="caption" style={{color:'var(--text-tertiary)', marginTop:2}}>
                            <IconFileText size={10} style={{verticalAlign:'-1px', marginRight:3}}/>
                            <a href={`/api/storage/download/?key=${encodeURIComponent(e.documento_evidencia)}`}
                               target="_blank" rel="noreferrer"
                               style={{color:'inherit', textDecoration:'underline'}}>
                              {lang==='es'?'Evidencia':'Evidence'}
                            </a>
                          </div>
                        )}
                      </td>
                      <td className="ta-right">
                        <button className="btn btn-xs"
                                title={lang==='es'?'Eliminar auditoría':'Delete evaluation'}
                                onClick={()=>handleDelete(e)}>
                          <IconTrash size={11}/>
                        </button>
                      </td>
                    </motion.tr>
                  );
                })}
              </AnimatePresence>
            </tbody>
          </table>
        )}

        {/* Mostrar comentarios expandidos abajo, para no inflar la fila */}
        {evaluations.some(e => e.comentarios) && (
          <div style={{marginTop:14, padding:'12px 14px', borderTop:'1px solid var(--border-subtle)'}}>
            <div className="heading-sm" style={{marginBottom:8}}>
              {lang==='es'?'Comentarios / hallazgos':'Comments / findings'}
            </div>
            {evaluations.filter(e => e.comentarios).map(e => (
              <div key={e.id} style={{marginBottom:10}}>
                <div className="mono-sm" style={{fontWeight:700}}>
                  {e.periodo}
                  {' · '}
                  <span style={{color: (DECISION_META[e.decision]||{}).color}}>
                    {(DECISION_META[e.decision]||{})[lang] || e.decision}
                  </span>
                </div>
                <div className="body-sm" style={{color:'var(--text-secondary)', whiteSpace:'pre-wrap'}}>
                  {e.comentarios}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal "Registrar nueva auditoría" */}
      {openModal && createPortal(
        <NewIsoEvaluationModal
          supplierName={supplierName}
          lang={lang}
          onClose={()=>setOpenModal(false)}
          onSubmit={handleSubmit}
        />,
        document.body
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// VIEW LEGACY (mock) — para SUP-XXX legacy
// ─────────────────────────────────────────────────────────────
function MockAuditView({ lang, supplierId }) {
  const audit = SUPPLIER_AUDIT_SCORES[supplierId];
  const incidents = useMemo(
    () => SUPPLIER_INCIDENTS.filter(i => i.supplier_id === supplierId)
                             .sort((a,b) => b.date.localeCompare(a.date)),
    [supplierId]
  );

  if (!audit) {
    return (
      <div className="card card-pad-lg empty" style={{marginTop:14}}>
        <IconShield size={24} style={{color:'var(--text-tertiary)'}}/>
        <div className="heading-md">{lang==='es'?'Sin auditoría ISO':'No ISO audit'}</div>
        <div className="caption" style={{maxWidth:360}}>
          {lang==='es'
            ? 'Este proveedor no tiene una auditoría ISO 9001 registrada aún.'
            : 'This supplier has no ISO 9001 audit recorded yet.'}
        </div>
      </div>
    );
  }

  const weighted = DIMENSIONS.reduce((a, d) => a + audit.dimensions[d.key] * (d.weight / 100), 0);
  const tier = scoreTier(weighted);

  return (
    <div className="audit-tab">
      <div className="audit-grid-top">
        <div className="card card-pad-md audit-scorecard">
          <div className="form-card-head">
            <IconShield size={16} style={{color:'var(--brand-accent)'}}/>
            <div>
              <div className="heading-md">{lang==='es'?'Score ponderado ISO 9001':'Weighted ISO 9001 score'}</div>
              <div className="caption" style={{color:'var(--text-tertiary)'}}>
                {lang==='es'?'Última auditoría':'Last audit'}: {audit.audit_date} · {audit.auditor}
              </div>
            </div>
          </div>
          <div className="audit-score-big">
            <div className="audit-score-val tabular-nums" style={{color: tier.color}}>
              {weighted.toFixed(2)}
            </div>
            <div className="audit-score-meta">
              <div className="heading-sm" style={{color: tier.color}}>{tier.label}</div>
            </div>
          </div>
          <div className="audit-bars">
            {DIMENSIONS.map((d, idx) => {
              const v = audit.dimensions[d.key] || 0;
              const pct = (v / 5) * 100;
              return (
                <motion.div key={d.key} className="audit-bar-row"
                  initial={{ opacity:0, x:-4 }}
                  animate={{ opacity:1, x:0, transition:{ delay: idx*0.05 + 0.1 } }}>
                  <div className="audit-bar-lbl">
                    <span className="heading-sm">{lang==='es'?d.label:d.labelEn}</span>
                    <span className="caption" style={{color:'var(--text-tertiary)'}}>
                      {lang==='es'?'Peso':'Weight'} {d.weight}%
                    </span>
                  </div>
                  <div className="audit-bar-track">
                    <motion.div className="audit-bar-fill"
                      style={{ background: d.color }}
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%`, transition:{ delay: idx*0.05 + 0.2, duration: 0.55 } }}/>
                  </div>
                  <div className="audit-bar-val tabular-nums">{v.toFixed(1)}</div>
                </motion.div>
              );
            })}
          </div>
        </div>

        <div className="card card-pad-md audit-radar-card">
          <div className="form-card-head">
            <div>
              <div className="heading-md">{lang==='es'?'Radar de desempeño':'Performance radar'}</div>
              <div className="caption" style={{color:'var(--text-tertiary)'}}>
                {lang==='es'?'Escala 1.0 – 5.0':'Scale 1.0 – 5.0'}
              </div>
            </div>
          </div>
          <div className="audit-radar-wrap">
            <Radar values={DIMENSIONS.map(d => audit.dimensions[d.key])}/>
          </div>
        </div>
      </div>

      {/* NC log */}
      <div className="card card-pad-sm supplier-table-wrap" style={{marginTop:14}}>
        <div className="supplier-table-head">
          <div>
            <div className="heading-md">
              {lang==='es'?'Log de No Conformidades (NC)':'Non-Conformity log (NC)'}
            </div>
            <div className="caption" style={{color:'var(--text-tertiary)'}}>
              {lang==='es' ? 'Control de no conformes · ISO 9001 cláusula 8.7' : 'Non-conformity control · ISO 9001 clause 8.7'}
            </div>
          </div>
          <span className="mono-sm">{incidents.length} NC</span>
        </div>
        {incidents.length === 0 ? (
          <div className="empty-state" style={{padding:'20px 12px'}}>
            <IconCheck size={20} style={{color:'var(--success)'}}/>
            <div className="caption">{lang==='es'?'Sin incidencias registradas':'No incidents recorded'}</div>
          </div>
        ) : (
          <table className="nc-table">
            <thead>
              <tr>
                <th>{lang==='es'?'Ref NC':'NC Ref'}</th>
                <th>{lang==='es'?'Fecha':'Date'}</th>
                <th>{lang==='es'?'Descripción':'Description'}</th>
                <th>{lang==='es'?'Impacto':'Impact'}</th>
                <th>{lang==='es'?'Acción':'Action'}</th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((i, idx) => {
                const im = IMPACTO_META[i.impacto] || IMPACTO_META.BAJO;
                return (
                  <motion.tr key={i.id}
                    initial={{ opacity:0, y:4 }}
                    animate={{ opacity:1, y:0, transition:{ delay: idx*0.04, duration:0.22 } }}
                    className="nc-row">
                    <td>
                      <div className="mono-sm" style={{fontWeight:600}}>{i.ref_nc}</div>
                    </td>
                    <td className="caption mono-sm">{i.date}</td>
                    <td><div className="body-sm">{i.descripcion}</div></td>
                    <td>
                      <span className="phase-pill"
                            style={{'--phase-color': im.color, '--phase-soft': im.soft}}>
                        <span className="dot"/>{im.label}
                      </span>
                    </td>
                    <td>
                      <div className="caption">
                        <IconFileText size={10} style={{verticalAlign:'-1px', marginRight:3, color:'var(--text-tertiary)'}}/>
                        {i.accion}
                      </div>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// EXPORT — switch backend / mock por shape del supplierId
// ─────────────────────────────────────────────────────────────
export default function SupplierAuditTab({ lang='es', supplierId, supplierName='' }) {
  const isUuid = /^[0-9a-f-]{36}$/i.test(supplierId || '');
  return isUuid
    ? <BackendAuditView lang={lang} supplierId={supplierId} supplierName={supplierName}/>
    : <MockAuditView    lang={lang} supplierId={supplierId}/>;
}
