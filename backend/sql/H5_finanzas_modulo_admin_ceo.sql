-- =====================================================================
-- MWT.ONE · H5_finanzas_modulo_admin_ceo.sql
-- 2026-08-23 — módulo `finanzas` para las tools MCP de KPIs/comisiones/
-- margen/devengo (finanzas_overview, finanzas_comisiones,
-- finanzas_commission_by_month, finanzas_margin_scatter, finanzas_cliente).
--
-- Las tools `finanzas_*` del MCP se filtran por el módulo `finanzas` en
-- tool_rbac.py. Sin este módulo en la matriz, admin/superadmin NO verían
-- las tools en el listado RBAC (aunque el backend valida IsCeoOrAdmin).
--
-- Alcance de la decisión del CEO:
--   · Módulo `finanzas` SOLO para operadores MWT (admin/superadmin):
--     can_read=true (son KPIs internos de comisión/margen).
--   · client_b2b NO recibe este módulo.
--   · El backend además exige IsCeoOrAdmin (doble capa).
--
-- Este archivo:
--   1. Asegura el módulo `finanzas` en users.module_cat (defensivo).
--   2. Upsert de las celdas (admin|superadmin, finanzas) con can_read=true.
--   3. Re-sincroniza core.roles.permissions (misma fuente que el JWT del MCP).
--
-- IDEMPOTENTE: INSERT ... WHERE NOT EXISTS + UPDATE + SELECT sync.
-- Backward-compatible: solo añade celdas de permiso; no toca esquema.
-- =====================================================================

BEGIN;

-- 1. Asegurar que el módulo `finanzas` existe y está activo (defensivo).
INSERT INTO users.module_cat (slug, nombre, descripcion, icon, categoria, orden)
VALUES ('finanzas', 'Finanzas', 'KPIs financieros: comisiones, margen, devengo (MCP + consola)', 'dollar-sign', 'FINANCIERO', 40)
ON CONFLICT (slug) DO UPDATE
    SET is_active = TRUE;

-- 2. admin + superadmin: SOLO lectura sobre el módulo finanzas.
INSERT INTO users.role_permission
    (role_slug, module_slug, can_create, can_read, can_update, can_delete,
     can_upload_doc, can_download_doc)
SELECT rp.role_slug, 'finanzas', FALSE, TRUE, FALSE, FALSE, FALSE, FALSE
FROM (VALUES ('admin'), ('superadmin')) AS rp(role_slug)
WHERE NOT EXISTS (
    SELECT 1 FROM users.role_permission
    WHERE role_slug = rp.role_slug AND module_slug = 'finanzas'
);

UPDATE users.role_permission
   SET can_create = FALSE,
       can_read = TRUE,
       can_update = FALSE,
       can_delete = FALSE,
       can_upload_doc = FALSE,
       can_download_doc = FALSE,
       updated_by_id = NULL
 WHERE module_slug = 'finanzas'
   AND role_slug IN ('admin', 'superadmin');

-- 3. Re-sincronizar core.roles.permissions (misma fuente que el JWT del MCP).
SELECT users.sync_role_permissions_to_core();

COMMIT;
