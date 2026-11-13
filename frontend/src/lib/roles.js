// =====================================================================
// MWT.ONE · lib/roles.js
// Agente responsable: [AG-FRONTEND]
//
// Fuente única de los roles para los selectores de Usuarios.
//
// Antes cada página importaba `ROLES_DEMO` (lista hardcodeada), así que
// cualquier rol creado en /roles (users.role_cat) nunca aparecía al
// crear/editar un usuario. Ahora se lee el catálogo real en
// GET /api/permissions/roles/ y ROLES_DEMO queda solo como fallback
// (mock mode o backend caído).
// =====================================================================
import { apiFetch, getToken } from "./api.js";
import { ROLES_DEMO } from "./usersRolesMock.js";

export const ROLES_FALLBACK = ROLES_DEMO;

// Mismos alias que apps.core.permissions.is_client_role del backend.
const CLIENT_ROLE_ALIASES = new Set(["client", "cliente", "client_b2b"]);

/** ¿El rol es de cliente (necesita empresa asignada)? */
export function isClientRoleSlug(slug) {
  const r = String(slug || "").trim().toLowerCase();
  return r.startsWith("client_") || CLIENT_ROLE_ALIASES.has(r);
}

function normalizeRole(r) {
  return {
    slug:      r.slug,
    nombre:    r.nombre || r.name || r.slug,
    color:     r.color || "#64748B",
    orden:     Number.isFinite(r.orden) ? r.orden : 100,
    is_system: !!r.is_system,
    is_active: r.is_active !== false,
  };
}

/** Catálogo de roles activos, ordenado como en /roles. */
export async function fetchRoles() {
  try {
    const data = await apiFetch("/permissions/roles/", { token: getToken() });
    const arr = Array.isArray(data) ? data : (data?.results || []);
    const roles = arr
      .filter((r) => r && r.slug)
      .map(normalizeRole)
      .filter((r) => r.is_active)
      .sort((a, b) => (a.orden - b.orden) || a.slug.localeCompare(b.slug));
    return roles.length ? roles : ROLES_FALLBACK;
  } catch {
    return ROLES_FALLBACK;
  }
}

/**
 * Garantiza que el rol actual del usuario esté en la lista. Sin esto un
 * usuario con un rol inactivo/borrado muestra el primer <option> como
 * valor del select aunque su role_default sea otro (mentira visual).
 */
export function withCurrentRole(roles, slug) {
  const list = Array.isArray(roles) ? roles : [];
  if (!slug || list.some((r) => r.slug === slug)) return list;
  return [
    ...list,
    { slug, nombre: slug, color: "#64748B", orden: 9999, is_system: false, is_active: false },
  ];
}
