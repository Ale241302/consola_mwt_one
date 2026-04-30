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
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  IconArrow, IconCheck, IconX, IconUpload, IconWarehouse, IconAlert,
  IconSparkle, IconFileText, IconPackage, IconTruck, IconRefresh,
} from "../lib/icons.jsx";
import {
  nodosApi, proveedoresApi, transferenciasApi, productosApi,
  inboundApi,
} from "../lib/api.js";
import { useLang } from "../context/LangContext.jsx";

// ─── Tipos de origen del inbound (alineado con SQL source_type_cat) ─
const SOURCE_TYPES = [
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
  const { lang } = useLang() || { lang: "es" };
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

  // ── Estado paso 3 / submit ────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  // ── Catálogos cargados ─────────────────────────────────────────
  const [nodos, setNodos] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [productos, setProductos] = useState([]);

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
  }, []);

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
  const addBlankLine = () => {
    setLines((prev) => [...prev, {
      _key: `manual-${Date.now()}`,
      product_sku: "", product_label: "", producto_id: null,
      talla: "", lote_code: "", expiration_date: "",
      expected_qty: 0, received_qty: 0,
      unit_cost_usd: null, gap_justification: "",
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
  const step1Valid = !!destinationNode && !!sourceType
                     && (sourceType === "BLIND_RECEIPT" || !!reference || sourceType === "RETURN");
  const linesWithGap = lines.filter((l) =>
    Number(l.received_qty || 0) < Number(l.expected_qty || 0)
  );
  const gapsNeedingJustif = linesWithGap.filter((l) => !((l.gap_justification || "").trim()));
  const step2Valid = lines.length > 0
                     && lines.every((l) => l.product_sku && Number(l.received_qty) >= 0)
                     && gapsNeedingJustif.length === 0;

  // ── Métricas paso 3 ───────────────────────────────────────────
  const totals = useMemo(() => {
    const expected = lines.reduce((a, l) => a + Number(l.expected_qty || 0), 0);
    const received = lines.reduce((a, l) => a + Number(l.received_qty || 0), 0);
    const value = lines.reduce((a, l) => {
      const cost = Number(l.unit_cost_usd || 0);
      return a + (cost * Number(l.received_qty || 0));
    }, 0);
    return {
      expected, received,
      delta: received - expected,
      value_usd: value,
      gap_count: linesWithGap.length,
    };
  }, [lines, linesWithGap.length]);

  // ── Submit final ──────────────────────────────────────────────
  const submit = async () => {
    if (!step2Valid || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
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
            <Step2Reconcile
              lang={lang}
              lines={lines}
              productos={productos}
              onUpdate={updateLine}
              onRemove={removeLine}
              onAdd={addBlankLine}
            />
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
            disabled={(step === 1 && !step1Valid) || (step === 2 && !step2Valid)}
            onClick={() => setStep((s) => s + 1)}
            style={{
              minWidth: 200, fontWeight: 700,
              background: ((step === 1 && step1Valid) || (step === 2 && step2Valid))
                ? "#00B286" : "#94A3B8",
              borderColor: ((step === 1 && step1Valid) || (step === 2 && step2Valid))
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
function Step2Reconcile({ lang, lines, productos, onUpdate, onRemove, onAdd }) {
  const findProductoBySku = (sku) => productos.find(
    (p) => String(p.sku || "").toUpperCase() === String(sku || "").toUpperCase()
  );

  return (
    <Card title={lang === "es" ? "Líneas detectadas" : "Detected lines"}
          subtitle={lang === "es"
            ? "Edita la cantidad recibida. Si es menor a la esperada, justifica el faltante."
            : "Edit received quantity. If less than expected, justify the gap."}>
      <div style={{ overflowX: "auto", border: "1px solid var(--border-subtle)", borderRadius: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "rgba(11,30,58,0.04)" }}>
              <th style={th}>{lang === "es" ? "SKU / Producto" : "SKU / Product"}</th>
              <th style={th}>{lang === "es" ? "Lote" : "Lot"}</th>
              <th style={th}>{lang === "es" ? "Vencimiento" : "Exp."}</th>
              <th style={{ ...th, textAlign: "right" }}>{lang === "es" ? "Esp." : "Exp."}</th>
              <th style={{ ...th, textAlign: "right" }}>{lang === "es" ? "Recibido" : "Received"}</th>
              <th style={{ ...th, textAlign: "right" }}>{lang === "es" ? "Costo USD" : "Cost USD"}</th>
              <th style={th}/>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && (
              <tr>
                <td colSpan={7} style={{ ...td, textAlign: "center", color: "var(--text-tertiary)", padding: 24 }}>
                  {lang === "es"
                    ? "No hay líneas. Sube un documento o agrega manualmente."
                    : "No lines yet. Upload a document or add manually."}
                </td>
              </tr>
            )}
            {lines.map((l) => {
              const exp  = Number(l.expected_qty || 0);
              const recv = Number(l.received_qty || 0);
              const isGap = recv < exp;
              const isOver = recv > exp;
              return (
                <React.Fragment key={l._key}>
                  <tr style={{
                    borderTop: "1px solid var(--border-subtle)",
                    background: isGap ? "rgba(239,68,68,0.04)" : (isOver ? "rgba(245,158,11,0.04)" : "white"),
                  }}>
                    <td style={td}>
                      <input
                        className="input mono-sm"
                        style={{ marginBottom: 4 }}
                        value={l.product_sku}
                        placeholder="SKU"
                        onChange={(e) => {
                          const sku = e.target.value.toUpperCase();
                          const p = findProductoBySku(sku);
                          onUpdate(l._key, {
                            product_sku: sku,
                            producto_id: p?.id || null,
                            product_label: p?.nombre || l.product_label,
                          });
                        }}
                      />
                      <input
                        className="input"
                        style={{ fontSize: 12 }}
                        value={l.product_label}
                        placeholder={lang === "es" ? "Descripción" : "Description"}
                        onChange={(e) => onUpdate(l._key, { product_label: e.target.value })}
                      />
                      <input
                        className="input mono-sm"
                        style={{ fontSize: 11, marginTop: 4, maxWidth: 80 }}
                        value={l.talla}
                        placeholder={lang === "es" ? "Talla" : "Size"}
                        onChange={(e) => onUpdate(l._key, { talla: e.target.value.toUpperCase() })}
                      />
                    </td>
                    <td style={td}>
                      <input
                        className="input mono-sm"
                        value={l.lote_code}
                        placeholder="LOT-…"
                        onChange={(e) => onUpdate(l._key, { lote_code: e.target.value })}
                      />
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
                        style={{ width: 80, textAlign: "right",
                                 background: "rgba(11,30,58,0.04)" }}
                        value={l.expected_qty}
                        onChange={(e) => onUpdate(l._key, { expected_qty: Number(e.target.value) })}
                      />
                    </td>
                    <td style={{ ...td, textAlign: "right" }} className="tabular-nums">
                      <input
                        type="number" min={0}
                        className="input mono-sm"
                        style={{
                          width: 80, textAlign: "right", fontWeight: 700,
                          color:    isGap ? "#991B1B" : isOver ? "#92400E" : "#065F46",
                          background: isGap ? "rgba(239,68,68,0.08)"
                                    : isOver ? "rgba(245,158,11,0.08)"
                                    : "rgba(0,178,134,0.06)",
                          borderColor: isGap ? "#FCA5A5" : isOver ? "#FCD34D" : "#A7F3D0",
                        }}
                        value={l.received_qty}
                        onChange={(e) => onUpdate(l._key, { received_qty: Number(e.target.value) })}
                      />
                      {isGap && (
                        <div style={{ fontSize: 10, color: "#991B1B", fontWeight: 700, marginTop: 2 }}>
                          Δ {recv - exp}
                        </div>
                      )}
                    </td>
                    <td style={{ ...td, textAlign: "right" }} className="tabular-nums">
                      <input
                        type="number" min={0} step="0.01"
                        className="input mono-sm"
                        style={{ width: 90, textAlign: "right" }}
                        value={l.unit_cost_usd ?? ""}
                        placeholder="—"
                        onChange={(e) => onUpdate(l._key, {
                          unit_cost_usd: e.target.value === "" ? null : Number(e.target.value),
                        })}
                      />
                    </td>
                    <td style={td}>
                      <button className="btn" onClick={() => onRemove(l._key)}>
                        <IconX size={11}/>
                      </button>
                    </td>
                  </tr>
                  {isGap && (
                    <tr style={{ background: "rgba(239,68,68,0.04)" }}>
                      <td colSpan={7} style={{ ...td, paddingTop: 0 }}>
                        <div style={{
                          display: "flex", alignItems: "center", gap: 10,
                          padding: "0 8px 12px",
                        }}>
                          <span style={{
                            fontSize: 11, fontWeight: 700, color: "#991B1B",
                            textTransform: "uppercase", letterSpacing: 0.5,
                            whiteSpace: "nowrap",
                          }}>
                            <IconAlert size={10} style={{ verticalAlign: -1, marginRight: 4 }}/>
                            {lang === "es" ? "Justificación del faltante *" : "Gap justification *"}
                          </span>
                          <input
                            className="input"
                            style={{
                              flex: 1, fontSize: 12,
                              borderColor: (l.gap_justification || "").trim() ? "#A7F3D0" : "#FCA5A5",
                            }}
                            value={l.gap_justification || ""}
                            placeholder={lang === "es"
                              ? "Ej.: rotura en tránsito, fábrica recortó, conteo manual…"
                              : "E.g. damage in transit, factory short, manual count…"}
                            onChange={(e) => onUpdate(l._key, { gap_justification: e.target.value })}
                          />
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
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
            ? `${lines.length} líneas · ${lines.filter((l) => Number(l.received_qty) < Number(l.expected_qty)).length} con faltante`
            : `${lines.length} lines · ${lines.filter((l) => Number(l.received_qty) < Number(l.expected_qty)).length} with gap`}
        </div>
      </div>
    </Card>
  );
}

// =====================================================================
// PASO 3 — Confirmación
// =====================================================================
function Step3Confirm({ lang, destinationNode, sourceType, reference, lines,
                       totals, submitting, submitError, onConfirm }) {
  const sType = SOURCE_TYPES.find((s) => s.v === sourceType);
  return (
    <div style={{ display: "grid", gap: 18 }}>
      {/* Resumen tile */}
      <div style={{
        background: "linear-gradient(135deg, #0B1E3A 0%, #1F3A66 100%)",
        color: "white", borderRadius: 16, padding: 24,
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 18,
      }}>
        <Tile label={lang === "es" ? "Líneas" : "Lines"}
              value={lines.length}/>
        <Tile label={lang === "es" ? "Unidades esperadas" : "Expected units"}
              value={totals.expected.toLocaleString()}/>
        <Tile label={lang === "es" ? "Unidades recibidas" : "Received units"}
              value={totals.received.toLocaleString()}
              accent={totals.received < totals.expected ? "#FCA5A5" : "#86EFAC"}/>
        <Tile label={lang === "es" ? "Faltantes (ART-17)" : "Gaps (ART-17)"}
              value={totals.gap_count}
              accent={totals.gap_count > 0 ? "#FCA5A5" : "#86EFAC"}/>
        <Tile label={lang === "es" ? "Valorización USD" : "Value USD"}
              value={`$${totals.value_usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}/>
      </div>

      {/* Detalle contexto */}
      <Card title={lang === "es" ? "Resumen" : "Summary"}>
        <Row k={lang === "es" ? "Nodo destino" : "Destination node"}
             v={destinationNode ? `${destinationNode.codigo} · ${destinationNode.nombre}` : "—"}/>
        <Row k={lang === "es" ? "Tipo de origen" : "Source type"}
             v={sType ? (lang === "es" ? sType.l_es : sType.l_en) : sourceType}/>
        {reference && (
          <Row k={lang === "es" ? "Referencia" : "Reference"} v={reference.label}/>
        )}
        {totals.gap_count > 0 && (
          <div style={{
            marginTop: 14, padding: "12px 14px", borderRadius: 10,
            background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.30)",
            color: "#92400E", fontSize: 13,
          }}>
            <IconAlert size={11} style={{ verticalAlign: -1, marginRight: 6 }}/>
            {lang === "es"
              ? `Se generarán ${totals.gap_count} excepción(es) ART-17 automáticamente para auditoría.`
              : `${totals.gap_count} ART-17 exception(s) will be auto-generated for audit.`}
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
