// ─────────────────────────────────────────────────────────────
// InventoryDashboard — Supply chain visibility
// Agente responsable: [AG-FRONTEND]
//
// KPIs cabecera (5):
//   1. Stock Total          (sub: SKUs y nodos activos)
//   2. Disponible           (sub: % del total sin reservar)
//   3. Reservado            (sub: comprometido en expedientes/transfers)
//   4. En Tránsito          (sub: unidades moviéndose entre nodos)
//   5. Alertas de Quiebre   (SKUs <21 días de stock — crítico)
//
// Red de Nodos (strip horizontal compacto).
// Tabla Inventario Global con:
//   SKU · Producto · Nodo · Lote · Stock · Reservado · Disponible · Vendidos · Recibido · Salud
// ─────────────────────────────────────────────────────────────
import React, { useMemo, useState, useEffect, useCallback } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  IconSwap, IconPlus, IconSearch, IconX, IconWarehouse, IconAlert,
  IconTruck, IconPackage, IconNetwork, IconShip, IconGrid, IconGlobe,
} from "../lib/icons.jsx";
import {
  TRANSFERS_IN_TRANSIT,   // mock provisorio hasta que haya endpoint real
  getDaysStockTier,
} from "../data/mockData.js";
import CreateTransferDrawer from "../components/inventario/CreateTransferDrawer.jsx";
import ReceiveBatchModal   from "../components/inventario/ReceiveBatchModal.jsx";
import { createPortal } from "react-dom";
import { stockApi, nodosApi } from "../lib/api.js";

// ── Helpers backend → UI ────────
// El backend ahora enriquece el payload con producto_sku, producto_nombre,
// nodo_codigo, nodo_nombre — ya no necesitamos los maps externos.
function mapStockFromApi(r) {
  const qty      = Number(r.cantidad_disponible || 0) + Number(r.cantidad_reservada || 0);
  const reserved = Number(r.cantidad_reservada || 0);
  return {
    sku:       r.producto_sku    || (r.producto_id ? r.producto_id.slice(0, 8) : '—'),
    product:   r.producto_nombre || r.producto_sku || '—',
    node:      r.nodo_nombre     || r.nodo_codigo  || '—',
    lot:       r.lote || '—',
    qty,
    reserved,
    vendidos:  0,
    received:  (r.last_movement_at || r.updated_at || '').slice(0, 10),
    days_stock: Number(r.dias_stock_minimo) || 60,
    _raw: r,
  };
}

const NODE_TYPE_META = {
  factory:     { label:'Fábrica',    icon: IconPackage,   color:'#481EE3' },
  fiscal:      { label:'Puerto',     icon: IconShip,      color:'#3083FE' },
  warehouse:   { label:'CD',         icon: IconWarehouse, color:'#00B286' },
  distributor: { label:'Hub',        icon: IconNetwork,   color:'#1EE3D7' },
  marketplace: { label:'Marketplace',icon: IconGlobe,     color:'#B45309' },
};

const HEALTH_META = {
  OK:   { color:'#00B286', soft:'rgba(0,178,134,0.12)',  label:'Saludable' },
  WARN: { color:'#B45309', soft:'rgba(180,83,9,0.12)',   label:'Vigilado' },
  CRIT: { color:'#DC2626', soft:'rgba(220,38,38,0.12)',  label:'Stockout' },
};

export default function ScreenInventario() {
  const { lang } = useOutletContext();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [nodeFilter, setNodeFilter] = useState('ALL');
  const [drawerOpen, setDrawerOpen]   = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);

  // ── Data desde API (fallback a mock) ────────
  const [apiStock,    setApiStock]    = useState([]);
  const [apiNodes,    setApiNodes]    = useState([]);
  const [loading,     setLoading]     = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // El backend ahora enriquece /api/stock/ con sku/nombre/nodo —
      // una sola llamada sin N+1 en el FE.
      const [stockRaw, nodoRaw] = await Promise.all([
        stockApi.list().catch(() => []),
        nodosApi.list().catch(() => []),
      ]);
      const stockItems = Array.isArray(stockRaw) ? stockRaw : (stockRaw?.results || []);
      const nodoItems  = Array.isArray(nodoRaw)  ? nodoRaw  : (nodoRaw?.results  || []);

      setApiStock(stockItems.map(mapStockFromApi));
      setApiNodes(nodoItems.map(n => ({
        node_id: n.id,
        name:    n.nombre || n.codigo || '—',
        flag:    n.flag || '🏳️',
        type:    (n.tipo || 'warehouse').toLowerCase(),
        status:  n.is_active === false ? 'INACTIVE' : 'ACTIVE',
      })));
    } catch {
      setApiStock([]);
      setApiNodes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Sin fallback a mock: si el backend no devuelve nada, mostramos
  // la UI con arrays vacíos (la tabla / cards muestran "Sin datos"
  // y el usuario sabe que tiene que cargar stock real).
  const INVENTORY = apiStock;
  const NODES     = apiNodes;

  // ── KPIs ────────
  const kpis = useMemo(() => {
    const stockTotal = INVENTORY.reduce((a,i) => a + i.qty, 0);
    const reservado  = INVENTORY.reduce((a,i) => a + i.reserved, 0);
    const disponible = stockTotal - reservado;
    const enTransito = TRANSFERS_IN_TRANSIT.reduce((a,t) => a + t.units_total, 0);
    const alertas    = INVENTORY.filter(i => getDaysStockTier(i.days_stock) === 'CRIT').length;
    const skusUnicos = new Set(INVENTORY.map(i => i.sku)).size;
    const nodosActivos = NODES.filter(n => n.status === 'ACTIVE').length;
    return { stockTotal, disponible, reservado, enTransito, alertas, skusUnicos, nodosActivos };
  }, [INVENTORY, NODES]);

  // ── Stock por nodo (para strip) ────────
  const nodeStats = useMemo(() => {
    return NODES
      .filter(n => n.status === 'ACTIVE')
      .map(n => {
        const rows = INVENTORY.filter(i => i.node === n.name);
        const units = rows.reduce((a,i) => a + i.qty, 0);
        const skus  = new Set(rows.map(r => r.sku)).size;
        return { node: n, units, skus };
      })
      .sort((a,b) => b.units - a.units);
  }, [INVENTORY, NODES]);

  // ── Filtrado tabla ────────
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return INVENTORY.filter(i => {
      if (nodeFilter !== 'ALL' && i.node !== nodeFilter) return false;
      if (!needle) return true;
      return [i.sku, i.product, i.lot].join(' ').toLowerCase().includes(needle);
    });
  }, [q, nodeFilter, INVENTORY]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="micro" style={{marginBottom:6}}>
            {lang==='es'?'SUPPLY CHAIN · INVENTARIO':'SUPPLY CHAIN · INVENTORY'}
          </div>
          <h1 className="page-title">{lang==='es'?'Inventario':'Inventory'}</h1>
          <div className="page-subtitle">
            {lang==='es'
              ? 'Visibilidad total de stock físico, reservas, ventas y salud de rotación en toda la red logística.'
              : 'Full visibility of physical stock, reservations, sales and rotation health across the logistic network.'}
          </div>
        </div>
        <div className="flex ai-center gap-2">
          {/* Sprint Transfer Engine v2: navega al wizard full-page en vez del drawer viejo. */}
          <button className="btn btn-accent" onClick={()=>navigate('/transferencias/nueva')}>
            <IconSwap size={14}/> {lang==='es'?'Nueva transferencia':'New transfer'}
          </button>
          <button className="btn" onClick={()=>setReceiveOpen(true)}>
            <IconPlus size={14}/> {lang==='es'?'Recibir lote':'Receive lot'}
          </button>
        </div>
      </div>

      {/* ─── KPIs ─── */}
      <div className="inv-kpi-row">
        <motion.div className="kpi-tile" initial={{opacity:0,y:6}} animate={{opacity:1,y:0, transition:{duration:0.25}}}>
          <div className="k-label">{lang==='es'?'Stock total':'Total stock'}</div>
          <div className="k-value tabular-nums">{kpis.stockTotal.toLocaleString()}</div>
          <div className="k-sub">
            <IconPackage size={10} style={{marginRight:4, verticalAlign:'-1px'}}/>
            {kpis.skusUnicos} SKUs · {kpis.nodosActivos} {lang==='es'?'nodos activos':'active nodes'}
          </div>
        </motion.div>
        <motion.div className="kpi-tile" initial={{opacity:0,y:6}} animate={{opacity:1,y:0, transition:{delay:0.04, duration:0.25}}}>
          <div className="k-label">{lang==='es'?'Disponible':'Available'}</div>
          <div className="k-value tabular-nums" style={{color:'var(--success)'}}>
            {kpis.disponible.toLocaleString()}
          </div>
          <div className="k-sub">
            {((kpis.disponible / Math.max(1, kpis.stockTotal)) * 100).toFixed(0)}% {lang==='es'?'del total sin reservar':'of total unreserved'}
          </div>
        </motion.div>
        <motion.div className="kpi-tile" initial={{opacity:0,y:6}} animate={{opacity:1,y:0, transition:{delay:0.08, duration:0.25}}}>
          <div className="k-label">{lang==='es'?'Reservado':'Reserved'}</div>
          <div className="k-value tabular-nums" style={{color:'var(--warning)'}}>
            {kpis.reservado.toLocaleString()}
          </div>
          <div className="k-sub">
            {lang==='es'?'Comprometido en expedientes y transfers':'Committed to files & transfers'}
          </div>
        </motion.div>
        <motion.div className="kpi-tile" initial={{opacity:0,y:6}} animate={{opacity:1,y:0, transition:{delay:0.12, duration:0.25}}}>
          <div className="k-label">{lang==='es'?'En tránsito':'In transit'}</div>
          <div className="k-value tabular-nums" style={{color:'var(--brand-blue, #3083FE)'}}>
            {kpis.enTransito.toLocaleString()}
          </div>
          <div className="k-sub">
            <IconTruck size={10} style={{marginRight:4, verticalAlign:'-1px'}}/>
            {TRANSFERS_IN_TRANSIT.length} {lang==='es'?'transfers activas · moviéndose entre nodos':'active transfers · moving between nodes'}
          </div>
        </motion.div>
        <motion.div className="kpi-tile kpi-alert" initial={{opacity:0,y:6}} animate={{opacity:1,y:0, transition:{delay:0.16, duration:0.25}}}>
          <div className="k-label" style={{color:'var(--critical)'}}>
            {lang==='es'?'Alertas de quiebre':'Stockout alerts'}
          </div>
          <div className="k-value tabular-nums" style={{color:'var(--critical)'}}>
            {kpis.alertas}
          </div>
          <div className="k-sub">
            <IconAlert size={10} style={{marginRight:4, verticalAlign:'-1px', color:'var(--critical)'}}/>
            {lang==='es'?'SKU·nodos con <21 días de stock':'SKU·nodes with <21d stock'}
          </div>
        </motion.div>
      </div>

      {/* ─── Red de nodos (strip horizontal) ─── */}
      <div className="inv-nodes-section">
        <div className="inv-nodes-head">
          <div>
            <div className="heading-md">{lang==='es'?'Red de nodos logísticos':'Logistic network'}</div>
            <div className="caption" style={{color:'var(--text-tertiary)'}}>
              {lang==='es'
                ? 'Click en un nodo para filtrar el inventario'
                : 'Click a node to filter inventory'}
            </div>
          </div>
          {nodeFilter !== 'ALL' && (
            <button className="filter-chip" data-active="true" onClick={()=>setNodeFilter('ALL')}>
              {nodeFilter} <IconX size={11}/>
            </button>
          )}
        </div>
        <div className="inv-nodes-strip">
          {nodeStats.map(({node, units, skus}, idx) => {
            const meta = NODE_TYPE_META[node.type] || NODE_TYPE_META.warehouse;
            const Icon = meta.icon;
            const active = nodeFilter === node.name;
            return (
              <motion.button
                key={node.node_id}
                layout
                initial={{ opacity:0, y:6 }}
                animate={{ opacity:1, y:0, transition:{ delay: idx*0.04, duration:0.24 } }}
                whileHover={{ y:-3 }}
                className={`inv-node-card ${active?'is-active':''}`}
                style={{'--node-color': meta.color}}
                onClick={()=>setNodeFilter(active ? 'ALL' : node.name)}
              >
                <div className="inv-node-head">
                  <span className="inv-node-flag">{node.flag}</span>
                  <span className="inv-node-icon">
                    <Icon size={12}/>
                  </span>
                </div>
                <div className="inv-node-name">{node.name}</div>
                <div className="inv-node-type caption">{meta.label}</div>
                <div className="inv-node-stats">
                  <div className="inv-node-units tabular-nums">{units.toLocaleString()}</div>
                  <div className="inv-node-skus caption">{skus} SKU{skus!==1?'s':''}</div>
                </div>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* ─── Filtros ─── */}
      <div className="nodes-filters">
        <div className="search-box" style={{flex:'1 1 260px', maxWidth: 420}}>
          <IconSearch size={14} className="search-icon"/>
          <input className="input" value={q} onChange={e=>setQ(e.target.value)}
                 placeholder={lang==='es'?'Buscar SKU, producto o lote…':'Search SKU, product or lot…'}/>
        </div>
        <select className="select" style={{width:200}} value={nodeFilter} onChange={e=>setNodeFilter(e.target.value)}>
          <option value="ALL">{lang==='es'?'Todos los nodos':'All nodes'}</option>
          {NODES.filter(n => n.status==='ACTIVE').map(n => (
            <option key={n.node_id} value={n.name}>{n.flag} {n.name}</option>
          ))}
        </select>
        <span className="caption tabular-nums" style={{color:'var(--text-tertiary)'}}>
          {rows.length} {lang==='es'?'filas':'rows'}
        </span>
      </div>

      {/* ─── Tabla ─── */}
      <div className="card card-pad-sm inv-table-wrap">
        <table className="inv-table">
          <thead>
            <tr>
              <th style={{width:32}}></th>
              <th>SKU</th>
              <th>{lang==='es'?'Producto':'Product'}</th>
              <th>{lang==='es'?'Nodo':'Node'}</th>
              <th>{lang==='es'?'Lote':'Lot'}</th>
              <th className="ta-right">{lang==='es'?'Stock':'Stock'}</th>
              <th className="ta-right">{lang==='es'?'Reservado':'Reserved'}</th>
              <th className="ta-right">{lang==='es'?'Disponible':'Available'}</th>
              <th className="ta-right">{lang==='es'?'Vendidos':'Sold'}</th>
              <th>{lang==='es'?'Recibido':'Received'}</th>
              <th className="ta-right">{lang==='es'?'Días':'Days'}</th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence mode="popLayout">
              {rows.map((i, idx) => {
                const available = i.qty - i.reserved;
                const tier = getDaysStockTier(i.days_stock);
                const h = HEALTH_META[tier];
                const key = `${i.sku}-${i.node}-${i.lot}`;
                return (
                  <motion.tr
                    key={key}
                    layout
                    initial={{ opacity:0, y:4 }}
                    animate={{ opacity:1, y:0, transition:{ delay: idx*0.02, duration:0.2 } }}
                    exit={{ opacity:0, y:-4, transition:{ duration:0.1 } }}
                    whileHover={{ backgroundColor:'rgba(0,178,134,0.04)' }}
                    className="inv-row"
                  >
                    <td>
                      <span className="health-dot"
                            title={h.label}
                            style={{'--dot-color': h.color}}/>
                    </td>
                    <td className="mono-sm" style={{fontWeight:600, color:'var(--brand-purple, #481EE3)'}}>
                      {i.sku}
                    </td>
                    <td>
                      <div className="body-sm">{i.product}</div>
                    </td>
                    <td>
                      <span className="inv-node-chip">
                        <IconWarehouse size={10}/> {i.node}
                      </span>
                    </td>
                    <td className="mono-sm" style={{color:'var(--text-tertiary)'}}>{i.lot}</td>
                    <td className="ta-right tabular-nums" style={{fontWeight:600}}>
                      {i.qty.toLocaleString()}
                    </td>
                    <td className="ta-right tabular-nums" style={{color:'var(--warning)'}}>
                      {i.reserved.toLocaleString()}
                    </td>
                    <td className="ta-right tabular-nums" style={{color:'var(--success)', fontWeight:600}}>
                      {available.toLocaleString()}
                    </td>
                    <td className="ta-right tabular-nums">
                      <span className="inv-sold-pill">{i.vendidos.toLocaleString()}</span>
                    </td>
                    <td className="caption mono-sm">{i.received}</td>
                    <td className="ta-right">
                      <span className="health-pill"
                            style={{'--h-color': h.color, '--h-soft': h.soft}}>
                        <span className="dot"/>
                        <span className="tabular-nums">{i.days_stock}d</span>
                      </span>
                    </td>
                  </motion.tr>
                );
              })}
            </AnimatePresence>
          </tbody>
        </table>

        {rows.length === 0 && (
          <div className="empty-state" style={{padding:'28px 12px'}}>
            <IconGrid size={24} style={{color:'var(--text-tertiary)'}}/>
            <div className="heading-md">{lang==='es'?'Sin resultados':'No results'}</div>
            <div className="caption">{lang==='es'?'Ajusta los filtros o limpia la búsqueda.':'Adjust filters or clear search.'}</div>
          </div>
        )}
      </div>

      {/* Drawer · Nueva transferencia DEPRECATED — sustituido por el
          wizard full-page /transferencias/nueva (sprint Transfer Engine v2). */}

      {/* Modal · Recibir lote */}
      {receiveOpen && createPortal(
        <ReceiveBatchModal
          lang={lang}
          onClose={()=>setReceiveOpen(false)}
          onSaved={()=>{ setReceiveOpen(false); load(); }}
        />,
        document.body
      )}
    </div>
  );
}
