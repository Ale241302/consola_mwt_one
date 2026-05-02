// frontend/src/components/expedientes/UploadDocumentModal.jsx
// =====================================================================
// MWT.ONE · UploadDocumentModal
// Modal para subir documentos comerciales a la OC.
//
// Sprint 2026-05-02 (AG-03): cuando kind === "OC" y existe expedienteId,
// tras subir a /api/documentos/ encadena automáticamente la extracción
// IA + matchmaker contra el catálogo de productos. El padre recibe el
// resultado vía `onAiAnalysisReady(payload, file)` y puede abrir el
// wizard de revisión para que el usuario confirme las líneas a insertar
// en "Productos OC".
// =====================================================================
import React, { useState, useRef } from "react";
import {
  IconUpload, IconX, IconFileText, IconCheck, IconAlert, IconSparkle,
} from "../../lib/icons.jsx";
import { documentosApi, getToken, documentMatchmakerApi } from "../../lib/api.js";

const API_BASE = (import.meta && import.meta.env && import.meta.env.VITE_API_BASE) || "/api";

// Tipos canónicos (codigo interno + label).
const DOCUMENT_KINDS = [
  { id: "OC",        es: "OC del Cliente",        en: "Client PO",
    hint_es: "Orden de Compra original recibida del cliente.",
    hint_en: "Original purchase order received from the client.",
    aiPipeline: "ART-01_OC" },
  { id: "PROFORMA",  es: "Proforma",              en: "Proforma",
    hint_es: "Proforma emitida por MWT al cliente.",
    hint_en: "Proforma issued by MWT to the client.",
    aiPipeline: "ART-02_PROFORMA" },
  { id: "FACTURA",   es: "Factura comercial",     en: "Commercial invoice",
    hint_es: "Factura emitida al cliente o de un proveedor.",
    hint_en: "Invoice issued to client or from a supplier." },
  { id: "CONTRATO",  es: "Contrato",              en: "Contract",
    hint_es: "Acuerdo comercial firmado.",
    hint_en: "Signed commercial agreement." },
  { id: "OTRO",      es: "Otro documento",        en: "Other document",
    hint_es: "Cualquier otro documento de soporte.",
    hint_en: "Any other supporting document." },
];

function prettyBytes(n) {
  if (!n) return "0 B";
  const k = 1024;
  const i = Math.floor(Math.log(n) / Math.log(k));
  const u = ["B", "KB", "MB", "GB"];
  return `${(n / Math.pow(k, i)).toFixed(1)} ${u[i]}`;
}

export default function UploadDocumentModal({
  open,
  onClose,
  onUploaded,           // (newDoc) => void
  onAiAnalysisReady,    // (mismatchPayload, file, documentType) => void  ← NUEVO
  lang = "es",
  ocId,
  expedienteId,
  contextLabel,
}) {
  const [kind,    setKind]    = useState("OC");
  const [codigo,  setCodigo]  = useState("");
  const [file,    setFile]    = useState(null);
  const [error,   setError]   = useState(null);
  const [uploading, setUploading] = useState(false);
  const [aiPhase, setAiPhase] = useState(null); // null | 'uploading' | 'analyzing'
  const [dragOver,  setDragOver]  = useState(false);
  const inputRef = useRef(null);

  if (!open) return null;

  const kindObj = DOCUMENT_KINDS.find(k => k.id === kind) || DOCUMENT_KINDS[0];
  const aiEligible = !!(kindObj.aiPipeline && expedienteId && onAiAnalysisReady);

  const reset = () => {
    setKind("OC"); setCodigo(""); setFile(null);
    setError(null); setUploading(false); setAiPhase(null);
  };

  const validate = (f) => {
    if (!f) return "Selecciona un archivo";
    if (f.size > 20 * 1024 * 1024) {
      return lang === "es" ? "Maximo 20MB" : "Max 20MB";
    }
    const ok = /\.(pdf|png|jpe?g|xml|xlsx?|docx?)$/i.test(f.name);
    if (!ok) {
      return lang === "es"
        ? "Formato no admitido (PDF, imagen, Excel, Word, XML)"
        : "Format not allowed (PDF, image, Excel, Word, XML)";
    }
    return null;
  };

  const onPickFile = (f) => {
    const err = validate(f);
    if (err) { setError(err); return; }
    setError(null);
    setFile(f);
  };

  const onSubmit = async () => {
    if (!file) { setError(lang === "es" ? "Sube un archivo" : "Upload a file"); return; }
    if (!kind) { setError(lang === "es" ? "Elige el tipo" : "Pick a type"); return; }
    setUploading(true); setError(null); setAiPhase("uploading");
    try {
      // 1) Persistir el documento en /api/documentos/ (siempre).
      const fd = new FormData();
      fd.append("kind", kind);
      fd.append("codigo", (codigo || "").trim() || file.name);
      fd.append("file", file, file.name);
      if (ocId) fd.append("oc_id", ocId);
      if (expedienteId) fd.append("expediente_id", expedienteId);

      const token = getToken();
      const resp = await fetch(`${API_BASE}/documentos/`, {
        method: "POST",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: fd,
      });
      const text = await resp.text();
      let data = null;
      if (text) { try { data = JSON.parse(text); } catch { data = { raw: text }; } }
      if (!resp.ok) {
        throw new Error(data?.detail || data?.error || `HTTP ${resp.status}`);
      }

      // BUG FIX 2026-05-02 (AG-03): NO disparamos `onUploaded(data)` antes
      // de la IA. El padre típicamente reacciona haciendo `navigate(0)` con
      // un setTimeout(200ms), lo que aborta la promesa IA en vuelo y nunca
      // se abre el wizard de revisión. Cuando hay IA, el padre va a
      // refrescar al cerrar el wizard (vía onApplied). Cuando NO hay IA,
      // sí disparamos onUploaded al final para refrescar el listado.

      // 2) Si aplica, encadenar extracción IA + matchmaker.
      if (aiEligible) {
        setAiPhase("analyzing");
        try {
          const ai = await documentMatchmakerApi.upload(
            expedienteId, file, kindObj.aiPipeline,
          );
          // Pasamos `data` al padre para que pueda hidratar el listado de
          // documentos sin esperar la recarga (mejor UX).
          onAiAnalysisReady?.(ai, file, kindObj.aiPipeline, data);
          reset();
          onClose?.();
          return;
        } catch (aiErr) {
          // Falla en IA NO debe bloquear el flujo: el doc ya se guardó.
          // Avisamos al padre del upload exitoso y mostramos el aviso.
          // eslint-disable-next-line no-console
          console.warn("[UploadDocumentModal] IA matchmaker falló:", aiErr);
          onUploaded?.(data);
          setError(
            lang === "es"
              ? "Documento subido, pero el análisis IA falló. Podés reprocesarlo desde Documentos comerciales."
              : "Document uploaded, but AI analysis failed. You can reprocess it from Commercial documents."
          );
          setUploading(false);
          setAiPhase(null);
          return;
        }
      }

      // Sin IA → fire onUploaded para que el padre refresque el listado.
      onUploaded?.(data);
      reset();
      onClose?.();
    } catch (e) {
      setError(e.message || (lang === "es" ? "Error al subir" : "Upload error"));
      setAiPhase(null);
    } finally {
      setUploading(false);
    }
  };

  const onDrop = (ev) => {
    ev.preventDefault();
    setDragOver(false);
    const f = ev.dataTransfer.files?.[0];
    if (f) onPickFile(f);
  };

  const cta = (() => {
    if (aiPhase === "analyzing") {
      return lang === "es" ? "Analizando con IA…" : "Analyzing with AI…";
    }
    if (uploading) {
      return lang === "es" ? "Subiendo…" : "Uploading…";
    }
    if (aiEligible) {
      return lang === "es" ? "Subir y analizar con IA" : "Upload & analyze with AI";
    }
    return lang === "es" ? "Subir documento" : "Upload document";
  })();

  return (
    <div
      onClick={() => !uploading && onClose?.()}
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(11,30,58,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "white", borderRadius: 14,
          width: "min(560px, 96vw)", maxHeight: "90vh",
          boxShadow: "0 30px 60px -20px rgba(15,27,61,0.55)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "14px 20px",
          borderBottom: "1px solid var(--border-subtle)",
          background: "linear-gradient(135deg, rgba(48,131,254,0.04), rgba(0,178,134,0.03))",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: "var(--brand-info, #3083FE)", color: "white",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <IconUpload size={14}/>
            </div>
            <div>
              <div className="micro" style={{
                color: "var(--text-tertiary)", letterSpacing: 1,
              }}>
                {lang === "es" ? "DOCUMENTO COMERCIAL" : "COMMERCIAL DOCUMENT"}
              </div>
              <div style={{ fontWeight: 800, fontSize: 15, color: "var(--text-primary)" }}>
                {lang === "es" ? "Agregar documento" : "Add document"}
                {contextLabel && (
                  <span className="caption mono-sm" style={{
                    marginLeft: 8, color: "var(--text-tertiary)",
                    fontWeight: 500, fontSize: 12,
                  }}>· {contextLabel}</span>
                )}
              </div>
            </div>
          </div>
          <button
            type="button" disabled={uploading}
            onClick={onClose}
            className="btn btn-ghost btn-sm" style={{ padding: "6px 8px" }}
          >
            <IconX size={11}/>
          </button>
        </div>

        {/* Body */}
        <div style={{
          padding: 20, display: "flex", flexDirection: "column", gap: 14,
          overflowY: "auto",
        }}>
          {/* Tipo de documento */}
          <div>
            <div className="micro" style={{
              fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
              color: "var(--text-tertiary)", textTransform: "uppercase",
              marginBottom: 6,
            }}>
              {lang === "es" ? "Tipo de documento" : "Document type"}{" "}
              <span style={{ color: "var(--danger, #DC2626)" }}>*</span>
            </div>
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(2, 1fr)",
              gap: 8,
            }}>
              {DOCUMENT_KINDS.map((k) => {
                const active = kind === k.id;
                const hasAi = !!k.aiPipeline && !!expedienteId && !!onAiAnalysisReady;
                return (
                  <button
                    key={k.id} type="button"
                    onClick={() => setKind(k.id)}
                    disabled={uploading}
                    style={{
                      padding: "8px 10px",
                      border: active
                        ? "1.5px solid var(--success, #00B286)"
                        : "1px solid var(--border)",
                      borderRadius: 8,
                      background: active
                        ? "color-mix(in oklab, var(--success, #00B286) 6%, transparent)"
                        : "white",
                      cursor: uploading ? "not-allowed" : "pointer",
                      textAlign: "left",
                      fontSize: 13, fontWeight: 600, color: "var(--text-primary)",
                      display: "flex", alignItems: "center", gap: 6,
                      position: "relative",
                    }}
                  >
                    {active
                      ? <IconCheck size={12} style={{ color: "var(--success, #00B286)", flexShrink: 0 }}/>
                      : <IconFileText size={12} style={{ color: "var(--text-tertiary)", flexShrink: 0 }}/>}
                    <span style={{ flex: 1 }}>{lang === "es" ? k.es : k.en}</span>
                    {hasAi && (
                      <span
                        title={lang === "es" ? "Análisis con IA disponible" : "AI analysis available"}
                        style={{
                          fontSize: 10, fontWeight: 700, padding: "2px 6px",
                          borderRadius: 999,
                          background: "color-mix(in oklab, var(--brand-accent, #481EE3) 12%, transparent)",
                          color: "var(--brand-accent, #481EE3)",
                          letterSpacing: 0.4,
                          display: "inline-flex", alignItems: "center", gap: 3,
                        }}
                      >
                        <IconSparkle size={9}/> IA
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="caption" style={{
              marginTop: 6, fontSize: 11,
              color: "var(--text-tertiary)", lineHeight: 1.4,
            }}>
              {lang === "es" ? kindObj.hint_es : kindObj.hint_en}
              {aiEligible && (
                <>
                  {" "}
                  <span style={{ color: "var(--brand-accent, #481EE3)", fontWeight: 600 }}>
                    {lang === "es"
                      ? "· La IA leerá el documento y mapeará los productos contra el catálogo."
                      : "· AI will OCR the doc and match products against the catalog."}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Numero / Codigo del documento */}
          <label style={{ display: "block" }}>
            <div className="micro" style={{
              fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
              color: "var(--text-tertiary)", textTransform: "uppercase",
              marginBottom: 6,
            }}>
              {lang === "es" ? "Numero / Codigo (opcional)" : "Number / Code (optional)"}
            </div>
            <input
              type="text" className="input mono-sm"
              value={codigo}
              disabled={uploading}
              onChange={(e) => setCodigo(e.target.value)}
              placeholder={
                kind === "OC" ? "PO-..." :
                kind === "PROFORMA" ? "PF-..." :
                kind === "FACTURA" ? "FAC-..." :
                lang === "es" ? "Identificador (opcional)" : "Identifier (optional)"
              }
              style={{
                width: "100%", fontSize: 13, padding: "10px 12px",
                border: "1px solid var(--border)", borderRadius: 8,
                fontFamily: "var(--font-mono, monospace)",
              }}
            />
          </label>

          {/* Drop zone */}
          <div>
            <div className="micro" style={{
              fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
              color: "var(--text-tertiary)", textTransform: "uppercase",
              marginBottom: 6,
            }}>
              {lang === "es" ? "Archivo" : "File"}{" "}
              <span style={{ color: "var(--danger, #DC2626)" }}>*</span>
            </div>
            <div
              onClick={() => !uploading && inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              role="button" tabIndex={0}
              style={{
                border: dragOver
                  ? "2px dashed var(--success, #00B286)"
                  : file
                    ? "1.5px solid var(--success, #00B286)"
                    : "2px dashed var(--border)",
                borderRadius: 12,
                background: dragOver
                  ? "color-mix(in oklab, var(--success, #00B286) 6%, transparent)"
                  : file ? "color-mix(in oklab, var(--success, #00B286) 4%, transparent)" : "white",
                padding: file ? "14px 16px" : "32px 20px",
                textAlign: "center",
                cursor: uploading ? "not-allowed" : "pointer",
                transition: "all 0.15s",
              }}
            >
              <input
                ref={inputRef} type="file"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onPickFile(f);
                }}
                accept=".pdf,.png,.jpg,.jpeg,.xml,.xlsx,.xls,.docx,.doc"
              />
              {file ? (
                <div style={{
                  display: "flex", alignItems: "center", gap: 12,
                  textAlign: "left",
                }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 8,
                    background: "color-mix(in oklab, var(--success, #00B286) 10%, transparent)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "var(--success, #00B286)", flexShrink: 0,
                  }}>
                    <IconFileText size={16}/>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 13, fontWeight: 700, color: "var(--text-primary)",
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    }}>{file.name}</div>
                    <div className="caption tabular-nums" style={{
                      fontSize: 11, color: "var(--text-tertiary)", marginTop: 2,
                    }}>
                      {prettyBytes(file.size)}
                    </div>
                  </div>
                  <button
                    type="button" disabled={uploading}
                    onClick={(e) => { e.stopPropagation(); setFile(null); }}
                    style={{
                      background: "transparent", border: 0,
                      color: "var(--danger, #D64545)", cursor: "pointer", padding: 6,
                    }}
                  >
                    <IconX size={12}/>
                  </button>
                </div>
              ) : (
                <>
                  <IconUpload size={28} style={{
                    color: dragOver ? "var(--success, #00B286)" : "var(--text-tertiary)",
                    marginBottom: 8,
                  }}/>
                  <div style={{
                    fontSize: 14, fontWeight: 600, color: "var(--text-primary)",
                    marginBottom: 4,
                  }}>
                    {lang === "es"
                      ? "Arrastra el archivo aqui"
                      : "Drag & drop the file here"}
                  </div>
                  <div className="caption" style={{
                    fontSize: 12, color: "var(--text-tertiary)",
                  }}>
                    {lang === "es"
                      ? "o hace click para seleccionar (max 20MB)"
                      : "or click to select (max 20MB)"}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Estado IA en curso */}
          {aiPhase === "analyzing" && (
            <div style={{
              padding: "10px 14px", borderRadius: 8,
              background: "color-mix(in oklab, var(--brand-accent, #481EE3) 8%, transparent)",
              border: "1px solid color-mix(in oklab, var(--brand-accent, #481EE3) 30%, transparent)",
              color: "var(--brand-accent, #481EE3)", fontSize: 13,
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <IconSparkle size={12}/>
              <div>
                <div style={{ fontWeight: 700 }}>
                  {lang === "es"
                    ? "La IA está leyendo el documento…"
                    : "AI is reading the document…"}
                </div>
                <div className="caption" style={{ fontSize: 11, marginTop: 2 }}>
                  {lang === "es"
                    ? "Extrayendo productos, tallas y cantidades. Tarda 5–15 s."
                    : "Extracting products, sizes and qtys. Takes 5–15 s."}
                </div>
              </div>
            </div>
          )}

          {error && (
            <div style={{
              padding: "8px 12px", borderRadius: 8,
              background: "color-mix(in oklab, var(--danger, #DC2626) 14%, transparent)",
              color: "var(--danger, #991B1B)",
              border: "1px solid color-mix(in oklab, var(--danger, #DC2626) 35%, transparent)",
              fontSize: 13,
              display: "flex", alignItems: "flex-start", gap: 6,
            }}>
              <IconAlert size={11} style={{ flexShrink: 0, marginTop: 3 }}/>
              <div>{error}</div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "12px 20px",
          borderTop: "1px solid var(--border-subtle)",
          background: "color-mix(in oklab, var(--text-primary) 2%, transparent)",
          display: "flex", justifyContent: "flex-end", gap: 8,
        }}>
          <button
            type="button" disabled={uploading}
            onClick={onClose}
            className="btn btn-ghost"
          >
            {lang === "es" ? "Cancelar" : "Cancel"}
          </button>
          <button
            type="button"
            disabled={uploading || !file || !kind}
            onClick={onSubmit}
            className="btn btn-accent"
            style={{
              fontWeight: 700, minWidth: 180,
              background: aiEligible ? "var(--brand-accent, #481EE3)" : "var(--success, #00B286)",
              borderColor: aiEligible ? "var(--brand-accent, #481EE3)" : "var(--success, #00B286)",
            }}
          >
            {aiEligible ? <IconSparkle size={12}/> : <IconCheck size={12}/>}
            <span style={{ marginLeft: 6 }}>{cta}</span>
          </button>
        </div>
      </div>
    </div>
  );
}