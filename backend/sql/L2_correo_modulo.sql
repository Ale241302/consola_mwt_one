-- =====================================================================
-- L2 · Etapa 3 - Módulo RBAC `correo` (bandeja, contactos, editor, envío)
-- Idempotente. Re-sincroniza core.
-- =====================================================================
BEGIN;

INSERT INTO users.module_cat (slug, nombre, descripcion, icon, categoria, orden)
VALUES ('correo', 'Correo', 'Bandeja, contactos, editor y envío de correo operativo.',
        'mail', 'COMUNICACIONES', 60)
ON CONFLICT (slug) DO UPDATE SET is_active = TRUE, nombre = EXCLUDED.nombre;

-- admin + superadmin: CRUD.
INSERT INTO users.role_permission
    (role_slug, module_slug, can_create, can_read, can_update, can_delete,
     can_upload_doc, can_download_doc)
SELECT rp.role_slug, 'correo', TRUE, TRUE, TRUE, TRUE, TRUE, TRUE
FROM (VALUES ('admin'), ('superadmin')) AS rp(role_slug)
WHERE NOT EXISTS (SELECT 1 FROM users.role_permission
                  WHERE role_slug = rp.role_slug AND module_slug = 'correo');
UPDATE users.role_permission
   SET can_create = TRUE, can_read = TRUE, can_update = TRUE, can_delete = TRUE,
       can_upload_doc = TRUE, can_download_doc = TRUE, updated_at = NOW()
 WHERE module_slug = 'correo' AND role_slug IN ('admin', 'superadmin');

-- manager + operator: crear/leer/actualizar (sin borrar).
INSERT INTO users.role_permission
    (role_slug, module_slug, can_create, can_read, can_update, can_delete,
     can_upload_doc, can_download_doc)
SELECT rp.role_slug, 'correo', TRUE, TRUE, TRUE, FALSE, TRUE, TRUE
FROM (VALUES ('manager'), ('operator')) AS rp(role_slug)
WHERE NOT EXISTS (SELECT 1 FROM users.role_permission
                  WHERE role_slug = rp.role_slug AND module_slug = 'correo');
UPDATE users.role_permission
   SET can_create = TRUE, can_read = TRUE, can_update = TRUE, can_delete = FALSE,
       can_upload_doc = TRUE, can_download_doc = TRUE, updated_at = NOW()
 WHERE module_slug = 'correo' AND role_slug IN ('manager', 'operator');

-- finance + viewer: solo lectura.
INSERT INTO users.role_permission
    (role_slug, module_slug, can_create, can_read, can_update, can_delete,
     can_upload_doc, can_download_doc)
SELECT rp.role_slug, 'correo', FALSE, TRUE, FALSE, FALSE, FALSE, TRUE
FROM (VALUES ('finance'), ('viewer')) AS rp(role_slug)
WHERE NOT EXISTS (SELECT 1 FROM users.role_permission
                  WHERE role_slug = rp.role_slug AND module_slug = 'correo');
UPDATE users.role_permission
   SET can_create = FALSE, can_read = TRUE, can_update = FALSE, can_delete = FALSE,
       can_upload_doc = FALSE, can_download_doc = TRUE, updated_at = NOW()
 WHERE module_slug = 'correo' AND role_slug IN ('finance', 'viewer');

SELECT users.sync_role_permissions_to_core();

COMMIT;
