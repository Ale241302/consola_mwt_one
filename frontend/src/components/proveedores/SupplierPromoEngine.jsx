// ─────────────────────────────────────────────────────────────
// SupplierPromoEngine — Tab 2 del detalle proveedor
// Agente responsable: [AG-FRONTEND]
//
// Form generador de códigos:
//   · código (ej. MLV-SUMMER-5)    · productos_aplicables (ALL | lista SKUs)
//   · cantidad_minima (MOQ)        · porcentaje_descuento
//   · límite_usos                  · fecha_inicio / fecha_expiración
//
// Tabla de códigos:
//   código · descripción · alcance · MOQ · % · uso X/Y · vigencia · ahorro total · estado
// ─────────────────────────────────────────────────────────────
import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  IconPercent, IconPlus, IconCheck, IconX, IconPackage, IconTag,
} from "../../lib/icons.jsx";
import { fmtMoney } from "../../lib/i18n.js";
import {
  SUPPLIER_PROMO_CODES, SUPPLIER_PRODUCTS,
} from "../../data/mockData.js";

const STATUS_META = {
  ACTIVO:   { label:'Activo',   color:'#0E8A6D', soft:'rgba(14,138,109,0.12)' },
  EXPIRADO: { label:'Expirado', color:'#64748B', soft:'rgba(100,116,139,0.12)' },
  AGOTADO:  { label:'Agotado',  color:'#B45309', soft:'rgba(180,83,9,0.12)' },
};

export default function SupplierPromoEngine({ lang='es', supplierId, supplierName='', supplierCode='SUP' }) {
  // Códigos del supplier actual (en memoria — demo)
  const existingCodes = useMemo(
    () => SUPPLIER_PROMO_CODES.filter(c => c.supplier_id === supplierId),
    [supplierId]
  );
  const supplierSkus = useMemo(
    () => Array.from(new Set(SUPPLIER_PRODUCTS.filter(p => p.supplier_id === supplierId).map(p => p.sku))),
    [supplierId]
  );

  // Local state para códigos agregados en la sesión
  const [sessionCodes, setSessionCodes] = useState([]);
  const allCodes = [...sessionCodes, ...existingCodes];

  // Form
  const [form, setForm] = useState({
    codigo: '',
    descripcion: '',
    scope: 'ALL',          // 'ALL' | 'SKUS'
    scope_skus: [],
    moq: 500,
    pct: 5,
    limit: 20,
    start: new Date().toISOString().slice(0, 10),
    end: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10),
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const toggleSku = (sku) => setForm(f => ({
    ...f,
    scope_skus: f.scope_skus.includes(sku)
      ? f.scope_skus.filter(x => x!==sku)
      : [...f.scope_skus, sku],
  }));

  const canSave = form.codigo.trim().length >= 3 && form.pct > 0 && form.pct <= 100 && form.limit > 0;

  const handleAdd = () => {
    const scope = form.scope === 'ALL' ? 'ALL' : form.scope_skus;
    const newCode = {
      id: `PC-SES-${Date.now()}`,
      supplier_id: supplierId,
      codigo: form.codigo.toUpperCase().replace(/\s+/g, '-'),
      descripcion: form.descripcion || (lang==='es'?'Código sin descripción':'Code without description'),
      scope,
      moq: parseInt(form.moq, 10) || 0,
      pct: parseFloat(form.pct) || 0,
      uses: 0,
      limit: parseInt(form.limit, 10) || 1,
      start: form.start,
      end: form.end,
      status: 'ACTIVO',
      ahorro_total: 0,
    };
    setSessionCodes(prev => [newCode, ...prev]);
    setForm(f => ({ ...f, codigo:'', descripcion:'', scope_skus:[] }));
  };

  // Sugerencia de código
  const suggestCode = () => {
    const tag = Math.random().toString(36).slice(2, 5).toUpperCase();
    set('codigo', `${supplierCode}-${tag}-${form.pct || 5}`);
  };

  // KPIs
  const stats = useMemo(() => {
    const activos = allCodes.filter(c => c.status === 'ACTIVO').length;
    const usosTotales = allCodes.reduce((a,c) => a + (c.uses || 0), 0);
    const ahorroTotal = allCodes.reduce((a,c) => a + (c.ahorro_total || 0), 0);
    return { activos, usosTotales, ahorroTotal, total: allCodes.length };
  }, [allCodes]);

  return (
    <div className="promo-engine">
      {/* Stats */}
      <div className="promo-stats">
        <div className="promo-stat">
          <div className="caption">{lang==='es'?'Códigos totales':'Total codes'}</div>
          <div className="heading-md tabular-nums">{stats.total}</div>
        </div>
        <div className="promo-stat">
          <div className="caption">{lang==='es'?'Activos':'Active'}</div>
          <div className="heading-md tabular-nums" style={{color:'var(--success)'}}>{stats.activos}</div>
        </div>
        <div className="promo-stat">
          <div className="caption">{lang==='es'?'Usos acumulados':'Accumulated uses'}</div>
          <div className="heading-md tabular-nums">{stats.usosTotales.toLocaleString()}</div>
        </div>
        <div className="promo-stat">
          <div className="caption">{lang==='es'?'Ahorro total':'Total savings'}</div>
          <div className="heading-md tabular-nums" style={{color:'var(--brand-accent)'}}>
            {fmtMoney(stats.ahorroTotal)}
          </div>
        </div>
      </div>

      {/* Form */}
      <motion.div
        className="card card-pad-md promo-form"
        initial={{ opacity:0, y:6 }}
        animate={{ opacity:1, y:0, transition:{ duration:0.22 } }}
      >
        <div className="form-card-head">
          <IconPercent size={16} style={{color:'var(--brand-accent)'}}/>
          <div>
            <div className="heading-md">{lang==='es'?'Generar código promocional':'Generate promo code'}</div>
            <div className="caption" style={{color:'var(--text-tertiary)'}}>
              {lang==='es'
                ? 'Rebates, descuentos por volumen o lanzamientos negociados con este proveedor'
                : 'Rebates, volume discounts or launch deals negotiated with this supplier'}
            </div>
          </div>
        </div>

        <div className="form-grid-3">
          <div className="form-field">
            <label>{lang==='es'?'Código':'Code'}</label>
            <div style={{display:'flex', gap:6}}>
              <input className="input mono-sm" value={form.codigo}
                     onChange={e=>set('codigo', e.target.value.toUpperCase())}
                     placeholder={`${supplierCode}-SUMMER-5`}/>
              <button className="btn btn-xs" onClick={suggestCode} type="button">
                {lang==='es'?'Sugerir':'Suggest'}
              </button>
            </div>
          </div>
          <div className="form-field">
            <label>{lang==='es'?'Descripción':'Description'}</label>
            <input className="input" value={form.descripcion}
                   onChange={e=>set('descripcion', e.target.value)}
                   placeholder={lang==='es'?'Ej. Rebaja verano 2026':'e.g. Summer rebate 2026'}/>
          </div>
          <div className="form-field">
            <label>{lang==='es'?'Descuento (%)':'Discount (%)'}</label>
            <input className="input tabular-nums" type="number" min="1" max="100"
                   value={form.pct}
                   onChange={e=>set('pct', e.target.value)}/>
          </div>
        </div>

        <div className="form-grid-3">
          <div className="form-field">
            <label>{lang==='es'?'Cantidad mínima (MOQ)':'Minimum order qty (MOQ)'}</label>
            <input className="input tabular-nums" type="number" min="0"
                   value={form.moq}
                   onChange={e=>set('moq', e.target.value)}/>
          </div>
          <div className="form-field">
            <label>{lang==='es'?'Límite de usos':'Usage limit'}</label>
            <input className="input tabular-nums" type="number" min="1"
                   value={form.limit}
                   onChange={e=>set('limit', e.target.value)}/>
          </div>
          <div className="form-field">
            <label>{lang==='es'?'Vigencia':'Validity'}</label>
            <div style={{display:'flex', gap:6}}>
              <input className="input mono-sm" type="date"
                     value={form.start} onChange={e=>set('start', e.target.value)}/>
              <input className="input mono-sm" type="date"
                     value={form.end} onChange={e=>set('end', e.target.value)}/>
            </div>
          </div>
        </div>

        {/* Scope */}
        <div className="form-field">
          <label>{lang==='es'?'Alcance':'Scope'}</label>
          <div className="scope-picker">
            <button className={`scope-btn ${form.scope==='ALL'?'is-on':''}`}
                    onClick={()=>set('scope','ALL')}>
              <IconPackage size={12}/> {lang==='es'?'Todos los productos':'All products'}
            </button>
            <button className={`scope-btn ${form.scope==='SKUS'?'is-on':''}`}
                    onClick={()=>set('scope','SKUS')}>
              <IconTag size={12}/> {lang==='es'?'SKUs específicos':'Specific SKUs'}
            </button>
          </div>
          {form.scope === 'SKUS' && (
            <div className="scope-sku-wrap">
              {supplierSkus.length === 0 ? (
                <span className="caption" style={{color:'var(--text-tertiary)'}}>
                  {lang==='es'?'Sin SKUs registrados para este proveedor':'No SKUs registered for this supplier'}
                </span>
              ) : supplierSkus.map(sku => {
                const on = form.scope_skus.includes(sku);
                return (
                  <button key={sku}
                          className={`sku-chip ${on?'is-on':''}`}
                          onClick={()=>toggleSku(sku)}>
                    {on ? <IconCheck size={10}/> : null}
                    <span className="mono-sm">{sku}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div style={{display:'flex', justifyContent:'flex-end', marginTop:8}}>
          <button className="btn btn-accent" onClick={handleAdd} disabled={!canSave}>
            <IconPlus size={14}/> {lang==='es'?'Agregar código':'Add code'}
          </button>
        </div>
      </motion.div>

      {/* Códigos existentes */}
      <div className="card card-pad-sm promo-table-wrap" style={{marginTop:14}}>
        <div className="supplier-table-head">
          <div>
            <div className="heading-md">{lang==='es'?'Códigos de este proveedor':'Codes for this supplier'}</div>
            <div className="caption" style={{color:'var(--text-tertiary)'}}>
              {supplierName} · {allCodes.length} {lang==='es'?'códigos':'codes'}
            </div>
          </div>
        </div>

        {allCodes.length === 0 ? (
          <div className="empty-state" style={{padding:'24px 12px'}}>
            <IconPercent size={20} style={{color:'var(--text-tertiary)'}}/>
            <div className="caption">
              {lang==='es'?'Sin códigos emitidos aún':'No codes issued yet'}
            </div>
          </div>
        ) : (
          <table className="promo-table">
            <thead>
              <tr>
                <th>{lang==='es'?'Código':'Code'}</th>
                <th>{lang==='es'?'Descripción / alcance':'Description / scope'}</th>
                <th className="ta-right">MOQ</th>
                <th className="ta-right">%</th>
                <th>{lang==='es'?'Uso':'Usage'}</th>
                <th>{lang==='es'?'Vigencia':'Validity'}</th>
                <th className="ta-right">{lang==='es'?'Ahorro':'Savings'}</th>
                <th>{lang==='es'?'Estado':'Status'}</th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence mode="popLayout">
                {allCodes.map((c, idx) => {
                  const st = STATUS_META[c.status] || STATUS_META.ACTIVO;
                  const usePct = c.limit > 0 ? (c.uses / c.limit) * 100 : 0;
                  const isSkuScope = Array.isArray(c.scope);
                  return (
                    <motion.tr
                      key={c.id}
                      layout
                      initial={{ opacity:0, y:4 }}
                      animate={{ opacity:1, y:0, transition:{ delay: idx*0.03, duration:0.22 } }}
                      exit={{ opacity:0, y:-4, transition:{ duration:0.1 } }}
                      className="promo-row"
                    >
                      <td className="mono-sm" style={{fontWeight:600}}>{c.codigo}</td>
                      <td>
                        <div className="body-sm">{c.descripcion}</div>
                        <div className="caption" style={{color:'var(--text-tertiary)'}}>
                          {isSkuScope
                            ? `${c.scope.length} SKU${c.scope.length!==1?'s':''}`
                            : (lang==='es'?'Todos los SKUs':'All SKUs')}
                        </div>
                      </td>
                      <td className="ta-right tabular-nums">{c.moq.toLocaleString()}</td>
                      <td className="ta-right tabular-nums" style={{color:'var(--brand-accent)', fontWeight:600}}>
                        {c.pct}%
                      </td>
                      <td>
                        <div className="promo-use-bar">
                          <span className="tabular-nums mono-sm">{c.uses}/{c.limit}</span>
                          <div className="use-bar-outer">
                            <div className="use-bar-inner"
                                 style={{ width: `${Math.min(usePct, 100)}%` }}/>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="caption mono-sm">{c.start}</div>
                        <div className="caption mono-sm" style={{color:'var(--text-tertiary)'}}>
                          → {c.end}
                        </div>
                      </td>
                      <td className="ta-right tabular-nums" style={{fontWeight:600}}>
                        {fmtMoney(c.ahorro_total)}
                      </td>
                      <td>
                        <span className="phase-pill"
                              style={{'--phase-color': st.color, '--phase-soft': st.soft}}>
                          <span className="dot"/>{st.label}
                        </span>
                      </td>
                    </motion.tr>
                  );
                })}
              </AnimatePresence>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
