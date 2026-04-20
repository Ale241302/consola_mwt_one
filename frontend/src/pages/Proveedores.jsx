// ─────────────────────────────────────────────────────────────
// SuppliersDashboard — Grid animado de proveedores (ISO 9001)
// Agente responsable: [AG-FRONTEND]
//
// Tarjeta por supplier:
//   · Nombre Comercial · País (flag)
//   · ID mono-espaciado (SUP-001)
//   · Badge Clase       CRÍTICO / IMPORTANTE / ESTÁNDAR
//   · Categoría
//   · Score ISO 1.0–5.0 con semáforo (≥4.0 Mint · 3.0–3.9 Warning · <3.0 Critical)
//   · Estado             ACTIVO · EN SELECCIÓN · DESCARTADO
//
// KPIs superiores:
//   · Total proveedores · Activos · En selección · Promedio ISO global
//
// Filtros: search + clase + status + segmented.
// Tokens: Navy · Mint · LightGreen · Purple · Blue · Cyan · Warning · Critical.
// ─────────────────────────────────────────────────────────────
import React, { useMemo, useState, useEffect, useCallback } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  IconPlus, IconSearch, IconShield, IconCheck, IconAlert,
  IconGlobe, IconTruck, IconPackage,
} from "../lib/icons.jsx";
import { fmtMoney } from "../lib/i18n.js";
import {
  SUPPLIERS as MOCK_SUPPLIERS, SUPPLIER_AUDIT_SCORES,
} from "../data/mockData.js";
import { proveedoresApi } from "../lib/api.js";

// ── Helpers de mapeo backend → UI ────────
const COUNTRY_NAME = {
  MX: 'México', AR: 'Argentina', CL: 'Chile', CO: 'Colombia', PE: 'Perú',
  UY: 'Uruguay', PY: 'Paraguay', BR: 'Brasil', US: 'Estados Unidos',
  ES: 'España', CN: 'China', IT: 'Italia', DE: 'Alemania', FR: 'Francia',
  PT: 'Portugal', VN: 'Vietnam', ID: 'Indonesia', TR: 'Turquía', IN: 'India',
};
const FLAG_ISO = {
  MX:'🇲🇽', AR:'🇦🇷', CL:'🇨🇱', CO:'🇨🇴', PE:'🇵🇪', UY:'🇺🇾', PY:'🇵🇾',
  BR:'🇧🇷', US:'🇺🇸', ES:'🇪🇸', CN:'🇨🇳', IT:'🇮🇹', DE:'🇩🇪', FR:'🇫🇷',
  PT:'🇵🇹', VN:'🇻🇳', ID:'🇮🇩', TR:'🇹🇷', IN:'🇮🇳',
};
// estado backend → status UI
const ESTADO_API_TO_UI = {
  ACTIVO:    'ACTIVO',
  PROSPECTO: 'EN_SELECCION',
  PAUSADO:   'DESCARTADO',
  INACTIVO:  'DESCARTADO',
  BLOQUEADO: 'DESCARTADO',
};
// tipo backend → clase UI (aprox.)
const TIPO_API_TO_CLASE = {
  FABRICANTE:   'CRITICO',
  IMPORTADOR:   'IMPORTANTE',
  DISTRIBUIDOR: 'IMPORTANTE',
  LOCAL:        'ESTANDAR',
};

function mapProveedorFromApi(r) {
  const iso  = (r.pais_iso2 || '').toUpperCase();
  const cats = Array.isArray(r.categorias) ? r.categorias : [];
  const cert = Array.isArray(r.certificaciones) ? r.certificaciones : [];
  const lt   = Number(r.lead_time_dias) || 0;
  return {
    id: r.codigo || r.id,
    nombre_comercial: r.nombre_comercial || r.razon_social || '',
    razon_social:     r.razon_social || '',
    pais:             COUNTRY_NAME[iso] || iso || '',
    flag:             FLAG_ISO[iso] || '🏳️',
    producto_servicio: cats[0] || '—',
    clase:  TIPO_API_TO_CLASE[r.tipo] || 'ESTANDAR',
    status: ESTADO_API_TO_UI[r.estado] || 'EN_SELECCION',
    iso_score: Number(r.rating) || 0,
    volumen_transaccionado: 0,
    expedientes_activos: 0,
    lead_time_real:     lt,
    lead_time_promised: lt,
    certs: cert,
    _raw: r,
  };
}

// ── Meta de clasificación ISO ────────
const CLASE_META = {
  CRITICO:    { label:'CRÍTICO',    color:'#DC2626', soft:'rgba(220,38,38,0.12)' },
  IMPORTANTE: { label:'IMPORTANTE', color:'#3083FE', soft:'rgba(48,131,254,0.12)' },
  ESTANDAR:   { label:'ESTÁNDAR',   color:'#64748B', soft:'rgba(100,116,139,0.12)' },
};

const STATUS_META = {
  ACTIVO:       { label:'Activo',       color:'#0E8A6D', soft:'rgba(14,138,109,0.14)' },
  EN_SELECCION: { label:'En selección', color:'#B45309', soft:'rgba(180,83,9,0.14)' },
  DESCARTADO:   { label:'Descartado',   color:'#64748B', soft:'rgba(100,116,139,0.14)' },
};

// Semáforo ISO
function scoreTier(s) {
  if (s >= 4.0) return { tier:'GREEN', color:'#00B286', label:'Sólido' };
  if (s >= 3.0) return { tier:'AMBER', color:'#B45309', label:'Vigilado' };
  return { tier:'RED', color:'#DC2626', label:'Riesgo' };
}

export default function ScreenProveedores() {
  const navigate = useNavigate();
  const { lang } = useOutletContext();

  const [q, setQ] = useState('');
  const [claseFilter, setClaseFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // ── Data desde API (fallback a mock si no hay resultados o error) ────────
  const [apiSuppliers, setApiSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await proveedoresApi.list();
      const items = Array.isArray(data) ? data : (data?.results || []);
      setApiSuppliers(items.map(mapProveedorFromApi));
    } catch {
      setApiSuppliers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const SUPPLIERS = !loading && apiSuppliers.length > 0 ? apiSuppliers : MOCK_SUPPLIERS;

  // ── KPIs agregados ────────
  const kpis = useMemo(() => {
    const total = SUPPLIERS.length;
    const activos = SUPPLIERS.filter(s => s.status === 'ACTIVO').length;
    const enSeleccion = SUPPLIERS.filter(s => s.status === 'EN_SELECCION').length;
    const activosScores = SUPPLIERS
      .filter(s => s.status === 'ACTIVO')
      .map(s => s.iso_score);
    const avgIso = activosScores.length
      ? activosScores.reduce((a,b) => a+b, 0) / activosScores.length
      : 0;
    const volumen = SUPPLIERS.reduce((a,s) => a + (s.volumen_transaccionado || 0), 0);
    return { total, activos, enSeleccion, avgIso, volumen };
  }, [SUPPLIERS]);

  // ── Filtrado ────────
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return SUPPLIERS
      .filter(s => {
        if (claseFilter !== 'ALL' && s.clase !== claseFilter) return false;
        if (statusFilter !== 'ALL' && s.status !== statusFilter) return false;
        if (!needle) return true;
        const hay = [s.id, s.nombre_comercial, s.razon_social, s.pais, s.producto_servicio].join(' ').toLowerCase();
        return hay.includes(needle);
      })
      .sort((a, b) => {
        // Activos primero, luego en selección, luego descartados; dentro de cada grupo por score desc
        const order = { ACTIVO: 0, EN_SELECCION: 1, DESCARTADO: 2 };
        const d = (order[a.status] ?? 9) - (order[b.status] ?? 9);
        if (d !== 0) return d;
        return (b.iso_score || 0) - (a.iso_score || 0);
      });
  }, [q, claseFilter, statusFilter, SUPPLIERS]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="micro" style={{marginBottom:6}}>
            {lang==='es'?'RED DE PROVEEDORES · ISO 9001':'SUPPLIER NETWORK · ISO 9001'}
          </div>
          <h1 className="page-title">{lang==='es'?'Proveedores':'Suppliers'}</h1>
          <div className="page-subtitle">
            {lang==='es'
              ? 'Gestión de proveedores con clasificación ISO, score de calidad auditado y trazabilidad completa a expedientes.'
              : 'Supplier governance with ISO classification, audited quality score, and full traceability to files.'}
          </div>
        </div>
        <div className="flex ai-center gap-2">
          <button className="btn btn-accent" onClick={()=>navigate('/proveedores/nuevo')}>
            <IconPlus size={14}/> {lang==='es'?'Nuevo proveedor':'New supplier'}
          </button>
        </div>
      </div>

      {/* ─── KPIs ─── */}
      <div className="nodes-kpis">
        <div className="kpi-tile">
          <div className="k-label">{lang==='es'?'Total proveedores':'Total suppliers'}</div>
          <div className="k-value tabular-nums">{kpis.total}</div>
          <div className="k-sub">
            <IconGlobe size={10} style={{marginRight:4, verticalAlign:'-1px'}}/>
            {lang==='es'?'Red operativa y evaluada':'Operational & evaluated'}
          </div>
        </div>
        <div className="kpi-tile">
          <div className="k-label">{lang==='es'?'Activos':'Active'}</div>
          <div className="k-value tabular-nums" style={{color:'var(--success)'}}>{kpis.activos}</div>
          <div className="k-sub">
            <IconCheck size={10} style={{marginRight:4, verticalAlign:'-1px', color:'var(--success)'}}/>
            {kpis.enSeleccion} {lang==='es'?'en evaluación':'under evaluation'}
          </div>
        </div>
        <div className="kpi-tile">
          <div className="k-label">{lang==='es'?'ISO score promedio':'Avg. ISO score'}</div>
          <div className="k-value tabular-nums" style={{color: scoreTier(kpis.avgIso).color}}>
            {kpis.avgIso.toFixed(1)}
          </div>
          <div className="k-sub">
            <IconShield size={10} style={{marginRight:4, verticalAlign:'-1px'}}/>
            {lang==='es'?'Calidad consolidada de activos':'Consolidated quality of active'}
          </div>
        </div>
        <div className="kpi-tile">
          <div className="k-label">{lang==='es'?'Volumen transaccionado':'Transacted volume'}</div>
          <div className="k-value tabular-nums">{fmtMoney(kpis.volumen)}</div>
          <div className="k-sub">
            <IconPackage size={10} style={{marginRight:4, verticalAlign:'-1px'}}/>
            {lang==='es'?'Histórico acumulado 12M':'Trailing 12M'}
          </div>
        </div>
      </div>

      {/* ─── Filtros ─── */}
      <div className="nodes-filters">
        <div className="search-box" style={{flex:'1 1 260px', maxWidth: 420}}>
          <IconSearch size={14} className="search-icon"/>
          <input className="input" value={q} onChange={e=>setQ(e.target.value)}
                 placeholder={lang==='es'?'Buscar por ID, nombre, país, producto…':'Search by ID, name, country, product…'}/>
        </div>
        <div className="seg seg-scroll">
          <button data-active={claseFilter==='ALL'} onClick={()=>setClaseFilter('ALL')}>
            {lang==='es'?'Todas las clases':'All classes'}
          </button>
          {Object.keys(CLASE_META).map(k => (
            <button key={k} data-active={claseFilter===k} onClick={()=>setClaseFilter(k)}>
              {CLASE_META[k].label}
            </button>
          ))}
        </div>
        <div className="seg seg-scroll">
          <button data-active={statusFilter==='ALL'} onClick={()=>setStatusFilter('ALL')}>
            {lang==='es'?'Todos':'All'}
          </button>
          {Object.keys(STATUS_META).map(k => (
            <button key={k} data-active={statusFilter===k} onClick={()=>setStatusFilter(k)}>
              {STATUS_META[k].label}
            </button>
          ))}
        </div>
      </div>

      {/* ─── Grid de tarjetas ─── */}
      <div className="suppliers-grid">
        <AnimatePresence mode="popLayout">
          {rows.map((s, idx) => {
            const clase = CLASE_META[s.clase] || CLASE_META.ESTANDAR;
            const status = STATUS_META[s.status] || STATUS_META.ACTIVO;
            const tier = scoreTier(s.iso_score);
            const audit = SUPPLIER_AUDIT_SCORES[s.id];
            const lastAudit = audit?.audit_date;
            const isDescarte = s.status === 'DESCARTADO';

            return (
              <motion.div
                key={s.id}
                layout
                initial={{ opacity:0, y:10 }}
                animate={{ opacity: isDescarte ? 0.72 : 1, y:0,
                           transition:{ delay: idx*0.05, type:'spring', stiffness:260, damping:30 } }}
                exit={{ opacity:0, scale:0.95, transition:{ duration:0.12 } }}
                whileHover={{ y:-4 }}
                className={`supplier-card card card-pad-md ${isDescarte?'is-descarte':''}`}
                style={{ cursor:'pointer' }}
                onClick={()=>navigate(`/proveedores/${s.id}`)}
              >
                {/* Head: flag + nombre + id */}
                <div className="sup-head">
                  <div className="sup-flag-wrap">
                    <span className="sup-flag">{s.flag}</span>
                  </div>
                  <div className="sup-head-body">
                    <div className="heading-md sup-name">{s.nombre_comercial}</div>
                    <div className="caption sup-country">{s.pais}</div>
                  </div>
                  <div className="mono-sm sup-id">{s.id}</div>
                </div>

                {/* Clase + status */}
                <div className="sup-badges">
                  <span className="sup-clase-badge"
                        style={{'--clase-color': clase.color, '--clase-soft': clase.soft}}>
                    <span className="dot"/>{clase.label}
                  </span>
                  <span className="sup-status-badge"
                        style={{'--st-color': status.color, '--st-soft': status.soft}}>
                    {status.label}
                  </span>
                </div>

                {/* Categoría */}
                <div className="sup-cat caption">{s.producto_servicio}</div>

                {/* Score + metrics */}
                <div className="sup-metrics">
                  <div className="sup-score-ring" style={{'--ring-color': tier.color}}>
                    <div className="sup-score-val tabular-nums">{s.iso_score.toFixed(1)}</div>
                    <div className="sup-score-lbl">ISO</div>
                  </div>
                  <div className="sup-mini-stats">
                    <div className="sup-mini-row">
                      <span className="caption">{lang==='es'?'Volumen':'Volume'}</span>
                      <span className="mono-sm tabular-nums">{fmtMoney(s.volumen_transaccionado)}</span>
                    </div>
                    <div className="sup-mini-row">
                      <span className="caption">{lang==='es'?'Expedientes activos':'Active files'}</span>
                      <span className="mono-sm tabular-nums">{s.expedientes_activos}</span>
                    </div>
                    <div className="sup-mini-row">
                      <span className="caption">
                        <IconTruck size={10} style={{verticalAlign:'-1px', marginRight:3}}/>
                        {lang==='es'?'Lead time':'Lead time'}
                      </span>
                      <span className="mono-sm tabular-nums">
                        {s.lead_time_real}d
                        <span className="caption" style={{color:'var(--text-tertiary)', marginLeft:4}}>
                          / {s.lead_time_promised}d
                        </span>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div className="sup-foot">
                  <div className="sup-certs">
                    {(s.certs || []).slice(0, 3).map(c => (
                      <span key={c} className="sup-cert-chip">{c}</span>
                    ))}
                    {(s.certs || []).length > 3 && (
                      <span className="sup-cert-chip">+{s.certs.length - 3}</span>
                    )}
                    {(!s.certs || s.certs.length === 0) && (
                      <span className="sup-cert-chip is-empty">
                        <IconAlert size={10} style={{verticalAlign:'-1px', marginRight:3}}/>
                        {lang==='es'?'Sin certs':'No certs'}
                      </span>
                    )}
                  </div>
                  {lastAudit && (
                    <span className="caption" style={{color:'var(--text-tertiary)'}}>
                      {lang==='es'?'Última auditoría':'Last audit'}: {lastAudit}
                    </span>
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {rows.length === 0 && (
          <div className="card card-pad-lg empty" style={{gridColumn:'1 / -1'}}>
            <IconShield size={22} style={{color:'var(--text-tertiary)'}}/>
            <div className="heading-md">{lang==='es'?'Sin resultados':'No results'}</div>
            <div className="caption" style={{maxWidth:360}}>
              {lang==='es'
                ? 'Ajusta los filtros o limpia la búsqueda para ver más proveedores.'
                : 'Adjust filters or clear search to see more suppliers.'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
