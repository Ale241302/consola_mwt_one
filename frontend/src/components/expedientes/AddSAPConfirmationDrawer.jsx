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

// Sprint 2026-05-04 (AG-03): tipos de archivo aceptados para
// la Confirmación SAP. xlsx/xls = export real de Marluvas (parser
// determinístico); csv = export tabular alternativo; pdf = legacy
// (cae al extractor IA). Todo se valida primero contra
// /analyze-sap-confirmation/ antes del confirm/upsert.
const ACCEPTED_EXT_RE = /\.(pdf|xlsx?|xlsm|csv)$/i;
const ACCEPTED_INPUT  = ".pdf,.xlsx,.xlsm,.xls,.csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv";

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

// ───── Multipart POST a /expedientes/{id}/upsert-sap/ ────────
// Sprint 2026-05-01: edita SAP existente o agrega SAP adicional sin
// transicionar el estado del expediente. Acepta los mismos campos que
// confirm-sap, mas `remove_documento` (bool) para eliminar el PDF.
async function postUpsertSap({ expedienteId, sapId, fechaFabricacion,
                                lineasConfirmadas, file, removeFile }) {
  const fd = new FormData();
  fd.append("sap_id", sapId);
  if (fechaFabricacion) fd.append("fecha_fabricacion", fechaFabricacion);
  fd.append("lineas_confirmadas", JSON.stringify(lineasConfirmadas));
  if (file) fd.append("documento_sap", file, file.name);
  if (removeFile) fd.append("remove_documento", "true");

  const token = getToken();
  const resp = await fetch(`${API_BASE}/expedientes/${expedienteId}/upsert-sap/`, {
    method: "POST",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: fd,
  });
  const text = await resp.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = { raw: text }; } }
  if (!resp.ok) {
    const err = new Error(data?.detail || data?.error || `HTTP ${resp.status}`);
    err.status = resp.status; err.body = data;
    throw err;
  }
  return data;
}

// ───── Multipart POST a /expedientes/{id}/analyze-sap-confirmation/ ──
// Sprint 2026-05-04 (AG-03): análisis IA + parser determinístico ANTES
// del confirm/upsert. Devuelve sap_id detectado, lineas con match y
// discrepancias (qty/sku/talla/nombre).
async function postAnalyzeSap({ expedienteId, file }) {
  const fd = new FormData();
  fd.append("file", file, file.name);
  const token = getToken();
  const resp = await fetch(
    `${API_BASE}/expedientes/${expedienteId}/analyze-sap-confirmation/`,
    {
      method: "POST",
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: fd,
    },
  );
  const text = await resp.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = { raw: text }; } }
  if (!resp.ok) {
    const err = new Error(data?.detail || data?.error || `HTTP ${resp.status}`);
    err.status = resp.status; err.body = data;
    throw err;
  }
  return data;
}

// ───── JSON POST a /expedientes/{id}/sync-sap-discrepancies/ ─────
// Sprint 2026-05-04 (AG-03): aplica las acciones derivadas del análisis
// IA. ADD_LINE inserta la talla faltante con precio del cliente
// (cascada doc → CPA → precio_lista). UPDATE_QTY ajusta la cantidad.
async function postSyncDiscrepancies({ expedienteId, actions }) {
  const token = getToken();
  const resp = await fetch(
    `${API_BASE}/expedientes/${expedienteId}/sync-sap-discrepancies/`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ actions }),
    },
  );
  const text = await resp.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = { raw: text }; } }
  if (!resp.ok) {
    const err = new Error(data?.detail || data?.error || `HTTP ${resp.status}`);
    err.status = resp.status; err.body = data;
    throw err;
  }
  return data;
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
  // Sprint 2026-05-04 (AG-03): callback opcional para que el padre
  // refetche líneas tras una sincronización IA (botón Sincronizar).
  // El drawer ya mantiene `extraLines` localmente, así que esto es
  // best-effort: el flujo funciona aunque el padre ignore el callback.
  onLinesChanged,     // () => void
  // Sprint 2026-05-01: si viene existingSap, el drawer entra en modo
  // EDIT. Pre-popula sapId/fechaFab/addedLineIds, omite el check de
  // estado (permite editar en PRODUCCION) y llama upsert-sap en vez
  // de confirm-sap.
  existingSap = null, // { sap_id, fecha_fabricacion, line_ids, has_file }
}) {
  const isEditMode = !!existingSap;
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

  // Sprint 2026-05-04 (AG-03): estado del análisis IA del documento.
  // Se popula tras subir el archivo y llamar /analyze-sap-confirmation/.
  // Trae sap_id detectado, líneas extraídas con match contra el
  // expediente, y discrepancias por SKU/talla/qty/nombre.
  const [analyzing, setAnalyzing]         = useState(false);
  const [analysis, setAnalysis]           = useState(null);
  const [analysisError, setAnalysisError] = useState(null);

  // Sprint 2026-05-04 (AG-03): líneas insertadas localmente por el
  // botón "Sincronizar" — todavía no presentes en `lines` (prop del
  // padre) hasta que onLinesChanged provoque un refetch. Se mergean
  // con `lines` en `allLines` para que la búsqueda y la tabla de
  // líneas agregadas las muestren inmediatamente.
  const [extraLines, setExtraLines]       = useState([]);
  const [syncing, setSyncing]             = useState(false);
  const [syncError, setSyncError]         = useState(null);
  const [syncedAt, setSyncedAt]           = useState(null);

  // Reset al re-abrir
  // Sprint 2026-05-04 (AG-03): usamos un ref para inicializar UNA SOLA
  // VEZ por apertura del drawer. Antes el effect dependía de `lines` y
  // se reseteaba cada vez que el padre re-renderizaba — eso pisaba el
  // estado del usuario (incluyendo addedLineIds que el botón
  // Sincronizar acaba de actualizar).
  const didInitRef = useRef(false);
  useEffect(() => {
    if (!open) {
      didInitRef.current = false;
      return;
    }
    // Edit mode necesita `lines` para inicializar confirmedQtys; si aún
    // no llegaron, esperamos.
    if (didInitRef.current) return;
    if (isEditMode && (!lines || lines.length === 0)) return;
    didInitRef.current = true;

    if (isEditMode && existingSap) {
      setSapId(existingSap.sap_id || "");
      setFechaFab(existingSap.fecha_fabricacion || todayISO());
      const ids = new Set(existingSap.line_ids || []);
      setAddedLineIds(ids);
      const qtys = {};
      for (const l of lines) {
        if (ids.has(l.id)) qtys[l.id] = Number(l.qty || 0);
      }
      setConfirmedQtys(qtys);
    } else {
      setSapId("");
      setFechaFab(todayISO());
      setAddedLineIds(new Set());
      setConfirmedQtys({});
    }
    setSearchQ("");
    setPickerOpen(false);
    setApiError(null);
    setFile(null);
    setFileError(null);
    setAnalyzing(false);
    setAnalysis(null);
    setAnalysisError(null);
    setExtraLines([]);
    setSyncing(false);
    setSyncError(null);
    setSyncedAt(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lines, isEditMode, existingSap?.sap_id]);

  const fileInputRef = useRef(null);

  // ───── computed ─────
  // Sprint 2026-05-04 (AG-03): mergeamos `lines` (prop del padre) con
  // `extraLines` (líneas insertadas localmente por Sincronizar). Cuando
  // el padre eventualmente refetcha, las nuevas líneas aparecen en
  // `lines` y deduplicamos por id para no mostrar duplicados.
  const allLines = useMemo(() => {
    const base = lines || [];
    const baseIds = new Set(base.map(l => l.id));
    const extras = (extraLines || []).filter(l => !baseIds.has(l.id));
    return [...base, ...extras];
  }, [lines, extraLines]);

  // Líneas agregadas por el usuario (subset filtrado por addedLineIds)
  const addedLines = useMemo(() => {
    return allLines.filter(l => addedLineIds.has(l.id));
  }, [allLines, addedLineIds]);

  // Resultados del buscador: líneas del expediente que NO están aún
  // agregadas y matchean el query (SKU o talla).
  const searchResults = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    if (!q) return [];
    return allLines
      .filter(l => !addedLineIds.has(l.id))
      .filter(l => {
        const sku = String(l.sku || "").toLowerCase();
        const sz  = String(l.size || l.talla || "").toLowerCase();
        const lbl = String(l.descripcion || l.product || l.product_label || "").toLowerCase();
        return sku.includes(q) || sz.includes(q) || lbl.includes(q);
      })
      .slice(0, 12);
  }, [allLines, addedLineIds, searchQ]);

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

  // En edit mode permitimos cualquier estado (PRODUCCION, etc.)
  const wrongState = !isEditMode && expediente && expediente.estado && expediente.estado !== "REGISTRO";

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
    allLines.forEach(l => {
      if (!all.has(l.id)) {
        all.add(l.id);
        newQtys[l.id] = Number(l.qty || 0);
      }
    });
    setAddedLineIds(all);
    setConfirmedQtys(newQtys);
  };
  const pickFile = () => fileInputRef.current?.click();

  // Sprint 2026-05-04 (AG-03): tras seleccionar archivo, dispara
  // /analyze-sap-confirmation/ → autocompleta sap_id, agrega líneas
  // matched y registra discrepancias en `analysis`.
  const runAnalysis = async (f) => {
    if (!expediente?.id || !f) return;
    setAnalyzing(true);
    setAnalysisError(null);
    setAnalysis(null);
    try {
      const res = await postAnalyzeSap({
        expedienteId: expediente.id,
        file: f,
      });
      setAnalysis(res);

      // Auto-fill sap_id si el documento lo trae y el campo está vacío
      // (en edit mode no sobreescribimos el sap existente).
      if (!isEditMode && res?.sap_id && !sapId.trim()) {
        setSapId(String(res.sap_id));
      }

      // Auto-add líneas matched por (sku,talla) — el usuario podrá
      // remover manualmente las que no quiera incluir en este SAP.
      const docSapId = String(res?.sap_id || "").trim();
      const userSapId = String(sapId || "").trim();
      const targetSap = docSapId || userSapId;

      const newAdded = new Set(addedLineIds);
      const newQtys  = { ...confirmedQtys };
      for (const docLine of (res?.lineas || [])) {
        const m = docLine.match;
        if (!m?.matched || !m.line_id) continue;
        // Si la línea trae sap_doc y no coincide con el SAP que estamos
        // registrando, NO la agregamos (puede pertenecer a otro SAP).
        if (targetSap && docLine.sap_doc &&
            String(docLine.sap_doc).trim() !== targetSap) {
          continue;
        }
        newAdded.add(m.line_id);
        newQtys[m.line_id] = Number(docLine.qty || 0);
      }
      setAddedLineIds(newAdded);
      setConfirmedQtys(newQtys);
    } catch (e) {
      setAnalysisError(e.message || "Error analizando el documento");
    } finally {
      setAnalyzing(false);
    }
  };

  const onFileSelected = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!ACCEPTED_EXT_RE.test(f.name)) {
      setFileError(lang === "es"
        ? "Formato no soportado. Use PDF, XLSX, XLS o CSV."
        : "Unsupported format. Use PDF, XLSX, XLS or CSV.");
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      setFileError(lang === "es" ? "Máximo 10MB" : "Max 10MB");
      return;
    }
    setFileError(null);
    setFile(f);
    // Disparar análisis IA en background
    runAnalysis(f);
  };
  const onDrop = (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) {
      const dt = { target: { files: [f] } };
      onFileSelected(dt);
    }
  };

  const clearFile = () => {
    setFile(null);
    setAnalysis(null);
    setAnalysisError(null);
    setAnalyzing(false);
    setSyncError(null);
    setSyncedAt(null);
  };

  // Sprint 2026-05-04 (AG-03): convierte las discrepancias actuales en
  // acciones aplicables (ADD_LINE / UPDATE_QTY) y las envía al backend.
  // Mismo patrón que /resolve-match/ del matchmaker OC/Proforma.
  const buildSyncActions = () => {
    if (!analysis?.discrepancies) return [];
    const out = [];
    for (const d of analysis.discrepancies) {
      if (d.kind === "MISSING_IN_EXPEDIENTE" && d.sku && d.talla) {
        out.push({
          kind:        "ADD_LINE",
          sku:         d.sku,
          talla:       d.talla,
          qty:         Number(d.qty_doc || 0),
          qty_doc:     Number(d.qty_doc || 0),
          descripcion: d.descripcion || null,
          sap_doc:     d.sap_doc || null,
        });
      } else if (d.kind === "QTY_DIFF" && d.line_id) {
        out.push({
          kind:    "UPDATE_QTY",
          line_id: d.line_id,
          qty:     Number(d.qty_doc || 0),
          qty_doc: Number(d.qty_doc || 0),
          sku:     d.sku,
          talla:   d.talla,
        });
      }
      // NAME_DIFF y INCOMPLETE_KEY no son auto-sincronizables — el
      // operador debe revisar manualmente.
    }
    return out;
  };

  const syncableCount = useMemo(
    () => buildSyncActions().length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [analysis],
  );

  const handleSync = async () => {
    if (syncing || !analysis?.ok || !expediente?.id) return;
    const actions = buildSyncActions();
    if (actions.length === 0) return;
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await postSyncDiscrepancies({
        expedienteId: expediente.id,
        actions,
      });

      // 1) Mergear new_lines en extraLines y agregarlas a addedLineIds.
      const incoming = (res.new_lines || []).map(l => ({
        id:            l.id,
        sku:           l.sku,
        size:          l.size,
        talla:         l.size,
        qty:           Number(l.qty || 0),
        descripcion:   l.descripcion || l.sku,
        product:       l.descripcion || l.sku,
        product_label: l.descripcion || l.sku,
        producto_id:   l.producto_id || null,
        unit_price:    Number(l.unit_price || 0),
        total_price:   Number(l.total_price || 0),
        sap:           l.sap || null,
        expediente_id: expediente.id,
        exp_id:        expediente.id,
        estado:        "PENDIENTE_SAP",
      }));
      if (incoming.length > 0) {
        setExtraLines(prev => {
          const seen = new Set(prev.map(l => l.id));
          const fresh = incoming.filter(l => !seen.has(l.id));
          return [...prev, ...fresh];
        });
      }

      // 2) Auto-add las líneas insertadas al SAP en curso, con qty del doc.
      const newAdded = new Set(addedLineIds);
      const newQtys  = { ...confirmedQtys };
      incoming.forEach(l => {
        newAdded.add(l.id);
        newQtys[l.id] = Number(l.qty || 0);
      });
      // 3) Aplicar UPDATE_QTY locales (sin esperar refetch del padre).
      (res.updated_lines || []).forEach(u => {
        if (u.line_id) {
          newQtys[u.line_id] = Number(u.qty || 0);
          newAdded.add(u.line_id);
        }
      });
      setAddedLineIds(newAdded);
      setConfirmedQtys(newQtys);
      setSyncedAt(new Date().toISOString());

      // 4) Best-effort: avisar al padre para que refetche líneas (opcional).
      try { onLinesChanged?.(); } catch { /* no-op */ }

      // 5) Re-correr análisis: ahora la BD tiene las líneas, el cruce
      //    debería volver perfect_match (o al menos sin MISSING/QTY_DIFF
      //    de los que ya aplicamos).
      if (file) {
        await runAnalysis(file);
      }
    } catch (e) {
      setSyncError(e.message || "Error sincronizando discrepancias");
    } finally {
      setSyncing(false);
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
      // Sprint 2026-05-01: tambien enviamos `unit_price` resuelto en el
      // OC (catalogo / client_prices override) para que el backend lo
      // persista en expedientes.linea.unit_price y el expediente lo
      // muestre correctamente desde el inicio.
      const lineasConfirmadas = addedLines.map(l => ({
        linea_id:        l.id,
        qty_confirmada:  Number(confirmedQtys[l.id] ?? l.qty ?? 0),
        unit_price:      Number(l.unit_price || 0),
      }));
      const result = await (isEditMode ? postUpsertSap : postConfirmSap)({
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
                  {isEditMode
                    ? (lang === "es" ? "Editar Confirmación SAP" : "Edit SAP Confirmation")
                    : (lang === "es" ? "Agregar Confirmación SAP" : "Add SAP Confirmation")}
                </div>
                <div className="caption">
                  {isEditMode
                    ? (lang === "es"
                        ? "Editá número, fecha, líneas o reemplazá el PDF. No cambia el estado del expediente."
                        : "Edit number, date, lines or replace PDF. Doesn't change expediente state.")
                    : (lang === "es"
                        ? "Comando C5 · genera el artefacto ART-04 y mueve el expediente a PRODUCCIÓN."
                        : "Command C5 · generates the ART-04 artifact and moves the expediente to PRODUCTION.")}
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
                  accept={ACCEPTED_INPUT}
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
                        ? "Subir Confirmación SAP (ART-04) · IA analizará el contenido"
                        : "Upload SAP Confirmation (ART-04) · AI will analyze contents"}
                    </div>
                    <div className="caption">
                      {lang === "es"
                        ? "PDF · XLSX · XLS · CSV · máx. 10MB · arrastrá o hacé click"
                        : "PDF · XLSX · XLS · CSV · max 10MB · drag or click"}
                    </div>
                  </>
                ) : (
                  <div className="sap-file-preview">
                    <div className="sap-file-icon" style={{
                      background: analyzing ? BLUE : (analysisError ? AMBER : MINT),
                    }}>
                      {analyzing ? <span className="sap-spinner"/> : <IconFileText size={16}/>}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="heading-sm" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {file.name}
                      </div>
                      <div className="caption tabular-nums">
                        {prettyBytes(file.size)}
                        {file.name.match(ACCEPTED_EXT_RE)
                          ? ` · ${file.name.split('.').pop().toUpperCase()}`
                          : ""}
                        {analyzing && (lang === "es"
                          ? " · analizando…"
                          : " · analyzing…")}
                        {!analyzing && analysis?.ok && (lang === "es"
                          ? ` · ${analysis.summary?.lines_in_doc || 0} líneas detectadas`
                          : ` · ${analysis.summary?.lines_in_doc || 0} lines detected`)}
                      </div>
                    </div>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={(e) => { e.stopPropagation(); clearFile(); }}
                      disabled={analyzing}
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

              {/* ── Panel de resultado IA ─────────────────────
                  Sprint 2026-05-04 (AG-03): muestra el resumen del
                  análisis: SAP detectado, líneas matched, discrepancias.
                  Tokens MWT: usa CSS vars + colores semánticos por tono. */}
              {analysisError && (
                <div className="sap-inline-error" style={{ marginTop: 8 }}>
                  <IconAlert size={12}/>
                  <span>
                    {lang === "es"
                      ? `No pude analizar el documento: ${analysisError}`
                      : `Could not analyze document: ${analysisError}`}
                  </span>
                </div>
              )}

              {analysis?.ok && (
                <div className="sap-ai-panel" style={{
                  marginTop: 12,
                  border: "1px solid var(--border-subtle, rgba(11,30,58,0.1))",
                  borderRadius: 10,
                  background: "var(--surface-alt, rgba(48,131,254,0.03))",
                  padding: 12,
                  fontSize: 13,
                }}>
                  <div style={{
                    display: "flex", alignItems: "center", gap: 8,
                    marginBottom: 8,
                  }}>
                    <IconSparkle size={13} style={{ color: BLUE }}/>
                    <span className="heading-sm" style={{ color: NAVY, fontWeight: 700 }}>
                      {lang === "es"
                        ? "Análisis IA del documento"
                        : "AI Document Analysis"}
                    </span>
                    <span className="micro" style={{
                      marginLeft: "auto",
                      padding: "2px 8px", borderRadius: 4,
                      background: "rgba(48,131,254,0.08)",
                      color: BLUE, fontWeight: 700, fontSize: 10,
                      letterSpacing: "0.04em",
                    }}>
                      {analysis.kind === "xlsx_marluvas" ? "MARLUVAS · XLSX"
                        : analysis.kind === "csv_marluvas" ? "CSV"
                        : analysis.kind === "pdf_ai" ? "IA · PDF"
                        : (analysis.kind || "").toUpperCase()}
                    </span>
                  </div>

                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(4, 1fr)",
                    gap: 8, marginBottom: 8,
                  }}>
                    <div className="sap-ai-stat">
                      <div className="micro text-sec">SAP {analysis.sap_count > 1 ? lang === "es" ? "(detectados)" : "(detected)" : ""}</div>
                      <div className="heading-sm mono tabular-nums" style={{ color: NAVY, fontWeight: 800 }}>
                        {analysis.sap_id || "—"}
                      </div>
                      {analysis.sap_count > 1 && (
                        <div className="micro" style={{ color: AMBER }}>
                          +{analysis.sap_count - 1} {lang === "es" ? "más" : "more"}
                        </div>
                      )}
                    </div>
                    <div className="sap-ai-stat">
                      <div className="micro text-sec">{lang === "es" ? "Líneas en doc." : "Lines in doc"}</div>
                      <div className="heading-sm tabular-nums" style={{ color: NAVY, fontWeight: 800 }}>
                        {fmtNumber(analysis.summary?.lines_in_doc || 0)}
                      </div>
                    </div>
                    <div className="sap-ai-stat">
                      <div className="micro text-sec">{lang === "es" ? "Matched" : "Matched"}</div>
                      <div className="heading-sm tabular-nums" style={{ color: MINT, fontWeight: 800 }}>
                        {fmtNumber(analysis.summary?.lines_matched || 0)}
                      </div>
                    </div>
                    <div className="sap-ai-stat">
                      <div className="micro text-sec">{lang === "es" ? "Discrepancias" : "Discrepancies"}</div>
                      <div
                        className="heading-sm tabular-nums"
                        style={{
                          fontWeight: 800,
                          color: (analysis.summary?.discrepancies_count || 0) === 0 ? MINT : AMBER,
                        }}>
                        {fmtNumber(analysis.summary?.discrepancies_count || 0)}
                      </div>
                    </div>
                  </div>

                  {analysis.summary?.perfect_match ? (
                    <div style={{
                      display: "flex", alignItems: "center", gap: 6,
                      color: MINT, fontWeight: 700, fontSize: 12,
                    }}>
                      <IconCheck size={12}/>
                      <span>
                        {lang === "es"
                          ? "Match perfecto · todas las líneas del documento existen en el expediente con la cantidad correcta."
                          : "Perfect match · every doc line exists in the expediente with the right quantity."}
                      </span>
                    </div>
                  ) : (
                    (analysis.discrepancies || []).length > 0 && (
                      <details open style={{ marginTop: 4 }}>
                        <summary style={{
                          cursor: "pointer", color: NAVY,
                          fontWeight: 700, fontSize: 12,
                          display: "flex", alignItems: "center",
                          gap: 6, flexWrap: "wrap",
                        }}>
                          <IconAlert size={12} style={{ color: AMBER }}/>
                          <span style={{ flex: 1 }}>
                            {lang === "es"
                              ? `${analysis.discrepancies.length} discrepancia(s) encontradas`
                              : `${analysis.discrepancies.length} discrepancy(ies) found`}
                          </span>
                          {/* Sprint 2026-05-04 (AG-03): botón Sincronizar.
                              Aplica las acciones derivadas del análisis IA
                              (ADD_LINE para tallas faltantes con precio del
                              cliente, UPDATE_QTY para cantidades distintas).
                              Mismo patrón que /resolve-match/ del matchmaker
                              OC/Proforma. */}
                          {syncableCount > 0 && (
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={(e) => { e.preventDefault(); handleSync(); }}
                              disabled={syncing}
                              data-loading={syncing}
                              style={{
                                background: BLUE, color: "white",
                                border: 0, padding: "4px 10px",
                                borderRadius: 6, fontWeight: 700,
                                fontSize: 11, cursor: syncing ? "wait" : "pointer",
                                display: "inline-flex", alignItems: "center", gap: 5,
                                opacity: syncing ? 0.7 : 1,
                              }}
                              title={lang === "es"
                                ? "Crea las tallas faltantes con el precio del cliente y ajusta cantidades."
                                : "Create missing sizes with client price and adjust quantities."}>
                              {syncing
                                ? <span className="sap-spinner" style={{ width: 10, height: 10 }}/>
                                : <IconSparkle size={11}/>}
                              {syncing
                                ? (lang === "es" ? "Sincronizando…" : "Syncing…")
                                : (lang === "es"
                                    ? `Sincronizar ${syncableCount}`
                                    : `Sync ${syncableCount}`)}
                            </button>
                          )}
                        </summary>
                        {syncError && (
                          <div className="sap-inline-error" style={{
                            margin: "6px 0", padding: "6px 8px",
                            borderRadius: 6,
                          }}>
                            <IconAlert size={11}/>
                            <span style={{ fontSize: 11 }}>{syncError}</span>
                          </div>
                        )}
                        {syncedAt && !syncing && !syncError && (
                          <div style={{
                            margin: "6px 0", padding: "6px 8px",
                            borderRadius: 6,
                            background: "rgba(0,178,134,0.08)",
                            color: MINT, fontWeight: 700, fontSize: 11,
                            display: "inline-flex", alignItems: "center", gap: 5,
                          }}>
                            <IconCheck size={11}/>
                            {lang === "es"
                              ? "Discrepancias sincronizadas con el expediente."
                              : "Discrepancies synced into expediente."}
                          </div>
                        )}
                        <div style={{
                          marginTop: 8, maxHeight: 220, overflowY: "auto",
                          border: "1px solid var(--border-subtle, rgba(11,30,58,0.08))",
                          borderRadius: 8, background: "white",
                        }}>
                          {analysis.discrepancies.map((d, i) => {
                            const tone = d.severity === "ERROR" ? RED
                                       : d.severity === "WARN"  ? AMBER
                                       : BLUE;
                            const labelByKind = {
                              MISSING_IN_EXPEDIENTE: lang === "es"
                                ? "No está en el expediente" : "Not in expediente",
                              QTY_DIFF: lang === "es"
                                ? "Cantidad difiere" : "Qty differs",
                              NAME_DIFF: lang === "es"
                                ? "Nombre difiere" : "Name differs",
                              INCOMPLETE_KEY: lang === "es"
                                ? "Falta SKU o talla" : "Missing SKU or size",
                            };
                            return (
                              <div
                                key={i}
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "auto 1fr auto",
                                  gap: 8, padding: "8px 10px",
                                  borderBottom: "1px solid var(--border-subtle, rgba(11,30,58,0.06))",
                                  fontSize: 12,
                                }}>
                                <span style={{
                                  alignSelf: "start",
                                  padding: "2px 6px", borderRadius: 4,
                                  background: `${tone}15`, color: tone,
                                  fontWeight: 700, fontSize: 10,
                                  letterSpacing: "0.04em",
                                }}>
                                  {labelByKind[d.kind] || d.kind}
                                </span>
                                <div style={{ minWidth: 0 }}>
                                  <div className="mono" style={{ color: NAVY, fontWeight: 700 }}>
                                    {d.sku || "—"}
                                    {d.talla && (
                                      <span style={{
                                        marginLeft: 6, padding: "0 6px", borderRadius: 3,
                                        background: "rgba(11,30,58,0.06)", fontSize: 10,
                                      }}>{d.talla}</span>
                                    )}
                                  </div>
                                  {(d.descripcion || d.descripcion_doc || d.nombre_exp) && (
                                    <div className="caption text-sec" style={{
                                      fontSize: 11, marginTop: 2,
                                      overflow: "hidden", textOverflow: "ellipsis",
                                      whiteSpace: "nowrap",
                                    }}>
                                      {d.kind === "NAME_DIFF"
                                        ? `doc: "${d.descripcion_doc || ''}" · exp: "${d.nombre_exp || ''}"`
                                        : (d.descripcion || d.nombre_exp || "")}
                                    </div>
                                  )}
                                </div>
                                <div className="tabular-nums" style={{
                                  textAlign: "right", whiteSpace: "nowrap",
                                  alignSelf: "center", color: NAVY,
                                }}>
                                  {(d.kind === "QTY_DIFF" || d.kind === "MISSING_IN_EXPEDIENTE") && (
                                    <>
                                      <span style={{ color: BLUE, fontWeight: 700 }}>
                                        {fmtNumber(d.qty_doc)}
                                      </span>
                                      <span style={{ color: "var(--text-tertiary)" }}> doc</span>
                                      {d.kind === "QTY_DIFF" && (
                                        <>
                                          <span style={{ margin: "0 4px", color: "var(--text-tertiary)" }}>vs</span>
                                          <span style={{ color: NAVY, fontWeight: 700 }}>
                                            {fmtNumber(d.qty_exp)}
                                          </span>
                                          <span style={{ color: "var(--text-tertiary)" }}> exp</span>
                                        </>
                                      )}
                                    </>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </details>
                    )
                  )}

                  {analysis.sap_count > 1 && (
                    <div style={{
                      marginTop: 8, padding: 8,
                      borderRadius: 6, background: "rgba(180,83,9,0.06)",
                      color: AMBER, fontSize: 11, lineHeight: 1.4,
                    }}>
                      <IconAlert size={11} style={{ marginRight: 4, verticalAlign: "middle" }}/>
                      {lang === "es"
                        ? `El documento contiene varios SAPs (${(analysis.all_saps || []).join(", ")}). Sólo se pre-seleccionaron las líneas del SAP "${analysis.sap_id}". Cargá los demás SAPs por separado.`
                        : `Document has multiple SAPs (${(analysis.all_saps || []).join(", ")}). Only "${analysis.sap_id}" lines were pre-selected. Upload remaining SAPs separately.`}
                    </div>
                  )}
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
                            {Number(l.unit_price || 0) > 0 && (
                              <div className="caption" style={{
                                fontSize: 10, color: 'var(--text-tertiary)',
                                marginTop: 1, fontVariantNumeric: 'tabular-nums',
                              }}>
                                ${Number(l.unit_price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/u
                              </div>
                            )}
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
