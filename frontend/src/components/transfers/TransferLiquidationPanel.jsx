// ─────────────────────────────────────────────────────────────
// TransferLiquidationPanel — Liquidación / Landed Cost
// Sprint Transfer Engine v3 · 2026-04-29
// Agente responsable: [AG-FRONTEND]
//
// Vista interna (CEO-ONLY / INTERNAL · POL_VISIBILIDAD) que se inserta
// en /transferencias/{id}.
//
// 3 secciones:
//   1. Contexto y Documentación Legal — tipo + chips a docs (DUA, BL/AWB).
//   2. Registro de Costos Multidivisa — tabla editable de cost_lines.
//   3. Resumen de Landed Cost (factura interna) — preview en vivo,
//      botón "Liquidar y transferir inventario".
//
// Tokens: Navy #0B1E3A · Mint #00B286 · tabular-nums.
// ─────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  IconCheck, IconX, IconPlus, IconAlert, IconRefresh, IconFileText,
  IconDollar, IconLock, IconClipboard,
} from "../../lib/icons.jsx";
import { transferenciasApi } from "../../lib/api.js";

// ── Catálogo fallback de tipos de costo (espejo del backend) ──
const COST_KINDS_FALLBACK = [
  { codigo:"DAI",           label:"Aranceles (DAI)",     is_fiscal:true,  color:"#481EE3" },
  { codigo:"IVA",           label:"Impuestos (IVA)",     is_fiscal:true,  color:"#7C3AED" },
  { codigo:"ALMACENAJE",    label:"Almacenaje aduanal",  is_fiscal:false, color:"#0891B2" },
  { codigo:"AGENCIAMIENTO", label:"Agenciamiento",       is_fiscal:false, color:"#0EA5E9" },
  { codigo:"MANIPULEO",     label:"Manipuleo / handling",is_fiscal:false, color:"#06B6D4" },
  { codigo:"FLETE",         label:"Flete",               is_fiscal:false, color:"#3083FE" },
  { codigo:"SEGURO",        label:"Seguro",              is_fiscal:false, color:"#10B981" },
  { codigo:"CONSOLIDACION", label:"Consolidación",       is_fiscal:false, color:"#22C55E" },
  { codigo:"OTRO",          label:"Otro",                is_fiscal:false, color:"#64748B" },
];

const CURRENCIES = ["USD", "PEN", "MXN", "COP", "CLP", "BRL", "ARS", "CRC", "EUR"];

const fmt = (n) => Number(n || 0).toLocaleString("en-US", {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const fmt4 = (n) => Number(n || 0).toLocaleString("en-US", {
  minimumFractionDigits: 4, maximumFractionDigits: 4,
});

export default function TransferLiquidationPanel({ transfer, lang = "es", onLiquidated }) {
  const transferId = transfer?._backend_id || transfer?.id;

  // Estado local de cost lines editables (espejo del backend)
  const [costLines,  setCostLines]  = useState([]);
  const [costKinds,  setCostKinds]  = useState(COST_KINDS_FALLBACK);
  const [report,     setReport]     = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [liquidating, setLiquidating] = useState(false);
  const [error,      setError]      = useState(null);
  const [success,    setSuccess]    = useState(null);
  const [confirming, setConfirming] = useState(false);

  // ── Carga inicial: cost lines + preview report ──
  const load = useCallback(async () => {
    if (!transferId) return;
    setLoading(true); setError(null);
    try {
      const [costs, rpt] = await Promise.all([
        transferenciasApi.action("cost-lines", transferId).catch(() => []),
        transferenciasApi.action("liquidation_report", transferId).catch(() => null),
      ]);
      setCostLines(Array.isArray(costs) ? costs : (costs?.results || []));
      setReport(rpt);
    } catch (e) {
      setError(e?.message || "fetch_failed");
    } finally {
      setLoading(false);
    }
  }, [transferId]);

  useEffect(() => { load(); }, [load]);

  // Catálogo de tipos de costo
  useEffect(() => {
    transferenciasApi.action("select_cost_kinds")
      .then((d) => { if (Array.isArray(d) && d.length) setCostKinds(d); })
      .catch(() => {});
  }, []);

  const isLiquidated = !!transfer?._raw?.liquidated_at || !!report?.liquidated_at;

  // ── Cálculo en vivo del preview (sin pegarle al backend cada keystroke) ──
  const livePreview = useMemo(() => {
    const lineas = transfer?.lines || transfer?.lineas || [];
    let fobTotal = 0;
    const lineValues = lineas.map((l) => {
      const qty = Number(l.qty_transfer || 0);
      const uv  = Number(l._raw?.unit_value || l.unit_value || l.unit_cost || 0);
      const lt  = qty * uv;
      fobTotal += lt;
      return { l, qty, uv, lt };
    });
    let extraUsd = 0;
    for (const c of costLines) {
      extraUsd += Number(c.amount || 0) * Number(c.fx_to_usd || 1);
    }
    const lines = lineValues.map(({ l, qty, uv, lt }) => {
      const weight     = fobTotal > 0 ? lt / fobTotal : 0;
      const costShare  = extraUsd * weight;
      const landedUnit = qty > 0 ? uv + (costShare / qty) : uv;
      return {
        line_id:          l._line_id || l.id,
        sku:              l.sku || "",
        product_label:    l.product_label || l.product || "",
        size:             l.size || "",
        lote:             l.lote || l.lot || "",
        qty,
        unit_fob_usd:     uv,
        fob_total_usd:    lt,
        weight_pct:       weight * 100,
        cost_share_usd:   costShare,
        landed_unit_usd:  landedUnit,
        landed_total_usd: landedUnit * qty,
      };
    });
    const unitsTotal = lineValues.reduce((a, x) => a + x.qty, 0);
    const landedTotal = lines.reduce((a, x) => a + x.landed_total_usd, 0);
    return {
      fobTotal, extraUsd, unitsTotal, landedTotal,
      avgLanded: unitsTotal > 0 ? landedTotal / unitsTotal : 0,
      lines,
    };
  }, [transfer, costLines]);

  // ── Cost line CRUD (server-side persiste; trigger SQL actualiza total_cost_usd) ──
  const addCost = async () => {
    setSaving(true); setError(null);
    try {
      const created = await transferenciasApi.action("cost-lines", transferId, {
        kind: "OTRO", label: "", amount: 0, currency: "USD",
        fx_to_usd: 1, source: "MANUAL",
      });
      setCostLines((prev) => [...prev, created]);
    } catch (e) { setError(e?.message || "create_failed"); }
    finally { setSaving(false); }
  };

  const updateCost = (id, patch) => {
    setCostLines((prev) => prev.map((c) => c.id === id ? { ...c, ...patch } : c));
  };

  const persistCost = async (c) => {
    // El backend no tiene PATCH directo de cost-line — lo hacemos via
    // delete + create (idempotente para MVP). En siguiente iteración:
    // PATCH /api/transfer-cost-lines/{id}/ vía CostLineViewSet.
    setSaving(true); setError(null);
    try {
      await transferenciasApi.action(`cost-lines/${c.id}`, transferId, undefined);
    } catch {}
    try {
      const created = await transferenciasApi.action("cost-lines", transferId, {
        kind:           c.kind,
        label:          c.label || "",
        amount:         Number(c.amount) || 0,
        currency:       c.currency || "USD",
        fx_to_usd:      Number(c.fx_to_usd) || 1,
        source:         c.source || "MANUAL",
        ocr_confidence: c.ocr_confidence ?? null,
      });
      setCostLines((prev) => prev.map((x) => x.id === c.id ? created : x));
    } catch (e) { setError(e?.message || "save_failed"); }
    finally { setSaving(false); }
  };

  const removeCost = async (id) => {
    setSaving(true); setError(null);
    try {
      await fetch(`/api/transferencias/${transferId}/cost-lines/${id}/`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      setCostLines((prev) => prev.filter((c) => c.id !== id));
    } catch (e) { setError(e?.message || "delete_failed"); }
    finally { setSaving(false); }
  };

  // ── Liquidar (persistir landed_cost_usd por línea) ──
  const liquidate = async () => {
    setLiquidating(true); setError(null); setSuccess(null);
    try {
      const r = await transferenciasApi.action("liquidate", transferId, {
        method: "BY_VALUE",
      });
      setReport(r);
      setSuccess(lang === "es"
        ? `✓ Liquidado. Landed cost total: $${fmt(r.summary.landed_total_usd)} USD.`
        : `✓ Liquidated. Total landed cost: $${fmt(r.summary.landed_total_usd)} USD.`);
      setConfirming(false);
      onLiquidated?.(r);
    } catch (e) {
      setError(e?.message || "liquidate_failed");
    } finally {
      setLiquidating(false);
    }
  };

  if (!transferId) return null;

  // Documentos legales referenciados
  const documents = transfer?._raw?.documentos || [];
  const dua = documents.find((d) => d.tipo === "DUA");
  const bl  = documents.find((d) => d.tipo === "BL" || d.tipo === "AWB");
  const factura = documents.find((d) => d.tipo === "FACTURA");
  const remision = documents.find((d) => d.tipo === "REMISION");

  return (
    <div style={{ marginTop: 24 }}>
      {/* ── Header CEO-ONLY ────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10, marginBottom: 14,
        padding: "12px 16px", background: "linear-gradient(135deg, #0B1E3A 0%, #1A2A5C 100%)",
        color: "#fff", borderRadius: 12,
      }}>
        <IconLock size={16} style={{ color: "#1DE394" }} />
        <div style={{ flex: 1 }}>
          <div className="micro" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: 1 }}>
            {lang === "es" ? "LIQUIDACIÓN INTERNA · CEO-ONLY" : "INTERNAL LIQUIDATION · CEO-ONLY"}
          </div>
          <div style={{ fontSize: 17, fontWeight: 700, color: "#fff" }}>
            {lang === "es" ? "Landed Cost · Factura interna de transferencia" : "Landed Cost · Internal transfer invoice"}
          </div>
        </div>
        {isLiquidated && (
          <span style={{
            padding: "4px 10px", borderRadius: 999,
            background: "rgba(0,178,134,0.20)", color: "#1DE394",
            fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
          }}>
            ✓ {lang === "es" ? "LIQUIDADA" : "LIQUIDATED"}
          </span>
        )}
      </div>

      {error && (
        <div style={{
          padding: "10px 14px", marginBottom: 12, borderRadius: 8,
          background: "#FEE2E2", border: "1px solid #FCA5A5",
          color: "#991B1B", fontSize: 13,
        }}>
          <IconAlert size={12} style={{ verticalAlign: -1, marginRight: 6 }}/> {error}
        </div>
      )}
      {success && (
        <div style={{
          padding: "10px 14px", marginBottom: 12, borderRadius: 8,
          background: "rgba(0,178,134,0.10)", border: "1px solid rgba(0,178,134,0.40)",
          color: "#0B1E3A", fontSize: 13,
        }}>{success}</div>
      )}

      {/* ── Sección 1 · Contexto y Documentos ───────── */}
      <div className="card card-pad-md" style={{ marginBottom: 14 }}>
        <div className="micro" style={{ color: "#00B286", letterSpacing: 1, marginBottom: 10 }}>
          {lang === "es" ? "1 · CONTEXTO Y DOCUMENTACIÓN LEGAL" : "1 · LEGAL CONTEXT & DOCUMENTS"}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          <Field label={lang === "es" ? "Motivo legal" : "Legal context"}
                 value={<span style={{ fontWeight: 700 }}>{transfer?.legal_context || "INTERNAL"}</span>}/>
          <Field label="Origen → Destino"
                 value={<span><strong>{transfer?.origen}</strong> → <strong>{transfer?.destino}</strong></span>}/>
          <Field label={lang === "es" ? "Tracking" : "Tracking"}
                 value={<code className="mono-sm">{transfer?.ref_tracking || "—"}</code>}/>
        </div>
        <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <DocChip doc={factura} fallbackLabel={lang === "es" ? "Factura comercial" : "Commercial invoice"} kind="FACTURA"/>
          <DocChip doc={dua}     fallbackLabel="DUA"           kind="DUA"/>
          <DocChip doc={bl}      fallbackLabel="BL / AWB"      kind="BL"/>
          <DocChip doc={remision} fallbackLabel={lang === "es" ? "Remisión" : "Waybill"} kind="REMISION"/>
        </div>
      </div>

      {/* ── Sección 2 · Registro de Costos Multidivisa ── */}
      <div className="card card-pad-md" style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div className="micro" style={{ color: "#00B286", letterSpacing: 1 }}>
            {lang === "es" ? "2 · COSTOS INCREMENTALES MULTIDIVISA" : "2 · MULTI-CURRENCY INCREMENTAL COSTS"}
          </div>
          {!isLiquidated && (
            <button className="btn btn-ghost btn-sm" onClick={addCost} disabled={saving}>
              <IconPlus size={11}/> {lang === "es" ? "Agregar costo" : "Add cost"}
            </button>
          )}
        </div>

        {costLines.length === 0 ? (
          <div className="caption" style={{ color: "var(--text-tertiary)", padding: 18, textAlign: "center" }}>
            {lang === "es"
              ? "Sin costos registrados. Agregá flete, aranceles o seguros para que el motor calcule el landed cost."
              : "No costs yet. Add freight, duties or insurance to compute landed cost."}
          </div>
        ) : (
          <div className="card card-pad-0" style={{ overflow: "hidden" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>{lang === "es" ? "Tipo" : "Kind"}</th>
                  <th>{lang === "es" ? "Detalle" : "Label"}</th>
                  <th style={{ textAlign: "right" }}>{lang === "es" ? "Monto" : "Amount"}</th>
                  <th>{lang === "es" ? "Moneda" : "Curr."}</th>
                  <th style={{ textAlign: "right" }}>FX→USD</th>
                  <th style={{ textAlign: "right" }}>USD</th>
                  <th>{lang === "es" ? "Origen" : "Source"}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {costLines.map((c) => {
                  const usd = Number(c.amount || 0) * Number(c.fx_to_usd || 1);
                  const isOcr = c.source === "OCR_DUA";
                  return (
                    <tr key={c.id}>
                      <td>
                        <select className="input" style={{ minWidth: 140 }}
                                value={c.kind} disabled={isLiquidated}
                                onChange={(e) => updateCost(c.id, { kind: e.target.value })}
                                onBlur={() => persistCost(c)}>
                          {costKinds.map((k) => <option key={k.codigo} value={k.codigo}>{k.label}</option>)}
                        </select>
                      </td>
                      <td>
                        <input className="input" value={c.label || ""}
                               disabled={isLiquidated}
                               placeholder={costKinds.find((k) => k.codigo === c.kind)?.label || ""}
                               onChange={(e) => updateCost(c.id, { label: e.target.value })}
                               onBlur={() => persistCost(c)}/>
                      </td>
                      <td>
                        <input className="input tabular-nums" type="number" step="0.01" min="0"
                               style={{ width: 110, textAlign: "right" }}
                               value={c.amount} disabled={isLiquidated}
                               onChange={(e) => updateCost(c.id, { amount: e.target.value })}
                               onBlur={() => persistCost(c)}/>
                      </td>
                      <td>
                        <select className="input mono-sm" style={{ width: 76 }}
                                value={c.currency} disabled={isLiquidated}
                                onChange={(e) => updateCost(c.id, { currency: e.target.value })}
                                onBlur={() => persistCost(c)}>
                          {CURRENCIES.map((cur) => <option key={cur} value={cur}>{cur}</option>)}
                        </select>
                      </td>
                      <td>
                        <input className="input tabular-nums" type="number" step="0.0001" min="0"
                               style={{ width: 90, textAlign: "right" }}
                               value={c.fx_to_usd} disabled={isLiquidated || c.currency === "USD"}
                               onChange={(e) => updateCost(c.id, { fx_to_usd: e.target.value })}
                               onBlur={() => persistCost(c)}/>
                      </td>
                      <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 700, color: "#0B1E3A" }}>
                        ${fmt(usd)}
                      </td>
                      <td>
                        {isOcr ? (
                          <span style={{
                            padding: "2px 8px", borderRadius: 999, fontSize: 10, fontWeight: 700,
                            background: "rgba(0,178,134,0.12)", color: "#00B286",
                          }}>IA · {Math.round(c.ocr_confidence || 0)}%</span>
                        ) : (
                          <span style={{ padding: "2px 8px", borderRadius: 999, fontSize: 10, fontWeight: 600,
                                         background: "var(--surface-soft, #F3F5F8)", color: "var(--text-tertiary)" }}>
                            {c.source}
                          </span>
                        )}
                      </td>
                      <td>
                        {!isLiquidated && (
                          <button className="btn btn-ghost btn-sm"
                                  onClick={() => removeCost(c.id)}
                                  style={{ color: "#D64545" }} disabled={saving}>
                            <IconX size={11}/>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                <tr style={{ background: "rgba(0,178,134,0.06)", fontWeight: 700 }}>
                  <td colSpan={5} style={{ textAlign: "right", color: "#0B1E3A" }}>
                    {lang === "es" ? "Bolsa de costos en USD" : "Total cost pool in USD"}
                  </td>
                  <td className="tabular-nums" style={{ textAlign: "right", color: "#00B286", fontSize: 15 }}>
                    ${fmt(livePreview.extraUsd)}
                  </td>
                  <td colSpan={2}></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Sección 3 · Resumen de Landed Cost ───────── */}
      <div className="card card-pad-md" style={{ marginBottom: 14 }}>
        <div className="micro" style={{ color: "#00B286", letterSpacing: 1, marginBottom: 12 }}>
          {lang === "es" ? "3 · LANDED COST · FACTURA INTERNA" : "3 · LANDED COST · INTERNAL INVOICE"}
        </div>

        {/* Financial summary card */}
        <div style={{
          background: "linear-gradient(135deg, #0B1E3A 0%, #1A2A5C 100%)",
          color: "#fff", padding: "20px 22px", borderRadius: 12, marginBottom: 14,
        }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
            <SummaryStat label={lang === "es" ? "Total FOB" : "Total FOB"}
                         value={`$${fmt(livePreview.fobTotal)}`}/>
            <SummaryStat label={lang === "es" ? "Costos extra" : "Extra costs"}
                         value={`$${fmt(livePreview.extraUsd)}`}
                         color="#F59E0B"/>
            <SummaryStat label={lang === "es" ? "Landed total" : "Landed total"}
                         value={<><span style={{ color: "#1DE394" }}>${fmt(livePreview.landedTotal)}</span></>}
                         strong/>
            <SummaryStat label={lang === "es" ? "Promedio / unidad" : "Avg / unit"}
                         value={`$${fmt4(livePreview.avgLanded)}`}/>
          </div>
        </div>

        {livePreview.lines.length === 0 ? (
          <div className="caption" style={{ color: "var(--text-tertiary)", padding: 18, textAlign: "center" }}>
            {lang === "es" ? "Sin líneas de mercadería para calcular." : "No lines to compute."}
          </div>
        ) : (
          <div className="card card-pad-0">
            <table className="table">
              <thead>
                <tr>
                  <th>SKU / {lang === "es" ? "Lote" : "Lot"}</th>
                  <th>{lang === "es" ? "Producto" : "Product"}</th>
                  <th>{lang === "es" ? "Talla" : "Size"}</th>
                  <th style={{ textAlign: "right" }}>{lang === "es" ? "Cant." : "Qty"}</th>
                  <th style={{ textAlign: "right" }}>{lang === "es" ? "FOB unit." : "Unit FOB"}</th>
                  <th style={{ textAlign: "right" }}>FOB total</th>
                  <th style={{ textAlign: "right" }}>%</th>
                  <th style={{ textAlign: "right" }}>{lang === "es" ? "Costo asignado" : "Cost share"}</th>
                  <th style={{ textAlign: "right" }}>
                    <strong style={{ color: "#00B286" }}>
                      {lang === "es" ? "Landed unit." : "Landed unit"}
                    </strong>
                  </th>
                  <th style={{ textAlign: "right" }}>{lang === "es" ? "Landed total" : "Landed total"}</th>
                </tr>
              </thead>
              <tbody>
                {livePreview.lines.map((l) => (
                  <tr key={l.line_id}>
                    <td className="mono-sm">
                      <div>{l.sku}</div>
                      {l.lote && <div className="caption">L: {l.lote}</div>}
                    </td>
                    <td>{l.product_label}</td>
                    <td>{l.size || "—"}</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>{l.qty}</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>${fmt4(l.unit_fob_usd)}</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>${fmt(l.fob_total_usd)}</td>
                    <td className="tabular-nums" style={{ textAlign: "right", color: "var(--text-tertiary)" }}>
                      {l.weight_pct.toFixed(1)}%
                    </td>
                    <td className="tabular-nums" style={{ textAlign: "right", color: "#F59E0B" }}>
                      +${fmt(l.cost_share_usd)}
                    </td>
                    <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 700, color: "#00B286" }}>
                      ${fmt4(l.landed_unit_usd)}
                    </td>
                    <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 700 }}>
                      ${fmt(l.landed_total_usd)}
                    </td>
                  </tr>
                ))}
                <tr style={{ background: "rgba(0,178,134,0.06)", fontWeight: 700 }}>
                  <td colSpan={3} style={{ color: "#0B1E3A" }}>
                    {lang === "es" ? "TOTALES" : "TOTALS"}
                  </td>
                  <td className="tabular-nums" style={{ textAlign: "right" }}>{livePreview.unitsTotal}</td>
                  <td colSpan={2} className="tabular-nums" style={{ textAlign: "right" }}>${fmt(livePreview.fobTotal)}</td>
                  <td></td>
                  <td className="tabular-nums" style={{ textAlign: "right", color: "#F59E0B" }}>
                    +${fmt(livePreview.extraUsd)}
                  </td>
                  <td></td>
                  <td className="tabular-nums" style={{ textAlign: "right", color: "#00B286", fontSize: 15 }}>
                    ${fmt(livePreview.landedTotal)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* ── Botón Liquidar ─────────────────── */}
        {!isLiquidated && livePreview.lines.length > 0 && (
          <div style={{ marginTop: 18, display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button className="btn btn-ghost" onClick={load} disabled={loading || liquidating}>
              <IconRefresh size={12}/> {lang === "es" ? "Refrescar" : "Refresh"}
            </button>
            <button
              className="btn btn-accent"
              onClick={() => setConfirming(true)}
              disabled={liquidating || livePreview.extraUsd === 0}
              style={{
                background: "var(--btn-primary, #00B286)",
                borderColor: "var(--btn-primary, #00B286)",
                minWidth: 280, fontWeight: 700,
              }}>
              {liquidating
                ? (lang === "es" ? "Liquidando…" : "Liquidating…")
                : <><IconCheck size={12}/> {lang === "es" ? "Liquidar y transferir inventario" : "Liquidate & transfer inventory"}</>
              }
            </button>
          </div>
        )}

        {isLiquidated && report?.liquidated_at && (
          <div className="caption" style={{
            marginTop: 14, padding: "10px 14px", borderRadius: 8,
            background: "rgba(0,178,134,0.06)", color: "#0B1E3A",
          }}>
            ✓ {lang === "es" ? "Liquidada el " : "Liquidated on "}
            <strong>{new Date(report.liquidated_at).toLocaleString()}</strong>
            {report.liquidated_by_name && <> {lang === "es" ? "por" : "by"} <strong>{report.liquidated_by_name}</strong></>}
            {" · "} {lang === "es" ? "Método" : "Method"}: <code className="mono-sm">{report.method}</code>
          </div>
        )}
      </div>

      {/* ── Modal de confirmación ─────────────────── */}
      {confirming && (
        <ConfirmModal
          lang={lang}
          summary={livePreview}
          onCancel={() => setConfirming(false)}
          onConfirm={liquidate}
          busy={liquidating}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
function Field({ label, value }) {
  return (
    <div>
      <div className="caption" style={{ color: "var(--text-tertiary)", marginBottom: 3 }}>
        {label}
      </div>
      <div style={{ color: "#0B1E3A", fontSize: 14 }}>{value}</div>
    </div>
  );
}

function SummaryStat({ label, value, color, strong }) {
  return (
    <div>
      <div className="micro" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: 1, marginBottom: 4 }}>
        {label}
      </div>
      <div className="tabular-nums" style={{
        fontSize: strong ? 24 : 18, fontWeight: 700,
        color: color || "#fff",
      }}>
        {value}
      </div>
    </div>
  );
}

function DocChip({ doc, fallbackLabel, kind }) {
  if (!doc) {
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px",
        borderRadius: 999, background: "rgba(100,116,139,0.08)",
        color: "var(--text-tertiary)", fontSize: 12, fontStyle: "italic",
      }}>
        <IconFileText size={11}/> {fallbackLabel} —
      </span>
    );
  }
  const url = doc.url || (doc.object_key ? `/api/storage/signed_url/?key=${encodeURIComponent(doc.object_key)}` : null);
  return (
    <a href={url || "#"} target="_blank" rel="noopener noreferrer"
       style={{
         display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px",
         borderRadius: 999, background: "rgba(0,178,134,0.10)",
         color: "#0B1E3A", fontSize: 12, fontWeight: 600, textDecoration: "none",
         border: "1px solid rgba(0,178,134,0.25)",
       }}>
      <IconFileText size={11} style={{ color: "#00B286" }}/>
      {doc.titulo || fallbackLabel}
      {doc.numero_ref && <code className="mono-sm" style={{ color: "var(--text-tertiary)" }}>{doc.numero_ref}</code>}
    </a>
  );
}

function ConfirmModal({ lang, summary, onCancel, onConfirm, busy }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "rgba(11,30,58,0.55)", backdropFilter: "blur(2px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }} onClick={busy ? undefined : onCancel}>
      <div onClick={(e) => e.stopPropagation()}
           style={{
             background: "#fff", borderRadius: 14, width: "min(520px, 96vw)",
             padding: 26, boxShadow: "0 30px 60px -20px rgba(15,27,61,0.55)",
           }}>
        <div className="micro" style={{ color: "#00B286", letterSpacing: 1, marginBottom: 6 }}>
          {lang === "es" ? "CONFIRMAR LIQUIDACIÓN" : "CONFIRM LIQUIDATION"}
        </div>
        <div style={{ font: "700 18px/1.3 inherit", color: "#0B1E3A", marginBottom: 10 }}>
          {lang === "es" ? "¿Liquidar y transferir inventario?" : "Liquidate and transfer inventory?"}
        </div>
        <div className="caption" style={{ color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: 14 }}>
          {lang === "es"
            ? "Esta acción congelará el landed cost por línea y dejará el inventario listo para impactar al nodo destino con su costo real. La acción es auditable pero no totalmente reversible."
            : "This will freeze the landed cost per line and prepare inventory to land at the destination node with its real cost. Auditable but not fully reversible."}
        </div>
        <div style={{ padding: 14, borderRadius: 10, background: "rgba(0,178,134,0.06)", marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span className="caption">FOB</span>
            <span className="tabular-nums" style={{ fontWeight: 600 }}>${fmt(summary.fobTotal)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span className="caption">{lang === "es" ? "Costos extra" : "Extra costs"}</span>
            <span className="tabular-nums" style={{ fontWeight: 600, color: "#F59E0B" }}>+${fmt(summary.extraUsd)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 8, borderTop: "1px solid rgba(0,178,134,0.20)" }}>
            <span style={{ fontWeight: 700, color: "#0B1E3A" }}>Landed</span>
            <span className="tabular-nums" style={{ fontWeight: 700, color: "#00B286", fontSize: 16 }}>
              ${fmt(summary.landedTotal)}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            {lang === "es" ? "Cancelar" : "Cancel"}
          </button>
          <button className="btn btn-accent" onClick={onConfirm} disabled={busy}
                  style={{
                    minWidth: 200, fontWeight: 700,
                    background: "var(--btn-primary, #00B286)",
                    borderColor: "var(--btn-primary, #00B286)",
                  }}>
            {busy
              ? (lang === "es" ? "Liquidando…" : "Liquidating…")
              : (lang === "es" ? "Sí, liquidar" : "Yes, liquidate")}
          </button>
        </div>
      </div>
    </div>
  );
}

function getToken() {
  try {
    const raw = localStorage.getItem("mwt-auth");
    if (raw) {
      const p = JSON.parse(raw);
      return p?.access || p?.token || "";
    }
  } catch {}
  return localStorage.getItem("mwt_access") || localStorage.getItem("access") || "";
}
