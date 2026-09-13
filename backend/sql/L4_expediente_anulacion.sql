-- =====================================================================
-- L4 · Etapa 1/backlog B8 - anular/recrear con motivo y vínculo interno.
-- Conserva el expediente anterior y su documentación; enlaza el reemplazo.
-- =====================================================================
BEGIN;

ALTER TABLE expedientes.expediente ADD COLUMN IF NOT EXISTS anulado_at TIMESTAMPTZ;
ALTER TABLE expedientes.expediente ADD COLUMN IF NOT EXISTS anulacion_motivo TEXT;
ALTER TABLE expedientes.expediente ADD COLUMN IF NOT EXISTS replaces_expediente_id UUID;
ALTER TABLE expedientes.expediente ADD COLUMN IF NOT EXISTS replacement_expediente_id UUID;

CREATE INDEX IF NOT EXISTS expediente_replaces_idx
    ON expedientes.expediente (replaces_expediente_id);
CREATE INDEX IF NOT EXISTS expediente_replacement_idx
    ON expedientes.expediente (replacement_expediente_id);

COMMIT;
