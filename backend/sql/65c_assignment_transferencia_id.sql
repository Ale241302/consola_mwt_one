-- =====================================================================
-- MWT.ONE · 65c_assignment_transferencia_id.sql
-- Sprint 2026-05-13 · Fase 10 · trazabilidad transferencia→assignment.
-- Agente responsable: [AG-DATABASE]
--
-- Caso de uso (CEO, textual):
--   "En el detalle del expediente quiero ver una tabla de costos que
--    se vean los que están en la transferencia. Al hacer clic me debe
--    llevar al detalle de la transferencia."
--
-- Para mapear (expediente → costos), necesitamos saber qué
-- transferencias afectan a qué expediente. La columna `notas` ya
-- contenía 'transfer from {uuid}' pero parsearla es frágil. Añadimos
-- la columna `transferencia_id UUID` que el endpoint /transfer/
-- popula al crear cada fila destino + residual.
--
-- Backward-compatible: existentes quedan con transferencia_id = NULL
-- (no participan en transferencias rastreables).
-- =====================================================================

ALTER TABLE inventario.expediente_nodo_assignment
    ADD COLUMN IF NOT EXISTS transferencia_id UUID;

COMMENT ON COLUMN inventario.expediente_nodo_assignment.transferencia_id IS
    'Si la fila fue creada por una transferencia (POST /nodo-assignments/'
    'transfer/), apunta al id de transfers.transferencia. NULL si la '
    'fila vino de una recepción o ajuste manual.';

CREATE INDEX IF NOT EXISTS idx_ena_transferencia
    ON inventario.expediente_nodo_assignment(transferencia_id)
    WHERE transferencia_id IS NOT NULL;

-- =====================================================================
-- FIN 65c_assignment_transferencia_id.sql
-- =====================================================================
