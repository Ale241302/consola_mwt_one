// ─────────────────────────────────────────────────────────────
// InventoryDashboard — Supply chain visibility
// Agente responsable: [AG-FRONTEND]
//
// KPIs cabecera (4):
//   1. Stock Total          (sub: SKUs y nodos activos)
//   2. Disponible           (sub: % del total sin reservar)
//   3. Reservado            (sub: comprometido en expedientes/transfers)
//   4. En Tránsito          (sub: unidades moviéndose entre nodos)
//
// Red de Nodos (strip horizontal compacto).
// Tabla Inventario Global con:
//   SKU · Producto · Talla · Nodo · Lote · Stock · Reservado · Disponible
//   · Vendidos · Recibido (clickable → ver movimientos)
// ─────────────────────────────────────────────────────────────
import React, { useMemo, useState, useEffect, useCallback } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  IconSwap, IconPlus, IconSearch, IconX, IconWarehouse,
  IconTruck, IconPackage, IconNetwork, IconShip, IconGrid, IconGlobe,
} from "../lib/icons.jsx";
import { TRANSFERS_IN_TRANSIT } from "../data/mockData.js";
import ReceiveBatchModal      from "../components/inventario/ReceiveBatchModal.jsx";
import StockMovementsDrawer   from "../components/inventario/StockMovementsDrawer.jsx";
import { createPortal } from "react-dom";
import { stockApi, nodosApi, nodoAssignmentsApi } from "../lib/api.js";

// ── Helpers backend → UI ────────
// El backend ahora enriquece el payload con producto_sku, producto_nombre,
// nodo_codigo, nodo_nombre — ya no necesitamos los maps externos.
function mapStockFromApi(r) {
  // Fable5 · blindaje: r puede llegar null/incompleto desde el API — `?.`
  // evita un TypeError que tumbaría toda la tabla por una fila corrupta.
  const qty      = Number(r?.cantidad_disponible || 0) + Number(r?.cantidad_reservada || 0);
  const reserved = Number(r?.cantidad_reservada || 0);
  return {
    sku:       r?.producto_sku    || (r?.producto_id ? r.producto_id.slice(0, 8) : '—'),
    product:   r?.producto_nombre || r?.producto_sku || '—',
    node:      r?.nodo_nombre     || r?.nodo_codigo  || '—',
    nodeId:    r?.nodo_id || null,
    productId: r?.producto_id || null,
    // Sprint Inbound v2 — talla del lote (granularidad por size)
    size:      r?.size || r?.talla || '',
    lot:       r?.lote || '—',
    qty,
    reserved,
    vendidos:  0,
    received:  (r?.last_movement_at || r?.updated_at || '').slice(0, 10),
    expediente: '',                                  // legacy stock no tiene exp
    _source:   'stock',
    _raw: r,
  };
}

// Sprint 2026-05-11 fix · Mapper para filas del overview de asignaciones
// (inventario.expediente_nodo_assignment). Se renderiza en la MISMA tabla
// que `mapStockFromApi`, distinguiéndose por la columna "Expediente".
function mapAllocationToInventoryRow(r) {
  // Fable5 · mismo blindaje `?.` que mapStockFromApi.
  return {
    sku:       r?.sku || '—',
    product:   r?.nombre || '—',
    node:      r?.nodo_nombre || r?.nodo_codigo || '—',
    nodeId:    r?.nodo_id || null,
    productId: r?.producto_id || null,
    size:      r?.talla || '',
    lot:       '—',                                  // assignments no usan lote
    qty:       Number(r?.qty || 0),
    reserved:  0,                                    // assignments no reservan
    vendidos:  0,
    received:  '',
    expediente: r?.expediente_codigo || '',
    expedienteId: r?.expediente_id || null,
    _source:   'allocation',
    _raw:      r,
  };
}

const NODE_TYPE_META = {
  factory:     { label:'Fábrica',    icon: IconPackage,   color:'#481EE3' },
  fiscal:      { label:'Puerto',     icon: IconShip,      color:'#3083FE' },
  warehouse:   { label:'CD',         icon: IconWarehouse, color:'#00B286' },
  distributor: { label:'Hub',        icon: IconNetwork,   color:'#1EE3D7' },
  marketplace: { label:'Marketplace',icon: IconGlobe,     color:'#B45309' },
};

export default function ScreenInventario() {
  const { lang } = useOutletContext();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [nodeFilter, setNodeFilter] = useState('ALL');
  const [receiveOpen, setReceiveOpen] = useState(false);
  // Drawer de movimientos por (nodo, producto, lote) — el usuario clickea
  // en la celda "Recibido" para ver el detalle del lote (qué movimiento
  // creó esta fila: RECEPCION, TRANSFER de origen→destino, AJUSTE, etc.).
  const [movDrawerRow, setMovDrawerRow] = useState(null);

  // ── Data desde API (fallback a mock) ────────
  const [apiStock,       setApiStock]       = useState([]);
  // Sprint 2026-05-11 fix · Filas que vienen de las asignaciones
  // (inventario.expediente_nodo_assignment) — incluyen expediente.
  const [apiAllocations, setApiAllocations] = useState([]);
  const [apiNodes,       setApiNodes]       = useState([]);
  const [loading,        setLoading]        = useState(true);

  // Fable5 · `isAlive` permite cancelar desde el efecto de montaje sin
  // perder la reutilización de load() (p.ej. refresh tras recibir lote).
  const load = useCallback(async (isAlive = () => true) => {
    setLoading(true);
    try {
      // El backend ahora enriquece /api/stock/ con sku/nombre/nodo —
      // una sola llamada sin N+1 en el FE.
      const [stockRaw, allocRaw, nodoRaw] = await Promise.all([
        stockApi.list().catch(() => []),
        nodoAssignmentsApi.allocationsOverview().catch(() => []),
        nodosApi.list().catch(() => []),
      ]);
      if (!isAlive()) return;   // Fable5 · componente desmontado: no setState
      const stockItems = Array.isArray(stockRaw) ? stockRaw : (stockRaw?.results || []);
      const allocItems = Array.isArray(allocRaw) ? allocRaw : (allocRaw?.results || []);
      const nodoItems  = Array.isArray(nodoRaw)  ? nodoRaw  : (nodoRaw?.results  || []);

      setApiStock(stockItems.map(mapStockFromApi));
      setApiAllocations(allocItems.map(mapAllocationToInventoryRow));
      setApiNodes(nodoItems.map(n => ({
        node_id: n.id,
        name:    n.nombre || n.codigo || '—',
        flag:    n.flag || '🏳️',
        type:    (n.tipo || 'warehouse').toLowerCase(),
        status:  n.is_active === false ? 'INACTIVE' : 'ACTIVE',
      })));
    } catch {
      if (!isAlive()) return;   // Fable5
      setApiStock([]);
      setApiAllocations([]);
      setApiNodes([]);
    } finally {
      if (isAlive()) setLoading(false);   // Fable5
    }
  }, []);

  // Fable5 · cancelación: si el usuario navega antes de que resuelva el
  // Promise.all, el cleanup marca alive=false y load() no toca el estado.
  useEffect(() => {
    let alive = true;
    load(() => alive);
    return () => { alive = false; };
  }, [load]);

  // Sin fallback a mock: si el backend no devuelve nada, mostramos
  // la UI con arrays vacíos (la tabla / cards muestran "Sin datos"
  // y el usuario sabe que tiene que cargar stock real).
  // Sprint 2026-05-11 fix · INVENTORY = stock legacy + allocations
  // (cada allocation se pinta como una fila con columna Expediente llena).
  const INVENTORY = useMemo(
    () => [...apiAllocations, ...apiStock],
    [apiAllocations, apiStock],
  );
  const NODES     = apiNodes;

  // ── KPIs ────────
  const kpis = useMemo(() => {
    const stockTotal = INVENTORY.reduce((a,i) => a + i.qty, 0);
    const reservado  = INVENTORY.reduce((a,i) => a + i.reserved, 0);
    const disponible = stockTotal - reservado;
    const enTransito = TRANSFERS_IN_TRANSIT.reduce((a,t) => a + t.units_total, 0);
    const lotesActivos = INVENTORY.filter(i => i.qty > 0).length;
    const skusUnicos = new Set(INVENTORY.map(i => i.sku)).size;
    const nodosActivos = NODES.filter(n => n.status === 'ACTIVE').length;
    return { stockTotal, disponible, reservado, enTransito, lotesActivos, skusUnicos, nodosActivos };
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
      // Sprint 2026-05-11 fix · expediente también participa en la búsqueda.
      return [i.sku, i.product, i.lot, i.expediente]
        .filter(Boolean).join(' ').toLowerCase().includes(needle);
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
            <IconSwap size={14}/> {lang==='es'?'Nuevo movimiento':'New transfer'}
          </button>
          {/* Sprint Inbound Engine v1 (2026-04-29):
              navega al wizard full-page en /inventario/recepcion
              en vez de abrir el drawer viejo. */}
          <button className="btn" onClick={()=>navigate('/inventario/recepcion')}>
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
        <motion.div className="kpi-tile" initial={{opacity:0,y:6}} animate={{opacity:1,y:0, transition:{delay:0.16, duration:0.25}}}>
          <div className="k-label">
            {lang==='es'?'Lotes activos':'Active lots'}
          </div>
          <div className="k-value tabular-nums" style={{color:'var(--brand-purple, #481EE3)'}}>
            {kpis.lotesActivos}
          </div>
          <div className="k-sub">
            <IconPackage size={10} style={{marginRight:4, verticalAlign:'-1px'}}/>
            {lang==='es'?'Lotes con stock disponible':'Lots with available stock'}
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
              <th>SKU</th>
              <th>{lang==='es'?'Producto':'Product'}</th>
              {/* Talla — granularidad del stock (sprint Inbound v2) */}
              <th style={{ textAlign: 'center', width: 70 }}>
                {lang==='es'?'Talla':'Size'}
              </th>
              <th>{lang==='es'?'Nodo':'Node'}</th>
              <th>{lang==='es'?'Lote':'Lot'}</th>
              <th className="ta-right">{lang==='es'?'Stock':'Stock'}</th>
              <th className="ta-right">{lang==='es'?'Reservado':'Reserved'}</th>
              <th className="ta-right">{lang==='es'?'Disponible':'Available'}</th>
              <th className="ta-right">{lang==='es'?'Vendidos':'Sold'}</th>
              {/* Recibido: click → drawer con detalle del movimiento que
                  generó esta fila (RECEPCION del nodo / TRANSFER origen→destino) */}
              <th>{lang==='es'?'Recibido':'Received'}</th>
              {/* Sprint 2026-05-11 fix · columna Expediente.
                  Solo se rellena para filas que vienen del overview de
                  asignaciones (expediente_nodo_assignment). El stock
                  legacy muestra "—". */}
              <th>{lang==='es'?'Expediente':'Expediente'}</th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence mode="popLayout">
              {rows.map((i, idx) => {
                const available = i.qty - i.reserved;
                // Sprint 2026-05-11 fix · expediente y talla suman a la
                // unicidad — sin esto colapsan filas distintas del mismo
                // SKU+nodo en diferentes (talla, expediente).
                const key = `${i._source}-${i.sku}-${i.node}-${i.lot}-${i.size || ''}-${i.expediente || ''}-${idx}`;
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
                    <td className="mono-sm" style={{fontWeight:600, color:'var(--brand-purple, #481EE3)'}}>
                      {i.sku}
                    </td>
                    <td>
                      <div className="body-sm">{i.product}</div>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {i.size
                        ? <span style={{
                            display: 'inline-block',
                            padding: '2px 10px', borderRadius: 999,
                            background: 'rgba(72,30,227,0.10)', color: '#481EE3',
                            fontSize: 11, fontWeight: 700,
                            fontFamily: 'var(--font-mono)',
                          }}>{i.size}</span>
                        : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
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
                    {/* Recibido — clickable: abre drawer con movimientos
                        del lote (RECEPCION del nodo · TRANSFER origen→destino).
                        Sprint 2026-05-11 fix · Para filas que vienen del
                        overview de asignaciones (_source='allocation') NO
                        existe `inventario.movimiento` asociado, así que
                        el drawer mostraba un mensaje confuso. Aquí, sólo
                        renderizamos texto plano (no botón). */}
                    <td>
                      {i._source === 'allocation' ? (
                        <span className="caption" style={{
                          color: 'var(--text-tertiary)',
                          fontFamily: 'var(--font-mono)', fontSize: 11.5,
                        }}>—</span>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setMovDrawerRow(i); }}
                          title={lang==='es' ? 'Ver detalle del lote' : 'View lot detail'}
                          style={{
                            display:'inline-flex', alignItems:'center', gap:6,
                            background:'transparent', border:'1px solid transparent',
                            borderRadius: 6, padding:'2px 8px',
                            fontFamily:'var(--font-mono)', fontSize:11.5,
                            color:'var(--brand-purple, #481EE3)', fontWeight:600,
                            cursor:'pointer',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(72,30,227,0.06)';
                            e.currentTarget.style.borderColor = 'rgba(72,30,227,0.20)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'transparent';
                            e.currentTarget.style.borderColor = 'transparent';
                          }}
                        >
                          <span>{i.received || '—'}</span>
                          <svg width="11" height="11" viewBox="0 0 16 16" fill="none"
                               style={{ opacity: 0.65 }}>
                            <path d="M2 8s2.5-4.5 6-4.5S14 8 14 8s-2.5 4.5-6 4.5S2 8 2 8z"
                                  stroke="currentColor" strokeWidth="1.4"/>
                            <circle cx="8" cy="8" r="1.8" fill="currentColor"/>
                          </svg>
                        </button>
                      )}
                    </td>
                    {/* Sprint 2026-05-11 fix · expediente_codigo
                        (sólo filas con _source='allocation' lo traen).
                        Click → navega al detalle del expediente
                        /expedientes/none/exp/{expedienteId}. */}
                    <td>
                      {i.expediente && i.expedienteId ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/expedientes/none/exp/${i.expedienteId}`);
                          }}
                          title={lang==='es'
                            ? 'Ver detalle del expediente'
                            : 'View expediente detail'}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            background: 'transparent',
                            border: '1px solid transparent',
                            borderRadius: 6, padding: '2px 8px',
                            fontFamily: 'var(--font-mono)', fontSize: 11.5,
                            color: 'var(--brand-primary, #481EE3)', fontWeight: 600,
                            cursor: 'pointer',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(72,30,227,0.06)';
                            e.currentTarget.style.borderColor = 'rgba(72,30,227,0.20)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'transparent';
                            e.currentTarget.style.borderColor = 'transparent';
                          }}
                        >
                          {i.expediente}
                        </button>
                      ) : (
                        <span style={{ color: 'var(--text-tertiary)' }}>—</span>
                      )}
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

      {/* Drawer · Nuevo movimiento DEPRECATED — sustituido por el
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

      {/* Drawer · detalle del lote (movimientos recibidos por el nodo) */}
      {movDrawerRow && createPortal(
        <StockMovementsDrawer
          lang={lang}
          row={movDrawerRow}
          onClose={() => setMovDrawerRow(null)}
        />,
        document.body
      )}
    </div>
  );
}
