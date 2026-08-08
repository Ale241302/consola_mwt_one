-- =====================================================================
-- MWT.ONE · A7_mcp_tools_rbac.sql
-- Ola 2 · RBAC del MCP por rol del usuario conectado.
--
-- El filtrado de tools del MCP (mcp_server/mwt_mcp/tool_rbac.py) mapea cada
-- herramienta a un (módulo, acción) de `core.roles.permissions`. Para que el
-- CEO controle desde /roles QUÉ tools ve cada usuario, los módulos que el MCP
-- usa DEBEN existir en users.module_cat y tener filas en users.role_permission.
--
-- A5 purgó de module_cat los módulos que no estaban en el sidebar (pagos,
-- storage, sizing). El MCP los necesita. Este archivo:
--   1. Reinserta los módulos MCP faltantes (pagos, storage, sizing).
--   2. Crea filas de role_permission por rol (baseline conservador; el CEO
--      los afina desde /roles).
--   3. Re-sincroniza core.roles.permissions (el trigger ya lo hace por fila;
--      el sync final es por robustez e idempotencia).
--
-- IDEMPOTENTE: INSERT ... ON CONFLICT DO NOTHING / DO UPDATE.
-- =====================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. Módulos que el MCP expone y que A5 purgó del catálogo.
-- ────────────────────────────────────────────────────────────
INSERT INTO users.module_cat (slug, nombre, descripcion, icon, categoria, orden) VALUES
    ('pagos',   'Pagos',         'Pagos + conciliación financiera',       'dollar',     'FINANCIERO',   130),
    ('storage', 'Storage',       'MinIO + archivos y descargas',          'hard-drive', 'ALMACEN',      105),
    ('sizing',  'Motor de Tallas','Plantillas de tallas por categoría',    'ruler',      'CATALOGOS',     65)
ON CONFLICT (slug) DO UPDATE
    SET nombre      = EXCLUDED.nombre,
        descripcion = EXCLUDED.descripcion,
        icon        = EXCLUDED.icon,
        categoria   = EXCLUDED.categoria,
        orden       = EXCLUDED.orden,
        is_active   = TRUE;

-- ────────────────────────────────────────────────────────────
-- 2. Seed de role_permission para los módulos MCP reinsertados.
--    Baseline conservador (el CEO lo afina desde la UI /roles):
--      · superadmin/admin  → full (create/read/update/delete + docs)
--      · manager           → create/read/update + docs (sin delete)
--      · finance           → create/read/update en pagos, read en storage/sizing
--      · operator          → create/read/update en storage (sube archivos),
--                            read en pagos/sizing
--      · compras           → create/read/update en sizing, read en pagos/storage
--      · viewer            → read + docs
--      · client_b2b        → read + ver/descargar docs en pagos y storage
-- ON CONFLICT no toca filas ya existentes (el CEO ya las configuró).
-- ────────────────────────────────────────────────────────────
INSERT INTO users.role_permission
    (role_slug, module_slug, can_create, can_read, can_update, can_delete,
     can_upload_doc, can_download_doc, can_view_doc)
SELECT r.slug, m.slug,
    CASE
        WHEN r.slug IN ('superadmin','admin') THEN TRUE
        WHEN r.slug='manager'                  THEN TRUE
        WHEN r.slug='finance'   AND m.slug IN ('pagos')           THEN TRUE
        WHEN r.slug='operator'  AND m.slug IN ('storage')         THEN TRUE
        WHEN r.slug='compras'   AND m.slug IN ('sizing')          THEN TRUE
        ELSE FALSE END,
    CASE
        WHEN r.slug='client_b2b' AND m.slug IN ('pagos','storage','sizing') THEN TRUE
        WHEN r.slug NOT IN ('client_b2b') THEN TRUE
        ELSE FALSE END,
    CASE
        WHEN r.slug IN ('superadmin','admin') THEN TRUE
        WHEN r.slug='manager'                  THEN TRUE
        WHEN r.slug='finance'   AND m.slug IN ('pagos')           THEN TRUE
        WHEN r.slug='operator'  AND m.slug IN ('storage')         THEN TRUE
        WHEN r.slug='compras'   AND m.slug IN ('sizing')          THEN TRUE
        ELSE FALSE END,
    CASE
        WHEN r.slug IN ('superadmin','admin') THEN TRUE
        ELSE FALSE END,
    CASE
        WHEN r.slug IN ('superadmin','admin') THEN TRUE
        WHEN r.slug='manager'                  THEN TRUE
        WHEN r.slug='operator'  AND m.slug IN ('storage')         THEN TRUE
        WHEN r.slug='compras'   AND m.slug IN ('sizing')          THEN TRUE
        ELSE FALSE END,
    CASE
        WHEN r.slug='client_b2b' AND m.slug IN ('pagos','storage') THEN TRUE
        WHEN r.slug NOT IN ('client_b2b') THEN TRUE
        ELSE FALSE END,
    CASE
        WHEN r.slug='client_b2b' AND m.slug IN ('pagos','storage') THEN TRUE
        WHEN r.slug NOT IN ('client_b2b') THEN TRUE
        ELSE FALSE END
FROM users.role_cat r
CROSS JOIN users.module_cat m
WHERE r.is_active = TRUE AND m.is_active = TRUE
  AND m.slug IN ('pagos','storage','sizing')
ON CONFLICT (role_slug, module_slug) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 3. Re-sincronizar core.roles.permissions (idempotente).
--    El trigger tg_role_permission_sync ya lo hace por fila; esto garantiza
--    consistencia incluso si el trigger no existiera.
-- ────────────────────────────────────────────────────────────
SELECT users.sync_role_permissions_to_core();

COMMIT;
