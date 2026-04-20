// ─────────────────────────────────────────────────────────────
// CreateTransferDrawer — motor inter-nodos
// Agente responsable: [AG-FRONTEND]
//
// Drawer lateral ancho · 3 pasos:
//   PASO 1 · Contexto        origen · destino · legal_context · ref_tracking
//   PASO 2 · Productos       líneas dinámicas (SKUs con stock en origen)
//                            por línea: stock_disponible_origen (ro) · cantidad_transferir · cantidad_reservar
//   PASO 3 · Validación      totales + advertencia de stock de seguridad del origen
//
// Al elegir nodo_origen, el selector de SKUs se filtra a los SKUs con
// stock disponible en ese nodo.
// ─────────────────────────────────────────────────────────────
import React, { useState, useMemo, useEffect } from "react";
import { motion } from "framer-motion";
import {
  IconX, IconSwap, IconCheck, IconAlert, IconPlus, IconPackage,
  IconTruck, IconArrow, IconChevLeft, IconChevRight, IconFileText,
} from "../../lib/icons.jsx";
import { INVENTORY, NODES } from "../../data/mockData.js";
import { transferenciasApi, transferLineasApi } from "../../lib/api.js";

// Contexto legal — política estricta ENT_OPS_TRANSFERS
const LEGAL_CONTEXT = [
  { value:'internal',       label:'Interno / Redistribución', desc:'Movimiento intra-entidad, sin fiscalía',  color:'#64748B' },
  { value:'nationalization',label:'Nacionalización',           desc:'Ingreso fiscal · DUA / despacho aduanero', color:'#481EE3' },
  { value:'reexport',       label:'Reexportación',             desc:'Salida internacional bajo régimen',        color:'#3083FE' },
  { value:'distribution',   label:'Distribución',              desc:'Envío a distribuidor / marketplace',       color:'#00B286' },
  { value:'consignment',    label:'Consignación',              desc:'Propiedad retenida · reporte semanal',     color:'#B45309' },
];

// Stock de seguridad (mínimo recomendado por nodo)
const STOCK_SEGURIDAD_DIAS = 14;

export default function CreateTransferDrawer({ lang='es', onClose, onSaved }) {
  const [step, setStep]         = useState(1);
  const [saving, setSaving]     = useState(false);
  const [saveError, setSaveErr] = useState(null);

  const [form, setForm] = useState({
    nodo_origen:      '',
    nodo_destino:     '',
    legal_context:    'internal',
    ref_tracking:     '',
    lines:            [], // { key, sku, product, lot, stock_available, qty_transfer, qty_reserve }
  });

  // Bloquea el scroll del body mientras el drawer está abierto
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // ── Inventario disponible en nodo_origen ────────
  const availableRows = useMemo(() => {
    if (!form.nodo_origen) return [];
    return INVENTORY
      .filter(i => i.node === form.nodo_origen && (i.qty - i.reserved) > 0)
      .sort((a,b) => a.sku.localeCompare(b.sku));
  }, [form.nodo_origen]);

  // Si cambia el origen, limpiamos las líneas (estaban basadas en otro nodo)
  useEffect(() => {
    setForm(f => ({ ...f, lines: [] }));
  }, [form.nodo_origen]);

  // ── Helpers de líneas ────────
  const addLine = (invRow) => {
    const key = `${invRow.sku}-${invRow.lot}-${Date.now()}`;
    const line = {
      key,
      sku: invRow.sku,
      product: invRow.product,
      lot: invRow.lot,
      stock_available: invRow.qty - invRow.reserved,
      qty_transfer: 0,
      qty_reserve: 0,
    };
    setForm(f => ({ ...f, lines: [...f.lines, line] }));
  };
  const removeLine = (key) => {
    setForm(f => ({ ...f, lines: f.lines.filter(l => l.key !== key) }));
  };
  const updateLine = (key, patch) => {
    setForm(f => ({
      ...f,
      lines: f.lines.map(l => l.key === key ? { ...l, ...patch } : l),
    }));
  };

  const usedLotKeys = new Set(form.lines.map(l => `${l.sku}-${l.lot}`));

  // ── Totales ────────
  const totals = useMemo(() => {
    const totalTransfer = form.lines.reduce((a,l) => a + (Number(l.qty_transfer) || 0), 0);
    const totalReserve  = form.lines.reduce((a,l) => a + (Number(l.qty_reserve)  || 0), 0);
    const totalFree     = totalTransfer - totalReserve;

    // Validaciones
    const overflows = form.lines.filter(l => Number(l.qty_transfer) > l.stock_available);
    const reserveOverflows = form.lines.filter(l => Number(l.qty_reserve) > Number(l.qty_transfer));

    // Stock de seguridad: calcular cuánto quedaría en origen tras la transferencia
    // (comparado contra stock_seguridad mínimo estimado — demo)
    const postOriginStock = availableRows.reduce((a,r) => a + (r.qty - r.reserved), 0) - totalTransfer;
    const breachesSafety  = totalTransfer > 0 && postOriginStock < STOCK_SEGURIDAD_DIAS;

    return { totalTransfer, totalReserve, totalFree, overflows, reserveOverflows, postOriginStock, breachesSafety };
  }, [form.lines, availableRows]);

  const canStep1 = form.nodo_origen && form.nodo_destino && form.nodo_origen !== form.nodo_destino && form.legal_context;
  const canStep2 = form.lines.length > 0 && totals.totalTransfer > 0 && totals.overflows.length === 0 && totals.reserveOverflows.length === 0;
  const canSave  = canStep1 && canStep2;

  const go = (n) => {
    if (n < step) setStep(n);
    else if (n === 2 && canStep1) setStep(2);
    else if (n === 3 && canStep2) setStep(3);
  };

  // ── Mapeo FE legal_context → backend LegalContextCat (UPPERCASE) ──
  const LEGAL_CONTEXT_TO_API = {
    internal:       'INTERNAL',
    nationalization:'NATIONALIZATION',
    reexport:       'REEXPORT',
    distribution:   'DISTRIBUTION',
    consignment:    'CONSIGNMENT',
  };

  const handleSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    setSaveErr(null);
    try {
      // Valor estimado ≈ unidades * 1 USD (placeholder hasta que tengamos costing)
      const estimated = totals.totalTransfer * 1;
      const body = {
        codigo:         `TRF-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}`,
        origen_label:   form.nodo_origen,
        destino_label:  form.nodo_destino,
        legal_context:  LEGAL_CONTEXT_TO_API[form.legal_context] || 'INTERNAL',
        estado:         'PLANNED',
        ref_tracking:   form.ref_tracking || '',
        needs_approval: form.legal_context !== 'internal',
        value_usd:      estimated,
        is_active:      true,
      };
      const created = await transferenciasApi.create(body);
      const transferId = created?.id;

      // Crear líneas en serie (en paralelo podría saturar el ratelimit del API)
      if (transferId) {
        for (const l of form.lines) {
          try {
            await transferLineasApi.create({
              transferencia_id: transferId,
              sku:              l.sku,
              product_label:    l.product,
              lot:              l.lot,
              qty_transfer:     Number(l.qty_transfer) || 0,
              qty_reserve:      Number(l.qty_reserve)  || 0,
              is_active:        true,
            });
          } catch (e) {
            // No abortar: loguear y continuar con el resto de líneas
            console.warn("No se pudo crear línea", l.sku, e);
          }
        }
      }

      onSaved?.(created);
      onClose?.();
    } catch (e) {
      console.error("Error al crear transferencia:", e);
      setSaveErr(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const activeNodes = NODES.filter(n => n.status === 'ACTIVE');
  const legalMeta = LEGAL_CONTEXT.find(c => c.value === form.legal_context);

  return (
    <>
      {/* Overlay */}
      <motion.div
        className="drawer-overlay"
        initial={{ opacity:0 }}
        animate={{ opacity:1, transition:{ duration:0.2 } }}
        exit={{ opacity:0, transition:{ duration:0.15 } }}
        onClick={onClose}
      />

      {/* Drawer */}
      <motion.aside
        className="transfer-drawer"
        initial={{ x:'100%' }}
        animate={{ x:0, transition:{ type:'spring', stiffness:260, damping:30 } }}
        exit={{ x:'100%', transition:{ duration:0.2 } }}
      >
        <div className="transfer-drawer-head">
          <div>
            <div className="micro" style={{marginBottom:4}}>
              {lang==='es'?'MOTOR DE TRANSFERENCIAS':'TRANSFER ENGINE'}
            </div>
            <div className="heading-md">
              {lang==='es'?'Nueva transferencia inter-nodos':'New inter-node transfer'}
            </div>
          </div>
          <button className="btn-icon-xs" onClick={onClose} aria-label="Close">
            <IconX size={14}/>
          </button>
        </div>

        {/* Stepper */}
        <div className="transfer-stepper">
          {[1,2,3].map(n => (
            <button key={n}
                    className={`transfer-step ${step===n?'is-active':''} ${step>n?'is-done':''}`}
                    onClick={()=>go(n)}>
              <span className="step-dot tabular-nums">
                {step > n ? <IconCheck size={10}/> : n}
              </span>
              <span className="step-lbl">
                {n===1 ? (lang==='es'?'Contexto':'Context')
                 : n===2 ? (lang==='es'?'Productos':'Products')
                 : (lang==='es'?'Validación':'Review')}
              </span>
            </button>
          ))}
        </div>

        <div className="transfer-body">
          {/* ─── PASO 1 ─── */}
          {step === 1 && (
            <motion.div
              initial={{ opacity:0, y:6 }}
              animate={{ opacity:1, y:0, transition:{ duration:0.25 } }}
              className="transfer-step-body"
            >
              <div className="transfer-section-title">
                {lang==='es'?'Paso 1 · Contexto de la transferencia':'Step 1 · Transfer context'}
              </div>

              <div className="form-grid-2">
                <div className="form-field">
                  <label>{lang==='es'?'Nodo origen':'Origin node'} <span style={{color:'var(--critical)'}}>*</span></label>
                  <select className="select" value={form.nodo_origen}
                          onChange={e=>set('nodo_origen', e.target.value)}>
                    <option value="">— {lang==='es'?'Selecciona origen':'Select origin'} —</option>
                    {activeNodes.map(n => (
                      <option key={n.node_id} value={n.name}>{n.flag} {n.name} · {n.location}</option>
                    ))}
                  </select>
                </div>
                <div className="form-field">
                  <label>{lang==='es'?'Nodo destino':'Destination node'} <span style={{color:'var(--critical)'}}>*</span></label>
                  <select className="select" value={form.nodo_destino}
                          onChange={e=>set('nodo_destino', e.target.value)}>
                    <option value="">— {lang==='es'?'Selecciona destino':'Select destination'} —</option>
                    {activeNodes
                      .filter(n => n.name !== form.nodo_origen)
                      .map(n => (
                        <option key={n.node_id} value={n.name}>{n.flag} {n.name} · {n.location}</option>
                    ))}
                  </select>
                </div>
              </div>

              {form.nodo_origen && form.nodo_destino && (
                <motion.div
                  className="transfer-path"
                  initial={{ opacity:0 }}
                  animate={{ opacity:1 }}
                >
                  <span className="transfer-path-node">{form.nodo_origen}</span>
                  <IconArrow size={16} style={{color:'var(--brand-accent)'}}/>
                  <span className="transfer-path-node">{form.nodo_destino}</span>
                </motion.div>
              )}

              <div className="form-field">
                <label>{lang==='es'?'Motivo / Contexto legal':'Legal context / Reason'} <span style={{color:'var(--critical)'}}>*</span></label>
                <div className="legal-picker">
                  {LEGAL_CONTEXT.map(c => (
                    <button key={c.value}
                            className={`legal-card ${form.legal_context===c.value?'is-on':''}`}
                            style={{'--legal-color': c.color}}
                            onClick={()=>set('legal_context', c.value)}>
                      <div className="legal-card-head">
                        <span className="legal-dot"/>
                        <span className="heading-sm">{c.label}</span>
                      </div>
                      <div className="caption">{c.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-field">
                <label>
                  <IconFileText size={12} style={{verticalAlign:'-1px', marginRight:4}}/>
                  {lang==='es'?'Referencia de tracking (opcional)':'Tracking reference (optional)'}
                </label>
                <input className="input mono-sm" value={form.ref_tracking}
                       onChange={e=>set('ref_tracking', e.target.value)}
                       placeholder={lang==='es'?'BL / AWB / TRK — si aplica':'BL / AWB / TRK — if applicable'}/>
                <div className="caption" style={{color:'var(--text-tertiary)'}}>
                  {lang==='es'
                    ? 'Bill of Lading, Air Waybill o número de tracking del courier'
                    : 'Bill of Lading, Air Waybill or courier tracking number'}
                </div>
              </div>
            </motion.div>
          )}

          {/* ─── PASO 2 ─── */}
          {step === 2 && (
            <motion.div
              initial={{ opacity:0, y:6 }}
              animate={{ opacity:1, y:0, transition:{ duration:0.25 } }}
              className="transfer-step-body"
            >
              <div className="transfer-section-title">
                {lang==='es'?'Paso 2 · Productos y cantidades':'Step 2 · Products & quantities'}
              </div>

              {/* SKU picker */}
              <div className="card card-pad-sm transfer-sku-picker">
                <div className="caption" style={{color:'var(--text-tertiary)', marginBottom:8}}>
                  {lang==='es'
                    ? `SKUs con stock disponible en ${form.nodo_origen}`
                    : `SKUs with available stock at ${form.nodo_origen}`}
                </div>
                {availableRows.length === 0 ? (
                  <div className="empty-state" style={{padding:'16px 8px'}}>
                    <IconAlert size={18} style={{color:'var(--warning)'}}/>
                    <div className="caption">
                      {lang==='es'?'No hay stock disponible en este nodo':'No available stock at this node'}
                    </div>
                  </div>
                ) : (
                  <div className="transfer-sku-grid">
                    {availableRows.map(inv => {
                      const usedKey = `${inv.sku}-${inv.lot}`;
                      const used = usedLotKeys.has(usedKey);
                      return (
                        <button key={`${inv.sku}-${inv.lot}`}
                                className={`transfer-sku-chip ${used?'is-used':''}`}
                                disabled={used}
                                onClick={()=>addLine(inv)}>
                          <span className="mono-sm" style={{fontWeight:600}}>{inv.sku}</span>
                          <span className="caption" style={{color:'var(--text-tertiary)'}}>
                            · {inv.lot}
                          </span>
                          <span className="tabular-nums caption" style={{color:'var(--success)'}}>
                            {(inv.qty - inv.reserved).toLocaleString()}u
                          </span>
                          {used
                            ? <IconCheck size={11} style={{color:'var(--success)'}}/>
                            : <IconPlus size={11}/>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Líneas agregadas */}
              <div className="transfer-lines-wrap" style={{marginTop:12}}>
                <div className="transfer-section-title-sm">
                  {lang==='es'?'Líneas de la transferencia':'Transfer lines'}
                  {form.lines.length > 0 && (
                    <span className="caption tabular-nums" style={{marginLeft:8, color:'var(--text-tertiary)'}}>
                      {form.lines.length} {lang==='es'?'líneas':'lines'}
                    </span>
                  )}
                </div>

                {form.lines.length === 0 ? (
                  <div className="empty-state" style={{padding:'20px 12px', background:'var(--surface-alt, #F5F7FA)', borderRadius:8}}>
                    <IconPackage size={20} style={{color:'var(--text-tertiary)'}}/>
                    <div className="caption">
                      {lang==='es'
                        ? 'Sin líneas. Selecciona SKUs arriba para agregarlos.'
                        : 'No lines. Pick SKUs above to add them.'}
                    </div>
                  </div>
                ) : (
                  <table className="transfer-lines-table">
                    <thead>
                      <tr>
                        <th>SKU / Lote</th>
                        <th>{lang==='es'?'Producto':'Product'}</th>
                        <th className="ta-right">{lang==='es'?'Disp. origen':'Avail. origin'}</th>
                        <th className="ta-right">{lang==='es'?'Transferir':'Transfer'}</th>
                        <th className="ta-right">{lang==='es'?'Reservar':'Reserve'}</th>
                        <th className="ta-right">{lang==='es'?'Libre':'Free'}</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {form.lines.map(l => {
                        const qt = Number(l.qty_transfer) || 0;
                        const qr = Number(l.qty_reserve)  || 0;
                        const free = qt - qr;
                        const overflow = qt > l.stock_available;
                        const resOverflow = qr > qt;
                        return (
                          <motion.tr
                            key={l.key}
                            initial={{ opacity:0, y:4 }}
                            animate={{ opacity:1, y:0, transition:{ duration:0.2 } }}
                            exit={{ opacity:0, y:-4 }}
                            className={`transfer-line ${overflow||resOverflow?'has-err':''}`}
                          >
                            <td>
                              <div className="mono-sm" style={{fontWeight:600}}>{l.sku}</div>
                              <div className="caption mono-sm" style={{color:'var(--text-tertiary)'}}>
                                {l.lot}
                              </div>
                            </td>
                            <td>
                              <div className="body-sm">{l.product}</div>
                            </td>
                            <td className="ta-right tabular-nums" style={{color:'var(--success)'}}>
                              {l.stock_available.toLocaleString()}
                            </td>
                            <td className="ta-right">
                              <input className={`input input-sm tabular-nums ${overflow?'is-err':''}`}
                                     type="number" min="0" max={l.stock_available}
                                     value={l.qty_transfer}
                                     onChange={e=>updateLine(l.key, { qty_transfer: e.target.value })}/>
                            </td>
                            <td className="ta-right">
                              <input className={`input input-sm tabular-nums ${resOverflow?'is-err':''}`}
                                     type="number" min="0" max={qt}
                                     value={l.qty_reserve}
                                     onChange={e=>updateLine(l.key, { qty_reserve: e.target.value })}/>
                            </td>
                            <td className="ta-right tabular-nums" style={{color: free>0?'var(--success)':'var(--text-tertiary)'}}>
                              {Math.max(0, free).toLocaleString()}
                            </td>
                            <td className="ta-right">
                              <button className="btn-icon-xs" onClick={()=>removeLine(l.key)} aria-label="Remove">
                                <IconX size={12}/>
                              </button>
                            </td>
                          </motion.tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}

                {(totals.overflows.length > 0 || totals.reserveOverflows.length > 0) && (
                  <div className="transfer-error-note">
                    <IconAlert size={12}/>
                    {lang==='es'
                      ? 'Corrige las líneas resaltadas: la cantidad a transferir no puede superar el stock disponible, y la cantidad reservada no puede superar la cantidad a transferir.'
                      : 'Fix highlighted lines: transfer qty cannot exceed available stock, and reserved qty cannot exceed transfer qty.'}
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* ─── PASO 3 ─── */}
          {step === 3 && (
            <motion.div
              initial={{ opacity:0, y:6 }}
              animate={{ opacity:1, y:0, transition:{ duration:0.25 } }}
              className="transfer-step-body"
            >
              <div className="transfer-section-title">
                {lang==='es'?'Paso 3 · Validación y totales':'Step 3 · Review & totals'}
              </div>

              {/* Resumen contexto */}
              <div className="card card-pad-md transfer-review-card">
                <div className="heading-sm" style={{color:'var(--text-tertiary)', letterSpacing:0.6}}>
                  {lang==='es'?'CONTEXTO':'CONTEXT'}
                </div>
                <div className="transfer-review-path" style={{marginTop:8}}>
                  <span className="transfer-path-node">{form.nodo_origen}</span>
                  <IconArrow size={16} style={{color:'var(--brand-accent)'}}/>
                  <span className="transfer-path-node">{form.nodo_destino}</span>
                </div>
                <div className="review-grid" style={{marginTop:10}}>
                  <div>
                    <div className="caption" style={{color:'var(--text-tertiary)'}}>
                      {lang==='es'?'Motivo':'Reason'}
                    </div>
                    <div className="body-sm" style={{color: legalMeta?.color}}>
                      {legalMeta?.label}
                    </div>
                  </div>
                  <div>
                    <div className="caption" style={{color:'var(--text-tertiary)'}}>
                      {lang==='es'?'Tracking':'Tracking'}
                    </div>
                    <div className="mono-sm body-sm">{form.ref_tracking || '—'}</div>
                  </div>
                  <div>
                    <div className="caption" style={{color:'var(--text-tertiary)'}}>
                      {lang==='es'?'Líneas':'Lines'}
                    </div>
                    <div className="body-sm tabular-nums">{form.lines.length}</div>
                  </div>
                </div>
              </div>

              {/* Totales */}
              <div className="transfer-totals-grid">
                <div className="transfer-total-card">
                  <div className="caption">{lang==='es'?'Unidades a mover':'Units to move'}</div>
                  <div className="heading-lg tabular-nums" style={{color:'var(--brand-accent)'}}>
                    {totals.totalTransfer.toLocaleString()}
                  </div>
                </div>
                <div className="transfer-total-card">
                  <div className="caption">{lang==='es'?'Pre-reservadas (viajan comprometidas)':'Pre-reserved (committed)'}</div>
                  <div className="heading-lg tabular-nums" style={{color:'var(--warning)'}}>
                    {totals.totalReserve.toLocaleString()}
                  </div>
                </div>
                <div className="transfer-total-card">
                  <div className="caption">{lang==='es'?'Libres al llegar a destino':'Free at destination'}</div>
                  <div className="heading-lg tabular-nums" style={{color:'var(--success)'}}>
                    {Math.max(0, totals.totalFree).toLocaleString()}
                  </div>
                </div>
              </div>

              {/* Advertencia stock de seguridad */}
              {totals.breachesSafety && (
                <motion.div
                  className="transfer-warn"
                  initial={{ opacity:0, y:4 }}
                  animate={{ opacity:1, y:0 }}
                >
                  <IconAlert size={14}/>
                  <div>
                    <div className="heading-sm">
                      {lang==='es'?'Advertencia · stock de seguridad':'Warning · safety stock'}
                    </div>
                    <div className="caption">
                      {lang==='es'
                        ? `Esta transferencia dejaría el origen (${form.nodo_origen}) con stock insuficiente para cubrir los próximos ${STOCK_SEGURIDAD_DIAS} días. Confirma que sea intencional antes de crearla.`
                        : `This transfer would leave origin (${form.nodo_origen}) below the ${STOCK_SEGURIDAD_DIAS}-day safety buffer. Confirm this is intentional before creating.`}
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Desglose líneas (compacto) */}
              <div className="card card-pad-sm transfer-review-lines">
                <div className="heading-sm" style={{color:'var(--text-tertiary)', letterSpacing:0.6, marginBottom:8}}>
                  {lang==='es'?'DESGLOSE':'BREAKDOWN'}
                </div>
                {form.lines.map(l => {
                  const qt = Number(l.qty_transfer) || 0;
                  const qr = Number(l.qty_reserve)  || 0;
                  return (
                    <div key={l.key} className="transfer-review-line">
                      <div style={{flex:1, minWidth:0}}>
                        <div className="mono-sm" style={{fontWeight:600}}>{l.sku}</div>
                        <div className="caption" style={{color:'var(--text-tertiary)'}}>{l.product} · {l.lot}</div>
                      </div>
                      <div className="mono-sm tabular-nums" style={{whiteSpace:'nowrap'}}>
                        <span style={{color:'var(--brand-accent)'}}>{qt}</span>
                        <span style={{color:'var(--text-tertiary)'}}> · </span>
                        <span style={{color:'var(--warning)'}}>res {qr}</span>
                        <span style={{color:'var(--text-tertiary)'}}> · </span>
                        <span style={{color:'var(--success)'}}>libre {Math.max(0, qt-qr)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </div>

        {/* Footer navegación */}
        <div className="transfer-footer">
          <div style={{display:'flex', gap:8}}>
            {step > 1 && (
              <button className="btn" onClick={()=>setStep(step-1)}>
                <IconChevLeft size={14}/> {lang==='es'?'Atrás':'Back'}
              </button>
            )}
          </div>
          <div style={{display:'flex', alignItems:'center', gap:12}}>
            <span className="caption tabular-nums" style={{color:'var(--text-tertiary)'}}>
              {totals.totalTransfer > 0 && `${totals.totalTransfer.toLocaleString()} u`}
            </span>
            {step < 3 && (
              <button className="btn btn-accent"
                      disabled={step===1 ? !canStep1 : !canStep2}
                      onClick={()=>setStep(step+1)}>
                {lang==='es'?'Continuar':'Continue'} <IconChevRight size={14}/>
              </button>
            )}
            {step === 3 && (
              <button
                className="btn btn-accent"
                disabled={!canSave || saving}
                onClick={handleSave}
              >
                <IconTruck size={14}/>
                {saving
                  ? (lang==='es'?'Creando…':'Creating…')
                  : (lang==='es'?'Crear transferencia':'Create transfer')}
              </button>
            )}
          </div>
        </div>

        {saveError && (
          <div className="transfer-error-note" style={{ margin:'0 20px 14px' }}>
            <IconAlert size={12}/>
            {lang==='es'
              ? `Error al guardar: ${saveError}`
              : `Save error: ${saveError}`}
          </div>
        )}
      </motion.aside>
    </>
  );
}
