// ─────────────────────────────────────────────────────────────
// BrandDetail — Vista completa de marca con 4 tabs
// Agente responsable: [AG-FRONTEND]
//
// Layout:
//   Breadcrumb → Hero con color de marca → 4 KPIs top → Feature Flags
//   → Tabs:
//     1. Resumen             (KPIs + drill semanal + flags)
//     2. Productos           (catálogo + carga masiva Excel + alta manual)
//     3. Motor de Precios    (tabla tri-capa con CEO-ONLY)
//     4. Expedientes asoc.   (semáforo + link a detalle)
//
// Tokens:
//   Navy #0B1E3A · Mint #00B286 · LightGreen #1DE394
//   Purple #481EE3 · Blue #3083FE · Cyan #1EE3D7
// ─────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useOutletContext } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  IconChevLeft, IconGlobe, IconPackage, IconFolder, IconDollar,
  IconShield, IconSparkle, IconLock, IconAlert, IconCheck, IconRefresh,
  IconPlus, IconUpload, IconTag, IconPercent, IconX, IconSearch,
} from "../lib/icons.jsx";
import { fmtMoney, fmtMoneyDetail, fmtShortDate } from "../lib/i18n.js";
import { marcasApi, productosApi } from "../lib/api.js";
import {
  BRANDS, LEGAL_ENTITIES, EXPEDIENTES, BRAND_PRODUCTS, BRAND_ATTRIBUTES, OCS,
} from "../data/mockData.js";

// Backend (ProductoListSerializer) → shape que usa el grid de cards.
// El backend list trae solo campos básicos (sku, nombre, precio, marca);
// las specs detalladas (capellada, suela, etc.) viven en el detalle del
// producto. Mostramos '' en las específicas para no romper el render.
function adaptProductoFromApi(r) {
  return {
    id:                r.id,
    sku:               r.sku || '',
    nombre:            r.nombre || '',
    brand_id:          r.marca_id || null,
    tipo_calzado:      r.subcategoria || r.categoria || '',
    list_price:        Number(r.precio_lista || 0),
    active_in_markets: r.pais_origen_iso2 ? [r.pais_origen_iso2] : [],
    capellada: '', tipo_puntera: '', suela: '', normativa: '',
    color: '', segmento: '', cierre: '', antiperforante: '',
  };
}
import CreateBrandDrawer from "../components/brands/CreateBrandDrawer.jsx";
import ProductMassiveUpload from "../components/brands/ProductMassiveUpload.jsx";
import BrandPricingConsole from "../components/brands/BrandPricingConsole.jsx";

// ── Adapter backend → forma esperada por el componente (heredada del mock).
// Backend: nombre/slug/tipo/brand_code/pais_origen_iso2/categoria_principal/
//          estado_comercial/markup_default/fecha_firma/mercados_activos/etc.
// Mock:    name/brand_id/color/created_at/status/description/feature_flags/etc.
const TIPO_COLOR = { PROPIA: '#00B286', DISTRIBUCION: '#481EE3', TERCEROS: '#481EE3' };
function adaptBackendBrand(raw) {
  if (!raw || !raw.id) return null;
  return {
    id:                raw.id,
    name:              raw.nombre || raw.slug || '—',
    brand_id:          raw.brand_code || raw.slug || '—',
    color:             TIPO_COLOR[raw.tipo] || '#481EE3',
    tipo:              raw.tipo || 'TERCEROS',
    issuing_entity:    raw.issuing_entity_id || null,
    created_at:        raw.fecha_firma || (raw.updated_at || '').slice(0,10) || '—',
    status:            raw.estado_comercial || 'PROSPECTO',
    description:       raw.categoria_principal ? `Categoría: ${raw.categoria_principal}` : '',
    mercados_activos:  Array.isArray(raw.mercados_activos) ? raw.mercados_activos : [],
    feature_flags:     raw.feature_flags || {},
    active_skus:       Number(raw.active_skus || 0),
    avg_margin:        Number(raw.markup_default || 0),
    _raw: raw,
  };
}

/* ── Tipo → meta ────────────────────────── */
const TIPO_META = {
  PROPIA:       { label: 'PROPIA',       color: '#00B286' },
  DISTRIBUCION: { label: 'DISTRIBUCIÓN', color: '#481EE3' },
};

/* ── Banderas — subset LatAm + US/CN ─────── */
const FLAG = {
  MX:'🇲🇽', PE:'🇵🇪', CO:'🇨🇴', CL:'🇨🇱', PA:'🇵🇦', BR:'🇧🇷',
  CR:'🇨🇷', US:'🇺🇸', CN:'🇨🇳', EC:'🇪🇨', AR:'🇦🇷', DO:'🇩🇴',
};

/* ── Feature flag metadata ─────────────── */
const FEATURE_FLAGS_META = [
  { k:'STOREFRONT_ENABLED', icon: IconGlobe,
    l:'Storefront público', h:'Permite venta DTC en storefront web.' },
  { k:'B2B_PORTAL_ENABLED', icon: IconShield,
    l:'Portal B2B',         h:'Clientes B2B pueden ver catálogo y pedidos.' },
  { k:'EXPEDITION_ENABLED', icon: IconFolder,
    l:'Expedientes',        h:'Habilita flujo de expedientes operativos.' },
  { k:'SCANNER_ENABLED',    icon: IconPackage,
    l:'Scanner en WMS',     h:'SKU escaneado en nodos WMS (handheld).' },
];

/* ── Semáforo para expedientes ─────────── */
function creditBand(days) {
  if (days >= 75) return 'red';
  if (days >= 60) return 'amber';
  return 'green';
}
function phaseBand(signal) {
  if (signal === 'red')    return 'red';
  if (signal === 'amber')  return 'amber';
  return 'green';
}

export default function ScreenBrandDetail() {
  const { brandId } = useParams();
  const navigate = useNavigate();
  const { lang } = useOutletContext();

  const [tab, setTab]           = useState('resumen');
  const [showEdit, setShowEdit] = useState(false);
  const [showMassUp, setMassUp] = useState(false);
  const [showNewProd, setShowNewProd] = useState(false);

  // ── Fetch real al backend (antes leía BRANDS de mockData.js) ──
  const [rawBrand, setRawBrand] = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [loadErr,  setLoadErr]  = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadErr(null);
    marcasApi.get(brandId)
      .then(data => { if (!cancelled) { setRawBrand(data); setLoading(false); } })
      .catch(err => {
        if (cancelled) return;
        const mockMatch = BRANDS.find(b => b.id === brandId);
        if (mockMatch) {
          setRawBrand({ __isMockShape: true, ...mockMatch });
        } else {
          setLoadErr(err?.message || 'fetch_failed');
        }
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [brandId]);

  const brand = useMemo(() => {
    if (!rawBrand) return null;
    if (rawBrand.__isMockShape) return rawBrand;
    return adaptBackendBrand(rawBrand);
  }, [rawBrand]);

  /* Feature flags en estado local — se sincronizan cuando llega `brand`,
     y cada toggle se persiste con PATCH /api/marcas/{id}/. */
  const [flags, setFlags] = useState({});
  const [savingFlag, setSavingFlag] = useState(null);   // key del flag en vuelo
  useEffect(() => { if (brand?.feature_flags) setFlags(brand.feature_flags); }, [brand]);
  const toggleFlag = async (k) => {
    if (!brand?._raw) {
      // Mock-only — no persistimos, solo local UI
      setFlags(prev => ({ ...prev, [k]: !prev[k] }));
      return;
    }
    const next = { ...flags, [k]: !flags[k] };
    // Optimista — actualizamos UI antes; revertimos si falla.
    setFlags(next);
    setSavingFlag(k);
    try {
      const updated = await marcasApi.update(brandId, { feature_flags: next });
      setRawBrand(updated);   // sincroniza el resto de la vista
    } catch (e) {
      // Revertir
      setFlags(flags);
      alert((lang==='es'?'No se pudo guardar el flag: ':'Failed to save flag: ') + (e?.message || ''));
    } finally {
      setSavingFlag(null);
    }
  };

  // ── TODOS los hooks ANTES de los returns condicionales (regla React) ──
  const bid = brand?.id;

  // Productos reales del backend (filtrados por marca). Fallback al mock
  // solo si la marca tiene UUID demo conocido y el backend no devuelve nada.
  const [products, setProducts] = useState([]);
  useEffect(() => {
    let cancelled = false;
    if (!bid) { setProducts([]); return; }
    productosApi.list({ marca: bid })
      .then(rows => {
        if (cancelled) return;
        const real = Array.isArray(rows) ? rows.map(adaptProductoFromApi) : [];
        if (real.length > 0) setProducts(real);
        else setProducts(BRAND_PRODUCTS.filter(p => p.brand_id === bid));
      })
      .catch(() => {
        if (cancelled) return;
        setProducts(BRAND_PRODUCTS.filter(p => p.brand_id === bid));
      });
    return () => { cancelled = true; };
  }, [bid]);
  const expedientes = useMemo(
    () => bid ? EXPEDIENTES.filter(e => e.brand_id === bid) : [],
    [bid]
  );
  const expedientesActivos = useMemo(
    () => expedientes.filter(e => e.status !== 'CERRADO'),
    [expedientes]
  );
  const kpis = useMemo(() => {
    if (!brand) return { totalProds:0, activos:0, revenue:0, margin:0 };
    const totalProds = products.length || brand.active_skus || 0;
    const activos    = expedientesActivos.length;
    const revenue    = expedientes.reduce((a, e) => a + (e.total_invoiced || 0), 0);
    const marginNum  = expedientes.reduce((a, e) => a + ((e.real_margin || 0) * (e.total_invoiced || 0)), 0);
    const marginDen  = expedientes.reduce((a, e) => a + (e.total_invoiced || 0), 0);
    const margin     = marginDen ? marginNum / marginDen : brand.avg_margin || 0;
    return { totalProds, activos, revenue, margin };
  }, [products, expedientes, expedientesActivos, brand]);

  // ── Returns condicionales DESPUÉS de los hooks ──
  if (loading) {
    return (
      <div className="page">
        <div className="card card-pad-lg empty">
          <IconRefresh size={20} style={{color:'var(--brand-accent)', animation:'spin 1.2s linear infinite'}}/>
          <div className="caption">{lang==='es'?'Cargando marca…':'Loading brand…'}</div>
        </div>
      </div>
    );
  }

  if (!brand) {
    return (
      <div className="page">
        <div className="card card-pad-lg empty">
          <IconAlert size={22} style={{ color: 'var(--text-tertiary)' }}/>
          <div className="heading-md">
            {lang === 'es' ? 'Marca no encontrada' : 'Brand not found'}
          </div>
          {loadErr && <div className="caption" style={{color:'var(--text-tertiary)'}}>{loadErr}</div>}
          <button className="btn btn-ghost" onClick={()=>navigate('/marcas')}>
            <IconChevLeft size={14}/> {lang === 'es' ? 'Volver a Marcas' : 'Back to Brands'}
          </button>
        </div>
      </div>
    );
  }

  const tipo  = TIPO_META[brand.tipo] || TIPO_META.PROPIA;
  const owner = LEGAL_ENTITIES.find(e => e.id === brand.issuing_entity);

  return (
    <div className="page">
      {/* ── Breadcrumb ────────────── */}
      <div className="flex ai-center gap-2" style={{ marginBottom: 12 }}>
        <button className="btn btn-ghost" onClick={()=>navigate('/marcas')}>
          <IconChevLeft size={14}/> {lang === 'es' ? 'Marcas' : 'Brands'}
        </button>
        <span className="caption" style={{ color: 'var(--text-tertiary)' }}>/</span>
        <span className="caption">{brand.name}</span>
      </div>

      {/* ── Hero ─────────────────── */}
      <motion.div
        className="brand-hero"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0, transition: { duration: 0.3 } }}
        style={{
          '--brand-color': brand.color,
          '--tipo-color':  tipo.color,
        }}
      >
        <div className="brand-hero-accent"/>
        <div className="brand-hero-body">
          {/* Badge de monograma removido — el código aparece en el row de info. */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="micro" style={{ color: tipo.color }}>{tipo.label}</div>
            <h1 className="page-title" style={{ margin: '2px 0 2px' }}>{brand.name}</h1>
            <div className="caption" style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <IconShield size={11}/> {owner?.short || '—'} — {owner?.name || ''}
              </span>
              <span className="mono-sm">{brand.brand_id}</span>
              <span>
                <IconTag size={11} style={{ verticalAlign:'-1px', marginRight:4 }}/>
                {lang === 'es' ? 'desde' : 'since'} {brand.created_at}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <span className={`badge ${brand.status === 'ACTIVO' ? 'badge-success' : 'badge-neutral'}`}>
                <span className="dot"/> {brand.status}
              </span>
              {brand.description && (
                <span className="pill-soft">{brand.description}</span>
              )}
              <span className="pill-soft">
                <IconGlobe size={11}/> {brand.mercados_activos.length} {lang === 'es' ? 'mercados' : 'markets'}
              </span>
            </div>
            {/* Flags row */}
            <div className="flag-row" style={{ marginTop: 10 }}>
              {brand.mercados_activos.map(cc => (
                <span key={cc} className="flag-chip" title={cc}>
                  <span className="flag-emo">{FLAG[cc] || '🌐'}</span>
                  <span className="flag-cc">{cc}</span>
                </span>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" onClick={()=>setShowEdit(true)}>
              {lang === 'es' ? 'Editar' : 'Edit'}
            </button>
          </div>
        </div>
      </motion.div>

      {/* ── KPIs ─────────────────── */}
      <div className="nodes-kpis" style={{ marginTop: 16 }}>
        <div className="kpi-tile">
          <div className="k-label">{lang === 'es' ? 'Total productos' : 'Total products'}</div>
          <div className="k-value tabular-nums">{kpis.totalProds}</div>
          <div className="k-sub">
            {products.length} {lang === 'es' ? 'con specs completas' : 'with full specs'}
          </div>
        </div>
        <div className="kpi-tile">
          <div className="k-label">{lang === 'es' ? 'Expedientes activos' : 'Active files'}</div>
          <div className="k-value tabular-nums">{kpis.activos}</div>
          <div className="k-sub">
            {expedientes.length - kpis.activos} {lang === 'es' ? 'cerrados' : 'closed'}
          </div>
        </div>
        <div className="kpi-tile">
          <div className="k-label">{lang === 'es' ? 'Facturación total' : 'Total invoiced'}</div>
          <div className="k-value tabular-nums">{fmtMoney(kpis.revenue)}</div>
          <div className="k-sub">{lang === 'es' ? 'Sum de expedientes de la marca' : 'Sum of brand files'}</div>
        </div>
        <div className="kpi-tile kpi-ceo">
          <div className="k-label">
            <IconLock size={10} style={{ marginRight: 4, verticalAlign:'-1px' }}/>
            {lang === 'es' ? 'Margen promedio global' : 'Avg global margin'}
          </div>
          <div className="k-value tabular-nums">{(kpis.margin * 100).toFixed(1)}%</div>
          <div className="k-sub" style={{ color:'var(--critical)' }}>CEO-ONLY</div>
        </div>
      </div>

      {/* ── Feature Flags ────────── */}
      <section className="card card-pad-lg" style={{ marginTop: 16 }}>
        <div className="flex ai-center jc-between" style={{ marginBottom: 10 }}>
          <div>
            <div className="micro">
              {lang === 'es' ? 'FEATURE FLAGS' : 'FEATURE FLAGS'}
            </div>
            <div className="heading-md">
              {lang === 'es' ? 'Capacidades habilitadas' : 'Enabled capabilities'}
            </div>
          </div>
          <span className="caption" style={{ color: 'var(--text-tertiary)' }}>
            {lang === 'es'
              ? 'Se aplican a toda la marca. Override por mercado en futuro roadmap.'
              : 'Applied to the whole brand. Per-market override in future roadmap.'}
          </span>
        </div>
        <div className="feature-flags-grid">
          {FEATURE_FLAGS_META.map(f => {
            const on = !!flags[f.k];
            const Ico = f.icon;
            return (
              <button
                key={f.k}
                type="button"
                className="flag-toggle"
                data-on={on}
                onClick={()=>toggleFlag(f.k)}
              >
                <div className="flag-toggle-icon"><Ico size={14}/></div>
                <div className="flag-toggle-body">
                  <div className="flag-toggle-label">{f.l}</div>
                  <div className="flag-toggle-hint">{f.h}</div>
                  <div className="flag-toggle-key mono-sm">{f.k}</div>
                </div>
                <div className="flag-switch" data-on={on}>
                  <span/>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Tabs ───────────────── */}
      <div className="tab-bar" style={{ marginTop: 20 }}>
        <button className="tab-btn" data-active={tab === 'resumen'} onClick={()=>setTab('resumen')}>
          <IconSparkle size={12}/> {lang === 'es' ? 'Resumen' : 'Overview'}
        </button>
        <button className="tab-btn" data-active={tab === 'productos'} onClick={()=>setTab('productos')}>
          <IconPackage size={12}/> {lang === 'es' ? 'Productos' : 'Products'}
          <span className="tab-count">{products.length}</span>
        </button>
        <button className="tab-btn" data-active={tab === 'precios'} onClick={()=>setTab('precios')}>
          <IconDollar size={12}/> {lang === 'es' ? 'Motor de Precios' : 'Pricing Engine'}
        </button>
        <button className="tab-btn" data-active={tab === 'expedientes'} onClick={()=>setTab('expedientes')}>
          <IconFolder size={12}/> {lang === 'es' ? 'Expedientes' : 'Files'}
          <span className="tab-count">{expedientesActivos.length}</span>
        </button>
      </div>

      {/* ── Tab panels ─────────── */}
      <div className="tab-panel">
        <AnimatePresence mode="wait">
          {tab === 'resumen' && (
            <motion.div key="resumen"
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
              <ResumenTab
                lang={lang}
                brand={brand}
                kpis={kpis}
                flags={flags}
                expedientes={expedientes}
              />
            </motion.div>
          )}
          {tab === 'productos' && (
            <motion.div key="productos"
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
              <ProductosTab
                lang={lang}
                products={products}
                onAddManual={()=>setShowNewProd(true)}
                onMassUpload={()=>setMassUp(true)}
                onProductClick={(p) => navigate(`/productos/${p.id}`)}
              />
            </motion.div>
          )}
          {tab === 'precios' && (
            <motion.div key="precios"
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
              <BrandPricingConsole
                lang={lang}
                brandId={brand.id}
              />
            </motion.div>
          )}
          {tab === 'expedientes' && (
            <motion.div key="expedientes"
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
              <ExpedientesTab
                lang={lang}
                expedientes={expedientes}
                onOpen={(exp)=>{
                  const oc = OCS?.find(o => o.expedientes?.includes(exp.id));
                  if (oc) navigate(`/expedientes/${oc.id}/exp/${exp.id}`);
                  else navigate(`/expedientes`);
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Drawers / Modals ───── */}
      <AnimatePresence>
        {showEdit && (
          <CreateBrandDrawer
            lang={lang}
            initial={brand}
            onClose={()=>setShowEdit(false)}
            onCreated={async (payload) => {
              // Igual que en Brands.jsx: payload viene en shape UI, lo
              // convertimos a lo que el backend espera y mandamos PATCH.
              const slugify = (s) =>
                (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                         .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
              const body = {
                nombre:              payload.name || payload.nombre,
                slug:                payload.slug || slugify(payload.name || payload.nombre),
                pais_origen_iso2:    payload.pais_origen_iso2 || payload.country || brand._raw?.pais_origen_iso2 || 'MX',
                categoria_principal: payload.categoria_principal || payload.categoria || brand._raw?.categoria_principal || 'GENERAL',
                estado_comercial:    payload.estado_comercial || payload.status || brand._raw?.estado_comercial || 'PROSPECTO',
                mercados_activos:    payload.mercados_activos || payload.territorios || [],
                tipo:                payload.tipo || brand._raw?.tipo || 'TERCEROS',
                brand_code:          payload.brand_id || payload.brand_code || brand._raw?.brand_code || null,
              };
              try {
                const updated = await marcasApi.update(brandId, body);
                setRawBrand(updated);
                setShowEdit(false);
              } catch (e) {
                alert((lang==='es'?'Error al guardar: ':'Save failed: ') + (e?.message || ''));
              }
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showMassUp && (
          <motion.div
            className="modal-backdrop"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={()=>setMassUp(false)}
          >
            <motion.div
              className="modal-panel"
              initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }}
              transition={{ type:'spring', stiffness: 260, damping: 30 }}
              onClick={e=>e.stopPropagation()}
            >
              <div className="modal-head">
                <div>
                  <div className="micro">
                    {lang === 'es' ? 'IMPORTAR CATÁLOGO' : 'IMPORT CATALOG'}
                  </div>
                  <div className="heading-md">
                    {lang === 'es' ? 'Carga masiva de productos' : 'Massive product upload'}
                  </div>
                </div>
                <button className="icon-btn" onClick={()=>setMassUp(false)}>
                  <IconX size={14}/>
                </button>
              </div>
              <div className="modal-body">
                <ProductMassiveUpload
                  lang={lang}
                  marcaId={brandId}
                  onParsed={(r)=>{
                    console.log('[brands] products parsed:', r);
                  }}
                  onClose={()=>setMassUp(false)}
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showNewProd && (
          <NewProductDrawer
            lang={lang}
            brand={brand}
            onClose={()=>setShowNewProd(false)}
            onCreated={(payload)=>{
              console.log('[mock] new product:', payload);
              setShowNewProd(false);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TAB · Resumen — cards de alto nivel
   ═══════════════════════════════════════════════════════════════ */
function ResumenTab({ lang, brand, kpis, flags, expedientes }) {
  const enabledFlags = Object.entries(flags).filter(([, v]) => v).length;
  const criticals = expedientes.filter(e => e.credit_days >= 75).length;
  const risky     = expedientes.filter(e => e.credit_days >= 60 && e.credit_days < 75).length;

  return (
    <div className="resumen-grid">
      <div className="card card-pad-lg">
        <div className="micro">{lang === 'es' ? 'CAPACIDADES' : 'CAPABILITIES'}</div>
        <div className="heading-md" style={{ marginBottom: 8 }}>
          {enabledFlags}/{FEATURE_FLAGS_META.length} {lang === 'es' ? 'habilitadas' : 'enabled'}
        </div>
        <div className="caption" style={{ color: 'var(--text-tertiary)' }}>
          {lang === 'es'
            ? 'Activadas en la sección superior. Cambios aplican en tiempo real.'
            : 'Toggled in the section above. Changes apply in real time.'}
        </div>
      </div>

      <div className="card card-pad-lg">
        <div className="micro">{lang === 'es' ? 'SALUD COMERCIAL' : 'COMMERCIAL HEALTH'}</div>
        <div className="heading-md" style={{ marginBottom: 8 }}>
          {criticals === 0 && risky === 0
            ? (lang === 'es' ? 'Saludable' : 'Healthy')
            : criticals > 0
              ? (lang === 'es' ? 'Atención requerida' : 'Attention needed')
              : (lang === 'es' ? 'Riesgo moderado' : 'Moderate risk')}
        </div>
        <div className="caption" style={{ color: 'var(--text-tertiary)' }}>
          {criticals} {lang === 'es' ? 'crítico(s)' : 'critical'}  ·  {risky} {lang === 'es' ? 'en riesgo' : 'at risk'}
        </div>
      </div>

      <div className="card card-pad-lg">
        <div className="micro">{lang === 'es' ? 'PRESENCIA GEOGRÁFICA' : 'GEOGRAPHIC FOOTPRINT'}</div>
        <div className="heading-md" style={{ marginBottom: 8 }}>
          {brand.mercados_activos.length} {lang === 'es' ? 'mercados' : 'markets'}
        </div>
        <div className="flag-row">
          {brand.mercados_activos.map(cc => (
            <span key={cc} className="flag-chip" title={cc}>
              <span className="flag-emo">{FLAG[cc] || '🌐'}</span>
              <span className="flag-cc">{cc}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="card card-pad-lg kpi-ceo" style={{ borderColor:'color-mix(in oklab, var(--critical), white 75%)' }}>
        <div className="micro" style={{ color:'var(--critical)' }}>
          <IconLock size={10} style={{ marginRight: 3, verticalAlign:'-1px' }}/>
          CEO-ONLY
        </div>
        <div className="heading-md" style={{ marginBottom: 8 }}>
          {(kpis.margin * 100).toFixed(1)}% {lang === 'es' ? 'margen global' : 'global margin'}
        </div>
        <div className="caption" style={{ color: 'var(--text-tertiary)' }}>
          {fmtMoney(kpis.revenue)} {lang === 'es' ? 'facturado · ver motor de precios para detalle' : 'invoiced · see pricing engine for detail'}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TAB · Productos — grid con specs + alta + masivo
   ═══════════════════════════════════════════════════════════════ */
function ProductosTab({ lang, products, onAddManual, onMassUpload, onProductClick }) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return products;
    return products.filter(p =>
      [p.sku, p.nombre, p.capellada, p.color, p.normativa, p.segmento]
        .filter(Boolean).join(' ').toLowerCase().includes(n)
    );
  }, [products, q]);

  return (
    <>
      <div className="pricing-toolbar" style={{ marginBottom: 12 }}>
        <div className="search-box" style={{ flex: '1 1 260px', maxWidth: 360 }}>
          <IconSearch size={14} className="search-icon"/>
          <input
            className="input"
            placeholder={lang === 'es' ? 'Buscar SKU, nombre, normativa…' : 'Search SKU, name, norm…'}
            value={q} onChange={e=>setQ(e.target.value)}
          />
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onAddManual}>
          <IconPlus size={12}/> {lang === 'es' ? 'Añadir producto' : 'Add product'}
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={onMassUpload}>
          <IconUpload size={12}/> {lang === 'es' ? 'Carga masiva (Excel)' : 'Mass upload (Excel)'}
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="card card-pad-lg empty">
          <IconPackage size={22} style={{ color: 'var(--text-tertiary)' }}/>
          <div className="heading-md">
            {lang === 'es' ? 'Sin productos para esta marca' : 'No products for this brand'}
          </div>
          <div className="caption">
            {lang === 'es' ? 'Sube un Excel o añade manualmente.' : 'Upload Excel or add manually.'}
          </div>
        </div>
      ) : (
        <div className="products-grid">
          {filtered.map((p, idx) => (
            <motion.div
              key={p.id}
              className="product-card"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0, transition: { delay: idx * 0.03 } }}
              whileHover={{ y: -2 }}
              onClick={() => onProductClick && onProductClick(p)}
              style={{ cursor: onProductClick ? 'pointer' : 'default' }}
              role={onProductClick ? 'button' : undefined}
              tabIndex={onProductClick ? 0 : undefined}
              onKeyDown={(e) => {
                if (onProductClick && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  onProductClick(p);
                }
              }}
            >
              <div className="product-card-head">
                <div className="product-sku mono-sm">{p.sku}</div>
                <span className="badge badge-outline">{p.tipo_calzado}</span>
              </div>
              <div className="product-name">{p.nombre}</div>
              <div className="product-attrs">
                <SpecRow l={lang === 'es' ? 'Capellada' : 'Upper'} v={p.capellada}/>
                <SpecRow l={lang === 'es' ? 'Puntera' : 'Toe'} v={p.tipo_puntera}/>
                <SpecRow l={lang === 'es' ? 'Suela' : 'Outsole'} v={p.suela}/>
                <SpecRow l={lang === 'es' ? 'Normativa' : 'Norm'} v={p.normativa}/>
                <SpecRow l={lang === 'es' ? 'Color' : 'Color'} v={p.color}/>
                <SpecRow l={lang === 'es' ? 'Segmento' : 'Segment'} v={p.segmento}/>
                <SpecRow l={lang === 'es' ? 'Cierre' : 'Closure'} v={p.cierre}/>
                <SpecRow l={lang === 'es' ? 'Antiperf.' : 'Antiperf.'} v={p.antiperforante}/>
              </div>
              <div className="product-foot">
                <div className="flag-row">
                  {(p.active_in_markets || []).map(cc => (
                    <span key={cc} className="flag-chip sm" title={cc}>
                      <span className="flag-emo">{FLAG[cc] || '🌐'}</span>
                      <span className="flag-cc">{cc}</span>
                    </span>
                  ))}
                </div>
                <div className="product-price tabular-nums">
                  {fmtMoneyDetail(p.list_price)}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </>
  );
}

function SpecRow({ l, v }) {
  const val = v || '—';
  return (
    <div className="spec-row">
      <span className="spec-l">{l}</span>
      <span className="spec-v" title={val}>{val}</span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TAB · Expedientes — semáforo + reloj de crédito + link
   ═══════════════════════════════════════════════════════════════ */
function ExpedientesTab({ lang, expedientes, onOpen }) {
  if (!expedientes.length) {
    return (
      <div className="card card-pad-lg empty">
        <IconFolder size={22} style={{ color: 'var(--text-tertiary)' }}/>
        <div className="heading-md">
          {lang === 'es' ? 'Sin expedientes' : 'No files'}
        </div>
      </div>
    );
  }

  return (
    <div className="card card-pad-0">
      <table className="table">
        <thead>
          <tr>
            <th>{lang === 'es' ? 'Expediente' : 'File'}</th>
            <th>{lang === 'es' ? 'Cliente' : 'Client'}</th>
            <th>{lang === 'es' ? 'Estado' : 'Status'}</th>
            <th>{lang === 'es' ? 'Fase' : 'Phase'}</th>
            <th>{lang === 'es' ? 'Reloj crédito' : 'Credit clock'}</th>
            <th>{lang === 'es' ? 'Logística' : 'Logistics'}</th>
            <th style={{ textAlign: 'right' }}>{lang === 'es' ? 'Facturado' : 'Invoiced'}</th>
            <th style={{ textAlign: 'right' }}>{lang === 'es' ? 'Saldo' : 'Balance'}</th>
          </tr>
        </thead>
        <tbody>
          {expedientes.map(e => {
            const band  = creditBand(e.credit_days);
            const phase = phaseBand(e.phase_signal);
            const logisticPct = Math.min(100, Math.round(((e.artifacts_done || 0) / (e.artifacts_total || 6)) * 100));
            return (
              <tr key={e.id} onClick={()=>onOpen(e)} style={{ cursor: 'pointer' }}>
                <td className="mono-sm">{e.ref}</td>
                <td>{e.client}</td>
                <td>
                  <span className="badge badge-outline">{e.status}</span>
                  {e.is_blocked && (
                    <span className="badge badge-danger" style={{ marginLeft: 4 }}>
                      <IconLock size={9}/> {lang === 'es' ? 'bloqueado' : 'blocked'}
                    </span>
                  )}
                </td>
                <td>
                  <span className={`phase-pill phase-${phase}`}>
                    <span className="phase-dot"/> {e.time_in_phase}d
                  </span>
                </td>
                <td>
                  <span className={`cred-clock band-${band}`}>
                    <span className="cred-clock-dot"/> {e.credit_days}d
                  </span>
                </td>
                <td style={{ width: 140 }}>
                  <div className="credit-bar band-ok" style={{ background: 'color-mix(in oklab, var(--text-tertiary), white 80%)' }}>
                    <span style={{ width: `${logisticPct}%`, background: 'var(--brand-color, #00B286)' }}/>
                  </div>
                  <div className="caption" style={{ textAlign: 'right', marginTop: 2 }}>{logisticPct}%</div>
                </td>
                <td style={{ textAlign: 'right' }} className="tabular-nums">{fmtMoney(e.total_invoiced)}</td>
                <td style={{ textAlign: 'right' }} className="tabular-nums">{fmtMoney(e.balance)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   NewProductDrawer — Alta manual de producto (strict footwear)
   ═══════════════════════════════════════════════════════════════ */
function NewProductDrawer({ lang, brand, onClose, onCreated }) {
  // Lazy import via require-style is fine because we're already bundled.
  // We import directly in the file top-level for clarity.
  return (
    <>
      <motion.div
        className="drawer-backdrop"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.aside
        className="drawer-panel drawer-panel-lg"
        role="dialog" aria-modal="true"
        initial={{ x: 560, opacity: 0.6 }}
        animate={{ x: 0, opacity: 1, transition: { type: 'spring', stiffness: 260, damping: 30 } }}
        exit={{ x: 560, opacity: 0, transition: { duration: 0.18 } }}
      >
        <NewProductForm
          lang={lang}
          brand={brand}
          onClose={onClose}
          onCreated={onCreated}
        />
      </motion.aside>
    </>
  );
}

/* Standalone form (kept in same file to avoid an extra file) */
function NewProductForm({ lang, brand, onClose, onCreated }) {
  const [form, setForm] = useState({
    sku: '',
    nombre: '',
    tipo_calzado: 'Bota al Tobillo',
    cubrepuntera: 'Sí',
    tipo_puntera: 'Composite 200J',
    antiperforante: 'Textil 1100 N',
    protector_metatarsal: 'No',
    capellada: 'Cuero Plena Flor',
    disipativo_energia: 'ISO 20345 14.000V',
    suela: 'Bidensidad PU',
    normativa: 'ISO 20345',
    cierre: 'Con Cordones',
    color: 'Negro',
    segmento: 'Construcción',
    materiales_circulares: 'No',
    plantilla_interna: 'Poliuretano',
    ncm: '',
    riesgo: 'Ocupacional',
    list_price: '',
  });

  const update = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const valid = form.sku.trim().length >= 3 && form.nombre.trim().length >= 3;

  const submit = (e) => {
    e.preventDefault();
    if (!valid) return;
    onCreated && onCreated({ ...form, brand_id: brand.id });
  };

  const FIELDS = [
    { k:'tipo_calzado' },
    { k:'cubrepuntera' },
    { k:'tipo_puntera' },
    { k:'antiperforante' },
    { k:'protector_metatarsal' },
    { k:'capellada' },
    { k:'disipativo_energia' },
    { k:'suela' },
    { k:'normativa' },
    { k:'cierre' },
    { k:'color' },
    { k:'segmento' },
    { k:'materiales_circulares' },
    { k:'plantilla_interna' },
    { k:'riesgo' },
  ];
  const LABELS = {
    tipo_calzado:'Tipo de calzado', cubrepuntera:'Cubrepuntera',
    tipo_puntera:'Tipo de puntera', antiperforante:'Antiperforante',
    protector_metatarsal:'Protector metatarsal', capellada:'Capellada',
    disipativo_energia:'Disipativo de energía', suela:'Suela',
    normativa:'Normativa', cierre:'Cierre', color:'Color',
    segmento:'Segmento', materiales_circulares:'Mat. econ. circulares',
    plantilla_interna:'Plantilla interna', riesgo:'Riesgo',
  };

  return (
    <>
      <div className="drawer-head">
        <div>
          <div className="micro">
            {lang === 'es' ? 'NUEVO PRODUCTO' : 'NEW PRODUCT'}
          </div>
          <div className="heading-md">
            {lang === 'es' ? 'Alta manual — calzado de seguridad' : 'Manual onboarding — safety footwear'}
          </div>
          <div className="caption" style={{ marginTop: 2 }}>
            {lang === 'es' ? 'Marca:' : 'Brand:'} <strong>{brand.name}</strong>
          </div>
        </div>
        <button className="icon-btn" onClick={onClose}><IconX size={14}/></button>
      </div>

      <form className="drawer-body" onSubmit={submit}>
        {/* Identificación */}
        <section className="drawer-section">
          <div className="drawer-section-title">
            {lang === 'es' ? 'Identificación' : 'Identification'}
          </div>
          <div className="grid col-2 gap-3">
            <div>
              <label className="field-label">SKU</label>
              <input className="input mono-sm"
                placeholder={`${brand.brand_id}-XYZ-42`}
                value={form.sku}
                onChange={e=>update('sku', e.target.value.toUpperCase())}/>
            </div>
            <div>
              <label className="field-label">{lang === 'es' ? 'Nombre comercial' : 'Commercial name'}</label>
              <input className="input"
                placeholder={lang === 'es' ? 'Bota seguridad 50S29…' : 'Safety boot 50S29…'}
                value={form.nombre}
                onChange={e=>update('nombre', e.target.value)}/>
            </div>
            <div>
              <label className="field-label">NCM</label>
              <input className="input mono-sm"
                placeholder="6403.40.00"
                value={form.ncm}
                onChange={e=>update('ncm', e.target.value)}/>
            </div>
            <div>
              <label className="field-label">
                {lang === 'es' ? 'Precio de lista (USD)' : 'List price (USD)'}
              </label>
              <input className="input tabular-nums" type="number" step="0.01"
                placeholder="49.90"
                value={form.list_price}
                onChange={e=>update('list_price', e.target.value)}/>
            </div>
          </div>
        </section>

        {/* 14 atributos estrictos */}
        <section className="drawer-section">
          <div className="drawer-section-title">
            {lang === 'es' ? 'Atributos técnicos' : 'Technical attributes'}
            <span className="caption" style={{ marginLeft: 8, color: 'var(--text-tertiary)' }}>
              {lang === 'es' ? 'Estrictos · normativa calzado' : 'Strict · footwear norm'}
            </span>
          </div>
          <div className="grid col-2 gap-3">
            {FIELDS.map(f => (
              <div key={f.k}>
                <label className="field-label">{LABELS[f.k]}</label>
                <select className="select"
                  value={form[f.k]}
                  onChange={e=>update(f.k, e.target.value)}>
                  {(BRAND_ATTRIBUTES[f.k] || []).map(o => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </section>
      </form>

      <div className="drawer-foot">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          {lang === 'es' ? 'Cancelar' : 'Cancel'}
        </button>
        <button type="button" className="btn btn-primary" disabled={!valid} onClick={submit}>
          <IconCheck size={14}/>
          {lang === 'es' ? 'Crear producto' : 'Create product'}
        </button>
      </div>
    </>
  );
}
