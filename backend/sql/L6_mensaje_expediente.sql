-- =====================================================================
-- L6 · Etapa 3 - un mensaje puede vincularse a VARIOS expedientes.
--   correo.mensaje_expediente (N:M). Backfill desde mensaje.expediente_id.
-- Idempotente.
-- =====================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS correo.mensaje_expediente (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mensaje_id     UUID NOT NULL,
    expediente_id  UUID NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS mensaje_expediente_uniq
    ON correo.mensaje_expediente (mensaje_id, expediente_id);
CREATE INDEX IF NOT EXISTS mensaje_expediente_msg_idx
    ON correo.mensaje_expediente (mensaje_id);
CREATE INDEX IF NOT EXISTS mensaje_expediente_exp_idx
    ON correo.mensaje_expediente (expediente_id);

INSERT INTO correo.mensaje_expediente (mensaje_id, expediente_id)
SELECT id, expediente_id FROM correo.mensaje
 WHERE expediente_id IS NOT NULL
ON CONFLICT DO NOTHING;

COMMIT;
