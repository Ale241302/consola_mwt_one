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
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
// Renombrado para no chocar con la `ConfirmModal` local de liquidación
// (que tiene un summary preview específico). Este es el genérico de
// destrucción que usa la sección de costos para "¿Eliminar este costo?".
import GenericConfirmModal from "../common/ConfirmModal.jsx";
import CostScopeModal from "./CostScopeModal.jsx";
import TransferBuilderArtifactsBlock from "./TransferBuilderArtifactsBlock.jsx";
import {
  IconCheck, IconX, IconPlus, IconAlert, IconRefresh, IconFileText,
  IconDollar, IconLock, IconClipboard, IconUpload, IconTrash,
} from "../../lib/icons.jsx";
import {
  transferenciasApi, transferDetailApi, currencyCatApi, transferLineasApi,
  nodosApi,
} from "../../lib/api.js";
import { useRole } from "../../context/RoleContext.jsx";
import { isMwtOperated, MWT_OPERATING_CLIENT_ID } from "../../lib/operatingCompany.js";

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

// Sprint 2026-05-14 · Fase 15 — catálogo de motivos legales para el
// dropdown editable. Espejo de transfers.legal_context_cat.
const LEGAL_CONTEXT_OPTIONS = [
  { codigo: "INTERNAL",        label: { es: "Interno / Redistribución", en: "Internal / Redistribution" } },
  { codigo: "NATIONALIZATION", label: { es: "Nacionalización",          en: "Nationalization" } },
  { codigo: "EXPORT",          label: { es: "Reexportación",            en: "Re-export" } },
  { codigo: "DISTRIBUTION",    label: { es: "Distribución",             en: "Distribution" } },
  { codigo: "CONSIGNMENT",     label: { es: "Consignación",             en: "Consignment" } },
];

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
  // Sprint 2026-05-14 · Fase 14 — scope picker para cost-lines del
  // TransferDetail. Reutiliza CostScopeModal (mismo del wizard).
  //   - scopeOpenFor: cost.id ó null
  //   - creatingNewScope: bool (flow "+ Agregar costo" abre el modal
  //     primero; al guardar se inserta la fila con scope ya aplicado).
  const [scopeOpenFor, setScopeOpenFor]       = useState(null);
  const [creatingNewScope, setCreatingNewScope] = useState(false);

  // Sprint 2026-05-14 · Fase 15 — header editable (admin only).
  // El admin puede cambiar motivo, origen, destino, tracking,
  // dispatched_at y ETA en cualquier momento. Backend ya tiene PATCH.
  const { isAdmin, isClient } = useRole();
  const canEdit = isAdmin && !isClient;
  // Sprint 2026-05-22 · viewer-aware basado en el VIEWPORT EFECTIVO.
  // `isAdmin` ya respeta el toggle del Tweaks (admin previewing como
  // Cliente B2B → isAdmin=false → ve unit_price_client). El override
  // del Tweaks es la fuente de verdad — NO consultamos
  // user.legal_entity_ids porque eso ignoraría la previsualización.
  const viewerIsMwt = !!isAdmin;
  const [headerEdit, setHeaderEdit] = useState({});  // patch pendiente
  const [headerSaving, setHeaderSaving] = useState(false);
  const [headerError, setHeaderError] = useState(null);
  const [nodos, setNodos] = useState([]);
  useEffect(() => {
    if (!canEdit) return;
    nodosApi.list({ is_active: true })
      .then((d) => setNodos(Array.isArray(d) ? d : (d?.results || [])))
      .catch(() => setNodos([]));
  }, [canEdit]);
  const headerVal = (k, fallback) =>
    headerEdit[k] !== undefined ? headerEdit[k] : (transfer?.[k] ?? fallback ?? "");
  const setHV = (k, v) => setHeaderEdit((p) => ({ ...p, [k]: v }));
  const persistHeader = async (patch) => {
    if (!transferId) return;
    setHeaderSaving(true); setHeaderError(null);
    try {
      await transferenciasApi.update(transferId, patch);
      onLiquidated?.();   // re-fetch del padre
      setHeaderEdit((p) => {
        const next = { ...p };
        for (const k of Object.keys(patch)) delete next[k];
        return next;
      });
    } catch (e) {
      setHeaderError(e?.message || (lang === "es" ? "Error al guardar" : "Save failed"));
    } finally {
      setHeaderSaving(false);
    }
  };
  const [report,     setReport]     = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [liquidating, setLiquidating] = useState(false);
  const [error,      setError]      = useState(null);
  const [success,    setSuccess]    = useState(null);
  const [confirming, setConfirming] = useState(false);

  // Sprint 2026-04-30 — OCR upload + currencies catalog
  const [ocrBusy,    setOcrBusy]    = useState(false);
  const [ocrSummary, setOcrSummary] = useState(null);
  const [currencies, setCurrencies] = useState(
    CURRENCIES.map((c) => ({ codigo: c, nombre: c, symbol: "" }))
  );
  const fileInputRef = useRef(null);

  // Modal de confirmación para eliminar costo (reemplaza window.confirm).
  const [pendingDeleteCost, setPendingDeleteCost] = useState(null); // {id, label, kind, amount, currency} | null
  const [deleteCostBusy,    setDeleteCostBusy]    = useState(false);
  const [deleteCostError,   setDeleteCostError]   = useState(null);

  // Sprint 2026-04-30 — FOB UNIT editable inline en la sección 3.
  // Mapa { line_id → valor temporal mientras el operador escribe }.
  const [editingUnitValue, setEditingUnitValue] = useState({});
  // Persistir el unit_value de una línea via PATCH a /api/transfer-lineas/{id}/.
  const persistLineUnitValue = useCallback(async (lineId, val) => {
    if (!lineId) return;
    const num = Number(val);
    if (!Number.isFinite(num) || num < 0) return;
    try {
      await transferLineasApi.update(lineId, { unit_value: num });
      // El re-fetch del padre reflejará el cambio en livePreview.
      onLiquidated?.(null);
    } catch (e) {
      setError(
        (lang === "es" ? "No se pudo actualizar el valor: " : "Could not update value: ")
        + (e?.body?.detail || e?.message || "error")
      );
    }
  }, [lang, onLiquidated]);

  // Catálogo ISO 4217 (47 monedas) — el SELECT de moneda lo usa.
  useEffect(() => {
    currencyCatApi.list({ is_active: "true", limit: 100 })
      .then((d) => {
        const arr = Array.isArray(d) ? d : (d?.results || []);
        if (arr.length) setCurrencies(arr);
      })
      .catch(() => {});
  }, []);

  // Maneja el archivo subido para OCR auto-merge.
  const handleOcrUpload = async (file) => {
    if (!file || !transferId) return;
    setOcrBusy(true);
    setOcrSummary(null);
    setError(null);
    try {
      const res = await transferDetailApi.uploadCostOcr(transferId, file);
      setOcrSummary(res?.summary || null);
      // Recarga cost lines y preview
      await load();
    } catch (e) {
      setError(e?.body?.detail || e?.message || "ocr_failed");
    } finally {
      setOcrBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

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

  // Sprint 2026-05-14 · Fase 16.1 — refrescar costLines + report cuando
  // el padre nos pasa una transferencia con número distinto de líneas
  // (típicamente: el admin acaba de "+ Agregar productos"). Sin esto
  // la sección 3 "Landed Cost · Factura Interna" mostraba los nuevos
  // productos (vía livePreview que se recomputa de transfer.lines)
  // pero el `report` y el `extra_cost_total` quedaban stale.
  const linesLen = (transfer?.lines || transfer?.lineas || []).length;
  useEffect(() => {
    // Saltamos la primera vez (load() ya corrió en el mount con load).
    // Sólo reaccionamos a cambios de cantidad después del primer render.
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linesLen]);

  // Catálogo de tipos de costo
  useEffect(() => {
    transferenciasApi.action("select_cost_kinds")
      .then((d) => { if (Array.isArray(d) && d.length) setCostKinds(d); })
      .catch(() => {});
  }, []);

  const isLiquidated = !!transfer?._raw?.liquidated_at || !!report?.liquidated_at;

  // Sprint 2026-05-14 · Fase 14 — items de la transferencia que el
  // scope picker necesita. Backend ya enriquece cada linea con
  // expediente_id/expediente_codigo en /transferencias/{id}/ retrieve()
  // (Fase 11.2). Mapeamos al shape que CostScopeModal espera —
  // mismo contrato que el wizard step 3 (Step3TransferAssign).
  const transferItems = useMemo(() => {
    const lineas = transfer?.lines || transfer?.lineas || [];
    return lineas
      .filter((l) => l.expediente_id)   // solo líneas con expediente real
      .map((l) => ({
        expediente_id:      l.expediente_id,
        _expediente_codigo: l.expediente_codigo || "",
        _proforma_codigo:   l.proforma_codigo   || "",
        producto_id:        l._raw?.producto_id || l.producto_id || "",
        _sku:               l.sku || "",
        _nombre:            l.product_label || l.product || l.sku || "",
        talla:              l.size || "",
        qty:                Number(l.qty_transfer || 0),
        // Sprint 2026-05-17 · campos para edicion de precios en
        // CostScopeModal con replicacion por SKU + persistencia bulk.
        _operating_company_id: l.operating_company_id || null,
        _linea_id_expediente:  l.linea_id_expediente || null,
        _unit_price_mwt:       l.unit_price_mwt != null ? Number(l.unit_price_mwt) : null,
        _unit_price_client:    l.unit_price_client != null ? Number(l.unit_price_client) : null,
      }));
  }, [transfer]);

  // ── Cálculo en vivo del preview (sin pegarle al backend cada keystroke) ──
  const livePreview = useMemo(() => {
    const lineas = transfer?.lines || transfer?.lineas || [];
    let fobTotal = 0;
    const lineValues = lineas.map((l) => {
      const qty = Number(l.qty_transfer || 0);
      // Sprint 2026-05-22 · viewer-aware unit_value.
      // Si el expediente fue operado por MWT y el viewer es interno,
      // usar unit_price_mwt. Sino, unit_price_client. Si ninguno está
      // disponible (línea sin snapshot dual), caer al legacy unit_value.
      const opIsMwt  = isMwtOperated(l.operating_company_id || l._operating_company_id);
      const priceMwt = Number(l.unit_price_mwt    || 0);
      const priceCli = Number(l.unit_price_client || 0);
      let uv;
      if (opIsMwt && viewerIsMwt) {
        uv = priceMwt > 0 ? priceMwt : priceCli;
      } else if (priceCli > 0) {
        uv = priceCli;
      } else if (priceMwt > 0) {
        uv = priceMwt;
      } else {
        uv = Number(l._raw?.unit_value || l.unit_value || l.unit_cost || 0);
      }
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
        // Sprint 2026-05-14 · Fase 11.2 — propagar expediente_codigo
        // para mostrar la columna Expediente en la tabla del Landed Cost.
        expediente_codigo: l.expediente_codigo || "",
        // Sprint 2026-05-17 · proforma_codigo para que la celda EXPEDIENTE
        // muestre la proforma (con fallback a EXP code). Sin esto, el panel
        // dejaba caer el campo y la tabla mostraba EXP-YYYY-NNNN.
        proforma_codigo:   l.proforma_codigo || "",
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
    // Sprint 2026-05-22 · viewerIsMwt en deps. Sin esta dependencia el
    // useMemo NO recalcula cuando el admin toggle a "Cliente B2B" en el
    // panel Tweaks - la tabla mostraba el precio MWT cacheado aunque la
    // logica del if/else if mas arriba ya era correcta.
  }, [transfer, costLines, viewerIsMwt]);

  // ── Cost line CRUD (server-side persiste; trigger SQL actualiza total_cost_usd) ──
  // Sprint 2026-05-14 · Fase 14 — addCost acepta { scope } para que el
  // flow "+ Agregar costo" → modal → guardar scope cree la fila ya con
  // scope_json aplicado, igual que el wizard.
  const addCost = async (extra = {}) => {
    setSaving(true); setError(null);
    try {
      const created = await transferenciasApi.action("cost-lines", transferId, {
        kind: "OTRO", label: "", amount: 0, currency: "USD",
        fx_to_usd: 1, source: "MANUAL",
        scope_json: extra.scope || null,
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
        // Sprint 2026-05-14 · Fase 14 — persistir scope_json en el ciclo
        // delete-then-create. Si el editor sólo cambió el alcance, se
        // mantiene tipo/monto/moneda intactos.
        scope_json:     c.scope_json || null,
      });
      setCostLines((prev) => prev.map((x) => x.id === c.id ? created : x));
    } catch (e) { setError(e?.message || "save_failed"); }
    finally { setSaving(false); }
  };

  // Abre el modal de confirmación (reemplaza window.confirm).
  const askRemoveCost = (cost) => {
    setDeleteCostError(null);
    setPendingDeleteCost(cost);
  };

  const confirmRemoveCost = async () => {
    if (!pendingDeleteCost?.id) return;
    setDeleteCostBusy(true);
    setDeleteCostError(null);
    try {
      await fetch(`/api/transferencias/${transferId}/cost-lines/${pendingDeleteCost.id}/`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      setCostLines((prev) => prev.filter((c) => c.id !== pendingDeleteCost.id));
      setPendingDeleteCost(null);
    } catch (e) {
      setDeleteCostError(
        (lang === "es" ? "No se pudo eliminar: " : "Could not delete: ") +
        (e?.message || "error")
      );
    } finally {
      setDeleteCostBusy(false);
    }
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

      {/* ── Sección 1 · Contexto y Documentos · Sprint Fase 15 editable ─── */}
      <div className="card card-pad-md" style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between",
                      alignItems: "center", marginBottom: 10 }}>
          <div className="micro" style={{ color: "#00B286", letterSpacing: 1 }}>
            {lang === "es" ? "1 · CONTEXTO Y DOCUMENTACIÓN LEGAL" : "1 · LEGAL CONTEXT & DOCUMENTS"}
          </div>
          {canEdit && (
            <span className="micro" style={{ color: "var(--text-tertiary)" }}>
              {headerSaving
                ? (lang === "es" ? "Guardando…" : "Saving…")
                : (Object.keys(headerEdit).length > 0
                    ? (lang === "es" ? "Cambios sin guardar" : "Unsaved changes")
                    : (lang === "es" ? "Editable" : "Editable"))}
            </span>
          )}
        </div>

        {headerError && (
          <div style={{
            padding: "8px 12px", borderRadius: 6, fontSize: 12.5,
            background: "rgba(220,38,38,0.08)", color: "#991B1B",
            marginBottom: 10,
          }}>
            <IconAlert size={11} style={{ verticalAlign: -1, marginRight: 4 }}/>
            {headerError}
          </div>
        )}

        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 12,
        }}>
          {/* Motivo legal */}
          <div>
            <div className="caption" style={{ color: "var(--text-tertiary)", marginBottom: 4 }}>
              {lang === "es" ? "Motivo legal" : "Legal context"}
            </div>
            {canEdit ? (
              <select className="input"
                      value={headerVal("legal_context", "INTERNAL")}
                      disabled={headerSaving}
                      onChange={(e) => setHV("legal_context", e.target.value)}
                      onBlur={(e) => {
                        if (headerEdit.legal_context !== undefined
                            && headerEdit.legal_context !== transfer?.legal_context) {
                          persistHeader({ legal_context: e.target.value });
                        }
                      }}>
                {LEGAL_CONTEXT_OPTIONS.map((o) => (
                  <option key={o.codigo} value={o.codigo}>
                    {o.label[lang] || o.label.es}
                  </option>
                ))}
              </select>
            ) : (
              <span style={{ fontWeight: 700 }}>{transfer?.legal_context || "INTERNAL"}</span>
            )}
          </div>

          {/* Origen */}
          <div>
            <div className="caption" style={{ color: "var(--text-tertiary)", marginBottom: 4 }}>
              {lang === "es" ? "Nodo origen" : "Origin node"}
            </div>
            {canEdit ? (
              <select className="input"
                      value={headerVal("_raw_origen_id", transfer?._raw?.origen_id || "")}
                      disabled={headerSaving}
                      onChange={(e) => setHV("_raw_origen_id", e.target.value)}
                      onBlur={(e) => {
                        const cur = transfer?._raw?.origen_id || "";
                        if (e.target.value && e.target.value !== cur) {
                          persistHeader({ origen_id: e.target.value });
                        }
                      }}>
                {nodos.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.codigo} · {n.nombre}
                  </option>
                ))}
              </select>
            ) : (
              <span><strong>{transfer?.origen}</strong></span>
            )}
          </div>

          {/* Destino */}
          <div>
            <div className="caption" style={{ color: "var(--text-tertiary)", marginBottom: 4 }}>
              {lang === "es" ? "Nodo destino" : "Destination node"}
            </div>
            {canEdit ? (
              <select className="input"
                      value={headerVal("_raw_destino_id", transfer?._raw?.destino_id || "")}
                      disabled={headerSaving}
                      onChange={(e) => setHV("_raw_destino_id", e.target.value)}
                      onBlur={(e) => {
                        const cur = transfer?._raw?.destino_id || "";
                        if (e.target.value && e.target.value !== cur) {
                          persistHeader({ destino_id: e.target.value });
                        }
                      }}>
                {nodos.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.codigo} · {n.nombre}
                  </option>
                ))}
              </select>
            ) : (
              <span><strong>{transfer?.destino}</strong></span>
            )}
          </div>

          {/* Tracking */}
          <div>
            <div className="caption" style={{ color: "var(--text-tertiary)", marginBottom: 4 }}>
              {lang === "es" ? "Tracking (BL / AWB)" : "Tracking (BL / AWB)"}
            </div>
            {canEdit ? (
              <input className="input mono-sm"
                     value={headerVal("ref_tracking", transfer?.ref_tracking || "")}
                     disabled={headerSaving}
                     placeholder="BL / AWB / TRK"
                     onChange={(e) => setHV("ref_tracking", e.target.value)}
                     onBlur={(e) => {
                       if (headerEdit.ref_tracking !== undefined
                           && (headerEdit.ref_tracking || "") !== (transfer?.ref_tracking || "")) {
                         persistHeader({ ref_tracking: e.target.value || null });
                       }
                     }}/>
            ) : (
              <code className="mono-sm">{transfer?.ref_tracking || "—"}</code>
            )}
          </div>

          {/* Despachada · dispatched_at */}
          <div>
            <div className="caption" style={{ color: "var(--text-tertiary)", marginBottom: 4 }}>
              {lang === "es" ? "Fecha despachada" : "Dispatched at"}
            </div>
            {canEdit ? (
              <input className="input" type="date"
                     value={(headerVal("dispatched_at", transfer?.dispatched_at || "") || "").slice(0,10)}
                     disabled={headerSaving}
                     onChange={(e) => setHV("dispatched_at", e.target.value)}
                     onBlur={(e) => {
                       const v = e.target.value || null;
                       const cur = (transfer?.dispatched_at || "").slice(0,10);
                       if ((v || "") !== cur) {
                         persistHeader({ dispatched_at: v });
                       }
                     }}/>
            ) : (
              <code className="mono-sm">{transfer?.dispatched_at || "—"}</code>
            )}
          </div>

          {/* ETA */}
          <div>
            <div className="caption" style={{ color: "var(--text-tertiary)", marginBottom: 4 }}>
              {lang === "es" ? "ETA" : "ETA"}
            </div>
            {canEdit ? (
              <input className="input" type="date"
                     value={(headerVal("eta", transfer?.eta || "") || "").slice(0,10)}
                     disabled={headerSaving}
                     onChange={(e) => setHV("eta", e.target.value)}
                     onBlur={(e) => {
                       const v = e.target.value || null;
                       const cur = (transfer?.eta || "").slice(0,10);
                       if ((v || "") !== cur) {
                         persistHeader({ eta: v });
                       }
                     }}/>
            ) : (
              <code className="mono-sm">{transfer?.eta || "—"}</code>
            )}
          </div>
        </div>

        {/* Sprint 2026-05-14 · Fase 15 — los 4 chips estáticos
            (Factura, DUA, BL/AWB, Remisión) se eliminaron porque NO se
            podían editar y daban falsa sensación de upload. La gestión
            documental ahora vive en el bloque Artefactos (sección 2.5
            más abajo), con scope picker idéntico al wizard de recepción. */}
      </div>

      {/* ── Sección 1.5 · Artefactos vinculados (Sprint Fase 16) ──
          Builder artifacts ligados a esta transferencia. Botón
          "+ Agregar artefacto" abre el flow scope → picker → fill
          con expedientes/líneas derivados de transfer.lineas (in-memory). */}
      <TransferBuilderArtifactsBlock transfer={transfer} lang={lang}/>

      {/* ── Sección 2 · Registro de Costos Multidivisa ── */}
      <div className="card card-pad-md" style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10, gap: 12 }}>
          <div>
            <div className="micro" style={{ color: "#00B286", letterSpacing: 1 }}>
              {lang === "es" ? "2 · COSTOS INCREMENTALES MULTIDIVISA" : "2 · MULTI-CURRENCY INCREMENTAL COSTS"}
            </div>
            <div className="caption" style={{ color: "var(--text-tertiary)", marginTop: 4 }}>
              {lang === "es"
                ? "Sube una DUA, factura aduanal o liquidación → el motor IA detecta y agrega/fusiona costos automáticamente."
                : "Upload a customs declaration or invoice — the AI engine detects and merges costs."}
            </div>
          </div>
          {!isLiquidated && (
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={ocrBusy || saving}
                className="btn"
                style={{
                  background: ocrBusy ? "#F3F5F8" : "#0B1E3A",
                  color: ocrBusy ? "#64748B" : "#fff",
                  fontSize: 12, padding: "6px 12px", borderRadius: 8,
                  fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6,
                }}
                title={lang === "es" ? "Subir DUA / factura para OCR" : "Upload customs doc for OCR"}
              >
                <IconUpload size={12}/>
                {ocrBusy
                  ? (lang === "es" ? "Procesando…" : "Processing…")
                  : (lang === "es" ? "Subir documento (IA)" : "Upload doc (AI)")}
              </button>
              <button className="btn btn-ghost btn-sm"
                      onClick={() => setCreatingNewScope(true)}
                      disabled={saving || isLiquidated}>
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
          onChange={(e) => handleOcrUpload(e.target.files?.[0])}
        />

        {/* OCR summary banner */}
        {ocrSummary && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            style={{
              background: "rgba(0,178,134,0.08)",
              border: "1px solid rgba(0,178,134,0.20)",
              borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 13,
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <IconCheck size={14} style={{ color: "#00B286" }}/>
              <span>
                <strong style={{ color: "#00B286" }}>
                  {ocrSummary.added} {lang === "es" ? "nueva(s)" : "new"} ·{" "}
                  {ocrSummary.merged} {lang === "es" ? "fusionada(s)" : "merged"}
                </strong>
                {ocrSummary.document_reference && (
                  <span style={{ color: "var(--text-tertiary)", marginLeft: 8 }}>
                    · {lang === "es" ? "Doc:" : "Doc:"} <code className="mono-sm">{ocrSummary.document_reference}</code>
                  </span>
                )}
                {ocrSummary.confidence && (
                  <span style={{
                    marginLeft: 8, padding: "1px 8px", borderRadius: 999,
                    background: "rgba(72,30,227,0.10)", color: "#481EE3",
                    fontSize: 10.5, fontWeight: 700,
                  }}>
                    {ocrSummary.confidence}
                  </span>
                )}
              </span>
            </div>
            {ocrSummary.gaps_detected && ocrSummary.gaps_detected.length > 0 && (
              <span style={{
                color: "#B45309", fontSize: 11.5, fontWeight: 600,
                display: "inline-flex", alignItems: "center", gap: 4,
              }}>
                <IconAlert size={11}/> {ocrSummary.gaps_detected.length} gap{ocrSummary.gaps_detected.length !== 1 ? "s" : ""}
              </span>
            )}
            <button onClick={() => setOcrSummary(null)} className="btn btn-ghost btn-sm"
                    style={{ color: "#64748B", fontSize: 14, padding: "0 6px" }}>×</button>
          </motion.div>
        )}

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
                  {/* Sprint 2026-05-14 · Fase 14 — alcance por costo. */}
                  <th style={{ textAlign: "center" }}>
                    {lang === "es" ? "Aplicar a" : "Apply to"}
                  </th>
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
                        {/* Sprint 2026-04-30 — SELECT con catálogo ISO 4217
                            (47 monedas) cargado desde
                            /api/commercial/catalogs/currencies/. */}
                        <select className="input mono-sm" style={{ width: 90 }}
                                value={c.currency} disabled={isLiquidated}
                                onChange={(e) => updateCost(c.id, { currency: e.target.value })}
                                onBlur={() => persistCost(c)}>
                          {currencies.map((cur) => (
                            <option key={cur.codigo} value={cur.codigo}
                                    title={`${cur.nombre || cur.codigo}${cur.symbol ? " (" + cur.symbol + ")" : ""}`}>
                              {cur.codigo}
                            </option>
                          ))}
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
                      <td style={{ textAlign: "center" }}>
                        <ScopeChip scope={c.scope_json}
                                   transferItems={transferItems}
                                   disabled={isLiquidated || transferItems.length === 0}
                                   onOpen={() => setScopeOpenFor(c.id)}
                                   lang={lang}/>
                      </td>
                      <td>
                        {!isLiquidated && (
                          <button className="btn btn-ghost btn-sm"
                                  onClick={() => askRemoveCost(c)}
                                  style={{ color: "#D64545" }} disabled={saving}
                                  title={lang === "es" ? "Eliminar costo" : "Remove cost"}>
                            <IconTrash size={12}/>
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
                  {/* +1 columna Aplicar a (Sprint Fase 14). */}
                  <td colSpan={3}></td>
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
                         value={`$${fmt(livePreview.avgLanded)}`}/>
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
                  {/* Sprint 2026-05-14 · Fase 11.2 — Expediente antes de SKU/Lote. */}
                  <th>{lang === "es" ? "Expediente" : "Expediente"}</th>
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
                {livePreview.lines.map((l) => {
                  // FOB UNIT editable — sprint 2026-04-30. El operador puede
                  // corregir el valor declarado para que el motor de Landed
                  // Cost prorratee bien (BY_VALUE). PATCH al perder foco.
                  const editingVal = editingUnitValue[l.line_id];
                  const displayVal = editingVal !== undefined
                    ? editingVal
                    : Number(l.unit_fob_usd || 0).toFixed(4);
                  return (
                  <tr key={l.line_id}>
                    {/* Sprint 2026-05-17 · muestra proforma_codigo con
                        fallback al EXP code. Header de columna mantiene
                        "Expediente" — el valor es la proforma cuando existe. */}
                    <td className="mono-sm" style={{ color: "var(--brand-primary)", fontWeight: 700 }}>
                      {l.proforma_codigo || l.expediente_codigo || "—"}
                    </td>
                    <td className="mono-sm">
                      <div>{l.sku}</div>
                      {l.lote && <div className="caption">L: {l.lote}</div>}
                    </td>
                    <td>{l.product_label}</td>
                    <td>{l.size || "—"}</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>{l.qty}</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>
                      {isLiquidated ? (
                        <span>${fmt4(l.unit_fob_usd)}</span>
                      ) : (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <span style={{ color: "#64748B", fontSize: 11 }}>$</span>
                          <input className="input tabular-nums"
                                 type="number" step="0.0001" min="0"
                                 style={{
                                   width: 88, textAlign: "right",
                                   padding: "4px 6px", fontSize: 12.5,
                                 }}
                                 value={displayVal}
                                 onChange={(e) => setEditingUnitValue((m) => ({
                                   ...m, [l.line_id]: e.target.value,
                                 }))}
                                 onBlur={(e) => {
                                   const v = Number(e.target.value);
                                   if (Number.isFinite(v) && v !== Number(l.unit_fob_usd || 0)) {
                                     persistLineUnitValue(l.line_id, v);
                                   }
                                   setEditingUnitValue((m) => {
                                     const { [l.line_id]: _, ...rest } = m;
                                     return rest;
                                   });
                                 }}
                                 title={lang === "es"
                                   ? "Valor unitario USD declarado · base FOB"
                                   : "Declared unit value USD · FOB base"}/>
                        </span>
                      )}
                    </td>
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
                  );
                })}
                <tr style={{ background: "rgba(0,178,134,0.06)", fontWeight: 700 }}>
                  {/* +1 columna Expediente (Sprint Fase 11.2). */}
                  <td colSpan={4} style={{ color: "#0B1E3A" }}>
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

      {/* ── Modal de confirmación de liquidación (preview por unidad) ── */}
      {confirming && (
        <ConfirmModal
          lang={lang}
          summary={livePreview}
          onCancel={() => setConfirming(false)}
          onConfirm={liquidate}
          busy={liquidating}
        />
      )}

      {/* ── Modal MWT genérico — eliminar costo (sprint 2026-04-30,
            reemplaza window.confirm/browser dialog). ────────────────── */}
      {pendingDeleteCost && createPortal(
        <GenericConfirmModal
          eyebrow={lang === "es" ? "ACCIÓN DESTRUCTIVA" : "DESTRUCTIVE ACTION"}
          title={lang === "es" ? "¿Eliminar este costo?" : "Delete this cost?"}
          body={
            <>
              {lang === "es"
                ? "El costo se quitará del cálculo de Landed Cost. Esta acción es permanente."
                : "This cost will be removed from the Landed Cost calculation."}
              <div style={{
                marginTop: 10, padding: "10px 12px", borderRadius: 6,
                background: "rgba(11,30,58,0.04)",
                fontSize: 12.5, color: "#0B1E3A",
              }}>
                <div style={{ fontWeight: 700 }}>
                  {pendingDeleteCost.label || pendingDeleteCost.kind}
                </div>
                <div style={{ color: "#64748B", marginTop: 2,
                              fontFamily: "var(--font-mono)" }}>
                  {Number(pendingDeleteCost.amount || 0).toLocaleString()}{" "}
                  {pendingDeleteCost.currency || "USD"}
                  {pendingDeleteCost.source === "OCR_DUA" && (
                    <span style={{
                      marginLeft: 8, padding: "1px 7px", borderRadius: 999,
                      background: "rgba(0,178,134,0.12)", color: "#00B286",
                      fontSize: 10, fontWeight: 700,
                    }}>IA</span>
                  )}
                </div>
              </div>
            </>
          }
          actionLabel={lang === "es" ? "Sí, eliminar" : "Yes, delete"}
          actionColor="#DC2626"
          cancelLabel={lang === "es" ? "Cancelar" : "Cancel"}
          busy={deleteCostBusy}
          error={deleteCostError}
          onCancel={() => { if (!deleteCostBusy) setPendingDeleteCost(null); }}
          onConfirm={confirmRemoveCost}
        />,
        document.body
      )}

      {/* Sprint 2026-05-14 · Fase 14 — Scope picker para cost-lines.
          Doble uso:
            · creatingNewScope=true → "+ Agregar costo": al guardar
              crea la fila ya con scope aplicado.
            · scopeOpenFor=cost.id → edición del scope de una fila
              existente vía chip "Aplicar a". */}
      {(creatingNewScope || scopeOpenFor) && (() => {
        const editing = scopeOpenFor
          ? costLines.find((c) => c.id === scopeOpenFor) || null
          : null;
        const initialScope = creatingNewScope ? null : (editing?.scope_json || null);
        const costLabel = creatingNewScope
          ? (lang === "es" ? "Nuevo costo" : "New cost")
          : (editing?.label
              || (costKinds.find((k) => k.codigo === editing?.kind)?.label)
              || "");
        return (
          <CostScopeModal
            open={true}
            lang={lang}
            costLabel={costLabel}
            initialScope={initialScope}
            transferItems={transferItems}
            onClose={() => { setCreatingNewScope(false); setScopeOpenFor(null); }}
            onSave={(scope) => {
              if (creatingNewScope) {
                addCost({ scope });
              } else if (editing) {
                // Mutar localmente y persistir el cambio.
                const next = { ...editing, scope_json: scope };
                updateCost(editing.id, { scope_json: scope });
                persistCost(next);
              }
            }}
          />
        );
      })()}
    </div>
  );
}

// ── Sprint 2026-05-14 · Fase 14 — chip resumen del scope ────
// Muestra "Todo" si scope=null/applies_to_all, "N exp" o "N exp · M
// líneas" si está restringido. Click → abre el modal de edición.
function ScopeChip({ scope, transferItems, disabled, onOpen, lang }) {
  let label = lang === "es" ? "Todo" : "All";
  let restricted = false;
  if (scope && scope.applies_to_all === false) {
    restricted = true;
    const nExp   = Array.isArray(scope.expediente_ids) ? scope.expediente_ids.length : 0;
    const nLines = Array.isArray(scope.lines)          ? scope.lines.length          : 0;
    if (nLines > 0) {
      label = lang === "es" ? `${nExp} exp · ${nLines} líneas`
                            : `${nExp} exp · ${nLines} lines`;
    } else if (nExp > 0) {
      label = `${nExp} ${lang === "es"
        ? (nExp === 1 ? "expediente" : "expedientes")
        : (nExp === 1 ? "expediente" : "expedientes")}`;
    }
  }
  const noItems = !transferItems || transferItems.length === 0;
  const realDisabled = !!disabled || noItems;
  return (
    <button type="button"
            onClick={onOpen}
            disabled={realDisabled}
            title={noItems
              ? (lang === "es" ? "No hay líneas en la transferencia" : "No transfer lines")
              : (lang === "es" ? "Configurar alcance del costo" : "Set cost scope")}
            style={{
              padding: "4px 10px", borderRadius: 999,
              border: restricted
                ? "1.5px solid var(--brand-accent, #0E8A6D)"
                : "1px solid var(--border-subtle, #E1E6ED)",
              background: restricted
                ? "color-mix(in oklab, var(--brand-accent, #0E8A6D) 10%, transparent)"
                : "var(--surface, white)",
              color: restricted ? "var(--brand-accent, #0E8A6D)" : "var(--text-secondary, #475467)",
              fontSize: 11, fontWeight: 700, letterSpacing: 0.3,
              cursor: realDisabled ? "not-allowed" : "pointer",
              opacity: realDisabled ? 0.5 : 1,
            }}>
      {label}
    </button>
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
