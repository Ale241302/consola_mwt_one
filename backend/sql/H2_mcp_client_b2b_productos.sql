-- =====================================================================
-- MWT.ONE · H2_mcp_client_b2b_productos.sql
-- Ola 3 · 3.0 — el rol client_b2b gana LECTURA de productos (catálogo,
-- precios de cliente, ficha técnica, NCM, búsqueda) para el MCP por cliente.
--
-- Hoy client_b2b no tiene `productos` en su matriz → el MCP no muestra
-- producto_listar/obtener/buscar/precio_cliente/ficha_tecnica. El objetivo
-- del CEO: un cliente conectado a su app MCP ve productos y precios (igual
-- que el portal), SOLO lectura, NUNCA create/update/delete ni docs.
--
-- Este archivo:
--   1. Upsert de la celda (client_b2b, productos) con can_read=true.
--   2. Re-sincroniza core.roles.permissions (users.sync_role_permissions_to_core()).
--
-- IDEMPOTENTE: UPDATE + SELECT sync.
-- =====================================================================

BEGIN;

-- 1. Asegurar que el módulo productos existe y está activo (defensivo).
INSERT INTO users.module_cat (slug, nombre, descripcion, icon, categoria, orden)
VALUES ('productos', 'Productos', 'Catálogo de SKUs y precios', 'box', 'COMERCIAL', 10)
ON CONFLICT (slug) DO UPDATE
    SET is_active = TRUE;

-- 2. client_b2b: productos SOLO lectura (can_read), todo lo demás false.
--    No toca otras celdas; si la celda no existe (caso limpio), la crea.
INSERT INTO users.role_permission
    (role_slug, module_slug, can_create, can_read, can_update, can_delete,
     can_upload_doc, can_download_doc, can_view_doc)
SELECT 'client_b2b', 'productos', FALSE, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE
WHERE NOT EXISTS (
    SELECT 1 FROM users.role_permission
    WHERE role_slug = 'client_b2b' AND module_slug = 'productos'
);

UPDATE users.role_permission
   SET can_read = TRUE,
       can_create = FALSE,
       can_update = FALSE,
       can_delete = FALSE,
       can_upload_doc = FALSE,
       can_download_doc = FALSE,
       can_view_doc = FALSE,
       updated_by_id = NULL
 WHERE role_slug = 'client_b2b' AND module_slug = 'productos';

-- 3. Re-sincronizar core.roles.permissions (misma fuente que el JWT del MCP).
SELECT users.sync_role_permissions_to_core();

COMMIT;
