-- ============================================================
-- MWT.ONE · B6_finance_v2.sql
-- Agente responsable: [AG-DATABASE]
--
-- Schema `finance` para el módulo "Registrar Pago" v2.0:
-- valida comprobantes con IA, dispara email a info@mwt.one
-- y libera crédito automáticamente cuando el verdict matchea.
--
-- Fase 2 sólo crea las tablas y las llena con catálogos.
-- La integración Claude (AIPaymentAnalyzer) y el envío de
-- email se enchufan en Fase 3 / Fase 4.
--
-- Cero FKs gestionadas por Postgres — vínculos por UUID
-- al estilo del resto del repo (cobros / expedientes / etc.).
-- Idempotente: re-correr este archivo es seguro.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS finance;

SET search_path = finance, public;

-- ────────────────────────────────────────────────────────────
-- Catálogos (alineados a apps.finance.enums)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS finance.metodo_cat (
    codigo     VARCHAR(32)  PRIMARY KEY,
    label      VARCHAR(64)  NOT NULL,
    requires_evidence BOOLEAN NOT NULL DEFAULT TRUE,
    orden      INTEGER      NOT NULL DEFAULT 100,
    is_active  BOOLEAN      NOT NULL DEFAULT TRUE
);

INSERT INTO finance.metodo_cat(codigo, label, requires_evidence, orden) VALUES
    ('TRANSFERENCIA_BANCARIA', 'Transferencia bancaria', TRUE,  10),
    ('NOTA_CREDITO',           'Nota de crédito',        TRUE,  20)
ON CONFLICT (codigo) DO NOTHING;

CREATE TABLE IF NOT EXISTS finance.tipo_pago_cat (
    codigo     VARCHAR(16)  PRIMARY KEY,
    label      VARCHAR(64)  NOT NULL,
    orden      INTEGER      NOT NULL DEFAULT 100,
    is_active  BOOLEAN      NOT NULL DEFAULT TRUE
);

INSERT INTO finance.tipo_pago_cat(codigo, label, orden) VALUES
    ('PARCIAL',  'Pago parcial',  10),
    ('COMPLETO', 'Pago completo', 20)
ON CONFLICT (codigo) DO NOTHING;

CREATE TABLE IF NOT EXISTS finance.estado_pago_cat (
    codigo     VARCHAR(32)  PRIMARY KEY,
    label      VARCHAR(64)  NOT NULL,
    color      VARCHAR(16),
    orden      INTEGER      NOT NULL DEFAULT 100,
    is_active  BOOLEAN      NOT NULL DEFAULT TRUE
);

INSERT INTO finance.estado_pago_cat(codigo, label, color, orden) VALUES
    ('PENDIENTE_AI',      'Pendiente análisis IA',     '#64748B', 10),
    ('CONFIRMADO_AI',     'Confirmado por IA',         '#00B286', 20),
    ('NEEDS_REVIEW',      'Requiere revisión humana',  '#F59E0B', 30),
    ('CONFIRMADO_HUMANO', 'Confirmado por revisor',    '#10B981', 40),
    ('RECHAZADO',         'Rechazado',                 '#EF4444', 50),
    ('REVERTIDO',         'Revertido',                 '#94A3B8', 60)
ON CONFLICT (codigo) DO NOTHING;

CREATE TABLE IF NOT EXISTS finance.applicable_type_cat (
    codigo     VARCHAR(16)  PRIMARY KEY,
    label      VARCHAR(64)  NOT NULL,
    orden      INTEGER      NOT NULL DEFAULT 100,
    is_active  BOOLEAN      NOT NULL DEFAULT TRUE
);

INSERT INTO finance.applicable_type_cat(codigo, label, orden) VALUES
    ('COSTO',    'Costo',    10),
    ('PRODUCTO', 'Producto', 20),
    ('PROFORMA', 'Proforma', 30),
    ('FACTURA',  'Factura',  40)
ON CONFLICT (codigo) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- Payment · transacción contable atómica
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS finance.payment (
    id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo              VARCHAR(32)   UNIQUE NOT NULL,                    -- PAY-2026-00001
    expediente_id       UUID,                                              -- FK lógico → expedientes.files
    client_id           UUID,                                              -- FK lógico → clientes.accounts (denormalizado)
    monto               NUMERIC(14,2) NOT NULL CHECK (monto > 0),
    moneda              CHAR(3)       NOT NULL DEFAULT 'USD',
    tasa_cambio_a_usd   NUMERIC(12,6) NOT NULL DEFAULT 1,
    monto_usd           NUMERIC(14,2) GENERATED ALWAYS AS (monto * tasa_cambio_a_usd) STORED,
    fecha               DATE          NOT NULL,                            -- fecha de la operación bancaria
    metodo              VARCHAR(32)   NOT NULL,                            -- TRANSFERENCIA_BANCARIA / NOTA_CREDITO
    tipo_pago           VARCHAR(16)   NOT NULL,                            -- PARCIAL / COMPLETO
    referencia          VARCHAR(64)   NOT NULL,
    estado              VARCHAR(32)   NOT NULL DEFAULT 'PENDIENTE_AI',
    notas               TEXT,
    created_by          UUID,                                              -- FK lógico → core.users
    confirmed_at        TIMESTAMPTZ,
    confirmed_by        UUID,                                              -- nullable; null si fue IA
    reverted_at         TIMESTAMPTZ,
    reverted_by         UUID,
    reverted_reason     TEXT,
    event_id            UUID          UNIQUE NOT NULL DEFAULT gen_random_uuid(),  -- idempotencia
    metadata            JSONB         NOT NULL DEFAULT '{}'::jsonb,
    is_active           BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- (referencia, metodo, expediente_id) único — evita doble-registro
CREATE UNIQUE INDEX IF NOT EXISTS payment_uniq_ref_idx
    ON finance.payment (metodo, referencia, expediente_id)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS payment_exp_idx     ON finance.payment (expediente_id);
CREATE INDEX IF NOT EXISTS payment_client_idx  ON finance.payment (client_id);
CREATE INDEX IF NOT EXISTS payment_estado_idx  ON finance.payment (estado);
CREATE INDEX IF NOT EXISTS payment_fecha_idx   ON finance.payment (fecha);
CREATE INDEX IF NOT EXISTS payment_created_idx ON finance.payment (created_at DESC);

-- ────────────────────────────────────────────────────────────
-- PaymentApplication · descomposición del pago
-- (un Payment puede aplicarse a 1+ documentos: costos, productos,
-- proformas o facturas. Σ monto_aplicado == Payment.monto)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS finance.payment_application (
    id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id          UUID          NOT NULL,                            -- FK lógico → finance.payment
    applicable_type     VARCHAR(16)   NOT NULL,                            -- COSTO / PRODUCTO / PROFORMA / FACTURA
    applicable_id       UUID          NOT NULL,                            -- FK lógico al doc destino
    applicable_code     VARCHAR(64),                                       -- denormalizado (PF-0942 etc.) para audit
    cantidad_producto   INTEGER,                                           -- sólo si applicable_type = PRODUCTO
    monto_aplicado      NUMERIC(14,2) NOT NULL CHECK (monto_aplicado > 0),
    metadata            JSONB         NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    -- Coherencia: cantidad_producto sólo si applicable_type=PRODUCTO
    CONSTRAINT payment_app_qty_chk CHECK (
        (applicable_type = 'PRODUCTO' AND cantidad_producto IS NOT NULL AND cantidad_producto > 0)
        OR
        (applicable_type <> 'PRODUCTO' AND cantidad_producto IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS payment_app_payment_idx ON finance.payment_application (payment_id);
CREATE INDEX IF NOT EXISTS payment_app_target_idx  ON finance.payment_application (applicable_type, applicable_id);

-- ────────────────────────────────────────────────────────────
-- PaymentEvidence · comprobante (PDF/imagen) en MinIO
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS finance.payment_evidence (
    id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id          UUID          UNIQUE NOT NULL,                     -- one-to-one
    bucket              VARCHAR(64)   NOT NULL DEFAULT 'mwt-one',
    object_key          TEXT          NOT NULL,                            -- finance/payments/<pay>/<uuid>-name
    mime_type           VARCHAR(64)   NOT NULL,
    size_bytes          BIGINT        NOT NULL CHECK (size_bytes >= 0),
    sha256              CHAR(64),                                          -- antifraude / dedup
    original_name       VARCHAR(255),
    uploaded_by         UUID,
    uploaded_at         TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_evidence_payment_idx ON finance.payment_evidence (payment_id);
CREATE INDEX IF NOT EXISTS payment_evidence_sha_idx     ON finance.payment_evidence (sha256);

-- ────────────────────────────────────────────────────────────
-- ActivityLog · audit append-only del módulo finance
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS finance.activity_log (
    id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id        UUID,                                                  -- FK lógico → core.users
    actor_role      VARCHAR(32),                                           -- snapshot del rol al momento del evento
    action          VARCHAR(64)   NOT NULL,                                -- payment.registered / .verdict / .confirmed / .reverted ...
    target_type     VARCHAR(32)   NOT NULL,                                -- payment / payment_application / payment_evidence
    target_id       UUID          NOT NULL,
    payload_diff    JSONB         NOT NULL DEFAULT '{}'::jsonb,
    metadata        JSONB         NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_log_target_idx ON finance.activity_log (target_type, target_id);
CREATE INDEX IF NOT EXISTS activity_log_actor_idx  ON finance.activity_log (actor_id);
CREATE INDEX IF NOT EXISTS activity_log_action_idx ON finance.activity_log (action);
CREATE INDEX IF NOT EXISTS activity_log_created_idx ON finance.activity_log (created_at DESC);

-- ────────────────────────────────────────────────────────────
-- Append-only: bloqueamos UPDATE/DELETE en activity_log
-- (Postgres no tiene un "INSERT-ONLY" nativo; usamos un trigger)
-- ────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'finance_activity_log_immutable') THEN
    CREATE OR REPLACE FUNCTION finance_activity_log_immutable() RETURNS trigger AS $fn$
    BEGIN
      RAISE EXCEPTION 'finance.activity_log is append-only (% blocked)', TG_OP;
    END; $fn$ LANGUAGE plpgsql;
  END IF;
END $$;

DROP TRIGGER IF EXISTS tg_activity_log_no_update ON finance.activity_log;
DROP TRIGGER IF EXISTS tg_activity_log_no_delete ON finance.activity_log;

CREATE TRIGGER tg_activity_log_no_update
    BEFORE UPDATE ON finance.activity_log
    FOR EACH ROW EXECUTE FUNCTION finance_activity_log_immutable();

CREATE TRIGGER tg_activity_log_no_delete
    BEFORE DELETE ON finance.activity_log
    FOR EACH ROW EXECUTE FUNCTION finance_activity_log_immutable();

-- ────────────────────────────────────────────────────────────
-- Triggers updated_at (reusa la función `tg_set_updated_at`
-- que ya creó 80_cobros.sql; si por alguna razón corremos este
-- archivo solo, la creamos defensivamente)
-- ────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'tg_set_updated_at') THEN
    CREATE OR REPLACE FUNCTION tg_set_updated_at() RETURNS trigger AS $fn$
    BEGIN NEW.updated_at := now(); RETURN NEW; END; $fn$ LANGUAGE plpgsql;
  END IF;
END $$;

DROP TRIGGER IF EXISTS tg_finance_payment_upd ON finance.payment;
CREATE TRIGGER tg_finance_payment_upd BEFORE UPDATE ON finance.payment
    FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- ────────────────────────────────────────────────────────────
-- Sequence + helper para generar `codigo` (PAY-YYYY-#####)
-- Lo llamamos desde Python (PaymentService.register), no desde
-- DEFAULT, para que el código quede legible en logs y errores.
-- ────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS finance.payment_codigo_seq START WITH 1 INCREMENT BY 1;

CREATE OR REPLACE FUNCTION finance.next_payment_codigo() RETURNS VARCHAR AS $$
DECLARE
    n BIGINT;
    yr INT := EXTRACT(YEAR FROM now())::INT;
BEGIN
    n := nextval('finance.payment_codigo_seq');
    RETURN 'PAY-' || yr::TEXT || '-' || LPAD(n::TEXT, 5, '0');
END; $$ LANGUAGE plpgsql;

-- ============================================================
-- FIN B6_finance_v2.sql
-- ============================================================
