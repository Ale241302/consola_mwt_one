// =====================================================================
// MWT.ONE · components/finance/PaymentDetailDrawer.jsx
// Sprint Registrar Pago (Fase 3) — Drawer de detalle de pago.
//
// Se abre desde la tabla de pagos (en /financiero, /clientes/{id} tab
// Pagos, /expedientes/{id} tab Pagos). Muestra:
//   - Header: REF, estado, monto, contraparte
//   - Timeline vertical de transiciones (registered → confirmed →
//                                         released/rejected)
//   - Tabla de aplicaciones (que obligaciones cubre)
//   - Evidencia (link a URL firmada de MinIO)
//   - Botones CEO: [Conciliar con banco] / [Liberar credito] / [Rechazar]
//
// Refetch tras cada PATCH para refrescar el timeline en vivo.
//
// Reglas honradas:
//   R1 — Cero hex literales
//   R3 — Botones CEO gated por isAdmin
//   R5 — tabular-nums en monto y referencias
// =====================================================================
import React, { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { financePaymentsApi } from "../../lib/api.js";
import { useRole } from "../../context/RoleContext.jsx";
import {
  PAYMENT_STATUS_LABELS, PAYMENT_STATUS_COLORS,
  COUNTERPARTY_TYPE_LABELS, PAYMENT_DIRECTION_LABELS,
  PAYMENT_APPLICABLE_TYPE_LABELS,
  PAYMENT_REJECTION_REASON_LABELS,
  PAYMENT_ERROR_LABELS,
  getEnumLabel,
} from "../../lib/i18n/payments.js";
import RejectPaymentDialog from "./RejectPaymentDialog.jsx";

// Estados desde los que el CEO puede liberar credito.
const RELEASABLE_STATES = ["PENDIENTE_AI", "CONFIRMADO_AI", "NEEDS_REVIEW"];
// Estados desde los que el CEO puede rechazar (incluye CONFIRMADO_HUMANO
// para reversion).
const REJECTABLE_STATES = [...RELEASABLE_STATES, "CONFIRMADO_HUMANO"];

/**
 * @param {{
 *   open: boolean,
 *   paymentId: string|null,
 *   onClose: () => void,
 *   onChange?: () => void,        // refresh callback (parent re-fetches lista)
 *   lang?: 'es'|'en',
 * }} props
 */
export default function PaymentDetailDrawer({
  open,
  paymentId,
  onClose,
  onChange,
  lang = "es",
}) {
  const { isAdmin } = useRole();
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [actionBusy, setActionBusy] = useState(null);  // 'reconcile' | 'release' | 'reject' | 'delete'
  const [actionError, setActionError] = useState(null);
  const [rejectOpen,  setRejectOpen]  = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");

  // Fetch detalle del pago.
  const reload = useCallback(async () => {
    if (!paymentId) { setData(null); return; }
    setLoading(true); setError(null);
    try {
      const resp = await financePaymentsApi.get(paymentId);
      setData(resp);
    } catch (err) {
      setError(err?.message || "No se pudo cargar el pago");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [paymentId]);

  useEffect(() => { if (open && paymentId) reload(); }, [open, paymentId, reload]);

  // Helpers acciones.
  const doAction = async (kind, fn) => {
    setActionBusy(kind); setActionError(null);
    try {
      await fn();
      await reload();
      onChange?.();
    } catch (err) {
      const body = err?.body;
      const code = body?.code;
      const detail = body?.detail || err?.message || "Acción falló";
      setActionError(
        code ? `${getEnumLabel(PAYMENT_ERROR_LABELS, code, lang) || detail}` : detail
      );
    } finally {
      setActionBusy(null);
    }
  };

  const handleDelete = () => doAction("delete", async () => {
    await financePaymentsApi.delete(data.id, {
      ...(deleteReason.trim() ? { reverted_reason: deleteReason.trim() } : {}),
    });
    setDeleteConfirmOpen(false);
    setDeleteReason("");
    onClose?.();
  });

  const handleReconcile = () => doAction("reconcile",
    () => financePaymentsApi.reconcile(paymentId));

  const handleRelease = () => doAction("release",
    () => financePaymentsApi.releaseCredit(paymentId));

  const handleReject = (payload) => doAction("reject",
    () => financePaymentsApi.reject(paymentId, payload).then(() => setRejectOpen(false)));

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            style={{
              position: "fixed", inset: 0, zIndex: 1190,
              background: "rgba(11, 30, 58, 0.45)",
            }}
          />
          <motion.aside
            initial={{ x: 600 }} animate={{ x: 0 }} exit={{ x: 600 }}
            transition={{ type: "spring", damping: 30, stiffness: 280 }}
            style={{
              position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 1191,
              width: 600, maxWidth: "100vw",
              background: "var(--surface)",
              boxShadow: "var(--shadow-lg)",
              display: "flex", flexDirection: "column",
            }}
          >
            {/* Header */}
            <header style={{
              padding: "16px 20px",
              borderBottom: "1px solid var(--divider)",
              display: "flex", alignItems: "flex-start", justifyContent: "space-between",
              flexShrink: 0,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="micro" style={{ color: "var(--text-tertiary)",
                                                 marginBottom: 4 }}>
                  {lang === "es" ? "DETALLE DE PAGO" : "PAYMENT DETAIL"}
                </div>
                <div className="font-mono tabular-nums"
                     style={{ font: "var(--heading-md)",
                              color: "var(--brand-primary)",
                              fontWeight: 700 }}>
                  {data?.codigo || (loading ? "..." : "—")}
                </div>
                {data && (
                  <div style={{ marginTop: 6, display: "flex", gap: 8,
                                alignItems: "center", flexWrap: "wrap" }}>
                    <_StatusChip estado={data.estado}
                                 reconciled={data.reconciled_with_bank}
                                 lang={lang}/>
                    {data.direction && (
                      <span className="caption" style={{ color: "var(--text-tertiary)" }}>
                        · {getEnumLabel(PAYMENT_DIRECTION_LABELS, data.direction, lang)}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={lang === "es" ? "Cerrar" : "Close"}
                style={{
                  width: 32, height: 32, border: 0, background: "transparent",
                  fontSize: 22, color: "var(--text-tertiary)",
                  cursor: "pointer", borderRadius: "var(--radius-sm)",
                }}
              >×</button>
            </header>

            {/* Body */}
            <div style={{
              flex: 1, overflowY: "auto",
              padding: "16px 20px",
              background: "var(--bg)",
              display: "flex", flexDirection: "column", gap: 16,
            }}>
              {loading && (
                <div style={{ padding: 30, textAlign: "center",
                              color: "var(--text-tertiary)" }}>
                  {lang === "es" ? "Cargando..." : "Loading..."}
                </div>
              )}
              {error && (
                <div style={{ padding: 16, textAlign: "center",
                              color: "var(--critical)" }}>{error}</div>
              )}
              {!loading && !error && data && (
                <>
                  {/* Resumen */}
                  <_Section title={lang === "es" ? "Resumen" : "Summary"}>
                    <_Row label={lang === "es" ? "Monto" : "Amount"}>
                      <span className="tabular-nums font-mono"
                            style={{ fontWeight: 700, fontSize: 16 }}>
                        {data.moneda || "USD"}{" "}
                        {Number(data.monto || 0).toLocaleString("en-US", {
                          minimumFractionDigits: 2, maximumFractionDigits: 2,
                        })}
                      </span>
                      {data.monto_usd && data.moneda !== "USD" && (
                        <span className="caption tabular-nums"
                              style={{ color: "var(--text-tertiary)", marginLeft: 8 }}>
                          ≈ USD {Number(data.monto_usd).toLocaleString("en-US",
                            { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      )}
                    </_Row>
                    <_Row label={lang === "es" ? "Método" : "Method"}>
                      {data.metodo || "—"}
                    </_Row>
                    <_Row label={lang === "es" ? "Tipo" : "Type"}>
                      {data.tipo_pago || "—"}
                    </_Row>
                    <_Row label={lang === "es" ? "Fecha" : "Date"}>
                      {data.fecha || "—"}
                    </_Row>
                    <_Row label={lang === "es" ? "Referencia" : "Reference"}>
                      <span className="tabular-nums font-mono">
                        {data.referencia || "—"}
                      </span>
                    </_Row>
                    {data.counterparty_id && (
                      <_Row label={lang === "es" ? "Contraparte" : "Counterparty"}>
                        <span style={{ fontSize: 10, fontWeight: 700,
                                        textTransform: "uppercase",
                                        letterSpacing: "0.04em",
                                        padding: "2px 6px", borderRadius: 4,
                                        background: "var(--bg-alt)",
                                        color: "var(--brand-primary)",
                                        marginRight: 6 }}>
                          {getEnumLabel(COUNTERPARTY_TYPE_LABELS,
                                        data.counterparty_type, lang)}
                        </span>
                        <span className="tabular-nums font-mono"
                              style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                          {String(data.counterparty_id).slice(0, 8)}
                        </span>
                      </_Row>
                    )}
                    {data.notas && (
                      <_Row label={lang === "es" ? "Notas" : "Notes"}>
                        <span style={{ fontStyle: "italic",
                                       color: "var(--text-secondary)" }}>
                          {data.notas}
                        </span>
                      </_Row>
                    )}
                    {data.rejection_reason && (
                      <_Row label={lang === "es" ? "Motivo rechazo" : "Rejection reason"}>
                        <span style={{ color: "var(--critical)", fontWeight: 600 }}>
                          {getEnumLabel(PAYMENT_REJECTION_REASON_LABELS,
                                        data.rejection_reason, lang)}
                        </span>
                        {data.rejection_comment && (
                          <div style={{ fontSize: 12, marginTop: 4,
                                        color: "var(--text-secondary)",
                                        fontStyle: "italic" }}>
                            "{data.rejection_comment}"
                          </div>
                        )}
                      </_Row>
                    )}
                  </_Section>

                  {/* Timeline */}
                  <_Section title={lang === "es" ? "Línea de tiempo" : "Timeline"}>
                    <_Timeline data={data} lang={lang}/>
                  </_Section>

                  {/* Aplicaciones */}
                  {Array.isArray(data.aplicaciones) && data.aplicaciones.length > 0 && (
                    <_Section title={lang === "es"
                      ? `Aplicaciones (${data.aplicaciones.length})`
                      : `Applications (${data.aplicaciones.length})`}>
                      <table style={{ width: "100%", fontSize: 12 }}>
                        <thead>
                          <tr style={{ color: "var(--text-tertiary)",
                                       textAlign: "left" }}>
                            <th style={{ padding: "4px 6px" }}>
                              {lang === "es" ? "Tipo" : "Type"}
                            </th>
                            <th style={{ padding: "4px 6px" }}>
                              {lang === "es" ? "Código" : "Code"}
                            </th>
                            <th style={{ padding: "4px 6px", textAlign: "right" }}>
                              {lang === "es" ? "Aplicado" : "Applied"}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.aplicaciones.map((a, i) => (
                            <tr key={a.id || i}>
                              <td style={{ padding: "4px 6px" }}>
                                {getEnumLabel(PAYMENT_APPLICABLE_TYPE_LABELS,
                                              a.applicable_type, lang)}
                              </td>
                              <td className="tabular-nums font-mono"
                                  style={{ padding: "4px 6px" }}>
                                {a.applicable_code
                                  || String(a.applicable_id || "").slice(0, 8)}
                              </td>
                              <td className="tabular-nums"
                                  style={{ padding: "4px 6px", textAlign: "right" }}>
                                {Number(a.monto_aplicado || 0).toLocaleString("en-US", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </_Section>
                  )}

                  {/* Evidencia */}
                  {data.evidencia && (
                    <_Section title={lang === "es" ? "Comprobante" : "Proof"}>
                      <_Evidence ev={data.evidencia} lang={lang}/>
                    </_Section>
                  )}

                  {/* Acciones CEO */}
                  {isAdmin && (
                    <_Section title={lang === "es" ? "Acciones (CEO/Admin)" : "Actions (CEO/Admin)"}>
                      {actionError && (
                        <div style={{ marginBottom: 10, padding: "8px 10px",
                                      background: "color-mix(in oklab, var(--critical) 10%, transparent)",
                                      border: "1px solid color-mix(in oklab, var(--critical) 36%, transparent)",
                                      borderRadius: "var(--radius-sm)",
                                      color: "var(--critical)", fontSize: 12 }}>
                          {actionError}
                        </div>
                      )}
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {/* Conciliar */}
                        {!data.reconciled_with_bank
                          && data.estado === "PENDIENTE_AI" && (
                          <button
                            type="button"
                            disabled={!!actionBusy}
                            onClick={handleReconcile}
                            style={_actionBtn("secondary", !!actionBusy)}
                          >
                            {actionBusy === "reconcile"
                              ? (lang === "es" ? "Conciliando..." : "Reconciling...")
                              : (lang === "es" ? "Conciliar con banco" : "Reconcile with bank")}
                          </button>
                        )}
                        {/* Liberar credito */}
                        {RELEASABLE_STATES.includes(data.estado) && (
                          <button
                            type="button"
                            disabled={!!actionBusy}
                            onClick={handleRelease}
                            style={_actionBtn("primary", !!actionBusy)}
                          >
                            {actionBusy === "release"
                              ? (lang === "es" ? "Liberando..." : "Releasing...")
                              : (lang === "es" ? "Liberar crédito" : "Release credit")}
                          </button>
                        )}
                        {/* Rechazar */}
                        {REJECTABLE_STATES.includes(data.estado) && (
                          <button
                            type="button"
                            disabled={!!actionBusy}
                            onClick={() => setRejectOpen(true)}
                            style={_actionBtn("danger", !!actionBusy)}
                          >
                            {actionBusy === "reject"
                              ? (lang === "es" ? "Rechazando..." : "Rejecting...")
                              : (lang === "es" ? "Rechazar" : "Reject")}
                          </button>
                        )}
                        {/* Ninguna accion disponible */}
                        {!RELEASABLE_STATES.includes(data.estado)
                         && !REJECTABLE_STATES.includes(data.estado) && (
                          <span className="caption" style={{ color: "var(--text-tertiary)" }}>
                            {lang === "es"
                              ? "No hay acciones disponibles en este estado."
                              : "No actions available in this state."}
                          </span>
                        )}
                        {/* Eliminar pago — R3: solo isAdmin, no REVERTIDO ni RECHAZADO */}
                        {data.estado !== "REVERTIDO" && data.estado !== "RECHAZADO" && (
                          <button
                            type="button"
                            disabled={!!actionBusy}
                            onClick={() => { setDeleteConfirmOpen(true); setDeleteReason(""); }}
                            style={_actionBtn("danger-outline", !!actionBusy)}
                          >
                            {actionBusy === "delete"
                              ? (lang === "es" ? "Eliminando..." : "Deleting...")
                              : (lang === "es" ? "Eliminar pago" : "Delete payment")}
                          </button>
                        )}
                      </div>

                      {/* ── Confirm delete inline ─────────────────────────── */}
                      {deleteConfirmOpen && (
                        <div style={{
                          marginTop: 12,
                          padding: "14px 16px",
                          borderRadius: "var(--radius-md)",
                          border: "1px solid color-mix(in oklab, var(--critical) 40%, transparent)",
                          background: "color-mix(in oklab, var(--critical) 6%, transparent)",
                        }}>
                          {/* Warning contextual */}
                          {data.estado === "CONFIRMADO_HUMANO" ? (
                            <p style={{ fontSize: 13, color: "var(--critical)",
                                        fontWeight: 600, margin: "0 0 10px" }}>
                              {lang === "es"
                                ? `Este pago ya liberó crédito a ${data.counterparty_name || data.counterparty_id || "la contraparte"}. Al eliminar, el crédito se devolverá automáticamente.`
                                : `This payment already released credit to ${data.counterparty_name || data.counterparty_id || "the counterparty"}. Deleting will automatically reverse the credit.`}
                            </p>
                          ) : (
                            <p style={{ fontSize: 13, color: "var(--text-secondary)",
                                        margin: "0 0 10px" }}>
                              {lang === "es"
                                ? "El pago se marcará como REVERTIDO. ¿Confirmas?"
                                : "The payment will be marked as REVERTED. Confirm?"}
                            </p>
                          )}
                          {/* Motivo opcional */}
                          <textarea
                            rows={2}
                            value={deleteReason}
                            onChange={(e) => setDeleteReason(e.target.value)}
                            placeholder={lang === "es"
                              ? "Motivo (opcional)…"
                              : "Reason (optional)…"}
                            style={{
                              width: "100%", padding: "6px 8px",
                              border: "1px solid var(--border)",
                              borderRadius: "var(--radius-sm)",
                              font: "var(--body-sm)", color: "var(--text-primary)",
                              background: "var(--surface)",
                              resize: "vertical", marginBottom: 10, boxSizing: "border-box",
                            }}
                          />
                          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                            <button
                              type="button"
                              disabled={!!actionBusy}
                              onClick={() => { setDeleteConfirmOpen(false); setDeleteReason(""); }}
                              style={_actionBtn("secondary", !!actionBusy)}
                            >
                              {lang === "es" ? "Cancelar" : "Cancel"}
                            </button>
                            <button
                              type="button"
                              disabled={!!actionBusy}
                              onClick={handleDelete}
                              style={_actionBtn("danger", !!actionBusy)}
                            >
                              {actionBusy === "delete"
                                ? (lang === "es" ? "Eliminando..." : "Deleting...")
                                : (lang === "es" ? "Sí, eliminar" : "Yes, delete")}
                            </button>
                          </div>
                        </div>
                      )}
                    </_Section>
                  )}
                </>
              )}
            </div>
          </motion.aside>

          {/* Reject dialog */}
          <RejectPaymentDialog
            open={rejectOpen}
            onClose={() => setRejectOpen(false)}
            onConfirm={handleReject}
            isCurrentStateReleased={data?.estado === "CONFIRMADO_HUMANO"}
            submitting={actionBusy === "reject"}
            lang={lang}
          />
        </>
      )}
    </AnimatePresence>
  );
}


// ── Subcomponentes ───────────────────────────────────────────────────

function _Section({ title, children }) {
  return (
    <section className="card card-pad">
      <div className="micro" style={{ color: "var(--text-tertiary)",
                                       marginBottom: 8 }}>
        {title}
      </div>
      {children}
    </section>
  );
}

function _Row({ label, children }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "flex-start",
      padding: "6px 0", gap: 12,
      borderBottom: "1px dashed var(--divider)",
    }}>
      <span style={{ color: "var(--text-secondary)", fontSize: 12,
                     textTransform: "uppercase", letterSpacing: "0.04em",
                     fontWeight: 500, flexShrink: 0 }}>
        {label}
      </span>
      <span style={{ color: "var(--text-primary)", fontSize: 13,
                     textAlign: "right" }}>
        {children}
      </span>
    </div>
  );
}

function _StatusChip({ estado, reconciled, lang }) {
  const label = getEnumLabel(PAYMENT_STATUS_LABELS, estado, lang);
  const color = PAYMENT_STATUS_COLORS[estado] || "var(--text-tertiary)";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "3px 9px", borderRadius: "999px",
      background: `color-mix(in oklab, ${color} 14%, transparent)`,
      color: color,
      border: `1px solid color-mix(in oklab, ${color} 36%, transparent)`,
      fontSize: 11, fontWeight: 600,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color }}/>
      {label}
      {estado === "PENDIENTE_AI" && reconciled && (
        <span style={{ marginLeft: 4, fontSize: 9, opacity: 0.8 }}>
          {lang === "es" ? "· conciliado" : "· reconciled"}
        </span>
      )}
    </span>
  );
}

function _Timeline({ data, lang }) {
  // Construimos eventos a partir de timestamps del payment.
  const events = [];
  if (data.created_at) {
    events.push({
      label: lang === "es" ? "Pago registrado" : "Payment registered",
      ts: data.created_at, color: "var(--brand-primary)",
    });
  }
  if (data.reconciled_with_bank) {
    events.push({
      label: lang === "es" ? "Conciliado con banco" : "Reconciled with bank",
      ts: data.updated_at, color: "var(--brand-accent-dark)",
    });
  }
  if (data.confirmed_at) {
    events.push({
      label: data.estado === "CONFIRMADO_HUMANO"
        ? (lang === "es" ? "Crédito liberado por CEO" : "Credit released by CEO")
        : (lang === "es" ? "Confirmado por IA"        : "Confirmed by AI"),
      ts: data.confirmed_at,
      color: data.estado === "CONFIRMADO_HUMANO" ? "var(--success)" : "var(--brand-accent-dark)",
    });
  }
  if (data.reverted_at) {
    events.push({
      label: lang === "es"
        ? `Rechazado (${data.rejection_reason || "—"})`
        : `Rejected (${data.rejection_reason || "—"})`,
      ts: data.reverted_at,
      color: "var(--critical)",
    });
  }

  if (events.length === 0) {
    return <span className="caption" style={{ color: "var(--text-tertiary)" }}>
      {lang === "es" ? "Sin eventos registrados." : "No events recorded."}
    </span>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {events.map((ev, i) => (
        <div key={i} style={{
          display: "flex", gap: 12, padding: "6px 0",
          position: "relative",
        }}>
          <div style={{
            width: 10, height: 10, borderRadius: "50%",
            background: ev.color, marginTop: 5, flexShrink: 0,
            position: "relative", zIndex: 1,
          }}/>
          {i < events.length - 1 && (
            <div style={{
              position: "absolute", left: 4.5, top: 16, width: 1, bottom: -6,
              background: "var(--divider)",
            }}/>
          )}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{ev.label}</div>
            <div className="caption tabular-nums"
                 style={{ color: "var(--text-tertiary)" }}>
              {_fmtTs(ev.ts)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function _Evidence({ ev, lang }) {
  const url = ev.archivo_url || ev.url;
  if (!url) {
    return (
      <span className="caption" style={{ color: "var(--text-tertiary)" }}>
        {lang === "es" ? "Sin URL firmada disponible." : "No signed URL available."}
      </span>
    );
  }
  const isPdf = String(ev.mime_type || "").includes("pdf");
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ fontSize: 22 }}>{isPdf ? "📄" : "🖼️"}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500,
                      overflow: "hidden", textOverflow: "ellipsis",
                      whiteSpace: "nowrap" }}>
          {ev.original_name || ev.object_key || "—"}
        </div>
        <div className="caption tabular-nums"
             style={{ color: "var(--text-tertiary)" }}>
          {ev.mime_type || "—"}
          {ev.size_bytes && ` · ${(Number(ev.size_bytes) / 1024).toFixed(1)} KB`}
        </div>
      </div>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          padding: "6px 12px",
          background: "var(--brand-primary)",
          color: "var(--text-inverse)",
          borderRadius: "var(--radius-sm)",
          fontSize: 12, fontWeight: 600,
          textDecoration: "none",
        }}
      >
        {lang === "es" ? "Abrir" : "Open"}
      </a>
    </div>
  );
}

function _fmtTs(ts) {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    return d.toLocaleString("es", {
      year: "numeric", month: "short", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return String(ts); }
}

function _actionBtn(kind, disabled) {
  if (kind === "danger-outline") {
    return {
      padding: "8px 14px",
      background: disabled ? "var(--bg-alt)" : "transparent",
      color: disabled ? "var(--text-tertiary)" : "var(--critical)",
      border: `1px solid ${disabled ? "var(--border)" : "var(--critical)"}`,
      borderRadius: "var(--radius-sm)",
      font: "var(--body-sm)", fontWeight: 600,
      cursor: disabled ? "not-allowed" : "pointer",
      transition: "opacity 120ms ease",
    };
  }
  const colors = {
    primary:   { bg: "var(--brand-primary)", fg: "var(--text-inverse)" },
    secondary: { bg: "var(--bg-alt)",        fg: "var(--text-primary)" },
    danger:    { bg: "var(--critical)",      fg: "var(--text-inverse)" },
  };
  const c = colors[kind] || colors.secondary;
  return {
    padding: "8px 14px",
    background: disabled ? "var(--bg-alt)" : c.bg,
    color: disabled ? "var(--text-tertiary)" : c.fg,
    border: 0, borderRadius: "var(--radius-sm)",
    font: "var(--body-sm)", fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "opacity 120ms ease",
  };
}
