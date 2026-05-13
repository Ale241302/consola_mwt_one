// =====================================================================
// MWT.ONE · DynamicField — renderiza UN campo del structure_json.
// Tipos soportados (alineados con Builder Preview.jsx):
//   text · textarea · number · date · select · radio · checkbox ·
//   code · file
//
// Sprint 2026-05-11 fase 7++ · El tipo `file` ahora sube de verdad a
// MinIO via /api/storage/upload-proxy/ y conserva la URL para que al
// reabrir el modal se muestre preview de imagen o icono del archivo
// con click → ventana nueva.
// =====================================================================
import React, { useRef, useState } from "react";
import { storageApi } from "../../../lib/api.js";
import { IconUpload, IconFileText, IconX } from "../../../lib/icons.jsx";

function normalizeOptions(opts) {
  if (!Array.isArray(opts)) return [];
  return opts.map((o, i) =>
    typeof o === "string"
      ? { id: `opt-${i}`, label: o }
      : { id: o.id || `opt-${i}`, label: o.label ?? String(o) }
  );
}

// ────────────────────────────────────────────────────────
// FilePicker — case "file" como subcomponente para encapsular el state
// (upload progress, error) sin contaminar el switch principal.
// ────────────────────────────────────────────────────────
function FilePicker({ value, onChange, disabled, lang, field }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError]         = useState(null);

  // Normalizamos `value` a un shape consistente:
  //   { key, url, name, mime, size, uploaded_at }
  // value puede venir como objeto (caso nuevo) o string (legado).
  const v = (value && typeof value === "object") ? value : null;
  const fileName = v?.name || v?.file_name || "";
  const fileMime = v?.mime || v?.content_type || "";
  const fileSize = Number(v?.size || 0);
  // URL final que abre en una pestaña nueva. Si tenemos `key`, usamos
  // el download-proxy de Django (HTTPS, sin mixed-content); si solo
  // tenemos `url` (legado), la usamos tal cual.
  const openUrl = v?.key ? storageApi.downloadUrl(v.key) : (v?.url || "");
  const hasFile = !!openUrl;

  const isImage = (fileMime || "").startsWith("image/")
    || /\.(png|jpe?g|gif|webp|svg)$/i.test(fileName);
  const isPdf   = (fileMime || "").includes("pdf")
    || /\.pdf$/i.test(fileName);

  const fmtBytes = (n) => {
    if (!n) return "";
    const u = ["B", "KB", "MB", "GB"];
    let i = 0; let val = n;
    while (val >= 1024 && i < u.length - 1) { val /= 1024; i++; }
    return `${val.toFixed(val < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
  };

  const handleSelect = async (file) => {
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const resp = await storageApi.uploadProxy({
        file,
        scope:    `artifact-field/${field.id || "misc"}`,
        filename: file.name,
      });
      // resp: { ok, key, bucket, etag, content_type, size }
      onChange?.({
        key:          resp.key,
        url:          storageApi.downloadUrl(resp.key),
        name:         file.name,
        mime:         resp.content_type || file.type || "",
        size:         resp.size || file.size || 0,
        uploaded_at:  new Date().toISOString(),
      });
    } catch (e) {
      setError(e?.body?.detail || e?.message
        || (lang === "es" ? "Error al subir archivo" : "Upload error"));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const clearFile = () => {
    setError(null);
    onChange?.(null);
  };

  // ── Render: si ya hay archivo, mostramos preview/icono + acciones.
  if (hasFile && !uploading) {
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "8px 10px",
        border: "1px solid var(--border-subtle)",
        borderRadius: 10,
        background: "var(--surface, white)",
      }}>
        {/* Preview: imagen vs icono */}
        {isImage ? (
          <a href={openUrl} target="_blank" rel="noreferrer"
             title={lang === "es" ? "Abrir en nueva pestaña" : "Open in new tab"}
             style={{ display: "inline-block", flexShrink: 0 }}>
            <img
              src={openUrl}
              alt={fileName}
              style={{
                width: 56, height: 56, objectFit: "cover",
                borderRadius: 8,
                border: "1px solid var(--border-subtle)",
                cursor: "pointer",
              }}
            />
          </a>
        ) : (
          <a href={openUrl} target="_blank" rel="noreferrer"
             title={lang === "es" ? "Abrir en nueva pestaña" : "Open in new tab"}
             style={{
               width: 56, height: 56, flexShrink: 0,
               borderRadius: 8, border: "1px solid var(--border-subtle)",
               background: isPdf
                 ? "color-mix(in oklab, var(--critical) 10%, transparent)"
                 : "color-mix(in oklab, var(--brand-primary, #481EE3) 10%, transparent)",
               color: isPdf
                 ? "var(--critical, #DC2626)"
                 : "var(--brand-primary, #481EE3)",
               display: "grid", placeItems: "center",
               cursor: "pointer",
               textDecoration: "none",
               fontWeight: 800, fontSize: 11,
             }}>
            <IconFileText size={20}/>
            <span style={{ marginTop: -2 }}>
              {isPdf ? "PDF" : (fileName.split(".").pop() || "FILE").slice(0, 4).toUpperCase()}
            </span>
          </a>
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <a href={openUrl} target="_blank" rel="noreferrer"
             style={{
               fontWeight: 600, fontSize: 13,
               color: "var(--text-primary)",
               textDecoration: "none",
               display: "block",
               overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
             }}>
            {fileName || (lang === "es" ? "Archivo" : "File")}
          </a>
          <div className="caption" style={{
            color: "var(--text-tertiary)", fontSize: 11, marginTop: 2,
          }}>
            {fmtBytes(fileSize)}{fileMime ? ` · ${fileMime}` : ""}
          </div>
        </div>

        {!disabled && (
          <>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => inputRef.current?.click()}
              title={lang === "es" ? "Reemplazar archivo" : "Replace file"}
              style={{ flexShrink: 0 }}
            >
              <IconUpload size={12}/>
              {lang === "es" ? "Reemplazar" : "Replace"}
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={clearFile}
              title={lang === "es" ? "Quitar archivo" : "Remove file"}
              style={{ width: 28, height: 28, color: "var(--critical)" }}
            >
              <IconX size={12}/>
            </button>
          </>
        )}

        <input
          ref={inputRef}
          type="file"
          hidden
          disabled={disabled}
          onChange={(e) => handleSelect(e.target.files?.[0])}
        />
      </div>
    );
  }

  // ── Render: empty / uploading.
  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => !disabled && !uploading && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !disabled && !uploading) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => { e.preventDefault(); }}
        onDrop={(e) => {
          e.preventDefault();
          if (disabled || uploading) return;
          const f = e.dataTransfer?.files?.[0];
          if (f) handleSelect(f);
        }}
        style={{
          border: "1.5px dashed var(--border-subtle)",
          borderRadius: 10,
          padding: "14px 12px",
          textAlign: "center",
          cursor: disabled ? "not-allowed" : (uploading ? "wait" : "pointer"),
          background: "var(--surface-alt, rgba(11,30,58,0.02))",
          color: uploading
            ? "var(--text-tertiary)"
            : "var(--text-secondary)",
          transition: "all 0.15s",
          opacity: disabled ? 0.55 : 1,
        }}
      >
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <IconUpload size={14} style={{
            color: "var(--brand-accent, #0E8A6D)",
          }}/>
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            {uploading
              ? (lang === "es" ? "Subiendo…" : "Uploading…")
              : (lang === "es"
                  ? "Suelta un archivo o haz click"
                  : "Drop a file or click")}
          </span>
        </div>
      </div>
      {error && (
        <div className="caption" style={{
          marginTop: 6, color: "var(--critical)", fontSize: 11.5,
        }}>
          {error}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        hidden
        disabled={disabled || uploading}
        onChange={(e) => handleSelect(e.target.files?.[0])}
      />
    </div>
  );
}

export default function DynamicField({ field, value, onChange, disabled, lang = "es" }) {
  const handle = (v) => onChange?.(v);
  const ph = field.placeholder || (lang === "es" ? "" : "");

  switch (field.type) {
    case "text":
      return (
        <input
          className="input"
          type="text"
          value={value ?? ""}
          placeholder={ph}
          onChange={(e) => handle(e.target.value)}
          disabled={disabled}
        />
      );

    case "textarea":
      return (
        <textarea
          className="input"
          rows={4}
          value={value ?? ""}
          placeholder={ph}
          onChange={(e) => handle(e.target.value)}
          disabled={disabled}
        />
      );

    case "number":
      return (
        <input
          className="input tabular"
          type="number"
          value={value ?? ""}
          placeholder={ph}
          onChange={(e) =>
            handle(e.target.value === "" ? null : Number(e.target.value))
          }
          disabled={disabled}
        />
      );

    case "date":
      return (
        <input
          className="input tabular"
          type="date"
          value={value ?? ""}
          onChange={(e) => handle(e.target.value)}
          disabled={disabled}
        />
      );

    case "select": {
      const opts = normalizeOptions(field.options);
      return (
        <select
          className="select"
          value={value ?? ""}
          onChange={(e) => handle(e.target.value)}
          disabled={disabled}
        >
          <option value="">
            {lang === "es" ? "— seleccionar —" : "— select —"}
          </option>
          {opts.map((o) => (
            <option key={o.id} value={o.label}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }

    case "radio": {
      const opts = normalizeOptions(field.options);
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {opts.map((o) => (
            <label
              key={o.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                color: "var(--text-primary)",
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.6 : 1,
              }}
            >
              <input
                type="radio"
                name={field.id}
                checked={value === o.label}
                onChange={() => handle(o.label)}
                disabled={disabled}
                style={{ accentColor: "var(--brand-primary)" }}
              />
              {o.label}
            </label>
          ))}
        </div>
      );
    }

    case "checkbox":
      return (
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            color: "var(--text-primary)",
            cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.6 : 1,
          }}
        >
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => handle(e.target.checked)}
            disabled={disabled}
            style={{ accentColor: "var(--brand-primary)" }}
          />
          {field.placeholder || field.label}
        </label>
      );

    case "code":
      return (
        <textarea
          className="input"
          rows={8}
          spellCheck={false}
          value={value ?? field.code ?? ""}
          placeholder={ph}
          onChange={(e) => handle(e.target.value)}
          disabled={disabled}
          style={{
            fontFamily: "var(--font-mono, JetBrains Mono, monospace)",
            fontSize: 12,
            lineHeight: 1.5,
          }}
        />
      );

    case "file":
      // Sprint 2026-05-11 fase 7++ · upload real a MinIO + preview/icono.
      return (
        <FilePicker
          field={field}
          value={value}
          onChange={onChange}
          disabled={disabled}
          lang={lang}
        />
      );

    default:
      return (
        <span className="caption" style={{ color: "var(--text-tertiary)" }}>
          {lang === "es" ? "Tipo no soportado:" : "Unsupported type:"}{" "}
          {field.type}
        </span>
      );
  }
}
