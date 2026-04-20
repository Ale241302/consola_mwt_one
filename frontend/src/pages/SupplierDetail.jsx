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
import React, { useState, useMemo } from "react";
import { useNavigate, useParams, useOutletContext } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  IconChevLeft, IconPackage, IconFolder, IconShield, IconTruck,
  IconDollar, IconMail, IconFileText, IconPercent, IconAlert, IconCheck,
} from "../lib/icons.jsx";
import { fmtMoney } from "../lib/i18n.js";
import {
  SUPPLIERS, SUPPLIER_PRODUCTS, SUPPLIER_EXPEDIENTE_REFS,
  SUPPLIER_AUDIT_SCORES, BRAND_PRODUCTS, EXPEDIENTES,
} from "../data/mockData.js";
import SupplierPromoEngine from "../components/proveedores/SupplierPromoEngine.jsx";
import SupplierAuditTab from "../components/proveedores/SupplierAuditTab.jsx";

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

  const supplier = SUPPLIERS.find(s => s.id === supplierId);
  const [tab, setTab] = useState('comercial');

  if (!supplier) {
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

  const products = SUPPLIER_PRODUCTS.filter(p => p.supplier_id === supplier.id);
  const expedientes = SUPPLIER_EXPEDIENTE_REFS.filter(e => e.supplier_id === supplier.id);

  const productIndex = useMemo(() => {
    const m = {};
    BRAND_PRODUCTS.forEach(p => { m[p.sku] = p; });
    return m;
  }, []);

  const resolveExpedienteId = (ref) => {
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
            <span className="sup-detail-flag">{supplier.flag}</span>
            <h1 className="page-title" style={{margin:0}}>{supplier.nombre_comercial}</h1>
            <span className="mono-sm" style={{color:'var(--text-tertiary)'}}>{supplier.id}</span>
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
          <a className="btn" href={`mailto:${supplier.contacto_email}`}>
            <IconMail size={14}/> {supplier.contacto_nombre || supplier.contacto_email}
          </a>
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
                    {lang==='es'?'SKUs con al menos 1 orden en los últimos 12 meses':'SKUs with ≥1 order in last 12 months'}
                  </div>
                </div>
                <span className="mono-sm">{products.length} SKU{products.length!==1?'s':''}</span>
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
                      <th>SKU</th>
                      <th>{lang==='es'?'Nombre':'Name'}</th>
                      <th className="ta-right">{lang==='es'?'Cantidad 12M':'Qty 12M'}</th>
                      <th className="ta-right">{lang==='es'?'Último precio':'Last price'}</th>
                      <th>{lang==='es'?'Última PO':'Last PO'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((p, idx) => {
                      const ref = productIndex[p.sku];
                      return (
                        <motion.tr
                          key={p.sku}
                          initial={{ opacity:0, y:4 }}
                          animate={{ opacity:1, y:0, transition:{ delay: idx*0.03, duration:0.22 } }}
                          className="supplier-product-row"
                        >
                          <td className="mono-sm">{p.sku}</td>
                          <td>
                            <div className="heading-sm">{ref?.nombre || '—'}</div>
                            {ref && (
                              <div className="caption" style={{color:'var(--text-tertiary)'}}>
                                {ref.tipo_calzado} · {ref.color}
                              </div>
                            )}
                          </td>
                          <td className="ta-right tabular-nums">{p.units_12m.toLocaleString()}</td>
                          <td className="ta-right tabular-nums" style={{fontWeight:600}}>
                            {fmtMoney(p.last_purchase_price)}
                          </td>
                          <td className="caption">{p.last_po_date}</td>
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
                  </div>
                </div>
                <span className="mono-sm">{expedientes.length}</span>
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
                              {expId && (
                                <button className="btn btn-xs"
                                        onClick={()=>navigate(`/expedientes/${expId}`)}>
                                  <IconFileText size={11}/> {lang==='es'?'Ver':'View'}
                                </button>
                              )}
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
            <SupplierAuditTab lang={lang} supplierId={supplier.id}/>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
