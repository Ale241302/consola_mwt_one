// =====================================================================
// DocumentMatchmakerWizard.jsx — Auditoría documental con IA
// Sprint 2026-05-03 v3 — chequea visibility del SKU contra el cliente y
// ofrece "Solicitar Asignación" cuando ADD_LINE apunta a un producto NO
// asignado, en lugar del checkbox de resolución habitual.
// Sprint Document Matchmaker · 2026-04-29
// Agente responsable: [AG-FRONTEND]
//
// Reemplaza el flujo viejo de "Agregar documento" en ExpedienteDetail
// con un wizard de 3 pasos que cruza el contenido del documento contra
// la BD vía gpt-5-nano:
//
//   Paso 1 · Selector tipo de documento + Dropzone
//   Paso 2 · Loading "Analizando con IA…"
//   Paso 3 · Dashboard:
//             · Match perfecto  → tile verde + cerrar
//             · Discrepancias    → grouped accordion (per SAP / por categoría)
//                                  con accept/skip por línea
//             · Botón "Aplicar resoluciones y guardar"
//
// API: documentMatchmakerApi.upload + .resolve (lib/api.js)
// Design tokens: Navy #0B1E3A, Mint #00B286, tabular-nums.
// =====================================================================
import React, { useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  IconUpload, IconCheck, IconX, IconAlert, IconSparkle,
  IconFileText, IconRefresh, IconArrow, IconShield,
} from "../../lib/icons.jsx";
import {  documentMatchmakerApi, productosApi, getToken } from "../../lib/api.js";

// ─── Catálogo de tipos de documento ───────────────────────────
const DOC_TYPES = [
  { v: "ART-01_OC",       l_es: "OC del Cliente",
                          l_en: "Client PO",
                          desc_es: "Orden de Compra emitida por el cliente",
                          desc_en: "Purchase Order issued by the client",
                          color: "#3083FE" },
  { v: "ART-02_PROFORMA", l_es: "Proforma MWT",
                          l_en: "MWT Proforma",
                          desc_es: "Proforma comercial interna (puede agrupar varios SAPs)",
                          desc_en: "Internal commercial proforma (may group several SAPs)",
                          color: "#481EE3" },
  { v: "ART-04_SAP",      l_es: "Confirmación SAP",
                          l_en: "SAP Confirmation",
                          desc_es: "Confirmación del proveedor (uno o varios números SAP)",
                          desc_en: "Supplier confirmation (one or several SAP numbers)",
                          color: "#10B981" },
];

// ═════════════════════════════════════════════════════════════
// Component principal
// ═════════════════════════════════════════════════════════════
export default function DocumentMatchmakerWizard({
  expedienteId, lang = "es", onClose, onApplied,
  // Sprint 2026-05-02 (AG-03): permite saltar el Paso 1 cuando el wizard
  // se invoca tras un upload ya hecho desde UploadDocumentModal.
  //   · initialFile         → archivo elegido por el usuario
  //   · initialDocumentType → ART-01_OC | ART-02_PROFORMA | ART-04_SAP
  //   · initialResult       → mismatch_payload + log_id ya retornado por
  //                            el backend (salta directo al Paso 3).
  initialFile = null,
  initialDocumentType = null,
  initialResult = null,
  clientId = null,
}) {
  const [step, setStep] = useState(
    initialResult ? 3 : (initialFile ? 2 : 1)
  );
  const [documentType, setDocumentType] = useState(initialDocumentType || "ART-01_OC");
  const [file, setFile]               = useState(initialFile);
  const [uploading, setUploading]     = useState(false);
  const [error, setError]             = useState(null);
  const [result, setResult]           = useState(initialResult);     // { log_id, mismatch_payload, ... }
  const [selected, setSelected]       = useState(() => {
    // Pre-marcar todas las discrepancias auto-aplicables si ya viene resultado.
    const auto = new Set();
    if (initialResult) {
      (initialResult.mismatch_payload?.discrepancies || []).forEach((d, i) => {
        if (d.severity !== "INFO" && d.suggested_action !== "MANUAL") auto.add(i);
      });
    }
    return auto;
  });
  const [resolving, setResolving]     = useState(false);
  const [resolveError, setResolveError] = useState(null);
  const [resolvedSummary, setResolvedSummary] = useState(null);

  // Sprint 2026-05-03 v3 · mapa SKU→isAssigned para gates de "Solicitar Asignación".
  // Sólo se evalúa para discrepancias con ADD_LINE que apuntan a un SKU.
  const [assignmentMap, setAssignmentMap] = useState({});  // { SKU: true|false }
  const [requestPending, setRequestPending] = useState(new Set());
  const [requestSent,    setRequestSent]    = useState(new Set());
  const [requestErr,     setRequestErr]     = useState({});

  // Cargar visibility para los SKUs con ADD_LINE — single batch al productosApi
  React.useEffect(() => {
    if (!clientId || !result) return;
    const discs = result?.mismatch_payload?.discrepancies || [];
    const skus = Array.from(new Set(
      discs
        .filter(d => d.suggested_action === "ADD_LINE" && d.sku)
        .map(d => String(d.sku).toUpperCase())
    ));
    if (skus.length === 0) return;
    let cancel = false;
    Promise.all(skus.map(sku =>
      productosApi.list({ q: sku }).then(d => {
        const arr = Array.isArray(d) ? d : (d?.results || []);
        return arr.find(p => String(p.sku || "").toUpperCase() === sku) || null;
      }).catch(() => null)
    )).then(prods => {
      if (cancel) return;
      const map = {};
      for (let i = 0; i < skus.length; i++) {
        const p = prods[i];
        if (!p) { map[skus[i]] = true; continue; }  // sin info, no bloqueamos
        const vis = p?.especificaciones?.visibility || {};
        const ov  = vis.client_overrides || {};
        const legacy = p?.especificaciones?.client_visibility || null;
        const assigned =
          vis.visible_to_all === true ||
          ov[clientId] === true ||
          (legacy && typeof legacy === "object" && legacy[clientId] === true);
        map[skus[i]] = !!assigned;
      }
      setAssignmentMap(prev => ({ ...prev, ...map }));
    });
    return () => { cancel = true; };
  }, [clientId, result]);

  // One-click envío de Solicitud de Asignación
  const requestAssignment = async (sku) => {
    const SKU = (sku || "").toUpperCase();
    if (!SKU || !clientId) return;
    if (requestPending.has(SKU) || requestSent.has(SKU)) return;
    setRequestPending(prev => new Set(prev).add(SKU));
    setRequestErr(prev => { const n = { ...prev }; delete n[SKU]; return n; });
    try {
      const res = await fetch("/api/catalog/request-assignment/", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ client_id: clientId, sku: SKU }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      setRequestSent(prev => new Set(prev).add(SKU));
    } catch (e) {
      setRequestErr(prev => ({ ...prev, [SKU]: e?.message || "fallo" }));
    } finally {
      setRequestPending(prev => {
        const n = new Set(prev); n.delete(SKU); return n;
      });
    }
  };

  const submit = async () => {
    if (!file || uploading) return;
    setUploading(true); setError(null);
    setStep(2);
    try {
      const r = await documentMatchmakerApi.upload(expedienteId, file, documentType);
      setResult(r);
      // Pre-marcar todas las discrepancias auto-aplicables (severity != INFO).
      // Sprint 2026-05-03 v3 · NO pre-marcamos las ADD_LINE de un SKU sin
      // asignar (la chequea el effect de visibility después de fetch).
      const auto = new Set();
      (r.mismatch_payload?.discrepancies || []).forEach((d, i) => {
        if (d.severity !== "INFO" && d.suggested_action !== "MANUAL") auto.add(i);
      });
      setSelected(auto);
      setStep(3);
    } catch (e) {
      setError(e?.body?.detail || e?.message || "Falló el análisis IA.");
      setStep(1);
    } finally {
      setUploading(false);
    }
  };

  const toggleDisc = (idx) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(idx)) n.delete(idx); else n.add(idx);
      return n;
    });
  };

  const applyResolutions = async () => {
    if (!result || resolving) return;
    setResolving(true); setResolveError(null);
    const discrepancies = result.mismatch_payload?.discrepancies || [];
    const actions = [];
    discrepancies.forEach((d, i) => {
      if (selected.has(i)) {
        actions.push({
          kind:           d.suggested_action || "MANUAL",
          line_id:        d.line_id || null,
          sku:            d.sku,
          talla:          d.talla,
          qty_doc:        d.qty_doc,
          qty_exp:        d.qty_exp,
          sap_doc:        d.sap_doc,
          product_label:  d.product_label,
          // Sprint 2026-05-02 (AG-03): pasamos el precio extraído por la IA
          // para que ADD_LINE pueda persistirlo. Si viene null/0, el
          // backend cae al CPA del cliente o al precio_lista.
          unit_price:     d.unit_price,
        });
      }
    });
    try {
      const r = await documentMatchmakerApi.resolve(expedienteId, {
        log_id:  result.log_id,
        actions,
        note:    null,
      });
      setResolvedSummary(r);
      onApplied?.();
    } catch (e) {
      setResolveError(e?.body?.detail || e?.message || "Falló la aplicación.");
    } finally {
      setResolving(false);
    }
  };

  // Sprint 2026-05-02: si llega initialFile sin initialResult, dispara el
  // upload automáticamente para evitar un click extra del usuario.
  React.useEffect(() => {
    if (initialFile && !initialResult && step === 2 && !uploading && !result) {
      submit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={overlay} onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.22 }}
        onClick={(e) => e.stopPropagation()}
        style={modal}
      >
        {/* Header */}
        <div style={header}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 38, height: 38, borderRadius: 10,
              background: "linear-gradient(135deg, #481EE3 0%, #00B286 100%)",
              display: "flex", alignItems: "center", justifyContent: "center", color: "white",
            }}>
              <IconShield size={16}/>
            </div>
            <div>
              <div className="micro" style={{ color: "var(--text-tertiary)", letterSpacing: 1.2 }}>
                {lang === "es" ? "AUDITORÍA DOCUMENTAL · IA" : "DOCUMENT AUDIT · AI"}
              </div>
              <div style={{ fontWeight: 800, fontSize: 17, color: "#0B1E3A", marginTop: 2 }}>
                {lang === "es" ? "Cruzar documento con expediente" : "Cross-check document with file"}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="btn btn-ghost" style={{ padding: "6px 10px" }}>
            <IconX size={12}/>
          </button>
        </div>

        {/* Stepper */}
        <Stepper step={step} lang={lang}/>

        {/* Body por paso */}
        <div style={body}>
          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div key="step1"
                          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
                <Step1Selector
                  lang={lang}
                  documentType={documentType} setDocumentType={setDocumentType}
                  file={file} setFile={setFile}
                  error={error}
                />
              </motion.div>
            )}
            {step === 2 && (
              <motion.div key="step2"
                          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <Step2Loading lang={lang} documentType={documentType} filename={file?.name}/>
              </motion.div>
            )}
            {step === 3 && result && (
              <motion.div key="step3"
                          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.22 }}>
                <Step3Dashboard
                  lang={lang}
                  result={result}
                  documentType={documentType}
                  selected={selected}
                  onToggle={toggleDisc}
                  onSelectAll={(action) => {
                    if (action === "all") {
                      const all = new Set();
                      (result.mismatch_payload?.discrepancies || []).forEach((_, i) => all.add(i));
                      setSelected(all);
                    } else if (action === "none") setSelected(new Set());
                  }}
                  resolvedSummary={resolvedSummary}
                  resolveError={resolveError}
                  assignmentMap={assignmentMap}
                  requestPending={requestPending}
                  requestSent={requestSent}
                  requestErr={requestErr}
                  onRequestAssignment={requestAssignment}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div style={footer}>
          {step === 1 && (
            <>
              <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                {lang === "es"
                  ? "PDF · Excel · CSV · Imagen · max 25MB"
                  : "PDF · Excel · CSV · Image · max 25MB"}
              </span>
              <button
                className="btn btn-accent"
                disabled={!file || uploading}
                onClick={submit}
                style={{
                  minWidth: 200, fontWeight: 700,
                  background: file ? "#00B286" : "#94A3B8",
                  borderColor: file ? "#00B286" : "#94A3B8",
                }}>
                {lang === "es" ? "Analizar con IA" : "Analyze with AI"} <IconArrow size={12}/>
              </button>
            </>
          )}

          {step === 3 && !resolvedSummary && (
            <>
              <button className="btn btn-ghost" onClick={onClose}>
                {lang === "es" ? "Cerrar" : "Close"}
              </button>
              {(result?.mismatch_payload?.discrepancies?.length > 0) && (
                <button
                  className="btn btn-accent"
                  disabled={selected.size === 0 || resolving}
                  onClick={applyResolutions}
                  style={{
                    minWidth: 240, fontWeight: 700,
                    background: selected.size > 0 ? "#00B286" : "#94A3B8",
                    borderColor: selected.size > 0 ? "#00B286" : "#94A3B8",
                  }}>
                  {resolving
                    ? <><IconRefresh size={12}/> {lang === "es" ? "Aplicando…" : "Applying…"}</>
                    : <><IconCheck size={12}/> {lang === "es"
                          ? `Aplicar resoluciones y guardar (${selected.size})`
                          : `Apply resolutions & save (${selected.size})`}</>}
                </button>
              )}
            </>
          )}

          {step === 3 && resolvedSummary && (
            <button className="btn btn-accent"
                    onClick={onClose}
                    style={{
                      minWidth: 200, fontWeight: 700,
                      background: "#00B286", borderColor: "#00B286",
                    }}>
              <IconCheck size={12}/> {lang === "es" ? "Cerrar" : "Close"}
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// Stepper
// ═════════════════════════════════════════════════════════════
function Stepper({ step, lang }) {
  const items = lang === "es"
    ? ["Documento", "Análisis IA", "Resoluciones"]
    : ["Document",  "AI Analysis", "Resolutions"];
  return (
    <div style={{
      display: "flex", gap: 6, alignItems: "center", padding: "12px 22px",
      borderBottom: "1px solid var(--border-subtle)", background: "rgba(11,30,58,0.02)",
    }}>
      {items.map((label, i) => {
        const idx = i + 1;
        const done = step > idx;
        const active = step === idx;
        return (
          <React.Fragment key={i}>
            <div style={{
              display: "flex", alignItems: "center", gap: 7,
              padding: "5px 10px", borderRadius: 999,
              background: done ? "#00B286" : active ? "rgba(0,178,134,0.10)" : "transparent",
              color:      done ? "white" : active ? "#0B1E3A" : "var(--text-tertiary)",
              border:     done ? "none" : active ? "1.5px solid #00B286" : "1px solid var(--border-subtle)",
              fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase",
            }}>
              <span style={{
                width: 18, height: 18, borderRadius: "50%",
                background: done ? "rgba(255,255,255,0.25)" : active ? "#00B286" : "rgba(11,30,58,0.10)",
                color: done || active ? "white" : "var(--text-tertiary)",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                fontSize: 10,
              }}>
                {done ? <IconCheck size={9}/> : idx}
              </span>
              {label}
            </div>
            {i < items.length - 1 && (
              <div style={{
                flex: "0 0 18px", height: 2,
                background: step > idx ? "#00B286" : "var(--border-subtle)",
              }}/>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// PASO 1 — Selector + Dropzone
// ═════════════════════════════════════════════════════════════
function Step1Selector({ lang, documentType, setDocumentType, file, setFile, error }) {
  const fileRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const onDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) setFile(f);
  };

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div>
        <div style={subTitle}>
          {lang === "es" ? "1. Tipo de documento" : "1. Document type"}
        </div>
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10,
        }}>
          {DOC_TYPES.map((t) => {
            const sel = documentType === t.v;
            return (
              <button
                key={t.v}
                type="button"
                onClick={() => setDocumentType(t.v)}
                style={{
                  padding: "12px 14px", borderRadius: 10,
                  border: sel ? `2px solid ${t.color}` : "1px solid var(--border-subtle)",
                  background: sel ? `${t.color}10` : "white",
                  color: "#0B1E3A", textAlign: "left", cursor: "pointer",
                  display: "flex", flexDirection: "column", gap: 4,
                  transition: "all 0.15s",
                }}
              >
                <span style={{
                  fontSize: 11, fontWeight: 800, letterSpacing: 0.4,
                  color: sel ? t.color : "var(--text-secondary)",
                  fontFamily: "ui-monospace, monospace",
                }}>{t.v}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#0B1E3A" }}>
                  {lang === "es" ? t.l_es : t.l_en}
                </span>
                <span style={{ fontSize: 11, color: "var(--text-tertiary)", lineHeight: 1.4 }}>
                  {lang === "es" ? t.desc_es : t.desc_en}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div style={subTitle}>
          {lang === "es" ? "2. Documento" : "2. Document"}
        </div>
        {!file ? (
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
            }}>
            <input ref={fileRef} type="file" hidden
                   accept=".pdf,.xlsx,.xls,.csv,image/*"
                   onChange={(e) => setFile(e.target.files?.[0])}/>
            <IconUpload size={28} style={{ color: "#00B286", marginBottom: 8 }}/>
            <div style={{ fontWeight: 700, color: "#0B1E3A", fontSize: 15, marginBottom: 2 }}>
              {lang === "es" ? "Arrastra el documento o haz clic" : "Drag the document or click"}
            </div>
            <div className="caption" style={{ color: "var(--text-tertiary)", fontSize: 12 }}>
              {lang === "es"
                ? "PDF · Excel · CSV · Imagen · max 25MB"
                : "PDF · Excel · CSV · Image · max 25MB"}
            </div>
          </div>
        ) : (
          <div style={{
            border: "1px solid var(--border-subtle)", borderRadius: 12,
            padding: 14, display: "flex", alignItems: "center", gap: 12, background: "white",
          }}>
            <IconFileText size={18} style={{ color: "#00B286" }}/>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#0B1E3A",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {file.name}
              </div>
              <div className="caption" style={{ color: "var(--text-tertiary)", fontSize: 12 }}>
                {(file.size / 1024).toFixed(1)} KB
              </div>
            </div>
            <button className="btn" onClick={() => setFile(null)}><IconX size={11}/></button>
          </div>
        )}
        {error && (
          <div style={{
            marginTop: 12, padding: "10px 14px", borderRadius: 8,
            background: "#FEE2E2", color: "#991B1B", border: "1px solid #FCA5A5", fontSize: 13,
          }}>
            <IconAlert size={11} style={{ verticalAlign: -1, marginRight: 6 }}/> {error}
          </div>
        )}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// PASO 2 — Loading
// ═════════════════════════════════════════════════════════════
function Step2Loading({ lang, documentType, filename }) {
  const tip = DOC_TYPES.find((t) => t.v === documentType);
  return (
    <div style={{
      padding: "48px 24px", textAlign: "center",
      display: "flex", flexDirection: "column", alignItems: "center", gap: 14,
    }}>
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 2.4, ease: "linear" }}
        style={{
          width: 56, height: 56, borderRadius: "50%",
          background: "linear-gradient(135deg, #481EE3 0%, #00B286 100%)",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "white",
        }}>
        <IconSparkle size={22}/>
      </motion.div>
      <div style={{ fontWeight: 800, fontSize: 17, color: "#0B1E3A" }}>
        {lang === "es" ? "Analizando documento y cruzando datos con IA…"
                       : "Analyzing document and cross-checking with AI…"}
      </div>
      <div className="caption" style={{ color: "var(--text-tertiary)", fontSize: 13, maxWidth: 480 }}>
        {lang === "es"
          ? `Modelo: gpt-5-nano · ${tip?.l_es || documentType} · ${filename || "—"}`
          : `Model: gpt-5-nano · ${tip?.l_en || documentType} · ${filename || "—"}`}
      </div>
      <div style={{
        marginTop: 18, display: "flex", gap: 6,
        fontSize: 12, color: "var(--text-tertiary)",
      }}>
        <Dot delay={0}/><Dot delay={0.2}/><Dot delay={0.4}/>
      </div>
    </div>
  );
}
function Dot({ delay }) {
  return (
    <motion.span
      animate={{ opacity: [0.2, 1, 0.2] }}
      transition={{ repeat: Infinity, duration: 1.2, delay, ease: "easeInOut" }}
      style={{
        width: 6, height: 6, borderRadius: "50%", background: "#481EE3",
        display: "inline-block",
      }}/>
  );
}

// ═════════════════════════════════════════════════════════════
// PASO 3 — Dashboard de resultados
// ═════════════════════════════════════════════════════════════
function Step3Dashboard({
  lang, result, documentType, selected, onToggle, onSelectAll,
  resolvedSummary, resolveError,
  assignmentMap = {}, requestPending, requestSent, requestErr,
  onRequestAssignment,
}) {
  const summary = result.mismatch_payload?.summary || {};
  const discrepancies = result.mismatch_payload?.discrepancies || [];
  const groups = result.mismatch_payload?.groups || [];
  const isPerfect = summary.perfect_match;
  const isProforma = documentType === "ART-02_PROFORMA";
  const isSAP      = documentType === "ART-04_SAP";

  // Resolved final view
  if (resolvedSummary) {
    return (
      <div style={{ padding: 24, textAlign: "center" }}>
        <div style={{
          width: 64, height: 64, borderRadius: "50%", background: "rgba(0,178,134,0.12)",
          margin: "0 auto 14px", display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <IconCheck size={26} style={{ color: "#00B286" }}/>
        </div>
        <div style={{ fontWeight: 800, fontSize: 18, color: "#0B1E3A", marginBottom: 6 }}>
          {lang === "es" ? "Resoluciones aplicadas" : "Resolutions applied"}
        </div>
        <div className="caption" style={{ color: "var(--text-secondary)", fontSize: 13 }}>
          {lang === "es"
            ? `${resolvedSummary.applied_count || 0} acciones aplicadas`
            : `${resolvedSummary.applied_count || 0} actions applied`}
          {resolvedSummary.errors_count > 0 && (
            <span style={{ color: "#B91C1C", marginLeft: 6 }}>
              · {resolvedSummary.errors_count} {lang === "es" ? "errores" : "errors"}
            </span>
          )}
        </div>
      </div>
    );
  }

  // Match perfecto
  if (isPerfect) {
    return (
      <div style={{ padding: "32px 24px", textAlign: "center" }}>
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.3, type: "spring" }}
          style={{
            width: 84, height: 84, borderRadius: "50%",
            background: "linear-gradient(135deg, #00B286 0%, #1DE394 100%)",
            margin: "0 auto 16px", display: "flex", alignItems: "center", justifyContent: "center",
            color: "white",
          }}>
          <IconCheck size={36}/>
        </motion.div>
        <div style={{ fontWeight: 800, fontSize: 22, color: "#0B1E3A", marginBottom: 4 }}>
          {lang === "es" ? "Match perfecto" : "Perfect match"}
        </div>
        <div className="tabular-nums" style={{ color: "#00B286", fontSize: 14, fontWeight: 700 }}>
          100% {lang === "es" ? "de cobertura" : "coverage"}
        </div>
        <div className="caption" style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 12 }}>
          {lang === "es"
            ? `${summary.lines_in_doc || 0} líneas en el documento · ${summary.lines_in_expediente || 0} en BD · ${summary.lines_matched || 0} cruzadas`
            : `${summary.lines_in_doc || 0} lines in doc · ${summary.lines_in_expediente || 0} in DB · ${summary.lines_matched || 0} matched`}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Summary tiles */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10,
      }}>
        <Tile label={lang === "es" ? "Cobertura" : "Coverage"}
              value={`${(summary.coverage_pct || 0).toFixed(1)}%`}
              accent={summary.coverage_pct >= 95 ? "#00B286" :
                      summary.coverage_pct >= 75 ? "#F59E0B" : "#EF4444"}/>
        <Tile label={lang === "es" ? "Líneas doc" : "Lines doc"}
              value={summary.lines_in_doc || 0}/>
        <Tile label={lang === "es" ? "Líneas expediente" : "Lines file"}
              value={summary.lines_in_expediente || 0}/>
        <Tile label={lang === "es" ? "Cruzadas" : "Matched"}
              value={summary.lines_matched || 0} accent="#00B286"/>
        <Tile label={lang === "es" ? "Discrepancias" : "Discrepancies"}
              value={summary.discrepancies_count || 0}
              accent={summary.discrepancies_count > 0 ? "#EF4444" : "#00B286"}/>
      </div>

      {/* Toolbar */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "8px 12px", background: "rgba(11,30,58,0.03)", borderRadius: 8,
        fontSize: 12,
      }}>
        <span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>
          {lang === "es"
            ? `${selected.size} de ${discrepancies.length} discrepancias seleccionadas`
            : `${selected.size} of ${discrepancies.length} discrepancies selected`}
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => onSelectAll("all")}
                  style={{ fontSize: 11 }}>
            {lang === "es" ? "Marcar todas" : "Select all"}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => onSelectAll("none")}
                  style={{ fontSize: 11 }}>
            {lang === "es" ? "Limpiar" : "Clear"}
          </button>
        </div>
      </div>

      {/* Lista de discrepancias */}
      <div style={{ maxHeight: 380, overflowY: "auto", paddingRight: 4 }}>
        {(isProforma || isSAP) && groups.length > 0
          ? <GroupedView groups={groups} discrepancies={discrepancies}
                         selected={selected} onToggle={onToggle} lang={lang}
                         assignmentMap={assignmentMap}
                         requestPending={requestPending}
                         requestSent={requestSent}
                         requestErr={requestErr}
                         onRequestAssignment={onRequestAssignment}/>
          : <FlatView discrepancies={discrepancies}
                      selected={selected} onToggle={onToggle} lang={lang}
                      assignmentMap={assignmentMap}
                      requestPending={requestPending}
                      requestSent={requestSent}
                      requestErr={requestErr}
                      onRequestAssignment={onRequestAssignment}/>}
      </div>

      {resolveError && (
        <div style={{
          padding: "10px 14px", borderRadius: 8,
          background: "#FEE2E2", color: "#991B1B", border: "1px solid #FCA5A5", fontSize: 13,
        }}>
          <IconAlert size={11} style={{ verticalAlign: -1, marginRight: 6 }}/> {resolveError}
        </div>
      )}
    </div>
  );
}

// ─── Vista plana (OC) ─────────────────────────────────────
function FlatView({ discrepancies, selected, onToggle, lang,
                    assignmentMap, requestPending, requestSent, requestErr,
                    onRequestAssignment }) {
  if (discrepancies.length === 0) {
    return (
      <div className="caption" style={{
        padding: 24, textAlign: "center", color: "var(--text-tertiary)",
      }}>
        {lang === "es" ? "Sin discrepancias detectadas." : "No discrepancies detected."}
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {discrepancies.map((d, i) => (
        <DiscrepancyCard key={i} idx={i} d={d}
                         checked={selected.has(i)}
                         onToggle={() => onToggle(i)} lang={lang}
                         assignmentMap={assignmentMap}
                         requestPending={requestPending}
                         requestSent={requestSent}
                         requestErr={requestErr}
                         onRequestAssignment={onRequestAssignment}/>
      ))}
    </div>
  );
}

// ─── Vista agrupada (Proforma / SAP) ──────────────────────
function GroupedView({ groups, discrepancies, selected, onToggle, lang,
                       assignmentMap, requestPending, requestSent, requestErr,
                       onRequestAssignment }) {
  // Indexamos discrepancias por SAP para poder enlazar con los grupos
  const discIndexBySAP = useMemo(() => {
    const m = {};
    discrepancies.forEach((d, i) => {
      const k = d.sap_doc || d.sap_exp || "(sin SAP)";
      if (!m[k]) m[k] = [];
      m[k].push({ ...d, _idx: i });
    });
    return m;
  }, [discrepancies]);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {Object.entries(discIndexBySAP).map(([sapKey, group]) => (
        <GroupAccordion key={sapKey} sapKey={sapKey} group={group}
                        selected={selected} onToggle={onToggle} lang={lang}
                        assignmentMap={assignmentMap}
                        requestPending={requestPending}
                        requestSent={requestSent}
                        requestErr={requestErr}
                        onRequestAssignment={onRequestAssignment}/>
      ))}
    </div>
  );
}

function GroupAccordion({ sapKey, group, selected, onToggle, lang,
                          assignmentMap, requestPending, requestSent, requestErr,
                          onRequestAssignment }) {
  const [open, setOpen] = useState(true);
  const errs  = group.filter((d) => d.severity === "ERROR").length;
  const warns = group.filter((d) => d.severity === "WARN").length;
  return (
    <div style={{ border: "1px solid var(--border-subtle)", borderRadius: 10, overflow: "hidden" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: "100%", padding: "10px 14px", border: 0, cursor: "pointer",
          background: "linear-gradient(135deg, rgba(72,30,227,0.06), rgba(0,178,134,0.04))",
          display: "flex", alignItems: "center", gap: 10, textAlign: "left",
        }}>
        <span style={{
          fontFamily: "ui-monospace, monospace", fontSize: 13, fontWeight: 800, color: "#481EE3",
        }}>SAP · {sapKey}</span>
        <span style={{ flex: 1 }}/>
        {errs > 0 && <Pill text={`${errs} ${lang === "es" ? "errores" : "errors"}`} bg="#FEE2E2" color="#991B1B"/>}
        {warns > 0 && <Pill text={`${warns} ${lang === "es" ? "advertencias" : "warnings"}`} bg="#FEF3C7" color="#92400E"/>}
        <span style={{ color: "var(--text-tertiary)", fontSize: 11 }}>{group.length}</span>
        <span style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.2s",
                       color: "var(--text-tertiary)", fontSize: 12 }}>▶</span>
      </button>
      {open && (
        <div style={{ padding: 10, display: "grid", gap: 8, background: "white" }}>
          {group.map((d) => (
            <DiscrepancyCard key={d._idx} idx={d._idx} d={d}
                             checked={selected.has(d._idx)}
                             onToggle={() => onToggle(d._idx)} lang={lang}
                             assignmentMap={assignmentMap}
                             requestPending={requestPending}
                             requestSent={requestSent}
                             requestErr={requestErr}
                             onRequestAssignment={requestAssignment}/>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tarjeta de discrepancia ───────────────────────────────
function DiscrepancyCard({
  idx, d, checked, onToggle, lang,
  assignmentMap = {}, requestPending = new Set(),
  requestSent = new Set(), requestErr = {},
  onRequestAssignment,
}) {
  const sev = d.severity || "WARN";
  // Sprint 2026-05-03 v3 · si la discrepancia es ADD_LINE y el SKU NO está
  // asignado al cliente, deshabilitamos el checkbox y mostramos el botón
  // "Solicitar Asignación". Por defecto (sin info) tratamos como asignado.
  const skuKey = (d.sku || "").toUpperCase();
  const isAddLine = d.suggested_action === "ADD_LINE";
  const isAssigned = isAddLine
    ? (skuKey in assignmentMap ? assignmentMap[skuKey] : true)
    : true;
  const reqPending = isAddLine && requestPending.has(skuKey);
  const reqSent    = isAddLine && requestSent.has(skuKey);
  const reqErrMsg  = isAddLine ? requestErr[skuKey] : null;
  const palette = sev === "ERROR"
    ? { bg: "rgba(239,68,68,0.05)", border: "rgba(239,68,68,0.30)", title: "#991B1B", pillBg: "#FEE2E2", pillFg: "#991B1B" }
    : sev === "WARN"
    ? { bg: "rgba(245,158,11,0.05)", border: "rgba(245,158,11,0.30)", title: "#92400E", pillBg: "#FEF3C7", pillFg: "#92400E" }
    : { bg: "rgba(11,30,58,0.03)",  border: "var(--border-subtle)",   title: "#0B1E3A", pillBg: "rgba(11,30,58,0.08)", pillFg: "#0B1E3A" };

  const kindLabel = {
    "MISSING_IN_EXPEDIENTE": lang === "es" ? "Falta en expediente" : "Missing in file",
    "MISSING_IN_DOC":        lang === "es" ? "Falta en documento"  : "Missing in document",
    "QTY_DIFF":              lang === "es" ? "Diferencia cantidad" : "Qty diff",
    "SAP_MISMATCH":          lang === "es" ? "SAP no coincide"     : "SAP mismatch",
    "SIZE_MISMATCH":         lang === "es" ? "Talla no coincide"   : "Size mismatch",
    "OTHER":                 lang === "es" ? "Otro"                : "Other",
  }[d.kind] || d.kind;

  const actionLabel = {
    "ADD_LINE":     lang === "es" ? "Agregar línea al expediente" : "Add line to file",
    "UPDATE_QTY":   lang === "es" ? "Actualizar cantidad"          : "Update quantity",
    "ATTACH_SAP":   lang === "es" ? "Vincular SAP"                 : "Attach SAP",
    "DELETE_LINE":  lang === "es" ? "Marcar línea como cancelada"  : "Mark line as cancelled",
    "MANUAL":       lang === "es" ? "Sólo registrar"               : "Just log",
  }[d.suggested_action] || d.suggested_action;

  return (
    <label style={{
      display: "flex", gap: 12, alignItems: "flex-start",
      padding: "10px 12px", borderRadius: 8,
      background: isAddLine && !isAssigned ? "rgba(180,83,9,0.05)" : palette.bg,
      border: `1px solid ${isAddLine && !isAssigned ? "rgba(180,83,9,0.30)" : palette.border}`,
      cursor: (isAddLine && !isAssigned) ? "default" : "pointer",
    }}>
      <input
        type="checkbox" checked={checked && (!isAddLine || isAssigned)}
        disabled={isAddLine && !isAssigned}
        onChange={(isAddLine && !isAssigned) ? undefined : onToggle}
        style={{ marginTop: 4, accentColor: "#00B286", flexShrink: 0,
                 opacity: (isAddLine && !isAssigned) ? 0.4 : 1 }}/>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 4 }}>
          <Pill text={kindLabel} bg={palette.pillBg} color={palette.pillFg}/>
          <span className="mono-sm" style={{
            fontWeight: 800, fontSize: 13, color: palette.title,
          }}>{d.sku}</span>
          {d.talla && (
            <span className="mono-sm" style={{
              padding: "1px 7px", borderRadius: 4,
              background: "rgba(11,30,58,0.06)", color: "#0B1E3A",
              fontSize: 11, fontWeight: 700,
            }}>{d.talla}</span>
          )}
          {d.product_label && (
            <span style={{ fontSize: 12, color: "var(--text-secondary)", flex: 1, minWidth: 0,
                           overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {d.product_label}
            </span>
          )}
        </div>
        <div className="tabular-nums" style={{
          display: "flex", gap: 14, fontSize: 12, color: "var(--text-secondary)",
          flexWrap: "wrap",
        }}>
          {(d.qty_doc != null || d.qty_exp != null) && (
            <span>
              {lang === "es" ? "Doc:" : "Doc:"}{" "}
              <strong style={{ color: "#0B1E3A" }}>{d.qty_doc ?? "—"}</strong>
              {" · "}
              {lang === "es" ? "BD:" : "DB:"}{" "}
              <strong style={{ color: d.qty_doc !== d.qty_exp ? "#B91C1C" : "#0B1E3A" }}>
                {d.qty_exp ?? "—"}
              </strong>
              {(d.qty_doc != null && d.qty_exp != null && d.qty_doc !== d.qty_exp) && (
                <span style={{ color: "#B91C1C", fontWeight: 800, marginLeft: 4 }}>
                  Δ {Number(d.qty_doc) - Number(d.qty_exp)}
                </span>
              )}
            </span>
          )}
          {(d.sap_doc || d.sap_exp) && (
            <span>
              SAP:{" "}
              <strong style={{ color: "#0B1E3A" }}>{d.sap_doc || "—"}</strong>
              {d.sap_doc !== d.sap_exp && (
                <>{" / "}
                  <strong style={{ color: "#B91C1C" }}>{d.sap_exp || "—"}</strong></>
              )}
            </span>
          )}
        </div>
        {actionLabel && !(isAddLine && !isAssigned) && (
          <div style={{
            marginTop: 6, fontSize: 11, color: "#00B286", fontWeight: 700,
            letterSpacing: 0.4, textTransform: "uppercase",
          }}>
            → {actionLabel}
          </div>
        )}
        {isAddLine && !isAssigned && (
          <div style={{
            marginTop: 8, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          }}>
            <span style={{
              padding: "2px 8px", borderRadius: 999,
              background: "rgba(180,83,9,0.10)", color: "#B45309",
              fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
              textTransform: "uppercase",
            }}>
              ⚠ {lang === "es" ? "PRODUCTO NO ASIGNADO" : "PRODUCT NOT ASSIGNED"}
            </span>
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation();
                                onRequestAssignment && onRequestAssignment(d.sku); }}
              disabled={reqPending || reqSent}
              style={{
                padding: "6px 12px", borderRadius: 8,
                border: "1px solid " + (reqSent ? "rgba(0,135,90,0.25)" : "rgba(0,178,134,0.40)"),
                background: reqSent ? "rgba(0,135,90,0.10)" : "#fff",
                color: reqSent ? "#00875A" : "#00B286",
                fontWeight: 700, fontSize: 11,
                cursor: (reqPending || reqSent) ? "default" : "pointer",
                whiteSpace: "nowrap", letterSpacing: 0.3,
              }}
              title={reqErrMsg || ""}>
              {reqPending
                ? (lang === "es" ? "Enviando…" : "Sending…")
                : reqSent
                  ? (lang === "es" ? "✓ Solicitado" : "✓ Requested")
                  : (lang === "es" ? "Solicitar Asignación" : "Request Assignment")}
            </button>
            <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
              {lang === "es"
                ? "El equipo MWT recibirá un correo y al asignarlo podrás aplicar la resolución."
                : "MWT team will receive an email; once assigned you'll be able to apply the resolution."}
            </span>
          </div>
        )}
      </div>
    </label>
  );
}

// ─── Helpers ──────────────────────────────────────────────
function Tile({ label, value, accent }) {
  return (
    <div style={{
      padding: 12, border: "1px solid var(--border-subtle)", borderRadius: 10, background: "white",
    }}>
      <div style={{
        fontSize: 10, fontWeight: 800, letterSpacing: 0.5,
        color: "var(--text-tertiary)", textTransform: "uppercase", marginBottom: 4,
      }}>{label}</div>
      <div className="tabular-nums" style={{
        fontSize: 18, fontWeight: 800, color: accent || "#0B1E3A",
      }}>{value}</div>
    </div>
  );
}
function Pill({ text, bg, color }) {
  return (
    <span style={{
      padding: "2px 8px", borderRadius: 999, fontSize: 10, fontWeight: 800,
      letterSpacing: 0.5, textTransform: "uppercase", whiteSpace: "nowrap",
      background: bg, color,
    }}>{text}</span>
  );
}

// ─── Estilos del overlay/modal ─────────────────────────────
const overlay = {
  position: "fixed", inset: 0, zIndex: 200,
  background: "rgba(11,30,58,0.55)",
  display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
};
const modal = {
  background: "white", borderRadius: 16, width: "min(820px, 96vw)",
  maxHeight: "92vh", overflow: "hidden", display: "flex", flexDirection: "column",
  boxShadow: "0 30px 60px -20px rgba(15,27,61,0.55)",
};
const header = {
  padding: "14px 22px", borderBottom: "1px solid var(--border-subtle)",
  display: "flex", justifyContent: "space-between", alignItems: "center",
};
const body   = { padding: 22, overflowY: "auto", flex: 1 };
const footer = {
  padding: "12px 22px", borderTop: "1px solid var(--border-subtle)",
  display: "flex", justifyContent: "space-between", alignItems: "center",
  background: "rgba(11,30,58,0.02)",
};
const subTitle = {
  fontSize: 11, fontWeight: 800, letterSpacing: 0.6,
  color: "var(--text-tertiary)", textTransform: "uppercase", marginBottom: 8,
};
