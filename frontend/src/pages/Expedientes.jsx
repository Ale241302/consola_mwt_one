// =====================================================================
// MWT.ONE · Expedientes.jsx
//
// Dos experiencias en un solo archivo, gobernadas por RoleContext:
//
//   ADMIN (staff MWT)  → Dashboard CEO global:
//       · KPIs en vivo (rentabilidad, cuentas por cobrar/pagar, crédito)
//       · Tiempos operativos vs baseline + calidad del proceso
//       · Tabla completa con vistas Financial / Ops / Fleet
//       · Fila expandida con costos internos + deferred pricing
//       · Botón "+ Crear Expediente"
//
//   CLIENT (Portal B2B) → Vista "Mis Pedidos":
//       · Título cambia a "Mis Pedidos"
//       · Sin KPIs CEO, sin columnas de margen, sin costos internos
//       · Sin botón "+ Crear" (ART-01 es CEO-ONLY)
//       · Solo columnas útiles para el cliente: ref, estado, destino, ETA
//       · Si show_deferred_to_client=true → muestra "Precio acordado: $X"
//         como lectura, NUNCA como "deferred" ni editable
//
// La seguridad real vive en el backend (apps.portal + ClientScopedManager).
// Este componente solo oculta UI para dar la experiencia correcta.
// =====================================================================
import React, { useState, useMemo, useEffect, useCallback, Fragment } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { tr, fmtMoney } from "../lib/i18n.js";
import {
  StatusBadge, CreditDot, CountryFlag,
} from "../components/ui/primitives.jsx";
import {
  IconDownload, IconPlus, IconSearch, IconLock, IconAlert, IconChevDown, IconChevRight,
  IconCreditCard, IconDollar, IconFolder, IconCheck, IconTrash, IconX,
} from "../lib/icons.jsx";
import {
  EXPEDIENTES as MOCK_EXPEDIENTES,
  BRANDS, CLIENTS, STATES, PHASE_BASELINE,
  OCS as MOCK_OCS,
} from "../data/mockData.js";
import { expedientesApi, ocsApi, clientesApi, lineasApi, productosApi } from "../lib/api.js";
import { useRole } from "../context/RoleContext.jsx";

// ── Mapeo backend → UI ────────
function mapExpedienteFromApi(r) {
  return {
    // id legible para navegacion y React keys (codigo si existe, sino UUID).
    // uuid es el identificador real para llamadas API DELETE/PATCH.
    id:   r.codigo || r.id,
    uuid: r.id || null,
    ref:  r.codigo || '',
    oc_client: '',                     // se resuelve desde la OC cuando exista
    oc_id: r.oc_id || null,
    sap:  r.sap || null,
    proforma: '',
    client: '', client_country: '', client_id: r.client_id || null,
    brand:  '', brand_id:  r.brand_id  || null,
    status: r.estado || 'REGISTRO',
    credit_days:  Number(r.credit_days) || 0,
    credit_band:  r.credit_band || 'GREEN',
    is_blocked:   !!r.is_blocked,
    block_reason: r.block_reason || null,
    block_cause:  r.block_cause || null,
    factory_delay: !!r.factory_delay,
    artifacts_done:  r.artifacts_done || 0,
    artifacts_total: r.artifacts_total || 6,
    op_mode: r.modo_operacion === 'COMISION' ? 'B' : 'C',
    total_cost:      Number(r.total_cost) || 0,
    total_invoiced:  Number(r.total_invoiced) || 0,
    total_paid:      Number(r.total_paid) || 0,
    balance:         Number(r.balance) || 0,
    projected_margin: Number(r.projected_margin) || 0,
    real_margin:      Number(r.real_margin) || 0,
    margin_drift:     Number(r.margin_drift) || 0,
    commission_pct:   r.commission_pct != null ? Number(r.commission_pct) : null,
    dai_pct:   Number(r.dai_pct) || 0,
    iva_pct:   Number(r.iva_pct) || 0,
    dai_amount:    Number(r.dai_amount) || 0,
    iva_amount:    Number(r.iva_amount) || 0,
    logistic_cost: Number(r.logistic_cost) || 0,
    base_price:    Number(r.base_price) || 0,
    deferred_total_price:    Number(r.deferred_total_price) || 0,
    show_deferred_to_client: !!r.show_deferred_to_client,
    cost_corrections:        !!r.cost_corrections,
    proforma_reviewed:       !!r.proforma_reviewed,
    pg_verified: Number(r.pg_verified) || 0,
    pg_released: Number(r.pg_released) || 0,
    pg_pending:  Number(r.pg_pending)  || 0,
    pg_rejected: Number(r.pg_rejected) || 0,
    time_in_phase: r.time_in_phase || 0,
    baseline_days: r.baseline_days || 10,
    phase_ratio:   Number(r.phase_ratio) || 0,
    phase_signal:  r.phase_signal || 'green',
    currency:      r.moneda || 'USD',
    mode:          r.incoterm || '—',
    freight_mode:  r.freight_mode || 'SEA',
    dispatch_mode: r.dispatch_mode || 'FCL',
    origin:        r.origin || '',
    destination:   r.destination || '',
    shipment_date: r.shipment_date || null,
    eta:           r.eta || null,
    created_at:    r.created_at || null,
    updated_at:    r.updated_at || null,
    last_event_at: r.last_event_at || null,
    product_count:   r.product_count   || 0,
    container_count: r.container_count || 0,
    notes: r.notas || '',
    // Sprint 2026-05-01: order_value/payables_est se hidratan en el load()
    // a partir de las lineas activas + catalogo de productos. Sirven como
    // fallback de los KPIs cuando total_invoiced/total_cost vienen en 0
    // (caso comun en expedientes recien creados sin facturacion).
    order_value:  0,
    payables_est: 0,
    _raw:  r,
  };
}

export default function ScreenExpedientes() {
  const navigate = useNavigate();
  const { lang } = useOutletContext();
  // Viewport efectivo (ADMIN | CLIENT). Re-renderiza cuando el CEO usa
  // el toggle "Tweaks → Viewport" para simular al cliente.
  const { isAdmin, isClient, can } = useRole();

  // ── Data desde API (fallback a mocks) ────────
  const [apiExpedientes, setApiExpedientes] = useState([]);
  const [apiOcs,         setApiOcs]         = useState([]);
  const [loading,        setLoading]        = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [expRaw, ocRaw] = await Promise.all([
        expedientesApi.list().catch(() => []),
        ocsApi.list().catch(() => []),
      ]);
      const expItems = Array.isArray(expRaw) ? expRaw : (expRaw?.results || []);
      const ocItems  = Array.isArray(ocRaw)  ? ocRaw  : (ocRaw?.results  || []);
      const mapped   = expItems.map(mapExpedienteFromApi);

      // ── Sprint 2026-05-01: KPIs reales cuando no hay facturacion ─────
      // Fetch de todas las lineas activas + catalogo de productos para
      // computar order_value por expediente. Esto alimenta:
      //   · receivables (Total por cobrar) cuando total_invoiced = 0
      //   · payables_est (Pagos por salir) cuando total_cost = 0
      let lineasArr = [];
      try {
        const lnRaw = await lineasApi.list({ is_active: true });
        lineasArr = Array.isArray(lnRaw) ? lnRaw : (lnRaw?.results || []);
      } catch { lineasArr = []; }

      // Productos para resolver precio cuando linea.unit_price = 0.
      // Sprint 2026-05-01: usamos UN SOLO list() en lugar de N gets.
      // El ProductoListSerializer ya incluye `precio_lista` y
      // `especificaciones`, asi que no necesitamos los retrieves individuales
      // (que ademas disparaban 404 ruidosos en producto_ids huerfanos).
      const productMap = {};
      try {
        const prodList = await productosApi.list();
        const arr = Array.isArray(prodList) ? prodList : (prodList?.results || []);
        for (const p of arr) {
          if (p?.id) productMap[p.id] = p;
        }
      } catch { /* fallthrough — order_value queda en 0 */ }

      // ── Enriquecimiento batch: hidratar nombre de cliente y días
      // de crédito desde /api/clientes (un fetch por client_id único).
      // Sin esto el listado mostraba "🌐" (CountryFlag con país vacío)
      // y "0d" para los días de crédito porque expedientes.expediente
      // no guarda esos campos — viven en clientes.cliente.
      const uniqueClientIds = Array.from(new Set(
        mapped.map(e => e.client_id).filter(Boolean)
      ));
      let clientMap = {};
      if (uniqueClientIds.length > 0) {
        try {
          const cliResults = await Promise.all(
            uniqueClientIds.map(id => clientesApi.get(id).catch(() => null))
          );
          clientMap = cliResults.reduce((acc, c) => {
            if (c?.id) acc[c.id] = c;
            return acc;
          }, {});
        } catch { clientMap = {}; }
      }
      const enriched = mapped.map(e => {
        const cli = clientMap[e.client_id];
        // ── Calcular order_value sumando lineas de este expediente.
        //    Para cada linea: usar unit_price si > 0, sino caer al
        //    catalogo via especificaciones.client_prices[client_id]
        //    o precio_lista. Mismo enfoque que OCDetail.
        const expLines = lineasArr.filter(
          l => l.expediente_id === e._raw.id
        );
        let orderValue = 0;
        for (const ln of expLines) {
          const qty = Number(ln.qty || 0);
          let unit  = Number(ln.unit_price || 0);
          if (unit === 0 && ln.producto_id) {
            const p = productMap[ln.producto_id];
            if (p) {
              const cliMap = (p.especificaciones && p.especificaciones.client_prices) || {};
              const override = Number(cliMap[e.client_id] || 0);
              const lista    = Number(p.precio_lista || 0);
              unit = override > 0 ? override : lista;
            }
          }
          orderValue += qty * unit;
        }
        const enrichedExp = {
          ...e,
          order_value:  orderValue,
          // Estimacion grosera de pagos a fabrica = ~70% del valor del pedido
          // (resto = margen + logistica). Solo se usa como proxy visual cuando
          // total_cost del backend = 0. Una vez que el AG-COSTOS empiece a
          // poblar costos reales este fallback queda dormido.
          payables_est: orderValue * 0.7,
        };
        if (!cli) return enrichedExp;
        return {
          ...enrichedExp,
          client:         cli.razon_social || cli.nombre || cli.codigo || e.client,
          client_country: cli.pais_iso2 || e.client_country,
          credit_days:    Number(
            cli.dias_credito ?? cli.credit_days ?? cli.credito_dias ?? e.credit_days ?? 0
          ),
        };
      });

      setApiExpedientes(enriched);
      setApiOcs(ocItems);
    } catch {
      setApiExpedientes([]);
      setApiOcs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const EXPEDIENTES = !loading && apiExpedientes.length > 0 ? apiExpedientes : MOCK_EXPEDIENTES;
  const OCS         = !loading && apiOcs.length > 0         ? apiOcs         : MOCK_OCS;

  const onNavigate = (key) => {
    const map = { wizard: '/wizard' };
    if (map[key]) navigate(map[key]);
  };
  const onOpenOC = (ocId) => navigate(`/expedientes/${ocId}`);
  const onOpenExpediente = (id) => {
    // 1) Buscar el expediente en la lista para leer su oc_id directamente.
    //    El backend devuelve oc_id como UUID en expedientes.expediente; los
    //    mocks lo emiten también. Si no hay oc_id, intentamos por compat
    //    con el shape viejo (mocks) donde la OC tenía un array `expedientes`.
    const exp = EXPEDIENTES.find(e => e.id === id);
    const ocId = exp?.oc_id
              || OCS.find(o => Array.isArray(o.expedientes) && o.expedientes.includes(id))?.id;
    if (ocId) {
      navigate(`/expedientes/${ocId}/exp/${id}`);
      return;
    }
    // 3) Sin oc_id (expediente sin OC vinculada — caso raro): vamos al
    //    detalle directamente vía la ruta sin OC. ExpedienteDetail tolera
    //    /expedientes/none/exp/<id> y carga por el id propio.
    navigate(`/expedientes/none/exp/${id}`);
  };

  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [brandFilter, setBrandFilter] = useState('ALL');
  const [clientFilter, setClientFilter] = useState('ALL');
  const [signalFilter, setSignalFilter] = useState('ALL'); // ALL | green | amber | red
  const [alertFilter, setAlertFilter] = useState('ALL');   // ALL | blocked | alerts
  const [view, setView] = useState('financial');           // financial | ops | fleet (solo ADMIN)
  const [expandedId, setExpandedId] = useState(null);
  // En CLIENT forzamos la vista "fleet" (origen→destino, modo, ETA, total
  // facturado como "precio") y escondemos el selector. Esa vista es la más
  // limpia y útil para el cliente, sin columnas internas de margen.
  const effectiveView = isClient ? 'fleet' : view;
  // In-memory edits of deferred price / visibility toggle
  const [deferredEdits, setDeferredEdits] = useState({});

  // ── Bulk delete (sprint 2026-05-01) ────────────────────────
  // selected: Set de UUIDs (no codigos) para llamar al API DELETE.
  // deleting: bloquea botones mientras corren las llamadas en serie.
  const [selected, setSelected] = useState(() => new Set());
  const [deleting, setDeleting] = useState(false);

  const toggleOne = (uuid) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(uuid)) next.delete(uuid); else next.add(uuid);
      return next;
    });
  };
  const clearSelection = () => setSelected(new Set());
  const handleBulkDelete = async (ids) => {
    if (!ids || ids.length === 0 || deleting) return;
    const ok = window.confirm(
      lang === 'es'
        ? `¿Eliminar ${ids.length} expediente${ids.length > 1 ? 's' : ''}? Esta acción no se puede deshacer.`
        : `Delete ${ids.length} file${ids.length > 1 ? 's' : ''}? This cannot be undone.`
    );
    if (!ok) return;
    setDeleting(true);
    try {
      // Llamadas en serie para no saturar el backend ni perder errores
      // individuales. Si una falla, las demás continúan; al final reload.
      const results = await Promise.allSettled(
        ids.map(id => expedientesApi.remove(id))
      );
      const failed = results.filter(r => r.status === 'rejected');
      if (failed.length > 0) {
        const msg = failed[0].reason?.message || (lang === 'es' ? 'Error' : 'Error');
        alert(
          (lang === 'es'
            ? `${failed.length} de ${ids.length} no se pudo eliminar. `
            : `${failed.length} of ${ids.length} could not be deleted. `) + msg
        );
      }
      clearSelection();
      await load();   // refrescar listado desde API
    } finally {
      setDeleting(false);
    }
  };

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
  }, [q, statusFilter, brandFilter, clientFilter, signalFilter, alertFilter, EXPEDIENTES]);

  // ── CEO KPIs (live) ─────
  const kpi = useMemo(() => {
    const N = EXPEDIENTES.length || 1; // evitar div/0 en porcentajes
    const total_invoiced = EXPEDIENTES.reduce((a,e)=>a+(e.total_invoiced||0),0);
    const total_cost     = EXPEDIENTES.reduce((a,e)=>a+(e.total_cost||0),0);
    const total_paid     = EXPEDIENTES.reduce((a,e)=>a+(e.total_paid||0),0);

    // Sprint 2026-05-01: receivables/payables con fallback a order_value
    // calculado en load() (sum lineas con resolucion del catalogo) cuando
    // los campos persistidos del backend son 0.
    //   receivables = Σ max(balance, order_value − total_paid)
    //   payables    = Σ max(total_cost − pg_verified − pg_released, payables_est)
    const receivables = EXPEDIENTES.reduce((a, e) => {
      const persisted = Number(e.balance || 0);
      if (persisted > 0) return a + persisted;
      const ov = Number(e.order_value || 0);
      const paid = Number(e.total_paid || 0);
      return a + Math.max(0, ov - paid);
    }, 0);
    const payables = EXPEDIENTES.reduce((a, e) => {
      const tc = Number(e.total_cost || 0);
      const pgVerif = Number(e.pg_verified || 0);
      const pgRel   = Number(e.pg_released || 0);
      const persisted = Math.max(0, tc - Math.min(tc, pgVerif + pgRel));
      if (persisted > 0) return a + persisted;
      return a + Number(e.payables_est || 0);
    }, 0);

    // Margenes ponderados — guard contra NaN cuando total_invoiced = 0.
    const weighted_real_margin = total_invoiced > 0
      ? EXPEDIENTES.reduce((a,e)=>a + (e.real_margin||0) * (e.total_invoiced||0), 0) / total_invoiced
      : 0;
    const weighted_proj_margin = total_invoiced > 0
      ? EXPEDIENTES.reduce((a,e)=>a + (e.projected_margin||0) * (e.total_invoiced||0), 0) / total_invoiced
      : 0;
    const drift = weighted_real_margin - weighted_proj_margin;

    // Reloj de credito — solo cuenta expedientes con credit_days > 60.
    // Si todos estan en 0 (recien creados), ambos counters quedan en 0
    // pero ya no son NaN.
    const credit_60 = EXPEDIENTES.filter(e => Number(e.credit_days||0) > 60 && Number(e.credit_days||0) <= 75).length;
    const credit_75 = EXPEDIENTES.filter(e => Number(e.credit_days||0) > 75).length;

    const docs_missing = EXPEDIENTES.filter(e => e.block_cause === 'docs').length;
    const factory_delayed = EXPEDIENTES.filter(e => e.factory_delay).length;
    const corrected = EXPEDIENTES.filter(e => e.cost_corrections).length;
    const pf_reviewed = EXPEDIENTES.filter(e => e.proforma_reviewed).length;
    const clean_pct = 1 - pf_reviewed / N;
    const corrected_pct = corrected / N;
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
  }, [EXPEDIENTES]);

  // ── Títulos/subtítulos dependientes del viewport ──
  const pageTitle = isClient
    ? (tr(lang, 'my_orders') || 'Mis Pedidos')
    : tr(lang, 'expedientes');
  const pageSubtitle = isClient
    ? (lang === 'es'
        ? `${EXPEDIENTES.length} pedidos activos`
        : `${EXPEDIENTES.length} active orders`)
    : `${tr(lang,'ceo_overview')} · ${EXPEDIENTES.length} ${lang==='es'?'expedientes globales':'global files'}`;

  return (
    <div
      className="page"
      data-viewport={isClient ? 'CLIENT' : 'ADMIN'}
      data-screen-label={isClient ? 'Mis Pedidos' : 'Expedientes · CEO Dashboard'}
    >
      <div className="page-header">
        <div>
          {/* Micro-header "CEO Scope" SOLO para ADMIN. CLIENT no ve etiqueta interna. */}
          {isAdmin && (
            <div className="micro" style={{marginBottom:6, color:'var(--brand-accent-dark, #0E8A6D)'}}>
              {tr(lang,'ceo_scope')}
            </div>
          )}
          <h1 className="page-title">{pageTitle}</h1>
          <div className="page-subtitle">{pageSubtitle}</div>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary"><IconDownload size={14}/>{tr(lang,'export')}</button>
          {/* "+ Crear Expediente" → capability create_expediente (CEO-ONLY).
              ART-01 se origina siempre desde MWT-Factory, nunca desde Portal B2B. */}
          {can('create_expediente') && (
            <button className="btn btn-primary" onClick={() => onNavigate('wizard')}>
              <IconPlus size={14}/>{tr(lang,'new_expediente')}
            </button>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          CEO-ONLY: KPIs de rentabilidad, tiempos operativos y calidad.
          Ocultos cuando el viewport efectivo es CLIENT.
          ══════════════════════════════════════════════════════════════════ */}
      {isAdmin && <>
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
      </>}
      {/* ── Fin bloque CEO-ONLY ══════════════════════════════════════════ */}

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

        {/* Filtros cross-client / brand / señales de fase / bloqueos: CEO-ONLY.
            Un cliente B2B solo ve sus propios pedidos (backend lo fuerza vía
            ClientScopedManager) — no tiene sentido mostrarle el dropdown de
            "Todos los clientes" o los semáforos de fase internos. */}
        {isAdmin && <>
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
        </>}

        <div style={{ marginLeft:'auto' }}/>

        {/* Selector de vista (Financial / Ops / Fleet) es CEO-ONLY. En CLIENT
            forzamos "fleet" para mostrar origen→destino + ETA, sin márgenes. */}
        {isAdmin && (
          <div className="ceo-chip-group">
            <button data-active={view==='financial'} onClick={()=>setView('financial')}>{tr(lang,'financial_view')}</button>
            <button data-active={view==='ops'}       onClick={()=>setView('ops')}>{tr(lang,'ops_view')}</button>
            <button data-active={view==='fleet'}     onClick={()=>setView('fleet')}>{tr(lang,'fleet_view')}</button>
          </div>
        )}
      </div>

      {/* ── Bulk action bar (CEO-ONLY) ───── */}
      {isAdmin && selected.size > 0 && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '10px 16px', marginBottom: 10,
            background: 'var(--brand-primary)',
            color: '#fff',
            borderRadius: 10,
            boxShadow: '0 2px 8px -2px rgba(11,30,58,0.2)',
          }}
        >
          <IconCheck size={14}/>
          <span style={{ fontWeight: 600, fontSize: 13 }} className="tabular">
            {lang === 'es'
              ? `${selected.size} seleccionado${selected.size > 1 ? 's' : ''}`
              : `${selected.size} selected`}
          </span>
          <button
            type="button"
            onClick={clearSelection}
            disabled={deleting}
            style={{
              background: 'transparent', border: 0, color: '#fff',
              opacity: 0.85, fontSize: 12, cursor: 'pointer',
              textDecoration: 'underline', padding: 0,
            }}
          >
            {lang === 'es' ? 'Limpiar' : 'Clear'}
          </button>
          <div style={{ marginLeft: 'auto' }}/>
          <button
            type="button"
            onClick={() => handleBulkDelete(Array.from(selected))}
            disabled={deleting}
            className="btn btn-sm"
            style={{
              background: 'var(--critical, #DC2626)',
              color: '#fff', border: 0, fontWeight: 600,
              padding: '6px 14px', borderRadius: 6,
              opacity: deleting ? 0.6 : 1,
              cursor: deleting ? 'not-allowed' : 'pointer',
            }}
          >
            <IconTrash size={12}/>
            {deleting
              ? (lang === 'es' ? 'Eliminando…' : 'Deleting…')
              : (lang === 'es'
                  ? `Eliminar ${selected.size}`
                  : `Delete ${selected.size}`)}
          </button>
        </div>
      )}

      {/* ── Master table ───── */}
      <div className="table-wrap">
        <table className="table ceo-table">
          <thead>
            <tr>
              {/* Checkbox de seleccion (CEO-ONLY) */}
              {isAdmin && (
                <th style={{width:32, textAlign:'center'}}>
                  <input
                    type="checkbox"
                    checked={
                      filtered.length > 0 &&
                      filtered.every(e => e.uuid && selected.has(e.uuid))
                    }
                    onChange={(ev) => {
                      ev.stopPropagation();
                      const checked = ev.target.checked;
                      setSelected(prev => {
                        const next = new Set(prev);
                        if (checked) {
                          for (const e of filtered) {
                            if (e.uuid) next.add(e.uuid);
                          }
                        } else {
                          for (const e of filtered) {
                            if (e.uuid) next.delete(e.uuid);
                          }
                        }
                        return next;
                      });
                    }}
                    onClick={(ev) => ev.stopPropagation()}
                    title={lang === 'es' ? 'Seleccionar todos' : 'Select all'}
                    style={{ accentColor: 'var(--brand-primary)', cursor: 'pointer' }}
                  />
                </th>
              )}
              <th style={{width:38}}></th>
              <th>{tr(lang,'ref')}</th>
              <th>{tr(lang,'client')}</th>
              {/* Columna MARCA quitada — el wizard simplificado no asigna
                  marca en el create, y para el listado el cliente tiene
                  más prioridad informativa que la marca por expediente. */}
              <th>{tr(lang,'status')}</th>
              {effectiveView === 'ops' && <>
                <th style={{width:210}}>{lang==='es'?'Timeline · Semáforo':'Timeline · Signal'}</th>
                <th style={{width:90, textAlign:'right'}}>{tr(lang,'time_signal')}</th>
              </>}
              {effectiveView === 'financial' && <>
                <th style={{textAlign:'right'}}>{tr(lang,'invoiced')}</th>
                <th style={{textAlign:'right'}}>{tr(lang,'real_margin')}</th>
                <th style={{textAlign:'right'}}>{tr(lang,'credit_days')}</th>
                <th style={{width: 140}}>{tr(lang,'payments_breakdown')}</th>
              </>}
              {effectiveView === 'fleet' && <>
                <th>{tr(lang,'origin')} → {tr(lang,'destination')}</th>
                <th style={{textAlign:'right'}}>{tr(lang,'mode')}</th>
                {/* "Días de crédito" es una señal interna (cuántos días lleva
                    la factura sin pagar). No mostramos esto al cliente. */}
                {isAdmin && <th style={{width:90, textAlign:'right'}}>{tr(lang,'credit_days')}</th>}
                <th style={{textAlign:'right'}}>
                  {isClient
                    ? (tr(lang, 'agreed_price') || (lang==='es' ? 'Precio acordado' : 'Agreed price'))
                    : tr(lang,'invoiced')}
                </th>
              </>}
              {/* Columna de alertas internas (bloqueos, docs faltantes,
                  retrasos de fábrica, señales de crédito): CEO-ONLY. */}
              {isAdmin && <th style={{width:110}}>{tr(lang,'alerts_blocks')}</th>}
              <th style={{width:36}}></th>
              {isAdmin && <th style={{width:36}}></th>}
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
                  <tr data-selected={isOpen || (e.uuid && selected.has(e.uuid))} style={{ cursor:'pointer' }}
                      onClick={() => {
                        // Para CLIENT, el click directo en la fila abre el
                        // detalle de la OC (no hay expandible con data interna).
                        if (isClient) {
                          const oc = OCS.find(o => o.code === e.oc_client)
                                  || OCS.find(o => o.id === e.oc_id)
                                  || OCS.find(o => Array.isArray(o.expedientes) && o.expedientes.includes(e.id));
                          if (oc) navigate(`/expedientes/${oc.id}`);
                          else if (e.oc_id) navigate(`/expedientes/${e.oc_id}`);
                          else onOpenExpediente(e.id);
                          return;
                        }
                        setExpandedId(isOpen ? null : e.id);
                      }}>
                    {isAdmin && (
                      <td
                        style={{ textAlign: 'center' }}
                        onClick={(ev) => ev.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={!!(e.uuid && selected.has(e.uuid))}
                          disabled={!e.uuid}
                          onChange={(ev) => {
                            ev.stopPropagation();
                            if (e.uuid) toggleOne(e.uuid);
                          }}
                          onClick={(ev) => ev.stopPropagation()}
                          title={
                            !e.uuid
                              ? (lang === 'es' ? 'Sin UUID — no eliminable' : 'No UUID — not deletable')
                              : (lang === 'es' ? 'Seleccionar' : 'Select')
                          }
                          style={{ accentColor: 'var(--brand-primary)', cursor: e.uuid ? 'pointer' : 'not-allowed' }}
                        />
                      </td>
                    )}
                    <td onClick={(ev)=>{
                          ev.stopPropagation();
                          // El chevron tampoco expande en CLIENT; navega al detalle.
                          if (isClient) {
                            const oc = OCS.find(o => o.code === e.oc_client) || OCS.find(o => Array.isArray(o.expedientes) && o.expedientes.includes(e.id));
                            if (oc) navigate(`/expedientes/${oc.id}`);
                            return;
                          }
                          setExpandedId(isOpen?null:e.id);
                        }}>
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
                        {/* CountryFlag quitado: el avión que veías era el
                            placeholder cuando no había country_iso2 en la
                            data del expediente. Ahora mostramos solo el
                            nombre del cliente, que viene hidratado desde
                            /api/clientes/<id> en el batch enrich. */}
                        <span style={{fontWeight: 500}}>{e.client || '—'}</span>
                      </div>
                      {e.destination && (
                        <div className="caption" style={{ marginTop: 2 }}>{e.destination}</div>
                      )}
                    </td>
                    {/* Columna MARCA eliminada (header y body). */}
                    <td><StatusBadge status={e.status} lang={lang}/></td>

                    {effectiveView === 'ops' && <>
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

                    {effectiveView === 'financial' && <>
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

                    {effectiveView === 'fleet' && <>
                      <td>
                        <div className="caption">{e.origin}</div>
                        <div className="body-sm" style={{fontWeight:500}}>→ {e.destination}</div>
                      </td>
                      <td style={{textAlign:'right'}}>
                        <span className="caption">{e.mode} · {e.freight_mode}</span>
                      </td>
                      {/* "credit_days" es una señal interna (edad de la cuenta por cobrar).
                          CLIENT no ve esto. */}
                      {isAdmin && (
                        <td className="td-num">
                          <div className="flex ai-center gap-2" style={{justifyContent:'flex-end'}}>
                            <CreditDot band={e.credit_days>75?'RED':e.credit_days>60?'AMBER':'GREEN'}/>
                            <span className="tabular">{e.credit_days}d</span>
                          </div>
                        </td>
                      )}
                      <td className="td-money">
                        {/* Para CLIENT, esta columna es "Precio acordado" y solo se
                            muestra si el CEO habilitó show_deferred_to_client.
                            Si no, cae al total facturado (es el precio que el cliente
                            ve en su factura — no expone márgenes). */}
                        {isClient && e.show_deferred_to_client && e.deferred_total_price > 0
                          ? fmtMoney(e.deferred_total_price)
                          : fmtMoney(e.total_invoiced)}
                      </td>
                    </>}

                    {isAdmin && (
                      <td>
                        <AlertStack e={e} lang={lang}/>
                      </td>
                    )}
                    <td onClick={(ev)=>{
                         ev.stopPropagation();
                         // Va a la vista intermedia de la OC (PO-xxxx-xxxxx).
                         // Buscar primero por code (mocks) y luego por oc_id (real),
                         // con fallback al detalle del expediente si no hay OC.
                         const oc = OCS.find(o => o.code === e.oc_client)
                                 || OCS.find(o => o.id === e.oc_id)
                                 || OCS.find(o => Array.isArray(o.expedientes) && o.expedientes.includes(e.id));
                         if (oc) navigate(`/expedientes/${oc.id}`);
                         else if (e.oc_id) navigate(`/expedientes/${e.oc_id}`);
                         else onOpenExpediente(e.id);
                       }}
                       title={tr(lang,'oc_detail')}>
                      <IconChevRight size={14} style={{ color:'var(--text-tertiary)'}}/>
                    </td>
                    {isAdmin && (
                      <td
                        style={{ textAlign: 'center' }}
                        onClick={(ev) => ev.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            if (!e.uuid) {
                              alert(lang === 'es'
                                ? 'No se puede eliminar: el expediente no tiene UUID.'
                                : 'Cannot delete: file has no UUID.');
                              return;
                            }
                            handleBulkDelete([e.uuid]);
                          }}
                          disabled={!e.uuid || deleting}
                          className="icon-btn"
                          title={lang === 'es' ? 'Eliminar expediente' : 'Delete file'}
                          style={{
                            color: 'var(--critical, #DC2626)',
                            opacity: !e.uuid || deleting ? 0.4 : 1,
                            cursor: !e.uuid || deleting ? 'not-allowed' : 'pointer',
                          }}
                        >
                          <IconTrash size={14}/>
                        </button>
                      </td>
                    )}
                  </tr>

                  {/* Fila expandida con costos internos + deferred pricing: CEO-ONLY.
                      CLIENT nunca puede expandir (el click ya lo redirigió al detalle). */}
                  {isAdmin && isOpen && (
                    <tr className="expand-row">
                      <td colSpan={13}>
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
