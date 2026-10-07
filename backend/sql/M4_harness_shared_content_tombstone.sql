-- M4 · Tombstones del contenido compartido de un Space del harness.
--
-- Un miembro con `delete-<módulo>` puede retirar el ítem que otro miembro
-- publicó. El borrado se marca con `deleted_at` en lugar de eliminar la fila,
-- para que la siguiente publicación del autor (que reemplaza su conjunto
-- completo) no lo resucite; el autor que retira el ítem de su conjunto sí lo
-- elimina del todo (la poda del POST borra la fila).
--
-- Aplicado una sola vez por docker-entrypoint.sh, rastreado en public._applied_sql.

ALTER TABLE core.harness_shared_content
    ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

COMMENT ON COLUMN core.harness_shared_content.deleted_at IS
    'Instante en que un miembro con permiso de borrado retiró el ítem; NULL cuando está vigente.';
