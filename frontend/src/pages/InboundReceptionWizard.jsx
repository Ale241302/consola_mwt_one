// =====================================================================
// InboundReceptionWizard.jsx — Motor de Recepción de Inventario
// Sprint Inbound Engine v1 · 2026-04-29
// Agente responsable: [AG-FRONTEND]
//
// Ruta: /inventario/recepcion
//
// Reemplaza el modal viejo de "Recibir Lote" con un wizard full-page
// de 3 pasos:
//   Paso 1 · Contexto + Documento de soporte (Dropzone con OCR IA)
//   Paso 2 · Reconciliación de líneas (grid editable, gaps en rojo,
//            justificación obligatoria por línea con faltante)
//   Paso 3 · Confirmación de ingreso (resumen + botón masivo)
//
// Design tokens MWT: Navy #0B1E3A, Mint #00B286, tabular-nums.
// POL_VISIBILIDAD: el costo unitario USD se enmascara para no-CEO
// (lo decide el backend; el front sólo muestra lo que reciba).
// =====================================================================
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  IconArrow, IconCheck, IconX, IconUpload, IconWarehouse, IconAlert,
  IconSparkle, IconFileText, IconPackage, IconTruck, IconRefresh,
  IconTrash,
} from "../lib/icons.jsx";
import {
  nodosApi, proveedoresApi, transferenciasApi, productosApi,
  inboundApi, tallasApi, currencyCatApi, nodoAssignmentsApi,
} from "../lib/api.js";
// Sprint 2026-05-11 · Fase 3 · sourceType="EXPEDIENTE_ASSIGN" usa este
// paso 2 alternativo en vez del Step2Reconcile legacy.
import Step2ExpedientesAssign from "../components/inventario/Step2ExpedientesAssign.jsx";

// ─── Tipos de origen del inbound (alineado con SQL source_type_cat) ─
// Sprint 2026-05-11 · Fase 3 · Se agrega EXPEDIENTE_ASSIGN: el operador
// asigna líneas (producto, talla, qty) de uno o más expedientes al nodo
// destino. Activa un paso 2 distinto al legacy (Step2ExpedientesAssign).
const SOURCE_TYPES = [
  { v: "EXPEDIENTE_ASSIGN", l_es: "Desde expediente(s)",
                            l_en: "From expediente(s)",         color: "#0E8A6D" },
  { v: "SUPPLIER_PO",   l_es: "Orden de compra a proveedor",
                        l_en: "Supplier PO",                color: "#3083FE" },
  { v: "TRANSFER_IN",   l_es: "Transferencia entrante",
                        l_en: "Inbound transfer",           color: "#481EE3" },
  { v: "BLIND_RECEIPT", l_es: "Ajuste ciego (sin documento)",
                        l_en: "Blind receipt",              color: "#B45309" },
  { v: "RETURN",        l_es: "Devolución / RMA",
                        l_en: "Return / RMA",               color: "#10B981" },
];

// ─── Stepper visual reutilizable ───────────────────────────────────
function Stepper({ step, lang }) {
  const items = lang === "es"
    ? ["Contexto", "Reconciliación", "Confirmar"]
    : ["Context",  "Reconcile",      "Confirm"];
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "24px 0 18px" }}>
      {items.map((label, i) => {
        const idx = i + 1;
        const done = step > idx;
        const active = step === idx;
        return (
          <React.Fragment key={i}>
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "8px 14px", borderRadius: 999,
              background: done ? "#00B286" : active ? "rgba(0,178,134,0.10)" : "rgba(11,30,58,0.05)",
              color:      done ? "white" : active ? "#0B1E3A" : "var(--text-tertiary)",
              border:     done ? "none" : active ? "1.5px solid #00B286" : "1px solid var(--border-subtle)",
              fontWeight: 700, fontSize: 12, letterSpacing: 0.4,
              textTransform: "uppercase",
            }}>
              <span style={{
                width: 22, height: 22, borderRadius: "50%",
                background: done ? "rgba(255,255,255,0.25)" : active ? "#00B286" : "rgba(11,30,58,0.10)",
                color:      done || active ? "white" : "var(--text-tertiary)",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                fontSize: 11,
              }}>
                {done ? <IconCheck size={11}/> : idx}
              </span>
              {label}
            </div>
            {i < items.length - 1 && (
              <div style={{
                flex: "0 0 24px", height: 2,
                background: step > idx ? "#00B286" : "var(--border-subtle)",
              }}/>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── Página principal ──────────────────────────────────────────────
export default function InboundReceptionWizard() {
  const navigate = useNavigate();
  const { lang = "es" } = useOutletContext() || {};
  const [step, setStep] = useState(1);

  // ── Estado paso 1: contexto ────────────────────────────────────
  const [destinationNode, setDestinationNode]   = useState(null);
  const [sourceType, setSourceType]             = useState("SUPPLIER_PO");
  const [reference, setReference]               = useState(null);  // {id, label}
  const [supportFile, setSupportFile]           = useState(null);
  const [ocrPayload, setOcrPayload]             = useState(null);
  const [ocrLoading, setOcrLoading]             = useState(false);
  const [ocrError, setOcrError]                 = useState(null);

  // ── Estado paso 2: líneas ──────────────────────────────────────
  const [lines, setLines] = useState([]);
  // Sprint 2026-05-11 · Fase 3 · sourceType="EXPEDIENTE_ASSIGN".
  // El paso 2 alternativo (Step2ExpedientesAssign) reporta su array de
  // items listos para bulk-insert en `inventario.expediente_nodo_assignment`.
  const [assignItems, setAssignItems] = useState([]);
  const [assignValid, setAssignValid] = useState(false);

  // ── Estado paso 3 / submit ────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  // ── Catálogos cargados ─────────────────────────────────────────
  const [nodos, setNodos] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [productos, setProductos] = useState([]);
  // Mapa { uuid_talla → label } del Motor de Tallas, para resolver
  // los IDs guardados en producto.tallas a etiquetas humanas (43, M, …).
  const [sizingMap, setSizingMap] = useState({});
  // Cache de tallas asignadas por producto.id (lleno cuando el usuario
  // escoge un SKU). Estructura: { producto_id: [labels...] }
  const [tallasByProducto, setTallasByProducto] = useState({});
  // Catálogo de monedas (ISO 4217 — pricing.currency_cat seeded en BD).
  // [{codigo, nombre, symbol}]
  const [currencies, setCurrencies] = useState([
    { codigo: "USD", nombre: "US Dollar", symbol: "$" },
  ]);

  // Cargar catálogos
  useEffect(() => {
    nodosApi.list({ is_active: "true", limit: 200 })
      .then((d) => {
        const arr = Array.isArray(d) ? d : (d?.results || []);
        // Solo nodos con capability RECEIVE
        const filtered = arr.filter((n) => {
          const caps = (n.capabilities || []).map((c) => String(c).toUpperCase());
          return caps.length === 0 || caps.includes("RECEIVE");
        });
        setNodos(filtered);
      })
      .catch(() => setNodos([]));
    proveedoresApi.list({ is_active: "true", limit: 200 })
      .then((d) => setProveedores(Array.isArray(d) ? d : (d?.results || [])))
      .catch(() => setProveedores([]));
    productosApi.list({ is_active: "true", limit: 500 })
      .then((d) => setProductos(Array.isArray(d) ? d : (d?.results || [])))
      .catch(() => setProductos([]));
    // Catálogo del Motor de Tallas — uuid → label
    tallasApi.list({ limit: 500 })
      .then((d) => {
        const arr = Array.isArray(d) ? d : (d?.results || []);
        const m = {};
        for (const sz of arr) {
          const label = sz.talla_base || sz.eu || sz.us_men || sz.nombre || sz.codigo || "—";
          m[String(sz.id)] = label;
        }
        setSizingMap(m);
      })
      .catch(() => setSizingMap({}));
    // Catálogo de monedas (ISO 4217)
    currencyCatApi.list({ is_active: "true" })
      .then((d) => {
        const arr = Array.isArray(d) ? d : (d?.results || []);
        if (arr.length > 0) setCurrencies(arr);
      })
      .catch(() => { /* mantén el default USD */ });
  }, []);

  // ── Resolver tallas asignadas a un producto (lazy + cached) ──
  const resolveProductSizes = useCallback(async (productoId) => {
    if (!productoId) return [];
    if (tallasByProducto[productoId]) return tallasByProducto[productoId];
    try {
      const full = await productosApi.get(productoId);
      const ids  = Array.isArray(full?.tallas) ? full.tallas : [];
      const labels = [];
      for (const t of ids) {
        if (typeof t === "object" && t) {
          const lbl = t.talla_base || t.eu || t.us_men || t.codigo || t.nombre;
          if (lbl) labels.push(lbl);
        } else {
          const lbl = sizingMap[String(t)];
          if (lbl) labels.push(lbl);
        }
      }
      const dedup = Array.from(new Set(labels));
      const out = dedup.length ? dedup : ["ÚNICA"];
      setTallasByProducto((p) => ({ ...p, [productoId]: out }));
      return out;
    } catch {
      return ["ÚNICA"];
    }
  }, [sizingMap, tallasByProducto]);

  // Cargar transferencias en tránsito al cambiar a TRANSFER_IN
  useEffect(() => {
    if (sourceType !== "TRANSFER_IN") return;
    transferenciasApi.list({ estado: "EN_TRANSITO", limit: 50 })
      .then((d) => setTransfers(Array.isArray(d) ? d : (d?.results || [])))
      .catch(() => setTransfers([]));
  }, [sourceType]);

  // ── OCR file handler ──────────────────────────────────────────
  const handleFileSelected = async (file) => {
    if (!file) return;
    setSupportFile(file);
    setOcrError(null);
    setOcrPayload(null);
    setOcrLoading(true);
    try {
      const data = await inboundApi.ocrReceipt(file);
      setOcrPayload(data);
      // Pre-popular líneas
      const ocrLines = (data?.lines || []).map((l, idx) => ({
        _key:            `ocr-${idx}-${l.product_sku || idx}`,
        product_sku:     (l.product_sku || "").toUpperCase().trim(),
        product_label:   l.product_label || "",
        producto_id:     l.producto_id || null,
        talla:           (l.talla || "").toUpperCase().trim(),
        lote_code:       l.lote_code || "",
        expiration_date: l.expiration_date || "",
        expected_qty:    Number(l.expected_qty || 0),
        received_qty:    Number(l.expected_qty || 0),  // arranca = expected
        unit_cost_usd:   l.unit_cost_usd ?? null,
        gap_justification: "",
        source:          "OCR_PL",
        ocr_confidence:  l.confidence || 80,
      }));
      setLines(ocrLines);
    } catch (e) {
      setOcrError(e?.body?.detail || e?.message || "OCR falló");
    } finally {
      setOcrLoading(false);
    }
  };

  const removeFile = () => {
    setSupportFile(null);
    setOcrPayload(null);
    setOcrError(null);
    setLines([]);
  };

  // ── Líneas helpers ────────────────────────────────────────────
  // Sprint Inbound v3 (2026-04-30):
  //   · Cada línea es ahora (producto, talla, qty, moneda, costo).
  //   · Se elimina lote_code (no aplica al inbound; el sistema asigna
  //     LOT-<YYYYMMDD>-<recepcion_codigo> automáticamente al persistir).
  //   · Se reemplaza expected_qty/received_qty por una sola `qty` —
  //     decisión de negocio: el inbound es "lo que llega", no hay
  //     reconciliación contra orden esperada en este flujo.
  //   · Currency default USD pero editable por línea.
  const addBlankLine = () => {
    setLines((prev) => [...prev, {
      _key: `manual-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
      product_sku: "", product_label: "", producto_id: null,
      talla: "", lote_code: "", expiration_date: "",
      qty: 0,
      // Compat: el backend aún lee expected_qty/received_qty.
      expected_qty: 0, received_qty: 0,
      currency: "USD",
      unit_cost: null, unit_cost_usd: null, gap_justification: "",
      source: "MANUAL", ocr_confidence: null,
    }]);
  };
  const updateLine = (key, patch) => {
    setLines((prev) => prev.map((l) => l._key === key ? { ...l, ...patch } : l));
  };
  const removeLine = (key) => {
    setLines((prev) => prev.filter((l) => l._key !== key));
  };

  // ── Validaciones ──────────────────────────────────────────────
  // Sprint 2026-05-11 · CEO pide que el proveedor / referencia NO sea
  // obligatorio en el paso 1. Antes la regla era:
  //   (sourceType === "BLIND_RECEIPT" || !!reference || sourceType === "RETURN")
  // que forzaba a elegir proveedor en SUPPLIER_PO o transferencia en
  // TRANSFER_IN. Ahora el paso 1 sólo exige nodo destino + tipo de origen;
  // la referencia queda como input opcional que se rellena si el operador
  // tiene la info a mano. El selector de proveedor sigue visible — sólo
  // dejó de bloquear el avance al paso 2.
  const step1Valid = !!destinationNode && !!sourceType;
  // Para el nuevo flow EXPEDIENTE_ASSIGN la validez del paso 2 viene del
  // sub-componente (basta con que haya >=1 item con qty>0).
  const isExpedienteAssign = sourceType === "EXPEDIENTE_ASSIGN";
  const linesWithGap = lines.filter((l) =>
    Number(l.received_qty || 0) < Number(l.expected_qty || 0)
  );
  const gapsNeedingJustif = linesWithGap.filter((l) => !((l.gap_justification || "").trim()));
  const step2Valid = lines.length > 0
                     && lines.every((l) =>
                          l.product_sku
                          && Number(l.qty || l.received_qty || 0) > 0
                       )
                     && gapsNeedingJustif.length === 0;

  // ── Métricas paso 3 ───────────────────────────────────────────
  // Sprint Inbound v3: sin "expected" — el inbound es "lo que llegó".
  // Mantenemos `expected` y `received` por compat con el render legacy
  // (el resumen ahora muestra agrupación por producto+talla y por
  // moneda, no el delta esperado vs recibido).
  const totals = useMemo(() => {
    const received = lines.reduce(
      (a, l) => a + Number(l.qty || l.received_qty || 0), 0
    );
    // Valorización USD: suma costo×qty SOLO de las líneas con currency=USD.
    // Para multi-moneda el resumen tiene un breakdown dedicado en Step3.
    const value = lines.reduce((a, l) => {
      const isUsd = (l.currency || "USD") === "USD";
      if (!isUsd) return a;
      const cost = Number(l.unit_cost ?? l.unit_cost_usd ?? 0);
      return a + (cost * Number(l.qty || l.received_qty || 0));
    }, 0);
    return {
      expected: received,            // alias para legacy
      received,
      delta: 0,
      value_usd: value,
      gap_count: linesWithGap.length,
    };
  }, [lines, linesWithGap.length]);

  // ── Submit final ──────────────────────────────────────────────
  // Sprint 2026-05-11 · Fase 3 · Si sourceType=EXPEDIENTE_ASSIGN
  // mandamos un bulk-create a /api/inventario/nodo-assignments/bulk/
  // — un POST atómico que valida over-assignment del lado backend.
  // En cualquier otro caso seguimos el flow legacy de inboundApi.receive.
  const submit = async () => {
    if (submitting) return;
    if (isExpedienteAssign) {
      if (!assignValid) return;
    } else {
      if (!step2Valid) return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (isExpedienteAssign) {
        await nodoAssignmentsApi.bulkCreate({
          // recepcion_id queda null — esta recepción no genera un row en
          // inventario.recepcion (no hay líneas físicas, sólo asignaciones).
          // Si en el futuro queremos vincularlas, creamos primero el
          // recepcion via inboundApi.receive y pasamos su id aquí.
          recepcion_id: null,
          items: assignItems,
        });
        navigate("/inventario", { state: {
          assigned: true,
          count: assignItems.length,
          nodeId: destinationNode?.id,
        }});
        return;
      }
      const payload = {
        destination_node_id:    destinationNode?.id,
        destination_node_label: destinationNode?.codigo || destinationNode?.nombre || "",
        source_type:            sourceType,
        reference_id:           reference?.id || null,
        reference_label:        reference?.label || "",
        ocr_payload_json:       ocrPayload || null,
        ocr_confidence_avg:     ocrPayload?.confidence_avg || null,
        lines: lines.map((l) => ({
          producto_id:       l.producto_id,
          product_sku:       l.product_sku,
          product_label:     l.product_label,
          talla:             l.talla,
          lote_code:         l.lote_code,
          expiration_date:   l.expiration_date || null,
          expected_qty:      Number(l.expected_qty || 0),
          received_qty:      Number(l.received_qty || 0),
          unit_cost_usd:     l.unit_cost_usd,
          gap_justification: l.gap_justification || null,
          source:            l.source,
          ocr_confidence:    l.ocr_confidence,
        })),
      };
      const r = await inboundApi.receive(payload);
      navigate("/inventario", { state: { receivedId: r.id, codigo: r.codigo } });
    } catch (e) {
      setSubmitError(e?.body?.detail || e?.message || "Error al confirmar la recepción");
    } finally {
      setSubmitting(false);
    }
  };

  // ─────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: "24px 28px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: "linear-gradient(135deg, #0B1E3A 0%, #1F3A66 100%)",
          color: "white", display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <IconWarehouse size={20}/>
        </div>
        <div style={{ flex: 1 }}>
          <div className="micro" style={{ color: "var(--text-tertiary)", letterSpacing: 1.2 }}>
            {lang === "es" ? "INVENTARIO · MOTOR DE RECEPCIÓN" : "INVENTORY · INBOUND ENGINE"}
          </div>
          <h1 style={{
            margin: "4px 0 0", fontSize: 26, fontWeight: 800,
            color: "#0B1E3A", letterSpacing: -0.5,
          }}>
            {lang === "es" ? "Recibir lote de inventario" : "Receive inventory lot"}
          </h1>
          <div className="caption" style={{ color: "var(--text-secondary)", marginTop: 4, fontSize: 13 }}>
            {lang === "es"
              ? "Sube el Packing List o Factura, deja que la IA extraiga las líneas, reconcilia faltantes y confirma el ingreso."
              : "Upload the Packing List or Invoice, let AI extract the lines, reconcile gaps and confirm receipt."}
          </div>
        </div>
        <button className="btn" onClick={() => navigate("/inventario")}>
          <IconX size={12}/> {lang === "es" ? "Cerrar" : "Close"}
        </button>
      </div>

      <Stepper step={step} lang={lang}/>

      {/* ─── PASOS ─── */}
      <AnimatePresence mode="wait">
        {step === 1 && (
          <motion.div key="step1" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.22 }}>
            <Step1Context
              lang={lang}
              nodos={nodos}
              proveedores={proveedores}
              transfers={transfers}
              destinationNode={destinationNode} setDestinationNode={setDestinationNode}
              sourceType={sourceType}           setSourceType={setSourceType}
              reference={reference}             setReference={setReference}
              supportFile={supportFile}
              onFileSelected={handleFileSelected}
              onRemoveFile={removeFile}
              ocrLoading={ocrLoading}
              ocrPayload={ocrPayload}
              ocrError={ocrError}
            />
          </motion.div>
        )}

        {step === 2 && (
          <motion.div key="step2" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.22 }}>
            {/* Sprint 2026-05-11 · Fase 3 · Si el operador eligió
                "Desde expediente(s)" en el paso 1, mostramos el nuevo
                selector multi-expediente con tabla por talla. En cualquier
                otro caso seguimos el Step2Reconcile legacy (grid editable
                manual + OCR), que también soporta talla. */}
            {isExpedienteAssign ? (
              <Step2ExpedientesAssign
                lang={lang}
                destinationNode={destinationNode}
                onItemsChange={setAssignItems}
                onValidityChange={setAssignValid}
              />
            ) : (
              <Step2Reconcile
                tallasByProducto={tallasByProducto}
                resolveProductSizes={resolveProductSizes}
                currencies={currencies}
                lang={lang}
                lines={lines}
                productos={productos}
                onUpdate={updateLine}
                onRemove={removeLine}
                onAdd={addBlankLine}
              />
            )}
          </motion.div>
        )}

        {step === 3 && (
          <motion.div key="step3" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.22 }}>
            <Step3Confirm
              lang={lang}
              destinationNode={destinationNode}
              sourceType={sourceType}
              reference={reference}
              lines={lines}
              totals={totals}
              submitting={submitting}
              submitError={submitError}
              onConfirm={submit}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Footer Nav ─── */}
      <div style={{
        display: "flex", justifyContent: "space-between", marginTop: 24,
        paddingTop: 18, borderTop: "1px solid var(--border-subtle)",
      }}>
        <button className="btn" disabled={step === 1} onClick={() => setStep((s) => Math.max(1, s - 1))}>
          ← {lang === "es" ? "Atrás" : "Back"}
        </button>
        {step < 3 ? (
          <button
            className="btn btn-accent"
            disabled={
              (step === 1 && !step1Valid) ||
              (step === 2 && !(isExpedienteAssign ? assignValid : step2Valid))
            }
            onClick={() => setStep((s) => s + 1)}
            style={{
              minWidth: 200, fontWeight: 700,
              background:
                ((step === 1 && step1Valid) ||
                 (step === 2 && (isExpedienteAssign ? assignValid : step2Valid)))
                  ? "#00B286" : "#94A3B8",
              borderColor:
                ((step === 1 && step1Valid) ||
                 (step === 2 && (isExpedienteAssign ? assignValid : step2Valid)))
                  ? "#00B286" : "#94A3B8",
            }}
          >
            {lang === "es" ? "Siguiente" : "Next"} <IconArrow size={12}/>
          </button>
        ) : (
          <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
            {lang === "es"
              ? "Revisa el resumen y confirma"
              : "Review the summary and confirm"}
          </span>
        )}
      </div>
    </div>
  );
}

// =====================================================================
// PASO 1 — Contexto + Documento de soporte (Dropzone con OCR IA)
// =====================================================================
function Step1Context({
  lang, nodos, proveedores, transfers,
  destinationNode, setDestinationNode,
  sourceType, setSourceType,
  reference, setReference,
  supportFile, onFileSelected, onRemoveFile,
  ocrLoading, ocrPayload, ocrError,
}) {
  const fileRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const onDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onFileSelected(f);
  };

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <Card title={lang === "es" ? "1. Nodo destino" : "1. Destination node"}
            subtitle={lang === "es"
              ? "Solo se listan nodos con capacidad RECEIVE."
              : "Only nodes with RECEIVE capability are listed."}>
        <select
          className="input"
          value={destinationNode?.id || ""}
          onChange={(e) => {
            const n = nodos.find((x) => String(x.id) === e.target.value);
            setDestinationNode(n || null);
          }}
        >
          <option value="">— {lang === "es" ? "Selecciona nodo" : "Select node"} —</option>
          {nodos.map((n) => (
            <option key={n.id} value={n.id}>
              {n.codigo} · {n.nombre} · {n.tipo || "—"}
            </option>
          ))}
        </select>
      </Card>

      <Card title={lang === "es" ? "2. Origen" : "2. Source"}
            subtitle={lang === "es"
              ? "De dónde proviene la mercancía que vas a recibir."
              : "Where the merchandise you are receiving comes from."}>
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10,
          marginBottom: 12,
        }}>
          {SOURCE_TYPES.map((s) => (
            <button
              key={s.v}
              type="button"
              onClick={() => { setSourceType(s.v); setReference(null); }}
              style={{
                padding: "12px 14px", borderRadius: 10,
                border: sourceType === s.v ? `2px solid ${s.color}` : "1px solid var(--border-subtle)",
                background: sourceType === s.v ? `${s.color}10` : "white",
                color: "#0B1E3A", textAlign: "left", cursor: "pointer",
                fontWeight: 600, fontSize: 13,
                display: "flex", flexDirection: "column", gap: 2,
                transition: "all 0.15s",
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.4,
                             color: sourceType === s.v ? s.color : "var(--text-secondary)" }}>
                {s.v}
              </span>
              {lang === "es" ? s.l_es : s.l_en}
            </button>
          ))}
        </div>

        {/* Selector de referencia según tipo */}
        {sourceType === "SUPPLIER_PO" && (
          <select className="input" value={reference?.id || ""} onChange={(e) => {
            const p = proveedores.find((x) => String(x.id) === e.target.value);
            setReference(p ? { id: p.id, label: `${p.nombre || p.codigo}` } : null);
          }}>
            <option value="">— {lang === "es" ? "Proveedor" : "Supplier"} —</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>{p.codigo || p.nombre} · {p.nombre}</option>
            ))}
          </select>
        )}
        {sourceType === "TRANSFER_IN" && (
          <select className="input" value={reference?.id || ""} onChange={(e) => {
            const t = transfers.find((x) => String(x.id) === e.target.value);
            setReference(t ? { id: t.id, label: t.codigo || t.id } : null);
          }}>
            <option value="">— {lang === "es" ? "Transferencia en tránsito" : "Transfer in transit"} —</option>
            {transfers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.codigo} · {t.nodo_origen_label} → {t.nodo_destino_label}
              </option>
            ))}
          </select>
        )}
        {sourceType === "BLIND_RECEIPT" && (
          <div style={{
            padding: "10px 14px", borderRadius: 8,
            background: "rgba(180,83,9,0.06)", color: "#92400E",
            border: "1px solid rgba(180,83,9,0.20)", fontSize: 13,
          }}>
            <IconAlert size={11} style={{ verticalAlign: -1, marginRight: 6 }}/>
            {lang === "es"
              ? "Ajuste ciego: ingreso sin documento previo. Quedará marcado como excepción auditada."
              : "Blind receipt: no prior document. Will be flagged as audited exception."}
          </div>
        )}
      </Card>

      <Card title={lang === "es" ? "3. Documento de soporte (Packing List · Factura)" : "3. Supporting document (Packing List · Invoice)"}
            subtitle={lang === "es"
              ? "PDF / Excel. La IA detectará SKUs, lotes, cantidades y costos."
              : "PDF / Excel. AI will extract SKUs, lots, quantities and costs."}>
        {!supportFile ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
            style={{
              border: dragOver ? "2px dashed #00B286" : "2px dashed var(--border-subtle)",
              background: dragOver ? "rgba(0,178,134,0.05)" : "rgba(11,30,58,0.02)",
              borderRadius: 14, padding: "32px 24px", textAlign: "center", cursor: "pointer",
              transition: "all 0.18s",
            }}
          >
            <input ref={fileRef} type="file" hidden
                   accept=".pdf,.xlsx,.xls,.csv,image/*"
                   onChange={(e) => onFileSelected(e.target.files?.[0])}/>
            <IconUpload size={28} style={{ color: "#00B286", marginBottom: 8 }}/>
            <div style={{ fontWeight: 700, color: "#0B1E3A", fontSize: 15, marginBottom: 2 }}>
              {lang === "es" ? "Arrastra el documento o haz clic" : "Drag the document or click"}
            </div>
            <div className="caption" style={{ color: "var(--text-tertiary)", fontSize: 12 }}>
              {lang === "es"
                ? "Formatos: PDF · Excel · CSV · Imagen · max 25 MB"
                : "Formats: PDF · Excel · CSV · Image · max 25 MB"}
            </div>
          </div>
        ) : (
          <div style={{
            border: "1px solid var(--border-subtle)", borderRadius: 12,
            padding: 14, display: "flex", alignItems: "center", gap: 12,
            background: "white",
          }}>
            <IconFileText size={18} style={{ color: "#00B286" }}/>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#0B1E3A",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {supportFile.name}
              </div>
              <div className="caption" style={{ color: "var(--text-tertiary)", fontSize: 12 }}>
                {(supportFile.size / 1024).toFixed(1)} KB
              </div>
            </div>
            <button className="btn" onClick={onRemoveFile}><IconX size={11}/></button>
          </div>
        )}

        {/* Estado OCR */}
        {ocrLoading && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            style={{
              marginTop: 14, padding: "12px 14px", borderRadius: 10,
              background: "linear-gradient(90deg, rgba(72,30,227,0.08), rgba(0,178,134,0.06))",
              border: "1px solid rgba(72,30,227,0.20)",
              display: "flex", alignItems: "center", gap: 10,
            }}>
            <motion.div animate={{ rotate: 360 }}
                        transition={{ repeat: Infinity, duration: 1.6, ease: "linear" }}>
              <IconSparkle size={14} style={{ color: "#481EE3" }}/>
            </motion.div>
            <div style={{ fontSize: 13, color: "#0B1E3A", fontWeight: 600 }}>
              {lang === "es" ? "Analizando con IA…" : "Analyzing with AI…"}
            </div>
          </motion.div>
        )}
        {ocrError && (
          <div style={{
            marginTop: 14, padding: "10px 14px", borderRadius: 8,
            background: "#FEE2E2", color: "#991B1B", border: "1px solid #FCA5A5", fontSize: 13,
          }}>
            <IconAlert size={11} style={{ verticalAlign: -1, marginRight: 6 }}/> {ocrError}
          </div>
        )}
        {ocrPayload && !ocrLoading && (
          <div style={{
            marginTop: 14, padding: "12px 14px", borderRadius: 10,
            background: "rgba(0,178,134,0.06)", border: "1px solid rgba(0,178,134,0.20)",
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <IconCheck size={14} style={{ color: "#00B286" }}/>
            <div style={{ fontSize: 13, color: "#065F46", fontWeight: 600 }}>
              {lang === "es"
                ? `IA detectó ${ocrPayload.lines?.length || 0} líneas. Continúa para reconciliar.`
                : `AI detected ${ocrPayload.lines?.length || 0} lines. Continue to reconcile.`}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

// =====================================================================
// PASO 2 — Reconciliación (Grid editable)
// =====================================================================
//
// Sprint Inbound v3 (2026-04-30):
// Columnas: PRODUCTO (SKU autocomplete + descripción + talla SELECT) ·
//           VENCIMIENTO · CANTIDAD · MONEDA · COSTO · trash
// Eliminadas: LOTE (la asigna el sistema) · ESP (no aplica al inbound;
//             es "lo que llegó", no "lo que se esperaba").
// =====================================================================
function Step2Reconcile({
  lang, lines, productos, onUpdate, onRemove, onAdd,
  tallasByProducto = {}, resolveProductSizes = async () => [],
  currencies = [{ codigo: "USD", nombre: "US Dollar", symbol: "$" }],
}) {
  return (
    <Card title={lang === "es" ? "Líneas detectadas" : "Detected lines"}
          subtitle={lang === "es"
            ? "Cada línea es un (SKU, talla, cantidad). Si la fábrica recortó, ajusta la cantidad y registra justificación al final."
            : "Each line is a (SKU, size, qty). If the factory cut, adjust the qty and add a justification at the end."}>
      <div style={{ overflowX: "auto", border: "1px solid var(--border-subtle)", borderRadius: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, tableLayout: "fixed" }}>
          <colgroup>
            <col/>{/* Producto */}
            <col style={{ width: 140 }}/>{/* Vencimiento */}
            <col style={{ width: 110 }}/>{/* Cantidad */}
            <col style={{ width: 110 }}/>{/* Moneda */}
            <col style={{ width: 120 }}/>{/* Costo */}
            <col style={{ width: 50 }}/>{/* Trash */}
          </colgroup>
          <thead>
            <tr style={{ background: "rgba(11,30,58,0.04)" }}>
              <th style={th}>{lang === "es" ? "Producto" : "Product"}</th>
              <th style={th}>{lang === "es" ? "Vencimiento" : "Exp. date"}</th>
              <th style={{ ...th, textAlign: "right" }}>{lang === "es" ? "Cantidad" : "Qty"}</th>
              <th style={{ ...th, textAlign: "center" }}>{lang === "es" ? "Moneda" : "Currency"}</th>
              <th style={{ ...th, textAlign: "right" }}>{lang === "es" ? "Costo" : "Cost"}</th>
              <th style={th}/>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && (
              <tr>
                <td colSpan={6} style={{ ...td, textAlign: "center", color: "var(--text-tertiary)", padding: 24 }}>
                  {lang === "es"
                    ? "No hay líneas. Agrega manualmente con el botón debajo."
                    : "No lines yet. Add manually with the button below."}
                </td>
              </tr>
            )}
            {lines.map((l) => {
              const qty = Number(l.qty || l.received_qty || 0);
              return (
                <tr key={l._key} style={{
                  borderTop: "1px solid var(--border-subtle)",
                  background: "white",
                }}>
                  <td style={td}>
                    <ProductAutocomplete
                      lang={lang}
                      value={l.product_sku}
                      label={l.product_label}
                      productos={productos}
                      onPick={async (p) => {
                        onUpdate(l._key, {
                          product_sku:   p ? (p.sku || "") : "",
                          producto_id:   p?.id || null,
                          product_label: p?.nombre || "",
                          // Reset talla cuando cambia el producto
                          talla: "",
                        });
                        if (p?.id) await resolveProductSizes(p.id);
                      }}
                    />
                    {/* Talla SELECT poblada con las tallas del producto. */}
                    {(() => {
                      const sizes = (l.producto_id && tallasByProducto[l.producto_id]) || null;
                      if (sizes && sizes.length > 0) {
                        return (
                          <select
                            className="input mono-sm"
                            style={{ fontSize: 11, marginTop: 6, maxWidth: 140 }}
                            value={l.talla || ""}
                            onChange={(e) => onUpdate(l._key, { talla: e.target.value.toUpperCase() })}
                          >
                            <option value="">— {lang === "es" ? "Talla" : "Size"} —</option>
                            {sizes.map((s) => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        );
                      }
                      // Sin producto resuelto → input free como fallback
                      return (
                        <input
                          className="input mono-sm"
                          style={{ fontSize: 11, marginTop: 6, maxWidth: 140 }}
                          value={l.talla}
                          placeholder={lang === "es" ? "Talla" : "Size"}
                          onChange={(e) => onUpdate(l._key, { talla: e.target.value.toUpperCase() })}
                          disabled={!l.producto_id}
                        />
                      );
                    })()}
                  </td>
                  <td style={td}>
                    <input
                      type="date"
                      className="input mono-sm"
                      value={l.expiration_date || ""}
                      onChange={(e) => onUpdate(l._key, { expiration_date: e.target.value })}
                    />
                  </td>
                  <td style={{ ...td, textAlign: "right" }} className="tabular-nums">
                    <input
                      type="number" min={0}
                      className="input mono-sm"
                      style={{ width: "100%", textAlign: "right", fontWeight: 700 }}
                      value={qty}
                      onChange={(e) => {
                        const v = Number(e.target.value) || 0;
                        // Mantener compat con backend: setea también
                        // expected_qty/received_qty al mismo valor.
                        onUpdate(l._key, { qty: v, expected_qty: v, received_qty: v });
                      }}
                    />
                  </td>
                  <td style={{ ...td, textAlign: "center" }}>
                    <select
                      className="input mono-sm"
                      style={{ width: "100%", textAlign: "center" }}
                      value={l.currency || "USD"}
                      onChange={(e) => onUpdate(l._key, { currency: e.target.value })}
                    >
                      {currencies.map((c) => (
                        <option key={c.codigo} value={c.codigo}>
                          {c.symbol ? `${c.symbol} ` : ""}{c.codigo}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={{ ...td, textAlign: "right" }} className="tabular-nums">
                    <input
                      type="number" min={0} step="0.01"
                      className="input mono-sm"
                      style={{ width: "100%", textAlign: "right" }}
                      value={l.unit_cost ?? l.unit_cost_usd ?? ""}
                      placeholder="0.00"
                      onChange={(e) => {
                        const v = e.target.value === "" ? null : Number(e.target.value);
                        // Mantener compat con backend que aún lee
                        // unit_cost_usd; si la moneda es USD, lo refleja.
                        const isUsd = (l.currency || "USD") === "USD";
                        onUpdate(l._key, {
                          unit_cost: v,
                          unit_cost_usd: isUsd ? v : (l.unit_cost_usd ?? null),
                        });
                      }}
                    />
                  </td>
                  <td style={td}>
                    <button className="btn btn-ghost btn-sm"
                            onClick={() => onRemove(l._key)}
                            title={lang === "es" ? "Quitar línea" : "Remove line"}
                            style={{ color: "#D64545", padding: "6px 8px" }}>
                      <IconTrash size={13}/>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
        <button className="btn" onClick={onAdd}>
          + {lang === "es" ? "Agregar línea manual" : "Add manual line"}
        </button>
        <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
          {lang === "es"
            ? `${lines.length} líneas`
            : `${lines.length} lines`}
        </div>
      </div>
    </Card>
  );
}

// ─── Autocomplete de producto (SKU o nombre) ───────────────────────
// Busca en /api/productos/?q=<texto> en cuanto el usuario teclea ≥ 2
// caracteres. Renderiza un dropdown con SKU + nombre + marca (si hay
// stock asignado) y sustituye el valor por (sku, nombre, id) al pick.
function ProductAutocomplete({ lang, value, label, productos, onPick }) {
  const [search, setSearch]   = useState(value || "");
  const [open, setOpen]       = useState(false);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => { setSearch(value || ""); }, [value]);

  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) { setResults([]); return; }
    setSearching(true);
    // Hit el endpoint real (busca en sku + nombre + descripcion).
    productosApi.list({ q, limit: 12 })
      .then((d) => {
        const arr = Array.isArray(d) ? d : (d?.results || []);
        setResults(arr.slice(0, 12));
      })
      .catch(() => setResults([]))
      .finally(() => setSearching(false));
  }, [search]);

  return (
    <div style={{ position: "relative" }}>
      <input
        className="input mono-sm"
        style={{ marginBottom: 4 }}
        value={search}
        placeholder={lang === "es" ? "Buscar SKU o nombre…" : "Search SKU or name…"}
        onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {label && (
        <div className="caption" style={{
          fontSize: 11, color: "var(--text-secondary)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{label}</div>
      )}
      {open && search.trim().length >= 2 && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10,
          background: "white", border: "1px solid var(--border-subtle)",
          borderRadius: 8, marginTop: 2, maxHeight: 240, overflowY: "auto",
          boxShadow: "0 8px 24px -8px rgba(15,27,61,0.18)",
        }}>
          {searching && (
            <div className="caption" style={{
              padding: "8px 12px", color: "var(--text-tertiary)", fontSize: 12,
            }}>
              {lang === "es" ? "Buscando…" : "Searching…"}
            </div>
          )}
          {!searching && results.length === 0 && (
            <div className="caption" style={{
              padding: "8px 12px", color: "var(--text-tertiary)", fontSize: 12,
              textAlign: "center",
            }}>
              {lang === "es" ? "Sin resultados" : "No results"}
            </div>
          )}
          {results.map((p) => (
            <button
              key={p.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onPick(p); setOpen(false); }}
              style={{
                width: "100%", textAlign: "left", border: 0,
                padding: "8px 12px", background: "white",
                cursor: "pointer", display: "flex",
                flexDirection: "column", gap: 2,
                borderBottom: "1px solid var(--border-subtle)",
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = "rgba(48,131,254,0.05)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "white"}
            >
              <span className="mono-sm" style={{ fontWeight: 700, color: "#0B1E3A", fontSize: 12 }}>
                {p.sku || "—"}
              </span>
              <span className="caption" style={{ fontSize: 11, color: "var(--text-tertiary)",
                                                 overflow: "hidden", textOverflow: "ellipsis",
                                                 whiteSpace: "nowrap" }}>
                {p.nombre || ""}
                {p.marca_nombre ? ` · ${p.marca_nombre}` : ""}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// =====================================================================
// PASO 3 — Confirmación
// =====================================================================
function Step3Confirm({ lang, destinationNode, sourceType, reference, lines,
                       totals, submitting, submitError, onConfirm }) {
  const sType = SOURCE_TYPES.find((s) => s.v === sourceType);

  // ── Agrupación por producto + breakdown por talla y por moneda ──
  // Sprint Inbound v3: el resumen muestra exactamente qué llega:
  //   · Cada producto con sus tallas (cantidad por talla)
  //   · Total por moneda (no asume USD)
  const byProduct = useMemo(() => {
    const map = new Map();
    for (const l of lines) {
      const key = l.producto_id || l.product_sku || "—";
      const prev = map.get(key) || {
        producto_id:   l.producto_id || null,
        sku:           l.product_sku || "",
        product_label: l.product_label || "",
        sizes: {},          // { talla: qty }
        total_qty: 0,
      };
      const qty = Number(l.qty || l.received_qty || 0);
      const talla = (l.talla || "ÚNICA").toUpperCase();
      prev.sizes[talla] = (prev.sizes[talla] || 0) + qty;
      prev.total_qty += qty;
      map.set(key, prev);
    }
    return Array.from(map.values());
  }, [lines]);

  const byCurrency = useMemo(() => {
    const map = new Map();
    for (const l of lines) {
      const cur = (l.currency || "USD").toUpperCase();
      const cost = Number(l.unit_cost ?? l.unit_cost_usd ?? 0);
      const qty  = Number(l.qty || l.received_qty || 0);
      const prev = map.get(cur) || { currency: cur, total_value: 0, lines: 0 };
      prev.total_value += cost * qty;
      prev.lines += 1;
      map.set(cur, prev);
    }
    return Array.from(map.values());
  }, [lines]);

  return (
    <div style={{ display: "grid", gap: 18 }}>
      {/* Resumen tile */}
      <div style={{
        background: "linear-gradient(135deg, #0B1E3A 0%, #1F3A66 100%)",
        color: "white", borderRadius: 16, padding: 24,
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 18,
      }}>
        <Tile label={lang === "es" ? "Líneas" : "Lines"} value={lines.length}/>
        <Tile label={lang === "es" ? "Productos" : "Products"} value={byProduct.length}/>
        <Tile label={lang === "es" ? "Unidades totales" : "Total units"}
              value={totals.received.toLocaleString()}
              accent="#86EFAC"/>
        <Tile label={lang === "es" ? "Monedas" : "Currencies"} value={byCurrency.length}/>
      </div>

      {/* Contexto */}
      <Card title={lang === "es" ? "Contexto" : "Context"}>
        <Row k={lang === "es" ? "Nodo destino" : "Destination node"}
             v={destinationNode ? `${destinationNode.codigo} · ${destinationNode.nombre}` : "—"}/>
        <Row k={lang === "es" ? "Tipo de origen" : "Source type"}
             v={sType ? (lang === "es" ? sType.l_es : sType.l_en) : sourceType}/>
        {reference && (
          <Row k={lang === "es" ? "Referencia" : "Reference"} v={reference.label}/>
        )}
      </Card>

      {/* Productos con desglose por talla */}
      <Card title={lang === "es" ? "Productos por talla" : "Products by size"}
            subtitle={lang === "es"
              ? "Cantidad que se sumará al stock del nodo, granularidad (producto, talla)."
              : "Quantity to be added to node stock, granularity (product, size)."}>
        <div style={{
          border: "1px solid var(--border-subtle)", borderRadius: 10, overflow: "hidden",
        }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "rgba(11,30,58,0.04)" }}>
                <th style={{ ...th, textAlign: "left" }}>SKU</th>
                <th style={{ ...th, textAlign: "left" }}>{lang === "es" ? "Producto" : "Product"}</th>
                <th style={{ ...th, textAlign: "left" }}>{lang === "es" ? "Tallas" : "Sizes"}</th>
                <th style={{ ...th, textAlign: "right" }}>{lang === "es" ? "Total" : "Total"}</th>
              </tr>
            </thead>
            <tbody>
              {byProduct.map((p) => (
                <tr key={p.producto_id || p.sku}
                    style={{ borderTop: "1px solid var(--border-subtle)" }}>
                  <td style={td}>
                    <span className="mono-sm" style={{ fontWeight: 700, color: "#0B1E3A" }}>
                      {p.sku || "—"}
                    </span>
                  </td>
                  <td style={td}>{p.product_label || "—"}</td>
                  <td style={td}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {Object.entries(p.sizes).map(([t, q]) => (
                        <span key={t} style={{
                          display: "inline-flex", alignItems: "center", gap: 4,
                          padding: "2px 8px", borderRadius: 999,
                          background: "rgba(72,30,227,0.08)", color: "#481EE3",
                          fontSize: 11, fontWeight: 700, fontFamily: "var(--font-mono)",
                        }}>
                          {t}
                          <span style={{
                            background: "white", color: "#0B1E3A",
                            padding: "0 5px", borderRadius: 4, fontSize: 10,
                          }}>{q}</span>
                        </span>
                      ))}
                    </div>
                  </td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 700 }}
                      className="tabular-nums">
                    {p.total_qty.toLocaleString()} u
                  </td>
                </tr>
              ))}
              {byProduct.length === 0 && (
                <tr><td colSpan={4} style={{
                  ...td, textAlign: "center", color: "var(--text-tertiary)", padding: 24,
                }}>
                  {lang === "es" ? "Sin productos." : "No products."}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Valorización por moneda */}
      <Card title={lang === "es" ? "Valorización por moneda" : "Value by currency"}
            subtitle={lang === "es"
              ? "Suma del costo unitario × cantidad para cada moneda capturada."
              : "Sum of unit cost × qty for each captured currency."}>
        {byCurrency.length === 0 ? (
          <div className="caption" style={{ padding: 12, color: "var(--text-tertiary)" }}>
            {lang === "es" ? "Sin costos capturados." : "No costs captured."}
          </div>
        ) : (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 10,
          }}>
            {byCurrency.map((c) => (
              <div key={c.currency} style={{
                padding: "12px 14px", borderRadius: 10,
                border: "1px solid var(--border-subtle)",
                background: "white",
              }}>
                <div className="micro" style={{
                  fontSize: 10, fontWeight: 800, letterSpacing: 0.6,
                  color: "var(--text-tertiary)", textTransform: "uppercase",
                  marginBottom: 4,
                }}>{c.currency}</div>
                <div className="tabular-nums" style={{
                  fontSize: 18, fontWeight: 800, color: "#0B1E3A",
                }}>
                  {c.total_value.toLocaleString(undefined, {
                    minimumFractionDigits: 2, maximumFractionDigits: 2,
                  })}
                </div>
                <div className="caption" style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 2 }}>
                  {c.lines} {lang === "es" ? "línea(s)" : "line(s)"}
                </div>
              </div>
            ))}
          </div>
        )}

        {submitError && (
          <div style={{
            marginTop: 14, padding: "10px 14px", borderRadius: 8,
            background: "#FEE2E2", color: "#991B1B", border: "1px solid #FCA5A5", fontSize: 13,
          }}>
            <IconAlert size={11} style={{ verticalAlign: -1, marginRight: 6 }}/> {submitError}
          </div>
        )}
      </Card>

      {/* Botón masivo */}
      <button
        type="button"
        onClick={onConfirm}
        disabled={submitting}
        className="btn btn-accent"
        style={{
          padding: "18px 28px", fontSize: 16, fontWeight: 800,
          background: "var(--btn-primary, #00B286)",
          borderColor: "var(--btn-primary, #00B286)",
          letterSpacing: 0.4, borderRadius: 14,
        }}
      >
        {submitting ? (
          <><IconRefresh size={14}/> {lang === "es" ? "Procesando…" : "Processing…"}</>
        ) : (
          <><IconCheck size={14}/> {lang === "es"
            ? "Confirmar Recepción de Inventario"
            : "Confirm Inventory Receipt"}</>
        )}
      </button>
    </div>
  );
}

// =====================================================================
// Helpers visuales
// =====================================================================
function Card({ title, subtitle, children }) {
  return (
    <div style={{
      background: "white", border: "1px solid var(--border-subtle)",
      borderRadius: 14, padding: 20,
    }}>
      <div className="micro" style={{
        fontSize: 11, fontWeight: 800, letterSpacing: 0.6,
        color: "var(--text-tertiary)", textTransform: "uppercase", marginBottom: 4,
      }}>{title}</div>
      {subtitle && (
        <div className="caption" style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 14 }}>
          {subtitle}
        </div>
      )}
      {children}
    </div>
  );
}
function Tile({ label, value, accent }) {
  return (
    <div>
      <div style={{
        fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
        color: "rgba(255,255,255,0.6)", textTransform: "uppercase", marginBottom: 4,
      }}>{label}</div>
      <div className="tabular-nums" style={{
        fontSize: 22, fontWeight: 800, color: accent || "white",
      }}>{value}</div>
    </div>
  );
}
function Row({ k, v }) {
  return (
    <div style={{ display: "flex", padding: "8px 0", borderBottom: "1px solid var(--border-subtle)" }}>
      <span style={{ flex: "0 0 200px", color: "var(--text-tertiary)", fontSize: 12,
                     fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase" }}>
        {k}
      </span>
      <span style={{ color: "#0B1E3A", fontSize: 14, fontWeight: 600 }}>{v}</span>
    </div>
  );
}

const th = {
  padding: "10px 12px", textAlign: "left", fontSize: 11,
  fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase",
  color: "var(--text-tertiary)",
};
const td = { padding: "10px 12px", verticalAlign: "top" };
