// =====================================================================
// MWT.ONE · api.js
// Wrapper mínimo para llamadas al backend DRF. Inyecta el token JWT y
// normaliza el manejo de errores (401 → trigger logout desde AuthContext).
// =====================================================================

const API_BASE = import.meta.env.VITE_API_BASE || "/api";

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export async function apiFetch(path, { method = "GET", body, token, headers = {} } = {}) {
  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  };
  if (body !== undefined) opts.body = typeof body === "string" ? body : JSON.stringify(body);

  let resp;
  try {
    resp = await fetch(`${API_BASE}${path}`, opts);
  } catch (e) {
    throw new ApiError("No se pudo contactar al servidor", 0, null);
  }

  let data = null;
  const text = await resp.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
  }

  if (!resp.ok) {
    const msg = data?.detail || data?.message || data?.error || `HTTP ${resp.status}`;
    throw new ApiError(msg, resp.status, data);
  }
  return data;
}

// -------- Auth endpoints ---------------------------------------------
export const authApi = {
  login:    (usuario, password) => apiFetch("/auth/login/",    { method: "POST", body: { usuario, password } }),
  refresh:  (refresh)           => apiFetch("/auth/refresh/",  { method: "POST", body: { refresh } }),
  me:       (token)             => apiFetch("/auth/me/",       { token }),
  logout:   (token, refresh)    => apiFetch("/auth/logout/",   { method: "POST", token, body: { refresh } }),
};

// ---------------------------------------------------------------------
// Token helper: lee el access token guardado por AuthContext
// ---------------------------------------------------------------------
export const getToken = () =>
  (typeof localStorage !== "undefined" && localStorage.getItem("mwt_access")) || null;

// ---------------------------------------------------------------------
// CRUD genérico alineado al ViewSet de DRF.
//   resource("nodos")    → { list, get, create, update, remove, select }
// Cumple "cero hardcode": cada dropdown del FE consume select("nombre_cat").
// ---------------------------------------------------------------------
export function resource(name) {
  const base = `/${name}/`;
  const tokenOpt = () => ({ token: getToken() });

  const qs = (params) => {
    if (!params) return "";
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") usp.set(k, v);
    }
    const s = usp.toString();
    return s ? `?${s}` : "";
  };

  return {
    list:   (params)      => apiFetch(`${base}${qs(params)}`,                { ...tokenOpt() }),
    get:    (id)          => apiFetch(`${base}${id}/`,                       { ...tokenOpt() }),
    create: (body)        => apiFetch(base,                                  { method: "POST",   body, ...tokenOpt() }),
    update: (id, body)    => apiFetch(`${base}${id}/`,                       { method: "PATCH",  body, ...tokenOpt() }),
    replace:(id, body)    => apiFetch(`${base}${id}/`,                       { method: "PUT",    body, ...tokenOpt() }),
    remove: (id)          => apiFetch(`${base}${id}/`,                       { method: "DELETE", ...tokenOpt() }),
    // acciones custom del ViewSet: select_tipos, select_paises, kpis, etc.
    // action(name)               → GET   /resource/<name>/
    // action(name, id)           → GET   /resource/<id>/<name>/
    // action(name, id, body)     → POST  /resource/<id>/<name>/  (para state transitions)
    // action(name, null, body)   → POST  /resource/<name>/
    action: (name, id, body) => {
      const path = id ? `${base}${id}/${name}/` : `${base}${name}/`;
      if (body !== undefined) {
        return apiFetch(path, { method: "POST", body, ...tokenOpt() });
      }
      return apiFetch(path, { ...tokenOpt() });
    },
    select: (selectName)  => apiFetch(`${base}select_${selectName}/`,        { ...tokenOpt() }),
  };
}

export const nodosApi          = resource("nodos");
export const marcasApi         = resource("marcas");
export const clientesApi       = resource("clientes");
export const productosApi      = resource("productos");
export const proveedoresApi    = resource("proveedores");
export const stockApi          = resource("stock");
export const movimientosApi    = resource("movimientos");
export const ocsApi            = resource("ocs");
export const expedientesApi    = resource("expedientes");
export const lineasApi         = resource("lineas");
export const documentosApi     = resource("documentos");
export const cobrosApi         = resource("cobros");
export const pagosApi          = resource("pagos");
export const conciliacionesApi = resource("conciliaciones");
export const transferenciasApi    = resource("transferencias");
export const transferLineasApi    = resource("transfer-lineas");
export const transferEventosApi   = resource("transfer-eventos");
export const emailTemplatesApi    = resource("email-templates");
export const emailTemplateVersionsApi = resource("email-template-versions");
export const notificationLogsApi  = resource("notification-logs");
export const collectionLogsApi    = resource("collection-logs");

// ---------------------------------------------------------------------
// Storage (apps.storage) — MinIO signed URLs + Paperless OCR ingest.
//   POST /api/storage/signed_url/        { key, kind: "get"|"put", ttl }
//   POST /api/storage/paperless_ingest/  { filename, body_b64, ... }
//   GET  /api/storage/healthz/
// ---------------------------------------------------------------------
const storageBase = "/storage";
export const storageApi = {
  signedUrl: (key, kind = "get", ttl = 900, bucket) =>
    apiFetch(`${storageBase}/signed_url/`, {
      method: "POST",
      body: { key, kind, ttl, bucket },
      token: getToken(),
    }),
  paperlessIngest: (payload) =>
    apiFetch(`${storageBase}/paperless_ingest/`, {
      method: "POST",
      body: payload,
      token: getToken(),
    }),
  healthz: () =>
    apiFetch(`${storageBase}/healthz/`, { token: getToken() }),
  // Shortcut para resolver la URL firmada de un documento por id
  documentSignedUrl: (documentoId, ttl = 900) =>
    apiFetch(`/documentos/${documentoId}/signed_url/?ttl=${ttl}`, { token: getToken() }),
};

// ---------------------------------------------------------------------
// Analytics (apps.analytics) — read-only cross-schema aggregations.
//   GET /api/analytics/dashboard_kpis/
//   GET /api/analytics/cashflow/
//   GET /api/analytics/aging/
//   GET /api/analytics/exposicion_clientes/
//   GET /api/analytics/margen_marcas/
//   GET /api/analytics/by_status/
//   GET /api/analytics/urgent/
// ---------------------------------------------------------------------
const analyticsBase = "/analytics";
export const analyticsApi = {
  dashboardKpis:       () => apiFetch(`${analyticsBase}/dashboard_kpis/`,       { token: getToken() }),
  cashflow:            () => apiFetch(`${analyticsBase}/cashflow/`,             { token: getToken() }),
  aging:               () => apiFetch(`${analyticsBase}/aging/`,                { token: getToken() }),
  exposicionClientes:  () => apiFetch(`${analyticsBase}/exposicion_clientes/`,  { token: getToken() }),
  margenMarcas:        () => apiFetch(`${analyticsBase}/margen_marcas/`,        { token: getToken() }),
  byStatus:            () => apiFetch(`${analyticsBase}/by_status/`,            { token: getToken() }),
  urgent:              () => apiFetch(`${analyticsBase}/urgent/`,               { token: getToken() }),
};

// ---------------------------------------------------------------------
// Portal B2B (apps.portal) — read-only, scopeado al client_id.
// Acepta `clientId` opcional para dev (se envía por header X-Portal-Client
// hasta que el JWT claim portal_client_id esté en producción).
// ---------------------------------------------------------------------
const portalBase = "/portal";
const portalHeaders = (clientId) => clientId ? { "X-Portal-Client": clientId } : {};
export const portalApi = {
  me:             (cid) => apiFetch(`${portalBase}/me/`,             { token: getToken(), headers: portalHeaders(cid) }),
  kpis:           (cid) => apiFetch(`${portalBase}/kpis/`,           { token: getToken(), headers: portalHeaders(cid) }),
  misOcs:         (cid) => apiFetch(`${portalBase}/mis_ocs/`,        { token: getToken(), headers: portalHeaders(cid) }),
  misExpedientes: (cid) => apiFetch(`${portalBase}/mis_expedientes/`,{ token: getToken(), headers: portalHeaders(cid) }),
  misPagos:       (cid) => apiFetch(`${portalBase}/mis_pagos/`,      { token: getToken(), headers: portalHeaders(cid) }),
  misCobros:      (cid) => apiFetch(`${portalBase}/mis_cobros/`,     { token: getToken(), headers: portalHeaders(cid) }),
  misDocumentos:  (cid) => apiFetch(`${portalBase}/mis_documentos/`, { token: getToken(), headers: portalHeaders(cid) }),
};
