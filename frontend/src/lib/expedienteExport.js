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

/** Pide el factura-payload de un expediente (autenticado). */
async function fetchPayload(expedienteId) {
  const token = getToken();
  const resp = await fetch(
    `${API_BASE}/expedientes/${encodeURIComponent(expedienteId)}/factura-payload/`,
    { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } },
  );
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(
      `HTTP ${resp.status} (${expedienteId})${txt ? ": " + txt.slice(0, 120) : ""}`,
    );
  }
  return resp.json();
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
        codigo: r.ref || (res.value && res.value.proforma_codigo) || "",
        estado: r.status || "",
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

  const html = buildExpedientesExportHtml({
    items,
    audience,
    lang,
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
