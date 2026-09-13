-- =====================================================================
-- L7 · Etapa 4 - extracción de fechas de correos + publicación al cliente
--   correo.extraccion       -> propuesta por campo (con evidencia/precisión)
--   correo.expediente_fecha -> fecha VIGENTE publicada por expediente+campo
-- Idempotente.
-- =====================================================================
BEGIN;

CREATE SCHEMA IF NOT EXISTS correo;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS correo.extraccion (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mensaje_id     UUID,
    expediente_id  UUID,
    campo          VARCHAR(24) NOT NULL,
    valor_raw      TEXT,
    valor_fecha    DATE,
    precision      VARCHAR(16) NOT NULL DEFAULT 'EXACTA',
    fuente         VARCHAR(32) NOT NULL DEFAULT 'MENSAJE',
    confianza      NUMERIC(4,3) NOT NULL DEFAULT 0,
    estado         VARCHAR(16) NOT NULL DEFAULT 'PROPUESTO',
    conflicto      BOOLEAN NOT NULL DEFAULT FALSE,
    evidencias     JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by_id  UUID,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT extraccion_campo_chk
        CHECK (campo IN ('PRODUCCION','ETD','ETA','BL_AWB','DUE','DOCUMENTO','OTRO')),
    CONSTRAINT extraccion_precision_chk
        CHECK (precision IN ('EXACTA','RANGO','MES','DESCONOCIDA')),
    CONSTRAINT extraccion_estado_chk
        CHECK (estado IN ('PROPUESTO','CONFIRMADO','RECHAZADO','SUPERSEDIDO'))
);
CREATE INDEX IF NOT EXISTS extraccion_exp_idx    ON correo.extraccion (expediente_id);
CREATE INDEX IF NOT EXISTS extraccion_estado_idx ON correo.extraccion (estado);
CREATE UNIQUE INDEX IF NOT EXISTS extraccion_dedup_uniq
    ON correo.extraccion (mensaje_id, campo, md5(COALESCE(valor_raw, '')))
    WHERE mensaje_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS correo.expediente_fecha (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    expediente_id         UUID NOT NULL,
    campo                 VARCHAR(24) NOT NULL,
    valor_raw             TEXT,
    valor_fecha           DATE,
    precision             VARCHAR(16) NOT NULL DEFAULT 'EXACTA',
    publicado             BOOLEAN NOT NULL DEFAULT TRUE,
    fuente_extraccion_id  UUID,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT exfecha_campo_chk
        CHECK (campo IN ('PRODUCCION','ETD','ETA','BL_AWB','DUE','DOCUMENTO','OTRO')),
    CONSTRAINT exfecha_precision_chk
        CHECK (precision IN ('EXACTA','RANGO','MES','DESCONOCIDA'))
);
CREATE UNIQUE INDEX IF NOT EXISTS expediente_fecha_uniq
    ON correo.expediente_fecha (expediente_id, campo);

COMMIT;
