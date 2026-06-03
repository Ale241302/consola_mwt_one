-- =====================================================================
-- MWT.ONE · 91m_cost_line_price_view.sql
-- Sprint 2026-06-03 · Vista dual MWT / Cliente en la liquidación.
-- Agente responsable: [AG-DATABASE]
--
-- Caso de uso (CEO, textual):
--   "Cuando el expediente del movimiento es Operado por Muito Work
--    Limitada quiero dos vistas: Vista MWT y Vista Cliente. Los valores
--    (costos incrementales, landed cost, impuestos, líneas a facturar)
--    son unos para MWT y otros para el cliente, y cada vista debe
--    guardar sus propios valores."
--
-- Las tasas/overrides/impuestos custom se guardan namespaced en
-- transfers.transferencia.context_data.views.{MWT|CLIENT} (JSONB, ya
-- existe — sin DDL). Lo único que necesita columna física es la
-- separación de las cost_line (flete, seguro, aduana, etc.): cada costo
-- pertenece a una vista.
--
--   price_view = 'MWT'    → costo de la liquidación interna (CEO-only)
--   price_view = 'CLIENT' → costo de la vista cliente final
--
-- Backward-compatible / zero-downtime (deploy rolling en VPS único):
--   · Columna nullable con DEFAULT 'MWT'.
--   · Backfill de filas existentes a 'MWT' (la liquidación histórica
--     siempre fue la interna).
--   · CHECK laxo (acepta NULL) para no romper inserts legacy en vuelo.
-- =====================================================================

ALTER TABLE transfers.cost_line
    ADD COLUMN IF NOT EXISTS price_view VARCHAR(8) DEFAULT 'MWT';

-- Backfill explícito de filas previas (por si alguna quedó NULL).
UPDATE transfers.cost_line
   SET price_view = 'MWT'
 WHERE price_view IS NULL;

-- Validación laxa: permite NULL (compat) pero restringe valores no esperados.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'cost_line_price_view_chk'
    ) THEN
        ALTER TABLE transfers.cost_line
            ADD CONSTRAINT cost_line_price_view_chk
            CHECK (price_view IS NULL OR price_view IN ('MWT', 'CLIENT'));
    END IF;
END $$;

COMMENT ON COLUMN transfers.cost_line.price_view IS
    'Vista a la que pertenece el costo en la liquidación dual: '
    'MWT (liquidación interna CEO-only) o CLIENT (vista cliente final). '
    'Default MWT. Las tasas/overrides/impuestos custom por vista viven en '
    'transferencia.context_data.views.{MWT|CLIENT}.';

-- Índice parcial para el filtrado por (transferencia, vista) activo.
CREATE INDEX IF NOT EXISTS idx_cost_line_trf_view
    ON transfers.cost_line (transferencia_id, price_view)
    WHERE is_active = true;
