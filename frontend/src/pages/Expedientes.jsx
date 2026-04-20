// Expedientes — ADMIN / CEO Dashboard
// Global scope: all expedientes, all clients, all brands, all nodes.
// Live profitability · cash flow & credit clock · operational times ·
// process quality · alerts & blocks · payment breakdown · internal pricing.
import React, { useState, useMemo, Fragment } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { tr, fmtMoney } from "../lib/i18n.js";
import {
  StatusBadge, CreditDot, CountryFlag,
} from "../components/ui/primitives.jsx";
import {
  IconDownload, IconPlus, IconSearch, IconLock, IconAlert, IconChevDown, IconChevRight,
  IconCreditCard, IconDollar, IconFolder, IconCheck,
} from "../lib/icons.jsx";
import {
  EXPEDIENTES, BRANDS, CLIENTS, STATES, PHASE_BASELINE, OCS,
} from "../data/mockData.js";

export default function ScreenExpedientes() {
  const navigate = useNavigate();
  const { lang } = useOutletContext();
  const onNavigate = (key) => {
    const map = { wizard: '/wizard' };
    if (map[key]) navigate(map[key]);
  };
  const onOpenOC = (ocId) => navigate(`/expedientes/${ocId}`);
  const onOpenExpediente = (id) => {
    const oc = OCS.find(o => o.expedientes.includes(id));
    if (oc) navigate(`/expedientes/${oc.id}/exp/${id}`);
    else navigate('/expedientes');
  };

  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [brandFilter, setBrandFilter] = useState('ALL');
  const [clientFilter, setClientFilter] = useState('ALL');
  const [signalFilter, setSignalFilter] = useState('ALL'); // ALL | green | amber | red
  const [alertFilter, setAlertFilter] = useState('ALL');   // ALL | blocked | alerts
  const [view, setView] = useState('financial');           // financial | ops | fleet
  const [expandedId, setExpandedId] = useState(null);
  // In-memory edits of deferred price / visibility toggle
  const [deferredEdits, setDeferredEdits] = useState({});

  // ── Global dataset: all expedientes ─────
  const filtered = useMemo(() => {
    return EXPEDIENTES.filter(e => {
      if (statusFilter !== 'ALL' && e.status !== statusFilter) return false;
      if (brandFilter !== 'ALL'  && e.brand_id !== brandFilter) return false;
      if (clientFilter !== 'ALL' && e.client_id !== clientFilter) return false;
      if (signalFilter !== 'ALL' && e.phase_signal !== signalFilter) return false;
      if (alertFilter === 'blocked' && !e.is_blocked) return false;
      if (alertFilter === 'alerts') {
        const any = e.is_blocked || e.factory_delay || e.credit_days > 60;
        if (!any) return false;
      }
      if (q) {
        const s = (e.ref+' '+e.oc_client+' '+(e.sap||'')+' '+e.client+' '+e.brand).toLowerCase();
        if (!s.includes(q.toLowerCase())) return false;
      }
      return true;
    });
  }, [q, statusFilter, brandFilter, clientFilter, signalFilter, alertFilter]);

  // ── CEO KPIs (live) ─────
  const kpi = useMemo(() => {
    const total_invoiced = EXPEDIENTES.reduce((a,e)=>a+e.total_invoiced,0);
    const total_cost     = EXPEDIENTES.reduce((a,e)=>a+e.total_cost,0);
    const total_paid     = EXPEDIENTES.reduce((a,e)=>a+e.total_paid,0);
    const receivables    = EXPEDIENTES.reduce((a,e)=>a+e.balance,0);
    const payables       = EXPEDIENTES.reduce((a,e)=>a+(e.total_cost - Math.min(e.total_cost, e.pg_verified + e.pg_released)),0);
    const weighted_real_margin = EXPEDIENTES.reduce((a,e)=>a+e.real_margin*e.total_invoiced,0) / total_invoiced;
    const weighted_proj_margin = EXPEDIENTES.reduce((a,e)=>a+e.projected_margin*e.total_invoiced,0) / total_invoiced;
    const drift = weighted_real_margin - weighted_proj_margin;
    const credit_60 = EXPEDIENTES.filter(e => e.credit_days > 60 && e.credit_days <= 75).length;
    const credit_75 = EXPEDIENTES.filter(e => e.credit_days > 75).length;
    const docs_missing = EXPEDIENTES.filter(e => e.block_cause === 'docs').length;
    const factory_delayed = EXPEDIENTES.filter(e => e.factory_delay).length;
    const corrected = EXPEDIENTES.filter(e => e.cost_corrections).length;
    const pf_reviewed = EXPEDIENTES.filter(e => e.proforma_reviewed).length;
    const clean_pct = 1 - pf_reviewed / EXPEDIENTES.length;
    const corrected_pct = corrected / EXPEDIENTES.length;
    // Avg time per phase vs baseline
    const phase_stats = {};
    for (const s of STATES.slice(0, 6)) {
      const exps = EXPEDIENTES.filter(e => e.status === s);
      if (!exps.length) continue;
      const avg = exps.reduce((a,e)=>a+e.time_in_phase,0)/exps.length;
      phase_stats[s] = { avg, baseline: PHASE_BASELINE[s], count: exps.length };
    }
    return { total_invoiced, total_cost, total_paid, receivables, payables,
      weighted_real_margin, weighted_proj_margin, drift,
      credit_60, credit_75, docs_missing, factory_delayed,
      corrected, corrected_pct, clean_pct, pf_reviewed, phase_stats };
  }, []);

  return (
    <div className="page" data-screen-label="Expedientes · CEO Dashboard">
      <div className="page-header">
        <div>
          <div className="micro" style={{marginBottom:6, color:'var(--brand-accent-dark, #0E8A6D)'}}>
            {tr(lang,'ceo_scope')}
          </div>
          <h1 className="page-title">{tr(lang,'expedientes')}</h1>
          <div className="page-subtitle">{tr(lang,'ceo_overview')} · {EXPEDIENTES.length} {lang==='es'?'expedientes globales':'global files'}</div>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary"><IconDownload size={14}/>{tr(lang,'export')}</button>
          <button className="btn btn-primary" onClick={() => onNavigate('wizard')}><IconPlus size={14}/>{tr(lang,'new_expediente')}</button>
        </div>
      </div>

      {/* ── Row 1: Rentabilidad en vivo ───── */}
      <div className="grid col-4 gap-3 mb-4">
        <div className="kpi-tile accent">
          <div className="k-label">{tr(lang,'live_profitability')}</div>
          <div className="k-value">{(kpi.weighted_real_margin*100).toFixed(1)}%</div>
          <div className="k-sub">
            <span className={`k-delta ${kpi.drift >= 0 ? 'up' : 'down'}`} style={{color: kpi.drift>=0 ? '#75CBB3':'#FF9B9B'}}>
              {kpi.drift >= 0 ? '▲' : '▼'} {(Math.abs(kpi.drift)*100).toFixed(1)}pp
            </span>
            <span style={{opacity:0.7}}>{tr(lang,'vs_projected')} {(kpi.weighted_proj_margin*100).toFixed(1)}%</span>
          </div>
        </div>
        <div className="kpi-tile">
          <div className="k-label">{tr(lang,'receivables_total')}</div>
          <div className="k-value">{fmtMoney(kpi.receivables)}</div>
          <div className="k-sub">
            <IconCreditCard size={12}/>
            {tr(lang,'credit_clock_sub')}
          </div>
        </div>
        <div className="kpi-tile">
          <div className="k-label">{tr(lang,'payables_total')}</div>
          <div className="k-value">{fmtMoney(kpi.payables)}</div>
          <div className="k-sub">
            <IconDollar size={12}/>
            {lang==='es' ? 'Por salir a fábricas y logística' : 'To factories & logistics'}
          </div>
        </div>
        <div className="kpi-tile">
          <div className="k-label">{tr(lang,'credit_clock')}</div>
          <div className="k-value" style={{display:'flex',alignItems:'baseline',gap:8}}>
            <span style={{color:'var(--warning)'}}>{kpi.credit_60}</span>
            <span className="caption" style={{color:'var(--text-tertiary)',fontSize:13}}>+</span>
            <span style={{color:'var(--critical)'}}>{kpi.credit_75}</span>
          </div>
          <div className="k-sub">
            <span className="alert-chip amber">60d</span>
            <span className="alert-chip red">75d</span>
          </div>
        </div>
      </div>

      {/* ── Row 2: Tiempos operativos & Calidad del proceso ───── */}
      <div className="grid gap-3 mb-4" style={{gridTemplateColumns:'1.5fr 1fr'}}>
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">{tr(lang,'operational_times')}</div>
              <div className="card-subtitle">{tr(lang,'avg_phase_time')} · {tr(lang,'vs_historical')}</div>
            </div>
          </div>
          <div style={{padding:'18px 22px'}}>
            <div style={{display:'grid', gridTemplateColumns:'repeat(6, 1fr)', gap: 16}}>
              {STATES.slice(0,6).map(s => {
                const ps = kpi.phase_stats[s];
                if (!ps) return (
                  <div key={s}>
                    <div className="micro" style={{marginBottom:6}}>{tr(lang,s)}</div>
                    <div className="caption">—</div>
                  </div>
                );
                const ratio = ps.avg / ps.baseline;
                const signal = ratio < 1.1 ? 'green' : ratio < 1.35 ? 'amber' : 'red';
                const color = signal === 'green' ? 'var(--success)' : signal === 'amber' ? 'var(--warning)' : 'var(--critical)';
                return (
                  <div key={s}>
                    <div className="micro" style={{marginBottom:8}}>{tr(lang,s)}</div>
                    <div style={{display:'flex',alignItems:'baseline',gap:4}}>
                      <span style={{font:'800 22px/1 var(--font-display)', color, fontVariantNumeric:'tabular-nums'}}>{ps.avg.toFixed(0)}</span>
                      <span className="caption">{lang==='es'?'d':'d'}</span>
                    </div>
                    <div style={{height: 4, background:'var(--border)', borderRadius:2, marginTop:8, overflow:'hidden'}}>
                      <div style={{height:'100%', width: Math.min(100, ratio*60) + '%', background: color}}/>
                    </div>
                    <div className="caption" style={{marginTop:4, color:'var(--text-tertiary)'}}>
                      {lang==='es'?'hist.':'avg'} {ps.baseline}d · {(ratio*100-100).toFixed(0)}%
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">{tr(lang,'process_quality')}</div>
              <div className="card-subtitle">{EXPEDIENTES.length} {lang==='es'?'expedientes':'files'} · {lang==='es'?'últimos 90 días':'last 90 days'}</div>
            </div>
          </div>
          <div style={{padding:'18px 22px'}}>
            <div className="metric-row">
              <span className="ml">{tr(lang,'proformas_clean')}</span>
              <span className="mv" style={{color:'var(--success)'}}>{(kpi.clean_pct*100).toFixed(0)}%</span>
            </div>
            <div className="metric-row">
              <span className="ml">{tr(lang,'proformas_reviewed')}</span>
              <span className="mv">{kpi.pf_reviewed} / {EXPEDIENTES.length}</span>
            </div>
            <div className="metric-row">
              <span className="ml">{tr(lang,'with_cost_correction')}</span>
              <span className="mv" style={{color: kpi.corrected_pct > 0.25 ? 'var(--warning)' : 'var(--text-primary)'}}>
                {(kpi.corrected_pct*100).toFixed(0)}% ({kpi.corrected})
              </span>
            </div>
            <div className="metric-row">
              <span className="ml">{tr(lang,'docs_missing')}</span>
              <span className="mv" style={{color: kpi.docs_missing > 0 ? 'var(--critical)' : 'var(--text-primary)'}}>{kpi.docs_missing}</span>
            </div>
            <div className="metric-row">
              <span className="ml">{tr(lang,'factory_delay')}</span>
              <span className="mv" style={{color: kpi.factory_delayed > 0 ? 'var(--warning)' : 'var(--text-primary)'}}>{kpi.factory_delayed}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Toolbar ───── */}
      <div className="toolbar">
        <div className="search-box" style={{ flex: 1, maxWidth: 340 }}>
          <IconSearch size={14} className="search-icon"/>
          <input className="input" placeholder={tr(lang,'search_ph')} value={q} onChange={e=>setQ(e.target.value)} />
        </div>

        <div className="sep"/>

        <select className="select" style={{ width: 150 }} value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
          <option value="ALL">{lang==='es' ? 'Todos los estados' : 'All states'}</option>
          {STATES.slice(0,6).map(s => <option key={s} value={s}>{tr(lang,s)}</option>)}
        </select>

        <select className="select" style={{ width: 140 }} value={brandFilter} onChange={e=>setBrandFilter(e.target.value)}>
          <option value="ALL">{tr(lang,'all_brands')}</option>
          {BRANDS.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>

        <select className="select" style={{ width: 170 }} value={clientFilter} onChange={e=>setClientFilter(e.target.value)}>
          <option value="ALL">{tr(lang,'all_clients')}</option>
          {CLIENTS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        <div className="ceo-chip-group">
          <button data-active={signalFilter==='ALL'}   onClick={()=>setSignalFilter('ALL')}>{lang==='es'?'Todos':'All'}</button>
          <button data-active={signalFilter==='green'} onClick={()=>setSignalFilter('green')}
                  style={{color: signalFilter==='green' ? 'var(--success)':undefined}}>● {tr(lang,'signal_green')}</button>
          <button data-active={signalFilter==='amber'} onClick={()=>setSignalFilter('amber')}
                  style={{color: signalFilter==='amber' ? 'var(--warning)':undefined}}>● {tr(lang,'signal_amber')}</button>
          <button data-active={signalFilter==='red'}   onClick={()=>setSignalFilter('red')}
                  style={{color: signalFilter==='red' ? 'var(--critical)':undefined}}>● {tr(lang,'signal_red')}</button>
        </div>

        <button className="filter-chip" data-active={alertFilter==='blocked'} onClick={() => setAlertFilter(alertFilter==='blocked'?'ALL':'blocked')}>
          <IconLock size={12}/> {tr(lang,'show_blocked')}
        </button>
        <button className="filter-chip" data-active={alertFilter==='alerts'} onClick={() => setAlertFilter(alertFilter==='alerts'?'ALL':'alerts')}>
          <IconAlert size={12}/> {tr(lang,'show_alerts')}
        </button>

        <div style={{ marginLeft:'auto' }}/>

        <div className="ceo-chip-group">
          <button data-active={view==='financial'} onClick={()=>setView('financial')}>{tr(lang,'financial_view')}</button>
          <button data-active={view==='ops'}       onClick={()=>setView('ops')}>{tr(lang,'ops_view')}</button>
          <button data-active={view==='fleet'}     onClick={()=>setView('fleet')}>{tr(lang,'fleet_view')}</button>
        </div>
      </div>

      {/* ── Master table ───── */}
      <div className="table-wrap">
        <table className="table ceo-table">
          <thead>
            <tr>
              <th style={{width:38}}></th>
              <th>{tr(lang,'ref')}</th>
              <th>{tr(lang,'client')}</th>
              <th>{tr(lang,'brand')}</th>
              <th>{tr(lang,'status')}</th>
              {view === 'ops' && <>
                <th style={{width:210}}>{lang==='es'?'Timeline · Semáforo':'Timeline · Signal'}</th>
                <th style={{width:90, textAlign:'right'}}>{tr(lang,'time_signal')}</th>
              </>}
              {view === 'financial' && <>
                <th style={{textAlign:'right'}}>{tr(lang,'invoiced')}</th>
                <th style={{textAlign:'right'}}>{tr(lang,'real_margin')}</th>
                <th style={{textAlign:'right'}}>{tr(lang,'credit_days')}</th>
                <th style={{width: 140}}>{tr(lang,'payments_breakdown')}</th>
              </>}
              {view === 'fleet' && <>
                <th>{tr(lang,'origin')} → {tr(lang,'destination')}</th>
                <th style={{textAlign:'right'}}>{tr(lang,'mode')}</th>
                <th style={{width:90, textAlign:'right'}}>{tr(lang,'credit_days')}</th>
                <th style={{textAlign:'right'}}>{tr(lang,'invoiced')}</th>
              </>}
              <th style={{width:110}}>{tr(lang,'alerts_blocks')}</th>
              <th style={{width:36}}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(e => {
              const brand = BRANDS.find(b => b.id === e.brand_id);
              const isOpen = expandedId === e.id;
              const driftE = e.real_margin - e.projected_margin;
              const stIdx = STATES.indexOf(e.status);
              const deferredVal = deferredEdits[e.id]?.deferred ?? e.deferred_total_price;
              const showDeferred = deferredEdits[e.id]?.show ?? e.show_deferred_to_client;
              return (
                <Fragment key={e.id}>
                  <tr data-selected={isOpen} style={{ cursor:'pointer' }}
                      onClick={() => setExpandedId(isOpen ? null : e.id)}>
                    <td onClick={(ev)=>{ev.stopPropagation(); setExpandedId(isOpen?null:e.id);}}>
                      <IconChevDown size={14} style={{ color:'var(--text-tertiary)', transform: isOpen?'rotate(180deg)':'none', transition:'transform 160ms' }}/>
                    </td>
                    <td>
                      <div className="flex ai-center gap-2">
                        {e.is_blocked && <IconLock size={13} style={{ color:'var(--critical)'}}/>}
                        <span className="td-ref">{e.ref}</span>
                      </div>
                      <div className="caption oc-code-cell" style={{ marginTop: 2 }}>
                        <span
                          className="oc-code-link"
                          onClick={(ev)=>{ ev.stopPropagation(); const oc = OCS.find(o=>o.code===e.oc_client); if (oc && onOpenOC) onOpenOC(oc.id); }}
                          title={tr(lang,'oc_detail')}
                        >{e.oc_client}</span>
                        {e.sap && <span style={{color:'var(--text-tertiary)'}}>· {e.sap}</span>}
                      </div>
                    </td>
                    <td>
                      <div className="flex ai-center gap-2">
                        <CountryFlag country={e.client_country}/>
                        <span style={{fontWeight: 500}}>{e.client}</span>
                      </div>
                      <div className="caption" style={{ marginTop: 2 }}>{e.destination}</div>
                    </td>
                    <td>
                      <div className="flex ai-center gap-2">
                        <span style={{ width:8, height:8, background: brand?.color, borderRadius: 2 }}/>
                        <span>{e.brand}</span>
                      </div>
                      <div className="caption" style={{marginTop:2}}>{e.op_mode === 'COMISION' ? `${tr(lang,'commission')} ${(e.commission_pct*100).toFixed(1)}%` : tr(lang,'full_mode')}</div>
                    </td>
                    <td><StatusBadge status={e.status} lang={lang}/></td>

                    {view === 'ops' && <>
                      <td>
                        <div className="mini-timeline">
                          {STATES.slice(0,6).map((s, i) => {
                            const cls = i < stIdx ? 'done' : i === stIdx ? 'cur ' + e.phase_signal : 'future';
                            return <div key={s} className={`seg ${cls}`} title={tr(lang,s)}/>;
                          })}
                        </div>
                        <div className="caption" style={{marginTop:6}}>
                          {e.time_in_phase}d / {e.baseline_days}d {tr(lang,'vs_historical')}
                        </div>
                      </td>
                      <td style={{textAlign:'right'}}>
                        <span className="signal-bar">
                          <span className={e.phase_signal==='green'?'on-green':(e.phase_signal==='amber'||e.phase_signal==='red'?'':'')}/>
                          <span className={e.phase_signal==='amber'?'on-amber':(e.phase_signal==='red'?'':'')}/>
                          <span className={e.phase_signal==='red'?'on-red':''}/>
                        </span>
                      </td>
                    </>}

                    {view === 'financial' && <>
                      <td className="td-money">{fmtMoney(e.total_invoiced)}</td>
                      <td style={{textAlign:'right'}}>
                        <span className={`margin-pill ${driftE > 0.005 ? 'up' : driftE < -0.005 ? 'down' : 'flat'}`}>
                          {(e.real_margin*100).toFixed(1)}%
                          <span style={{fontSize:10, marginLeft:2, opacity:0.8}}>
                            {driftE >= 0 ? '+' : ''}{(driftE*100).toFixed(1)}
                          </span>
                        </span>
                      </td>
                      <td className="td-num">
                        <div className="flex ai-center gap-2" style={{justifyContent:'flex-end'}}>
                          <CreditDot band={e.credit_days>75?'RED':e.credit_days>60?'AMBER':'GREEN'}/>
                          <span className="tabular">{e.credit_days}d</span>
                        </div>
                      </td>
                      <td>
                        <PayBar e={e}/>
                      </td>
                    </>}

                    {view === 'fleet' && <>
                      <td>
                        <div className="caption">{e.origin}</div>
                        <div className="body-sm" style={{fontWeight:500}}>→ {e.destination}</div>
                      </td>
                      <td style={{textAlign:'right'}}>
                        <span className="caption">{e.mode} · {e.freight_mode}</span>
                      </td>
                      <td className="td-num">
                        <div className="flex ai-center gap-2" style={{justifyContent:'flex-end'}}>
                          <CreditDot band={e.credit_days>75?'RED':e.credit_days>60?'AMBER':'GREEN'}/>
                          <span className="tabular">{e.credit_days}d</span>
                        </div>
                      </td>
                      <td className="td-money">{fmtMoney(e.total_invoiced)}</td>
                    </>}

                    <td>
                      <AlertStack e={e} lang={lang}/>
                    </td>
                    <td onClick={(ev)=>{
                         ev.stopPropagation();
                         // Va a la vista intermedia de la OC (PO-xxxx-xxxxx)
                         const oc = OCS.find(o => o.code === e.oc_client) || OCS.find(o => o.expedientes.includes(e.id));
                         if (oc) navigate(`/expedientes/${oc.id}`);
                         else onOpenExpediente(e.id);
                       }}
                       title={tr(lang,'oc_detail')}>
                      <IconChevRight size={14} style={{ color:'var(--text-tertiary)'}}/>
                    </td>
                  </tr>

                  {isOpen && (
                    <tr className="expand-row">
                      <td colSpan={view === 'financial' ? 11 : 11}>
                        <CeoDetailRow e={e} lang={lang}
                          deferredVal={deferredVal}
                          showDeferred={showDeferred}
                          onUpdate={(patch) => setDeferredEdits(prev => ({...prev, [e.id]: {...prev[e.id], ...patch}}))}
                          onOpen={() => onOpenExpediente(e.id)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <div className="card" style={{padding:40, textAlign:'center', marginTop:16}}>
          <div className="heading-md" style={{marginBottom:6}}>{lang==='es'?'Sin resultados':'No results'}</div>
          <div className="caption">{lang==='es'?'Ajusta los filtros para ver expedientes.':'Adjust filters to see files.'}</div>
        </div>
      )}
    </div>
  );
}

// ── Payment breakdown inline bar ─────
function PayBar({ e }) {
  const total = e.total_invoiced || 1;
  const v = (e.pg_verified / total) * 100;
  const r = (e.pg_released / total) * 100;
  const p = (e.pg_pending  / total) * 100;
  const x = (e.pg_rejected / total) * 100;
  return (
    <div>
      <div className="pay-bar" title={`Verif ${fmtMoney(e.pg_verified)} · Lib ${fmtMoney(e.pg_released)} · Pend ${fmtMoney(e.pg_pending)} · Rech ${fmtMoney(e.pg_rejected)}`}>
        <div className="seg verified" style={{width: v+'%'}}/>
        <div className="seg released" style={{width: r+'%'}}/>
        <div className="seg pending"  style={{width: p+'%'}}/>
        <div className="seg rejected" style={{width: x+'%'}}/>
      </div>
      <div className="caption" style={{marginTop:4, display:'flex', justifyContent:'space-between'}}>
        <span>{fmtMoney(e.total_paid)} / {fmtMoney(e.total_invoiced)}</span>
        <span style={{color:'var(--text-tertiary)'}}>{((e.total_paid/e.total_invoiced)*100).toFixed(0)}%</span>
      </div>
    </div>
  );
}

// ── Alerts column ─────
function AlertStack({ e, lang }) {
  const chips = [];
  if (e.credit_days > 75) chips.push({c:'red',   t:'75d', label: tr(lang,'credit_75')});
  else if (e.credit_days > 60) chips.push({c:'amber', t:'60d', label: tr(lang,'credit_60')});
  if (e.block_cause === 'docs') chips.push({c:'red', t:'DOC', label: tr(lang,'docs_missing')});
  if (e.factory_delay) chips.push({c:'amber', t:'FAB', label: tr(lang,'factory_delay')});
  if (!chips.length) return <span className="caption" style={{color:'var(--text-tertiary)'}}>—</span>;
  return (
    <div className="flex" style={{flexWrap:'wrap', gap:4}}>
      {chips.map((ch,i) => <span key={i} className={`alert-chip ${ch.c}`} title={ch.label}>{ch.t}</span>)}
    </div>
  );
}

// ── Expanded detail row with payments breakdown + internal costs + deferred pricing ─────
function CeoDetailRow({ e, lang, deferredVal, showDeferred, onUpdate, onOpen }) {
  const client = CLIENTS.find(c => c.id === e.client_id);
  const creditAvail = client ? client.credit_limit - client.credit_used : 0;
  const exposure    = e.balance;
  return (
    <div className="expand-inner">
      {/* Payments breakdown */}
      <div>
        <div className="micro" style={{marginBottom:10}}>{tr(lang,'payments_breakdown')}</div>
        <PayBar e={e}/>
        <div className="pay-legend">
          <div className="it"><span className="sw" style={{background:'var(--success)'}}/>{tr(lang,'pg_verified')} {fmtMoney(e.pg_verified)}</div>
          <div className="it"><span className="sw" style={{background:'var(--brand-accent)'}}/>{tr(lang,'pg_released')} {fmtMoney(e.pg_released)}</div>
          <div className="it"><span className="sw" style={{background:'var(--warning)'}}/>{tr(lang,'pg_pending')} {fmtMoney(e.pg_pending)}</div>
          <div className="it"><span className="sw" style={{background:'var(--critical)'}}/>{tr(lang,'pg_rejected')} {fmtMoney(e.pg_rejected)}</div>
        </div>
        <div style={{marginTop:16, paddingTop:14, borderTop:'1px dashed var(--divider)'}}>
          <div className="metric-row">
            <span className="ml">{tr(lang,'credit_available')} · {client?.name}</span>
            <span className="mv" style={{color: creditAvail < 20000 ? 'var(--critical)' : 'var(--text-primary)'}}>{fmtMoney(creditAvail)}</span>
          </div>
          <div className="metric-row">
            <span className="ml">{tr(lang,'exposure')}</span>
            <span className="mv">{fmtMoney(exposure)}</span>
          </div>
          <div className="metric-row">
            <span className="ml">{tr(lang,'balance')}</span>
            <span className="mv" style={{color:'var(--brand-primary)'}}>{fmtMoney(e.balance)}</span>
          </div>
        </div>
      </div>

      {/* Internal costs (CEO-ONLY) */}
      <div>
        <div className="micro" style={{marginBottom:10, color:'var(--brand-accent-dark, #0E8A6D)'}}>
          🔒 {tr(lang,'internal_costs')}
        </div>
        <div className="metric-row">
          <span className="ml">{tr(lang,'logistic_cost')}</span>
          <span className="mv">{fmtMoney(e.logistic_cost)}</span>
        </div>
        <div className="metric-row">
          <span className="ml">DAI ({(e.dai_pct*100).toFixed(1)}%)</span>
          <span className="mv">{fmtMoney(e.dai_amount)}</span>
        </div>
        <div className="metric-row">
          <span className="ml">IVA ({(e.iva_pct*100).toFixed(0)}%)</span>
          <span className="mv">{fmtMoney(e.iva_amount)}</span>
        </div>
        <div className="metric-row">
          <span className="ml">{tr(lang,'mode_op')}</span>
          <span className="mv">{e.op_mode === 'COMISION' ? `${tr(lang,'commission')} ${(e.commission_pct*100).toFixed(1)}%` : tr(lang,'full_mode')}</span>
        </div>
        <div className="metric-row">
          <span className="ml">{tr(lang,'base_price_lbl')}</span>
          <span className="mv">{fmtMoney(e.base_price)}</span>
        </div>
        <div className="metric-row">
          <span className="ml">{tr(lang,'projected_margin')}</span>
          <span className="mv" style={{color:'var(--text-secondary)'}}>{(e.projected_margin*100).toFixed(1)}%</span>
        </div>
        <div className="metric-row">
          <span className="ml">{tr(lang,'real_margin')}</span>
          <span className="mv" style={{color: e.real_margin >= e.projected_margin ? 'var(--success)' : 'var(--critical)'}}>
            {(e.real_margin*100).toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Deferred price + visibility */}
      <div>
        <div className="micro" style={{marginBottom:10}}>{tr(lang,'deferred_price')}</div>
        <div className="caption" style={{marginBottom:10}}>{tr(lang,'deferred_price_sub')}</div>

        <div style={{display:'flex', gap:8, alignItems:'center', marginBottom:10}}>
          <div className="input" style={{fontFamily:'var(--font-mono)', fontWeight:600, fontSize:15, padding:'8px 10px', background:'var(--bg-alt)', borderRadius:8, flex:1, display:'flex', alignItems:'center'}}>
            <span style={{color:'var(--text-tertiary)', marginRight:4}}>USD</span>
            <input
              type="number"
              value={deferredVal}
              onChange={(ev) => onUpdate({deferred: +ev.target.value})}
              style={{border:0, background:'transparent', outline:'none', flex:1, font:'inherit', color:'inherit'}}
            />
          </div>
        </div>

        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 0', borderTop:'1px dashed var(--divider)', borderBottom:'1px dashed var(--divider)'}}>
          <div>
            <div className="body-sm" style={{fontWeight:500}}>{tr(lang,'visible_to_client')}</div>
            <div className="caption">{showDeferred ? (lang==='es'?'El cliente ve este precio':'Client sees this price') : (lang==='es'?'Solo visible internamente':'Internal only')}</div>
          </div>
          <div className="switch" data-on={showDeferred} onClick={()=>onUpdate({show: !showDeferred})}/>
        </div>

        <div style={{marginTop:14, display:'flex', gap:8}}>
          <button className="btn btn-sm btn-secondary" onClick={onOpen}>
            <IconFolder size={12}/> {lang==='es'?'Abrir expediente':'Open file'}
          </button>
          <button className="btn btn-sm btn-primary">
            <IconCheck size={12}/> {tr(lang,'save')}
          </button>
        </div>
      </div>
    </div>
  );
}
