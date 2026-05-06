-- ============================================================
-- MWT.ONE · C2_audience_admin_only.sql
-- Sprint 2026-05-06 — Tercer nivel de audiencia: ADMIN_ONLY.
--
-- Caso de uso: confirmaciones SAP (ART-04) y otros documentos
-- estrictamente confidenciales que NI siquiera los usuarios
-- internos de Muito Work Limitada deben ver — solo el rol Admin
-- (CEO/superuser).
--
-- Cambios:
--   1) expedientes.documento  · CHECK extendido para aceptar
--      'CLIENT' | 'MWT_INTERNAL' | 'ADMIN_ONLY'.
--   2) expedientes.artifact_instances · ALTER ADD COLUMN audience
--      con misma CHECK + index.
--
-- Idempotente. Asume C1_documentos_audience.sql ya corrió.
-- ============================================================
SET search_path = expedientes, public;

-- ─────────────────────────────────────────────────────────────
-- 1. expedientes.documento  · extender CHECK
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE expedientes.documento
    DROP CONSTRAINT IF EXISTS documento_audience_chk;
EXCEPTION WHEN undefined_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE expedientes.documento
    ADD CONSTRAINT documento_audience_chk
    CHECK (audience IN ('CLIENT','MWT_INTERNAL','ADMIN_ONLY'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────
-- 2. expedientes.artifact_instances · agregar audience
-- ─────────────────────────────────────────────────────────────
ALTER TABLE expedientes.artifact_instances
  ADD COLUMN IF NOT EXISTS audience VARCHAR(16) NOT NULL DEFAULT 'CLIENT';

DO $$ BEGIN
  ALTER TABLE expedientes.artifact_instances
    ADD CONSTRAINT artifact_instances_audience_chk
    CHECK (audience IN ('CLIENT','MWT_INTERNAL','ADMIN_ONLY'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS artifact_instances_audience_idx
  ON expedientes.artifact_instances (audience);

-- ─────────────────────────────────────────────────────────────
-- 3. Backfill: ART-04 (Confirmación SAP) ya existentes pasan a
--    ADMIN_ONLY (regla de negocio del CEO 2026-05-06).
-- ─────────────────────────────────────────────────────────────
UPDATE expedientes.artifact_instances
   SET audience = 'ADMIN_ONLY'
 WHERE artifact_code = 'ART-04'
   AND audience = 'CLIENT';

COMMENT ON COLUMN expedientes.documento.audience IS
  'CLIENT: visible a clientes finales, MWT y Admin. MWT_INTERNAL: solo MWT staff y Admin. ADMIN_ONLY: SOLO rol Admin/CEO/superuser.';

COMMENT ON COLUMN expedientes.artifact_instances.audience IS
  'Audiencia del artefacto. ART-04 (SAP) por defecto ADMIN_ONLY.';
