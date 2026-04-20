-- ============================================================
-- MWT.ONE · 92_notifications.sql
-- Agente responsable: [AG-DATABASE]
--
-- Historial de envíos de email disparados por Celery / workflow.
-- Dos tablas:
--   notifications.notification_log   — envíos generales
--   notifications.collection_email_log — enriquecido con
--     amount_overdue, grace_days_used, proforma_id para cobranza.
-- Cero FKs gestionadas por Postgres — vínculos por UUID en ORM.
-- Idempotente.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS notifications;

SET search_path = notifications, public;

-- ────────────────────────────────────────────────────────────
-- CATÁLOGOS
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications.estado_envio_cat (
    codigo     VARCHAR(32) PRIMARY KEY,
    label      VARCHAR(64) NOT NULL,
    color      VARCHAR(16),
    orden      INTEGER     NOT NULL DEFAULT 100,
    is_active  BOOLEAN     NOT NULL DEFAULT TRUE
);

INSERT INTO notifications.estado_envio_cat(codigo, label, color, orden) VALUES
    ('Sent',       'Enviado',               '#00B286', 10),
    ('Delivered',  'Entregado',             '#1DE394', 20),
    ('Skipped',    'Omitido',               '#64748B', 30),
    ('Failed',     'Falló',                 '#EF4444', 40),
    ('Exhausted',  'Reintentos agotados',   '#C2410C', 50),
    ('Disabled',   'Deshabilitado',         '#94A3B8', 60),
    ('Bounced',    'Rebotado',              '#F59E0B', 70)
ON CONFLICT (codigo) DO NOTHING;

CREATE TABLE IF NOT EXISTS notifications.trigger_cat (
    codigo     VARCHAR(32) PRIMARY KEY,
    label      VARCHAR(64) NOT NULL,
    is_active  BOOLEAN     NOT NULL DEFAULT TRUE
);

INSERT INTO notifications.trigger_cat(codigo, label) VALUES
    ('workflow_push',   'Workflow push'),
    ('cron',            'Cron'),
    ('manual',          'Envío manual'),
    ('verify_payment',  'Verificación de pago'),
    ('C1',              'Recordatorio cobranza C1'),
    ('C2',              'Aviso de vencimiento C2'),
    ('C3',              'Bloqueo comercial C3')
ON CONFLICT (codigo) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- notification_log — registro general
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications.notification_log (
    id                UUID PRIMARY KEY,
    ts                TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at      TIMESTAMPTZ,
    expediente_id     UUID,
    proforma_id       UUID,
    template_key      VARCHAR(64),
    template_id       UUID,
    recipient_email   VARCHAR(255),
    subject           VARCHAR(512),
    body_preview      TEXT,
    trigger           VARCHAR(32),
    status            VARCHAR(32) NOT NULL DEFAULT 'Sent',
    retries           INTEGER     NOT NULL DEFAULT 0,
    attempt_count     INTEGER     NOT NULL DEFAULT 1,
    error             VARCHAR(512),
    skip_reason       VARCHAR(255),
    -- Campos enriquecidos de cobranza (NULL para envíos no-cobranza)
    amount_overdue    NUMERIC(12,2),
    grace_days_used   INTEGER,
    currency          VARCHAR(8),
    is_active         BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_nlog_ts            ON notifications.notification_log(ts);
CREATE INDEX IF NOT EXISTS idx_nlog_exp           ON notifications.notification_log(expediente_id);
CREATE INDEX IF NOT EXISTS idx_nlog_tpl           ON notifications.notification_log(template_key);
CREATE INDEX IF NOT EXISTS idx_nlog_trigger       ON notifications.notification_log(trigger);
CREATE INDEX IF NOT EXISTS idx_nlog_status        ON notifications.notification_log(status);
CREATE INDEX IF NOT EXISTS idx_nlog_recipient     ON notifications.notification_log(recipient_email);
CREATE INDEX IF NOT EXISTS idx_nlog_active        ON notifications.notification_log(is_active);

-- ────────────────────────────────────────────────────────────
-- Triggers de updated_at
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION notifications.touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_nlog_upd ON notifications.notification_log;

CREATE TRIGGER tg_nlog_upd
    BEFORE UPDATE ON notifications.notification_log
    FOR EACH ROW EXECUTE FUNCTION notifications.touch_updated_at();
