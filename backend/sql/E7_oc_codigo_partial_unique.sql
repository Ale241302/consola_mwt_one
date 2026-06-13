-- =====================================================================
-- MWT.ONE · E7_oc_codigo_partial_unique.sql
-- Agente responsable: [AG-DATABASE]
-- Sprint 2026-06-13 · Fix: re-registro de PO tras borrado (soft-delete).
--
-- Se aplica AUTOMÁTICAMENTE en el deploy: el entrypoint del backend corre
-- backend/sql/*.sql una sola vez (rastreado en public._applied_sql).
--
-- PROBLEMA
--   Borrar un expediente desde /expedientes es soft-delete
--   (expediente.is_active=FALSE) y NO tocaba la OC, dejándola ACTIVA y
--   huérfana. Como expedientes.oc.codigo tiene UNIQUE global (constraint
--   `oc_codigo_key`), al re-registrar el mismo PO desde el portal fallaba:
--     duplicate key value violates unique constraint "oc_codigo_key"
--     Key (codigo)=(504960) already exists.
--
-- SOLUCIÓN (idempotente)
--   1. Limpieza conservadora: soft-delete de OCs huérfanas (tuvieron
--      expedientes y hoy ninguno activo). Libera codigos atascados.
--   2. UNIQUE global → índice ÚNICO PARCIAL (solo OCs activas). Una OC
--      soft-deleteada puede compartir codigo con una nueva OC activa
--      (re-registro), pero NUNCA pueden coexistir dos OCs ACTIVAS con el
--      mismo número.
-- =====================================================================

BEGIN;

-- 1. Limpieza de OCs huérfanas (todas sus expedientes inactivos).
--    SOLO toca OCs que ALGUNA VEZ tuvieron expedientes y hoy no tienen
--    ninguno activo. Las OCs sin ningún expediente NO se tocan.
UPDATE expedientes.oc o
   SET is_active = FALSE,
       updated_at = NOW()
 WHERE o.is_active = TRUE
   AND EXISTS (
         SELECT 1 FROM expedientes.expediente e
          WHERE e.oc_id = o.id)
   AND NOT EXISTS (
         SELECT 1 FROM expedientes.expediente e
          WHERE e.oc_id = o.id AND e.is_active = TRUE);

-- 2. UNIQUE global → índice único PARCIAL (solo activas).
--    DROP tolerante (constraint o índice suelto, según cómo exista).
ALTER TABLE expedientes.oc DROP CONSTRAINT IF EXISTS oc_codigo_key;
DROP INDEX  IF EXISTS expedientes.oc_codigo_key;

CREATE UNIQUE INDEX IF NOT EXISTS oc_codigo_active_uniq
    ON expedientes.oc (codigo)
 WHERE is_active = TRUE;

COMMIT;

-- FIN E7_oc_codigo_partial_unique.sql
