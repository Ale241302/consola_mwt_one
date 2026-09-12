-- =====================================================================
-- K9 · Etapa 2 - ajustes de tareas
--  · documentos de la tarea (array de referencias del expediente).
--  · índice por catalogo_codigo para búsquedas de agenda.
-- Idempotente.
-- =====================================================================
BEGIN;

ALTER TABLE tareas.tarea
    ADD COLUMN IF NOT EXISTS documentos JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS tarea_catalogo_codigo_idx
    ON tareas.tarea (catalogo_codigo) WHERE is_active;

COMMIT;
