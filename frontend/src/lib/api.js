// =====================================================================
// MWT.ONE · api.js
// Wrapper mínimo para llamadas al backend DRF. Inyecta el token JWT y
// normaliza el manejo de errores (401 → trigger logout desde AuthContext).
// =====================================================================

import {
  portalProductsListMock,
  portalProductsDetailMock,
} from "./portalProductsMock.js";
import { portalOcrParseMock } from "./ocrMock.js";
import {
  aiAgentsListMock, aiSkillsListMock, aiInstructionsListMock,
  aiAgentDetailMock, aiSkillDetailMock, aiInstructionDetailMock,
} from "./aiGovernanceMock.js";
import {
  ROLES_DEMO, MODULES_DEMO, USERS_DEMO, ME_PROFILE_MOCK,
  roleMatrixMock, usersListMock, userDetailMock,
  activityFeedListMock, activityFeedUnreadCountMock,
  legalEntityMock, legalEntitiesListMock,
} from "./usersRolesMock.js";

const API_BASE = import.meta.env.VITE_API_BASE || "/api";

// =====================================================================
// Mock fixtures — paths cuya respuesta queremos quemar en modo demo.
// Si el path matchea, resolveMockFixture() devuelve el payload con el
// MISMO shape que el backend real (para que los componentes de vista
// no tengan que hacer branch-and-render).
//
// Paths cubiertos:
//   · GET /portal/products/                  → {count, limit, offset, results}
//   · GET /portal/products/<uuid>/           → detalle full
//
// Para agregar más fixtures, empujá más casos en resolveMockFixture.
// =====================================================================
function resolveMockFixture(path) {
  // /portal/products/<id>/   (detalle — match por regex para capturar UUID o string)
  const mDetail = path.match(/^\/portal\/products\/([^/?]+)\/?(?:\?.*)?$/);
  if (mDetail) {
    const productId = mDetail[1];
    const p = portalProductsDetailMock(productId);
    return p || { detail: "Producto no encontrado" };
  }

  // /portal/products/?limit=…&offset=…&q=…
  if (path.startsWith("/portal/products/") || path.startsWith("/portal/products?")) {
    const qs = path.split("?")[1] || "";
    const sp = new URLSearchParams(qs);
    return portalProductsListMock({
      limit:  Number(sp.get("limit"))  || 60,
      offset: Number(sp.get("offset")) || 0,
      q:      sp.get("q") || "",
    });
  }

  // ── AI Hub · Gobernanza ─────────────────────────────────────────
  // Detail endpoints (GET /api/ai/agents/<id>/, etc.)
  const mAiDetail = path.match(/^\/ai\/(agents|skills|instructions)\/([^/?]+)\/?(?:\?.*)?$/);
  if (mAiDetail) {
    const [, kind, id] = mAiDetail;
    const fn = (kind === "agents") ? aiAgentDetailMock
            : (kind === "skills") ? aiSkillDetailMock
            : aiInstructionDetailMock;
    return fn(id) || { detail: "No encontrado" };
  }

  // List endpoints (GET /api/ai/agents/?ordering=nombre, etc.)
  const mAiList = path.match(/^\/ai\/(agents|skills|instructions)\/?(?:\?(.*))?$/);
  if (mAiList) {
    const [, kind, qs] = mAiList;
    const sp = new URLSearchParams(qs || "");
    const params = {
      ordering:  sp.get("ordering") || undefined,
      is_active: sp.get("is_active") || undefined,
    };
    if (kind === "agents")       return aiAgentsListMock(params);
    if (kind === "skills")       return aiSkillsListMock(params);
    if (kind === "instructions") return aiInstructionsListMock(params);
  }

  // ── Users · Roles · Activity feed (M3 CORE) ─────────────────────
  // /api/users/me/profile/
  if (path.startsWith("/users/me/profile")) {
    return ME_PROFILE_MOCK;
  }
  // /api/users/<id>/
  const mUserDetail = path.match(/^\/users\/([^/?]+)\/?(?:\?.*)?$/);
  if (mUserDetail && mUserDetail[1] !== "me") {
    const u = userDetailMock(mUserDetail[1]);
    return u || { detail: "Usuario no encontrado" };
  }
  // /api/users/?q=…
  if (path.startsWith("/users/") || path.startsWith("/users?")) {
    const qs = path.split("?")[1] || "";
    const sp = new URLSearchParams(qs);
    return usersListMock({
      q:                 sp.get("q") || "",
      role:              sp.get("role") || undefined,
      include_inactive:  sp.get("include_inactive") === "true",
    });
  }

  // /api/permissions/roles/
  if (path.startsWith("/permissions/roles")) return ROLES_DEMO;
  // /api/permissions/modules/
  if (path.startsWith("/permissions/modules")) return MODULES_DEMO;
  // /api/permissions/groups/<slug>/
  const mGroup = path.match(/^\/permissions\/groups\/([^/?]+)\/?(?:\?.*)?$/);
  if (mGroup) {
    const result = roleMatrixMock(mGroup[1]);
    return result || { detail: "Role no existe" };
  }

  // /api/legal-entities/<id>/ — empresa individual (ficha completa)
  const mLEDetail = path.match(/^\/legal-entities\/([^/?]+)\/?(?:\?.*)?$/);
  if (mLEDetail) {
    const le = legalEntityMock(mLEDetail[1]);
    return le || { detail: "Empresa no encontrada" };
  }
  // /api/legal-entities/ — listado (para selector de UserFormView)
  if (path.startsWith("/legal-entities/") || path.startsWith("/legal-entities?")) {
    return legalEntitiesListMock();
  }

  // /api/activity-feed/unread-count/
  if (path.startsWith("/activity-feed/unread-count")) {
    return activityFeedUnreadCountMock();
  }
  // /api/activity-feed/
  if (path.startsWith("/activity-feed/") || path.startsWith("/activity-feed?")) {
    const qs = path.split("?")[1] || "";
    const sp = new URLSearchParams(qs);
    return activityFeedListMock({
      unread_only: sp.get("unread_only") || false,
      limit:       Number(sp.get("limit")) || 50,
    });
  }

  return undefined;
}

// =====================================================================
// MOCK MODE — kill-switch para apagar el backend salvo /auth/*.
// Activar con `VITE_USE_MOCKS=1` al buildear el frontend.
// Comportamiento:
//   · /auth/login/, /auth/refresh/, /auth/logout/, /auth/me/  → backend real.
//   · cualquier otro path:
//       - GET    → devuelve []  (las páginas detectan vacío y caen al
//                                 fallback hardcoded de data/mockData.js).
//       - POST/PUT/PATCH/DELETE → lanza ApiError con mensaje claro,
//                                 para no simular escrituras fantasma.
// Para reconectar el backend más tarde:  VITE_USE_MOCKS=0 + rebuild.
// =====================================================================
export const MOCKS_ENABLED = (
  import.meta.env.VITE_USE_MOCKS === "1" ||
  import.meta.env.VITE_USE_MOCKS === "true"
);

if (MOCKS_ENABLED && typeof window !== "undefined") {
  // Marca visible en consola para que cualquiera entienda por qué la app
  // no está pegándole al backend más allá del login.
  // eslint-disable-next-line no-console
  console.info("%c[api] MOCK MODE ON — solo /auth/* hace fetch real al backend.",
               "color:#B45309;font-weight:600");
}

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export async function apiFetch(path, { method = "GET", body, token, headers = {} } = {}) {
  // ── Kill-switch: mock mode ──────────────────────────────────────────
  // /auth/* siempre pasa al backend real (login + refresh + me + logout).
  // El resto: GET → [] (o fixtures específicos si hay mock registrado)
  //           writes → ApiError honesta.
  if (MOCKS_ENABLED && !path.startsWith("/auth/")) {
    if (method === "GET") {
      // Antes de devolver [] probamos con fixtures específicos.
      const fixture = resolveMockFixture(path);
      if (fixture !== undefined) return fixture;
      return [];
    }
    throw new ApiError(
      "Backend deshabilitado (modo mock). Los cambios no se guardan.",
      0,
      { mock_mode: true, path, method },
    );
  }

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
// Token helper: lee el access token guardado por AuthContext.
// AuthContext persiste el bundle completo como JSON bajo la key
// "mwt-auth" con shape { user, access, refresh }. Se mantienen los
// fallbacks históricos ("mwt_access", "token", "access") por si algún
// build viejo dejó residuo en localStorage.
// ---------------------------------------------------------------------
export const getToken = () => {
  if (typeof localStorage === "undefined") return null;
  // Camino canónico: bundle JSON serializado por AuthContext.
  try {
    const raw = localStorage.getItem("mwt-auth");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.access) return parsed.access;
      if (parsed?.token)  return parsed.token;
    }
  } catch { /* mwt-auth corrupto → caemos al fallback */ }
  // Fallbacks legacy.
  return (
    localStorage.getItem("mwt_access") ||
    localStorage.getItem("access")     ||
    localStorage.getItem("token")      ||
    null
  );
};

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

// Aliases comerciales por cliente (CEO/ADMIN-only, R3 · POL_VISIBILIDAD).
//   GET    /api/productos/<productoId>/aliases/
//   POST   /api/productos/<productoId>/aliases/   {cliente_id, alias, cliente_sku?, notas?}
//   DELETE /api/productos/<productoId>/aliases/?cliente_id=<uuid>
export const productoAliasesApi = {
  list: (productoId) =>
    apiFetch(`/productos/${encodeURIComponent(productoId)}/aliases/`,
             { token: getToken() }),
  upsert: (productoId, body) =>
    apiFetch(`/productos/${encodeURIComponent(productoId)}/aliases/`,
             { method: "POST", body, token: getToken() }),
  remove: (productoId, clienteId) =>
    apiFetch(
      `/productos/${encodeURIComponent(productoId)}/aliases/?cliente_id=${encodeURIComponent(clienteId)}`,
      { method: "DELETE", token: getToken() },
    ),
};
export const proveedoresApi    = resource("proveedores");
export const stockApi          = resource("stock");
export const movimientosApi    = resource("movimientos");
export const ocsApi            = resource("ocs");
export const expedientesApi    = resource("expedientes");
export const lineasApi         = resource("lineas");
export const documentosApi     = resource("documentos");
export const cobrosApi         = resource("cobros");

// ---------------------------------------------------------------------
// Inbound Engine v1 (sprint 2026-04-29)
//   POST /api/inventory/ocr-receipt/    (multipart: file)
//   POST /api/inventory/receive/        (json: cabecera + lines[])
//   GET  /api/inventario-recepciones/   (lista paginada)
//   GET  /api/inventario-recepciones/{id}/ (detalle)
// ---------------------------------------------------------------------
export const recepcionesApi = resource("inventario-recepciones");
export const inboundApi = {
  ocrReceipt: async (file) => {
    const fd = new FormData();
    fd.append("file", file);
    return postMultipart("/inventory/ocr-receipt/", fd, { token: getToken() });
  },
  receive: (payload) =>
    apiFetch("/inventory/receive/", {
      method: "POST", body: payload, token: getToken(),
    }),
};

// ---------------------------------------------------------------------
// Document Matchmaker (sprint 2026-04-29)
//   POST /api/expedientes/{id}/upload-match/   (multipart: file, document_type)
//   POST /api/expedientes/{id}/resolve-match/  (json: log_id, actions[], note)
//   GET  /api/expedientes/{id}/match-history/  (lista paginada last 50)
// ---------------------------------------------------------------------
export const documentMatchmakerApi = {
  upload: async (expedienteId, file, documentType) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("document_type", documentType);
    return postMultipart(
      `/expedientes/${expedienteId}/upload-match/`,
      fd,
      { token: getToken() },
    );
  },
  resolve: (expedienteId, payload) =>
    apiFetch(`/expedientes/${expedienteId}/resolve-match/`, {
      method: "POST",
      body:   payload,
      token:  getToken(),
    }),
  history: (expedienteId) =>
    apiFetch(`/expedientes/${expedienteId}/match-history/`, { token: getToken() }),
};

// ---------------------------------------------------------------------
// Builder Artifacts (sprint 2026-05-01)
//
// Instancias de artefactos cuyas plantillas vienen del Builder externo
// (https://builder.muito.work). El backend hace login server-side y
// cachea el JWT — el frontend NUNCA ve credenciales del Builder.
//
// Rutas:
//   GET    /api/expedientes/{id}/artifacts/
//   POST   /api/expedientes/{id}/artifacts/
//   PATCH  /api/expedientes/{id}/artifacts/{artifact_id}/
//   DELETE /api/expedientes/{id}/artifacts/{artifact_id}/
//   GET    /api/builder/templates/
//   GET    /api/builder/templates/{id}/
// ---------------------------------------------------------------------
export const builderArtifactsApi = {
  list: (expedienteId, params) =>
    apiFetch(`/expedientes/${expedienteId}/artifacts/${params ? `?${new URLSearchParams(params)}` : ""}`,
             { token: getToken() }),
  create: (expedienteId, payload) =>
    apiFetch(`/expedientes/${expedienteId}/artifacts/`,
             { method: "POST", body: payload, token: getToken() }),
  update: (expedienteId, artifactId, payload) =>
    apiFetch(`/expedientes/${expedienteId}/artifacts/${artifactId}/`,
             { method: "PATCH", body: payload, token: getToken() }),
  remove: (expedienteId, artifactId) =>
    apiFetch(`/expedientes/${expedienteId}/artifacts/${artifactId}/`,
             { method: "DELETE", token: getToken() }),
};

export const builderTemplatesApi = {
  list: () =>
    apiFetch(`/builder/templates/`, { token: getToken() }),
  get: (templateId) =>
    apiFetch(`/builder/templates/${templateId}/`, { token: getToken() }),
};

export const pagosApi          = resource("pagos");
export const conciliacionesApi = resource("conciliaciones");

// ---------------------------------------------------------------------
// Artefactos por nodo (sprint 2026-05-11 · Fase 2).
// Tabla `nodos.artefacto` con `nodo_id`, `tipo`, `nombre`, `estado`,
// `archivo_url`, `metadata`. Permite mismo tipo repetido y estado libre.
//
// Flow de upload recomendado en el FE:
//   1) POST /api/storage/upload-proxy/  → devuelve { url, key }
//   2) POST /api/nodos/{nodoId}/artifacts/ con archivo_url=url + metadata
//
// Rutas:
//   GET    /api/nodos/{nodoId}/artifacts/
//   POST   /api/nodos/{nodoId}/artifacts/
//   GET    /api/nodos/{nodoId}/artifacts/{artId}/
//   PATCH  /api/nodos/{nodoId}/artifacts/{artId}/
//   DELETE /api/nodos/{nodoId}/artifacts/{artId}/
// ---------------------------------------------------------------------
export const nodoArtefactosApi = {
  list: (nodoId, params) =>
    apiFetch(
      `/nodos/${nodoId}/artifacts/${params ? `?${new URLSearchParams(params)}` : ""}`,
      { token: getToken() },
    ),
  get: (nodoId, artId) =>
    apiFetch(`/nodos/${nodoId}/artifacts/${artId}/`, { token: getToken() }),
  create: (nodoId, payload) =>
    apiFetch(`/nodos/${nodoId}/artifacts/`,
             { method: "POST", body: payload, token: getToken() }),
  update: (nodoId, artId, payload) =>
    apiFetch(`/nodos/${nodoId}/artifacts/${artId}/`,
             { method: "PATCH", body: payload, token: getToken() }),
  remove: (nodoId, artId) =>
    apiFetch(`/nodos/${nodoId}/artifacts/${artId}/`,
             { method: "DELETE", token: getToken() }),
};

// ---------------------------------------------------------------------
// Finance v2.0 · "Registrar Pago" con validación IA del comprobante
//   POST /api/finance/payments/                  (multipart · drawer)
//   GET  /api/finance/payments/                  (lista + filtros)
//   GET  /api/finance/payments/{id}/             (detalle + aplicaciones + evidencia)
//   GET  /api/finance/payments/select_metodos/   (catálogo)
//   GET  /api/finance/payments/select_tipos/     (catálogo)
//   GET  /api/finance/payments/select_estados/   (catálogo)
//
// `register({...campos, evidencia: File, aplicaciones: [{...}]})` arma
// el FormData multipart automáticamente. El backend devuelve el Payment
// con codigo (PAY-YYYY-#####) y estado=PENDIENTE_AI (Fase 2 — sin IA).
// ---------------------------------------------------------------------
const _financeListGet = resource("finance/payments");
export const financePaymentsApi = {
  list:    _financeListGet.list,
  get:     _financeListGet.get,
  selectMetodos: () => apiFetch("/finance/payments/select_metodos/", { token: getToken() }),
  selectTipos:   () => apiFetch("/finance/payments/select_tipos/",   { token: getToken() }),
  selectEstados: () => apiFetch("/finance/payments/select_estados/", { token: getToken() }),

  // Lista de items "Aplicar a" reales del expediente (Fase 5A.5).
  // Reemplaza los mocks · GET /finance/payments/applicables/?expediente=&type=
  listApplicables: ({ expediente, type }) => apiFetch(
    `/finance/payments/applicables/?expediente=${encodeURIComponent(expediente)}` +
    `&type=${encodeURIComponent(type)}`,
    { token: getToken() },
  ),

  register: async ({
    expediente_id, monto, moneda, fecha, metodo, tipo_pago,
    referencia, notas, aplicaciones, evidencia, event_id,
  }) => {
    const fd = new FormData();
    fd.append("expediente_id", expediente_id);
    fd.append("monto",         String(monto));
    fd.append("moneda",        moneda);
    fd.append("fecha",         fecha);  // ISO YYYY-MM-DD
    fd.append("metodo",        metodo);
    fd.append("tipo_pago",     tipo_pago);
    fd.append("referencia",    referencia);
    if (notas) fd.append("notas", notas);
    if (event_id) fd.append("event_id", event_id);
    fd.append("aplicaciones", JSON.stringify(aplicaciones || []));
    fd.append("evidencia", evidencia);
    return postMultipart("/finance/payments/", fd, { token: getToken() });
  },
};

export const transferenciasApi    = resource("transferencias");
export const transferLineasApi    = resource("transfer-lineas");
export const transferEventosApi   = resource("transfer-eventos");

// Transfer detail · sprint 2026-04-30
//   POST  /api/transferencias/{id}/cost-lines/                add manual
//   DELETE /api/transferencias/{id}/cost-lines/{cost_id}/     soft delete
//   POST  /api/transferencias/{id}/upload-cost-ocr/          multipart, OCR auto-merge
//   GET / POST /api/transferencias/{id}/notes/                ledger
//   DELETE     /api/transferencias/{id}/notes/{note_id}/      remove
export const transferDetailApi = {
  // Costos
  addCost:    (trfId, body)        => apiFetch(`/transferencias/${trfId}/cost-lines/`,
                                              { method: "POST", body, token: getToken() }),
  removeCost: (trfId, costId)      => apiFetch(`/transferencias/${trfId}/cost-lines/${costId}/`,
                                              { method: "DELETE", token: getToken() }),
  uploadCostOcr: async (trfId, file) => {
    const fd = new FormData();
    fd.append("file", file);
    return postMultipart(`/transferencias/${trfId}/upload-cost-ocr/`, fd,
                         { token: getToken() });
  },
  // Notas
  listNotes:   (trfId)             => apiFetch(`/transferencias/${trfId}/notes/`,
                                              { token: getToken() }),
  addNote:     (trfId, text)       => apiFetch(`/transferencias/${trfId}/notes/`,
                                              { method: "POST", body: { text }, token: getToken() }),
  removeNote:  (trfId, noteId)     => apiFetch(`/transferencias/${trfId}/notes/${noteId}/`,
                                              { method: "DELETE", token: getToken() }),
};
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

// ---------------------------------------------------------------------
// AI Hub (apps.ai_hub) — chat conversacional + catálogos de gobernanza.
//
//   /api/ai/agents/         · CRUD agentes
//   /api/ai/skills/         · CRUD skills
//   /api/ai/instructions/   · CRUD instrucciones
//   /api/ai/threads/        · CRUD hilos + actions (pin/archive/anchor/...)
//   /api/ai/messages/       · CRUD mensajes (read-mostly)
//   /api/ai/attachments/    · CRUD adjuntos (read + soft delete)
//   /api/ai/usage-logs/     · read-only telemetría
//
//   /api/ai/chat/send/      · POST → ChatService (LLM)
//   /api/ai/chat/upload/    · POST multipart → AiAttachment
//
// MentionPopover (@/) consume:
//   /api/ai/agents/select/?q=...
//   /api/ai/skills/select/?q=...
//   /api/ai/instructions/select/?q=...
// ---------------------------------------------------------------------
export const aiAgentsApi       = resource("ai/agents");
export const aiSkillsApi       = resource("ai/skills");
export const aiInstructionsApi = resource("ai/instructions");
export const aiThreadsApi      = resource("ai/threads");
export const aiThreadCtxApi    = resource("ai/thread-contexts");
export const aiMessagesApi     = resource("ai/messages");
export const aiAttachmentsApi  = resource("ai/attachments");
export const aiUsageLogsApi    = resource("ai/usage-logs");

const aiBase = "/ai";
export const aiChatApi = {
  // Mentions / Skills autocomplete
  selectAgents:       (params)        => aiAgentsApi.action("select"),
  selectSkills:       (params)        => aiSkillsApi.action("select"),
  selectInstructions: (params)        => aiInstructionsApi.action("select"),

  // Acciones de hilo (alias semánticos sobre el ViewSet)
  threadMessages:     (threadId, qs)  => apiFetch(
    `/ai/threads/${threadId}/messages/${qs ? `?${new URLSearchParams(qs).toString()}` : ""}`,
    { token: getToken() },
  ),
  threadContext:      (threadId)      => apiFetch(
    `/ai/threads/${threadId}/context/`, { token: getToken() },
  ),
  anchor:             (threadId, body) => apiFetch(
    `/ai/threads/${threadId}/anchor/`,
    { method: "POST", body, token: getToken() },
  ),
  unanchor:           (threadId, body) => apiFetch(
    `/ai/threads/${threadId}/unanchor/`,
    { method: "POST", body, token: getToken() },
  ),
  pinThread:          (threadId)      => apiFetch(
    `/ai/threads/${threadId}/pin/`,   { method: "POST", token: getToken() },
  ),
  unpinThread:        (threadId)      => apiFetch(
    `/ai/threads/${threadId}/unpin/`, { method: "POST", token: getToken() },
  ),
  archiveThread:      (threadId)      => apiFetch(
    `/ai/threads/${threadId}/archive/`, { method: "POST", token: getToken() },
  ),
  unarchiveThread:    (threadId)      => apiFetch(
    `/ai/threads/${threadId}/unarchive/`, { method: "POST", token: getToken() },
  ),

  // POST principal del chat
  send: (payload) => apiFetch(`${aiBase}/chat/send/`, {
    method: "POST", body: payload, token: getToken(),
  }),

  // Upload multipart (NO usa apiFetch porque éste fija Content-Type JSON).
  upload: async ({ file, threadId, userId }) => {
    const fd = new FormData();
    fd.append("file", file);
    if (threadId) fd.append("thread_id", threadId);
    if (userId)   fd.append("user_id",   userId);
    const headers = {};
    const tk = getToken();
    if (tk) headers.Authorization = `Bearer ${tk}`;
    const resp = await fetch(`${API_BASE}${aiBase}/chat/upload/`, {
      method: "POST", body: fd, headers,
    });
    let data = null;
    const text = await resp.text();
    if (text) {
      try { data = JSON.parse(text); } catch { data = { raw: text }; }
    }
    if (!resp.ok) {
      const msg = data?.detail || data?.message || `HTTP ${resp.status}`;
      throw new ApiError(msg, resp.status, data);
    }
    return data;
  },
};

// ---------------------------------------------------------------------
// Commercial Pricing API (Sprint 22-23)
//   /api/commercial/pricelist-versions/          · CRUD + bulk-upsert-items + items
//   /api/commercial/grade-items/                 · CRUD (cost_usd masked si ≠ CEO)
//   /api/commercial/client-assignments/          · CPA
//   /api/commercial/early-payment-policies/      · CRUD + replace-tiers
//   /api/commercial/early-payment-tiers/         · CRUD bajo nivel
//   /api/commercial/commission-rules/            · [CEO-ONLY]
//   /api/commercial/catalogs/currencies/
//   /api/commercial/catalogs/sources/
//   /api/commercial/catalogs/commission-bases/
//
//   POST /api/commercial/resolve_client_price/   · waterfall endpoint
// ---------------------------------------------------------------------
export const priceListVersionsApi   = resource("commercial/pricelist-versions");
export const gradeItemsApi          = resource("commercial/grade-items");
export const clientAssignmentsApi   = resource("commercial/client-assignments");
export const earlyPaymentPoliciesApi = resource("commercial/early-payment-policies");
export const earlyPaymentTiersApi    = resource("commercial/early-payment-tiers");
export const commissionRulesApi      = resource("commercial/commission-rules");
export const currencyCatApi          = resource("commercial/catalogs/currencies");
export const pricelistSourceCatApi   = resource("commercial/catalogs/sources");
export const commissionBaseCatApi    = resource("commercial/catalogs/commission-bases");

export const commercialApi = {
  resolveClientPrice: (payload) =>
    apiFetch(`/commercial/resolve_client_price/`, {
      method: "POST", body: payload, token: getToken(),
    }),
  bulkUpsertItems: (pricelistId, items, replace_existing = false) =>
    priceListVersionsApi.action("bulk-upsert-items", pricelistId, { items, replace_existing }),
  listItemsOfPricelist: (pricelistId) =>
    priceListVersionsApi.action("items", pricelistId),
  replaceTiers: (policyId, tiers) =>
    earlyPaymentPoliciesApi.action("replace-tiers", policyId, { tiers }),
};

// ---------------------------------------------------------------------
// SIZING ENGINE — Sprint Sizing v1
// ---------------------------------------------------------------------
//   GET    /api/sizing/options/                catálogos para selects FE
//   GET    /api/sizing/tipos-producto/         (read-only)
//   GET    /api/sizing/sistemas-medida/        (read-only)
//   CRUD   /api/sizing/tallas/                 (incluye action "clone")
// ---------------------------------------------------------------------
export const tallasApi               = resource("sizing/tallas");
export const tiposProductoCatApi     = resource("sizing/tipos-producto");
export const sistemasMedidaCatApi    = resource("sizing/sistemas-medida");

export const sizingApi = {
  options: () => apiFetch(`/sizing/options/`, { token: getToken() }),
  clone:   (tallaId) => tallasApi.action("clone", tallaId, {}),
};


// =====================================================================
// postMultipart — wrapper para uploads de archivos con mock hook.
//
// El Wizard (CreateExpedienteWizard.jsx) y el grid del catálogo usaban
// su propia función local para POST multipart, lo cual NO respetaba el
// kill-switch MOCKS_ENABLED. Esta versión centralizada:
//   · En modo mock, matchea `/ocr/parse-oc/` y devuelve el fixture demo
//     (lib/ocrMock.js) con cliente/marca/PO/líneas pre-seleccionados.
//   · Para cualquier otro upload en modo mock → lanza ApiError clara.
//   · En modo real, hace fetch multipart normal.
// =====================================================================
export async function postMultipart(path, formData, { token } = {}) {
  // ── Interceptor de mocks ──────────────────────────────────────────
  if (MOCKS_ENABLED) {
    // /ocr/parse-oc/ — devuelve payload estructurado con cliente/marca/PO
    if (path.startsWith("/ocr/parse-oc")) {
      const file = (formData && typeof formData.get === "function")
        ? formData.get("file")
        : null;
      // Pequeño delay para que la animación de escaneo sea perceptible
      // (el scan-line del StepUpload luce feo si el fetch resuelve en < 50ms).
      await new Promise((r) => setTimeout(r, 1100));
      return portalOcrParseMock(file);
    }
    // /expedientes/create-from-oc/ — en mock NO creamos nada real, pero
    // devolvemos un shape "ok:true" para que el wizard muestre el estado
    // de éxito. El archivo físico NO se persiste (estamos en demo).
    if (path.startsWith("/expedientes/create-from-oc")) {
      await new Promise((r) => setTimeout(r, 700));
      const idem = (formData && typeof formData.get === "function")
        ? (formData.get("idempotence_token") || "mock")
        : "mock";
      return {
        ok: true,
        command: "C1",
        expediente: {
          id:                    `demo-exp-${String(idem).slice(-8)}`,
          codigo:                `EXP-DEMO-${String(idem).slice(-4).toUpperCase()}`,
          estado:                "REGISTRO",
          client_id:             "demo-client",
          brand_id:              null,
          modo_operacion:        null,
          freight_mode:          null,
          transport_mode:        null,
          dispatch_mode:         null,
          price_basis:           null,
          moneda:                "USD",
          total_cost:            0,
          phase_signal:          "PENDING_CEO_REVIEW",
          submitted_via_portal:  true,
          submitted_by_role:     "CLIENT",
        },
        oc:              { id: "demo-oc", codigo: "OC-DEMO-0000", lines_count: 0 },
        artifact_id:     `demo-art-${String(idem).slice(-6)}`,
        correlation_id:  "demo-corr",
        submission_id:   "demo-sub",
        requires_ceo_review: true,
      };
    }
    throw new ApiError(
      "Backend deshabilitado (modo mock). Uploads no se persisten.",
      0,
      { mock_mode: true, path },
    );
  }

  // ── Modo real: fetch multipart ────────────────────────────────────
  const resp = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body:    formData,
  });
  const text = await resp.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = { raw: text }; } }
  if (!resp.ok) {
    const msg = data?.detail || data?.error || `HTTP ${resp.status}`;
    throw new ApiError(msg, resp.status, data);
  }
  return data;
}

// ---------------------------------------------------------------------
// Tickets / Soporte interno (LOTE_SM_TICKETS).
//   GET    /api/tickets/                       -> lista (filtrado por rol)
//   POST   /api/tickets/                       -> crear ticket
//   GET    /api/tickets/<id>/                  -> detalle + hilo + adjuntos
//   PATCH  /api/tickets/<id>/                  -> editar (no si finalizado)
//   DELETE /api/tickets/<id>/                  -> soft-delete
//   GET    /api/tickets/<id>/messages/         -> lista mensajes
//   POST   /api/tickets/<id>/messages/         -> agrega mensaje
//   POST   /api/tickets/<id>/attachments/      -> sube adjunto (multipart)
//   GET    /api/tickets/<id>/attachments/<a>/download/ -> signed URL
//   POST   /api/tickets/<id>/transition/       -> { status }
//   GET    /api/tickets/dashboard/             -> KPIs admin
//   GET    /api/tickets/reasons/               -> catalogo motivos
//   GET    /api/tickets/statuses/              -> catalogo estados
// ---------------------------------------------------------------------
const ticketsBase = "/tickets/";

async function postMultipartHere(path, formData) {
  // Reutilizamos el wrapper postMultipart si existe; sino fetch directo.
  if (typeof postMultipart === "function") {
    return postMultipart(path, formData, { token: getToken() });
  }
  const headers = {};
  const tk = getToken();
  if (tk) headers.Authorization = `Bearer ${tk}`;
  const res = await fetch(`${API_BASE}${path}`, { method: "POST", body: formData, headers });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new ApiError(typeof data === "string" ? data : JSON.stringify(data), res.status, data);
  return data;
}

export const ticketsApi = {
  list:    (params)  => apiFetch(`${ticketsBase}${params ? "?" + new URLSearchParams(params).toString() : ""}`,
                                 { token: getToken() }),
  get:     (id)      => apiFetch(`${ticketsBase}${id}/`,                       { token: getToken() }),
  create:  (body)    => apiFetch(ticketsBase,                                  { method: "POST",   body, token: getToken() }),
  update:  (id, body)=> apiFetch(`${ticketsBase}${id}/`,                       { method: "PATCH",  body, token: getToken() }),
  remove:  (id)      => apiFetch(`${ticketsBase}${id}/`,                       { method: "DELETE",       token: getToken() }),

  messages: (id)               => apiFetch(`${ticketsBase}${id}/messages/`,    { token: getToken() }),
  postMessage: (id, content)   => apiFetch(`${ticketsBase}${id}/messages/`,
                                           { method: "POST", body: { content }, token: getToken() }),

  uploadAttachment: (id, file, { messageId } = {}) => {
    const fd = new FormData();
    fd.append("file", file);
    if (messageId) fd.append("message_id", messageId);
    return postMultipartHere(`${ticketsBase}${id}/attachments/`, fd);
  },

  attachmentDownloadUrl: (ticketId, attId) =>
    apiFetch(`${ticketsBase}${ticketId}/attachments/${attId}/download/`, { token: getToken() }),

  transition: (id, status) =>
    apiFetch(`${ticketsBase}${id}/transition/`, { method: "POST", body: { status }, token: getToken() }),

  dashboard: () => apiFetch(`${ticketsBase}dashboard/`,                        { token: getToken() }),
  reasons:   () => apiFetch(`${ticketsBase}reasons/`,                          { token: getToken() }),
  statuses:  () => apiFetch(`${ticketsBase}statuses/`,                         { token: getToken() }),
};

