// ─────────────────────────────────────────────────────────────
// ProductExpedientesTab — trazabilidad histórica del SKU
// Agente responsable: [AG-FRONTEND]
//
// Tabla con:
//   · ID Expediente (clickable → /expedientes/:id)
//   · Cliente
//   · Estado del expediente
//   · Cantidad Vendida
//   · Precio de Venta unitario cobrado
//   · Tallas Vendidas (desglose)
// ─────────────────────────────────────────────────────────────
import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { IconFolder, IconPackage, IconChevLeft, IconChevRight } from "../../lib/icons.jsx";
import { fmtMoney } from "../../lib/i18n.js";
import {
  PRODUCT_EXPEDIENTE_LINES, CLIENTS, SIZES, EXPEDIENTES,
} from "../../data/mockData.js";

const PHASE_META = {
  REGISTRO:    { label:'Registro',    color:'#64748B', soft:'rgba(100,116,139,0.12)' },
  PRODUCCION:  { label:'Producción',  color:'#3083FE', soft:'rgba(48,131,254,0.12)' },
  PREPARACION: { label:'Preparación', color:'#481EE3', soft:'rgba(72,30,227,0.12)' },
  DESPACHO:    { label:'Despacho',    color:'#1EE3D7', soft:'rgba(30,227,215,0.12)' },
  TRANSITO:    { label:'Tránsito',    color:'#B45309', soft:'rgba(180,83,9,0.12)' },
  EN_DESTINO:  { label:'En destino',  color:'#00B286', soft:'rgba(0,178,134,0.12)' },
  CERRADO:     { label:'Cerrado',     color:'#0E8A6D', soft:'rgba(14,138,109,0.12)' },
};

export default function ProductExpedientesTab({ lang='es', sku }) {
  const navigate = useNavigate();

  const clientMap = useMemo(() => {
    const m = {};
    CLIENTS.forEach(c => { m[c.id] = c; });
    return m;
  }, []);
  const sizeMap = useMemo(() => {
    const m = {};
    SIZES.forEach(s => { m[s.id] = s; });
    return m;
  }, []);

  const lines = useMemo(() => {
    return PRODUCT_EXPEDIENTE_LINES
      .filter(l => l.sku === sku)
      .sort((a,b) => a.expediente_ref.localeCompare(b.expediente_ref));
  }, [sku]);

  const totals = useMemo(() => {
    const qty = lines.reduce((a,l) => a + l.qty, 0);
    const revenue = lines.reduce((a,l) => a + l.qty * l.unit_price_sold, 0);
    const avgPrice = qty > 0 ? revenue / qty : 0;
    return { qty, revenue, avgPrice, count: lines.length };
  }, [lines]);

  const resolveExpedienteId = (ref) => {
    const hit = EXPEDIENTES.find(e => e.id === ref || e.ref === ref);
    return hit?.id || null;
  };

  return (
    <div className="prod-expedientes-tab">
      {/* Summary strip */}
      <div className="prod-trace-summary card card-pad-md">
        <div className="prod-trace-sumcell">
          <span className="caption">{lang==='es'?'Expedientes':'Files'}</span>
          <span className="heading-md tabular-nums">{totals.count}</span>
        </div>
        <div className="prod-trace-sumcell">
          <span className="caption">{lang==='es'?'Unidades vendidas':'Units sold'}</span>
          <span className="heading-md tabular-nums">{totals.qty.toLocaleString()}</span>
        </div>
        <div className="prod-trace-sumcell">
          <span className="caption">{lang==='es'?'Revenue histórico':'Historical revenue'}</span>
          <span className="heading-md tabular-nums">{fmtMoney(totals.revenue)}</span>
        </div>
        <div className="prod-trace-sumcell">
          <span className="caption">{lang==='es'?'Precio promedio':'Avg. price'}</span>
          <span className="heading-md tabular-nums">{fmtMoney(totals.avgPrice)}</span>
        </div>
      </div>

      {lines.length === 0 ? (
        <div className="card card-pad-lg empty" style={{marginTop:12}}>
          <IconFolder size={22} style={{color:'var(--text-tertiary)'}}/>
          <div className="heading-md">
            {lang==='es'?'Sin historial':'No history'}
          </div>
          <div className="caption" style={{maxWidth:360}}>
            {lang==='es'
              ? 'Este SKU aún no ha sido asignado a ningún expediente de venta.'
              : 'This SKU has not been attached to any sales file yet.'}
          </div>
        </div>
      ) : (
        <div className="card card-pad-sm prod-trace-wrap">
          <table className="prod-trace-table">
            <thead>
              <tr>
                <th>{lang==='es'?'Expediente':'File'}</th>
                <th>{lang==='es'?'Cliente':'Client'}</th>
                <th>{lang==='es'?'Estado':'State'}</th>
                <th className="ta-right">{lang==='es'?'Cantidad':'Qty'}</th>
                <th className="ta-right">{lang==='es'?'Precio unit.':'Unit price'}</th>
                <th>{lang==='es'?'Tallas vendidas':'Sizes sold'}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, idx) => {
                const client = clientMap[l.client_id];
                const phase = PHASE_META[l.estado] || PHASE_META.REGISTRO;
                const expId = resolveExpedienteId(l.expediente_ref);
                return (
                  <motion.tr
                    key={l.id}
                    initial={{ opacity:0, y:4 }}
                    animate={{ opacity:1, y:0, transition:{ delay: idx*0.03, duration:0.22 } }}
                    className="prod-trace-row"
                  >
                    <td>
                      <button className="exp-link mono-sm"
                              onClick={()=> expId && navigate(`/expedientes/${expId}`)}>
                        {l.expediente_ref}
                      </button>
                    </td>
                    <td>
                      <span className="client-cell">
                        <span>{client?.flag || '🌐'}</span>
                        <span>
                          <span className="heading-sm">{client?.name || l.client_id}</span>
                          <div className="caption" style={{color:'var(--text-tertiary)'}}>{client?.country || ''}</div>
                        </span>
                      </span>
                    </td>
                    <td>
                      <span className="phase-pill"
                            style={{'--phase-color': phase.color, '--phase-soft': phase.soft}}>
                        <span className="dot"/>
                        {phase.label}
                      </span>
                    </td>
                    <td className="ta-right tabular-nums">{l.qty.toLocaleString()}</td>
                    <td className="ta-right tabular-nums">{fmtMoney(l.unit_price_sold)}</td>
                    <td>
                      <div className="size-breakdown-row">
                        {Object.entries(l.size_breakdown || {}).map(([sid, q]) => {
                          const sz = sizeMap[sid];
                          return (
                            <span key={sid} className="size-bk-chip">
                              <span className="size-bk-lbl">{sz?.system || ''} {sz?.valor_talla || sid}</span>
                              <span className="size-bk-qty tabular-nums">{q}</span>
                            </span>
                          );
                        })}
                      </div>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
