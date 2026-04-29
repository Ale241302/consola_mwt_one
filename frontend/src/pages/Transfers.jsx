// ─────────────────────────────────────────────────────────────
// TransfersDashboard — Motor de Transferencias Inter-Nodos
// Agente responsable: [AG-FRONTEND]
//
// Cabecera con 4 KPIs:
//   1. Unidades en tránsito          (físico moviéndose)
//   2. Transferencias activas         (in_transit)
//   3. Pendientes de aprobación       (planned & needs_approval)
//   4. Pendientes de reconciliación   (received con discrepancia)
//
// Tabla de trazabilidad con expansión por fila + badges del state machine.
//   PLANNED (gris) · APPROVED (azul) · IN-TRANSIT (ámbar) ·
//   RECEIVED (verde claro) · RECONCILED (verde oscuro)
// ─────────────────────────────────────────────────────────────
import React, { useMemo, useState } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  IconSwap, IconSearch, IconX, IconTruck, IconAlert, IconCheck,
  IconClipboard, IconChevDown, IconChevRight, IconFileText, IconEye,
  IconClock,
} from "../lib/icons.jsx";
import {
  TRANSFERS as MOCK_TRANSFERS, TRANSFER_STATUS_META, LEGAL_CONTEXT_META, getTransferTotals,
} from "../data/mockData.js";
import CreateTransferDrawer from "../components/inventario/CreateTransferDrawer.jsx";
import { useTransfersData } from "../hooks/useTransfersData.js";
import { transferenciasApi } from "../lib/api.js";

// ── Adapter: backend ESTADO (UPPERCASE) → mock status (lowercase)
const API_TO_MOCK_STATUS = {
  PLANNED:    'planned',
  APPROVED:   'approved',
  IN_TRANSIT: 'in_transit',
  RECEIVED:   'received',
  RECONCILED: 'reconciled',
  CANCELLED:  'cancelled',
};

// Convierte un row del backend (transfers.transferencia) al shape que la tabla
// ya sabe renderizar. Las líneas se dejan vacías: el detalle se lazy-loadea.
function mapApiTransferToRow(r) {
  // El list serializer del backend devuelve agregados (lines_count,
  // total_qty_transfer, total_qty_received). Fabricamos un stub de `lines`
  // con la longitud y totales correctos para que getTransferTotals(t)
  // retorne valores reales en lugar de "0 SKU · 0 RESV.".
  const linesCount     = Number(r.lines_count        || 0);
  const totalTransfer  = Number(r.total_qty_transfer || 0);
  const totalReceived  = Number(r.total_qty_received || 0);
  const linesStub      = Array.from({ length: linesCount }, (_, i) => ({
    qty_transfer: i === 0 ? totalTransfer : 0,
    qty_reserve:  0,
    qty_received: (i === 0 && totalReceived > 0) ? totalReceived : null,
  }));
  return {
    id:             r.codigo || r.id,
    _backend_id:    r.id,
    status:         API_TO_MOCK_STATUS[r.estado] || 'planned',
    origen:         r.origen_label || '—',
    destino:        r.destino_label || '—',
    legal_context:  r.legal_context || 'INTERNAL',
    ref_tracking:   r.ref_tracking || '',
    needs_approval: !!r.needs_approval,
    value_usd:      Number(r.value_usd || 0),
    created_at:     r.updated_at || r.created_at || null,
    dispatched_at:  r.dispatched_at || null,
    eta:            r.eta || null,
    received_at:    r.received_at || null,
    lines:          linesStub,
    // discrepancia oficial del backend (no la inferida desde los stubs)
    _has_discrepancy_be: !!r.has_discrepancy,
  };
}

const STATUS_ORDER = ['planned','approved','in_transit','received','reconciled'];

function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  return d.toLocaleDateString('es-PE', { day:'2-digit', month:'short' });
}
function fmtInt(n) { return (n ?? 0).toLocaleString('en-US'); }
function fmtUsd(n) { return '$' + (n ?? 0).toLocaleString('en-US'); }

export default function ScreenTransfers() {
  const { lang } = useOutletContext();
  const navigate = useNavigate();

  const [q, setQ]               = useState('');
  const [statusFilter, setSF]   = useState('ALL');
  const [drawerOpen, setDrawer] = useState(false);
  const [expanded, setExpanded] = useState(null); // transfer id
  const [transitioning, setTransitioning] = useState(null); // backend id while a transition POST is in-flight

  // ── Backend data (fallback a mock si aún no hay data real) ────
  const { transfers: apiTransfers, kpis: apiKpis, loading: loadingBackend, reload: reloadTransfers } = useTransfersData();
  const TRANSFERS = useMemo(() => {
    if (!loadingBackend && Array.isArray(apiTransfers) && apiTransfers.length > 0) {
      return apiTransfers.map(mapApiTransferToRow);
    }
    return MOCK_TRANSFERS;
  }, [apiTransfers, loadingBackend]);

  // ── KPIs ───────────
  const kpis = useMemo(() => {
    // Si el backend ya devolvió KPIs oficiales, usarlos (las "unidades en tránsito"
    // no están disponibles server-side todavía — se derivan del listado).
    if (apiKpis) {
      let unitsInTransit = 0;
      for (const t of TRANSFERS) {
        if (t.status === 'in_transit') {
          const tot = getTransferTotals(t);
          unitsInTransit += tot.units_total;
        }
      }
      return {
        unitsInTransit,
        activeCount:      apiKpis.in_transit   || 0,
        pendingApproval:  apiKpis.needs_approval || 0,
        pendingReconcile: apiKpis.received     || 0,
      };
    }
    let unitsInTransit = 0;
    let activeCount    = 0;
    let pendingApproval = 0;
    let pendingReconcile = 0;
    for (const t of TRANSFERS) {
      const tot = getTransferTotals(t);
      if (t.status === 'in_transit') {
        activeCount += 1;
        unitsInTransit += tot.units_total;
      }
      if (t.status === 'planned' && t.needs_approval) pendingApproval += 1;
      if (t.status === 'received' && tot.has_discrepancy) pendingReconcile += 1;
    }
    return { unitsInTransit, activeCount, pendingApproval, pendingReconcile };
  }, [TRANSFERS, apiKpis]);

  // ── Filter + sort ───────────
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return TRANSFERS
      .filter(t => {
        if (statusFilter !== 'ALL' && t.status !== statusFilter) return false;
        if (!needle) return true;
        return [
          t.id, t.origen, t.destino, t.legal_context, t.ref_tracking || '',
          ...t.lines.map(l => l.sku),
        ].join(' ').toLowerCase().includes(needle);
      })
      .sort((a,b) => {
        // activos primero, luego fecha desc
        const sa = STATUS_ORDER.indexOf(a.status);
        const sb = STATUS_ORDER.indexOf(b.status);
        if (sa !== sb) return sa - sb;
        return (b.created_at || '').localeCompare(a.created_at || '');
      });
  }, [q, statusFilter, TRANSFERS]);

  // ── Status counts para chips ───────────
  const statusCounts = useMemo(() => {
    const c = { ALL: TRANSFERS.length };
    for (const s of STATUS_ORDER) c[s] = TRANSFERS.filter(t => t.status === s).length;
    return c;
  }, [TRANSFERS]);

  // ── State machine: POST /api/transferencias/{id}/{action}/ ────
  async function transition(transfer, actionName) {
    const backendId = transfer._backend_id;
    if (!backendId) {
      // Row viene del mock → no hay ID real. Cortar con un warning silencioso.
      console.warn("transition() ignorado: row viene del mock, no hay _backend_id");
      return;
    }
    try {
      setTransitioning(backendId);
      await transferenciasApi.action(actionName, backendId, {});
      await reloadTransfers?.();
    } catch (e) {
      console.error(`transition(${actionName}) falló:`, e);
      alert(`${lang==='es'?'Error al transicionar':'Transition error'}: ${e?.message || e}`);
    } finally {
      setTransitioning(null);
    }
  }

  return (
    <div className="page">
      {/* ── Header ── */}
      <div className="page-header">
        <div>
          <div className="micro" style={{marginBottom:6}}>
            {lang==='es'?'SUPPLY CHAIN · TRANSFERENCIAS':'SUPPLY CHAIN · TRANSFERS'}
          </div>
          <h1 className="page-title">{lang==='es'?'Transferencias':'Transfers'}</h1>
          <div className="page-subtitle">
            {lang==='es'
              ? 'Trazabilidad del flujo físico inter-nodos: planificación, aprobación, tránsito y reconciliación.'
              : 'End-to-end traceability of inter-node physical flow: planning, approval, transit and reconciliation.'}
          </div>
        </div>
        <div className="flex ai-center gap-2">
          {/* Sprint Transfer Engine v2: el drawer queda en archivo pero ya no
              se usa — el botón navega al wizard full-page /transferencias/nueva. */}
          <button className="btn btn-accent" onClick={() => navigate('/transferencias/nueva')}>
            <IconSwap size={14}/> {lang==='es'?'Nueva transferencia':'New transfer'}
          </button>
        </div>
      </div>

      {/* ── KPIs ── */}
      <motion.div
        className="inv-kpi-row"
        initial={{ opacity:0, y:8 }}
        animate={{ opacity:1, y:0 }}
        transition={{ duration:0.35, ease:'easeOut' }}
        style={{ marginTop:16 }}
      >
        <KpiTile
          icon={IconTruck}
          color="#B45309"
          label={lang==='es'?'Unidades en tránsito':'Units in transit'}
          value={fmtInt(kpis.unitsInTransit)}
          sub={`${kpis.activeCount} ${lang==='es'?'transferencias activas':'active transfers'}`}
        />
        <KpiTile
          icon={IconSwap}
          color="#3083FE"
          label={lang==='es'?'Transferencias activas':'Active transfers'}
          value={fmtInt(kpis.activeCount)}
          sub={lang==='es'?'En tránsito ahora':'Currently in transit'}
        />
        <KpiTile
          icon={IconClock}
          color="#6B7280"
          label={lang==='es'?'Pendientes de aprobación':'Pending approval'}
          value={fmtInt(kpis.pendingApproval)}
          sub={lang==='es'?'Requieren visto bueno CEO':'Require CEO sign-off'}
          alert={kpis.pendingApproval > 0}
        />
        <KpiTile
          icon={IconAlert}
          color="#DC2626"
          label={lang==='es'?'Pendientes reconciliación':'Pending reconciliation'}
          value={fmtInt(kpis.pendingReconcile)}
          sub={lang==='es'?'Discrepancias destino vs origen':'Destination/origin discrepancies'}
          alert={kpis.pendingReconcile > 0}
        />
      </motion.div>

      {/* ── Filtros ── */}
      <div className="trf-filters">
        <div className="search-wrap" style={{ maxWidth:340 }}>
          <IconSearch size={14} className="search-icon"/>
          <input
            className="input"
            placeholder={lang==='es'?'Buscar ID, nodo, SKU o tracking…':'Search ID, node, SKU or tracking…'}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q && <button className="search-clear" onClick={() => setQ('')}><IconX size={12}/></button>}
        </div>
        <div className="trf-status-chips">
          <StatusChip
            active={statusFilter === 'ALL'}
            onClick={() => setSF('ALL')}
            label={lang==='es'?'Todas':'All'}
            count={statusCounts.ALL}
            dotColor="#0B1E3A"
          />
          {STATUS_ORDER.map(s => (
            <StatusChip
              key={s}
              active={statusFilter === s}
              onClick={() => setSF(s)}
              label={TRANSFER_STATUS_META[s].label}
              count={statusCounts[s]}
              dotColor={TRANSFER_STATUS_META[s].color}
            />
          ))}
        </div>
      </div>

      {/* ── Trazabilidad ── */}
      <div className="card trf-table-card" style={{ marginTop:16 }}>
        <div className="trf-table-head">
          <div className="trf-col-id">{lang==='es'?'ID':'ID'}</div>
          <div className="trf-col-date">{lang==='es'?'Fecha':'Date'}</div>
          <div className="trf-col-route">{lang==='es'?'Ruta':'Route'}</div>
          <div className="trf-col-legal">{lang==='es'?'Contexto':'Context'}</div>
          <div className="trf-col-units tabular-nums">{lang==='es'?'Unidades':'Units'}</div>
          <div className="trf-col-value tabular-nums">{lang==='es'?'Valor':'Value'}</div>
          <div className="trf-col-status">{lang==='es'?'Estado':'Status'}</div>
          <div className="trf-col-caret"/>
        </div>

        <AnimatePresence mode="popLayout">
          {rows.map((t, idx) => {
            const tot   = getTransferTotals(t);
            const meta  = TRANSFER_STATUS_META[t.status];
            const lmeta = LEGAL_CONTEXT_META[t.legal_context] || { label: t.legal_context, color: '#64748B' };
            const isExp = expanded === t.id;

            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity:0, y:6 }}
                animate={{ opacity:1, y:0 }}
                exit={{ opacity:0 }}
                transition={{ duration:0.25, delay: Math.min(idx*0.02, 0.15) }}
                className={`trf-row ${isExp ? 'is-expanded' : ''}`}
              >
                <button
                  type="button"
                  className="trf-row-main"
                  onClick={() => setExpanded(isExp ? null : t.id)}
                >
                  <div className="trf-col-id mono">{t.id}</div>
                  <div className="trf-col-date">
                    <div className="trf-date-main">{fmtDate(t.created_at)}</div>
                    {t.dispatched_at && (
                      <div className="trf-date-sub micro">
                        {lang==='es'?'Desp.':'Disp.'} {fmtDate(t.dispatched_at)}
                      </div>
                    )}
                  </div>
                  <div className="trf-col-route">
                    <span className="trf-node">{t.origen}</span>
                    <span className="trf-arrow">→</span>
                    <span className="trf-node">{t.destino}</span>
                    {t.ref_tracking && (
                      <div className="trf-tracking micro mono">{t.ref_tracking}</div>
                    )}
                  </div>
                  <div className="trf-col-legal">
                    <span
                      className="trf-legal-pill"
                      style={{ '--legal-color': lmeta.color }}
                    >
                      <span className="trf-legal-dot"/>
                      {lmeta.label}
                    </span>
                  </div>
                  <div className="trf-col-units tabular-nums">
                    <div className="trf-units-main">{fmtInt(tot.units_total)}</div>
                    <div className="trf-units-sub micro">
                      {tot.lines_count} SKU · {fmtInt(tot.units_reserved)} {lang==='es'?'resv.':'resv.'}
                    </div>
                  </div>
                  <div className="trf-col-value tabular-nums">{fmtUsd(t.value_usd)}</div>
                  <div className="trf-col-status">
                    <StatusBadge status={t.status}/>
                    {t.status === 'planned' && t.needs_approval && (
                      <div className="trf-flag-approval">
                        <IconAlert size={10}/> {lang==='es'?'Aprobación CEO':'CEO sign-off'}
                      </div>
                    )}
                    {t.status === 'received' && tot.has_discrepancy && (
                      <div className="trf-flag-disc">
                        <IconAlert size={10}/> {lang==='es'?'Discrepancia':'Discrepancy'}
                      </div>
                    )}
                  </div>
                  <div className="trf-col-caret">
                    <motion.div
                      animate={{ rotate: isExp ? 90 : 0 }}
                      transition={{ duration:0.2 }}
                    >
                      <IconChevRight size={14}/>
                    </motion.div>
                  </div>
                </button>

                {/* ── Row expansion ── */}
                <AnimatePresence initial={false}>
                  {isExp && (
                    <motion.div
                      key="exp"
                      initial={{ height:0, opacity:0 }}
                      animate={{ height:'auto', opacity:1 }}
                      exit={{ height:0, opacity:0 }}
                      transition={{ duration:0.22, ease:'easeOut' }}
                      className="trf-row-exp"
                    >
                      <div className="trf-exp-inner">
                        <div className="trf-exp-section">
                          <div className="trf-exp-title">
                            {lang==='es'?'Resumen de SKUs':'SKU summary'}
                          </div>
                          <div className="trf-exp-lines">
                            {t.lines.map((ln, i) => {
                              const hasDelta = ln.qty_received != null && ln.qty_received !== ln.qty_transfer;
                              return (
                                <div key={i} className={`trf-exp-line ${hasDelta ? 'has-delta' : ''}`}>
                                  <div className="trf-exp-line-sku mono">{ln.sku}</div>
                                  <div className="trf-exp-line-name">{ln.product}</div>
                                  <div className="trf-exp-line-qty tabular-nums">
                                    <span className="trf-exp-lbl micro">
                                      {lang==='es'?'Transf.':'Transf.'}
                                    </span>
                                    {fmtInt(ln.qty_transfer)}
                                  </div>
                                  {ln.qty_reserve > 0 && (
                                    <div className="trf-exp-line-qty tabular-nums reserve">
                                      <span className="trf-exp-lbl micro">
                                        {lang==='es'?'Resv.':'Resv.'}
                                      </span>
                                      {fmtInt(ln.qty_reserve)}
                                    </div>
                                  )}
                                  {ln.qty_received != null && (
                                    <div className={`trf-exp-line-qty tabular-nums received ${hasDelta ? 'err' : ''}`}>
                                      <span className="trf-exp-lbl micro">
                                        {lang==='es'?'Recib.':'Recv.'}
                                      </span>
                                      {fmtInt(ln.qty_received)}
                                      {hasDelta && (
                                        <span className="trf-exp-delta">
                                          Δ {ln.qty_received - ln.qty_transfer}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {t.notes && (
                          <div className="trf-exp-notes">
                            <IconFileText size={12}/>
                            <span>{t.notes}</span>
                          </div>
                        )}

                        <div className="trf-exp-footer">
                          <div className="trf-exp-meta micro">
                            {lang==='es'?'Creada por':'Created by'} <strong>{t.created_by || '—'}</strong>
                            {t.approved_by && (
                              <> · {lang==='es'?'aprobada por':'approved by'} <strong>{t.approved_by}</strong></>
                            )}
                            {t.received_by && (
                              <> · {lang==='es'?'recibida por':'received by'} <strong>{t.received_by}</strong></>
                            )}
                          </div>
                          <div className="flex ai-center gap-2">
                            {/* ── State transitions (sólo si la row tiene _backend_id) ── */}
                            {t._backend_id && t.status === 'planned' && (
                              <button
                                className="btn btn-accent btn-sm"
                                disabled={transitioning === t._backend_id}
                                onClick={(e) => { e.stopPropagation(); transition(t, 'approve'); }}
                              >
                                <IconCheck size={12}/> {lang==='es'?'Aprobar':'Approve'}
                              </button>
                            )}
                            {t._backend_id && t.status === 'approved' && (
                              <button
                                className="btn btn-accent btn-sm"
                                disabled={transitioning === t._backend_id}
                                onClick={(e) => { e.stopPropagation(); transition(t, 'dispatch'); }}
                              >
                                <IconTruck size={12}/> {lang==='es'?'Despachar':'Dispatch'}
                              </button>
                            )}
                            {/* Rechazar: válido en PLANNED y APPROVED (catálogo
                                transfers.transicion_cat). Después de IN_TRANSIT
                                la mercancía ya está en flujo y no se cancela
                                con un click — requiere reverso operacional. */}
                            {t._backend_id && (t.status === 'planned' || t.status === 'approved') && (
                              <button
                                className="btn btn-danger-soft btn-sm"
                                disabled={transitioning === t._backend_id}
                                title={lang==='es'?'Cancelar la transferencia (no se puede deshacer)':'Cancel the transfer (cannot be undone)'}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const confirmMsg = lang==='es'
                                    ? `¿Rechazar transferencia ${t.id}? Esta acción es definitiva.`
                                    : `Reject transfer ${t.id}? This action is final.`;
                                  if (window.confirm(confirmMsg)) transition(t, 'cancel');
                                }}
                              >
                                <IconX size={12}/> {lang==='es'?'Rechazar':'Reject'}
                              </button>
                            )}
                            {t._backend_id && t.status === 'in_transit' && (
                              <button
                                className="btn btn-accent btn-sm"
                                disabled={transitioning === t._backend_id}
                                onClick={(e) => { e.stopPropagation(); transition(t, 'receive'); }}
                              >
                                <IconCheck size={12}/> {lang==='es'?'Marcar recibida':'Mark received'}
                              </button>
                            )}
                            {t._backend_id && t.status === 'received' && (
                              <button
                                className="btn btn-accent btn-sm"
                                disabled={transitioning === t._backend_id}
                                onClick={(e) => { e.stopPropagation(); transition(t, 'reconcile'); }}
                              >
                                <IconCheck size={12}/> {lang==='es'?'Reconciliar':'Reconcile'}
                              </button>
                            )}
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/transferencias/${t._backend_id || t.id}`);
                              }}
                            >
                              <IconEye size={12}/> {lang==='es'?'Ver detalle':'View detail'}
                            </button>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {rows.length === 0 && (
          <div className="trf-empty">
            <IconClipboard size={20} style={{ opacity:0.35 }}/>
            <div className="heading-sm">
              {lang==='es'?'Sin transferencias con esos filtros':'No transfers match these filters'}
            </div>
          </div>
        )}
      </div>

      {/* ── Drawer creación ── */}
      <AnimatePresence>
        {drawerOpen && (
          <CreateTransferDrawer
            lang={lang}
            onClose={() => setDrawer(false)}
            onSaved={() => reloadTransfers?.()}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Tile KPI ─────────────────────────
function KpiTile({ icon: Icon, color, label, value, sub, alert }) {
  return (
    <div className={`kpi-tile ${alert ? 'kpi-alert' : ''}`} style={{ '--kpi-color': color }}>
      <div className="kpi-icon-wrap" style={{ background: `${color}1a`, color }}>
        <Icon size={16}/>
      </div>
      <div className="kpi-body">
        <div className="kpi-label">{label}</div>
        <div className="kpi-value tabular-nums">{value}</div>
        <div className="kpi-sub micro">{sub}</div>
      </div>
    </div>
  );
}

// ── Chip de status ─────────────────────────
function StatusChip({ active, onClick, label, count, dotColor }) {
  return (
    <button
      className={`trf-chip ${active ? 'is-active' : ''}`}
      onClick={onClick}
      style={active ? { '--chip-color': dotColor } : undefined}
    >
      <span className="trf-chip-dot" style={{ background: dotColor }}/>
      {label}
      <span className="trf-chip-count">{count}</span>
    </button>
  );
}

// ── Badge del state machine ─────────────────────────
function StatusBadge({ status }) {
  const meta = TRANSFER_STATUS_META[status];
  if (!meta) return null;
  const label = (status === 'in_transit' ? 'IN-TRANSIT' : status).toUpperCase();
  return (
    <span
      className="trf-badge"
      style={{ color: meta.color, background: meta.soft, borderColor: `${meta.color}55` }}
    >
      <span className="trf-badge-dot" style={{ background: meta.color }}/>
      {label}
    </span>
  );
}
