// =====================================================================
// MWT.ONE · RoleContext.jsx
// Sistema de Visibilidad por Roles (RBAC) — capa de UI
//
// Gobierno de reglas:
//   - El rol REAL del usuario viene del JWT (AuthContext.user.role).
//     Posibles valores (MWT_ROLES en settings.py):
//        superadmin · admin · manager · operator · finance · viewer · client_b2b
//
//   - En la UI colapsamos eso a dos "viewports":
//        ADMIN  → todo el staff interno MWT (superadmin/admin/manager/operator/finance/viewer)
//        CLIENT → usuarios del Portal B2B (client_b2b)
//
//   - Un usuario real con rol CLIENT_B2B NUNCA puede cambiar su viewport;
//     el override del Tweaks solo funciona para staff (canTweak=true).
//
//   - El override se guarda en sessionStorage (no localStorage) para que
//     expire al cerrar la pestaña y no haya "fugas" de modo cliente que
//     persistan entre sesiones.
//
//   - SEGURIDAD: este context es SOLO UI. La autoridad de visibilidad
//     real vive en el backend (apps.portal + ClientScopedManager +
//     POL_VISIBILIDAD). Aunque un usuario manipule DevTools para forzar
//     role=ADMIN, el API no le responderá con datos que no son suyos.
//     Por eso este módulo no intenta "proteger" datos — solo oculta UI
//     para dar la experiencia correcta al viewport correcto.
// =====================================================================
import React, { createContext, useContext, useMemo, useState, useCallback, useEffect } from "react";
import { useAuth } from "./AuthContext.jsx";

const OVERRIDE_KEY = "mwt-role-override";

// Mapeo del rol del JWT al viewport UI.
function normalizeBackendRole(backendRole) {
  return String(backendRole || "").trim().toLowerCase();
}

function isClientBackendRole(backendRole) {
  const r = normalizeBackendRole(backendRole);
  return r.startsWith("client_") || r === "client" || r === "cliente" || r === "client_b2b";
}

function isCeoAdminBackendRole(backendRole) {
  const r = normalizeBackendRole(backendRole);
  return r === "superadmin" || r === "admin" || r === "ceo";
}

function deriveBaseViewport(backendRole) {
  if (!backendRole) return "ADMIN"; // DEV fallback ? el ProtectedRoute ya filtr? no-auth
  return isClientBackendRole(backendRole) ? "CLIENT" : "ADMIN";
}

// Whitelist de módulos visibles en CLIENT.
// El Sidebar y otros filtros consumen esta lista.
//
// Ampliación 2026-04-21 (AG-FRONTEND):
//   - pipeline → kanban READ-ONLY de los propios expedientes (sin drag-drop,
//               sin montos USD, sin márgenes, sin filtros internos).
//   - portal   → ficha "Mi Empresa" read-only (razón social, RUC/CUIT, AM,
//               límite de crédito) + tabs Orders/Payments/Docs existentes.
//   - pagos    → vista compacta "Saldo + próximos vencimientos" (sin
//               máquina de estados, sin aging, sin Rentabilidad CEO).
//   - ai       → Asistente MWT (SVC-01). El cliente entra al mismo módulo
//               /ai que el admin, pero con strip-down aplicado en
//               AIHub.jsx + AIChat.jsx (sin Gobernanza, sin @ / /, pill
//               fija SVC-01). Backend: guards en apps/ai_hub bloquean
//               /api/ai/agents|skills|instructions con 403 y fuerzan
//               user_id=request.user.id en threads.
export const CLIENT_ALLOWED_MODULES = new Set([
  "dashboard",
  "expedientes",
  "cronograma",  // Sprint 2026-06-10 · Cronograma interactivo (precios per-rol)
  "pipeline",
  "portal",
  "pagos",
  "ai",
  "tickets",  // Modulo de soporte interno (LOTE_SM_TICKETS) — visible para todos
]);

// Mapeo sidebar-key → module_slug de la matriz RBAC (users.role_permission).
// Se usa para resolver can_read/can_create/can_update/can_delete/can_*_doc
// cuando el login trae permissions reales del rol. Claves sin entrada caen
// al comportamiento legacy (CLIENT_ALLOWED_MODULES).
const SIDEBAR_KEY_TO_MODULE = {
  dashboard:       "dashboard",
  expedientes:     "expedientes",
  cronograma:      "expedientes",   // el cronograma vive bajo expedientes
  pipeline:        "expedientes",
  portal:          "portal",
  pagos:           "pagos",
  ai:              "portal",        // Asistente MWT scoped al portal
  tickets:         "tickets",
  transfers:       "transferencias",
  nodos:           "nodos",
  inventario:      "inventario",
  clientes:        "clientes",
  brands:          "marcas",
  productos:       "productos",
  "price-history": "historial-precios",
  history:         "notificaciones",
  collections:     "cartera",
  usuarios:        "usuarios",
  roles:           "roles",
  "mesa-trabajo":  "expedientes",
  sizing:          "sizing",
};

// Convierte la matriz CRUD (de /api/permissions/groups/<slug>/) a la shape
// {modules:[...], actions:[...]} que ya consume el frontend.
function matrixToPermissions(matrix = []) {
  const modules = [];
  const actions = [];
  const push = (m, act) => { if (!m) return; if (!modules.includes(m)) modules.push(m); actions.push(`${m}.${act}`); };
  for (const cell of matrix) {
    if (!cell || !cell.module) continue;
    const m = String(cell.module);
    if (cell.can_read)       push(m, "view");
    if (cell.can_create)     push(m, "create");
    if (cell.can_update)     push(m, "update");
    if (cell.can_delete)     push(m, "delete");
    if (cell.can_upload_doc) push(m, "upload_doc");
    if (cell.can_download_doc) push(m, "download_doc");
    if (cell.can_view_doc)   push(m, "view_doc");
  }
  return { modules, actions };
}

// Capacidades CEO-ONLY — si isClient, estas acciones se ocultan/deshabilitan.
// Mantener sincronizado con POL_VISIBILIDAD.md en la KB.
export const CEO_ONLY_CAPABILITIES = new Set([
  "create_expediente",          // + Crear / + Nueva OC
  "edit_oc_line_qty",           // modificar qty de línea
  "edit_oc_line_unit_price",    // modificar precio unitario
  "delete_oc_line",             // eliminar línea
  "add_oc_line",                // + Agregar producto
  "edit_deferred_qty",          // input deferred_qty
  "edit_deferred_unit_price",   // input deferred_unit_price
  "toggle_deferred_visibility", // switch show_deferred_to_client
  "register_sap",               // + Agregar SAP (C5 RegisterSAPConfirmation)
  "upload_document",            // + Agregar Documento
  "view_cost_breakdown",        // tab costos logísticos
  "view_margin",                // tab márgenes
  "view_internal_proforma",     // tab proforma interna
  "view_payables",              // KPI por pagar (Dashboard)
  "view_weighted_margin",       // KPI rentabilidad en vivo
  // ─── Pipeline ────────────────────────────────────
  "pipeline_drag",              // drag-and-drop para avanzar estado
  "view_pipeline_money",        // montos USD en cards + column totals
  "view_pipeline_internal_filters", // chips "Bloqueados" + leyenda con "Blocked"
  // ─── Financiero / Pagos ──────────────────────────
  "register_payment",           // "+ Registrar pago"
  "view_financiero_full_dashboard", // Máquina de estados + Aging + Rentabilidad CEO + tabs
  // ─── Portal ──────────────────────────────────────
  "portal_edit_company",        // editar ficha de compañía (staff)
  "view_portal_preview_badge",  // "VISTA CLIENTE" badge (solo staff previsualizando)
]);

const RoleContext = createContext(null);

export function RoleProvider({ children }) {
  const { user, role: backendRole } = useAuth();

  // Viewport REAL derivado del JWT (fuente de verdad). Nunca mutable por UI.
  const baseViewport = useMemo(() => deriveBaseViewport(backendRole), [backendRole]);
  const isCeoAdmin = useMemo(() => isCeoAdminBackendRole(backendRole), [backendRole]);

  // ¿Este usuario puede usar el Tweak de rol? Solo staff interno.
  const canTweak = baseViewport === "ADMIN";

  // Override manual (solo staff). Se guarda en sessionStorage.
  const [override, setOverrideState] = useState(() => {
    if (typeof window === "undefined") return null;
    try {
      const v = sessionStorage.getItem(OVERRIDE_KEY);
      return (v === "ADMIN" || v === "CLIENT") ? v : null;
    } catch { return null; }
  });

  // Si el usuario cambia (login/logout) y ya no es staff, limpia el override.
  useEffect(() => {
    if (!canTweak && override) {
      setOverrideState(null);
      try { sessionStorage.removeItem(OVERRIDE_KEY); } catch {}
    }
  }, [canTweak, override]);

  const setOverride = useCallback((next) => {
    if (!canTweak) return; // silencioso: no-op para CLIENT reales
    const clean = (next === "ADMIN" || next === "CLIENT") ? next : null;
    setOverrideState(clean);
    try {
      if (clean) sessionStorage.setItem(OVERRIDE_KEY, clean);
      else sessionStorage.removeItem(OVERRIDE_KEY);
    } catch {}
  }, [canTweak]);

  // Viewport efectivo = override (si staff y pusiste uno) || baseViewport.
  const role = canTweak && override ? override : baseViewport;
  const isAdmin  = role === "ADMIN";
  const isClient = role === "CLIENT";

  // Matriz real del rol (si el backend la mandó). Shape esperado:
  //   { modules: ["expedientes", "portal", ...],
  //     actions: ["expedientes.view", "expedientes.create", ...] }
  // Fuente: core.roles.permissions (editado en /roles → sync A6). Si el
  // login trae la shape de la matriz CRUD (array de celdas), la convertimos.
  const rawPerms = useMemo(() => user?.permissions || {}, [user]);
  const rolePerms = useMemo(() => {
    if (Array.isArray(rawPerms?.matrix)) return matrixToPermissions(rawPerms.matrix);
    if (Array.isArray(rawPerms)) return { modules: rawPerms, actions: [] };
    return {
      modules: Array.isArray(rawPerms?.modules) ? rawPerms.modules : [],
      actions: Array.isArray(rawPerms?.actions) ? rawPerms.actions : [],
    };
  }, [rawPerms]);
  const hasRealMatrix = useMemo(
    () => Array.isArray(rolePerms.modules) && rolePerms.modules.length > 0,
    [rolePerms],
  );
  const matrixHasWildcard = rolePerms.modules.includes("*");

  // Helper para consultar capacidades CEO-ONLY.
  const can = useCallback((capability) => {
    if (!CEO_ONLY_CAPABILITIES.has(capability)) return true; // no es CEO-only → siempre permitido
    return isAdmin; // CEO-only → solo ADMIN
  }, [isAdmin]);

  // Helper para módulos del Sidebar.
  // Si el backend mandó la matriz real del rol, la usamos (can_read).
  // Si no (login legacy sin permissions), caemos a la whitelist por viewport.
  const canSeeModule = useCallback((moduleKey) => {
    if (isAdmin) return true;
    if (!hasRealMatrix) return CLIENT_ALLOWED_MODULES.has(moduleKey);
    if (matrixHasWildcard) return true;
    const moduleSlug = SIDEBAR_KEY_TO_MODULE[moduleKey] || moduleKey;
    return rolePerms.modules.includes(moduleSlug);
  }, [isAdmin, hasRealMatrix, matrixHasWildcard, rolePerms.modules]);

  // Acción granular (create/update/delete/view_doc/download_doc/upload_doc).
  // fallback: si no hay matriz real, ADMIN=true / CLIENT=false para acciones
  // de escritura; las de lectura/docs respetan la whitelist legacy.
  const canAction = useCallback((moduleKeyOrSlug, action) => {
    if (isAdmin) return true;
    const moduleSlug = SIDEBAR_KEY_TO_MODULE[moduleKeyOrSlug] || moduleKeyOrSlug;
    if (hasRealMatrix) {
      if (matrixHasWildcard) return true;
      return rolePerms.actions.includes(`${moduleSlug}.${action}`);
    }
    // Legacy (sin matriz): cliente no edita nada en el ERP.
    const readLike = ["view", "view_doc", "download_doc"].includes(action);
    return readLike && CLIENT_ALLOWED_MODULES.has(moduleKeyOrSlug);
  }, [isAdmin, hasRealMatrix, matrixHasWildcard, rolePerms.actions]);

  const value = useMemo(() => ({
    // estado
    role,               // "ADMIN" | "CLIENT"
    isAdmin,
    isClient,
    isCeoAdmin,
    baseViewport,       // el rol real derivado del JWT (no override)
    canTweak,           // ¿puede este usuario cambiar el viewport?
    override,           // "ADMIN" | "CLIENT" | null
    // acciones
    setOverride,
    clearOverride: () => setOverride(null),
    // helpers
    can,
    canSeeModule,
    canAction,
    // metadata útil
    backendRole,
    user,
    rolePerms,
    hasRealMatrix,
  }), [role, isAdmin, isClient, isCeoAdmin, baseViewport, canTweak, override, setOverride, can, canSeeModule, canAction, rolePerms, hasRealMatrix, backendRole, user]);

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole() {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error("useRole debe usarse dentro de <RoleProvider/>");
  return ctx;
}
