// =====================================================================
// MWT.ONE · lib/expedienteExport.js
// Agente responsable: [AG-03 FRONTEND]
//
// Orquestador del export de expedientes desde la pantalla /expedientes.
// Resuelve el conjunto de expedientes a partir de filtros NO obligatorios
// (cliente, estado, expediente específico), pide el factura-payload de cada
// uno y arma un único documento HTML "Resumen de Exportación".
//
// El payload trae precio dual (mwt/cliente), operated_by_mwt y los costos
// del MOVIMIENTO ligado — la matriz de precio se aplica por expediente en
// expedienteExportHtml.js (effectiveAudienceFor).
// =====================================================================
import { getToken } from "./api.js";
import {
  buildExpedientesExportHtml,
  downloadTransferInvoice,
  INVOICE_AUDIENCE,
} from "./expedienteExportHtml.js";

const API_BASE =
  (import.meta && import.meta.env && import.meta.env.VITE_API_BASE) || "/api";

/** GET autenticado → JSON. */
async function fetchJson(path) {
  const token = getToken();
  const resp = await fetch(`${API_BASE}${path}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`HTTP ${resp.status} ${path}${txt ? ": " + txt.slice(0, 120) : ""}`);
  }
  return resp.json();
}

/** Pide el factura-payload de un expediente (autenticado). */
async function fetchPayload(expedienteId) {
  return fetchJson(
    `/expedientes/${encodeURIComponent(expedienteId)}/factura-payload/`,
  );
}

/**
 * Trae los artefactos del Builder del expediente (Packing List, AWB/BL, …).
 * Lista: /inventario/expedientes/{id}/artifacts/
 * Detalle: /nodos/{nodo_id}/builder-artifacts/{artifact_id}/ (trae data +
 * structure_snapshot con labels y archivos). Tolerante a fallos.
 * @returns {Promise<Array>} detalles de artefacto
 */
async function fetchArtifacts(expedienteId) {
  let list;
  try {
    list = await fetchJson(
      `/inventario/expedientes/${encodeURIComponent(expedienteId)}/artifacts/`,
    );
  } catch {
    return [];
  }
  const arr = Array.isArray(list) ? list : (list?.results || []);
  const details = await Promise.allSettled(
    arr
      .filter((a) => a && a.nodo_id && a.id)
      .map((a) =>
        fetchJson(
          `/nodos/${encodeURIComponent(a.nodo_id)}/builder-artifacts/${encodeURIComponent(a.id)}/`,
        ),
      ),
  );
  return details
    .filter((d) => d.status === "fulfilled")
    .map((d) => d.value);
}

/**
 * Costos del MOVIMIENTO puntual del expediente (no el fan-out histórico).
 * `trfId` = payload.transferencia.id (transfer más reciente ligado). Si no
 * hay transfer real (cae al expediente_id), no consulta. Devuelve las
 * cost_line con su `price_view` para que el front filtre MWT/Cliente.
 */
async function fetchCostLines(trfId, expedienteId) {
  if (!trfId || trfId === expedienteId) return [];
  try {
    const r = await fetchJson(`/transferencias/${encodeURIComponent(trfId)}/cost-lines/`);
    return Array.isArray(r) ? r : (r?.results || []);
  } catch {
    return [];
  }
}

/**
 * Event log del expediente (cambios de fase REGISTRO→…→CERRADO) para el
 * Gantt del Cronograma. GET /expedientes/{id}/events/ — tolerante a fallos
 * (si el rol no puede verlo, el Gantt cae al fallback embarque/ETA).
 */
async function fetchEvents(expedienteId) {
  try {
    const r = await fetchJson(
      `/expedientes/${encodeURIComponent(expedienteId)}/events/?limit=200`,
    );
    return Array.isArray(r) ? r : (r?.results || []);
  } catch {
    return [];
  }
}

/**
 * Overrides manuales de días por fase — mismo endpoint que usa el detalle
 * del expediente. Fallback/refuerzo del campo `phase_durations` del
 * factura-payload (cubre cualquier mismatch de ids en el backend).
 */
async function fetchPhaseDurations(expedienteId) {
  try {
    const r = await fetchJson(
      `/expedientes/${encodeURIComponent(expedienteId)}/phase-durations/`,
    );
    return (r && r.phase_durations) || {};
  } catch {
    return {};
  }
}

/**
 * Resuelve el conjunto de expedientes objetivo según los filtros.
 * @param {Array} expedientes  filas cargadas en la pantalla (mapExpedienteFromApi)
 * @param {Object} f  { expedienteUuid, clienteId, estado }
 * @returns {Array} subconjunto de filas
 */
export function resolveTargets(expedientes, f = {}) {
  const rows = Array.isArray(expedientes) ? expedientes : [];
  if (f.expedienteUuid) {
    return rows.filter((r) => (r.uuid || r.id) === f.expedienteUuid);
  }
  return rows.filter((r) => {
    if (f.clienteId && f.clienteId !== "ALL" && r.client_id !== f.clienteId) return false;
    if (f.estado && f.estado !== "ALL" && r.status !== f.estado) return false;
    return true;
  });
}

/**
 * Ejecuta el export completo: resuelve, descarga payloads, arma y baja HTML.
 * @param {Object} args
 * @param {Array} args.expedientes
 * @param {('MWT'|'CLIENT')} args.audience
 * @param {('es'|'en')} [args.lang='es']
 * @param {Object} [args.filters]  { expedienteUuid, clienteId, estado, clienteLabel, estadoLabel, expedienteLabel }
 * @param {string} [args.generatedBy]
 * @returns {Promise<{count:number, filename:string}>}
 */
export async function runExpedienteExport({
  expedientes,
  audience = INVOICE_AUDIENCE.MWT,
  lang = "es",
  filters = {},
  generatedBy = "",
}) {
  const targets = resolveTargets(expedientes, filters);
  if (!targets.length) {
    throw new Error(
      lang === "es"
        ? "No hay expedientes que coincidan con los filtros seleccionados."
        : "No files match the selected filters.",
    );
  }

  // Descarga de payloads en paralelo, tolerante a fallos individuales.
  const settled = await Promise.allSettled(
    targets.map((r) => fetchPayload(r.uuid || r.id)),
  );

  const items = [];
  const errors = [];
  settled.forEach((res, i) => {
    const r = targets[i];
    if (res.status === "fulfilled") {
      items.push({
        payload: res.value,
        expedienteId: r.uuid || r.id,
        artifacts: [],
        costLines: [],
        codigo: r.ref || (res.value && res.value.proforma_codigo) || "",
        estado: r.status || "",
        // Sprint 2026-06-10 — hints de la fila para el Cronograma:
        // fecha de creación (inicio de REGISTRO cuando no hay eventos),
        // método de envío y fechas logísticas del expediente.
        created_at: r.created_at || null,
        freight_mode: r.freight_mode || "",
        eta: r.eta || null,
        shipment_date: r.shipment_date || null,
        sap: r.sap || (Array.isArray(r.sap_codigos) ? r.sap_codigos[0] : "") || "",
        oc_codigo:
          (Array.isArray(r.oc_codigos) ? r.oc_codigos[0] : "") ||
          (res.value && res.value.oc_codigo) ||
          "",
      });
    } else {
      errors.push(res.reason && res.reason.message ? res.reason.message : String(res.reason));
    }
  });

  if (!items.length) {
    throw new Error(
      (lang === "es" ? "No se pudo obtener ningún expediente. " : "Could not fetch any file. ") +
        errors.join(" · "),
    );
  }

  // Artefactos del Builder (Packing List, AWB/BL, …) por expediente.
  const includeArtifacts = filters.includeArtifacts !== false;
  if (includeArtifacts) {
    const artRes = await Promise.allSettled(
      items.map((it) => fetchArtifacts(it.expedienteId)),
    );
    artRes.forEach((r, i) => {
      items[i].artifacts = r.status === "fulfilled" ? r.value : [];
    });
  }

  // Costos del movimiento para AMBAS audiencias: la liquidación landed se
  // calcula por vista (MWT y Cliente cada una con sus tasas/valores).
  const clRes = await Promise.allSettled(
    items.map((it) =>
      fetchCostLines(
        it.payload && it.payload.transferencia && it.payload.transferencia.id,
        it.expedienteId,
      ),
    ),
  );
  clRes.forEach((r, i) => {
    items[i].costLines = r.status === "fulfilled" ? r.value : [];
  });

  // Historial de fases (EventLog) → Gantt por estado del Cronograma.
  const evRes = await Promise.allSettled(
    items.map((it) => fetchEvents(it.expedienteId)),
  );
  evRes.forEach((r, i) => {
    items[i].events = r.status === "fulfilled" ? r.value : [];
  });

  // Overrides manuales de días por fase: refuerza/llena payload.phase_durations
  // con el endpoint dedicado (el factura-payload puede venir vacío si el id
  // del export no matchea directo en el backend).
  const pdRes = await Promise.allSettled(
    items.map((it) => fetchPhaseDurations(it.expedienteId)),
  );
  pdRes.forEach((r, i) => {
    const pd = r.status === "fulfilled" ? r.value : {};
    if (pd && Object.keys(pd).length) {
      const base = (items[i].payload && items[i].payload.phase_durations) || {};
      items[i].payload = {
        ...(items[i].payload || {}),
        phase_durations: { ...base, ...pd },
      };
    }
  });

  const fileBase =
    typeof window !== "undefined" && window.location ? window.location.origin : "";

  const html = buildExpedientesExportHtml({
    items,
    audience,
    lang,
    fileBase,
    filters: {
      clienteLabel: filters.clienteLabel || "",
      estadoLabel: filters.estadoLabel || "",
      expedienteLabel: filters.expedienteLabel || "",
    },
    generatedBy,
  });

  const tag = audience === INVOICE_AUDIENCE.CLIENT ? "CLIENTE" : "MWT";
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `Resumen_Exportacion_${tag}_${stamp}.html`;
  downloadTransferInvoice(html, filename);

  return { count: items.length, filename, skipped: errors.length };
}
