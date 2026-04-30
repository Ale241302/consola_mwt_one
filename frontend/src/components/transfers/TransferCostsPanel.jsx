// =====================================================================
// MWT.ONE · components/transfers/TransferCostsPanel.jsx
// Agente responsable: [AG-FRONTEND]
//
// Panel editable de costos en /transferencias/{id} (sprint 2026-04-30).
//
// Features:
//   1. Tabla con todas las CostLine (kind / detalle / monto / moneda /
//      FX→USD / total USD / origen / trash).
//   2. SELECT de moneda con el catálogo ISO 4217 (47 monedas).
//   3. + Agregar costo MANUAL — fila inline, valida y persiste.
//   4. Dropzone "Subir documento (DUA / Factura / Liquidación)" →
//      llama POST /api/transferencias/{id}/upload-cost-ocr/ que aplica
//      SKILL_OCR_ADUANAS y hace auto-merge inteligente:
//        · Mismo (kind, currency) → suma al monto existente.
//        · Nuevo (kind, currency)  → agrega línea source=OCR_DUA.
//   5. Trash icon por línea para soft-delete.
//   6. Refresca el callback `onChanged()` tras cada mutación para que
//      el container actualice los totales y el landed cost.
// =====================================================================
import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  IconTrash, IconPlus, IconUpload, IconCheck, IconAlert, IconFileText,
} from "../../lib/icons.jsx";
import {
  transferDetailApi, currencyCatApi, transferenciasApi,
} from "../../lib/api.js";

const VIOLET = "#481EE3";
const MINT   = "#00B286";
const NAVY   = "#0B1E3A";
const AMBER  = "#B45309";
const RED    = "#DC2626";
const GREY   = "#6B7280";

export default function TransferCostsPanel({
  lang = "es",
  transferId,                        // UUID backend
  costLines = [],                    // [{id, kind, label, amount, currency, fx_to_usd, amount_usd, source, ocr_confidence}]
  totalCostUsd = 0,
  onChanged,                          // se llama tras add/remove/OCR para refrescar
  readOnly = false,
}) {
  const [costKinds,  setCostKinds]  = useState([]);
  const [currencies, setCurrencies] = useState([
    { codigo: "USD", nombre: "US Dollar", symbol: "$" },
  ]);
  const [adding,     setAdding]     = useState(false);
  const [draft, setDraft] = useState({
    kind: "", label: "", amount: "", currency: "USD", fx_to_usd: "1.0",
  });
  const [saving,     setSaving]     = useState(false);
  const [ocrBusy,    setOcrBusy]    = useState(false);
  const [ocrSummary, setOcrSummary] = useState(null);
  const [error,      setError]      = useState(null);
  const fileInputRef = useRef(null);

  // ── Catálogos (kind + currencies) ──
  useEffect(() => {
    transferenciasApi.action("select_cost_kinds")
      .then((d) => setCostKinds(Array.isArray(d) ? d : []))
      .catch(() => setCostKinds([]));
    currencyCatApi.list({ is_active: "true", limit: 100 })
      .then((d) => {
        const arr = Array.isArray(d) ? d : (d?.results || []);
        if (arr.length) setCurrencies(arr);
      })
      .catch(() => {});
  }, []);

  // ── Inicializar draft cuando se abre el form ──
  useEffect(() => {
    if (adding && !draft.kind && costKinds.length > 0) {
      setDraft((d) => ({ ...d, kind: costKinds[0].codigo }));
    }
  }, [adding, costKinds]);

  const findKind = (k) => costKinds.find((x) => x.codigo === k);

  // ── Submit del form de costo manual ──
  const submitCost = async () => {
    setError(null);
    if (!draft.kind || !Number(draft.amount)) {
      setError(lang === "es" ? "Tipo y monto son obligatorios." : "Kind and amount are required.");
      return;
    }
    setSaving(true);
    try {
      await transferDetailApi.addCost(transferId, {
        kind:      draft.kind,
        label:     draft.label || null,
        amount:    Number(draft.amount),
        currency:  draft.currency || "USD",
        fx_to_usd: Number(draft.fx_to_usd || 1),
        source:    "MANUAL",
      });
      setAdding(false);
      setDraft({ kind: costKinds[0]?.codigo || "", label: "", amount: "", currency: "USD", fx_to_usd: "1.0" });
      onChanged && onChanged();
    } catch (e) {
      setError(lang === "es" ? "Error al guardar el costo." : "Error saving cost.");
    } finally {
      setSaving(false);
    }
  };

  // ── Eliminar costo ──
  const deleteCost = async (costId) => {
    if (!window.confirm(lang === "es" ? "¿Eliminar este costo?" : "Delete this cost?")) return;
    try {
      await transferDetailApi.removeCost(transferId, costId);
      onChanged && onChanged();
    } catch {
      setError(lang === "es" ? "No se pudo eliminar." : "Could not delete.");
    }
  };

  // ── OCR upload ──
  const handleOcrFile = async (file) => {
    if (!file) return;
    setOcrBusy(true);
    setOcrSummary(null);
    setError(null);
    try {
      const res = await transferDetailApi.uploadCostOcr(transferId, file);
      setOcrSummary(res?.summary || null);
      onChanged && onChanged();
    } catch (e) {
      setError(lang === "es"
        ? `OCR falló: ${e?.message || e}`
        : `OCR failed: ${e?.message || e}`);
    } finally {
      setOcrBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // ── Render ──
  return (
    <div className="card card-pad-md" style={{ marginTop: 16, borderLeft: `4px solid ${VIOLET}` }}>
      {/* Header */}
      <div style={{
        display: "flex", justifyContent: "space-between",
        alignItems: "flex-start", gap: 12, marginBottom: 12,
      }}>
        <div>
          <div className="micro" style={{ color: VIOLET, letterSpacing: 1, marginBottom: 4 }}>
            {lang === "es" ? "2 · COSTOS INCREMENTALES MULTIDIVISA" : "2 · INCREMENTAL MULTI-CURRENCY COSTS"}
          </div>
          <div className="caption" style={{ color: GREY }}>
            {lang === "es"
              ? "Sube un DUA, factura o liquidación para que el motor OCR detecte y agregue costos automáticamente."
              : "Upload a customs declaration or invoice — the OCR engine will detect and merge costs."}
          </div>
        </div>
        {!readOnly && (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={ocrBusy}
              className="btn"
              style={{
                background: ocrBusy ? "#F3F5F8" : NAVY, color: "#fff",
                fontSize: 12, padding: "6px 12px", borderRadius: 8, fontWeight: 600,
              }}
            >
              {ocrBusy
                ? (lang === "es" ? "Procesando…" : "Processing…")
                : (<><IconUpload size={12}/> {lang === "es" ? "Subir documento (IA)" : "Upload doc (AI)"}</>)}
            </button>
            <button
              type="button"
              onClick={() => setAdding((a) => !a)}
              className="btn btn-ghost btn-sm"
              style={{ fontSize: 12 }}
            >
              <IconPlus size={11}/> {lang === "es" ? "Agregar costo" : "Add cost"}
            </button>
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,image/*"
        style={{ display: "none" }}
        onChange={(e) => handleOcrFile(e.target.files?.[0])}
      />

      {/* OCR summary banner */}
      {ocrSummary && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          style={{
            background: "rgba(0,178,134,0.08)", border: "1px solid rgba(0,178,134,0.20)",
            borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 13,
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <IconCheck size={14} style={{ color: MINT }}/>
            <span>
              <strong style={{ color: MINT }}>
                {ocrSummary.added} {lang === "es" ? "nueva(s)" : "new"} ·{" "}
                {ocrSummary.merged} {lang === "es" ? "fusionada(s)" : "merged"}
              </strong>
              {ocrSummary.document_reference && (
                <span style={{ color: GREY, marginLeft: 8 }}>
                  · {lang === "es" ? "Doc:" : "Doc:"} <code className="mono-sm">{ocrSummary.document_reference}</code>
                </span>
              )}
              {ocrSummary.confidence && (
                <span style={{
                  marginLeft: 8, padding: "1px 8px", borderRadius: 999,
                  background: "rgba(72,30,227,0.10)", color: VIOLET,
                  fontSize: 10.5, fontWeight: 700,
                }}>
                  {ocrSummary.confidence}
                </span>
              )}
            </span>
          </div>
          {ocrSummary.gaps_detected && ocrSummary.gaps_detected.length > 0 && (
            <span style={{
              color: AMBER, fontSize: 11.5, fontWeight: 600,
              display: "flex", alignItems: "center", gap: 4,
            }}>
              <IconAlert size={11}/>
              {ocrSummary.gaps_detected.length} gap{ocrSummary.gaps_detected.length !== 1 ? "s" : ""}
            </span>
          )}
          <button onClick={() => setOcrSummary(null)} className="btn btn-ghost btn-sm"
                  style={{ color: GREY, fontSize: 14, padding: "0 6px" }}>×</button>
        </motion.div>
      )}

      {/* Error inline */}
      {error && (
        <div style={{
          background: "rgba(220,38,38,0.06)", color: RED,
          padding: "8px 12px", borderRadius: 6, fontSize: 12.5, marginBottom: 12,
        }}>{error}</div>
      )}

      {/* Tabla de costos */}
      {(costLines.length === 0 && !adding) ? (
        <div style={{
          padding: 18, textAlign: "center", color: GREY, fontSize: 13,
          background: "#FAFBFC", borderRadius: 8,
        }}>
          {lang === "es"
            ? "Sin costos registrados. Sube un DUA o agrega un costo manual."
            : "No costs yet. Upload a customs declaration or add one manually."}
        </div>
      ) : (
        <div className="card card-pad-0" style={{ overflow: "hidden" }}>
          <table className="table" style={{ tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: 150 }}/>
              <col/>
              <col style={{ width: 110 }}/>
              <col style={{ width: 75 }}/>
              <col style={{ width: 90 }}/>
              <col style={{ width: 120 }}/>
              <col style={{ width: 80 }}/>
              <col style={{ width: 50 }}/>
            </colgroup>
            <thead>
              <tr>
                <th>{lang === "es" ? "Tipo" : "Kind"}</th>
                <th>{lang === "es" ? "Detalle" : "Label"}</th>
                <th style={{ textAlign: "right" }}>{lang === "es" ? "Monto" : "Amount"}</th>
                <th style={{ textAlign: "center" }}>{lang === "es" ? "Mon." : "Curr."}</th>
                <th style={{ textAlign: "right" }}>FX→USD</th>
                <th style={{ textAlign: "right" }}>USD</th>
                <th style={{ textAlign: "center" }}>{lang === "es" ? "Origen" : "Source"}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {costLines.map((c) => {
                const k = findKind(c.kind);
                const usd = Number(c.amount_usd ?? Number(c.amount || 0) * Number(c.fx_to_usd || 1));
                return (
                  <tr key={c.id}>
                    <td>
                      <span style={{
                        padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 600,
                        background: `${k?.color || "#64748B"}20`, color: k?.color || "#64748B",
                      }}>{k?.label || c.kind}</span>
                    </td>
                    <td style={{ fontSize: 12.5 }}>{c.label || "—"}</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>
                      {Number(c.amount || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                    </td>
                    <td className="mono-sm" style={{ textAlign: "center", fontWeight: 600, fontSize: 11.5 }}>
                      {(c.currency || "USD").toUpperCase()}
                    </td>
                    <td className="tabular-nums" style={{ textAlign: "right", color: GREY, fontSize: 11.5 }}>
                      {Number(c.fx_to_usd || 1).toFixed(4)}
                    </td>
                    <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 700, color: MINT }}>
                      ${usd.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <span style={{
                        padding: "2px 8px", borderRadius: 999, fontSize: 10, fontWeight: 700,
                        background: c.source === "OCR_DUA" ? "rgba(0,178,134,0.12)" : "#F3F5F8",
                        color:      c.source === "OCR_DUA" ? MINT : GREY,
                      }}>
                        {c.source === "OCR_DUA" ? "IA" : (c.source || "MANUAL")}
                      </span>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => deleteCost(c.id)}
                          title={lang === "es" ? "Eliminar costo" : "Remove cost"}
                          className="btn btn-ghost btn-sm"
                          style={{ color: RED, padding: "4px 6px" }}
                        >
                          <IconTrash size={13}/>
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}

              {/* Form de adición inline */}
              {adding && (
                <tr style={{ background: "rgba(72,30,227,0.04)" }}>
                  <td>
                    <select className="input" style={{ width: "100%" }}
                            value={draft.kind}
                            onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
                      {costKinds.map((k) => (
                        <option key={k.codigo} value={k.codigo}>{k.label}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input className="input" style={{ width: "100%" }}
                           value={draft.label}
                           placeholder={lang === "es" ? "Detalle (opcional)" : "Label (optional)"}
                           onChange={(e) => setDraft({ ...draft, label: e.target.value })}/>
                  </td>
                  <td>
                    <input className="input tabular-nums" type="number" step="0.01" min="0"
                           style={{ width: "100%", textAlign: "right" }}
                           value={draft.amount}
                           onChange={(e) => setDraft({ ...draft, amount: e.target.value })}/>
                  </td>
                  <td>
                    <select className="input mono-sm" style={{ width: "100%", textAlign: "center", padding: "6px 4px" }}
                            value={draft.currency}
                            onChange={(e) => setDraft({ ...draft, currency: e.target.value })}>
                      {currencies.map((cur) => (
                        <option key={cur.codigo} value={cur.codigo}>{cur.codigo}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input className="input tabular-nums" type="number" step="0.0001" min="0"
                           style={{ width: "100%", textAlign: "right" }}
                           value={draft.fx_to_usd}
                           onChange={(e) => setDraft({ ...draft, fx_to_usd: e.target.value })}/>
                  </td>
                  <td colSpan={2} style={{ textAlign: "center" }}>
                    <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                      <button type="button" onClick={submitCost} disabled={saving}
                              className="btn"
                              style={{ background: MINT, color: "#fff", fontSize: 11, padding: "5px 10px" }}>
                        {saving ? "…" : (lang === "es" ? "Guardar" : "Save")}
                      </button>
                      <button type="button" onClick={() => setAdding(false)}
                              className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}>
                        {lang === "es" ? "Cancelar" : "Cancel"}
                      </button>
                    </div>
                  </td>
                  <td></td>
                </tr>
              )}

              {/* Total */}
              <tr style={{ background: "rgba(0,178,134,0.06)", fontWeight: 700 }}>
                <td colSpan={5} style={{ textAlign: "right", color: NAVY }}>
                  {lang === "es" ? "Total USD" : "Total USD"}
                </td>
                <td className="tabular-nums" style={{ textAlign: "right", color: MINT, fontSize: 14 }}>
                  ${Number(totalCostUsd || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                </td>
                <td colSpan={2}></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
