// Pagos / Financial module
//
// ── Variante CLIENT (RBAC, 2026-04-21) ────────────────────────────
// Cuando isClient=true, el componente raíz delega en <ClientFinanciero/>,
// que muestra una vista compacta: header de saldo actual + uso de crédito
// + lista de los próximos 5 vencimientos. Oculto para CLIENT:
//   - Máquina de estados de pagos (detalle operativo interno)
//   - Aging de cuentas por cobrar (dashboard de cobranza)
//   - Rentabilidad y márgenes [CEO-ONLY]
//   - Tabs "Por cobrar / Por cliente / Historial" (vistas cross-cliente)
//   - Botón "+ Registrar pago" (solo staff registra transferencias)
// La autoridad real de filtrado por cliente vive en apps.portal +
// ClientScopedManager; esta capa solo adapta la UI.
import React, { useState, useEffect, useCallback } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { tr, fmtMoney, fmtDate } from "../lib/i18n.js";
import { Badge, StatusBadge, CreditDot, CreditBar, CountryFlag } from "../components/ui/primitives.jsx";
import { IconDownload, IconPlus, IconClock, IconShield } from "../lib/icons.jsx";
import {
  EXPEDIENTES as MOCK_EXPEDIENTES,
  CLIENTS,
  OCS as MOCK_OCS,
} from "../data/mockData.js";
import { expedientesApi, ocsApi, financePaymentsApi } from "../lib/api.js";
import { TableSkeletonRows } from "../components/ui/Skeleton.jsx";
import { useRole } from "../context/RoleContext.jsx";
// Sprint Registrar Pago (Fase 2) · Wizard ensamblador.
import RegisterPaymentWizard from "../components/finance/RegisterPaymentWizard.jsx";

// ── Mapeo backend → UI (campos financieros) ────────
function mapExpedienteForPagos(r) {
  return {
    id: r.codigo || r.id,
    ref: r.codigo || '',
    oc_id: r.oc_id || null,
    client: '', client_country: '',
    brand: '', brand_id: r.brand_id || null,
    status:       r.estado || 'REGISTRO',
    op_mode:      r.modo_operacion === 'COMISION' ? 'B' : 'C',
    commission_pct: r.commission_pct != null ? Number(r.commission_pct) : null,
    total_invoiced: Number(r.total_invoiced) || 0,
    total_paid:     Number(r.total_paid) || 0,
    balance:        Number(r.balance) || 0,
    credit_days:    Number(r.credit_days) || 0,
    credit_band:    r.credit_band || 'GREEN',
    projected_margin: Number(r.projected_margin) || 0,
    real_margin:      Number(r.real_margin) || 0,
    pg_verified: Number(r.pg_verified) || 0,
    pg_released: Number(r.pg_released) || 0,
    pg_pending:  Number(r.pg_pending)  || 0,
    pg_rejected: Number(r.pg_rejected) || 0,
    cost_corrections: !!r.cost_corrections,
    _raw: r,
  };
}

export default function ScreenPagos() {
  const navigate = useNavigate();
  const { lang } = useOutletContext();
  const { isClient, can } = useRole();

  // ── Data desde API (fallback a mocks) ────────
  const [apiExpedientes, setApiExpedientes] = useState([]);
  const [apiOcs,         setApiOcs]         = useState([]);
  const [loading,        setLoading]        = useState(true);

  // Sprint Registrar Pago (Fase 2) · Estado del wizard + pagos reales.
  const [wizardOpen,  setWizardOpen]  = useState(false);
  const [apiPayments, setApiPayments] = useState([]);
  const [paymentsRefreshKey, setPaymentsRefreshKey] = useState(0);

  // Pagos reales para alimentar los KPIs financieros. Antes mostraba
  // mock; ahora consume /api/finance/payments/. El refreshKey se bump-ea
  // cuando el wizard registra un pago para refrescar los KPIs sin
  // reload de pagina.
  useEffect(() => {
    let alive = true;
    financePaymentsApi.list()
      .then((rows) => {
        if (!alive) return;
        const arr = Array.isArray(rows) ? rows : (rows?.results || []);
        setApiPayments(arr);
      })
      .catch(() => { if (alive) setApiPayments([]); });
    return () => { alive = false; };
  }, [paymentsRefreshKey]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [expRaw, ocRaw] = await Promise.all([
        expedientesApi.list().catch(() => []),
        ocsApi.list().catch(() => []),
      ]);
      const expItems = Array.isArray(expRaw) ? expRaw : (expRaw?.results || []);
      const ocItems  = Array.isArray(ocRaw)  ? ocRaw  : (ocRaw?.results  || []);
      // Fable5 · guard: blindaje extra por si el shape del API cambia.
      setApiExpedientes(Array.isArray(expItems) ? expItems.map(mapExpedienteForPagos) : []);
      setApiOcs(Array.isArray(ocItems) ? ocItems : []);
    } catch {
      setApiExpedientes([]);
      setApiOcs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Sprint 2026-05-10 · CEO ordenó eliminar TODA fallback a mock data.
  const EXPEDIENTES = apiExpedientes;
  const OCS         = apiOcs;

  const onOpenExpediente = (id) => {
    const oc = OCS.find(o => Array.isArray(o.expedientes) && o.expedientes.includes(id));
    if (oc) navigate(`/expedientes/${oc.id}/exp/${id}`);
    else navigate('/expedientes');
  };

  const [tab, setTab] = useState('receivable');

  // Aggregate core totals
  const totalInvoiced = EXPEDIENTES.reduce((a,e)=>a+e.total_invoiced,0);
  const totalPaid     = EXPEDIENTES.reduce((a,e)=>a+e.total_paid,0);

  // Payment state machine aggregates
  //   pg_pending  + pg_verified  → aún NO libera crédito (pre-release)
  //   pg_released                → libera crédito (el único que cuenta como cobrado real)
  //   pg_rejected                → inválido
  const pgPending  = EXPEDIENTES.reduce((a,e)=>a + (e.pg_pending  || 0), 0);
  const pgVerified = EXPEDIENTES.reduce((a,e)=>a + (e.pg_verified || 0), 0);
  const pgReleased = EXPEDIENTES.reduce((a,e)=>a + (e.pg_released || 0), 0);
  const pgRejected = EXPEDIENTES.reduce((a,e)=>a + (e.pg_rejected || 0), 0);
  const pendingVerification = pgPending + pgVerified;  // combined pre-release bucket

  // Counts (rough: count expedientes with non-zero values in each bucket)
  const cntPending  = EXPEDIENTES.filter(e => (e.pg_pending||0) + (e.pg_verified||0) > 0).length;
  const cntReleased = EXPEDIENTES.filter(e => (e.pg_released||0) > 0).length;
  const cntRejected = EXPEDIENTES.filter(e => (e.pg_rejected||0) > 0).length;

  const totalReceivable = totalInvoiced - pgReleased;  // only released counts as collected
  const paidBase = pendingVerification + pgReleased + pgRejected;  // for % computation

  // Aging
  const ageing = [
    { label: '0-30d',  money: 120400, count: 8, color: 'var(--success)' },
    { label: '31-60d', money: 186300, count: 11, color: 'var(--brand-accent)' },
    { label: '61-90d', money: 98200,  count: 6, color: 'var(--warning)' },
    { label: '>90d',   money: 68500,  count: 3, color: 'var(--critical)' },
  ];
  const ageMax = Math.max(...ageing.map(a=>a.money));

  // CEO profitability aggregates
  const marginProjected = EXPEDIENTES.reduce((a,e)=>a + e.total_invoiced * e.projected_margin, 0);
  const marginReal      = EXPEDIENTES.reduce((a,e)=>a + e.total_invoiced * e.real_margin, 0);
  const marginDelta     = marginReal - marginProjected;
  const avgProjected    = EXPEDIENTES.reduce((a,e)=>a + e.projected_margin, 0) / EXPEDIENTES.length;
  const avgReal         = EXPEDIENTES.reduce((a,e)=>a + e.real_margin, 0) / EXPEDIENTES.length;
  const expsBelowThreshold = EXPEDIENTES.filter(e => (e.real_margin - e.projected_margin) < -0.05).length;
  const expsWithCorrections = EXPEDIENTES.filter(e => e.cost_corrections).length;
  const driftPct = (expsBelowThreshold / EXPEDIENTES.length) * 100;

  // Modo B vs C breakdown
  const expsB = EXPEDIENTES.filter(e => e.op_mode === 'B');
  const expsC = EXPEDIENTES.filter(e => e.op_mode === 'C');
  const revenueB = expsB.reduce((a,e)=>a + e.total_invoiced * (e.commission_pct || 0.06), 0); // comisión facturada
  const revenueC = expsC.reduce((a,e)=>a + e.total_invoiced, 0);                               // facturación FULL
  const marginB  = expsB.reduce((a,e)=>a + e.total_invoiced * e.real_margin, 0);
  const marginC  = expsC.reduce((a,e)=>a + e.total_invoiced * e.real_margin, 0);
  const avgMarginB = expsB.length ? expsB.reduce((a,e)=>a + e.real_margin,0) / expsB.length : 0;
  const avgMarginC = expsC.length ? expsC.reduce((a,e)=>a + e.real_margin,0) / expsC.length : 0;

  // ── Variante CLIENT: vista compacta "Saldo + Próximos vencimientos" ──
  // Delegamos en un componente aparte que consume los agregados ya calculados.
  if (isClient) {
    return (
      <ClientFinanciero
        lang={lang}
        expedientes={EXPEDIENTES}
        ocs={OCS}
        totalInvoiced={totalInvoiced}
        totalReceivable={totalReceivable}
        onOpenExpediente={onOpenExpediente}
        loading={loading}
      />
    );
  }

  return (
    <div className="page" data-screen-label="Financiero · Pagos">
      <div className="page-header">
        <div>
          <div className="micro" style={{marginBottom:6}}>{lang==='es' ? 'MÓDULO FINANCIERO' : 'FINANCIAL MODULE'}</div>
          <h1 className="page-title">{tr(lang,'financiero')}</h1>
          <div className="page-subtitle">{lang==='es' ? 'Cobros, aging y estado de cuentas por cliente' : 'Collections, aging and client statements'}</div>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary"><IconDownload size={14}/>{tr(lang,'export')}</button>
          {can('register_payment') && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setWizardOpen(true)}
            >
              <IconPlus size={14}/>{tr(lang,'register_payment')}
            </button>
          )}
        </div>
      </div>

      {/* Top KPI row */}
      <div className="grid col-4 gap-3 mb-4">
        <div className="stat">
          <div className="stat-label">{tr(lang,'total_invoiced_lbl')}</div>
          <div className="stat-value">{fmtMoney(totalInvoiced)}</div>
          <div className="stat-sub">{EXPEDIENTES.length} {lang==='es' ? 'expedientes' : 'files'}</div>
        </div>
        <div className="stat">
          <div className="stat-label">{lang==='es' ? 'Crédito liberado' : 'Credit released'}</div>
          <div className="stat-value" style={{ color:'var(--success)' }}>{fmtMoney(pgReleased)}</div>
          <div className="stat-sub">{(pgReleased/totalInvoiced*100).toFixed(1)}% {lang==='es' ? 'facturado' : 'invoiced'}</div>
        </div>
        <div className="stat">
          <div className="stat-label">{tr(lang,'receivable')}</div>
          <div className="stat-value" style={{ color:'var(--warning)' }}>{fmtMoney(totalReceivable)}</div>
          <div className="stat-sub">{lang==='es' ? '28 expedientes abiertos' : '28 open files'}</div>
        </div>
        <div className="stat">
          <div className="stat-label">DSO</div>
          <div className="stat-value">62 <span style={{fontSize:14,fontWeight:500,color:'var(--text-tertiary)'}}>{lang==='es'?'días':'days'}</span></div>
          <div className="stat-sub"><span style={{color:'var(--success)'}}>−4d</span> {lang==='es'?'vs. mes anterior':'vs. last month'}</div>
        </div>
      </div>

      {/* ─── Payment State Machine breakdown ─────────────────── */}
      <div className="card mb-6">
        <div className="card-head">
          <div>
            <div className="card-title">{lang==='es' ? 'Máquina de estados de pagos' : 'Payment state machine'}</div>
            <div className="card-subtitle">
              {lang==='es'
                ? 'Sólo los pagos con crédito liberado cuentan como cobrados. Los demás están en verificación o fueron rechazados.'
                : 'Only released payments count as collected. Others are in verification or were rejected.'}
            </div>
          </div>
          <div className="flex gap-2 ai-center">
            <Badge kind="outline" dot>{lang==='es'?'Sprint 25':'Sprint 25'}</Badge>
          </div>
        </div>
        <div className="card-pad-lg">
          {/* Stacked progress bar */}
          <div className="pay-bar" style={{ height: 12, marginBottom: 10 }}>
            <div className="seg pending"  style={{ width: (pendingVerification/paidBase*100)+'%' }}/>
            <div className="seg released" style={{ width: (pgReleased/paidBase*100)+'%' }}/>
            <div className="seg rejected" style={{ width: (pgRejected/paidBase*100)+'%' }}/>
          </div>

          {/* Inline summary */}
          <div style={{
            display:'flex', alignItems:'center', gap:16, flexWrap:'wrap',
            padding:'10px 14px', background:'var(--bg-alt)', borderRadius:8,
            font: '600 13px/1.4 var(--font-mono)', marginBottom: 16
          }}>
            <span style={{ color:'var(--text-tertiary)', textTransform:'uppercase', letterSpacing:'0.08em', fontSize:11 }}>
              {lang==='es' ? 'RESUMEN' : 'SUMMARY'}
            </span>
            <span>{lang==='es'?'Liberado':'Released'} <span style={{color:'var(--success)'}}>{fmtMoney(pgReleased)}</span></span>
            <span style={{ color:'var(--border-strong)' }}>|</span>
            <span>{lang==='es'?'Pendiente verif.':'Pending verif.'} <span style={{color:'var(--warning)'}}>{fmtMoney(pendingVerification)}</span></span>
            <span style={{ color:'var(--border-strong)' }}>|</span>
            <span>{lang==='es'?'Rechazado':'Rejected'} <span style={{color:'var(--critical)'}}>{fmtMoney(pgRejected)}</span></span>
          </div>

          {/* Three cards: one per state */}
          <div className="grid col-3 gap-3">
            <PaymentStateCard
              lang={lang}
              kind="pending"
              title={lang==='es' ? 'Pendiente de verificación' : 'Pending verification'}
              subtitle={lang==='es'
                ? 'Reportado por el cliente, aún no conciliado en banco'
                : 'Client-reported, not yet reconciled in bank'}
              amount={pendingVerification}
              count={cntPending}
              detail={[
                { k: lang==='es'?'Reportado (s/ conciliar)':'Reported', v: pgPending, color:'var(--warning)' },
                { k: lang==='es'?'Conciliado (s/ liberar)':'Reconciled', v: pgVerified, color:'var(--info)' },
              ]}
              action={lang==='es' ? 'Conciliar →' : 'Reconcile →'}
            />
            <PaymentStateCard
              lang={lang}
              kind="released"
              title={lang==='es' ? 'Crédito liberado' : 'Credit released'}
              subtitle={lang==='es'
                ? 'Verificado por CEO, impacta al límite de crédito del cliente'
                : 'CEO-verified, affects client credit limit'}
              amount={pgReleased}
              count={cntReleased}
              highlight
            />
            <PaymentStateCard
              lang={lang}
              kind="rejected"
              title={lang==='es' ? 'Pagos rechazados' : 'Rejected payments'}
              subtitle={lang==='es'
                ? 'Marcados inválidos por CEO (referencia errónea, monto, duplicado)'
                : 'Invalid per CEO (wrong reference, amount, duplicate)'}
              amount={pgRejected}
              count={cntRejected}
              action={lang==='es' ? 'Ver motivos →' : 'See reasons →'}
            />
          </div>
        </div>
      </div>

      {/* ─── Aging buckets ─────────────────────────────────── */}
      <div className="card mb-6">
        <div className="card-head">
          <div>
            <div className="card-title">{lang==='es' ? 'Antigüedad de cuentas por cobrar' : 'Accounts receivable aging'}</div>
            <div className="card-subtitle">{lang==='es' ? 'Distribución del saldo pendiente por bucket' : 'Outstanding balance distribution by bucket'}</div>
          </div>
        </div>
        <div className="card-pad-lg grid col-4 gap-4">
          {ageing.map(a => (
            <div key={a.label}>
              <div className="flex ai-center jc-between mb-2">
                <span className="heading-sm" style={{ color:'var(--text-primary)'}}>{a.label}</span>
                <Badge kind="neutral">{a.count}</Badge>
              </div>
              <div className="tabular" style={{ font:'700 20px/1 var(--font-mono)'}}>{fmtMoney(a.money)}</div>
              <div style={{ height: 6, background: 'var(--bg-alt)', borderRadius: 3, marginTop: 8, overflow:'hidden'}}>
                <div style={{ height:'100%', width: (a.money/ageMax*100)+'%', background: a.color, transition: 'width 300ms' }}/>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ─── [CEO-ONLY] Rentabilidad y márgenes ────────────── */}
      <CeoProfitabilitySection
        lang={lang}
        marginProjected={marginProjected}
        marginReal={marginReal}
        marginDelta={marginDelta}
        avgProjected={avgProjected}
        avgReal={avgReal}
        driftPct={driftPct}
        expsBelowThreshold={expsBelowThreshold}
        expsWithCorrections={expsWithCorrections}
        totalExps={EXPEDIENTES.length}
        expsB={expsB}
        expsC={expsC}
        revenueB={revenueB}
        revenueC={revenueC}
        marginB={marginB}
        marginC={marginC}
        avgMarginB={avgMarginB}
        avgMarginC={avgMarginC}
      />

      {/* Tabs */}
      <div className="tabs mb-6">
        <button className="tab" data-active={tab==='receivable'} onClick={()=>setTab('receivable')}>{lang==='es'?'Por cobrar':'Receivable'}<span className="count">28</span></button>
        <button className="tab" data-active={tab==='clients'} onClick={()=>setTab('clients')}>{lang==='es'?'Por cliente':'By client'}<span className="count">{CLIENTS.length}</span></button>
        <button className="tab" data-active={tab==='history'} onClick={()=>setTab('history')}>{lang==='es'?'Historial de pagos':'Payment history'}</button>
      </div>

      {tab === 'receivable' && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr>
              <th>{tr(lang,'ref')}</th><th>{tr(lang,'client')}</th><th>{tr(lang,'status')}</th>
              <th style={{textAlign:'right'}}>{tr(lang,'invoiced')}</th>
              <th style={{textAlign:'right'}}>{tr(lang,'paid')}</th>
              <th style={{textAlign:'right'}}>{tr(lang,'balance')}</th>
              <th style={{textAlign:'right'}}>{tr(lang,'credit_days')}</th>
              <th style={{width:60}}/>
            </tr></thead>
            <tbody>
              {loading && <TableSkeletonRows rows={6} />}
              {EXPEDIENTES.filter(e=>e.balance>0).slice(0,14).map(e => (
                <tr key={e.id} onClick={() => onOpenExpediente(e.id)} style={{cursor:'pointer'}}>
                  <td><span className="td-ref">{e.ref}</span></td>
                  <td>
                    <div className="flex ai-center gap-2">
                      <CountryFlag country={e.client_country}/>
                      <span style={{ fontWeight: 500 }}>{e.client}</span>
                    </div>
                  </td>
                  <td><StatusBadge status={e.status} lang={lang}/></td>
                  <td className="td-money">{fmtMoney(e.total_invoiced)}</td>
                  <td className="td-money text-mint">{fmtMoney(e.total_paid)}</td>
                  <td className="td-money" style={{ color: e.credit_days>80?'var(--critical)':e.credit_days>60?'var(--warning)':'var(--text-primary)'}}>{fmtMoney(e.balance)}</td>
                  <td className="td-num">
                    <div className="flex ai-center gap-2" style={{justifyContent:'flex-end'}}>
                      <CreditDot band={e.credit_band}/>
                      <span className="tabular">{e.credit_days}d</span>
                    </div>
                  </td>
                  <td><button className="btn btn-ghost btn-sm">{lang==='es'?'Cobrar':'Collect'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'clients' && (
        <div className="grid col-3 gap-3">
          {CLIENTS.map(c => {
            const pct = c.credit_limit>0 ? (c.credit_used/c.credit_limit)*100 : 0;
            return (
              <div key={c.id} className="card card-pad-lg">
                <div className="flex ai-center gap-3 mb-3">
                  <div className="avatar">{c.name.split(' ').map(s=>s[0]).slice(0,2).join('')}</div>
                  <div style={{flex:1, minWidth:0}}>
                    <div className="heading-md truncate">{c.name}</div>
                    <div className="caption"><CountryFlag country={c.country}/> {c.country}</div>
                  </div>
                  <Badge kind={c.band==='GREEN'?'success':c.band==='AMBER'?'warning':'critical'} dot>{c.band}</Badge>
                </div>
                <div className="mb-3">
                  <div className="micro mb-2">{lang==='es' ? 'CRÉDITO UTILIZADO' : 'CREDIT USED'}</div>
                  <CreditBar limit={c.credit_limit} used={c.credit_used}/>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'history' && <PaymentHistoryTable lang={lang}/>}

      {/* Sprint Registrar Pago (Fase 2) · Wizard montado a nivel pagina.
          Solo se renderea cuando wizardOpen=true; los efectos / hooks
          internos del wizard solo corren si `open` es true. */}
      <RegisterPaymentWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onSuccess={(payment) => {
          setPaymentsRefreshKey((k) => k + 1);
          // eslint-disable-next-line no-console
          console.info("[Pagos] pago registrado:", payment?.id || payment);
        }}
        lang={lang}
      />
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── */
/* Payment-state card                                           */
/* ──────────────────────────────────────────────────────────── */
function PaymentStateCard({ lang, kind, title, subtitle, amount, count, detail, action, highlight }) {
  const colorMap = {
    pending:  { border: 'var(--warning)',  bg: 'var(--warning-bg)',  icon: '⏳' },
    released: { border: 'var(--success)',  bg: 'var(--success-bg)',  icon: '✓' },
    rejected: { border: 'var(--critical)', bg: 'var(--critical-bg)', icon: '✕' },
  }[kind];

  return (
    <div
      className="card card-pad"
      style={{
        borderLeft: `3px solid ${colorMap.border}`,
        background: highlight ? colorMap.bg : 'var(--surface)',
      }}
    >
      <div className="flex ai-center gap-2 mb-2">
        <span style={{
          width:22, height:22, borderRadius:'50%', display:'grid', placeItems:'center',
          background: colorMap.border, color:'#fff', font:'700 11px/1 var(--font-mono)'
        }}>{colorMap.icon}</span>
        <div className="heading-sm" style={{ flex:1 }}>{title}</div>
        <Badge kind="neutral">{count}</Badge>
      </div>
      <div className="caption mb-3" style={{ color:'var(--text-tertiary)', lineHeight:1.45 }}>
        {subtitle}
      </div>
      <div style={{ font:'800 26px/1 var(--font-display)', color: colorMap.border, fontVariantNumeric:'tabular-nums', letterSpacing:'-0.01em', marginBottom: 10 }}>
        {fmtMoney(amount)}
      </div>

      {detail && (
        <div style={{ borderTop:'1px dashed var(--border)', paddingTop:10, marginBottom:10 }}>
          {detail.map((d,i) => (
            <div key={i} className="flex ai-center jc-between" style={{ padding:'4px 0', font:'500 12px/1.3 var(--font-body)' }}>
              <span style={{ color:'var(--text-secondary)' }}>{d.k}</span>
              <span className="tabular" style={{ color: d.color || 'var(--text-primary)', fontWeight:600 }}>{fmtMoney(d.v)}</span>
            </div>
          ))}
        </div>
      )}

      {action && (
        <button className="btn btn-ghost btn-sm" style={{ width:'100%', justifyContent:'center', borderTop:'1px solid var(--border)', borderRadius:0, marginTop: detail ? 0 : 4, paddingTop:8 }}>
          {action}
        </button>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── */
/* [CEO-ONLY] Profitability section                             */
/* ──────────────────────────────────────────────────────────── */
function CeoProfitabilitySection({
  lang, marginProjected, marginReal, marginDelta,
  avgProjected, avgReal, driftPct, expsBelowThreshold, expsWithCorrections, totalExps,
  expsB, expsC, revenueB, revenueC, marginB, marginC, avgMarginB, avgMarginC,
}) {
  const marginDeltaPct = marginProjected > 0 ? (marginDelta / marginProjected) * 100 : 0;
  const driftSignal = driftPct > 20 ? 'critical' : driftPct > 10 ? 'warning' : 'success';

  return (
    <div
      className="card mb-6"
      style={{
        borderLeft: '3px solid var(--brand-primary)',
        background: 'linear-gradient(180deg, color-mix(in oklab, var(--brand-primary) 4%, transparent) 0%, var(--surface) 40%)',
      }}
    >
      <div className="card-head" style={{ alignItems:'center' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <span style={{
            display:'inline-flex', alignItems:'center', gap:6,
            padding:'4px 8px', background:'var(--brand-primary)', color:'#fff',
            borderRadius:4, font:'700 10px/1 var(--font-mono)', letterSpacing:'0.1em'
          }}>
            🔒 CEO-ONLY
          </span>
          <div>
            <div className="card-title">{lang==='es' ? 'Rentabilidad y márgenes' : 'Profitability & margins'}</div>
            <div className="card-subtitle">
              {lang==='es'
                ? 'Margen proyectado vs. real, desviación de costos y desglose por modo de operación'
                : 'Projected vs. real margin, cost drift, and breakdown by operation mode'}
            </div>
          </div>
        </div>
        <button className="btn btn-ghost btn-sm"><IconDownload size={14}/>{lang==='es'?'Exportar':'Export'}</button>
      </div>

      <div className="card-pad-lg">
        {/* Row 1: Margin vs projected + drift */}
        <div className="grid col-4 gap-3 mb-4">
          <div className="kpi-tile">
            <div className="k-label">{lang==='es' ? 'Margen proyectado' : 'Projected margin'}</div>
            <div className="k-value">{fmtMoney(marginProjected)}</div>
            <div className="k-sub">{(avgProjected*100).toFixed(1)}% {lang==='es'?'promedio':'avg'}</div>
          </div>
          <div className="kpi-tile accent">
            <div className="k-label">{lang==='es' ? 'Margen real' : 'Real margin'}</div>
            <div className="k-value">{fmtMoney(marginReal)}</div>
            <div className="k-sub">{(avgReal*100).toFixed(1)}% {lang==='es'?'promedio':'avg'}</div>
          </div>
          <div className="kpi-tile">
            <div className="k-label">{lang==='es' ? 'Desviación $' : 'Delta $'}</div>
            <div className="k-value" style={{ color: marginDelta >= 0 ? 'var(--success)' : 'var(--critical)' }}>
              {marginDelta >= 0 ? '+' : ''}{fmtMoney(marginDelta)}
            </div>
            <div className="k-sub">
              <span className={marginDelta >= 0 ? 'k-delta up' : 'k-delta down'}>
                {marginDelta >= 0 ? '▲' : '▼'} {Math.abs(marginDeltaPct).toFixed(1)}%
              </span>
              {lang==='es'?'vs. proyectado':'vs. projected'}
            </div>
          </div>
          <div className="kpi-tile">
            <div className="k-label">{lang==='es' ? 'Desviación costos' : 'Cost drift'}</div>
            <div className="k-value" style={{ color: `var(--${driftSignal})` }}>{driftPct.toFixed(0)}%</div>
            <div className="k-sub">
              <span className="alert-chip" style={{
                background:`var(--${driftSignal}-bg)`,
                color:`var(--${driftSignal})`,
                border:`1px solid color-mix(in oklab, var(--${driftSignal}), transparent 70%)`,
                padding:'2px 6px', borderRadius:4, font:'600 10px/1 var(--font-mono)', letterSpacing:'0.08em'
              }}>
                {expsBelowThreshold}/{totalExps} {lang==='es'?'bajo umbral':'below threshold'}
              </span>
            </div>
          </div>
        </div>

        {/* Row 2: Inline KPI line */}
        <div style={{
          display:'flex', alignItems:'center', gap:18, flexWrap:'wrap',
          padding:'12px 16px',
          background:'color-mix(in oklab, var(--brand-primary) 5%, var(--bg-alt))',
          border:'1px solid color-mix(in oklab, var(--brand-primary) 15%, transparent)',
          borderRadius:8,
          font:'600 13px/1.4 var(--font-mono)',
          marginBottom: 24,
        }}>
          <span style={{ color:'var(--text-tertiary)', textTransform:'uppercase', letterSpacing:'0.08em', fontSize:11 }}>
            {lang==='es' ? 'SALUD OPERATIVA' : 'OPERATIONAL HEALTH'}
          </span>
          <span>{lang==='es'?'Correcciones post-aprobación':'Post-approval corrections'}: <span style={{ color:'var(--warning)' }}>{expsWithCorrections}</span></span>
          <span style={{ color:'var(--border-strong)' }}>|</span>
          <span>{lang==='es'?'Bajo umbral 5%':'Below 5% threshold'}: <span style={{ color:'var(--critical)' }}>{expsBelowThreshold}</span></span>
          <span style={{ color:'var(--border-strong)' }}>|</span>
          <span>{lang==='es'?'Expedientes totales':'Total files'}: <span style={{ color:'var(--text-primary)' }}>{totalExps}</span></span>
        </div>

        {/* Row 3: Modo B vs C comparison */}
        <div className="flex ai-center jc-between mb-3">
          <div>
            <div className="heading-md">{lang==='es' ? 'Modo B (Comisión) vs Modo C (FULL)' : 'Mode B (Commission) vs Mode C (FULL)'}</div>
            <div className="caption" style={{ color:'var(--text-tertiary)' }}>
              {lang==='es'
                ? 'Comparación de rentabilidad operativa por modelo de facturación'
                : 'Profitability comparison by billing model'}
            </div>
          </div>
          <Badge kind="outline">{totalExps} {lang==='es'?'expedientes':'files'}</Badge>
        </div>

        <div className="grid col-2 gap-3">
          <ModeCompareCard
            lang={lang}
            letter="B"
            kind="accent"
            title={lang==='es' ? 'Modo B · Comisión' : 'Mode B · Commission'}
            subtitle={lang==='es'
              ? 'Facturación a Marluvas vía ART-10. Cliente importa directo.'
              : 'Billed to Marluvas via ART-10. Client imports directly.'}
            count={expsB.length}
            revenue={revenueB}
            margin={marginB}
            avgMargin={avgMarginB}
            revenueLabel={lang==='es'?'Comisión facturada':'Commission billed'}
          />
          <ModeCompareCard
            lang={lang}
            letter="C"
            kind="primary"
            title={lang==='es' ? 'Modo C · FULL' : 'Mode C · FULL'}
            subtitle={lang==='es'
              ? 'Importación directa. Facturación completa al cliente vía ART-09.'
              : 'Direct import. Full billing to client via ART-09.'}
            count={expsC.length}
            revenue={revenueC}
            margin={marginC}
            avgMargin={avgMarginC}
            revenueLabel={lang==='es'?'Facturación FULL':'FULL billing'}
          />
        </div>
      </div>
    </div>
  );
}

/* Side-by-side comparison card for Mode B vs C */
function ModeCompareCard({ lang, letter, kind, title, subtitle, count, revenue, margin, avgMargin, revenueLabel }) {
  const accentColor = kind === 'accent' ? 'var(--brand-accent-dark, #0E8A6D)' : 'var(--brand-primary)';
  const accentBg    = kind === 'accent' ? 'var(--brand-accent-soft)' : 'color-mix(in oklab, var(--brand-primary) 6%, transparent)';

  return (
    <div
      className="card card-pad-lg"
      style={{ background: accentBg, borderColor: `color-mix(in oklab, ${accentColor}, transparent 60%)` }}
    >
      <div className="flex ai-center gap-3 mb-3">
        <div style={{
          width:44, height:44, borderRadius:10,
          background: accentColor, color:'#fff',
          display:'grid', placeItems:'center',
          font: '800 22px/1 var(--font-display)'
        }}>{letter}</div>
        <div style={{ flex:1 }}>
          <div className="heading-md">{title}</div>
          <div className="caption" style={{ color:'var(--text-secondary)', lineHeight:1.4 }}>{subtitle}</div>
        </div>
        <Badge kind="neutral">{count}</Badge>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, paddingTop:12, borderTop:'1px solid var(--border)' }}>
        <div>
          <div className="micro">{revenueLabel}</div>
          <div className="tabular" style={{ font:'700 18px/1.2 var(--font-mono)', color:'var(--text-primary)' }}>{fmtMoney(revenue)}</div>
        </div>
        <div>
          <div className="micro">{lang==='es'?'Margen real':'Real margin'}</div>
          <div className="tabular" style={{ font:'700 18px/1.2 var(--font-mono)', color: accentColor }}>{fmtMoney(margin)}</div>
        </div>
        <div style={{ gridColumn:'1 / -1', paddingTop:8, borderTop:'1px dashed var(--border)' }}>
          <div className="flex ai-center jc-between">
            <span className="micro">{lang==='es'?'Margen promedio':'Average margin'}</span>
            <span className="margin-pill" style={{ background: accentColor, color:'#fff' }}>
              {(avgMargin*100).toFixed(1)}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── */
/* Payment history table with state-machine badges             */
/* ──────────────────────────────────────────────────────────── */
function PaymentHistoryTable({ lang }) {
  // Synthesize rows from HERO_PAGOS + expedientes to get state-machine distribution
  const stateOf = (i) => {
    const mod = i % 7;
    if (mod === 0) return 'REJECTED';
    if (mod === 1 || mod === 4) return 'PENDING';
    if (mod === 2) return 'VERIFIED';
    return 'RELEASED';
  };

  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr>
          <th>{lang==='es'?'Fecha':'Date'}</th>
          <th>{tr(lang,'client')}</th>
          <th>{tr(lang,'ref')}</th>
          <th>{lang==='es'?'Estado':'Status'}</th>
          <th>{tr(lang,'payment_method')}</th>
          <th>{tr(lang,'reference')}</th>
          <th style={{textAlign:'right'}}>{tr(lang,'amount')}</th>
        </tr></thead>
        <tbody>
          {EXPEDIENTES.slice(0,14).map((e,i) => {
            const st = stateOf(i);
            return (
              <tr key={i}>
                <td className="text-sec">{fmtDate(e.last_event_at, lang)}</td>
                <td>{e.client}</td>
                <td><span className="td-ref">{e.ref}</span></td>
                <td><PaymentStateBadge state={st} lang={lang}/></td>
                <td>{lang==='es'?'Movimiento':'Wire transfer'}</td>
                <td><span className="mono-sm" style={{fontWeight:600}}>TRX-{90000 + i*37}</span></td>
                <td className="td-money" style={{
                  color: st==='RELEASED' ? 'var(--success)'
                       : st==='REJECTED' ? 'var(--critical)'
                       : 'var(--text-primary)',
                  textDecoration: st==='REJECTED' ? 'line-through' : 'none',
                }}>{fmtMoney(e.total_paid * 0.5)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PaymentStateBadge({ state, lang }) {
  const map = {
    PENDING:  { kind:'warning',  label: lang==='es' ? 'Pendiente verif.'  : 'Pending verif.' },
    VERIFIED: { kind:'info',     label: lang==='es' ? 'Conciliado'        : 'Reconciled' },
    RELEASED: { kind:'success',  label: lang==='es' ? 'Crédito liberado'  : 'Credit released' },
    REJECTED: { kind:'critical', label: lang==='es' ? 'Rechazado'         : 'Rejected' },
  }[state] || { kind:'neutral', label: state };
  return <Badge kind={map.kind} dot>{map.label}</Badge>;
}

/* ──────────────────────────────────────────────────────────────────
 * ClientFinanciero — vista CLIENT de /financiero
 *
 * Muestra SOLO:
 *   - Hero de saldo actual (balance total pendiente).
 *   - Chip de uso de límite de crédito.
 *   - Lista de los próximos 5 vencimientos (OC, monto, fecha, días restantes).
 *
 * Oculto respecto a la vista staff:
 *   - Máquina de estados (pending/verified/released/rejected).
 *   - Aging buckets.
 *   - Sección [CEO-ONLY] Rentabilidad y márgenes.
 *   - Tabs Por cobrar / Por cliente / Historial.
 *   - Botón "+ Registrar pago" (solo staff registra; el cliente reporta
 *     su pago desde /portal → tab "Pagos" con botón "Reportar pago",
 *     fuera del scope de este sprint).
 * ────────────────────────────────────────────────────────────────── */
function ClientFinanciero({ lang, expedientes, ocs, totalInvoiced, totalReceivable, onOpenExpediente, loading = false }) {
  // Saldo actual = receivable (lo que aún no se liberó a crédito).
  // Heurística: el cliente ve sus expedientes con balance > 0 ordenados
  // por ETA ascendente (o last_event_at descendente si no hay ETA).
  const openExps = (expedientes || []).filter(e => Number(e.balance) > 0);
  const upcoming = [...openExps]
    .sort((a, b) => {
      const ea = a.eta || a.due_date || a.last_event_at || '';
      const eb = b.eta || b.due_date || b.last_event_at || '';
      return String(ea).localeCompare(String(eb));
    })
    .slice(0, 5);

  const balance = totalReceivable ?? openExps.reduce((acc, e) => acc + Number(e.balance || 0), 0);

  // Uso de crédito: para la demo usamos % de receivable sobre invoiced.
  // En el backend real esto vendrá de portal.kpis.credit_days_used / limit.
  const creditUsagePct = totalInvoiced > 0
    ? Math.min(100, Math.round((balance / totalInvoiced) * 100))
    : 0;
  const creditTone = creditUsagePct >= 85 ? 'critical' : creditUsagePct >= 65 ? 'warning' : 'success';

  const today = new Date();
  const daysUntil = (dateStr) => {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return Math.round((d - today) / (1000 * 60 * 60 * 24));
  };

  return (
    <div className="page" data-screen-label="Mis Pagos" data-viewport="CLIENT">
      <div className="page-header">
        <div>
          <div className="micro" style={{marginBottom:6, color:'var(--brand-primary)'}}>
            {lang==='es' ? 'MIS PAGOS' : 'MY PAYMENTS'}
          </div>
          <h1 className="page-title">
            {lang==='es' ? 'Tu estado de cuenta' : 'Your account statement'}
          </h1>
          <div className="page-subtitle">
            {lang==='es'
              ? 'Saldo actual y próximos vencimientos. Para reportar un pago, usa el portal.'
              : 'Current balance and upcoming payments. To report a payment, use the portal.'}
          </div>
        </div>
      </div>

      {/* Hero: saldo actual + uso de crédito */}
      <div className="client-balance-card mb-4">
        <div className="client-balance-main">
          <div className="micro" style={{color:'var(--text-tertiary)', marginBottom:6}}>
            {lang==='es' ? 'SALDO ACTUAL' : 'CURRENT BALANCE'}
          </div>
          <div style={{font:'800 36px/1 var(--font-display)', color:'var(--text-primary)', letterSpacing:'-0.02em'}}>
            {fmtMoney(balance)}
          </div>
          <div className="caption" style={{marginTop:6}}>
            {openExps.length} {lang==='es' ? 'pedidos con saldo abierto' : 'orders with open balance'}
          </div>
        </div>
        <div className="client-balance-credit">
          <div className="micro" style={{color:'var(--text-tertiary)', marginBottom:6}}>
            {lang==='es' ? 'USO DE LÍMITE DE CRÉDITO' : 'CREDIT LIMIT USAGE'}
          </div>
          <div style={{display:'flex', alignItems:'baseline', gap:6, marginBottom:8}}>
            <span style={{font:'700 28px/1 var(--font-display)', color:`var(--${creditTone})`, fontVariantNumeric:'tabular-nums'}}>{creditUsagePct}</span>
            <span style={{font:'500 14px/1 var(--font-body)', color:'var(--text-tertiary)'}}>%</span>
          </div>
          <div style={{height:6, background:'var(--bg-alt)', borderRadius:3, overflow:'hidden'}}>
            <div style={{height:'100%', width:`${creditUsagePct}%`, background:`var(--${creditTone})`, transition:'width 300ms'}}/>
          </div>
          <div className="caption" style={{marginTop:8, display:'flex', alignItems:'center', gap:5}}>
            <IconShield size={11}/>
            {creditTone === 'critical'
              ? (lang==='es' ? 'Cerca del límite — contactá a tu ejecutivo' : 'Near limit — contact your account manager')
              : creditTone === 'warning'
              ? (lang==='es' ? 'Uso moderado de tu línea' : 'Moderate use of your line')
              : (lang==='es' ? 'Dentro del rango saludable' : 'Within healthy range')}
          </div>
        </div>
      </div>

      {/* Próximos vencimientos */}
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">
              {lang==='es' ? 'Próximos vencimientos' : 'Upcoming payments'}
            </div>
            <div className="card-subtitle">
              {lang==='es'
                ? 'Los próximos 5 pedidos con saldo pendiente, ordenados por fecha.'
                : 'The next 5 orders with outstanding balance, sorted by date.'}
            </div>
          </div>
          <Badge kind="outline">{upcoming.length}</Badge>
        </div>
        {upcoming.length === 0 ? (
          <div className="card-pad-lg" style={{textAlign:'center', color:'var(--text-tertiary)'}}>
            <IconClock size={22} style={{opacity:0.4, marginBottom:8}}/>
            <div>{lang==='es' ? 'No tenés vencimientos próximos.' : 'No upcoming payments.'}</div>
          </div>
        ) : (
          <table className="table">
            <thead><tr>
              <th>{lang==='es'?'Pedido':'Order'}</th>
              <th>{lang==='es'?'Estado':'Status'}</th>
              <th style={{textAlign:'right'}}>{lang==='es'?'Saldo':'Balance'}</th>
              <th>{lang==='es'?'Vencimiento':'Due date'}</th>
              <th>{lang==='es'?'Días restantes':'Days left'}</th>
            </tr></thead>
            <tbody>
              {loading && <TableSkeletonRows rows={6} />}
              {upcoming.map(e => {
                const due = e.eta || e.due_date || e.last_event_at;
                const days = daysUntil(due);
                const tone = days == null ? 'var(--text-tertiary)'
                           : days < 0 ? 'var(--critical)'
                           : days <= 7 ? 'var(--warning)'
                           : 'var(--text-secondary)';
                return (
                  <tr key={e.id} onClick={() => onOpenExpediente && onOpenExpediente(e.id)} style={{cursor:'pointer'}}>
                    <td><span className="td-ref">{e.ref}</span></td>
                    <td><StatusBadge status={e.status} lang={lang}/></td>
                    <td className="td-money">{fmtMoney(e.balance)}</td>
                    <td className="text-sec">{fmtDate(due, lang) || '—'}</td>
                    <td className="td-num" style={{color:tone, fontVariantNumeric:'tabular-nums', fontWeight:600}}>
                      {days == null ? '—' : days < 0 ? `${Math.abs(days)}d ${lang==='es'?'vencido':'overdue'}` : `${days}d`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div style={{padding:'10px 16px', borderTop:'1px solid var(--divider)', background:'var(--bg-alt)', font:'500 11px/1.4 var(--font-body)', color:'var(--text-tertiary)', display:'flex', gap:6, alignItems:'center'}}>
          <IconShield size={11}/>
          {lang==='es'
            ? 'Para reportar un pago usa el Portal → pestaña Pagos. Para cualquier consulta, contactá a tu ejecutivo de cuenta.'
            : 'To report a payment, use the Portal → Payments tab. For any questions, contact your account manager.'}
        </div>
      </div>
    </div>
  );
}
