-- =====================================================================
-- A5 · Rediseño RBAC alineado al sidebar (Sprint 2026-05-21)
--
-- Cambios introducidos:
--   1. role_permission gana 3 columnas booleanas para gestión documental:
--      can_upload_doc, can_download_doc, can_view_doc.
--   2. module_cat se purga: eliminamos módulos obsoletos que ya no
--      aparecen en el sidebar (ai-hub, ai-governance, storage, plantillas,
--      financiero, cobros, pagos, pipeline, sizing, pricing, proveedores).
--   3. module_cat se completa con los módulos que faltaban del sidebar:
--      historial-precios, cartera, tickets.
--   4. Re-categorización para que las secciones del sidebar coincidan
--      con `categoria`: CORE, COMERCIAL, ALMACEN, COMUNICACIONES, SOPORTE,
--      ADMINISTRACION.
--   5. Re-orden para que la matriz aparezca en el mismo orden que el menú.
--   6. Seed inicial de los 3 nuevos flags por rol (superadmin/admin =
--      todo; manager/operator/finance = consume operativo según rol;
--      compras = ver/descargar; viewer = ver/descargar; client_b2b =
--      ver descargas del portal).
--
-- IDEMPOTENTE: las ALTER usan IF NOT EXISTS, los INSERT usan ON CONFLICT
-- DO UPDATE, y los DELETE usan WHERE module_slug IN (...). Es seguro
-- correr este archivo múltiples veces.
-- =====================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. Nuevas columnas para gestión documental
-- ────────────────────────────────────────────────────────────
ALTER TABLE users.role_permission
    ADD COLUMN IF NOT EXISTS can_upload_doc   BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS can_download_doc BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS can_view_doc     BOOLEAN NOT NULL DEFAULT FALSE;

-- ────────────────────────────────────────────────────────────
-- 2. Purgar módulos obsoletos (ya no aparecen en el sidebar)
--    Primero borramos los rows de role_permission (no hay FK física,
--    pero queremos consistencia) y luego del catálogo.
-- ────────────────────────────────────────────────────────────
DELETE FROM users.role_permission
 WHERE module_slug IN (
   'ai-hub', 'ai-governance', 'storage', 'plantillas',
   'financiero', 'cobros', 'pagos',
   'pipeline', 'sizing', 'pricing', 'proveedores'
 );

DELETE FROM users.module_cat
 WHERE slug IN (
   'ai-hub', 'ai-governance', 'storage', 'plantillas',
   'financiero', 'cobros', 'pagos',
   'pipeline', 'sizing', 'pricing', 'proveedores'
 );

-- ────────────────────────────────────────────────────────────
-- 3. Re-categorizar + reordenar módulos vigentes para alinear
--    con el sidebar real.
-- ────────────────────────────────────────────────────────────
UPDATE users.module_cat SET categoria='CORE',           orden=10  WHERE slug='dashboard';
UPDATE users.module_cat SET categoria='CORE',           orden=20  WHERE slug='expedientes';
UPDATE users.module_cat SET categoria='CORE',           orden=30, nombre='Portal' WHERE slug='portal';

UPDATE users.module_cat SET categoria='COMERCIAL',      orden=40  WHERE slug='clientes';
UPDATE users.module_cat SET categoria='COMERCIAL',      orden=50  WHERE slug='marcas';
UPDATE users.module_cat SET categoria='COMERCIAL',      orden=60  WHERE slug='productos';

UPDATE users.module_cat SET categoria='ALMACEN',        orden=80  WHERE slug='transferencias';
UPDATE users.module_cat SET categoria='ALMACEN',        orden=90  WHERE slug='nodos';
UPDATE users.module_cat SET categoria='ALMACEN',        orden=100 WHERE slug='inventario';

UPDATE users.module_cat SET categoria='COMUNICACIONES', orden=110 WHERE slug='notificaciones';

UPDATE users.module_cat SET categoria='ADMINISTRACION', orden=200 WHERE slug='usuarios';
UPDATE users.module_cat SET categoria='ADMINISTRACION', orden=210 WHERE slug='roles';

-- ────────────────────────────────────────────────────────────
-- 4. Insertar módulos nuevos del sidebar
-- ────────────────────────────────────────────────────────────
INSERT INTO users.module_cat (slug, nombre, descripcion, icon, categoria, orden) VALUES
    ('historial-precios', 'Historial de precios', 'Histórico de precios por cliente/producto', 'clock', 'COMERCIAL',     70),
    ('cartera',           'Cartera',              'Estado de cartera + cobranza',              'wallet', 'COMUNICACIONES', 120),
    ('tickets',           'Tickets',              'Soporte interno',                            'inbox',  'SOPORTE',       150)
ON CONFLICT (slug) DO UPDATE
    SET nombre      = EXCLUDED.nombre,
        descripcion = EXCLUDED.descripcion,
        icon        = EXCLUDED.icon,
        categoria   = EXCLUDED.categoria,
        orden       = EXCLUDED.orden,
        is_active   = TRUE;

-- ────────────────────────────────────────────────────────────
-- 5. Seed de role_permission para módulos que recién agregamos.
--    Mantiene el patrón de A4 (superadmin/admin full, manager/operator
--    según categoría, etc.). ON CONFLICT no toca filas existentes.
-- ────────────────────────────────────────────────────────────
INSERT INTO users.role_permission
    (role_slug, module_slug, can_create, can_read, can_update, can_delete,
     can_upload_doc, can_download_doc, can_view_doc)
SELECT r.slug, m.slug,
    CASE WHEN r.slug IN ('superadmin','admin') THEN TRUE
         WHEN r.slug='manager' AND m.categoria NOT IN ('ADMINISTRACION') THEN TRUE
         WHEN r.slug='operator' AND m.categoria IN ('ALMACEN','CORE') THEN TRUE
         WHEN r.slug='compras' AND m.categoria IN ('COMERCIAL') THEN TRUE
         ELSE FALSE END,
    CASE WHEN r.slug='client_b2b' AND m.slug IN ('portal','dashboard','expedientes','cartera') THEN TRUE
         WHEN r.slug NOT IN ('client_b2b') AND m.categoria NOT IN ('B2B') THEN TRUE
         ELSE FALSE END,
    CASE WHEN r.slug IN ('superadmin','admin') THEN TRUE
         WHEN r.slug='manager' AND m.categoria NOT IN ('ADMINISTRACION') THEN TRUE
         WHEN r.slug='operator' AND m.categoria IN ('ALMACEN','CORE') THEN TRUE
         WHEN r.slug='compras' AND m.categoria IN ('COMERCIAL') THEN TRUE
         ELSE FALSE END,
    CASE WHEN r.slug IN ('superadmin','admin') THEN TRUE ELSE FALSE END,
    CASE WHEN r.slug IN ('superadmin','admin') THEN TRUE
         WHEN r.slug='manager' AND m.categoria NOT IN ('ADMINISTRACION') THEN TRUE
         WHEN r.slug='operator' AND m.categoria IN ('ALMACEN','CORE') THEN TRUE
         ELSE FALSE END,
    CASE WHEN r.slug IN ('superadmin','admin','manager','operator','compras','viewer') THEN TRUE
         WHEN r.slug='client_b2b' AND m.slug IN ('portal','expedientes','cartera') THEN TRUE
         ELSE FALSE END,
    CASE WHEN r.slug IN ('superadmin','admin','manager','operator','compras','viewer','finance') THEN TRUE
         WHEN r.slug='client_b2b' AND m.slug IN ('portal','expedientes','cartera') THEN TRUE
         ELSE FALSE END
FROM users.role_cat r
CROSS JOIN users.module_cat m
WHERE r.is_active = TRUE AND m.is_active = TRUE
ON CONFLICT (role_slug, module_slug) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 6. Backfill de can_view_doc / can_download_doc en filas YA existentes
--    (ON CONFLICT del paso 5 no las toca). Damos defaults conservadores:
--      · superadmin / admin → todo TRUE
--      · viewer → solo ver/descargar (no subir)
--      · resto → según rol y categoría
-- ────────────────────────────────────────────────────────────
UPDATE users.role_permission rp
   SET can_view_doc     = CASE WHEN rp.role_slug IN ('superadmin','admin') THEN TRUE
                                WHEN rp.can_read THEN TRUE
                                ELSE FALSE END,
       can_download_doc = CASE WHEN rp.role_slug IN ('superadmin','admin') THEN TRUE
                                WHEN rp.can_read THEN TRUE
                                ELSE FALSE END,
       can_upload_doc   = CASE WHEN rp.role_slug IN ('superadmin','admin','manager') THEN TRUE
                                WHEN rp.can_update THEN TRUE
                                ELSE FALSE END
 WHERE rp.can_view_doc = FALSE
   AND rp.can_download_doc = FALSE
   AND rp.can_upload_doc = FALSE;

COMMIT;
