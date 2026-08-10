-- =====================================================================
-- MWT.ONE · F5_mcp_charts_rbac.sql
-- Ola 3.10 · RBAC de las tools de visualización (charts server-side).
--
-- Las 4 tools MCP (generar_grafico, cashflow_chart, margen_marcas_chart,
-- dashboard_resumen) se registran en TOOL_MODULES como (analytics, view).
-- Para que el filtrado por rol del MCP (permissions_for_role_exact) y el
-- enforcement del backend (RoleBasedPermission) las permitan, el módulo
-- `analytics` debe existir en users.module_cat y tener filas de
-- users.role_permission con can_read=TRUE para los roles staff.
--
-- Decisión de diseño (Ola 3.10):
--   · superadmin/admin/manager/operator/finance/compras/viewer → analytics.view
--     (los charts son visualización ejecutiva interna).
--   · client_b2b → NO (el Portal B2B no expone charts internos).
--   · margen_marcas_chart además queda CEO-only en el backend
--     (_deny_unless_ceo_admin), independiente de esta matriz.
--
-- IDEMPOTENTE: INSERT ... ON CONFLICT DO NOTHING / DO UPDATE.
-- =====================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. Módulo `analytics` en el catálogo de módulos.
-- ────────────────────────────────────────────────────────────
INSERT INTO users.module_cat (slug, nombre, descripcion, icon, categoria, orden) VALUES
    ('analytics', 'Analytics', 'Dashboard analítico + charts server-side (Ola 3.10)',
     'chart-bar', 'DASHBOARD', 15)
ON CONFLICT (slug) DO UPDATE
    SET nombre      = EXCLUDED.nombre,
        descripcion = EXCLUDED.descripcion,
        icon        = EXCLUDED.icon,
        categoria   = EXCLUDED.categoria,
        orden       = EXCLUDED.orden,
        is_active   = TRUE;

-- ────────────────────────────────────────────────────────────
-- 2. role_permission: solo lectura (can_read) para roles staff.
--    ON CONFLICT no toca filas ya existentes (respeto al CEO).
-- ────────────────────────────────────────────────────────────
INSERT INTO users.role_permission
    (role_slug, module_slug, can_create, can_read, can_update, can_delete,
     can_upload_doc, can_download_doc, can_view_doc)
SELECT r.slug, m.slug,
    FALSE,
    CASE WHEN r.slug = 'client_b2b' THEN FALSE ELSE TRUE END,  -- solo staff
    FALSE, FALSE, FALSE, FALSE, FALSE
FROM users.role_cat r
CROSS JOIN users.module_cat m
WHERE r.is_active = TRUE AND m.is_active = TRUE
  AND m.slug = 'analytics'
  AND r.slug IN ('superadmin','admin','manager','operator','finance',
                 'compras','viewer')
ON CONFLICT (role_slug, module_slug) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 3. Re-sincronizar core.roles.permissions (idempotente).
-- ────────────────────────────────────────────────────────────
SELECT users.sync_role_permissions_to_core();

COMMIT;
