-- =====================================================================
-- MWT.ONE · 81_cobros_audit.sql
-- Extensiones del schema cobros · BLOQUE 3 (vencimientos + mora + idempotencia).
--
-- Añade:
--   §1. Extensiones en cobros.pago (external_id unique, fx_rate_history_id).
--   §2. Extensiones en cobros.cobro (dias_mora, bucket_mora, intereses_mora_usd).
--   §3. Unique parcial en conciliación (pago_ingreso, pago_egreso, cobro).
--   §4. cobros.vencimiento — plan de pago T1/T2/T3 por cobro.
--   §5. cobros.withholding_log — retenciones append-only.
--   §6. cobros.fx_rate_history — snapshots de TC por fecha.
--   §7. cobros.collection_event — log inmutable del CollectionBot.
--   §8. Catálogo bucket_mora_cat (T1/T2/T3/T4).
--   §9. Índices para queries de cartera.
--
-- Regla MWT: CERO FKs. Idempotente. Tipos monetarios DECIMAL(14,2).
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS cobros;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'tg_set_updated_at'
    ) THEN
        CREATE FUNCTION tg_set_updated_at() RETURNS trigger AS $f$
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        $f$ LANGUAGE plpgsql;
    END IF;
END $$;

-- =====================================================================
-- §1. Extensiones en cobros.pago (conciliación bancaria idempotente).
-- =====================================================================
ALTER TABLE cobros.pago
    ADD COLUMN IF NOT EXISTS external_id      VARCHAR(128),
                             -- SWIFT / ACH / referencia única del banco
    ADD COLUMN IF NOT EXISTS bank_statement_id VARCHAR(64),
    ADD COLUMN IF NOT EXISTS fx_source         VARCHAR(32) DEFAULT 'MANUAL',
                             -- MANUAL / BCR / SBS / FIXER / ECB
    ADD COLUMN IF NOT EXISTS fx_rate_date      DATE,
    ADD COLUMN IF NOT EXISTS withholding_usd   NUMERIC(14,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS fees_bank_usd     NUMERIC(14,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS monto_neto_usd    NUMERIC(14,2) GENERATED ALWAYS
                             AS (monto_usd - COALESCE(withholding_usd,0) - COALESCE(fees_bank_usd,0)) STORED;

COMMENT ON COLUMN cobros.pago.external_id IS
    'Referencia única del banco. Clave idempotente de conciliación — dos insert con misma ref se rechazan.';

-- Unique parcial: external_id es único para pagos activos (permite reusar si se elimina).
CREATE UNIQUE INDEX IF NOT EXISTS idx_uq_pago_external_id
    ON cobros.pago (external_id)
    WHERE external_id IS NOT NULL AND is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_pago_statement
    ON cobros.pago (bank_statement_id)
    WHERE bank_statement_id IS NOT NULL;

-- =====================================================================
-- §2. Extensiones en cobros.cobro (mora y buckets).
-- =====================================================================
ALTER TABLE cobros.cobro
    ADD COLUMN IF NOT EXISTS dias_mora          INT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS bucket_mora        VARCHAR(8),
                             -- T0 / T1 (1-30) / T2 (31-60) / T3 (61-90) / T4 (90+)
    ADD COLUMN IF NOT EXISTS intereses_mora_usd NUMERIC(14,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS tasa_mora_anual    NUMERIC(5,2)  DEFAULT 0,
    ADD COLUMN IF NOT EXISTS collection_stage   VARCHAR(32) DEFAULT 'NONE',
                             -- NONE / REMINDER / DUNNING / ESCALATED / LEGAL
    ADD COLUMN IF NOT EXISTS last_reminder_at   TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_cobro_bucket
    ON cobros.cobro (bucket_mora)
    WHERE bucket_mora IS NOT NULL AND is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_cobro_vencimiento
    ON cobros.cobro (fecha_vencimiento)
    WHERE is_active = TRUE;

-- =====================================================================
-- §3. Unique parcial en conciliación (mismo par pago↔cobro no se duplica).
-- =====================================================================
ALTER TABLE cobros.conciliacion
    ADD COLUMN IF NOT EXISTS external_ref     VARCHAR(128),
    ADD COLUMN IF NOT EXISTS idempotence_token VARCHAR(64),
    ADD COLUMN IF NOT EXISTS auto_matched    BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS match_score     NUMERIC(5,2);

CREATE UNIQUE INDEX IF NOT EXISTS idx_uq_conciliacion_tuple
    ON cobros.conciliacion (pago_ingreso_id, COALESCE(pago_egreso_id, '00000000-0000-0000-0000-000000000000'::uuid),
                            COALESCE(cobro_id, '00000000-0000-0000-0000-000000000000'::uuid))
    WHERE is_active = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_uq_conciliacion_idemp
    ON cobros.conciliacion (idempotence_token)
    WHERE idempotence_token IS NOT NULL AND is_active = TRUE;

-- =====================================================================
-- §4. Plan de pago T1/T2/T3 por cobro.
-- =====================================================================
CREATE TABLE IF NOT EXISTS cobros.vencimiento (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cobro_id          UUID NOT NULL,                         -- ⛔ sin FK
    tramo             VARCHAR(8) NOT NULL,                   -- T1 / T2 / T3
    pct_monto         NUMERIC(5,2) NOT NULL,                 -- % del cobro_total
    monto_usd         NUMERIC(14,2) NOT NULL,
    fecha_vencimiento DATE NOT NULL,
    monto_pagado_usd  NUMERIC(14,2) DEFAULT 0,
    monto_pendiente_usd NUMERIC(14,2) GENERATED ALWAYS
                      AS (monto_usd - COALESCE(monto_pagado_usd, 0)) STORED,
    dias_mora         INT DEFAULT 0,
    estado            VARCHAR(16) DEFAULT 'PENDIENTE',
                      -- PENDIENTE / PARCIAL / PAGADO / VENCIDO / CONDONADO
    notas             TEXT,

    is_active         BOOLEAN DEFAULT TRUE,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_uq_vencimiento_tramo
    ON cobros.vencimiento (cobro_id, tramo)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_vencimiento_fecha
    ON cobros.vencimiento (fecha_vencimiento)
    WHERE is_active = TRUE;

DROP TRIGGER IF EXISTS tr_vencimiento_updated_at ON cobros.vencimiento;
CREATE TRIGGER tr_vencimiento_updated_at
    BEFORE UPDATE ON cobros.vencimiento
    FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- =====================================================================
-- §5. Withholding log append-only.
-- =====================================================================
CREATE TABLE IF NOT EXISTS cobros.withholding_log (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pago_id           UUID NOT NULL,                         -- ⛔ sin FK
    cobro_id          UUID,
    tipo              VARCHAR(32) NOT NULL,
                      -- IGV / ITF / RENTA / DETRACCION / PERCEPCION / OTRO
    tasa_pct          NUMERIC(5,2),
    base_usd          NUMERIC(14,2),
    monto_usd         NUMERIC(14,2) NOT NULL,
    referencia_certif VARCHAR(128),
    notas             TEXT,
    payload_json      JSONB DEFAULT '{}'::jsonb,

    is_active         BOOLEAN DEFAULT TRUE,
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_withholding_pago
    ON cobros.withholding_log (pago_id) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_withholding_cobro
    ON cobros.withholding_log (cobro_id)
    WHERE cobro_id IS NOT NULL AND is_active = TRUE;

-- =====================================================================
-- §6. Historia de TC (para snapshots inmutables).
-- =====================================================================
CREATE TABLE IF NOT EXISTS cobros.fx_rate_history (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fecha         DATE NOT NULL,
    moneda_from   CHAR(3) NOT NULL,
    moneda_to     CHAR(3) NOT NULL DEFAULT 'USD',
    rate          NUMERIC(12,6) NOT NULL,
    source        VARCHAR(32) NOT NULL,
                  -- MANUAL / BCR / SBS / FIXER / ECB
    source_ref    VARCHAR(128),
    is_active     BOOLEAN DEFAULT TRUE,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_uq_fx_rate_daily
    ON cobros.fx_rate_history (fecha, moneda_from, moneda_to, source)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_fx_rate_lookup
    ON cobros.fx_rate_history (moneda_from, moneda_to, fecha DESC);

-- =====================================================================
-- §7. Log inmutable del CollectionBot (append-only).
-- =====================================================================
CREATE TABLE IF NOT EXISTS cobros.collection_event (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cobro_id          UUID NOT NULL,                         -- ⛔ sin FK
    client_id         UUID,
    canal             VARCHAR(16) NOT NULL,
                      -- EMAIL / SMS / WHATSAPP / CALL / LETTER / LEGAL
    stage             VARCHAR(32) NOT NULL,
                      -- REMINDER_T_MINUS_3 / REMINDER_D0 / DUNNING_30 /
                      -- DUNNING_60 / ESCALATED / LEGAL_FILED
    outcome           VARCHAR(32),
                      -- SENT / BOUNCED / OPENED / CLICKED / REPLIED /
                      -- PAID / PROMISE / NO_ANSWER
    dias_mora_at_event INT,
    monto_usd_at_event NUMERIC(14,2),

    template_id       UUID,
    notification_id   UUID,
    actor_type        VARCHAR(16) DEFAULT 'BOT',
                      -- BOT / USER / SYSTEM
    actor_id          UUID,
    payload_json      JSONB DEFAULT '{}'::jsonb,

    is_active         BOOLEAN DEFAULT TRUE,
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collection_cobro_fecha
    ON cobros.collection_event (cobro_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_collection_client
    ON cobros.collection_event (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_collection_stage
    ON cobros.collection_event (stage, created_at DESC);

-- =====================================================================
-- §8. Catálogo bucket_mora_cat (visualización).
-- =====================================================================
CREATE TABLE IF NOT EXISTS cobros.bucket_mora_cat (
    codigo    VARCHAR(8) PRIMARY KEY,
    label     VARCHAR(64) NOT NULL,
    dias_min  INT NOT NULL,
    dias_max  INT,
    color     VARCHAR(16),
    orden     INT DEFAULT 100,
    is_active BOOLEAN DEFAULT TRUE
);

INSERT INTO cobros.bucket_mora_cat (codigo, label, dias_min, dias_max, color, orden) VALUES
    ('T0', 'Al día',       -9999, 0,    '#00B286', 10),
    ('T1', '1–30 días',    1,     30,   '#F59E0B', 20),
    ('T2', '31–60 días',   31,    60,   '#E3A21E', 30),
    ('T3', '61–90 días',   61,    90,   '#E3461E', 40),
    ('T4', '90+ días',     91,    NULL, '#EF4444', 50)
ON CONFLICT (codigo) DO NOTHING;

-- =====================================================================
-- §9. Catálogo collection_stage_cat.
-- =====================================================================
CREATE TABLE IF NOT EXISTS cobros.collection_stage_cat (
    codigo       VARCHAR(32) PRIMARY KEY,
    label        VARCHAR(96) NOT NULL,
    descripcion  TEXT,
    dias_trigger INT,
    color        VARCHAR(16),
    orden        INT DEFAULT 100,
    is_active    BOOLEAN DEFAULT TRUE
);

INSERT INTO cobros.collection_stage_cat (codigo, label, descripcion, dias_trigger, color, orden) VALUES
    ('NONE',       'Sin gestión',              'Cuenta al día o sin historial.',       NULL, '#64748B', 10),
    ('REMINDER',   'Recordatorio amistoso',    'T-3 y D0 — correo suave.',             -3,   '#3083FE', 20),
    ('DUNNING',    'Cobranza formal',          '1–60 días — cartas + llamadas.',       1,    '#F59E0B', 30),
    ('ESCALATED',  'Escalado a cartera',       '61+ días — tercero o mandatario.',     61,   '#E3461E', 40),
    ('LEGAL',      'En proceso legal',         'Demanda / protesto / reporte crédito.',91,   '#EF4444', 50)
ON CONFLICT (codigo) DO NOTHING;

-- =====================================================================
-- Fin 81_cobros_audit.sql
-- =====================================================================
