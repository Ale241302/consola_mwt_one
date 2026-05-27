// =====================================================================
// MWT.ONE · lib/usersRolesMock.js
// Agente responsable: [AG-FRONTEND]
//
// Fixtures demo para el módulo CORE M3 (VITE_USE_MOCKS=1):
//   GET /api/users/                      → USERS_DEMO
//   GET /api/users/me/profile/           → el user demo actual
//   GET /api/permissions/roles/          → ROLES_DEMO
//   GET /api/permissions/modules/        → MODULES_DEMO
//   GET /api/permissions/groups/<slug>/  → matriz generada por rol
//   GET /api/activity-feed/              → ACTIVITY_FEED_DEMO
//   GET /api/activity-feed/unread-count/ → count de unread
//
// Shape backend-compatible (apps.users.serializers).
// =====================================================================

export const ROLES_DEMO = [
  { slug: "superadmin", nombre: "Super Admin",      descripcion: "Acceso total incluyendo gobernanza y Kill-Switch.", color: "#481EE3", orden: 10,  is_system: true,  is_active: true },
  { slug: "admin",      nombre: "Admin (CEO)",      descripcion: "Acceso total operativo + comercial. Ve costos y márgenes.", color: "#0B1E3A", orden: 20, is_system: true, is_active: true },
  { slug: "manager",    nombre: "Manager",          descripcion: "Orquesta expedientes y equipo. No ve rentabilidad interna.", color: "#3083FE", orden: 30, is_system: false, is_active: true },
  { slug: "operator",   nombre: "Operador",         descripcion: "Gestión diaria de OCs, documentos y líneas.", color: "#00B286", orden: 40, is_system: false, is_active: true },
  { slug: "finance",    nombre: "Finance",          descripcion: "Cobros, pagos y conciliación. Ve límites de crédito.", color: "#B45309", orden: 50, is_system: false, is_active: true },
  { slug: "compras",    nombre: "Compras",          descripcion: "Gestión de proveedores + productos.", color: "#1EE3D7", orden: 60, is_system: false, is_active: true },
  { slug: "viewer",     nombre: "Viewer",           descripcion: "Lectura de módulos operativos sin poder modificar.", color: "#64748B", orden: 80, is_system: false, is_active: true },
  { slug: "client_b2b", nombre: "Cliente B2B",      descripcion: "Usuario del Portal B2B. Scope estricto al legal_entity_id.", color: "#008B69", orden: 90, is_system: true, is_active: true },
];

export const MODULES_DEMO = [
  { slug: "dashboard",      nombre: "Dashboard",          categoria: "CORE",         orden: 10 },
  { slug: "expedientes",    nombre: "Expedientes",        categoria: "OPERACIONAL",  orden: 20 },
  { slug: "pipeline",       nombre: "Pipeline",           categoria: "OPERACIONAL",  orden: 30 },
  { slug: "inventario",     nombre: "Inventario",         categoria: "OPERACIONAL",  orden: 40 },
  { slug: "transferencias", nombre: "Movimientos",     categoria: "OPERACIONAL",  orden: 50 },
  { slug: "productos",      nombre: "Productos",          categoria: "CATALOGOS",    orden: 60 },
  { slug: "marcas",         nombre: "Marcas",             categoria: "CATALOGOS",    orden: 70 },
  { slug: "clientes",       nombre: "Clientes",           categoria: "COMERCIAL",    orden: 80 },
  { slug: "proveedores",    nombre: "Proveedores",        categoria: "COMERCIAL",    orden: 90 },
  { slug: "nodos",          nombre: "Nodos",              categoria: "OPERACIONAL",  orden: 100 },
  { slug: "cobros",         nombre: "Cobros",             categoria: "FINANCIERO",   orden: 110 },
  { slug: "pagos",          nombre: "Pagos",              categoria: "FINANCIERO",   orden: 120 },
  { slug: "financiero",     nombre: "Financiero",         categoria: "FINANCIERO",   orden: 130 },
  { slug: "notificaciones", nombre: "Notificaciones",     categoria: "OPERACIONAL",  orden: 140 },
  { slug: "plantillas",     nombre: "Plantillas (Email)", categoria: "CATALOGOS",    orden: 150 },
  { slug: "portal",         nombre: "Portal B2B",         categoria: "B2B",          orden: 160 },
  { slug: "ai-hub",         nombre: "AI Hub",             categoria: "AI",           orden: 170 },
  { slug: "ai-governance",  nombre: "AI Gobernanza",      categoria: "AI",           orden: 175 },
  { slug: "sizing",         nombre: "Motor de Tallas",    categoria: "CATALOGOS",    orden: 180 },
  { slug: "pricing",        nombre: "Motor de Precios",   categoria: "COMERCIAL",    orden: 190 },
  { slug: "usuarios",       nombre: "Usuarios",           categoria: "CORE",         orden: 200 },
  { slug: "roles",          nombre: "Roles y Permisos",   categoria: "CORE",         orden: 210 },
];

// Direcciones demo (un user puede tener varias; una es `is_default`).
// Shape coherente con lo que espera ProfilePage + UserFormView.
const ADDR = (label, street, city, country_iso2, is_default = false) => ({
  id:          `addr-${Math.random().toString(36).slice(2, 10)}`,
  label,                  // "Casa", "Oficina", "Almacén", "Fiscal"
  street,
  city,
  country_iso2,
  zip:         null,
  is_default,
  is_active:   true,
});

export const USERS_DEMO = [
  {
    id: "u-001", email_plain: "alejandro@muitowork.com", full_name: "Alejandro Mendoza",
    contact_email: "alejandro@muitowork.com", phone: "+51 999 111 111",
    preferred_language: "es", timezone: "America/Lima",
    role_default: "superadmin", is_superuser: true,
    legal_entity_id: null,  // staff interno — no asignado a empresa cliente
    last_login_at: "2026-04-23T14:22:00Z", is_active: true, created_at: "2024-01-10T09:00:00Z",
    addresses: [
      ADDR("Oficina HQ", "Av. República de Colombia 791, piso 14, San Isidro", "Lima", "PE", true),
    ],
  },
  {
    id: "u-002", email_plain: "manager@mwt.one", full_name: "Carolina Ortiz",
    contact_email: "co@mwt.one", phone: "+51 999 222 222",
    preferred_language: "es", timezone: "America/Lima",
    role_default: "manager", is_superuser: false, legal_entity_id: null,
    last_login_at: "2026-04-22T16:45:00Z", is_active: true, created_at: "2024-03-05T10:30:00Z",
    addresses: [ADDR("Oficina HQ", "Av. República de Colombia 791, piso 14, San Isidro", "Lima", "PE", true)],
  },
  {
    id: "u-003", email_plain: "ops@mwt.one", full_name: "Diego Salazar",
    contact_email: "ds@mwt.one", phone: "+51 999 333 333",
    preferred_language: "es", timezone: "America/Lima",
    role_default: "operator", is_superuser: false, legal_entity_id: null,
    last_login_at: "2026-04-23T08:12:00Z", is_active: true, created_at: "2024-06-11T14:20:00Z",
    addresses: [ADDR("Oficina HQ", "Av. República de Colombia 791, piso 14, San Isidro", "Lima", "PE", true)],
  },
  {
    id: "u-004", email_plain: "finance@mwt.one", full_name: "Lucía Vargas",
    contact_email: "lv@mwt.one", phone: "+51 999 444 444",
    preferred_language: "es", timezone: "America/Lima",
    role_default: "finance", is_superuser: false, legal_entity_id: null,
    last_login_at: "2026-04-23T11:05:00Z", is_active: true, created_at: "2024-09-01T12:00:00Z",
    addresses: [ADDR("Oficina HQ", "Av. República de Colombia 791, piso 14, San Isidro", "Lima", "PE", true)],
  },
  {
    id: "u-005", email_plain: "compras@mwt.one", full_name: "Rodrigo Fernández",
    contact_email: "rf@mwt.one", phone: "+51 999 555 555",
    preferred_language: "es", timezone: "America/Lima",
    role_default: "compras", is_superuser: false, legal_entity_id: null,
    last_login_at: "2026-04-21T09:40:00Z", is_active: true, created_at: "2025-01-20T08:00:00Z",
    addresses: [ADDR("Oficina HQ", "Av. República de Colombia 791, piso 14, San Isidro", "Lima", "PE", true)],
  },
  {
    id: "u-006", email_plain: "viewer@mwt.one", full_name: "Pablo Guzmán",
    contact_email: "pg@mwt.one", phone: null,
    preferred_language: "es", timezone: "America/Lima",
    role_default: "viewer", is_superuser: false, legal_entity_id: null,
    last_login_at: "2026-04-18T15:30:00Z", is_active: true, created_at: "2025-03-12T14:00:00Z",
    addresses: [],
  },
  {
    id: "u-007", email_plain: "lpa@andesretail.pe", full_name: "Luz Paredes",
    contact_email: "lpa@andesretail.pe", phone: "+51 1 234 5678",
    preferred_language: "es", timezone: "America/Lima",
    role_default: "client_b2b", is_superuser: false,
    legal_entity_id: "c1",  // Andes Retail Co.
    last_login_at: "2026-04-23T13:10:00Z", is_active: true, created_at: "2024-11-08T10:00:00Z",
    addresses: [
      ADDR("Oficina principal", "Av. Javier Prado Este 2450, San Isidro", "Lima",     "PE", true),
      ADDR("Almacén Callao",     "Av. Néstor Gambetta km 14.5, Callao",     "Callao",   "PE"),
    ],
  },
  {
    id: "u-008", email_plain: "rojas@atacama.cl", full_name: "Carolina Rojas",
    contact_email: "rojas@atacama.cl", phone: "+56 2 987 6543",
    preferred_language: "es", timezone: "America/Santiago",
    role_default: "client_b2b", is_superuser: false,
    legal_entity_id: "c2",  // Atacama Distribuidora
    last_login_at: "2026-04-22T10:50:00Z", is_active: true, created_at: "2024-08-15T11:30:00Z",
    addresses: [
      ADDR("Oficina central",  "Av. Apoquindo 4800, piso 8, Las Condes", "Santiago", "CL", true),
      ADDR("CD Valparaíso",    "Av. Altamirano 1480",                    "Valparaíso","CL"),
    ],
  },
  {
    id: "u-009", email_plain: "consultor.externo@mwt.one", full_name: "Valeria Ibáñez",
    contact_email: "vi.consultant@mwt.one", phone: null,
    preferred_language: "en", timezone: "America/Lima",
    role_default: "viewer", is_superuser: false, legal_entity_id: null,
    last_login_at: null, is_active: false, created_at: "2025-06-10T09:00:00Z",
    addresses: [],
  },
];


// ─────────────────────────────────────────────────────────────────────
// Empresas (legal entities) — lookup helper. En real importamos de
// /api/clientes/. Acá re-exportamos un subset de mockData.CLIENTS para
// no duplicar verdad: el UserFormView y ProfilePage los resuelven por
// legal_entity_id → {id, razon_social, tax_id, country, direccion,
// contacto, email, phone, credit_days, credit_limit}.
// ─────────────────────────────────────────────────────────────────────
import { CLIENTS as MOCK_CLIENTS } from "../data/mockData.js";

/** Devuelve los datos corporativos completos de una empresa. */
export function legalEntityMock(id) {
  if (!id) return null;
  const c = (MOCK_CLIENTS || []).find((x) => x.id === id);
  if (!c) return null;
  return {
    id:             c.id,
    razon_social:   c.cliente || c.name,
    nombre_comercial: c.name,
    tax_id:         c.cedula_juridica || c.rut || "",
    country:        c.country || null,
    country_iso2:   c.country_code || null,
    flag:           c.flag || null,
    direccion_fiscal: c.direccion_entrega || "",
    contacto_nombre: c.contacto_nombre || c.contact || "",
    email:          c.email || "",
    phone:          c.phone || "",
    credito_dias:   c.credito_dias ?? null,
    credito_limit:  c.credit_limit ?? c.credito_limit ?? null,
    band:           c.band || null,
  };
}

/** Lista completa de empresas para el selector del UserFormView. */
export function legalEntitiesListMock() {
  return (MOCK_CLIENTS || []).map((c) => ({
    id:              c.id,
    razon_social:    c.cliente || c.name,
    nombre_comercial: c.name,
    country:         c.country,
    flag:            c.flag,
    tax_id:          c.cedula_juridica || "",
  }));
}


// Activity feed: mezcla de notificaciones realistas
export const ACTIVITY_FEED_DEMO = [
  { id: "af-001", user_id: "u-001", kind: "expediente.pending_review",    title: "Nuevo expediente del Portal",       body: "Andes Retail Co. subió PO-ANDES-4156. 4 líneas, $30K USD.",        icon: "folder", severity: "INFO",     deep_link: "/expedientes/oc-001/exp/exp-1027",       related_type: "expediente", related_id: null, read_at: null,                        is_active: true, created_at: "2026-04-23T14:12:00Z" },
  { id: "af-002", user_id: "u-001", kind: "cobro.overdue",                title: "Cartera vencida · T2",              body: "Cafetera del Norte SAS 32 días vencida · $18,400 USD.",            icon: "dollar", severity: "WARN",     deep_link: "/cobros",                                 related_type: "cobro",      related_id: null, read_at: null,                        is_active: true, created_at: "2026-04-23T12:30:00Z" },
  { id: "af-003", user_id: "u-001", kind: "sap.confirmed",                title: "SAP confirmado · EXP-1023",         body: "Pampas Importaciones S.A. · 1240 pares RW-IND-STL.",              icon: "check",  severity: "SUCCESS",  deep_link: "/expedientes/oc-005/exp/exp-1023",       related_type: "expediente", related_id: null, read_at: "2026-04-23T10:00:00Z",      is_active: true, created_at: "2026-04-23T09:45:00Z" },
  { id: "af-004", user_id: "u-001", kind: "email.queued_failed",          title: "Email bounced · 3 destinatarios",   body: "Bounce rate 4.2% últimas 24h. Revisa DNS de mwt.one.",             icon: "mail",   severity: "CRITICAL", deep_link: "/notificaciones",                         related_type: "notification", related_id: null, read_at: null,                        is_active: true, created_at: "2026-04-23T08:20:00Z" },
  { id: "af-005", user_id: "u-001", kind: "portal.message",               title: "Mensaje del Portal · Andes Retail", body: "Consultan ETA actualizada para EXP-1027.",                         icon: "message",severity: "INFO",     deep_link: "/ai",                                     related_type: "message",    related_id: null, read_at: null,                        is_active: true, created_at: "2026-04-23T07:55:00Z" },
  { id: "af-006", user_id: "u-001", kind: "transferencia.arrived",        title: "Transfer arribada · Callao → Lima", body: "3 contenedores · 6,240 pares · Lunes 09:00.",                      icon: "truck",  severity: "SUCCESS",  deep_link: "/transferencias",                         related_type: "transfer",   related_id: null, read_at: "2026-04-22T18:00:00Z",      is_active: true, created_at: "2026-04-22T17:45:00Z" },
  { id: "af-007", user_id: "u-001", kind: "user.login_anomaly",           title: "Login anómalo · IP Colombia",       body: "viewer@mwt.one inició sesión desde Bogotá (usualmente Lima).",     icon: "shield", severity: "WARN",     deep_link: "/usuarios",                               related_type: "user",       related_id: "u-006", read_at: null,                is_active: true, created_at: "2026-04-22T15:10:00Z" },
  { id: "af-008", user_id: "u-001", kind: "pricing.drift",                title: "Drift de pricing · Rana Walk",      body: "12 SKUs con desviación ≥3% vs pricing interno.",                   icon: "chart",  severity: "WARN",     deep_link: "/marcas",                                 related_type: "brand",      related_id: null, read_at: "2026-04-22T11:00:00Z",      is_active: true, created_at: "2026-04-22T10:30:00Z" },
  { id: "af-009", user_id: "u-001", kind: "backup.completed",             title: "Backup nocturno OK",                body: "Postgres dump + MinIO snapshot completados (1.4 GB).",             icon: "save",   severity: "INFO",     deep_link: null,                                      related_type: null,         related_id: null, read_at: "2026-04-22T06:10:00Z",      is_active: true, created_at: "2026-04-22T03:00:00Z" },
  { id: "af-010", user_id: "u-001", kind: "ai.governance.publish",        title: "Instrucción IA publicada",          body: "\"Respetar idempotence_token\" ahora auto_inject=ON.",              icon: "bot",    severity: "INFO",     deep_link: "/ai/governance",                          related_type: "ai_instruction", related_id: null, read_at: "2026-04-21T09:00:00Z", is_active: true, created_at: "2026-04-21T08:40:00Z" },
  { id: "af-011", user_id: "u-001", kind: "expediente.delayed",           title: "Expediente demorado · EXP-1019",    body: "Factory delay de 5 días reportado por proveedor VN-02.",           icon: "alert",  severity: "CRITICAL", deep_link: "/expedientes/oc-003/exp/exp-1019",       related_type: "expediente", related_id: null, read_at: null,                        is_active: true, created_at: "2026-04-20T16:00:00Z" },
  { id: "af-012", user_id: "u-001", kind: "portal.new_client",            title: "Nuevo usuario invitado al Portal",  body: "rojas@atacama.cl aceptó la invitación y configuró su cuenta.",     icon: "user",   severity: "SUCCESS",  deep_link: "/usuarios",                               related_type: "user",       related_id: "u-008", read_at: "2026-04-20T09:30:00Z", is_active: true, created_at: "2026-04-20T09:15:00Z" },
];


// Matriz por rol — derivada algorítmicamente coherente con las
// reglas del seed SQL. El front recibe esto y renderiza los checkboxes.
export function roleMatrixMock(roleSlug) {
  const role = ROLES_DEMO.find((r) => r.slug === roleSlug);
  if (!role) return null;

  function cell(module) {
    const is_admin     = roleSlug === "superadmin" || roleSlug === "admin";
    const is_manager   = roleSlug === "manager";
    const is_operator  = roleSlug === "operator";
    const is_finance   = roleSlug === "finance";
    const is_compras   = roleSlug === "compras";
    const is_viewer    = roleSlug === "viewer";
    const is_client    = roleSlug === "client_b2b";

    const can_read =
      (is_client && ["portal","dashboard","expedientes","pipeline","pagos","ai-hub"].includes(module.slug)) ||
      (!is_client && module.categoria !== "B2B");

    const can_create =
      is_admin ||
      (is_manager  && module.categoria !== "CORE") ||
      (is_operator && module.categoria === "OPERACIONAL") ||
      (is_finance  && module.categoria === "FINANCIERO") ||
      (is_compras  && ["CATALOGOS","COMERCIAL"].includes(module.categoria));

    const can_update = can_create;
    const can_delete = is_admin;

    return {
      module:       module.slug,
      module_label: module.nombre,
      categoria:    module.categoria,
      can_create, can_read, can_update, can_delete,
    };
  }
  return {
    role,
    matrix: MODULES_DEMO.map(cell),
  };
}


// ─────────────────────────────────────────────────────────────────────
// Helpers para el interceptor
// ─────────────────────────────────────────────────────────────────────
export function usersListMock({ q = "", role, include_inactive = false } = {}) {
  let items = USERS_DEMO.slice();
  if (!include_inactive) items = items.filter((u) => u.is_active);
  if (role)              items = items.filter((u) => u.role_default === role);
  if (q) {
    const needle = q.toLowerCase();
    items = items.filter((u) =>
      (u.email_plain || "").toLowerCase().includes(needle) ||
      (u.full_name   || "").toLowerCase().includes(needle));
  }
  return items;
}

export function activityFeedListMock({ unread_only = false, limit = 50 } = {}) {
  let items = ACTIVITY_FEED_DEMO.filter((a) => a.is_active);
  if (unread_only === "true" || unread_only === true) {
    items = items.filter((a) => a.read_at === null);
  }
  return items.slice(0, limit);
}

export function activityFeedUnreadCountMock() {
  return {
    count: ACTIVITY_FEED_DEMO.filter((a) => a.is_active && a.read_at === null).length,
  };
}

export function userDetailMock(id) {
  return USERS_DEMO.find((u) => u.id === id) || null;
}

/** Usuario "actual" (para /me/profile/). En un deploy real lo resuelve el JWT. */
export const ME_PROFILE_MOCK = USERS_DEMO[0];  // Alejandro (superadmin)
