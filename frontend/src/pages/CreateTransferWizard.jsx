// ─────────────────────────────────────────────────────────────
// CreateTransferWizard — Motor de transferencias (FULL PAGE)
// Sprint Transfer Engine v2 · 2026-04-29
// Agente responsable: [AG-FRONTEND]
//
// Reemplaza al CreateTransferDrawer (modal lateral). Vive en
// /transferencias/nueva como página dedicada del shell.
//
// 4 pasos:
//   1. Contexto y Nodos    — origen / destino / motivo + Dropzone DUA
//   2. Costos Operativos   — tabla editable (auto-llenada por OCR)
//   3. Productos           — líneas con stock disponible en origen
//   4. Validación          — totales, desglose, costo total, registrar
//
// Tokens: Navy #0B1E3A · Mint #00B286 · tabular-nums.
// ─────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  IconChevLeft, IconChevRight, IconCheck, IconX, IconAlert, IconPlus,
  IconUpload, IconRefresh, IconTruck, IconArrow, IconFileText,
  IconPackage, IconDollar, IconSettings, IconSparkle, IconTrash,
} from "../lib/icons.jsx";
import { fmtMoney } from "../lib/i18n.js";
import {
  transferenciasApi, nodosApi, stockApi, apiFetch, currencyCatApi,
  nodoAssignmentsApi,
} from "../lib/api.js";
import { useRole } from "../context/RoleContext.jsx";
import Step3TransferAssign from "../components/transfers/Step3TransferAssign.jsx";
import CostScopeModal      from "../components/transfers/CostScopeModal.jsx";

// ── Catálogo legal (espejo del backend transfers.legal_context_cat) ──
const LEGAL_CONTEXT = [
  { codigo:"INTERNAL",        label:"Interno / Redistribución", desc:"Movimiento intra-entidad, sin fiscalía",     color:"#64748B" },
  { codigo:"NATIONALIZATION", label:"Nacionalización",          desc:"Ingreso fiscal · DUA / despacho aduanero",   color:"#481EE3" },
  { codigo:"EXPORT",          label:"Reexportación",            desc:"Salida internacional bajo régimen",          color:"#3083FE" },
  { codigo:"DISTRIBUTION",    label:"Distribución",             desc:"Envío a distribuidor / marketplace",         color:"#00B286" },
  { codigo:"CONSIGNMENT",     label:"Consignación",             desc:"Propiedad retenida · reporte semanal",       color:"#B45309" },
];
const NEEDS_CUSTOMS_DOC = new Set(["NATIONALIZATION", "EXPORT"]);

// ── Capacidades canónicas (espejo backend serializer.validate) ──
const CAP_DISPATCH = "DISPATCH";
const CAP_RECEIVE  = "RECEIVE";

// ── Catálogo de tipos de costo (fallback si /select_cost_kinds falla) ──
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

// Sprint 2026-05-13 · Fase 9 — Swap: Productos PRIMERO (paso 2), Costos
// DESPUÉS (paso 3). El operador necesita ver qué expedientes/líneas va
// a mover antes de poder asignar costos por scope (todos · alguno · solo
// estas líneas). El paso 4 sigue siendo la validación final.
const STEPS = [
  { id:1, label:"Contexto y nodos" },
  { id:2, label:"Productos" },
  { id:3, label:"Costos operativos" },
  { id:4, label:"Validación y totales" },
];

// ─────────────────────────────────────────────────────────────
// COMPONENTE PRINCIPAL
// ─────────────────────────────────────────────────────────────
export default function CreateTransferWizard() {
  const navigate = useNavigate();
  const { lang = "es" } = useOutletContext() || {};
  const [step, setStep] = useState(1);

  // Estado global del wizard
  const [origenId,      setOrigenId]      = useState("");
  const [destinoId,     setDestinoId]     = useState("");
  const [legalContext,  setLegalContext]  = useState("INTERNAL");
  const [refTracking,   setRefTracking]   = useState("");
  const [notes,         setNotes]         = useState("");
  const [contextData,   setContextData]   = useState({});

  // Sprint v3.5 — Documentos legales por motivo (UUIDs/strings que el
  // backend persiste en transferencia.{supplier_invoice_document_id, …}).
  // Por simplicidad, hoy guardamos el nombre del archivo como
  // identificador placeholder; cuando integremos el upload-real (MinIO)
  // estos campos pasarán a UUIDs devueltos por el endpoint de subida.
  const [legalDocs, setLegalDocs] = useState({
    supplier_invoice: null,
    export_invoice:   null,
    freight_quote:    null,
    remission_guide:  null,
  });
  const setLegalDoc = (k, file) => setLegalDocs(p => ({ ...p, [k]: file }));
  const [costLines,     setCostLines]     = useState([]);  // [{tmpId, kind, label, amount, currency, source, ocr_confidence}]
  const [productLines,  setProductLines]  = useState([]);  // [{tmpId, sku, producto_id, product_label, size, qty_transfer, qty_reserve, disponible}]
  // Sprint 2026-05-13 · Fase 8 — el nuevo paso 3 emite items con
  // expediente_id incluido (no son sólo SKUs sueltos sino asignaciones
  // exp→nodo). Se mantienen en paralelo a productLines: el primer state
  // alimenta el endpoint /nodo-assignments/transfer/, el segundo sigue
  // alimentando el resumen Step4 + el legacy create() de la transferencia.
  const [transferItems, setTransferItems] = useState([]);
  const [transferItemsValid, setTransferItemsValid] = useState(false);
  const [docFile,       setDocFile]       = useState(null);
  const [ocrLoading,    setOcrLoading]    = useState(false);
  const [ocrResult,     setOcrResult]     = useState(null);
  const [saving,        setSaving]        = useState(false);
  const [error,         setError]         = useState(null);

  // Catálogos
  const [nodos,        setNodos]         = useState([]);
  const [costKinds,    setCostKinds]     = useState(COST_KINDS_FALLBACK);
  const [stockOrigen,  setStockOrigen]   = useState([]);
  // ISO 4217 — pricing.currency_cat (47 monedas seedeadas en SQL 64).
  // Default: USD por si el endpoint falla o aún no está disponible.
  const [currencies,   setCurrencies]    = useState([
    { codigo: "USD", nombre: "US Dollar", symbol: "$" },
  ]);

  // ── Carga catálogos al montar ──
  useEffect(() => {
    nodosApi.list({ is_active: true }).then((d) => {
      const arr = Array.isArray(d) ? d : (d?.results || []);
      setNodos(arr);
    }).catch(() => setNodos([]));

    // Catálogo de monedas ISO 4217 — el FE puebla un SELECT en Step 2
    // para que los costos operativos puedan registrarse en la moneda
    // del documento aduanal (DUA en COP, factura en EUR, etc.).
    currencyCatApi.list({ is_active: "true", limit: 100 })
      .then((d) => {
        const arr = Array.isArray(d) ? d : (d?.results || []);
        if (arr.length > 0) setCurrencies(arr);
      })
      .catch(() => { /* mantén el default USD */ });

    transferenciasApi.action("select_cost_kinds").then((d) => {
      if (Array.isArray(d) && d.length) setCostKinds(d);
    }).catch(() => {});
  }, []);

  // ── Cuando cambia el origen, traer su stock ──
  //
  // /api/stock/?nodo=<id> devuelve TODAS las filas del ledger del nodo
  // del nodo. Consolidamos por (producto, lote, talla):
  //   · Si lote es vacío ("" o "—"), el bucket aún se crea con lote="(sin lote)".
  //     Antes había una regla que descartaba estas filas y solo las usaba
  //     como "ajuste" sobre buckets existentes — eso hacía desaparecer
  //     productos cuyo único stock estuviera sin lote. Sprint 2026-04-30:
  //     siempre se crea bucket aunque el lote esté vacío.
  //   · Filas con misma (producto, lote, talla) se suman.
  //   · Buckets con qty_disponible <= 0 se ocultan al final.
  useEffect(() => {
    if (!origenId) { setStockOrigen([]); return; }
    stockApi.list({ nodo: origenId }).then((d) => {
      const arr = Array.isArray(d) ? d : (d?.results || []);
      const onNode = arr.filter((r) => !r.nodo_id || String(r.nodo_id) === String(origenId));

      // Buckets por (producto, lote, talla) — sprint Stock-by-size.
      // Cada talla del mismo SKU tiene su bucket independiente para que
      // el operador pueda transferir, ej., 5 unidades de talla 43 sin
      // tocar las 3 unidades de talla 44 del mismo lote.
      const buckets = new Map();

      for (const r of onNode) {
        const a = adaptStockRow(r);
        const productoId = a.producto_id || a.sku || "";
        const tallaKey   = (a.size || "").toUpperCase();
        // Lote vacío → usamos la string vacía "" como key. Sigue siendo
        // un bucket válido, el wizard lo enviará con lote="" al backend.
        const loteKey    = (a.lote || "").trim();
        const key = `${productoId}|${loteKey}|${tallaKey}`;
        const prev = buckets.get(key);
        if (prev) {
          prev.qty_disponible += a.qty_disponible;
          prev.qty_reservada  += a.qty_reservada;
          if (a.qty_disponible > 0 && (!prev.unit_cost || a.unit_cost > 0)) {
            prev.unit_cost = a.unit_cost || prev.unit_cost;
          }
        } else {
          buckets.set(key, { ...a, lote: loteKey, _key: key });
        }
      }

      const consolidated = Array.from(buckets.values()).filter((s) => s.qty_disponible > 0);
      setStockOrigen(consolidated);
    }).catch(() => setStockOrigen([]));
  }, [origenId]);

  // ── Reset contextData al cambiar el motivo (campos pueden no aplicar) ──
  useEffect(() => { setContextData({}); }, [legalContext]);

  // Sprint 2026-05-13 · Fase 8 — sync transferItems → productLines.
  // Mantenemos productLines (legacy) para que el resumen del paso 4 y el
  // payload de transferenciasApi.create() sigan funcionando. El paso 3
  // nuevo es la fuente de verdad ahora — productLines es derivada.
  useEffect(() => {
    setProductLines(transferItems.map((it, i) => ({
      tmpId:         `ti-${i}-${it.producto_id}-${it.talla || ""}`,
      sku:           it._sku || "",
      producto_id:   it.producto_id,
      product_label: it._nombre || it._sku || "",
      size:          it.talla || "",
      lote:          "",
      qty_transfer:  Number(it.qty) || 0,
      qty_reserve:   0,
      disponible:    Number(it._disponible_origen || 0),
      unit_cost:     0,
      unit_value:    0,
      // Metadata para el bloque "Stock movido" del paso 4.
      _expediente_codigo: it._expediente_codigo,
      _proforma_codigo:   it._proforma_codigo,
    })));
  }, [transferItems]);

  // ── Filtrado dinámico de nodos por capacidad ──
  const nodosOrigen  = useMemo(() => nodos.filter((n) => hasCap(n, CAP_DISPATCH)), [nodos]);
  const nodosDestino = useMemo(() => nodos.filter((n) => hasCap(n, CAP_RECEIVE) && n.id !== origenId), [nodos, origenId]);

  // ── Validación de paso ──
  const canAdvance = useMemo(() => {
    if (step === 1) {
      if (!origenId || !destinoId || origenId === destinoId) return false;
      // DISTRIBUTION requiere transfer_pricing_amount > 0
      if (legalContext === "DISTRIBUTION") {
        const tp = Number(contextData?.transfer_pricing_amount || 0);
        if (!tp || tp <= 0) return false;
      }
      return true;
    }
    // Sprint 2026-05-13 · Fase 9 — Swap: paso 2 = Productos, paso 3 = Costos.
    if (step === 2) {
      // Productos primero — al menos un item con qty > 0.
      return transferItemsValid;
    }
    if (step === 3) {
      // Costos son opcionales — siempre se puede avanzar.
      return true;
    }
    return true;
  }, [step, origenId, destinoId, legalContext, docFile, costLines,
      productLines, transferItemsValid]);

  // ── OCR Aduanal ──
  const runOCR = useCallback(async (file) => {
    setOcrLoading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      // postMultipart a /api/transferencias/ocr_customs/
      const res = await fetch("/api/transferencias/ocr_customs/", {
        method: "POST", body: fd,
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.detail || `HTTP ${res.status}`);
      }
      const payload = await res.json();
      setOcrResult(payload);
      // Auto-llenar costLines con lo extraído (source = OCR_DUA)
      if (Array.isArray(payload.lines) && payload.lines.length) {
        const ocrLines = payload.lines.map((l, i) => ({
          tmpId:          `ocr-${Date.now()}-${i}`,
          kind:           l.kind,
          label:          l.label || labelForKind(costKinds, l.kind),
          amount:         Number(l.amount || 0),
          currency:       l.currency || "USD",
          fx_to_usd:      1,
          source:         "OCR_DUA",
          ocr_confidence: Number(l.confidence || 0),
        }));
        setCostLines((prev) => [...ocrLines, ...prev]);
      }
    } catch (e) {
      setError(e?.message || "OCR falló");
    } finally {
      setOcrLoading(false);
    }
  }, [costKinds]);

  const handleDoc = (file) => {
    setDocFile(file);
    setOcrResult(null);
    if (NEEDS_CUSTOMS_DOC.has(legalContext)) {
      runOCR(file);
    }
  };

  // ── Helpers de productos ──
  const addProductLine = (s) => {
    if (!s) return;
    // Clave de unicidad: sku + lote + size (mismo SKU puede venir en
    // varios lotes con cantidades distintas).
    const key = (l) => `${l.sku}|${l.lote || ""}|${l.size || ""}`;
    if (productLines.some((l) => key(l) === `${s.sku}|${s.lote || ""}|${s.size || ""}`)) return;
    setProductLines((prev) => [...prev, {
      tmpId:         `pl-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
      sku:           s.sku,
      producto_id:   s.producto_id,
      product_label: s.product_label || s.sku,
      size:          s.size || "",
      lote:          s.lote || "",
      qty_transfer:  0,
      qty_reserve:   0,
      disponible:    Number(s.qty_disponible || 0),
      // unit_cost = costo histórico del lote en el stock origen (referencia).
      unit_cost:     Number(s.unit_cost || 0),
      // unit_value = valor a usar en la base FOB del prorrateo de Landed Cost
      // (sprint Transfer Engine v3). Default: el unit_cost del stock origen
      // — el operador puede editarlo si el valor declarado para aduanas es
      // distinto al costo de adquisición.
      unit_value:    Number(s.unit_cost || 0),
    }]);
  };
  const updateProductLine = (tmpId, patch) => {
    setProductLines((prev) => prev.map((l) => l.tmpId === tmpId ? { ...l, ...patch } : l));
  };
  const removeProductLine = (tmpId) => {
    setProductLines((prev) => prev.filter((l) => l.tmpId !== tmpId));
  };

  // ── Helpers de costos ──
  // Sprint 2026-05-13 · Fase 9.1 — addCostLine acepta un patch opcional
  // para aplicar valores iniciales (típicamente {scope}) cuando la fila
  // se crea desde el flow "+ Agregar costo → scope modal → guardar".
  const addCostLine = (patch = {}) => {
    setCostLines((prev) => [...prev, {
      tmpId:    `c-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
      kind:     "OTRO",
      label:    "",
      amount:   0,
      currency: "USD",
      fx_to_usd: 1,
      source:   "MANUAL",
      // Scope opcional · null = aplica a TODO.
      scope:    null,
      ...patch,
    }]);
  };
  const updateCostLine = (tmpId, patch) => {
    setCostLines((prev) => prev.map((c) => c.tmpId === tmpId ? { ...c, ...patch } : c));
  };
  const removeCostLine = (tmpId) => {
    setCostLines((prev) => prev.filter((c) => c.tmpId !== tmpId));
  };

  // ── Totales ──
  const totals = useMemo(() => {
    const totalUnits   = productLines.reduce((a, l) => a + Number(l.qty_transfer || 0), 0);
    const totalReserve = productLines.reduce((a, l) => a + Number(l.qty_reserve  || 0), 0);
    const totalFree    = totalUnits - totalReserve;
    const totalCostUsd = costLines.reduce((a, c) =>
      a + Number(c.amount || 0) * Number(c.fx_to_usd || 1), 0);
    // FOB base = qty * unit_value (no unit_cost). El unit_value es el
    // declarado por el operador en Step 3 — puede diferir del costo
    // histórico del lote.
    const totalValueUsd = productLines.reduce((a, l) =>
      a + Number(l.qty_transfer || 0) * Number(l.unit_value || l.unit_cost || 0), 0);
    return { totalUnits, totalReserve, totalFree, totalCostUsd, totalValueUsd };
  }, [productLines, costLines]);

  // ── Submit final ──
  const submit = async () => {
    if (saving) return;
    setSaving(true); setError(null);
    try {
      const payload = {
        codigo:        `TRF-${new Date().toISOString().slice(0,10).replace(/-/g,"")}-${Math.random().toString(36).slice(2,6).toUpperCase()}`,
        origen_id:     origenId,
        destino_id:    destinoId,
        origen_label:  nodos.find((n) => n.id === origenId)?.codigo || "",
        destino_label: nodos.find((n) => n.id === destinoId)?.codigo || "",
        legal_context: legalContext,
        ref_tracking:  refTracking || null,
        notes:         notes || null,
        estado:        "PLANNED",
        value_usd:     totals.totalValueUsd,
        context_data:  contextData || {},
        // Sprint v3.5 — Documentos legales por motivo. El nombre del
        // archivo va como placeholder; cuando se integre upload real
        // a MinIO, estos serán UUIDs del artifact_instance creado.
        // El backend filtra los campos que no aplican al motivo.
        supplier_invoice_document_id: legalDocs.supplier_invoice?.name?.slice(0,36) || null,
        export_invoice_document_id:   legalDocs.export_invoice?.name?.slice(0,36)   || null,
        freight_quote_document_id:    legalDocs.freight_quote?.name?.slice(0,36)    || null,
        remission_guide_document_id:  legalDocs.remission_guide?.name?.slice(0,36)  || null,
        lineas: productLines.map((l) => ({
          producto_id:   l.producto_id || null,
          sku:           l.sku,
          product_label: l.product_label,
          size:          l.size || null,
          qty_transfer:  Number(l.qty_transfer) || 0,
          qty_reserve:   Number(l.qty_reserve)  || 0,
          unit_cost:     Number(l.unit_cost)    || null,
          // Sprint 2026-04-30 — unit_value persistido para que el motor
          // de Landed Cost (BY_VALUE) tenga la base FOB de prorrateo.
          unit_value:    Number(l.unit_value)   || Number(l.unit_cost) || null,
        })),
        cost_lines: costLines.map((c) => ({
          kind:           c.kind,
          label:          c.label || labelForKind(costKinds, c.kind),
          amount:         Number(c.amount) || 0,
          currency:       c.currency || "USD",
          fx_to_usd:      Number(c.fx_to_usd) || 1,
          source:         c.source || "MANUAL",
          ocr_confidence: c.ocr_confidence ?? null,
          // Sprint 2026-05-13 · Fase 9 — scope opcional.
          // null = aplica a todo el batch. Shape ya validado en el picker.
          scope_json:     c.scope || null,
        })),
      };
      const created = await transferenciasApi.create(payload);

      // Sprint 2026-05-13 · Fase 8 — además de persistir el registro
      // de la transferencia (audit/legal), movemos atómicamente las
      // asignaciones expediente→nodo. Esto es lo que hace que el
      // inventario del nodo origen se vacíe (o quede residual) y el
      // destino reciba el stock. El backend valida over-transfer y
      // hace soft-delete + insert + residual en una sola transacción.
      if (transferItems.length > 0) {
        try {
          await nodoAssignmentsApi.transfer({
            originNodoId:      origenId,
            destinationNodoId: destinoId,
            transferenciaId:   created.id,
            items: transferItems.map((it) => ({
              expediente_id: it.expediente_id,
              producto_id:   it.producto_id,
              talla:         it.talla || "",
              qty:           Number(it.qty) || 0,
            })),
          });
        } catch (e2) {
          // La transferencia ya fue creada para audit, pero el move
          // falló. Mostramos el error específico (over-transfer suele
          // pasar si otro operador movió stock en paralelo). El operador
          // puede editar la transferencia o cancelarla.
          setError(
            (lang === "es"
              ? "Transferencia creada, pero el movimiento de stock falló: "
              : "Transfer created, but stock move failed: ") +
            (e2?.body?.detail || e2?.message || "error desconocido"),
          );
          navigate(`/transferencias/${created.id}`);
          return;
        }
      }

      navigate(`/transferencias/${created.id}`);
    } catch (e) {
      setError(e?.message || (lang === "es" ? "Error al crear la transferencia" : "Error creating transfer"));
    } finally {
      setSaving(false);
    }
  };

  // ─────────────────────────────────────────────────────────────
  return (
    <div className="page" style={{ paddingBottom: 80 }}>
      {/* ── Header ─────────────────────── */}
      <div className="page-header" style={{ marginBottom: 18 }}>
        <div>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate("/transferencias")}>
            <IconChevLeft size={12}/> {lang === "es" ? "Volver a transferencias" : "Back"}
          </button>
          <div className="micro" style={{ marginTop: 8, marginBottom: 4 }}>
            {lang === "es" ? "MOTOR DE TRANSFERENCIAS" : "TRANSFER ENGINE"}
          </div>
          <h1 className="page-title">
            {lang === "es" ? "Nueva transferencia inter-nodos" : "New inter-node transfer"}
          </h1>
        </div>
      </div>

      {/* ── Stepper ─────────────────────── */}
      <div className="card card-pad-lg" style={{ marginBottom: 18 }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12, flexWrap: "wrap",
        }}>
          {STEPS.map((s, idx) => {
            const done = step > s.id;
            const active = step === s.id;
            return (
              <React.Fragment key={s.id}>
                <button
                  type="button"
                  onClick={() => { if (s.id < step) setStep(s.id); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "8px 14px", borderRadius: 999,
                    border: active ? "1.5px solid #00B286" : "1px solid var(--border, #E1E6ED)",
                    background: active ? "rgba(0,178,134,0.06)" : (done ? "rgba(0,178,134,0.10)" : "#fff"),
                    color: active ? "#0B1E3A" : (done ? "#00B286" : "var(--text-secondary)"),
                    fontWeight: 600, fontSize: 13,
                    cursor: s.id < step ? "pointer" : "default",
                  }}>
                  <span style={{
                    width: 22, height: 22, borderRadius: 99,
                    background: active ? "#00B286" : (done ? "#00B286" : "#E1E6ED"),
                    color: (active || done) ? "#fff" : "#64748B",
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, fontWeight: 700,
                  }}>
                    {done ? <IconCheck size={11}/> : s.id}
                  </span>
                  <span>{s.label}</span>
                </button>
                {idx < STEPS.length - 1 && (
                  <span style={{ flex: 1, height: 1, background: "#E1E6ED", maxWidth: 60 }}/>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* ── Contenido del paso ────────── */}
      <AnimatePresence mode="wait">
        <motion.div key={step}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0,  transition: { duration: 0.22 } }}
          exit   ={{ opacity: 0, y: -8, transition: { duration: 0.14 } }}>

          {step === 1 && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0,1fr) 320px',
              gap: 18,
              alignItems: 'start',
            }}>
              <Step1Context
                lang={lang}
                nodosOrigen={nodosOrigen} nodosDestino={nodosDestino}
                origenId={origenId}     setOrigenId={setOrigenId}
                destinoId={destinoId}   setDestinoId={setDestinoId}
                legalContext={legalContext} setLegalContext={setLegalContext}
                refTracking={refTracking}   setRefTracking={setRefTracking}
                notes={notes}               setNotes={setNotes}
                docFile={docFile}           onDocFile={handleDoc}
                ocrLoading={ocrLoading}     ocrResult={ocrResult}
                contextData={contextData}   setContextData={setContextData}
                legalDocs={legalDocs}       setLegalDoc={setLegalDoc}
                error={error}
              />
              {/* Sidebar — Motor OCR IA (Gobernanza)
                  trigger_word canónico: ocr-aduanas (ver SKILL_OCR_ADUANAS
                  en KB MWT.ONE). El backend acepta también ocr-transfers
                  como alias por compatibilidad. */}
              <OcrSkillSidebar lang={lang} skillKey="ocr-aduanas"/>
            </div>
          )}

          {step === 2 && (
            // Sprint 2026-05-13 · Fase 9 — Swap: Productos primero.
            // El paso 2 es ahora el picker multi-expediente (fase 8) para
            // que el paso 3 pueda mostrar los costos con scope a esos
            // expedientes/líneas ya seleccionados.
            <Step3TransferAssign
              lang={lang}
              originNode={nodos.find((n) => n.id === origenId)}
              destinationNode={nodos.find((n) => n.id === destinoId)}
              onItemsChange={setTransferItems}
              onValidityChange={setTransferItemsValid}
            />
          )}

          {step === 3 && (
            // Sprint 2026-05-13 · Fase 9 — Costos con scope a expedientes/líneas.
            // Step2Costs recibe `transferItems` para que cada cost-line
            // pueda restringir su aplicación a un subconjunto de los
            // expedientes / líneas ya elegidos en el paso 2.
            <Step2Costs
              lang={lang}
              costKinds={costKinds}
              costLines={costLines}
              addCostLine={addCostLine}
              updateCostLine={updateCostLine}
              removeCostLine={removeCostLine}
              totals={totals}
              currencies={currencies}
              transferItems={transferItems}
            />
          )}

          {step === 4 && (
            <Step4Summary
              lang={lang}
              origen={nodos.find((n) => n.id === origenId)}
              destino={nodos.find((n) => n.id === destinoId)}
              legalContext={legalContext}
              refTracking={refTracking}
              productLines={productLines}
              costLines={costLines}
              costKinds={costKinds}
              totals={totals}
            />
          )}

        </motion.div>
      </AnimatePresence>

      {/* ── Footer nav ────────────────── */}
      <div className="card card-pad-lg" style={{
        marginTop: 18, position: "sticky", bottom: 16, zIndex: 5,
        boxShadow: "0 8px 24px rgba(15,27,61,0.08)",
      }}>
        {error && (
          <div style={{
            padding: "10px 14px", marginBottom: 12, borderRadius: 8,
            background: "#FEE2E2", border: "1px solid #FCA5A5",
            color: "#991B1B", fontSize: 13,
          }}>
            <IconAlert size={12} style={{ verticalAlign: -1, marginRight: 6 }}/>
            {error}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <button className="btn btn-ghost"
                  disabled={step === 1}
                  onClick={() => setStep((s) => Math.max(1, s - 1))}>
            <IconChevLeft size={12}/> {lang === "es" ? "Anterior" : "Back"}
          </button>
          {step < 4 ? (
            <button className="btn btn-accent"
                    disabled={!canAdvance}
                    onClick={() => setStep((s) => Math.min(4, s + 1))}
                    style={{ minWidth: 180 }}>
              {lang === "es" ? "Siguiente" : "Next"} <IconChevRight size={12}/>
            </button>
          ) : (
            <button className="btn btn-accent"
                    disabled={saving || productLines.length === 0}
                    onClick={submit}
                    style={{
                      minWidth: 220,
                      background: "var(--btn-primary, #00B286)",
                      borderColor: "var(--btn-primary, #00B286)",
                    }}>
              {saving
                ? (lang === "es" ? "Registrando…" : "Saving…")
                : <>{lang === "es" ? "Registrar transferencia" : "Register transfer"} <IconCheck size={12}/></>
              }
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// STEP 1 · Contexto y Nodos
// ═════════════════════════════════════════════════════════════
function Step1Context({
  lang, nodosOrigen, nodosDestino,
  origenId, setOrigenId, destinoId, setDestinoId,
  legalContext, setLegalContext, refTracking, setRefTracking,
  notes, setNotes, docFile, onDocFile, ocrLoading, ocrResult,
  contextData, setContextData,
  legalDocs = {}, setLegalDoc = () => {},
}) {
  const setCtx = (patch) => setContextData((p) => ({ ...(p || {}), ...patch }));
  const dropRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const showDropzone = NEEDS_CUSTOMS_DOC.has(legalContext);

  return (
    <div className="card card-pad-lg">
      <h2 className="heading-md" style={{ marginBottom: 14 }}>
        {lang === "es" ? "Paso 1 · Contexto de la transferencia" : "Step 1 · Transfer context"}
      </h2>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 18 }}>
        <Field label={lang === "es" ? "Nodo origen *" : "Origin node *"}>
          <select className="input" value={origenId} onChange={(e) => setOrigenId(e.target.value)}>
            <option value="">{lang === "es" ? "— Selecciona origen —" : "— Select origin —"}</option>
            {nodosOrigen.map((n) => (
              <option key={n.id} value={n.id}>
                {n.codigo} · {n.nombre} {n.pais_iso2 ? `(${n.pais_iso2})` : ""}
              </option>
            ))}
          </select>
          <span className="caption" style={{ color: "var(--text-tertiary)" }}>
            {lang === "es" ? "Solo nodos con capacidad DISPATCH" : "Only nodes with DISPATCH capability"}
          </span>
        </Field>
        <Field label={lang === "es" ? "Nodo destino *" : "Destination node *"}>
          <select className="input" value={destinoId} onChange={(e) => setDestinoId(e.target.value)}>
            <option value="">{lang === "es" ? "— Selecciona destino —" : "— Select destination —"}</option>
            {nodosDestino.map((n) => (
              <option key={n.id} value={n.id}>
                {n.codigo} · {n.nombre} {n.pais_iso2 ? `(${n.pais_iso2})` : ""}
              </option>
            ))}
          </select>
          <span className="caption" style={{ color: "var(--text-tertiary)" }}>
            {lang === "es" ? "Solo nodos con capacidad RECEIVE" : "Only nodes with RECEIVE capability"}
          </span>
        </Field>
      </div>

      <div style={{ marginBottom: 18 }}>
        <Field label={lang === "es" ? "Motivo / Contexto legal *" : "Reason / Legal context *"}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            {LEGAL_CONTEXT.map((c) => (
              <button key={c.codigo} type="button"
                      onClick={() => setLegalContext(c.codigo)}
                      style={{
                        textAlign: "left", padding: "12px 14px",
                        border: legalContext === c.codigo
                          ? `2px solid ${c.color}` : "1px solid var(--border, #E1E6ED)",
                        background: legalContext === c.codigo
                          ? `${c.color}10` : "#fff",
                        borderRadius: 10, cursor: "pointer",
                      }}>
                <div style={{ fontWeight: 700, color: "#0B1E3A", marginBottom: 3 }}>
                  {c.label}
                </div>
                <div className="caption" style={{ color: "var(--text-tertiary)" }}>
                  {c.desc}
                </div>
              </button>
            ))}
          </div>
        </Field>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Field label={lang === "es" ? "Referencia de tracking (opcional)" : "Tracking reference (optional)"}>
          <input className="input" value={refTracking}
                 onChange={(e) => setRefTracking(e.target.value)}
                 placeholder="BL / AWB / TRK"/>
          <span className="caption" style={{ color: "var(--text-tertiary)" }}>
            {lang === "es" ? "Bill of Lading, Air Waybill o tracking del courier" : "Bill of Lading, Air Waybill, or courier tracking"}
          </span>
        </Field>
        <Field label={lang === "es" ? "Notas (opcional)" : "Notes (optional)"}>
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)}/>
        </Field>
      </div>

      {/* ── Sub-sección condicional según motivo (sprint Transfer Engine v2) ── */}
      <ContextDataSection lang={lang} legalContext={legalContext}
                          contextData={contextData} setCtx={setCtx} />

      {/* Dropzone aduanal — solo si motivo lo requiere */}
      {showDropzone && (
        <motion.div initial={{ opacity:0, height:0 }} animate={{ opacity:1, height:"auto" }}
                    style={{ marginTop: 22 }}>
          <Field label={lang === "es" ? "Documento aduanal (DUA) — análisis con IA" : "Customs document (DUA) — AI analysis"}>
            <div ref={dropRef}
                 onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                 onDragLeave={() => setDragOver(false)}
                 onDrop={(e) => {
                   e.preventDefault(); setDragOver(false);
                   const f = e.dataTransfer.files?.[0];
                   if (f) onDocFile(f);
                 }}
                 style={{
                   border: `2px dashed ${dragOver ? "#00B286" : "#CBD5E1"}`,
                   borderRadius: 12,
                   padding: 28, textAlign: "center",
                   background: dragOver ? "rgba(0,178,134,0.04)" : "#FAFBFD",
                   transition: "background 0.15s, border 0.15s",
                 }}>
              {ocrLoading ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
                  <IconRefresh size={20} style={{ color: "#00B286", animation: "spin 1.2s linear infinite" }}/>
                  <div>
                    <div style={{ fontWeight: 700, color: "#0B1E3A" }}>
                      {lang === "es" ? "Analizando con IA…" : "Analyzing with AI…"}
                    </div>
                    <div className="caption" style={{ color: "var(--text-tertiary)" }}>
                      gpt-5-nano · OCR aduanal
                    </div>
                  </div>
                </div>
              ) : docFile ? (
                <div>
                  <IconCheck size={26} style={{ color: "#00B286", margin: "0 auto 8px", display: "block" }}/>
                  <div style={{ fontWeight: 700, color: "#0B1E3A" }}>
                    <IconFileText size={12} style={{ verticalAlign: -1, marginRight: 4 }}/>
                    {docFile.name}
                  </div>
                  <div className="caption" style={{ color: "var(--text-tertiary)", marginTop: 4 }}>
                    {ocrResult?.lines?.length
                      ? (lang === "es"
                          ? `${ocrResult.lines.length} costos detectados — revisalos en el paso 2.`
                          : `${ocrResult.lines.length} costs detected — review in step 2.`)
                      : (ocrResult?.error
                          ? `⚠ ${ocrResult.error}`
                          : (lang === "es" ? "Documento cargado." : "Document uploaded."))}
                  </div>
                  <label className="btn btn-ghost btn-sm" style={{ marginTop: 10, cursor: "pointer" }}>
                    {lang === "es" ? "Cambiar archivo" : "Change file"}
                    <input type="file" accept="application/pdf,image/*" style={{ display: "none" }}
                           onChange={(e) => { const f = e.target.files?.[0]; if (f) onDocFile(f); }}/>
                  </label>
                </div>
              ) : (
                <div>
                  <IconUpload size={26} style={{ color: "#3083FE", margin: "0 auto 8px", display: "block" }}/>
                  <div style={{ fontWeight: 700, color: "#0B1E3A" }}>
                    {lang === "es" ? "Arrastra el DUA / liquidación aquí" : "Drag the DUA / customs receipt here"}
                  </div>
                  <div className="caption" style={{ color: "var(--text-tertiary)", marginTop: 4 }}>
                    PDF, JPG o PNG · max 25 MB
                  </div>
                  <label className="btn btn-ghost" style={{ marginTop: 12, cursor: "pointer" }}>
                    {lang === "es" ? "o seleccionar archivo" : "or pick a file"}
                    <input type="file" accept="application/pdf,image/*" style={{ display: "none" }}
                           onChange={(e) => { const f = e.target.files?.[0]; if (f) onDocFile(f); }}/>
                  </label>
                </div>
              )}
            </div>
          </Field>
        </motion.div>
      )}

      {/* ── Documentos legales por motivo (sprint v3.5) ── */}
      <LegalDocsByMotive
        lang={lang}
        legalContext={legalContext}
        legalDocs={legalDocs}
        setLegalDoc={setLegalDoc}
      />
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// LEGAL DOCS por motivo · sprint Transfer Engine v3.5
// ═════════════════════════════════════════════════════════════
function LegalDocsByMotive({ lang, legalContext, legalDocs, setLegalDoc }) {
  // Mapeo motivo → array de slots de documentos.
  // El backend `transferencia_serializer.validate()` acepta solo los
  // campos que aplican al motivo y limpia los demás.
  const SLOTS_BY_MOTIVE = {
    NATIONALIZATION: [
      { key: "supplier_invoice", required: true,
        label_es: "Factura Comercial del Proveedor",
        label_en: "Supplier Commercial Invoice",
        hint_es:  "Documento que acompaña al DUA. Obligatorio para nacionalizar.",
        hint_en:  "Accompanies the DUA. Required to nationalize." },
    ],
    EXPORT: [
      { key: "export_invoice", required: true,
        label_es: "Factura de Exportación",
        label_en: "Export Invoice",
        hint_es:  "Factura emitida hacia el destinatario internacional.",
        hint_en:  "Invoice issued to the international consignee." },
      { key: "freight_quote", required: true,
        label_es: "Cotización de Flete (ART-06)",
        label_en: "Freight Quote (ART-06)",
        hint_es:  "Cotización del transporte internacional contratado.",
        hint_en:  "International freight quote." },
    ],
    DISTRIBUTION: [
      { key: "export_invoice", required: true,
        label_es: "Factura Comercial MWT (ART-09)",
        label_en: "MWT Commercial Invoice (ART-09)",
        hint_es:  "Factura emitida al distribuidor / marketplace.",
        hint_en:  "Invoice issued to the distributor / marketplace." },
    ],
    CONSIGNMENT: [
      { key: "remission_guide", required: true,
        label_es: "Guía de Remisión / Traslado",
        label_en: "Remission / Transfer Guide",
        hint_es:  "Documento legal de traslado sin transferencia de propiedad.",
        hint_en:  "Legal transfer document without ownership transfer." },
    ],
    INTERNAL: [],
  };
  const slots = SLOTS_BY_MOTIVE[legalContext] || [];
  if (slots.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      style={{ marginTop: 22 }}
    >
      <div className="micro" style={{
        fontSize: 11, fontWeight: 800, letterSpacing: 0.6,
        color: "var(--text-tertiary)", textTransform: "uppercase",
        marginBottom: 10,
      }}>
        {lang === "es" ? "Documentos legales del motivo" : "Legal documents for this reason"}
      </div>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        gap: 12,
      }}>
        {slots.map((slot) => (
          <LegalDocSlot key={slot.key}
            slot={slot}
            file={legalDocs[slot.key]}
            onFile={(f) => setLegalDoc(slot.key, f)}
            onClear={() => setLegalDoc(slot.key, null)}
            lang={lang}
          />
        ))}
      </div>
    </motion.div>
  );
}

function LegalDocSlot({ slot, file, onFile, onClear, lang }) {
  const fileRef = useRef(null);
  const [drag, setDrag] = useState(false);
  return (
    <div style={{
      border: file
        ? "1.5px solid #00B286"
        : `1.5px dashed ${drag ? "#00B286" : "var(--border, #E1E6ED)"}`,
      borderRadius: 12,
      padding: "14px 16px",
      background: file
        ? "rgba(0,178,134,0.04)"
        : (drag ? "rgba(0,178,134,0.04)" : "white"),
      transition: "all 0.15s",
    }}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault(); setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: file ? "rgba(0,178,134,0.12)" : "rgba(11,30,58,0.05)",
          color: file ? "#00B286" : "#0B1E3A",
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}>
          {file ? <IconCheck size={14}/> : <IconFileText size={14}/>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: "#0B1E3A" }}>
            {lang === "es" ? slot.label_es : slot.label_en}
            {slot.required && (
              <span style={{ color: "#DC2626", marginLeft: 4 }}>*</span>
            )}
          </div>
          <div className="caption" style={{
            color: "var(--text-tertiary)", fontSize: 11, marginTop: 2,
            lineHeight: 1.4,
          }}>
            {file
              ? `${file.name} · ${(file.size/1024).toFixed(1)} KB`
              : (lang === "es" ? slot.hint_es : slot.hint_en)}
          </div>
        </div>
      </div>
      <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
        <input ref={fileRef} type="file" hidden
               accept="application/pdf,image/*,.xlsx,.xls"
               onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}/>
        {file ? (
          <>
            <button type="button" className="btn btn-ghost btn-sm"
                    onClick={() => fileRef.current?.click()}
                    style={{ fontSize: 11 }}>
              {lang === "es" ? "Cambiar" : "Change"}
            </button>
            <button type="button" className="btn btn-ghost btn-sm"
                    onClick={onClear}
                    style={{ fontSize: 11, color: "#DC2626" }}>
              {lang === "es" ? "Quitar" : "Remove"}
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-secondary btn-sm"
                  onClick={() => fileRef.current?.click()}
                  style={{
                    fontSize: 11, fontWeight: 700,
                    background: "#0B1E3A", color: "white",
                    borderColor: "#0B1E3A",
                  }}>
            <IconUpload size={11}/>{" "}
            {lang === "es" ? "Subir archivo" : "Upload file"}
          </button>
        )}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// SIDEBAR · Motor OCR IA · Gobernanza de skill (sprint v3.5)
// ═════════════════════════════════════════════════════════════
function OcrSkillSidebar({ lang, skillKey }) {
  const { isAdmin, can } = useRole() || {};
  const [skill, setSkill]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const refresh = () => {
    setLoading(true);
    apiFetch(`/ai/skills/${skillKey}/`, { token: getToken() })
      .then(setSkill)
      .catch(() => setSkill(null))
      .finally(() => setLoading(false));
  };
  useEffect(() => { refresh(); }, [skillKey]);

  // Solo CEO/admin puede editar — el backend también lo bloquea (403).
  const canEdit = !!isAdmin || can?.("edit_ai_skill");

  return (
    <>
      <aside style={{
        position: "sticky", top: 88,
        background: "white",
        border: "1px solid var(--border, #E1E6ED)",
        borderRadius: 14,
        overflow: "hidden",
        boxShadow: "0 1px 3px rgba(15,27,61,0.04)",
      }}>
        {/* Header */}
        <div style={{
          padding: "14px 18px",
          background: "linear-gradient(135deg, #0B1E3A 0%, #1F3A66 100%)",
          color: "white",
        }}>
          <div className="micro" style={{
            color: "rgba(255,255,255,0.65)", letterSpacing: 1.2,
          }}>
            {lang === "es" ? "MOTOR OCR · IA" : "OCR ENGINE · AI"}
          </div>
          <div style={{ fontWeight: 800, fontSize: 14, marginTop: 4,
                         display: "flex", alignItems: "center", gap: 8 }}>
            <IconSparkle size={13} style={{ color: "#1DE394" }}/>
            {loading
              ? (lang === "es" ? "Cargando…" : "Loading…")
              : (skill?.display_name || skill?.nombre
                  || (lang === "es" ? "Skill no configurado" : "Skill not configured"))}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: 16, display: "grid", gap: 10 }}>
          <SkillRow k={lang === "es" ? "Skill" : "Skill"}
                    v={skill?.codigo || skill?.skill_key || "—"}/>
          <SkillRow k={lang === "es" ? "Modelo activo" : "Active model"}
                    v={skill?.model_id || "—"} mono/>
          <SkillRow k={lang === "es" ? "Proveedor" : "Provider"}
                    v={skill?.model_provider_id || "—"}/>
          {skill?.system_prompt && (
            <div>
              <div className="micro" style={{
                fontSize: 10, fontWeight: 800, letterSpacing: 0.6,
                color: "var(--text-tertiary)", textTransform: "uppercase",
                marginBottom: 4,
              }}>
                {lang === "es" ? "System Prompt" : "System Prompt"}
              </div>
              <div style={{
                fontSize: 11, color: "var(--text-secondary)",
                background: "rgba(11,30,58,0.04)",
                padding: "8px 10px", borderRadius: 6,
                fontFamily: "var(--font-mono, ui-monospace)",
                maxHeight: 80, overflow: "hidden", textOverflow: "ellipsis",
                lineHeight: 1.4,
              }}>
                {String(skill.system_prompt).slice(0, 200)}
                {skill.system_prompt.length > 200 ? "…" : ""}
              </div>
            </div>
          )}
        </div>

        {/* Footer · botón editar (CEO-ONLY) */}
        {canEdit && skill && (
          <div style={{
            padding: "10px 16px 14px",
            borderTop: "1px solid var(--border-subtle, #F1F4F9)",
          }}>
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="btn"
              style={{
                width: "100%", fontWeight: 700,
                background: "rgba(72,30,227,0.08)", color: "#481EE3",
                border: "1px solid rgba(72,30,227,0.20)",
                fontSize: 12,
              }}
            >
              <IconSettings size={12}/>{" "}
              {lang === "es" ? "Editar Skill" : "Edit Skill"}
            </button>
          </div>
        )}
      </aside>

      {drawerOpen && (
        <EditSkillDrawer
          lang={lang}
          skill={skill}
          onClose={() => setDrawerOpen(false)}
          onSaved={(s) => { setSkill(s); setDrawerOpen(false); }}
        />
      )}
    </>
  );
}

function SkillRow({ k, v, mono }) {
  return (
    <div>
      <div className="micro" style={{
        fontSize: 10, fontWeight: 800, letterSpacing: 0.6,
        color: "var(--text-tertiary)", textTransform: "uppercase",
        marginBottom: 2,
      }}>{k}</div>
      <div style={{
        fontSize: 13, color: "#0B1E3A", fontWeight: 600,
        fontFamily: mono ? "var(--font-mono, ui-monospace)" : undefined,
        wordBreak: "break-word",
      }}>{v}</div>
    </div>
  );
}

// ─── Drawer de edición del skill (CEO-only en frontend; backend
// tiene IsCEOOrAdmin como defensa de segunda línea) ─────────────
function EditSkillDrawer({ lang, skill, onClose, onSaved }) {
  const [displayName, setDisplayName] = useState(skill?.display_name || skill?.nombre || "");
  const [modelId,     setModelId]     = useState(skill?.model_id || "");
  const [systemPrompt, setSystemPrompt] = useState(skill?.system_prompt || "");
  const [saving, setSaving]   = useState(false);
  const [error,  setError]    = useState(null);
  const models = skill?.available_models || [];

  const dirty =
       displayName  !== (skill?.display_name || skill?.nombre || "")
    || modelId      !== (skill?.model_id || "")
    || systemPrompt !== (skill?.system_prompt || "");

  const save = async () => {
    if (saving) return;
    setSaving(true); setError(null);
    try {
      const out = await apiFetch(`/ai/skills/${skill.skill_key}/`, {
        method: "PATCH",
        body:   { display_name: displayName, model_id: modelId,
                  system_prompt: systemPrompt },
        token:  getToken(),
      });
      onSaved?.(out);
    } catch (e) {
      setError(e?.body?.detail || e?.message || "Error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div onClick={() => !saving && onClose?.()}
         style={{
           position: "fixed", inset: 0, zIndex: 200,
           background: "rgba(11,30,58,0.55)",
           display: "flex", justifyContent: "flex-end",
         }}>
      <motion.aside
        initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
        transition={{ duration: 0.22 }}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(640px, 96vw)", height: "100vh",
          background: "white", display: "flex", flexDirection: "column",
          boxShadow: "-30px 0 60px -20px rgba(15,27,61,0.55)",
        }}>
        {/* Header */}
        <div style={{
          padding: "16px 22px",
          background: "linear-gradient(135deg, #0B1E3A 0%, #1F3A66 100%)",
          color: "white",
          display: "flex", alignItems: "center", gap: 12,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: "rgba(72,30,227,0.30)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <IconSettings size={16}/>
          </div>
          <div style={{ flex: 1 }}>
            <div className="micro" style={{
              color: "rgba(255,255,255,0.65)", letterSpacing: 1.2,
            }}>
              {lang === "es" ? "GOBERNANZA IA · CEO-ONLY" : "AI GOVERNANCE · CEO-ONLY"}
            </div>
            <div style={{ fontWeight: 800, fontSize: 16, marginTop: 2 }}>
              {lang === "es" ? "Editar Motor OCR" : "Edit OCR Engine"}
            </div>
          </div>
          <button onClick={onClose} disabled={saving}
                  className="btn btn-ghost btn-sm"
                  style={{ color: "white", padding: "6px 10px" }}>
            <IconX size={12}/>
          </button>
        </div>

        {/* Warning rojo */}
        <div style={{
          padding: "12px 22px",
          background: "rgba(220,38,38,0.06)",
          borderBottom: "1px solid rgba(220,38,38,0.20)",
          display: "flex", gap: 10, alignItems: "flex-start",
          color: "#991B1B",
        }}>
          <IconAlert size={14} style={{ color: "#DC2626", flexShrink: 0, marginTop: 1 }}/>
          <div style={{ fontSize: 12, lineHeight: 1.5 }}>
            <strong>
              {lang === "es" ? "Cambios críticos a nivel compañía. " : "Company-wide critical changes. "}
            </strong>
            {lang === "es"
              ? "Modificar el system prompt o el modelo afecta el cálculo de costos de TODAS las transferencias futuras (DUAs, facturas, landed cost). Procedé con cuidado y notificá al equipo."
              : "Editing the system prompt or model affects cost computation across ALL future transfers (DUAs, invoices, landed cost). Proceed carefully and notify the team."}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: 22, display: "grid", gap: 18 }}>
          <div>
            <Label>{lang === "es" ? "Nombre del skill" : "Skill name"}</Label>
            <input className="input" value={displayName}
                   onChange={(e) => setDisplayName(e.target.value)}
                   disabled={saving}/>
          </div>

          <div>
            <Label>{lang === "es" ? "Modelo LLM" : "LLM model"}</Label>
            <select className="input mono-sm" value={modelId}
                    onChange={(e) => setModelId(e.target.value)}
                    disabled={saving}>
              <option value="">— {lang === "es" ? "Seleccionar" : "Select"} —</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} · {m.provider} · {m.speed}/{m.cost}
                  {m.vision ? " · vision" : ""}
                </option>
              ))}
            </select>
            <span className="caption" style={{
              color: "var(--text-tertiary)", fontSize: 11, marginTop: 4, display: "block",
            }}>
              {lang === "es"
                ? "El proveedor se infiere del modelo seleccionado."
                : "Provider is inferred from selected model."}
            </span>
          </div>

          <div>
            <Label>
              {lang === "es" ? "System Prompt / Instrucciones de extracción" : "System Prompt / Extraction instructions"}
            </Label>
            <textarea className="input"
                      value={systemPrompt}
                      onChange={(e) => setSystemPrompt(e.target.value)}
                      disabled={saving}
                      rows={20}
                      style={{
                        fontFamily: "var(--font-mono, ui-monospace)",
                        fontSize: 12, lineHeight: 1.5,
                        minHeight: 320, resize: "vertical",
                      }}/>
            <span className="caption" style={{
              color: "var(--text-tertiary)", fontSize: 11, marginTop: 4, display: "block",
            }}>
              {lang === "es"
                ? `Caracteres: ${systemPrompt.length.toLocaleString()}`
                : `Characters: ${systemPrompt.length.toLocaleString()}`}
            </span>
          </div>

          {error && (
            <div style={{
              padding: "10px 12px", borderRadius: 8,
              background: "#FEE2E2", color: "#991B1B",
              border: "1px solid #FCA5A5", fontSize: 13,
            }}>
              <IconAlert size={11} style={{ verticalAlign: -1, marginRight: 6 }}/>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "12px 22px",
          borderTop: "1px solid var(--border-subtle, #F1F4F9)",
          background: "rgba(11,30,58,0.02)",
          display: "flex", justifyContent: "flex-end", gap: 8,
        }}>
          <button onClick={onClose} className="btn btn-ghost" disabled={saving}>
            {lang === "es" ? "Cancelar" : "Cancel"}
          </button>
          <button onClick={save}
                  className="btn btn-accent"
                  disabled={!dirty || saving}
                  style={{
                    minWidth: 180, fontWeight: 700,
                    background: "#00B286", borderColor: "#00B286",
                  }}>
            {saving
              ? (lang === "es" ? "Guardando…" : "Saving…")
              : (lang === "es" ? "Guardar cambios" : "Save changes")}
          </button>
        </div>
      </motion.aside>
    </div>
  );
}

function Label({ children }) {
  return (
    <div className="micro" style={{
      fontSize: 11, fontWeight: 800, letterSpacing: 0.5,
      color: "var(--text-tertiary)", textTransform: "uppercase",
      marginBottom: 6,
    }}>{children}</div>
  );
}

// ═════════════════════════════════════════════════════════════
// STEP 3 · Costos Operativos (Sprint 2026-05-13 · Fase 9 — antes era paso 2)
//
// Cada cost-line puede tener scope opcional:
//   - null            → aplica a TODA la transferencia
//   - {expediente_ids,lines?} → aplica solo a esos expedientes/líneas
//
// El picker (CostScopeModal) lee transferItems del paso 2 (Productos)
// para que el operador no tenga que tipear UUIDs.
// ═════════════════════════════════════════════════════════════
function Step2Costs({ lang, costKinds, costLines, addCostLine, updateCostLine, removeCostLine, totals, currencies = [], transferItems = [] }) {
  // Sprint 2026-05-13 · Fase 9.1 — el flow ahora es:
  //   click "+ Agregar costo" → abre scope modal con creatingNew=true
  //   → al guardar, se crea la fila ya con el scope persistido.
  // Las filas existentes pueden re-editar su scope clickeando la celda
  // "Aplicar a" (scopeOpenFor = tmpId).
  const [scopeOpenFor, setScopeOpenFor] = useState(null);        // tmpId | null
  const [creatingNewScope, setCreatingNewScope] = useState(false); // bool
  const openScope = costLines.find((c) => c.tmpId === scopeOpenFor) || null;
  const modalOpen = creatingNewScope || !!openScope;
  const modalInitialScope = creatingNewScope ? null : (openScope?.scope || null);
  const modalCostLabel = creatingNewScope
    ? (lang === "es" ? "Nuevo costo" : "New cost")
    : (openScope?.label || (openScope ? labelForKind(costKinds, openScope.kind) : ""));

  const handleScopeSave = (scope) => {
    if (creatingNewScope) {
      // Crea la fila Y le aplica el scope en el mismo tick. addCostLine
      // empuja una fila default; luego buscamos su tmpId (la última)
      // para aplicar el scope. Como setState es asíncrono, usamos el
      // callback de updateCostLine vía un truco: addCostLine inserta
      // con un tmpId predecible (timestamp) → pero más simple es
      // generar el tmpId aquí y pasarlo al setter del wizard.
      addCostLine({ scope });
    } else if (openScope) {
      updateCostLine(openScope.tmpId, { scope });
    }
  };

  return (
    <div className="card card-pad-lg">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <h2 className="heading-md">
          {lang === "es" ? "Paso 3 · Costos operativos" : "Step 3 · Operating costs"}
        </h2>
        <button className="btn btn-ghost btn-sm"
                onClick={() => setCreatingNewScope(true)}>
          <IconPlus size={11}/> {lang === "es" ? "Agregar costo" : "Add cost"}
        </button>
      </div>

      {costLines.length === 0 ? (
        <div className="empty" style={{ padding: 30 }}>
          <IconDollar size={22} style={{ color: "var(--text-tertiary)" }}/>
          <div className="caption" style={{ color: "var(--text-tertiary)", maxWidth: 460, textAlign: "center" }}>
            {lang === "es"
              ? "Sin costos asociados. Si el motivo requiere DUA, los costos detectados por la IA aparecerán aquí automáticamente."
              : "No costs yet. If the reason requires DUA, AI-detected costs will appear here automatically."}
          </div>
        </div>
      ) : (
        <div className="card card-pad-0" style={{ overflow: "hidden" }}>
          <table className="table" style={{ tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: 170 }}/>
              <col/>
              <col style={{ width: 120 }}/>
              <col style={{ width: 80 }}/>
              <col style={{ width: 100 }}/>
              <col style={{ width: 110 }}/>
              <col style={{ width: 110 }}/>
              <col style={{ width: 140 }}/>{/* Sprint 2026-05-13 fase 9: Aplicar a */}
              <col style={{ width: 50 }}/>
            </colgroup>
            <thead>
              <tr>
                <th>{lang === "es" ? "Tipo" : "Kind"}</th>
                <th>{lang === "es" ? "Detalle" : "Label"}</th>
                <th style={{ textAlign: "right", paddingRight: 18 }}>{lang === "es" ? "Monto" : "Amount"}</th>
                <th style={{ textAlign: "center" }}>{lang === "es" ? "Moneda" : "Curr."}</th>
                <th style={{ textAlign: "right", paddingRight: 18 }}>FX→USD</th>
                <th style={{ textAlign: "right", paddingRight: 18 }}>USD</th>
                <th style={{ textAlign: "center" }}>{lang === "es" ? "Origen" : "Source"}</th>
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
                const lowConf = isOcr && Number(c.ocr_confidence || 0) < 60;
                return (
                  <tr key={c.tmpId}>
                    <td>
                      <select className="input" style={{ width: "100%" }}
                              value={c.kind}
                              onChange={(e) => updateCostLine(c.tmpId, { kind: e.target.value })}>
                        {costKinds.map((k) => (
                          <option key={k.codigo} value={k.codigo}>{k.label}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input className="input" style={{ width: "100%" }} value={c.label || ""}
                             onChange={(e) => updateCostLine(c.tmpId, { label: e.target.value })}
                             placeholder={labelForKind(costKinds, c.kind)}/>
                    </td>
                    <td style={{ textAlign: "right", paddingRight: 18 }}>
                      <input className="input tabular-nums" type="number" step="0.01" min="0"
                             style={{ width: "100%", textAlign: "right" }}
                             value={c.amount}
                             onChange={(e) => updateCostLine(c.tmpId, { amount: e.target.value })}/>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      {/* Sprint 2026-04-30: select con catálogo ISO 4217.
                          Antes era input texto; ahora se carga desde
                          /api/commercial/catalogs/currencies/ (47 monedas). */}
                      <select className="input mono-sm"
                              style={{ width: "100%", textAlign: "center", padding: "6px 4px" }}
                              value={c.currency || "USD"}
                              onChange={(e) => updateCostLine(c.tmpId, { currency: e.target.value })}>
                        {currencies.length === 0
                          ? <option value="USD">USD</option>
                          : currencies.map((cur) => (
                              <option key={cur.codigo} value={cur.codigo}
                                      title={`${cur.nombre || cur.codigo}${cur.symbol ? " (" + cur.symbol + ")" : ""}`}>
                                {cur.codigo}
                              </option>
                            ))}
                      </select>
                    </td>
                    <td style={{ textAlign: "right", paddingRight: 18 }}>
                      <input className="input tabular-nums" type="number" step="0.0001" min="0"
                             style={{ width: "100%", textAlign: "right" }}
                             value={c.fx_to_usd}
                             onChange={(e) => updateCostLine(c.tmpId, { fx_to_usd: e.target.value })}/>
                    </td>
                    <td className="tabular-nums" style={{ textAlign: "right", paddingRight: 18, fontWeight: 700, color: "#0B1E3A" }}>
                      ${usd.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      {isOcr ? (
                        <span title={`Confianza ${c.ocr_confidence ?? "?"}%`}
                              style={{
                                padding: "2px 8px", borderRadius: 999, fontSize: 10, fontWeight: 700,
                                background: lowConf ? "#FEF3C7" : "rgba(0,178,134,0.12)",
                                color: lowConf ? "#92400E" : "#00B286",
                              }}>
                          IA · {Math.round(c.ocr_confidence ?? 0)}%
                        </span>
                      ) : (
                        <span style={{
                          padding: "2px 8px", borderRadius: 999, fontSize: 10, fontWeight: 600,
                          background: "#F3F5F8", color: "#64748B",
                        }}>MANUAL</span>
                      )}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <ScopeCell scope={c.scope} transferItems={transferItems}
                                 onOpen={() => setScopeOpenFor(c.tmpId)}
                                 lang={lang}/>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <button className="btn btn-ghost btn-sm"
                              onClick={() => removeCostLine(c.tmpId)}
                              title={lang === "es" ? "Quitar costo" : "Remove cost"}
                              style={{ color: "#D64545", padding: "4px 6px" }}>
                        <IconTrash size={13}/>
                      </button>
                    </td>
                  </tr>
                );
              })}
              <tr style={{ background: "rgba(0,178,134,0.06)", fontWeight: 700 }}>
                <td colSpan={5} style={{ textAlign: "right", color: "#0B1E3A" }}>
                  {lang === "es" ? "Total costos USD" : "Total costs USD"}
                </td>
                <td className="tabular-nums" style={{ textAlign: "right", color: "#00B286", fontSize: 15 }}>
                  ${totals.totalCostUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                </td>
                <td colSpan={3}></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Sprint 2026-05-13 · Fase 9.1 — modal de scope.
          Doble uso:
            - creatingNewScope=true → "+ Agregar costo": al guardar
              crea la fila ya con el scope aplicado.
            - scopeOpenFor=tmpId   → edición de una fila existente
              vía el chip "Aplicar a" de la columna. */}
      <CostScopeModal
        open={modalOpen}
        lang={lang}
        costLabel={modalCostLabel}
        initialScope={modalInitialScope}
        transferItems={transferItems}
        onClose={() => { setCreatingNewScope(false); setScopeOpenFor(null); }}
        onSave={handleScopeSave}
      />
    </div>
  );
}

// ── Sprint 2026-05-13 · Fase 9 — celda "Aplicar a" de Step2Costs ───
// Muestra el resumen del scope actual:
//   - null / applies_to_all → "Todo"
//   - solo expedientes      → "3 expedientes"
//   - con lines             → "2 expedientes · 5 líneas"
// Click → abre el CostScopeModal.
function ScopeCell({ scope, transferItems, onOpen, lang }) {
  let label = lang === "es" ? "Todo" : "All";
  let restricted = false;
  if (scope && scope.applies_to_all === false) {
    restricted = true;
    const n_exp = Array.isArray(scope.expediente_ids) ? scope.expediente_ids.length : 0;
    const n_lines = Array.isArray(scope.lines) ? scope.lines.length : 0;
    if (n_lines > 0) {
      label = lang === "es"
        ? `${n_exp} exp · ${n_lines} líneas`
        : `${n_exp} exp · ${n_lines} lines`;
    } else if (n_exp > 0) {
      label = lang === "es"
        ? `${n_exp} expediente${n_exp !== 1 ? "s" : ""}`
        : `${n_exp} expediente${n_exp !== 1 ? "s" : ""}`;
    }
  }
  const noItems = !transferItems || transferItems.length === 0;
  return (
    <button type="button"
            onClick={onOpen}
            disabled={noItems}
            title={noItems
              ? (lang === "es"
                  ? "Selecciona productos primero (paso 2)"
                  : "Pick products first (step 2)")
              : (lang === "es" ? "Configurar alcance del costo" : "Set cost scope")}
            style={{
              padding: "4px 10px", borderRadius: 999,
              border: restricted
                ? "1.5px solid var(--brand-accent, #0E8A6D)"
                : "1px solid var(--border-subtle)",
              background: restricted
                ? "color-mix(in oklab, var(--brand-accent, #0E8A6D) 10%, transparent)"
                : "var(--surface, white)",
              color: restricted ? "var(--brand-accent, #0E8A6D)" : "var(--text-secondary)",
              fontSize: 11, fontWeight: 700, letterSpacing: 0.3,
              cursor: noItems ? "not-allowed" : "pointer",
              opacity: noItems ? 0.5 : 1,
            }}>
      {label}
    </button>
  );
}

// ═════════════════════════════════════════════════════════════
// STEP 3 · Productos
// ═════════════════════════════════════════════════════════════
function Step3Products({ lang, origenLabel, stockOrigen, productLines, addProductLine, updateProductLine, removeProductLine }) {
  const [search, setSearch] = useState("");
  // Sprint 2026-04-30 — el catálogo de SKUs en un nodo puede tener miles
  // de filas. El acordeón está cerrado por defecto y solo se abre cuando
  // el usuario hace clic. Si escribe algo en el buscador, se abre auto-
  // máticamente para mostrar las coincidencias.
  const [open, setOpen] = useState(false);
  const filtered = useMemo(() => {
    const n = search.trim().toLowerCase();
    if (!n) return stockOrigen.slice(0, 200);
    return stockOrigen.filter((s) => {
      const hay = [s.sku, s.product_label, s.lote, s.size].join(" ").toLowerCase();
      return hay.includes(n);
    }).slice(0, 200);
  }, [search, stockOrigen]);

  // Auto-expand cuando el usuario empieza a tipear.
  const onSearchChange = (e) => {
    const v = e.target.value;
    setSearch(v);
    if (v.trim()) setOpen(true);
  };

  return (
    <div className="card card-pad-lg">
      <h2 className="heading-md" style={{ marginBottom: 14 }}>
        {lang === "es" ? "Paso 3 · Productos y cantidades" : "Step 3 · Products & quantities"}
      </h2>

      <div className="caption" style={{ color: "var(--text-tertiary)", marginBottom: 10 }}>
        {lang === "es" ? "SKUs con stock disponible en " : "SKUs with stock available in "}
        <strong style={{ color: "#0B1E3A" }}>{origenLabel || "—"}</strong>
      </div>

      {/* ── Acordeón: cabecera clickable + cuerpo colapsable ─────────────── */}
      <div style={{
        border: "1px solid var(--border, #E1E6ED)", borderRadius: 10,
        marginBottom: 18, overflow: "hidden", background: "#fff",
      }}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          style={{
            width: "100%", display: "flex", alignItems: "center",
            justifyContent: "space-between", gap: 12,
            padding: "12px 16px", border: "none", cursor: "pointer",
            background: open ? "rgba(0,178,134,0.04)" : "#fff",
            transition: "background 120ms ease",
          }}
          onMouseEnter={(e) => { if (!open) e.currentTarget.style.background = "#F7F9FC"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = open ? "rgba(0,178,134,0.04)" : "#fff"; }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <IconPackage size={14} style={{ color: "#3083FE" }}/>
            <span style={{ fontWeight: 700, color: "#0B1E3A", fontSize: 13 }}>
              {lang === "es" ? "Productos disponibles" : "Available products"}
            </span>
            <span style={{
              padding: "2px 9px", borderRadius: 999,
              background: "rgba(72,30,227,0.10)", color: "#481EE3",
              fontSize: 11, fontWeight: 700, fontFamily: "var(--font-mono)",
            }}>
              {stockOrigen.length}
            </span>
          </div>
          <span style={{
            display: "inline-block", color: "#64748B",
            transition: "transform 180ms ease",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
          }} aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M3 6l5 5 5-5" stroke="currentColor" strokeWidth="1.6"
                    strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </span>
        </button>

        {/* Cuerpo del acordeón */}
        {open && (
          <div style={{ borderTop: "1px solid #EEF1F5" }}>
            <div style={{ padding: "10px 12px 0" }}>
              <input className="input"
                     placeholder={lang === "es" ? "Buscar SKU, producto, lote, talla…" : "Search SKU, product, lot, size…"}
                     value={search} onChange={onSearchChange}
                     autoFocus
                     style={{ marginBottom: 10 }}/>
            </div>
            <div style={{ maxHeight: 240, overflowY: "auto" }}>
              {filtered.length === 0 ? (
                <div className="caption" style={{ padding: 18, textAlign: "center", color: "var(--text-tertiary)" }}>
                  {stockOrigen.length === 0
                    ? (lang === "es" ? "Sin stock en el nodo origen." : "No stock at origin node.")
                    : (lang === "es" ? "Sin coincidencias." : "No matches.")}
                </div>
              ) : (
                filtered.map((s) => (
                  <button key={s._key || s.id} type="button"
                          onClick={() => addProductLine(s)}
                          style={{
                            width: "100%", textAlign: "left", padding: "10px 14px",
                            border: "none", borderBottom: "1px solid #F3F5F8", background: "#fff",
                            cursor: "pointer", display: "flex", alignItems: "center", gap: 12,
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = "#F7F9FC"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "#fff"}>
              <IconPackage size={14} style={{ color: "#3083FE", flexShrink: 0 }}/>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: "#0B1E3A", fontSize: 13 }}>
                  <span className="mono-sm">{s.sku || "—"}</span>
                  {s.size && <span style={{ marginLeft: 8 }}>· {s.size}</span>}
                  {s.lote && <span className="caption" style={{ marginLeft: 8 }}>L: {s.lote}</span>}
                </div>
                <div className="caption" style={{ color: "var(--text-tertiary)" }}>
                  {s.product_label || ""}
                </div>
              </div>
              <span className="badge badge-outline tabular-nums">
                {Number(s.qty_disponible || 0)}u
              </span>
            </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <h3 className="heading-sm">{lang === "es" ? "Líneas de la transferencia" : "Transfer lines"}</h3>
        <span className="caption" style={{ color: "var(--text-tertiary)" }}>
          {productLines.length} {productLines.length === 1 ? (lang === "es" ? "línea" : "line") : (lang === "es" ? "líneas" : "lines")}
        </span>
      </div>

      {productLines.length === 0 ? (
        <div className="empty" style={{ padding: 30 }}>
          <IconTruck size={22} style={{ color: "var(--text-tertiary)" }}/>
          <div className="caption" style={{ color: "var(--text-tertiary)" }}>
            {lang === "es" ? "Selecciona productos del listado superior." : "Pick products from the list above."}
          </div>
        </div>
      ) : (
        <div className="card card-pad-0">
          <table className="table" style={{ tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: 130 }}/>{/* SKU / Lote */}
              <col style={{ width: 70 }}/>{/* Talla */}
              <col/>                        {/* Producto */}
              <col style={{ width: 90 }}/>{/* Disp. origen */}
              <col style={{ width: 90 }}/>{/* Transferir */}
              <col style={{ width: 90 }}/>{/* Reservar */}
              <col style={{ width: 70 }}/>{/* Libre */}
              <col style={{ width: 110 }}/>{/* Valor unit. */}
              <col style={{ width: 110 }}/>{/* Subtotal FOB */}
              <col style={{ width: 50 }}/>{/* Trash */}
            </colgroup>
            <thead>
              <tr>
                <th>SKU / {lang === "es" ? "Lote" : "Lot"}</th>
                <th style={{ textAlign: "center" }}>{lang === "es" ? "Talla" : "Size"}</th>
                <th>{lang === "es" ? "Producto" : "Product"}</th>
                <th style={{ textAlign: "right", paddingRight: 12 }}>{lang === "es" ? "Disp." : "Avail."}</th>
                <th style={{ textAlign: "right", paddingRight: 12 }}>{lang === "es" ? "Transferir" : "Transfer"}</th>
                <th style={{ textAlign: "right", paddingRight: 12 }}>{lang === "es" ? "Reservar" : "Reserve"}</th>
                <th style={{ textAlign: "right", paddingRight: 12 }}>{lang === "es" ? "Libre" : "Free"}</th>
                {/* Sprint 2026-04-30 — Valor unitario USD declarado para
                    el cálculo de Landed Cost (BY_VALUE). */}
                <th style={{ textAlign: "right", paddingRight: 12 }}
                    title={lang === "es"
                      ? "Valor unitario USD (FOB declarado). Default = costo del lote."
                      : "Unit value USD (declared FOB). Default = lot cost."}>
                  {lang === "es" ? "Val. unit. (USD)" : "Unit val. (USD)"}
                </th>
                <th style={{ textAlign: "right", paddingRight: 12 }}>{lang === "es" ? "Subtotal FOB" : "Subtotal FOB"}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {productLines.map((l) => {
                const free = Math.max(0, Number(l.qty_transfer || 0) - Number(l.qty_reserve || 0));
                const overstock = Number(l.qty_transfer || 0) > Number(l.disponible || 0);
                const subtotal = Number(l.qty_transfer || 0) * Number(l.unit_value || l.unit_cost || 0);
                return (
                  <tr key={l.tmpId} style={overstock ? { background: "#FEF3C7" } : null}>
                    <td className="mono-sm">
                      <div style={{ fontWeight: 600 }}>{l.sku}</div>
                      {l.lote && <div className="caption" style={{ marginTop: 2 }}>L: {l.lote}</div>}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      {l.size
                        ? <span className="size-chip" style={{
                            display: "inline-block",
                            padding: "2px 10px", borderRadius: 999,
                            background: "rgba(72,30,227,0.10)", color: "#481EE3",
                            fontSize: 12, fontWeight: 700,
                          }}>{l.size}</span>
                        : <span className="caption" style={{ color: "var(--text-tertiary)" }}>—</span>}
                    </td>
                    <td>{l.product_label}</td>
                    <td className="tabular-nums" style={{ textAlign: "right", paddingRight: 12 }}>{l.disponible}</td>
                    <td style={{ textAlign: "right", paddingRight: 12 }}>
                      <input className="input tabular-nums" type="number" min="0" max={l.disponible}
                             style={{ width: "100%", textAlign: "right" }}
                             value={l.qty_transfer}
                             onChange={(e) => updateProductLine(l.tmpId, { qty_transfer: Number(e.target.value) })}/>
                    </td>
                    <td style={{ textAlign: "right", paddingRight: 12 }}>
                      <input className="input tabular-nums" type="number" min="0" max={l.qty_transfer}
                             style={{ width: "100%", textAlign: "right" }}
                             value={l.qty_reserve}
                             onChange={(e) => updateProductLine(l.tmpId, { qty_reserve: Math.min(Number(e.target.value), Number(l.qty_transfer || 0)) })}/>
                    </td>
                    <td className="tabular-nums" style={{ textAlign: "right", paddingRight: 12, fontWeight: 600, color: "#00B286" }}>
                      {free}
                    </td>
                    {/* Valor unitario USD — input editable, default = unit_cost */}
                    <td style={{ textAlign: "right", paddingRight: 12 }}>
                      <input className="input tabular-nums" type="number" min="0" step="0.01"
                             style={{ width: "100%", textAlign: "right" }}
                             value={l.unit_value ?? l.unit_cost ?? 0}
                             onChange={(e) => updateProductLine(l.tmpId, { unit_value: Number(e.target.value) })}
                             title={l.unit_cost
                               ? `${lang === "es" ? "Costo histórico:" : "Historical cost:"} $${Number(l.unit_cost).toFixed(2)}`
                               : undefined}/>
                    </td>
                    {/* Subtotal FOB = qty * unit_value, read-only display */}
                    <td className="tabular-nums" style={{
                      textAlign: "right", paddingRight: 12,
                      fontWeight: 700, color: "#0B1E3A",
                    }}>
                      ${subtotal.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <button className="btn btn-ghost btn-sm"
                              onClick={() => removeProductLine(l.tmpId)}
                              title={lang === "es" ? "Quitar línea" : "Remove line"}
                              style={{ color: "#D64545", padding: "4px 6px" }}>
                        <IconTrash size={13}/>
                      </button>
                    </td>
                  </tr>
                );
              })}
              {/* Totals row — total FOB sumando subtotales de cada línea */}
              <tr style={{ background: "rgba(0,178,134,0.06)", fontWeight: 700 }}>
                <td colSpan={4} style={{ textAlign: "right", color: "#0B1E3A", paddingRight: 12 }}>
                  {lang === "es" ? "Totales" : "Totals"}
                </td>
                <td className="tabular-nums" style={{ textAlign: "right", paddingRight: 12 }}>
                  {productLines.reduce((a, l) => a + Number(l.qty_transfer || 0), 0)}
                </td>
                <td className="tabular-nums" style={{ textAlign: "right", paddingRight: 12 }}>
                  {productLines.reduce((a, l) => a + Number(l.qty_reserve || 0), 0)}
                </td>
                <td className="tabular-nums" style={{ textAlign: "right", paddingRight: 12, color: "#00B286" }}>
                  {productLines.reduce((a, l) =>
                    a + Math.max(0, Number(l.qty_transfer || 0) - Number(l.qty_reserve || 0)), 0)}
                </td>
                <td colSpan={1}></td>
                <td className="tabular-nums" style={{
                  textAlign: "right", paddingRight: 12,
                  color: "#00B286", fontSize: 14,
                }}>
                  ${productLines.reduce((a, l) =>
                    a + Number(l.qty_transfer || 0) * Number(l.unit_value || l.unit_cost || 0), 0
                  ).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                </td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// STEP 4 · Validación y totales — desglose detallado
// ═════════════════════════════════════════════════════════════
function Step4Summary({ lang, origen, destino, legalContext, refTracking, productLines, costLines, costKinds, totals }) {
  const legalLabel = LEGAL_CONTEXT.find((c) => c.codigo === legalContext)?.label || legalContext;

  // ── Agrupaciones derivadas ────────────────────────────────
  // (a) Costos por categoría (kind) — suma USD por tipo, ej. todos los
  //     "arancel_aduana" en un solo bucket aunque haya 3 líneas DUA.
  const costsByKind = useMemo(() => {
    const map = new Map();
    costLines.forEach((c) => {
      const usd = Number(c.amount || 0) * Number(c.fx_to_usd || 1);
      const cur = map.get(c.kind) || { kind: c.kind, total_usd: 0, count: 0, lines: [] };
      cur.total_usd += usd;
      cur.count += 1;
      cur.lines.push({ ...c, usd });
      map.set(c.kind, cur);
    });
    return Array.from(map.values()).sort((a, b) => b.total_usd - a.total_usd);
  }, [costLines]);

  // (b) Costos por moneda original — útil cuando la DUA viene en COP,
  //     factura del proveedor en USD, almacenaje en CRC, etc.
  const costsByCurrency = useMemo(() => {
    const map = new Map();
    costLines.forEach((c) => {
      const code = (c.currency || "USD").toUpperCase();
      const usd = Number(c.amount || 0) * Number(c.fx_to_usd || 1);
      const cur = map.get(code) || { code, total_native: 0, total_usd: 0, count: 0 };
      cur.total_native += Number(c.amount || 0);
      cur.total_usd    += usd;
      cur.count += 1;
      map.set(code, cur);
    });
    return Array.from(map.values()).sort((a, b) => b.total_usd - a.total_usd);
  }, [costLines]);

  // (c) Productos agrupados por SKU para conteo de productos únicos.
  const skusUnicos = useMemo(() => {
    const set = new Set(productLines.map(l => l.sku));
    return set.size;
  }, [productLines]);

  // (d) Costo prorrateado por unidad (landed cost incremental).
  const costPerUnit = totals.totalUnits > 0
    ? totals.totalCostUsd / totals.totalUnits
    : 0;

  return (
    <div className="card card-pad-lg">
      <h2 className="heading-md" style={{ marginBottom: 14 }}>
        {lang === "es" ? "Paso 4 · Validación y totales" : "Step 4 · Validation & totals"}
      </h2>

      {/* ─── Strip de KPIs (5 tiles) ────────────────────────── */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(5, 1fr)",
        gap: 10, marginBottom: 18,
      }}>
        <KpiTile label={lang === "es" ? "Líneas" : "Lines"}
                 value={productLines.length}/>
        <KpiTile label={lang === "es" ? "Productos" : "Products"}
                 value={skusUnicos}
                 accent="#481EE3"/>
        <KpiTile label={lang === "es" ? "Unidades" : "Units"}
                 value={totals.totalUnits.toLocaleString()}/>
        <KpiTile label={lang === "es" ? "Costos (líneas)" : "Costs (lines)"}
                 value={costLines.length}/>
        <KpiTile label={lang === "es" ? "Monedas" : "Currencies"}
                 value={costsByCurrency.length}
                 accent="#3083FE"/>
      </div>

      {/* ─── Bloque CONTEXTO ────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginBottom: 18 }}>
        <SummaryBox title={lang === "es" ? "CONTEXTO" : "CONTEXT"}>
          <Row k={lang === "es" ? "Origen → Destino" : "Origin → Destination"}
               v={<><strong>{origen?.codigo || "—"}</strong> <IconArrow size={11}/> <strong>{destino?.codigo || "—"}</strong></>}/>
          <Row k={lang === "es" ? "Motivo" : "Reason"} v={legalLabel}/>
          <Row k="Tracking" v={refTracking || "—"}/>
        </SummaryBox>
        <SummaryBox title={lang === "es" ? "STOCK MOVIDO" : "STOCK MOVED"}>
          <Row k={lang === "es" ? "Unidades a mover" : "Units to move"} v={<strong className="tabular-nums">{totals.totalUnits}</strong>}/>
          <Row k={lang === "es" ? "Pre-reservadas" : "Pre-reserved"} v={<span className="tabular-nums">{totals.totalReserve}</span>}/>
          <Row k={lang === "es" ? "Libres al llegar" : "Free at arrival"} v={<span className="tabular-nums" style={{ color: "#00B286", fontWeight: 700 }}>{totals.totalFree}</span>}/>
        </SummaryBox>
      </div>

      {/* ─── Hero: total costo + costo por unidad ──────────── */}
      <div style={{
        background: "linear-gradient(135deg, #0B1E3A 0%, #1A2A5C 100%)",
        color: "#fff", padding: "20px 22px", borderRadius: 14, marginBottom: 18,
        display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 24,
      }}>
        <div>
          <div className="micro" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: 1, marginBottom: 6 }}>
            {lang === "es" ? "COSTO TOTAL INCREMENTAL" : "TOTAL INCREMENTAL COST"}
          </div>
          <div className="tabular-nums" style={{ fontSize: 36, fontWeight: 700, color: "#1DE394", lineHeight: 1.05 }}>
            ${totals.totalCostUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}
            <span style={{ fontSize: 18, fontWeight: 400, color: "rgba(255,255,255,0.7)", marginLeft: 6 }}>USD</span>
          </div>
          <div className="caption" style={{ color: "rgba(255,255,255,0.6)", marginTop: 4 }}>
            {lang === "es"
              ? `${costLines.length} costo${costLines.length !== 1 ? "s" : ""} · ${costsByCurrency.length} moneda${costsByCurrency.length !== 1 ? "s" : ""}`
              : `${costLines.length} cost${costLines.length !== 1 ? "s" : ""} · ${costsByCurrency.length} currenc${costsByCurrency.length !== 1 ? "ies" : "y"}`}
          </div>
        </div>
        <div style={{
          borderLeft: "1px solid rgba(255,255,255,0.10)",
          paddingLeft: 24, display: "flex", flexDirection: "column", justifyContent: "center",
        }}>
          <div className="micro" style={{ color: "rgba(255,255,255,0.6)", letterSpacing: 1, marginBottom: 6 }}>
            {lang === "es" ? "COSTO POR UNIDAD" : "COST PER UNIT"}
          </div>
          <div className="tabular-nums" style={{ fontSize: 22, fontWeight: 700, color: "#fff" }}>
            ${costPerUnit.toLocaleString("en-US", { maximumFractionDigits: 4 })}
            <span style={{ fontSize: 13, fontWeight: 400, color: "rgba(255,255,255,0.7)", marginLeft: 4 }}>USD / u</span>
          </div>
          <div className="caption" style={{ color: "rgba(255,255,255,0.6)", marginTop: 4 }}>
            {lang === "es"
              ? `Prorrateo lineal sobre ${totals.totalUnits} u.`
              : `Even allocation over ${totals.totalUnits} u.`}
          </div>
        </div>
      </div>

      {/* ─── Desglose por categoría de costo ─────────────────── */}
      {costsByKind.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <h3 className="heading-sm" style={{ marginBottom: 8 }}>
            {lang === "es" ? "Desglose por categoría" : "Breakdown by category"}
          </h3>
          <div className="card card-pad-0">
            <table className="table">
              <thead>
                <tr>
                  <th>{lang === "es" ? "Categoría" : "Category"}</th>
                  <th style={{ textAlign: "center", width: 100 }}>{lang === "es" ? "Líneas" : "Lines"}</th>
                  <th style={{ textAlign: "right", width: 160 }}>USD</th>
                  <th style={{ textAlign: "right", width: 90 }}>%</th>
                </tr>
              </thead>
              <tbody>
                {costsByKind.map((g) => {
                  const k = costKinds.find((x) => x.codigo === g.kind);
                  const pct = totals.totalCostUsd > 0
                    ? (g.total_usd / totals.totalCostUsd) * 100 : 0;
                  return (
                    <tr key={g.kind}>
                      <td>
                        <span style={{
                          padding: "3px 10px", borderRadius: 999,
                          fontSize: 11, fontWeight: 700,
                          background: `${k?.color || "#64748B"}20`, color: k?.color || "#64748B",
                        }}>{k?.label || g.kind}</span>
                      </td>
                      <td className="tabular-nums" style={{ textAlign: "center" }}>
                        {g.count}
                      </td>
                      <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 700 }}>
                        ${g.total_usd.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                      </td>
                      <td className="tabular-nums" style={{ textAlign: "right", color: "#64748B" }}>
                        {pct.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
                <tr style={{ background: "rgba(0,178,134,0.06)", fontWeight: 700 }}>
                  <td style={{ color: "#0B1E3A" }}>{lang === "es" ? "Total" : "Total"}</td>
                  <td className="tabular-nums" style={{ textAlign: "center" }}>{costLines.length}</td>
                  <td className="tabular-nums" style={{ textAlign: "right", color: "#00B286", fontSize: 14 }}>
                    ${totals.totalCostUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                  </td>
                  <td className="tabular-nums" style={{ textAlign: "right" }}>100%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── Detalle línea por línea de los costos ────────────── */}
      {costLines.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <h3 className="heading-sm" style={{ marginBottom: 8 }}>
            {lang === "es" ? "Detalle de costos" : "Cost lines"}
          </h3>
          <div className="card card-pad-0">
            <table className="table">
              <thead>
                <tr>
                  <th>{lang === "es" ? "Tipo" : "Kind"}</th>
                  <th>{lang === "es" ? "Detalle" : "Label"}</th>
                  <th style={{ textAlign: "right", width: 110 }}>{lang === "es" ? "Monto" : "Amount"}</th>
                  <th style={{ textAlign: "center", width: 70 }}>{lang === "es" ? "Mon." : "Curr."}</th>
                  <th style={{ textAlign: "right", width: 90 }}>FX→USD</th>
                  <th style={{ textAlign: "right", width: 130 }}>USD</th>
                  <th style={{ textAlign: "center", width: 80 }}>{lang === "es" ? "Origen" : "Source"}</th>
                </tr>
              </thead>
              <tbody>
                {costLines.map((c) => {
                  const usd = Number(c.amount || 0) * Number(c.fx_to_usd || 1);
                  const k = costKinds.find((x) => x.codigo === c.kind);
                  return (
                    <tr key={c.tmpId}>
                      <td>
                        <span style={{
                          padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 600,
                          background: `${k?.color || "#64748B"}20`, color: k?.color || "#64748B",
                        }}>{k?.label || c.kind}</span>
                      </td>
                      <td>{c.label || "—"}</td>
                      <td className="tabular-nums" style={{ textAlign: "right" }}>
                        {Number(c.amount || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                      </td>
                      <td className="mono-sm" style={{ textAlign: "center", fontWeight: 600 }}>
                        {c.currency || "USD"}
                      </td>
                      <td className="tabular-nums" style={{ textAlign: "right", color: "#64748B" }}>
                        {Number(c.fx_to_usd || 1).toFixed(4)}
                      </td>
                      <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 700, color: "#00B286" }}>
                        ${usd.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <span style={{
                          padding: "2px 8px", borderRadius: 999, fontSize: 10, fontWeight: 700,
                          background: c.source === "OCR_DUA" ? "rgba(0,178,134,0.12)" : "#F3F5F8",
                          color:      c.source === "OCR_DUA" ? "#00B286" : "#64748B",
                        }}>{c.source === "OCR_DUA" ? "IA" : "MANUAL"}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── Valorización por moneda ──────────────────────────── */}
      {costsByCurrency.length > 1 && (
        <div style={{ marginBottom: 14 }}>
          <h3 className="heading-sm" style={{ marginBottom: 8 }}>
            {lang === "es" ? "Valorización por moneda" : "Valuation by currency"}
          </h3>
          <div style={{
            display: "grid",
            gridTemplateColumns: `repeat(${Math.min(costsByCurrency.length, 4)}, 1fr)`,
            gap: 10,
          }}>
            {costsByCurrency.map((c) => (
              <div key={c.code} style={{
                background: "#fff", padding: "12px 14px", borderRadius: 10,
                border: "1px solid rgba(11,30,58,0.08)",
              }}>
                <div className="mono-sm" style={{
                  fontSize: 11, color: "#64748B", fontWeight: 700, letterSpacing: 0.5,
                }}>{c.code}</div>
                <div className="tabular-nums" style={{
                  fontSize: 17, fontWeight: 700, color: "#0B1E3A", marginTop: 2,
                }}>
                  {c.total_native.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                </div>
                <div className="caption" style={{ color: "#64748B", marginTop: 2 }}>
                  ≈ ${c.total_usd.toLocaleString("en-US", { maximumFractionDigits: 2 })} USD
                  · {c.count} {lang === "es" ? (c.count === 1 ? "línea" : "líneas") : (c.count === 1 ? "line" : "lines")}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Desglose de productos detallado ──────────────────── */}
      <div style={{ marginBottom: 14 }}>
        <h3 className="heading-sm" style={{ marginBottom: 8 }}>
          {lang === "es" ? "Desglose de productos" : "Product breakdown"}
        </h3>
        <div className="card card-pad-0">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 100 }}>SKU</th>
                <th>{lang === "es" ? "Producto" : "Product"}</th>
                <th style={{ textAlign: "center", width: 70 }}>{lang === "es" ? "Talla" : "Size"}</th>
                <th style={{ textAlign: "center", width: 90 }}>{lang === "es" ? "Lote" : "Lot"}</th>
                <th style={{ textAlign: "right", width: 70 }}>{lang === "es" ? "Mover" : "Move"}</th>
                {/* Sprint 2026-04-30 — valor unitario y subtotal FOB. */}
                <th style={{ textAlign: "right", width: 90 }}>{lang === "es" ? "Val. unit." : "Unit val."}</th>
                <th style={{ textAlign: "right", width: 100 }}>{lang === "es" ? "Subtotal FOB" : "Subtotal FOB"}</th>
                <th style={{ textAlign: "right", width: 110 }}>{lang === "es" ? "Costo asig." : "Cost alloc."}</th>
                <th style={{ textAlign: "right", width: 110 }}>{lang === "es" ? "Landed unit." : "Landed unit."}</th>
              </tr>
            </thead>
            <tbody>
              {productLines.map((l) => {
                const lineCost     = costPerUnit * Number(l.qty_transfer || 0);
                const unitVal      = Number(l.unit_value || l.unit_cost || 0);
                const subtotalFob  = Number(l.qty_transfer || 0) * unitVal;
                const landedUnit   = unitVal + costPerUnit;
                return (
                  <tr key={l.tmpId}>
                    <td className="mono-sm" style={{ color: "#481EE3", fontWeight: 600 }}>{l.sku}</td>
                    <td>{l.product_label}</td>
                    <td style={{ textAlign: "center" }}>
                      {l.size
                        ? <span style={{
                            padding: "2px 10px", borderRadius: 999,
                            background: "rgba(72,30,227,0.10)", color: "#481EE3",
                            fontSize: 11, fontWeight: 700,
                            fontFamily: "var(--font-mono)",
                          }}>{l.size}</span>
                        : <span style={{ color: "#64748B" }}>—</span>}
                    </td>
                    <td className="mono-sm" style={{ textAlign: "center", color: "#64748B", fontSize: 11.5 }}>
                      {l.lote || "—"}
                    </td>
                    <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 600 }}>{l.qty_transfer}</td>
                    <td className="tabular-nums" style={{ textAlign: "right", color: "#0B1E3A" }}>
                      ${unitVal.toLocaleString("en-US", { maximumFractionDigits: 4 })}
                    </td>
                    <td className="tabular-nums" style={{ textAlign: "right", color: "#0B1E3A", fontWeight: 600 }}>
                      ${subtotalFob.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                    </td>
                    <td className="tabular-nums" style={{ textAlign: "right", color: "#B45309", fontWeight: 600 }}>
                      +${lineCost.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                    </td>
                    <td className="tabular-nums" style={{ textAlign: "right", color: "#00B286", fontWeight: 700 }}>
                      ${landedUnit.toLocaleString("en-US", { maximumFractionDigits: 4 })}
                    </td>
                  </tr>
                );
              })}
              <tr style={{ background: "rgba(0,178,134,0.06)", fontWeight: 700 }}>
                <td colSpan={4} style={{ color: "#0B1E3A" }}>{lang === "es" ? "Total" : "Total"}</td>
                <td className="tabular-nums" style={{ textAlign: "right" }}>{totals.totalUnits}</td>
                <td></td>
                <td className="tabular-nums" style={{ textAlign: "right", color: "#0B1E3A", fontSize: 13 }}>
                  ${totals.totalValueUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                </td>
                <td className="tabular-nums" style={{ textAlign: "right", color: "#00B286", fontSize: 14 }}>
                  +${totals.totalCostUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                </td>
                <td className="tabular-nums" style={{ textAlign: "right", color: "#00B286", fontSize: 14 }}>
                  ${(totals.totalValueUsd + totals.totalCostUsd).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── Recap narrativo ──────────────────────────────────── */}
      <div style={{
        background: "rgba(0,178,134,0.06)", border: "1px solid rgba(0,178,134,0.20)",
        borderRadius: 10, padding: "12px 16px",
        fontSize: 13, color: "#0B1E3A", lineHeight: 1.55,
      }}>
        <strong style={{ color: "#00B286" }}>✓ {lang === "es" ? "Resumen ejecutivo:" : "Executive summary:"}</strong>{" "}
        {lang === "es" ? (
          <>
            Esta transferencia mueve <strong>{totals.totalUnits}</strong> u. de{" "}
            <strong>{skusUnicos}</strong> producto{skusUnicos !== 1 ? "s" : ""} desde{" "}
            <strong>{origen?.codigo || "—"}</strong> hacia{" "}
            <strong>{destino?.codigo || "—"}</strong> bajo motivo{" "}
            <strong>{legalLabel}</strong>.{" "}
            {totals.totalCostUsd > 0 ? (
              <>El costo total incremental es <strong>${totals.totalCostUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })} USD</strong>{" "}
                (≈ <strong>${costPerUnit.toLocaleString("en-US", { maximumFractionDigits: 4 })}/u</strong>),
                distribuido en {costLines.length} línea{costLines.length !== 1 ? "s" : ""}{" "}
                de costo y {costsByCurrency.length} moneda{costsByCurrency.length !== 1 ? "s" : ""}.</>
            ) : (
              <>No se registraron costos operativos incrementales — solo movimiento físico.</>
            )}
          </>
        ) : (
          <>
            This transfer moves <strong>{totals.totalUnits}</strong> u. of{" "}
            <strong>{skusUnicos}</strong> product{skusUnicos !== 1 ? "s" : ""} from{" "}
            <strong>{origen?.codigo || "—"}</strong> to{" "}
            <strong>{destino?.codigo || "—"}</strong> under <strong>{legalLabel}</strong>.{" "}
            {totals.totalCostUsd > 0 ? (
              <>Total incremental cost: <strong>${totals.totalCostUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })} USD</strong>{" "}
                (≈ <strong>${costPerUnit.toLocaleString("en-US", { maximumFractionDigits: 4 })}/u</strong>),
                spread across {costLines.length} cost line{costLines.length !== 1 ? "s" : ""}{" "}
                in {costsByCurrency.length} currenc{costsByCurrency.length !== 1 ? "ies" : "y"}.</>
            ) : (
              <>No incremental operating costs recorded — physical movement only.</>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── KPI tile usado en Step 4 ──
function KpiTile({ label, value, accent }) {
  return (
    <div style={{
      background: "#fff", padding: "10px 12px", borderRadius: 10,
      border: "1px solid rgba(11,30,58,0.08)",
    }}>
      <div style={{
        fontSize: 10, letterSpacing: 0.5, textTransform: "uppercase",
        color: "#64748B", fontWeight: 600, marginBottom: 4,
      }}>{label}</div>
      <div className="tabular-nums" style={{
        fontSize: 18, fontWeight: 700,
        color: accent || "#0B1E3A",
      }}>{value}</div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// SUB-FORM CONDICIONAL POR MOTIVO LEGAL
// ═════════════════════════════════════════════════════════════
function ContextDataSection({ lang, legalContext, contextData, setCtx }) {
  const cd = contextData || {};
  const lbl = (es, en) => lang === "es" ? es : en;

  if (legalContext === "INTERNAL") {
    return (
      <div style={{ marginTop: 22, padding: 18, border: "1px solid var(--border, #E1E6ED)", borderRadius: 12, background: "rgba(100,116,139,0.04)" }}>
        <div className="micro" style={{ color: "#64748B", letterSpacing: 1, marginBottom: 12 }}>
          {lbl("LOGÍSTICA LOCAL", "LOCAL LOGISTICS")}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Field label={lbl("Transportista / Carrier", "Carrier")}>
            <input className="input" value={cd.carrier_name || ""}
                   onChange={(e) => setCtx({ carrier_name: e.target.value })}
                   placeholder={lbl("Ej. Servientrega, TCC", "e.g. local courier")} />
          </Field>
          <Field label={lbl("Conductor (nombre)", "Driver name")}>
            <input className="input" value={cd.conductor_name || ""}
                   onChange={(e) => setCtx({ conductor_name: e.target.value })} />
          </Field>
          <Field label={lbl("Placa del vehículo", "Vehicle plate")}>
            <input className="input mono-sm" value={cd.vehicle_plate || ""}
                   onChange={(e) => setCtx({ vehicle_plate: e.target.value.toUpperCase() })}
                   placeholder="ABC-123" />
          </Field>
          <Field label={lbl("ID interno del vehículo", "Vehicle ID")}>
            <input className="input mono-sm" value={cd.vehicle_id || ""}
                   onChange={(e) => setCtx({ vehicle_id: e.target.value })} />
          </Field>
        </div>
      </div>
    );
  }

  if (legalContext === "NATIONALIZATION") {
    return (
      <div style={{ marginTop: 22, padding: 18, border: "1px solid rgba(72,30,227,0.3)", borderRadius: 12, background: "rgba(72,30,227,0.04)" }}>
        <div className="micro" style={{ color: "#481EE3", letterSpacing: 1, marginBottom: 12 }}>
          {lbl("DOCUMENTOS DE IMPORTACIÓN", "IMPORT DOCUMENTS")}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Field label={lbl("Número BL / AWB", "BL / AWB number")}>
            <input className="input mono-sm" value={cd.bl_awb_number || ""}
                   onChange={(e) => setCtx({ bl_awb_number: e.target.value })}
                   placeholder="MAEU-123456789" />
          </Field>
          <Field label={lbl("Número DUA / liquidación", "DUA / customs ref")}>
            <input className="input mono-sm" value={cd.dua_number || ""}
                   onChange={(e) => setCtx({ dua_number: e.target.value })}
                   placeholder="2026-PE-001234" />
          </Field>
        </div>
        <div className="caption" style={{ color: "var(--text-tertiary)", marginTop: 8 }}>
          {lbl("Subí abajo el DUA — la IA extraerá DAI, IVA y almacenaje automáticamente.",
               "Upload the DUA below — AI will extract duties, VAT and storage costs automatically.")}
        </div>
      </div>
    );
  }

  if (legalContext === "EXPORT") {
    return (
      <div style={{ marginTop: 22, padding: 18, border: "1px solid rgba(48,131,254,0.3)", borderRadius: 12, background: "rgba(48,131,254,0.04)" }}>
        <div className="micro" style={{ color: "#3083FE", letterSpacing: 1, marginBottom: 12 }}>
          {lbl("EXPORTACIÓN INTERNACIONAL", "INTERNATIONAL EXPORT")}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Field label={lbl("Carrier internacional", "International carrier")}>
            <input className="input" value={cd.international_carrier || ""}
                   onChange={(e) => setCtx({ international_carrier: e.target.value })}
                   placeholder="Maersk, MSC, DHL Express…" />
          </Field>
          <Field label={lbl("Número de contenedor", "Container number")}>
            <input className="input mono-sm" value={cd.container_number || ""}
                   onChange={(e) => setCtx({ container_number: e.target.value.toUpperCase() })}
                   placeholder="MAEU1234567" />
          </Field>
          <Field label={lbl("BL / AWB internacional", "International BL/AWB")}>
            <input className="input mono-sm" value={cd.awb_bl_number || ""}
                   onChange={(e) => setCtx({ awb_bl_number: e.target.value })} />
          </Field>
        </div>
        <div className="caption" style={{ color: "var(--text-tertiary)", marginTop: 8 }}>
          {lbl("Subí abajo el DUA de salida — opcional, pero recomendado para anclar costos de exportación.",
               "Upload the export DUA below — optional but recommended to track export costs.")}
        </div>
      </div>
    );
  }

  if (legalContext === "DISTRIBUTION") {
    const tp = Number(cd.transfer_pricing_amount || 0);
    return (
      <div style={{ marginTop: 22, padding: 18, border: "2px solid #00B286", borderRadius: 12, background: "rgba(0,178,134,0.05)" }}>
        <div className="micro" style={{ color: "#00B286", letterSpacing: 1, marginBottom: 8 }}>
          {lbl("TRANSFER PRICING ★", "TRANSFER PRICING ★")}
        </div>
        <div className="caption" style={{ color: "#0B1E3A", marginBottom: 14, lineHeight: 1.5 }}>
          ⚠ {lbl(
            "Este movimiento implica cambio de dueño. Requiere precio de transferencia y aprobación CEO/Compliance.",
            "This movement transfers ownership. Requires transfer pricing and CEO/Compliance approval."
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 14 }}>
          <Field label={lbl("Precio de transferencia *", "Transfer price *")}>
            <input className="input tabular-nums" type="number" step="0.01" min="0"
                   value={cd.transfer_pricing_amount || ""}
                   onChange={(e) => setCtx({ transfer_pricing_amount: e.target.value })}
                   required />
          </Field>
          <Field label={lbl("Moneda", "Currency")}>
            <input className="input mono-sm" value={cd.transfer_pricing_currency || "USD"}
                   onChange={(e) => setCtx({ transfer_pricing_currency: e.target.value.toUpperCase().slice(0,3) })}
                   maxLength={3} />
          </Field>
          <Field label={lbl("Base", "Basis")}>
            <select className="input" value={cd.transfer_pricing_basis || "PER_UNIT"}
                    onChange={(e) => setCtx({ transfer_pricing_basis: e.target.value })}>
              <option value="PER_UNIT">{lbl("Por unidad", "Per unit")}</option>
              <option value="TOTAL">{lbl("Total", "Total")}</option>
              <option value="COST_PLUS">Cost plus</option>
              <option value="RESALE_MINUS">Resale minus</option>
              <option value="CUP">CUP (Comparable)</option>
            </select>
          </Field>
        </div>
        <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Field label={lbl("BL / AWB / Tracking", "BL / AWB / Tracking")}>
            <input className="input mono-sm" value={cd.awb_bl_number || ""}
                   onChange={(e) => setCtx({ awb_bl_number: e.target.value })} />
          </Field>
          <label style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 24 }}>
            <input type="checkbox" checked={!!cd.crosses_border}
                   onChange={(e) => setCtx({ crosses_border: e.target.checked })} />
            <span className="caption" style={{ color: "#0B1E3A", fontWeight: 600 }}>
              {lbl("Cruza frontera (requiere DUA)", "Crosses border (DUA required)")}
            </span>
          </label>
        </div>
        {tp > 0 && (
          <div className="caption" style={{ color: "#00B286", fontWeight: 600, marginTop: 10 }}>
            ✓ {lbl(
              "Transferencia quedará en estado PLANNED hasta aprobación de Transfer Pricing.",
              "Transfer will stay in PLANNED until Transfer Pricing is approved."
            )}
          </div>
        )}
      </div>
    );
  }

  if (legalContext === "CONSIGNMENT") {
    return (
      <div style={{ marginTop: 22, padding: 18, border: "1px solid rgba(180,83,9,0.3)", borderRadius: 12, background: "rgba(180,83,9,0.04)" }}>
        <div className="micro" style={{ color: "#B45309", letterSpacing: 1, marginBottom: 12 }}>
          {lbl("CONSIGNACIÓN", "CONSIGNMENT")}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Field label={lbl("Frecuencia de reporte", "Report frequency")}>
            <select className="input" value={cd.report_frequency || "WEEKLY"}
                    onChange={(e) => setCtx({ report_frequency: e.target.value })}>
              <option value="WEEKLY">{lbl("Semanal", "Weekly")}</option>
              <option value="BIWEEKLY">{lbl("Quincenal", "Biweekly")}</option>
              <option value="MONTHLY">{lbl("Mensual", "Monthly")}</option>
              <option value="ON_DEMAND">{lbl("Bajo demanda", "On demand")}</option>
            </select>
          </Field>
          <Field label={lbl("Referencia de contrato", "Contract ref")}>
            <input className="input mono-sm" value={cd.contract_ref || ""}
                   onChange={(e) => setCtx({ contract_ref: e.target.value })}
                   placeholder="CONS-2026-001" />
          </Field>
          <Field label={lbl("BL / AWB / Tracking", "BL / AWB / Tracking")}>
            <input className="input mono-sm" value={cd.awb_bl_number || ""}
                   onChange={(e) => setCtx({ awb_bl_number: e.target.value })} />
          </Field>
        </div>
        <div className="caption" style={{ color: "var(--text-tertiary)", marginTop: 8 }}>
          {lbl(
            "La propiedad NO se transfiere. El distribuidor reporta consumo según la frecuencia indicada.",
            "Ownership is RETAINED. The receiver reports consumption per the indicated frequency."
          )}
        </div>
      </div>
    );
  }

  return null;
}

// ═════════════════════════════════════════════════════════════
// HELPERS
// ═════════════════════════════════════════════════════════════
// Adapta el shape de /api/stock/ al shape del wizard.
//   producto_sku → sku
//   producto_nombre → product_label
//   talla → size
//   cantidad_disponible → qty_disponible
//   costo_unitario_usd → unit_cost
function adaptStockRow(r) {
  return {
    id:            r.id || `${r.producto_id}-${r.lote || ""}-${r.nodo_id}`,
    sku:           r.producto_sku || r.sku || "",
    producto_id:   r.producto_id || null,
    product_label: r.producto_nombre || r.producto_sku || "",
    size:          r.talla || r.size || "",
    lote:          r.lote || "",
    qty_disponible: Number(r.cantidad_disponible || 0),
    qty_reservada: Number(r.cantidad_reservada || 0),
    unit_cost:     Number(r.costo_unitario_usd || r.costo_actual_usd || 0),
    nodo_id:       r.nodo_id,
    nodo_codigo:   r.nodo_codigo || r.nodo_nombre || "",
    _raw:          r,
  };
}

function hasCap(node, cap) {
  const arr = node?.capabilities || [];
  if (!Array.isArray(arr) || arr.length === 0) {
    // Compat con seeds viejos sin capabilities — permitir todo
    return true;
  }
  return arr.map((c) => String(c).toUpperCase()).includes(cap);
}

function labelForKind(catalog, kind) {
  return catalog.find((k) => k.codigo === kind)?.label || kind;
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

function Field({ label, children }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{
        display: "block", fontSize: 11, fontWeight: 700,
        color: "var(--text-tertiary)", letterSpacing: 0.4,
        textTransform: "uppercase", marginBottom: 6,
      }}>{label}</span>
      {children}
    </label>
  );
}

function SummaryBox({ title, children }) {
  return (
    <div style={{ border: "1px solid var(--border, #E1E6ED)", borderRadius: 12, padding: 16 }}>
      <div className="micro" style={{ color: "#00B286", fontWeight: 700, letterSpacing: 1, marginBottom: 10 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({ k, v }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px dashed #F1F4F9" }}>
      <span className="caption" style={{ color: "var(--text-tertiary)" }}>{k}</span>
      <span style={{ color: "#0B1E3A" }}>{v}</span>
    </div>
  );
}
