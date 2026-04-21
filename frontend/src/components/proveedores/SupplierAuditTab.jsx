// ─────────────────────────────────────────────────────────────
// SupplierAuditTab — Tab 3 del detalle proveedor · ISO 9001
// Agente responsable: [AG-FRONTEND]
//
// Scorecard 5 dimensiones ponderadas (sección 8.4.1 ISO 9001):
//   · Calidad       30%
//   · Entregas      25%
//   · Comunicación  15%
//   · Técnica       15%
//   · Precio        15%
//
// Componentes visuales:
//   · Radar SVG (5 ejes)
//   · Barras horizontales por dimensión
//   · Histórico de score (sparkline)
//   · Tabla de No Conformidades (NC) — ISO 9001 8.7
// ─────────────────────────────────────────────────────────────
import React, { useMemo } from "react";
import { motion } from "framer-motion";
import { IconShield, IconAlert, IconCheck, IconFileText } from "../../lib/icons.jsx";
import {
  SUPPLIER_AUDIT_SCORES, SUPPLIER_INCIDENTS,
} from "../../data/mockData.js";

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

function scoreTier(s) {
  if (s >= 4.0) return { color:'#00B286', label:'Sólido' };
  if (s >= 3.0) return { color:'#B45309', label:'Vigilado' };
  return { color:'#DC2626', label:'Riesgo' };
}

// Radar SVG — 5 ejes
// size 280 + radius 90 deja margen suficiente para que labels largos
// como "COMUNICACIÓN" o "ENTREGAS" no se salgan del viewport.
function Radar({ values, size = 280 }) {
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 50;   // más aire para los labels exteriores
  const n = values.length;

  // Cada dimensión a ángulo (empieza arriba y gira clockwise)
  const angle = (i) => (-Math.PI / 2) + (i * (2 * Math.PI) / n);

  // Puntos del polígono de valores (valor / 5)
  const points = values.map((v, i) => {
    const r = radius * (Math.max(0, Math.min(5, v)) / 5);
    return [cx + r * Math.cos(angle(i)), cy + r * Math.sin(angle(i))];
  });
  const polyStr = points.map(p => p.join(',')).join(' ');

  // Grid concéntrico
  const rings = [1, 2, 3, 4, 5].map(v => {
    const pts = Array.from({length: n}, (_, i) => {
      const r = (radius * v) / 5;
      return [cx + r * Math.cos(angle(i)), cy + r * Math.sin(angle(i))];
    });
    return pts.map(p => p.join(',')).join(' ');
  });

  return (
    <svg width={size} height={size} className="audit-radar-svg">
      {/* Anillos de fondo */}
      {rings.map((r, i) => (
        <polygon key={i}
          points={r}
          fill="none"
          stroke="var(--border-subtle)"
          strokeWidth={i === 4 ? 1.5 : 0.8}
          opacity={0.6}/>
      ))}
      {/* Ejes */}
      {Array.from({length:n}, (_, i) => {
        const [x, y] = [cx + radius * Math.cos(angle(i)), cy + radius * Math.sin(angle(i))];
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y}
                     stroke="var(--border-subtle)" strokeWidth={0.8} opacity={0.5}/>;
      })}
      {/* Polígono de valores */}
      <motion.polygon
        initial={{ opacity:0, scale:0.7 }}
        animate={{ opacity:1, scale:1, transition:{ duration:0.4, type:'spring', stiffness:200, damping:20 } }}
        style={{ transformOrigin: `${cx}px ${cy}px` }}
        points={polyStr}
        fill="rgba(0,178,134,0.18)"
        stroke="#00B286"
        strokeWidth={1.8}
      />
      {/* Puntos */}
      {points.map((p, i) => (
        <motion.circle
          key={i}
          initial={{ opacity:0 }}
          animate={{ opacity:1, transition:{ delay:0.15 + i*0.05 } }}
          cx={p[0]} cy={p[1]} r={3.5}
          fill="#00B286" stroke="#fff" strokeWidth={1.5}/>
      ))}
      {/* Labels */}
      {DIMENSIONS.map((d, i) => {
        const lr = radius + 14;
        const [x, y] = [cx + lr * Math.cos(angle(i)), cy + lr * Math.sin(angle(i))];
        return (
          <text key={d.key} x={x} y={y}
                textAnchor={Math.abs(Math.cos(angle(i))) < 0.2 ? 'middle' : (Math.cos(angle(i)) > 0 ? 'start' : 'end')}
                dominantBaseline="middle"
                fontSize="10"
                fill="var(--text-secondary)"
                style={{ fontWeight: 600, letterSpacing: 0.3 }}>
            {d.label.toUpperCase()}
          </text>
        );
      })}
    </svg>
  );
}

// Sparkline histórico
function Spark({ data, width = 240, height = 60 }) {
  if (!data || data.length === 0) return null;
  const min = 1, max = 5;
  const step = data.length > 1 ? width / (data.length - 1) : 0;
  const pts = data.map((d, i) => {
    const x = i * step;
    const y = height - ((d.score - min) / (max - min)) * height;
    return [x, y];
  });
  const polyStr = pts.map(p => p.join(',')).join(' ');
  return (
    <svg width={width} height={height} className="audit-spark-svg">
      <line x1="0" y1={height * 0.6} x2={width} y2={height * 0.6}
            stroke="var(--border-subtle)" strokeDasharray="3 3" opacity="0.6"/>
      <motion.polyline
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1, transition:{ duration: 0.7 } }}
        points={polyStr}
        fill="none"
        stroke="#481EE3"
        strokeWidth="2"/>
      {pts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r="3" fill="#481EE3"/>
      ))}
    </svg>
  );
}

export default function SupplierAuditTab({ lang='es', supplierId }) {
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

  // Score ponderado
  const weighted = DIMENSIONS.reduce((a, d) => a + audit.dimensions[d.key] * (d.weight / 100), 0);
  const tier = scoreTier(weighted);

  // Trend (delta contra audit previa)
  const history = audit.history || [];
  const prev = history.length > 1 ? history[history.length - 2].score : null;
  const last = history.length > 0 ? history[history.length - 1].score : weighted;
  const delta = prev !== null ? last - prev : 0;

  return (
    <div className="audit-tab">
      {/* Scorecard + radar */}
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
              {prev !== null && (
                <div className="caption tabular-nums" style={{
                  color: delta > 0 ? 'var(--success)' : (delta < 0 ? 'var(--critical)' : 'var(--text-tertiary)')
                }}>
                  {delta > 0 ? '▲' : delta < 0 ? '▼' : '·'} {Math.abs(delta).toFixed(2)} {lang==='es'?'vs. previa':'vs. previous'}
                </div>
              )}
            </div>
          </div>

          {/* Barras por dimensión */}
          <div className="audit-bars">
            {DIMENSIONS.map((d, idx) => {
              const v = audit.dimensions[d.key] || 0;
              const pct = (v / 5) * 100;
              return (
                <motion.div
                  key={d.key}
                  className="audit-bar-row"
                  initial={{ opacity:0, x:-4 }}
                  animate={{ opacity:1, x:0, transition:{ delay: idx*0.05 + 0.1 } }}
                >
                  <div className="audit-bar-lbl">
                    <span className="heading-sm">{lang==='es'?d.label:d.labelEn}</span>
                    <span className="caption" style={{color:'var(--text-tertiary)'}}>
                      {lang==='es'?'Peso':'Weight'} {d.weight}%
                    </span>
                  </div>
                  <div className="audit-bar-track">
                    <motion.div
                      className="audit-bar-fill"
                      style={{ background: d.color }}
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%`, transition:{ delay: idx*0.05 + 0.2, duration: 0.55 } }}
                    />
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

      {/* Histórico */}
      {history.length > 1 && (
        <motion.div
          className="card card-pad-md"
          initial={{ opacity:0, y:6 }}
          animate={{ opacity:1, y:0, transition:{ duration:0.22, delay:0.15 } }}
          style={{marginTop:14}}
        >
          <div className="form-card-head">
            <div>
              <div className="heading-md">{lang==='es'?'Histórico de score':'Score history'}</div>
              <div className="caption" style={{color:'var(--text-tertiary)'}}>
                {history.length} {lang==='es'?'auditorías registradas':'recorded audits'}
              </div>
            </div>
          </div>
          <div className="audit-history">
            <Spark data={history}/>
            <div className="audit-history-ticks">
              {history.map((h, i) => (
                <div key={i} className="audit-history-tick">
                  <div className="mono-sm tabular-nums" style={{fontWeight:600, color: scoreTier(h.score).color}}>
                    {h.score.toFixed(1)}
                  </div>
                  <div className="caption mono-sm" style={{color:'var(--text-tertiary)'}}>
                    {h.date}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      )}

      {/* NC log */}
      <div className="card card-pad-sm supplier-table-wrap" style={{marginTop:14}}>
        <div className="supplier-table-head">
          <div>
            <div className="heading-md">
              {lang==='es'?'Log de No Conformidades (NC)':'Non-Conformity log (NC)'}
            </div>
            <div className="caption" style={{color:'var(--text-tertiary)'}}>
              {lang==='es'
                ? 'Control de no conformes · ISO 9001 cláusula 8.7'
                : 'Non-conformity control · ISO 9001 clause 8.7'}
            </div>
          </div>
          <span className="mono-sm">{incidents.length} NC</span>
        </div>

        {incidents.length === 0 ? (
          <div className="empty-state" style={{padding:'20px 12px'}}>
            <IconCheck size={20} style={{color:'var(--success)'}}/>
            <div className="caption">
              {lang==='es'?'Sin incidencias registradas':'No incidents recorded'}
            </div>
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
                  <motion.tr
                    key={i.id}
                    initial={{ opacity:0, y:4 }}
                    animate={{ opacity:1, y:0, transition:{ delay: idx*0.04, duration:0.22 } }}
                    className="nc-row"
                  >
                    <td>
                      <div className="mono-sm" style={{fontWeight:600}}>{i.ref_nc}</div>
                      <div className="caption mono-sm" style={{color:'var(--text-tertiary)'}}>
                        {i.id}
                      </div>
                    </td>
                    <td className="caption mono-sm">{i.date}</td>
                    <td>
                      <div className="body-sm">{i.descripcion}</div>
                    </td>
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
