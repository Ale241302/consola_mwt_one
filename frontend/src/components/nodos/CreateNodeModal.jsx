// ─────────────────────────────────────────────────────────────
// CreateNodeModal — Drawer lateral de creación
// Agente responsable: [AG-FRONTEND]
//
// Campos canónicos ENT_OPS_NODOS:
//   node_id, name, type, legal_entity_id, operator_id,
//   country, status, capabilities{...}
// ─────────────────────────────────────────────────────────────
import React, { useState } from "react";
import { motion } from "framer-motion";
import {
  IconX, IconCheck, IconPackage, IconBoxes, IconTruck,
  IconDollar, IconTrend, IconMapPin,
} from "../../lib/icons.jsx";
import { LEGAL_ENTITIES, OPERATORS } from "../../data/mockData.js";

const TYPES = [
  { k:'marketplace', l:'Marketplace', hint:'Inventario consignado en Amazon, Mercado Libre, etc.' },
  { k:'fiscal',      l:'Fiscal',      hint:'Almacén fiscal o depósito aduanero' },
  { k:'warehouse',   l:'Warehouse',   hint:'Centro de distribución propio u operado' },
  { k:'distributor', l:'Distributor', hint:'Hub de un distribuidor regional' },
  { k:'factory',     l:'Factory',     hint:'Planta productiva / origen de mercancía' },
];

const COUNTRIES = [
  { k:'MX', l:'México 🇲🇽' }, { k:'PE', l:'Perú 🇵🇪' },
  { k:'CO', l:'Colombia 🇨🇴' }, { k:'CL', l:'Chile 🇨🇱' },
  { k:'PA', l:'Panamá 🇵🇦' }, { k:'BR', l:'Brasil 🇧🇷' },
  { k:'CR', l:'Costa Rica 🇨🇷' }, { k:'US', l:'USA 🇺🇸' },
  { k:'CN', l:'China 🇨🇳' }, { k:'EC', l:'Ecuador 🇪🇨' },
  { k:'AR', l:'Argentina 🇦🇷' },
];

const CAPS = [
  { k:'receive',          l:'Recibir',    icon: IconPackage },
  { k:'store',            l:'Almacenar',  icon: IconBoxes   },
  { k:'prepare',          l:'Preparar',   icon: IconCheck   },
  { k:'dispatch',         l:'Despachar',  icon: IconTruck   },
  { k:'report_sales',     l:'Ventas',     icon: IconDollar  },
  { k:'report_inventory', l:'Inventario', icon: IconTrend   },
];

export default function CreateNodeModal({ lang='es', onClose, onCreated }) {
  const [form, setForm] = useState({
    node_id: '',
    name: '',
    type: 'warehouse',
    legal_entity_id: LEGAL_ENTITIES[0]?.id || '',
    operator_id:     OPERATORS[0]?.id     || '',
    country: 'MX',
    status: 'PLANNED',
    capabilities: {
      receive: true, store: true, prepare: false,
      dispatch: true, report_sales: false, report_inventory: true,
    },
  });

  const update  = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const toggle  = (k)    => setForm(p => ({ ...p, capabilities: { ...p.capabilities, [k]: !p.capabilities[k] } }));

  const valid = form.node_id.trim().length >= 3 && form.name.trim().length >= 3;

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
        animate={{ x: 0,   opacity: 1, transition: { type: 'spring', stiffness: 260, damping: 30 } }}
        exit   ={{ x: 520, opacity: 0, transition: { duration: 0.18 } }}
      >
        <div className="drawer-head">
          <div>
            <div className="micro">{lang==='es'?'CREAR NODO':'CREATE NODE'}</div>
            <div className="heading-md">{lang==='es'?'Nuevo nodo logístico':'New logistic node'}</div>
            <div className="caption" style={{marginTop: 2}}>
              {lang==='es'
                ? 'Se guarda en estado PLANNED hasta que el CEO lo active.'
                : 'Saved as PLANNED until CEO activates it.'}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose}><IconX size={14}/></button>
        </div>

        <form className="drawer-body" onSubmit={submit}>
          {/* ── Identificación ── */}
          <section className="drawer-section">
            <div className="drawer-section-title">{lang==='es'?'Identificación':'Identification'}</div>
            <div className="grid col-2 gap-3">
              <div>
                <label className="field-label">node_id</label>
                <input className="input mono-sm" placeholder="FBA-US"
                       value={form.node_id}
                       onChange={e=>update('node_id', e.target.value.toUpperCase().slice(0, 12))}/>
                <div className="field-hint">{lang==='es'?'Slug corto (3–12).':'Short slug (3–12).'}</div>
              </div>
              <div>
                <label className="field-label">{lang==='es'?'Nombre':'Name'}</label>
                <input className="input" placeholder="Amazon FBA USA"
                       value={form.name}
                       onChange={e=>update('name', e.target.value)}/>
              </div>
            </div>
          </section>

          {/* ── Tipo de nodo ── */}
          <section className="drawer-section">
            <div className="drawer-section-title">{lang==='es'?'Tipo':'Type'}</div>
            <div className="type-picker">
              {TYPES.map(t => (
                <button key={t.k} type="button"
                        className="type-chip"
                        data-active={form.type === t.k}
                        onClick={()=>update('type', t.k)}>
                  <span className="type-chip-l">{t.l}</span>
                  <span className="type-chip-h">{t.hint}</span>
                </button>
              ))}
            </div>
          </section>

          {/* ── Owner + Operator ── */}
          <section className="drawer-section">
            <div className="drawer-section-title">{lang==='es'?'Dueño del inventario y operador':'Inventory owner & operator'}</div>
            <div className="grid col-2 gap-3">
              <div>
                <label className="field-label">{lang==='es'?'Entidad legal (dueño)':'Legal entity (owner)'}</label>
                <select className="select" value={form.legal_entity_id}
                        onChange={e=>update('legal_entity_id', e.target.value)}>
                  {LEGAL_ENTITIES.map(le => (
                    <option key={le.id} value={le.id}>{le.short} — {le.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label">{lang==='es'?'Operador del espacio':'Space operator'}</label>
                <select className="select" value={form.operator_id}
                        onChange={e=>update('operator_id', e.target.value)}>
                  {OPERATORS.map(op => (
                    <option key={op.id} value={op.id}>{op.name} ({op.kind})</option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* ── Localización + estado ── */}
          <section className="drawer-section">
            <div className="drawer-section-title">{lang==='es'?'Localización y estado':'Location & status'}</div>
            <div className="grid col-2 gap-3">
              <div>
                <label className="field-label">{lang==='es'?'País':'Country'}</label>
                <div className="input" style={{display:'flex', alignItems:'center', gap:8, padding:'0 12px'}}>
                  <IconMapPin size={13} style={{color:'var(--text-tertiary)'}}/>
                  <select value={form.country} onChange={e=>update('country', e.target.value)}
                          style={{flex:1, border:0, background:'transparent', outline:'none', font:'inherit'}}>
                    {COUNTRIES.map(c => <option key={c.k} value={c.k}>{c.l}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="field-label">{lang==='es'?'Estado':'Status'}</label>
                <div className="seg" style={{width:'100%'}}>
                  <button type="button" data-active={form.status==='PLANNED'} onClick={()=>update('status','PLANNED')}>PLANNED</button>
                  <button type="button" data-active={form.status==='ACTIVE'}  onClick={()=>update('status','ACTIVE')}>ACTIVE</button>
                </div>
              </div>
            </div>
          </section>

          {/* ── Capabilities ── */}
          <section className="drawer-section">
            <div className="drawer-section-title">{lang==='es'?'Capacidades':'Capabilities'}</div>
            <div className="cap-grid">
              {CAPS.map(c => {
                const on = form.capabilities[c.k];
                const Ico = c.icon;
                return (
                  <button key={c.k} type="button"
                          className="cap-check" data-on={on}
                          onClick={()=>toggle(c.k)}>
                    <Ico size={14}/>
                    <span>{c.l}</span>
                    {on && <IconCheck size={12} className="cap-check-tick"/>}
                  </button>
                );
              })}
            </div>
          </section>
        </form>

        <div className="drawer-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {lang==='es'?'Cancelar':'Cancel'}
          </button>
          <button type="button" className="btn btn-primary" disabled={!valid} onClick={submit}>
            <IconCheck size={14}/> {lang==='es'?'Crear nodo':'Create node'}
          </button>
        </div>
      </motion.aside>
    </>
  );
}
