-- =====================================================================
-- MWT.ONE · H4_builder_modulo_admin_ceo.sql
-- 2026-08-20 — módulo `builder` para las tools MCP del Builder externo
-- (builder.muito.work): plantillas de artefactos (secciones, columnas,
-- tipos de campo, opciones).
--
-- Las tools `builder_*` del MCP (builder_structure_construir,
-- builder_artefacto_listar/obtener/crear/editar/eliminar) se filtran por
-- el módulo `builder` en tool_rbac.py. Sin este módulo en la matriz, los
-- roles admin/superadmin (y cualquier rol que quiera gobernar plantillas)
-- NO verían las tools en el listado RBAC.
--
-- Alcance de la decisión del CEO:
--   · Módulo `builder` SOLO para operadores MWT (admin/superadmin):
--     create/read/update/delete completos (son los que diseñan plantillas).
--   · client_b2b NO recibe este módulo (un cliente no crea plantillas).
--   · Backend valida igualmente; fail-closed si el rol no lo tiene.
--
-- Este archivo:
--   1. Asegura el módulo `builder` en users.module_cat (defensivo).
--   2. Upsert de las celdas (admin|superadmin, builder) con CRUD completo.
--   3. Re-sincroniza core.roles.permissions (misma fuente que el JWT del MCP).
--
-- IDEMPOTENTE: INSERT ... WHERE NOT EXISTS + UPDATE + SELECT sync.
-- Backward-compatible: solo añade celdas de permiso; no toca esquema.
-- =====================================================================

BEGIN;

-- 1. Asegurar que el módulo `builder` existe y está activo (defensivo).
INSERT INTO users.module_cat (slug, nombre, descripcion, icon, categoria, orden)
VALUES ('builder', 'MWT Builder', 'Plantillas de artefactos (builder.muito.work): secciones, columnas, campos', 'layout-grid', 'CORE', 95)
ON CONFLICT (slug) DO UPDATE
    SET is_active = TRUE;

-- 2. admin + superadmin: CRUD completo sobre el módulo builder.
INSERT INTO users.role_permission
    (role_slug, module_slug, can_create, can_read, can_update, can_delete,
     can_upload_doc, can_download_doc)
SELECT rp.role_slug, 'builder', TRUE, TRUE, TRUE, TRUE, FALSE, FALSE
FROM (VALUES ('admin'), ('superadmin')) AS rp(role_slug)
WHERE NOT EXISTS (
    SELECT 1 FROM users.role_permission
    WHERE role_slug = rp.role_slug AND module_slug = 'builder'
);

UPDATE users.role_permission
   SET can_create = TRUE,
       can_read = TRUE,
       can_update = TRUE,
       can_delete = TRUE,
       can_upload_doc = FALSE,
       can_download_doc = FALSE,
       updated_by_id = NULL
 WHERE module_slug = 'builder'
   AND role_slug IN ('admin', 'superadmin');

-- 3. Re-sincronizar core.roles.permissions (misma fuente que el JWT del MCP).
SELECT users.sync_role_permissions_to_core();

COMMIT;
