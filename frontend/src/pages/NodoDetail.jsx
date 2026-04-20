// ─────────────────────────────────────────────────────────────
// NodoDetail — Dashboard operativo de un nodo logístico
// Agente responsable: [AG-FRONTEND]
//
// Tabs: Resumen (KPIs) · Inventario · Transferencias ·
//       Automatizaciones · Expedientes vinculados
// ─────────────────────────────────────────────────────────────
import React, { useMemo, useState } from "react";
import { useNavigate, useParams, useOutletContext } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  IconChevLeft, IconMapPin, IconPackage, IconTruck, IconRefresh,
  IconCheck, IconX, IconClock, IconDollar, IconBoxes, IconTrend,
  IconArrow, IconSparkle,
} from "../lib/icons.jsx";
import { tr, fmtMoney } from "../lib/i18n.js";
import {
  NODES, NODE_INVENTORY, NODE_TRANSFERS, NODE_AUTOMATIONS,
  LEGAL_ENTITIES, OPERATORS, PRODUCTS, EXPEDIENTES, OCS,
} from "../data/mockData.js";

const TYPE_META = {
  marketplace: { label: 'Marketplace', color: '#481EE3' },
  fiscal:      { label: 'Fiscal',      color: '#3083FE' },
  warehouse:   { label: 'Warehouse',   color: '#00B286' },
  distributor: { label: 'Distributor', color: '#1EE3D7' },
  factory:     { label: 'Factory',     color: '#1DE394' },
};

const TABS = [
  { k: 'overview',    l: 'Resumen' },
  { k: 'inventory',   l: 'Inventario' },
  { k: 'transfers',   l: 'Transferencias' },
  { k: 'automations', l: 'Automatizaciones' },
  { k: 'files',       l: 'Expedientes' },
];

export default function ScreenNodoDetail() {
  const navigate = useNavigate();
  const { nodeId } = useParams();
  const { lang } = useOutletContext();
  const [tab, setTab] = useState('overview');

  const node = useMemo(() => NODES.find(n => n.id === nodeId), [nodeId]);

  // Derivados
  const inventory = useMemo(() => NODE_INVENTORY.filter(r => r.node_id === nodeId), [nodeId]);
  const transfers = useMemo(() => NODE_TRANSFERS.filter(t => t.from === nodeId || t.to === nodeId), [nodeId]);
  const autos     = useMemo(() => NODE_AUTOMATIONS.filter(a => a.node_id === nodeId), [nodeId]);
  const files     = useMemo(() =>
    // Expedientes cuyo destino coincide con la ubicación del nodo
    EXPEDIENTES.filter(e => node && (e.destination || '').includes((node.location || '').split(',')[0] || '__none__'))
               .slice(0, 8)
  , [node]);

  if (!node) {
    return (
      <div className="page">
        <div className="empty-state">
          <IconSparkle size={22} style={{color:'var(--brand-accent)'}}/>
          <div className="heading-md">{lang==='es'?'Nodo no encontrado':'Node not found'}</div>
          <button className="btn btn-ghost" onClick={()=>navigate('/nodos')}>
            <IconChevLeft size={14}/> {lang==='es'?'Volver a nodos':'Back to nodes'}
          </button>
        </div>
      </div>
    );
  }

  const meta       = TYPE_META[node.type] || TYPE_META.warehouse;
  const owner      = LEGAL_ENTITIES.find(e => e.id === node.legal_entity_id);
  const operator   = OPERATORS.find(o => o.id === node.operator_id);
  const util       = node.capacity_units ? node.capacity_used / node.capacity_units : 0;
  const utilPct    = Math.round(util * 100);
  const utilBand   = util >= 0.9 ? 'red' : util >= 0.7 ? 'amber' : 'green';
  const invValue   = inventory.reduce((a, r) => a + (r.value || 0), 0);
  const inboundTx  = transfers.filter(t => t.to   === nodeId);
  const outboundTx = transfers.filter(t => t.from === nodeId);

  return (
    <div className="page">
      {/* ── Breadcrumb + header ────────── */}
      <div className="flex ai-center gap-2" style={{marginBottom: 12}}>
        <button className="btn btn-ghost btn-sm" onClick={()=>navigate('/nodos')}>
          <IconChevLeft size={13}/> {lang==='es'?'Nodos':'Nodes'}
        </button>
        <span className="caption">/</span>
        <span className="caption">{node.node_id}</span>
      </div>

      <div className="node-hero" style={{ '--type-color': meta.color }}>
        <div className="node-hero-flag">{node.flag || '🌐'}</div>
        <div style={{flex:1, minWidth:0}}>
          <div className="micro">{meta.label.toUpperCase()} · {node.node_id}</div>
          <h1 className="page-title" style={{margin:'4px 0 6px'}}>{node.name}</h1>
          <div className="node-hero-meta">
            <span className="pill-soft"><IconMapPin size={12}/> {node.location}</span>
            <span className="pill-soft">Owner: {owner?.short || '—'}</span>
            <span className="pill-soft">Operador: {operator?.name || '—'}</span>
            <span className={`badge ${node.status==='ACTIVE'?'badge-success':'badge-outline'}`}>
              <span className="dot"/>{node.status}
            </span>
          </div>
        </div>
        <div className="node-hero-cap">
          <div className="caption">{lang==='es'?'Utilización':'Utilization'}</div>
          <div className="display-md tabular">{utilPct}%</div>
          <div className={`capacity-bar band-${utilBand}`} style={{width: 180}}>
            <span style={{width: `${Math.min(100, utilPct)}%`}}/>
          </div>
          <div className="caption">{node.capacity_used.toLocaleString()} / {node.capacity_units.toLocaleString()} u.</div>
        </div>
      </div>

      {/* ── KPIs fila superior ──────────── */}
      <div className="nodes-kpis" style={{marginTop: 20}}>
        <KpiTile
          label={lang==='es'?'Inventario total':'Total inventory'}
          value={fmtMoney(invValue)}
          sub={`${inventory.length} SKU`}
        />
        <KpiTile
          label={lang==='es'?'Inbound en tránsito':'Inbound in transit'}
          value={inboundTx.filter(t => t.status==='in_transit').reduce((a,t)=>a+t.units, 0).toLocaleString()}
          sub={`${inboundTx.length} ${lang==='es'?'movimientos':'moves'}`}
          icon={<IconArrow size={14} style={{color: meta.color, transform: 'rotate(180deg)'}}/>}
        />
        <KpiTile
          label={lang==='es'?'Outbound en tránsito':'Outbound in transit'}
          value={outboundTx.filter(t => t.status==='in_transit').reduce((a,t)=>a+t.units, 0).toLocaleString()}
          sub={`${outboundTx.length} ${lang==='es'?'movimientos':'moves'}`}
          icon={<IconArrow size={14} style={{color: meta.color}}/>}
        />
        <KpiTile
          label={lang==='es'?'Capacidad libre':'Free capacity'}
          value={(node.capacity_units - node.capacity_used).toLocaleString()}
          sub={`${100 - utilPct}% ${lang==='es'?'disponible':'available'}`}
          accent={utilBand === 'red'}
        />
      </div>

      {/* ── Tabs ───────────────────────── */}
      <div className="tab-bar" style={{marginTop: 24}}>
        {TABS.map(t => (
          <button key={t.k} className="tab-btn" data-active={tab === t.k} onClick={()=>setTab(t.k)}>
            {t.l}
          </button>
        ))}
      </div>

      <div className="tab-wrap">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.22, ease: 'easeOut' } }}
            exit   ={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
          >
            {tab === 'overview'    && <OverviewTab node={node} inventory={inventory} transfers={transfers} lang={lang}/>}
            {tab === 'inventory'   && <InventoryTab inventory={inventory} lang={lang}/>}
            {tab === 'transfers'   && <TransfersTab transfers={transfers} nodeId={nodeId} lang={lang}/>}
            {tab === 'automations' && <AutomationsTab autos={autos} lang={lang}/>}
            {tab === 'files'       && <FilesTab files={files} lang={lang} navigate={navigate}/>}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ─────────────── Tile auxiliar ─────────────── */
function KpiTile({ label, value, sub, icon, accent }) {
  return (
    <div className={`kpi-tile ${accent ? 'accent' : ''}`}>
      <div className="k-label">{label}</div>
      <div className="flex ai-center gap-2">
        {icon}
        <div className="k-value">{value}</div>
      </div>
      <div className="k-sub">{sub}</div>
    </div>
  );
}

/* ─────────────── Tab: Resumen ─────────────── */
function OverviewTab({ node, inventory, transfers, lang }) {
  // Top 3 SKUs por valor
  const topSkus = [...inventory].sort((a,b) => (b.value||0) - (a.value||0)).slice(0, 3);
  const caps    = node.capabilities || {};
  return (
    <div className="grid col-2 gap-3" style={{marginTop: 12}}>
      <div className="card card-pad">
        <div className="card-title">{lang==='es'?'Top SKUs por valor':'Top SKUs by value'}</div>
        {topSkus.length === 0
          ? <div className="caption" style={{marginTop: 8}}>{lang==='es'?'Sin inventario registrado.':'No inventory registered.'}</div>
          : topSkus.map(r => {
              const p = PRODUCTS.find(pp => pp.sku === r.sku);
              return (
                <div key={r.sku} className="metric-row">
                  <div>
                    <div style={{font:'600 12.5px/1.2 var(--font-mono)', color:'var(--text-primary)'}}>{r.sku}</div>
                    <div className="caption">{p?.name || '—'}</div>
                  </div>
                  <div className="mv">{fmtMoney(r.value)}</div>
                </div>
              );
            })
        }
      </div>

      <div className="card card-pad">
        <div className="card-title">{lang==='es'?'Capacidades':'Capabilities'}</div>
        <div className="cap-grid" style={{marginTop: 10}}>
          {Object.entries({
            receive: lang==='es'?'Recibir':'Receive',
            store:   lang==='es'?'Almacenar':'Store',
            prepare: lang==='es'?'Preparar':'Prepare',
            dispatch:lang==='es'?'Despachar':'Dispatch',
            report_sales: lang==='es'?'Ventas':'Sales',
            report_inventory: lang==='es'?'Inventario':'Inventory',
          }).map(([k, l]) => (
            <div key={k} className="cap-check" data-on={!!caps[k]} style={{pointerEvents:'none'}}>
              {caps[k] ? <IconCheck size={14}/> : <IconX size={14}/>}
              <span>{l}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card card-pad" style={{gridColumn: '1 / -1'}}>
        <div className="card-title">{lang==='es'?'Movimientos recientes':'Recent movements'}</div>
        <table className="table" style={{marginTop: 10}}>
          <thead><tr>
            <th>ID</th><th>Fecha</th><th>Dirección</th><th>SKUs</th><th style={{textAlign:'right'}}>Unidades</th><th>Estado</th>
          </tr></thead>
          <tbody>
            {transfers.slice(0, 5).map(t => {
              const isIn = t.to === node.id;
              return (
                <tr key={t.id}>
                  <td className="td-ref">{t.id}</td>
                  <td>{t.date}</td>
                  <td><span className={`badge ${isIn ? 'badge-info' : 'badge-mint'}`}>{isIn ? 'IN' : 'OUT'}</span></td>
                  <td>{t.skus}</td>
                  <td className="td-num">{t.units.toLocaleString()}</td>
                  <td><TransferStatus status={t.status} lang={lang}/></td>
                </tr>
              );
            })}
            {transfers.length === 0 && (
              <tr><td colSpan={6} className="caption" style={{textAlign:'center', padding:'16px 0'}}>
                {lang==='es'?'Sin movimientos registrados':'No movements recorded'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─────────────── Tab: Inventario (semáforo días stock) ─────────────── */
function InventoryTab({ inventory, lang }) {
  const totalValue = inventory.reduce((a,r)=>a+(r.value||0), 0);
  const totalUnits = inventory.reduce((a,r)=>a+(r.qty||0),  0);
  return (
    <div className="card" style={{marginTop: 12}}>
      <div className="card-head">
        <div>
          <div className="card-title">{lang==='es'?'Inventario en tiempo real':'Real-time inventory'}</div>
          <div className="card-subtitle">
            {inventory.length} SKU · {totalUnits.toLocaleString()} u. · {fmtMoney(totalValue)}
          </div>
        </div>
        <button className="btn btn-secondary btn-sm"><IconRefresh size={13}/> {lang==='es'?'Sincronizar':'Sync'}</button>
      </div>
      <div style={{overflowX:'auto'}}>
        <table className="table">
          <thead><tr>
            <th>SKU</th>
            <th>{lang==='es'?'Producto':'Product'}</th>
            <th style={{textAlign:'right'}}>{lang==='es'?'Cant.':'Qty'}</th>
            <th style={{textAlign:'right'}}>{lang==='es'?'Valor':'Value'}</th>
            <th style={{width:220}}>{lang==='es'?'Días de stock':'Days of stock'}</th>
          </tr></thead>
          <tbody>
            {inventory.map(r => {
              const p = PRODUCTS.find(pp => pp.sku === r.sku);
              const band = r.days_stock >= 35 ? 'green' : r.days_stock >= 21 ? 'amber' : 'red';
              const bandLabel = band === 'green' ? (lang==='es'?'Saludable':'Healthy') : band === 'amber' ? (lang==='es'?'Seguir':'Watch') : (lang==='es'?'Resurtir':'Restock');
              return (
                <tr key={r.sku}>
                  <td style={{font:'600 12.5px/1.2 var(--font-mono)', color:'var(--interactive)'}}>{r.sku}</td>
                  <td>{p?.name || '—'}</td>
                  <td className="td-num">{r.qty.toLocaleString()}</td>
                  <td className="td-money">{fmtMoney(r.value)}</td>
                  <td>
                    <div className="flex ai-center gap-2">
                      <span className={`stock-dot dot-${band}`}/>
                      <span className="tabular">{r.days_stock}d</span>
                      <span className={`alert-chip ${band === 'green' ? 'gray' : band}`}>{bandLabel}</span>
                    </div>
                  </td>
                </tr>
              );
            })}
            {inventory.length === 0 && (
              <tr><td colSpan={5} className="caption" style={{textAlign:'center', padding:'16px 0'}}>
                {lang==='es'?'Este nodo aún no tiene inventario':'This node has no inventory yet'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─────────────── Tab: Transferencias ─────────────── */
function TransfersTab({ transfers, nodeId, lang }) {
  return (
    <div className="card" style={{marginTop: 12}}>
      <div className="card-head">
        <div>
          <div className="card-title">{lang==='es'?'Historial de transferencias':'Transfers history'}</div>
          <div className="card-subtitle">{transfers.length} {lang==='es'?'movimientos':'movements'}</div>
        </div>
      </div>
      <div style={{overflowX:'auto'}}>
        <table className="table">
          <thead><tr>
            <th>{lang==='es'?'Fecha':'Date'}</th>
            <th>ID</th>
            <th>{lang==='es'?'Dirección':'Direction'}</th>
            <th>{lang==='es'?'Origen → Destino':'From → To'}</th>
            <th style={{textAlign:'right'}}>SKUs</th>
            <th style={{textAlign:'right'}}>{lang==='es'?'Unidades':'Units'}</th>
            <th>{lang==='es'?'Estado':'Status'}</th>
          </tr></thead>
          <tbody>
            {transfers.map(t => {
              const from = NODES.find(n => n.id === t.from);
              const to   = NODES.find(n => n.id === t.to);
              const isIn = t.to === nodeId;
              return (
                <tr key={t.id}>
                  <td>{t.date}</td>
                  <td className="td-ref">{t.id}</td>
                  <td><span className={`badge ${isIn ? 'badge-info' : 'badge-mint'}`}>{isIn ? 'IN' : 'OUT'}</span></td>
                  <td>
                    <span>{from?.node_id || '—'}</span>
                    <span style={{color:'var(--text-tertiary)', margin:'0 6px'}}>→</span>
                    <span>{to?.node_id || '—'}</span>
                  </td>
                  <td className="td-num">{t.skus}</td>
                  <td className="td-num">{t.units.toLocaleString()}</td>
                  <td><TransferStatus status={t.status} lang={lang}/></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TransferStatus({ status, lang }) {
  const M = {
    planned:    { cls: 'badge-neutral', l: lang==='es'?'Planificada':'Planned' },
    approved:   { cls: 'badge-info',    l: lang==='es'?'Aprobada':'Approved'   },
    in_transit: { cls: 'badge-warning', l: lang==='es'?'En tránsito':'In transit' },
    received:   { cls: 'badge-success', l: lang==='es'?'Recibida':'Received'   },
  };
  const m = M[status] || M.planned;
  return <span className={`badge ${m.cls}`}><span className="dot"/>{m.l}</span>;
}

/* ─────────────── Tab: Automatizaciones ─────────────── */
function AutomationsTab({ autos, lang }) {
  return (
    <div className="card card-pad" style={{marginTop: 12}}>
      <div className="card-title">{lang==='es'?'Automatizaciones ancladas':'Anchored automations'}</div>
      <div className="card-subtitle">
        {lang==='es'?'Reglas y jobs corriendo en este nodo':'Rules and jobs running on this node'}
      </div>
      <div className="auto-list" style={{marginTop: 14}}>
        {autos.map(a => (
          <div key={a.id} className="auto-row" data-state={a.state}>
            <div className="auto-row-icon"><IconSparkle size={14}/></div>
            <div style={{flex:1, minWidth:0}}>
              <div className="heading-sm" style={{color:'var(--text-primary)'}}>{a.name}</div>
              <div className="caption"><IconClock size={11}/> {a.cadence}</div>
            </div>
            <span className={`badge ${a.state === 'active' ? 'badge-success' : 'badge-neutral'}`}>
              <span className="dot"/>{a.state === 'active' ? 'Activa' : 'Pausada'}
            </span>
          </div>
        ))}
        {autos.length === 0 && (
          <div className="empty-state">
            <IconSparkle size={20} style={{color:'var(--brand-accent)'}}/>
            <div className="caption">{lang==='es'?'Este nodo no tiene automatizaciones activas.':'No automations attached.'}</div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────── Tab: Expedientes ─────────────── */
function FilesTab({ files, lang, navigate }) {
  const openExp = (eid) => {
    const oc = OCS.find(o => o.expedientes.includes(eid));
    if (oc) navigate(`/expedientes/${oc.id}/exp/${eid}`);
  };
  return (
    <div className="card" style={{marginTop: 12}}>
      <div className="card-head">
        <div>
          <div className="card-title">{lang==='es'?'Expedientes vinculados':'Linked files'}</div>
          <div className="card-subtitle">
            {lang==='es'
              ? 'Expedientes recientes cuyo destino coincide con este nodo.'
              : 'Recent files whose destination matches this node.'}
          </div>
        </div>
      </div>
      <table className="table">
        <thead><tr>
          <th>Ref</th>
          <th>{lang==='es'?'Cliente':'Client'}</th>
          <th>{lang==='es'?'Marca':'Brand'}</th>
          <th>{lang==='es'?'Estado':'Status'}</th>
          <th style={{textAlign:'right'}}>{lang==='es'?'Facturado':'Invoiced'}</th>
          <th style={{width:40}}/>
        </tr></thead>
        <tbody>
          {files.map(e => (
            <tr key={e.id} onClick={()=>openExp(e.id)} style={{cursor:'pointer'}}>
              <td className="td-ref">{e.ref}</td>
              <td>{e.client}</td>
              <td>{e.brand}</td>
              <td><span className={`badge ${e.status==='CERRADO'?'badge-success':'badge-info'}`}><span className="dot"/>{e.status}</span></td>
              <td className="td-money">{fmtMoney(e.total_invoiced)}</td>
              <td><IconArrow size={14} style={{color:'var(--text-tertiary)'}}/></td>
            </tr>
          ))}
          {files.length === 0 && (
            <tr><td colSpan={6} className="caption" style={{textAlign:'center', padding:'16px 0'}}>
              {lang==='es'?'No hay expedientes cerrados con destino en este nodo todavía.':'No closed files with destination at this node yet.'}
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
