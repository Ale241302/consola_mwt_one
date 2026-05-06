-- ============================================================
-- MWT.ONE · B7_finance_ai_verdict.sql
-- Agente responsable: [AG-DATABASE]
--
-- Fase 3 — extiende el schema `finance` con la tabla
-- `payment_ai_verdict`, donde el AIPaymentAnalyzer
-- (apps.ai_hub.payment_analyzer) persiste el resultado de
-- analizar el comprobante con Claude.
--
-- Idempotente. Asume que B6_finance_v2.sql ya corrió.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS finance;

SET search_path = finance, public;

-- ────────────────────────────────────────────────────────────
-- Catálogo de status del verdict IA
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS finance.ai_verdict_status_cat (
    codigo     VARCHAR(16)  PRIMARY KEY,
    label      VARCHAR(96)  NOT NULL,
    color      VARCHAR(16),
    severity   INTEGER      NOT NULL DEFAULT 0,         -- 0 OK / 1 PARTIAL / 2 NEEDS / 3 SUSPECT
    orden      INTEGER      NOT NULL DEFAULT 100,
    is_active  BOOLEAN      NOT NULL DEFAULT TRUE
);

INSERT INTO finance.ai_verdict_status_cat(codigo, label, color, severity, orden) VALUES
    ('MATCH',      'Match — todo coincide',                    '#00B286', 0, 10),
    ('PARTIAL',    'Match parcial — campos secundarios divergen','#10B981', 1, 20),
    ('MISMATCH',   'Mismatch — campos clave divergen',           '#F59E0B', 2, 30),
    ('UNREADABLE', 'Comprobante ilegible',                       '#94A3B8', 2, 40),
    ('SUSPICIOUS', 'Sospechoso — posible fraude',                '#EF4444', 3, 50)
ON CONFLICT (codigo) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- payment_ai_verdict · resultado del AIPaymentAnalyzer
-- (one-to-one con finance.payment, append-once: cada re-análisis
-- crea una fila nueva con `is_current=TRUE` y desmarca la previa)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS finance.payment_ai_verdict (
    id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id            UUID          NOT NULL,                    -- FK lógico → finance.payment
    is_current            BOOLEAN       NOT NULL DEFAULT TRUE,        -- el último verdict; sólo 1 por pago
    status                VARCHAR(16)   NOT NULL,                    -- MATCH / PARTIAL / MISMATCH / UNREADABLE / SUSPICIOUS
    confianza             NUMERIC(5,2)  NOT NULL CHECK (confianza >= 0 AND confianza <= 100),
    monto_extraido        NUMERIC(14,2),
    moneda_extraida       CHAR(3),
    fecha_extraida        DATE,
    referencia_extraida   VARCHAR(128),
    beneficiario_extraido VARCHAR(255),
    ordenante_extraido    VARCHAR(255),
    banco_emisor          VARCHAR(255),
    banco_receptor        VARCHAR(255),
    concepto              TEXT,
    mismatch_fields       JSONB         NOT NULL DEFAULT '[]'::jsonb,
    razon_humana          TEXT          NOT NULL,
    alertas_fraude        JSONB         NOT NULL DEFAULT '[]'::jsonb,
    raw_claude_response   JSONB         NOT NULL DEFAULT '{}'::jsonb, -- auditoría / disputas
    model_version         VARCHAR(64)   NOT NULL,                    -- ej. "claude-opus-4-7"
    skill_version         VARCHAR(16),                                -- versión del SKILL_PAGOS_AI_ANALYZER
    duration_ms           INTEGER,                                    -- latencia de la llamada
    tokens_input          INTEGER,
    tokens_output         INTEGER,
    cost_usd              NUMERIC(10,6),
    error_code            VARCHAR(64),                                -- null si ok
    error_message         TEXT,
    analyzed_at           TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pav_payment_idx     ON finance.payment_ai_verdict (payment_id);
CREATE INDEX IF NOT EXISTS pav_status_idx      ON finance.payment_ai_verdict (status);
CREATE INDEX IF NOT EXISTS pav_analyzed_at_idx ON finance.payment_ai_verdict (analyzed_at DESC);

-- Sólo 1 verdict marcado como current por payment
CREATE UNIQUE INDEX IF NOT EXISTS pav_current_uniq
    ON finance.payment_ai_verdict (payment_id)
    WHERE is_current = TRUE;

-- ────────────────────────────────────────────────────────────
-- Trigger: cuando se inserta un verdict nuevo con is_current=TRUE,
-- desmarcar el anterior (lock contention mínimo: la PK + filtro
-- parcial nos da O(1) en condiciones normales).
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION finance.tg_pav_unset_previous() RETURNS trigger AS $$
BEGIN
    IF NEW.is_current = TRUE THEN
        UPDATE finance.payment_ai_verdict
           SET is_current = FALSE
         WHERE payment_id = NEW.payment_id
           AND is_current = TRUE
           AND id <> NEW.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_pav_unset_previous ON finance.payment_ai_verdict;
CREATE TRIGGER tg_pav_unset_previous
    BEFORE INSERT ON finance.payment_ai_verdict
    FOR EACH ROW EXECUTE FUNCTION finance.tg_pav_unset_previous();

-- ============================================================
-- FIN B7_finance_ai_verdict.sql
-- ============================================================
