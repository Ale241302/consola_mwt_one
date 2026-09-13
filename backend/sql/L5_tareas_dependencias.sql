-- =====================================================================
-- L5 · Etapa 2 - dependencias tarea -> tarea.
-- Idempotente.
-- =====================================================================
BEGIN;

ALTER TABLE tareas.tarea
    ADD COLUMN IF NOT EXISTS depends_on_tarea_id UUID;

CREATE INDEX IF NOT EXISTS tarea_depends_on_idx
    ON tareas.tarea (depends_on_tarea_id) WHERE is_active;

COMMIT;
