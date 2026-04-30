// ─────────────────────────────────────────────────────────────
// AddSAPConfirmationDrawer — Comando C5 · RegisterSAPConfirmation
// Agente responsable: [AG-FRONTEND]
//
// Drawer lateral ancho que dispara la transición atómica
// REGISTRO → PRODUCCION de un expediente, generando el
// artefacto ART-04 (Confirmación SAP) en el backend.
//
// Flujo:
//   1. CEO abre el drawer desde "+ Agregar SAP" en OCDetail.
//   2. Ingresa sap_id + fecha_fabricacion + sube PDF.
//   3. Revisa la conciliación por línea (qty_solicitada vs
//      qty_confirmada). La fábrica puede haber recortado.
//   4. Click "Confirmar Producción" → POST /confirm-sap/
//      multipart con el PDF + payload. El backend:
//        · inserta artifact_instances (ART-04)
//        · actualiza expedientes.linea (qty confirmada, sap)
//        · actualiza expedientes.expediente (estado, numero_sap,
//          fecha_produccion_estimada)
//        · inserta 2 eventos en pipeline.event_log (C5)
//
// Tokens MWT.ONE:
//   Navy #0B1E3A · Mint #00B286 · Blue #3083FE
// ─────────────────────────────────────────────────────────────
import React, { useState, useMemo, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  IconX, IconUpload, IconFileText, IconCheck, IconAlert,
  IconChevRight, IconPackage, IconShield, IconSparkle,
  IconSearch, IconPlus, IconTrash,
} from "../../lib/icons.jsx";
import { getToken } from "../../lib/api.js";

const NAVY  = "#0B1E3A";
const MINT  = "#00B286";
const BLUE  = "#3083FE";
const AMBER = "#B45309";
const RED   = "#DC2626";

const API_BASE = (import.meta && import.meta.env && import.meta.env.VITE_API_BASE) || "/api";

// ───── helpers ────────────────────────────────────────────────
function fmtNumber(v) {
  if (v == null || isNaN(v)) return "—";
  return Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
}
function todayISO() {
  const d = new Date();
  const z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
function prettyBytes(n) {
  if (!n) return "0 B";
  const k = 1024;
  const i = Math.floor(Math.log(n) / Math.log(k));
  const units = ["B", "KB", "MB", "GB"];
  return `${(n / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
}

// ───── Multipart POST a /expedientes/{id}/confirm-sap/ ────────
async function postConfirmSap({ expedienteId, sapId, fechaFabricacion,
                                lineasConfirmadas, file }) {
  const fd = new FormData();
  fd.append("sap_id", sapId);
  fd.append("fecha_fabricacion", fechaFabricacion);
  fd.append("lineas_confirmadas", JSON.stringify(lineasConfirmadas));
  if (file) fd.append("documento_sap", file, file.name);

  const token = getToken();
  const resp = await fetch(`${API_BASE}/expedientes/${expedienteId}/confirm-sap/`, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: fd,
  });

  const text = await resp.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = { raw: text }; } }

  if (!resp.ok) {
    const err = new Error(data?.detail || data?.error || `HTTP ${resp.status}`);
    err.status = resp.status;
    err.body = data;
    throw err;
  }
  return data;
}

// ─────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────
export default function AddSAPConfirmationDrawer({
  open,
  onClose,
  lang = "es",
  oc,                 // { codigo, id, ... }
  expediente,         // { id, codigo, estado, ... }
  lines = [],         // [{ id, sku, size, qty, unit_price, ... }]
  onSuccess,          // (payload) => void  — padre refresca la vista
}) {
  // ───── state ─────
  const [sapId, setSapId]                 = useState("");
  const [fechaFab, setFechaFab]           = useState(todayISO());
  const [file, setFile]                   = useState(null);
  const [fileError, setFileError]         = useState(null);
  const [confirmedQtys, setConfirmedQtys] = useState({});
  // Set de IDs de líneas que el usuario explícitamente agregó a este SAP.
  // Sólo estas se envían al backend en el submit (no las del expediente
  // que no fueron incluidas).
  const [addedLineIds, setAddedLineIds]   = useState(() => new Set());
  // Estado del buscador SKU
  const [searchQ, setSearchQ]             = useState("");
  const [pickerOpen, setPickerOpen]       = useState(false);
  const [submitting, setSubmitting]       = useState(false);
  const [apiError, setApiError]           = useState(null);

  // Reset al re-abrir
  useEffect(() => {
    if (!open) return;
    setAddedLineIds(new Set());
    setConfirmedQtys({});
    setSearchQ("");
    setPickerOpen(false);
    setApiError(null);
  }, [open, lines]);

  const fileInputRef = useRef(null);

  // ───── computed ─────
  // Líneas agregadas por el usuario (subset filtrado por addedLineIds)
  const addedLines = useMemo(() => {
    return (lines || []).filter(l => addedLineIds.has(l.id));
  }, [lines, addedLineIds]);

  // Resultados del buscador: líneas del expediente que NO están aún
  // agregadas y matchean el query (SKU o talla).
  const searchResults = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    if (!q) return [];
    return (lines || [])
      .filter(l => !addedLineIds.has(l.id))
      .filter(l => {
        const sku = String(l.sku || "").toLowerCase();
        const sz  = String(l.size || l.talla || "").toLowerCase();
        const lbl = String(l.descripcion || l.product || l.product_label || "").toLowerCase();
        return sku.includes(q) || sz.includes(q) || lbl.includes(q);
      })
      .slice(0, 12);
  }, [lines, addedLineIds, searchQ]);

  const cutTotal = useMemo(() => {
    return addedLines.reduce((acc, l) => {
      const orig = Number(l.qty || 0);
      const conf = Number(confirmedQtys[l.id] ?? orig);
      return acc + Math.max(orig - conf, 0);
    }, 0);
  }, [addedLines, confirmedQtys]);

  const hasCuts = cutTotal > 0;

  const formValid = useMemo(() => {
    if (!sapId.trim()) return false;
    if (!fechaFab) return false;
    if (!expediente?.id) return false;
    // al menos una línea agregada con qty confirmada > 0
    if (addedLines.length === 0) return false;
    const anyQty = addedLines.some(l =>
      Number(confirmedQtys[l.id] ?? l.qty ?? 0) > 0
    );
    return anyQty;
  }, [sapId, fechaFab, expediente, confirmedQtys, addedLines]);

  const wrongState = expediente && expediente.estado && expediente.estado !== "REGISTRO";

  // ───── handlers ─────
  const updateQty = (lineId, raw) => {
    const v = Math.max(0, Number(raw || 0));
    setConfirmedQtys(prev => ({ ...prev, [lineId]: v }));
  };
  const applyAll100 = () => {
    const m = {};
    addedLines.forEach(l => { m[l.id] = Number(l.qty || 0); });
    setConfirmedQtys(m);
  };
  const addLineToSap = (line) => {
    setAddedLineIds(prev => {
      const n = new Set(prev);
      n.add(line.id);
      return n;
    });
    // Inicializar la qty confirmada al valor solicitado
    setConfirmedQtys(prev => ({ ...prev, [line.id]: Number(line.qty || 0) }));
    // Limpiar el buscador para el siguiente add
    setSearchQ("");
    setPickerOpen(false);
  };
  const removeLineFromSap = (lineId) => {
    setAddedLineIds(prev => {
      const n = new Set(prev);
      n.delete(lineId);
      return n;
    });
    setConfirmedQtys(prev => {
      const { [lineId]: _, ...rest } = prev;
      return rest;
    });
  };
  const addAllRemaining = () => {
    const all = new Set(addedLineIds);
    const newQtys = { ...confirmedQtys };
    (lines || []).forEach(l => {
      if (!all.has(l.id)) {
        all.add(l.id);
        newQtys[l.id] = Number(l.qty || 0);
      }
    });
    setAddedLineIds(all);
    setConfirmedQtys(newQtys);
  };
  const pickFile = () => fileInputRef.current?.click();
  const onFileSelected = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!/\.pdf$/i.test(f.name)) {
      setFileError(lang === "es" ? "Solo se admite PDF" : "Only PDF is allowed");
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      setFileError(lang === "es" ? "Máximo 10MB" : "Max 10MB");
      return;
    }
    setFileError(null);
    setFile(f);
  };
  const onDrop = (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) {
      const dt = { target: { files: [f] } };
      onFileSelected(dt);
    }
  };

  const submit = async () => {
    if (!formValid || submitting) return;
    setSubmitting(true);
    setApiError(null);
    try {
      // Enviamos SOLO las líneas que el usuario explícitamente agregó
      // a este SAP (no todas las del expediente). Las que no estén en
      // este SAP quedan disponibles para asignar a futuros SAPs.
      const lineasConfirmadas = addedLines.map(l => ({
        linea_id: l.id,
        qty_confirmada: Number(confirmedQtys[l.id] ?? l.qty ?? 0),
      }));
      const result = await postConfirmSap({
        expedienteId:      expediente.id,
        sapId:             sapId.trim(),
        fechaFabricacion:  fechaFab,
        lineasConfirmadas,
        file,
      });
      onSuccess?.(result);
      onClose?.();
    } catch (e) {
      setApiError(e.message || "Error desconocido");
    } finally {
      setSubmitting(false);
    }
  };

  // ───── render ─────
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="sap-drawer-backdrop"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />
          <motion.aside
            className="sap-drawer"
            role="dialog"
            aria-label={lang === "es" ? "Agregar Confirmación SAP" : "Add SAP Confirmation"}
            initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
            transition={{ type: "tween", duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
          >
            {/* ── Header ──────────────────────────── */}
            <header className="sap-drawer-head">
              <div className="sap-drawer-breadcrumb">
                <span className="sap-crumb">{lang === "es" ? "Expedientes" : "Expedientes"}</span>
                <IconChevRight size={12}/>
                <span className="sap-crumb mono" style={{ color: BLUE }}>
                  {oc?.codigo || "OC-—"}
                </span>
                <IconChevRight size={12}/>
                <span className="sap-crumb mono" style={{ color: NAVY, fontWeight: 700 }}>
                  {expediente?.codigo || "EXP-—"}
                </span>
              </div>
              <button className="sap-drawer-close" onClick={onClose} aria-label="close">
                <IconX size={14}/>
              </button>
            </header>

            <div className="sap-drawer-title-row">
              <div>
                <div className="heading-md" style={{ color: NAVY, fontWeight: 800 }}>
                  {lang === "es"
                    ? "Agregar Confirmación SAP"
                    : "Add SAP Confirmation"}
                </div>
                <div className="caption">
                  {lang === "es"
                    ? "Comando C5 · genera el artefacto ART-04 y mueve el expediente a PRODUCCIÓN."
                    : "Command C5 · generates the ART-04 artifact and moves the expediente to PRODUCTION."}
                </div>
              </div>
              <div className="sap-state-transition">
                <span className="sap-pill sap-pill-registro">REGISTRO</span>
                <IconChevRight size={12}/>
                <span className="sap-pill sap-pill-produccion">
                  <IconSparkle size={11}/> PRODUCCIÓN
                </span>
              </div>
            </div>

            {/* Estado incorrecto → bloquea */}
            {wrongState && (
              <div className="sap-state-warning">
                <IconAlert size={14}/>
                <div style={{ flex: 1 }}>
                  <div className="heading-sm">
                    {lang === "es"
                      ? `Transición bloqueada · expediente en '${expediente.estado}'`
                      : `Transition blocked · expediente is in '${expediente.estado}'`}
                  </div>
                  <div className="caption">
                    {lang === "es"
                      ? "Sólo se puede agregar SAP si el expediente está en estado REGISTRO."
                      : "SAP can only be added when the expediente is in REGISTRO state."}
                  </div>
                </div>
              </div>
            )}

            {/* ══ Sección 1 · Datos de confirmación ═ */}
            <section className="sap-section">
              <div className="sap-section-head">
                <span className="sap-section-num" style={{ background: NAVY }}>1</span>
                <div>
                  <div className="heading-sm">
                    {lang === "es" ? "Datos de Confirmación" : "Confirmation Data"}
                  </div>
                  <div className="caption">
                    {lang === "es"
                      ? "Número SAP de Marluvas + fecha de fabricación + PDF de confirmación."
                      : "Marluvas SAP number + manufacturing date + confirmation PDF."}
                  </div>
                </div>
              </div>

              <div className="sap-form-grid">
                <label className="sap-field">
                  <span className="sap-label">
                    {lang === "es" ? "Número SAP (Marluvas)" : "SAP Number (Marluvas)"}
                    <span className="sap-req">*</span>
                  </span>
                  <input
                    className="input mono"
                    placeholder="SAP-202600123"
                    value={sapId}
                    onChange={(e) => setSapId(e.target.value)}
                    autoFocus
                  />
                </label>

                <label className="sap-field">
                  <span className="sap-label">
                    {lang === "es" ? "Fecha de Fabricación" : "Manufacturing Date"}
                    <span className="sap-req">*</span>
                  </span>
                  <input
                    type="date"
                    className="input tabular-nums"
                    value={fechaFab}
                    onChange={(e) => setFechaFab(e.target.value)}
                  />
                  <span className="micro text-sec" style={{ marginTop: 4 }}>
                    {lang === "es"
                      ? "Punto de partida del ETA proyectado."
                      : "Starting point of the projected ETA."}
                  </span>
                </label>
              </div>

              {/* Dropzone */}
              <div
                className="sap-dropzone"
                data-has-file={!!file}
                onClick={pickFile}
                onDragOver={(e) => e.preventDefault()}
                onDrop={onDrop}
                role="button"
                tabIndex={0}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  style={{ display: "none" }}
                  onChange={onFileSelected}
                />
                {!file ? (
                  <>
                    <div className="sap-drop-icon">
                      <IconUpload size={18}/>
                    </div>
                    <div className="heading-sm" style={{ marginBottom: 2 }}>
                      {lang === "es"
                        ? "Subir PDF de Confirmación SAP (ART-04)"
                        : "Upload SAP Confirmation PDF (ART-04)"}
                    </div>
                    <div className="caption">
                      {lang === "es"
                        ? "Arrastrá o hacé click · máx. 10MB · solo PDF"
                        : "Drag or click · max 10MB · PDF only"}
                    </div>
                  </>
                ) : (
                  <div className="sap-file-preview">
                    <div className="sap-file-icon" style={{ background: MINT }}>
                      <IconFileText size={16}/>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="heading-sm" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {file.name}
                      </div>
                      <div className="caption tabular-nums">
                        {prettyBytes(file.size)} · PDF
                      </div>
                    </div>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={(e) => { e.stopPropagation(); setFile(null); }}
                    >
                      <IconX size={12}/>
                    </button>
                  </div>
                )}
              </div>
              {fileError && (
                <div className="sap-inline-error">
                  <IconAlert size={12}/> {fileError}
                </div>
              )}
            </section>

            {/* ══ Sección 2 · Productos a incluir en este SAP ═ */}
            <section className="sap-section">
              <div className="sap-section-head">
                <span className="sap-section-num" style={{ background: BLUE }}>2</span>
                <div>
                  <div className="heading-sm">
                    {lang === "es"
                      ? "Productos en este SAP"
                      : "Products in this SAP"}
                  </div>
                  <div className="caption">
                    {lang === "es"
                      ? "Buscá por SKU y agregá sólo las líneas que la fábrica confirmó. Las que no agregues quedan disponibles para futuros SAPs."
                      : "Search by SKU and add only the lines confirmed by the factory. Unselected lines stay available for future SAPs."}
                  </div>
                </div>
                {addedLines.length > 0 && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={applyAll100}
                    style={{ marginLeft: "auto" }}
                  >
                    <IconCheck size={11}/> {lang === "es" ? "Aceptar 100%" : "Accept 100%"}
                  </button>
                )}
              </div>

              {/* ── Buscador SKU ── */}
              <div style={{ position: "relative", marginBottom: 12 }}>
                <div style={{
                  position: "relative",
                  display: "flex", alignItems: "center", gap: 8,
                  border: "1px solid var(--border)", borderRadius: 10,
                  padding: "8px 12px", background: "white",
                }}>
                  <IconSearch size={14} style={{ color: "var(--text-tertiary)" }}/>
                  <input
                    type="text"
                    value={searchQ}
                    onChange={(e) => { setSearchQ(e.target.value); setPickerOpen(true); }}
                    onFocus={() => setPickerOpen(true)}
                    placeholder={lang === "es"
                      ? "Buscar por SKU, talla o nombre…"
                      : "Search by SKU, size or name…"}
                    style={{
                      flex: 1, border: 0, outline: "none",
                      background: "transparent", fontSize: 14,
                    }}
                  />
                  {(lines || []).length > 0 && addedLines.length < (lines || []).length && (
                    <button
                      type="button"
                      onClick={addAllRemaining}
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: 11 }}>
                      {lang === "es" ? "Agregar todas" : "Add all"}
                    </button>
                  )}
                </div>

                {/* Dropdown de resultados */}
                {pickerOpen && searchQ.trim() && (
                  <div style={{
                    position: "absolute", top: "calc(100% + 4px)",
                    left: 0, right: 0, zIndex: 10,
                    background: "white", border: "1px solid var(--border)",
                    borderRadius: 10, maxHeight: 260, overflowY: "auto",
                    boxShadow: "0 8px 24px -8px rgba(15,27,61,0.18)",
                  }}>
                    {searchResults.length === 0 ? (
                      <div style={{
                        padding: "12px 14px", color: "var(--text-tertiary)",
                        fontSize: 13, textAlign: "center",
                      }}>
                        {lang === "es"
                          ? "Sin coincidencias en líneas del expediente"
                          : "No matches in expediente lines"}
                      </div>
                    ) : (
                      searchResults.map(l => (
                        <button
                          key={l.id} type="button"
                          onClick={() => addLineToSap(l)}
                          style={{
                            width: "100%", textAlign: "left", border: 0,
                            padding: "10px 14px", background: "white",
                            cursor: "pointer", display: "flex",
                            alignItems: "center", gap: 12,
                            borderBottom: "1px solid var(--border-subtle)",
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = "rgba(48,131,254,0.05)"}
                          onMouseLeave={(e) => e.currentTarget.style.background = "white"}
                        >
                          <IconPackage size={14} style={{ color: BLUE, flexShrink: 0 }}/>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="mono" style={{ fontWeight: 700, color: NAVY, fontSize: 13 }}>
                              {l.sku || "—"}
                              {(l.size || l.talla) && (
                                <span style={{
                                  marginLeft: 8, padding: "1px 7px", borderRadius: 4,
                                  background: "rgba(11,30,58,0.06)", fontSize: 10,
                                  color: NAVY, fontWeight: 700,
                                }}>{l.size || l.talla}</span>
                              )}
                            </div>
                            <div className="caption" style={{ color: "var(--text-tertiary)", fontSize: 12 }}>
                              {fmtNumber(l.qty)} u · {l.descripcion || l.product || l.product_label || ""}
                            </div>
                          </div>
                          <IconPlus size={13} style={{ color: MINT }}/>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* ── Tabla de líneas agregadas ── */}
              <div className="sap-lines-table">
                {addedLines.length === 0 ? (
                  <div className="sap-empty">
                    <IconPackage size={22} style={{ opacity: 0.35 }}/>
                    <div className="heading-sm">
                      {lang === "es"
                        ? "Aún no agregás líneas a este SAP"
                        : "No lines added to this SAP yet"}
                    </div>
                    <div className="caption">
                      {lang === "es"
                        ? "Usá el buscador de arriba para incluir las líneas que cubre este número SAP."
                        : "Use the search above to include lines covered by this SAP number."}
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="sap-lines-head" style={{
                      gridTemplateColumns: "1fr 90px 90px 60px 36px",
                    }}>
                      <div>{lang === "es" ? "Producto" : "Product"}</div>
                      <div className="text-right">{lang === "es" ? "Solicitado" : "Requested"}</div>
                      <div className="text-right">{lang === "es" ? "Confirmado" : "Confirmed"}</div>
                      <div className="text-right">Δ</div>
                      <div></div>
                    </div>
                    {addedLines.map(l => {
                      const orig = Number(l.qty || 0);
                      const conf = Number(confirmedQtys[l.id] ?? orig);
                      const delta = conf - orig;
                      const tone = delta === 0 ? "ok" : delta < 0 ? "cut" : "over";
                      return (
                        <div key={l.id} className="sap-line-row" style={{
                          gridTemplateColumns: "1fr 90px 90px 60px 36px",
                        }}>
                          <div className="sap-line-refs">
                            <div className="mono heading-sm" style={{ color: NAVY }}>
                              {l.sku || "—"}
                            </div>
                            <div className="caption text-sec" style={{ marginTop: 2 }}>
                              {(l.size || l.talla) ? `${lang === "es" ? "Talla" : "Size"} ${l.size || l.talla} · ` : ""}
                              {l.descripcion || l.product || l.product_label || ""}
                            </div>
                          </div>
                          <div className="sap-line-cell tabular-nums text-right">
                            {fmtNumber(orig)}
                          </div>
                          <div className="sap-line-cell text-right">
                            <input
                              type="number"
                              className="input input-sm tabular-nums sap-qty-input"
                              value={conf}
                              min={0}
                              max={orig * 2}
                              onChange={(e) => updateQty(l.id, e.target.value)}
                              data-tone={tone}
                            />
                          </div>
                          <div className="sap-line-cell tabular-nums text-right">
                            <span className="sap-delta" data-tone={tone}>
                              {delta === 0 ? "—" : (delta > 0 ? `+${fmtNumber(delta)}` : fmtNumber(delta))}
                            </span>
                          </div>
                          <div className="sap-line-cell" style={{ textAlign: "center" }}>
                            <button
                              type="button"
                              onClick={() => removeLineFromSap(l.id)}
                              className="btn btn-ghost btn-sm"
                              title={lang === "es" ? "Quitar de este SAP" : "Remove from this SAP"}
                              style={{ color: RED, padding: "4px 6px" }}>
                              <IconTrash size={13}/>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>

              {hasCuts && (
                <div className="sap-cut-warning">
                  <IconAlert size={12}/>
                  <span>
                    {lang === "es"
                      ? `La fábrica recortó ${fmtNumber(cutTotal)} unidades. Estas líneas se marcarán como CANCELADA si quedan en 0.`
                      : `Factory cut ${fmtNumber(cutTotal)} units. Lines will be marked CANCELLED if they end at 0.`}
                  </span>
                </div>
              )}
            </section>

            {/* Spacer para que el footer sticky no tape el contenido */}
            <div style={{ height: 80 }}/>

            {/* ══ Footer sticky ═══════════════════ */}
            <footer className="sap-drawer-footer">
              {apiError && (
                <div className="sap-inline-error" style={{ flex: 1, marginRight: 12 }}>
                  <IconAlert size={12}/> {apiError}
                </div>
              )}
              <button className="btn btn-secondary" onClick={onClose} disabled={submitting}>
                {lang === "es" ? "Cancelar" : "Cancel"}
              </button>
              <button
                className="btn btn-primary sap-confirm-btn"
                onClick={submit}
                disabled={!formValid || !!wrongState || submitting}
                data-loading={submitting}
              >
                {submitting ? (
                  <>
                    <span className="sap-spinner"/>
                    {lang === "es"
                      ? "Registrando en SAP y actualizando a PRODUCCIÓN…"
                      : "Registering in SAP and moving to PRODUCTION…"}
                  </>
                ) : (
                  <>
                    <IconShield size={13}/>
                    {lang === "es" ? "Confirmar Producción" : "Confirm Production"}
                  </>
                )}
              </button>
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
