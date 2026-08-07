// Client Portal — read-only, safe view.
//
// STRICT RULES (spec):
//  - NEVER show: internal costs, margins, commissions, suppliers,
//    operation mode (B/C), Artifact Policy, rejection reasons.
//  - Pivot view by OC (not expediente); "Mis Órdenes" opens OC Detail.
//  - Status mapping: technical → client-friendly natural states.
//  - KPIs: Payment Coverage %, Credit Days used / limit (no $ exposure).
//  - Deferred price visible only when show_deferred_to_client = true.
//  - Modo C lines get a subtle "Operado por Muito Work" tag.
//  - All downloadable docs marked as signed-URL (15-min expiry).
import React, { useState, useEffect } from "react";
import { clientesApi, storageUrl } from "../lib/api.js";
import { useNavigate, useOutletContext } from "react-router-dom";
import OcChoiceModal from "../components/portal/OcChoiceModal.jsx";
import { tr, fmtMoney, fmtDate } from "../lib/i18n.js";
import { Badge, StatusBadge } from "../components/ui/primitives.jsx";
import { TableSkeletonRows } from "../components/ui/Skeleton.jsx";
import ExportExpedientesModal from "../components/expedientes/ExportExpedientesModal.jsx";
import { runExpedienteExport } from "../lib/expedienteExport.js";
import { INVOICE_AUDIENCE } from "../lib/transferInvoiceHtml.js";
import {
  IconCheck, IconFileText, IconShield, IconDownload, IconMapPin, IconShip, IconPlane,
  IconClock, IconArrow, IconChevRight, IconBuilding, IconUsers, IconPlus,
} from "../lib/icons.jsx";
import { motion } from "framer-motion";
import {
  CLIENTS    as MOCK_CLIENTS,
  OCS        as MOCK_OCS,
  EXPEDIENTES as MOCK_EXPEDIENTES,
} from "../data/mockData.js";
import { usePortalData } from "../hooks/usePortalData.js";
import { useRole } from "../context/RoleContext.jsx";
import ProductCatalogGrid from "../components/portal/ProductCatalogGrid.jsx";

// ── Adapters backend → shape UI ─────
// El backend NO expone total_cost / margin / commission / supplier / modo_operacion;
// el adapter mapea sólo los campos seguros del spec del Portal.
function mapApiOcToPortalOc(r, allApiExpedientes) {
  const expIds = (allApiExpedientes || [])
    .filter(e => e.oc_id === r.id)
    .map(e => e.id);
  return {
    id:          r.id,
    // Fable5-QA 2026-06-12: client_ref = referencia visible del cliente
    // (codigo del documento OC subido / alias E4), igual que /expedientes.
    // El codigo interno PO-2026-N queda como fallback.
    po_code:     r.client_ref || r.codigo || r.po_code || '',
    client_id:   r.client_id || null,
    brand:       r.brand_id || '—',            // UUID — ver TODO resolver nombre
    total_value: Number(r.total_value) || 0,
    total_paid:  Number(r.total_paid)  || 0,
    balance:     Number(r.balance)     || 0,
    coverage_pct: Number(r.coverage_pct) || 0,
    lines_count: Number(r.lines_count) || 0,
    lines: [],                                  // líneas no viajan por /mis_ocs/
    expedientes: expIds,                        // ids de los expedientes asociados
    _raw: r,
  };
}

function mapApiExpedienteToPortalExp(r) {
  return {
    id:           r.id,
    ref:          r.codigo || r.ref || '',
    oc_id:        r.oc_id || null,
    client_id:    r.client_id || null,
    brand_id:     r.brand_id || null,
    // Rev 2026-05-21d · exponer `estado` técnico + naturales (es/en)
    // para que PortalOrders pueda renderizar la pill sin caer al fallback.
    status:       r.estado || 'REGISTRO',
    estado:       r.estado || null,
    estado_cliente_es: r.estado_cliente_es || null,
    estado_cliente_en: r.estado_cliente_en || null,
    origin:       r.origin || '',
    destination:  r.destination || '',
    freight_mode: r.freight_mode || 'SEA',
    eta:          r.eta || null,
    total_invoiced: Number(r.total_invoiced) || 0,
    total_paid:     Number(r.total_paid)     || 0,
    balance:        Number(r.balance)        || 0,
    coverage_pct:   Number(r.coverage_pct)   || 0,
    _raw: r,
  };
}

// ── Status mapping: technical → client natural ─────
const CLIENT_STATUS_MAP = {
  REGISTRO:  { es:'Confirmado',      en:'Confirmed',        step: 0 },
  PRODUCCION:{ es:'En fabricación',  en:'Manufacturing',    step: 1 },
  PREPARACION:{es:'Preparación de despacho', en:'Dispatch preparation', step: 2 },
  DESPACHO:  { es:'Preparación de despacho', en:'Dispatch preparation', step: 2 },
  TRANSITO:  { es:'En tránsito',     en:'In transit',       step: 3 },
  EN_DESTINO:{ es:'En aduana',       en:'In customs',       step: 4 },
  CERRADO:   { es:'Listo',           en:'Ready',            step: 5 },
};
const CLIENT_STEPS_ES = ['Confirmado','En fabricación','Preparación de despacho','En tránsito','En aduana','Listo'];
const CLIENT_STEPS_EN = ['Confirmed','Manufacturing','Dispatch preparation','In transit','In customs','Ready'];

// ── Client-friendly status pill ─────
function ClientStatusPill({ status, lang }) {
  const m = CLIENT_STATUS_MAP[status] || { es: status, en: status, step: 0 };
  const label = lang === 'es' ? m.es : m.en;
  // Color tier
  const tone =
    m.step === 5 ? { bg:'var(--success-bg)', fg:'var(--success)', ring:'var(--success)' } :
    m.step >= 3  ? { bg:'color-mix(in oklab, var(--info) 14%, transparent)', fg:'var(--info)', ring:'var(--info)' } :
    m.step >= 1  ? { bg:'var(--warning-bg)', fg:'var(--warning)', ring:'var(--warning)' } :
                   { bg:'var(--bg-alt)', fg:'var(--text-secondary)', ring:'var(--border-strong)' };
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:5,
      padding:'3px 9px', borderRadius:999,
      background: tone.bg, color: tone.fg,
      border: `1px solid ${tone.ring}`,
      font:'600 11px/1 var(--font-body)',
      whiteSpace:'nowrap'
    }}>
      <span style={{width:5,height:5,borderRadius:'50%',background:tone.fg}}/>
      {label}
    </span>
  );
}

// ── Client progress rail (5 steps, no technical names) ─────
function ClientProgress({ status, lang }) {
  const curStep = CLIENT_STATUS_MAP[status]?.step ?? 0;
  const steps = lang === 'es' ? CLIENT_STEPS_ES : CLIENT_STEPS_EN;
  return (
    <div className="client-rail">
      {steps.map((label, i) => (
        <div key={i} className="rail-step" data-state={i < curStep ? 'done' : i === curStep ? 'active' : 'future'}>
          <div className="rail-node">
            {i < curStep ? <IconCheck size={12}/> : <span>{i+1}</span>}
          </div>
          <div className="rail-label">{label}</div>
          {i < steps.length - 1 && <div className="rail-connector" data-done={i < curStep}/>}
        </div>
      ))}
    </div>
  );
}

// ── KPI card: coverage % (no amounts) ─────
// Sprint 2026-05-20 · Si `pct` es null/undefined o no hay facturación,
// renderiza EmptyState honesto en lugar de "0% Pendiente" (prompt CEO §10).
function CoverageKPI({ pct, lang, hasData = null }) {
  // hasData === false → empty state (sin facturación)
  // hasData === null  → infer desde pct (legacy)
  const isEmpty = hasData === false || pct == null || Number.isNaN(pct);
  if (isEmpty) {
    return (
      <div className="kpi-coverage">
        <div className="kpi-coverage-ring" style={{
          background: 'var(--bg-alt)',
          border: '1px dashed var(--border-strong)',
        }}>
          <div className="kpi-coverage-inner">
            <div style={{
              font: '600 11px/1.2 var(--font-body)',
              color: 'var(--text-tertiary)',
              textAlign: 'center',
              padding: '0 6px',
            }}>
              {lang === 'en' ? 'No data' : 'Sin datos'}
            </div>
          </div>
        </div>
        <div style={{flex:1}}>
          <div className="micro" style={{color:'var(--text-tertiary)', marginBottom:4}}>
            {lang==='es' ? 'COBERTURA DE PAGOS' : 'PAYMENT COVERAGE'}
          </div>
          <div style={{font:'600 13px/1.3 var(--font-body)', color:'var(--text-secondary)', marginBottom:2}}>
            {lang==='es' ? 'Aún sin facturación' : 'No invoicing yet'}
          </div>
          <div className="caption">
            {lang==='es'
              ? 'Cuando MWT emita la primera factura, esta tarjeta se actualizará.'
              : 'When MWT issues your first invoice, this card will update.'}
          </div>
        </div>
      </div>
    );
  }
  const status =
    pct >= 1   ? { es:'Completo', en:'Complete', tone:'success' } :
    pct >= 0.5 ? { es:'Parcial',  en:'Partial',  tone:'warning' } :
                 { es:'Pendiente',en:'Pending',  tone:'critical' };
  const pctShown = Math.min(100, Math.round(pct * 100));
  return (
    <div className="kpi-coverage">
      <div className="kpi-coverage-ring" style={{
        background: `conic-gradient(var(--${status.tone}) ${pctShown*3.6}deg, var(--bg-alt) 0)`
      }}>
        <div className="kpi-coverage-inner">
          <div className="kpi-coverage-pct">{pctShown}<span>%</span></div>
        </div>
      </div>
      <div style={{flex:1}}>
        <div className="micro" style={{color:'var(--text-tertiary)', marginBottom:4}}>
          {lang==='es' ? 'COBERTURA DE PAGOS' : 'PAYMENT COVERAGE'}
        </div>
        <div style={{font:'700 13px/1.3 var(--font-body)', color:`var(--${status.tone})`, marginBottom:2}}>
          {lang==='es' ? status.es : status.en}
        </div>
        <div className="caption">
          {lang==='es' ? 'de tu deuda actual' : 'of current balance'}
        </div>
      </div>
    </div>
  );
}

// ── KPI card: credit days used / limit ─────
// Sprint 2026-05-20 · Si no hay límite o no hay OCs activas, EmptyState honesto.
function CreditDaysKPI({ used, limit, lang }) {
  const hasLimit = limit != null && Number(limit) > 0;
  if (!hasLimit) {
    return (
      <div className="kpi-credit">
        <div className="micro" style={{color:'var(--text-tertiary)', marginBottom:8}}>
          {lang==='es' ? 'DÍAS DE CRÉDITO' : 'CREDIT DAYS'}
        </div>
        <div style={{
          font: '700 14px/1.3 var(--font-body)',
          color: 'var(--text-secondary)',
          marginBottom: 6,
        }}>
          {lang==='es' ? 'Sin límite contratado' : 'No credit limit set'}
        </div>
        <div className="caption">
          {lang==='es'
            ? 'Tu empresa aún no tiene un plazo de crédito asignado por MWT.'
            : 'Your company has no credit term set by MWT yet.'}
        </div>
      </div>
    );
  }
  const pct = Math.min(1, used / limit);
  const tone = used > limit * 0.85 ? 'critical' : used > limit * 0.65 ? 'warning' : 'success';
  return (
    <div className="kpi-credit">
      <div className="micro" style={{color:'var(--text-tertiary)', marginBottom:8}}>
        {lang==='es' ? 'DÍAS DE CRÉDITO' : 'CREDIT DAYS'}
      </div>
      <div className="kpi-credit-num">
        <span style={{font:'800 26px/1 var(--font-display)', color:`var(--${tone})`, fontVariantNumeric:'tabular-nums'}}>{used}</span>
        <span style={{font:'500 14px/1 var(--font-body)', color:'var(--text-tertiary)', marginLeft:4}}>/ {limit} {lang==='es' ? 'días' : 'days'}</span>
      </div>
      <div className="kpi-credit-bar">
        <div className="kpi-credit-fill" style={{width: `${pct*100}%`, background:`var(--${tone})`}}/>
      </div>
      <div className="caption" style={{marginTop:8}}>
        {tone === 'critical' ? (lang==='es' ? 'Cerca del límite' : 'Near limit') :
         tone === 'warning'  ? (lang==='es' ? 'Uso moderado' : 'Moderate use') :
                               (lang==='es' ? 'Dentro del rango' : 'Within range')}
      </div>
    </div>
  );
}

// ── Signed URL download button ─────
function SignedDownload({ label, lang, kind }) {
  return (
    <button className="signed-doc" title={lang==='es' ? 'Enlace seguro — expira en 15 min' : 'Secure link — expires in 15 min'}>
      <IconFileText size={14}/>
      <span style={{flex:1, textAlign:'left'}}>
        <div style={{font:'600 12px/1.2 var(--font-body)', color:'var(--text-primary)'}}>{label}</div>
        <div style={{font:'500 10px/1 var(--font-body)', color:'var(--text-tertiary)', marginTop:2}}>
          <IconShield size={9} style={{display:'inline', verticalAlign:'-1px'}}/>{' '}
          {lang==='es' ? 'Enlace firmado · 15 min' : 'Signed link · 15 min'}
        </div>
      </span>
      <IconDownload size={13} style={{color:'var(--text-tertiary)'}}/>
    </button>
  );
}

// ── Sprint 2026-05-20 · Estilo de chip para filtro de empresa.
// Toggle activo/inactivo con tokens MWT (R1 cero hex).
function chipStyle(active) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '5px 12px',
    font: '600 12px/1 var(--font-body)',
    color: active ? 'var(--text-on-navy)' : 'var(--text-secondary)',
    background: active ? 'var(--brand-primary)' : 'transparent',
    border: `1px solid ${active ? 'var(--brand-primary)' : 'var(--border-strong)'}`,
    borderRadius: 'var(--radius-full)',
    cursor: 'pointer',
    transition: 'background 120ms, color 120ms, border-color 120ms',
    maxWidth: 200,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };
}

// ── Main Portal ─────
export default function ScreenPortal() {
  const navigate = useNavigate();
  const { lang } = useOutletContext();
  const { isClient, can } = useRole();
  const onOpenOC = (ocId) => navigate(`/expedientes/${ocId}`);

  const [tab, setTab] = useState('orders');

  // ── Sprint 2026-05-20 · Multi-empresa.
  //   Antes: portalClientId = 'c1' hardcoded.
  //   Ahora: el backend resuelve el scope a partir del JWT
  //     (users.mwtuser.legal_entity_ids). usePortalData() ya no necesita
  //     un client_id explícito — el header X-Portal-Client se queda null
  //     y backend usa el array del usuario. El frontend solo decide
  //     filtros UI (chips por empresa).
  const [activeEmpresaId, setActiveEmpresaId] = useState(null);  // null = todas
  const {
    me, kpis: apiKpis, ocs: apiOcsRaw, expedientes: apiExpedientesRaw,
    loading: loadingPortal,
  } = usePortalData(activeEmpresaId);

  const apiExpedientes = (apiExpedientesRaw || []).map(mapApiExpedienteToPortalExp);

  // Rev 2026-05-21d · Fallback: si /api/portal/mis_ocs/ devuelve [] (caso
  // tipico cuando la empresa del usuario es operadora pero no cliente final
  // de la OC), construimos "OCs sinteticas" agrupando los expedientes por
  // oc_id. /api/portal/mis_expedientes/ si trae los registros correctos.
  // El shape replica el de mis_ocs (codigo, client_id, client_name,
  // brand_id, total_invoiced/paid/balance agregados) para que el resto
  // del componente PortalOrders no necesite cambios.
  const ocsFromExps = Object.values(
    (apiExpedientesRaw || []).reduce((acc, e) => {
      const ocId = e.oc_id;
      if (!ocId) return acc;
      if (!acc[ocId]) {
        acc[ocId] = {
          id:             ocId,
          codigo:         e.client_ref || e.oc_codigo || '',  // Fable5-QA: ref del cliente
          client_ref:     e.client_ref || null,
          proforma:       e.oc_proforma || null,
          client_id:      e.client_id || null,
          client_name:    e.client_name || null,
          brand_id:       e.brand_id || null,
          total_value:    0,
          total_invoiced: 0,
          total_paid:     0,
          balance:        0,
          coverage_pct:   0,
          lines_count:    0,
          issued_at:      null,
          estado:         e.estado || null,
          _synthetic:     true,
        };
      }
      acc[ocId].total_invoiced += Number(e.total_invoiced) || 0;
      acc[ocId].total_paid     += Number(e.total_paid)     || 0;
      acc[ocId].balance        += Number(e.balance)        || 0;
      return acc;
    }, {})
  );
  const apiOcsEffective = (apiOcsRaw && apiOcsRaw.length > 0)
    ? apiOcsRaw
    : ocsFromExps;
  const apiOcs = apiOcsEffective.map(r => mapApiOcToPortalOc(r, apiExpedientesRaw));

  const OCS         = apiOcs;
  const EXPEDIENTES = apiExpedientes;

  // Empresas asignadas al usuario (vienen del nuevo /api/portal/me/ shape:
  //   { empresas: [{id, nombre, contacto, email, telefono, credit_days, pais_iso2}],
  //     primary:  {...primera empresa...} }
  // Si me.empresas no existe (backend viejo), fallback a shape legacy {id, nombre, ...}
  const empresas = Array.isArray(me?.empresas) ? me.empresas
                    : (me && me.id ? [me] : []);
  const primaryEmpresa = me?.primary || empresas[0] || null;
  const hasMultiEmpresa = empresas.length > 1;

  // Cliente activo: si el usuario seleccionó una empresa específica, esa;
  // si no, primary (primer empresa de la lista).
  const activeEmpresa = activeEmpresaId
    ? empresas.find(e => e.id === activeEmpresaId)
    : primaryEmpresa;

  const client = activeEmpresa ? {
    id: activeEmpresa.id,
    name: activeEmpresa.nombre || 'Cliente',
    razon_social: activeEmpresa.razon_social || activeEmpresa.nombre || '',
    logo_url: activeEmpresa.logo_url || '',
    tax_id: activeEmpresa.tax_id || '',
    country: activeEmpresa.pais_iso2 || '',
    address: activeEmpresa.direccion || '',
    contact: activeEmpresa.contacto || '',
    email: activeEmpresa.email || '',
    phone: activeEmpresa.telefono || '',
    incoterm: activeEmpresa.incoterm || '',
    medio_pago: activeEmpresa.medio_pago || '',
    moneda: activeEmpresa.moneda || 'USD',
    credit_days: activeEmpresa.credit_days ?? null,
    credito_limit_usd: activeEmpresa.credito_limit_usd ?? null,
    credito_usado: activeEmpresa.credito_usado ?? null,
    credito_disponible: activeEmpresa.credito_disponible ?? null,
    tasa_utilizacion: activeEmpresa.tasa_utilizacion ?? null,
  } : null;

  // Orders = OCs belonging to the user's empresas (already scoped by backend).
  const myOCs = apiOcs;
  // Featured (most recent / most active)
  const featured = myOCs[0];

  // KPIs: prioriza /api/portal/kpis/ si llegó; si no, calcula desde OCs
  const totalInvoicedAll = apiKpis ? Number(apiKpis.total_invoiced) || 0
                                   : myOCs.reduce((a,o) => a + (o.total_value || 0), 0);
  const totalPaidAll     = apiKpis ? Number(apiKpis.total_paid) || 0
                                   : myOCs.reduce((a,o) => a + (o.total_paid  || 0), 0);

  // Sprint 2026-05-20: coverage es null cuando no hay facturación, NO 0.
  //   Backend ahora emite is_empty:true en /kpis/ cuando aplica.
  //   Si todavía no facturó, dejamos coverage = null → EmptyState honesto.
  let coveragePct = null;
  let coverageHasData = true;
  if (apiKpis) {
    if (apiKpis.is_empty || apiKpis.coverage_pct == null) {
      coverageHasData = false;
    } else {
      coveragePct = Number(apiKpis.coverage_pct);
    }
  } else if (totalInvoicedAll > 0) {
    coveragePct = totalPaidAll / totalInvoicedAll;
  } else {
    coverageHasData = false;
  }

  // Credit days — null si no hay límite contratado
  const creditLimit = apiKpis?.credit_days_limit
    || activeEmpresa?.credit_days
    || null;
  const creditUsed  = apiKpis?.credit_days_used ?? 0;

  // Sprint 2026-05-21 · EmptyState honesto cuando no hay scope.
  // Backend (apps.portal.views._resolve_client_ids) devuelve `empresas: []`
  // cuando users.mwtuser.legal_entity_ids está vacío para el usuario.
  // Sin este flag el portal renderiza chrome muda → CLIENT cree que
  // está roto. Respetamos la señal del backend en UI.
  const noEmpresas = !loadingPortal && empresas.length === 0;

  return (
    <div style={{ background:'var(--bg)', minHeight:'100%' }} data-screen-label="Client Portal">
      {/* Portal chrome */}
      <div className="portal-chrome">
        {can('view_portal_preview_badge') && (
          <Badge kind="mint" style={{ marginLeft: 8 }}>{lang==='es'?'VISTA CLIENTE':'CLIENT VIEW'}</Badge>
        )}
        <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:10, fontSize:13 }}>
          <span style={{ opacity:0.7 }}>
            {client?.name || (noEmpresas ? (lang==='en'?'No company':'Sin empresa') : '')}
          </span>
          {client && (
            <div className="avatar" style={{ width:28, height:28, fontSize:11, overflow:'hidden', padding:0 }}>
              {client.logo_url ? (
                <img
                  src={storageUrl(client.logo_url)}
                  alt="logo"
                  style={{ width:'100%', height:'100%', objectFit:'contain' }}
                />
              ) : (
                (client.name || '').trim().charAt(0).toUpperCase() || '—'
              )}
            </div>
          )}
        </div>
      </div>

      {noEmpresas ? (
        <NoEmpresasState lang={lang} userEmail={me?.email} />
      ) : (
      <div className="page">
        {/* Greeting */}
        <div className="mb-6">
          <div className="micro" style={{marginBottom:6, color:'var(--brand-accent-dark,#0E8A6D)'}}>
            {lang==='es' ? 'PORTAL DE CLIENTES' : 'CLIENT PORTAL'}
          </div>
          <h1 className="page-title">
            {(() => {
              // Sprint 2026-05-21 · El greeting usa el nombre del USUARIO
              // logueado, no del contacto de la empresa primaria. Antes
              // decía "Hola, Saymonn" / "Hola, Alvaro" — el contacto de
              // Sondel / Muito — incluso cuando el logueado era el CEO.
              // me.user.full_name viene del backend (_user_identity →
              // users.mwtuser.full_name). Fallback: nombre de empresa
              // → genérico.
              const userFullName = me?.user?.full_name || '';
              const greetingName = userFullName.split(' ')[0]
                || client?.name
                || (lang === 'en' ? 'there' : '');
              return lang === 'es' ? `Hola, ${greetingName}` : `Hi, ${greetingName}`;
            })()}
          </h1>
          <div className="page-subtitle">
            {hasMultiEmpresa
              ? (lang === 'en'
                  ? `${empresas.length} companies assigned. Use the filter above to switch scope.`
                  : `${empresas.length} empresas asignadas. Usa el filtro de arriba para cambiar de empresa.`)
              : (lang === 'es'
                  ? 'Revisa tus órdenes, pagos y catálogo de productos.'
                  : 'Review your orders, payments, and product catalog.')}
          </div>
        </div>

        {/* Mi Empresa — solo CLIENT (read-only). Staff ya ve la ficha real en /clientes. */}
        {isClient && client && (
          <MyCompanyCard lang={lang} client={client} creditLimit={creditLimit} creditUsed={creditUsed} />
        )}

        {/* Sprint 2026-05-20 · Filtro de empresa cuando el usuario tiene >1.
            Cuando tiene 1 sola o 0, NO se muestra el filtro. */}
        {hasMultiEmpresa && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
              marginBottom: 16,
              padding: '10px 14px',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <span className="micro" style={{ color: 'var(--text-tertiary)', letterSpacing: '0.06em' }}>
              {lang === 'en' ? 'COMPANY' : 'EMPRESA'}
            </span>
            <button
              type="button"
              onClick={() => setActiveEmpresaId(null)}
              data-active={activeEmpresaId == null}
              style={chipStyle(activeEmpresaId == null)}
            >
              {lang === 'en' ? 'All' : 'Todas'} ({empresas.length})
            </button>
            {empresas.map(e => (
              <button
                key={e.id}
                type="button"
                onClick={() => setActiveEmpresaId(e.id)}
                data-active={activeEmpresaId === e.id}
                style={chipStyle(activeEmpresaId === e.id)}
                title={e.nombre}
              >
                {e.nombre}
              </button>
            ))}
          </div>
        )}

        {/* Client KPIs (safe, no $ exposure) */}
        <div className="portal-kpi-grid mb-6">
          <div className="card card-pad-lg portal-orders-stat">
            <div className="micro" style={{color:'var(--text-tertiary)', marginBottom:8}}>
              {lang==='es' ? 'MIS ÓRDENES' : 'MY ORDERS'}
            </div>
            <div style={{display:'flex', alignItems:'baseline', gap:6, marginBottom:4}}>
              {myOCs.length > 0 ? (
                <>
                  <span style={{font:'800 28px/1 var(--font-display)', color:'var(--text-primary)'}}>{myOCs.length}</span>
                  <span className="caption">{lang==='es' ? 'activas' : 'active'}</span>
                </>
              ) : (
                <span style={{font:'600 14px/1.3 var(--font-body)', color:'var(--text-secondary)'}}>
                  {empresas.length === 0
                    ? (lang === 'en' ? 'No companies assigned' : 'Sin empresas asignadas')
                    : (lang === 'en' ? 'No orders yet' : 'Aún sin órdenes')}
                </span>
              )}
            </div>
            <div className="portal-orders-breakdown">
              {['PRODUCCION','TRANSITO','EN_DESTINO','CERRADO'].map(s => {
                const n = myOCs.filter(o => {
                  const expIds = Array.isArray(o.expedientes) ? o.expedientes : [];
                  return (EXPEDIENTES.find(e => expIds.includes(e.id))?.status) === s;
                }).length;
                if (n === 0) return null;
                return (
                  <div key={s} className="caption">
                    <span className="portal-status-dot" data-state={s}/>
                    {n} {lang==='es' ? CLIENT_STATUS_MAP[s].es : CLIENT_STATUS_MAP[s].en}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Rev 2026-05-21e · Card "TU ÚLTIMA ORDEN" removida (mandato CEO).
            La vista del portal arranca directo con las tabs. */}

        {/* Sprint 2026-05-20 · Tabs reducidas de 4 a 3 (mandato CEO §4).
            La tab "Documentos" se eliminó del nav raíz — los documentos
            viven dentro del detalle de cada expediente, no como tab
            global.
            Sprint 2026-05-30 (CEO) · "Historial de Pagos" oculta
            temporalmente — el modulo de cobros B2B todavia no esta
            curado para mostrarse al cliente. Se mantiene <PortalPayments>
            importado y el case 'payments' por si vuelve. */}
        <div className="tabs mb-4">
          {[
            { k:'orders',   es:'Mis Órdenes',        en:'My Orders' },
            // { k:'payments', es:'Historial de Pagos', en:'Payment History' }, // oculta 2026-05-30
            { k:'products', es:'Productos',          en:'Products' },
          ].map(t => (
            <button key={t.k} className="tab" data-active={tab===t.k} onClick={()=>setTab(t.k)}>
              {lang==='es'?t.es:t.en}
            </button>
          ))}
        </div>

        {tab === 'orders'   && <PortalOrders   lang={lang} ocs={myOCs} expedientes={EXPEDIENTES} onOpenOC={onOpenOC} isClient={isClient} showEmpresaCol={hasMultiEmpresa} loading={loadingPortal}/>}
        {tab === 'payments' && <PortalPayments lang={lang} ocs={myOCs} showEmpresaCol={hasMultiEmpresa}/>}
        {tab === 'products' && <ProductCatalogGrid lang={lang} clientId={activeEmpresa?.id || null} />}
      </div>
      )}
    </div>
  );
}

// ── EmptyState dominante cuando el usuario no tiene legal_entity_ids ─────
// Sprint 2026-05-21. Backend (apps.portal.views) devuelve `empresas: []`
// cuando users.mwtuser.legal_entity_ids está vacío. Antes el portal seguía
// renderizando greeting + KPI cards en blanco; ahora muestra mensaje claro
// con email del usuario para que el admin sepa a quién asignarle empresa.
// Cumple R1 (tokens), R3 (sin data CEO-only), R5 (no aplica), R6 (no aplica).
function NoEmpresasState({ lang, userEmail }) {
  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <div
        className="card card-pad-lg"
        style={{
          marginTop: 48,
          textAlign: 'center',
          background: 'var(--surface)',
          border: '1px dashed var(--border-strong)',
        }}
      >
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 16,
            margin: '0 auto 20px',
            display: 'grid',
            placeItems: 'center',
            background: 'var(--bg-alt)',
            color: 'var(--text-tertiary)',
          }}
        >
          <IconBuilding size={28} />
        </div>
        <h2
          style={{
            font: '700 22px/1.3 var(--font-display)',
            color: 'var(--text-primary)',
            margin: '0 0 10px',
          }}
        >
          {lang === 'en'
            ? 'No companies assigned to your account yet'
            : 'Aún no tienes empresas asignadas a tu cuenta'}
        </h2>
        <p
          style={{
            font: '500 14px/1.55 var(--font-body)',
            color: 'var(--text-secondary)',
            maxWidth: 480,
            margin: '0 auto 18px',
          }}
        >
          {lang === 'en'
            ? 'Your MWT administrator must link at least one company to your profile before you can see orders, payments or the catalog.'
            : 'Tu administrador MWT debe vincular al menos una empresa a tu perfil antes de que puedas ver órdenes, pagos o catálogo.'}
        </p>
        {userEmail && (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              borderRadius: 999,
              background: 'var(--bg-alt)',
              border: '1px solid var(--border-subtle)',
              font: '500 12px/1 var(--font-mono)',
              color: 'var(--text-secondary)',
              marginBottom: 18,
            }}
          >
            <IconUsers size={12} />
            {userEmail}
          </div>
        )}
        <div
          style={{
            font: '500 12px/1.5 var(--font-body)',
            color: 'var(--text-tertiary)',
            paddingTop: 16,
            borderTop: '1px solid var(--divider)',
          }}
        >
          {lang === 'en'
            ? 'Contact your MWT representative or write to '
            : 'Contacta a tu ejecutivo MWT o escribe a '}
          <a
            href="mailto:soporte@muitowork.com"
            style={{ color: 'var(--brand-primary)', fontWeight: 600 }}
          >
            soporte@muitowork.com
          </a>
        </div>
      </div>
    </div>
  );
}

// ── Orders tab: table of OCs (not expedientes) ─────
function PortalOrders({ lang, ocs, expedientes = [], onOpenOC, isClient = false, loading = false }) {
  const navigate = useNavigate();
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting]   = useState(false);
  const [ocChoiceOpen, setOcChoiceOpen] = useState(false);
  const [exportErr, setExportErr]   = useState(null);
  // Export del portal: SIEMPRE vista CLIENT (precio de venta). El modal oculta
  // la pregunta de audiencia porque isAdmin=false.
  // Sprint 2026-06-10 — abre el Cronograma interactivo en pestaña nueva
  // (siempre vista CLIENT desde el portal) con los filtros del modal.
  const handlePortalExport = (opts) => {
    setExportErr(null);
    const p = new URLSearchParams();
    p.set("aud", "CLIENT");
    if (opts.expedienteUuid) {
      p.set("exp", opts.expedienteUuid);
    } else {
      if (opts.clienteId && opts.clienteId !== "ALL") p.set("cliente", opts.clienteId);
      if (opts.estado && opts.estado !== "ALL") p.set("estado", opts.estado);
    }
    window.open(`/cronograma?${p.toString()}`, "_blank", "noopener");
    setExportOpen(false);
  };
  // Clientes para el selector (nombre legible). clientesApi.list() ya viene
  // scopeado por el backend a las empresas del usuario (legal_entity_ids).
  const [clientOpts, setClientOpts] = useState([]);
  useEffect(() => {
    let alive = true;
    clientesApi.list()
      .then((rows) => {
        if (!alive) return;
        const arr = Array.isArray(rows) ? rows : (rows?.results || []);
        setClientOpts(arr.map((c) => ({
          id: c.id,
          name: c.razon_social || c.nombre_comercial || c.name || c.nombre || c.id,
        })));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  // Sólo órdenes con estado real (las "sin estado" / sin envíos no se muestran).
  const visibleOcs = ocs.filter((o) => {
    const lead = expedientes.find((e) => e.oc_id === o.id);
    return !!(lead?.estado || o.estado);
  });
  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">{lang==='es' ? 'Mis Órdenes' : 'My Orders'}</div>
        <div style={{display:'flex', alignItems:'center', gap:12}}>
          <span className="caption">{visibleOcs.length} {lang==='es'?'órdenes':'orders'}</span>
          {/* Sprint 2026-06-10 — botón Exportar retirado: el reporte vive
              en /cronograma (vista React, item del sidebar). */}
          {/* CTA primaria: subir una nueva OC.
              · Nunca decimos "Crear expediente" — eso es jerga interna MWT.
              · Fable5-QA 2026-06-12: visible para TODOS los roles (antes
                solo isClient; el CEO pidio que cualquier usuario pueda
                iniciar una orden desde el portal). La ruta es role-aware:
                CLIENT -> wizard 3 pasos (create-from-oc), staff -> Lite. */}
          {(
            <motion.button
              type="button"
              className="btn btn-primary"
              onClick={() => setOcChoiceOpen(true)}
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.97 }}
              style={{
                background: '#00B286',          // Mint MWT
                color: '#fff',
                border: 'none',
                padding: '8px 16px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                boxShadow: '0 1px 2px rgba(11, 30, 58, 0.10)',
              }}
            >
              <IconPlus size={13}/>
              {lang==='es' ? 'Subir Orden de Compra' : 'Upload Purchase Order'}
            </motion.button>
          )}
          <OcChoiceModal
            open={ocChoiceOpen}
            lang={lang}
            onClose={() => setOcChoiceOpen(false)}
            onYes={() => { setOcChoiceOpen(false); navigate('/portal/nueva-oc'); }}
            onNo={() => { setOcChoiceOpen(false); navigate('/portal/nueva-oc', { state: { jumpToStep: 'products' } }); }}
          />
        </div>
      </div>
      <table className="table">
        <thead><tr>
          <th>{lang==='es' ? 'Orden' : 'Order'}</th>
          <th>{lang==='es' ? 'Estado' : 'Status'}</th>
          <th>{lang==='es' ? 'Cliente' : 'Client'}</th>
          <th/>
        </tr></thead>
        <tbody>
          {loading && visibleOcs.length === 0 && (
            <TableSkeletonRows rows={6} />
          )}
          {visibleOcs.map(o => {
            // Sprint 2026-05-21 · Match real con shape backend
            // (apps.portal.views.mis_ocs):
            //   { id, codigo, brand_id, proforma, moneda, total_value,
            //     total_invoiced, total_paid, balance, coverage_pct,
            //     lines_count, issued_at, estado, client_id, client_name }
            // Backend NO devuelve `expedientes[]` ni `brand` ni `po_code`.
            // Derivamos lead expediente buscando expedientes con oc_id === o.id.
            const ocCode    = o.client_ref || o.codigo || o.po_code || '—';  // Fable5-QA
            const lineCount = o.lines_count ?? (o.lines?.length || 0);
            const relatedExps = expedientes.filter(e => e.oc_id === o.id);
            const leadExp     = relatedExps[0];
            const expCount    = relatedExps.length;
            // Estado natural del expediente (CLIENT_STATE_MAP en backend
            // ya devuelve `estado_cliente_es/en/step` en mis_expedientes).
            // Mismos estados que "Mis Pedidos" (StatusBadge crudo: REGISTRO,
            // EN_DESTINO, PRODUCCION…), no los labels "amigables" del portal.
            const rawStatus   = leadExp?.estado || o.estado || null;
            const expStatus   = leadExp?.estado_cliente_es
                              || leadExp?.estado
                              || o.estado
                              || '—';
            const expEta      = leadExp?.eta;
            const totalVal    = Number(o.total_value || 0);
            const totalPaid   = Number(o.total_paid  || 0);
            const coverage    = totalVal > 0 ? (totalPaid / totalVal) : 0;
            return (
              <tr key={o.id} style={{cursor:'pointer'}} onClick={() => onOpenOC && onOpenOC(o.id)}>
                <td>
                  <div style={{font:'700 12px/1.2 var(--font-mono)', color:'var(--brand-primary)'}}>{ocCode}</div>
                  <div className="caption" style={{marginTop:2}}>
                    {expCount} {lang==='es'?'envíos':'shipments'}
                  </div>
                </td>
                <td>
                  {rawStatus
                    ? <StatusBadge status={rawStatus} lang={lang}/>
                    : <span className="caption">{expStatus}</span>}
                </td>
                <td>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{o.client_name || '—'}</span>
                </td>
                <td><IconChevRight size={14} style={{color:'var(--text-tertiary)'}}/></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {/* Sprint 2026-06-10 — modal de exportación retirado: el reporte
          vive en /cronograma (vista React). */}
    </div>
  );
}

// Inline mini-coverage bar
function CoverageMini({ pct, lang }) {
  const pctShown = Math.min(100, Math.round(pct * 100));
  const tone = pct >= 1 ? 'success' : pct >= 0.5 ? 'warning' : 'critical';
  return (
    <div style={{display:'inline-flex', flexDirection:'column', gap:3, alignItems:'flex-end', minWidth:100}}>
      <span style={{font:'700 12px/1 var(--font-mono)', color:`var(--${tone})`}}>{pctShown}%</span>
      <div style={{width:80, height:4, background:'var(--bg-alt)', borderRadius:2, overflow:'hidden'}}>
        <div style={{width:`${pctShown}%`, height:'100%', background:`var(--${tone})`}}/>
      </div>
    </div>
  );
}

// ── Payments tab: simplified history ─────
function PortalPayments({ lang, ocs }) {
  // Synthesize some client-safe payment records
  const records = ocs.slice(0, 12).flatMap((o, i) => {
    const n = 1 + (i % 3);
    return Array.from({length: n}).map((_, j) => {
      const status = ['verified','released','pending','rejected'][(i*n + j) % 4];
      const amount = Math.round((o.total_value || 20000) * (0.15 + (j * 0.12)));
      const daysAgo = 2 + i * 4 + j * 3;
      const d = new Date(); d.setDate(d.getDate() - daysAgo);
      return {
        id: `pay-${o.id}-${j}`,
        oc: o.po_code,
        amount,
        date: d.toISOString().slice(0,10),
        status,
        method: ['Movimiento','Letra','Cheque'][j % 3]
      };
    });
  }).sort((a,b) => b.date.localeCompare(a.date));

  const badgeFor = (status) => {
    const map = {
      verified: { es:'Verificado',  en:'Verified',  tone:'info' },
      released: { es:'Liberado',    en:'Released',  tone:'success' },
      pending:  { es:'Pendiente',   en:'Pending',   tone:'warning' },
      rejected: { es:'Rechazado',   en:'Rejected',  tone:'critical' },
    };
    const b = map[status];
    return (
      <span className="payment-badge" data-tone={b.tone}>
        {lang==='es'?b.es:b.en}
      </span>
    );
  };

  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">{lang==='es' ? 'Historial de Pagos' : 'Payment History'}</div>
        <span className="caption">{records.length} {lang==='es' ? 'registros' : 'records'}</span>
      </div>
      <table className="table">
        <thead><tr>
          <th>{lang==='es'?'Fecha':'Date'}</th>
          <th>{lang==='es'?'Orden':'Order'}</th>
          <th>{lang==='es'?'Método':'Method'}</th>
          <th style={{textAlign:'right'}}>{lang==='es'?'Monto':'Amount'}</th>
          <th>{lang==='es'?'Estado':'Status'}</th>
        </tr></thead>
        <tbody>
          {records.map(r => (
            <tr key={r.id}>
              <td className="text-sec">{fmtDate(r.date, lang)}</td>
              <td><span className="mono" style={{fontWeight:600, color:'var(--text-secondary)'}}>{r.oc}</span></td>
              <td>{r.method}</td>
              <td className="td-money">{fmtMoney(r.amount)}</td>
              <td>{badgeFor(r.status)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{padding:'12px 16px', borderTop:'1px solid var(--divider)', background:'var(--bg-alt)', font:'500 11px/1.4 var(--font-body)', color:'var(--text-tertiary)', display:'flex', gap:6, alignItems:'center'}}>
        <IconShield size={11}/>
        {lang==='es'
          ? 'Los pagos rechazados requieren contacto directo con tu ejecutivo MWT para más detalles.'
          : 'Rejected payments require direct contact with your MWT rep for details.'}
      </div>
    </div>
  );
}

// ── Mi Empresa card (CLIENT only) ─────
// Ficha read-only con los datos fiscales y comerciales de la compañía.
// Los campos vienen del serializer del Portal (me.*); si falta alguno,
// cae al mock (--) como placeholder visual.
function MyCompanyCard({ lang, client, creditLimit, creditUsed }) {
  const fiscalId       = client.tax_id || '—';
  const companyName    = client.name || client.razon_social || '—';
  const fiscalName     = client.razon_social || '—';
  const fiscalAddress  = client.address || '—';
  const accountManager = client.contact || '—';
  const country        = client.country || '—';
  const PAY_LABEL = { TRANSFER_BANCARIA: lang==='es'?'Transferencia':'Bank transfer', CONTADO: lang==='es'?'Contado':'Cash', CREDITO: lang==='es'?'Crédito':'Credit' };
  const paymentTerms   = [PAY_LABEL[client.medio_pago] || client.medio_pago, client.incoterm].filter(Boolean).join(' · ') || '—';

  return (
    <div className="card card-pad-lg mb-6 my-company-card">
      <div className="flex ai-center gap-3 mb-4" style={{borderBottom:'1px solid var(--divider)', paddingBottom:14}}>
        <div style={{
          width:48, height:48, borderRadius:12,
          background: client.logo_url ? 'var(--surface-raised)' : 'linear-gradient(135deg, var(--brand-primary), var(--brand-ice, #3083FE))',
          color: client.logo_url ? 'inherit' : '#fff', display:'grid', placeItems:'center',
          overflow:'hidden',
        }}>
          {client.logo_url ? (
            <img
              src={storageUrl(client.logo_url)}
              alt="logo"
              style={{ width:'100%', height:'100%', objectFit:'contain' }}
            />
          ) : (
            <IconBuilding size={22}/>
          )}
        </div>
        <div style={{flex:1, minWidth:0}}>
          <div className="micro" style={{color:'var(--text-tertiary)', marginBottom:4}}>
            {lang==='es' ? 'MI EMPRESA' : 'MY COMPANY'}
          </div>
          <div className="heading-lg truncate">{companyName}</div>
          <div className="caption" style={{marginTop:2}}>
            {fiscalName !== companyName ? `${fiscalName} · ` : ''}{country} · {lang==='es' ? 'Ficha read-only' : 'Read-only profile'}
          </div>
        </div>
        <span
          className="caption"
          title={lang==='es' ? 'Para cambios contactá a tu ejecutivo de cuenta' : 'Contact your account manager for changes'}
          style={{
            display:'inline-flex', alignItems:'center', gap:5,
            padding:'4px 9px', borderRadius:999,
            background:'var(--bg-alt)', color:'var(--text-tertiary)',
            border:'1px solid var(--divider)', font:'600 10px/1 var(--font-mono)', letterSpacing:'0.08em',
          }}
        >
          <IconShield size={10}/>{lang==='es' ? 'SOLO LECTURA' : 'READ ONLY'}
        </span>
      </div>

      <div className="grid col-3 gap-4">
        <CompanyField label={lang==='es'?'RUC / CUIT':'Tax ID'} value={fiscalId} mono/>
        <CompanyField label={lang==='es'?'Razón social':'Legal name'} value={fiscalName}/>
        <CompanyField label={lang==='es'?'País':'Country'} value={country}/>
        <CompanyField label={lang==='es'?'Dirección fiscal':'Fiscal address'} value={fiscalAddress} wide/>
        <CompanyField label={lang==='es'?'Ejecutivo de cuenta':'Account manager'} value={accountManager} icon={<IconUsers size={12}/>}/>
        <CompanyField label={lang==='es'?'Condiciones de pago':'Payment terms'} value={paymentTerms}/>
      </div>

      <div className="flex ai-center gap-4 mt-4" style={{paddingTop:14, borderTop:'1px solid var(--divider)'}}>
        <div style={{flex:1}}>
          <div className="micro" style={{marginBottom:4}}>{lang==='es'?'LÍMITE DE CRÉDITO':'CREDIT LIMIT'}</div>
          <div style={{font:'700 15px/1.2 var(--font-mono)', color:'var(--text-primary)'}}>
            {client.credito_limit_usd != null ? fmtMoney(client.credito_limit_usd, client.moneda) : '—'}
          </div>
        </div>
        <div style={{flex:1}}>
          <div className="micro" style={{marginBottom:4}}>{lang==='es'?'CRÉDITO USADO':'CREDIT USED'}</div>
          <div style={{font:'700 15px/1.2 var(--font-mono)', color:(client.tasa_utilizacion||0) >= 100 ? 'var(--critical)' : 'var(--text-primary)'}}>
            {client.credito_usado != null ? fmtMoney(client.credito_usado, client.moneda) : '—'}
            {client.tasa_utilizacion != null && (
              <span style={{fontSize:11, marginLeft:6, color:'var(--text-tertiary)'}}>({Math.round(client.tasa_utilizacion)}%)</span>
            )}
          </div>
          {client.credito_disponible != null && (
            <div className="caption" style={{marginTop:2}}>
              {fmtMoney(client.credito_disponible, client.moneda)} {lang==='es'?'disponible':'available'}
            </div>
          )}
        </div>
        <div style={{flex:1}}>
          <div className="micro" style={{marginBottom:4}}>{lang==='es'?'DÍAS DE CRÉDITO':'CREDIT DAYS'}</div>
          <div style={{font:'700 15px/1.2 var(--font-mono)', color:'var(--text-primary)'}}>
            {client.credit_days != null ? `${client.credit_days} ${lang==='es'?'días':'days'}` : '—'}
          </div>
        </div>
      </div>
    </div>
  );
}

// Small labeled field for Mi Empresa.
function CompanyField({ label, value, mono, icon, wide }) {
  return (
    <div style={wide ? {gridColumn:'1 / -1'} : undefined}>
      <div className="micro" style={{color:'var(--text-tertiary)', marginBottom:4, display:'flex', alignItems:'center', gap:4}}>
        {icon}{label}
      </div>
      <div style={{
        font: mono ? '600 13px/1.3 var(--font-mono)' : '500 13px/1.3 var(--font-body)',
        color:'var(--text-primary)',
      }}>
        {value}
      </div>
    </div>
  );
}

// ── Documents tab: signed URLs ─────
function PortalDocs({ lang, ocs }) {
  // Build a flat list of allowed docs per OC
  const docs = ocs.slice(0, 8).flatMap(o => [
    { id:`${o.id}-pf`, oc:o.po_code, kind: lang==='es'?'Proforma (vista cliente)':'Proforma (client view)', date:'2026-02-08', ext:'pdf' },
    { id:`${o.id}-in`, oc:o.po_code, kind: lang==='es'?'Factura MWT':'MWT Invoice',                       date:'2026-02-14', ext:'pdf' },
    { id:`${o.id}-bl`, oc:o.po_code, kind: lang==='es'?'Documento de embarque (BL/AWB)':'Shipping doc (BL/AWB)', date:'2026-02-20', ext:'pdf' },
  ]);

  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">{lang==='es' ? 'Documentos' : 'Documents'}</div>
        <span className="caption" style={{display:'inline-flex', gap:5, alignItems:'center'}}>
          <IconShield size={11}/>
          {lang==='es' ? 'Enlaces seguros con expiración 15 min' : 'Secure links, 15-min expiry'}
        </span>
      </div>
      <div className="portal-docs-grid">
        {docs.map(d => (
          <div key={d.id} className="portal-doc-card">
            <div className="portal-doc-head">
              <div className="mono" style={{font:'700 10.5px/1 var(--font-mono)', color:'var(--brand-primary)'}}>{d.oc}</div>
              <span className="doc-ext">{d.ext.toUpperCase()}</span>
            </div>
            <div style={{font:'600 13px/1.3 var(--font-body)', color:'var(--text-primary)', marginBottom:4}}>{d.kind}</div>
            <div className="caption" style={{marginBottom:12}}>{fmtDate(d.date, lang)}</div>
            <SignedDownload label={lang==='es'?'Descargar':'Download'} lang={lang} kind={d.kind}/>
          </div>
        ))}
      </div>
    </div>
  );
}
