// Pipeline kanban — drag-and-drop, rich cards per Módulo/Artefacto spec
//
// Each card shows:
//  1. Identifiers: Ref (mono, clickable), Cliente, Marca, Modo B/C badge
//  2. Mini artifact timeline: 6 dots (done ✅ / active 🔵 / future ⚪ / blocked 🔴)
//  3. SLA traffic-light: days in phase vs baseline (green/amber/red dot)
//  4. Alerts: blocked badge, credit clock (>60d amber, >75d red)
// Cards are drag-droppable between columns to advance state.
//
// ── Variante CLIENT (RBAC, 2026-04-21) ────────────────────────────
// Cuando isClient=true:
//   - Kanban READ-ONLY: draggable=false, sin dropTargets, sin overrides.
//   - Datos ya vienen filtrados por el backend (ClientScopedManager en
//     apps.portal filtra por client_id del JWT), así que no hay leak de
//     expedientes ajenos aunque un staff previsualice como CLIENT con
//     datos mock — el mock incluye todos y aquí no filtramos por cliente
//     (la realidad la fuerza el API). En staff-mock-preview es demo-UI.
//   - Oculto: montos USD por card, totales por columna, filtros internos
//     (chip "Bloqueados"), leyenda con "Blocked", botón "+ Nuevo".
//   - Visible adaptado: subtítulo "Estado de tus pedidos", chip "Atención"
//     (renombre de "Solo urgentes" a lenguaje cliente).
import React, { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { tr, fmtMoney } from "../lib/i18n.js";
import { DISPLAY_STAGES, displayStage } from "../lib/phaseDisplay.js";
import { CountryFlag } from "../components/ui/primitives.jsx";
import {
  IconRefresh, IconPlus, IconAlert, IconLock, IconClock, IconArrow, IconKanban,
} from "../lib/icons.jsx";
import {
  BRANDS,
} from "../data/mockData.js";
// Sprint 2026-08-07 · Ola 1 F2: BRANDS sigue como fixture de catálogo de
// filtro hasta que haya endpoint. MOCK_EXPEDIENTES/MOCK_OCS se eliminan.
import {
  expedientesApi, ocsApi,
  clientesApi, lineasApi, productosApi, marcasApi,
  storageUrl,
} from "../lib/api.js";
import { useRole } from "../context/RoleContext.jsx";

// ── Mapeo backend → UI (Pipeline) ──────────────────────────
// Sprint 2026-05-05: alineado con Expedientes.jsx para que las cards
// muestren cliente, días de crédito, time_in_phase / baseline_days y
// monto facturado en lugar de placeholders vacíos. Los campos vienen
// crudos del backend; la enrichment (cliente nombre/país, marca nombre,
// order_value como fallback de total_invoiced) ocurre en load().
function mapExpedienteForPipeline(r) {
  return {
    id:    r.codigo || r.id,
    uuid:  r.id || null,
    ref:   r.codigo || '',
    oc_id: r.oc_id || null,
    // client_id / brand_id se hidratan en load() con nombre + país.
    client: '', client_country: '', client_id: r.client_id || null,
    brand:  '', brand_id:  r.brand_id  || null,
    // Sprint 2026-05-17 · Operador: operating_company_id (puede ser MWT
    // o el cliente directo). El nombre se hidrata en load().
    operator: '',
    operating_company_id: r.operating_company_id || null,
    status: r.estado || 'REGISTRO',
    credit_days:   Number(r.credit_days) || 0,
    is_blocked:    !!r.is_blocked,
    block_reason:  r.block_reason || null,
    factory_delay: !!r.factory_delay,
    // Modo de operación legacy — ya no se renderea como badge "C/B" en
    // la card (Sprint 2026-05-17 CEO request), pero se conserva en el
    // shape por si el detalle lo usa.
    op_mode:       r.modo_operacion === 'COMISION' ? 'B' : 'C',
    // Sprint 2026-05-17 · arrays role-aware servidos por el backend.
    //   ADMIN/CEO → proforma_codigos[] poblado, sap_codigos[] poblado.
    //   CLIENT_*  → backend devuelve [] en proformas y saps.
    //   oc_codigos[] llega a todos los roles.
    proforma_codigos: Array.isArray(r.proforma_codigos) ? r.proforma_codigos : [],
    oc_codigos:       Array.isArray(r.oc_codigos)       ? r.oc_codigos       : [],
    artifacts_done:  r.artifacts_done || 0,
    artifacts_total: r.artifacts_total || 6,
    // SLA / fase (legacy — no se renderea en la card pero se conserva).
    time_in_phase: Number(r.time_in_phase) || 0,
    baseline_days: Number(r.baseline_days) || 10,
    phase_ratio:   Number(r.phase_ratio)   || 0,
    phase_signal:  r.phase_signal || 'green',
    // Monto: total_invoiced es la fuente de verdad; order_value se calcula
    // en load() como fallback cuando aún no hay facturación.
    total_invoiced: Number(r.total_invoiced) || 0,
    order_value:    0,
    incoterm:       r.incoterm || '—',
    _raw: r,
  };
}

export default function ScreenPipeline({
  searchQuery = "",
  brandFilter: propBrandFilter = "ALL",
  clientFilter: propClientFilter = "ALL",
  statusFilter: propStatusFilter = "ALL",
}) {
  const navigate = useNavigate();
  const { lang } = useOutletContext();
  const { isClient, isAdmin, can } = useRole();

  // ── Data desde API (sin fallback a mocks) ────────
  const [apiExpedientes, setApiExpedientes] = useState([]);
  const [apiOcs,         setApiOcs]         = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [loadError,      setLoadError]      = useState(null);

  // Fable5 · `isAlive` cancela el enriquecimiento (cadena de Promise.all
  // lenta: líneas + productos + clientes + marcas) si el usuario navega
  // antes de que resuelva — evita setState sobre componente desmontado.
  const load = useCallback(async (isAlive = () => true) => {
    setLoading(true);
    try {
      const [expRaw, ocRaw] = await Promise.all([
        // Sprint 2026-08-07 · Ola 1 F2: errores propagados, no mocks.
        expedientesApi.list(),
        ocsApi.list(),
      ]);
      setLoadError(null);
      const expItems = Array.isArray(expRaw) ? expRaw : (expRaw?.results || []);
      const ocItems  = Array.isArray(ocRaw)  ? ocRaw  : (ocRaw?.results  || []);
      const mapped   = expItems.map(mapExpedienteForPipeline);

      // ── Enrichment (mismo patrón que Expedientes.jsx) ──────────────
      let lineasArr = [];
      try {
        const lnRaw = await lineasApi.list({ is_active: true });
        lineasArr = Array.isArray(lnRaw) ? lnRaw : (lnRaw?.results || []);
      } catch { lineasArr = []; }

      const productMap = {};
      try {
        const prodList = await productosApi.list();
        const arr = Array.isArray(prodList) ? prodList : (prodList?.results || []);
        for (const p of arr) { if (p?.id) productMap[p.id] = p; }
      } catch { /* fallthrough — order_value queda en 0 */ }

      const uniqueClientIds = Array.from(new Set([
        ...mapped.map(e => e.client_id).filter(Boolean),
        ...mapped.map(e => e.operating_company_id).filter(Boolean),
      ]));
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

      const brandMap = {};
      try {
        const brList = await marcasApi.list();
        const arr = Array.isArray(brList) ? brList : (brList?.results || []);
        for (const b of arr) { if (b?.id) brandMap[b.id] = b; }
      } catch { /* fallthrough */ }

      const enriched = mapped.map(e => {
        const cli = clientMap[e.client_id];
        const br  = brandMap[e.brand_id];

        const expLines = lineasArr.filter(
          l => l.expediente_id === e._raw.id
        );
        let orderValue = 0;
        let totalClientVal = Number(e._raw?.balance || e._raw?.total_invoiced || 0);
        let totalMwtVal = Number(e._raw?.total_cost || 0);
        let sumClient = 0;
        let sumMwt = 0;

        for (const ln of expLines) {
          const qty = Number(ln.qty || 0);
          const priceClient = Number(ln.unit_price_client || ln.unit_price || 0);
          const priceMwt = Number(ln.unit_price_mwt || ln.unit_price || 0);
          sumClient += qty * priceClient;
          sumMwt += qty * priceMwt;
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

        if (sumClient > 0) totalClientVal = sumClient;
        if (sumMwt > 0) totalMwtVal = sumMwt;

        const op = e.operating_company_id ? clientMap[e.operating_company_id] : null;
        const operatorName = op
          ? (op.razon_social || op.nombre_comercial || op.codigo || '')
          : '';

        return {
          ...e,
          client: cli
            ? (cli.razon_social || cli.nombre_comercial || cli.codigo || '')
            : e.client,
          client_country: cli?.pais_iso2 || e.client_country,
          credit_days:    Number(
            cli?.dias_credito ?? cli?.credit_days ?? cli?.credito_dias ?? e.credit_days ?? 0
          ),
          operator: operatorName,
          operator_logo: op?.logo_url  || '',
          client_logo:   cli?.logo_url || '',
          brand: br ? (br.nombre || br.brand_code || br.slug || '') : e.brand,
          order_value: orderValue,
          total_client: totalClientVal,
          total_mwt: totalMwtVal,
        };
      });

      if (!isAlive()) return;
      setApiExpedientes(enriched);
      setApiOcs(ocItems);
      setLoadError(null);
    } catch (e) {
      if (!isAlive()) return;
      setLoadError(e);
      setApiExpedientes([]);
      setApiOcs([]);
    } finally {
      if (isAlive()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    load(() => alive);
    return () => { alive = false; };
  }, [load]);

  const EXPEDIENTES = apiExpedientes;
  const OCS         = apiOcs;

  const onNavigate = (key) => {
    const map = { wizard: '/wizard' };
    if (map[key]) navigate(map[key]);
  };
  const onOpenOC = (ocId) => navigate(`/expedientes/${ocId}`);
  const onOpenExpediente = (id) => {
    const exp = EXPEDIENTES.find(e => e.id === id);
    const ocId = exp?.oc_id
              || OCS.find(o => Array.isArray(o.expedientes) && o.expedientes.includes(id))?.id;
    if (ocId) {
      navigate(`/expedientes/${ocId}/exp/${id}`);
      return;
    }
    navigate(`/expedientes/none/exp/${id}`);
  };

  const [brandFilter, setBrandFilter] = useState('ALL');
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [blockedOnly, setBlockedOnly] = useState(false);
  const [stateOverrides, setStateOverrides] = useState({});
  const [draggingId, setDraggingId] = useState(null);
  const [dropTargetCol, setDropTargetCol] = useState(null);

  const cols = DISPLAY_STAGES;

  const effectiveStatus = (e) => displayStage(stateOverrides[e.id] || e.status);

  const baseCards = EXPEDIENTES.filter(e => {
    if (brandFilter !== 'ALL' && e.brand_id !== brandFilter) return false;
    if (propBrandFilter !== 'ALL' && e.brand_id !== propBrandFilter) return false;
    if (propClientFilter !== 'ALL' && e.client_id !== propClientFilter) return false;
    if (propStatusFilter !== 'ALL' && effectiveStatus(e) !== propStatusFilter) return false;
    if (urgentOnly && e.phase_signal !== 'red') return false;
    if (blockedOnly && !e.is_blocked) return false;

    if (searchQuery && searchQuery.trim()) {
      const qStr = searchQuery.trim().toLowerCase();
      const matchRef = (e.ref || '').toLowerCase().includes(qStr);
      const matchClient = (e.client || '').toLowerCase().includes(qStr);
      const matchOperator = (e.operator || '').toLowerCase().includes(qStr);
      const matchPfs = (e.proforma_codigos || []).some(c => String(c).toLowerCase().includes(qStr));
      const matchOcs = (e.oc_codigos || []).some(c => String(c).toLowerCase().includes(qStr));
      const matchSaps = (e.sap_codigos || []).some(c => String(c).toLowerCase().includes(qStr));
      if (!matchRef && !matchClient && !matchOperator && !matchPfs && !matchOcs && !matchSaps) {
        return false;
      }
    }
    return true;
  });

  const getCards = (state) => baseCards.filter(e => effectiveStatus(e) === state);

  const handleDragStart = (e, id) => {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = 'move';
    // Firefox needs some data
    try { e.dataTransfer.setData('text/plain', id); } catch(_) {}
  };
  const handleDragEnd = () => { setDraggingId(null); setDropTargetCol(null); };
  const handleDragOver = (e, state) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dropTargetCol !== state) setDropTargetCol(state);
  };
  const handleDrop = (e, state) => {
    e.preventDefault();
    if (draggingId) {
      // El pipeline visual fusiona PREPARACION+DESPACHO; internamente el
      // drag cae en PREPARACION (la primera fase técnica del grupo).
      const techState = state === 'PREPARACION_DESPACHO' ? 'PREPARACION' : state;
      setStateOverrides(prev => ({ ...prev, [draggingId]: techState }));
    }
    setDraggingId(null);
    setDropTargetCol(null);
  };

  const activeCount = baseCards.filter(e => cols.includes(effectiveStatus(e))).length;

  return (
    <div className="page" data-screen-label="Pipeline · Kanban" data-viewport={isClient ? 'CLIENT' : 'ADMIN'}>
      <div className="page-header">
        <div>
          <div className="micro" style={{marginBottom:6}}>
            {isClient
              ? (lang==='es' ? 'ESTADO DE MIS PEDIDOS' : 'MY ORDERS STATUS')
              : (lang==='es' ? 'FLUJO OPERATIVO' : 'OPERATIONAL FLOW')}
          </div>
          <h1 className="page-title">
            {isClient
              ? (lang==='es' ? 'Estado de tus pedidos' : 'Your orders status')
              : tr(lang,'pipeline')}
          </h1>
          <div className="page-subtitle">
            {isClient
              ? (lang==='es' ? 'Seguimiento de cada pedido por etapa. Haz click para ver el detalle.' : 'Track each order by stage. Click to see details.')
              : (lang==='es' ? 'Arrastra tarjetas entre columnas para avanzar estado' : 'Drag cards between columns to advance state')}
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary"><IconRefresh size={13}/>{tr(lang,'refresh')}</button>
          {can('create_expediente') && (
            <button className="btn btn-primary" onClick={() => onNavigate('wizard')}><IconPlus size={14}/>{tr(lang,'new_expediente')}</button>
          )}
        </div>
      </div>

      <div className="toolbar">
        <select className="select" style={{ width: 180 }} value={brandFilter} onChange={e=>setBrandFilter(e.target.value)}>
          <option value="ALL">{tr(lang,'all_brands')}</option>
          {BRANDS.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <button className="filter-chip" data-active={urgentOnly} onClick={()=>setUrgentOnly(!urgentOnly)}>
          <IconAlert size={12}/>
          {isClient
            ? (lang==='es' ? 'Solo atención' : 'Needs attention')
            : (lang==='es' ? 'Solo urgentes' : 'Urgent only')}
        </button>
        {can('view_pipeline_internal_filters') && (
          <button className="filter-chip" data-active={blockedOnly} onClick={()=>setBlockedOnly(!blockedOnly)}>
            <IconLock size={12}/>{tr(lang,'blocked')}
          </button>
        )}
        {/* Legend */}
        <div style={{marginLeft:20, display:'flex', alignItems:'center', gap:12, paddingLeft:16, borderLeft:'1px solid var(--divider)'}}>
          <div className="legend-it"><span className="timeline-dot" data-state="done"/>{lang==='es'?'Completado':'Done'}</div>
          <div className="legend-it"><span className="timeline-dot" data-state="active"/>{lang==='es'?'Activo':'Active'}</div>
          <div className="legend-it"><span className="timeline-dot" data-state="future"/>{lang==='es'?'Pendiente':'Pending'}</div>
          {can('view_pipeline_internal_filters') && (
            <div className="legend-it"><span className="timeline-dot" data-state="blocked"/>{lang==='es'?'Bloqueado':'Blocked'}</div>
          )}
        </div>
        <div style={{ marginLeft:'auto' }}/>
        <span className="caption">
          {isClient
            ? `${lang==='es' ? 'Mostrando' : 'Showing'} ${activeCount} ${lang==='es'?'pedidos':'orders'}`
            : `${lang==='es' ? 'Mostrando' : 'Showing'} ${activeCount} ${lang==='es'?'expedientes':'files'}`}
        </span>
      </div>

      {!loading && loadError && (
        <div className="card" style={{padding:24, textAlign:'center', marginTop:16, marginBottom:16}}>
          <div className="heading-md" style={{marginBottom:6, color:'var(--critical, #DC2626)'}}>
            {lang==='es'?'Error al cargar el pipeline':'Error loading pipeline'}
          </div>
          <div className="caption" style={{marginBottom:16}}>
            {loadError?.message || (lang==='es'?'No se pudo conectar con el servidor.':'Could not connect to the server.')}
          </div>
          <button
            className="btn btn-primary"
            onClick={() => {
              let alive = true;
              load(() => alive);
              return () => { alive = false; };
            }}
          >
            {lang==='es'?'Reintentar':'Retry'}
          </button>
        </div>
      )}

      <div className="kanban" data-readonly={isClient}>
        {cols.map(state => {
          const cards = getCards(state);
          // Total de la columna: usa el monto efectivo (facturado o
          // order_value como fallback) — coherente con el chip por card.
          const totalMoney = cards.reduce(
            (a,c) => a + (c.total_invoiced > 0 ? c.total_invoiced : (c.order_value || 0)),
            0,
          );
          const urgentCount = cards.filter(c => c.phase_signal === 'red').length;
          // En CLIENT no conectamos handlers de drag-drop — la columna es pasiva.
          const dropHandlers = can('pipeline_drag') ? {
            onDragOver: (e)=>handleDragOver(e, state),
            onDragLeave: ()=> dropTargetCol===state && setDropTargetCol(null),
            onDrop: (e)=>handleDrop(e, state),
          } : {};
          return (
            <div key={state}
                 className="k-col"
                 data-drop-target={dropTargetCol === state}
                 {...dropHandlers}>
              <div className="k-col-head">
                <div className="k-col-title">
                  <span className="ab-state-dot" data-state={state}/>
                  <span className="k-col-title-text">{tr(lang, state)}</span>
                  <span className="pill k-col-count">{cards.length}</span>
                  {urgentCount > 0 && (
                    <span className="k-col-urgent" title={lang==='es'?'Urgentes':'Urgent'}>
                      <IconAlert size={10}/>{urgentCount}
                    </span>
                  )}
                </div>
                {can('view_pipeline_money') && (
                  <div className="k-col-money">{fmtMoney(totalMoney)}</div>
                )}
              </div>
              <div className="k-col-body">
                {cards.map(e => (
                  <PipelineCard
                    key={e.id}
                    exp={e}
                    currentState={state}
                    lang={lang}
                    dragging={draggingId === e.id}
                    onOpen={() => onOpenExpediente(e.id)}
                    onOpenOC={() => onOpenOC(e.oc_id)}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    isClient={isClient}
                    canDrag={can('pipeline_drag')}
                    showMoney={can('view_pipeline_money')}
                  />
                ))}
                {cards.length === 0 && (
                  <div className="k-col-empty">
                    {dropTargetCol === state
                      ? <><IconArrow size={16}/><span>{lang==='es'?'Soltar aquí para mover':'Drop here to move'}</span></>
                      : <><IconKanban size={16}/><span className="caption">
                          {isClient
                            ? (lang==='es' ? 'Sin pedidos en esta etapa' : 'No orders in this stage')
                            : (lang==='es' ? 'Sin expedientes' : 'No files')}
                        </span></>
                    }
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Rich pipeline card ─────────
// storageUrl se importa desde lib/api.js.

function PipelineCard({ exp, currentState, lang, dragging, onOpen, onOpenOC, onDragStart, onDragEnd, isClient, canDrag, showMoney }) {
  // Monto cliente y monto MWT (mismo criterio que la tabla master de Expedientes.jsx)
  const clientAmount = exp.total_client > 0
    ? exp.total_client
    : (exp.total_invoiced > 0 ? exp.total_invoiced : (exp.order_value || 0));
  const mwtAmount = exp.total_mwt > 0
    ? exp.total_mwt
    : (exp._raw?.total_cost || 0);

  // Track whether a real drag started, so mouseup-on-same-card still opens detail
  const dragStartedRef = useRef(false);

  // En CLIENT: sin draggable, sin handlers de drag, sin barra de drag-handle.
  const dragProps = canDrag ? {
    draggable: true,
    onDragStart: (e) => { dragStartedRef.current = true; onDragStart(e, exp.id); },
    onDragEnd:   (e) => { onDragEnd(e); setTimeout(() => { dragStartedRef.current = false; }, 50); },
  } : {};

  // Sprint 2026-05-17 · Card rediseñada por CEO request:
  //   · Out: badge "C" (op_mode), badge "90d" (credit clock), timeline de
  //          artefactos, SLA chip "0d / 10d En plazo".
  //   · In:  fila Operador, fila Proforma(s) (ADMIN) u OC(s) (CLIENT_*).
  //   · Card más alta y ancha para que respire la información clave.
  // POL_VISIBILIDAD (R3): los proforma_codigos[] vienen vacíos del backend
  // para CLIENT_* — defense in depth, no se renderean igual.
  const proformas = Array.isArray(exp.proforma_codigos) ? exp.proforma_codigos : [];
  const ocs       = Array.isArray(exp.oc_codigos)       ? exp.oc_codigos       : [];

  // Sprint 2026-06-11 (CEO) · título role-aware, SIN código EXP interno:
  //   CLIENT_* → su PO; ADMIN/CEO → la proforma (PF). Fallback al EXP
  //   solo si no existe ninguno. El código que sube al título se quita
  //   de los chips para no duplicarlo.
  const poFmt = (c) => (/^po[\s_-]/i.test(String(c || "")) ? c : `PO ${c}`);
  let headRef = exp.ref;
  let headKind = "exp";
  if (isClient) {
    if (ocs.length) { headRef = poFmt(ocs[0]); headKind = "oc"; }
  } else if (proformas.length) {
    headRef = /^pf[\s_-]/i.test(String(proformas[0])) ? proformas[0] : `PF ${proformas[0]}`;
    headKind = "pf";
  } else if (ocs.length) {
    headRef = poFmt(ocs[0]); headKind = "oc";
  }
  const pfChips = headKind === "pf" ? proformas.slice(1) : proformas;
  const ocChips = headKind === "oc" ? ocs.slice(1) : ocs;

  // Sprint 2026-08-02 (CEO) · logo en la esquina superior derecha:
  // prioriza el logo del OPERADOR del pedido; si no tiene, cae al del
  // cliente final. Ambos se hidratan en load() desde /api/clientes/<id>.
  // rev2: solo staff (ADMIN/CEO) — el cliente B2B no ve logos en la card.
  const cardLogo = !isClient
    ? (storageUrl(exp.operator_logo) || storageUrl(exp.client_logo))
    : null;

  return (
    <div
      className="k-card-pro k-card-pipeline-v2"
      data-blocked={exp.is_blocked}
      data-dragging={dragging}
      data-readonly={!canDrag}
      {...dragProps}
      onClick={(e) => {
        if (dragStartedRef.current || dragging) return;
        // Sprint 2026-08-02 (CEO) · el click en CUALQUIER parte de la card
        // abre la vista de la OC (/expedientes/:ocId), igual que la fila de
        // la tabla y el click en el código PF/PO. Solo si el expediente no
        // tiene OC vinculada caemos al detalle individual del expediente.
        if (exp.oc_id && onOpenOC) onOpenOC(exp.oc_id);
        else onOpen();
      }}
    >
      {/* Drag handle hint — solo visible en ADMIN */}
      {canDrag && (
        <div className="k-card-dragbar" title={lang==='es'?'Arrastra para mover':'Drag to move'}>⋮⋮</div>
      )}

      {/* Logo operador (fallback: cliente) — esquina superior derecha */}
      {cardLogo && (
        <img
          src={cardLogo}
          alt={exp.operator || exp.client || ''}
          title={exp.operator || exp.client || ''}
          className="k-card-logo"
          loading="lazy"
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
      )}

      {/* Header: REF + lock (si bloqueado). Sin badge "C" ni "90d". */}
      <div className="k-card-row1" style={cardLogo ? { paddingRight: 40 } : undefined}>
        <span
          className="k-card-ref-mono"
          style={{ cursor: 'pointer' }}
          title={lang==='es' ? 'Ver detalle' : 'View detail'}
          onClick={(e) => {
            e.stopPropagation();
            // Sprint 2026-07-31 (CEO) · click en el código principal (PF/PO)
            // abre la vista OC/común (mismo comportamiento que la fila de
            // la tabla), no la subpágina de expediente individual. Si el
            // expediente no tiene OC vinculada, caemos al detalle del exp.
            if (exp.oc_id && onOpenOC) onOpenOC(exp.oc_id);
            else onOpen();
          }}
        >
          {headRef}
        </span>
        {exp.is_blocked && (
          <span className="card-alert card-alert-critical"
                style={{ marginLeft: 'auto' }}
                title={exp.block_reason || (lang==='es'?'Bloqueado':'Blocked')}>
            <IconLock size={10}/>
          </span>
        )}
      </div>

      {/* Cliente — fila destacada (la entidad más importante en la card). */}
      <div className="k-card-field">
        <div className="k-card-field-label">
          {lang==='es' ? 'Cliente' : 'Client'}
        </div>
        <div className="k-card-field-value k-card-field-value--strong" title={exp.client || ''}>
          {exp.client_country && <CountryFlag country={exp.client_country}/>}
          <span className="k-card-text-wrap">
            {exp.client || (
              <span style={{color:'var(--text-tertiary)', fontWeight:400}}>
                {lang==='es' ? 'Sin cliente' : 'No client'}
              </span>
            )}
          </span>
        </div>
      </div>

      {/* Operador — operating_company. Útil para distinguir
          expedientes operados por MWT vs. operados directamente por
          el cliente. */}
      {exp.operator && (
        <div className="k-card-field">
          <div className="k-card-field-label">
            {lang==='es' ? 'Operador' : 'Operator'}
          </div>
          <div className="k-card-field-value" title={exp.operator}>
            <span className="k-card-text-wrap">{exp.operator}</span>
          </div>
        </div>
      )}

      {/* Identificador comercial:
            ADMIN/CEO → Proforma(s) si existen, fallback a OC(s)
            CLIENT_*  → siempre OC(s) (su PO). */}
      {isClient ? (
        ocChips.length > 0 && (
          <div className="k-card-field">
            <div className="k-card-field-label">
              {lang==='es' ? 'OC' : 'PO'}
            </div>
            <div className="k-card-field-chips">
              {ocChips.map((c) => (
                <span key={`oc-${c}`} className="ref-chip ref-chip--oc">
                  <span className="ref-chip__value font-mono tabular-nums">{c}</span>
                </span>
              ))}
            </div>
          </div>
        )
      ) : (
        (pfChips.length > 0 || ocChips.length > 0) && (
          <div className="k-card-field">
            <div className="k-card-field-label">
              {pfChips.length > 0
                ? (lang==='es' ? 'Proforma' : 'Proforma')
                : (lang==='es' ? 'OC' : 'PO')}
            </div>
            <div className="k-card-field-chips">
              {pfChips.length > 0
                ? pfChips.map((c) => (
                    <span key={`pf-${c}`} className="ref-chip ref-chip--proforma">
                      <span className="ref-chip__value font-mono tabular-nums">{c}</span>
                    </span>
                  ))
                : ocChips.map((c) => (
                    <span key={`oc-${c}`} className="ref-chip ref-chip--oc">
                      <span className="ref-chip__value font-mono tabular-nums">{c}</span>
                    </span>
                  ))}
            </div>
          </div>
        )
      )}

      {/* Footer: monto cliente / monto MWT (Admin/CEO) vs solo cliente (Client/Normal) */}
      <div className="k-card-foot" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'baseline' }}>
        {!isClient ? (
          <div style={{ textAlign: 'right' }}>
            <span className="k-card-money-pro tabular-nums" title={lang==='es' ? 'Total Cliente' : 'Client Total'}>
              {fmtMoney(clientAmount)}
            </span>
            {Boolean(exp.operating_company_id && exp.operating_company_id !== exp.client_id) && (
              <span className="tabular-nums" style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 6 }} title={lang==='es' ? 'Total MWT' : 'MWT Total'}>
                / {fmtMoney(mwtAmount)}
              </span>
            )}
          </div>
        ) : (
          <span className="k-card-money-pro tabular-nums" title={lang==='es' ? 'Total Cliente' : 'Client Total'}>
            {fmtMoney(clientAmount)}
          </span>
        )}
      </div>
    </div>
  );
}
