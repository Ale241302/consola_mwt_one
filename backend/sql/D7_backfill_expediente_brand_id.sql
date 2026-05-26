-- =====================================================================
-- MWT.ONE · backend/sql/D7_backfill_expediente_brand_id.sql
-- Sprint 2026-05-26 (CEO) · Agente: AG-DB
--
-- Problema:
--   El wizard de creacion de expediente (apps/expedientes/views.py)
--   NO popula `expedientes.expediente.brand_id`. Solo lo guarda en
--   `expedientes.oc.brand_id`. Resultado: todas las queries que
--   filtran por expediente.brand_id (dashboard.by_brand,
--   by_status_by_brand, KPIs por marca, etc.) devuelven [].
--
-- Solucion durable:
--   1. Backfill historico: copiar `oc.brand_id` -> `expediente.brand_id`
--      donde el expediente este vinculado a una OC con marca.
--   2. El nuevo SQL de analytics.views ya usa COALESCE como defensa
--      adicional, pero este backfill garantiza que TODAS las queries
--      (incluso las que no lleven COALESCE) vean la marca correcta.
--
-- Idempotente:
--   El UPDATE solo toca filas donde brand_id IS NULL y existe OC con
--   marca. Re-correrlo no cambia nada. Marcado en _applied_sql.
-- =====================================================================
BEGIN;

-- 1) Heredar brand_id desde la OC padre cuando el expediente lo tenga NULL
UPDATE expedientes.expediente e
   SET brand_id = o.brand_id,
       updated_at = NOW()
  FROM expedientes.oc o
 WHERE e.oc_id     = o.id
   AND e.brand_id  IS NULL
   AND o.brand_id  IS NOT NULL;

-- 2) Reportar cuantas filas quedan sin marca (info, no error)
DO $$
DECLARE
    sin_marca INTEGER;
    total     INTEGER;
BEGIN
    SELECT COUNT(*) INTO total
      FROM expedientes.expediente
     WHERE is_active = TRUE;
    SELECT COUNT(*) INTO sin_marca
      FROM expedientes.expediente
     WHERE is_active = TRUE AND brand_id IS NULL;
    RAISE NOTICE 'D7 backfill brand_id: % de % expedientes activos siguen sin marca',
        sin_marca, total;
END$$;

COMMIT;
