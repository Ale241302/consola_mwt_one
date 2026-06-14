// ─────────────────────────────────────────────────────────────
// BrandsDashboard — Listado animado de marcas
// Agente responsable: [AG-FRONTEND]
//
// Grid de cards (framer-motion · staggered fade-in).
// Click → /marcas/:brandId (BrandDetailView con 4 tabs).
// Botón "+ Nueva marca" → <CreateBrandDrawer/>.
//
// Tokens visuales:
//   Navy #0B1E3A · Mint #00B286 · LightGreen #1DE394
//   Purple #481EE3 · Blue #3083FE · Cyan #1EE3D7
// ─────────────────────────────────────────────────────────────
import React, { useMemo, useState, useEffect, useCallback } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  IconPlus, IconSearch, IconTag, IconPackage, IconFolder,
  IconGlobe, IconCheck, IconAlert, IconSparkle,
} from "../lib/icons.jsx";
import { fmtMoney } from "../lib/i18n.js";
import { BRANDS as MOCK_BRANDS, LEGAL_ENTITIES, EXPEDIENTES } from "../data/mockData.js";
import { marcasApi } from "../lib/api.js";
import { Skeleton } from "../components/ui/Skeleton.jsx";
import CreateBrandDrawer from "../components/brands/CreateBrandDrawer.jsx";

// ─────────────────────────────────────────────────────────────
// Adaptador backend → shape de UI.
// Backend brands.marca:  id, nombre, slug, pais_origen_iso2,
//                        categoria_principal, estado_comercial
//                        (PROSPECTO/ACTIVO/PAUSADO/CERRADO),
//                        territorios[], markup_default, moneda_default,
//                        is_active, timestamps.
// UI espera:             id, brand_id, name, tipo(PROPIA/DISTRIBUCION),
//                        status(ACTIVO/INACTIVO), mercados_activos[],
//                        description, active_skus, revenue_ytd,
//                        issuing_entity, color.
// ─────────────────────────────────────────────────────────────
const ESTADO_API_TO_UI = {
  ACTIVO:    "ACTIVO",
  PROSPECTO: "ACTIVO",
  PAUSADO:   "INACTIVO",
  CERRADO:   "INACTIVO",
};
function mapBrandFromApi(r) {
  // Fable5 · blindaje: r puede llegar null/incompleto — `?.` evita que una
  // fila corrupta del API tumbe el listado completo de marcas.
  const slug = r?.slug || (r?.nombre || "").toLowerCase().replace(/\W+/g, "-").slice(0, 12);
  const mono = (r?.nombre || "").split(/\s+/).map(s => s[0]).join("").slice(0, 3).toUpperCase();
  // ⚠️ El backend devuelve `mercados_activos` (array). `territorios` es un
  // nombre legacy que NUNCA fue serializado — leerlo siempre daba undefined
  // y caía al fallback `pais_origen_iso2`, que es el PAÍS DE ORIGEN, no los
  // mercados donde la marca opera. Por eso el listado mostraba MX (el default
  // del seed) mientras el detalle mostraba CO correctamente.
  const mercados = Array.isArray(r?.mercados_activos) && r.mercados_activos.length > 0
    ? r.mercados_activos
    : (Array.isArray(r?.territorios) && r.territorios.length > 0
        ? r.territorios
        : (r?.pais_origen_iso2 ? [r.pais_origen_iso2] : []));
  return {
    id:              r?.id,
    brand_id:        mono || slug.slice(0, 3).toUpperCase(),
    name:            r?.nombre || "",
    tipo:            "PROPIA",   // backend no distingue aún — se corregirá con ENT_PLAT_BRANDS v2
    status:          ESTADO_API_TO_UI[r?.estado_comercial] || (r?.is_active ? "ACTIVO" : "INACTIVO"),
    mercados_activos: mercados,
    description:     "",
    active_skus:     0,
    revenue_ytd:     0,
    issuing_entity:  null,
    color:           "#00B286",
    _raw:            r,
  };
}

/* Tipo → color / label */
const TIPO_META = {
  PROPIA:       { label: 'PROPIA',       color: '#00B286', soft: 'rgba(0,178,134,0.12)'  },
  DISTRIBUCION: { label: 'DISTRIBUCIÓN', color: '#481EE3', soft: 'rgba(72,30,227,0.12)' },
};

/* ISO-2 → emoji bandera (subset relevante) */
const FLAG = {
  MX:'🇲🇽', PE:'🇵🇪', CO:'🇨🇴', CL:'🇨🇱', PA:'🇵🇦', BR:'🇧🇷',
  CR:'🇨🇷', US:'🇺🇸', CN:'🇨🇳', EC:'🇪🇨', AR:'🇦🇷', DO:'🇩🇴',
};

export default function ScreenBrands() {
  const navigate = useNavigate();
  const { lang } = useOutletContext();

  const [q, setQ] = useState('');
  const [tipoFilter, setTipoFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [showCreate, setShowCreate] = useState(false);

  // ── Fetch backend + fallback mock ──
  const [apiBrands, setApiBrands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const data = await marcasApi.list();
      const arr  = Array.isArray(data) ? data : (data?.results || []);
      // Fable5 · guard: blindaje extra por si `results` no es un array.
      setApiBrands((Array.isArray(arr) ? arr : []).map(mapBrandFromApi));
    } catch (e) {
      setErr(e); setApiBrands([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Sprint 2026-05-10 · CEO ordenó eliminar TODA fallback a mock data.
  const BRANDS = apiBrands;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return BRANDS.filter(b => {
      if (tipoFilter   !== 'ALL' && b.tipo   !== tipoFilter)   return false;
      if (statusFilter !== 'ALL' && b.status !== statusFilter) return false;
      if (!needle) return true;
      const hay = [b.name, b.brand_id, b.description].join(' ').toLowerCase();
      return hay.includes(needle);
    });
  }, [q, tipoFilter, statusFilter, BRANDS]);

  const kpis = useMemo(() => {
    const activas      = BRANDS.filter(b => b.status === 'ACTIVO').length;
    const propias      = BRANDS.filter(b => b.tipo === 'PROPIA').length;
    const distribucion = BRANDS.filter(b => b.tipo === 'DISTRIBUCION').length;
    const totalSkus    = BRANDS.reduce((a, b) => a + (b.active_skus || 0), 0);
    const totalRevenue = BRANDS.reduce((a, b) => a + (b.revenue_ytd || 0), 0);
    return { activas, propias, distribucion, totalSkus, totalRevenue };
  }, [BRANDS]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="micro" style={{marginBottom:6}}>
            {lang==='es'?'CATÁLOGO DE MARCAS':'BRAND CATALOG'}
          </div>
          <h1 className="page-title">{lang==='es'?'Marcas':'Brands'}</h1>
          <div className="page-subtitle">
            {lang==='es'
              ? 'Marcas propias y representadas. Cada marca configura su catálogo, precios, feature-flags y expedientes.'
              : 'Owned and represented brands. Each brand configures its catalog, pricing, feature-flags and files.'}
          </div>
        </div>
        <div className="flex ai-center gap-2">
          <button className="btn btn-accent" onClick={()=>setShowCreate(true)}>
            <IconPlus size={14}/> {lang==='es'?'Nueva marca':'New brand'}
          </button>
        </div>
      </div>

      {/* ── KPIs header ───────── */}
      <div className="nodes-kpis">
        <div className="kpi-tile">
          <div className="k-label">{lang==='es'?'Marcas activas':'Active brands'}</div>
          <div className="k-value">{kpis.activas}</div>
          <div className="k-sub">
            <span className="dot-credit dot-green"/>
            {BRANDS.length - kpis.activas} {lang==='es'?'inactivas':'inactive'}
          </div>
        </div>
        <div className="kpi-tile">
          <div className="k-label">{lang==='es'?'Propias vs distribución':'Own vs distribution'}</div>
          <div className="k-value tabular-nums">{kpis.propias}<span style={{color:'var(--text-tertiary)', fontWeight:500}}> / </span>{kpis.distribucion}</div>
          <div className="k-sub">{lang==='es'?'Modelo de operación mixto':'Mixed operational model'}</div>
        </div>
        <div className="kpi-tile">
          <div className="k-label">{lang==='es'?'SKUs activos (red)':'Active SKUs (network)'}</div>
          <div className="k-value tabular-nums">{kpis.totalSkus.toLocaleString()}</div>
          <div className="k-sub">{lang==='es'?'Consolidado todas las marcas':'Aggregated all brands'}</div>
        </div>
        <div className="kpi-tile accent">
          <div className="k-label">{lang==='es'?'Revenue YTD':'Revenue YTD'}</div>
          <div className="k-value tabular-nums">{fmtMoney(kpis.totalRevenue)}</div>
          <div className="k-sub">{lang==='es'?'Suma facturado consolidado':'Aggregated invoiced sum'}</div>
        </div>
      </div>

      {/* ── Filtros ───────── */}
      <div className="nodes-filters">
        <div className="search-box" style={{flex:'1 1 260px', maxWidth: 360}}>
          <IconSearch size={14} className="search-icon"/>
          <input className="input" value={q} onChange={e=>setQ(e.target.value)}
                 placeholder={lang==='es'?'Buscar por nombre o código…':'Search by name or code…'}/>
        </div>
        <div className="seg">
          <button data-active={tipoFilter==='ALL'}          onClick={()=>setTipoFilter('ALL')}>{lang==='es'?'Todas':'All'}</button>
          <button data-active={tipoFilter==='PROPIA'}       onClick={()=>setTipoFilter('PROPIA')}>Propias</button>
          <button data-active={tipoFilter==='DISTRIBUCION'} onClick={()=>setTipoFilter('DISTRIBUCION')}>Distribución</button>
        </div>
        <div className="seg">
          <button data-active={statusFilter==='ALL'}      onClick={()=>setStatusFilter('ALL')}>{lang==='es'?'Todos':'All'}</button>
          <button data-active={statusFilter==='ACTIVO'}   onClick={()=>setStatusFilter('ACTIVO')}>Activo</button>
          <button data-active={statusFilter==='INACTIVO'} onClick={()=>setStatusFilter('INACTIVO')}>Inactivo</button>
        </div>
      </div>

      {/* ── Grid de cards ───────── */}
      <div className="brands-grid">
        <AnimatePresence mode="popLayout">
          {filtered.map((b, idx) => {
            const tipo  = TIPO_META[b.tipo] || TIPO_META.PROPIA;
            const owner = LEGAL_ENTITIES.find(e => e.id === b.issuing_entity);
            const activeExps = EXPEDIENTES.filter(e => e.brand_id === b.id && e.status !== 'CERRADO').length;
            const isInactive = b.status === 'INACTIVO';

            return (
              <motion.div
                key={b.id}
                layout
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0, transition: { delay: idx * 0.05, duration: 0.28, ease: 'easeOut' } }}
                exit={{ opacity: 0, y: -8, transition: { duration: 0.15 } }}
                whileHover={{ y: -4 }}
                className="brand-card"
                data-status={b.status}
                data-inactive={isInactive}
                onClick={()=>navigate(`/marcas/${b.id}`)}
                style={{
                  '--brand-color': b.color,
                  '--tipo-color':  tipo.color,
                  '--tipo-soft':   tipo.soft,
                }}
              >
                {/* Glow superior con color de marca */}
                <div className="brand-card-glow"/>

                {/* Header: nombre + status (monograma de iniciales removido). */}
                <div className="brand-card-head">
                  <div style={{flex:1, minWidth:0}}>
                    <div className="brand-name">{b.name}</div>
                    <div className="brand-code mono-sm">{b.brand_id}</div>
                  </div>
                  <span className={`badge ${isInactive ? 'badge-neutral' : 'badge-success'}`}>
                    <span className="dot"/>{b.status}
                  </span>
                </div>

                {/* Tipo + descripción */}
                <div className="brand-card-meta">
                  <span className="tipo-badge" title={tipo.label}>
                    <span className="tipo-dot" style={{background: tipo.color}}/>
                    {tipo.label}
                  </span>
                  <span className="caption" style={{color:'var(--text-tertiary)', textAlign:'right'}}>
                    {owner?.short || '—'}
                  </span>
                </div>

                {b.description && (
                  <div className="brand-desc">{b.description}</div>
                )}

                {/* Mercados activos — banderas */}
                <div className="brand-markets">
                  <div className="caption" style={{color:'var(--text-tertiary)', marginBottom:4}}>
                    <IconGlobe size={11} style={{marginRight:4, verticalAlign:'-1px'}}/>
                    {lang==='es'?'Mercados':'Markets'}
                  </div>
                  <div className="flag-row">
                    {b.mercados_activos.map(cc => (
                      <span key={cc} className="flag-chip" title={cc}>
                        <span className="flag-emo">{FLAG[cc] || '🌐'}</span>
                        <span className="flag-cc">{cc}</span>
                      </span>
                    ))}
                  </div>
                </div>

                {/* Métricas rápidas */}
                <div className="brand-card-stats">
                  <div className="bstat">
                    <IconPackage size={12} style={{color:'var(--tipo-color)'}}/>
                    <span className="bstat-v tabular-nums">{b.active_skus}</span>
                    <span className="bstat-l">SKUs</span>
                  </div>
                  <div className="bstat">
                    <IconFolder size={12} style={{color:'var(--tipo-color)'}}/>
                    <span className="bstat-v tabular-nums">{activeExps}</span>
                    <span className="bstat-l">{lang==='es'?'expedientes':'files'}</span>
                  </div>
                  <div className="bstat bstat-revenue">
                    <span className="bstat-v tabular-nums">{fmtMoney(b.revenue_ytd)}</span>
                    <span className="bstat-l">YTD</span>
                  </div>
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
          <div className="empty-state" style={{gridColumn:'1 / -1'}}>
            <IconTag size={26} style={{color:'var(--text-tertiary)'}}/>
            <div className="heading-md">{lang==='es'?'Sin resultados':'No results'}</div>
            <div className="caption">{lang==='es'?'Ajusta los filtros o limpia la búsqueda.':'Tune filters or clear search.'}</div>
          </div>
        )}
      </div>

      {/* ── Drawer creación ─────── */}
      <AnimatePresence>
        {showCreate && (
          <CreateBrandDrawer
            lang={lang}
            onClose={()=>setShowCreate(false)}
            onCreated={async (payload) => {
              // UI → backend brands.marca. Campos mínimos requeridos por el serializer:
              //   nombre, slug, pais_origen_iso2, categoria_principal, estado_comercial
              const slugify = (s) =>
                (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                         .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
              const body = {
                nombre:              payload.name || payload.nombre,
                slug:                payload.slug || slugify(payload.name || payload.nombre),
                pais_origen_iso2:    payload.pais_origen_iso2 || payload.country || "MX",
                categoria_principal: payload.categoria_principal || payload.categoria || "GENERAL",
                estado_comercial:    payload.estado_comercial || payload.status || "PROSPECTO",
                // El serializer del backend expone `mercados_activos`, NO `territorios`
                // (territorios existe en BD pero está oculto). Antes mandábamos el campo
                // equivocado y los markets seleccionados se descartaban silenciosamente.
                mercados_activos:    payload.mercados_activos || payload.territorios || [],
                tipo:                payload.tipo || "TERCEROS",
                brand_code:          payload.brand_id || payload.brand_code || null,
              };
              try {
                await marcasApi.create(body);
                await load();
                setShowCreate(false);
              } catch (e) {
                console.error("[marcas] create failed:", e);
                alert((lang==='es'?"Error al crear marca: ":"Error creating brand: ") + (e?.message || ""));
              }
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
