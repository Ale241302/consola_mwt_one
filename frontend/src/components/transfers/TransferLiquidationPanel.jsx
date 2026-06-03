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
import { useTransferPriceMode } from "../../hooks/useTransferPriceMode.js";

const NCM_TAX_RATES = {
  "6403.99.90": { dai: 0.14, ley_6946: 0.01, iva: 0.13 }, // calzado seguridad
  "6403.40.00": { dai: 0.14, ley_6946: 0.01, iva: 0.13 }, // calzado puntera metálica
  _default:     { dai: 0.14, ley_6946: 0.01, iva: 0.13 },
};

function taxRatesForNcm(ncm) {
  const key = String(ncm || "").trim();
  return NCM_TAX_RATES[key] || NCM_TAX_RATES._default;
}

const KIND_FREIGHT = new Set(["FLETE", "FREIGHT", "CONSOLIDACION"]);
const KIND_INSURANCE = new Set(["SEGURO", "INSURANCE"]);

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
const fmtInt = (n) => Number(n || 0).toLocaleString("en-US", {
  maximumFractionDigits: 0,
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
  //
  // Hook canonico — la regla unificada considera:
  //   1. Admin/CEO real (sin Tweaks override)        → MWT
  //   2. Admin con Tweaks "Cliente B2B"               → CLIENT (previsualizacion)
  //   3. Cliente B2B real cuyo legal_entity_ids
  //      incluye al operador MWT                      → MWT (cliente del operador)
  //   4. Cliente B2B real sin match                   → CLIENT
  //
  // El override del Tweaks SIEMPRE tiene prioridad: previsualizar como
  // Cliente B2B debe mostrar precio cliente aunque el usuario real tenga
  // legal_entity asignada.
  const { viewerIsMwt } = useTransferPriceMode();
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

  // Custom rates in state. Se inicializan desde context_data.custom_rates si
  // el operador ya editó las tasas; si no, quedan en null → fallback a NCM.
  // (Antes eran siempre null y no se persistían: editar IVA/DAI/Ley no se
  //  guardaba y al recargar volvía al default NCM. Fix sprint 2026-06-03.)
  const _initRate = (k) => {
    const v = transfer?.context_data?.custom_rates?.[k];
    return v !== undefined && v !== null ? Number(v) : null;
  };
  const [customDaiRate, setCustomDaiRate] = useState(() => _initRate("dai"));
  const [customLeyRate, setCustomLeyRate] = useState(() => _initRate("ley"));
  const [customIvaRate, setCustomIvaRate] = useState(() => _initRate("iva"));

  // Line overrides states
  const [lineOverrides, setLineOverrides] = useState(() => transfer?.context_data?.line_overrides || {});
  const [editingOverrides, setEditingOverrides] = useState({});
  const [customTaxes, setCustomTaxes] = useState(() => transfer?.context_data?.custom_taxes || []);

  // Sync state with transfer prop updates
  useEffect(() => {
    if (transfer?.context_data?.line_overrides) {
      setLineOverrides(transfer.context_data.line_overrides);
    } else {
      setLineOverrides({});
    }
    if (transfer?.context_data?.custom_taxes) {
      setCustomTaxes(transfer.context_data.custom_taxes);
    } else {
      setCustomTaxes([]);
    }
    // Re-hidratar tasas custom tras un re-fetch del padre.
    const cr = transfer?.context_data?.custom_rates;
    setCustomDaiRate(cr?.dai !== undefined && cr?.dai !== null ? Number(cr.dai) : null);
    setCustomLeyRate(cr?.ley !== undefined && cr?.ley !== null ? Number(cr.ley) : null);
    setCustomIvaRate(cr?.iva !== undefined && cr?.iva !== null ? Number(cr.iva) : null);
  }, [transfer]);

  // Persistir overrides in context_data via PATCH
  const persistLineOverrides = useCallback(async (newOverrides) => {
    if (!transferId) return;
    try {
      const currentCtx = transfer?.context_data || {};
      const nextCtx = {
        ...currentCtx,
        line_overrides: newOverrides,
      };
      await transferenciasApi.update(transferId, { context_data: nextCtx });
      onLiquidated?.();
    } catch (e) {
      setError(
        (lang === "es" ? "No se pudo actualizar los costos: " : "Could not update costs: ")
        + (e?.body?.detail || e?.message || "error")
      );
    }
  }, [transferId, transfer, lang, onLiquidated]);

  // Persistir custom taxes/costs via PATCH
  const persistCustomTaxes = useCallback(async (nextTaxes) => {
    if (!transferId) return;
    try {
      const currentCtx = transfer?.context_data || {};
      const nextCtx = {
        ...currentCtx,
        custom_taxes: nextTaxes,
      };
      await transferenciasApi.update(transferId, { context_data: nextCtx });
      onLiquidated?.();
    } catch (e) {
      setError(
        (lang === "es" ? "No se pudo actualizar los impuestos: " : "Could not update taxes: ")
        + (e?.body?.detail || e?.message || "error")
      );
    }
  }, [transferId, transfer, lang, onLiquidated]);

  // Persistir tasas custom (DAI / Ley 6946 / IVA) en context_data.custom_rates.
  // null = "usar default NCM". Se llama en onBlur de cada input de tasa/monto.
  const persistCustomRates = useCallback(async (next = {}) => {
    if (!transferId) return;
    try {
      const currentCtx = transfer?.context_data || {};
      const nextCtx = {
        ...currentCtx,
        custom_rates: {
          dai: next.dai !== undefined ? next.dai : customDaiRate,
          ley: next.ley !== undefined ? next.ley : customLeyRate,
          iva: next.iva !== undefined ? next.iva : customIvaRate,
        },
      };
      await transferenciasApi.update(transferId, { context_data: nextCtx });
      onLiquidated?.();
    } catch (e) {
      setError(
        (lang === "es" ? "No se pudo actualizar las tasas: " : "Could not update rates: ")
        + (e?.body?.detail || e?.message || "error")
      );
    }
  }, [transferId, transfer, customDaiRate, customLeyRate, customIvaRate, lang, onLiquidated]);

  // ── Cálculo en vivo del preview (sin pegarle al backend cada keystroke) ──
  const livePreview = useMemo(() => {
    const lineas = transfer?.lines || transfer?.lineas || [];

    // 1. Identificar costos de flete, seguro y otros costos de costLines
    const freight = costLines.reduce((a, c) => a + (KIND_FREIGHT.has(String(c.kind || "").toUpperCase()) ? Number(c.amount || 0) * Number(c.fx_to_usd || 1) : 0), 0);
    const insurance = costLines.reduce((a, c) => a + (KIND_INSURANCE.has(String(c.kind || "").toUpperCase()) ? Number(c.amount || 0) * Number(c.fx_to_usd || 1) : 0), 0);
    const extraTotal = freight + insurance;
    const destTotal = costLines.reduce((a, c) => {
      const k = String(c.kind || "").toUpperCase();
      if (!KIND_FREIGHT.has(k) && !KIND_INSURANCE.has(k)) {
        return a + Number(c.amount || 0) * Number(c.fx_to_usd || 1);
      }
      return a;
    }, 0);
    const otherCostsTotal = destTotal;

    // 2. Computar FOB unitario y total por línea (con la cantidad entregada/recibida > despachada > planeada)
    let fobTotal = 0;
    const lineValues = lineas.map((l) => {
      const qty = l.qty_received != null ? Number(l.qty_received) : (l.qty_dispatched != null ? Number(l.qty_dispatched) : Number(l.qty_transfer || 0));
      
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

    const qtyTotalAll = lineValues.reduce((a, x) => a + x.qty, 0);

    // 3. Desglosar por talla y calcular impuestos (prorrateo por cantidad)
    let daiTotal = 0;
    let leyTotal = 0;
    let ivaTotal = 0;
    let customTaxesSum = 0;
    let customCostsSum = 0;

    const lines = lineValues.map(({ l, qty, uv, lt }) => {
      const lineId = l._line_id || l.id;
      const override = lineOverrides[lineId] || {};

      const extra = qtyTotalAll > 0 ? extraTotal * (qty / qtyTotalAll) : 0;
      const dest = qtyTotalAll > 0 ? destTotal * (qty / qtyTotalAll) : 0;
      
      const calculatedCif = lt + extra;
      const cif = override.cif !== undefined ? Number(override.cif) : calculatedCif;

      const r = taxRatesForNcm(l.ncm || l._raw?.ncm);
      const daiRate = customDaiRate !== null ? customDaiRate : r.dai;
      const leyRate = customLeyRate !== null ? customLeyRate : r.ley_6946;
      const ivaRate = customIvaRate !== null ? customIvaRate : r.iva;

      const dai = override.dai !== undefined ? Number(override.dai) : (cif * daiRate);
      const ley = override.ley !== undefined ? Number(override.ley) : (cif * leyRate);
      const iva = cif * ivaRate;

      // Custom taxes on CIF and custom costs prorated by pairs qty
      const lineCustomTaxesAmount = customTaxes.filter(x => x.type === "TAX").reduce((sum, tax) => sum + (cif * ((tax.rate || 0) / 100)), 0);
      const lineCustomCostsAmount = customTaxes.filter(x => x.type === "COST").reduce((sum, cost) => sum + (qtyTotalAll > 0 ? (Number(cost.amount || 0) * (qty / qtyTotalAll)) : 0), 0);

      const itemDest = override.dest !== undefined ? Number(override.dest) : dest;

      daiTotal += dai;
      leyTotal += ley;
      ivaTotal += iva;
      customTaxesSum += lineCustomTaxesAmount;
      customCostsSum += lineCustomCostsAmount;

      let total = cif + dai + ley + itemDest + lineCustomTaxesAmount + lineCustomCostsAmount;
      let landedUnit = qty > 0 ? total / qty : 0;

      if (override.landed_total_usd !== undefined) {
        total = Number(override.landed_total_usd);
        landedUnit = qty > 0 ? total / qty : 0;
      } else if (override.landed_unit_usd !== undefined) {
        landedUnit = Number(override.landed_unit_usd);
        total = landedUnit * qty;
      }

      return {
        line_id:          lineId,
        sku:              l.sku || "",
        product_label:    l.product_label || l.product || "",
        size:             l.size || "",
        lote:             l.lote || l.lot || "",
        expediente_codigo: l.expediente_codigo || "",
        proforma_codigo:   l.proforma_codigo || "",
        qty,
        unit_fob_usd:     uv,
        fob_total_usd:    lt,
        extra,
        cif,
        dai,
        ley,
        dest:             itemDest,
        iva,
        landed_unit_usd:  landedUnit,
        landed_total_usd: total,
      };
    });

    const landedTotal = lines.reduce((a, x) => a + x.landed_total_usd, 0);
    const cifTotal = lines.reduce((a, x) => a + x.cif, 0);
    const destTotalSum = lines.reduce((a, x) => a + x.dest, 0);

    return {
      fobTotal,
      freight,
      insurance,
      extraTotal,
      extraUsd: extraTotal,
      destTotal: destTotalSum,
      cifTotal,
      otherCostsTotal,
      unitsTotal: qtyTotalAll,
      landedTotal,
      daiTotal,
      leyTotal,
      ivaTotal,
      customTaxesSum,
      customCostsSum,
      avgLanded: qtyTotalAll > 0 ? landedTotal / qtyTotalAll : 0,
      lines,
      daiRate: customDaiRate !== null ? customDaiRate : 0.14,
      leyRate: customLeyRate !== null ? customLeyRate : 0.01,
      ivaRate: customIvaRate !== null ? customIvaRate : 0.13,
    };
  }, [transfer, costLines, viewerIsMwt, customDaiRate, customLeyRate, customIvaRate, lineOverrides, customTaxes]);

  // Sku distribution helpers
  const distributeSkuOverride = useCallback((sku, field, totalValue) => {
    const skuLines = livePreview.lines.filter(l => (l.sku || "—") === sku);
    const totalQty = skuLines.reduce((sum, l) => sum + l.qty, 0);
    if (totalQty === 0) return;

    let nextOverrides = { ...lineOverrides };
    skuLines.forEach((l) => {
      if (!nextOverrides[l.line_id]) {
        nextOverrides[l.line_id] = {};
      }
      const share = (l.qty / totalQty) * totalValue;
      nextOverrides[l.line_id][field] = share;
    });

    setLineOverrides(nextOverrides);
    persistLineOverrides(nextOverrides);
  }, [livePreview, lineOverrides, persistLineOverrides]);

  const distributeSkuUnitOverride = useCallback((sku, unitValue) => {
    const skuLines = livePreview.lines.filter(l => (l.sku || "—") === sku);
    let nextOverrides = { ...lineOverrides };
    skuLines.forEach((l) => {
      if (!nextOverrides[l.line_id]) {
        nextOverrides[l.line_id] = {};
      }
      nextOverrides[l.line_id]["landed_unit_usd"] = unitValue;
    });
    setLineOverrides(nextOverrides);
    persistLineOverrides(nextOverrides);
  }, [livePreview, lineOverrides, persistLineOverrides]);

  // Cell rendering helpers
  const renderEditableCell = (lineId, field, currentValue, step = "0.01", decimals = 2) => {
    const fieldKey = `${lineId}_${field}`;
    const editingVal = editingOverrides[fieldKey];
    const displayVal = editingVal !== undefined
      ? editingVal
      : (currentValue !== undefined && currentValue !== null ? Number(currentValue).toFixed(decimals) : "");

    if (isLiquidated) {
      return <span>${decimals === 4 ? fmt4(currentValue) : fmt(currentValue)}</span>;
    }

    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
        <span style={{ color: "#64748B", fontSize: 11 }}>$</span>
        <input className="input tabular-nums"
               type="number" step={step} min="0"
               style={{
                 width: decimals === 4 ? 88 : 80, textAlign: "right",
                 padding: "4px 6px", fontSize: 12,
               }}
               value={displayVal}
               onChange={(e) => setEditingOverrides((m) => ({
                 ...m, [fieldKey]: e.target.value,
               }))}
               onKeyDown={(e) => {
                 if (e.key === "Enter") {
                   e.target.blur();
                 }
               }}
               onBlur={(e) => {
                 const raw = e.target.value;
                 let nextOverrides = { ...lineOverrides };
                 if (raw === "") {
                   if (nextOverrides[lineId]) {
                     delete nextOverrides[lineId][field];
                     if (Object.keys(nextOverrides[lineId]).length === 0) {
                       delete nextOverrides[lineId];
                     }
                   }
                 } else {
                   const v = Number(raw);
                   if (Number.isFinite(v) && v >= 0) {
                     if (!nextOverrides[lineId]) {
                       nextOverrides[lineId] = {};
                     }
                     nextOverrides[lineId][field] = v;
                   }
                 }
                 setLineOverrides(nextOverrides);
                 persistLineOverrides(nextOverrides);
                 setEditingOverrides((m) => {
                   const { [fieldKey]: _, ...rest } = m;
                   return rest;
                 });
               }}
        />
      </span>
    );
  };

  const renderSkuEditableCell = (sku, field, currentValue, step = "0.01", decimals = 2) => {
    const fieldKey = `${sku}_${field}`;
    const editingVal = editingOverrides[fieldKey];
    const displayVal = editingVal !== undefined
      ? editingVal
      : (currentValue !== undefined && currentValue !== null ? Number(currentValue).toFixed(decimals) : "");

    if (isLiquidated) {
      return <span>${decimals === 4 ? fmt4(currentValue) : fmt(currentValue)}</span>;
    }

    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
        <span style={{ color: "#64748B", fontSize: 11 }}>$</span>
        <input className="input tabular-nums"
               type="number" step={step} min="0"
               style={{
                 width: decimals === 4 ? 88 : 80, textAlign: "right",
                 padding: "4px 6px", fontSize: 12,
               }}
               value={displayVal}
               onChange={(e) => setEditingOverrides((m) => ({
                 ...m, [fieldKey]: e.target.value,
               }))}
               onKeyDown={(e) => {
                 if (e.key === "Enter") {
                   e.target.blur();
                 }
               }}
               onBlur={(e) => {
                 const raw = e.target.value;
                 if (raw === "") {
                   const skuLines = livePreview.lines.filter(l => (l.sku || "—") === sku);
                   let nextOverrides = { ...lineOverrides };
                   skuLines.forEach((l) => {
                     if (nextOverrides[l.line_id]) {
                       delete nextOverrides[l.line_id][field];
                       if (Object.keys(nextOverrides[l.line_id]).length === 0) {
                         delete nextOverrides[l.line_id];
                       }
                     }
                   });
                   setLineOverrides(nextOverrides);
                   persistLineOverrides(nextOverrides);
                 } else {
                   const v = Number(raw);
                   if (Number.isFinite(v) && v >= 0) {
                     if (field === "landed_unit_usd") {
                       distributeSkuUnitOverride(sku, v);
                     } else {
                       distributeSkuOverride(sku, field, v);
                     }
                   }
                 }
                 setEditingOverrides((m) => {
                   const { [fieldKey]: _, ...rest } = m;
                   return rest;
                 });
               }}
        />
      </span>
    );
  };

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

  // (livePreview moved above helper callbacks to prevent Temporal Dead Zone error)

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
    setSaving(true); setError(null);
    try {
      if (String(c.id).startsWith("temp-")) {
        const created = await transferenciasApi.action("cost-lines", transferId, {
          kind:           c.kind,
          label:          c.label || "",
          amount:         Number(c.amount) || 0,
          currency:       c.currency || "USD",
          fx_to_usd:      Number(c.fx_to_usd) || 1,
          source:         c.source || "MANUAL",
          scope_json:     c.scope_json || null,
        });
        setCostLines((prev) => prev.map((x) => x.id === c.id ? created : x));
      } else {
        const updated = await transferDetailApi.updateCost(transferId, c.id, {
          kind:           c.kind,
          label:          c.label || "",
          amount:         Number(c.amount) || 0,
          currency:       c.currency || "USD",
          fx_to_usd:      Number(c.fx_to_usd) || 1,
          source:         c.source || "MANUAL",
          ocr_confidence: c.ocr_confidence ?? null,
          scope_json:     c.scope_json || null,
        });
        setCostLines((prev) => prev.map((x) => x.id === c.id ? updated : x));
      }
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
            {lang === "es" ? "Landed Cost · Factura interna de movimiento" : "Landed Cost · Internal transfer invoice"}
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
          Builder artifacts ligados a este movimiento. Botón
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
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Tabla 1: Liquidación detallada */}
            <div className="card card-pad-0" style={{ overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", background: "var(--raised)", borderBottom: "1.5px solid var(--border-subtle, #E1E6ED)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h4 style={{ margin: 0, color: "#0B1E3A", fontSize: 13, fontWeight: 700 }}>
                  {viewerIsMwt
                    ? (lang === "es" ? "LIQUIDACIÓN DETALLADA — MWT NACIONALIZA AL PRECIO MARLUVAS (UF)" : "DETAILED LIQUIDATION — MWT AT MARLUVAS (UF)")
                    : (lang === "es" ? `LIQUIDACIÓN DETALLADA — ${transfer?._raw?.operating_company_label || "SONDEL"} NACIONALIZA AL PRECIO DE LA ORDEN (DUA REFERENCIAL)` : `DETAILED LIQUIDATION — ${transfer?._raw?.operating_company_label || "SONDEL"} AT ORDER PRICE`)}
                </h4>
                {!isLiquidated && (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn btn-ghost btn-xs" onClick={() => {
                      const next = [...customTaxes, { id: "tax-" + Date.now(), type: "TAX", concept: lang === "es" ? "Impuesto adicional" : "Additional tax", rate: 0 }];
                      setCustomTaxes(next);
                      persistCustomTaxes(next);
                    }} style={{ padding: "2px 6px", fontSize: 11 }}>
                      <IconPlus size={10} style={{ marginRight: 2 }}/> {lang === "es" ? "Agregar impuesto (%)" : "Agregar impuesto (%)"}
                    </button>
                    <button className="btn btn-ghost btn-xs" onClick={() => {
                      const next = [...customTaxes, { id: "cost-" + Date.now(), type: "COST", concept: lang === "es" ? "Gasto adicional" : "Additional charge", amount: 0 }];
                      setCustomTaxes(next);
                      persistCustomTaxes(next);
                    }} style={{ padding: "2px 6px", fontSize: 11 }}>
                      <IconPlus size={10} style={{ marginRight: 2 }}/> {lang === "es" ? "Agregar gasto (USD)" : "Agregar gasto (USD)"}
                    </button>
                  </div>
                )}
              </div>
              <table className="table" style={{ fontSize: 12.5 }}>
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>#</th>
                    <th>{lang === "es" ? "Concepto" : "Concept"}</th>
                    <th>{lang === "es" ? "Base" : "Basis"}</th>
                    <th style={{ textAlign: "right" }}>{lang === "es" ? "Tasa" : "Rate"}</th>
                    <th style={{ textAlign: "right" }}>{lang === "es" ? "Monto USD" : "Amount USD"}</th>
                    <th>{lang === "es" ? "Notas" : "Notes"}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>1</td>
                    <td><strong>{viewerIsMwt ? (lang === "es" ? "FOB Marluvas (UF v5)" : "Marluvas FOB (UF v5)") : (lang === "es" ? "FOB declarado (precio orden SN)" : "Declared FOB (SN order price)")}</strong></td>
                    <td>{viewerIsMwt ? (lang === "es" ? "Factura Marluvas / pedido" : "Marluvas invoice / order") : (lang === "es" ? "Precio de la orden (precio cliente)" : "Order price (client price)")}</td>
                    <td style={{ textAlign: "right" }}>—</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>${fmt(livePreview.fobTotal)}</td>
                    <td style={{ color: "#64748B", fontSize: 11 }}>{livePreview.unitsTotal} {lang === "es" ? "pares" : "pairs"}</td>
                  </tr>
                  <tr>
                    <td>2</td>
                    <td>{lang === "es" ? "Flete aéreo internacional" : "International air freight"}</td>
                    <td>AWB / BL</td>
                    <td style={{ textAlign: "right" }}>—</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>
                      {isLiquidated ? (
                        <span>${fmt(livePreview.freight)}</span>
                      ) : (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
                          <span style={{ color: "#64748B", fontSize: 11 }}>$</span>
                          <input className="input tabular-nums" type="number" step="0.01" min="0"
                                 style={{ width: 110, textAlign: "right", padding: "4px 8px", fontSize: 12 }}
                                 value={(() => {
                                   const c = costLines.find(x => KIND_FREIGHT.has(String(x.kind || "").toUpperCase()));
                                   return c ? c.amount : "";
                                 })()}
                                 placeholder="0.00"
                                 onChange={(e) => {
                                   const val = e.target.value;
                                   const c = costLines.find(x => KIND_FREIGHT.has(String(x.kind || "").toUpperCase()));
                                   if (c) {
                                     updateCost(c.id, { amount: val });
                                   } else {
                                     const tempCost = {
                                       id: "temp-flete",
                                       kind: "FLETE",
                                       label: lang === "es" ? "Flete" : "Freight",
                                       amount: val,
                                       currency: "USD",
                                       fx_to_usd: 1,
                                       source: "MANUAL"
                                     };
                                     setCostLines((prev) => [...prev, tempCost]);
                                   }
                                 }}
                                 onBlur={() => {
                                   const target = costLines.find(x => KIND_FREIGHT.has(String(x.kind || "").toUpperCase()));
                                   if (target) {
                                     persistCost(target);
                                   }
                                 }}/>
                        </span>
                      )}
                    </td>
                    <td style={{ color: "#64748B", fontSize: 11 }}>{lang === "es" ? "Costo real registrado" : "Registered cost"}</td>
                  </tr>
                  <tr>
                    <td>3</td>
                    <td>{lang === "es" ? "Seguro internacional" : "International insurance"}</td>
                    <td>Factura</td>
                    <td style={{ textAlign: "right" }}>—</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>
                      {isLiquidated ? (
                        <span>${fmt(livePreview.insurance)}</span>
                      ) : (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
                          <span style={{ color: "#64748B", fontSize: 11 }}>$</span>
                          <input className="input tabular-nums" type="number" step="0.01" min="0"
                                 style={{ width: 110, textAlign: "right", padding: "4px 8px", fontSize: 12 }}
                                 value={(() => {
                                   const c = costLines.find(x => KIND_INSURANCE.has(String(x.kind || "").toUpperCase()));
                                   return c ? c.amount : "";
                                 })()}
                                 placeholder="0.00"
                                 onChange={(e) => {
                                   const val = e.target.value;
                                   const c = costLines.find(x => KIND_INSURANCE.has(String(x.kind || "").toUpperCase()));
                                   if (c) {
                                     updateCost(c.id, { amount: val });
                                   } else {
                                     const tempCost = {
                                       id: "temp-seguro",
                                       kind: "SEGURO",
                                       label: lang === "es" ? "Seguro" : "Insurance",
                                       amount: val,
                                       currency: "USD",
                                       fx_to_usd: 1,
                                       source: "MANUAL"
                                     };
                                     setCostLines((prev) => [...prev, tempCost]);
                                   }
                                 }}
                                 onBlur={() => {
                                   const target = costLines.find(x => KIND_INSURANCE.has(String(x.kind || "").toUpperCase()));
                                   if (target) {
                                     persistCost(target);
                                   }
                                 }}/>
                        </span>
                      )}
                    </td>
                    <td style={{ color: "#64748B", fontSize: 11 }}>{lang === "es" ? "Costo real registrado" : "Registered cost"}</td>
                  </tr>
                  <tr style={{ background: "rgba(11,30,58,0.02)", fontWeight: 700 }}>
                    <td colSpan={4}>CIF (base imponible aduana)</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>${fmt(livePreview.cifTotal)}</td>
                    <td></td>
                  </tr>
                  <tr>
                    <td>4</td>
                    <td>DAI — Derecho Arancelario</td>
                    <td>CIF</td>
                    <td style={{ textAlign: "right" }}>
                      {isLiquidated ? (
                        <span>{Number(livePreview.daiRate * 100).toFixed(2)}%</span>
                      ) : (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
                          <input className="input tabular-nums" type="number" step="0.01" min="0" max="100"
                                 style={{ width: 70, textAlign: "right", padding: "2px 4px", fontSize: 12 }}
                                 value={(livePreview.daiRate * 100).toFixed(2)}
                                 onChange={(e) => {
                                   const val = e.target.value;
                                   setCustomDaiRate(val === "" ? null : Number(val) / 100);
                                 }}
                                 onBlur={(e) => {
                                   const val = e.target.value;
                                   persistCustomRates({ dai: val === "" ? null : Number(val) / 100 });
                                 }}/>
                          <span>%</span>
                        </span>
                      )}
                    </td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>
                      {isLiquidated ? (
                        <span>${fmt(livePreview.daiTotal)}</span>
                      ) : (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
                          <span style={{ color: "#64748B", fontSize: 11 }}>$</span>
                          <input className="input tabular-nums" type="number" step="0.01" min="0"
                                 style={{ width: 110, textAlign: "right", padding: "4px 8px", fontSize: 12 }}
                                 value={livePreview.daiTotal.toFixed(2)}
                                 onChange={(e) => {
                                   const val = e.target.value;
                                   const cifBase = livePreview.cifTotal;
                                   if (cifBase > 0) {
                                     setCustomDaiRate(val === "" ? null : Number(val) / cifBase);
                                   }
                                 }}
                                 onBlur={(e) => {
                                   const val = e.target.value;
                                   const cifBase = livePreview.cifTotal;
                                   if (cifBase > 0) {
                                     persistCustomRates({ dai: val === "" ? null : Number(val) / cifBase });
                                   }
                                 }}/>
                        </span>
                      )}
                    </td>
                    <td style={{ color: "#64748B", fontSize: 11 }}>{lang === "es" ? "Régimen general calzado" : "General footwear regime"}</td>
                  </tr>
                  <tr>
                    <td>5</td>
                    <td>Ley 6946</td>
                    <td>CIF</td>
                    <td style={{ textAlign: "right" }}>
                      {isLiquidated ? (
                        <span>{Number(livePreview.leyRate * 100).toFixed(2)}%</span>
                      ) : (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
                          <input className="input tabular-nums" type="number" step="0.01" min="0" max="100"
                                 style={{ width: 70, textAlign: "right", padding: "2px 4px", fontSize: 12 }}
                                 value={(livePreview.leyRate * 100).toFixed(2)}
                                 onChange={(e) => {
                                   const val = e.target.value;
                                   setCustomLeyRate(val === "" ? null : Number(val) / 100);
                                 }}
                                 onBlur={(e) => {
                                   const val = e.target.value;
                                   persistCustomRates({ ley: val === "" ? null : Number(val) / 100 });
                                 }}/>
                          <span>%</span>
                        </span>
                      )}
                    </td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>
                      {isLiquidated ? (
                        <span>${fmt(livePreview.leyTotal)}</span>
                      ) : (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
                          <span style={{ color: "#64748B", fontSize: 11 }}>$</span>
                          <input className="input tabular-nums" type="number" step="0.01" min="0"
                                 style={{ width: 110, textAlign: "right", padding: "4px 8px", fontSize: 12 }}
                                 value={livePreview.leyTotal.toFixed(2)}
                                 onChange={(e) => {
                                   const val = e.target.value;
                                   const cifBase = livePreview.cifTotal;
                                   if (cifBase > 0) {
                                     setCustomLeyRate(val === "" ? null : Number(val) / cifBase);
                                   }
                                 }}
                                 onBlur={(e) => {
                                   const val = e.target.value;
                                   const cifBase = livePreview.cifTotal;
                                   if (cifBase > 0) {
                                     persistCustomRates({ ley: val === "" ? null : Number(val) / cifBase });
                                   }
                                 }}/>
                        </span>
                      )}
                    </td>
                    <td style={{ color: "#64748B", fontSize: 11 }}>{lang === "es" ? "Tributo fijo" : "Fixed tax"}</td>
                  </tr>
                  <tr>
                    <td>6</td>
                    <td>IVA</td>
                    <td>CIF</td>
                    <td style={{ textAlign: "right" }}>
                      {isLiquidated ? (
                        <span>{Number(livePreview.ivaRate * 100).toFixed(2)}%</span>
                      ) : (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
                          <input className="input tabular-nums" type="number" step="0.01" min="0" max="100"
                                 style={{ width: 70, textAlign: "right", padding: "2px 4px", fontSize: 12 }}
                                 value={(livePreview.ivaRate * 100).toFixed(2)}
                                 onChange={(e) => {
                                   const val = e.target.value;
                                   setCustomIvaRate(val === "" ? null : Number(val) / 100);
                                 }}
                                 onBlur={(e) => {
                                   const val = e.target.value;
                                   persistCustomRates({ iva: val === "" ? null : Number(val) / 100 });
                                 }}/>
                          <span>%</span>
                        </span>
                      )}
                    </td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>
                      {isLiquidated ? (
                        <span>${fmt(livePreview.ivaTotal)}</span>
                      ) : (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
                          <span style={{ color: "#64748B", fontSize: 11 }}>$</span>
                          <input className="input tabular-nums" type="number" step="0.01" min="0"
                                 style={{ width: 110, textAlign: "right", padding: "4px 8px", fontSize: 12 }}
                                 value={livePreview.ivaTotal.toFixed(2)}
                                 onChange={(e) => {
                                   const val = e.target.value;
                                   const cifBase = livePreview.cifTotal;
                                   if (cifBase > 0) {
                                     setCustomIvaRate(val === "" ? null : Number(val) / cifBase);
                                   }
                                 }}
                                 onBlur={(e) => {
                                   const val = e.target.value;
                                   const cifBase = livePreview.cifTotal;
                                   if (cifBase > 0) {
                                     persistCustomRates({ iva: val === "" ? null : Number(val) / cifBase });
                                   }
                                 }}/>
                        </span>
                      )}
                    </td>
                    <td style={{ color: "#64748B", fontSize: 11, fontStyle: "italic" }}>
                      {lang === "es" ? "Acreditable — crédito fiscal (no suma)" : "Creditable — VAT credit (excluded)"}
                    </td>
                  </tr>
                  {customTaxes.filter(x => x.type === "TAX").map((x, idx) => {
                    const rowNum = `6${String.fromCharCode(97 + idx)}`;
                    const amount = livePreview.cifTotal * ((x.rate || 0) / 100);
                    return (
                      <tr key={x.id}>
                        <td>{rowNum}</td>
                        <td>
                          {isLiquidated ? (
                            <strong>{x.concept}</strong>
                          ) : (
                            <input className="input" style={{ width: 180, padding: "2px 6px", fontSize: 12 }}
                                   value={x.concept}
                                   onChange={(e) => {
                                     const next = customTaxes.map(item => item.id === x.id ? { ...item, concept: e.target.value } : item);
                                     setCustomTaxes(next);
                                   }}
                                   onBlur={() => persistCustomTaxes(customTaxes)}/>
                          )}
                        </td>
                        <td>CIF</td>
                        <td style={{ textAlign: "right" }}>
                          {isLiquidated ? (
                            <span>{Number(x.rate || 0).toFixed(2)}%</span>
                          ) : (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
                              <input className="input tabular-nums" type="number" step="0.01" min="0" max="100"
                                     style={{ width: 70, textAlign: "right", padding: "2px 4px", fontSize: 12 }}
                                     value={x.rate}
                                     onChange={(e) => {
                                       const next = customTaxes.map(item => item.id === x.id ? { ...item, rate: Number(e.target.value) } : item);
                                       setCustomTaxes(next);
                                     }}
                                     onBlur={() => persistCustomTaxes(customTaxes)}/>
                              <span>%</span>
                            </span>
                          )}
                        </td>
                        <td className="tabular-nums" style={{ textAlign: "right" }}>
                          ${fmt(amount)}
                        </td>
                        <td>
                          {!isLiquidated && (
                            <button className="btn btn-ghost btn-xs" style={{ color: "#D64545", padding: "2px" }}
                                    onClick={() => {
                                      const next = customTaxes.filter(item => item.id !== x.id);
                                      setCustomTaxes(next);
                                      persistCustomTaxes(next);
                                    }}>
                              <IconTrash size={10}/>
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  <tr style={{ background: "rgba(11,30,58,0.02)", fontWeight: 700 }}>
                    <td colSpan={4}>{lang === "es" ? "Subtotal impuestos (con IVA)" : "Subtotal taxes (incl. VAT)"}</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>${fmt(livePreview.daiTotal + livePreview.leyTotal + livePreview.ivaTotal + livePreview.customTaxesSum)}</td>
                    <td></td>
                  </tr>
                  {costLines.filter(c => {
                    const k = String(c.kind || "").toUpperCase();
                    return !KIND_FREIGHT.has(k) && !KIND_INSURANCE.has(k);
                  }).map((c, idx) => (
                    <tr key={c.id}>
                      <td>{7 + idx}</td>
                      <td>{c.label || c.kind}</td>
                      <td>{c.kind}</td>
                      <td style={{ textAlign: "right" }}>—</td>
                      <td className="tabular-nums" style={{ textAlign: "right" }}>
                        {isLiquidated ? (
                          <span>${fmt(Number(c.amount) * Number(c.fx_to_usd || 1))}</span>
                        ) : (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
                            <span style={{ color: "#64748B", fontSize: 11 }}>
                              {c.currency === "USD" ? "$" : `${c.currency} `}
                            </span>
                            <input className="input tabular-nums" type="number" step="0.01" min="0"
                                   style={{ width: 110, textAlign: "right", padding: "4px 8px", fontSize: 12 }}
                                   value={c.amount}
                                   onChange={(e) => updateCost(c.id, { amount: e.target.value })}
                                   onBlur={() => persistCost(c)}/>
                          </span>
                        )}
                      </td>
                      <td style={{ color: "#64748B", fontSize: 11 }}>{lang === "es" ? "Costo en destino" : "Destination cost"}</td>
                    </tr>
                  ))}
                  {customTaxes.filter(x => x.type === "COST").map((x, idx) => {
                    const rowNum = 7 + costLines.filter(c => {
                      const k = String(c.kind || "").toUpperCase();
                      return !KIND_FREIGHT.has(k) && !KIND_INSURANCE.has(k);
                    }).length + idx;
                    return (
                      <tr key={x.id}>
                        <td>{rowNum}</td>
                        <td>
                          {isLiquidated ? (
                            <strong>{x.concept}</strong>
                          ) : (
                            <input className="input" style={{ width: 180, padding: "2px 6px", fontSize: 12 }}
                                   value={x.concept}
                                   onChange={(e) => {
                                     const next = customTaxes.map(item => item.id === x.id ? { ...item, concept: e.target.value } : item);
                                     setCustomTaxes(next);
                                   }}
                                   onBlur={() => persistCustomTaxes(customTaxes)}/>
                          )}
                        </td>
                        <td>OTRO</td>
                        <td style={{ textAlign: "right" }}>—</td>
                        <td className="tabular-nums" style={{ textAlign: "right" }}>
                          {isLiquidated ? (
                            <span>${fmt(x.amount)}</span>
                          ) : (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
                              <span style={{ color: "#64748B", fontSize: 11 }}>$</span>
                              <input className="input tabular-nums" type="number" step="0.01" min="0"
                                     style={{ width: 110, textAlign: "right", padding: "4px 8px", fontSize: 12 }}
                                     value={x.amount}
                                     onChange={(e) => {
                                       const next = customTaxes.map(item => item.id === x.id ? { ...item, amount: Number(e.target.value) } : item);
                                       setCustomTaxes(next);
                                     }}
                                     onBlur={() => persistCustomTaxes(customTaxes)}/>
                            </span>
                          )}
                        </td>
                        <td>
                          <span style={{ color: "#64748B", fontSize: 11, marginRight: 8 }}>{lang === "es" ? "Costo en destino" : "Destination cost"}</span>
                          {!isLiquidated && (
                            <button className="btn btn-ghost btn-xs" style={{ color: "#D64545", padding: "2px", display: "inline-flex", verticalAlign: "middle" }}
                                    onClick={() => {
                                      const next = customTaxes.filter(item => item.id !== x.id);
                                      setCustomTaxes(next);
                                      persistCustomTaxes(next);
                                    }}>
                              <IconTrash size={10}/>
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  <tr style={{ background: "rgba(11,30,58,0.02)", fontWeight: 700 }}>
                    <td colSpan={4}>{lang === "es" ? "Subtotal costos destino" : "Subtotal destination costs"}</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>${fmt(livePreview.destTotal + livePreview.customCostsSum)}</td>
                    <td></td>
                  </tr>
                  <tr style={{ background: "var(--text-secondary, #475569)", color: "white", fontWeight: 700 }}>
                    <td colSpan={4} style={{ color: "white" }}>{lang === "es" ? "Total con IVA (incluye crédito fiscal)" : "Total incl. VAT (includes credit)"}</td>
                    <td className="tabular-nums" style={{ textAlign: "right", color: "white" }}>
                      ${fmt(livePreview.landedTotal + livePreview.ivaTotal)}
                    </td>
                    <td style={{ color: "rgba(255,255,255,0.8)", fontSize: 11 }}>{lang === "es" ? "embarque completo" : "complete shipment"}</td>
                  </tr>
                  <tr style={{ background: "#0B1E3A", color: "white", fontWeight: 700 }}>
                    <td colSpan={4} style={{ color: "white" }}>
                      {viewerIsMwt
                        ? (lang === "es" ? "TOTAL SIN IVA — costo real de MWT" : "TOTAL EXCL. VAT — real MWT cost")
                        : (lang === "es" ? "TOTAL SIN IVA — costo real de nacionalizar" : "TOTAL EXCL. VAT — real nationalization cost")}
                    </td>
                    <td className="tabular-nums" style={{ textAlign: "right", color: "#1DE394", fontSize: 14 }}>
                      ${fmt(livePreview.landedTotal)}
                    </td>
                    <td style={{ color: "rgba(255,255,255,0.8)", fontSize: 11 }}>{lang === "es" ? "ver $/par por línea abajo" : "see $/pair by line below"}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Tabla 2: Costo nacionalizado por línea */}
            <div className="card card-pad-0" style={{ overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", background: "var(--raised)", borderBottom: "1.5px solid var(--border-subtle, #E1E6ED)" }}>
                <h4 style={{ margin: 0, color: "#0B1E3A", fontSize: 13, fontWeight: 700 }}>
                  {viewerIsMwt
                    ? (lang === "es" ? "COSTO NACIONALIZADO POR LÍNEA (BASE UF, SIN IVA)" : "NATIONALIZED COST BY LINE (UF BASE, EXCL. VAT)")
                    : (lang === "es" ? "COSTO NACIONALIZADO POR LÍNEA (BASE PRECIO ORDEN SN, SIN IVA)" : "NATIONALIZED COST BY LINE (SN BASE, EXCL. VAT)")}
                </h4>
              </div>
              <table className="table" style={{ fontSize: 12.5 }}>
                <thead>
                  <tr>
                    <th>{lang === "es" ? "Expediente" : "Expediente"}</th>
                    <th>SKU / {lang === "es" ? "Lote" : "Lot"}</th>
                    <th>{lang === "es" ? "Producto" : "Product"}</th>
                    <th>{lang === "es" ? "Talla" : "Size"}</th>
                    <th style={{ textAlign: "right" }}>{lang === "es" ? "Pares" : "Pairs"}</th>
                    <th style={{ textAlign: "right" }}>{viewerIsMwt ? "FOB UF" : "FOB SN"}</th>
                    <th style={{ textAlign: "right" }}>CIF</th>
                    <th style={{ textAlign: "right" }}>DAI</th>
                    <th style={{ textAlign: "right" }}>L6946</th>
                    <th style={{ textAlign: "right" }}>{lang === "es" ? "Aduana+Transp" : "Customs+Transp"}</th>
                    <th style={{ textAlign: "right", color: "#00B286" }}>{lang === "es" ? "Landed Unit" : "Landed Unit"}</th>
                    <th style={{ textAlign: "right" }}>Landed Total</th>
                  </tr>
                </thead>
                <tbody>
                  {livePreview.lines.map((l) => {
                    const editingVal = editingUnitValue[l.line_id];
                    const displayVal = editingVal !== undefined
                      ? editingVal
                      : Number(l.unit_fob_usd || 0).toFixed(4);
                    return (
                      <tr key={l.line_id}>
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
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
                              <span style={{ color: "#64748B", fontSize: 11 }}>$</span>
                              <input className="input tabular-nums"
                                     type="number" step="0.0001" min="0"
                                     style={{
                                       width: 88, textAlign: "right",
                                       padding: "4px 6px", fontSize: 12,
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
                                     title="Editar FOB unitario"/>
                            </span>
                          )}
                        </td>
                        <td className="tabular-nums" style={{ textAlign: "right" }}>
                          {renderEditableCell(l.line_id, "cif", l.cif, "0.01", 2)}
                        </td>
                        <td className="tabular-nums" style={{ textAlign: "right" }}>
                          {renderEditableCell(l.line_id, "dai", l.dai, "0.01", 2)}
                        </td>
                        <td className="tabular-nums" style={{ textAlign: "right" }}>
                          {renderEditableCell(l.line_id, "ley", l.ley, "0.01", 2)}
                        </td>
                        <td className="tabular-nums" style={{ textAlign: "right" }}>
                          {renderEditableCell(l.line_id, "dest", l.dest, "0.01", 2)}
                        </td>
                        <td className="tabular-nums landed" style={{ textAlign: "right", fontWeight: 700, color: "#00B286" }}>
                          {renderEditableCell(l.line_id, "landed_unit_usd", l.landed_unit_usd, "0.0001", 4)}
                        </td>
                        <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 700 }}>
                          {renderEditableCell(l.line_id, "landed_total_usd", l.landed_total_usd, "0.01", 2)}
                        </td>
                      </tr>
                    );
                  })}
                  <tr style={{ background: "rgba(0,178,134,0.06)", fontWeight: 700 }}>
                    <td colSpan={4}>{lang === "es" ? "TOTALES" : "TOTALS"}</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>{livePreview.unitsTotal}</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>${fmt(livePreview.fobTotal)}</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>${fmt(livePreview.cifTotal)}</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>${fmt(livePreview.daiTotal)}</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>${fmt(livePreview.leyTotal)}</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>${fmt(livePreview.destTotal)}</td>
                    <td></td>
                    <td className="tabular-nums" style={{ textAlign: "right", color: "#00B286", fontSize: 14 }}>
                      ${fmt(livePreview.landedTotal)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Tabla 3: Líneas a facturar */}
            <div className="card card-pad-0" style={{ overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", background: "var(--raised)", borderBottom: "1.5px solid var(--border-subtle, #E1E6ED)" }}>
                <h4 style={{ margin: 0, color: "#0B1E3A", fontSize: 13, fontWeight: 700 }}>
                  {lang === "es" ? "LÍNEAS A FACTURAR — PRECIO NACIONALIZADO + IVA 13% (TALLAS ENTREGADAS)" : "LINES TO INVOICE — LANDED COST + 13% VAT (DELIVERED SIZES)"}
                </h4>
              </div>
              <table className="table" style={{ fontSize: 12.5 }}>
                <thead>
                  <tr>
                    <th>SKU / {lang === "es" ? "Lote" : "Lot"}</th>
                    <th>{lang === "es" ? "Producto" : "Product"}</th>
                    <th>{lang === "es" ? "Talla" : "Size"}</th>
                    <th style={{ textAlign: "right" }}>{lang === "es" ? "Pares entregados" : "Delivered pairs"}</th>
                    <th style={{ textAlign: "right" }}>{lang === "es" ? "Precio nacionalizado" : "Landed unit price"}</th>
                    <th style={{ textAlign: "right" }}>Subtotal</th>
                    <th style={{ textAlign: "right" }}>IVA {Number(livePreview.ivaRate * 100).toFixed(0)}%</th>
                    <th style={{ textAlign: "right", color: "#7C3AED" }}>Total con IVA</th>
                  </tr>
                </thead>
                <tbody>
                  {livePreview.lines.map((l) => {
                    const subtotal = l.qty * l.landed_unit_usd;
                    const iva = subtotal * livePreview.ivaRate;
                    const totalConIva = subtotal + iva;
                    return (
                      <tr key={l.line_id}>
                        <td className="mono-sm">
                          <div>{l.sku}</div>
                          {l.lote && <div className="caption">L: {l.lote}</div>}
                        </td>
                        <td>{l.product_label}</td>
                        <td>{l.size || "—"}</td>
                        <td className="tabular-nums" style={{ textAlign: "right" }}>{l.qty}</td>
                        <td className="tabular-nums" style={{ textAlign: "right" }}>${fmt4(l.landed_unit_usd)}</td>
                        <td className="tabular-nums" style={{ textAlign: "right" }}>${fmt(subtotal)}</td>
                        <td className="tabular-nums" style={{ textAlign: "right" }}>${fmt(iva)}</td>
                        <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 700, color: "#7C3AED" }}>
                          ${fmt(totalConIva)}
                        </td>
                      </tr>
                    );
                  })}
                  <tr style={{ background: "rgba(124,58,237,0.06)", fontWeight: 700 }}>
                    <td colSpan={3}>{lang === "es" ? "TOTALES" : "TOTALS"}</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>{livePreview.unitsTotal}</td>
                    <td></td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>${fmt(livePreview.landedTotal)}</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>${fmt(livePreview.ivaTotal)}</td>
                    <td className="tabular-nums" style={{ textAlign: "right", color: "#7C3AED", fontSize: 14 }}>
                      ${fmt(livePreview.landedTotal + livePreview.ivaTotal)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Botón Liquidar (Ocultado por requerimiento de usuario) ──
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
        ── */}

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

        {/* Costo nacionalizado por línea (base UF, sin IVA) - SKU grouped card */}
        {livePreview.lines.length > 0 && (
          <div className="card card-pad-0" style={{ marginTop: 24, overflow: "hidden", borderTop: "4px solid #00B286" }}>
            <div style={{ padding: "14px 18px", borderBottom: "1.5px solid var(--border-subtle, #E1E6ED)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, color: "#0B1E3A", fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5 }}>
                {viewerIsMwt
                  ? (lang === "es" ? "Costo nacionalizado por línea (base UF, sin IVA)" : "Nationalized cost by line (UF base, excl. VAT)")
                  : (lang === "es" ? "Costo nacionalizado por línea (base precio orden SN, sin IVA)" : "Nationalized cost by line (SN base, excl. VAT)")}
              </h3>
              <span style={{ fontSize: 11, color: "var(--text-tertiary)", fontWeight: 600 }}>
                {viewerIsMwt ? (lang === "es" ? "MWT · DDP contable (real)" : "MWT · DDP real (contable)") : (lang === "es" ? "SONDEL · Nacionalización DDP (referencia)" : "SONDEL · DDP Nationalization (reference)")}
              </span>
            </div>
            <div className="card-b" style={{ padding: 0 }}>
              <table className="table" style={{ fontSize: 12.5 }}>
                <thead>
                  <tr>
                    <th>{lang === "es" ? "Modelo" : "Model"}</th>
                    <th style={{ textAlign: "right" }}>{lang === "es" ? "Pares" : "Pairs"}</th>
                    <th style={{ textAlign: "right" }}>{viewerIsMwt ? "FOB UF" : "FOB SN"}</th>
                    <th style={{ textAlign: "right" }}>CIF</th>
                    <th style={{ textAlign: "right" }}>DAI</th>
                    <th style={{ textAlign: "right" }}>L6946</th>
                    <th style={{ textAlign: "right" }}>{lang === "es" ? "Aduana+Transp" : "Customs+Transp"}</th>
                    <th style={{ textAlign: "right" }}>{lang === "es" ? "Nac. s/IVA" : "Nac. excl. VAT"}</th>
                    <th style={{ textAlign: "right", color: "#00B286" }}>{viewerIsMwt ? "$/par" : "Nac/par"}</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const groupsMap = new Map();
                    livePreview.lines.forEach((item) => {
                      const sku = item.sku || "—";
                      const g = groupsMap.get(sku) || {
                        sku,
                        product_label: item.product_label,
                        qty: 0,
                        goods: 0,
                        cif: 0,
                        dai: 0,
                        ley: 0,
                        dest: 0,
                        iva: 0,
                        total: 0,
                      };
                      g.qty += item.qty;
                      g.goods += item.fob_total_usd;
                      g.cif += item.cif;
                      g.dai += item.dai;
                      g.ley += item.ley;
                      g.dest += item.dest;
                      g.iva += item.iva;
                      g.total += item.landed_total_usd;
                      groupsMap.set(sku, g);
                    });
                    
                    return Array.from(groupsMap.values()).map((g) => {
                      const perPar = g.qty > 0 ? g.total / g.qty : 0;
                      return (
                        <tr key={g.sku}>
                          <td className="mono-sm" style={{ fontWeight: 600 }}>{g.sku} &middot; {g.product_label}</td>
                          <td className="tabular-nums" style={{ textAlign: "right" }}>{fmtInt(g.qty)}</td>
                          <td className="tabular-nums" style={{ textAlign: "right" }}>${fmt(g.goods)}</td>
                          <td className="tabular-nums" style={{ textAlign: "right" }}>
                            {renderSkuEditableCell(g.sku, "cif", g.cif, "0.01", 2)}
                          </td>
                          <td className="tabular-nums" style={{ textAlign: "right" }}>
                            {renderSkuEditableCell(g.sku, "dai", g.dai, "0.01", 2)}
                          </td>
                          <td className="tabular-nums" style={{ textAlign: "right" }}>
                            {renderSkuEditableCell(g.sku, "ley", g.ley, "0.01", 2)}
                          </td>
                          <td className="tabular-nums" style={{ textAlign: "right" }}>
                            {renderSkuEditableCell(g.sku, "dest", g.dest, "0.01", 2)}
                          </td>
                          <td className="tabular-nums" style={{ textAlign: "right" }}>
                            {renderSkuEditableCell(g.sku, "landed_total_usd", g.total, "0.01", 2)}
                          </td>
                          <td className="tabular-nums landed" style={{ textAlign: "right", fontWeight: 700, color: "#00B286" }}>
                            {renderSkuEditableCell(g.sku, "landed_unit_usd", perPar, "0.0001", 4)}
                          </td>
                        </tr>
                      );
                    });
                  })()}
                  <tr style={{ background: "rgba(0,178,134,0.06)", fontWeight: 700 }}>
                    <td>{lang === "es" ? "TOTAL" : "TOTAL"}</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>{fmtInt(livePreview.unitsTotal)}</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>${fmt(livePreview.fobTotal)}</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>${fmt(livePreview.cifTotal)}</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>${fmt(livePreview.daiTotal)}</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>${fmt(livePreview.leyTotal)}</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>${fmt(livePreview.destTotal)}</td>
                    <td className="tabular-nums" style={{ textAlign: "right" }}>${fmt(livePreview.landedTotal)}</td>
                    <td className="tabular-nums" style={{ textAlign: "right", color: "#00B286", fontSize: 13 }}>
                      ${fmt(livePreview.unitsTotal > 0 ? livePreview.landedTotal / livePreview.unitsTotal : 0)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
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
              ? (lang === "es" ? "No hay líneas en el movimiento" : "No transfer lines")
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
