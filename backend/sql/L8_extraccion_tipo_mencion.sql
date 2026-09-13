-- =====================================================================
-- L8 · Etapa 4 (cierre) - clasificación de la mención + preparación de
--      artefactos y tareas de seguimiento.
--   correo.extraccion.tipo_mencion -> CONSULTA | PROPUESTA | CONFIRMACION
--     · CONSULTA     = pregunta (¿cuándo…?) -> se descarta sola, no genera
--                      propuesta publicable ni revisión.
--     · PROPUESTA    = tentativa ("estimamos", "si todo va bien") -> se guarda
--                      como informativa; NO dispara conflicto.
--     · CONFIRMACION = hecho asertado -> propuesta normal; si contradice la
--                      fecha publicada -> conflicto + tarea de revisión.
--   Idempotente.
-- =====================================================================
BEGIN;

ALTER TABLE correo.extraccion
    ADD COLUMN IF NOT EXISTS tipo_mencion VARCHAR(16) NOT NULL DEFAULT 'CONFIRMACION';

ALTER TABLE correo.extraccion DROP CONSTRAINT IF EXISTS extraccion_tipo_mencion_chk;
ALTER TABLE correo.extraccion
    ADD CONSTRAINT extraccion_tipo_mencion_chk
    CHECK (tipo_mencion IN ('CONSULTA','PROPUESTA','CONFIRMACION'));

COMMENT ON COLUMN correo.extraccion.tipo_mencion IS
    'Etapa 4: distingue pregunta (CONSULTA), tentativa (PROPUESTA) o hecho (CONFIRMACION).';

CREATE INDEX IF NOT EXISTS extraccion_tipo_mencion_idx
    ON correo.extraccion (tipo_mencion);

COMMIT;
