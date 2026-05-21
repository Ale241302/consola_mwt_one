-- =====================================================================
-- MWT.ONE · D2_expedientes_corrections_count.sql
-- Agente responsable: [AG-BACKEND]
-- Sprint Dashboard KPIs · 2026-05-21
--
-- Propósito:
--   Crear las columnas necesarias para alimentar la KPI
--   "% expedientes con corrección R1+" del dashboard.
--
--   Hoy `expedientes.expediente` solo tiene `cost_corrections BOOLEAN`,
--   que es insuficiente para distinguir niveles (R1/R2/R3/R4/R5) o
--   contar correcciones múltiples sobre el mismo expediente.
--
-- Cambios:
--   1. ALTER TABLE expedientes.expediente — 2 columnas nuevas:
--        · corrections_count       INTEGER NOT NULL DEFAULT 0
--        · last_correction_level   VARCHAR(8) NULL  CHECK (level IN R1..R5)
--
--   2. Backfill conservador:
--        WHERE cost_corrections = TRUE
--          → corrections_count = 1, last_correction_level = 'R1'
--        (es lo más conservador: si la BD venía registrando el booleano
--         significa que hubo AL MENOS una corrección; asumimos R1 como
--         nivel más bajo. Cuando el flujo de correcciones tipado esté
--         operativo, este campo se actualiza por trigger desde la
--         futura tabla expedientes.correccion.)
--
--   3. Índice parcial sobre corrections_count > 0 — la KPI consulta
--      últimos 90 días filtrando por count >= 1, vale la pena.
--
-- No se toca:
--   · cost_corrections — sigue existiendo (no se borra). Tras el
--     backfill, el sistema puede seguir leyéndolo donde lo necesite
--     hasta que se complete la migración a corrections_count en todos
--     los call sites.
--
-- Idempotente. Ejecutable múltiples veces sin error.
-- Backward-compatible (zero-downtime): código actual que solo lee
-- cost_corrections sigue funcionando; lectores que pidan
-- corrections_count obtienen 0 hasta que se popule.
--
-- Ejecutar:
--   psql -U mwt -d mwt_one -f backend/sql/D2_expedientes_corrections_count.sql
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. ALTER TABLE expedientes.expediente — agregar columnas
-- ---------------------------------------------------------------------
ALTER TABLE expedientes.expediente
    ADD COLUMN IF NOT EXISTS corrections_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE expedientes.expediente
    ADD COLUMN IF NOT EXISTS last_correction_level VARCHAR(8) NULL;

-- CHECK constraint sobre el nivel (idempotente vía DO bloque).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'expediente_last_correction_level_check'
    ) THEN
        ALTER TABLE expedientes.expediente
            ADD CONSTRAINT expediente_last_correction_level_check
            CHECK (last_correction_level IS NULL
                   OR last_correction_level IN ('R1','R2','R3','R4','R5'));
    END IF;
END$$;

-- ---------------------------------------------------------------------
-- 2. Backfill conservador desde cost_corrections boolean
-- ---------------------------------------------------------------------
UPDATE expedientes.expediente
   SET corrections_count     = 1,
       last_correction_level = COALESCE(last_correction_level, 'R1')
 WHERE cost_corrections = TRUE
   AND corrections_count = 0;  -- idempotente: solo filas aún no procesadas

-- ---------------------------------------------------------------------
-- 3. Índice parcial — la KPI filtra corrections_count >= 1
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS expediente_corrections_count_idx
    ON expedientes.expediente (corrections_count)
    WHERE corrections_count > 0;

COMMIT;
