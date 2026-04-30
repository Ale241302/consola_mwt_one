// ─────────────────────────────────────────────────────────────
// TransferReconciliationView — Detalle de transferencia
// Agente responsable: [AG-FRONTEND]
//
// Fuente de datos:
//   - Si el id de la URL es UUID → GET /api/transferencias/{id}/
//     (payload extendido con `lineas` y `eventos`).
//   - Si no, fallback al mock local para demos sin backend.
//
// Acciones disponibles según estado:
//   - PLANNED    → Aprobar        (POST /approve/)
//   - APPROVED   → Despachar      (POST /dispatch/)
//   - IN_TRANSIT → Recibir        (POST /receive/)
//   - RECEIVED   → Reconciliar    (POST /reconcile/)
//
// La tabla de recepción edita `qty_received` por línea y, al confirmar,
// marca la transferencia como RECEIVED (+ Reconciled si no hubo delta).
// Si hay delta, ofrece el botón "Marcar reconciliada" al final.
// ─────────────────────────────────────────────────────────────
import React, { useMemo, useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, useOutletContext } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  IconChevLeft, IconCheck, IconAlert, IconTruck, IconPackage,
  IconFileText, IconClock, IconSwap, IconClipboard, IconHistory,
} from "../lib/icons.jsx";
import {
  TRANSFERS, TRANSFER_STATUS_META, LEGAL_CONTEXT_META, getTransferTotals,
} from "../data/mockData.js";
import { transferenciasApi, transferLineasApi } from "../lib/api.js";
import TransferLiquidationPanel from "../components/transfers/TransferLiquidationPanel.jsx";
import TransferStateStepper from "../components/transfers/TransferStateStepper.jsx";
import TransferInvoicePrintView from "../components/transfers/TransferInvoicePrintView.jsx";
// Sprint 2026-04-30 — paneles editables para costos (con OCR auto-merge)
// y notas (ledger JSONB).
import TransferCostsPanel  from "../components/transfers/TransferCostsPanel.jsx";
import TransferNotesPanel  from "../components/transfers/TransferNotesPanel.jsx";

// ── Helpers format ─────────────────────────
function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString('es-PE', { day:'2-digit', month:'short', year:'numeric' });
}
function fmtDateTime(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString('es-PE', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
}
function fmtInt(n) { return (n ?? 0).toLocaleString('en-US'); }
function fmtUsd(n) { return '$' + (n ?? 0).toLocaleString('en-US'); }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Backend ESTADO (UPPERCASE) → status lowercase del mock-shape
const API_TO_MOCK_STATUS = {
  PLANNED:    'planned',
  APPROVED:   'approved',
  IN_TRANSIT: 'in_transit',
  RECEIVED:   'received',
  RECONCILED: 'reconciled',
  CANCELLED:  'cancelled',
};

// Normaliza un payload backend (Transferencia + lineas + eventos) al shape
// que la UI ya sabe renderizar.
function mapApiDetailToTransfer(r) {
  const lineas = Array.isArray(r?.lineas) ? r.lineas : [];
  return {
    _backend_id:    r.id,
    id:             r.codigo || r.id,
    status:         API_TO_MOCK_STATUS[r.estado] || 'planned',
    origen:         r.origen_label || '—',
    destino:        r.destino_label || '—',
    legal_context:  r.legal_context || 'INTERNAL',
    ref_tracking:   r.ref_tracking || '',
    context_data:   r.context_data || {},
    cost_lines:     Array.isArray(r.cost_lines) ? r.cost_lines : [],
    total_cost_usd: Number(r.total_cost_usd || 0),
    needs_approval: !!r.needs_approval,
    value_usd:      Number(r.value_usd || 0),
    created_at:     r.created_at || r.updated_at || null,
    dispatched_at:  r.dispatched_at || null,
    eta:            r.eta || null,
    received_at:    r.received_at || null,
    created_by:     r.created_by_name || '',
    approved_by:    r.approved_by_name || '',
    received_by:    r.received_by_name || '',
    notes:          r.notes || '',
    notes_log:      Array.isArray(r.notes_log) ? r.notes_log : [],
    lines: lineas.map(l => ({
      _line_id:        l.id,
      sku:             l.sku || '',
      product:         l.product_label || l.product || '',
      lot:             l.lot || '',
      qty_transfer:    Number(l.qty_transfer || 0),
      qty_reserve:     Number(l.qty_reserve  || 0),
      qty_received:    l.qty_received != null ? Number(l.qty_received) : null,
    })),
    eventos: Array.isArray(r?.eventos) ? r.eventos : [],
  };
}

export default function ScreenTransferDetail() {
  const { lang } = useOutletContext();
  const { transferId } = useParams();
  const navigate = useNavigate();

  const [backend, setBackend]       = useState(null); // transfer from backend (null until fetched)
  const [loadingBe, setLoadingBe]   = useState(false);
  const [loadError, setLoadError]   = useState(null);
  const [saving, setSaving]         = useState(false);
  const [advancing, setAdvancing]   = useState(false);
  const [advanceErr, setAdvanceErr] = useState(null);
  const [printingPayload, setPrintingPayload] = useState(null);
  const [loadingPdf, setLoadingPdf] = useState(false);

  const isUuid = typeof transferId === "string" && UUID_RE.test(transferId);

  // ── Cargar desde backend si es UUID; si no, fallback mock ──
  const loadBackend = useCallback(async () => {
    if (!isUuid) return;
    setLoadingBe(true);
    setLoadError(null);
    try {
      const r = await transferenciasApi.get(transferId);
      setBackend(mapApiDetailToTransfer(r));
    } catch (e) {
      console.error("No se pudo cargar transferencia:", e);
      setLoadError(e?.message || String(e));
    } finally {
      setLoadingBe(false);
    }
  }, [isUuid, transferId]);

  useEffect(() => { loadBackend(); }, [loadBackend]);

  // Sprint v4 — avanzar estado y abrir PDF
  const handleAdvance = useCallback(async () => {
    if (!isUuid || advancing) return;
    setAdvancing(true); setAdvanceErr(null);
    try {
      await transferenciasApi.action("advance", transferId, {});
      await loadBackend();
    } catch (e) {
      setAdvanceErr(e?.body?.detail || e?.message || "advance_failed");
    } finally {
      setAdvancing(false);
    }
  }, [isUuid, advancing, transferId, loadBackend]);

  const handleOpenPrint = useCallback(async () => {
    if (!isUuid) return;
    setLoadingPdf(true);
    try {
      const payload = await transferenciasApi.action("invoice_payload", transferId);
      setPrintingPayload(payload);
    } catch (e) {
      alert(e?.message || "No se pudo generar el documento.");
    } finally {
      setLoadingPdf(false);
    }
  }, [isUuid, transferId]);

  // Resuelve base del dato: backend > mock
  const transferBase = useMemo(() => {
    if (backend) return backend;
    return TRANSFERS.find(t => t.id === transferId) || null;
  }, [backend, transferId]);

  // Estado local para recepción (no persiste, solo sesión)
  const [status, setStatus] = useState('planned');
  const [lines,  setLines]  = useState([]);
  const [confirmed, setConfirmed] = useState(false);

  // Rehidratar cuando transferBase cambia (por ejemplo después del fetch)
  useEffect(() => {
    if (!transferBase) return;
    setStatus(transferBase.status || 'planned');
    setLines((transferBase.lines || []).map(l => ({
      ...l,
      qty_received: l.qty_received ?? '',
    })));
    setConfirmed(transferBase.status === 'received' || transferBase.status === 'reconciled');
  }, [transferBase]);

  // ── Reconciliation math ─────
  // ⚠️ Este useMemo TIENE que estar ANTES de los early returns. Si se
  // declara después, React error #310 (hooks count cambia entre el render
  // de "loading" y el de "ready") → pantalla en blanco.
  const reco = useMemo(() => {
    let totalTransfer = 0;
    let totalReceived = 0;
    let missingInput  = 0;
    let deltaLines    = 0;
    const lineMeta = (lines || []).map(l => {
      const transfer = Number(l.qty_transfer || 0);
      const received = l.qty_received === '' ? null : Number(l.qty_received);
      totalTransfer += transfer;
      if (received == null) {
        missingInput += 1;
        return { ...l, received, delta:0, has_delta:false, pending:true };
      }
      totalReceived += received;
      const delta = received - transfer;
      const has_delta = delta !== 0;
      if (has_delta) deltaLines += 1;
      return { ...l, received, delta, has_delta, pending:false };
    });
    return { totalTransfer, totalReceived, missingInput, deltaLines, lineMeta };
  }, [lines]);

  // ── Early states ──
  if (isUuid && loadingBe && !transferBase) {
    return (
      <div className="page">
        <div className="card card-pad-lg empty">
          <IconClock size={24} style={{ color:'var(--brand-accent)' }}/>
          <div className="heading-md">
            {lang==='es'?'Cargando transferencia…':'Loading transfer…'}
          </div>
        </div>
      </div>
    );
  }
  if (!transferBase) {
    return (
      <div className="page">
        <div className="card card-pad-lg empty">
          <IconClipboard size={24} style={{ color:'var(--brand-accent)' }}/>
          <div className="heading-md">
            {lang==='es'?'Transferencia no encontrada':'Transfer not found'}
          </div>
          {loadError && (
            <div className="body-sm text-sec">{loadError}</div>
          )}
          <button className="btn btn-ghost" onClick={() => navigate('/transferencias')}>
            <IconChevLeft size={12}/> {lang==='es'?'Volver':'Back'}
          </button>
        </div>
      </div>
    );
  }

  const lmeta    = LEGAL_CONTEXT_META[transferBase.legal_context] || { label: transferBase.legal_context, color:'#64748B' };
  const smeta    = TRANSFER_STATUS_META[status] || TRANSFER_STATUS_META.planned;
  const totBase  = getTransferTotals(transferBase);

  const isActionable = status === 'in_transit' || (status === 'received' && !confirmed);
  const canConfirm   = reco.missingInput === 0 && isActionable;
  const willNeedReconcile = reco.deltaLines > 0;

  function updateReceived(idx, value) {
    setLines(prev => prev.map((l,i) => i === idx ? { ...l, qty_received: value } : l));
  }
  function autofillPerfect() {
    setLines(prev => prev.map(l => ({ ...l, qty_received: l.qty_transfer })));
  }

  // ── Persist backend transitions ─────────────
  async function callTransition(actionName) {
    if (!transferBase._backend_id) return; // mock-only transfer
    setSaving(true);
    try {
      await transferenciasApi.action(actionName, transferBase._backend_id, {});
      await loadBackend();
    } catch (e) {
      console.error(`transition(${actionName}) falló:`, e);
      alert(`${lang==='es'?'Error':'Error'}: ${e?.message || e}`);
    } finally {
      setSaving(false);
    }
  }

  // Persist qty_received por línea (PATCH /transfer-lineas/{id}/)
  async function persistReceivedQuantities() {
    if (!transferBase._backend_id) return;
    for (const ln of reco.lineMeta) {
      if (!ln._line_id || ln.received == null) continue;
      try {
        await transferLineasApi.update(ln._line_id, { qty_received: ln.received });
      } catch (e) {
        console.warn("No se pudo persistir qty_received de", ln.sku, e);
      }
    }
  }

  async function confirmReception() {
    if (!canConfirm) return;
    setStatus('received');
    setConfirmed(true);
    await persistReceivedQuantities();
    await callTransition('receive');
  }
  async function markReconciled() {
    setStatus('reconciled');
    await callTransition('reconcile');
  }
  async function approveNow()  { await callTransition('approve');  }
  async function dispatchNow() { await callTransition('dispatch'); }

  return (
    <div className="page">
      {/* ── Header ── */}
      <div className="page-header">
        <div>
          <button className="link-back" onClick={() => navigate('/transferencias')}>
            <IconChevLeft size={12}/> {lang==='es'?'Volver a Transferencias':'Back to Transfers'}
          </button>
          <div className="micro" style={{marginTop:8, marginBottom:6}}>
            {lang==='es'?'TRANSFERENCIA INTER-NODOS':'INTER-NODE TRANSFER'}
          </div>
          <div className="flex ai-center gap-2">
            <h1 className="page-title mono" style={{ margin:0 }}>{transferBase.id}</h1>
            <span
              className="trf-badge"
              style={{ color: smeta.color, background: smeta.soft, borderColor: `${smeta.color}55` }}
            >
              <span className="trf-badge-dot" style={{ background: smeta.color }}/>
              {(status === 'in_transit' ? 'IN-TRANSIT' : status).toUpperCase()}
            </span>
          </div>
          <div className="trf-detail-route">
            <span className="trf-detail-node">{transferBase.origen}</span>
            <span className="trf-detail-arrow">→</span>
            <span className="trf-detail-node">{transferBase.destino}</span>
            <span
              className="trf-legal-pill"
              style={{ '--legal-color': lmeta.color }}
            >
              <span className="trf-legal-dot"/>
              {lmeta.label}
            </span>
          </div>
        </div>
        <div className="flex ai-center gap-2">
          {status === 'planned' && transferBase._backend_id && (
            <button className="btn btn-accent" disabled={saving} onClick={approveNow}>
              <IconCheck size={12}/> {lang==='es'?'Aprobar':'Approve'}
            </button>
          )}
          {status === 'approved' && transferBase._backend_id && (
            <button className="btn btn-accent" disabled={saving} onClick={dispatchNow}>
              <IconTruck size={12}/> {lang==='es'?'Despachar':'Dispatch'}
            </button>
          )}
          {status === 'received' && willNeedReconcile && (
            <button className="btn btn-warn" disabled={saving} onClick={markReconciled}>
              <IconCheck size={12}/> {lang==='es'?'Marcar reconciliada':'Mark reconciled'}
            </button>
          )}
          {status === 'received' && !willNeedReconcile && confirmed && (
            <button className="btn btn-accent" disabled={saving} onClick={markReconciled}>
              <IconCheck size={12}/> {lang==='es'?'Cerrar transferencia':'Close transfer'}
            </button>
          )}
        </div>
      </div>

      {/* ── Info cards ── */}
      <motion.div
        className="trf-info-grid"
        initial={{ opacity:0, y:8 }}
        animate={{ opacity:1, y:0 }}
        transition={{ duration:0.3, ease:'easeOut' }}
      >
        <InfoCard
          icon={IconClock}
          color="#3083FE"
          label={lang==='es'?'Creada':'Created'}
          value={fmtDate(transferBase.created_at)}
          sub={`${lang==='es'?'por':'by'} ${transferBase.created_by || '—'}`}
        />
        <InfoCard
          icon={IconTruck}
          color="#B45309"
          label={lang==='es'?'Despachada':'Dispatched'}
          value={fmtDate(transferBase.dispatched_at)}
          sub={transferBase.ref_tracking || (lang==='es'?'Sin tracking':'No tracking')}
        />
        <InfoCard
          icon={IconPackage}
          color="#00B286"
          label={lang==='es'?'ETA':'ETA'}
          value={fmtDate(transferBase.eta)}
          sub={transferBase.received_at
            ? `${lang==='es'?'Recibida':'Received'} ${fmtDate(transferBase.received_at)}`
            : (lang==='es'?'En ruta':'In route')}
        />
        <InfoCard
          icon={IconFileText}
          color="#481EE3"
          label={lang==='es'?'Valor estimado':'Estimated value'}
          value={fmtUsd(transferBase.value_usd)}
          sub={`${totBase.lines_count} SKU · ${fmtInt(totBase.units_total)} ${lang==='es'?'u.':'u.'}`}
        />
      </motion.div>

      {/* ── Stepper de ciclo de vida (sprint v4) ── */}
      <TransferStateStepper
        currentStatus={transferBase.status}
        hasDiscrepancy={!!transferBase._raw?.has_discrepancy}
        onAdvance={handleAdvance}
        busy={advancing}
        lang={lang}
        canAdvance={transferBase.status !== 'cancelled' && transferBase.status !== 'closed'}
        blockReason={advanceErr}
      />

      {/* ── Botón generar PDF / Imprimir ── */}
      <div style={{ marginBottom: 14, display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={handleOpenPrint}
          disabled={loadingPdf || !isUuid}
          style={{ fontWeight: 600 }}>
          {loadingPdf
            ? (lang === 'es' ? 'Generando…' : 'Generating…')
            : (lang === 'es' ? '📄 Generar Factura / Remisión PDF' : '📄 Generate Invoice / Waybill PDF')}
        </button>
      </div>

      {/* ── Metadata por motivo legal (sprint Transfer Engine v2) ── */}
      {/* Pasamos costLines=[] para que la vieja sección de costos NO se
          renderice — ahora la maneja TransferCostsPanel editable. */}
      <LegalContextDataCard lang={lang}
                            legalContext={transferBase.legal_context}
                            contextData={transferBase.context_data}
                            costLines={[]}
                            totalCostUsd={0}/>

      {/* ── Costos editables + OCR auto-merge (sprint 2026-04-30) ── */}
      {isUuid && (
        <TransferCostsPanel
          lang={lang}
          transferId={transferBase._backend_id}
          costLines={transferBase.cost_lines}
          totalCostUsd={transferBase.total_cost_usd}
          onChanged={loadBackend}
        />
      )}

      {/* ── Liquidación / Landed Cost (sprint Transfer Engine v3) ── */}
      <TransferLiquidationPanel transfer={transferBase} lang={lang} onLiquidated={loadBackend}/>

      {/* ── Reconciliación banner ── */}
      {status === 'received' && willNeedReconcile && (
        <motion.div
          className="trf-reco-banner"
          initial={{ opacity:0, y:6 }}
          animate={{ opacity:1, y:0 }}
          transition={{ duration:0.25 }}
        >
          <div className="trf-reco-banner-icon">
            <IconAlert size={16}/>
          </div>
          <div className="trf-reco-banner-body">
            <div className="heading-sm">
              {lang==='es'?'Requiere reconciliación':'Requires reconciliation'}
            </div>
            <div className="body-sm text-sec">
              {lang==='es'
                ? `${reco.deltaLines} línea(s) con diferencia entre lo transferido y lo recibido. Ajusta con el operador origen antes de cerrar.`
                : `${reco.deltaLines} line(s) with variance between transferred and received. Reconcile with origin operator before closing.`}
            </div>
          </div>
        </motion.div>
      )}

      {/* ── Reception table ── */}
      <div className="card trf-reco-card" style={{ marginTop:16 }}>
        <div className="trf-reco-head">
          <div className="heading-sm">
            {lang==='es'?'Recepción en destino':'Reception at destination'}
          </div>
          {isActionable && (
            <button className="btn btn-ghost btn-sm" onClick={autofillPerfect}>
              <IconCheck size={12}/> {lang==='es'?'Recibir todo sin diferencia':'Receive all without variance'}
            </button>
          )}
        </div>

        <div className="trf-reco-table">
          <div className="trf-reco-thead">
            <div>SKU</div>
            <div>{lang==='es'?'Producto':'Product'}</div>
            <div className="ar">{lang==='es'?'Transferido':'Transferred'}</div>
            <div className="ar">{lang==='es'?'Reservado':'Reserved'}</div>
            <div className="ar">{lang==='es'?'Recibido':'Received'}</div>
            <div className="ar">Δ</div>
          </div>
          <div className="trf-reco-tbody">
            {reco.lineMeta.map((ln, idx) => (
              <div
                key={idx}
                className={`trf-reco-row ${ln.has_delta ? 'has-delta' : ''}`}
              >
                <div className="mono" style={{ fontSize:12 }}>{ln.sku}</div>
                <div>{ln.product}</div>
                <div className="ar tabular-nums">{fmtInt(ln.qty_transfer)}</div>
                <div className="ar tabular-nums text-sec">{fmtInt(ln.qty_reserve)}</div>
                <div className="ar">
                  {isActionable ? (
                    <input
                      type="number"
                      min={0}
                      className={`input input-sm tabular-nums ar ${ln.has_delta ? 'is-err' : ''}`}
                      value={ln.qty_received === null ? '' : ln.qty_received}
                      onChange={(e) => updateReceived(idx, e.target.value)}
                      placeholder="—"
                      style={{ width:110, textAlign:'right' }}
                    />
                  ) : (
                    <span className="tabular-nums">{ln.received == null ? '—' : fmtInt(ln.received)}</span>
                  )}
                </div>
                <div className={`ar tabular-nums trf-reco-delta ${ln.has_delta ? 'has-delta' : ''}`}>
                  {ln.received == null ? '—' : (ln.delta > 0 ? `+${ln.delta}` : ln.delta)}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Totals / action bar ── */}
        <div className="trf-reco-foot">
          <div className="trf-reco-totals">
            <TotalBlock
              label={lang==='es'?'Total transferido':'Total transferred'}
              value={fmtInt(reco.totalTransfer)}
            />
            <TotalBlock
              label={lang==='es'?'Total recibido':'Total received'}
              value={fmtInt(reco.totalReceived)}
              valueClass={willNeedReconcile ? 'is-err' : ''}
            />
            <TotalBlock
              label={lang==='es'?'Δ neto':'Net variance'}
              value={(reco.totalReceived - reco.totalTransfer) > 0
                ? `+${reco.totalReceived - reco.totalTransfer}`
                : `${reco.totalReceived - reco.totalTransfer}`}
              valueClass={willNeedReconcile ? 'is-err' : 'is-ok'}
            />
            <TotalBlock
              label={lang==='es'?'Líneas con discrepancia':'Variant lines'}
              value={fmtInt(reco.deltaLines)}
              valueClass={reco.deltaLines > 0 ? 'is-err' : ''}
            />
          </div>
          {isActionable && (
            <button
              className={`btn ${willNeedReconcile ? 'btn-warn' : 'btn-accent'}`}
              disabled={!canConfirm || saving}
              onClick={confirmReception}
            >
              <IconCheck size={12}/>
              {willNeedReconcile
                ? (lang==='es'?'Confirmar con discrepancia':'Confirm with variance')
                : (lang==='es'?'Confirmar recepción':'Confirm reception')}
            </button>
          )}
        </div>
      </div>

      {/* ── Event timeline (audit trail backend) ── */}
      {Array.isArray(transferBase.eventos) && transferBase.eventos.length > 0 && (
        <div className="card card-pad-md" style={{ marginTop:16 }}>
          <div className="flex ai-center gap-2" style={{ marginBottom:10 }}>
            <IconHistory size={14} style={{ color:'var(--text-sec)' }}/>
            <div className="heading-sm" style={{ margin:0 }}>
              {lang==='es'?'Historial de cambios de estado':'State-change history'}
            </div>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {transferBase.eventos.map((ev, i) => (
              <div key={ev.id || i} className="flex ai-center gap-3" style={{ fontSize:13 }}>
                <span className="micro" style={{ minWidth:120 }}>{fmtDateTime(ev.created_at)}</span>
                <span className="mono" style={{ color:'var(--text-sec)' }}>
                  {ev.estado_prev || '—'} → <strong>{ev.estado_nuevo}</strong>
                </span>
                <span className="body-sm text-sec">
                  {ev.notes || ''}
                  {ev.actor_name && ` · ${ev.actor_name}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Notes ledger editable (sprint 2026-04-30) ── */}
      {isUuid && (
        <TransferNotesPanel
          lang={lang}
          transferId={transferBase._backend_id}
          initialNotes={transferBase.notes_log}
          legacyNote={transferBase.notes}
        />
      )}
      {/* ── Modal full-screen del Print View (sprint v4) ── */}
      {printingPayload && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: '#F8FAFC', overflowY: 'auto',
        }}>
          <TransferInvoicePrintView
            payload={printingPayload}
            lang={lang}
            onClose={() => setPrintingPayload(null)}
          />
        </div>
      )}
    </div>
  );
}

// ── InfoCard ─────────────────────────
function InfoCard({ icon: Icon, color, label, value, sub }) {
  return (
    <div className="trf-info-card" style={{ '--info-color': color }}>
      <div className="trf-info-icon" style={{ background: `${color}1a`, color }}>
        <Icon size={14}/>
      </div>
      <div className="trf-info-body">
        <div className="micro" style={{ marginBottom:4 }}>{label}</div>
        <div className="trf-info-value tabular-nums">{value}</div>
        <div className="trf-info-sub micro">{sub}</div>
      </div>
    </div>
  );
}

// ── TotalBlock ─────────────────────────
function TotalBlock({ label, value, valueClass }) {
  return (
    <div className="trf-total-block">
      <div className="micro" style={{ marginBottom:4 }}>{label}</div>
      <div className={`trf-total-value tabular-nums ${valueClass || ''}`}>{value}</div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────
// LegalContextDataCard — muestra los campos específicos del motivo
// (sprint Transfer Engine v2 · 2026-04-29)
// ─────────────────────────────────────────────────────────────
function LegalContextDataCard({ lang, legalContext, contextData, costLines, totalCostUsd }) {
  const cd = contextData || {};
  const ctx = (legalContext || "INTERNAL").toUpperCase();
  const lbl = (es, en) => lang === "es" ? es : en;
  const hasCosts = Array.isArray(costLines) && costLines.length > 0;
  const hasCtxFields = Object.values(cd || {}).some(v => v !== "" && v !== null && v !== undefined && v !== false);
  if (!hasCtxFields && !hasCosts && ctx === "INTERNAL") return null;

  const items = [];
  if (ctx === "INTERNAL") {
    if (cd.carrier_name)    items.push([lbl("Carrier", "Carrier"),                 cd.carrier_name]);
    if (cd.conductor_name)  items.push([lbl("Conductor", "Driver"),                cd.conductor_name]);
    if (cd.vehicle_plate)   items.push([lbl("Placa", "Plate"),                     <code className="mono-sm">{cd.vehicle_plate}</code>]);
    if (cd.vehicle_id)      items.push([lbl("ID vehículo", "Vehicle ID"),          <code className="mono-sm">{cd.vehicle_id}</code>]);
  } else if (ctx === "NATIONALIZATION") {
    if (cd.bl_awb_number)   items.push(["BL / AWB",                                <code className="mono-sm">{cd.bl_awb_number}</code>]);
    if (cd.dua_number)      items.push([lbl("Nº DUA", "DUA #"),                    <code className="mono-sm">{cd.dua_number}</code>]);
  } else if (ctx === "EXPORT") {
    if (cd.international_carrier) items.push([lbl("Carrier internac.", "Intl carrier"), cd.international_carrier]);
    if (cd.container_number)      items.push([lbl("Contenedor", "Container"),           <code className="mono-sm">{cd.container_number}</code>]);
    if (cd.awb_bl_number)         items.push(["BL / AWB",                                <code className="mono-sm">{cd.awb_bl_number}</code>]);
  } else if (ctx === "DISTRIBUTION") {
    const tp = Number(cd.transfer_pricing_amount || 0);
    if (tp > 0) items.push([
      lbl("Transfer Pricing", "Transfer Pricing"),
      <span style={{ fontWeight: 700, color: "#00B286" }} className="tabular-nums">
        ${tp.toLocaleString("en-US", { maximumFractionDigits: 2 })} {cd.transfer_pricing_currency || "USD"} · {cd.transfer_pricing_basis || "PER_UNIT"}
      </span>
    ]);
    if (cd.requires_tp_approval) items.push([
      lbl("Aprobación", "Approval"),
      <span style={{ padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: "#FEF3C7", color: "#92400E" }}>
        ⚠ {lbl("Requiere aprobación TP", "TP approval required")}
      </span>
    ]);
    if (cd.crosses_border) items.push([
      lbl("Cruza frontera", "Crosses border"),
      <span style={{ color: "#481EE3", fontWeight: 600 }}>{lbl("Sí · DUA requerido", "Yes · DUA required")}</span>
    ]);
    if (cd.awb_bl_number) items.push(["BL / AWB", <code className="mono-sm">{cd.awb_bl_number}</code>]);
  } else if (ctx === "CONSIGNMENT") {
    if (cd.report_frequency) items.push([lbl("Frecuencia reporte", "Report frequency"), cd.report_frequency]);
    if (cd.contract_ref)     items.push([lbl("Contrato", "Contract"),                   <code className="mono-sm">{cd.contract_ref}</code>]);
    if (cd.awb_bl_number)    items.push(["BL / AWB",                                     <code className="mono-sm">{cd.awb_bl_number}</code>]);
  }

  const colorByCtx = {
    INTERNAL:        "#64748B",
    NATIONALIZATION: "#481EE3",
    EXPORT:          "#3083FE",
    DISTRIBUTION:    "#00B286",
    CONSIGNMENT:     "#B45309",
  };
  const titleByCtx = {
    INTERNAL:        lbl("LOGÍSTICA INTERNA", "INTERNAL LOGISTICS"),
    NATIONALIZATION: lbl("DOCUMENTOS DE IMPORTACIÓN", "IMPORT DOCUMENTS"),
    EXPORT:          lbl("EXPORTACIÓN INTERNACIONAL", "INTERNATIONAL EXPORT"),
    DISTRIBUTION:    lbl("TRANSFER PRICING", "TRANSFER PRICING"),
    CONSIGNMENT:     lbl("CONSIGNACIÓN", "CONSIGNMENT"),
  };
  const accent = colorByCtx[ctx] || "#64748B";

  return (
    <div className="card card-pad-md" style={{
      marginTop: 16, borderLeft: `4px solid ${accent}`,
    }}>
      <div className="micro" style={{ color: accent, letterSpacing: 1, marginBottom: 10 }}>
        {titleByCtx[ctx] || ctx}
      </div>
      {items.length > 0 ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
          {items.map(([k, v], i) => (
            <div key={i} style={{ padding: "8px 0", borderBottom: "1px dashed #F1F4F9" }}>
              <div className="caption" style={{ color: "var(--text-tertiary)", marginBottom: 2 }}>{k}</div>
              <div style={{ color: "#0B1E3A" }}>{v}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="caption" style={{ color: "var(--text-tertiary)" }}>
          {lbl("Sin metadata adicional para este motivo.", "No additional metadata for this reason.")}
        </div>
      )}

      {hasCosts && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #F1F4F9" }}>
          <div className="micro" style={{ color: "#0B1E3A", letterSpacing: 1, marginBottom: 8 }}>
            {lbl("COSTOS ASOCIADOS", "ASSOCIATED COSTS")} · {costLines.length}
          </div>
          <div className="card card-pad-0">
            <table className="table">
              <thead>
                <tr>
                  <th>{lbl("Tipo", "Kind")}</th>
                  <th>{lbl("Detalle", "Label")}</th>
                  <th style={{ textAlign: "right" }}>USD</th>
                  <th>{lbl("Origen", "Source")}</th>
                </tr>
              </thead>
              <tbody>
                {costLines.map((c) => (
                  <tr key={c.id}>
                    <td><span style={{ padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 600, background: "#F3F5F8", color: "#0B1E3A" }}>{c.kind}</span></td>
                    <td>{c.label || "—"}</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>
                      ${Number(c.amount_usd || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                    </td>
                    <td>
                      <span className="caption" style={{ color: c.source === "OCR_DUA" ? "#00B286" : "#64748B", fontWeight: 600 }}>
                        {c.source === "OCR_DUA" ? "IA" : c.source}
                      </span>
                    </td>
                  </tr>
                ))}
                <tr style={{ background: "rgba(0,178,134,0.06)", fontWeight: 700 }}>
                  <td colSpan={2} style={{ textAlign: "right" }}>{lbl("Total USD", "Total USD")}</td>
                  <td className="tabular-nums" style={{ textAlign: "right", color: "#00B286" }}>
                    ${Number(totalCostUsd || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                  </td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
