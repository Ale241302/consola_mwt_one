// ─────────────────────────────────────────────────────────────
// SupplierFormView — Vista dedicada de alta de proveedor
// Agente responsable: [AG-FRONTEND]
//
// Secciones (single-page scroll con stagger):
//   A. Datos Generales            proveedor_id · nombre_comercial · razon_social · país
//   B. Clasificación Operativa    producto_servicio · clase (CRÍTICO/IMPORTANTE/ESTÁNDAR)
//   C. Contacto y Tiempos         contacto_principal · email · tel · lead_time_estimado
//   D. Compliance Inicial         CE · RoHS · FCC · ISO 9001 (checkboxes)
//
// No se persiste — demo. Botón "Guardar" lleva al dashboard.
// ─────────────────────────────────────────────────────────────
import React, { useState, useMemo } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { motion } from "framer-motion";
import {
  IconChevLeft, IconCheck, IconShield, IconTruck, IconUser, IconGlobe,
} from "../lib/icons.jsx";
import { SUPPLIERS } from "../data/mockData.js";
import { proveedoresApi } from "../lib/api.js";

const CLASE_OPTIONS = [
  { value:'CRITICO',    label:'CRÍTICO',    desc:'Fabricante OEM de SKU vendible',         color:'#DC2626' },
  { value:'IMPORTANTE', label:'IMPORTANTE', desc:'Componentes o servicios relevantes',     color:'#3083FE' },
  { value:'ESTANDAR',   label:'ESTÁNDAR',   desc:'Suministros operativos o servicios low-risk', color:'#64748B' },
];

const CERT_OPTIONS = [
  { id:'ISO 9001', label:'ISO 9001', desc:'Sistema de gestión de calidad' },
  { id:'CE',       label:'CE',       desc:'Conformidad europea' },
  { id:'RoHS',     label:'RoHS',     desc:'Restricción de sustancias peligrosas' },
  { id:'FCC',      label:'FCC',      desc:'Federal Communications Commission (US)' },
];

const PAISES = [
  { code:'BR', label:'Brasil',   flag:'🇧🇷' },
  { code:'CN', label:'China',    flag:'🇨🇳' },
  { code:'PE', label:'Perú',     flag:'🇵🇪' },
  { code:'MX', label:'México',   flag:'🇲🇽' },
  { code:'CO', label:'Colombia', flag:'🇨🇴' },
  { code:'AR', label:'Argentina',flag:'🇦🇷' },
  { code:'CL', label:'Chile',    flag:'🇨🇱' },
  { code:'US', label:'Estados Unidos', flag:'🇺🇸' },
  { code:'CY', label:'Chipre',   flag:'🇨🇾' },
];

export default function ScreenSupplierFormView() {
  const navigate = useNavigate();
  const { lang } = useOutletContext();

  // Sugerir siguiente ID disponible
  const suggestedId = useMemo(() => {
    const nums = SUPPLIERS.map(s => parseInt(s.id.split('-')[1], 10)).filter(Boolean);
    const next = (nums.length ? Math.max(...nums) : 0) + 1;
    return `SUP-${String(next).padStart(3, '0')}`;
  }, []);

  const [form, setForm] = useState({
    id: suggestedId,
    nombre_comercial: '',
    razon_social: '',
    country_code: 'BR',
    producto_servicio: '',
    clase: 'IMPORTANTE',
    contacto_nombre: '',
    contacto_email: '',
    contacto_tel: '',
    lead_time_estimado: '',
    certs: [],
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const toggleCert = (id) => setForm(f => ({
    ...f,
    certs: f.certs.includes(id) ? f.certs.filter(x => x!==id) : [...f.certs, id]
  }));

  const paisActual = PAISES.find(p => p.code === form.country_code);

  // Por decisión de producto: ningún campo es obligatorio. El botón
  // siempre está activo; el backend decide si alguno es required.
  const canSave = true;

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    // ── Mapeo FE shape → backend shape ──
    // Ajustes de naming detectados en investigación:
    //   country_code        → pais_iso2
    //   lead_time_estimado  → lead_time_dias (number)
    //   certs[]             → certificaciones (JSON)
    //   id (SUP-001)        → DESCARTADO (backend genera UUID con s.save(id=...))
    const body = {
      nombre_comercial:  form.nombre_comercial || null,
      razon_social:      form.razon_social || form.nombre_comercial || null,
      pais_iso2:         form.country_code || null,
      producto_servicio: form.producto_servicio || null,
      clase:             form.clase || null,
      contacto_nombre:   form.contacto_nombre || null,
      contacto_email:    form.contacto_email || null,
      contacto_tel:      form.contacto_tel || null,
      lead_time_dias:    form.lead_time_estimado ? Number(form.lead_time_estimado) : 0,
      certificaciones:   form.certs || [],
    };
    try {
      await proveedoresApi.create(body);
      navigate('/proveedores');
    } catch (e) {
      let msg = String(e?.message || e);
      try {
        const parsed = JSON.parse(msg);
        if (parsed && typeof parsed === 'object') {
          msg = Object.entries(parsed)
            .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
            .join('  ·  ');
        }
      } catch (_) {}
      setSaveError(msg);
      alert((lang==='es' ? 'No se pudo crear el proveedor: ' : 'Could not create supplier: ') + msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page page-form">
      {/* Header */}
      <div className="page-header">
        <div>
          <button className="btn btn-ghost" style={{marginBottom:8}} onClick={()=>navigate('/proveedores')}>
            <IconChevLeft size={14}/> {lang==='es'?'Volver a proveedores':'Back to suppliers'}
          </button>
          <div className="micro" style={{marginBottom:6}}>
            {lang==='es'?'ALTA DE PROVEEDOR':'NEW SUPPLIER'}
          </div>
          <h1 className="page-title">{lang==='es'?'Nuevo Proveedor':'New Supplier'}</h1>
          <div className="page-subtitle">
            {lang==='es'
              ? 'Registra un proveedor con clasificación ISO 9001, clase operativa y certificaciones iniciales.'
              : 'Onboard a supplier with ISO 9001 classification, operational class and initial certifications.'}
          </div>
        </div>
        <div className="flex ai-center gap-2">
          <button className="btn" onClick={()=>navigate('/proveedores')}>
            {lang==='es'?'Cancelar':'Cancel'}
          </button>
          <button className="btn btn-accent" onClick={handleSave} disabled={!canSave}>
            <IconCheck size={14}/> {lang==='es'?'Crear proveedor':'Create supplier'}
          </button>
        </div>
      </div>

      <div className="form-stack">
        {/* ─── A. Datos Generales ─── */}
        <motion.section
          className="form-card"
          initial={{ opacity:0, y:10 }}
          animate={{ opacity:1, y:0, transition:{ duration:0.28 } }}
        >
          <div className="form-card-head">
            <IconGlobe size={16} style={{color:'var(--brand-accent)'}}/>
            <div>
              <div className="heading-md">{lang==='es'?'A. Datos Generales':'A. General Data'}</div>
              <div className="caption" style={{color:'var(--text-tertiary)'}}>
                {lang==='es'?'Identificación legal y fiscal':'Legal & fiscal identification'}
              </div>
            </div>
          </div>

          <div className="form-grid-2">
            <div className="form-field">
              <label>{lang==='es'?'ID del proveedor':'Supplier ID'}</label>
              <input className="input mono-sm" value={form.id}
                     onChange={e=>set('id', e.target.value)} />
              <div className="caption" style={{color:'var(--text-tertiary)'}}>
                {lang==='es'?'Sugerido por el sistema · editable':'System-suggested · editable'}
              </div>
            </div>
            <div className="form-field">
              <label>{lang==='es'?'Nombre comercial':'Commercial name'} <span style={{color:'var(--critical)'}}>*</span></label>
              <input className="input" value={form.nombre_comercial}
                     onChange={e=>set('nombre_comercial', e.target.value)}
                     placeholder={lang==='es'?'Ej. Marluvas':'e.g. Marluvas'}/>
            </div>
          </div>

          <div className="form-grid-2">
            <div className="form-field">
              <label>{lang==='es'?'Razón social':'Legal name'} <span style={{color:'var(--critical)'}}>*</span></label>
              <input className="input" value={form.razon_social}
                     onChange={e=>set('razon_social', e.target.value)}
                     placeholder={lang==='es'?'Ej. Marluvas Calçados de Segurança Ltda.':'e.g. Marluvas Calçados de Segurança Ltda.'}/>
            </div>
            <div className="form-field">
              <label>{lang==='es'?'País':'Country'}</label>
              <div className="country-picker">
                {PAISES.map(p => (
                  <button key={p.code}
                          className={`country-chip ${form.country_code===p.code?'is-on':''}`}
                          onClick={()=>set('country_code', p.code)}>
                    <span>{p.flag}</span><span>{p.label}</span>
                  </button>
                ))}
              </div>
              <div className="caption" style={{color:'var(--text-tertiary)'}}>
                {lang==='es'?'Seleccionado':'Selected'}: {paisActual?.flag} {paisActual?.label}
              </div>
            </div>
          </div>
        </motion.section>

        {/* ─── B. Clasificación Operativa ─── */}
        <motion.section
          className="form-card"
          initial={{ opacity:0, y:10 }}
          animate={{ opacity:1, y:0, transition:{ delay:0.06, duration:0.28 } }}
        >
          <div className="form-card-head">
            <IconShield size={16} style={{color:'var(--brand-accent)'}}/>
            <div>
              <div className="heading-md">{lang==='es'?'B. Clasificación Operativa':'B. Operational Class'}</div>
              <div className="caption" style={{color:'var(--text-tertiary)'}}>
                {lang==='es'
                  ? 'Define la criticidad y nivel de escrutinio ISO 9001'
                  : 'Defines criticality and ISO 9001 scrutiny tier'}
              </div>
            </div>
          </div>

          <div className="form-field">
            <label>{lang==='es'?'Producto / Servicio':'Product / Service'} <span style={{color:'var(--critical)'}}>*</span></label>
            <input className="input" value={form.producto_servicio}
                   onChange={e=>set('producto_servicio', e.target.value)}
                   placeholder={lang==='es'?'Ej. Calzado de seguridad OEM':'e.g. OEM Safety footwear'}/>
          </div>

          <div className="form-field">
            <label>{lang==='es'?'Clase':'Class'}</label>
            <div className="clase-picker">
              {CLASE_OPTIONS.map(c => (
                <button key={c.value}
                        className={`clase-card ${form.clase===c.value?'is-on':''}`}
                        style={{'--clase-color': c.color}}
                        onClick={()=>set('clase', c.value)}>
                  <div className="clase-card-head">
                    <span className="clase-dot"/>
                    <span className="heading-sm">{c.label}</span>
                  </div>
                  <div className="caption">{c.desc}</div>
                </button>
              ))}
            </div>
          </div>
        </motion.section>

        {/* ─── C. Contacto y Tiempos ─── */}
        <motion.section
          className="form-card"
          initial={{ opacity:0, y:10 }}
          animate={{ opacity:1, y:0, transition:{ delay:0.12, duration:0.28 } }}
        >
          <div className="form-card-head">
            <IconUser size={16} style={{color:'var(--brand-accent)'}}/>
            <div>
              <div className="heading-md">{lang==='es'?'C. Contacto y Tiempos':'C. Contact & Lead time'}</div>
              <div className="caption" style={{color:'var(--text-tertiary)'}}>
                {lang==='es'?'Contacto operativo principal':'Primary operational contact'}
              </div>
            </div>
          </div>

          <div className="form-grid-3">
            <div className="form-field">
              <label>{lang==='es'?'Contacto principal':'Primary contact'}</label>
              <input className="input" value={form.contacto_nombre}
                     onChange={e=>set('contacto_nombre', e.target.value)}
                     placeholder={lang==='es'?'Nombre completo':'Full name'}/>
            </div>
            <div className="form-field">
              <label>{lang==='es'?'Email':'Email'} <span style={{color:'var(--critical)'}}>*</span></label>
              <input className="input" type="email" value={form.contacto_email}
                     onChange={e=>set('contacto_email', e.target.value)}
                     placeholder="contacto@proveedor.com"/>
            </div>
            <div className="form-field">
              <label>{lang==='es'?'Teléfono':'Phone'}</label>
              <input className="input" value={form.contacto_tel}
                     onChange={e=>set('contacto_tel', e.target.value)}
                     placeholder="+XX XX XXXX XXXX"/>
            </div>
          </div>

          <div className="form-field">
            <label>
              <IconTruck size={12} style={{verticalAlign:'-1px', marginRight:4}}/>
              {lang==='es'?'Lead time estimado (días)':'Estimated lead time (days)'}
            </label>
            <input className="input" type="number" min="0" max="180"
                   style={{maxWidth:160}}
                   value={form.lead_time_estimado}
                   onChange={e=>set('lead_time_estimado', e.target.value)}
                   placeholder="45"/>
            <div className="caption" style={{color:'var(--text-tertiary)'}}>
              {lang==='es'
                ? 'Promesa contractual del proveedor. Se audita contra tiempo real trimestralmente.'
                : 'Supplier contractual promise. Audited against actual quarterly.'}
            </div>
          </div>
        </motion.section>

        {/* ─── D. Compliance Inicial ─── */}
        <motion.section
          className="form-card"
          initial={{ opacity:0, y:10 }}
          animate={{ opacity:1, y:0, transition:{ delay:0.18, duration:0.28 } }}
        >
          <div className="form-card-head">
            <IconCheck size={16} style={{color:'var(--brand-accent)'}}/>
            <div>
              <div className="heading-md">{lang==='es'?'D. Compliance Inicial':'D. Initial Compliance'}</div>
              <div className="caption" style={{color:'var(--text-tertiary)'}}>
                {lang==='es'
                  ? 'Certificaciones vigentes declaradas (se verifican en onboarding)'
                  : 'Declared active certifications (verified at onboarding)'}
              </div>
            </div>
          </div>

          <div className="certs-grid">
            {CERT_OPTIONS.map(c => {
              const on = form.certs.includes(c.id);
              return (
                <button key={c.id}
                        className={`cert-card ${on?'is-on':''}`}
                        onClick={()=>toggleCert(c.id)}>
                  <div className="cert-card-check">
                    {on ? <IconCheck size={14}/> : null}
                  </div>
                  <div className="cert-card-body">
                    <div className="heading-sm">{c.label}</div>
                    <div className="caption">{c.desc}</div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="caption" style={{color:'var(--text-tertiary)', marginTop:12}}>
            {lang==='es'
              ? '⚠ Certificaciones declaradas son validadas por el equipo de calidad en un plazo de 30 días. Documentos de soporte se suben en el detalle del proveedor.'
              : '⚠ Declared certifications are validated by the quality team within 30 days. Support documents uploaded in supplier detail.'}
          </div>
        </motion.section>
      </div>
    </div>
  );
}
