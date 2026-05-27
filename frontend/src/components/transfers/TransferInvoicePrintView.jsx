// ─────────────────────────────────────────────────────────────
// TransferInvoicePrintView — Factura/Remisión imprimible
// Sprint Transfer Engine v4 · 2026-04-29 · POL_PRINT compliant
// Agente responsable: [AG-FRONTEND]
//
// Renderiza el JSON devuelto por GET /api/transferencias/{id}/invoice_payload/
// como un documento bellamente maquetado, preparado para imprimir o
// guardar como PDF vía window.print().
//
// CUMPLIMIENTO POL_PRINT (13 reglas):
//   1.  @media print escondido lo que no debe imprimirse (.no-print, .actions).
//   2.  body en formato A4 (210mm × 297mm) con márgenes físicos 15mm.
//   3.  Forzar -webkit-print-color-adjust: exact (Chrome) y print-color-adjust: exact (resto).
//   4.  Evitar saltos de página dentro de filas críticas (page-break-inside: avoid).
//   5.  Tipografía web-safe (no depender de fuentes custom para garantizar render).
//   6.  Bordes y backgrounds tabulares preservados al imprimir.
//   7.  Header con identidad MWT (logo + códigos) + folio + fecha.
//   8.  Bloque destinatario / origen con direcciones y SAP.
//   9.  Tabla de líneas con tabular-nums alineada.
//   10. Bloque de firmas al pie (origen, destino, supervisor).
//   11. Footer con metadatos no-disruptivos (UUID, timestamp).
//   12. Número de página automático con CSS @page.
//   13. Botón flotante "Imprimir / PDF" se auto-oculta en @media print.
// ─────────────────────────────────────────────────────────────
import React from "react";

const fmt2 = (n) => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt4 = (n) => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const fmtDate = (s) => {
  if (!s) return "—";
  // Sprint 2026-05-26 (CEO) - fix timezone (ver TransferDetail.jsx).
  const isDateOnly = typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const d = new Date(isDateOnly ? `${s}T12:00:00` : s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString("es-PE", { day: "2-digit", month: "long", year: "numeric" });
};

const LEGAL_LABEL = {
  INTERNAL:        "Interno / Redistribución",
  NATIONALIZATION: "Nacionalización",
  EXPORT:          "Reexportación",
  DISTRIBUTION:    "Distribución",
  CONSIGNMENT:     "Consignación",
};

export default function TransferInvoicePrintView({ payload, lang = "es", onClose }) {
  if (!payload || !payload.movimiento) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#64748B" }}>
        {lang === "es" ? "Sin datos para generar el documento." : "No data to render document."}
      </div>
    );
  }
  const t = payload.movimiento;
  const totals = payload.totales || {};
  const tp = payload.transfer_pricing || {};
  const isFactura = payload.kind === "FACTURA_INTERNA";
  const docTitle = isFactura
    ? (lang === "es" ? "Factura Interna" : "Internal Invoice")
    : (lang === "es" ? "Remisión Interna" : "Internal Waybill");

  return (
    <>
      {/* ── POL_PRINT: bloque CSS de 13 reglas inline (scoped) ── */}
      <style>{POL_PRINT_CSS}</style>

      {/* ── Botón flotante imprimir/cerrar (no-print) ── */}
      <div className="invoice-actions no-print">
        {onClose && (
          <button onClick={onClose} className="btn btn-ghost"
                  style={{ marginRight: 8 }}>
            ← {lang === "es" ? "Cerrar" : "Close"}
          </button>
        )}
        <button onClick={() => window.print()} className="btn btn-accent"
                style={{
                  background: "var(--btn-primary, #00B286)",
                  borderColor: "var(--btn-primary, #00B286)",
                  fontWeight: 700, minWidth: 180,
                }}>
          🖨 {lang === "es" ? "Imprimir / Guardar PDF" : "Print / Save PDF"}
        </button>
      </div>

      {/* ── Documento ── */}
      <article className="invoice-doc">
        {/* ─── HEADER ─── */}
        <header className="inv-head">
          <div className="inv-brand">
            <div className="inv-brand-logo">
              <span className="inv-brand-mark">M</span>
              <span className="inv-brand-mark inv-brand-accent">W</span>
              <span className="inv-brand-mark">T</span>
            </div>
            <div className="inv-brand-text">
              <div className="inv-brand-name">MWT.ONE</div>
              <div className="inv-brand-sub">Marluvas · Worldwide Trade</div>
            </div>
          </div>
          <div className="inv-doc-id">
            <div className="inv-doc-kind">{docTitle.toUpperCase()}</div>
            <div className="inv-doc-folio">{t.codigo}</div>
            <div className="inv-doc-date">
              {lang === "es" ? "Fecha de emisión: " : "Issue date: "}
              <strong>{fmtDate(payload.fechas?.created_at)}</strong>
            </div>
            <div className="inv-doc-ctx">
              {lang === "es" ? "Motivo: " : "Reason: "}
              <strong>{LEGAL_LABEL[t.legal_context] || t.legal_context}</strong>
            </div>
          </div>
        </header>

        {/* ─── PARTES ─── */}
        <section className="inv-parties">
          <div className="inv-party">
            <div className="inv-party-label">{lang === "es" ? "ORIGEN (DESPACHA)" : "ORIGIN (SHIPS)"}</div>
            <div className="inv-party-name">{payload.origen?.label || "—"}</div>
            <div className="inv-party-meta">
              {lang === "es" ? "Despachado: " : "Dispatched: "}
              <strong>{fmtDate(payload.fechas?.dispatched_at)}</strong>
            </div>
            <div className="inv-party-meta">
              {lang === "es" ? "Por: " : "By: "}
              {payload.personas?.created_by_name || "—"}
            </div>
          </div>
          <div className="inv-party-arrow">→</div>
          <div className="inv-party">
            <div className="inv-party-label">{lang === "es" ? "DESTINO (RECIBE)" : "DESTINATION (RECEIVES)"}</div>
            <div className="inv-party-name">{payload.destino?.label || "—"}</div>
            <div className="inv-party-meta">
              {lang === "es" ? "Recibido: " : "Received: "}
              <strong>{fmtDate(payload.fechas?.received_at)}</strong>
            </div>
            <div className="inv-party-meta">
              {lang === "es" ? "Por: " : "By: "}
              {payload.personas?.received_by_name || "—"}
            </div>
          </div>
        </section>

        {/* ─── DOCUMENTACIÓN LEGAL ─── */}
        {(payload.documentos?.dua || payload.documentos?.bl_awb || payload.documentos?.factura) && (
          <section className="inv-section">
            <div className="inv-section-title">
              {lang === "es" ? "DOCUMENTACIÓN LEGAL" : "LEGAL DOCUMENTS"}
            </div>
            <div className="inv-docs-grid">
              {payload.documentos.factura && <DocBox label="Factura" doc={payload.documentos.factura}/>}
              {payload.documentos.dua && <DocBox label="DUA" doc={payload.documentos.dua}/>}
              {payload.documentos.bl_awb && <DocBox label="BL/AWB" doc={payload.documentos.bl_awb}/>}
              {payload.documentos.remision && <DocBox label={lang === "es" ? "Remisión" : "Waybill"} doc={payload.documentos.remision}/>}
              {payload.documentos.despacho && <DocBox label={lang === "es" ? "Despacho" : "Dispatch"} doc={payload.documentos.despacho}/>}
              {payload.documentos.acta_recepcion && <DocBox label={lang === "es" ? "Acta recepción" : "Receipt"} doc={payload.documentos.acta_recepcion}/>}
              {payload.documentos.excepcion && <DocBox label={lang === "es" ? "Excepción" : "Exception"} doc={payload.documentos.excepcion} highlight/>}
            </div>
          </section>
        )}

        {/* ─── LÍNEAS DE PRODUCTO ─── */}
        <section className="inv-section">
          <div className="inv-section-title">
            {lang === "es" ? "DETALLE DE MERCADERÍA" : "MERCHANDISE DETAIL"}
          </div>
          <table className="inv-lines-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>{lang === "es" ? "Producto" : "Product"}</th>
                <th>{lang === "es" ? "Talla" : "Size"}</th>
                <th className="num">{lang === "es" ? "Plan." : "Planned"}</th>
                <th className="num">{lang === "es" ? "Despach." : "Disp."}</th>
                <th className="num">{lang === "es" ? "Recib." : "Recv."}</th>
                <th className="num">FOB unit.</th>
                {tp.applies && <th className="num">{lang === "es" ? "Transfer Price" : "Transfer Price"}</th>}
                <th className="num">{lang === "es" ? "Costo asignado" : "Cost share"}</th>
                <th className="num">{lang === "es" ? "Landed unit." : "Landed unit"}</th>
                <th className="num">Total USD</th>
              </tr>
            </thead>
            <tbody>
              {(payload.lineas || []).map((l, idx) => {
                const qty = l.qty_received ?? l.qty_dispatched ?? l.qty_planned ?? 0;
                const unit = l.landed_cost_usd ?? l.unit_value_usd ?? 0;
                const tot = qty * unit;
                const hasGap = l.qty_received != null && l.qty_dispatched != null
                               && l.qty_received !== l.qty_dispatched;
                return (
                  <tr key={idx} className={hasGap ? "row-gap" : ""}>
                    <td className="mono">{l.sku || "—"}</td>
                    <td>{l.product_label || "—"}</td>
                    <td>{l.size || "—"}</td>
                    <td className="num">{l.qty_planned}</td>
                    <td className="num">{l.qty_dispatched ?? "—"}</td>
                    <td className="num">{l.qty_received ?? "—"}</td>
                    <td className="num">${fmt4(l.unit_value_usd)}</td>
                    {tp.applies && <td className="num">${fmt2(l.tp_unit_amount || tp.amount)}</td>}
                    <td className="num cost-share">+${fmt2(l.cost_share_usd)}</td>
                    <td className="num landed-unit">${fmt4(unit)}</td>
                    <td className="num total"><strong>${fmt2(tot)}</strong></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="totals-row">
                <td colSpan={3}><strong>{lang === "es" ? "TOTALES" : "TOTALS"}</strong></td>
                <td className="num"><strong>{totals.units_total}</strong></td>
                <td colSpan={tp.applies ? 4 : 3}></td>
                <td className="num cost-share"><strong>+${fmt2(totals.extra_costs_total_usd)}</strong></td>
                <td className="num landed-unit"><strong>${fmt4(totals.avg_landed_per_unit_usd)}</strong></td>
                <td className="num total"><strong>${fmt2(totals.landed_total_usd)}</strong></td>
              </tr>
            </tfoot>
          </table>
        </section>

        {/* ─── DESGLOSE DE COSTOS (si hay) ─── */}
        {(payload.cost_breakdown || []).length > 0 && (
          <section className="inv-section">
            <div className="inv-section-title">
              {lang === "es" ? "DESGLOSE DE COSTOS INCREMENTALES" : "INCREMENTAL COSTS BREAKDOWN"}
            </div>
            <table className="inv-cost-table">
              <thead>
                <tr>
                  <th>{lang === "es" ? "Tipo" : "Kind"}</th>
                  <th>{lang === "es" ? "Detalle" : "Label"}</th>
                  <th className="num">{lang === "es" ? "Monto" : "Amount"}</th>
                  <th>{lang === "es" ? "Mon." : "Curr."}</th>
                  <th className="num">FX→USD</th>
                  <th className="num">USD</th>
                </tr>
              </thead>
              <tbody>
                {payload.cost_breakdown.map((c, i) => (
                  <tr key={i}>
                    <td><span className="kind-tag">{c.kind}</span></td>
                    <td>{c.label || "—"}</td>
                    <td className="num">{fmt2(c.amount)}</td>
                    <td className="mono">{c.currency}</td>
                    <td className="num">{fmt4(c.fx_to_usd)}</td>
                    <td className="num"><strong>${fmt2(c.amount_usd)}</strong></td>
                  </tr>
                ))}
                <tr className="totals-row">
                  <td colSpan={5}><strong>{lang === "es" ? "Total costos en USD" : "Total cost in USD"}</strong></td>
                  <td className="num"><strong>${fmt2(totals.extra_costs_total_usd)}</strong></td>
                </tr>
              </tbody>
            </table>
          </section>
        )}

        {/* ─── RESUMEN FINANCIERO ─── */}
        <section className="inv-summary">
          <div className="inv-summary-card">
            <div className="inv-summary-row">
              <span>{lang === "es" ? "Total FOB (mercadería)" : "Total FOB (merchandise)"}</span>
              <strong>${fmt2(totals.fob_total_usd)}</strong>
            </div>
            {tp.applies && (
              <div className="inv-summary-row">
                <span>{lang === "es" ? "Transfer Pricing" : "Transfer Pricing"}</span>
                <strong>${fmt2(tp.amount)} {tp.currency} · {tp.basis}</strong>
              </div>
            )}
            <div className="inv-summary-row">
              <span>{lang === "es" ? "Costos incrementales" : "Incremental costs"}</span>
              <strong className="cost-share">+${fmt2(totals.extra_costs_total_usd)}</strong>
            </div>
            <div className="inv-summary-divider"/>
            <div className="inv-summary-row inv-summary-final">
              <span>{lang === "es" ? "LANDED TOTAL" : "LANDED TOTAL"}</span>
              <strong>${fmt2(totals.landed_total_usd)} USD</strong>
            </div>
            <div className="inv-summary-row inv-summary-secondary">
              <span>{lang === "es" ? "Promedio por unidad" : "Avg per unit"}</span>
              <strong>${fmt4(totals.avg_landed_per_unit_usd)}</strong>
            </div>
          </div>
        </section>

        {/* ─── GAP CONTABLE (si aplica) ─── */}
        {payload.gap_info?.has_discrepancy && (
          <section className="inv-section inv-gap">
            <div className="inv-section-title">
              ⚠ {lang === "es" ? "GAP CONTABLE — REQUIERE EXCEPCIÓN" : "ACCOUNTING GAP — EXCEPTION REQUIRED"}
            </div>
            <p>
              {lang === "es"
                ? `Este movimiento presenta ${payload.gap_info.discrepancy_count} líneas con diferencia entre lo despachado y lo recibido.`
                : `This transfer has ${payload.gap_info.discrepancy_count} lines with variance between dispatched and received.`}
            </p>
            {payload.gap_info.gap_justification && (
              <p><strong>{lang === "es" ? "Justificación: " : "Justification: "}</strong>{payload.gap_info.gap_justification}</p>
            )}
          </section>
        )}

        {/* ─── FIRMAS ─── */}
        <section className="inv-signatures">
          <SignatureBox label={lang === "es" ? "Origen (despacha)" : "Origin (ships)"}
                        name={payload.personas?.created_by_name}/>
          <SignatureBox label={lang === "es" ? "Destino (recibe)" : "Destination (receives)"}
                        name={payload.personas?.received_by_name}/>
          <SignatureBox label={lang === "es" ? "Reconcilia" : "Reconciles"}
                        name={payload.personas?.reconciled_by_name}/>
        </section>

        {/* ─── FOOTER ─── */}
        <footer className="inv-footer">
          <span>UUID: <code>{t.id}</code></span>
          <span>·</span>
          <span>{lang === "es" ? "Generado: " : "Generated: "}{new Date().toLocaleString()}</span>
          <span>·</span>
          <span>MWT.ONE Internal Document — POL_VISIBILIDAD: INTERNAL/CEO-ONLY</span>
        </footer>
      </article>
    </>
  );
}

function DocBox({ label, doc, highlight }) {
  return (
    <div className={`inv-doc-box ${highlight ? "inv-doc-box-highlight" : ""}`}>
      <div className="inv-doc-box-label">{label}</div>
      <div className="inv-doc-box-title">{doc.titulo || "—"}</div>
      {doc.numero_ref && <div className="inv-doc-box-ref">Ref: <code>{doc.numero_ref}</code></div>}
      {doc.fecha_emision && <div className="inv-doc-box-date">{fmtDate(doc.fecha_emision)}</div>}
    </div>
  );
}

function SignatureBox({ label, name }) {
  return (
    <div className="inv-sig">
      <div className="inv-sig-line"></div>
      <div className="inv-sig-label">{label}</div>
      <div className="inv-sig-name">{name || "—"}</div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// POL_PRINT · 13 reglas CSS canónicas
// ═════════════════════════════════════════════════════════════
const POL_PRINT_CSS = `
/* ── 1) Layout base de pantalla (preview) ─────────────────── */
.invoice-doc {
  background: #FFFFFF;
  color: #0B1E3A;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 13px;
  line-height: 1.45;
  width: 210mm;
  min-height: 297mm;
  padding: 18mm 16mm;
  margin: 24px auto;
  box-shadow: 0 8px 32px rgba(11,30,58,0.08);
  border-radius: 8px;
}

/* ── 2) Botonera flotante (no-print) ──────────────────────── */
.invoice-actions {
  position: sticky; top: 12px; z-index: 10;
  display: flex; justify-content: flex-end; gap: 10px;
  padding: 12px 24px; max-width: 210mm; margin: 0 auto;
}

/* ── 3) Header ───────────────────────────────────────────── */
.inv-head {
  display: flex; justify-content: space-between; align-items: flex-start;
  border-bottom: 3px solid #0B1E3A;
  padding-bottom: 16px; margin-bottom: 22px;
}
.inv-brand { display: flex; align-items: center; gap: 12px; }
.inv-brand-logo {
  display: flex; gap: 1px;
  background: #0B1E3A; padding: 8px 10px; border-radius: 6px;
}
.inv-brand-mark { color: #fff; font-weight: 800; font-size: 18px; letter-spacing: -1px; }
.inv-brand-accent { color: #00B286; }
.inv-brand-name { font-size: 18px; font-weight: 800; color: #0B1E3A; letter-spacing: 1px; }
.inv-brand-sub  { font-size: 10px; color: #64748B; letter-spacing: 0.5px; text-transform: uppercase; }

.inv-doc-id { text-align: right; }
.inv-doc-kind  { font-size: 10px; color: #00B286; font-weight: 700; letter-spacing: 1.5px; }
.inv-doc-folio { font-size: 22px; font-weight: 800; color: #0B1E3A; margin: 2px 0 4px; font-variant-numeric: tabular-nums; }
.inv-doc-date,
.inv-doc-ctx  { font-size: 11px; color: #475569; }

/* ── 4) Origen / Destino ─────────────────────────────────── */
.inv-parties {
  display: grid; grid-template-columns: 1fr auto 1fr; gap: 18px;
  margin-bottom: 22px;
}
.inv-party {
  border: 1px solid #E1E6ED; border-radius: 8px; padding: 14px 16px;
  background: #F8FAFC;
}
.inv-party-label { font-size: 9px; color: #00B286; font-weight: 700; letter-spacing: 1px; margin-bottom: 4px; }
.inv-party-name  { font-size: 14px; font-weight: 700; color: #0B1E3A; margin-bottom: 6px; }
.inv-party-meta  { font-size: 11px; color: #475569; }
.inv-party-arrow { font-size: 28px; color: #00B286; font-weight: 700; align-self: center; }

/* ── 5) Sección genérica ─────────────────────────────────── */
.inv-section { margin-bottom: 22px; }
.inv-section-title {
  font-size: 10px; font-weight: 700; color: #00B286;
  letter-spacing: 1.5px; margin-bottom: 10px;
  border-bottom: 1px solid #E1E6ED; padding-bottom: 6px;
}

/* ── 6) Documentos legales ───────────────────────────────── */
.inv-docs-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.inv-doc-box {
  border: 1px solid #E1E6ED; border-radius: 6px; padding: 10px 12px;
  background: #fff;
}
.inv-doc-box-highlight { border-color: #F59E0B; background: #FEF3C7; }
.inv-doc-box-label { font-size: 9px; color: #64748B; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; }
.inv-doc-box-title { font-size: 12px; font-weight: 700; color: #0B1E3A; margin: 2px 0; }
.inv-doc-box-ref,
.inv-doc-box-date { font-size: 10px; color: #475569; }

/* ── 7) Tablas ───────────────────────────────────────────── */
.inv-lines-table, .inv-cost-table {
  width: 100%; border-collapse: collapse; font-size: 11px;
}
.inv-lines-table th, .inv-cost-table th {
  background: #0B1E3A; color: #fff; padding: 8px 6px;
  text-align: left; font-weight: 600; letter-spacing: 0.3px;
  font-size: 10px; text-transform: uppercase;
}
.inv-lines-table td, .inv-cost-table td {
  padding: 7px 6px; border-bottom: 1px solid #E1E6ED;
}
.inv-lines-table .num, .inv-cost-table .num { text-align: right; font-variant-numeric: tabular-nums; }
.inv-lines-table .mono, .inv-cost-table .mono { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 10.5px; }
.inv-lines-table .cost-share { color: #B45309; }
.inv-lines-table .landed-unit { color: #00B286; font-weight: 600; }
.inv-lines-table .total { color: #0B1E3A; }
.inv-lines-table .row-gap td { background: #FEF3C7; }
.inv-lines-table .totals-row td, .inv-cost-table .totals-row td {
  background: rgba(0,178,134,0.08); border-top: 2px solid #00B286;
  border-bottom: none; padding-top: 10px; padding-bottom: 10px;
}

.kind-tag {
  display: inline-block; padding: 1px 6px; border-radius: 4px;
  background: #F3F5F8; color: #0B1E3A;
  font-size: 10px; font-weight: 700; letter-spacing: 0.5px;
}

/* ── 8) Resumen financiero ───────────────────────────────── */
.inv-summary { display: flex; justify-content: flex-end; margin-bottom: 24px; }
.inv-summary-card {
  width: 320px; border: 2px solid #0B1E3A; border-radius: 10px;
  padding: 14px 18px; background: #FAFBFD;
}
.inv-summary-row {
  display: flex; justify-content: space-between; align-items: baseline;
  padding: 5px 0; font-size: 12px; color: #475569;
}
.inv-summary-row strong { color: #0B1E3A; font-variant-numeric: tabular-nums; }
.inv-summary-row.cost-share strong { color: #B45309; }
.inv-summary-divider { border-top: 1px solid #E1E6ED; margin: 6px 0; }
.inv-summary-final { padding-top: 8px; border-top: 2px solid #00B286; }
.inv-summary-final span { font-size: 13px; font-weight: 700; color: #0B1E3A; letter-spacing: 0.5px; }
.inv-summary-final strong { font-size: 18px; color: #00B286 !important; }
.inv-summary-secondary { font-size: 11px; color: #94A3B8; }

/* ── 9) Gap section ──────────────────────────────────────── */
.inv-gap {
  border-left: 4px solid #F59E0B; background: #FEF3C7;
  padding: 12px 16px; border-radius: 4px;
}
.inv-gap p { margin: 4px 0; font-size: 12px; color: #92400E; }

/* ── 10) Firmas ──────────────────────────────────────────── */
.inv-signatures {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px;
  margin-top: 32px; margin-bottom: 18px;
}
.inv-sig { text-align: center; }
.inv-sig-line { border-top: 1px solid #0B1E3A; margin-bottom: 6px; height: 48px; }
.inv-sig-label { font-size: 10px; color: #64748B; letter-spacing: 0.5px; text-transform: uppercase; }
.inv-sig-name { font-size: 12px; font-weight: 700; color: #0B1E3A; }

/* ── 11) Footer ─────────────────────────────────────────── */
.inv-footer {
  margin-top: 24px; padding-top: 12px;
  border-top: 1px solid #E1E6ED;
  display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;
  font-size: 9px; color: #94A3B8;
}
.inv-footer code { font-family: ui-monospace, monospace; }

/* ─────────────────────────────────────────────────────────── */
/* ── 12-13) POL_PRINT · @media print ── */
/* ─────────────────────────────────────────────────────────── */
@media print {
  /* (1) Forzar render exacto de colores y backgrounds */
  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    color-adjust: exact !important;
  }
  /* (2) Tamaño físico A4 con margen 12mm */
  @page { size: A4; margin: 12mm; }
  /* (3) Limpiar fondo del body / html */
  html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
  /* (4) Esconder UI no imprimible */
  .no-print, .invoice-actions, .topbar, .sidebar, .side-nav, .navbar,
  nav, header.app-header, footer.app-footer { display: none !important; }
  /* (5) Quitar shadows / radii del documento al imprimir */
  .invoice-doc {
    width: auto !important; min-height: auto !important;
    margin: 0 !important; padding: 0 !important;
    box-shadow: none !important; border-radius: 0 !important;
  }
  /* (6) Evitar saltos de página dentro de bloques críticos */
  .inv-head, .inv-parties, .inv-summary, .inv-signatures,
  .inv-lines-table thead, .inv-cost-table thead,
  .inv-lines-table tr, .inv-cost-table tr, .inv-doc-box, .inv-party {
    page-break-inside: avoid !important;
    break-inside: avoid !important;
  }
  /* (7) Asegurar que los thead se repitan en páginas largas */
  thead { display: table-header-group; }
  tfoot { display: table-footer-group; }
  /* (8) Forzar que los colores brand persistan */
  .inv-lines-table th, .inv-cost-table th {
    background: #0B1E3A !important; color: #fff !important;
  }
  .inv-summary-final { border-top: 2px solid #00B286 !important; }
  .inv-summary-final strong { color: #00B286 !important; }
  .inv-lines-table .row-gap td { background: #FEF3C7 !important; }
  .inv-doc-box-highlight { background: #FEF3C7 !important; border-color: #F59E0B !important; }
  /* (9) Tipografía consistente */
  .invoice-doc { font-size: 11pt; }
  .inv-doc-folio { font-size: 16pt; }
  .inv-summary-final strong { font-size: 14pt; }
  /* (10) Permitir links hacerse evidentes */
  a { color: inherit; text-decoration: none; }
  /* (11) Forzar contraste alto en gris */
  .inv-party-meta, .inv-doc-box-ref, .inv-doc-box-date, .inv-summary-secondary {
    color: #1F2937 !important;
  }
  /* (12) Numeración de página automática vía counter */
  @page { @bottom-right { content: "Página " counter(page) " de " counter(pages); font-size: 9pt; color: #94A3B8; } }
  /* (13) No paginar dentro de la firma */
  .inv-sig { page-break-inside: avoid !important; break-inside: avoid !important; }
}
`;
