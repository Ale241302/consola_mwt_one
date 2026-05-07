-- ============================================================
-- MWT.ONE · C3_artifact_instances_sap_metadata.sql
-- Sprint 2026-05-06 — Editor SAP-level (Fase 2.A).
--
-- Hasta ahora el operador, forma_pago y payment_days vivían SOLO
-- en `expedientes.expediente`. El sprint Editor SAP los lleva al
-- nivel de SAP confirmation porque un mismo expediente puede
-- alojar varios SAPs y cada uno puede tener un operador / términos
-- de pago distintos. El crédito se aplica al operador del SAP, no
-- al del expediente.
--
-- Estrategia:
--   · Almacenamos los overrides SAP-level en expedientes.artifact_instances
--     (ya hay 1 fila por ART-04 por SAP). NULL = "hereda del expediente".
--   · Backfill: copiar de expediente padre para los ART-04 existentes.
--   · El cálculo de credito_usado del cliente (apps/clientes/models.py)
--     deberá consultar:
--          1) operating_company de la linea via su sap → artifact_instances
--          2) si no hay artifact_instances activo → expediente.operating_company_id
--
-- Idempotente. Asume que C0/C1/C2 ya corrieron.
-- ============================================================
SET search_path = expedientes, public;

-- ────────────────────────────────────────────────────────────
-- 1. Agregar columnas SAP-level
-- ────────────────────────────────────────────────────────────
ALTER TABLE expedientes.artifact_instances
  ADD COLUMN IF NOT EXISTS operating_company_id UUID NULL,
  ADD COLUMN IF NOT EXISTS forma_pago           VARCHAR(16) NULL,
  ADD COLUMN IF NOT EXISTS payment_days         INTEGER NULL;

-- CHECK constraint para forma_pago (idempotente)
DO $$ BEGIN
  ALTER TABLE expedientes.artifact_instances
    ADD CONSTRAINT artifact_instances_forma_pago_chk
    CHECK (forma_pago IS NULL OR forma_pago IN ('CREDITO', 'CONTADO'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Index para queries del recalculo de credito_usado por operador SAP
CREATE INDEX IF NOT EXISTS artifact_instances_sap_operating_idx
  ON expedientes.artifact_instances (operating_company_id)
 WHERE operating_company_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 2. Backfill: filas ART-04 existentes heredan del expediente
-- ────────────────────────────────────────────────────────────
UPDATE expedientes.artifact_instances ai
   SET operating_company_id = e.operating_company_id,
       forma_pago           = e.forma_pago,
       payment_days         = COALESCE(e.credit_days, 0)
  FROM expedientes.expediente e
 WHERE ai.expediente_id = e.id
   AND ai.artifact_code = 'ART-04'
   AND ai.is_active = TRUE
   AND ai.operating_company_id IS NULL;

COMMENT ON COLUMN expedientes.artifact_instances.operating_company_id IS
  'Operador del SAP. NULL = hereda del expediente. Permite que distintos SAPs del mismo expediente tengan operadores distintos.';
COMMENT ON COLUMN expedientes.artifact_instances.forma_pago IS
  'CREDITO o CONTADO a nivel SAP. NULL = hereda del expediente.';
COMMENT ON COLUMN expedientes.artifact_instances.payment_days IS
  'Días de crédito para este SAP (override del expediente).';
