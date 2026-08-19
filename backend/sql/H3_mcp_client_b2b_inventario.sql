-- =====================================================================
-- MWT.ONE · H3_mcp_client_b2b_inventario.sql
-- 2026-08-19 — el rol client_b2b gana LECTURA de inventario (artefactos
-- de envío del Builder: AWB/BL, Packing List, Factura Comercial, Certificado
-- de Origen) para el MCP por cliente.
--
-- Antes client_b2b NO tenía `inventario` en su matriz → el endpoint
-- /api/inventario/expedientes/{id}/artifacts/ devolvía 403 y el cliente no
-- podía ver/descargar sus documentos de embarque (packing list, BL, etc.).
-- Objetivo del CEO: un cliente conectado a su app MCP ve los artefactos
-- PUBLICADOS de su expediente (el filtro `publicado=True` lo aplica el MCP),
-- SOLO lectura, NUNCA create/update/delete ni asignaciones.
--
-- Este archivo:
--   1. Asegura el módulo inventario (defensivo).
--   2. Upsert de la celda (client_b2b, inventario) con can_read=true.
--   3. Re-sincroniza core.roles.permissions (misma fuente que el JWT del MCP).
--
-- IDEMPOTENTE: INSERT ... WHERE NOT EXISTS + UPDATE + SELECT sync.
-- Backward-compatible: solo añade una celda de permiso; no toca esquema.
-- =====================================================================

BEGIN;

-- 1. Asegurar que el módulo inventario existe y está activo (defensivo).
INSERT INTO users.module_cat (slug, nombre, descripcion, icon, categoria, orden)
VALUES ('inventario', 'Inventario', 'Asignación de stock y artefactos de envío', 'archive', 'ALMACEN', 30)
ON CONFLICT (slug) DO UPDATE
    SET is_active = TRUE;

-- 2. client_b2b: inventario SOLO lectura (can_read + can_download_doc).
--    Un cliente ve artefactos publicados y descarga el documento real
--    (PDF/HTML del packing list, BL, certificado). NUNCA create/update/
--    delete ni upload.
INSERT INTO users.role_permission
    (role_slug, module_slug, can_create, can_read, can_update, can_delete,
     can_upload_doc, can_download_doc, can_view_doc)
SELECT 'client_b2b', 'inventario', FALSE, TRUE, FALSE, FALSE, FALSE, TRUE, TRUE
WHERE NOT EXISTS (
    SELECT 1 FROM users.role_permission
    WHERE role_slug = 'client_b2b' AND module_slug = 'inventario'
);

UPDATE users.role_permission
   SET can_read = TRUE,
       can_create = FALSE,
       can_update = FALSE,
       can_delete = FALSE,
       can_upload_doc = FALSE,
       can_download_doc = TRUE,
       can_view_doc = TRUE,
       updated_by_id = NULL
 WHERE role_slug = 'client_b2b' AND module_slug = 'inventario';

-- 3. Re-sincronizar core.roles.permissions (misma fuente que el JWT del MCP).
SELECT users.sync_role_permissions_to_core();

COMMIT;
