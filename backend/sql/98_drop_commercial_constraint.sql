-- =====================================================================
-- MWT.ONE · 98_drop_commercial_constraint.sql
-- Agente responsable: [AG-DATABASE]
--
-- Sprint Wizard Simplificado · 2026-04-30 (revert)
--
-- El CEO decidió que NINGÚN campo comercial es obligatorio en ningún
-- estado. La transición REGISTRO→PRODUCCION (Comando C5 confirm_sap)
-- debe poder ejecutarse aunque el expediente tenga brand_id /
-- modo_operacion / moneda en NULL.
--
-- Acción: drop del constraint que estaba bloqueando T2.
--
-- Idempotente: sólo dropea si existe.
--
-- Cómo aplicar:
--   docker compose exec -T postgres psql -U mwt -d mwt_one \
--     < backend/sql/98_drop_commercial_constraint.sql
-- =====================================================================

DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ck_exp_commercial_complete_after_registro'
          AND conrelid = 'expedientes.expediente'::regclass
    ) THEN
        ALTER TABLE expedientes.expediente
            DROP CONSTRAINT ck_exp_commercial_complete_after_registro;
        RAISE NOTICE 'Constraint ck_exp_commercial_complete_after_registro DROPPED.';
    ELSE
        RAISE NOTICE 'Constraint no existía, nada que dropear.';
    END IF;
END $$;

-- Verificación: listar constraints CHECK que quedan en la tabla.
SELECT conname AS constraint_name
  FROM pg_constraint
 WHERE conrelid = 'expedientes.expediente'::regclass
   AND contype = 'c'
 ORDER BY conname;

-- =====================================================================
-- FIN 98_drop_commercial_constraint.sql
-- =====================================================================
