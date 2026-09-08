-- backend/sql/I6_expediente_dispatch_mode_widen.sql
-- Amplía expedientes.expediente.dispatch_mode de VARCHAR(8) a VARCHAR(12).
-- Motivo: el modelo documenta dispatch_mode = FCL | LCL | CONSOLIDADO, y
-- "CONSOLIDADO" (11 chars) no cabía en VARCHAR(8) → 500 "value too long".
-- Backward-compatible: solo se ensancha la columna (no se renombra ni se borra
-- nada); el código viejo y el nuevo conviven durante el rollout. Idempotente:
-- no-op si la columna ya es >= 12.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'expedientes' AND table_name = 'expediente'
           AND column_name = 'dispatch_mode'
           AND character_maximum_length < 12
    ) THEN
        ALTER TABLE expedientes.expediente
            ALTER COLUMN dispatch_mode TYPE VARCHAR(12);
    END IF;
END
$$;
