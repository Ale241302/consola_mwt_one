// ─────────────────────────────────────────────────────────────
// SizeFormDrawer — Alta / edición de talla en el Motor de Tallas
// Agente responsable: [AG-FRONTEND]
//
// Drawer lateral con:
//   · Sistema de medida (select)
//   · Valor de talla (texto libre)
//   · Especificaciones dimensionales (4 campos numéricos)
//   · Editor de equivalencias cross-system
// ─────────────────────────────────────────────────────────────
import React, { useState } from "react";
import { motion } from "framer-motion";
import { IconX, IconPlus, IconCheck, IconSliders } from "../../lib/icons.jsx";
import { SIZE_SYSTEMS } from "../../data/mockData.js";

export default function SizeFormDrawer({ lang='es', onClose, onCreated }) {
  const [system, setSystem] = useState('EU');
  const [valor, setValor] = useState('');
  const [forefoot, setForefoot] = useState('');
  const [heel, setHeel] = useState('');
  const [drop, setDrop] = useState('');
  const [weight, setWeight] = useState('');
  const [equivs, setEquivs] = useState([{ system:'US_MEN', value:'' }]);

  const canSave = valor.trim() && forefoot && heel;

  const addEquiv = () => setEquivs([...equivs, { system:'US_MEN', value:'' }]);
  const removeEquiv = (idx) => setEquivs(equivs.filter((_, i) => i !== idx));
  const updateEquiv = (idx, field, val) => {
    setEquivs(equivs.map((e, i) => i === idx ? { ...e, [field]: val } : e));
  };

  const handleSave = () => {
    if (!canSave) return;
    const payload = {
      system,
      valor_talla: valor.trim(),
      dimensional_specs: {
        forefoot_mm: Number(forefoot) || 0,
        heel_mm:     Number(heel) || 0,
        drop_mm:     Number(drop) || 0,
        weight_g:    Number(weight) || 0,
      },
      equivalences: equivs.filter(e => e.value.trim()),
    };
    onCreated?.(payload);
  };

  return (
    <>
      <motion.div
        className="modal-backdrop"
        initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
        onClick={onClose}
      />
      <motion.aside
        className="drawer-panel"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type:'spring', stiffness:260, damping:30 }}
      >
        <div className="drawer-head">
          <div>
            <div className="micro">{lang==='es'?'MOTOR DE TALLAS':'SIZING ENGINE'}</div>
            <div className="heading-md">{lang==='es'?'Nueva talla':'New size'}</div>
          </div>
          <button className="btn btn-sm" onClick={onClose} aria-label="Close"><IconX size={14}/></button>
        </div>

        <div className="drawer-body">
          {/* Sección A — sistema y valor */}
          <div className="drawer-section">
            <div className="drawer-section-title">
              <IconSliders size={13}/> {lang==='es'?'Sistema y valor':'System & value'}
            </div>
            <div className="form-grid-2">
              <label className="form-field">
                <span>{lang==='es'?'Sistema de medida':'Measurement system'}</span>
                <select className="input" value={system} onChange={e=>setSystem(e.target.value)}>
                  {SIZE_SYSTEMS.map(s => (
                    <option key={s.id} value={s.id}>{s.label} · {s.desc}</option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>{lang==='es'?'Valor de talla':'Size value'}</span>
                <input className="input" value={valor} onChange={e=>setValor(e.target.value)}
                       placeholder={lang==='es'?'ej. 42, 9.5, 26.0':'e.g. 42, 9.5, 26.0'}/>
              </label>
            </div>
          </div>

          {/* Sección B — specs dimensionales */}
          <div className="drawer-section">
            <div className="drawer-section-title">
              {lang==='es'?'Especificaciones dimensionales':'Dimensional specs'}
            </div>
            <div className="form-grid-2">
              <label className="form-field">
                <span>{lang==='es'?'Grosor antepié (mm)':'Forefoot thickness (mm)'}</span>
                <input className="input" type="number" value={forefoot} onChange={e=>setForefoot(e.target.value)}/>
              </label>
              <label className="form-field">
                <span>{lang==='es'?'Grosor talón (mm)':'Heel thickness (mm)'}</span>
                <input className="input" type="number" value={heel} onChange={e=>setHeel(e.target.value)}/>
              </label>
              <label className="form-field">
                <span>Drop (mm)</span>
                <input className="input" type="number" value={drop} onChange={e=>setDrop(e.target.value)}/>
              </label>
              <label className="form-field">
                <span>{lang==='es'?'Peso referencial (g)':'Reference weight (g)'}</span>
                <input className="input" type="number" value={weight} onChange={e=>setWeight(e.target.value)}/>
              </label>
            </div>
          </div>

          {/* Sección C — equivalencias */}
          <div className="drawer-section">
            <div className="drawer-section-title">
              {lang==='es'?'Equivalencias cross-system':'Cross-system equivalences'}
            </div>
            <div className="equiv-editor">
              {equivs.map((eq, idx) => (
                <div key={idx} className="equiv-editor-row">
                  <select className="input" value={eq.system} onChange={e=>updateEquiv(idx, 'system', e.target.value)}>
                    {SIZE_SYSTEMS.filter(s => s.id !== system).map(s => (
                      <option key={s.id} value={s.id}>{s.label}</option>
                    ))}
                  </select>
                  <input className="input" value={eq.value} onChange={e=>updateEquiv(idx, 'value', e.target.value)}
                         placeholder={lang==='es'?'Valor equivalente':'Equivalent value'}/>
                  <button className="btn btn-sm btn-danger-soft" onClick={()=>removeEquiv(idx)} aria-label="Remove">
                    <IconX size={11}/>
                  </button>
                </div>
              ))}
              <button className="btn btn-sm btn-ghost" onClick={addEquiv}>
                <IconPlus size={12}/> {lang==='es'?'Añadir equivalencia':'Add equivalence'}
              </button>
            </div>
          </div>
        </div>

        <div className="drawer-foot">
          <button className="btn" onClick={onClose}>{lang==='es'?'Cancelar':'Cancel'}</button>
          <button className="btn btn-accent" disabled={!canSave} onClick={handleSave}>
            <IconCheck size={13}/> {lang==='es'?'Guardar talla':'Save size'}
          </button>
        </div>
      </motion.aside>
    </>
  );
}
