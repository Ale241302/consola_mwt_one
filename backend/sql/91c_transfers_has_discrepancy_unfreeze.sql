-- =====================================================================
-- MWT.ONE · 91c_transfers_has_discrepancy_unfreeze.sql
-- Agente: [AG-DATABASE]
--
-- Convierte transfers.transferencia.has_discrepancy de columna
-- GENERATED ALWAYS AS ... STORED a columna regular con trigger que la
-- actualiza automáticamente. Esto permite que el ORM de Django (que
-- siempre incluye TODAS las columnas en INSERT/UPDATE) pueda escribir
-- la fila sin recibir "cannot insert a non-DEFAULT value into column".
--
-- El trigger garantiza que el valor sigue siendo (discrepancy_count > 0).
--
-- Idempotente: usa IF EXISTS / OR REPLACE.
-- =====================================================================

-- 1. Drop de la columna generada (si existe)
DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='transfers'
          AND table_name='transferencia'
          AND column_name='has_discrepancy'
          AND is_generated='ALWAYS'
    ) THEN
        ALTER TABLE transfers.transferencia DROP COLUMN has_discrepancy;
        RAISE NOTICE '[91c] has_discrepancy GENERATED removida';
    END IF;
END $$;

-- 2. Recrear como columna regular con DEFAULT
ALTER TABLE transfers.transferencia
    ADD COLUMN IF NOT EXISTS has_discrepancy BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. Trigger que mantiene has_discrepancy = (discrepancy_count > 0)
CREATE OR REPLACE FUNCTION transfers.fn_sync_has_discrepancy()
RETURNS TRIGGER AS $$
BEGIN
    NEW.has_discrepancy := COALESCE(NEW.discrepancy_count, 0) > 0;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_has_discrepancy ON transfers.transferencia;
CREATE TRIGGER trg_sync_has_discrepancy
    BEFORE INSERT OR UPDATE ON transfers.transferencia
    FOR EACH ROW EXECUTE FUNCTION transfers.fn_sync_has_discrepancy();

-- 4. Recalcular para filas existentes (un UPDATE no-op dispara el trigger)
UPDATE transfers.transferencia
   SET discrepancy_count = discrepancy_count
 WHERE TRUE;

-- 5. Recrear el index parcial que dependía de la columna
DROP INDEX IF EXISTS transfers.idx_transfer_has_discrepancy;
CREATE INDEX IF NOT EXISTS idx_transfer_has_discrepancy
    ON transfers.transferencia (has_discrepancy)
    WHERE has_discrepancy = TRUE AND is_active = TRUE;

DO $$ BEGIN
    RAISE NOTICE '[91c] has_discrepancy ahora es columna regular con trigger';
END $$;
