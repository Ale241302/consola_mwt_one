-- =====================================================================
-- MWT.ONE · A6_unify_rbac.sql
-- Ola 1 — F4: Unificación de RBAC.
--
-- Fuente de verdad para enforcement: core.roles.permissions.
-- Fuente editable por UI: users.role_permission.
--
-- Este script:
--   1. Asegura que core.roles tenga un row por cada users.role_cat.
--   2. Crea función users.sync_role_permissions_to_core() que materializa
--      la matriz CRUD en core.roles.permissions.
--   3. Crea trigger para mantener sincronización automática.
--   4. Hace un backfill inicial.
-- =====================================================================

-- Asegurar que todo rol canónico tenga su contraparte en core.roles.
INSERT INTO core.roles (slug, name, description, permissions, is_system)
SELECT rc.slug,
       rc.nombre,
       COALESCE(rc.descripcion, 'Rol ' || rc.slug),
       '{}'::jsonb,
       rc.is_system
FROM users.role_cat rc
ON CONFLICT (slug) DO UPDATE
    SET name        = EXCLUDED.name,
        description = EXCLUDED.description,
        is_system   = EXCLUDED.is_system;

-- Función que convierte users.role_permission a core.roles.permissions.
CREATE OR REPLACE FUNCTION users.sync_role_permissions_to_core()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE core.roles r
       SET permissions = sub.perms,
           updated_at  = NOW()
      FROM (
        SELECT
            rp.role_slug,
            jsonb_build_object(
                'modules', (
                    SELECT array_agg(DISTINCT rp2.module_slug)
                      FROM users.role_permission rp2
                     WHERE rp2.role_slug = rp.role_slug
                       AND (rp2.can_create OR rp2.can_read OR rp2.can_update OR rp2.can_delete
                            OR rp2.can_upload_doc OR rp2.can_download_doc OR rp2.can_view_doc)
                ),
                'actions', (
                    SELECT array_agg(DISTINCT act) FILTER (WHERE act IS NOT NULL)
                      FROM (
                        SELECT CASE WHEN rp2.can_create THEN rp2.module_slug || '.create' END AS act
                          FROM users.role_permission rp2 WHERE rp2.role_slug = rp.role_slug
                        UNION ALL
                        SELECT CASE WHEN rp2.can_read   THEN rp2.module_slug || '.view'   END
                          FROM users.role_permission rp2 WHERE rp2.role_slug = rp.role_slug
                        UNION ALL
                        SELECT CASE WHEN rp2.can_update THEN rp2.module_slug || '.update' END
                          FROM users.role_permission rp2 WHERE rp2.role_slug = rp.role_slug
                        UNION ALL
                        SELECT CASE WHEN rp2.can_delete THEN rp2.module_slug || '.delete' END
                          FROM users.role_permission rp2 WHERE rp2.role_slug = rp.role_slug
                        UNION ALL
                        SELECT CASE WHEN rp2.can_upload_doc   THEN rp2.module_slug || '.upload_doc'   END
                          FROM users.role_permission rp2 WHERE rp2.role_slug = rp.role_slug
                        UNION ALL
                        SELECT CASE WHEN rp2.can_download_doc THEN rp2.module_slug || '.download_doc' END
                          FROM users.role_permission rp2 WHERE rp2.role_slug = rp.role_slug
                        UNION ALL
                        SELECT CASE WHEN rp2.can_view_doc     THEN rp2.module_slug || '.view_doc'     END
                          FROM users.role_permission rp2 WHERE rp2.role_slug = rp.role_slug
                      ) actions
                )
            ) AS perms
        FROM users.role_permission rp
        GROUP BY rp.role_slug
      ) sub
     WHERE r.slug = sub.role_slug;
END;
$$;

-- Trigger para mantener sincronización al modificar users.role_permission.
CREATE OR REPLACE FUNCTION users.tg_role_permission_sync_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM users.sync_role_permissions_to_core();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_role_permission_sync ON users.role_permission;
CREATE TRIGGER tg_role_permission_sync
    AFTER INSERT OR UPDATE OR DELETE ON users.role_permission
    EXECUTE FUNCTION users.tg_role_permission_sync_fn();

-- Backfill inicial: sincroniza todo ahora.
SELECT users.sync_role_permissions_to_core();
