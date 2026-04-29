// ─────────────────────────────────────────────────────────────
// Clientes B2B — Dashboard
// Agente responsable: [AG-FRONTEND]
//
// Grid animado de tarjetas (framer-motion · staggered fade-in).
// Click → /clientes/:clienteId (ClienteDetail · CEO-ONLY).
// Botón "+ Nuevo cliente" → navega a /clientes/nuevo (página full).
//
// Tokens visuales (paleta MWT extendida):
//   Navy #0B1E3A · Mint #00B286 · LightGreen #1DE394
//   Purple #481EE3 · Blue #3083FE · Cyan #1EE3D7
// ─────────────────────────────────────────────────────────────
import React, { useMemo, useState, useEffect, useCallback } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  IconPlus, IconSearch, IconUser, IconMapPin, IconMail,
  IconCreditCard, IconGlobe, IconAlert, IconShield, IconUsers,
} from "../lib/icons.jsx";
import { fmtMoney } from "../lib/i18n.js";
import { CLIENTS as MOCK_CLIENTS, EXPEDIENTES } from "../data/mockData.js";
import { clientesApi } from "../lib/api.js";
import ClientFormDrawer from "../components/clientes/ClientFormDrawer.jsx";

// ─────────────────────────────────────────────────────────────
// Adaptador backend → shape de UI.
// Backend clientes.cliente: id, razon_social, nombre_comercial, tax_id,
//   tipo(B2B/CONSUMIDOR/DISTRIBUIDOR), segmento(A/B/C), pais_iso2,
//   credito_aprobado, credito_usado, dias_credito, contacto_nombre/email/tel,
//   estado(ACTIVO/INACTIVO/BLOQUEADO), nodo_asignado_id, responsable_id,
//   visibility_tier, is_active, timestamps.
// UI espera: id, name, cliente, codigo_marluvas, country, country_code, flag,
//   canal(directo/distribuidor), estado, contacto_nombre, email,
//   credito_limit, credito_used, credito_dias, incoterm.
// ─────────────────────────────────────────────────────────────
const COUNTRY_NAME = {
  MX:"México", PE:"Perú", CO:"Colombia", CL:"Chile", PA:"Panamá",
  BR:"Brasil", CR:"Costa Rica", US:"USA", CN:"China", EC:"Ecuador",
  AR:"Argentina", DO:"R. Dominicana", ES:"España", GT:"Guatemala",
};
const FLAG_ISO = {
  MX:"🇲🇽", PE:"🇵🇪", CO:"🇨🇴", CL:"🇨🇱", PA:"🇵🇦", BR:"🇧🇷",
  CR:"🇨🇷", US:"🇺🇸", CN:"🇨🇳", EC:"🇪🇨", AR:"🇦🇷", DO:"🇩🇴",
  ES:"🇪🇸", GT:"🇬🇹",
};
function mapClienteFromApi(r) {
  return {
    id:               r.id,
    name:             r.nombre_comercial || r.razon_social || "",
    cliente:          r.razon_social || "",
    codigo_marluvas:  r.codigo_marluvas || (r.tax_id || r.id || "").toString().slice(0, 10),
    country:          COUNTRY_NAME[r.pais_iso2] || r.pais_iso2 || "",
    country_code:     r.pais_iso2 || "",
    flag:             FLAG_ISO[r.pais_iso2] || "🌐",
    canal:            r.tipo === "DISTRIBUIDOR" ? "distribuidor" : "directo",
    estado:           r.estado || (r.is_active ? "ACTIVO" : "INACTIVO"),
    contacto_nombre:  r.contacto_nombre || "—",
    email:            r.contacto_email  || "—",
    credito_limit:    Number(r.credito_aprobado) || 0,
    credito_used:     Number(r.credito_usado)    || 0,
    credito_dias:     Number(r.dias_credito)     || 0,
    incoterm:         r.incoterm || "EXW",
    // Parent-Child (sprint 2026-04-29) — badge en card
    subsidiarias_count: Number(r.subsidiarias_count || 0),
    _raw:             r,
  };
}

/* Canal → color / label */
const CHANNEL_META = {
  directo:      { label: 'Directo',      color: '#3083FE', soft: 'rgba(48,131,254,0.12)' },
  distribuidor: { label: 'Distribuidor', color: '#481EE3', soft: 'rgba(72,30,227,0.12)'  },
};

/* Estado → tono del badge */
const ESTADO_META = {
  ACTIVO:    { label: 'Activo',    className: 'badge-success' },
  PAUSADO:   { label: 'Pausado',   className: 'badge-warning' },
  BLOQUEADO: { label: 'Bloqueado', className: 'badge-danger'  },
};

export default function ScreenClientes() {
  const navigate = useNavigate();
  const { lang } = useOutletContext();

  const [q, setQ] = useState('');
  const [canalFilter, setCanalFilter]   = useState('ALL');
  const [estadoFilter, setEstadoFilter] = useState('ALL');
  const [countryFilter, setCountryFilter] = useState('ALL');
  const [showCreate, setShowCreate] = useState(false);

  // ── Fetch backend + fallback mock ──
  const [apiClients, setApiClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      // sprint Parent-Child: dashboard top-level NO incluye subsidiarias.
      // Backend default es is_parent=true, lo dejamos explícito por claridad.
      const data = await clientesApi.list({ is_parent: "true" });
      const arr  = Array.isArray(data) ? data : (data?.results || []);
      setApiClients(arr.map(mapClienteFromApi));
    } catch (e) {
      setErr(e); setApiClients([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const CLIENTS = !loading && apiClients.length > 0 ? apiClients : MOCK_CLIENTS;

  // Países únicos para filtro
  const countries = useMemo(() => {
    const set = new Map();
    CLIENTS.forEach(c => {
      if (!set.has(c.country_code)) set.set(c.country_code, { code: c.country_code, flag: c.flag, name: c.country });
    });
    return Array.from(set.values());
  }, [CLIENTS]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return CLIENTS.filter(c => {
      if (canalFilter   !== 'ALL' && c.canal   !== canalFilter)   return false;
      if (estadoFilter  !== 'ALL' && c.estado  !== estadoFilter)  return false;
      if (countryFilter !== 'ALL' && c.country_code !== countryFilter) return false;
      if (!needle) return true;
      const hay = [c.name, c.cliente, c.codigo_marluvas, c.country, c.contacto_nombre].join(' ').toLowerCase();
      return hay.includes(needle);
    });
  }, [q, canalFilter, estadoFilter, countryFilter, CLIENTS]);

  // KPIs agregados
  const kpis = useMemo(() => {
    const activos  = CLIENTS.filter(c => c.estado === 'ACTIVO').length;
    const bloqueados = CLIENTS.filter(c => c.estado === 'BLOQUEADO').length;
    const creditTotal = CLIENTS.reduce((a, c) => a + (c.credito_limit || 0), 0);
    const creditUsed  = CLIENTS.reduce((a, c) => a + (c.credito_used  || 0), 0);
    const distribuidores = CLIENTS.filter(c => c.canal === 'distribuidor').length;
    return { activos, bloqueados, creditTotal, creditUsed, distribuidores, util: creditTotal ? creditUsed/creditTotal : 0 };
  }, [CLIENTS]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="micro" style={{marginBottom:6}}>
            {lang==='es'?'RED COMERCIAL':'COMMERCIAL NETWORK'}
          </div>
          <h1 className="page-title">{lang==='es'?'Clientes':'Clients'}</h1>
          <div className="page-subtitle">
            {lang==='es'
              ? 'Distribuidores y clientes directos. Vista operativa + inteligencia de crédito, pagos y surtido.'
              : 'Distributors and direct clients. Operational view with credit, payments and assortment intelligence.'}
          </div>
        </div>
        <div className="flex ai-center gap-2">
          <button className="btn btn-accent"
                  onClick={() => navigate("/clientes/nuevo")}>
            <IconPlus size={14}/> {lang==='es' ? 'Nuevo cliente' : 'New client'}
          </button>
        </div>
      </div>

      {/* ── KPIs header ───────────── */}
      <div className="nodes-kpis">
        <div className="kpi-tile">
          <div className="k-label">{lang==='es'?'Clientes activos':'Active clients'}</div>
          <div className="k-value">{kpis.activos}</div>
          <div className="k-sub">
            <span className="dot-credit dot-green"/>
            {kpis.bloqueados} {lang==='es'?'bloqueados':'blocked'}
          </div>
        </div>
        <div className="kpi-tile">
          <div className="k-label">{lang==='es'?'Crédito total otorgado':'Total credit granted'}</div>
          <div className="k-value">{fmtMoney(kpis.creditTotal)}</div>
          <div className="k-sub">{lang==='es'?'Límite agregado de la red':'Aggregated network limit'}</div>
        </div>
        <div className="kpi-tile">
          <div className="k-label">{lang==='es'?'Utilización de crédito':'Credit utilization'}</div>
          <div className="k-value">{(kpis.util*100).toFixed(0)}%</div>
          <div className="capacity-bar-xl">
            <span style={{width:`${Math.min(100, kpis.util*100)}%`}}/>
          </div>
          <div className="k-sub">
            {fmtMoney(kpis.creditUsed)} / {fmtMoney(kpis.creditTotal)}
          </div>
        </div>
        <div className="kpi-tile accent">
          <div className="k-label">{lang==='es'?'Distribuidores':'Distributors'}</div>
          <div className="k-value">{kpis.distribuidores}</div>
          <div className="k-sub">
            {CLIENTS.length - kpis.distribuidores} {lang==='es'?'directos':'direct'}
          </div>
        </div>
      </div>

      {/* ── Filtros ───────────── */}
      <div className="nodes-filters">
        <div className="search-box" style={{flex:'1 1 260px', maxWidth: 380}}>
          <IconSearch size={14} className="search-icon"/>
          <input className="input" value={q} onChange={e=>setQ(e.target.value)}
                 placeholder={lang==='es'?'Buscar por nombre, SAP, país o contacto…':'Search by name, SAP, country or contact…'}/>
        </div>
        <div className="seg">
          <button data-active={canalFilter==='ALL'}          onClick={()=>setCanalFilter('ALL')}>Todos</button>
          <button data-active={canalFilter==='directo'}      onClick={()=>setCanalFilter('directo')}>Directo</button>
          <button data-active={canalFilter==='distribuidor'} onClick={()=>setCanalFilter('distribuidor')}>Distribuidor</button>
        </div>
        <div className="seg">
          <button data-active={estadoFilter==='ALL'}       onClick={()=>setEstadoFilter('ALL')}>{lang==='es'?'Todos':'All'}</button>
          <button data-active={estadoFilter==='ACTIVO'}    onClick={()=>setEstadoFilter('ACTIVO')}>Activo</button>
          <button data-active={estadoFilter==='PAUSADO'}   onClick={()=>setEstadoFilter('PAUSADO')}>Pausado</button>
          <button data-active={estadoFilter==='BLOQUEADO'} onClick={()=>setEstadoFilter('BLOQUEADO')}>Bloqueado</button>
        </div>
        <div className="seg" style={{flexWrap:'wrap'}}>
          <button data-active={countryFilter==='ALL'} onClick={()=>setCountryFilter('ALL')}>🌐</button>
          {countries.map(c => (
            <button key={c.code} data-active={countryFilter===c.code}
                    onClick={()=>setCountryFilter(c.code)} title={c.name}>
              {c.flag} {c.code}
            </button>
          ))}
        </div>
      </div>

      {/* ── Grid de cards ───────── */}
      <div className="clients-grid">
        <AnimatePresence mode="popLayout">
          {filtered.map((c, idx) => {
            const channel = CHANNEL_META[c.canal] || CHANNEL_META.directo;
            const estado  = ESTADO_META[c.estado] || ESTADO_META.ACTIVO;
            const util    = c.credito_limit ? (c.credito_used / c.credito_limit) : 0;
            const utilPct = Math.round(util * 100);
            const creditBand = utilPct >= 100 ? 'critical' : utilPct >= 85 ? 'warning' : 'ok';
            const activeExps = EXPEDIENTES.filter(e => e.client_id === c.id && e.status !== 'CERRADO').length;

            return (
              <motion.div
                key={c.id}
                layout
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0, transition: { delay: idx * 0.04, duration: 0.26, ease: 'easeOut' } }}
                exit={{ opacity: 0, y: -8, transition: { duration: 0.15 } }}
                whileHover={{ y: -3 }}
                className="client-card"
                data-estado={c.estado}
                onClick={()=>navigate(`/clientes/${c.id}`)}
                style={{ '--channel-color': channel.color, '--channel-soft': channel.soft }}
              >
                <div className="client-card-accent"/>

                {/* Header (sin círculo de bandera — el país ya aparece debajo del nombre) */}
                <div className="client-card-head">
                  <div style={{flex:1, minWidth:0}}>
                    <div className="client-name" title={c.cliente}>{c.name}</div>
                    <div className="client-loc">
                      <IconMapPin size={11}/>
                      <span>{c.country}</span>
                    </div>
                  </div>
                  <span className={`badge ${estado.className}`}>
                    <span className="dot"/>{estado.label}
                  </span>
                </div>

                {/* SAP + canal */}
                <div className="client-card-meta">
                  <div className="sap-code" title="Código SAP (Marluvas)">
                    <span className="sap-label">SAP</span>
                    <span className="mono-sm">{c.codigo_marluvas}</span>
                  </div>
                  <span className="channel-badge">
                    <span className="channel-dot" style={{background: channel.color}}/>
                    {channel.label}
                  </span>
                </div>

                {/* Contacto */}
                <div className="client-contact">
                  <div className="cc-row">
                    <IconUser size={11}/>
                    <span className="cc-v" title={c.contacto_nombre}>{c.contacto_nombre}</span>
                  </div>
                  <div className="cc-row">
                    <IconMail size={11}/>
                    <span className="cc-v mono-sm" title={c.email}>{c.email}</span>
                  </div>
                </div>

                {/* Credit health */}
                <div className="client-credit">
                  <div className="credit-line">
                    <span className="caption">
                      <IconCreditCard size={11} style={{marginRight:4, verticalAlign:'-1px'}}/>
                      {lang==='es'?'Crédito':'Credit'}
                    </span>
                    <span className={`credit-pct band-${creditBand}`}>{utilPct}%</span>
                  </div>
                  <div className={`credit-bar band-${creditBand}`}>
                    <span style={{width:`${Math.min(100, utilPct)}%`}}/>
                  </div>
                  <div className="caption" style={{marginTop: 4, display:'flex', justifyContent:'space-between'}}>
                    <span>{fmtMoney(c.credito_used)} / {fmtMoney(c.credito_limit)}</span>
                    <span style={{color:'var(--text-tertiary)'}}>{c.credito_dias}d</span>
                  </div>
                </div>

                {/* Footer: expedientes activos + subsidiarias + incoterm */}
                <div className="client-card-foot">
                  <span className="footstat">
                    <strong>{activeExps}</strong>
                    <span className="caption">{lang==='es'?'expedientes activos':'active files'}</span>
                  </span>
                  {c.subsidiarias_count > 0 && (
                    <span className="footstat" title={lang==='es'?'Subsidiarias del cliente':'Client subsidiaries'}>
                      <strong style={{color:'#00B286'}}>{c.subsidiarias_count}</strong>
                      <span className="caption">{lang==='es'?'subsidiarias':'subsidiaries'}</span>
                    </span>
                  )}
                  <span className="incoterm-pill" title={`Incoterm default · ${c.incoterm}`}>
                    {c.incoterm}
                  </span>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {filtered.length === 0 && (
          <div className="empty-state" style={{gridColumn: '1 / -1'}}>
            <IconUsers size={26} style={{color:'var(--text-tertiary)'}}/>
            <div className="heading-md">{lang==='es'?'Sin resultados':'No results'}</div>
            <div className="caption">{lang==='es'?'Ajusta los filtros o limpia la búsqueda.':'Tune filters or clear search.'}</div>
          </div>
        )}
      </div>

      {/* Drawer creación DEPRECATED — "+ Nuevo cliente" ahora navega a
          /clientes/nuevo (página full-page, ver ClienteFormView.jsx).
          Este bloque queda inerte: setShowCreate nunca se dispara. */}
      <AnimatePresence>
        {false && showCreate && (
          <ClientFormDrawer
            lang={lang}
            onClose={()=>setShowCreate(false)}
            onCreated={async (payload) => {
              // UI → backend clientes.cliente. El serializer acepta los
              // campos base; incoterm / codigo_marluvas quedan fuera hasta
              // que el backend los modele.
              const body = {
                razon_social:     payload.razon_social || payload.cliente || payload.name,
                nombre_comercial: payload.nombre_comercial || payload.name || "",
                tax_id:           payload.tax_id || payload.codigo_marluvas || "",
                tipo:             payload.tipo || (payload.canal === "distribuidor" ? "DISTRIBUIDOR" : "B2B"),
                segmento:         payload.segmento || "B",
                pais_iso2:        payload.pais_iso2 || payload.country_code || "MX",
                contacto_nombre:  payload.contacto_nombre || "",
                contacto_email:   payload.email || payload.contacto_email || "",
                contacto_tel:     payload.telefono || payload.contacto_tel || "",
                credito_aprobado: Number(payload.credito_limit || payload.credito_aprobado || 0),
                credito_usado:    Number(payload.credito_used  || 0),
                dias_credito:     Number(payload.credito_dias  || payload.dias_credito || 0),
                estado:           payload.estado || "ACTIVO",
              };
              try {
                await clientesApi.create(body);
                await load();
                setShowCreate(false);
              } catch (e) {
                console.error("[clientes] create failed:", e);
                alert((lang==='es'?"Error al crear cliente: ":"Error creating client: ") + (e?.message || ""));
              }
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
