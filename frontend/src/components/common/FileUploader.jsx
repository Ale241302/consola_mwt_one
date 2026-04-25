// =====================================================================
// MWT.ONE · components/common/FileUploader.jsx
// Agente responsable: [AG-FRONTEND]
//
// Componente reusable para subir archivos a MinIO/S3 vía signed URL.
// Flujo de 2 pasos:
//   1) POST /api/storage/upload-url/  → backend genera signed PUT + key
//   2) PUT directo a MinIO con el binario
// Al terminar invoca onUploaded(key, meta) para que el padre persista
// la `key` en su modelo (PATCH /api/<modelo>/<id>/ {ficha_url: key}).
//
// Props:
//   scope        → "carpeta" lógica en el bucket. Ej: "producto/<id>"
//   accept       → mime types aceptados (passthrough al <input>)
//   maxSizeMb    → límite de tamaño cliente. Default 25.
//   multiple     → permite múltiples archivos (default false)
//   onUploaded   → callback(key, {filename, content_type, size})
//                  llamado UNA VEZ por archivo subido con éxito
//   onError      → callback(errorString)
//   children     → render-prop opcional para personalizar el dropzone
//   label        → texto del placeholder cuando no hay children
//
// Uso típico:
//   <FileUploader
//     scope={`producto/${productId}`}
//     accept="image/*,application/pdf"
//     onUploaded={(key) => patch({ ficha_url: key })}
//   />
// =====================================================================
import React, { useRef, useState } from "react";
import { apiFetch, getToken } from "../../lib/api.js";

export default function FileUploader({
  scope = "misc",
  accept = "*/*",
  maxSizeMb = 25,
  multiple = false,
  onUploaded,
  onError,
  children,
  label,
}) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);   // 0..100 (null = idle)
  const [errorMsg, setErrorMsg] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  const triggerSelect = () => inputRef.current?.click();

  // Sube un único archivo vía /api/storage/upload-proxy/ (multipart).
  // Django recibe el binario por HTTPS y lo sube internamente a MinIO.
  // Esto evita el problema de Mixed Content cuando MinIO no tiene SSL público.
  const uploadOne = async (file) => {
    if (file.size > maxSizeMb * 1024 * 1024) {
      throw new Error(`Archivo > ${maxSizeMb} MB (${(file.size/1024/1024).toFixed(1)} MB)`);
    }
    const fd = new FormData();
    fd.append("file", file, file.name);
    fd.append("scope", scope);
    fd.append("filename", file.name);

    // XHR para tener progreso real (fetch no expone upload progress bien).
    return await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      // Mismo origen → respeta el HTTPS del navegador, no hay mixed-content.
      xhr.open("POST", `${window.location.origin}/api/storage/upload-proxy/`);
      const token = getToken();
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const r = JSON.parse(xhr.responseText || "{}");
            if (!r.ok || !r.key) {
              reject(new Error(r.error || "Upload no devolvió key"));
              return;
            }
            resolve({
              key:          r.key,
              filename:     file.name,
              content_type: r.content_type || file.type || "application/octet-stream",
              size:         file.size,
            });
          } catch (e) {
            reject(new Error("Respuesta inválida del backend"));
          }
        } else {
          let msg = `Upload falló (HTTP ${xhr.status})`;
          try {
            const r = JSON.parse(xhr.responseText || "{}");
            if (r.error || r.detail) msg += `: ${r.error || r.detail}`;
          } catch (_) {}
          reject(new Error(msg));
        }
      };
      xhr.onerror = () => reject(new Error("Network error en upload"));
      xhr.send(fd);
    });
  };

  const handleFiles = async (fileList) => {
    if (!fileList || fileList.length === 0) return;
    setBusy(true);
    setErrorMsg(null);
    setProgress(0);
    try {
      const files = Array.from(fileList);
      for (const f of files) {
        const meta = await uploadOne(f);
        onUploaded?.(meta.key, meta);
        if (!multiple) break;   // single mode: 1 y se acabó
      }
      setProgress(null);
    } catch (e) {
      const msg = e?.message || String(e);
      setErrorMsg(msg);
      onError?.(msg);
      setProgress(null);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";   // permite re-seleccionar el mismo archivo
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (busy) return;
    handleFiles(e.dataTransfer?.files);
  };

  // ── Render ────────────────────────────────────────
  // Si el padre pasa `children` lo dejamos a su criterio. Si no, mostramos
  // un dropzone básico con label + estado de progreso.
  const renderDefault = () => (
    <div
      onClick={busy ? undefined : triggerSelect}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      style={{
        border: `1.5px dashed ${dragOver ? "#10B981" : "#CBD5E1"}`,
        background: dragOver ? "#10B98110" : (busy ? "#F8FAFC" : "#FFFFFF"),
        borderRadius: 10,
        padding: "20px 16px",
        cursor: busy ? "wait" : "pointer",
        textAlign: "center",
        transition: "all 130ms ease",
        userSelect: "none",
      }}
    >
      {busy ? (
        <div>
          <div style={{ font: "600 13px/1.2 inherit", color: "#0F1B3D" }}>
            Subiendo… {progress != null ? `${progress}%` : ""}
          </div>
          {progress != null && (
            <div style={{
              marginTop: 8, height: 4, background: "#E2E8F0",
              borderRadius: 99, overflow: "hidden",
            }}>
              <div style={{
                width: `${progress}%`, height: "100%", background: "#10B981",
                transition: "width 80ms linear",
              }}/>
            </div>
          )}
        </div>
      ) : (
        <>
          <div style={{ font: "600 13px/1.2 inherit", color: "#0F1B3D" }}>
            {label || "Arrastra un archivo o click para seleccionar"}
          </div>
          <div style={{ font: "500 11.5px/1.4 inherit", color: "#64748B", marginTop: 4 }}>
            {accept !== "*/*" ? accept : "cualquier formato"} · máx {maxSizeMb} MB
          </div>
        </>
      )}
      {errorMsg && (
        <div style={{
          marginTop: 10, padding: "6px 10px", borderRadius: 6,
          background: "#FEE2E2", color: "#991B1B",
          font: "500 11.5px/1.4 inherit", textAlign: "left",
        }}>
          {errorMsg}
        </div>
      )}
    </div>
  );

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={(e) => handleFiles(e.target.files)}
        style={{ display: "none" }}
      />
      {typeof children === "function"
        ? children({ busy, progress, errorMsg, triggerSelect })
        : (children || renderDefault())}
    </div>
  );
}
