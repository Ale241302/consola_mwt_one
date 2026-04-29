-- =====================================================================
-- MWT.ONE · 95d_expedientes_relax_commercial.sql
-- Agente responsable: [AG-DATABASE]
--
-- Sprint Wizard Simplificado · 2026-04-29.
--
-- El nuevo wizard de creación de expedientes (3 pasos) NO captura datos
-- comerciales/logísticos al crear. La cabecera del expediente nace en
-- estado REGISTRO con los siguientes campos en NULL, y un OPERATOR
-- los completa después en la pantalla de detalle (Hard Stop antes de
-- la transición T2 REGISTRO→PRODUCCION).
--
-- Campos a relajar:
--   · expedientes.expediente.modo_operacion  → DROP DEFAULT + NULLABLE
--   · expedientes.expediente.moneda          → DROP DEFAULT + NULLABLE
--   · brand_id, freight_mode, dispatch_mode  → ya son NULLABLE (ok)
--
-- Reglas MWT respetadas:
--   · CERO FK física.
--   · Idempotente.
--   · No borra datos. Solo afloja constraints.
-- =====================================================================

-- ────────────────────────────────────────────────────────────
-- 1. modo_operacion → NULLABLE (antes: NOT NULL DEFAULT 'FULL')
-- ────────────────────────────────────────────────────────────
ALTER TABLE expedientes.expediente
    ALTER COLUMN modo_operacion DROP NOT NULL,
    ALTER COLUMN modo_operacion DROP DEFAULT;

COMMENT ON COLUMN expedientes.expediente.modo_operacion IS
    'COMISION | FULL. NULL al crear desde wizard simplificado; el OPERATOR '
    'lo completa antes de transitar T2 (REGISTRO→PRODUCCION). Hard Stop '
    'en frontend (ExpedienteDetail) y validación en orchestrator.';


-- ────────────────────────────────────────────────────────────
-- 2. moneda → NULLABLE (antes: NOT NULL DEFAULT 'USD')
-- ────────────────────────────────────────────────────────────
ALTER TABLE expedientes.expediente
    ALTER COLUMN moneda DROP NOT NULL,
    ALTER COLUMN moneda DROP DEFAULT;

COMMENT ON COLUMN expedientes.expediente.moneda IS
    'ISO-4217 (USD, PEN, MXN, …). NULL al crear desde wizard simplificado; '
    'el OPERATOR la completa antes de T2.';


-- ────────────────────────────────────────────────────────────
-- 3. Sanity check del NULLABLE en brand_id, freight_mode, dispatch_mode
--    (ya eran NULL desde 70_expedientes.sql; idempotente).
-- ────────────────────────────────────────────────────────────
ALTER TABLE expedientes.expediente
    ALTER COLUMN brand_id      DROP NOT NULL,
    ALTER COLUMN freight_mode  DROP NOT NULL,
    ALTER COLUMN dispatch_mode DROP NOT NULL,
    ALTER COLUMN incoterm      DROP NOT NULL;


-- ────────────────────────────────────────────────────────────
-- 4. CHECK que documenta el contrato: si estado != 'REGISTRO',
--    los 4 campos comerciales/logísticos deben estar completos.
--    NOT VALID para no romper expedientes legacy con NULLs accidentales.
-- ────────────────────────────────────────────────────────────
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ck_exp_commercial_complete_after_registro'
          AND conrelid = 'expedientes.expediente'::regclass
    ) THEN
        ALTER TABLE expedientes.expediente
            ADD CONSTRAINT ck_exp_commercial_complete_after_registro
            CHECK (
                estado = 'REGISTRO'
                OR (modo_operacion IS NOT NULL
                    AND moneda IS NOT NULL
                    AND brand_id IS NOT NULL)
            )
            NOT VALID;
    END IF;
END $$;


-- ────────────────────────────────────────────────────────────
-- 5. Mismo trato a expedientes.linea (si tiene defaults rígidos)
--    Solo si la columna existe.
-- ────────────────────────────────────────────────────────────
DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'expedientes'
          AND table_name = 'linea'
          AND column_name = 'precio_unitario_usd'
    ) THEN
        EXECUTE 'ALTER TABLE expedientes.linea
                 ALTER COLUMN precio_unitario_usd DROP NOT NULL';
    END IF;
END $$;


-- =====================================================================
-- FIN 95d_expedientes_relax_commercial.sql
-- =====================================================================
