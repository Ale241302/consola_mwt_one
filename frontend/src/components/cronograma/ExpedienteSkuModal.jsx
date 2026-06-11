// ─────────────────────────────────────────────────────────────
// ExpedienteSkuModal — SKUs de un expediente (Cronograma React)
// Sprint 2026-06-10 · Agente responsable: [AG-03 FRONTEND]
//
// Click en la Proforma (admin) o en la PO (cliente) → tabla de líneas:
// SKU · Nombre · Talla · Cantidad · Precio MWT (sólo ADMIN/CEO · R3) ·
// Precio Cliente · SAP · Nodo. tabular-nums en todo lo numérico.
// ─────────────────────────────────────────────────────────────
import React from "react";
import { createPortal } from "react-dom";

const usd = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd4 = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const fInt = (n) => Number(n || 0).toLocaleString("es-CR");

export default function ExpedienteSkuModal({ item, isClient, lang = "es", onClose }) {
  if (!item) return null;
  const lineas = item.lineas || [];
  // R3 POL_VISIBILIDAD: precio MWT sólo para ADMIN/CEO.
  const showMwt = !isClient;
  const qtyOf = (l) => Number(l.qty_planned != null ? l.qty_planned : l.qty) || 0;
  const totQty = lineas.reduce((a, l) => a + qtyOf(l), 0);
  const totCli = lineas.reduce((a, l) => a + qtyOf(l) * (Number(l.unit_price_client) || 0), 0);
  const totMwt = lineas.reduce((a, l) => a + qtyOf(l) * (Number(l.unit_price_mwt) || 0), 0);

  return createPortal(
    <div onClick={onClose}
         style={{ position: "fixed", inset: 0, background: "rgba(11,30,58,0.45)", zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()}
           style={{ background: "var(--surface-raised, #fff)", borderRadius: 14, width: "min(860px, 96vw)", maxHeight: "82vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 24px 60px rgba(11,30,58,0.35)" }}>
        <div style={{ padding: "14px 20px", borderBottom: "1.5px solid var(--border-subtle, #E1E6ED)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <div className="micro" style={{ color: "#00B286", letterSpacing: 1, marginBottom: 4 }}>
              {lang === "es" ? "SKUS DEL EXPEDIENTE" : "FILE SKUS"}
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#0B1E3A" }}>
              {/* El código de OC puede venir YA con prefijo "PO" — no
                  duplicarlo ("PO PO 504802"). */}
              {(() => {
                const po = (c) => (/^po[\s_-]/i.test(String(c || "")) ? c : `PO ${c}`);
                return isClient
                  ? (item.ocCodigo ? po(item.ocCodigo) : item.expCodigo)
                  : `${item.proforma}${item.ocCodigo ? " · " + po(item.ocCodigo) : ""}`;
              })()}
            </div>
            <div className="caption" style={{ color: "var(--text-tertiary)", marginTop: 2 }}>
              {[
                // Sprint 2026-06-11 (CEO) · sin EXP interno: admin ve el
                // número SAP (si existe); cliente nada.
                isClient ? null : (item.sap || null),
                item.cliente,
                item.operadoPorMwt ? (lang === "es" ? "Operado por MWT" : "Operated by MWT") : null,
                item.modo || (lang === "es" ? "Aéreo (sup.)" : "Air (assumed)"),
                `${fInt(item.volumen)} ${lang === "es" ? "pares" : "pairs"}`,
              ].filter(Boolean).join(" · ")}
            </div>
          </div>
          <button className="btn btn-ghost btn-xs" onClick={onClose} style={{ padding: "4px 8px", fontSize: 14, lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ overflow: "auto" }}>
          {lineas.length === 0 ? (
            <div className="caption" style={{ padding: 24, textAlign: "center", color: "var(--text-tertiary)" }}>
              {lang === "es" ? "Sin líneas cargadas para este expediente." : "No lines loaded for this file."}
            </div>
          ) : (
            <table className="table" style={{ fontSize: 12.5 }}>
              <thead>
                <tr>
                  <th style={{ whiteSpace: "nowrap" }}>SKU</th>
                  <th>{lang === "es" ? "Nombre" : "Name"}</th>
                  <th style={{ textAlign: "right", whiteSpace: "nowrap" }}>{lang === "es" ? "Talla" : "Size"}</th>
                  <th style={{ textAlign: "right", whiteSpace: "nowrap" }}>{lang === "es" ? "Cant." : "Qty"}</th>
                  {showMwt && (
                    <th style={{ textAlign: "right", whiteSpace: "nowrap" }}>{lang === "es" ? "Precio MWT" : "MWT price"}</th>
                  )}
                  <th style={{ textAlign: "right", whiteSpace: "nowrap" }}>{lang === "es" ? "Precio Cliente" : "Client price"}</th>
                  <th style={{ whiteSpace: "nowrap" }}>SAP</th>
                  <th style={{ whiteSpace: "nowrap" }}>{lang === "es" ? "Nodo" : "Node"}</th>
                </tr>
              </thead>
              <tbody>
                {lineas.map((l, i) => (
                  <tr key={l.linea_id || `${l.sku}-${l.size}-${i}`}>
                    <td className="mono-sm" style={{ fontWeight: 700, color: "var(--brand-primary, #013A57)" }}>{l.sku || "—"}</td>
                    <td style={{ maxWidth: 220, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={l.product_label}>
                      {l.product_label || "—"}
                    </td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>{l.size || "—"}</td>
                    <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 700 }}>{fInt(qtyOf(l))}</td>
                    {showMwt && (
                      <td className="tabular-nums" style={{ textAlign: "right" }}>{usd4(l.unit_price_mwt)}</td>
                    )}
                    <td className="tabular-nums" style={{ textAlign: "right" }}>{usd4(l.unit_price_client)}</td>
                    <td className="mono-sm">{l.sap || "—"}</td>
                    <td className="mono-sm">{l.nodo || "—"}</td>
                  </tr>
                ))}
                <tr style={{ background: "rgba(1,58,87,0.05)", fontWeight: 700 }}>
                  <td colSpan={3}>{lang === "es" ? "Totales" : "Totals"}</td>
                  <td className="tabular-nums" style={{ textAlign: "right" }}>{fInt(totQty)}</td>
                  {showMwt && (
                    <td className="tabular-nums" style={{ textAlign: "right" }}>{usd(totMwt)}</td>
                  )}
                  <td className="tabular-nums" style={{ textAlign: "right", color: "#00B286" }}>{usd(totCli)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
