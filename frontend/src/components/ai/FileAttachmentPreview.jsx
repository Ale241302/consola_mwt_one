// =====================================================================
// MWT.ONE · components/ai/FileAttachmentPreview.jsx
// Agente: [AG-FRONTEND]
//
// Render compacto de un AiAttachment (server) o de un File en cola.
//   props:
//     attachment? : { id, filename, mime, size, extracted_text?, ... }
//     file?       : File   (preview cliente antes de subir)
//     uploading?  : bool
//     onRemove?   : () => void
//
// Muestra ícono según el MIME family + nombre + tamaño + estado.
// =====================================================================
import React, { useEffect, useState } from "react";
import { IconImage, IconFileText, IconX, IconRefresh } from "../../lib/icons.jsx";

function formatBytes(n) {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function MimeIcon({ mime }) {
  const m = (mime || "").toLowerCase();
  if (m.startsWith("image/")) return <IconImage size={16} />;
  return <IconFileText size={16} />;
}

export default function FileAttachmentPreview({
  attachment, file, uploading = false, onRemove,
}) {
  const data = attachment || {};
  const filename = data.filename || file?.name || "archivo";
  const size     = data.size_bytes ?? data.size ?? file?.size;
  const mime     = data.mime || file?.type || "application/octet-stream";

  // Generar preview cliente para imágenes en cola
  const [previewUrl, setPreviewUrl] = useState(null);
  useEffect(() => {
    if (!file || !mime.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file, mime]);

  return (
    <div
      className="ai-attachment-preview"
      title={filename}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px 6px 8px",
        borderRadius: 8,
        background: "var(--surface-elevated, #fff)",
        border: "1px solid var(--border-default, #E5E7EB)",
        font: "500 12px/1.2 var(--font-body)",
        color: "var(--text-primary)",
        maxWidth: 240,
      }}
    >
      {previewUrl ? (
        <img
          src={previewUrl}
          alt={filename}
          style={{ width: 28, height: 28, objectFit: "cover", borderRadius: 4 }}
        />
      ) : (
        <span style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 28, height: 28, borderRadius: 6,
          background: mime.startsWith("image/") ? "rgba(48,131,254,0.10)" : "rgba(0,178,134,0.10)",
          color:     mime.startsWith("image/") ? "#3083FE" : "#00B286",
        }}>
          <MimeIcon mime={mime} />
        </span>
      )}

      <span style={{ display: "flex", flexDirection: "column", overflow: "hidden", flex: 1 }}>
        <span style={{
          fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {filename}
        </span>
        <span style={{ font: "500 10.5px/1.1 var(--font-body)", color: "var(--text-tertiary)" }}>
          {uploading ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <IconRefresh size={10} /> Subiendo…
            </span>
          ) : (
            <>{formatBytes(size)} · {(mime.split("/")[1] || mime).toUpperCase()}</>
          )}
        </span>
      </span>

      {onRemove && !uploading && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          aria-label={`Quitar ${filename}`}
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 18, height: 18, padding: 0,
            border: "none", background: "transparent",
            color: "var(--text-tertiary)", cursor: "pointer",
          }}
        >
          <IconX size={12} />
        </button>
      )}
    </div>
  );
}
