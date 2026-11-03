-- =====================================================================
-- M5 · roles: sincronizar la matriz de /roles como UPSERT en core.roles
-- =====================================================================
-- Contexto (2026-11-03)
--
-- `users.sync_role_permissions_to_core()` sólo hacía UPDATE sobre
-- `core.roles`. Por eso un rol creado desde /roles (que vive en
-- `users.role_cat` + `users.role_permission`) NUNCA aparecía en
-- `core.roles`, que es la tabla que leen:
--   · el JWT del MCP (POST /api/auth/mcp-token/),
--   · el enforcement RBAC del backend (RoleBasedPermission),
--   · el filtrado de tools del MCP (permissions_for_role_exact).
-- Resultado: el rol nuevo caía en fail-closed y el usuario no veía NINGUNA
-- tool/herramienta.
--
-- Este script:
--   1. Reescribe la función para que haga UPSERT (INSERT si falta la fila).
--   2. La ejecuta una vez para backfillear cualquier rol que ya exista en
--      users.role_cat sin fila en core.roles.
--
-- Idempotente: se puede correr N veces.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION users.sync_role_permissions_to_core()
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
    perms jsonb;
    r     record;
BEGIN
    -- 1) Roles con celdas en la matriz: calcular {modules, actions} y upsert.
    FOR r IN
        SELECT rc.slug
          FROM users.role_cat rc
         WHERE EXISTS (SELECT 1 FROM users.role_permission rp WHERE rp.role_slug = rc.slug)
    LOOP
        SELECT jsonb_build_object(
                   'modules', COALESCE((
                       SELECT array_agg(DISTINCT rp2.module_slug)
                         FROM users.role_permission rp2
                        WHERE rp2.role_slug = r.slug
                          AND (rp2.can_create OR rp2.can_read OR rp2.can_update
                               OR rp2.can_delete OR rp2.can_upload_doc
                               OR rp2.can_download_doc OR rp2.can_view_doc)
                   ), '{}'::text[]),
                   'actions', COALESCE((
                       SELECT array_agg(DISTINCT act) FILTER (WHERE act IS NOT NULL)
                         FROM (
                           SELECT CASE WHEN rp2.can_create      THEN rp2.module_slug || '.create'       END AS act
                             FROM users.role_permission rp2 WHERE rp2.role_slug = r.slug
                           UNION ALL
                           SELECT CASE WHEN rp2.can_read        THEN rp2.module_slug || '.view'         END
                             FROM users.role_permission rp2 WHERE rp2.role_slug = r.slug
                           UNION ALL
                           SELECT CASE WHEN rp2.can_update      THEN rp2.module_slug || '.update'       END
                             FROM users.role_permission rp2 WHERE rp2.role_slug = r.slug
                           UNION ALL
                           SELECT CASE WHEN rp2.can_delete      THEN rp2.module_slug || '.delete'       END
                             FROM users.role_permission rp2 WHERE rp2.role_slug = r.slug
                           UNION ALL
                           SELECT CASE WHEN rp2.can_upload_doc  THEN rp2.module_slug || '.upload_doc'   END
                             FROM users.role_permission rp2 WHERE rp2.role_slug = r.slug
                           UNION ALL
                           SELECT CASE WHEN rp2.can_download_doc THEN rp2.module_slug || '.download_doc' END
                             FROM users.role_permission rp2 WHERE rp2.role_slug = r.slug
                           UNION ALL
                           SELECT CASE WHEN rp2.can_view_doc    THEN rp2.module_slug || '.view_doc'     END
                             FROM users.role_permission rp2 WHERE rp2.role_slug = r.slug
                         ) actions
                   ), '{}'::text[])
               )
          INTO perms;

        UPDATE core.roles
           SET permissions = perms,
               updated_at  = NOW()
         WHERE slug = r.slug;

        IF NOT FOUND THEN
            INSERT INTO core.roles (slug, name, description, permissions, is_system)
            SELECT rc.slug, rc.nombre, rc.descripcion, perms, COALESCE(rc.is_system, FALSE)
              FROM users.role_cat rc
             WHERE rc.slug = r.slug;
        END IF;
    END LOOP;

    -- 2) Roles del catálogo SIN celdas: asegurar la fila con permisos vacíos
    --    (fail-closed explícito, en lugar de "rol inexistente").
    INSERT INTO core.roles (slug, name, description, permissions, is_system)
    SELECT rc.slug, rc.nombre, rc.descripcion, '{}'::jsonb, COALESCE(rc.is_system, FALSE)
      FROM users.role_cat rc
     WHERE NOT EXISTS (SELECT 1 FROM core.roles r2 WHERE r2.slug = rc.slug);

    RETURN;
END;
$function$;

-- Backfill inmediato para los roles ya creados desde /roles.
SELECT users.sync_role_permissions_to_core();

COMMIT;
