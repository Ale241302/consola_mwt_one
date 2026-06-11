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
import { createPortal } from "react-dom";
import { useOutletContext, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  IconSwap, IconSearch, IconX, IconTruck, IconAlert, IconCheck,
  IconClipboard, IconChevDown, IconChevRight, IconFileText, IconEye,
  IconClock, IconTrash,
} from "../lib/icons.jsx";
import {
  TRANSFERS as MOCK_TRANSFERS, TRANSFER_STATUS_META, LEGAL_CONTEXT_META, getTransferTotals,
} from "../data/mockData.js";
import CreateTransferDrawer from "../components/inventario/CreateTransferDrawer.jsx";
import { useTransfersData } from "../hooks/useTransfersData.js";
import { transferenciasApi } from "../lib/api.js";
import ConfirmModal from "../components/common/ConfirmModal.jsx";
import { useRole } from "../context/RoleContext.jsx";

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
  // Sprint 2026-05-26 (CEO) - fix timezone (ver TransferDetail.jsx).
  const isDateOnly = typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const d = new Date(isDateOnly ? `${s}T12:00:00` : s);
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

  // Sprint 2026-05-14 · Fase 11 — lazy-fetch del detalle al expandir un
  // row. El list serializer sólo trae agregados (lines_count, totales);
  // para mostrar SKU/producto/talla/expediente necesitamos el detalle
  // completo (mismo endpoint retrieve() que enriquece expediente_codigo).
  // Cache por id de transferencia.
  const [linesByTrfId, setLinesByTrfId] = useState({});   // { be_id: [lineas] }
  const [linesLoading, setLinesLoading] = useState(null); // be_id en curso

  // Sprint 2026-05-14 · Fase 12 — bulk selección + delete + cancel modal.
  //   - selected = Set<backendId>
  //   - confirm = { type: 'cancel'|'delete'|'bulk-delete', target?, ids? }
  // Solo admin/CEO ve el trash + bulk delete. La protección dura está en
  // el backend (POL_VISIBILIDAD) pero ocultamos en UI para no confundir.
  const { isAdmin, isClient } = useRole();
  const canDelete = isAdmin && !isClient;
  const [selected, setSelected]   = useState(new Set());
  const [confirm, setConfirm]     = useState(null);
  const [busy, setBusy]           = useState(false);
  const [bulkError, setBulkError] = useState(null);

  // ── Backend data (fallback a mock si aún no hay data real) ────
  const { transfers: apiTransfers, kpis: apiKpis, loading: loadingBackend, reload: reloadTransfers } = useTransfersData();
  const TRANSFERS = useMemo(() => {
    if (!loadingBackend && Array.isArray(apiTransfers) && apiTransfers.length > 0) {
      return apiTransfers.map(mapApiTransferToRow);
    }
    // Sprint 2026-05-24 · CEO: apagar fallback a mock (DB ya tiene data real o se quiere ver el estado vacio).
    return [];
  }, [apiTransfers, loadingBackend]);

  // ── KPIs ───────────
  const kpis = useMemo(() => {
    // Si el backend ya devolvió KPIs oficiales, usarlos (las "unidades en tránsito"
    // no están disponibles server-side todavía — se derivan del listado).
    if (apiKpis) {
      let unitsInTransit = 0;
      for (const t of TRANSFERS) {
        if (t.status === 'in_transit') {
          // Fable5 · guard: getTransferTotals puede devolver undefined/parcial.
          const tot = getTransferTotals(t);
          unitsInTransit += (tot?.units_total ?? 0);
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
      // Fable5 · guard: mismos accesos blindados que en la rama con apiKpis.
      const tot = getTransferTotals(t);
      if (t.status === 'in_transit') {
        activeCount += 1;
        unitsInTransit += (tot?.units_total ?? 0);
      }
      if (t.status === 'planned' && t.needs_approval) pendingApproval += 1;
      if (t.status === 'received' && (tot?.has_discrepancy ?? false)) pendingReconcile += 1;
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

  // ── Sprint 2026-05-14 · Fase 12 — Selección + Delete ──────────
  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const allSelectableIds = useMemo(
    () => rows.filter((t) => t._backend_id).map((t) => t._backend_id),
    [rows],
  );
  const allChecked = allSelectableIds.length > 0
    && allSelectableIds.every((id) => selected.has(id));
  const someChecked = !allChecked && allSelectableIds.some((id) => selected.has(id));
  const toggleSelectAll = () => {
    setSelected(allChecked ? new Set() : new Set(allSelectableIds));
  };

  // Confirma · ejecuta la acción según confirm.type.
  const doConfirm = async () => {
    if (!confirm) return;
    setBusy(true); setBulkError(null);
    try {
      if (confirm.type === 'cancel' && confirm.target?._backend_id) {
        await transferenciasApi.action('cancel', confirm.target._backend_id, {});
      } else if (confirm.type === 'delete' && confirm.target?._backend_id) {
        await transferenciasApi.remove(confirm.target._backend_id);
      } else if (confirm.type === 'bulk-delete' && Array.isArray(confirm.ids)) {
        // Borrado secuencial — el endpoint hace soft-delete (is_active=FALSE)
        // así que es idempotente. Si una falla, paramos y mostramos error
        // con los que ya se borraron.
        for (const id of confirm.ids) {
          await transferenciasApi.remove(id);
        }
        setSelected(new Set());
      }
      await reloadTransfers?.();
      setConfirm(null);
    } catch (e) {
      setBulkError(e?.message || (lang==='es'?'Error':'Error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      {/* ── Header ── */}
      <div className="page-header">
        <div>
          <div className="micro" style={{marginBottom:6}}>
            {lang==='es'?'SUPPLY CHAIN · TRANSFERENCIAS':'SUPPLY CHAIN · TRANSFERS'}
          </div>
          <h1 className="page-title">{lang==='es'?'Movimientos':'Transfers'}</h1>
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
            <IconSwap size={14}/> {lang==='es'?'Nuevo movimiento':'New transfer'}
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
          sub={`${kpis.activeCount} ${lang==='es'?'movimientos activas':'active transfers'}`}
        />
        <KpiTile
          icon={IconSwap}
          color="#3083FE"
          label={lang==='es'?'Movimientos activas':'Active transfers'}
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

      {/* Sprint 2026-05-14 · Fase 12 — barra bulk-delete cuando hay seleccionados. */}
      {canDelete && selected.size > 0 && (
        <div className="card" style={{
          marginTop: 16, padding: '10px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'color-mix(in srgb, var(--brand-navy, #0B1E3A) 4%, #fff)',
          border: '1.5px solid var(--brand-accent, #0E8A6D)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="micro" style={{ fontWeight: 700, color: 'var(--brand-primary)' }}>
              {selected.size} {lang==='es'
                ? (selected.size === 1 ? 'seleccionada' : 'seleccionadas')
                : (selected.size === 1 ? 'selected' : 'selected')}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>
              {lang==='es'?'Limpiar':'Clear'}
            </button>
          </div>
          <button className="btn btn-sm" style={{
            background: '#DC2626', color: '#fff', border: '1px solid #DC2626',
          }}
            onClick={() => setConfirm({ type: 'bulk-delete', ids: Array.from(selected) })}>
            <IconTrash size={12}/> {lang==='es'?'Eliminar seleccionadas':'Delete selected'}
          </button>
        </div>
      )}

      {/* ── Trazabilidad ── */}
      <div className="card trf-table-card" style={{ marginTop:16 }}>
        <div className="trf-table-head">
          {/* Sprint 2026-05-14 · Fase 12 — checkbox select-all */}
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            {canDelete && (
              <input type="checkbox"
                     checked={allChecked}
                     ref={(el) => { if (el) el.indeterminate = someChecked; }}
                     onChange={toggleSelectAll}
                     title={lang==='es'?'Seleccionar todo':'Select all'}/>
            )}
          </div>
          <div className="trf-col-id">{lang==='es'?'ID':'ID'}</div>
          <div className="trf-col-date">{lang==='es'?'Fecha':'Date'}</div>
          <div className="trf-col-route">{lang==='es'?'Ruta':'Route'}</div>
          <div className="trf-col-legal">{lang==='es'?'Contexto':'Context'}</div>
          <div className="trf-col-units tabular-nums">{lang==='es'?'Unidades':'Units'}</div>
          <div className="trf-col-value tabular-nums">{lang==='es'?'Valor':'Value'}</div>
          <div className="trf-col-status">{lang==='es'?'Estado':'Status'}</div>
          <div/>{/* slot trash */}
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
                  onClick={() => {
                    const nextId = isExp ? null : t.id;
                    setExpanded(nextId);
                    // Sprint 2026-05-14 · Fase 11 — lazy-fetch detalle.
                    if (nextId && t._backend_id && !linesByTrfId[t._backend_id]
                        && linesLoading !== t._backend_id) {
                      setLinesLoading(t._backend_id);
                      transferenciasApi.get(t._backend_id)
                        .then((full) => {
                          const arr = Array.isArray(full?.lineas) ? full.lineas : [];
                          setLinesByTrfId((p) => ({ ...p, [t._backend_id]: arr }));
                        })
                        .catch(() => {
                          setLinesByTrfId((p) => ({ ...p, [t._backend_id]: [] }));
                        })
                        .finally(() => setLinesLoading(null));
                    }
                  }}
                >
                  {/* Sprint 2026-05-14 · Fase 12 — checkbox por fila. */}
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    {canDelete && t._backend_id && (
                      <input type="checkbox"
                             checked={selected.has(t._backend_id)}
                             onClick={(e) => e.stopPropagation()}
                             onChange={(e) => { e.stopPropagation(); toggleSelect(t._backend_id); }}/>
                    )}
                  </div>
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
                    {/* Sprint 2026-05-14 · Fase 12 — chip pintado desde
                        TRANSFER_STATUS_META (ahora incluye 'cancelled' en rojo). */}
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '3px 10px', borderRadius: 999,
                      fontSize: 11, fontWeight: 700, letterSpacing: 0.3,
                      textTransform: 'uppercase',
                      background: meta?.soft || 'rgba(107,114,128,0.12)',
                      color: meta?.color || '#6B7280',
                      border: `1px solid ${meta?.color || '#6B7280'}33`,
                    }}>
                      <span style={{
                        width: 6, height: 6, borderRadius: 99,
                        background: meta?.color || '#6B7280',
                      }}/>
                      {meta?.label || t.status}
                    </span>
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
                  {/* Sprint 2026-05-14 · Fase 12 — trash solo en cancelled/reconciled (admin). */}
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    {canDelete && t._backend_id
                       && (t.status === 'cancelled' || t.status === 'reconciled') && (
                      <button type="button"
                              className="icon-btn"
                              title={lang==='es'?'Eliminar registro':'Delete record'}
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirm({ type: 'delete', target: t });
                              }}
                              style={{
                                width: 26, height: 26,
                                color: '#DC2626',
                                background: 'transparent',
                                border: 'none', cursor: 'pointer',
                                borderRadius: 6,
                              }}>
                        <IconTrash size={13}/>
                      </button>
                    )}
                  </div>
                  <div className="trf-col-caret">
                    {/* Sprint 2026-06-10 — la flecha navega al detalle del
                        movimiento; expandir/colapsar sigue siendo el click
                        en la fila. (span: no se puede anidar button en
                        button — la fila ya es un <button>.) */}
                    <span
                      role="link"
                      tabIndex={0}
                      title={lang==='es'?'Ver detalle del movimiento':'Open transfer detail'}
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/transferencias/${t._backend_id || t.id}`);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.stopPropagation();
                          navigate(`/transferencias/${t._backend_id || t.id}`);
                        }
                      }}
                      style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: 26, height: 26, borderRadius: 6, cursor: 'pointer',
                        color: 'var(--brand-primary, #0B1E3A)',
                      }}
                    >
                      <IconChevRight size={14}/>
                    </span>
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
                          {/* Sprint 2026-05-14 · Fase 11 — usamos las
                              lineas reales del backend (lazy-fetched al
                              expandir) en vez del stub agregado. Cada
                              fila trae expediente_codigo, sku, product_label
                              (o product), size, qty_transfer, qty_received. */}
                          {(() => {
                            const realLines = (t._backend_id && linesByTrfId[t._backend_id]) || null;
                            const isLoading = linesLoading === t._backend_id;
                            if (isLoading) {
                              return (
                                <div className="caption" style={{ color: 'var(--text-tertiary)', padding: '10px 0' }}>
                                  {lang==='es'?'Cargando líneas…':'Loading lines…'}
                                </div>
                              );
                            }
                            const lines = realLines || t.lines || [];
                            if (lines.length === 0) {
                              return (
                                <div className="caption" style={{ color: 'var(--text-tertiary)', padding: '10px 0' }}>
                                  {lang==='es'?'Sin líneas.':'No lines.'}
                                </div>
                              );
                            }
                            return (
                              <div className="trf-exp-lines">
                                {lines.map((ln, i) => {
                                  const qtyT = Number(ln.qty_transfer || 0);
                                  const qtyR = Number(ln.qty_reserve  || 0);
                                  const qtyRecv = (ln.qty_received == null || ln.qty_received === '')
                                    ? null : Number(ln.qty_received);
                                  const hasDelta = qtyRecv != null && qtyRecv !== qtyT;
                                  const sku = ln.sku || '—';
                                  const productName = ln.product_label || ln.product || '—';
                                  const size = ln.size || '';
                                  return (
                                    <div key={i} className={`trf-exp-line ${hasDelta ? 'has-delta' : ''}`}>
                                      {/* Sprint 2026-05-14 · Fase 11.1 — densidad alta,
                                          producto + talla inline, expediente en mono compacto. */}
                                      {/* Sprint 2026-05-17 · muestra proforma con
                                          fallback al EXP code. CEO request: la
                                          referencia comercial relevante es la
                                          proforma; el EXP queda como backup. */}
                                      <div className="trf-exp-line-exp mono">
                                        {ln.proforma_codigo || ln.expediente_codigo || '—'}
                                      </div>
                                      <div className="trf-exp-line-sku mono">{sku}</div>
                                      <div className="trf-exp-line-name" title={productName}>
                                        <span style={{
                                          overflow: 'hidden',
                                          textOverflow: 'ellipsis',
                                          whiteSpace: 'nowrap',
                                          minWidth: 0,
                                        }}>{productName}</span>
                                        {size && <span className="size-chip">{size}</span>}
                                      </div>
                                      <div className="trf-exp-line-qty tabular-nums">
                                        <span className="trf-exp-lbl micro">
                                          {lang==='es'?'Transf.':'Transf.'}
                                        </span>
                                        {fmtInt(qtyT)}
                                      </div>
                                      {qtyR > 0 ? (
                                        <div className="trf-exp-line-qty tabular-nums reserve">
                                          <span className="trf-exp-lbl micro">
                                            {lang==='es'?'Resv.':'Resv.'}
                                          </span>
                                          {fmtInt(qtyR)}
                                        </div>
                                      ) : <div/>}
                                      {qtyRecv != null ? (
                                        <div className={`trf-exp-line-qty tabular-nums received ${hasDelta ? 'err' : ''}`}>
                                          <span className="trf-exp-lbl micro">
                                            {lang==='es'?'Recib.':'Recv.'}
                                          </span>
                                          {fmtInt(qtyRecv)}
                                          {hasDelta && (
                                            <span className="trf-exp-delta">
                                              Δ {qtyRecv - qtyT}
                                            </span>
                                          )}
                                        </div>
                                      ) : <div/>}
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })()}
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
                                title={lang==='es'?'Cancelar el movimiento (devuelve el inventario al origen)':'Cancel the transfer (returns stock to origin)'}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  // Sprint 2026-05-14 · Fase 12 — modal en vez de alert.
                                  setConfirm({ type: 'cancel', target: t });
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
              {lang==='es'?'Sin movimientos con esos filtros':'No transfers match these filters'}
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

      {/* Sprint 2026-05-14 · Fase 12 — ConfirmModal en portal para
          cancel / delete / bulk-delete. Reemplaza window.confirm. */}
      {confirm && createPortal(
        <ConfirmModal
          eyebrow={
            confirm.type === 'cancel'
              ? (lang==='es'?'CANCELAR TRANSFERENCIA':'CANCEL TRANSFER')
              : (lang==='es'?'ACCIÓN DESTRUCTIVA':'DESTRUCTIVE ACTION')
          }
          title={
            confirm.type === 'cancel'
              ? (lang==='es'
                  ? `¿Cancelar ${confirm.target?.id || ''}?`
                  : `Cancel ${confirm.target?.id || ''}?`)
              : confirm.type === 'bulk-delete'
                ? (lang==='es'
                    ? `¿Eliminar ${confirm.ids?.length || 0} movimientos?`
                    : `Delete ${confirm.ids?.length || 0} transfers?`)
                : (lang==='es'
                    ? `¿Eliminar ${confirm.target?.id || ''}?`
                    : `Delete ${confirm.target?.id || ''}?`)
          }
          body={
            confirm.type === 'cancel' ? (
              <>{lang==='es'
                ? <>Esta acción es definitiva. El inventario asociado <strong>vuelve al nodo origen</strong> automáticamente.</>
                : <>This action is final. Associated inventory <strong>returns to origin node</strong> automatically.</>}
              </>
            ) : (
              <>{lang==='es'
                ? <>El registro se marcará como inactivo (soft-delete). No se puede deshacer desde la UI.</>
                : <>The record will be soft-deleted. Cannot be undone from the UI.</>}
              </>
            )
          }
          actionLabel={
            confirm.type === 'cancel'
              ? (lang==='es'?'Sí, cancelar':'Yes, cancel')
              : (lang==='es'?'Sí, eliminar':'Yes, delete')
          }
          actionColor={confirm.type === 'cancel' ? '#B45309' : '#DC2626'}
          cancelLabel={lang==='es'?'Cancelar':'Cancel'}
          busy={busy}
          error={bulkError}
          onCancel={() => { if (!busy) { setConfirm(null); setBulkError(null); } }}
          onConfirm={doConfirm}
        />, document.body)}
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
