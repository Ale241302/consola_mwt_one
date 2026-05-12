// ─────────────────────────────────────────────────────────────
// NodoDetail — Dashboard operativo de un nodo logístico
// Agente responsable: [AG-FRONTEND]
//
// Tabs: Resumen (KPIs) · Inventario · Transferencias ·
//       Automatizaciones · Expedientes vinculados
// ─────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { createPortal } from "react-dom";
// Sprint 2026-05-11 fix · modal MWT para reemplazar window.confirm nativo
// en el delete de allocations de la tab Inventario.
import ConfirmModal from "../components/common/ConfirmModal.jsx";
import { useNavigate, useParams, useOutletContext } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  IconChevLeft, IconMapPin, IconPackage, IconTruck, IconRefresh,
  IconCheck, IconX, IconClock, IconDollar, IconBoxes, IconTrend,
  IconArrow, IconSparkle,
} from "../lib/icons.jsx";

// ── Definiciones compartidas con CreateNodeModal (mismas cards + iconos)
//    para que la pantalla de Edición se vea idéntica a la de Creación. ──
const TYPE_CARDS = [
  { ui:'marketplace', api:'HUB',     l:'Marketplace', hint:'Inventario consignado en Amazon, Mercado Libre, etc.' },
  { ui:'fiscal',      api:'OFICINA', l:'Fiscal',      hint:'Almacén fiscal o depósito aduanero' },
  { ui:'warehouse',   api:'ALMACEN', l:'Warehouse',   hint:'Centro de distribución propio u operado' },
  { ui:'distributor', api:'HUB',     l:'Distributor', hint:'Hub de un distribuidor regional' },
  { ui:'factory',     api:'HQ',      l:'Factory',     hint:'Planta productiva / origen de mercancía' },
];
// Mapeo inverso: backend → UI (cuando varias UI mapean al mismo API,
// preferimos la canónica: HUB → distributor, OFICINA → fiscal).
const API_TO_UI_TYPE = { HQ:'factory', OFICINA:'fiscal', ALMACEN:'warehouse', HUB:'distributor' };

const CAP_DEFS = [
  { k:'receive',          l:'Recibir',    icon: IconPackage },
  { k:'store',            l:'Almacenar',  icon: IconBoxes   },
  { k:'prepare',          l:'Preparar',   icon: IconCheck   },
  { k:'dispatch',         l:'Despachar',  icon: IconTruck   },
  { k:'report_sales',     l:'Ventas',     icon: IconDollar  },
  { k:'report_inventory', l:'Inventario', icon: IconTrend   },
];

// Estados de un nodo en el ciclo de vida (mismo orden que el catálogo
// `nodos.status_cat`). El segmentado los muestra todos para que el
// admin pueda pasar libremente entre ACTIVE ↔ INACTIVE etc.
const STATUS_OPTIONS = [
  { k:'PLANNED',  l:'Planeado'  },
  { k:'SETUP',    l:'Setup'     },
  { k:'ACTIVE',   l:'Activo'    },
  { k:'INACTIVE', l:'Inactivo'  },
  { k:'RETIRED',  l:'Retirado'  },
];
import { tr, fmtMoney } from "../lib/i18n.js";
import {
  nodosApi, stockApi, transferenciasApi, nodoAssignmentsApi,
  // Sprint 2026-05-11 fase 4 · nodoArtefactosApi (legacy de fase 2)
  // ya no se usa en esta page — el nuevo NodoArtifactsTab consume
  // nodoBuilderArtifactsApi internamente.
} from "../lib/api.js";
// Sprint 2026-05-11 · Fase 2 · tab Artefactos.
import NodoArtifactsTab from "../components/nodos/NodoArtifactsTab.jsx";
import {
  NODES, NODE_INVENTORY, NODE_TRANSFERS, NODE_AUTOMATIONS,
  LEGAL_ENTITIES, OPERATORS, PRODUCTS, EXPEDIENTES, OCS,
} from "../data/mockData.js";

// ── Backend → mock-shape adapters para tabs (Inventario / Transferencias) ──
function adaptStockRowToInventory(r) {
  return {
    sku:         r.producto_sku  || '',
    node_id:     r.nodo_id        || null,
    producto_id: r.producto_id    || null,   // necesario para link → /productos/{id}
    // Sprint Inbound v2 — granularidad por talla (size). Cada fila de
    // stock es una talla del mismo SKU; el tab "Inventario" del nodo
    // las muestra como filas separadas con su chip violeta.
    size:        r.size || r.talla || '',
    lote:        r.lote || '',
    qty:         Number(r.cantidad_disponible || 0),
    value:       Number(r.valor_disponible_usd || 0),
    // nombre de producto fallback (PRODUCTS mock no tendrá los SKUs reales)
    _producto_nombre: r.producto_nombre || '',
  };
}
const API_TO_MOCK_TRANSFER_STATUS = {
  PLANNED: 'planned', APPROVED: 'approved', IN_TRANSIT: 'in_transit',
  RECEIVED: 'received', RECONCILED: 'reconciled', CANCELLED: 'cancelled',
  DISCREPANCY: 'received',
};
function adaptApiTransferToRow(t) {
  return {
    id:         t.codigo || t.id,
    from:       t.origen_id  || null,
    to:         t.destino_id || null,
    from_label: t.origen_label  || '',
    to_label:   t.destino_label || '',
    date:       (t.dispatched_at || t.updated_at || '').slice(0, 10),
    skus:       Number(t.lines_count || 0),
    units:      Number(t.total_qty_transfer || 0),
    status:     API_TO_MOCK_TRANSFER_STATUS[t.estado] || 'planned',
  };
}

const TYPE_META = {
  marketplace: { label: 'Marketplace', color: '#481EE3' },
  fiscal:      { label: 'Fiscal',      color: '#3083FE' },
  warehouse:   { label: 'Warehouse',   color: '#00B286' },
  distributor: { label: 'Distributor', color: '#1EE3D7' },
  factory:     { label: 'Factory',     color: '#1DE394' },
};

// ── Mapeos backend → mock-shape ───────────────────────────────────
// Backend retorna `tipo` en MAYÚSCULAS (HQ/OFICINA/ALMACEN/HUB),
// el componente espera `type` en minúsculas (warehouse/factory/...).
const TIPO_TO_TYPE = {
  HQ:      'factory',
  OFICINA: 'fiscal',
  ALMACEN: 'warehouse',
  HUB:     'distributor',
};
// Banderas por país (subset; el resto cae a 🌐).
const FLAG_BY_ISO2 = {
  PE: '🇵🇪', CO: '🇨🇴', US: '🇺🇸', CN: '🇨🇳',
  MX: '🇲🇽', AR: '🇦🇷', CL: '🇨🇱', ES: '🇪🇸',
  BR: '🇧🇷', UY: '🇺🇾', EC: '🇪🇨',
};
// Adapter: toma el JSON crudo del API y produce el shape que espera
// el componente (heredado del mock). Capacidades llegan como array
// (["receive","dispatch"]) y el componente las consume como objeto
// ({receive: true, dispatch: true}).
function adaptBackendNode(raw) {
  if (!raw || !raw.id) return null;
  const capsArray = Array.isArray(raw.capabilities) ? raw.capabilities : [];
  // Normaliza a minúsculas porque algunos seeds antiguos guardan
  // RECEIVE/DISPATCH y el frontend compara con keys en minúsculas.
  const capsObj = {};
  capsArray.forEach(c => { capsObj[String(c).toLowerCase()] = true; });

  const cityCountry = [raw.ciudad, raw.pais_iso2].filter(Boolean).join(', ');
  const capUnits    = Number(raw.capacidad_m2 || 0);
  return {
    id:                raw.id,
    node_id:           raw.codigo,
    name:              raw.nombre,
    type:              TIPO_TO_TYPE[raw.tipo] || 'warehouse',
    flag:              FLAG_BY_ISO2[raw.pais_iso2] || '🌐',
    location:          cityCountry || raw.pais_iso2 || '—',
    status:            raw.status || (raw.is_active ? 'ACTIVE' : 'INACTIVE'),
    legal_entity_id:   raw.legal_entity_owner_id || null,
    operator_id:       raw.operator_id || null,
    capabilities:      capsObj,
    capacity_units:    capUnits,
    capacity_used:     0,   // TODO: cuando el endpoint de inventario consolide ocupación, sustituir.
    // mantén crudo por si tabs futuros lo quieren leer
    _raw: raw,
  };
}

const TABS = [
  { k: 'overview',    l: 'Resumen' },
  { k: 'inventory',   l: 'Inventario' },
  { k: 'transfers',   l: 'Transferencias' },
  { k: 'automations', l: 'Automatizaciones' },
  { k: 'files',       l: 'Expedientes' },
  // Sprint 2026-05-11 · Fase 2 · tab "Artefactos" — archivos arbitrarios
  // asociados al nodo (proformas, contratos 3PL, fotos de bodega, etc.).
  // Permite mismo tipo repetido y cualquier estado libre.
  { k: 'artefactos',  l: 'Artefactos' },
];

export default function ScreenNodoDetail() {
  const navigate = useNavigate();
  const { nodeId } = useParams();
  const { lang } = useOutletContext();
  const [tab, setTab] = useState('overview');
  // Sprint 2026-05-11 fix · contador para forzar refetch cross-tab.
  // InventoryTab lo incrementa después de adjust/delete; FilesTab lo
  // observa en su useEffect para re-fetch de expedientes-asignados,
  // así si el usuario borra TODAS las líneas de un expediente desde
  // Inventario, al cambiar (o incluso sin cambiar) a Expedientes ya
  // está sin esa fila.
  const [nodeRefreshKey, setNodeRefreshKey] = useState(0);
  const bumpRefresh = useCallback(() => setNodeRefreshKey((k) => k + 1), []);
  const [showEdit, setShowEdit] = useState(false);

  // ── Fetch real al backend (antes leía NODES de mockData.js,
  //    por eso nodos creados vía API daban "Nodo no encontrado") ──
  const [rawNode, setRawNode] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = () => {
    setLoading(true);
    setLoadErr(null);
    return nodosApi.get(nodeId)
      .then(data => { setRawNode(data); setLoading(false); })
      .catch(err => {
        const mockMatch = NODES.find(n => n.id === nodeId);
        if (mockMatch) {
          setRawNode({ __isMockShape: true, ...mockMatch });
        } else {
          setLoadErr(err?.message || 'fetch_failed');
        }
        setLoading(false);
      });
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadErr(null);
    nodosApi.get(nodeId)
      .then(data => { if (!cancelled) { setRawNode(data); setLoading(false); } })
      .catch(err => {
        if (cancelled) return;
        // Fallback al mock para mantener compatibilidad con IDs demo
        // que aún no están en BD (p.ej. screenshots/onboarding).
        const mockMatch = NODES.find(n => n.id === nodeId);
        if (mockMatch) {
          setRawNode({ __isMockShape: true, ...mockMatch });
        } else {
          setLoadErr(err?.message || 'fetch_failed');
        }
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [nodeId]);

  // Adapta el shape backend → forma esperada por el resto del componente.
  // Si el fallback devolvió shape mock crudo, úsalo directo.
  const node = useMemo(() => {
    if (!rawNode) return null;
    if (rawNode.__isMockShape) return rawNode;
    return adaptBackendNode(rawNode);
  }, [rawNode]);

  // Inventario y transferencias — backend real con fallback al mock para
  // nodos demo que no existen en BD (compatibilidad con onboarding/screenshots).
  const [inventory, setInventory] = useState([]);
  const [transfers, setTransfers] = useState([]);

  useEffect(() => {
    let cancelled = false;
    if (!nodeId) return;

    // Stock del nodo
    stockApi.list({ nodo: nodeId, solo_disponible: 0 })
      .then(rows => {
        if (cancelled) return;
        const real = Array.isArray(rows) ? rows.map(adaptStockRowToInventory) : [];
        if (real.length > 0) setInventory(real);
        else setInventory(NODE_INVENTORY.filter(r => r.node_id === nodeId));
      })
      .catch(() => {
        if (cancelled) return;
        setInventory(NODE_INVENTORY.filter(r => r.node_id === nodeId));
      });

    // Transferencias: nodo como origen y como destino, en paralelo
    Promise.all([
      transferenciasApi.list({ origen:  nodeId }).catch(() => []),
      transferenciasApi.list({ destino: nodeId }).catch(() => []),
    ]).then(([asOrigin, asDest]) => {
      if (cancelled) return;
      const dedup = new Map();
      for (const t of [...(asOrigin || []), ...(asDest || [])]) {
        if (t && t.id) dedup.set(t.id, t);
      }
      const merged = Array.from(dedup.values()).map(adaptApiTransferToRow);
      // Ordenar por fecha desc (id no, codigo no garantizan orden por fecha)
      merged.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      if (merged.length > 0) setTransfers(merged);
      else setTransfers(NODE_TRANSFERS.filter(t => t.from === nodeId || t.to === nodeId));
    });

    return () => { cancelled = true; };
  }, [nodeId]);

  // Automatizaciones siguen en mock (no migradas todavía)
  const autos     = useMemo(() => NODE_AUTOMATIONS.filter(a => a.node_id === nodeId), [nodeId]);
  const files     = useMemo(() =>
    EXPEDIENTES.filter(e => node && (e.destination || '').includes((node.location || '').split(',')[0] || '__none__'))
               .slice(0, 8)
  , [node]);

  if (loading) {
    return (
      <div className="page">
        <div className="empty-state">
          <IconRefresh size={20} style={{color:'var(--brand-accent)', animation:'spin 1.2s linear infinite'}}/>
          <div className="caption">{lang==='es'?'Cargando nodo…':'Loading node…'}</div>
        </div>
      </div>
    );
  }

  if (!node) {
    return (
      <div className="page">
        <div className="empty-state">
          <IconSparkle size={22} style={{color:'var(--brand-accent)'}}/>
          <div className="heading-md">{lang==='es'?'Nodo no encontrado':'Node not found'}</div>
          {loadErr && <div className="caption" style={{color:'var(--text-tertiary)'}}>{loadErr}</div>}
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
        <span style={{flex:1}}/>
        {/* "Editar" sólo aparece para nodos reales (con _raw del backend);
            los mock-only no se pueden persistir. */}
        {node._raw && (
          <button className="btn btn-secondary btn-sm" onClick={()=>setShowEdit(true)}>
            {lang==='es'?'Editar':'Edit'}
          </button>
        )}
      </div>

      <div className="node-hero" style={{ '--type-color': meta.color }}>
        {/* Círculo de bandera removido — el país aparece en node-hero-meta. */}
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
            {tab === 'inventory'   && (
              <InventoryTab
                inventory={inventory}
                lang={lang}
                nodeId={nodeId}
                refreshKey={nodeRefreshKey}
                onChanged={bumpRefresh}
                onProductClick={(r) => r.producto_id && navigate(`/productos/${r.producto_id}`)}
              />
            )}
            {tab === 'transfers'   && <TransfersTab transfers={transfers} nodeId={nodeId} lang={lang}/>}
            {tab === 'automations' && <AutomationsTab autos={autos} lang={lang}/>}
            {tab === 'files'       && <FilesTab files={files} lang={lang} navigate={navigate} nodeId={nodeId} refreshKey={nodeRefreshKey}/>}
            {/* Sprint 2026-05-11 · Fase 2 · Artefactos por nodo.
                Lista, agrega, edita y archiva archivos arbitrarios
                asociados al nodo. Soporta mismo tipo repetido y estado libre. */}
            {tab === 'artefactos'  && <NodoArtifactsTab nodeId={nodeId} lang={lang}/>}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ── Drawer de edición ───────────── */}
      <AnimatePresence>
        {showEdit && node?._raw && (
          <EditNodeDrawer
            raw={node._raw}
            lang={lang}
            onClose={()=>setShowEdit(false)}
            onSaved={async () => {
              setShowEdit(false);
              await reload();
            }}
          />
        )}
      </AnimatePresence>
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
            <th>ID</th><th>Fecha</th>
            <th>{lang==='es'?'Rol del nodo':'Node role'}</th>
            <th>{lang==='es'?'Contraparte':'Counterparty'}</th>
            <th>SKUs</th><th style={{textAlign:'right'}}>Unidades</th><th>Estado</th>
          </tr></thead>
          <tbody>
            {transfers.slice(0, 5).map(t => {
              const isIn = t.to === node.id;
              const counterpartyLabel = isIn ? (t.from_label || '—') : (t.to_label || '—');
              return (
                <tr key={t.id}>
                  <td className="td-ref">{t.id}</td>
                  <td>{t.date}</td>
                  <td>
                    <span style={{
                      display:'inline-flex', alignItems:'center', gap:6,
                      padding:'3px 10px', borderRadius:999, fontSize:11, fontWeight:700,
                      background: isIn ? 'rgba(48,131,254,0.10)' : 'rgba(0,178,134,0.10)',
                      color:    isIn ? '#3083FE' : '#00B286',
                      border:   isIn ? '1px solid rgba(48,131,254,0.30)' : '1px solid rgba(0,178,134,0.30)',
                    }}>
                      {isIn ? '↓' : '↑'}{' '}
                      {isIn
                        ? (lang==='es' ? 'RECIBIÓ' : 'RECEIVED')
                        : (lang==='es' ? 'DESPACHÓ' : 'DISPATCHED')}
                    </span>
                  </td>
                  <td>
                    <span className="caption" style={{color:'var(--text-tertiary)', marginRight:4}}>
                      {isIn ? (lang==='es'?'desde':'from') : (lang==='es'?'hacia':'to')}
                    </span>
                    <strong style={{color:'var(--text-primary,#0B1E3A)'}}>{counterpartyLabel}</strong>
                  </td>
                  <td>{t.skus}</td>
                  <td className="td-num">{t.units.toLocaleString()}</td>
                  <td><TransferStatus status={t.status} lang={lang}/></td>
                </tr>
              );
            })}
            {transfers.length === 0 && (
              <tr><td colSpan={7} className="caption" style={{textAlign:'center', padding:'16px 0'}}>
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
function InventoryTab({ inventory, lang, onProductClick, nodeId,
                        refreshKey, onChanged }) {
  // Sprint 2026-05-11 · Fase 3 · Si hay registros en
  // `inventario.expediente_nodo_assignment` para este nodo, preferimos
  // mostrar ESE inventario (incluye columna Expediente). Si la consulta
  // vuelve vacía o falla, caemos al inventario legacy (Stock).
  // Sprint 2026-05-11 fix · cantidad editable + delete in-line.
  const [allocated, setAllocated] = useState(null);  // null=loading · []=fetched
  const [savingKey, setSavingKey] = useState(null);  // celda en flight
  const [draftQty, setDraftQty]   = useState({});    // ediciones pendientes
  // Sprint 2026-05-11 fix · modal de confirmación (reemplaza window.confirm).
  // `pendingDelete` guarda la fila (o array de filas) a borrar mientras el
  // modal está abierto. Si es un array, es un bulk delete.
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleteBusy,    setDeleteBusy]    = useState(false);
  const [deleteError,   setDeleteError]   = useState(null);
  // Error inline para el editor de cantidad (reemplaza alert()).
  const [rowError, setRowError] = useState({}); // { key: 'mensaje' }
  // Sprint 2026-05-11 fix · selección masiva con checkboxes.
  const [selected, setSelected] = useState(new Set());

  const load = useCallback(() => {
    if (!nodeId) { setAllocated([]); return; }
    nodoAssignmentsApi.inventoryAllocated(nodeId)
      .then((data) => {
        const arr = Array.isArray(data) ? data : (data?.results || []);
        setAllocated(arr);
      })
      .catch(() => setAllocated([]));
  }, [nodeId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const keyOf = (r) => `${r.expediente_id}::${r.producto_id}::${r.talla || ''}`;

  const handleSave = async (r, rawValue) => {
    const k = keyOf(r);
    const newQty = Math.max(0, Math.floor(Number(rawValue) || 0));
    // Limpiar error previo de esta fila al intentar guardar de nuevo.
    setRowError((p) => { const n = { ...p }; delete n[k]; return n; });
    if (newQty === Number(r.qty || 0)) {
      // sin cambio — limpiar draft
      setDraftQty((p) => { const n = { ...p }; delete n[k]; return n; });
      return;
    }
    setSavingKey(k);
    try {
      await nodoAssignmentsApi.adjust({
        expedienteId: r.expediente_id,
        productoId:   r.producto_id,
        talla:        r.talla || '',
        nodoId:       nodeId,
        newQty,
      });
      setDraftQty((p) => { const n = { ...p }; delete n[k]; return n; });
      load();
      // Notifica al padre para que FilesTab también refetche (si el
      // ajuste deja qty=0 efectivo, el expediente se desvincula).
      onChanged?.();
    } catch (e) {
      const msg = e?.body?.detail || e?.message
        || (lang === 'es' ? 'Error al guardar' : 'Save error');
      // Reemplaza alert() — error inline justo debajo del input.
      setRowError((p) => ({ ...p, [k]: msg }));
    } finally {
      setSavingKey(null);
    }
  };

  // Sprint 2026-05-11 fix · ConfirmModal en vez de window.confirm.
  // Click en X abre el modal. Confirmar dispara la mutación; en error,
  // el modal se queda abierto mostrando el mensaje en `deleteError`.
  const requestDelete = (r) => {
    setDeleteError(null);
    setPendingDelete(r);
  };
  const cancelDelete = () => {
    if (deleteBusy) return;
    setPendingDelete(null);
    setDeleteError(null);
  };
  const confirmDelete = async () => {
    if (!pendingDelete || deleteBusy) return;
    const rows = Array.isArray(pendingDelete) ? pendingDelete : [pendingDelete];
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      // Sprint 2026-05-11 fix · bulk delete = N llamadas secuenciales al
      // endpoint adjust (no rompemos atomicity porque cada fila ya es
      // atómica del lado backend; si una falla, paramos y reportamos).
      for (const r of rows) {
        await nodoAssignmentsApi.adjust({
          expedienteId: r.expediente_id,
          productoId:   r.producto_id,
          talla:        r.talla || '',
          nodoId:       nodeId,
          newQty:       0,
        });
      }
      setPendingDelete(null);
      setSelected(new Set());
      load();
      // Notifica al padre — crítico para que FilesTab se entere de que
      // un expediente puede haber quedado sin allocations y desaparezca.
      onChanged?.();
    } catch (e) {
      setDeleteError(e?.body?.detail || e?.message
        || (lang === 'es' ? 'Error al eliminar' : 'Delete error'));
    } finally {
      setDeleteBusy(false);
    }
  };

  // Sprint 2026-05-11 fix · helpers de selección masiva.
  const requestDeleteSelected = () => {
    if (!allocated) return;
    const rows = allocated.filter((r) => selected.has(keyOf(r)));
    if (rows.length === 0) return;
    setDeleteError(null);
    setPendingDelete(rows);
  };
  const toggleSelectAll = (on) => {
    if (!allocated) return;
    if (on) setSelected(new Set(allocated.map(keyOf)));
    else    setSelected(new Set());
  };
  const toggleRow = (key, on) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(key); else next.delete(key);
      return next;
    });
  };

  // Decidimos cuál fuente renderizar.
  const useAllocated = Array.isArray(allocated) && allocated.length > 0;

  if (useAllocated) {
    const totalUnits = allocated.reduce((a, r) => a + Number(r.qty || 0), 0);
    const allChecked = allocated.length > 0
      && allocated.every((r) => selected.has(keyOf(r)));
    const someChecked = !allChecked && allocated.some((r) => selected.has(keyOf(r)));
    return (
      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-head">
          <div>
            <div className="card-title">
              {lang === 'es' ? 'Inventario asignado por expediente' : 'Inventory allocated by expediente'}
            </div>
            <div className="card-subtitle">
              {allocated.length} {lang === 'es' ? 'líneas' : 'lines'} · {totalUnits.toLocaleString()} u.
              {' · '}
              {lang === 'es'
                ? 'Edita la cantidad o elimina la línea directamente.'
                : 'Edit qty or remove the line inline.'}
            </div>
          </div>
          {selected.size > 0 && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={requestDeleteSelected}
              style={{
                background: 'var(--critical)',
                borderColor: 'var(--critical)',
                color: '#fff', fontWeight: 700,
              }}
              title={lang === 'es'
                ? 'Eliminar todas las líneas seleccionadas'
                : 'Remove all selected lines'}
            >
              <IconX size={13}/>
              {lang === 'es'
                ? `Eliminar ${selected.size} seleccionada${selected.size === 1 ? '' : 's'}`
                : `Remove ${selected.size} selected`}
            </button>
          )}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead><tr>
              <th style={{ width: 36, textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={allChecked}
                  ref={(el) => { if (el) el.indeterminate = someChecked; }}
                  onChange={(e) => toggleSelectAll(e.target.checked)}
                  title={lang === 'es' ? 'Seleccionar todo' : 'Select all'}
                />
              </th>
              <th>SKU</th>
              <th>{lang === 'es' ? 'Nombre' : 'Name'}</th>
              <th style={{ textAlign: 'center', width: 80 }}>
                {lang === 'es' ? 'Talla' : 'Size'}
              </th>
              <th style={{ textAlign: 'right', width: 130 }}>
                {lang === 'es' ? 'Cant.' : 'Qty'}
              </th>
              <th style={{ width: 140 }}>
                {lang === 'es' ? 'Expediente' : 'Expediente'}
              </th>
              <th style={{ width: 56, textAlign: 'center' }}></th>
            </tr></thead>
            <tbody>
              {allocated.map((r, i) => {
                const k = keyOf(r);
                const draft = draftQty[k];
                const value = draft !== undefined ? draft : Number(r.qty || 0);
                const busy = savingKey === k;
                const isSelected = selected.has(k);
                return (
                  <tr
                    key={`${r.producto_id}-${r.talla || ''}-${r.expediente_id}-${i}`}
                    style={isSelected ? {
                      background: 'color-mix(in oklab, var(--critical) 5%, transparent)',
                    } : undefined}
                  >
                    <td style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => toggleRow(k, e.target.checked)}
                      />
                    </td>
                    <td style={{ font: '600 12.5px/1.2 var(--font-mono)',
                                 color: 'var(--interactive)' }}>{r.sku || '—'}</td>
                    <td>{r.nombre || '—'}</td>
                    <td style={{ textAlign: 'center' }}>
                      {r.talla
                        ? <span style={{
                            display: 'inline-block', padding: '2px 10px',
                            borderRadius: 999,
                            background: 'color-mix(in oklab, var(--brand-primary, #481EE3) 12%, transparent)',
                            color: 'var(--brand-primary, #481EE3)',
                            fontSize: 11, fontWeight: 700,
                            fontFamily: 'var(--font-mono)',
                          }}>{r.talla}</span>
                        : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <input
                        type="number"
                        className="input"
                        min={0}
                        step={1}
                        value={value}
                        disabled={busy}
                        onChange={(e) => setDraftQty((p) => ({ ...p, [k]: e.target.value }))}
                        onBlur={(e) => handleSave(r, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur();
                          if (e.key === 'Escape') {
                            setDraftQty((p) => { const n = { ...p }; delete n[k]; return n; });
                            setRowError((p) => { const n = { ...p }; delete n[k]; return n; });
                            e.currentTarget.blur();
                          }
                        }}
                        style={{
                          width: 90, textAlign: 'right',
                          fontVariantNumeric: 'tabular-nums',
                          opacity: busy ? 0.5 : 1,
                          borderColor: rowError[k] ? 'var(--critical)' : undefined,
                        }}
                        title={lang === 'es'
                          ? 'Edita la cantidad y presiona Enter/Tab para guardar'
                          : 'Edit qty and press Enter/Tab to save'}
                      />
                      {/* Error inline (reemplaza alert) */}
                      {rowError[k] && (
                        <div className="caption" style={{
                          color: 'var(--critical)',
                          marginTop: 4, textAlign: 'right',
                          maxWidth: 180, marginLeft: 'auto',
                        }}>
                          {rowError[k]}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className="mono-sm" style={{ fontWeight: 600,
                                                         color: 'var(--brand-primary)' }}>
                        {r.expediente_codigo || '—'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={busy}
                        onClick={() => requestDelete(r)}
                        title={lang === 'es' ? 'Eliminar línea' : 'Remove line'}
                        style={{ color: 'var(--critical)', padding: '4px 8px' }}
                      >
                        <IconX size={13}/>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Modal MWT para confirmar el delete (reemplaza window.confirm).
            Soporta single delete (objeto) y bulk delete (array). */}
        {pendingDelete && createPortal(
          (() => {
            const isBulk = Array.isArray(pendingDelete);
            const count  = isBulk ? pendingDelete.length : 1;
            const units  = isBulk
              ? pendingDelete.reduce((a, r) => a + Number(r.qty || 0), 0)
              : Number(pendingDelete.qty || 0);
            const r      = isBulk ? null : pendingDelete;
            return (
              <ConfirmModal
                eyebrow={lang === 'es' ? 'ACCIÓN DESTRUCTIVA' : 'DESTRUCTIVE ACTION'}
                title={isBulk
                  ? (lang === 'es'
                      ? `¿Eliminar ${count} asignaciones?`
                      : `Remove ${count} allocations?`)
                  : (lang === 'es'
                      ? '¿Eliminar esta asignación?'
                      : 'Remove this allocation?')}
                body={isBulk ? (
                  <>
                    {lang === 'es' ? 'Se desasignarán ' : 'Will unassign '}
                    <strong>{units.toLocaleString()} u</strong>
                    {lang === 'es'
                      ? ` repartidas en ${count} línea(s) del nodo.`
                      : ` across ${count} line(s) of the node.`}
                    {' '}
                    {lang === 'es'
                      ? 'Las unidades vuelven al pool del expediente y quedan disponibles para asignar a otros nodos.'
                      : 'The units return to the expediente pool and become available for other nodes.'}
                  </>
                ) : (
                  <>
                    {lang === 'es' ? 'Se desasignarán ' : 'Will unassign '}
                    <strong>{units.toLocaleString()} u</strong>
                    {lang === 'es' ? ' de talla ' : ' of size '}
                    <strong>{r.talla || '—'}</strong>
                    {lang === 'es' ? ' del expediente ' : ' from expediente '}
                    <strong style={{ color: 'var(--brand-primary)' }}>
                      {r.expediente_codigo || '—'}
                    </strong>
                    {lang === 'es'
                      ? '. Las unidades vuelven a quedar disponibles para asignar a otros nodos.'
                      : '. The units become available to assign to other nodes.'}
                  </>
                )}
                actionLabel={lang === 'es' ? 'Sí, eliminar' : 'Yes, remove'}
                actionColor="#DC2626"
                cancelLabel={lang === 'es' ? 'Cancelar' : 'Cancel'}
                busy={deleteBusy}
                error={deleteError}
                onCancel={cancelDelete}
                onConfirm={confirmDelete}
              />
            );
          })(),
          document.body,
        )}
      </div>
    );
  }

  // ── Fallback legacy: Stock por nodo (no tiene columna Expediente) ──
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
            {/* Sprint Inbound v2 — granularidad por talla. */}
            <th style={{textAlign:'center', width:80}}>{lang==='es'?'Talla':'Size'}</th>
            <th style={{textAlign:'center', width:100}}>{lang==='es'?'Lote':'Lot'}</th>
            <th style={{textAlign:'right'}}>{lang==='es'?'Cant.':'Qty'}</th>
            <th style={{textAlign:'right'}}>{lang==='es'?'Valor':'Value'}</th>
          </tr></thead>
          <tbody>
            {inventory.map((r, i) => {
              const p = PRODUCTS.find(pp => pp.sku === r.sku);
              const productName = p?.name || r._producto_nombre || '—';
              const clickable = !!(r.producto_id && onProductClick);
              return (
                <tr
                  key={`${r.sku || 'row'}-${r.size || ''}-${r.lote || ''}-${i}`}
                  onClick={clickable ? () => onProductClick(r) : undefined}
                  style={clickable ? { cursor: 'pointer' } : undefined}
                  title={clickable ? (lang==='es'?'Ver detalle del producto':'View product detail') : undefined}
                >
                  <td style={{font:'600 12.5px/1.2 var(--font-mono)', color:'var(--interactive)'}}>{r.sku || '—'}</td>
                  <td>{productName}</td>
                  <td style={{textAlign:'center'}}>
                    {r.size
                      ? <span style={{
                          display:'inline-block', padding:'2px 10px', borderRadius:999,
                          background:'rgba(72,30,227,0.10)', color:'#481EE3',
                          fontSize:11, fontWeight:700,
                          fontFamily:'var(--font-mono)',
                        }}>{r.size}</span>
                      : <span style={{color:'var(--text-tertiary)'}}>—</span>}
                  </td>
                  <td style={{textAlign:'center', fontFamily:'var(--font-mono)', fontSize:11.5, color:'var(--text-tertiary)'}}>
                    {r.lote || '—'}
                  </td>
                  <td className="td-num">{(r.qty || 0).toLocaleString()}</td>
                  <td className="td-money">{fmtMoney(r.value)}</td>
                </tr>
              );
            })}
            {inventory.length === 0 && (
              <tr><td colSpan={6} className="caption" style={{textAlign:'center', padding:'16px 0'}}>
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
            <th>{lang==='es'?'Rol del nodo':'Node role'}</th>
            <th>{lang==='es'?'Contraparte':'Counterparty'}</th>
            <th>{lang==='es'?'Origen → Destino':'From → To'}</th>
            <th style={{textAlign:'right'}}>SKUs</th>
            <th style={{textAlign:'right'}}>{lang==='es'?'Unidades':'Units'}</th>
            <th>{lang==='es'?'Estado':'Status'}</th>
          </tr></thead>
          <tbody>
            {transfers.map(t => {
              const from      = NODES.find(n => n.id === t.from);
              const to        = NODES.find(n => n.id === t.to);
              const fromLabel = t.from_label || from?.node_id || '—';
              const toLabel   = t.to_label   || to?.node_id   || '—';
              const isIn      = t.to === nodeId;
              const counterpartyLabel = isIn ? fromLabel : toLabel;
              return (
                <tr key={t.id}>
                  <td>{t.date || '—'}</td>
                  <td className="td-ref">{t.id}</td>
                  <td>
                    <span style={{
                      display:'inline-flex', alignItems:'center', gap:6,
                      padding:'3px 10px', borderRadius:999, fontSize:11, fontWeight:700,
                      background: isIn ? 'rgba(48,131,254,0.10)' : 'rgba(0,178,134,0.10)',
                      color:    isIn ? '#3083FE' : '#00B286',
                      border:   isIn ? '1px solid rgba(48,131,254,0.30)' : '1px solid rgba(0,178,134,0.30)',
                    }}>
                      {isIn ? '↓' : '↑'}{' '}
                      {isIn
                        ? (lang==='es' ? 'RECIBIÓ' : 'RECEIVED')
                        : (lang==='es' ? 'DESPACHÓ' : 'DISPATCHED')}
                    </span>
                  </td>
                  <td>
                    <span className="caption" style={{color:'var(--text-tertiary)', marginRight:4}}>
                      {isIn ? (lang==='es'?'desde':'from') : (lang==='es'?'hacia':'to')}
                    </span>
                    <strong style={{color:'var(--text-primary,#0B1E3A)'}}>{counterpartyLabel}</strong>
                  </td>
                  <td>
                    <span style={{ color: isIn ? 'var(--text-tertiary)' : 'var(--text-primary,#0B1E3A)', fontWeight: isIn ? 400 : 600 }}>{fromLabel}</span>
                    <span style={{color:'var(--text-tertiary)', margin:'0 6px'}}>→</span>
                    <span style={{ color: isIn ? 'var(--text-primary,#0B1E3A)' : 'var(--text-tertiary)', fontWeight: isIn ? 600 : 400 }}>{toLabel}</span>
                  </td>
                  <td className="td-num">{t.skus}</td>
                  <td className="td-num">{(t.units || 0).toLocaleString()}</td>
                  <td><TransferStatus status={t.status} lang={lang}/></td>
                </tr>
              );
            })}
            {transfers.length === 0 && (
              <tr><td colSpan={8} className="caption" style={{textAlign:'center', padding:'16px 0'}}>
                {lang==='es'?'Sin transferencias para este nodo':'No transfers for this node'}
              </td></tr>
            )}
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
    reconciled: { cls: 'badge-mint',    l: lang==='es'?'Reconciliada':'Reconciled' },
    cancelled:  { cls: 'badge-danger',  l: lang==='es'?'Cancelada':'Cancelled'    },
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

/* ─────────────── Drawer de edición ─────────────── */
// Edita el nodo via PATCH /api/nodos/{id}/. Usa los catálogos del
// backend (select_tipos / select_status / select_paises / select_capabilities)
// para que los <select> reflejen exactamente lo que el BE acepta.
function EditNodeDrawer({ raw, lang, onClose, onSaved }) {
  // Mantenemos `type_ui` (clave UI: warehouse/factory/...) en el form
  // para alimentar el TYPE_CARDS picker. En submit lo mapeamos al
  // canónico backend (HQ/OFICINA/ALMACEN/HUB).
  const initUiType = API_TO_UI_TYPE[raw.tipo] || 'warehouse';

  const [form, setForm] = useState({
    codigo:         raw.codigo || '',
    nombre:         raw.nombre || '',
    type_ui:        initUiType,
    pais_iso2:      raw.pais_iso2 || '',
    ciudad:         raw.ciudad || '',
    direccion:      raw.direccion || '',
    zona_horaria:   raw.zona_horaria || 'America/Lima',
    status:         raw.status || 'ACTIVE',
    capabilities:   Array.isArray(raw.capabilities)
                      ? raw.capabilities.map(c => String(c).toLowerCase())
                      : [],
    capacidad_m2:   raw.capacidad_m2 ?? '',
    contacto_email: raw.contacto_email || '',
    contacto_tel:   raw.contacto_tel || '',
    observaciones:  raw.observaciones || '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState(null);

  // Catálogo de países (los demás están hardcodeados arriba con su look).
  const [paises, setPaises] = useState([]);
  useEffect(() => {
    nodosApi.select('paises').then(setPaises).catch(()=>{});
  }, []);

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const toggleCap = (codigo) => {
    setForm(f => {
      const has = f.capabilities.includes(codigo);
      return {
        ...f,
        capabilities: has
          ? f.capabilities.filter(c => c !== codigo)
          : [...f.capabilities, codigo],
      };
    });
  };

  const submit = async (e) => {
    e?.preventDefault?.();
    setBusy(true);
    setErr(null);
    try {
      // UI → API: mapeo del tipo y limpieza de campos derivados.
      const apiTipo = (TYPE_CARDS.find(c => c.ui === form.type_ui) || {}).api || 'ALMACEN';
      const body = {
        codigo:         form.codigo,
        nombre:         form.nombre,
        tipo:           apiTipo,
        pais_iso2:      form.pais_iso2,
        ciudad:         form.ciudad,
        direccion:      form.direccion,
        zona_horaria:   form.zona_horaria,
        status:         form.status,
        is_active:      form.status !== 'RETIRED' && form.status !== 'INACTIVE',
        capabilities:   form.capabilities,
        capacidad_m2:   form.capacidad_m2 === '' ? null : Number(form.capacidad_m2),
        contacto_email: form.contacto_email,
        contacto_tel:   form.contacto_tel,
        observaciones:  form.observaciones,
      };
      await nodosApi.update(raw.id, body);
      await onSaved?.();
    } catch (ex) {
      setErr(ex?.message || (lang==='es'?'Error al guardar':'Save failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(15,27,61,0.45)',
          zIndex: 90, backdropFilter: 'blur(2px)',
        }}
      />
      {/* Drawer */}
      <motion.aside
        initial={{ x: 480, opacity: 0 }}
        animate={{ x: 0, opacity: 1, transition: { duration: 0.25, ease: 'easeOut' }}}
        exit={{ x: 480, opacity: 0, transition: { duration: 0.18 }}}
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: 'min(480px, 96vw)', background: '#FFFFFF',
          boxShadow: '-12px 0 40px -10px rgba(15,27,61,0.25)',
          zIndex: 91, display: 'flex', flexDirection: 'column',
          fontFamily: 'inherit',
        }}
      >
        <div style={{
          padding: '18px 22px', borderBottom: '1px solid #EAEEF5',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{flex:1}}>
            <div className="micro" style={{ color: '#6B7894' }}>
              {lang==='es'?'EDICIÓN DE NODO':'EDIT NODE'}
            </div>
            <div style={{ font:'700 16px/1.2 inherit', color:'#0F1B3D' }}>
              {form.codigo || raw.codigo}
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>

        <form onSubmit={submit} className="drawer-body" style={{ padding: '18px 22px', overflowY:'auto', flex:1 }}>
          {/* ── Identificación ── */}
          <section className="drawer-section">
            <div className="drawer-section-title">{lang==='es'?'Identificación':'Identification'}</div>
            <div className="grid col-2 gap-3">
              <div>
                <label className="field-label">{lang==='es'?'Código':'Code'}</label>
                <input className="input mono-sm" value={form.codigo}
                       onChange={e=>setF('codigo', e.target.value.toUpperCase().slice(0, 16))}/>
              </div>
              <div>
                <label className="field-label">{lang==='es'?'Nombre':'Name'}</label>
                <input className="input" value={form.nombre}
                       onChange={e=>setF('nombre', e.target.value)}/>
              </div>
            </div>
          </section>

          {/* ── Tipo de nodo (cards) ── */}
          <section className="drawer-section">
            <div className="drawer-section-title">{lang==='es'?'Tipo':'Type'}</div>
            <div className="type-picker">
              {TYPE_CARDS.map(t => (
                <button key={t.ui} type="button"
                        className="type-chip"
                        data-active={form.type_ui === t.ui}
                        onClick={()=>setF('type_ui', t.ui)}>
                  <span className="type-chip-l">{t.l}</span>
                  <span className="type-chip-h">{t.hint}</span>
                </button>
              ))}
            </div>
          </section>

          {/* ── Localización + estado ── */}
          <section className="drawer-section">
            <div className="drawer-section-title">{lang==='es'?'Localización y estado':'Location & status'}</div>
            <div className="grid col-2 gap-3">
              <div>
                <label className="field-label">{lang==='es'?'País':'Country'}</label>
                <div className="input" style={{display:'flex', alignItems:'center', gap:8, padding:'0 12px'}}>
                  <IconMapPin size={13} style={{color:'var(--text-tertiary)'}}/>
                  <select value={form.pais_iso2} onChange={e=>setF('pais_iso2', e.target.value)}
                          style={{flex:1, border:0, background:'transparent', outline:'none', font:'inherit'}}>
                    <option value="">—</option>
                    {paises.map(p => (
                      <option key={p.codigo} value={p.codigo}>{p.label} ({p.codigo})</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="field-label">{lang==='es'?'Ciudad':'City'}</label>
                <input className="input" value={form.ciudad}
                       onChange={e=>setF('ciudad', e.target.value)}/>
              </div>
            </div>

            {/* Status segmentado — incluye TODOS los estados del catálogo
                para que el admin pueda activar/inactivar/retirar. */}
            <div style={{ marginTop: 12 }}>
              <label className="field-label">{lang==='es'?'Estado':'Status'}</label>
              <div className="seg" style={{ width:'100%', display:'grid',
                                            gridTemplateColumns:`repeat(${STATUS_OPTIONS.length}, 1fr)` }}>
                {STATUS_OPTIONS.map(s => (
                  <button key={s.k} type="button"
                          data-active={form.status === s.k}
                          onClick={()=>setF('status', s.k)}>
                    {s.k}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* ── Dirección + zona horaria + capacidad ── */}
          <section className="drawer-section">
            <div className="drawer-section-title">{lang==='es'?'Detalle físico':'Physical detail'}</div>
            <div>
              <label className="field-label">{lang==='es'?'Dirección':'Address'}</label>
              <input className="input" value={form.direccion}
                     onChange={e=>setF('direccion', e.target.value)}/>
            </div>
            <div className="grid col-2 gap-3" style={{ marginTop: 10 }}>
              <div>
                <label className="field-label">{lang==='es'?'Zona horaria':'Time zone'}</label>
                <input className="input mono-sm" value={form.zona_horaria}
                       onChange={e=>setF('zona_horaria', e.target.value)}/>
              </div>
              <div>
                <label className="field-label">{lang==='es'?'Capacidad (m²)':'Capacity (m²)'}</label>
                <input className="input" type="number" min="0" step="0.01"
                       value={form.capacidad_m2}
                       onChange={e=>setF('capacidad_m2', e.target.value)}/>
              </div>
            </div>
          </section>

          {/* ── Contacto ── */}
          <section className="drawer-section">
            <div className="drawer-section-title">{lang==='es'?'Contacto':'Contact'}</div>
            <div className="grid col-2 gap-3">
              <div>
                <label className="field-label">{lang==='es'?'Email':'Email'}</label>
                <input className="input" type="email" value={form.contacto_email}
                       onChange={e=>setF('contacto_email', e.target.value)}/>
              </div>
              <div>
                <label className="field-label">{lang==='es'?'Teléfono':'Phone'}</label>
                <input className="input" value={form.contacto_tel}
                       onChange={e=>setF('contacto_tel', e.target.value)}/>
              </div>
            </div>
          </section>

          {/* ── Capabilities (mismo cap-grid del Create) ── */}
          <section className="drawer-section">
            <div className="drawer-section-title">{lang==='es'?'Capacidades':'Capabilities'}</div>
            <div className="cap-grid">
              {CAP_DEFS.map(c => {
                const on = form.capabilities.includes(c.k);
                const Ico = c.icon;
                return (
                  <button key={c.k} type="button"
                          className="cap-check" data-on={on}
                          onClick={()=>toggleCap(c.k)}>
                    <Ico size={14}/>
                    <span>{c.l}</span>
                    {on && <IconCheck size={12} className="cap-check-tick"/>}
                  </button>
                );
              })}
            </div>
          </section>

          {/* ── Observaciones ── */}
          <section className="drawer-section">
            <div className="drawer-section-title">{lang==='es'?'Observaciones':'Notes'}</div>
            <textarea className="input" rows={3}
                      value={form.observaciones}
                      onChange={e=>setF('observaciones', e.target.value)}
                      style={{ resize:'vertical', minHeight:64 }}/>
          </section>

          {err && (
            <div style={{
              marginTop:12, padding:'10px 12px', borderRadius:8,
              background:'#FEE2E2', border:'1px solid #FCA5A5', color:'#991B1B',
              font:'500 12.5px/1.4 inherit',
            }}>
              {err}
            </div>
          )}
        </form>

        <div style={{
          padding:'14px 22px', borderTop:'1px solid #EAEEF5',
          display:'flex', gap:10, justifyContent:'flex-end',
        }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            {lang==='es'?'Cancelar':'Cancel'}
          </button>
          <button
            type="button" className="btn btn-primary" onClick={submit} disabled={busy}
          >
            {busy ? (lang==='es'?'Guardando…':'Saving…') : (lang==='es'?'Guardar cambios':'Save changes')}
          </button>
        </div>
      </motion.aside>
    </>
  );
}

/* ─────────────── Tab: Expedientes ─────────────── */
function FilesTab({ files, lang, navigate, nodeId, refreshKey }) {
  // Sprint 2026-05-11 fix · La fuente preferida son los expedientes
  // realmente asignados al nodo via `expediente_nodo_assignment`.
  // Si no hay assignments para este nodo, caemos al cálculo legacy
  // (por destino geográfico — mismo `files` que se pasaba antes).
  const [assigned, setAssigned] = useState(null);  // null=loading · []=done
  const [assignedError, setAssignedError] = useState(null);
  useEffect(() => {
    let cancel = false;
    if (!nodeId) { setAssigned([]); return; }
    setAssignedError(null);
    nodoAssignmentsApi.expedientesAsignados(nodeId)
      .then((data) => {
        if (cancel) return;
        const arr = Array.isArray(data) ? data : (data?.results || []);
        setAssigned(arr);
      })
      .catch((e) => {
        if (cancel) return;
        // En vez de caer mudo al fallback (que oculta el problema),
        // guardamos el error para mostrarlo al operador.
        setAssignedError(e?.body?.detail || e?.message
          || (lang === 'es' ? 'Error consultando expedientes asignados'
                            : 'Error fetching assigned expedientes'));
        setAssigned([]);
      });
    return () => { cancel = true; };
  }, [nodeId, lang, refreshKey]);

  const useAssigned = Array.isArray(assigned) && assigned.length > 0;

  // Si el endpoint falla, mostramos el error en un banner antes del fallback.
  if (assignedError) {
    return (
      <div className="card card-pad-lg" style={{ marginTop: 12 }}>
        <div className="micro" style={{ color: 'var(--critical)', marginBottom: 6 }}>
          {lang === 'es' ? 'ERROR' : 'ERROR'}
        </div>
        <div className="body-sm" style={{ color: 'var(--critical)' }}>
          {assignedError}
        </div>
        <div className="caption" style={{ color: 'var(--text-tertiary)', marginTop: 8 }}>
          {lang === 'es'
            ? 'Endpoint: GET /api/inventario/nodos/{id}/expedientes-asignados/'
            : 'Endpoint: GET /api/inventario/nodos/{id}/expedientes-asignados/'}
        </div>
      </div>
    );
  }

  const fmtFecha = (iso) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleDateString(
        lang === 'es' ? 'es-ES' : 'en-US',
        { year: 'numeric', month: 'short', day: '2-digit' });
    } catch { return iso; }
  };

  if (useAssigned) {
    return (
      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-head">
          <div>
            <div className="card-title">
              {lang === 'es' ? 'Expedientes asignados' : 'Assigned expedientes'}
            </div>
            <div className="card-subtitle">
              {assigned.length} {lang === 'es' ? 'expediente(s)' : 'expediente(s)'}
              {' · '}
              {lang === 'es'
                ? 'Origen del inventario que vive en este nodo.'
                : 'Source of the inventory at this node.'}
            </div>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead><tr>
              <th>{lang === 'es' ? 'Expediente' : 'Expediente'}</th>
              <th>{lang === 'es' ? 'Cliente' : 'Client'}</th>
              <th>{lang === 'es' ? 'Operador' : 'Operator'}</th>
              <th style={{ width: 130 }}>SAP</th>
              <th style={{ width: 130 }}>{lang === 'es' ? 'Proforma' : 'Proforma'}</th>
              <th style={{ width: 140 }}>{lang === 'es' ? 'OC' : 'PO'}</th>
              <th style={{ width: 130 }}>{lang === 'es' ? 'Fecha de registro' : 'Registered'}</th>
              <th style={{ textAlign: 'right', width: 100 }}>
                {lang === 'es' ? 'Unidades' : 'Units'}
              </th>
              <th style={{ width: 36 }}/>
            </tr></thead>
            <tbody>
              {assigned.map((r) => (
                <tr
                  key={r.expediente_id}
                  /* Sprint 2026-05-11 fix · El click navega a la OC
                     (vista que agrupa todos los SAPs de esa orden), no
                     al expediente individual — el CEO quiere ver el
                     contexto completo de la OC al hacer drill-down. */
                  onClick={() => r.oc_id && navigate(`/expedientes/${r.oc_id}`)}
                  style={{ cursor: r.oc_id ? 'pointer' : 'default' }}
                  title={lang === 'es' ? 'Abrir OC' : 'Open PO'}
                >
                  <td className="mono-sm" style={{ fontWeight: 700,
                                                    color: 'var(--brand-primary)' }}>
                    {r.expediente_codigo || '—'}
                  </td>
                  <td>{r.client_nombre || '—'}</td>
                  <td>{r.operating_company_nombre || '—'}</td>
                  <td className="mono-sm" style={{ color: 'var(--text-secondary)' }}>
                    {r.expediente_sap || r.oc_sap || '—'}
                  </td>
                  <td className="mono-sm" style={{ color: 'var(--text-secondary)' }}>
                    {/* Sprint 2026-05-11 fix · proforma_codigo es el field
                        real (viene de expedientes.documento via LATERAL).
                        oc_proforma queda como último fallback. */}
                    {r.proforma_codigo || r.expediente_proforma
                      || r.oc_proforma || '—'}
                  </td>
                  <td className="mono-sm" style={{ color: 'var(--text-secondary)' }}>
                    {r.oc_codigo || '—'}
                  </td>
                  <td className="caption tabular-nums">{fmtFecha(r.fecha_registro)}</td>
                  <td className="td-num tabular-nums" style={{ fontWeight: 600 }}>
                    {Number(r.qty_total_asignada || 0).toLocaleString()}
                  </td>
                  <td>
                    <IconArrow size={14} style={{ color: 'var(--text-tertiary)' }}/>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // Fallback legacy: cálculo por destino geográfico.
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
