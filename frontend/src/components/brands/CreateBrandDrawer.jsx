// ─────────────────────────────────────────────────────────────
// CreateBrandDrawer — Drawer lateral de alta de marca
// Agente responsable: [AG-FRONTEND]
//
// Campos canónicos ENT_PLAT_MARCAS:
//   brand_id, nombre, tipo (PROPIA|DISTRIBUCION),
//   issuing_entity (Legal Entity), mercados_activos[],
//   status (ACTIVO|INACTIVO), description
// ─────────────────────────────────────────────────────────────
import React, { useState } from "react";
import { motion } from "framer-motion";
import {
  IconX, IconCheck, IconTag, IconGlobe, IconShield,
} from "../../lib/icons.jsx";
import { LEGAL_ENTITIES } from "../../data/mockData.js";

const TIPOS = [
  { k:'PROPIA',       l:'Propia',       hint:'Marca propia MWT · facturación directa' },
  { k:'DISTRIBUCION', l:'Distribución', hint:'Marca representada · contrato de distribución' },
];

const COUNTRIES = [
  { k:'MX', l:'México', f:'🇲🇽' }, { k:'PE', l:'Perú', f:'🇵🇪' },
  { k:'CO', l:'Colombia', f:'🇨🇴' }, { k:'CL', l:'Chile', f:'🇨🇱' },
  { k:'PA', l:'Panamá', f:'🇵🇦' }, { k:'BR', l:'Brasil', f:'🇧🇷' },
  { k:'CR', l:'Costa Rica', f:'🇨🇷' }, { k:'US', l:'USA', f:'🇺🇸' },
  { k:'EC', l:'Ecuador', f:'🇪🇨' }, { k:'AR', l:'Argentina', f:'🇦🇷' },
  { k:'DO', l:'R. Dominicana', f:'🇩🇴' },
];

export default function CreateBrandDrawer({ lang='es', initial=null, onClose, onCreated }) {
  const isEdit = !!initial;
  const [form, setForm] = useState({
    brand_id: '',
    name: '',
    tipo: 'PROPIA',
    issuing_entity: LEGAL_ENTITIES[0]?.id || '',
    mercados_activos: ['MX'],
    status: 'ACTIVO',
    description: '',
    color: '#00B286',
    // Sprint 2026-07-20 · correlativo de proformas (opcional). PRÓXIMO
    // número PF de la marca — el año es automático (año actual).
    pf_correlativo: null,
    ...(initial || {}),
  });

  const update = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const toggleMarket = (cc) => setForm(p => ({
    ...p,
    mercados_activos: p.mercados_activos.includes(cc)
      ? p.mercados_activos.filter(c => c !== cc)
      : [...p.mercados_activos, cc],
  }));

  const valid =
    form.brand_id.trim().length >= 2 &&
    form.brand_id.trim().length <= 6 &&
    form.name.trim().length >= 3 &&
    form.mercados_activos.length >= 1;

  const submit = (e) => {
    e.preventDefault();
    if (!valid) return;
    onCreated && onCreated(form);
  };

  return (
    <>
      <motion.div
        className="drawer-backdrop"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.aside
        className="drawer-panel"
        role="dialog" aria-modal="true"
        initial={{ x: 520, opacity: 0.6 }}
        animate={{ x: 0, opacity: 1, transition: { type: 'spring', stiffness: 260, damping: 30 } }}
        exit   ={{ x: 520, opacity: 0, transition: { duration: 0.18 } }}
      >
        <div className="drawer-head">
          <div>
            <div className="micro">
              {isEdit ? (lang==='es'?'EDITAR MARCA':'EDIT BRAND')
                      : (lang==='es'?'NUEVA MARCA':'NEW BRAND')}
            </div>
            <div className="heading-md">
              {isEdit ? (lang==='es'?'Actualizar marca':'Update brand')
                      : (lang==='es'?'Alta de marca':'Brand onboarding')}
            </div>
            <div className="caption" style={{marginTop:2}}>
              {lang==='es'
                ? 'Se registra en ENT_PLAT_MARCAS. Los feature-flags se configuran en detalle.'
                : 'Registered in ENT_PLAT_MARCAS. Feature flags are configured in detail view.'}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose}><IconX size={14}/></button>
        </div>

        <form className="drawer-body" onSubmit={submit}>
          {/* ── Identificación ── */}
          <section className="drawer-section">
            <div className="drawer-section-title">
              <IconTag size={12} style={{marginRight:6, verticalAlign:'-1px'}}/>
              {lang==='es'?'Identificación':'Identification'}
            </div>
            <div className="grid col-2 gap-3">
              <div>
                <label className="field-label">brand_id</label>
                <input className="input mono-sm" placeholder="RW"
                       value={form.brand_id}
                       onChange={e=>update('brand_id', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6))}/>
                <div className="field-hint">{lang==='es'?'Slug corto (2–6 alfanumérico).':'Short slug (2–6 alphanum).'}</div>
              </div>
              <div>
                <label className="field-label">{lang==='es'?'Nombre comercial':'Commercial name'}</label>
                <input className="input" placeholder="Rana Walk"
                       value={form.name}
                       onChange={e=>update('name', e.target.value)}/>
              </div>
              <div style={{gridColumn:'1 / -1'}}>
                <label className="field-label">{lang==='es'?'Descripción corta':'Short description'}</label>
                <input className="input" placeholder={lang==='es'?'Línea propia MWT en ramp-up.':'Owned MWT line in ramp-up.'}
                       value={form.description}
                       onChange={e=>update('description', e.target.value)}/>
              </div>
              <div>
                <label className="field-label">{lang==='es'?'Color de marca':'Brand color'}</label>
                <div className="input" style={{display:'flex', alignItems:'center', gap:8, padding:'0 12px'}}>
                  <input type="color" value={form.color}
                         onChange={e=>update('color', e.target.value)}
                         style={{width:28, height:28, border:0, background:'transparent', cursor:'pointer'}}/>
                  <span className="mono-sm">{form.color}</span>
                </div>
              </div>
              <div>
                <label className="field-label">{lang==='es'?'Correlativo de Proformas':'Proforma sequence'}</label>
                <input className="input tabular-nums" type="number" min="1" step="1"
                       placeholder={lang==='es'?'Ej. 2489':'E.g. 2489'}
                       value={form.pf_correlativo ?? ''}
                       onChange={e=>update('pf_correlativo',
                         e.target.value === '' ? null : Math.max(1, parseInt(e.target.value, 10) || 1))}/>
                <div className="field-hint">
                  {lang==='es'
                    ? `Próximo número PF de la marca (PF ${form.pf_correlativo || 'N'}-${new Date().getFullYear()}). El año es automático.`
                    : `Next proforma number for this brand (PF ${form.pf_correlativo || 'N'}-${new Date().getFullYear()}). Year is automatic.`}
                </div>
              </div>
            </div>
          </section>

          {/* ── Tipo ── */}
          <section className="drawer-section">
            <div className="drawer-section-title">{lang==='es'?'Tipo de operación':'Operation type'}</div>
            <div className="type-picker">
              {TIPOS.map(t => (
                <button key={t.k} type="button"
                        className="type-chip"
                        data-active={form.tipo === t.k}
                        onClick={()=>update('tipo', t.k)}>
                  <span className="type-chip-l">{t.l}</span>
                  <span className="type-chip-h">{t.hint}</span>
                </button>
              ))}
            </div>
          </section>

          {/* ── Issuing entity ── */}
          <section className="drawer-section">
            <div className="drawer-section-title">
              <IconShield size={12} style={{marginRight:6, verticalAlign:'-1px'}}/>
              {lang==='es'?'Entidad emisora (issuer)':'Issuing entity'}
            </div>
            <select className="select" value={form.issuing_entity}
                    onChange={e=>update('issuing_entity', e.target.value)}>
              {LEGAL_ENTITIES.map(le => (
                <option key={le.id} value={le.id}>{le.short} — {le.name}</option>
              ))}
            </select>
            <div className="field-hint">
              {lang==='es'
                ? 'Entidad legal que factura los expedientes bajo esta marca.'
                : 'Legal entity that invoices files under this brand.'}
            </div>
          </section>

          {/* ── Mercados ── */}
          <section className="drawer-section">
            <div className="drawer-section-title">
              <IconGlobe size={12} style={{marginRight:6, verticalAlign:'-1px'}}/>
              {lang==='es'?'Mercados activos':'Active markets'}
              <span style={{color:'var(--text-tertiary)', marginLeft:8}}>
                ({form.mercados_activos.length})
              </span>
            </div>
            <div className="market-grid">
              {COUNTRIES.map(c => {
                const on = form.mercados_activos.includes(c.k);
                return (
                  <button key={c.k} type="button"
                          className="market-chip" data-on={on}
                          onClick={()=>toggleMarket(c.k)}>
                    <span className="market-flag">{c.f}</span>
                    <span className="market-name">{c.l}</span>
                    {on && <IconCheck size={12} className="market-tick"/>}
                  </button>
                );
              })}
            </div>
          </section>

          {/* ── Estado ── */}
          <section className="drawer-section">
            <div className="drawer-section-title">{lang==='es'?'Estado':'Status'}</div>
            <div className="seg" style={{width:'100%'}}>
              <button type="button" data-active={form.status==='ACTIVO'}   onClick={()=>update('status','ACTIVO')}>ACTIVO</button>
              <button type="button" data-active={form.status==='INACTIVO'} onClick={()=>update('status','INACTIVO')}>INACTIVO</button>
            </div>
          </section>
        </form>

        <div className="drawer-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {lang==='es'?'Cancelar':'Cancel'}
          </button>
          <button type="button" className="btn btn-primary" disabled={!valid} onClick={submit}>
            <IconCheck size={14}/>
            {isEdit ? (lang==='es'?'Guardar cambios':'Save changes')
                    : (lang==='es'?'Crear marca':'Create brand')}
          </button>
        </div>
      </motion.aside>
    </>
  );
}
