-- =====================================================================
-- K8 · Etapa 2 - Módulo RBAC `tareas` (catálogo + agenda + mesa de trabajo)
-- Registra el módulo y otorga permisos. Idempotente. Re-sincroniza core.
-- =====================================================================
BEGIN;

-- 1. Módulo en el catálogo (defensivo).
INSERT INTO users.module_cat (slug, nombre, descripcion, icon, categoria, orden)
VALUES ('tareas', 'Tareas', 'Catálogo, agenda por expediente y mesa de trabajo.',
        'check-square', 'OPERACIONAL', 45)
ON CONFLICT (slug) DO UPDATE SET is_active = TRUE, nombre = EXCLUDED.nombre;

-- 2. admin + superadmin: CRUD completo.
INSERT INTO users.role_permission
    (role_slug, module_slug, can_create, can_read, can_update, can_delete,
     can_upload_doc, can_download_doc)
SELECT rp.role_slug, 'tareas', TRUE, TRUE, TRUE, TRUE, FALSE, FALSE
FROM (VALUES ('admin'), ('superadmin')) AS rp(role_slug)
WHERE NOT EXISTS (
    SELECT 1 FROM users.role_permission
    WHERE role_slug = rp.role_slug AND module_slug = 'tareas'
);

UPDATE users.role_permission
   SET can_create = TRUE, can_read = TRUE, can_update = TRUE, can_delete = TRUE,
       updated_at = NOW()
 WHERE module_slug = 'tareas' AND role_slug IN ('admin', 'superadmin');

-- 3. manager + operator: crear/leer/actualizar (sin borrar).
INSERT INTO users.role_permission
    (role_slug, module_slug, can_create, can_read, can_update, can_delete,
     can_upload_doc, can_download_doc)
SELECT rp.role_slug, 'tareas', TRUE, TRUE, TRUE, FALSE, FALSE, FALSE
FROM (VALUES ('manager'), ('operator')) AS rp(role_slug)
WHERE NOT EXISTS (
    SELECT 1 FROM users.role_permission
    WHERE role_slug = rp.role_slug AND module_slug = 'tareas'
);

UPDATE users.role_permission
   SET can_create = TRUE, can_read = TRUE, can_update = TRUE, can_delete = FALSE,
       updated_at = NOW()
 WHERE module_slug = 'tareas' AND role_slug IN ('manager', 'operator');

-- 4. finance + viewer: solo lectura.
INSERT INTO users.role_permission
    (role_slug, module_slug, can_create, can_read, can_update, can_delete,
     can_upload_doc, can_download_doc)
SELECT rp.role_slug, 'tareas', FALSE, TRUE, FALSE, FALSE, FALSE, FALSE
FROM (VALUES ('finance'), ('viewer')) AS rp(role_slug)
WHERE NOT EXISTS (
    SELECT 1 FROM users.role_permission
    WHERE role_slug = rp.role_slug AND module_slug = 'tareas'
);

UPDATE users.role_permission
   SET can_create = FALSE, can_read = TRUE, can_update = FALSE, can_delete = FALSE,
       updated_at = NOW()
 WHERE module_slug = 'tareas' AND role_slug IN ('finance', 'viewer');

-- 5. Materializar en core (fuente del JWT/MCP).
SELECT users.sync_role_permissions_to_core();

COMMIT;
