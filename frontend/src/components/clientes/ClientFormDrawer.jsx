// ─────────────────────────────────────────────────────────────
// ClientFormDrawer — Drawer lateral de creación de cliente B2B
// Agente responsable: [AG-FRONTEND]
//
// Campos canónicos ENT_COMERCIAL_CLIENTES:
//   cliente, codigo_marluvas, cedula_juridica,
//   pais, direccion_entrega,
//   contacto_nombre, contacto_email, contacto_telefono,
//   credito_dias, credito_limit, medio_pago, incoterm,
//   canal, estado
// ─────────────────────────────────────────────────────────────
import React, { useState } from "react";
import { motion } from "framer-motion";
import {
  IconX, IconCheck, IconUser, IconMail, IconMapPin,
  IconCreditCard, IconShield, IconGlobe,
} from "../../lib/icons.jsx";

const COUNTRIES = [
  { k:'MX', l:'México 🇲🇽' }, { k:'PE', l:'Perú 🇵🇪' },
  { k:'CO', l:'Colombia 🇨🇴' }, { k:'CL', l:'Chile 🇨🇱' },
  { k:'PA', l:'Panamá 🇵🇦' }, { k:'BR', l:'Brasil 🇧🇷' },
  { k:'CR', l:'Costa Rica 🇨🇷' }, { k:'US', l:'USA 🇺🇸' },
  { k:'EC', l:'Ecuador 🇪🇨' }, { k:'AR', l:'Argentina 🇦🇷' },
  { k:'DO', l:'R. Dominicana 🇩🇴' },
];

const INCOTERMS   = ['FOB','CIF','EXW','DAP','DDP'];
const MEDIOS_PAGO = [
  { k:'transferencia', l:'Transferencia' },
  { k:'carta_credito', l:'Carta de Crédito' },
  { k:'anticipo',      l:'Anticipo 100%' },
  { k:'mixto',         l:'Mixto' },
];
const CANALES = [
  { k:'directo',      l:'Directo',      hint:'MWT vende directo al cliente final / corporativo.' },
  { k:'distribuidor', l:'Distribuidor', hint:'Cliente re-vende en su mercado. Manejo de límite y plazo ampliado.' },
];

export default function ClientFormDrawer({ lang='es', initial=null, onClose, onCreated }) {
  const isEdit = !!initial;
  const [form, setForm] = useState(initial || {
    cliente: '',
    codigo_marluvas: '',
    cedula_juridica: '',
    country_code: 'MX',
    direccion_entrega: '',
    contacto_nombre: '',
    email: '',
    phone: '',
    credito_dias: 60,
    credito_limit: 100000,
    medio_pago: 'transferencia',
    incoterm: 'CIF',
    canal: 'distribuidor',
    estado: 'ACTIVO',
  });

  const update = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const valid =
    form.cliente.trim().length >= 3 &&
    form.codigo_marluvas.trim().length >= 4 &&
    form.contacto_nombre.trim().length >= 3 &&
    /@/.test(form.email);

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
              {isEdit ? (lang==='es'?'EDITAR CLIENTE':'EDIT CLIENT')
                      : (lang==='es'?'CREAR CLIENTE':'CREATE CLIENT')}
            </div>
            <div className="heading-md">
              {isEdit ? (lang==='es'?'Actualizar cliente B2B':'Update B2B client')
                      : (lang==='es'?'Nuevo cliente B2B':'New B2B client')}
            </div>
            <div className="caption" style={{marginTop: 2}}>
              {lang==='es'
                ? 'Se guarda como ACTIVO en la tabla comercial (SAP Marluvas bidireccional).'
                : 'Saved as ACTIVE in the commercial table (bidirectional SAP sync).'}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose}><IconX size={14}/></button>
        </div>

        <form className="drawer-body" onSubmit={submit}>

          {/* ── Datos Base ─────────────── */}
          <section className="drawer-section">
            <div className="drawer-section-title">
              <IconShield size={12} style={{marginRight:6, verticalAlign:'-1px'}}/>
              {lang==='es'?'Datos base':'Core data'}
            </div>
            <div className="grid col-2 gap-3">
              <div style={{gridColumn:'1 / -1'}}>
                <label className="field-label">{lang==='es'?'Razón social (cliente)':'Legal name (client)'}</label>
                <input className="input" placeholder="Andes Retail Co. S.A.C."
                       value={form.cliente}
                       onChange={e=>update('cliente', e.target.value)}/>
              </div>
              <div>
                <label className="field-label">codigo_marluvas <span style={{color:'var(--text-tertiary)'}}>· SAP</span></label>
                <input className="input mono-sm" placeholder="4000000100"
                       value={form.codigo_marluvas}
                       onChange={e=>update('codigo_marluvas', e.target.value.trim().slice(0,12))}/>
                <div className="field-hint">{lang==='es'?'Identificador SAP (10 dígitos).':'SAP identifier (10 digits).'}</div>
              </div>
              <div>
                <label className="field-label">cedula_juridica</label>
                <input className="input mono-sm" placeholder="RUC / NIT / RFC / Tax ID"
                       value={form.cedula_juridica}
                       onChange={e=>update('cedula_juridica', e.target.value)}/>
              </div>
            </div>
          </section>

          {/* ── Ubicación ─────────────── */}
          <section className="drawer-section">
            <div className="drawer-section-title">
              <IconMapPin size={12} style={{marginRight:6, verticalAlign:'-1px'}}/>
              {lang==='es'?'Ubicación y entrega':'Location & delivery'}
            </div>
            <div className="grid col-2 gap-3">
              <div>
                <label className="field-label">{lang==='es'?'País':'Country'}</label>
                <div className="input" style={{display:'flex', alignItems:'center', gap:8, padding:'0 12px'}}>
                  <IconGlobe size={13} style={{color:'var(--text-tertiary)'}}/>
                  <select value={form.country_code} onChange={e=>update('country_code', e.target.value)}
                          style={{flex:1, border:0, background:'transparent', outline:'none', font:'inherit'}}>
                    {COUNTRIES.map(c => <option key={c.k} value={c.k}>{c.l}</option>)}
                  </select>
                </div>
              </div>
              <div style={{gridColumn:'1 / -1'}}>
                <label className="field-label">{lang==='es'?'Dirección de entrega':'Delivery address'}</label>
                <input className="input" placeholder="Av. Javier Prado 2450, San Isidro, Lima"
                       value={form.direccion_entrega}
                       onChange={e=>update('direccion_entrega', e.target.value)}/>
              </div>
            </div>
          </section>

          {/* ── Contacto ─────────────── */}
          <section className="drawer-section">
            <div className="drawer-section-title">
              <IconUser size={12} style={{marginRight:6, verticalAlign:'-1px'}}/>
              {lang==='es'?'Contacto principal':'Primary contact'}
            </div>
            <div className="grid col-2 gap-3">
              <div>
                <label className="field-label">{lang==='es'?'Nombre':'Name'}</label>
                <input className="input" placeholder="Luz Paredes"
                       value={form.contacto_nombre}
                       onChange={e=>update('contacto_nombre', e.target.value)}/>
              </div>
              <div>
                <label className="field-label">{lang==='es'?'Teléfono':'Phone'}</label>
                <input className="input mono-sm" placeholder="+51 1 234 5678"
                       value={form.phone}
                       onChange={e=>update('phone', e.target.value)}/>
              </div>
              <div style={{gridColumn:'1 / -1'}}>
                <label className="field-label">Email</label>
                <input className="input mono-sm" placeholder="lpa@andesretail.pe"
                       value={form.email}
                       onChange={e=>update('email', e.target.value)}/>
              </div>
            </div>
          </section>

          {/* ── Condiciones Comerciales ─────────────── */}
          <section className="drawer-section">
            <div className="drawer-section-title">
              <IconCreditCard size={12} style={{marginRight:6, verticalAlign:'-1px'}}/>
              {lang==='es'?'Condiciones comerciales':'Commercial terms'}
            </div>

            {/* Canal: visual picker */}
            <div className="type-picker" style={{marginBottom: 14}}>
              {CANALES.map(c => (
                <button key={c.k} type="button"
                        className="type-chip"
                        data-active={form.canal === c.k}
                        onClick={()=>update('canal', c.k)}>
                  <span className="type-chip-l">{c.l}</span>
                  <span className="type-chip-h">{c.hint}</span>
                </button>
              ))}
            </div>

            <div className="grid col-2 gap-3">
              <div>
                <label className="field-label">credito_dias</label>
                <input className="input mono-sm" type="number" min="0" max="180"
                       value={form.credito_dias}
                       onChange={e=>update('credito_dias', Math.max(0, Math.min(180, Number(e.target.value)||0)))}/>
                <div className="field-hint">{lang==='es'?'Plazo default (0–180 días).':'Default term (0–180 days).'}</div>
              </div>
              <div>
                <label className="field-label">credito_limit (USD)</label>
                <input className="input mono-sm" type="number" min="0" step="1000"
                       value={form.credito_limit}
                       onChange={e=>update('credito_limit', Math.max(0, Number(e.target.value)||0))}/>
              </div>
              <div>
                <label className="field-label">medio_pago</label>
                <select className="select" value={form.medio_pago}
                        onChange={e=>update('medio_pago', e.target.value)}>
                  {MEDIOS_PAGO.map(m => <option key={m.k} value={m.k}>{m.l}</option>)}
                </select>
              </div>
              <div>
                <label className="field-label">incoterm</label>
                <select className="select" value={form.incoterm}
                        onChange={e=>update('incoterm', e.target.value)}>
                  {INCOTERMS.map(i => <option key={i} value={i}>{i}</option>)}
                </select>
              </div>
            </div>
          </section>

          {/* ── Estado ─────────────── */}
          <section className="drawer-section">
            <div className="drawer-section-title">{lang==='es'?'Estado':'Status'}</div>
            <div className="seg" style={{width:'100%'}}>
              <button type="button" data-active={form.estado==='ACTIVO'}    onClick={()=>update('estado','ACTIVO')}>ACTIVO</button>
              <button type="button" data-active={form.estado==='PAUSADO'}   onClick={()=>update('estado','PAUSADO')}>PAUSADO</button>
              <button type="button" data-active={form.estado==='BLOQUEADO'} onClick={()=>update('estado','BLOQUEADO')}>BLOQUEADO</button>
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
                    : (lang==='es'?'Crear cliente':'Create client')}
          </button>
        </div>
      </motion.aside>
    </>
  );
}
