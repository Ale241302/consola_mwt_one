-- =====================================================================
-- E9_credit_query_indexes.sql · Auditoría de carga 2026-06-14 · [AG-DATABASE]
--
-- La query de crédito del portal (apps.clientes.models:
--   calcular_consumo_credito_pool / calcular_credito_consumido) es lo más
-- caro del hot path. Filtra por el pool del operador:
--
--     ... FROM expedientes.linea l
--         INNER JOIN expedientes.expediente e ON e.id = l.expediente_id
--         WHERE l.is_active = TRUE
--           AND COALESCE(e.operating_company_id, e.client_id)::text IN (pool_ids)
--
-- Sin FKs en la BD, las columnas de join/filtro suelen quedar sin índice y
-- el COALESCE(...)::text impide usar índices de columna simples. Añadimos:
--
--   1) Índice FUNCIONAL sobre la expresión EXACTA del filtro más selectivo
--      → el planner reduce de seq scan de `expediente` a index scan del pool.
--   2) Partial index para el JOIN a líneas activas (l.is_active = TRUE).
--
-- Ambos idempotentes (IF NOT EXISTS). Backward-compatible (solo añaden
-- índices; sin cambios de esquema ni de datos). Aplicado automáticamente por
-- docker-entrypoint.sh (tracked en public._applied_sql).
-- =====================================================================

-- 1) Filtro del pool: COALESCE(operating_company_id, client_id)::text IN (...)
CREATE INDEX IF NOT EXISTS idx_expediente_opco_text
  ON expedientes.expediente ((COALESCE(operating_company_id, client_id)::text));

-- 2) JOIN a líneas activas por expediente (l.is_active = TRUE AND l.expediente_id = e.id)
CREATE INDEX IF NOT EXISTS idx_linea_active_expediente
  ON expedientes.linea (expediente_id)
  WHERE is_active = TRUE;

-- Refresca estadísticas para que el planner adopte los índices de inmediato.
ANALYZE expedientes.expediente;
ANALYZE expedientes.linea;
