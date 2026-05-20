// ─────────────────────────────────────────────────────────────
// ProductExpedientesTab — trazabilidad histórica del SKU
// Agente responsable: [AG-FRONTEND]
//
// Tab del detalle de producto que lista todas las OCs donde aparece
// el SKU como línea. Por cada OC muestra:
//   · Header: número proforma (o código OC), cliente con bandera,
//             país, estado, indicador "Operado por MWT", fecha emisión.
//   · Tabla de líneas: Talla · Cantidad · Precio MWT · Precio Cliente
//                      · Total · SAP · Estado de la línea.
//   · Totales por OC (qty, total MWT, total Cliente).
//
// Datos:
//   GET /api/expedientes/products/{sku}/ocs/
//   El backend ya filtra por client_id si rol = CLIENT_*.
// ─────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { IconFolder } from "../../lib/icons.jsx";
import { fmtMoney } from "../../lib/i18n.js";
import { apiFetch } from "../../lib/api.js";
import { useAuth } from "../../context/AuthContext.jsx";

const FLAG = {
  PE:'🇵🇪', CO:'🇨🇴', US:'🇺🇸', MX:'🇲🇽', AR:'🇦🇷',
  CL:'🇨🇱', BR:'🇧🇷', UY:'🇺🇾', EC:'🇪🇨', CR:'🇨🇷',
  PA:'🇵🇦', DO:'🇩🇴', GT:'🇬🇹', SV:'🇸🇻', HN:'🇭🇳',
  ES:'🇪🇸', CN:'🇨🇳',
};

const OC_STATE_META = {
  EMITIDA:       { label:'Emitida',       color:'#3083FE', soft:'rgba(48,131,254,0.12)' },
  EN_PRODUCCION: { label:'En producción', color:'#481EE3', soft:'rgba(72,30,227,0.12)' },
  EN_TRANSITO:   { label:'En tránsito',   color:'#B45309', soft:'rgba(180,83,9,0.12)'  },
  EN_DESTINO:    { label:'En destino',    color:'#00B286', soft:'rgba(0,178,134,0.12)' },
  ENTREGADA:     { label:'Entregada',     color:'#0E8A6D', soft:'rgba(14,138,109,0.12)'},
  CERRADA:       { label:'Cerrada',       color:'#0E8A6D', soft:'rgba(14,138,109,0.12)'},
  CANCELADA:     { label:'Cancelada',     color:'#DC2626', soft:'rgba(220,38,38,0.12)' },
};
const DEFAULT_STATE_META = { label:'—', color:'#64748B', soft:'rgba(100,116,139,0.12)' };

function stateMeta(estado) {
  if (!estado) return DEFAULT_STATE_META;
  return OC_STATE_META[String(estado).toUpperCase()] || {
    label: String(estado), color: '#64748B', soft: 'rgba(100,116,139,0.12)',
  };
}

export default function ProductExpedientesTab({ lang='es', sku }) {
  const navigate = useNavigate();
  const { accessToken } = useAuth() || {};
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [data,    setData]    = useState({ ocs: [] });

  useEffect(() => {
    if (!sku) { setData({ ocs: [] }); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch(`/expedientes/products/${encodeURIComponent(sku)}/ocs/`, {
      token: accessToken,
    })
      .then((res) => {
        if (cancelled) return;
        setData({
          sku:   res?.sku || sku,
          count: Number(res?.count || 0),
          ocs:   Array.isArray(res?.ocs) ? res.ocs : [],
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setError(String(err?.body?.detail || err?.message || err));
        setData({ ocs: [] });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sku, accessToken]);

  const totals = useMemo(() => {
    let qty = 0, revMwt = 0, revCli = 0, lines = 0;
    for (const oc of data.ocs) {
      qty    += Number(oc.totals?.qty || 0);
      revMwt += Number(oc.totals?.total_mwt || 0);
      revCli += Number(oc.totals?.total_client || 0);
      lines  += Number(oc.totals?.lines || 0);
    }
    return { count: data.ocs.length, qty, lines, revMwt, revCli };
  }, [data.ocs]);

  if (!sku) {
    return (
      <div className="card card-pad-lg empty" style={{marginTop:12}}>
        <IconFolder size={22} style={{color:'var(--text-tertiary)'}}/>
        <div className="heading-md">
          {lang === 'es' ? 'SKU no disponible' : 'SKU unavailable'}
        </div>
        <div className="caption" style={{maxWidth:360}}>
          {lang === 'es'
            ? 'El producto aún no tiene un SKU asignado.'
            : 'This product does not have a SKU assigned yet.'}
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="card card-pad-lg empty" style={{marginTop:12}}>
        <div className="caption" style={{color:'var(--text-tertiary)'}}>
          {lang === 'es' ? 'Cargando historial…' : 'Loading history…'}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        marginTop:12, padding:'12px 14px',
        background:'rgba(220,38,38,0.08)', color:'#991B1B',
        border:'1px solid rgba(220,38,38,0.35)', borderRadius:8,
        font:'500 12px/1.4 var(--font-body)',
      }}>
        {lang === 'es' ? 'Error cargando expedientes: ' : 'Error loading files: '}
        {error}
      </div>
    );
  }

  return (
    <div className="prod-expedientes-tab">
      <div className="prod-trace-summary card card-pad-md">
        <div className="prod-trace-sumcell">
          <span className="caption">{lang==='es'?'OCs':'POs'}</span>
          <span className="heading-md tabular-nums">{totals.count}</span>
        </div>
        <div className="prod-trace-sumcell">
          <span className="caption">{lang==='es'?'Líneas':'Lines'}</span>
          <span className="heading-md tabular-nums">{totals.lines}</span>
        </div>
        <div className="prod-trace-sumcell">
          <span className="caption">{lang==='es'?'Unidades':'Units'}</span>
          <span className="heading-md tabular-nums">{totals.qty.toLocaleString()}</span>
        </div>
        <div className="prod-trace-sumcell">
          <span className="caption">{lang==='es'?'Revenue cliente':'Client revenue'}</span>
          <span className="heading-md tabular-nums">{fmtMoney(totals.revCli)}</span>
        </div>
        <div className="prod-trace-sumcell">
          <span className="caption">{lang==='es'?'Revenue MWT':'MWT revenue'}</span>
          <span className="heading-md tabular-nums">{fmtMoney(totals.revMwt)}</span>
        </div>
      </div>

      {data.ocs.length === 0 ? (
        <div className="card card-pad-lg empty" style={{marginTop:12}}>
          <IconFolder size={22} style={{color:'var(--text-tertiary)'}}/>
          <div className="heading-md">
            {lang === 'es' ? 'Sin historial' : 'No history'}
          </div>
          <div className="caption" style={{maxWidth:360}}>
            {lang === 'es'
              ? 'Este SKU aún no ha sido asignado a ninguna OC.'
              : 'This SKU has not been attached to any purchase order yet.'}
          </div>
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:12, marginTop:12 }}>
          {data.ocs.map((oc, idx) => (
            <OcCard key={oc.id} oc={oc} idx={idx} lang={lang}
                    onOpen={() => navigate(`/expedientes/${oc.id}`)}/>
          ))}
        </div>
      )}
    </div>
  );
}

function OcCard({ oc, idx, lang, onOpen }) {
  const meta  = stateMeta(oc.estado);
  const flag  = FLAG[(oc.cliente?.pais_iso2 || '').toUpperCase()] || '🌐';
  const title = oc.proforma || oc.codigo || `OC · ${String(oc.id).slice(0, 8)}`;
  const subtitle = oc.proforma && oc.codigo ? oc.codigo : null;

  return (
    <motion.div
      initial={{ opacity:0, y:6 }}
      animate={{ opacity:1, y:0, transition:{ delay: idx*0.04, duration:0.24 } }}
      className="card card-pad-md"
      style={{ display:'flex', flexDirection:'column', gap:10 }}>
      <div style={{
        display:'flex', justifyContent:'space-between', alignItems:'flex-start',
        gap:12, flexWrap:'wrap',
      }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
          <button onClick={onOpen}
            style={{
              background:'transparent', border:'none', padding:0,
              cursor:'pointer', textAlign:'left',
              font:'700 16px/1.2 var(--font-display)',
              color:'var(--brand-primary)',
              fontVariantNumeric:'tabular-nums',
            }}
            title={lang === 'es' ? 'Abrir detalle del expediente' : 'Open file detail'}>
            {title}
          </button>
          {subtitle && (
            <span style={{
              font:'500 11px/1.2 var(--font-mono, ui-monospace)',
              color:'var(--text-tertiary)', fontVariantNumeric:'tabular-nums',
            }}>{subtitle}</span>
          )}
          <span style={{
            display:'inline-flex', alignItems:'center', gap:4,
            padding:'2px 8px', borderRadius:10,
            background: meta.soft, color: meta.color,
            font:'700 9.5px/1 var(--font-body)',
            textTransform:'uppercase', letterSpacing:0.4,
            border:`1px solid ${meta.color}33`,
          }}>
            <span style={{
              width:6, height:6, borderRadius:3, background: meta.color,
              display:'inline-block',
            }}/>
            {meta.label}
          </span>
          {oc.is_operated_by_mwt && (
            <span style={{
              padding:'2px 8px', borderRadius:10,
              background:'rgba(0,178,134,0.12)', color:'#065F46',
              font:'700 9.5px/1 var(--font-body)',
              textTransform:'uppercase', letterSpacing:0.4,
              border:'1px solid rgba(0,178,134,0.35)',
            }} title={lang === 'es'
              ? 'Esta OC está operada por Muito Work Limitada'
              : 'This PO is operated by Muito Work Limitada'}>
              {lang === 'es' ? 'Operado por MWT' : 'Operated by MWT'}
            </span>
          )}
        </div>
        <div style={{
          display:'flex', alignItems:'center', gap:14, flexWrap:'wrap',
          font:'500 11px/1.3 var(--font-body)', color:'var(--text-secondary)',
        }}>
          <span style={{ display:'inline-flex', alignItems:'center', gap:4 }}>
            <span>{flag}</span>
            <span style={{ color:'var(--text-primary)', fontWeight:600 }}>
              {oc.cliente?.razon_social || oc.cliente?.nombre_comercial || '—'}
            </span>
            {oc.cliente?.pais_iso2 && (
              <span style={{ color:'var(--text-tertiary)' }}>· {oc.cliente.pais_iso2}</span>
            )}
          </span>
          {oc.issued_at && (
            <span className="tabular-nums">
              {lang === 'es' ? 'Emitida' : 'Issued'}:{' '}
              {new Date(oc.issued_at).toLocaleDateString(lang === 'es' ? 'es-CR' : 'en-US')}
            </span>
          )}
        </div>
      </div>

      <div style={{
        overflowX:'auto',
        border:'1px solid var(--border-subtle, #E5E7EB)',
        borderRadius:8, background:'#FFFFFF',
      }}>
        <table style={{
          width:'100%', borderCollapse:'separate', borderSpacing:0,
          fontVariantNumeric:'tabular-nums',
        }}>
          <thead>
            <tr>
              <th style={th}>{lang==='es'?'Talla':'Size'}</th>
              <th style={{...th, textAlign:'right'}}>{lang==='es'?'Cant.':'Qty'}</th>
              <th style={{...th, textAlign:'right'}}>{lang==='es'?'Precio MWT':'MWT price'}</th>
              <th style={{...th, textAlign:'right'}}>{lang==='es'?'Precio Cliente':'Client price'}</th>
              <th style={{...th, textAlign:'right'}}>{lang==='es'?'Total':'Total'}</th>
              <th style={th}>SAP</th>
              <th style={th}>{lang==='es'?'Estado':'Status'}</th>
            </tr>
          </thead>
          <tbody>
            {oc.lineas.map((l) => (
              <tr key={l.id}>
                <td style={td}>{l.size || '—'}</td>
                <td style={{...td, textAlign:'right'}}>
                  {Number(l.qty || 0).toLocaleString()}
                </td>
                <td style={{...td, textAlign:'right', color:'var(--text-secondary)'}}>
                  {fmtMoney(l.unit_price_mwt)}
                </td>
                <td style={{...td, textAlign:'right', fontWeight:700,
                  color:'var(--text-primary)'}}>
                  {fmtMoney(l.unit_price_client)}
                </td>
                <td style={{...td, textAlign:'right', fontWeight:600}}>
                  {fmtMoney(l.total_price)}
                </td>
                <td style={{...td, color:'var(--text-tertiary)',
                  font:'600 10.5px/1.3 var(--font-mono, ui-monospace)'}}>
                  {l.sap || '—'}
                </td>
                <td style={{...td, color:'var(--text-tertiary)', fontSize:11}}>
                  {l.estado || '—'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td style={{...tdFoot, textTransform:'uppercase', letterSpacing:0.4,
                font:'700 10.5px/1 var(--font-body)',
                color:'var(--text-secondary)'}}>
                {lang === 'es' ? 'Totales' : 'Totals'}
              </td>
              <td style={{...tdFoot, textAlign:'right', fontWeight:700}}>
                {Number(oc.totals?.qty || 0).toLocaleString()}
              </td>
              <td style={{...tdFoot, textAlign:'right', color:'var(--text-secondary)'}}>
                {fmtMoney(oc.totals?.total_mwt)}
              </td>
              <td style={{...tdFoot, textAlign:'right', fontWeight:700}}>
                {fmtMoney(oc.totals?.total_client)}
              </td>
              <td style={tdFoot}></td>
              <td style={tdFoot}></td>
              <td style={tdFoot}></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </motion.div>
  );
}

const th = {
  font:'700 9.5px/1 var(--font-body)',
  color:'var(--text-secondary)',
  padding:'10px 10px',
  textAlign:'left',
  textTransform:'uppercase', letterSpacing:0.5,
  borderBottom:'1px solid var(--border-subtle, #E5E7EB)',
  background:'var(--surface-alt, #F8FAFC)',
  whiteSpace:'nowrap',
};

const td = {
  padding:'9px 10px',
  fontSize:11.5,
  color:'var(--text-primary, #0B1E3A)',
  borderBottom:'1px solid var(--border-subtle, #F1F5F9)',
  verticalAlign:'middle',
};

const tdFoot = {
  padding:'9px 10px',
  fontSize:11.5,
  color:'var(--text-primary, #0B1E3A)',
  borderTop:'1px solid var(--border-subtle, #E5E7EB)',
  background:'var(--surface-alt, #F8FAFC)',
};
