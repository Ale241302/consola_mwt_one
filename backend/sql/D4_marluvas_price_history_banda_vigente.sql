-- =====================================================================
-- MWT.ONE · D4_marluvas_price_history_banda_vigente.sql
-- Agente responsable: [AG-BACKEND]
-- Sprint Historial de precios · 2026-05-21
--
-- Propósito:
--   Capturar QUÉ banda estaba vigente (segun el TC del día) en el momento
--   exacto en que el operador hizo "Guardar" del motor de precios.
--   Hoy el snapshot persiste el ancla por SKU (anchor JSONB en
--   marluvas_price_history_sku) pero NO persiste qué banda FX estaba
--   vigente a nivel global del cliente-marca. Sin ese dato, el visor de
--   "Todas las bandas" del historial no sabe cuál fila marcar como
--   VIGENTE (todas las del medio se pintaban iguales con look amarillo).
--
-- Cambios:
--   1. ALTER TABLE pricing.marluvas_price_history_event — 1 columna nueva:
--        · banda_vigente_id  INTEGER NULL (1..12) — solo para nuevos
--          snapshots; los antiguos quedan NULL y el frontend hace fallback
--          al default conocido (banda 6).
--
--   2. CHECK constraint sobre el rango (idempotente vía DO bloque):
--        banda_vigente_id IS NULL OR (banda_vigente_id BETWEEN 1 AND 12)
--
-- No hay backfill — los snapshots viejos no tienen forma de recuperar
-- la banda vigente histórica (depende del TC del día del save).
-- El frontend asume banda 6 (5,00–5,20) cuando viene NULL.
--
-- Idempotente. Backward-compatible (zero-downtime):
--   · El INSERT existente no menciona la columna, así que sigue
--     funcionando (cae al DEFAULT NULL).
--   · El SELECT existente no lista la columna, así que sigue
--     funcionando — solo los endpoints actualizados la leen.
--
-- Ejecutar:
--   psql -U mwt -d mwt_one -f backend/sql/D4_marluvas_price_history_banda_vigente.sql
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. ALTER TABLE — agregar columna banda_vigente_id
-- ---------------------------------------------------------------------
ALTER TABLE pricing.marluvas_price_history_event
    ADD COLUMN IF NOT EXISTS banda_vigente_id INTEGER NULL;

-- ---------------------------------------------------------------------
-- 2. CHECK constraint sobre el rango — idempotente vía DO bloque
-- ---------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'marluvas_price_history_event_banda_vigente_id_check'
    ) THEN
        ALTER TABLE pricing.marluvas_price_history_event
            ADD CONSTRAINT marluvas_price_history_event_banda_vigente_id_check
            CHECK (banda_vigente_id IS NULL
                   OR (banda_vigente_id BETWEEN 1 AND 12));
    END IF;
END$$;

COMMIT;
