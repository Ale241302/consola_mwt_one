-- ============================================================
-- C1_documentos_audience.sql · audiencia del documento.
-- audience IN ('CLIENT','MWT_INTERNAL') — los CLIENT_* solo ven CLIENT.
-- ============================================================
SET search_path = expedientes, public;

ALTER TABLE expedientes.documento
  ADD COLUMN IF NOT EXISTS audience VARCHAR(16) NOT NULL DEFAULT 'CLIENT';

DO $$ BEGIN
  ALTER TABLE expedientes.documento
    ADD CONSTRAINT documento_audience_chk
    CHECK (audience IN ('CLIENT','MWT_INTERNAL'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS documento_audience_idx
  ON expedientes.documento (audience);

COMMENT ON COLUMN expedientes.documento.audience IS
  'CLIENT: visible a clientes finales y a MWT. MWT_INTERNAL: solo Admin / usuarios MWT.';
