-- ============================================================
-- MWT.ONE · 80_cobros.sql
-- Agente responsable: [AG-DATABASE]
--
-- Pagos entrantes (cliente → MWT), cobros (agrupan pagos),
-- pagos egresados (MWT → proveedor), conciliación.
-- Cero FKs gestionadas por Postgres — vínculos por UUID en ORM.
-- Idempotente.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS cobros;

SET search_path = cobros, public;

-- ────────────────────────────────────────────────────────────
-- CATÁLOGOS
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cobros.metodo_cat (
    codigo     VARCHAR(32)  PRIMARY KEY,
    label      VARCHAR(64)  NOT NULL,
    direccion  CHAR(1)      NOT NULL DEFAULT '=' CHECK (direccion IN ('+', '-', '=')),  -- + entrante, - saliente
    orden      INTEGER      NOT NULL DEFAULT 100,
    is_active  BOOLEAN      NOT NULL DEFAULT TRUE
);

INSERT INTO cobros.metodo_cat(codigo, label, direccion, orden) VALUES
    ('TRANSFERENCIA',     'Transferencia bancaria',  '=', 10),
    ('WIRE_SWIFT',        'Wire / SWIFT',            '=', 20),
    ('ACH',               'ACH local',               '=', 30),
    ('CHEQUE',            'Cheque',                  '=', 40),
    ('LETRA_CAMBIO',      'Letra de cambio',         '=', 50),
    ('TARJETA_CREDITO',   'Tarjeta de crédito',      '+', 60),
    ('CREDITO_CARTA',     'Carta de crédito',        '=', 70),
    ('EFECTIVO',          'Efectivo',                '=', 80),
    ('COMPENSACION',      'Compensación / Netting', '=', 90)
ON CONFLICT (codigo) DO NOTHING;

CREATE TABLE IF NOT EXISTS cobros.estado_pago_cat (
    codigo     VARCHAR(32)  PRIMARY KEY,
    label      VARCHAR(64)  NOT NULL,
    color      VARCHAR(16),
    orden      INTEGER      NOT NULL DEFAULT 100,
    is_active  BOOLEAN      NOT NULL DEFAULT TRUE
);

INSERT INTO cobros.estado_pago_cat(codigo, label, color, orden) VALUES
    ('PENDIENTE',   'Pendiente',              '#64748B', 10),
    ('VERIFICADO',  'Verificado',             '#3083FE', 20),
    ('LIBERADO',    'Liberado',               '#00B286', 30),
    ('RECHAZADO',   'Rechazado',              '#EF4444', 40),
    ('REVERTIDO',   'Revertido',              '#F59E0B', 50),
    ('CONCILIADO',  'Conciliado',             '#1DE394', 60)
ON CONFLICT (codigo) DO NOTHING;

CREATE TABLE IF NOT EXISTS cobros.direccion_cat (
    codigo     VARCHAR(16)  PRIMARY KEY,
    label      VARCHAR(64)  NOT NULL,
    is_active  BOOLEAN      NOT NULL DEFAULT TRUE
);

INSERT INTO cobros.direccion_cat(codigo, label) VALUES
    ('INGRESO', 'Ingreso (cliente → MWT)'),
    ('EGRESO',  'Egreso (MWT → proveedor)')
ON CONFLICT (codigo) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- Cobro (agrupador — expediente o OC pueden tener múltiples pagos)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cobros.cobro (
    id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo              VARCHAR(32)   UNIQUE NOT NULL,                   -- CBR-2026-0001
    oc_id               UUID,                                             -- FK lógico → expedientes.oc
    expediente_id       UUID,                                             -- FK lógico → expedientes.expediente
    client_id           UUID,
    moneda              CHAR(3)       NOT NULL DEFAULT 'USD',
    monto_total         NUMERIC(14,2) NOT NULL DEFAULT 0,
    monto_pagado        NUMERIC(14,2) NOT NULL DEFAULT 0,
    monto_pendiente     NUMERIC(14,2) GENERATED ALWAYS AS (GREATEST(monto_total - monto_pagado, 0)) STORED,
    fecha_vencimiento   DATE,
    dias_credito        INTEGER       DEFAULT 0,
    estado              VARCHAR(32)   NOT NULL DEFAULT 'PENDIENTE',
    notas               TEXT,
    visibility_tier     VARCHAR(16)   NOT NULL DEFAULT 'INTERNAL',
    is_active           BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cobro_exp_idx     ON cobros.cobro (expediente_id);
CREATE INDEX IF NOT EXISTS cobro_oc_idx      ON cobros.cobro (oc_id);
CREATE INDEX IF NOT EXISTS cobro_client_idx  ON cobros.cobro (client_id);
CREATE INDEX IF NOT EXISTS cobro_estado_idx  ON cobros.cobro (estado);
CREATE INDEX IF NOT EXISTS cobro_venc_idx    ON cobros.cobro (fecha_vencimiento);

-- ────────────────────────────────────────────────────────────
-- Pago (movimiento concreto — ingreso o egreso)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cobros.pago (
    id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo              VARCHAR(32)   UNIQUE NOT NULL,                   -- PAG-2026-00001
    direccion           VARCHAR(16)   NOT NULL DEFAULT 'INGRESO',        -- INGRESO / EGRESO
    cobro_id            UUID,                                             -- agrupador (null si egreso directo)
    oc_id               UUID,                                             -- FK lógico
    expediente_id       UUID,                                             -- FK lógico
    client_id           UUID,                                             -- si INGRESO
    proveedor_id        UUID,                                             -- si EGRESO
    metodo              VARCHAR(32)   NOT NULL DEFAULT 'TRANSFERENCIA',
    referencia_externa  VARCHAR(128),                                    -- SWIFT, n° tx, ACH, etc.
    banco_origen        VARCHAR(96),
    banco_destino       VARCHAR(96),
    moneda              CHAR(3)       NOT NULL DEFAULT 'USD',
    monto               NUMERIC(14,2) NOT NULL DEFAULT 0,
    fx_rate             NUMERIC(12,6) DEFAULT 1,
    monto_usd           NUMERIC(14,2) NOT NULL DEFAULT 0,
    estado              VARCHAR(32)   NOT NULL DEFAULT 'PENDIENTE',
    fecha_operacion     DATE,
    fecha_acreditacion  DATE,
    verificado_at       TIMESTAMPTZ,
    verificado_by       UUID,                                             -- FK lógico → auth_user
    liberado_at         TIMESTAMPTZ,
    conciliado_at       TIMESTAMPTZ,
    comprobante_url     TEXT,
    notas               TEXT,
    visibility_tier     VARCHAR(16)   NOT NULL DEFAULT 'INTERNAL',
    is_active           BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pago_cobro_idx      ON cobros.pago (cobro_id);
CREATE INDEX IF NOT EXISTS pago_exp_idx        ON cobros.pago (expediente_id);
CREATE INDEX IF NOT EXISTS pago_oc_idx         ON cobros.pago (oc_id);
CREATE INDEX IF NOT EXISTS pago_client_idx     ON cobros.pago (client_id);
CREATE INDEX IF NOT EXISTS pago_proveedor_idx  ON cobros.pago (proveedor_id);
CREATE INDEX IF NOT EXISTS pago_estado_idx     ON cobros.pago (estado);
CREATE INDEX IF NOT EXISTS pago_direccion_idx  ON cobros.pago (direccion);
CREATE INDEX IF NOT EXISTS pago_fecha_op_idx   ON cobros.pago (fecha_operacion);

-- ────────────────────────────────────────────────────────────
-- Conciliación (match entre pago entrante y egreso, o cobro)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cobros.conciliacion (
    id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    pago_ingreso_id   UUID          NOT NULL,
    pago_egreso_id    UUID,
    cobro_id          UUID,
    monto_matched     NUMERIC(14,2) NOT NULL DEFAULT 0,
    moneda            CHAR(3)       NOT NULL DEFAULT 'USD',
    notas             TEXT,
    is_active         BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conc_ingreso_idx ON cobros.conciliacion (pago_ingreso_id);
CREATE INDEX IF NOT EXISTS conc_egreso_idx  ON cobros.conciliacion (pago_egreso_id);
CREATE INDEX IF NOT EXISTS conc_cobro_idx   ON cobros.conciliacion (cobro_id);

-- ────────────────────────────────────────────────────────────
-- Triggers updated_at
-- ────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'tg_set_updated_at') THEN
    CREATE OR REPLACE FUNCTION tg_set_updated_at() RETURNS trigger AS $fn$
    BEGIN NEW.updated_at := now(); RETURN NEW; END; $fn$ LANGUAGE plpgsql;
  END IF;
END $$;

DROP TRIGGER IF EXISTS tg_cobro_upd        ON cobros.cobro;
DROP TRIGGER IF EXISTS tg_pago_upd         ON cobros.pago;
DROP TRIGGER IF EXISTS tg_conc_upd         ON cobros.conciliacion;

CREATE TRIGGER tg_cobro_upd BEFORE UPDATE ON cobros.cobro         FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();
CREATE TRIGGER tg_pago_upd  BEFORE UPDATE ON cobros.pago          FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();
CREATE TRIGGER tg_conc_upd  BEFORE UPDATE ON cobros.conciliacion  FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();
