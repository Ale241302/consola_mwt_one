-- =====================================================================
-- MWT.ONE · 91l_cost_line_scope.sql
-- Sprint 2026-05-13 · Fase 9 · Costos con scope de expedientes/líneas.
-- Agente responsable: [AG-DATABASE]
--
-- Caso de uso (CEO, textual):
--   "En el paso de costos del wizard de transferencias quiero que al
--    registrar un costo me pregunte para qué expediente(s) y qué
--    productos seleccionados aplica. Puede aplicar a todos los
--    expedientes, a un subconjunto, o incluso solo a algunas líneas
--    específicas de un expediente."
--
-- Para soportar esto añadimos una columna JSONB `scope_json` a
-- `transfers.cost_line`. Forma del valor:
--
--   NULL                                       → costo aplica a todo el batch
--   {"applies_to_all": true}                   → idem (forma explícita)
--   {"applies_to_all": false,
--    "expediente_ids": ["uuid1", "uuid2"],
--    "lines": [{"expediente_id":"uuid1",
--               "producto_id":"uuid", "talla":"42"}, ...]}
--                                              → restringido
--
-- Si `lines` está presente, manda sobre `expediente_ids` (el costo
-- aplica sólo a esas (producto, talla) específicas).
--
-- Backward-compatible: cost_line existentes tendrán scope_json = NULL
-- y el motor de Landed Cost los seguirá tratando como "aplica a todos"
-- (semántica pre-fase 9).
-- =====================================================================

ALTER TABLE transfers.cost_line
    ADD COLUMN IF NOT EXISTS scope_json JSONB;

COMMENT ON COLUMN transfers.cost_line.scope_json IS
    'Scope opcional del costo: a qué expedientes / líneas aplica. '
    'NULL = aplica a toda la transferencia. Shape: '
    '{"applies_to_all":bool, "expediente_ids":[uuid...], '
    '"lines":[{"expediente_id":uuid,"producto_id":uuid,"talla":str}...]}';

-- Índice GIN sólo si hay filas con scope (mayoría serán NULL).
CREATE INDEX IF NOT EXISTS idx_cost_line_scope_gin
    ON transfers.cost_line USING gin (scope_json)
    WHERE scope_json IS NOT NULL;

-- =====================================================================
-- FIN 91l_cost_line_scope.sql
-- =====================================================================
