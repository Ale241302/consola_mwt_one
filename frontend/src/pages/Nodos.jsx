// ─────────────────────────────────────────────────────────────
// Nodos Logísticos — Dashboard
// Agente responsable: [AG-FRONTEND]
//
// Grid animado de tarjetas (framer-motion · staggered fade-in).
// Click → /nodos/:nodeId (NodeDetailView).
// Botón "+ Nuevo nodo" → <CreateNodeModal/> (drawer lateral).
// ─────────────────────────────────────────────────────────────
import React, { useState, useMemo, useEffect, useCallback } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  IconPlus, IconSearch, IconMapPin, IconPackage, IconTruck,
  IconGlobe, IconBoxes, IconDollar, IconTrend, IconCheck,
} from "../lib/icons.jsx";
import { tr, fmtMoney } from "../lib/i18n.js";
// Fable5 · NODE_INVENTORY (mock) removido de los KPIs — solo quedan los
// lookups de entidad legal / operador, que el backend aún no expone.
import {
  NODES as MOCK_NODES, LEGAL_ENTITIES, OPERATORS,
} from "../data/mockData.js";
import { nodosApi } from "../lib/api.js";
import { Skeleton } from "../components/ui/Skeleton.jsx";
import CreateNodeModal from "../components/nodos/CreateNodeModal.jsx";

// ─────────────────────────────────────────────────────────────
// Adaptador backend → shape que espera esta pantalla.
// Backend (nodos.nodo):  id, codigo, nombre, tipo(HQ/OFICINA/ALMACEN/HUB),
//                        pais_iso2, ciudad, direccion, zona_horaria,
//                        responsable_id, contacto_email, contacto_tel,
//                        lat, lng, capacidad_m2, is_active, timestamps
// UI espera:             id, node_id, name, type, status, location, flag,
//                        legal_entity_id, operator_id,
//                        capacity_units, capacity_used, capabilities{}
// Los campos que no viven en el backend todavía (legal_entity_id, operator_id,
// capabilities, capacity_used) se rellenan con valores neutrales.
// ─────────────────────────────────────────────────────────────
const TIPO_API_TO_UI = {
  HQ:      "factory",
  OFICINA: "fiscal",
  ALMACEN: "warehouse",
  HUB:     "distributor",
};
const FLAG_BY_ISO = {
  MX:"🇲🇽", PE:"🇵🇪", CO:"🇨🇴", CL:"🇨🇱", PA:"🇵🇦", BR:"🇧🇷",
  CR:"🇨🇷", US:"🇺🇸", CN:"🇨🇳", EC:"🇪🇨", AR:"🇦🇷", DO:"🇩🇴",
  ES:"🇪🇸", GT:"🇬🇹", HN:"🇭🇳", NI:"🇳🇮", SV:"🇸🇻",
};
function mapNodeFromApi(r) {
  return {
    id:               r.id,
    node_id:          r.codigo || r.id?.slice(0, 8) || "",
    name:             r.nombre || "",
    type:             TIPO_API_TO_UI[r.tipo] || "warehouse",
    status:           r.is_active ? "ACTIVE" : "PLANNED",
    location:         [r.ciudad, r.pais_iso2].filter(Boolean).join(", "),
    flag:             FLAG_BY_ISO[r.pais_iso2] || "🌐",
    legal_entity_id:  null,
    operator_id:      null,
    capacity_units:   Number(r.capacidad_m2) || 0,
    capacity_used:    0,
    capabilities: {
      receive: true, store: true, prepare: false,
      dispatch: true, report_sales: false, report_inventory: true,
    },
    _raw: r,
  };
}

/* Tipos de nodo → color de acento (paleta MWT extendida) */
const TYPE_META = {
  marketplace: { label: 'Marketplace', color: '#481EE3', soft: 'rgba(72,30,227,0.10)' },
  fiscal:      { label: 'Fiscal',      color: '#3083FE', soft: 'rgba(48,131,254,0.10)' },
  warehouse:   { label: 'Warehouse',   color: '#00B286', soft: 'rgba(0,178,134,0.10)'  },
  distributor: { label: 'Distributor', color: '#1EE3D7', soft: 'rgba(30,227,215,0.14)' },
  factory:     { label: 'Factory',     color: '#1DE394', soft: 'rgba(29,227,148,0.12)' },
};

const CAPABILITIES = [
  { key: 'receive',           label: 'Recibir',     icon: IconPackage  },
  { key: 'store',             label: 'Almacenar',   icon: IconBoxes    },
  { key: 'prepare',           label: 'Preparar',    icon: IconCheck    },
  { key: 'dispatch',          label: 'Despachar',   icon: IconTruck    },
  { key: 'report_sales',      label: 'Ventas',      icon: IconDollar   },
  { key: 'report_inventory',  label: 'Inventario',  icon: IconTrend    },
];

export default function ScreenNodos() {
  const navigate = useNavigate();
  const { lang } = useOutletContext();

  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [showCreate, setShowCreate] = useState(false);

  // ── Fetch real del backend (con fallback a mock si falla/está vacío) ──
  const [apiNodes, setApiNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const data = await nodosApi.list();
      const arr  = Array.isArray(data) ? data : (data?.results || []);
      setApiNodes(arr.map(mapNodeFromApi));
    } catch (e) {
      setErr(e);
      setApiNodes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Sprint 2026-05-10 · CEO ordenó eliminar TODA fallback a mock data.
  // Si la API devuelve [] mostramos estado vacío real, no demo.
  const NODES = apiNodes;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return NODES.filter(n => {
      if (typeFilter !== 'ALL' && n.type !== typeFilter) return false;
      if (statusFilter !== 'ALL' && n.status !== statusFilter) return false;
      if (!needle) return true;
      return (n.name + ' ' + n.node_id + ' ' + n.location).toLowerCase().includes(needle);
    });
  }, [q, typeFilter, statusFilter, NODES]);

  // KPIs agregados (header)
  // Fable5 · Derivan SOLO de los nodos reales del API. El valor de
  // inventario salía del mock NODE_INVENTORY (dato falso en producción);
  // hasta que exista un endpoint de valorización, invValue queda en null
  // y el tile muestra "—".
  const kpis = useMemo(() => {
    const list     = Array.isArray(NODES) ? NODES : [];
    const active   = list.filter(n => n.status === 'ACTIVE').length;
    const planned  = list.filter(n => n.status === 'PLANNED').length;
    const invValue = null;   // sin fuente real todavía — nunca mock
    const capTotal = list.reduce((a, n) => a + (n.capacity_units || 0), 0);
    const capUsed  = list.reduce((a, n) => a + (n.capacity_used  || 0), 0);
    return { active, planned, invValue, capTotal, capUsed, util: capTotal ? (capUsed / capTotal) : 0 };
  }, [NODES]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="micro" style={{marginBottom:6}}>
            {lang==='es'?'RED LOGÍSTICA':'LOGISTIC NETWORK'}
          </div>
          <h1 className="page-title">{lang==='es'?'Nodos':'Nodes'}</h1>
          <div className="page-subtitle">
            {lang==='es'
              ? 'Puntos estructurales de la red: fábricas, almacenes fiscales, CDs, distribuidores y marketplaces.'
              : 'Structural points of the network: factories, fiscal warehouses, DCs, distributors and marketplaces.'}
          </div>
        </div>
        <div className="flex ai-center gap-2">
          <button className="btn btn-accent" onClick={()=>setShowCreate(true)}>
            <IconPlus size={14}/> {lang==='es'?'Nuevo nodo':'New node'}
          </button>
        </div>
      </div>

      {/* ── KPIs header (responsive grid) ───────────── */}
      <div className="nodes-kpis">
        <div className="kpi-tile">
          <div className="k-label">{lang==='es'?'Nodos activos':'Active nodes'}</div>
          <div className="k-value">{kpis.active}</div>
          <div className="k-sub">
            <span className="dot-credit dot-green"/>
            {kpis.planned} {lang==='es'?'planificados':'planned'}
          </div>
        </div>
        <div className="kpi-tile">
          <div className="k-label">{lang==='es'?'Inventario total':'Total inventory'}</div>
          {/* Fable5 · sin dato real de valorización: "—" en vez del mock */}
          <div className="k-value">{kpis.invValue != null ? fmtMoney(kpis.invValue) : '—'}</div>
          <div className="k-sub">{NODES.length} {lang==='es'?'nodos':'nodes'}</div>
        </div>
        <div className="kpi-tile">
          <div className="k-label">{lang==='es'?'Utilización de red':'Network utilization'}</div>
          <div className="k-value">{(kpis.util*100).toFixed(0)}%</div>
          <div className="capacity-bar-xl">
            <span style={{width:`${Math.min(100, kpis.util*100)}%`}}/>
          </div>
          <div className="k-sub">
            {kpis.capUsed.toLocaleString()} / {kpis.capTotal.toLocaleString()} u.
          </div>
        </div>
        <div className="kpi-tile accent">
          <div className="k-label">{lang==='es'?'Marketplaces conectados':'Connected marketplaces'}</div>
          <div className="k-value">{NODES.filter(n=>n.type==='marketplace').length}</div>
          <div className="k-sub">{lang==='es'?'FBA · MLF · próximos':'FBA · MLF · upcoming'}</div>
        </div>
      </div>

      {/* ── Filtros ───────────── */}
      <div className="nodes-filters">
        <div className="search-box" style={{flex:'1 1 260px', maxWidth: 360}}>
          <IconSearch size={14} className="search-icon"/>
          <input className="input" value={q} onChange={e=>setQ(e.target.value)}
                 placeholder={lang==='es'?'Buscar por nombre, código o ubicación…':'Search by name, code or location…'}/>
        </div>
        <div className="seg">
          <button data-active={typeFilter==='ALL'}         onClick={()=>setTypeFilter('ALL')}>Todos</button>
          <button data-active={typeFilter==='marketplace'} onClick={()=>setTypeFilter('marketplace')}>Marketplace</button>
          <button data-active={typeFilter==='fiscal'}      onClick={()=>setTypeFilter('fiscal')}>Fiscal</button>
          <button data-active={typeFilter==='warehouse'}   onClick={()=>setTypeFilter('warehouse')}>Warehouse</button>
          <button data-active={typeFilter==='distributor'} onClick={()=>setTypeFilter('distributor')}>Distributor</button>
          <button data-active={typeFilter==='factory'}     onClick={()=>setTypeFilter('factory')}>Factory</button>
        </div>
        <div className="seg">
          <button data-active={statusFilter==='ALL'}     onClick={()=>setStatusFilter('ALL')}>{lang==='es'?'Todos':'All'}</button>
          <button data-active={statusFilter==='ACTIVE'}  onClick={()=>setStatusFilter('ACTIVE')}>Active</button>
          <button data-active={statusFilter==='PLANNED'} onClick={()=>setStatusFilter('PLANNED')}>Planned</button>
        </div>
      </div>

      {/* ── Grid de cards (staggered fade-in) ───────── */}
      <div className="nodes-grid">
        <AnimatePresence mode="popLayout">
          {filtered.map((n, idx) => {
            const meta = TYPE_META[n.type] || TYPE_META.warehouse;
            const owner    = LEGAL_ENTITIES.find(e => e.id === n.legal_entity_id);
            const operator = OPERATORS.find(o => o.id === n.operator_id);
            const util     = n.capacity_units ? (n.capacity_used / n.capacity_units) : 0;
            const utilPct  = Math.round(util * 100);
            const utilBand = util >= 0.9 ? 'red' : util >= 0.7 ? 'amber' : 'green';
            return (
              <motion.div
                key={n.id}
                layout
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0, transition: { delay: idx * 0.04, duration: 0.26, ease: 'easeOut' } }}
                exit={{ opacity: 0, y: -8, transition: { duration: 0.15 } }}
                whileHover={{ y: -3 }}
                className="node-card"
                data-status={n.status}
                onClick={()=>navigate(`/nodos/${n.id}`)}
                style={{ '--type-color': meta.color, '--type-soft': meta.soft }}
              >
                <div className="node-card-accent"/>
                <div className="node-card-head">
                  {/* Círculo de bandera removido — el país ya está en node-loc abajo. */}
                  <div style={{flex:1, minWidth:0}}>
                    <div className="node-name">{n.name}</div>
                    <div className="node-loc">
                      <IconMapPin size={11}/>
                      <span>{n.location}</span>
                    </div>
                  </div>
                  <span className={`badge ${n.status==='ACTIVE'?'badge-success':'badge-outline'}`}>
                    <span className="dot"/>{n.status}
                  </span>
                </div>

                <div className="node-card-meta">
                  <span className="type-badge" title={meta.label}>
                    <span className="type-dot" style={{background: meta.color}}/>
                    {meta.label}
                  </span>
                  <span className="node-code">{n.node_id}</span>
                </div>

                <div className="node-card-owners">
                  <div className="ownrow">
                    <span className="ownrow-l">{lang==='es'?'Entidad legal':'Legal entity'}</span>
                    <span className="ownrow-v" title={owner?.name}>{owner?.short || '—'}</span>
                  </div>
                  <div className="ownrow">
                    <span className="ownrow-l">{lang==='es'?'Operador':'Operator'}</span>
                    <span className="ownrow-v" title={operator?.name}>{operator?.name || '—'}</span>
                  </div>
                </div>

                {/* Capacity */}
                <div className="node-card-capacity">
                  <div className="capline">
                    <span className="caption">{lang==='es'?'Capacidad':'Capacity'}</span>
                    <span className={`cap-pct band-${utilBand}`}>{utilPct}%</span>
                  </div>
                  <div className={`capacity-bar band-${utilBand}`}>
                    <span style={{width: `${Math.min(100, utilPct)}%`}}/>
                  </div>
                  <div className="caption" style={{marginTop: 4}}>
                    {n.capacity_used.toLocaleString()} / {n.capacity_units.toLocaleString()} u.
                  </div>
                </div>

                {/* Capabilities */}
                <div className="node-caps">
                  {CAPABILITIES.map(c => {
                    const on = n.capabilities?.[c.key];
                    const Ico = c.icon;
                    return (
                      <span key={c.key} className="cap-pill" data-on={on ? 'true' : 'false'} title={c.label}>
                        <Ico size={12}/>
                        <span>{c.label}</span>
                      </span>
                    );
                  })}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {loading && filtered.length === 0 &&
          Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} height={140} radius={12} />
          ))}

        {!loading && filtered.length === 0 && (
          <div className="empty-state" style={{gridColumn: '1 / -1'}}>
            <IconGlobe size={26} style={{color:'var(--text-tertiary)'}}/>
            <div className="heading-md">{lang==='es'?'Sin resultados':'No results'}</div>
            <div className="caption">{lang==='es'?'Ajusta los filtros o limpia la búsqueda.':'Tune filters or clear search.'}</div>
          </div>
        )}
      </div>

      {/* ── Drawer creación ────────────── */}
      <AnimatePresence>
        {showCreate && (
          <CreateNodeModal
            lang={lang}
            onClose={()=>setShowCreate(false)}
            onCreated={async (payload) => {
              // Map UI → backend: {node_id,name,type,country,status,capabilities,
              //                    zona_horaria,legal_entity_owner_id,operator_id}
              //               →   {codigo,nombre,tipo,pais_iso2,status,is_active,
              //                    capabilities,zona_horaria,legal_entity_owner_id,operator_id}
              const UI_TO_API_TIPO = {
                factory:     "HQ",
                fiscal:      "OFICINA",
                warehouse:   "ALMACEN",
                distributor: "HUB",
                marketplace: "HUB",
              };
              // Default TZ por país; el FE puede override si se cambia en el modal.
              const TZ_POR_PAIS = {
                PE: "America/Lima",
                CO: "America/Bogota",
                CL: "America/Santiago",
                MX: "America/Mexico_City",
                AR: "America/Argentina/Buenos_Aires",
                US: "America/New_York",
                ES: "Europe/Madrid",
              };
              // CreateNodeModal mantiene `capabilities` como objeto
              // {receive:true, store:false, ...}; el backend espera un
              // array de claves activas: ["receive","store",...].
              const capsToArray = (caps) => {
                if (Array.isArray(caps)) return caps;
                if (caps && typeof caps === "object") {
                  return Object.entries(caps)
                    .filter(([, v]) => Boolean(v))
                    .map(([k]) => k);
                }
                return [];
              };
              const body = {
                codigo:                payload.node_id,
                nombre:                payload.name,
                tipo:                  UI_TO_API_TIPO[payload.type] || "ALMACEN",
                pais_iso2:             payload.country,
                zona_horaria:          payload.zona_horaria || TZ_POR_PAIS[payload.country] || "America/Lima",
                status:                payload.status || "ACTIVE",
                is_active:             payload.status !== "RETIRED",
                capabilities:          capsToArray(payload.capabilities),
                legal_entity_owner_id: payload.legal_entity_owner_id || null,
                operator_id:           payload.operator_id || null,
              };
              try {
                await nodosApi.create(body);
                await load();     // refresca lista
                setShowCreate(false);
              } catch (e) {
                console.error("[nodos] create failed:", e);
                alert((lang==='es'?"Error al crear nodo: ":"Error creating node: ") + (e?.message || ""));
              }
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
