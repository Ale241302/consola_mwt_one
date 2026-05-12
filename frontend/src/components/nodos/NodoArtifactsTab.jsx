// ─────────────────────────────────────────────────────────────
// NodoArtifactsTab — tab "Artefactos" del detalle de un nodo
// Sprint 2026-05-11 · Fase 2 del paquete Nodos.
// Agente responsable: [AG-FRONTEND]
//
// Reglas:
//   R1 · Cero hex hardcodeados — usa tokens CSS de MWT.
//   R3 · Aislamiento por rol — la tab existe igual para todos; los
//        botones de mutación (Agregar / Eliminar) se ocultan si role
//        es CLIENT (B2B no toca artefactos del nodo).
//   R5 · tabular-nums para tamaños de archivo y fechas.
//
// API consumida (definida en lib/api.js):
//   nodoArtefactosApi.list / create / update / remove
//
// Diferencia con BuilderArtifactsBoard (expedientes):
//   - NO usa templates del Builder externo.
//   - Cualquier `tipo` (string libre) y cualquier `estado` (string libre).
//   - El mismo `tipo` puede aparecer repetido — la tabla no des-duplica.
// ─────────────────────────────────────────────────────────────
import React, { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  IconPlus, IconX, IconUpload, IconDownload, IconFileText, IconTrash,
} from "../../lib/icons.jsx";
import { nodoArtefactosApi } from "../../lib/api.js";
import { useRole } from "../../context/RoleContext.jsx";

// Tipos sugeridos en el dropdown del drawer "Agregar". El input es
// editable (datalist), así que el operador puede tipear uno nuevo si lo
// necesita — el BE acepta cualquier string hasta 48 chars.
const TIPOS_SUGERIDOS = [
  "PROFORMA", "BL", "PACKING_LIST", "FACTURA", "COTIZACION",
  "CONTRATO_3PL", "FOTO_BODEGA", "CERTIFICADO", "PERMISO", "OTRO",
];

// Estados sugeridos. Igual que los tipos, el campo es libre — el FE solo
// pinta el chip con un color basado en el string (sin enum estricto).
const ESTADOS_SUGERIDOS = ["PUBLICADO", "BORRADOR", "REVISION", "VENCIDO"];

function fmtBytes(n) {
  if (!n || n < 0) return "—";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("es-ES", {
      year: "numeric", month: "short", day: "2-digit",
    });
  } catch {
    return iso;
  }
}

// Pill de estado con color derivado del string (no hardcodeado al enum).
function EstadoChip({ estado }) {
  const s = (estado || "").toUpperCase();
  let color = "var(--text-secondary)";
  let bg    = "var(--surface-alt)";
  if (s === "PUBLICADO")          { color = "var(--success)"; bg = "color-mix(in oklab, var(--success) 12%, transparent)"; }
  else if (s === "BORRADOR")      { color = "var(--text-tertiary)"; bg = "var(--surface-alt)"; }
  else if (s === "REVISION")      { color = "var(--warning)"; bg = "color-mix(in oklab, var(--warning) 12%, transparent)"; }
  else if (s === "VENCIDO")       { color = "var(--critical)"; bg = "color-mix(in oklab, var(--critical) 12%, transparent)"; }
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700,
      letterSpacing: 0.3, color, background: bg,
      border: `1px solid color-mix(in oklab, ${color} 30%, transparent)`,
    }}>
      ● {estado || "—"}
    </span>
  );
}

export default function NodoArtifactsTab({ nodeId, lang = "es" }) {
  const { isClient } = useRole();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAdd, setShowAdd] = useState(false);

  const reload = useCallback(() => {
    if (!nodeId) return;
    setLoading(true);
    setError(null);
    nodoArtefactosApi.list(nodeId)
      .then((data) => {
        const arr = Array.isArray(data) ? data : (data?.results || []);
        setItems(arr);
      })
      .catch((e) => setError(e?.message || "Error cargando artefactos"))
      .finally(() => setLoading(false));
  }, [nodeId]);

  useEffect(() => { reload(); }, [reload]);

  const handleRemove = async (artId) => {
    if (!window.confirm(lang === "es"
      ? "¿Archivar este artefacto? No se borra físicamente; quedará oculto."
      : "Archive this artifact? Not physically deleted; stays hidden.")) return;
    try {
      await nodoArtefactosApi.remove(nodeId, artId);
      reload();
    } catch (e) {
      alert((lang === "es" ? "Error al archivar: " : "Archive error: ") + (e?.message || e));
    }
  };

  // ── Render ──────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="card card-pad-lg">
        <div className="caption" style={{ color: "var(--text-tertiary)" }}>
          {lang === "es" ? "Cargando artefactos…" : "Loading artifacts…"}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card card-pad-lg">
        <div className="body-sm" style={{ color: "var(--critical)" }}>
          {error}
        </div>
        <button className="btn btn-secondary btn-sm" onClick={reload}
                style={{ marginTop: 10 }}>
          {lang === "es" ? "Reintentar" : "Retry"}
        </button>
      </div>
    );
  }

  return (
    <div className="card">
      {/* ── Header ────────────────────────────────────── */}
      <div className="card-head"
           style={{ display: "flex", alignItems: "center",
                    justifyContent: "space-between" }}>
        <div>
          <div className="card-title">
            {lang === "es" ? "Artefactos del nodo" : "Node artifacts"}
          </div>
          <div className="card-subtitle">
            {items.length} {lang === "es" ? "registrados" : "registered"}
            {" · "}
            {lang === "es"
              ? "tipos repetibles, estado libre"
              : "repeatable types, free-form state"}
          </div>
        </div>
        {!isClient && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowAdd(true)}
            disabled={!nodeId}
          >
            <IconPlus size={14}/>
            {lang === "es" ? "Agregar artefacto" : "Add artifact"}
          </button>
        )}
      </div>

      {/* ── Tabla / Empty ─────────────────────────────── */}
      {items.length === 0 ? (
        <div style={{ padding: "48px 24px", textAlign: "center" }}>
          <IconFileText size={28}
                        style={{ color: "var(--text-tertiary)", marginBottom: 10 }}/>
          <div className="body-sm" style={{ color: "var(--text-secondary)", marginBottom: 4 }}>
            {lang === "es" ? "Sin artefactos" : "No artifacts yet"}
          </div>
          <div className="caption" style={{ color: "var(--text-tertiary)" }}>
            {lang === "es"
              ? "Agrega proformas, contratos 3PL, fotos de bodega o cualquier documento."
              : "Add proformas, 3PL contracts, warehouse photos or any document."}
          </div>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 140 }}>{lang === "es" ? "Tipo" : "Type"}</th>
                <th>{lang === "es" ? "Nombre" : "Name"}</th>
                <th style={{ width: 110 }}>{lang === "es" ? "Estado" : "State"}</th>
                <th style={{ width: 110, textAlign: "right" }}>
                  {lang === "es" ? "Tamaño" : "Size"}
                </th>
                <th style={{ width: 130 }}>{lang === "es" ? "Subido" : "Uploaded"}</th>
                <th style={{ width: 110, textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id}>
                  <td>
                    <span className="mono-sm" style={{ fontWeight: 600 }}>
                      {a.tipo}
                    </span>
                  </td>
                  <td>
                    <div className="body-sm" style={{ fontWeight: 500 }}>
                      {a.nombre}
                    </div>
                    {a.descripcion && (
                      <div className="caption" style={{
                        color: "var(--text-tertiary)", marginTop: 2,
                        maxWidth: 420, overflow: "hidden",
                        textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {a.descripcion}
                      </div>
                    )}
                  </td>
                  <td><EstadoChip estado={a.estado}/></td>
                  <td className="td-num tabular-nums"
                      style={{ color: "var(--text-secondary)" }}>
                    {fmtBytes(a.archivo_size)}
                  </td>
                  <td className="caption tabular-nums">
                    {fmtDate(a.created_at)}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <div style={{ display: "inline-flex", gap: 6,
                                  justifyContent: "flex-end" }}>
                      {a.archivo_url && (
                        <a href={a.archivo_url} target="_blank" rel="noreferrer"
                           className="btn btn-ghost btn-sm"
                           title={lang === "es" ? "Descargar" : "Download"}>
                          <IconDownload size={13}/>
                        </a>
                      )}
                      {!isClient && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => handleRemove(a.id)}
                          title={lang === "es" ? "Archivar" : "Archive"}
                          style={{ color: "var(--critical)" }}
                        >
                          <IconTrash size={13}/>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Drawer Agregar ───────────────────────────── */}
      {showAdd && (
        <AddArtifactDrawer
          nodeId={nodeId}
          lang={lang}
          onClose={() => setShowAdd(false)}
          onCreated={() => { setShowAdd(false); reload(); }}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────
// Drawer "Agregar artefacto"
//
// Por simplicidad de Fase 2, este drawer NO sube físicamente el archivo
// al storage en este sprint. Solo guarda metadata + una URL ya conocida
// (que el usuario puede pegar — útil si el archivo ya vive en S3/GDrive
// del cliente). En un sprint posterior conectamos esto a /api/storage/
// upload-proxy/ para subir directo desde el drag-and-drop.
// ────────────────────────────────────────────────────────
function AddArtifactDrawer({ nodeId, lang, onClose, onCreated }) {
  const [form, setForm] = useState({
    tipo: "PROFORMA",
    nombre: "",
    estado: "PUBLICADO",
    descripcion: "",
    archivo_url: "",
    archivo_nombre: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const upd = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const canSubmit = !!form.tipo && !!form.nombre && !busy;

  const submit = async (e) => {
    e?.preventDefault();
    if (!canSubmit) return;
    setBusy(true); setErr(null);
    try {
      await nodoArtefactosApi.create(nodeId, {
        tipo:           form.tipo.trim(),
        nombre:         form.nombre.trim(),
        estado:         (form.estado || "PUBLICADO").trim(),
        descripcion:    form.descripcion?.trim() || null,
        archivo_url:    form.archivo_url?.trim() || null,
        archivo_nombre: form.archivo_nombre?.trim() || null,
      });
      onCreated();
    } catch (e2) {
      setErr(e2?.message || "Error al crear");
      setBusy(false);
    }
  };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(11,30,58,0.40)", backdropFilter: "blur(2px)",
        display: "flex", justifyContent: "flex-end",
      }}
    >
      <motion.div
        initial={{ x: 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1, transition: { duration: 0.22 } }}
        style={{
          width: 460, maxWidth: "92vw", height: "100vh",
          background: "var(--surface)", boxShadow: "var(--shadow-lg)",
          display: "flex", flexDirection: "column",
        }}
      >
        <div style={{
          padding: "18px 22px",
          borderBottom: "1px solid var(--border-subtle)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div className="micro" style={{ color: "var(--text-tertiary)" }}>
              {lang === "es" ? "AGREGAR" : "ADD"}
            </div>
            <div className="heading-sm">
              {lang === "es" ? "Nuevo artefacto del nodo" : "New node artifact"}
            </div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>
            <IconX size={14}/>
          </button>
        </div>

        <form onSubmit={submit}
              style={{ flex: 1, overflowY: "auto", padding: "18px 22px",
                       display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label className="micro" htmlFor="tipo">
              {lang === "es" ? "TIPO" : "TYPE"} *
            </label>
            <input
              id="tipo"
              className="input"
              list="tipos-sugeridos"
              value={form.tipo}
              onChange={(e) => upd("tipo", e.target.value.toUpperCase())}
              required
              maxLength={48}
              placeholder={lang === "es"
                ? "Ej. PROFORMA, BL, CONTRATO_3PL…"
                : "e.g. PROFORMA, BL, 3PL_CONTRACT…"}
            />
            <datalist id="tipos-sugeridos">
              {TIPOS_SUGERIDOS.map((t) => <option key={t} value={t}/>)}
            </datalist>
            <div className="caption" style={{ color: "var(--text-tertiary)", marginTop: 4 }}>
              {lang === "es"
                ? "El mismo tipo puede repetirse en el nodo."
                : "Same type can repeat for the node."}
            </div>
          </div>

          <div>
            <label className="micro" htmlFor="nombre">
              {lang === "es" ? "NOMBRE" : "NAME"} *
            </label>
            <input
              id="nombre"
              className="input"
              value={form.nombre}
              onChange={(e) => upd("nombre", e.target.value)}
              required
              maxLength={160}
              placeholder={lang === "es"
                ? "Ej. Proforma 2026-01 / contrato anual 3PL"
                : "e.g. Proforma 2026-01 / annual 3PL contract"}
            />
          </div>

          <div>
            <label className="micro" htmlFor="estado">
              {lang === "es" ? "ESTADO" : "STATE"}
            </label>
            <input
              id="estado"
              className="input"
              list="estados-sugeridos"
              value={form.estado}
              onChange={(e) => upd("estado", e.target.value.toUpperCase())}
              maxLength={32}
            />
            <datalist id="estados-sugeridos">
              {ESTADOS_SUGERIDOS.map((s) => <option key={s} value={s}/>)}
            </datalist>
          </div>

          <div>
            <label className="micro" htmlFor="descripcion">
              {lang === "es" ? "DESCRIPCIÓN" : "DESCRIPTION"}
            </label>
            <textarea
              id="descripcion"
              className="input"
              rows={3}
              value={form.descripcion}
              onChange={(e) => upd("descripcion", e.target.value)}
              placeholder={lang === "es"
                ? "Notas internas, contexto, número de documento…"
                : "Internal notes, context, document number…"}
            />
          </div>

          <div>
            <label className="micro" htmlFor="archivo_url">
              {lang === "es" ? "URL DEL ARCHIVO" : "FILE URL"}
            </label>
            <input
              id="archivo_url"
              className="input"
              value={form.archivo_url}
              onChange={(e) => upd("archivo_url", e.target.value)}
              placeholder="https://…"
              type="url"
            />
            <div className="caption" style={{ color: "var(--text-tertiary)", marginTop: 4 }}>
              {lang === "es"
                ? "Pega la URL del archivo (S3, Drive, Paperless). Upload directo llega en próximo sprint."
                : "Paste the file URL (S3, Drive, Paperless). Direct upload coming next sprint."}
            </div>
          </div>

          <div>
            <label className="micro" htmlFor="archivo_nombre">
              {lang === "es" ? "NOMBRE DEL ARCHIVO" : "FILE NAME"}
            </label>
            <input
              id="archivo_nombre"
              className="input"
              value={form.archivo_nombre}
              onChange={(e) => upd("archivo_nombre", e.target.value)}
              placeholder="proforma_2026_01.pdf"
              maxLength={255}
            />
          </div>

          {err && (
            <div className="body-sm" style={{ color: "var(--critical)" }}>
              {err}
            </div>
          )}
        </form>

        <div style={{
          padding: "14px 22px",
          borderTop: "1px solid var(--border-subtle)",
          display: "flex", justifyContent: "flex-end", gap: 8,
        }}>
          <button type="button" className="btn btn-ghost"
                  onClick={onClose} disabled={busy}>
            {lang === "es" ? "Cancelar" : "Cancel"}
          </button>
          <button type="button" className="btn btn-primary"
                  onClick={submit} disabled={!canSubmit}>
            <IconUpload size={13}/>
            {busy
              ? (lang === "es" ? "Guardando…" : "Saving…")
              : (lang === "es" ? "Crear artefacto" : "Create artifact")}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
