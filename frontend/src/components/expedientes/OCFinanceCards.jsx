// frontend/src/components/expedientes/OCFinanceCards.jsx
// ─────────────────────────────────────────────────────────────────────
// Sprint 2026-06-11 · Auditoría Fable5 (WAVE D · "partir archivos
// gigantes"). Cards financieras extraídas VERBATIM de OCDetail.jsx
// (~270 líneas): OCPagosCard + OCTransferCostsCard. OCDetail las
// importa y re-exporta para compatibilidad con consumidores previos.
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useEffect } from "react";
import { nodoAssignmentsApi, financePaymentsApi } from "../../lib/api.js";
import PaymentDetailDrawer from "../finance/PaymentDetailDrawer.jsx";

// ─────────────────────────────────────────────────────────────
// Sprint Pagos Transfers — OCPagosCard
// Card al pie de OCDetail con la lista de pagos cuyo oc_id = ocId.
// Solo visible para roles internos (isAdmin).
// ─────────────────────────────────────────────────────────────
export function OCPagosCard({ ocId, lang, refreshKey, onOpenWizard }) {
  const [pagos,        setPagos]        = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);
  const [openPaymentId, setOpenPaymentId] = useState(null);
  const [internalKey, setInternalKey]   = useState(0);

  const refresh = () => setInternalKey((k) => k + 1);

  useEffect(() => {
    if (!ocId) return;
    let cancel = false;
    setLoading(true); setError(null);
    financePaymentsApi.list({ oc_id: ocId })
      .then((data) => {
        if (cancel) return;
        const arr = Array.isArray(data) ? data : (data?.results || []);
        setPagos(arr);
      })
      .catch((e) => { if (!cancel) setError(e?.message || 'Error'); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [ocId, refreshKey, internalKey]);

  return (
    <div className="card card-pad-lg" style={{ marginTop: 16 }}>
      <div className="flex ai-center jc-between" style={{ marginBottom: 12 }}>
        <div>
          <h3 className="heading-md" style={{ margin: 0 }}>
            {lang === 'es' ? 'Pagos de costos logísticos' : 'Logistics cost payments'}
          </h3>
          <div className="caption" style={{ color: 'var(--text-tertiary)', marginTop: 2 }}>
            {lang === 'es'
              ? 'Pagos registrados contra costos de movimientos de esta OC.'
              : 'Payments registered against transfer costs of this OC.'}
          </div>
        </div>
        {onOpenWizard && (
          <button type="button" className="btn btn-primary btn-sm"
                  onClick={onOpenWizard}>
            + {lang === 'es' ? 'Registrar pago' : 'Register payment'}
          </button>
        )}
      </div>

      {loading ? (
        <div className="caption" style={{ color: 'var(--text-tertiary)', padding: '18px 0' }}>
          {lang === 'es' ? 'Cargando pagos…' : 'Loading payments…'}
        </div>
      ) : error ? (
        <div className="body-sm" style={{ color: 'var(--critical)' }}>{error}</div>
      ) : pagos.length === 0 ? (
        <div className="caption" style={{ color: 'var(--text-tertiary)', padding: '18px 0' }}>
          {lang === 'es'
            ? 'Sin pagos registrados contra costos de esta OC.'
            : 'No payments registered against costs of this OC.'}
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{lang === 'es' ? 'Código' : 'Code'}</th>
              <th>{lang === 'es' ? 'Fecha' : 'Date'}</th>
              <th>{lang === 'es' ? 'Dirección' : 'Direction'}</th>
              <th>{lang === 'es' ? 'Método' : 'Method'}</th>
              <th>{lang === 'es' ? 'Referencia' : 'Reference'}</th>
              <th style={{ textAlign: 'right' }}>{lang === 'es' ? 'Monto' : 'Amount'}</th>
              <th style={{ textAlign: 'right' }}>USD</th>
              <th>{lang === 'es' ? 'Estado' : 'Status'}</th>
              <th>{lang === 'es' ? 'Acciones' : 'Actions'}</th>
            </tr>
          </thead>
          <tbody>
            {pagos.map((p) => {
              const dir = p.direction || 'OUT';
              return (
                <tr key={p.id}>
                  <td className="mono-sm" style={{ fontWeight: 600 }}>
                    {p.codigo || (p.id ? String(p.id).slice(0, 8) : '—')}
                  </td>
                  <td className="tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                    {p.fecha ? new Date(p.fecha).toLocaleDateString(
                      lang === 'es' ? 'es-PE' : 'en-US',
                      { day: '2-digit', month: 'short', year: 'numeric' }
                    ) : '—'}
                  </td>
                  <td>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: 4,
                      font: '600 10px/1.4 var(--font-mono)', letterSpacing: '0.06em',
                      background: dir === 'IN'
                        ? 'color-mix(in oklab, var(--success) 10%, transparent)'
                        : 'color-mix(in oklab, var(--warning) 10%, transparent)',
                      color: dir === 'IN' ? 'var(--success)' : 'var(--warning)',
                    }}>
                      {dir}
                    </span>
                  </td>
                  <td>{p.metodo || '—'}</td>
                  <td className="mono-sm" style={{ fontWeight: 600 }}>{p.referencia || '—'}</td>
                  <td className="tabular-nums" style={{ textAlign: 'right' }}>
                    {Number(p.monto || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    {' '}<span style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{p.moneda || 'USD'}</span>
                  </td>
                  <td className="tabular-nums" style={{ textAlign: 'right', fontWeight: 700,
                                                         color: 'var(--brand-accent)' }}>
                    ${Number(p.monto_usd ?? p.monto ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td>
                    <span style={{
                      padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                      background: 'var(--bg-alt)', color: 'var(--text-secondary)',
                    }}>
                      {p.estado || '—'}
                    </span>
                  </td>
                  <td>
                    <button
                      className="btn-sm"
                      style={{
                        padding: '3px 10px', fontSize: 12, fontWeight: 600,
                        background: 'var(--bg-alt)', color: 'var(--brand-primary)',
                        border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                        cursor: 'pointer',
                      }}
                      onClick={(e) => { e.stopPropagation(); setOpenPaymentId(p.id); }}
                    >
                      {lang === 'es' ? 'Ver' : 'View'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {openPaymentId && (
        <PaymentDetailDrawer
          paymentId={openPaymentId}
          open={!!openPaymentId}
          onClose={() => setOpenPaymentId(null)}
          onChange={() => { setOpenPaymentId(null); refresh(); }}
          lang={lang}
        />
      )}
    </div>
  );
}


// ─────────────────────────────────────────────────────────────
// Sprint 2026-05-13 · Fase 10 — OCTransferCostsCard
// Card al pie de OCDetail con la tabla de costos de transferencias
// que tocaron a cualquier expediente bajo esta OC. Cada fila es
// clickable y navega al detalle de la transferencia correspondiente.
// ─────────────────────────────────────────────────────────────
export function OCTransferCostsCard({ ocId, lang, navigate }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!ocId) return;
    let cancel = false;
    setLoading(true); setError(null);
    nodoAssignmentsApi.transferenciaCostosPorOC(ocId)
      .then((data) => {
        if (cancel) return;
        const arr = Array.isArray(data) ? data : (data?.results || []);
        setRows(arr);
      })
      .catch((e) => { if (!cancel) setError(e?.message || 'Error'); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [ocId]);

  const total_usd = rows.reduce((a, r) => a + Number(r.amount_usd || 0), 0);

  return (
    <div className="card card-pad-lg" style={{ marginTop: 16 }}>
      <div className="flex ai-center jc-between" style={{ marginBottom: 12 }}>
        <div>
          <h3 className="heading-md" style={{ margin: 0 }}>
            {lang === 'es' ? 'Costos de movimientos' : 'Transfer costs'}
          </h3>
          <div className="caption" style={{ color: 'var(--text-tertiary)', marginTop: 2 }}>
            {lang === 'es'
              ? 'Costos registrados en los movimientos que movieron stock de algún expediente de esta OC.'
              : 'Costs recorded in transfers that moved stock from any expediente of this OC.'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="micro" style={{ color: 'var(--text-tertiary)', letterSpacing: 0.5 }}>
            {lang === 'es' ? 'TOTAL USD' : 'TOTAL USD'}
          </div>
          <div className="tabular-nums" style={{
            fontSize: 18, fontWeight: 700,
            color: 'var(--brand-accent, #0E8A6D)',
          }}>
            ${total_usd.toLocaleString('en-US', { maximumFractionDigits: 2 })}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="caption" style={{ color: 'var(--text-tertiary)', padding: '18px 0' }}>
          {lang === 'es' ? 'Cargando…' : 'Loading…'}
        </div>
      ) : error ? (
        <div className="body-sm" style={{ color: 'var(--critical)' }}>{error}</div>
      ) : rows.length === 0 ? (
        <div className="caption" style={{ color: 'var(--text-tertiary)', padding: '18px 0' }}>
          {lang === 'es'
            ? 'No hay costos de movimientos asociados a esta OC.'
            : 'No transfer costs linked to this OC yet.'}
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{lang === 'es' ? 'Movimiento' : 'Transfer'}</th>
              <th>{lang === 'es' ? 'Expediente' : 'Expediente'}</th>
              <th>{lang === 'es' ? 'Tipo' : 'Kind'}</th>
              <th>{lang === 'es' ? 'Detalle' : 'Label'}</th>
              <th style={{ textAlign: 'right' }}>{lang === 'es' ? 'Monto' : 'Amount'}</th>
              <th style={{ textAlign: 'center' }}>{lang === 'es' ? 'Mon.' : 'Curr.'}</th>
              <th style={{ textAlign: 'right' }}>USD</th>
              <th style={{ textAlign: 'center' }}>{lang === 'es' ? 'Origen' : 'Source'}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.cost_line_id}
                  onClick={() => navigate(`/transferencias/${r.transferencia_id}`)}
                  style={{ cursor: 'pointer' }}
                  title={lang === 'es' ? 'Ver detalle de el movimiento' : 'Open transfer detail'}>
                <td className="mono-sm" style={{ color: 'var(--brand-accent, #0E8A6D)', fontWeight: 700 }}>
                  {r.transferencia_codigo || '—'}
                </td>
                <td className="mono-sm" style={{ color: 'var(--brand-primary)', fontWeight: 600 }}>
                  {r.expediente_codigo || '—'}
                </td>
                <td>{r.kind_label || r.kind}</td>
                <td>{r.label || '—'}</td>
                <td className="tabular-nums" style={{ textAlign: 'right' }}>
                  {Number(r.amount || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}
                </td>
                <td className="mono-sm" style={{ textAlign: 'center' }}>{r.currency}</td>
                <td className="tabular-nums" style={{ textAlign: 'right', fontWeight: 700,
                                                       color: 'var(--brand-accent, #0E8A6D)' }}>
                  ${Number(r.amount_usd || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}
                </td>
                <td style={{ textAlign: 'center' }}>
                  <span style={{
                    padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700,
                    background: r.source === 'OCR_DUA' ? 'rgba(0,178,134,0.12)' : '#F3F5F8',
                    color: r.source === 'OCR_DUA' ? '#00B286' : '#64748B',
                  }}>
                    {r.source || 'MANUAL'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
