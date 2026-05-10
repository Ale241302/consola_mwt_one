// =====================================================================
// MWT.ONE · lib/operatingCompany.js
// Constantes y helpers de la "empresa operadora" del expediente.
//
// Sprint 2026-05-06 (AG-03): un expediente es operado por:
//   · Muito Work Limitada (operador por defecto)  → MWT_OPERATING_CLIENT_ID
//   · El propio cliente final                     → cualquier otro UUID
//
// El campo `Expediente.operating_company_id` lo decide el ADMIN al crear.
// El backend congela ambos precios (mwt + cliente) en la línea y devuelve
// `unit_price_for_viewer` resuelto según el rol del consumidor del API.
// =====================================================================

// Sprint 2026-05-10 · FIX produccion: el UUID anterior
// 61a3763d-75fb-461d-af4c-e17cbea880f0 era un placeholder que NO existia
// como fila en clientes.cliente. Por eso el lookup en
// producto.especificaciones.client_prices siempre fallaba y caia a
// precio_lista. El UUID real (creado por UI) es el de abajo. Mantener
// en sync con backend/apps/core/constants.py.
export const MWT_OPERATING_CLIENT_ID = "5525986c-3b09-4d13-bf8f-43ccaa2deae3";
export const MWT_OPERATOR_NAME       = "Muito Work Limitada";
export const MWT_OPERATOR_RUC        = "MWT-Operador";

/**
 * Devuelve true si el id de la empresa operadora coincide con MWT.
 * @param {string|null|undefined} operatingCompanyId
 * @returns {boolean}
 */
export function isMwtOperated(operatingCompanyId) {
  return String(operatingCompanyId || "").toLowerCase()
    === MWT_OPERATING_CLIENT_ID.toLowerCase();
}

/**
 * Es un usuario "interno" de MWT (Admin / CEO / Staff / Ops).
 * @param {object|null} user — objeto user del AuthContext.
 * @returns {boolean}
 */
export function isInternalRole(user) {
  if (!user) return false;
  if (user.is_superuser) return true;
  const role = String(user.role_default || user.role || "").toLowerCase();
  return (
    role === "admin" ||
    role === "ceo" ||
    role === "staff" ||
    role === "ops" ||
    (!role.startsWith("client_") && role !== "client" && role !== "viewer")
  );
}

/**
 * Es un usuario del Portal B2B (CLIENT_*).
 * @param {object|null} user
 * @returns {boolean}
 */
export function isClientRole(user) {
  if (!user) return false;
  if (user.is_superuser) return false;
  const role = String(user.role_default || user.role || "").toLowerCase();
  return role.startsWith("client_") || role === "client";
}

/**
 * Es estrictamente Admin / CEO / superuser. Sprint 2026-05-06.
 * Más estricto que isInternalRole: staff/ops NO cuentan como Admin.
 * Usado para audiencia ADMIN_ONLY (ART-04 SAP, etc.).
 * @param {object|null} user
 * @returns {boolean}
 */
export function isAdminRole(user) {
  if (!user) return false;
  if (user.is_superuser) return true;
  const role = String(user.role_default || user.role || "").toLowerCase();
  return role === "admin" || role === "ceo";
}

/**
 * Audiencias soportadas para Documento y artifact_instances.
 * Mantener en sync con backend/sql/C2_audience_admin_only.sql.
 */
export const DOCUMENT_AUDIENCES = Object.freeze({
  CLIENT:        "CLIENT",
  MWT_INTERNAL:  "MWT_INTERNAL",
  ADMIN_ONLY:    "ADMIN_ONLY",
});
