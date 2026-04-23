// New Expediente wizard
import React, { useState, useRef, useCallback } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { tr, fmtMoney, fmtMoneyDetail } from "../lib/i18n.js";
import { Badge, CreditBar } from "../components/ui/primitives.jsx";
import {
  IconChevLeft, IconChevRight, IconCheck, IconPlus, IconX, IconAlert,
  IconUpload,
} from "../lib/icons.jsx";
import { CLIENTS, BRANDS } from "../data/mockData.js";
import { postMultipart, getToken } from "../lib/api.js";

export default function ScreenWizard() {
  const navigate = useNavigate();
  const { lang } = useOutletContext();
  const onCancel = () => navigate('/expedientes');
  const onCreate = () => navigate('/expedientes');

  const [step, setStep] = useState(0);
  const [clientId, setClientId] = useState('c1');
  const [brandId, setBrandId] = useState('bis');
  const [mode, setMode] = useState('CIF');
  const [freight, setFreight] = useState('SEA');
  const [dispatch, setDispatch] = useState('FCL');
  const [origin, setOrigin] = useState('Shanghái, CN');
  const [lines, setLines] = useState([
    { id:'nl1', sku:'BIS-OXF-BLK-42', name:'Oxford cuero negro T.42', qty: 300, price: 69.90 },
  ]);
  // ── OCR upload (opcional) para Paso 1 ─────────────────────────
  // Si el admin arrastra un archivo, llamamos /api/ocr/parse-oc/ y
  // pre-seleccionamos cliente + marca + OC + líneas. Si lo deja vacío,
  // el flujo manual sigue intacto.
  const [poNumber, setPoNumber] = useState('PO-2026-04156');
  const [ocrFile, setOcrFile] = useState(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState(null);
  const [ocrSummary, setOcrSummary] = useState(null); // { clientName, brandName, linesCount, confidence, poNumber }
  const fileInputRef = useRef(null);

  const handleOcrFile = useCallback(async (file) => {
    if (!file) return;
    const name = (file.name || "").toLowerCase();
    const ok = name.endsWith(".pdf") || name.endsWith(".xlsx") || name.endsWith(".xlsm");
    if (!ok) {
      setOcrError(lang === "es"
        ? "Formato no soportado. Solo .pdf o .xlsx"
        : "Unsupported format. Only .pdf or .xlsx");
      return;
    }
    setOcrFile(file);
    setOcrLoading(true);
    setOcrError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const resp = await postMultipart("/ocr/parse-oc/", fd, { token: getToken() });
      if (!resp?.ok) {
        setOcrError(resp?.hint || resp?.error || (lang === "es"
          ? "El OCR no pudo leer el archivo. Completa los campos manualmente."
          : "OCR failed. Fill fields manually."));
        setOcrLoading(false);
        return;
      }
      const pl = resp.payload || {};
      const clientCand = (pl.client?._candidates || [])[0];
      const brandCand  = (pl.brand?._candidates  || [])[0];

      // Aplicar al estado del wizard (pre-selección)
      if (clientCand?.id && CLIENTS.some(c => c.id === clientCand.id)) {
        setClientId(clientCand.id);
      }
      if (brandCand?.id && BRANDS.some(b => b.id === brandCand.id)) {
        setBrandId(brandCand.id);
      }
      if (pl.po?.number) {
        setPoNumber(pl.po.number);
      }
      if (Array.isArray(pl.lines) && pl.lines.length > 0) {
        setLines(pl.lines.map((l, i) => ({
          id:    `nl-ocr-${i}`,
          sku:   l.sku,
          name:  l.descripcion || l.name || l.sku,
          qty:   Number(l.qty) || 0,
          price: Number(l.unit_price) || 0,
        })));
      }
      setOcrSummary({
        clientName:  clientCand?.razon_social || clientCand?.name || pl.client?.name || "—",
        brandName:   brandCand?.nombre || brandCand?.name || pl.brand?.name || "—",
        poNumber:    pl.po?.number || null,
        linesCount:  (pl.lines || []).length,
        confidence:  Math.round((pl.confidence || 0) * 100),
        creditDays:  clientCand?.credit_days,
        creditLimit: clientCand?.credit_limit_usd,
      });
    } catch (e) {
      setOcrError(e?.message || (lang === "es"
        ? "Error al procesar el archivo"
        : "Error processing file"));
    } finally {
      setOcrLoading(false);
    }
  }, [lang]);

  const clearOcr = useCallback(() => {
    setOcrFile(null);
    setOcrError(null);
    setOcrSummary(null);
  }, []);

  const steps = [
    tr(lang,'step_client'),
    tr(lang,'step_mode'),
    tr(lang,'step_lines'),
    tr(lang,'step_review'),
  ];
  const client = CLIENTS.find(c=>c.id===clientId);
  const brand = BRANDS.find(b=>b.id===brandId);
  const total = lines.reduce((a,l)=>a+l.qty*l.price,0);

  return (
    <div className="page" style={{maxWidth:1100}} data-screen-label="Nuevo expediente · Wizard">
      <button className="btn btn-ghost btn-sm" onClick={onCancel} style={{marginBottom:14, padding:'0 8px 0 4px'}}>
        <IconChevLeft size={14}/>{tr(lang,'cancel')}
      </button>
      <div className="page-header">
        <div>
          <div className="micro" style={{marginBottom:6}}>{lang==='es'?'ASISTENTE':'WIZARD'}</div>
          <h1 className="page-title">{tr(lang,'new_expediente')}</h1>
          <div className="page-subtitle">{lang==='es'?'Crea un expediente con los datos comerciales y operativos':'Create a file with commercial and operational data'}</div>
        </div>
      </div>

      {/* Stepper */}
      <div className="card card-pad-lg mb-4" style={{padding:'18px 24px'}}>
        <div style={{display:'grid', gridTemplateColumns:`repeat(${steps.length},1fr)`, gap:0, position:'relative'}}>
          {steps.map((s,i) => {
            const status = i < step ? 'done' : i === step ? 'active' : 'future';
            return (
              <div key={i} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:8,zIndex:1, position:'relative'}}>
                <div style={{
                  width: status==='active'?32:26, height: status==='active'?32:26, borderRadius:'50%',
                  background: status==='done'?'var(--brand-accent)':status==='active'?'var(--brand-primary)':'var(--surface)',
                  border: status==='future'?'2px solid var(--border-strong)':'2px solid transparent',
                  color: status==='future'?'var(--text-tertiary)':'#fff',
                  display:'grid', placeItems:'center', font:'700 13px/1 var(--font-display)',
                  boxShadow: status==='active'?'0 0 0 5px rgba(1,58,87,0.12)':'none',
                  transition:'all 200ms',
                }}>
                  {status==='done' ? <IconCheck size={14}/> : (i+1)}
                </div>
                <div className="heading-sm" style={{color: status==='future'?'var(--text-tertiary)':'var(--text-primary)'}}>{s}</div>
              </div>
            );
          })}
          <div style={{position:'absolute',top:14,left:'12.5%',right:'12.5%',height:2,background:'var(--border)',zIndex:0}}>
            <div style={{height:'100%',width:`${(step/(steps.length-1))*100}%`,background:'var(--brand-accent)',transition:'width 300ms'}}/>
          </div>
        </div>
      </div>

      <div className="card card-pad-lg mb-4" style={{minHeight:380}}>
        {step===0 && (
          <div>
            {/* ── OCR · upload opcional ──────────────────────────────
                Pegamos encima de las 2 columnas Cliente/Marca un bloque
                "Subir OC (opcional)". Si el admin suelta un archivo,
                llamamos /api/ocr/parse-oc/ y pre-seleccionamos cliente,
                marca, PO y líneas. Si no lo usa, el flujo manual sigue
                funcionando exactamente igual. ────────────────────── */}
            <div
              onDragOver={(e) => { e.preventDefault(); }}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f) handleOcrFile(f);
              }}
              onClick={() => !ocrLoading && fileInputRef.current?.click()}
              style={{
                position:     'relative',
                overflow:     'hidden',
                border:       `1.5px dashed ${ocrSummary ? 'var(--brand-accent, #00B286)' : 'var(--border, #E1E6ED)'}`,
                background:   ocrSummary ? 'rgba(0,178,134,0.06)' : 'var(--surface-soft, #FAFBFD)',
                borderRadius: 10,
                padding:      '14px 18px',
                marginBottom: 20,
                cursor:       ocrLoading ? 'wait' : 'pointer',
                transition:   'all 0.2s ease',
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.xlsx,.xlsm"
                style={{ display: 'none' }}
                onChange={(e) => handleOcrFile(e.target.files?.[0])}
              />

              {/* Scan line animation durante loading */}
              {ocrLoading && (
                <motion.div
                  aria-hidden="true"
                  initial={{ y: '-100%', opacity: 0.9 }}
                  animate={{ y: '100%',  opacity: 0.9 }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                  style={{
                    position: 'absolute', left: 0, right: 0,
                    height: 3,
                    background: 'linear-gradient(90deg, transparent 0%, #00B286 20%, #00B286 80%, transparent 100%)',
                    boxShadow: '0 0 8px #00B286',
                    zIndex: 2,
                  }}
                />
              )}

              {/* Estado 1: sin archivo → prompt */}
              {!ocrFile && !ocrLoading && !ocrSummary && (
                <div style={{display:'flex', alignItems:'center', gap:14}}>
                  <div style={{
                    width:42, height:42, borderRadius:8,
                    background:'rgba(0,178,134,0.10)',
                    display:'flex', alignItems:'center', justifyContent:'center',
                    fontSize:20, flexShrink:0,
                  }}>📄</div>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:600, color:'var(--text, #1B2A45)', fontSize:14}}>
                      {lang==='es' ? 'Subir OC del cliente (opcional)' : 'Upload client PO (optional)'}
                    </div>
                    <div style={{fontSize:12, color:'var(--text-tertiary, #64748B)', marginTop:2}}>
                      {lang==='es'
                        ? 'Arrastra o haz clic para subir un .pdf o .xlsx — el sistema llenará cliente, marca, OC y productos automáticamente.'
                        : 'Drag or click to upload a .pdf or .xlsx — the system will auto-fill client, brand, PO and products.'}
                    </div>
                  </div>
                  <Badge kind="neutral">OCR</Badge>
                </div>
              )}

              {/* Estado 2: loading */}
              {ocrLoading && (
                <div style={{display:'flex', alignItems:'center', gap:14, position:'relative', zIndex:1}}>
                  <div style={{fontSize:22}}>🔎</div>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:600, fontSize:14, color:'var(--text, #1B2A45)'}}>
                      {lang==='es' ? 'Leyendo documento…' : 'Reading document…'}
                    </div>
                    <div style={{fontSize:12, color:'var(--text-tertiary, #64748B)', marginTop:2}}>
                      {ocrFile?.name} · {lang==='es' ? 'detectando cliente, marca y productos' : 'detecting client, brand, products'}
                    </div>
                  </div>
                </div>
              )}

              {/* Estado 3: summary */}
              {ocrSummary && !ocrLoading && (
                <motion.div
                  initial={{opacity:0, y:6}} animate={{opacity:1, y:0}}
                  style={{display:'flex', alignItems:'center', gap:14, flexWrap:'wrap'}}
                >
                  <div style={{fontSize:22}}>✅</div>
                  <div style={{flex:1, minWidth:200}}>
                    <div style={{fontWeight:600, fontSize:13, color:'var(--text, #1B2A45)'}}>
                      {lang==='es' ? 'OC leída y pre-rellenada' : 'PO parsed & pre-filled'}
                      <span style={{
                        marginLeft:8, fontSize:10, fontWeight:700,
                        color:'#fff', background:'#00B286',
                        padding:'2px 8px', borderRadius:999, letterSpacing:0.4,
                      }}>
                        {ocrSummary.confidence}% OCR
                      </span>
                    </div>
                    <div style={{fontSize:12, color:'var(--text-tertiary, #64748B)', marginTop:4, display:'flex', gap:10, flexWrap:'wrap'}}>
                      <span><strong style={{color:'var(--text, #1B2A45)'}}>{ocrSummary.clientName}</strong>
                        {ocrSummary.creditDays != null && <> · {ocrSummary.creditDays} {lang==='es'?'días':'days'}</>}
                      </span>
                      <span>· {lang==='es'?'Marca':'Brand'}: <strong style={{color:'var(--text, #1B2A45)'}}>{ocrSummary.brandName}</strong></span>
                      {ocrSummary.poNumber && <span>· OC <code style={{fontFamily:'monospace', fontWeight:600}}>{ocrSummary.poNumber}</code></span>}
                      <span>· {ocrSummary.linesCount} {lang==='es'?'productos':'items'}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); clearOcr(); }}
                    className="btn btn-ghost btn-sm"
                    title={lang==='es'?'Quitar archivo':'Remove file'}
                    style={{padding:'4px 10px'}}
                  >
                    <IconX size={12}/> {lang==='es'?'Quitar':'Remove'}
                  </button>
                </motion.div>
              )}

              {/* Error */}
              {ocrError && !ocrLoading && (
                <div style={{
                  marginTop: ocrFile ? 8 : 0,
                  color:'#B83227', fontSize:12,
                }}>
                  ⚠️ {ocrError}
                </div>
              )}
            </div>

            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:24}}>
            <div>
              <label className="field-label">{tr(lang,'client')}</label>
              <select className="select" value={clientId} onChange={e=>setClientId(e.target.value)}>
                {CLIENTS.map(c=><option key={c.id} value={c.id}>{c.name} ({c.country})</option>)}
              </select>
              <div className="field-hint">{lang==='es'?'Cliente final del expediente':'End client for this file'}</div>
              {client && (
                <div className="card card-pad mt-4">
                  <div className="flex ai-center gap-3">
                    <div className="avatar">{client.name.split(' ').map(s=>s[0]).slice(0,2).join('')}</div>
                    <div style={{flex:1}}>
                      <div className="heading-md">{client.name}</div>
                      <div className="caption">{client.contact} · {client.email}</div>
                    </div>
                    <Badge kind={client.band==='GREEN'?'success':client.band==='AMBER'?'warning':'critical'} dot>{client.band}</Badge>
                  </div>
                  <div className="mt-3">
                    <div className="micro mb-2">{lang==='es'?'LÍMITE DE CRÉDITO':'CREDIT LIMIT'}</div>
                    <CreditBar limit={client.credit_limit} used={client.credit_used}/>
                  </div>
                </div>
              )}
            </div>
            <div>
              <label className="field-label">{tr(lang,'brand')}</label>
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10}}>
                {BRANDS.map(b => (
                  <button key={b.id} onClick={()=>setBrandId(b.id)}
                    style={{
                      padding:14, borderRadius: 8, textAlign:'left', cursor:'pointer',
                      background: brandId===b.id ? 'var(--brand-accent-soft)' : 'var(--surface)',
                      border: '1px solid ' + (brandId===b.id ? 'var(--brand-accent)' : 'var(--border)'),
                    }}>
                    <div className="flex ai-center gap-2 mb-2">
                      <span style={{width:14,height:14,background:b.color,borderRadius:3}}/>
                      <span className="heading-md">{b.name}</span>
                    </div>
                    <div className="caption">{b.expedientes} {lang==='es'?'expedientes activos':'active files'}</div>
                  </button>
                ))}
              </div>
              <div className="mt-6">
                <label className="field-label">{lang==='es'?'OC del cliente':'Client PO'}</label>
                <input
                  className="input"
                  value={poNumber}
                  onChange={(e) => setPoNumber(e.target.value)}
                />
              </div>
              <div className="grid col-2 gap-3 mt-4">
                <div>
                  <label className="field-label">{lang==='es'?'Moneda':'Currency'}</label>
                  <select className="select"><option>USD</option><option>EUR</option><option>PEN</option></select>
                </div>
                <div>
                  <label className="field-label">{lang==='es'?'Responsable':'Owner'}</label>
                  <select className="select"><option>A. Mendoza</option><option>L. Vargas</option></select>
                </div>
              </div>
            </div>
            </div>{/* cierra grid 2-col (cliente / marca) */}
          </div>{/* cierra wrapper step===0 (dropzone + grid) */}
        )}
        {step===1 && (
          <div style={{display:'grid',gap:24,maxWidth:700}}>
            <div>
              <label className="field-label">{lang==='es'?'Modalidad comercial (Incoterm)':'Commercial mode (Incoterm)'}</label>
              <div className="seg" style={{height:44}}>
                {['FOB','CIF','DDP','EXW'].map(m => <button key={m} data-active={mode===m} onClick={()=>setMode(m)}>{m}</button>)}
              </div>
            </div>
            <div className="grid col-2 gap-4">
              <div>
                <label className="field-label">{tr(lang,'freight')}</label>
                <div className="seg" style={{height:44}}>
                  {['SEA','AIR','LAND'].map(m => <button key={m} data-active={freight===m} onClick={()=>setFreight(m)}>{m}</button>)}
                </div>
              </div>
              <div>
                <label className="field-label">{tr(lang,'dispatch')}</label>
                <div className="seg" style={{height:44}}>
                  {['FCL','LCL','CONSOLIDADO'].map(m => <button key={m} data-active={dispatch===m} onClick={()=>setDispatch(m)}>{m}</button>)}
                </div>
              </div>
            </div>
            <div className="grid col-2 gap-4">
              <div>
                <label className="field-label">{tr(lang,'origin')}</label>
                <input className="input" value={origin} onChange={e=>setOrigin(e.target.value)}/>
              </div>
              <div>
                <label className="field-label">{tr(lang,'destination')}</label>
                <input className="input" defaultValue={client ? {Perú:'Callao, Perú',Chile:'San Antonio, Chile',Argentina:'Buenos Aires, Argentina',Colombia:'Buenaventura, Colombia',México:'Manzanillo, México',Ecuador:'Guayaquil, Ecuador','R. Dominicana':'Caucedo, R. Dominicana'}[client.country] : ''}/>
              </div>
            </div>
            <div className="grid col-2 gap-4">
              <div>
                <label className="field-label">{tr(lang,'shipment_date')}</label>
                <input className="input" type="date" defaultValue="2026-05-02"/>
              </div>
              <div>
                <label className="field-label">ETA</label>
                <input className="input" type="date" defaultValue="2026-06-18"/>
              </div>
            </div>
          </div>
        )}
        {step===2 && (
          <div>
            <div className="flex ai-center jc-between mb-4">
              <div className="heading-md">{lang==='es'?'Productos del expediente':'File products'}</div>
              <button className="btn btn-secondary btn-sm"><IconPlus size={13}/>{lang==='es'?'Agregar línea':'Add line'}</button>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr>
                  <th>SKU</th><th>{lang==='es'?'Descripción':'Description'}</th>
                  <th style={{textAlign:'right'}}>{lang==='es'?'Cant.':'Qty'}</th>
                  <th style={{textAlign:'right'}}>{lang==='es'?'Precio':'Price'}</th>
                  <th style={{textAlign:'right'}}>{lang==='es'?'Subtotal':'Subtotal'}</th>
                  <th style={{width:40}}></th>
                </tr></thead>
                <tbody>
                  {[...lines, {id:'nl2',sku:'BIS-BLT-BRN-L',name:'Cinturón cuero marrón L',qty:400,price:24.90},
                               {id:'nl3',sku:'BIS-OXF-TAN-42',name:'Oxford cuero tan T.42',qty:250,price:69.90}].map(l => (
                    <tr key={l.id}>
                      <td><span className="mono-sm" style={{fontWeight:600,color:'var(--interactive)'}}>{l.sku}</span></td>
                      <td>{l.name}</td>
                      <td className="td-num tabular">{l.qty}</td>
                      <td className="td-money">{fmtMoneyDetail(l.price)}</td>
                      <td className="td-money">{fmtMoney(l.qty*l.price)}</td>
                      <td><button className="icon-btn" style={{width:28,height:28}}><IconX size={13}/></button></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4} style={{padding:14,textAlign:'right',fontWeight:600}}>{lang==='es'?'Total estimado':'Estimated total'}</td>
                    <td className="td-money" style={{padding:14,fontSize:16}}>{fmtMoney(300*69.9 + 400*24.9 + 250*69.9)}</td>
                    <td/>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
        {step===3 && (
          <div>
            <div className="heading-md mb-4">{lang==='es'?'Revisa antes de crear':'Review before creating'}</div>
            <div className="grid col-2 gap-4">
              <div className="card card-pad">
                <div className="micro mb-2">{tr(lang,'client')} / {tr(lang,'brand')}</div>
                <div className="heading-md">{client?.name}</div>
                <div className="caption">{client?.country} · <span style={{display:'inline-block',width:8,height:8,background:brand?.color,borderRadius:2,marginRight:4,verticalAlign:'middle'}}/>{brand?.name}</div>
              </div>
              <div className="card card-pad">
                <div className="micro mb-2">{tr(lang,'mode')}</div>
                <div className="heading-md">{mode} · {freight} · {dispatch}</div>
                <div className="caption">{origin} → {client?.country}</div>
              </div>
              <div className="card card-pad">
                <div className="micro mb-2">{tr(lang,'products')}</div>
                <div className="heading-md">3 {lang==='es'?'líneas · 950 unidades':'lines · 950 units'}</div>
              </div>
              <div className="card card-pad" style={{background:'var(--brand-accent-soft)', borderColor:'var(--brand-accent)'}}>
                <div className="micro mb-2">{lang==='es'?'TOTAL ESTIMADO':'ESTIMATED TOTAL'}</div>
                <div className="tabular" style={{font:'700 22px/1 var(--font-mono)',color:'var(--brand-primary)'}}>{fmtMoney(300*69.9 + 400*24.9 + 250*69.9)}</div>
                <div className="caption">{lang==='es'?'Precio de venta estimado':'Estimated sale price'}</div>
              </div>
            </div>
            <div className="card card-pad mt-4" style={{background:'var(--info-bg)', borderColor:'var(--info)'}}>
              <div className="flex ai-center gap-2 mb-2"><IconAlert size={14} style={{color:'var(--info)'}}/><span className="heading-sm" style={{color:'var(--info)'}}>{lang==='es'?'Al crear:':'On create:'}</span></div>
              <ul style={{margin:0, paddingLeft:22, fontSize:13, color:'var(--text-secondary)', lineHeight:1.7}}>
                <li>{lang==='es'?'Se emitirá automáticamente la proforma cliente':'Client proforma will be auto-issued'}</li>
                <li>{lang==='es'?'Se asignará un código MWT- secuencial':'A sequential MWT- code will be assigned'}</li>
                <li>{lang==='es'?'El cliente recibirá acceso al Portal para este expediente':'The client will receive Portal access for this file'}</li>
                <li>{lang==='es'?'Podrás agregar costos y pagos desde el detalle':'You can add costs and payments from the detail view'}</li>
              </ul>
            </div>
          </div>
        )}
      </div>

      <div className="flex ai-center jc-between">
        <button className="btn btn-ghost" onClick={onCancel}>{tr(lang,'cancel')}</button>
        <div className="flex gap-2">
          {step>0 && <button className="btn btn-secondary" onClick={()=>setStep(step-1)}><IconChevLeft size={13}/>{tr(lang,'back')}</button>}
          {step<steps.length-1
            ? <button className="btn btn-primary" onClick={()=>setStep(step+1)}>{tr(lang,'next')}<IconChevRight size={13}/></button>
            : <button className="btn btn-accent" onClick={onCreate}><IconCheck size={14}/>{tr(lang,'create')}</button>}
        </div>
      </div>
    </div>
  );
}
