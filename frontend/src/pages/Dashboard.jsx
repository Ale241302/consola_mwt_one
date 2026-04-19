// Dashboard screen
import React from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { tr, fmtMoney } from "../lib/i18n.js";
import { Badge, Sparkline, BarChart, DualBar } from "../components/ui/primitives.jsx";
import {
  IconDownload, IconPlus, IconArrow, IconAlert, IconClock, IconChevRight,
} from "../lib/icons.jsx";
import { DASHBOARD, BRANDS, OCS } from "../data/mockData.js";

export default function ScreenDashboard() {
  const navigate = useNavigate();
  const { lang } = useOutletContext();
  const onNavigate = (key) => {
    const map = { wizard: '/wizard', pipeline: '/pipeline' };
    if (map[key]) navigate(map[key]);
  };
  const onOpenExpediente = (id) => {
    const oc = OCS.find(o => o.expedientes.includes(id));
    if (oc) navigate(`/expedientes/${oc.id}/exp/${id}`);
    else navigate('/expedientes');
  };

  const k = DASHBOARD.kpi;
  const spark = [12,18,15,22,19,24,21,28,25,32,30,34];
  const sparkReceivable = [100,112,118,124,130,138,142,148,150,156,162,168];
  const sparkPaid = [80,85,90,95,100,108,115,118,124,128,134,142];
  return (
    <div className="page" data-screen-label="Dashboard">
      <div className="page-header">
        <div>
          <div className="micro" style={{marginBottom:6}}>{lang==='es' ? 'VISTA GENERAL' : 'OVERVIEW'}</div>
          <h1 className="page-title">{tr(lang,'dashboard')}</h1>
          <div className="page-subtitle">{tr(lang,'overview')} · {new Date().toLocaleDateString(lang==='es'?'es-PE':'en-US',{weekday:'long',day:'2-digit',month:'long',year:'numeric'})}</div>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary"><IconDownload size={14}/>{tr(lang,'export')}</button>
          <button className="btn btn-primary" onClick={() => onNavigate('wizard')}><IconPlus size={14}/>{tr(lang,'new_expediente')}</button>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid col-6 gap-3 mb-6">
        <div className="stat">
          <div className="stat-label">{tr(lang,'active_exp')}</div>
          <div className="stat-row"><div className="stat-value">{k.active}</div><span className="stat-delta up">+4</span></div>
          <div className="stat-sub">{lang==='es' ? '6 ingresados esta semana' : '6 created this week'}</div>
          <div className="stat-spark"><Sparkline values={spark} width={240} height={32} /></div>
        </div>
        <div className="stat">
          <div className="stat-label">{tr(lang,'total_cost')}</div>
          <div className="stat-row"><div className="stat-value">{fmtMoney(k.total_cost)}</div></div>
          <div className="stat-sub">{lang==='es' ? 'USD · 32 expedientes' : 'USD · 32 files'}</div>
          <div className="stat-spark"><Sparkline values={[40,48,52,56,61,65,70,73,78,82,86,92]} color="var(--brand-primary)" width={240} height={32}/></div>
        </div>
        <div className="stat">
          <div className="stat-label">{tr(lang,'invoiced')}</div>
          <div className="stat-row"><div className="stat-value">{fmtMoney(k.total_invoiced)}</div><span className="stat-delta up">+12%</span></div>
          <div className="stat-sub">{lang==='es' ? 'vs. trimestre anterior' : 'vs. prior quarter'}</div>
          <div className="stat-spark"><Sparkline values={[60,64,70,72,78,82,88,92,98,104,110,118]} color="var(--brand-accent)" width={240} height={32}/></div>
        </div>
        <div className="stat">
          <div className="stat-label">{tr(lang,'paid')}</div>
          <div className="stat-row"><div className="stat-value">{fmtMoney(k.total_paid)}</div><span className="stat-delta up">+8%</span></div>
          <div className="stat-sub">{fmtMoney(k.total_paid/k.total_invoiced*100, 'USD').replace('$','')}% {lang==='es' ? 'del total facturado' : 'of invoiced'}</div>
          <div className="stat-spark"><Sparkline values={sparkPaid} color="var(--success)" width={240} height={32}/></div>
        </div>
        <div className="stat">
          <div className="stat-label">{tr(lang,'receivable')}</div>
          <div className="stat-row"><div className="stat-value">{fmtMoney(k.receivables)}</div><span className="stat-delta down">+3%</span></div>
          <div className="stat-sub">{lang==='es' ? '7 expedientes > 60d' : '7 files > 60d overdue'}</div>
          <div className="stat-spark"><Sparkline values={sparkReceivable} color="var(--warning)" width={240} height={32}/></div>
        </div>
        <div className="stat">
          <div className="stat-label">{tr(lang,'margin')}</div>
          <div className="stat-row"><div className="stat-value">{(k.margin_pct*100).toFixed(1)}%</div><span className="stat-delta up">+1.2pt</span></div>
          <div className="stat-sub">{lang==='es' ? 'Margen bruto promedio' : 'Average gross margin'}</div>
          <div className="stat-spark"><Sparkline values={[14,15,15.5,16,16.2,16.8,17.1,17.4,17.8,18.2,18.5,18.7]} color="var(--info)" width={240} height={32}/></div>
        </div>
      </div>

      {/* Pipeline + Urgent */}
      <div className="grid gap-3 mb-6" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">{tr(lang,'operational_pipeline')}</div>
              <div className="card-subtitle">{lang==='es' ? 'Expedientes activos por estado' : 'Active files by state'}</div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => onNavigate('pipeline')}>
              {lang==='es' ? 'Abrir kanban' : 'Open kanban'} <IconArrow size={13}/>
            </button>
          </div>
          <div className="card-pad-lg">
            <BarChart
              data={DASHBOARD.by_status.map(s => ({ ...s, statusLabel: tr(lang, s.status) }))}
              accessor="count" labels="statusLabel"
              height={180}
            />
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">{tr(lang,'urgent_actions')}</div>
              <div className="card-subtitle">{lang==='es' ? 'Requieren intervención hoy' : 'Need attention today'}</div>
            </div>
            <Badge kind="critical">{DASHBOARD.urgent.length}</Badge>
          </div>
          <div style={{ padding: 8 }}>
            {DASHBOARD.urgent.map(u => (
              <button key={u.id}
                onClick={() => onOpenExpediente(u.id)}
                style={{ width:'100%', background:'transparent', border:0, textAlign:'left', padding:'10px 12px', borderRadius:8, cursor:'pointer', display:'flex', gap:10, alignItems:'flex-start' }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-hover)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <div style={{ marginTop: 2 }}>
                  {u.urgency==='high' ? <IconAlert size={16} style={{color:'var(--critical)'}}/> : <IconClock size={16} style={{color:'var(--warning)'}}/>}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:'flex', gap:8, alignItems:'baseline' }}>
                    <span className="mono-sm" style={{ fontWeight:700, color:'var(--interactive)'}}>{u.ref}</span>
                    <span className="body-sm truncate">{u.client}</span>
                  </div>
                  <div className="caption" style={{ marginTop: 3 }}>{u.action}</div>
                </div>
                <IconChevRight size={14} style={{ color:'var(--text-tertiary)', marginTop:4 }}/>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Brand breakdown + cash flow */}
      <div className="grid gap-3 mb-6" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">{tr(lang,'brand_breakdown')}</div>
              <div className="card-subtitle">{lang==='es' ? 'Costo y facturación por marca' : 'Cost and invoicing by brand'}</div>
            </div>
          </div>
          <div className="card-pad-lg" style={{ display:'flex', flexDirection:'column', gap: 12 }}>
            {DASHBOARD.by_brand.map(b => {
              const brand = BRANDS.find(x => x.name === b.brand);
              const max = Math.max(...DASHBOARD.by_brand.map(x=>x.total_invoiced));
              const pct = (b.total_invoiced/max)*100;
              const costPct = (b.total_cost/max)*100;
              return (
                <div key={b.brand}>
                  <div className="flex ai-center jc-between" style={{ marginBottom: 6 }}>
                    <div className="flex ai-center gap-2">
                      <span style={{ width: 10, height: 10, background: brand?.color || '#999', borderRadius: 3 }}/>
                      <span className="heading-sm" style={{ color:'var(--text-primary)' }}>{b.brand}</span>
                      <Badge kind="neutral">{b.count}</Badge>
                    </div>
                    <span className="tabular" style={{font:'600 12px/1 var(--font-mono)'}}>{fmtMoney(b.total_invoiced)}</span>
                  </div>
                  <div style={{ position:'relative', height: 8, background:'var(--bg-alt)', borderRadius: 999, overflow:'hidden' }}>
                    <div style={{ position:'absolute', inset:0, width:`${pct}%`, background: brand?.color || 'var(--brand-primary)', opacity: 0.9, borderRadius: 999 }}/>
                    <div style={{ position:'absolute', inset:0, width:`${costPct}%`, background: brand?.color || 'var(--brand-primary)', opacity: 0.45 }}/>
                  </div>
                </div>
              );
            })}
            <div className="flex gap-4 mt-3" style={{ font:'500 11px/1 var(--font-body)', color:'var(--text-tertiary)' }}>
              <span style={{ display:'inline-flex', alignItems:'center', gap:5 }}><span style={{ width:10, height:8, background:'var(--brand-primary)', opacity:0.9, borderRadius: 2}}/>{tr(lang,'invoiced')}</span>
              <span style={{ display:'inline-flex', alignItems:'center', gap:5 }}><span style={{ width:10, height:8, background:'var(--brand-primary)', opacity:0.45, borderRadius: 2}}/>{tr(lang,'total_cost')}</span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">{tr(lang,'cash_flow')}</div>
              <div className="card-subtitle">{lang==='es' ? 'Facturación vs. cobranza mensual' : 'Invoicing vs. collection monthly'}</div>
            </div>
            <Badge kind="info">USD</Badge>
          </div>
          <div className="card-pad-lg">
            <DualBar
              data={DASHBOARD.cash_90}
              accessorA="invoiced" accessorB="paid"
              labelAccessor="month"
              labelA={tr(lang,'invoiced')} labelB={tr(lang,'paid')}
              height={180}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
