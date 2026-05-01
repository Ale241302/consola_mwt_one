// =====================================================================
// MWT.ONE · UploadDocumentModal
// Modal para subir documentos comerciales a la OC (OC original / Proforma /
// otros). Soporta drag-and-drop y persistencia via /api/documentos/.
//
// Sprint 2026-05-01: este modal lo invoca el boton "+ Agregar documento"
// del OCDetail y del ExpedienteDetail.
// =====================================================================
import React, { useState, useRef } from "react";
import {
  IconUpload, IconX, IconFileText, IconCheck, IconAlert,
} from "../../lib/icons.jsx";
import { documentosApi, getToken } from "../../lib/api.js";

const API_BASE = (import.meta && import.meta.env && import.meta.env.VITE_API_BASE) || "/api";

// Tipos de documento soportados (se envia en la columna `kind` del backend).
// Para cada uno: codigo interno + label visible + sugerencia (helper).
const DOCUMENT_KINDS = [
  { id: "OC",        es: "OC del Cliente",        en: "Client PO",
    hint_es: "Orden de Compra original recibida del cliente.",
    hint_en: "Original purchase order received from the client." },
  { id: "PROFORMA",  es: "Proforma",              en: "Proforma",
    hint_es: "Proforma emitida por MWT al cliente.",
    hint_en: "Proforma issued by MWT to the client." },
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
  onUploaded,        // (newDoc) => void
  lang = "es",
  ocId,              // UUID de la OC (opcional)
  expedienteId,      // UUID del expediente (opcional)
  contextLabel,      // "PO-2026-04107" para mostrar de referencia
}) {
  const [kind,    setKind]    = useState("OC");
  const [codigo,  setCodigo]  = useState("");
  const [file,    setFile]    = useState(null);
  const [error,   setError]   = useState(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver,  setDragOver]  = useState(false);
  const inputRef = useRef(null);

  if (!open) return null;

  const reset = () => {
    setKind("OC"); setCodigo(""); setFile(null);
    setError(null); setUploading(false);
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
    setUploading(true); setError(null);
    try {
      // Estrategia: subir como multipart al endpoint canonico de documentos.
      // El backend (apps.expedientes.documento) acepta:
      //   POST /api/documentos/  multipart con campos:
      //     kind, codigo, file, oc_id, expediente_id
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
      onUploaded?.(data);
      reset();
      onClose?.();
    } catch (e) {
      setError(e.message || (lang === "es" ? "Error al subir" : "Upload error"));
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

  const kindObj = DOCUMENT_KINDS.find(k => k.id === kind) || DOCUMENT_KINDS[0];

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
              background: "#3083FE", color: "white",
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
              <div style={{ fontWeight: 800, fontSize: 15, color: "#0B1E3A" }}>
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
              <span style={{ color: "#DC2626" }}>*</span>
            </div>
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(2, 1fr)",
              gap: 8,
            }}>
              {DOCUMENT_KINDS.map((k) => (
                <button
                  key={k.id} type="button"
                  onClick={() => setKind(k.id)}
                  disabled={uploading}
                  style={{
                    padding: "8px 10px",
                    border: kind === k.id
                      ? "1.5px solid #00B286"
                      : "1px solid var(--border)",
                    borderRadius: 8,
                    background: kind === k.id
                      ? "rgba(0,178,134,0.06)" : "white",
                    cursor: uploading ? "not-allowed" : "pointer",
                    textAlign: "left",
                    fontSize: 13, fontWeight: 600, color: "#0B1E3A",
                    display: "flex", alignItems: "center", gap: 6,
                  }}
                >
                  {kind === k.id && (
                    <IconCheck size={12} style={{ color: "#00B286", flexShrink: 0 }}/>
                  )}
                  {!kind || kind !== k.id
                    ? <IconFileText size={12} style={{ color: "var(--text-tertiary)", flexShrink: 0 }}/>
                    : null}
                  <span>{lang === "es" ? k.es : k.en}</span>
                </button>
              ))}
            </div>
            <div className="caption" style={{
              marginTop: 6, fontSize: 11,
              color: "var(--text-tertiary)", lineHeight: 1.4,
            }}>
              {lang === "es" ? kindObj.hint_es : kindObj.hint_en}
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
              <span style={{ color: "#DC2626" }}>*</span>
            </div>
            <div
              onClick={() => !uploading && inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              role="button" tabIndex={0}
              style={{
                border: dragOver
                  ? "2px dashed #00B286"
                  : file
                    ? "1.5px solid #00B286"
                    : "2px dashed var(--border)",
                borderRadius: 12,
                background: dragOver
                  ? "rgba(0,178,134,0.06)"
                  : file ? "rgba(0,178,134,0.04)" : "white",
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
                    background: "rgba(0,178,134,0.10)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "#00B286", flexShrink: 0,
                  }}>
                    <IconFileText size={16}/>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 13, fontWeight: 700, color: "#0B1E3A",
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
                      color: "#D64545", cursor: "pointer", padding: 6,
                    }}
                  >
                    <IconX size={12}/>
                  </button>
                </div>
              ) : (
                <>
                  <IconUpload size={28} style={{
                    color: dragOver ? "#00B286" : "var(--text-tertiary)",
                    marginBottom: 8,
                  }}/>
                  <div style={{
                    fontSize: 14, fontWeight: 600, color: "#0B1E3A",
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

          {error && (
            <div style={{
              padding: "8px 12px", borderRadius: 8,
              background: "#FEE2E2", color: "#991B1B",
              border: "1px solid #FCA5A5", fontSize: 13,
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
          background: "rgba(11,30,58,0.02)",
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
              fontWeight: 700, minWidth: 140,
              background: "#00B286", borderColor: "#00B286",
            }}
          >
            {uploading ? (
              <>
                <IconUpload size={12}/>
                {lang === "es" ? "Subiendo..." : "Uploading..."}
              </>
            ) : (
              <>
                <IconCheck size={12}/>
                {lang === "es" ? "Subir documento" : "Upload document"}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
