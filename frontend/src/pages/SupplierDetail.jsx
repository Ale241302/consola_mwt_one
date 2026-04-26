// ─────────────────────────────────────────────────────────────
// SupplierDetailDashboard — orquestador detalle proveedor
// Agente responsable: [AG-FRONTEND]
//
// Header 4 KPIs:
//   1. Volumen Transaccionado     (USD acumulado)
//   2. Expedientes Activos        (en curso)
//   3. Score Calidad              (ISO último)
//   4. Eficiencia Lead Time       (real / prometido %)
//
// Tabs:
//   - Comercial        tabla productos proveídos + tabla expedientes (link directo)
//   - Promociones      SupplierPromoEngine (Tab 2)
//   - Auditoría ISO    SupplierAuditTab (Tab 3)
// ─────────────────────────────────────────────────────────────
import React, { useState, useMemo, useEffect, useCallback } from "react";
import { useNavigate, useParams, useOutletContext } from "react-router-dom";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  IconChevLeft, IconPackage, IconFolder, IconShield, IconTruck,
  IconDollar, IconMail, IconFileText, IconPercent, IconAlert, IconCheck,
  IconPencil, IconPlus, IconTrash,
} from "../lib/icons.jsx";
import { fmtMoney } from "../lib/i18n.js";
import {
  SUPPLIERS, SUPPLIER_PRODUCTS, SUPPLIER_EXPEDIENTE_REFS,
  SUPPLIER_AUDIT_SCORES, BRAND_PRODUCTS, EXPEDIENTES,
} from "../data/mockData.js";
import { proveedoresApi, productosApi, ocsApi, apiFetch, getToken } from "../lib/api.js";
import { useRole } from "../context/RoleContext.jsx";
import SupplierPromoEngine from "../components/proveedores/SupplierPromoEngine.jsx";
import SupplierAuditTab from "../components/proveedores/SupplierAuditTab.jsx";
import AssignItemsModal from "../components/common/AssignItemsModal.jsx";
import AssignSupplierProductModal from "../components/proveedores/AssignSupplierProductModal.jsx";

// Banderitas por país — coincide con SupplierFormView
const FLAG_BY_ISO2 = {
  BR:'🇧🇷', CN:'🇨🇳', PE:'🇵🇪', MX:'🇲🇽', CO:'🇨🇴',
  AR:'🇦🇷', CL:'🇨🇱', US:'🇺🇸', CY:'🇨🇾',
};

// Backend (snake_case) → shape que el componente ya consume.
function adaptSupplier(b) {
  if (!b) return null;
  const certs = Array.isArray(b.certificaciones) ? b.certificaciones : [];
  const cats  = Array.isArray(b.categorias)      ? b.categorias      : [];
  // Mapeo de `clase` del backend (CRITICO/NORMAL/EVENTUAL) y los del
  // form viejo (CRITICO/IMPORTANTE/ESTANDAR) — en cualquier caso se
  // intenta hacer match con CLASE_META; si no hay, cae en ESTANDAR.
  return {
    id:                  b.id,
    nombre_comercial:    b.nombre_comercial || b.razon_social || '—',
    razon_social:        b.razon_social || b.nombre_comercial || '—',
    pais:                b.pais_iso2 || '',
    flag:                FLAG_BY_ISO2[(b.pais_iso2 || '').toUpperCase()] || '🌐',
    clase:               b.clase || 'ESTANDAR',
    status:              b.estado === 'ACTIVO' ? 'ACTIVO'
                          : b.estado === 'PROSPECTO' ? 'EN_SELECCION'
                          : b.estado || 'ACTIVO',
    certs,
    iso_score:           Number(b.score_iso) || 0,
    lead_time_promised:  Number(b.lead_time_dias) || 0,
    lead_time_real:      Number(b.lead_time_dias) || 0,   // backend aún no separa real
    volumen_transaccionado: 0,    // proviene de /kpis/ (spend_ytd_usd)
    expedientes_activos:    0,    // proviene de /kpis/ (oc_abiertas)
    categoria_desc:      cats.length ? cats.join(' · ') : (b.notas_internas || ''),
    producto_servicio:   b.producto_servicio || '',
    onboarded:           (b.created_at || '').slice(0, 10),
    contacto_nombre:     b.contacto_nombre || '',
    contacto_email:      b.contacto_email  || '',
    contacto_tel:        b.contacto_tel    || '',
  };
}

const CLASE_META = {
  CRITICO:    { label:'CRÍTICO',    color:'#DC2626', soft:'rgba(220,38,38,0.12)' },
  IMPORTANTE: { label:'IMPORTANTE', color:'#3083FE', soft:'rgba(48,131,254,0.12)' },
  ESTANDAR:   { label:'ESTÁNDAR',   color:'#64748B', soft:'rgba(100,116,139,0.12)' },
};

const STATUS_META = {
  ACTIVO:       { label:'Activo',       color:'#0E8A6D' },
  EN_SELECCION: { label:'En selección', color:'#B45309' },
  DESCARTADO:   { label:'Descartado',   color:'#64748B' },
};

const PHASE_META = {
  REGISTRO:    { label:'Registro',    color:'#64748B' },
  PRODUCCION:  { label:'Producción',  color:'#3083FE' },
  PREPARACION: { label:'Preparación', color:'#481EE3' },
  DESPACHO:    { label:'Despacho',    color:'#1EE3D7' },
  TRANSITO:    { label:'Tránsito',    color:'#B45309' },
  EN_DESTINO:  { label:'En destino',  color:'#00B286' },
  CERRADO:     { label:'Cerrado',     color:'#0E8A6D' },
};

function scoreTier(s) {
  if (s >= 4.0) return { color:'#00B286', label:'Sólido' };
  if (s >= 3.0) return { color:'#B45309', label:'Vigilado' };
  return { color:'#DC2626', label:'Riesgo' };
}

export default function ScreenSupplierDetail() {
  const navigate = useNavigate();
  const { supplierId } = useParams();
  const { lang } = useOutletContext();

  const [tab, setTab] = useState('comercial');
  const [supplier, setSupplier] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Fetch del backend con fallback a mock (compat con SUP-001/etc.)
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setNotFound(false);
    (async () => {
      // 1) Intentar backend
      try {
        const data = await proveedoresApi.get(supplierId);
        if (!alive) return;
        const adapted = adaptSupplier(data);
        if (adapted) {
          // 2) Sumar KPIs reales (best-effort, no bloqueante)
          try {
            const k = await proveedoresApi.action('kpis', supplierId);
            if (alive && k) {
              adapted.expedientes_activos    = Number(k.oc_abiertas)   || 0;
              adapted.volumen_transaccionado = Number(k.spend_ytd_usd) || 0;
            }
          } catch (_) { /* KPIs son opcionales */ }
          if (alive) { setSupplier(adapted); setLoading(false); }
          return;
        }
      } catch (_) { /* sigue al fallback */ }

      // 3) Fallback al mock por si es un SUP-XXX legacy
      const fromMock = SUPPLIERS.find(s => s.id === supplierId);
      if (!alive) return;
      if (fromMock) { setSupplier(fromMock); setLoading(false); }
      else          { setNotFound(true);     setLoading(false); }
    })();
    return () => { alive = false; };
  }, [supplierId]);

  // Hooks que dependen de supplier (siempre antes del return condicional)
  const productIndex = useMemo(() => {
    const m = {};
    BRAND_PRODUCTS.forEach(p => { m[p.sku] = p; });
    return m;
  }, []);

  // ── Catálogo de abastecimiento (assignments backend) ─────────
  const isUuid = /^[0-9a-f-]{36}$/i.test(supplierId || '');
  const { isAdmin } = useRole();
  const [beProducts, setBeProducts] = useState([]);          // [{id, supplier_id, product_sku, supplier_sku_code, moq, base_cost_usd?, production_lead_time_days, cantidad_12m, ultima_po_fecha, nombre_producto}]
  const [loadingBeProds, setLoadingBeProds] = useState(false);

  const reloadProducts = useCallback(async () => {
    if (!isUuid) { setBeProducts([]); return; }
    setLoadingBeProds(true);
    try {
      const list = await proveedoresApi.action('products', supplierId);
      setBeProducts(Array.isArray(list) ? list : []);
    } catch (_) {
      setBeProducts([]);
    } finally {
      setLoadingBeProds(false);
    }
  }, [supplierId, isUuid]);

  useEffect(() => { reloadProducts(); }, [reloadProducts]);

  // ── OCs asignadas al proveedor (backend real) ───────────────
  const [beOcs, setBeOcs] = useState([]);
  const [loadingBeOcs, setLoadingBeOcs] = useState(false);

  const reloadOcs = useCallback(async () => {
    if (!isUuid) { setBeOcs([]); return; }
    setLoadingBeOcs(true);
    try {
      const list = await ocsApi.list({ proveedor: supplierId });
      setBeOcs(Array.isArray(list) ? list : []);
    } catch (_) {
      setBeOcs([]);
    } finally {
      setLoadingBeOcs(false);
    }
  }, [supplierId, isUuid]);

  useEffect(() => { reloadOcs(); }, [reloadOcs]);

  // ── Modal "Asignar SKU al proveedor" (catálogo abastecimiento) ─
  const [openAssignProds, setOpenAssignProds] = useState(false);

  const handleAssignProductBody = async (body) => {
    // body = { product_sku, supplier_sku_code, moq, base_cost_usd?,
    //          production_lead_time_days, notas? }
    await proveedoresApi.action('products', supplierId, body);
    await reloadProducts();
  };

  // ── Modal "Asignar expedientes (OCs)" ────────────────────────
  const [openAssignOcs, setOpenAssignOcs] = useState(false);
  const [availOcs, setAvailOcs] = useState([]);
  const [loadingAvailOcs, setLoadingAvailOcs] = useState(false);

  const openAssignOcsModal = async () => {
    setOpenAssignOcs(true);
    setLoadingAvailOcs(true);
    try {
      const all = await ocsApi.list();
      const myIds = new Set(beOcs.map(o => o.id));
      setAvailOcs((all || []).filter(o => !myIds.has(o.id)));
    } catch (_) {
      setAvailOcs([]);
    } finally {
      setLoadingAvailOcs(false);
    }
  };

  const handleAssignOcs = async (ids) => {
    await Promise.all(
      ids.map(id => ocsApi.update(id, { proveedor_id: supplierId }))
    );
    await reloadOcs();
  };

  // ── Desasociar (DELETE de la asignación, soft-delete) ────────
  const handleUnassignProduct = async (assignmentId, sku) => {
    if (!assignmentId) return;
    if (!window.confirm(
      (lang==='es' ? '¿Quitar este SKU del catálogo del proveedor?\n\n' : 'Remove this SKU from the supplier catalog?\n\n')
      + (sku || assignmentId)
    )) return;
    try {
      await apiFetch(`/proveedores/${supplierId}/products/${assignmentId}/`, {
        method: 'DELETE',
        token: getToken(),
      });
      await reloadProducts();
    } catch (e) {
      alert((lang==='es' ? 'No se pudo desasociar: ' : 'Could not unassign: ') + (e?.message || e));
    }
  };

  const handleUnassignOc = async (ocId, ocLabel) => {
    if (!ocId) return;
    if (!window.confirm(
      (lang==='es' ? '¿Quitar esta OC del proveedor?\n\n' : 'Remove this PO from the supplier?\n\n')
      + (ocLabel || ocId)
    )) return;
    try {
      await ocsApi.update(ocId, { proveedor_id: null });
      await reloadOcs();
    } catch (e) {
      alert((lang==='es' ? 'No se pudo desasociar: ' : 'Could not unassign: ') + (e?.message || e));
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="page">
        <div className="card card-pad-lg empty">
          <div className="heading-md">{lang==='es'?'Cargando proveedor…':'Loading supplier…'}</div>
        </div>
      </div>
    );
  }

  if (notFound || !supplier) {
    return (
      <div className="page">
        <div className="card card-pad-lg empty">
          <IconAlert size={22} style={{color:'var(--critical)'}}/>
          <div className="heading-md">{lang==='es'?'Proveedor no encontrado':'Supplier not found'}</div>
          <button className="btn btn-accent" onClick={()=>navigate('/proveedores')}>
            {lang==='es'?'Volver':'Back'}
          </button>
        </div>
      </div>
    );
  }

  const clase = CLASE_META[supplier.clase] || CLASE_META.ESTANDAR;
  const status = STATUS_META[supplier.status] || STATUS_META.ACTIVO;
  const tier = scoreTier(supplier.iso_score);
  const audit = SUPPLIER_AUDIT_SCORES[supplier.id];

  const ltEff = supplier.lead_time_real > 0
    ? (supplier.lead_time_promised / supplier.lead_time_real) * 100
    : 0;
  const ltTier = ltEff >= 95 ? '#00B286' : ltEff >= 80 ? '#B45309' : '#DC2626';

  // Si es proveedor del backend (UUID), usamos las listas reales
  // adaptadas al shape que la tabla espera. Para SUP-XXX legacy mock,
  // seguimos con SUPPLIER_PRODUCTS / SUPPLIER_EXPEDIENTE_REFS.
  // Adapter: el endpoint /products/ devuelve assignments (no productos crudos).
  // Mapeamos al shape que la tabla consume.
  const products = isUuid
    ? beProducts.map(a => ({
        id:                  a.id,                        // UUID del assignment (no del producto)
        sku:                 a.product_sku,
        nombre:              a.nombre_producto || '',
        supplier_sku_code:   a.supplier_sku_code || '',
        moq:                 Number(a.moq) || 0,
        base_cost_usd:       a.base_cost_usd != null ? Number(a.base_cost_usd) : null,
        production_lead_time_days: Number(a.production_lead_time_days) || 0,
        units_12m:           Number(a.cantidad_12m) || 0,
        last_purchase_price: a.base_cost_usd != null ? Number(a.base_cost_usd) : 0,
        last_po_date:        (a.ultima_po_fecha || '').slice(0, 10) || '—',
        _backend:            a,
      }))
    : SUPPLIER_PRODUCTS.filter(p => p.supplier_id === supplier.id);

  const expedientes = isUuid
    ? beOcs.map(o => ({
        id:             o.id,                          // UUID real de la OC
        expediente_ref: o.codigo || o.id,
        estado:         (o.estado || 'REGISTRO').toUpperCase(),
        fecha:          (o.issued_at || o.created_at || '').slice(0, 10),
        monto:          Number(o.total_usd || o.total_value) || 0,
        _backend:       o,
      }))
    : SUPPLIER_EXPEDIENTE_REFS.filter(e => e.supplier_id === supplier.id);

  const resolveExpedienteId = (ref) => {
    // En modo backend, el ref ES el codigo o id real de la OC →
    // buscar primero en las OCs reales para mantener navegación viva.
    if (isUuid) {
      const hit = beOcs.find(o => o.codigo === ref || o.id === ref);
      return hit?.id || null;
    }
    const hit = EXPEDIENTES.find(e => e.id === ref || e.ref === ref);
    return hit?.id || null;
  };

  return (
    <div className="page">
      {/* Header */}
      <div className="page-header">
        <div>
          <button className="btn btn-ghost" style={{marginBottom:8}} onClick={()=>navigate('/proveedores')}>
            <IconChevLeft size={14}/> {lang==='es'?'Volver a proveedores':'Back to suppliers'}
          </button>
          <div className="micro" style={{marginBottom:6}}>
            {lang==='es'?'DETALLE DE PROVEEDOR':'SUPPLIER DETAIL'}
          </div>
          <div className="sup-detail-title">
            <h1 className="page-title" style={{margin:0}}>{supplier.nombre_comercial}</h1>
            {/* Solo mostramos el ID si es un código humano (PRV-XXX), nunca el UUID crudo */}
            {supplier.id && !/^[0-9a-f-]{36}$/i.test(supplier.id) && (
              <span className="mono-sm" style={{color:'var(--text-tertiary)'}}>{supplier.id}</span>
            )}
          </div>
          <div className="page-subtitle">
            {supplier.razon_social} · {supplier.pais}
          </div>
          <div className="sup-detail-badges" style={{marginTop:10}}>
            <span className="sup-clase-badge"
                  style={{'--clase-color': clase.color, '--clase-soft': clase.soft}}>
              <span className="dot"/>{clase.label}
            </span>
            <span className="phase-pill"
                  style={{'--phase-color': status.color, '--phase-soft':'rgba(0,0,0,0.06)'}}>
              <span className="dot"/>{status.label}
            </span>
            {(supplier.certs || []).map(c => (
              <span key={c} className="sup-cert-chip">{c}</span>
            ))}
          </div>
        </div>
        <div className="flex ai-center gap-2">
          {/* Solo editable cuando viene del backend (UUID), no mocks SUP-XXX */}
          {/^[0-9a-f-]{36}$/i.test(supplier.id) && (
            <button className="btn"
                    onClick={()=>navigate(`/proveedores/${supplier.id}/editar`)}>
              <IconPencil size={14}/> {lang==='es'?'Editar':'Edit'}
            </button>
          )}
          {supplier.contacto_email && (
            <a className="btn" href={`mailto:${supplier.contacto_email}`}>
              <IconMail size={14}/> {supplier.contacto_nombre || supplier.contacto_email}
            </a>
          )}
        </div>
      </div>

      {/* Header KPIs */}
      <div className="nodes-kpis">
        <div className="kpi-tile">
          <div className="k-label">{lang==='es'?'Volumen transaccionado':'Transacted volume'}</div>
          <div className="k-value tabular-nums">{fmtMoney(supplier.volumen_transaccionado)}</div>
          <div className="k-sub">
            <IconDollar size={10} style={{marginRight:4, verticalAlign:'-1px'}}/>
            {lang==='es'?'Acumulado histórico':'Cumulative historical'}
          </div>
        </div>
        <div className="kpi-tile">
          <div className="k-label">{lang==='es'?'Expedientes activos':'Active files'}</div>
          <div className="k-value tabular-nums">{supplier.expedientes_activos}</div>
          <div className="k-sub">
            <IconFolder size={10} style={{marginRight:4, verticalAlign:'-1px'}}/>
            {lang==='es'?'En curso':'In progress'}
          </div>
        </div>
        <div className="kpi-tile">
          <div className="k-label">{lang==='es'?'Score de calidad ISO':'ISO quality score'}</div>
          <div className="k-value tabular-nums" style={{color: tier.color}}>
            {supplier.iso_score.toFixed(1)}
          </div>
          <div className="k-sub">
            <IconShield size={10} style={{marginRight:4, verticalAlign:'-1px', color: tier.color}}/>
            {tier.label} · {audit?.audit_date || '—'}
          </div>
        </div>
        <div className="kpi-tile">
          <div className="k-label">{lang==='es'?'Eficiencia lead time':'Lead time efficiency'}</div>
          <div className="k-value tabular-nums" style={{color: ltTier}}>
            {ltEff.toFixed(0)}%
          </div>
          <div className="k-sub">
            <IconTruck size={10} style={{marginRight:4, verticalAlign:'-1px'}}/>
            {supplier.lead_time_real}d {lang==='es'?'real':'actual'} / {supplier.lead_time_promised}d {lang==='es'?'prometido':'promised'}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="seg" style={{marginTop:16}}>
        <button data-active={tab==='comercial'}    onClick={()=>setTab('comercial')}>
          <IconPackage size={14}/> {lang==='es'?'Comercial':'Commercial'}
        </button>
        <button data-active={tab==='promociones'}  onClick={()=>setTab('promociones')}>
          <IconPercent size={14}/> {lang==='es'?'Promociones':'Promotions'}
        </button>
        <button data-active={tab==='auditoria'}    onClick={()=>setTab('auditoria')}>
          <IconShield size={14}/> {lang==='es'?'Auditoría ISO':'ISO Audit'}
        </button>
      </div>

      {/* Tab content */}
      <AnimatePresence mode="wait">
        {tab === 'comercial' && (
          <motion.div key="comercial"
            initial={{ opacity:0, y:8 }}
            animate={{ opacity:1, y:0, transition:{ duration:0.22 } }}
            exit={{ opacity:0, y:-4, transition:{ duration:0.12 } }}
            className="supplier-tab-body"
          >
            {/* Productos proveídos */}
            <div className="card card-pad-sm supplier-table-wrap" style={{marginTop:14}}>
              <div className="supplier-table-head">
                <div>
                  <div className="heading-md">{lang==='es'?'Productos proveídos':'Supplied products'}</div>
                  <div className="caption" style={{color:'var(--text-tertiary)'}}>
                    {isUuid
                      ? (lang==='es'?'SKUs cuyo proveedor principal es este':'SKUs whose primary supplier is this one')
                      : (lang==='es'?'SKUs con al menos 1 orden en los últimos 12 meses':'SKUs with ≥1 order in last 12 months')}
                    {loadingBeProds && <> · {lang==='es'?'cargando…':'loading…'}</>}
                  </div>
                </div>
                <div style={{display:'flex', alignItems:'center', gap:10}}>
                  <span className="mono-sm">{products.length} SKU{products.length!==1?'s':''}</span>
                  {isUuid && (
                    <button className="btn btn-xs" onClick={()=>setOpenAssignProds(true)}>
                      <IconPlus size={11}/> {lang==='es'?'Asignar SKU':'Assign SKU'}
                    </button>
                  )}
                </div>
              </div>

              {products.length === 0 ? (
                <div className="empty-state" style={{padding:'20px 12px'}}>
                  <IconPackage size={20} style={{color:'var(--text-tertiary)'}}/>
                  <div className="caption">
                    {lang==='es'?'Sin productos proveídos aún':'No supplied products yet'}
                  </div>
                </div>
              ) : (
                <table className="supplier-products-table">
                  <thead>
                    <tr>
                      <th>{lang==='es'?'SKU MWT':'MWT SKU'}</th>
                      <th>{lang==='es'?'Nombre':'Name'}</th>
                      {isUuid && (
                        <th>{lang==='es'?'Código fábrica':'Factory code'}</th>
                      )}
                      {isUuid && (
                        <th className="ta-right">MOQ</th>
                      )}
                      {isUuid && isAdmin && (
                        <th className="ta-right" style={{color:'#B45309'}}>
                          🔒 {lang==='es'?'Costo FOB':'FOB cost'}
                        </th>
                      )}
                      <th className="ta-right">{lang==='es'?'Cantidad 12M':'Qty 12M'}</th>
                      <th>{lang==='es'?'Última PO':'Last PO'}</th>
                      {isUuid && <th className="ta-right" style={{width:48}}></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((p, idx) => {
                      const ref = productIndex[p.sku];
                      const productName = p.nombre || ref?.nombre || '—';
                      // Para navegar al detalle del producto necesitamos el
                      // UUID del producto, no del assignment. En modo backend
                      // no lo tenemos; resolvemos por SKU contra productIndex
                      // si el mock lo tiene, sino sin navegación.
                      const goToProduct = () => {
                        if (!isUuid) return;
                        // El mock productIndex no aporta UUID — buscamos
                        // productosApi por sku al momento del click.
                        productosApi.list({ q: p.sku }).then(res => {
                          const hit = (res || []).find(x => x.sku === p.sku);
                          if (hit?.id) navigate(`/productos/${hit.id}`);
                        }).catch(() => {});
                      };
                      return (
                        <motion.tr
                          key={p.id || p.sku}
                          initial={{ opacity:0, y:4 }}
                          animate={{ opacity:1, y:0, transition:{ delay: idx*0.03, duration:0.22 } }}
                          className="supplier-product-row"
                          style={{ cursor: isUuid ? 'pointer' : 'default' }}
                          onClick={goToProduct}
                        >
                          <td className="mono-sm">{p.sku}</td>
                          <td>
                            <div className="heading-sm">{productName}</div>
                            {ref && (
                              <div className="caption" style={{color:'var(--text-tertiary)'}}>
                                {ref.tipo_calzado} · {ref.color}
                              </div>
                            )}
                          </td>
                          {isUuid && (
                            <td className="mono-sm" style={{color:'var(--text-secondary)'}}>
                              {p.supplier_sku_code || '—'}
                            </td>
                          )}
                          {isUuid && (
                            <td className="ta-right tabular-nums">
                              {p.moq > 0 ? p.moq.toLocaleString() : '—'}
                            </td>
                          )}
                          {isUuid && isAdmin && (
                            <td className="ta-right tabular-nums" style={{fontWeight:600, color:'#B45309'}}>
                              {p.base_cost_usd != null
                                ? fmtMoney(p.base_cost_usd)
                                : <span style={{color:'var(--text-tertiary)'}}>—</span>}
                            </td>
                          )}
                          <td className="ta-right tabular-nums">{p.units_12m.toLocaleString()}</td>
                          <td className="caption">{p.last_po_date}</td>
                          {isUuid && (
                            <td className="ta-right">
                              <button className="btn btn-xs"
                                      title={lang==='es'?'Quitar SKU del catálogo':'Unassign SKU'}
                                      onClick={(e)=>{
                                        e.stopPropagation();
                                        handleUnassignProduct(p.id, `${p.sku} · ${productName}`);
                                      }}>
                                <IconTrash size={11}/>
                              </button>
                            </td>
                          )}
                        </motion.tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Expedientes asociados */}
            <div className="card card-pad-sm supplier-table-wrap" style={{marginTop:14}}>
              <div className="supplier-table-head">
                <div>
                  <div className="heading-md">{lang==='es'?'Expedientes asociados':'Associated files'}</div>
                  <div className="caption" style={{color:'var(--text-tertiary)'}}>
                    {lang==='es'?'Historial de POs y expedientes vinculados':'Historical POs & linked files'}
                    {loadingBeOcs && <> · {lang==='es'?'cargando…':'loading…'}</>}
                  </div>
                </div>
                <div style={{display:'flex', alignItems:'center', gap:10}}>
                  <span className="mono-sm">{expedientes.length}</span>
                  {isUuid && (
                    <button className="btn btn-xs" onClick={openAssignOcsModal}>
                      <IconPlus size={11}/> {lang==='es'?'Asignar OC':'Assign PO'}
                    </button>
                  )}
                </div>
              </div>

              {expedientes.length === 0 ? (
                <div className="empty-state" style={{padding:'20px 12px'}}>
                  <IconFolder size={20} style={{color:'var(--text-tertiary)'}}/>
                  <div className="caption">
                    {lang==='es'?'Sin expedientes asociados':'No associated files'}
                  </div>
                </div>
              ) : (
                <table className="supplier-exp-table">
                  <thead>
                    <tr>
                      <th>{lang==='es'?'Expediente':'File'}</th>
                      <th>{lang==='es'?'Estado':'State'}</th>
                      <th>{lang==='es'?'Fecha':'Date'}</th>
                      <th className="ta-right">{lang==='es'?'Monto':'Amount'}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {expedientes
                      .sort((a,b) => b.fecha.localeCompare(a.fecha))
                      .map((e, idx) => {
                        const phase = PHASE_META[e.estado] || PHASE_META.REGISTRO;
                        const expId = resolveExpedienteId(e.expediente_ref);
                        return (
                          <motion.tr
                            key={e.expediente_ref + idx}
                            initial={{ opacity:0, y:4 }}
                            animate={{ opacity:1, y:0, transition:{ delay: idx*0.03, duration:0.22 } }}
                            className="supplier-exp-row"
                          >
                            <td>
                              <button className="exp-link mono-sm"
                                      onClick={()=> expId && navigate(`/expedientes/${expId}`)}>
                                {e.expediente_ref}
                              </button>
                            </td>
                            <td>
                              <span className="phase-pill"
                                    style={{'--phase-color': phase.color, '--phase-soft':'rgba(0,0,0,0.06)'}}>
                                <span className="dot"/>{phase.label}
                              </span>
                            </td>
                            <td className="caption">{e.fecha}</td>
                            <td className="ta-right tabular-nums" style={{fontWeight:600}}>
                              {fmtMoney(e.monto)}
                            </td>
                            <td className="ta-right">
                              <div style={{display:'inline-flex', gap:6, justifyContent:'flex-end'}}>
                                {expId && (
                                  <button className="btn btn-xs"
                                          onClick={()=>navigate(`/expedientes/${expId}`)}>
                                    <IconFileText size={11}/> {lang==='es'?'Ver':'View'}
                                  </button>
                                )}
                                {isUuid && e.id && (
                                  <button className="btn btn-xs"
                                          title={lang==='es'?'Quitar OC del proveedor':'Unassign PO'}
                                          onClick={()=>handleUnassignOc(e.id, e.expediente_ref)}>
                                    <IconTrash size={11}/>
                                  </button>
                                )}
                              </div>
                            </td>
                          </motion.tr>
                        );
                      })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Info resumen */}
            <div className="card card-pad-md" style={{marginTop:14}}>
              <div className="heading-md" style={{marginBottom:10}}>
                {lang==='es'?'Resumen del proveedor':'Supplier summary'}
              </div>
              <div className="supplier-info-grid">
                <div>
                  <div className="caption" style={{color:'var(--text-tertiary)'}}>
                    {lang==='es'?'Descripción':'Description'}
                  </div>
                  <div className="body-sm">{supplier.categoria_desc}</div>
                </div>
                <div>
                  <div className="caption" style={{color:'var(--text-tertiary)'}}>
                    {lang==='es'?'Producto/servicio':'Product/service'}
                  </div>
                  <div className="body-sm">{supplier.producto_servicio}</div>
                </div>
                <div>
                  <div className="caption" style={{color:'var(--text-tertiary)'}}>
                    {lang==='es'?'Onboarded':'Onboarded'}
                  </div>
                  <div className="body-sm mono-sm">{supplier.onboarded}</div>
                </div>
                <div>
                  <div className="caption" style={{color:'var(--text-tertiary)'}}>
                    {lang==='es'?'Contacto':'Contact'}
                  </div>
                  <div className="body-sm">{supplier.contacto_nombre}</div>
                  <div className="caption">{supplier.contacto_email}</div>
                  <div className="caption mono-sm">{supplier.contacto_tel}</div>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {tab === 'promociones' && (
          <motion.div key="promociones"
            initial={{ opacity:0, y:8 }}
            animate={{ opacity:1, y:0, transition:{ duration:0.22 } }}
            exit={{ opacity:0, y:-4, transition:{ duration:0.12 } }}
            className="supplier-tab-body"
          >
            <SupplierPromoEngine lang={lang} supplierId={supplier.id}
              supplierName={supplier.nombre_comercial}
              supplierCode={supplier.nombre_comercial.slice(0,3).toUpperCase()}/>
          </motion.div>
        )}

        {tab === 'auditoria' && (
          <motion.div key="auditoria"
            initial={{ opacity:0, y:8 }}
            animate={{ opacity:1, y:0, transition:{ duration:0.22 } }}
            exit={{ opacity:0, y:-4, transition:{ duration:0.12 } }}
            className="supplier-tab-body"
          >
            <SupplierAuditTab lang={lang} supplierId={supplier.id}
              supplierName={supplier.nombre_comercial}/>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Modal: Asignar SKU al proveedor (catálogo abastecimiento) ── */}
      {openAssignProds && createPortal(
        <AssignSupplierProductModal
          supplierName={supplier.nombre_comercial}
          excludeSkus={beProducts.map(a => a.product_sku).filter(Boolean)}
          lang={lang}
          onClose={()=>setOpenAssignProds(false)}
          onAssign={handleAssignProductBody}
        />,
        document.body
      )}

      {/* ── Modal: Asignar OCs (expedientes) al proveedor ── */}
      {openAssignOcs && createPortal(
        <AssignItemsModal
          eyebrow={lang==='es'?'ASIGNAR EXPEDIENTES':'ASSIGN POs'}
          title={(lang==='es'?'Asignar órdenes de compra a ':'Assign purchase orders to ') + supplier.nombre_comercial}
          searchPlaceholder={lang==='es'?'Buscar código OC…':'Search PO code…'}
          actionLabel={lang==='es'?'Asignar':'Assign'}
          loading={loadingAvailOcs}
          emptyHint={lang==='es'
            ? 'No hay más OCs disponibles para asignar.'
            : 'No more POs available to assign.'}
          items={availOcs.map(o => ({
            id:       o.id,
            title:    o.codigo || o.id,
            subtitle: (o.estado || '') + (o.issued_at ? '  ·  ' + o.issued_at.slice(0,10) : ''),
            meta:     o.total_usd != null ? `$${Number(o.total_usd).toLocaleString()}` : '',
          }))}
          onClose={()=>setOpenAssignOcs(false)}
          onAssign={handleAssignOcs}
        />,
        document.body
      )}
    </div>
  );
}
