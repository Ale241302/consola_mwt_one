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
import React, { useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { tr, fmtMoney, fmtDate } from "../lib/i18n.js";
import { Badge } from "../components/ui/primitives.jsx";
import {
  IconCheck, IconFileText, IconShield, IconDownload, IconMapPin, IconShip, IconPlane,
  IconClock, IconArrow, IconChevRight, IconBuilding, IconUsers,
} from "../lib/icons.jsx";
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
    po_code:     r.codigo || r.po_code || '',
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
    status:       r.estado || 'REGISTRO',
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
  PREPARACION:{es:'Preparación',     en:'Preparing',        step: 2 },
  DESPACHO:  { es:'Despachado',      en:'Dispatched',       step: 3 },
  TRANSITO:  { es:'En tránsito',     en:'In transit',       step: 3 },
  EN_DESTINO:{ es:'En aduana',       en:'In customs',       step: 4 },
  CERRADO:   { es:'Listo',           en:'Ready',            step: 5 },
};
const CLIENT_STEPS_ES = ['Confirmado','En fabricación','En tránsito','En aduana','Listo'];
const CLIENT_STEPS_EN = ['Confirmed','Manufacturing','In transit','In customs','Ready'];

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
function CoverageKPI({ pct, lang }) {
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
function CreditDaysKPI({ used, limit, lang }) {
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

// ── Main Portal ─────
export default function ScreenPortal() {
  const navigate = useNavigate();
  const { lang } = useOutletContext();
  const { isClient, can } = useRole();
  const onOpenOC = (ocId) => navigate(`/expedientes/${ocId}`);

  const [tab, setTab] = useState('orders');

  // ── Backend real vía hook (fallback a mocks) ─────
  const portalClientId = 'c1';  // dev: futuro claim del JWT (portal_client_id)
  const {
    me, kpis: apiKpis, ocs: apiOcsRaw, expedientes: apiExpedientesRaw,
    loading: loadingPortal,
  } = usePortalData(portalClientId);

  const apiExpedientes = (apiExpedientesRaw || []).map(mapApiExpedienteToPortalExp);
  const apiOcs         = (apiOcsRaw || []).map(r => mapApiOcToPortalOc(r, apiExpedientesRaw));

  // Resolución CLIENTS / OCS / EXPEDIENTES — si el backend tiene data, úsala;
  // si no, cae al mock para mantener viva la demo.
  const CLIENTS = MOCK_CLIENTS;
  const OCS         = (!loadingPortal && apiOcs.length > 0)         ? apiOcs         : MOCK_OCS;
  const EXPEDIENTES = (!loadingPortal && apiExpedientes.length > 0) ? apiExpedientes : MOCK_EXPEDIENTES;

  // Client "c1" — scoped data
  const client = (me && me.id) ? {
    id: me.id, name: me.nombre || 'Cliente', contact: me.contacto || '',
    email: me.email || '', phone: me.telefono || '',
  } : CLIENTS.find(c => c.id === portalClientId);

  // Orders = OCs belonging to this client
  const myOCs = (!loadingPortal && apiOcs.length > 0)
    ? apiOcs
    : OCS.filter(o => o.client_id === portalClientId).slice(0, 10);
  // Featured (most recent / most active)
  const featured = myOCs[0];

  // KPIs: prioriza /api/portal/kpis/ si llegó; si no, calcula desde OCs
  const totalInvoicedAll = apiKpis ? Number(apiKpis.total_invoiced) || 0
                                   : myOCs.reduce((a,o) => a + (o.total_value || 0), 0);
  const totalPaidAll     = apiKpis ? Number(apiKpis.total_paid) || 0
                                   : myOCs.reduce((a,o) => a + (o.total_paid  || 0), 0);
  const coveragePct      = apiKpis && apiKpis.coverage_pct != null
                              ? Number(apiKpis.coverage_pct)
                              : (totalInvoicedAll > 0 ? totalPaidAll / totalInvoicedAll : 0);
  // Credit days
  const creditLimit      = apiKpis?.credit_days_limit || 90;
  const creditUsed       = apiKpis?.credit_days_used  || 45;

  return (
    <div style={{ background:'var(--bg)', minHeight:'100%' }} data-screen-label="Client Portal">
      {/* Portal chrome */}
      <div className="portal-chrome">
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div className="portal-chrome-logo">M</div>
          <span className="portal-chrome-brand">MWT · <small>PORTAL</small></span>
        </div>
        {can('view_portal_preview_badge') && (
          <Badge kind="mint" style={{ marginLeft: 8 }}>{lang==='es'?'VISTA CLIENTE':'CLIENT VIEW'}</Badge>
        )}
        <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:10, fontSize:13 }}>
          <span style={{ opacity:0.7 }}>{client?.name}</span>
          <div className="avatar" style={{ width:28, height:28, fontSize:11 }}>{client?.contact.split(' ').map(s=>s[0]).join('')}</div>
        </div>
      </div>

      <div className="page" style={{ maxWidth: 1280 }}>
        {/* Greeting */}
        <div className="mb-6">
          <div className="micro" style={{marginBottom:6, color:'var(--brand-accent-dark,#0E8A6D)'}}>
            {lang==='es' ? 'PORTAL DE CLIENTES' : 'CLIENT PORTAL'}
          </div>
          <h1 className="page-title">
            {lang==='es' ? `Hola, ${client?.contact.split(' ')[0]}` : `Hi, ${client?.contact.split(' ')[0]}`}
          </h1>
          <div className="page-subtitle">
            {lang==='es'
              ? 'Revisa tus órdenes, pagos y documentos de embarque.'
              : 'Review your orders, payments, and shipping documents.'}
          </div>
        </div>

        {/* Mi Empresa — solo CLIENT (read-only). Staff ya ve la ficha real en /clientes. */}
        {isClient && client && (
          <MyCompanyCard lang={lang} client={client} creditLimit={creditLimit} creditUsed={creditUsed} />
        )}

        {/* Client KPIs (safe, no $ exposure) */}
        <div className="portal-kpi-grid mb-6">
          <div className="card card-pad-lg">
            <CoverageKPI pct={coveragePct} lang={lang}/>
          </div>
          <div className="card card-pad-lg">
            <CreditDaysKPI used={creditUsed} limit={creditLimit} lang={lang}/>
          </div>
          <div className="card card-pad-lg portal-orders-stat">
            <div className="micro" style={{color:'var(--text-tertiary)', marginBottom:8}}>
              {lang==='es' ? 'MIS ÓRDENES' : 'MY ORDERS'}
            </div>
            <div style={{display:'flex', alignItems:'baseline', gap:6, marginBottom:4}}>
              <span style={{font:'800 28px/1 var(--font-display)', color:'var(--text-primary)'}}>{myOCs.length}</span>
              <span className="caption">{lang==='es' ? 'activas' : 'active'}</span>
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

        {/* Featured OC — most recent order */}
        {featured && (() => {
          const expIds = Array.isArray(featured.expedientes) ? featured.expedientes : [];
          const hero = EXPEDIENTES.find(e => expIds.includes(e.id));
          if (!hero) return null;
          return (
            <div className="card mb-6" style={{overflow:'hidden', cursor:'pointer'}} onClick={() => onOpenOC && onOpenOC(featured.id)}>
              <div style={{ padding:'20px 24px', background:'linear-gradient(135deg, var(--brand-accent-soft), var(--brand-ice-soft))', borderBottom:'1px solid var(--divider)' }}>
                <div className="flex ai-center jc-between mb-3">
                  <div>
                    <div className="micro" style={{color:'var(--brand-primary)'}}>
                      {lang==='es'?'TU ÚLTIMA ORDEN':'YOUR LATEST ORDER'}
                    </div>
                    <div className="heading-lg" style={{marginTop:4}}>{featured.po_code}</div>
                    <div className="caption" style={{marginTop:2}}>
                      {featured.lines_total || featured.lines?.length || 0} {lang==='es' ? 'líneas · ' : 'lines · '}
                      {expIds.length} {lang==='es' ? 'envíos' : 'shipments'}
                    </div>
                  </div>
                  <ClientStatusPill status={hero.status} lang={lang}/>
                </div>
                <div className="flex ai-center gap-3" style={{fontSize:13, color:'var(--text-secondary)', flexWrap:'wrap'}}>
                  <span className="flex ai-center gap-2"><IconMapPin size={13}/>{hero.origin} → {hero.destination}</span>
                  <span>·</span>
                  <span className="flex ai-center gap-2">{hero.freight_mode === 'SEA' ? <IconShip size={13}/> : <IconPlane size={13}/>}{hero.freight_mode === 'SEA' ? (lang==='es'?'Marítimo':'Sea') : (lang==='es'?'Aéreo':'Air')}</span>
                  <span>·</span>
                  <span className="flex ai-center gap-2"><IconClock size={13}/>ETA {fmtDate(hero.eta, lang)}</span>
                </div>
              </div>
              <div style={{ padding:'22px 24px 18px' }}>
                <ClientProgress status={hero.status} lang={lang}/>
              </div>
              <div style={{ padding:'14px 24px', borderTop:'1px solid var(--divider)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div className="caption">
                  <IconShip size={12} style={{display:'inline',verticalAlign:'-2px', marginRight:4}}/>
                  {lang==='es' ? 'Rastreo: ' : 'Tracking: '} <span className="mono" style={{fontWeight:600, color:'var(--text-secondary)'}}>MAEU-2458019</span>
                </div>
                <button className="btn btn-primary" onClick={(e)=>{e.stopPropagation(); onOpenOC && onOpenOC(featured.id);}}>
                  {lang==='es' ? 'Ver detalle de orden' : 'View order details'}<IconArrow size={13}/>
                </button>
              </div>
            </div>
          );
        })()}

        {/* Tabs — Portal B2B tiene 4 pestañas canónicas */}
        <div className="tabs mb-4">
          {[
            { k:'orders',   es:'Mis Órdenes',        en:'My Orders' },
            { k:'payments', es:'Historial de Pagos', en:'Payment History' },
            { k:'docs',     es:'Documentos',         en:'Documents' },
            { k:'products', es:'Productos',          en:'Products' },
          ].map(t => (
            <button key={t.k} className="tab" data-active={tab===t.k} onClick={()=>setTab(t.k)}>
              {lang==='es'?t.es:t.en}
            </button>
          ))}
        </div>

        {tab === 'orders'   && <PortalOrders   lang={lang} ocs={myOCs} expedientes={EXPEDIENTES} onOpenOC={onOpenOC}/>}
        {tab === 'payments' && <PortalPayments lang={lang} ocs={myOCs}/>}
        {tab === 'docs'     && <PortalDocs     lang={lang} ocs={myOCs}/>}
        {tab === 'products' && <ProductCatalogGrid lang={lang} />}
      </div>
    </div>
  );
}

// ── Orders tab: table of OCs (not expedientes) ─────
function PortalOrders({ lang, ocs, expedientes = [], onOpenOC }) {
  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">{lang==='es' ? 'Mis Órdenes' : 'My Orders'}</div>
        <span className="caption">{ocs.length} {lang==='es'?'órdenes':'orders'}</span>
      </div>
      <table className="table">
        <thead><tr>
          <th>{lang==='es' ? 'Orden' : 'Order'}</th>
          <th>{lang==='es' ? 'Productos' : 'Products'}</th>
          <th>{lang==='es' ? 'Estado' : 'Status'}</th>
          <th>{lang==='es' ? 'ETA' : 'ETA'}</th>
          <th style={{textAlign:'right'}}>{lang==='es' ? 'Valor' : 'Value'}</th>
          <th style={{textAlign:'right'}}>{lang==='es' ? 'Cobertura' : 'Coverage'}</th>
          <th/>
        </tr></thead>
        <tbody>
          {ocs.map(o => {
            // Status = status of lead expediente
            const expIds = Array.isArray(o.expedientes) ? o.expedientes : [];
            const leadExp = expedientes.find(e => expIds.includes(e.id));
            const lineCount = o.lines?.length || 0;
            const coverage = o.total_value > 0 ? (o.total_paid / o.total_value) : 0;
            return (
              <tr key={o.id} style={{cursor:'pointer'}} onClick={() => onOpenOC && onOpenOC(o.id)}>
                <td>
                  <div style={{font:'700 12px/1.2 var(--font-mono)', color:'var(--brand-primary)'}}>{o.po_code}</div>
                  <div className="caption" style={{marginTop:2}}>{expIds.length} {lang==='es'?'envíos':'shipments'}</div>
                </td>
                <td>
                  <div style={{font:'500 13px/1.3 var(--font-body)'}}>{lineCount} {lang==='es' ? 'líneas' : 'lines'}</div>
                  <div className="caption" style={{marginTop:2}}>{o.brand}</div>
                </td>
                <td>{leadExp ? <ClientStatusPill status={leadExp.status} lang={lang}/> : '—'}</td>
                <td className="text-sec">{leadExp ? fmtDate(leadExp.eta, lang) : '—'}</td>
                <td className="td-money">{fmtMoney(o.total_value || 0)}</td>
                <td className="td-num">
                  <CoverageMini pct={coverage} lang={lang}/>
                </td>
                <td><IconChevRight size={14} style={{color:'var(--text-tertiary)'}}/></td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
        method: ['Transferencia','Letra','Cheque'][j % 3]
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
  const _raw = client?._raw || {};
  const fiscalId       = _raw.fiscal_id || _raw.ruc || _raw.cuit || client.fiscal_id || '—';
  const fiscalName     = _raw.fiscal_name || _raw.razon_social || client.name || '—';
  const fiscalAddress  = _raw.fiscal_address || _raw.address || client.address || '—';
  const accountManager = _raw.account_manager_name || _raw.am_name || client.account_manager || '—';
  const paymentTerms   = _raw.payment_terms || client.payment_terms || '—';
  const country        = _raw.country || client.country || '—';

  return (
    <div className="card card-pad-lg mb-6 my-company-card">
      <div className="flex ai-center gap-3 mb-4" style={{borderBottom:'1px solid var(--divider)', paddingBottom:14}}>
        <div style={{
          width:48, height:48, borderRadius:12,
          background: 'linear-gradient(135deg, var(--brand-primary), var(--brand-ice, #3083FE))',
          color:'#fff', display:'grid', placeItems:'center',
        }}>
          <IconBuilding size={22}/>
        </div>
        <div style={{flex:1, minWidth:0}}>
          <div className="micro" style={{color:'var(--text-tertiary)', marginBottom:4}}>
            {lang==='es' ? 'MI EMPRESA' : 'MY COMPANY'}
          </div>
          <div className="heading-lg truncate">{fiscalName}</div>
          <div className="caption" style={{marginTop:2}}>
            {country} · {lang==='es' ? 'Ficha read-only' : 'Read-only profile'}
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
          <div className="micro" style={{marginBottom:4}}>
            {lang==='es'?'LÍMITE DE CRÉDITO':'CREDIT LIMIT'}
          </div>
          <div style={{font:'700 15px/1.2 var(--font-mono)', color:'var(--text-primary)'}}>
            {fmtMoney(_raw.credit_limit || client.credit_limit || 0)}
          </div>
        </div>
        <div style={{flex:1}}>
          <div className="micro" style={{marginBottom:4}}>
            {lang==='es'?'DÍAS DE CRÉDITO USADOS':'CREDIT DAYS USED'}
          </div>
          <div style={{font:'700 15px/1.2 var(--font-mono)', color:'var(--text-primary)'}}>
            {creditUsed} / {creditLimit} {lang==='es'?'días':'days'}
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
