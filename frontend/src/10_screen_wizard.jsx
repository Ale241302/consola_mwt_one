// New Expediente wizard
function ScreenWizard({ lang, onCancel, onCreate }) {
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
                <input className="input" defaultValue="PO-2026-04156"/>
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
          </div>
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
Object.assign(window, { ScreenWizard });
