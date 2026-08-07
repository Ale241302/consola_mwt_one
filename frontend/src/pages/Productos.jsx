// ─────────────────────────────────────────────────────────────
// ProductsDashboard — Listado analítico + catálogo
// Agente responsable: [AG-FRONTEND]
//
// KPIs superiores:
//   1. Total unidades vendidas (histórico)
//   2. Precio promedio de venta
//   3. Top 3 tallas más vendidas
//   4. Top 3 nodos por rotación
//
// Tabla principal (ordenada alfabéticamente por SKU):
//   Thumbnail circular · SKU (mono) · Nombre · Marca (badge) · Precio de Lista
//
// Tokens visuales:
//   Navy #0B1E3A · Mint #00B286 · LightGreen #1DE394
//   Purple #481EE3 · Blue #3083FE · Cyan #1EE3D7
// ─────────────────────────────────────────────────────────────
import React, { useMemo, useState, useEffect, useCallback } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  IconPlus, IconSearch, IconPackage, IconSliders,
  IconDollar, IconTag, IconWarehouse, IconSparkle,
  IconCopy, IconTrash, IconDownload,
} from "../lib/icons.jsx";
import { fmtMoney } from "../lib/i18n.js";
import {
  BRANDS, BRAND_PRODUCTS as MOCK_BRAND_PRODUCTS, SIZES, NODES,
  PRODUCT_EXPEDIENTE_LINES, PRODUCT_NODE_ASSIGNMENTS,
} from "../data/mockData.js";
import { productosApi, storageUrl } from "../lib/api.js";
import { TableSkeletonRows } from "../components/ui/Skeleton.jsx";
import useBrandsLight from "../hooks/useBrandsLight.js";

// ─────────────────────────────────────────────────────────────
// Adaptador backend productos.producto → shape UI.
// Backend: id, sku, nombre, marca_id, categoria, subcategoria,
//          precio_lista, precio_distribuidor, hs_code, colores[],
//          tallas[], estado, is_active.
// UI:      id, sku, nombre, brand_id, tipo_calzado, color,
//          ncm, list_price.
// ─────────────────────────────────────────────────────────────
function mapProductoFromApi(r) {
  const colores = Array.isArray(r.colores) ? r.colores : [];
  return {
    id:            r.id,
    sku:           r.sku || "",
    nombre:        r.nombre || "",
    brand_id:      r.marca_id || null,
    brand_nombre:  r.marca_nombre || null,   // ← viene del backend (lookup ya resuelto)
    tipo_calzado:  r.subcategoria || r.categoria || "",
    color:         colores[0] || "",
    ncm:           r.hs_code || "",
    list_price:    Number(r.precio_lista) || 0,
    is_active:     r.is_active !== false,    // default true si viene undefined
    // Imagen principal (gallery[0]). Se renderiza vía /api/storage/download/
    // si existe; si no, fallback a iniciales en el thumb.
    imagen_url:    r.imagen_url || null,
    _raw:          r,
  };
}

export default function ScreenProductos() {
  const navigate = useNavigate();
  const { lang } = useOutletContext();

  const { brands: dbBrands } = useBrandsLight();

  const [q, setQ] = useState('');
  const [brandFilter, setBrandFilter] = useState('ALL');

  // ── Selección múltiple ──
  const [selected, setSelected] = useState(() => new Set());

  // Modal de confirmación para eliminar (reemplaza window.confirm).
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy]     = useState(false);
  const [deleteError, setDeleteError]   = useState('');

  // ── Fetch backend + fallback mock ──
  const [apiProductos, setApiProductos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const data = await productosApi.list();
      const arr  = Array.isArray(data) ? data : (data?.results || []);
      setApiProductos(arr.map(mapProductoFromApi));
    } catch (e) {
      setErr(e); setApiProductos([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Sprint 2026-05-10 · CEO ordenó eliminar TODA fallback a mock data.
  const BRAND_PRODUCTS = apiProductos;
  const usingMock = false;

  // ── Maps de referencia ────────
  const brandMap = useMemo(() => {
    const m = {};
    dbBrands.forEach(b => { m[b.id] = b; });
    return m;
  }, [dbBrands]);
  const sizeMap = useMemo(() => {
    const m = {};
    SIZES.forEach(s => { m[s.id] = s; });
    return m;
  }, []);
  const nodeMap = useMemo(() => {
    const m = {};
    NODES.forEach(n => { m[n.id] = n; });
    return m;
  }, []);

  // ── KPIs agregados ────────
  const kpis = useMemo(() => {
    let totalUnits = 0, totalRev = 0;
    const sizeAgg = {}, nodeAgg = {};

    PRODUCT_EXPEDIENTE_LINES.forEach(l => {
      totalUnits += l.qty;
      totalRev   += l.qty * l.unit_price_sold;
      Object.entries(l.size_breakdown || {}).forEach(([sid, q]) => {
        sizeAgg[sid] = (sizeAgg[sid] || 0) + q;
      });
      // Imputar unidades a los nodos asignados al SKU (pro-rata simple)
      const assignment = PRODUCT_NODE_ASSIGNMENTS.find(a => a.sku === l.sku);
      if (assignment && assignment.node_ids.length > 0) {
        const share = l.qty / assignment.node_ids.length;
        assignment.node_ids.forEach(nid => {
          nodeAgg[nid] = (nodeAgg[nid] || 0) + share;
        });
      }
    });

    const avgPrice = totalUnits > 0 ? totalRev / totalUnits : 0;
    const topSizes = Object.entries(sizeAgg)
      .map(([sid, q]) => ({ size_id: sid, qty: q }))
      .sort((a,b) => b.qty - a.qty)
      .slice(0, 3);
    const topNodes = Object.entries(nodeAgg)
      .map(([nid, q]) => ({ node_id: nid, qty: q }))
      .sort((a,b) => b.qty - a.qty)
      .slice(0, 3);

    return { totalUnits, totalRev, avgPrice, topSizes, topNodes };
  }, []);

  // ── Filtro + ordenamiento alfabético ────────
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return BRAND_PRODUCTS
      .filter(p => {
        if (brandFilter !== 'ALL' && p.brand_id !== brandFilter) return false;
        if (!needle) return true;
        const hay = [p.sku, p.nombre, p.tipo_calzado, p.color].join(' ').toLowerCase();
        return hay.includes(needle);
      })
      .sort((a, b) => (a.sku || '').localeCompare(b.sku || ''));
  }, [q, brandFilter, BRAND_PRODUCTS]);

  // ── Helpers de selección ────────
  const toggleOne = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setSelected(prev => {
      const allSelected = rows.length > 0 && rows.every(r => prev.has(r.id));
      if (allSelected) {
        // Deselecciona los rows actualmente filtrados
        const next = new Set(prev);
        rows.forEach(r => next.delete(r.id));
        return next;
      }
      // Selecciona todos los rows actualmente filtrados (preservando previos fuera del filtro)
      const next = new Set(prev);
      rows.forEach(r => next.add(r.id));
      return next;
    });
  };
  const clearSelection = () => setSelected(new Set());
  const allFilteredSelected = rows.length > 0 && rows.every(r => selected.has(r.id));

  // ── Handlers de fila ────────
  const onToggleActive = async (p) => {
    const next = !p.is_active;
    // Optimista
    setApiProductos(prev => prev.map(x => x.id === p.id ? { ...x, is_active: next } : x));
    try {
      await productosApi.update(p.id, { is_active: next });
    } catch (e) {
      // Rollback
      setApiProductos(prev => prev.map(x => x.id === p.id ? { ...x, is_active: !next } : x));
      alert((lang==='es'?'No se pudo actualizar: ':'Update failed: ') + (e?.message || ''));
    }
  };

  const onDuplicate = async (p) => {
    try {
      await productosApi.action('duplicate', p.id, {});
      await load();
    } catch (e) {
      alert((lang==='es'?'No se pudo duplicar: ':'Duplicate failed: ') + (e?.message || ''));
    }
  };

  // Modal de confirmación: el target puede ser un solo producto (single)
  // o un array de productos (bulk via checkboxes). El modal y el handler
  // se adaptan dinámicamente según el shape.
  const onDelete = (p) => {
    setDeleteTarget(p);          // single product
    setDeleteError('');
  };

  const onBulkDelete = () => {
    if (selected.size === 0) return;
    const items = rows.filter(r => selected.has(r.id));
    if (items.length === 0) return;
    setDeleteTarget(items);      // array → modo bulk
    setDeleteError('');
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const isBulk = Array.isArray(deleteTarget);
    setDeleteBusy(true);
    setDeleteError('');

    if (isBulk) {
      const ids = deleteTarget.map(p => p.id);
      const idSet = new Set(ids);
      // Optimista
      setApiProductos(prev => prev.filter(x => !idSet.has(x.id)));
      setSelected(prev => {
        const n = new Set(prev);
        ids.forEach(id => n.delete(id));
        return n;
      });
      try {
        await productosApi.action('bulk-delete', null, { ids });
        setDeleteTarget(null);
      } catch (e) {
        await load(); // recargar si falla
        setDeleteError((lang==='es'?'No se pudieron eliminar: ':'Bulk delete failed: ') + (e?.message || ''));
      } finally {
        setDeleteBusy(false);
      }
      return;
    }

    // Single
    const p = deleteTarget;
    setApiProductos(prev => prev.filter(x => x.id !== p.id));
    setSelected(prev => {
      if (!prev.has(p.id)) return prev;
      const n = new Set(prev); n.delete(p.id); return n;
    });
    try {
      await productosApi.remove(p.id);
      setDeleteTarget(null);
    } catch (e) {
      await load();
      setDeleteError((lang==='es'?'No se pudo eliminar: ':'Delete failed: ') + (e?.message || ''));
    } finally {
      setDeleteBusy(false);
    }
  };

  // ── Export CSV ────────
  const csvEscape = (v) => {
    const s = v == null ? '' : String(v);
    if (/[;"\n\r]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const onExport = () => {
    const toExport = selected.size > 0
      ? rows.filter(r => selected.has(r.id))
      : rows;
    const header = ['sku','nombre','marca','categoria','color','precio_lista','activo'];
    const lines = [header.join(';')];
    toExport.forEach(p => {
      const marca = p.brand_nombre || brandMap[p.brand_id]?.name || '';
      lines.push([
        csvEscape(p.sku),
        csvEscape(p.nombre),
        csvEscape(marca),
        csvEscape(p.tipo_calzado),
        csvEscape(p.color),
        csvEscape(p.list_price),
        csvEscape(p.is_active ? 'true' : 'false'),
      ].join(';'));
    });
    // BOM UTF-8 al inicio para que Excel detecte codificación
    const csv = '﻿' + lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    const a = document.createElement('a');
    a.href = url;
    a.download = `productos_${yyyy}${mm}${dd}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="micro" style={{marginBottom:6}}>
            {lang==='es'?'CATÁLOGO DE PRODUCTOS':'PRODUCT CATALOG'}
          </div>
          <h1 className="page-title">{lang==='es'?'Productos':'Products'}</h1>
          <div className="page-subtitle">
            {lang==='es'
              ? 'Catálogo maestro MWT.ONE — calzado de seguridad y línea casual. Gobernanza, trazabilidad y motor de tallas integrados.'
              : 'MWT.ONE master catalog — safety footwear and casual line. Governance, traceability, and sizing engine.'}
          </div>
        </div>
        <div className="flex ai-center gap-2">
          <button className="btn" onClick={()=>navigate('/tallas')}>
            <IconSliders size={14}/> {lang==='es'?'Motor de Tallas':'Sizing Engine'}
          </button>
          <button className="btn" onClick={()=>navigate('/ncm')}>
            <IconSliders size={14}/> {lang==='es'?'Motor de NCM':'NCM Engine'}
          </button>
          <button className="btn" onClick={onExport} disabled={rows.length === 0}>
            <IconDownload size={14}/> {lang==='es'?'Exportar':'Export'}
            {selected.size > 0 && <span className="badge-count">{selected.size}</span>}
          </button>
          {selected.size > 0 && !usingMock && (
            <button
              className="btn"
              onClick={onBulkDelete}
              style={{
                color:'#fff',
                background:'var(--critical, #EF4444)',
                borderColor:'var(--critical, #EF4444)',
              }}
              title={lang==='es'?'Eliminar productos seleccionados':'Delete selected products'}
            >
              <IconTrash size={14}/>
              {lang==='es'?'Eliminar seleccionados':'Delete selected'}
              <span className="badge-count">{selected.size}</span>
            </button>
          )}
          <button className="btn btn-accent" onClick={()=>navigate('/productos/nuevo')}>
            <IconPlus size={14}/> {lang==='es'?'Nuevo producto':'New product'}
          </button>
        </div>
      </div>

      {/* ─── Filtros ─── */}
      <div className="nodes-filters" style={{marginTop: 16}}>
        <div className="search-box" style={{flex:'1 1 260px', maxWidth: 420}}>
          <IconSearch size={14} className="search-icon"/>
          <input className="input" value={q} onChange={e=>setQ(e.target.value)}
                 placeholder={lang==='es'?'Buscar por SKU, nombre, color…':'Search by SKU, name, color…'}/>
        </div>
        <div className="seg seg-scroll">
          <button data-active={brandFilter==='ALL'} onClick={()=>setBrandFilter('ALL')}>
            {lang==='es'?'Todas':'All'}
          </button>
          {dbBrands.filter(b => b.active).map(b => (
            <button key={b.id} data-active={brandFilter===b.id} onClick={()=>setBrandFilter(b.id)}>
              {b.name}
            </button>
          ))}
        </div>
      </div>

      {/* ─── Tabla catálogo ─── */}
      <div className="card card-pad-sm products-table-wrap">
        <table className="products-table">
          <thead>
            <tr>
              <th style={{width:36}}>
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={toggleAll}
                  aria-label={lang==='es'?'Seleccionar todo':'Select all'}
                />
              </th>
              <th style={{width:52}}></th>
              <th>SKU</th>
              <th>{lang==='es'?'Nombre':'Name'}</th>
              <th>{lang==='es'?'Marca':'Brand'}</th>
              <th className="ta-right">{lang==='es'?'Precio Lista':'List Price'}</th>
              <th style={{width:80, textAlign:'center'}}>{lang==='es'?'Activo':'Active'}</th>
              <th style={{width:96, textAlign:'center'}}>{lang==='es'?'Acciones':'Actions'}</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 && <TableSkeletonRows rows={8} />}
            <AnimatePresence mode="popLayout">
              {rows.map((p, idx) => {
                const brand = brandMap[p.brand_id];
                const initials = p.nombre.split(' ').slice(0,2).map(w => w[0]).join('').toUpperCase();
                return (
                  <motion.tr
                    key={p.id}
                    layout
                    initial={{ opacity:0, y:6 }}
                    animate={{ opacity:1, y:0, transition:{ delay: idx*0.03, duration:0.22 } }}
                    exit={{ opacity:0, y:-4, transition:{ duration:0.12 } }}
                    whileHover={{ backgroundColor:'rgba(0,178,134,0.04)' }}
                    className="product-row"
                    onClick={()=>navigate(`/productos/${p.id}`)}
                  >
                    <td onClick={(e)=>e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(p.id)}
                        onChange={()=>toggleOne(p.id)}
                        aria-label={`Select ${p.sku}`}
                      />
                    </td>
                    <td>
                      <div className="product-thumb"
                           style={{
                             '--brand-color': brand?.color,
                             // Fondo blanco para que la imagen no se vea con tinte;
                             // override del estilo de iniciales cuando hay imagen.
                             ...(p.imagen_url ? { background: 'var(--surface-raised)', overflow: 'hidden' } : {}),
                           }}>
                        {p.imagen_url ? (
                          <img
                            src={storageUrl(p.imagen_url)}
                            alt={p.nombre}
                            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                            onError={(e) => {
                              // Si la key es inválida (legacy), oculta y deja iniciales
                              e.currentTarget.style.display = 'none';
                              e.currentTarget.parentElement.textContent = initials;
                            }}
                          />
                        ) : initials}
                      </div>
                    </td>
                    <td>
                      <div className="mono-sm product-row-sku">{p.sku}</div>
                    </td>
                    <td>
                      <div className="product-row-name">{p.nombre}</div>
                    </td>
                    <td>
                      <span className="brand-badge-row" style={{'--brand-color': brand?.color}}>
                        <span className="brand-badge-dot" style={{background: brand?.color}}/>
                        {/* Prioridad: nombre real del backend (marca_nombre) →
                            fallback al mock map → último recurso "—" si no hay marca */}
                        {p.brand_nombre || brand?.name || (p.brand_id ? '—' : '—')}
                      </span>
                    </td>
                    <td className="ta-right tabular-nums" style={{fontWeight:600}}>
                      {fmtMoney(p.list_price)}
                    </td>
                    <td onClick={(e)=>e.stopPropagation()} style={{textAlign:'center'}}>
                      <button
                        onClick={()=>onToggleActive(p)}
                        disabled={usingMock}
                        title={p.is_active
                          ? (lang==='es'?'Activo':'Active')
                          : (lang==='es'?'Inactivo':'Inactive')}
                        style={{
                          width:32, height:18, padding:0, border:'none',
                          cursor: usingMock ? 'not-allowed' : 'pointer',
                          opacity: usingMock ? 0.5 : 1,
                          borderRadius:9999,
                          background: p.is_active ? '#00B286' : '#D1D5DB',
                          position:'relative', transition:'background 0.18s',
                          verticalAlign:'middle',
                        }}
                      >
                        <span style={{
                          position:'absolute', top:2, left:2, width:14, height:14,
                          background:'#fff', borderRadius:'50%',
                          transform: p.is_active ? 'translateX(14px)' : 'translateX(0)',
                          transition:'transform 0.18s',
                          boxShadow:'0 1px 2px rgba(0,0,0,0.2)',
                        }}/>
                      </button>
                    </td>
                    <td onClick={(e)=>e.stopPropagation()} style={{textAlign:'center'}}>
                      <div style={{
                        display:'inline-flex',
                        alignItems:'center',
                        justifyContent:'center',
                        gap:6,
                      }}>
                        <button
                          className="icon-btn"
                          title={lang==='es'?'Duplicar':'Duplicate'}
                          onClick={()=>onDuplicate(p)}
                          disabled={usingMock}
                          style={{
                            display:'inline-flex',
                            alignItems:'center',
                            justifyContent:'center',
                            width:28,
                            height:28,
                            padding:0,
                            border:'1px solid var(--border-subtle, #E5E7EB)',
                            background:'transparent',
                            borderRadius:6,
                            cursor: usingMock ? 'not-allowed' : 'pointer',
                            opacity: usingMock ? 0.4 : 1,
                            color:'var(--text-secondary, #4B5563)',
                          }}
                        >
                          <IconCopy size={14}/>
                        </button>
                        <button
                          className="icon-btn"
                          title={lang==='es'?'Eliminar':'Delete'}
                          onClick={()=>onDelete(p)}
                          disabled={usingMock}
                          style={{
                            display:'inline-flex',
                            alignItems:'center',
                            justifyContent:'center',
                            width:28,
                            height:28,
                            padding:0,
                            border:'1px solid var(--border-subtle, #E5E7EB)',
                            background:'transparent',
                            borderRadius:6,
                            cursor: usingMock ? 'not-allowed' : 'pointer',
                            opacity: usingMock ? 0.4 : 1,
                            color:'var(--critical, #EF4444)',
                          }}
                        >
                          <IconTrash size={14}/>
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                );
              })}
            </AnimatePresence>
          </tbody>
        </table>

        {!loading && rows.length === 0 && (
          <div className="empty-state" style={{padding:'28px 12px'}}>
            <IconTag size={24} style={{color:'var(--text-tertiary)'}}/>
            <div className="heading-md">{lang==='es'?'Sin resultados':'No results'}</div>
            <div className="caption">{lang==='es'?'Ajusta los filtros o limpia la búsqueda.':'Tune filters or clear search.'}</div>
          </div>
        )}
      </div>

      {/* ─── Modal de confirmación de eliminar ─── */}
      <AnimatePresence>
        {deleteTarget && (
          <motion.div
            className="modal-backdrop"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => !deleteBusy && setDeleteTarget(null)}
            style={{
              position:'fixed', inset:0, zIndex:1000,
              background:'rgba(11,30,58,0.45)',
              display:'flex', alignItems:'center', justifyContent:'center',
              padding:16,
            }}
          >
            <motion.div
              className="modal-panel"
              initial={{ y: 20, opacity: 0, scale: 0.98 }}
              animate={{ y: 0,  opacity: 1, scale: 1 }}
              exit={{ y: 10, opacity: 0, scale: 0.98 }}
              transition={{ type:'spring', stiffness: 280, damping: 28 }}
              onClick={e => e.stopPropagation()}
              style={{
                background:'var(--surface-raised)',
                borderRadius:12,
                width:'100%', maxWidth:420,
                boxShadow:'0 12px 48px rgba(11,30,58,0.18)',
                overflow:'hidden',
              }}
            >
              <div style={{
                padding:'20px 22px 8px 22px',
                display:'flex', alignItems:'flex-start', gap:14,
              }}>
                <div style={{
                  flexShrink:0, width:40, height:40, borderRadius:'50%',
                  background:'rgba(239,68,68,0.1)',
                  display:'flex', alignItems:'center', justifyContent:'center',
                  color:'var(--critical, #EF4444)',
                }}>
                  <IconTrash size={18}/>
                </div>
                <div style={{flex:1, minWidth:0}}>
                  <div className="heading-md" style={{marginBottom:4}}>
                    {Array.isArray(deleteTarget)
                      ? (lang==='es'
                          ? `Eliminar ${deleteTarget.length} producto${deleteTarget.length === 1 ? '' : 's'}`
                          : `Delete ${deleteTarget.length} product${deleteTarget.length === 1 ? '' : 's'}`)
                      : (lang==='es'?'Eliminar producto':'Delete product')}
                  </div>
                  <div className="caption" style={{color:'var(--text-tertiary)', lineHeight:1.5}}>
                    {Array.isArray(deleteTarget) ? (
                      lang==='es'
                        ? <>¿Seguro que quieres eliminar <strong>{deleteTarget.length} productos seleccionados</strong>? Esta acción es <strong>permanente</strong> y no se puede deshacer. Todos los SKUs quedarán libres para reutilizarse.</>
                        : <>Delete <strong>{deleteTarget.length} selected products</strong>? This action is <strong>permanent</strong> and cannot be undone. All SKUs will be freed for reuse.</>
                    ) : (
                      lang==='es'
                        ? <>¿Seguro que quieres eliminar <strong>{deleteTarget.nombre || deleteTarget.sku}</strong>? Esta acción es <strong>permanente</strong> y no se puede deshacer. El SKU quedará libre para reutilizarse.</>
                        : <>Delete <strong>{deleteTarget.nombre || deleteTarget.sku}</strong>? This action is <strong>permanent</strong> and cannot be undone. The SKU will be freed for reuse.</>
                    )}
                  </div>
                  {Array.isArray(deleteTarget) && deleteTarget.length > 0 && deleteTarget.length <= 8 && (
                    <ul style={{
                      margin:'8px 0 0 0', padding:'8px 12px',
                      background:'rgba(11,30,58,0.04)', borderRadius:6,
                      maxHeight:140, overflowY:'auto',
                      fontSize:12, lineHeight:1.6,
                      listStyle:'none',
                    }}>
                      {deleteTarget.map(p => (
                        <li key={p.id} style={{display:'flex', gap:8, color:'var(--text-secondary)'}}>
                          <span className="mono-sm" style={{minWidth:80, color:'var(--text-tertiary)'}}>{p.sku}</span>
                          <span style={{flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{p.nombre}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {Array.isArray(deleteTarget) && deleteTarget.length > 8 && (
                    <div className="caption" style={{marginTop:8, color:'var(--text-tertiary)', fontStyle:'italic'}}>
                      {lang==='es'
                        ? `Mostrando 8 de ${deleteTarget.length}. Todos serán eliminados.`
                        : `Showing 8 of ${deleteTarget.length}. All will be deleted.`}
                    </div>
                  )}
                  {deleteError && (
                    <div className="caption" style={{
                      color:'var(--critical, #EF4444)', marginTop:10,
                      background:'rgba(239,68,68,0.08)', padding:'8px 10px',
                      borderRadius:6, lineHeight:1.4,
                    }}>
                      {deleteError}
                    </div>
                  )}
                </div>
              </div>
              <div style={{
                padding:'14px 22px 18px 22px',
                display:'flex', gap:8, justifyContent:'flex-end',
              }}>
                <button
                  className="btn"
                  onClick={() => setDeleteTarget(null)}
                  disabled={deleteBusy}
                >
                  {lang==='es'?'Cancelar':'Cancel'}
                </button>
                <button
                  className="btn"
                  onClick={confirmDelete}
                  disabled={deleteBusy}
                  style={{
                    background:'var(--critical, #EF4444)',
                    color:'#fff', borderColor:'var(--critical, #EF4444)',
                    opacity: deleteBusy ? 0.7 : 1,
                    cursor: deleteBusy ? 'wait' : 'pointer',
                  }}
                >
                  {deleteBusy
                    ? (lang==='es'?'Eliminando…':'Deleting…')
                    : Array.isArray(deleteTarget)
                        ? (lang==='es'
                            ? `Eliminar ${deleteTarget.length}`
                            : `Delete ${deleteTarget.length}`)
                        : (lang==='es'?'Eliminar':'Delete')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
