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

// Sprint 2026-05-31 · errores transitorios → reintento automático 1x.
// Cubre la ventana de ~15-30s en que el upstream Django está abajo durante
// un deploy (docker compose recrea el contenedor): nginx/Cloudflare devuelven
// 502/503/504/522/523/524/408 o hay falla de red. Solo reintentamos métodos
// idempotentes (GET/HEAD) para NO duplicar mutaciones (POST/PATCH/DELETE).
const _TRANSIENT_STATUS = new Set([408, 502, 503, 504, 520, 521, 522, 523, 524]);
const _sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const _isIdempotent = (m) => {
  const u = String(m || "GET").toUpperCase();
  return u === "GET" || u === "HEAD";
};
const _abortError = (cause) => {
  if (cause && cause.name === "AbortError") return cause;
  const err = new Error("Request aborted");
  err.name = "AbortError";
  if (cause) err.cause = cause;
  return err;
};

// ── Cancelación global por navegación (GET idempotentes) ────────────
// Los GET sin signal explícito se atan a este controlador; el AppLayout
// llama abortInflightGets() al cambiar de ruta y se liberan las conexiones
// en vuelo (los flags isAlive/cancelled NO cancelaban el HTTP, por eso la
// página siguiente quedaba en cola). Las mutaciones nunca se auto-cancelan.
let _navController = (typeof AbortController !== "undefined") ? new AbortController() : null;
export function abortInflightGets() {
  if (!_navController) return;
  try { _navController.abort(); } catch { /* noop */ }
  _navController = new AbortController();
}

export async function apiFetch(path, { method = "GET", body, token, headers = {}, signal, _isRetry = false, _transientRetried = false } = {}) {
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

  // Sprint 2026-05-21 · Override de viewport desde Tweaks Panel.
  // Si el admin/CEO eligió "Ver como Cliente" en el Tweaks, RoleContext
  // guarda 'CLIENT' en sessionStorage('mwt-role-override'). El backend
  // respeta ese flag si el usuario tiene legal_entity_ids (ver
  // apps.expedientes.views._is_client_viewer).
  let viewportHeader = {};
  try {
    if (typeof window !== "undefined") {
      const ov = window.sessionStorage?.getItem("mwt-role-override");
      if (ov === "CLIENT" || ov === "ADMIN") {
        viewportHeader = { "X-Viewport-Role": ov };
      }
    }
  } catch { /* SSR / privacy mode → ignorar */ }

  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...viewportHeader,
      ...headers,
    },
  };
  if (body !== undefined) opts.body = typeof body === "string" ? body : JSON.stringify(body);
  // Sprint 2026-06-11 · Auditoría Fable5 (#5): cancelación REAL de
  // requests al desmontar pantallas. El caller pasa un AbortSignal y el
  // fetch nativo lo honra; un AbortError NUNCA se reintenta.
  // Cancelación: el signal explícito del caller manda; si no, los GET
  // idempotentes (excepto /auth/*) se atan al controlador de navegación.
  if (signal) {
    opts.signal = signal;
  } else if (_isIdempotent(method) && _navController && !path.startsWith("/auth/")) {
    opts.signal = _navController.signal;
  }

  let resp;
  try {
    resp = await fetch(`${API_BASE}${path}`, opts);
  } catch (e) {
    // Abort expl?cito del caller o del controlador global de navegaci?n:
    // propagar siempre un AbortError controlado. Antes, para abortos globales,
    // devolv?amos una promesa que nunca resolv?a y pod?a congelar loaders.
    if (e && e.name === "AbortError") {
      throw _abortError(e);
    }
    // Falla de red (upstream caído durante deploy, DNS, etc.). Reintento 1x.
    if (!_transientRetried && _isIdempotent(method)) {
      await _sleep(1000);
      return apiFetch(path, { method, body, token, headers, signal, _isRetry, _transientRetried: true });
    }
    throw new ApiError("No se pudo contactar al servidor", 0, null);
  }

  let data = null;
  const text = await resp.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
  }

  if (!resp.ok) {
    // Sprint 2026-05-31 · auto-refresh silencioso del access token.
    // Si una vista pega a la API con un access expirado (401), intentamos
    // UN refresh con el refresh token guardado y reintentamos la request
    // original una sola vez. Así la sesión no se "pierde" al navegar.
    // Las rutas /auth/* se excluyen para no entrar en bucle.
    if (resp.status === 401 && !_isRetry && !path.startsWith("/auth/")) {
      const newAccess = await refreshAccessToken();
      if (newAccess) {
        return apiFetch(path, { method, body, token: newAccess, headers, signal, _isRetry: true });
      }
      // No se pudo refrescar (refresh expirado/ausente) → logout limpio.
      emitForcedLogout();
    }
    // Sprint 2026-05-31 · reintento ante error transitorio del gateway
    // (deploy en curso: Django reiniciándose). Solo GET/HEAD, una vez.
    if (_TRANSIENT_STATUS.has(resp.status) && !_transientRetried && _isIdempotent(method)) {
      await _sleep(1000);
      return apiFetch(path, { method, body, token, headers, signal, _isRetry, _transientRetried: true });
    }
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

// =====================================================================
// Sprint 2026-05-31 · Refresh silencioso del access token.
// Comparte la key "mwt-auth" con AuthContext { user, access, refresh }.
// Single-flight: si varias requests caen en 401 a la vez, solo se
// dispara UN refresh y todas esperan el mismo resultado.
// =====================================================================
function _readAuthBundle() {
  try {
    const raw = localStorage.getItem("mwt-auth");
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function _writeAccess(newAccess, newRefresh) {
  try {
    const b = _readAuthBundle() || {};
    b.access = newAccess;
    if (newRefresh) b.refresh = newRefresh;
    localStorage.setItem("mwt-auth", JSON.stringify(b));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("mwt-auth-refreshed", {
        detail: { access: newAccess, refresh: b.refresh },
      }));
    }
  } catch { /* noop */ }
}

export function emitForcedLogout() {
  try {
    localStorage.removeItem("mwt-auth");
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("mwt-auth-logout"));
    }
  } catch { /* noop */ }
}

let _refreshPromise = null;
export function refreshAccessToken() {
  if (_refreshPromise) return _refreshPromise;
  const bundle = _readAuthBundle();
  const r = bundle?.refresh;
  // Sin refresh real (o sesión DEV-fallback) → no hay nada que refrescar.
  if (!r || String(r).startsWith("dev-local")) return Promise.resolve(null);
  _refreshPromise = (async () => {
    try {
      const data = await authApi.refresh(r);
      if (data?.access) {
        _writeAccess(data.access, data.refresh);
        return data.access;
      }
      return null;
    } catch {
      return null;
    } finally {
      _refreshPromise = null;
    }
  })();
  return _refreshPromise;
}

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
  const withQs = (path, params) => `${path}${qs(params)}`;
  const isParamsObject = (value) => (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );

  return {
    // `opts` opcional (p.ej. { signal }) para cancelar la request on-unmount.
    list:   (params, opts = {}) => apiFetch(`${base}${qs(params)}`,          { ...tokenOpt(), ...opts }),
    get:    (id, opts = {})     => apiFetch(`${base}${id}/`,                 { ...tokenOpt(), ...opts }),
    create: (body)        => apiFetch(base,                                  { method: "POST",   body, ...tokenOpt() }),
    update: (id, body)    => apiFetch(`${base}${id}/`,                       { method: "PATCH",  body, ...tokenOpt() }),
    replace:(id, body)    => apiFetch(`${base}${id}/`,                       { method: "PUT",    body, ...tokenOpt() }),
    remove: (id)          => apiFetch(`${base}${id}/`,                       { method: "DELETE", ...tokenOpt() }),
    // acciones custom del ViewSet: select_tipos, select_paises, kpis, etc.
    // action(name)                         ? GET   /resource/<name>/
    // action(name, params)                 ? GET   /resource/<name>/?k=v
    // action(name, id)                     ? GET   /resource/<id>/<name>/
    // action(name, id, body)               ? POST  /resource/<id>/<name>/
    // action(name, id, undefined, {params})? GET   /resource/<id>/<name>/?k=v
    // action(name, null, body)             ? POST  /resource/<name>/
    action: (name, id, body, opts = {}) => {
      let actionId = id;
      let params = opts?.params;
      let fetchOpts = opts && typeof opts === "object" ? { ...opts } : {};
      delete fetchOpts.params;

      // Sobrecarga para collection actions con query params. Evita construir
      // nombres tipo "select_x/?q=...", que agregaban el slash al valor.
      if (isParamsObject(id) && body === undefined) {
        actionId = null;
        params = id;
        fetchOpts = {};
      }

      const actionPath = actionId ? `${base}${actionId}/${name}/` : `${base}${name}/`;
      if (body !== undefined) {
        return apiFetch(actionPath, { method: "POST", body, ...tokenOpt(), ...fetchOpts });
      }
      return apiFetch(withQs(actionPath, params), { ...tokenOpt(), ...fetchOpts });
    },
    select: (selectName, params, opts = {}) =>
      apiFetch(withQs(`${base}select_${selectName}/`, params), { ...tokenOpt(), ...opts }),
  };
}

export const nodosApi          = resource("nodos");
export const marcasApi         = resource("marcas");
// Sprint 2026-05-17 · GET /api/marcas/{id}/expedientes/
// Lista expedientes activos con al menos un producto de la marca.
// Response: [{id, codigo, proforma_codigo, oc_cliente_codigo, ...}]
marcasApi.expedientes = (marcaId) =>
  apiFetch(`/marcas/${encodeURIComponent(marcaId)}/expedientes/`,
           { token: getToken() });
export const clientesApi       = resource("clientes");
export const productosApi      = resource("productos");
export const ncmApi            = resource("ncm");

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
// Sprint 2026-05-17 · Bulk update de precios por SKU (CEO-only).
//   Body: { updates: [{linea_id, unit_price_mwt?, unit_price_client?}, ...] }
//   Response: { updated, errors, skipped, summary }
// El backend recalcula total_price y mantiene unit_price (legacy) alineado
// con el operador del expediente.
lineasApi.bulkUpdatePrices = (updates) =>
  apiFetch("/lineas/bulk-update-prices/",
           { method: "POST", body: { updates }, token: getToken() });
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
// Sprint 2026-05-11 · Fase 3 · Asignaciones expediente→nodo.
//
// Rutas backend:
//   GET  /api/inventario/saldos-por-expediente/?expediente_ids=A,B,C&nodo_id=X
//   POST /api/inventario/nodo-assignments/bulk/
//   GET  /api/inventario/nodos/{nodoId}/inventory-allocated/
//
// Flujo del wizard de recepción (paso 2 nuevo):
//   1. Usuario elige un nodo destino en paso 1.
//   2. Usuario selecciona uno o más expedientes en el paso 2.
//   3. FE llama saldos.list(exp_ids, nodo_id) para conocer cuánto queda
//      por asignar de cada (producto, talla).
//   4. Usuario marca/edita cantidades.
//   5. Al confirmar (paso 3), FE llama assignments.bulkCreate({items}).
// ---------------------------------------------------------------------
export const nodoAssignmentsApi = {
  saldosPorExpediente: ({ expedienteIds = [], nodoId } = {}) => {
    const params = new URLSearchParams();
    if (expedienteIds.length) params.set("expediente_ids", expedienteIds.join(","));
    if (nodoId)               params.set("nodo_id", nodoId);
    return apiFetch(
      `/inventario/saldos-por-expediente/?${params.toString()}`,
      { token: getToken() },
    );
  },
  bulkCreate: (payload) =>
    apiFetch(`/inventario/nodo-assignments/bulk/`,
             { method: "POST", body: payload, token: getToken() }),
  inventoryAllocated: (nodoId) =>
    apiFetch(`/inventario/nodos/${nodoId}/inventory-allocated/`,
             { token: getToken() }),
  // Sprint 2026-05-11 fix · overview global de TODAS las asignaciones.
  // Soporta filtros opcionales por nodo_id, expediente_id, q (búsqueda).
  allocationsOverview: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.nodoId)       qs.set("nodo_id", params.nodoId);
    if (params.expedienteId) qs.set("expediente_id", params.expedienteId);
    if (params.q)            qs.set("q", params.q);
    const tail = qs.toString();
    return apiFetch(
      `/inventario/allocations-overview/${tail ? `?${tail}` : ""}`,
      { token: getToken() },
    );
  },
  // Sprint 2026-05-11 fix · ajustar cantidad asignada (editar/eliminar)
  // sobre el agregado (nodo, expediente, producto, talla).
  // new_qty === 0 → elimina (soft-delete) la línea entera.
  // new_qty > 0   → reemplaza el agregado por una sola fila nueva.
  adjust: ({ expedienteId, productoId, talla, nodoId, newQty }) =>
    apiFetch(`/inventario/nodo-assignments/adjust/`, {
      method: "POST",
      body: {
        expediente_id: expedienteId,
        producto_id:   productoId,
        talla:         talla || "",
        nodo_id:       nodoId,
        new_qty:       Number(newQty),
      },
      token: getToken(),
    }),
  // Sprint 2026-05-11 fix · expedientes asignados a un nodo, enriquecidos
  // con cliente, operating_company, sap, proforma, codigo OC, fecha.
  expedientesAsignados: (nodoId) =>
    apiFetch(`/inventario/nodos/${nodoId}/expedientes-asignados/`,
             { token: getToken() }),
  // Sprint 2026-05-11 fix · IDs de expedientes que aún tienen al menos
  // una (producto, talla) con qty_pendiente > 0. Para filtrar la lista
  // de chips en el paso 2 del wizard de recepción.
  expedientesWithPending: () =>
    apiFetch(`/inventario/expedientes-with-pending/`,
             { token: getToken() }),
  // Sprint 2026-05-11 fase 6 · para cada (producto, talla) del expediente,
  // los nodos donde está asignado (con qty). Alimenta columna "Nodo".
  nodosPorLineaExpediente: (expedienteId) =>
    apiFetch(`/inventario/expedientes/${expedienteId}/nodos-por-linea/`,
             { token: getToken() }),
  // Sprint 2026-05-11 fase 6 · artefactos del Builder con líneas en
  // este expediente. Alimenta la nueva tab Artefactos del expediente.
  artifactsPorExpediente: (expedienteId) =>
    apiFetch(`/inventario/expedientes/${expedienteId}/artifacts/`,
             { token: getToken() }),
  // Sprint 2026-05-26 (CEO) · resumen de envío consolidado (ART-05
  // + transferencia mas reciente). Devuelve { transport_mode, carrier,
  // tracking, doc_type, freight_mode, dispatch_mode, consolidation,
  // transferencia: { eta, dispatched_at, received_at, codigo, estado, ... } }.
  shippingSummary: (expedienteId) =>
    apiFetch(`/inventario/expedientes/${expedienteId}/shipping-summary/`,
             { token: getToken() }),
  // Sprint 2026-05-13 fase 8 · líneas con stock en un nodo. Para el
  // wizard de transferencias paso 3. Filtro opcional por expediente_ids
  // (CSV) — sin filtro devuelve todas las líneas del nodo.
  lineasEnNodo: ({ nodoId, expedienteIds = [] } = {}) => {
    const qs = new URLSearchParams();
    if (expedienteIds.length) qs.set("expediente_ids", expedienteIds.join(","));
    const tail = qs.toString();
    return apiFetch(
      `/inventario/nodos/${nodoId}/lineas-en-nodo/${tail ? `?${tail}` : ""}`,
      { token: getToken() },
    );
  },
  // Sprint 2026-05-13 fase 10 · costos de transferencias en las que
  // participó este expediente (filtrado por scope_json).
  transferenciaCostosPorExpediente: (expedienteId) =>
    apiFetch(`/inventario/expedientes/${expedienteId}/transferencia-costos/`,
             { token: getToken() }),
  // Sprint 2026-05-13 fase 10 · agregado OC-level: todos los costos de
  // transferencias que tocaron CUALQUIER expediente de esta OC.
  transferenciaCostosPorOC: (ocId) =>
    apiFetch(`/inventario/ocs/${ocId}/transferencia-costos/`,
             { token: getToken() }),
  // Sprint 2026-05-14 fase 13 · costos de transferencias que llegaron
  // a este nodo (como destino). Devuelve filas por (cost × exp × prod ×
  // talla) filtradas por scope_json. Para la tab Costos del NodoDetail.
  transferenciaCostosPorNodo: (nodoId) =>
    apiFetch(`/inventario/nodos/${nodoId}/transferencia-costos/`,
             { token: getToken() }),
  // Sprint 2026-05-13 fase 8 · transfer atómico de asignaciones de un
  // nodo origen a uno destino. Soft-delete origen, crea destino y
  // residual en una sola transacción. Si qty > disponible en origen,
  // devuelve 400 con detalle del over-transfer (sin mover nada).
  transfer: ({ originNodoId, destinationNodoId, items, transferenciaId } = {}) =>
    apiFetch(`/inventario/nodo-assignments/transfer/`, {
      method: "POST",
      body: {
        origin_nodo_id:      originNodoId,
        destination_nodo_id: destinationNodoId,
        transferencia_id:    transferenciaId || null,
        items: (items || []).map((it) => ({
          expediente_id: it.expediente_id,
          producto_id:   it.producto_id,
          talla:         it.talla || "",
          qty:           Number(it.qty) || 0,
        })),
      },
      token: getToken(),
    }),
};

// ---------------------------------------------------------------------
// Sprint 2026-05-11 · Fase 7 · Document Extractor (IA)
//
// POST /api/ai/document/extract/   (multipart)
//   - file: el documento (PDF / Excel / Word / txt)
//   - structure: structure_json del template del Builder (string JSON)
//   - model: opcional, override del modelo Anthropic
// Devuelve { extracted: {fid: value, ...}, confidence: {...}, notes, _meta }.
// El frontend hace merge de `extracted` al state del fill modal.
// ---------------------------------------------------------------------
export const aiDocumentExtractApi = {
  extract: async ({ file, structure, model } = {}) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("structure", typeof structure === "string"
      ? structure : JSON.stringify(structure || {}));
    if (model) fd.append("model", String(model));
    const resp = await fetch(`${API_BASE}/ai/document/extract/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${getToken()}` },
      body: fd,
    });
    let body = null;
    try { body = await resp.json(); } catch { body = null; }
    if (!resp.ok) {
      const detail = body?.detail || resp.statusText || "Error";
      const err = new Error(detail);
      err.status = resp.status;
      err.body   = body;
      throw err;
    }
    return body || {};
  },
};

// ---------------------------------------------------------------------
// Sprint 2026-05-11 · Fase 4 · Builder artifacts en nodos.
// Espejo de builderArtifactsApi (expedientes) — usa el mismo Builder
// externo, pero las instancias se persisten en
// `nodos.builder_artifact_instance` (no en expedientes.…).
//
// Rutas (proxied por backend):
//   GET    /api/nodos/{nodoId}/builder-artifacts/
//   POST   /api/nodos/{nodoId}/builder-artifacts/
//   GET    /api/nodos/{nodoId}/builder-artifacts/{artId}/
//   PATCH  /api/nodos/{nodoId}/builder-artifacts/{artId}/
//   DELETE /api/nodos/{nodoId}/builder-artifacts/{artId}/
//
// El catálogo de plantillas sigue siendo el mismo del lado expediente:
//   GET /api/builder/templates/        (ya existe en builderTemplatesApi)
//   GET /api/builder/templates/{id}/
// ---------------------------------------------------------------------
export const nodoBuilderArtifactsApi = {
  list: (nodoId, params) =>
    apiFetch(
      `/nodos/${nodoId}/builder-artifacts/${params ? `?${new URLSearchParams(params)}` : ""}`,
      { token: getToken() },
    ),
  get: (nodoId, artId) =>
    apiFetch(`/nodos/${nodoId}/builder-artifacts/${artId}/`,
             { token: getToken() }),
  create: (nodoId, payload) =>
    apiFetch(`/nodos/${nodoId}/builder-artifacts/`,
             { method: "POST", body: payload, token: getToken() }),
  update: (nodoId, artId, payload) =>
    apiFetch(`/nodos/${nodoId}/builder-artifacts/${artId}/`,
             { method: "PATCH", body: payload, token: getToken() }),
  remove: (nodoId, artId) =>
    apiFetch(`/nodos/${nodoId}/builder-artifacts/${artId}/`,
             { method: "DELETE", token: getToken() }),
  // Sprint 2026-05-11 · Fase 5 · saldo disponible de líneas para
  // un template (con descuento por uso previo del mismo template).
  availableLines: (nodoId, { templateId, expedienteIds = [], excludeInstanceId } = {}) => {
    const qs = new URLSearchParams();
    if (templateId)         qs.set("template_id", String(templateId));
    if (expedienteIds.length) qs.set("expediente_ids", expedienteIds.join(","));
    if (excludeInstanceId)  qs.set("exclude_instance_id", excludeInstanceId);
    return apiFetch(
      `/nodos/${nodoId}/builder-artifacts/available-lines/?${qs.toString()}`,
      { token: getToken() },
    );
  },
  // Lista de expedientes del nodo (chips para el Modal 1 del scope).
  // Si se pasa templateId aplica el descuento por template.
  expedientes: (nodoId, { templateId, excludeInstanceId } = {}) => {
    const qs = new URLSearchParams();
    if (templateId)        qs.set("template_id", String(templateId));
    if (excludeInstanceId) qs.set("exclude_instance_id", excludeInstanceId);
    const tail = qs.toString();
    return apiFetch(
      `/nodos/${nodoId}/builder-artifacts/expedientes/${tail ? `?${tail}` : ""}`,
      { token: getToken() },
    );
  },
};

// ---------------------------------------------------------------------
// Sprint 2026-05-14 · Fase 16 — Builder artifacts asociados a una
// transferencia inter-nodos. Espejo del nodoBuilderArtifactsApi pero
// scope = transferencia (no nodo). Backend reutiliza la tabla existente
// nodos.builder_artifact_instance ampliada con transferencia_id.
//
// Rutas:
//   GET    /api/transferencias/{trf_id}/builder-artifacts/
//   POST   /api/transferencias/{trf_id}/builder-artifacts/
//   GET    /api/transferencias/{trf_id}/builder-artifacts/{art_id}/
//   PATCH  /api/transferencias/{trf_id}/builder-artifacts/{art_id}/
//   DELETE /api/transferencias/{trf_id}/builder-artifacts/{art_id}/
//   GET    /api/transferencias/{trf_id}/builder-artifacts/available-lines/
//   GET    /api/transferencias/{trf_id}/builder-artifacts/expedientes/
// ---------------------------------------------------------------------
export const transferBuilderArtifactsApi = {
  list: (trfId, params) =>
    apiFetch(
      `/transferencias/${trfId}/builder-artifacts/${params ? `?${new URLSearchParams(params)}` : ""}`,
      { token: getToken() },
    ),
  get: (trfId, artId) =>
    apiFetch(`/transferencias/${trfId}/builder-artifacts/${artId}/`,
             { token: getToken() }),
  create: (trfId, payload) =>
    apiFetch(`/transferencias/${trfId}/builder-artifacts/`,
             { method: "POST", body: payload, token: getToken() }),
  update: (trfId, artId, payload) =>
    apiFetch(`/transferencias/${trfId}/builder-artifacts/${artId}/`,
             { method: "PATCH", body: payload, token: getToken() }),
  remove: (trfId, artId) =>
    apiFetch(`/transferencias/${trfId}/builder-artifacts/${artId}/`,
             { method: "DELETE", token: getToken() }),
  availableLines: (trfId, { templateId, expedienteIds = [], excludeInstanceId } = {}) => {
    const qs = new URLSearchParams();
    if (templateId)         qs.set("template_id", String(templateId));
    if (expedienteIds.length) qs.set("expediente_ids", expedienteIds.join(","));
    if (excludeInstanceId)  qs.set("exclude_instance_id", excludeInstanceId);
    return apiFetch(
      `/transferencias/${trfId}/builder-artifacts/available-lines/?${qs.toString()}`,
      { token: getToken() },
    );
  },
  expedientes: (trfId, { templateId, excludeInstanceId } = {}) => {
    const qs = new URLSearchParams();
    if (templateId)        qs.set("template_id", String(templateId));
    if (excludeInstanceId) qs.set("exclude_instance_id", excludeInstanceId);
    const tail = qs.toString();
    return apiFetch(
      `/transferencias/${trfId}/builder-artifacts/expedientes/${tail ? `?${tail}` : ""}`,
      { token: getToken() },
    );
  },
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
  // GET /api/finance/payments/ — soporta filtros: expediente_id, client_id,
  // estado, nodo_id, transferencia_id, oc_id (Sprint Pagos Transfers).
  list: (params) => _financeListGet.list(params),
  get:     _financeListGet.get,
  selectMetodos: () => apiFetch("/finance/payments/select_metodos/", { token: getToken() }),
  selectTipos:   () => apiFetch("/finance/payments/select_tipos/",   { token: getToken() }),
  selectEstados: () => apiFetch("/finance/payments/select_estados/", { token: getToken() }),

  // Lista de items "Aplicar a" reales. Acepta:
  //   expediente (UUID) · nodo_id · transferencia_id · oc_id
  // Ejemplo: listApplicables({ nodo_id: uuid, type: 'COSTO' })
  // GET /finance/payments/applicables/?<scope>=<id>&type=<type>
  listApplicables: ({ expediente, type, nodo_id, transferencia_id, oc_id }) => {
    const qs = new URLSearchParams();
    if (expediente)      qs.set("expediente",      expediente);
    if (nodo_id)         qs.set("nodo_id",         nodo_id);
    if (transferencia_id) qs.set("transferencia_id", transferencia_id);
    if (oc_id)           qs.set("oc_id",           oc_id);
    qs.set("type", type);
    return apiFetch(
      `/finance/payments/applicables/?${qs.toString()}`,
      { token: getToken() },
    );
  },

  register: async ({
    expediente_id, monto, moneda, fecha, metodo, tipo_pago,
    referencia, notas, aplicaciones, evidencia, event_id,
    // Sprint Registrar Pago (Fase 1) — campos nuevos del wizard
    direction, counterparty_type, counterparty_id,
    source_mwt_account_id, destination_mwt_account_id,
    tasa_cambio_a_usd,
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
    if (direction) fd.append("direction", direction);
    if (counterparty_type) fd.append("counterparty_type", counterparty_type);
    if (counterparty_id)   fd.append("counterparty_id",   counterparty_id);
    if (source_mwt_account_id)
      fd.append("source_mwt_account_id", source_mwt_account_id);
    if (destination_mwt_account_id)
      fd.append("destination_mwt_account_id", destination_mwt_account_id);
    if (tasa_cambio_a_usd != null)
      fd.append("tasa_cambio_a_usd", String(tasa_cambio_a_usd));
    fd.append("aplicaciones", JSON.stringify(aplicaciones || []));
    fd.append("evidencia", evidencia);
    return postMultipart("/finance/payments/", fd, { token: getToken() });
  },

  // ── Sprint Registrar Pago (Fase 1) — endpoints nuevos ──────────────
  // POST /api/finance/payments/dry-run — calcula efecto credito sin persistir.
  //   payload: { expediente_id, monto, aplicaciones, counterparty_type, ... }
  //   response: { validation_errors, credit_preview }
  dryRun: (payload) =>
    apiFetch("/finance/payments/dry-run/", {
      method: "POST", body: payload, token: getToken(),
    }),

  // PATCH /api/finance/payments/{id}/reconcile — flip reconciled_with_bank.
  reconcile: (id, { bank_reference, bank_statement_id } = {}) =>
    apiFetch(`/finance/payments/${encodeURIComponent(id)}/reconcile/`, {
      method: "PATCH",
      body: { bank_reference, bank_statement_id },
      token: getToken(),
    }),

  // PATCH /api/finance/payments/{id}/release-credit — CEO libera credito.
  //   409 + EXPEDIENTE_TERMS_UNDEFINED si forma_pago NULL.
  releaseCredit: (id, { confirm_token } = {}) =>
    apiFetch(`/finance/payments/${encodeURIComponent(id)}/release-credit/`, {
      method: "PATCH",
      body: confirm_token ? { confirm_token } : {},
      token: getToken(),
    }),

  // PATCH /api/finance/payments/{id}/reject — CEO rechaza.
  //   payload: { rejection_reason, rejection_comment?, confirm_reversal? }
  reject: (id, { rejection_reason, rejection_comment, confirm_reversal }) =>
    apiFetch(`/finance/payments/${encodeURIComponent(id)}/reject/`, {
      method: "PATCH",
      body: {
        rejection_reason,
        ...(rejection_comment ? { rejection_comment } : {}),
        ...(confirm_reversal ? { confirm_reversal: true } : {}),
      },
      token: getToken(),
    }),

  // Catalogos enum (Fase 1).
  selectRejectionReasons: () =>
    apiFetch("/finance/payments/select_rejection_reasons/", { token: getToken() }),
  selectCounterpartyTypes: () =>
    apiFetch("/finance/payments/select_counterparty_types/", { token: getToken() }),

  // DELETE /api/finance/payments/{id}/delete/
  // Soft-delete + credit reversal si CONFIRMADO_HUMANO.
  // body: { reverted_reason?: string }
  // 204 No Content (ok) · 409 ya revertido/rechazado · 403 no CEO
  delete: (id, body = {}) =>
    apiFetch(`/finance/payments/${encodeURIComponent(id)}/delete/`, {
      method: "DELETE",
      body,
      token: getToken(),
    }),

  // POST /api/finance/payments/analyze-evidence/  (multipart)
  // Analiza el comprobante con IA y devuelve campos extraídos + veredicto.
  // body: FormData con evidencia (File) + opcionales: monto, moneda, fecha,
  //        referencia, metodo, tipo_pago.
  // response 200: { status, confianza, monto_extraido, moneda_extraida,
  //                 fecha_extraida, referencia_extraida, beneficiario_extraido,
  //                 ordenante_extraido, banco_emisor, banco_receptor, concepto,
  //                 metodo_sugerido, razon_humana, alertas_fraude, mismatch_fields,
  //                 duration_ms, model_version, error_code, error_message }
  analyzeEvidence: ({ evidencia, monto, moneda, fecha, referencia, metodo, tipo_pago }) => {
    const fd = new FormData();
    fd.append("evidencia", evidencia);
    if (monto      != null) fd.append("monto",      String(monto));
    if (moneda     != null) fd.append("moneda",     moneda);
    if (fecha      != null) fd.append("fecha",      fecha);
    if (referencia != null) fd.append("referencia", referencia);
    if (metodo     != null) fd.append("metodo",     metodo);
    if (tipo_pago  != null) fd.append("tipo_pago",  tipo_pago);
    return postMultipart("/finance/payments/analyze-evidence/", fd, { token: getToken() });
  },
};

// =====================================================================
// Sprint Registrar Pago (Fase 1) — APIs nuevos
// =====================================================================

// CEO-ONLY · Cuentas bancarias propias MWT.
// GET   /api/finance/mwt-accounts/?operating_company_id=<uuid>
// POST  /api/finance/mwt-accounts/
const _mwtAcct = resource("finance/mwt-accounts");
export const mwtAccountsApi = {
  list:   (params) => _mwtAcct.list(params),
  create: (body)   => _mwtAcct.create(body),
};

// Obligaciones abiertas por contraparte — alimenta Paso 2 del wizard.
// GET /api/finance/counterparties/{TYPE}/{UUID}/open-debts/?applicable_type=...
export const counterpartiesApi = {
  openDebts: ({ counterparty_type, counterparty_id, applicable_type } = {}) => {
    const t = encodeURIComponent(String(counterparty_type || "").toUpperCase());
    const i = encodeURIComponent(counterparty_id);
    const qs = applicable_type
      ? `?applicable_type=${encodeURIComponent(applicable_type)}`
      : "";
    return apiFetch(
      `/finance/counterparties/${t}/${i}/open-debts/${qs}`,
      { token: getToken() },
    );
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
  updateCost: (trfId, costId, body)  => apiFetch(`/transferencias/${trfId}/cost-lines/${costId}/`,
                                              { method: "PATCH", body, token: getToken() }),
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
  // Sprint 2026-05-11 fase 7++ · subida de archivo a MinIO via Django.
  // Devuelve { ok, key, bucket, etag, content_type, size }.
  uploadProxy: async ({ file, scope = "artifact-field", filename } = {}) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("scope", scope);
    if (filename) fd.append("filename", filename);
    const resp = await fetch(`${API_BASE}/storage/upload-proxy/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${getToken()}` },
      body: fd,
    });
    let body = null;
    try { body = await resp.json(); } catch { body = null; }
    if (!resp.ok || !body?.ok) {
      const detail = body?.detail || body?.error || resp.statusText || "Upload error";
      const err = new Error(detail);
      err.status = resp.status;
      err.body = body;
      throw err;
    }
    return body;
  },
  // URL HTTPS para abrir/embed un archivo dado su key (server-side stream).
  downloadUrl: (key) =>
    `${API_BASE}/storage/download/?key=${encodeURIComponent(key)}`,
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
// Sprint 2026-05-20 · 6 nuevos endpoints (Centro de Operaciones CEO):
//   GET /api/analytics/credit_clock_avg/
//   GET /api/analytics/r1_correction_ratio/
//   GET /api/analytics/by_status_by_brand/
//   GET /api/analytics/inventory_coverage_by_node/
//   GET /api/analytics/top_skus_margen/
//   GET /api/analytics/expediente_margin_scatter/
// ---------------------------------------------------------------------
const analyticsBase = "/analytics";
// Sprint 2026-08-02 · scope por widget (dashboard ADMIN/CEO): cada método
// acepta opts.params ({ client_id, brand_id, market }) → querystring.
// Sin params la URL queda idéntica a antes (compat con el patrón viejo).
const _analyticsQs = (params) => {
  if (!params) return "";
  const usp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== "") usp.set(k, String(v));
  });
  const s = usp.toString();
  return s ? `?${s}` : "";
};
const _analyticsGet = (path, opts = {}) => {
  const { params, ...rest } = opts;
  return apiFetch(`${analyticsBase}/${path}/${_analyticsQs(params)}`, { token: getToken(), ...rest });
};
export const analyticsApi = {
  dashboardKpis:            (opts = {}) => _analyticsGet("dashboard_kpis", opts),
  cashflow:                 (opts = {}) => _analyticsGet("cashflow", opts),
  aging:                    (opts = {}) => _analyticsGet("aging", opts),
  exposicionClientes:       (opts = {}) => _analyticsGet("exposicion_clientes", opts),
  margenMarcas:             (opts = {}) => _analyticsGet("margen_marcas", opts),
  byStatus:                 (opts = {}) => _analyticsGet("by_status", opts),
  urgent:                   (opts = {}) => _analyticsGet("urgent", opts),
  creditClockAvg:           (opts = {}) => _analyticsGet("credit_clock_avg", opts),
  r1CorrectionRatio:        (opts = {}) => _analyticsGet("r1_correction_ratio", opts),
  byStatusByBrand:          (opts = {}) => _analyticsGet("by_status_by_brand", opts),
  inventoryCoverageByNode:  (opts = {}) => _analyticsGet("inventory_coverage_by_node", opts),
  topSkusMargen:            (opts = {}) => _analyticsGet("top_skus_margen", opts),
  expedienteMarginScatter:  (opts = {}) => _analyticsGet("expediente_margin_scatter", opts),
  sizeMarketDistribution:   (opts = {}) => _analyticsGet("size_market_distribution", opts),
  tacosFbaUs:               (opts = {}) => _analyticsGet("tacos_fba_us", opts),
};
// ---------------------------------------------------------------------
// FX (USD ↔ BRL) — endpoint compartido con BrandClientPricingForm.
// Backend: backend/apps/commercial/views.py · MarluvasExchangeRateView.
// Cadena: AwesomeAPI BR (1min) → Frankfurter/ECB (1d) → Redis cache 60min.
// Shape: { rate, bid, ask, timestamp, source, cached, error }
// ---------------------------------------------------------------------
export const fxApi = {
  usdBrl:        (refresh = false) =>
    apiFetch(`/commercial/exchange-rate/usd-brl/${refresh ? "?refresh=1" : ""}`,
             { token: getToken() }),
  // Cronograma · serie historica USD/BRL (Frankfurter/ECB), cacheada 6h.
  // Shape: { series:[{date, rate}], count, start, end, stats:{...}, source, cached }
  usdBrlHistory: (days = 180, refresh = false) =>
    apiFetch(`/commercial/exchange-rate/usd-brl/history/?days=${encodeURIComponent(days)}${refresh ? "&refresh=1" : ""}`,
             { token: getToken() }),
  usdCrc:        (refresh = false) =>
    apiFetch(`/commercial/exchange-rate/usd-crc/${refresh ? "?refresh=1" : ""}`,
             { token: getToken() }),
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
  selectAgents:       (params)        => aiAgentsApi.action("select", params),
  selectSkills:       (params)        => aiSkillsApi.action("select", params),
  selectInstructions: (params)        => aiInstructionsApi.action("select", params),

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
// SIZING ENGINE — Sprint Sizing v1 (+ motor dinámico 2026-07-22 fase 2)
// ---------------------------------------------------------------------
//   GET    /api/sizing/options/                catálogos para selects FE
//   CRUD   /api/sizing/tipos-producto/         (lookup por `codigo`; DELETE soft)
//   CRUD   /api/sizing/sistemas-medida/        (lookup por `codigo`; DELETE soft)
//   CRUD   /api/sizing/tallas/                 (incluye action "clone")
//   CRUD   /api/sizing/familias/               (por marca; DELETE soft)
//   resource() ya provee create/update/remove — remove(codigo) hace
//   DELETE /<base>/<codigo>/ tal como pide el contrato.
// ---------------------------------------------------------------------
export const tallasApi               = resource("sizing/tallas");
export const tiposProductoCatApi     = resource("sizing/tipos-producto");
export const sistemasMedidaCatApi    = resource("sizing/sistemas-medida");
// Sprint 2026-07-22 · familias de línea por marca (CRUD; DELETE = soft).
//   GET/POST /api/sizing/familias/ · PATCH/DELETE /api/sizing/familias/<id>/
//   Filtros: ?marca_id=<uuid> · ?is_active= · ?q=
export const sizingFamiliasApi       = resource("sizing/familias");
// Sprint 2026-07-23 · G23 · matriz de equivalencias por tipo + marca + grupo.
//   GET/POST /api/sizing/tipos-producto-matriz/
//   PATCH/DELETE /api/sizing/tipos-producto-matriz/<id>/
//   Filtros: ?tipo_producto= · ?marca_id= · ?familia_id=
export const tiposProductoMatrizApi  = resource("sizing/tipos-producto-matriz");

export const sizingApi = {
  options: () => apiFetch(`/sizing/options/`, { token: getToken() }),
  clone:   (tallaId) => tallasApi.action("clone", tallaId, {}),
};

// ---------------------------------------------------------------------
// Catálogo persistido de opciones de atributos técnicos (2026-07-16)
//   GET  /api/productos/attr-options/          { tipo_calzado: [...], ... }
//   POST /api/productos/attr-add/              { key, value }
//   POST /api/productos/attr-delete/           { key, value } → 409 si en uso
//   (attr-rename ya existía; renombra en todos los productos + catálogo)
// ---------------------------------------------------------------------
export const attrOptionsApi = {
  list:   ()            => apiFetch(`/productos/attr-options/`, { token: getToken() }),
  add:    (key, value)  => apiFetch(`/productos/attr-add/`,
                                    { method: "POST", body: { key, value }, token: getToken() }),
  remove: (key, value)  => apiFetch(`/productos/attr-delete/`,
                                    { method: "POST", body: { key, value }, token: getToken() }),
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

