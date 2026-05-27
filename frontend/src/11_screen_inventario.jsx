// Inventario
function ScreenInventario({ lang }) {
  const [q, setQ] = useState('');
  const [nodeFilter, setNodeFilter] = useState('ALL');
  const totalUnits = INVENTORY.reduce((a,i)=>a+i.qty,0);
  const reservedUnits = INVENTORY.reduce((a,i)=>a+i.reserved,0);
  const availableUnits = totalUnits - reservedUnits;

  const filtered = INVENTORY.filter(i => {
    if (nodeFilter!=='ALL' && i.node !== nodeFilter) return false;
    if (q && !(i.sku+i.product).toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  const nodeSummary = NODES.map(n => ({
    node: n,
    skuCount: INVENTORY.filter(i=>i.node===n.name).length,
    units: INVENTORY.filter(i=>i.node===n.name).reduce((a,i)=>a+i.qty,0),
  }));

  return (
    <div className="page" data-screen-label="Inventario">
      <div className="page-header">
        <div>
          <div className="micro" style={{marginBottom:6}}>{lang==='es'?'SUPPLY CHAIN':'SUPPLY CHAIN'}</div>
          <h1 className="page-title">{tr(lang,'inventario')}</h1>
          <div className="page-subtitle">{lang==='es'?'Stock por SKU y por nodo logístico':'Stock by SKU and logistic node'}</div>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary"><IconSwap size={14}/>{lang==='es'?'Nuevo movimiento':'New transfer'}</button>
          <button className="btn btn-primary"><IconPlus size={14}/>{lang==='es'?'Recibir lote':'Receive lot'}</button>
        </div>
      </div>

      <div className="grid col-4 gap-3 mb-6">
        <div className="stat">
          <div className="stat-label">{tr(lang,'stock')} {lang==='es'?'total':'total'}</div>
          <div className="stat-value">{totalUnits.toLocaleString()}</div>
          <div className="stat-sub">{INVENTORY.length} SKUs · {NODES.length} {tr(lang,'nodos').toLowerCase()}</div>
        </div>
        <div className="stat">
          <div className="stat-label">{tr(lang,'available')}</div>
          <div className="stat-value" style={{color:'var(--success)'}}>{availableUnits.toLocaleString()}</div>
          <div className="stat-sub">{((availableUnits/totalUnits)*100).toFixed(0)}% {lang==='es'?'sin reservar':'unreserved'}</div>
        </div>
        <div className="stat">
          <div className="stat-label">{tr(lang,'reserved')}</div>
          <div className="stat-value" style={{color:'var(--warning)'}}>{reservedUnits.toLocaleString()}</div>
          <div className="stat-sub">{lang==='es'?'comprometido en expedientes':'committed to files'}</div>
        </div>
        <div className="stat">
          <div className="stat-label">{lang==='es'?'Movimientos en tránsito':'Transfers in transit'}</div>
          <div className="stat-value">3</div>
          <div className="stat-sub">1,420 {lang==='es'?'unidades':'units'}</div>
        </div>
      </div>

      {/* Node summary */}
      <div className="card mb-4">
        <div className="card-head">
          <div className="card-title">{lang==='es'?'Nodos logísticos':'Logistic nodes'}</div>
          <button className="btn btn-ghost btn-sm">{lang==='es'?'Ver red':'View network'}<IconArrow size={13}/></button>
        </div>
        <div className="card-pad-lg grid gap-3" style={{gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))'}}>
          {nodeSummary.map(({node,skuCount,units}) => (
            <button key={node.id} className="card card-pad" onClick={()=>setNodeFilter(node.name)}
              style={{cursor:'pointer', border:'1px solid '+(nodeFilter===node.name?'var(--brand-accent)':'var(--border)'), background: nodeFilter===node.name?'var(--brand-accent-soft)':'var(--surface)'}}>
              <div className="flex ai-center gap-2 mb-2">
                <IconNetwork size={14} style={{color:'var(--brand-primary)'}}/>
                <span className="heading-sm" style={{color:'var(--text-primary)'}}>{node.name}</span>
              </div>
              <div className="caption mb-2">{node.type} · {node.location}</div>
              <div className="flex ai-center jc-between">
                <span className="tabular" style={{font:'700 16px/1 var(--font-mono)'}}>{units.toLocaleString()}</span>
                <Badge kind="neutral">{skuCount} SKU</Badge>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="toolbar">
        <div className="search-box" style={{flex:1, maxWidth:360}}>
          <IconSearch size={14} className="search-icon"/>
          <input className="input" placeholder={lang==='es'?'Buscar SKU o producto…':'Search SKU or product…'} value={q} onChange={e=>setQ(e.target.value)}/>
        </div>
        <select className="select" style={{width:180}} value={nodeFilter} onChange={e=>setNodeFilter(e.target.value)}>
          <option value="ALL">{lang==='es'?'Todos los nodos':'All nodes'}</option>
          {NODES.map(n=><option key={n.id} value={n.name}>{n.name}</option>)}
        </select>
        {nodeFilter!=='ALL' && <button className="filter-chip" data-active="true" onClick={()=>setNodeFilter('ALL')}>{nodeFilter}<IconX size={11}/></button>}
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead><tr>
            <th>SKU</th><th>{lang==='es'?'Producto':'Product'}</th><th>{tr(lang,'node')}</th>
            <th>{tr(lang,'lot')}</th>
            <th style={{textAlign:'right'}}>{tr(lang,'stock')}</th>
            <th style={{textAlign:'right'}}>{tr(lang,'reserved')}</th>
            <th style={{textAlign:'right'}}>{tr(lang,'available')}</th>
            <th>{tr(lang,'received')}</th>
          </tr></thead>
          <tbody>
            {filtered.map(i => {
              const avail = i.qty - i.reserved;
              const pct = i.qty>0 ? (avail/i.qty)*100 : 0;
              return (
                <tr key={i.sku+i.node}>
                  <td><span className="mono-sm" style={{fontWeight:600, color:'var(--interactive)'}}>{i.sku}</span></td>
                  <td>{i.product}</td>
                  <td><Badge kind="neutral"><IconWarehouse size={10}/>{i.node}</Badge></td>
                  <td className="mono-sm text-sec">{i.lot}</td>
                  <td className="td-num tabular">{i.qty.toLocaleString()}</td>
                  <td className="td-num tabular text-warning">{i.reserved.toLocaleString()}</td>
                  <td className="td-num">
                    <div style={{display:'flex', alignItems:'center', gap:8, justifyContent:'flex-end'}}>
                      <div style={{width:60, height:5, background:'var(--bg-alt)', borderRadius:3, overflow:'hidden'}}>
                        <div style={{height:'100%',width:pct+'%',background:pct>50?'var(--success)':pct>20?'var(--warning)':'var(--critical)'}}/>
                      </div>
                      <span className="tabular" style={{minWidth:40, textAlign:'right'}}>{avail.toLocaleString()}</span>
                    </div>
                  </td>
                  <td className="text-sec">{fmtDate(i.received, lang)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
Object.assign(window, { ScreenInventario });
