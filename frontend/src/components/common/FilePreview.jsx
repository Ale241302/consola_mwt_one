// =====================================================================
// MWT.ONE · components/common/FilePreview.jsx
// Agente responsable: [AG-FRONTEND]
//
// Renderiza un preview de un archivo en MinIO/S3 dado su `key`.
// Pide al backend una signed GET URL temporal y muestra:
//   · imagen → <img>
//   · PDF    → <iframe>
//   · resto  → botón "Descargar" + nombre derivado de la key
//
// Props:
//   keyOrUrl   → key del bucket ("producto/abc/xyz.pdf") o URL absoluta
//                  (https://...). Si empieza con "http" usamos directo.
//   mime       → mime type (opcional). Si falta inferimos de la extensión.
//   filename   → nombre a mostrar en el botón "Descargar". Si falta,
//                  usamos el último segmento de la key.
//   height     → alto del preview cuando es img/pdf (default 320)
//   onDelete   → opcional. Si se pasa, renderiza botón rojo "Eliminar"
//                  que dispara el callback. El padre debe llamar al
//                  endpoint /api/storage/delete/ + actualizar su modelo.
//
// Uso:
//   <FilePreview keyOrUrl={producto.ficha_url}
//                mime="application/pdf"
//                onDelete={() => askDelete(producto.ficha_url)} />
// =====================================================================
import React, { useEffect, useState } from "react";
import { apiFetch, getToken } from "../../lib/api.js";

const MIME_BY_EXT = {
  pdf:  "application/pdf",
  jpg:  "image/jpeg", jpeg: "image/jpeg",
  png:  "image/png",  webp: "image/webp",
  gif:  "image/gif",  svg:  "image/svg+xml",
  mp4:  "video/mp4",  webm: "video/webm",
  mp3:  "audio/mpeg", wav:  "audio/wav",
  csv:  "text/csv",   txt:  "text/plain",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls:  "application/vnd.ms-excel",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc:  "application/msword",
  zip:  "application/zip",
};

function guessMime(keyOrUrl) {
  if (!keyOrUrl) return "";
  const ext = String(keyOrUrl).split("?")[0].split(".").pop().toLowerCase();
  return MIME_BY_EXT[ext] || "";
}

function basename(keyOrUrl) {
  if (!keyOrUrl) return "";
  return String(keyOrUrl).split("?")[0].split("/").pop();
}

export default function FilePreview({
  keyOrUrl,
  mime,
  filename,
  height = 320,
  onDelete,
}) {
  const [signedUrl, setSignedUrl] = useState(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);

  const isAbsolute = typeof keyOrUrl === "string" && /^https?:\/\//i.test(keyOrUrl);
  const finalMime  = (mime || guessMime(keyOrUrl) || "").toLowerCase();
  const fname      = filename || basename(keyOrUrl);

  useEffect(() => {
    setError(null);
    if (!keyOrUrl) { setSignedUrl(null); return; }
    if (isAbsolute) { setSignedUrl(keyOrUrl); return; }
    // Stream proxy a través de Django (HTTPS, sin mixed-content).
    // El endpoint /api/storage/download/ es AllowAny (la key UUID actúa
    // como secret) — necesario para que <img src=...> y <iframe src=...>
    // funcionen sin necesidad de mandar Authorization header.
    setSignedUrl(`${window.location.origin}/api/storage/download/?key=${encodeURIComponent(keyOrUrl)}`);
  }, [keyOrUrl, isAbsolute]);

  if (!keyOrUrl) {
    return (
      <div style={emptyBox}>Sin archivo adjunto</div>
    );
  }
  if (loading) {
    return <div style={emptyBox}>Cargando preview…</div>;
  }
  if (error) {
    return (
      <div style={{ ...emptyBox, color: "#991B1B", background: "#FEE2E2", borderColor: "#FCA5A5" }}>
        {error}
      </div>
    );
  }
  if (!signedUrl) {
    return <div style={emptyBox}>—</div>;
  }

  const isImage = finalMime.startsWith("image/");
  const isPdf   = finalMime === "application/pdf";
  const isVideo = finalMime.startsWith("video/");
  const isAudio = finalMime.startsWith("audio/");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      {isImage && (
        <a href={signedUrl} target="_blank" rel="noreferrer">
          <img src={signedUrl} alt={fname}
               style={{
                 maxWidth: "100%", maxHeight: height,
                 borderRadius: 8, border: "1px solid #E5EAF2",
                 objectFit: "contain", display: "block",
               }}/>
        </a>
      )}

      {isPdf && (
        <div
          onClick={(e) => {
            e.preventDefault();
            if (signedUrl) {
              window.open(signedUrl, "_blank", "width=850,height=850,resizable=yes,scrollbars=yes");
            }
          }}
          style={{
            padding: "16px 18px",
            border: "1px solid #E5EAF2",
            borderRadius: 8,
            background: "#F8FAFC",
            font: "500 13px/1.4 inherit",
            color: "#3D4A6B",
            display: "flex",
            alignItems: "center",
            gap: 12,
            cursor: "pointer",
            transition: "all 0.2s ease",
            minWidth: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "#CBD5E1";
            e.currentTarget.style.background = "#F1F5F9";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "#E5EAF2";
            e.currentTarget.style.background = "#F8FAFC";
          }}
        >
          <span style={{ fontSize: 24 }}>📄</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontWeight: 600, color: "#0F1B3D",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{fname}</div>
            <div style={{ font: "500 11.5px/1.3 inherit", color: "#64748B" }}>
              Documento PDF · Clic para abrir en ventana nueva
            </div>
          </div>
          <span style={{ fontSize: 16, color: "#64748B" }}>↗</span>
        </div>
      )}

      {isVideo && (
        <video src={signedUrl} controls preload="metadata"
               style={{ width: "100%", maxHeight: height, borderRadius: 8 }}/>
      )}

      {isAudio && (
        <audio src={signedUrl} controls style={{ width: "100%" }}/>
      )}

      {!isImage && !isPdf && !isVideo && !isAudio && (
        <div style={{
          padding: "16px 18px", border: "1px solid #E5EAF2", borderRadius: 8,
          background: "#F8FAFC",
          font: "500 13px/1.4 inherit", color: "#3D4A6B",
          display: "flex", alignItems: "center", gap: 12,
          minWidth: 0,
        }}>
          <span style={{ fontSize: 22 }}>📄</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontWeight: 600, color: "#0F1B3D",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{fname}</div>
            <div style={{ font: "500 11.5px/1.3 inherit", color: "#64748B" }}>
              {finalMime || "tipo desconocido"} · preview no disponible
            </div>
          </div>
        </div>
      )}

      {/* Acciones */}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
        <a href={signedUrl} target="_blank" rel="noreferrer" download={fname}
           style={linkBtn}>
          ↓ Descargar
        </a>
        {onDelete && (
          <button type="button" onClick={onDelete} style={dangerBtn}>
            Eliminar
          </button>
        )}
      </div>
    </div>
  );
}

const emptyBox = {
  padding: "16px 18px", border: "1px dashed #CBD5E1", borderRadius: 8,
  color: "#64748B", font: "500 13px/1.4 inherit", textAlign: "center",
  background: "#F8FAFC",
};
const linkBtn = {
  padding: "6px 12px", borderRadius: 6,
  background: "#F1F4F9", color: "#0F1B3D",
  font: "600 12px/1 inherit", textDecoration: "none",
  border: "1px solid #E5EAF2",
};
const dangerBtn = {
  padding: "6px 12px", borderRadius: 6,
  background: "transparent", color: "#DC2626",
  font: "600 12px/1 inherit", cursor: "pointer",
  border: "1px solid rgba(220,38,38,0.30)",
};
