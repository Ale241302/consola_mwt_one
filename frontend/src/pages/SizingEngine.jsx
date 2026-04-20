// ─────────────────────────────────────────────────────────────
// SizingEngine — Motor de Tallas
// Agente responsable: [AG-FRONTEND]
//
// Tabla/grid de tallas agrupadas por sistema de medida, con:
//   · Dimensional specs (Grosor antepié, Grosor talón, Drop, Peso)
//   · Equivalencias cross-system (ej. EU 42 = BR 40 = US Men 9)
//   · Productos que usan cada talla
//
// Tokens visuales:
//   Navy #0B1E3A · Mint #00B286 · LightGreen #1DE394
//   Purple #481EE3 · Blue #3083FE · Cyan #1EE3D7
// ─────────────────────────────────────────────────────────────
import React, { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  IconPlus, IconSearch, IconSliders, IconPackage,
  IconSparkle, IconRefresh,
} from "../lib/icons.jsx";
import {
  SIZE_SYSTEMS, SIZES, PRODUCT_SIZES, BRAND_PRODUCTS,
} from "../data/mockData.js";
import SizeFormDrawer from "../components/productos/SizeFormDrawer.jsx";

export default function ScreenSizingEngine() {
  const { lang } = useOutletContext();
  const [q, setQ] = useState('');
  const [systemFilter, setSystemFilter] = useState('ALL');
  const [selectedSize, setSelectedSize] = useState(null);
  const [showNew, setShowNew] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return SIZES.filter(s => {
      if (systemFilter !== 'ALL' && s.system !== systemFilter) return false;
      if (!needle) return true;
      return (s.valor_talla + ' ' + s.system).toLowerCase().includes(needle);
    });
  }, [q, systemFilter]);

  const systemMap = useMemo(() => {
    const m = {};
    SIZE_SYSTEMS.forEach(s => { m[s.id] = s; });
    return m;
  }, []);

  const productsUsingSize = (sizeId) => {
    const skus = PRODUCT_SIZES.filter(ps => ps.sizes.includes(sizeId)).map(ps => ps.sku);
    return BRAND_PRODUCTS.filter(p => skus.includes(p.sku));
  };

  const kpis = useMemo(() => {
    const totalSizes   = SIZES.length;
    const totalSystems = SIZE_SYSTEMS.length;
    const mapped       = new Set(PRODUCT_SIZES.flatMap(p => p.sizes)).size;
    const unmapped     = totalSizes - mapped;
    return { totalSizes, totalSystems, mapped, unmapped };
  }, []);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="micro" style={{marginBottom:6}}>
            {lang==='es'?'MOTOR DE TALLAS':'SIZING ENGINE'}
          </div>
          <h1 className="page-title">{lang==='es'?'Motor de Tallas':'Sizing Engine'}</h1>
          <div className="page-subtitle">
            {lang==='es'
              ? 'Sistemas de medida, especificaciones dimensionales y equivalencias cross-system.'
              : 'Measurement systems, dimensional specs, and cross-system equivalences.'}
          </div>
        </div>
        <div className="flex ai-center gap-2">
          <button className="btn btn-accent" onClick={()=>setShowNew(true)}>
            <IconPlus size={14}/> {lang==='es'?'Nueva talla':'New size'}
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="nodes-kpis">
        <div className="kpi-tile">
          <div className="k-label">{lang==='es'?'Tallas registradas':'Registered sizes'}</div>
          <div className="k-value tabular-nums">{kpis.totalSizes}</div>
          <div className="k-sub">{lang==='es'?'Red completa':'Full network'}</div>
        </div>
        <div className="kpi-tile">
          <div className="k-label">{lang==='es'?'Sistemas soportados':'Supported systems'}</div>
          <div className="k-value tabular-nums">{kpis.totalSystems}</div>
          <div className="k-sub">EU · US · BR · CM · UK</div>
        </div>
        <div className="kpi-tile">
          <div className="k-label">{lang==='es'?'Con productos asociados':'With mapped products'}</div>
          <div className="k-value tabular-nums">{kpis.mapped}</div>
          <div className="k-sub">
            <span className="dot-credit dot-green"/>
            {kpis.unmapped} {lang==='es'?'huérfanas':'unmapped'}
          </div>
        </div>
        <div className="kpi-tile accent">
          <div className="k-label">{lang==='es'?'Productos cubiertos':'Products covered'}</div>
          <div className="k-value tabular-nums">{PRODUCT_SIZES.length}</div>
          <div className="k-sub">{lang==='es'?'SKUs con tallas definidas':'SKUs with sizes defined'}</div>
        </div>
      </div>

      {/* Filtros */}
      <div className="nodes-filters">
        <div className="search-box" style={{flex:'1 1 260px', maxWidth: 360}}>
          <IconSearch size={14} className="search-icon"/>
          <input className="input" value={q} onChange={e=>setQ(e.target.value)}
                 placeholder={lang==='es'?'Buscar talla (ej. 42, 9.5)…':'Search size…'}/>
        </div>
        <div className="seg">
          <button data-active={systemFilter==='ALL'} onClick={()=>setSystemFilter('ALL')}>
            {lang==='es'?'Todos':'All'}
          </button>
          {SIZE_SYSTEMS.map(s => (
            <button key={s.id} data-active={systemFilter===s.id} onClick={()=>setSystemFilter(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Grid principal · tallas + panel de detalle lateral */}
      <div className="sizing-layout">
        <div className="size-grid">
          <AnimatePresence mode="popLayout">
            {filtered.map((sz, idx) => {
              const sys = systemMap[sz.system] || {};
              const skuCount = PRODUCT_SIZES.filter(ps => ps.sizes.includes(sz.id)).length;
              const isSel = selectedSize?.id === sz.id;
              return (
                <motion.div
                  key={sz.id}
                  layout
                  initial={{ opacity:0, y:10 }}
                  animate={{ opacity:1, y:0, transition:{ delay: idx*0.025, duration:0.25 } }}
                  exit={{ opacity:0, y:-6, transition:{ duration:0.15 } }}
                  whileHover={{ y:-2 }}
                  className={`size-card ${isSel ? 'size-card-sel' : ''}`}
                  style={{ '--sys-color': sys.color || '#00B286' }}
                  onClick={()=>setSelectedSize(sz)}
                >
                  <div className="size-card-head">
                    <span className="size-system-chip">
                      <span className="size-dot" style={{background: sys.color}}/>
                      {sys.label}
                    </span>
                    <span className="size-sku-count">
                      <IconPackage size={10}/> {skuCount}
                    </span>
                  </div>
                  <div className="size-valor tabular-nums">{sz.valor_talla}</div>
                  <div className="size-specs">
                    <div className="spec-pill"><span>Antepié</span><b className="tabular-nums">{sz.dimensional_specs.forefoot_mm}mm</b></div>
                    <div className="spec-pill"><span>Talón</span><b className="tabular-nums">{sz.dimensional_specs.heel_mm}mm</b></div>
                    <div className="spec-pill"><span>Drop</span><b className="tabular-nums">{sz.dimensional_specs.drop_mm}mm</b></div>
                    <div className="spec-pill"><span>Peso</span><b className="tabular-nums">{sz.dimensional_specs.weight_g}g</b></div>
                  </div>
                  {sz.equivalences.length > 0 && (
                    <div className="size-equivs">
                      {sz.equivalences.slice(0, 4).map((eq, i) => (
                        <span key={i} className="equiv-mini">
                          {systemMap[eq.system]?.label || eq.system} {eq.value}
                        </span>
                      ))}
                      {sz.equivalences.length > 4 && (
                        <span className="equiv-mini equiv-more">+{sz.equivalences.length - 4}</span>
                      )}
                    </div>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {/* Panel de detalle */}
        <aside className="size-detail-panel">
          <AnimatePresence mode="wait">
            {selectedSize ? (
              <motion.div
                key={selectedSize.id}
                initial={{ opacity:0, x:12 }}
                animate={{ opacity:1, x:0 }}
                exit={{ opacity:0, x:-12 }}
                transition={{ type:'spring', stiffness:260, damping:30 }}
              >
                <div className="size-detail-head" style={{'--sys-color': systemMap[selectedSize.system]?.color}}>
                  <div>
                    <div className="caption" style={{color:'var(--text-tertiary)'}}>
                      {lang==='es'?'TALLA':'SIZE'} · {systemMap[selectedSize.system]?.label}
                    </div>
                    <div className="size-detail-val tabular-nums">{selectedSize.valor_talla}</div>
                  </div>
                  <button className="btn btn-sm" onClick={()=>setSelectedSize(null)}>✕</button>
                </div>

                <div className="size-detail-section">
                  <div className="size-detail-title">
                    <IconSliders size={13}/> {lang==='es'?'Especificaciones dimensionales':'Dimensional specs'}
                  </div>
                  <div className="size-detail-specs">
                    <div><span>Grosor antepié</span><b className="tabular-nums">{selectedSize.dimensional_specs.forefoot_mm} mm</b></div>
                    <div><span>Grosor talón</span><b className="tabular-nums">{selectedSize.dimensional_specs.heel_mm} mm</b></div>
                    <div><span>Drop</span><b className="tabular-nums">{selectedSize.dimensional_specs.drop_mm} mm</b></div>
                    <div><span>Peso referencial</span><b className="tabular-nums">{selectedSize.dimensional_specs.weight_g} g</b></div>
                  </div>
                </div>

                <div className="size-detail-section">
                  <div className="size-detail-title">
                    <IconRefresh size={13}/> {lang==='es'?'Equivalencias':'Equivalences'}
                  </div>
                  <div className="equiv-table">
                    {selectedSize.equivalences.map((eq, i) => {
                      const sys = systemMap[eq.system];
                      return (
                        <div key={i} className="equiv-row">
                          <span className="equiv-sys" style={{'--sys-color': sys?.color}}>
                            <span className="size-dot" style={{background: sys?.color}}/>
                            {sys?.label || eq.system}
                          </span>
                          <span className="equiv-val tabular-nums">{eq.value}</span>
                          <span className="equiv-desc caption">{sys?.desc || ''}</span>
                        </div>
                      );
                    })}
                    {selectedSize.equivalences.length === 0 && (
                      <div className="caption" style={{color:'var(--text-tertiary)'}}>
                        {lang==='es'?'Sin equivalencias registradas.':'No equivalences on file.'}
                      </div>
                    )}
                  </div>
                </div>

                <div className="size-detail-section">
                  <div className="size-detail-title">
                    <IconPackage size={13}/> {lang==='es'?'Productos que usan esta talla':'Products using this size'}
                  </div>
                  <div className="size-products">
                    {productsUsingSize(selectedSize.id).map(p => (
                      <div key={p.sku} className="size-product-row">
                        <div className="size-product-sku mono-sm">{p.sku}</div>
                        <div className="size-product-name">{p.nombre}</div>
                      </div>
                    ))}
                    {productsUsingSize(selectedSize.id).length === 0 && (
                      <div className="caption" style={{color:'var(--text-tertiary)'}}>
                        {lang==='es'?'Ningún producto usa esta talla todavía.':'No product uses this size yet.'}
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity:0 }}
                animate={{ opacity:1 }}
                exit={{ opacity:0 }}
                className="size-detail-empty"
              >
                <IconSparkle size={22} style={{color:'var(--brand-accent)'}}/>
                <div className="heading-md">{lang==='es'?'Selecciona una talla':'Select a size'}</div>
                <div className="caption" style={{maxWidth:260, textAlign:'center'}}>
                  {lang==='es'
                    ? 'Verás especificaciones dimensionales, equivalencias cross-system y qué productos la usan.'
                    : 'You\'ll see dimensional specs, cross-system equivalences and products that use it.'}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </aside>
      </div>

      <AnimatePresence>
        {showNew && (
          <SizeFormDrawer
            lang={lang}
            onClose={()=>setShowNew(false)}
            onCreated={(payload)=>{
              console.log('[mock] create size:', payload);
              setShowNew(false);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
