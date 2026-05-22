-- =====================================================================
-- D5_transfers_linea_4dp.sql
-- Sprint 2026-05-22 · Subir precisión de transfers.linea.unit_cost y
-- unit_value de 2 a 4 decimales para soportar precios del snapshot
-- Marluvas (prices_matrix devuelve hasta 4 decimales, ej. 29.5231).
--
-- Antes:   numeric(12,2)   → POST /api/transferencias/ rechazaba 29.5231
-- Después: numeric(14,4)
--
-- IDEMPOTENTE: el ALTER COLUMN ... TYPE no falla si ya está aplicado
-- porque PostgreSQL valida que el tipo nuevo sea idéntico al actual y
-- skipea silenciosamente. Aún así envolvemos en DO $$ ... $$ con
-- chequeo de information_schema para evitar tiempo de I/O cuando ya
-- está en 14,4.
-- =====================================================================
DO $$
DECLARE
    v_precision int;
    v_scale     int;
BEGIN
    SELECT numeric_precision, numeric_scale
      INTO v_precision, v_scale
      FROM information_schema.columns
     WHERE table_schema = 'transfers'
       AND table_name   = 'linea'
       AND column_name  = 'unit_cost';

    IF v_precision IS NULL THEN
        RAISE NOTICE 'transfers.linea.unit_cost no existe — skip';
        RETURN;
    END IF;

    IF v_precision = 14 AND v_scale = 4 THEN
        RAISE NOTICE 'transfers.linea.unit_cost ya es numeric(14,4) — skip';
        RETURN;
    END IF;

    RAISE NOTICE 'Altering transfers.linea.unit_cost: (%, %) → (14, 4)',
                 v_precision, v_scale;
    ALTER TABLE transfers.linea
        ALTER COLUMN unit_cost   TYPE numeric(14,4),
        ALTER COLUMN unit_value  TYPE numeric(14,4);
END
$$;
