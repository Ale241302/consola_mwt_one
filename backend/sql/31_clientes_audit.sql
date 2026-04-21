-- ============================================================
-- MWT.ONE · 31_clientes_audit.sql
-- Agente responsable: [AG-DATABASE]
--
-- Correcciones derivadas de la auditoría Bloque 2 del Módulo 8
-- (Clientes). Cubre 3 catálogos para dropdowns del FE + tabla
-- credit_snapshot para histórico auditable del semáforo de crédito.
--
-- Reglas: PK UUID, CERO FK, is_active, created_at + updated_at
-- + trigger, IF NOT EXISTS.
-- ============================================================

SET search_path = clientes, public;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'tg_set_updated_at') THEN
    CREATE OR REPLACE FUNCTION tg_set_updated_at() RETURNS trigger AS $fn$
    BEGIN NEW.updated_at := now(); RETURN NEW; END; $fn$ LANGUAGE plpgsql;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 1. clientes.canal_cat  ·  canales de venta (alimenta select).
--    (93_schema_extensions.sql §4 introdujo la columna `canal` ya;
--    este catálogo es la fuente de verdad para el dropdown.)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clientes.canal_cat (
    codigo     VARCHAR(32)  PRIMARY KEY,
    label      VARCHAR(96)  NOT NULL,
    orden      INTEGER      NOT NULL DEFAULT 100,
    is_active  BOOLEAN      NOT NULL DEFAULT TRUE
);

INSERT INTO clientes.canal_cat (codigo, label, orden) VALUES
    ('DIRECTO',      'Directo',         10),
    ('DISTRIBUIDOR', 'Distribuidor',    20),
    ('RETAIL',       'Retail',          30),
    ('OEM',          'OEM',             40),
    ('MARKETPLACE',  'Marketplace',     50),
    ('EXPORT',       'Exportación',     60)
ON CONFLICT (codigo) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 2. clientes.medio_pago_cat  ·  catálogo de medios de pago.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clientes.medio_pago_cat (
    codigo     VARCHAR(48)  PRIMARY KEY,
    label      VARCHAR(96)  NOT NULL,
    orden      INTEGER      NOT NULL DEFAULT 100,
    is_active  BOOLEAN      NOT NULL DEFAULT TRUE
);

INSERT INTO clientes.medio_pago_cat (codigo, label, orden) VALUES
    ('TRANSFER',     'Transferencia bancaria',    10),
    ('CREDITO',      'Crédito',                   20),
    ('CONTADO',      'Contado',                   30),
    ('CHEQUE',       'Cheque',                    40),
    ('TARJETA',      'Tarjeta',                   50),
    ('LETRA',        'Letra de cambio',           60),
    ('CARTA_CREDITO','Carta de crédito',          70)
ON CONFLICT (codigo) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 3. clientes.incoterm_cat  ·  incoterms aplicables a clientes.
--    (Existe en proveedores.incoterm_cat también — replicado por
--    módulo para independencia de dominio; ambos se seedean igual.)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clientes.incoterm_cat (
    codigo      VARCHAR(8)   PRIMARY KEY,
    label       VARCHAR(64)  NOT NULL,
    descripcion TEXT,
    orden       INTEGER      NOT NULL DEFAULT 100,
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE
);

INSERT INTO clientes.incoterm_cat (codigo, label, orden) VALUES
    ('EXW', 'EXW · Ex Works',             10),
    ('FCA', 'FCA · Free Carrier',         20),
    ('FOB', 'FOB · Free On Board',        30),
    ('CIF', 'CIF · Cost Insurance Freight',40),
    ('CIP', 'CIP · Carriage Insurance Paid',50),
    ('DAP', 'DAP · Delivered At Place',   60),
    ('DDP', 'DDP · Delivered Duty Paid',  70)
ON CONFLICT (codigo) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 4. clientes.cliente_credit_snapshot  ·  histórico auditable
--    del semáforo de crédito. Cada cálculo de `refresh-credit`
--    (endpoint @action) inserta una fila acá. Permite responder
--    "¿cómo evolucionó la disponibilidad de este cliente en 90 días?"
--    y auditar decisiones del CollectionBot.
--
--    Un snapshot por (cliente_id, snapshot_date) — si se recalcula
--    el mismo día se hace UPDATE in-place (via upsert del backend).
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clientes.cliente_credit_snapshot (
    id                    UUID PRIMARY KEY,
    cliente_id            UUID           NOT NULL,               -- ⛔ sin FK
    snapshot_date         DATE           NOT NULL DEFAULT CURRENT_DATE,

    credito_aprobado      NUMERIC(14,2)  NOT NULL DEFAULT 0,
    credito_usado         NUMERIC(14,2)  NOT NULL DEFAULT 0,
    credito_disponible    NUMERIC(14,2)  NOT NULL DEFAULT 0,
    tasa_utilizacion      NUMERIC(5,2)   NOT NULL DEFAULT 0,     -- 0..100
    dias_mora_max         INTEGER        NOT NULL DEFAULT 0,
    facturas_vencidas     INTEGER        NOT NULL DEFAULT 0,
    monto_vencido_usd     NUMERIC(14,2)  NOT NULL DEFAULT 0,

    estado_semaforo       VARCHAR(16)    NOT NULL DEFAULT 'VERDE',
                          -- VERDE / AMBAR / ROJO / BLOQUEADO
    motivo                TEXT,
    calculo_json          JSONB          NOT NULL DEFAULT '{}'::jsonb,
                          -- breakdown del cálculo (expedientes abiertos, vencidos, etc.)

    triggered_by          UUID,                                  -- ⛔ sin FK
    source                VARCHAR(32)    NOT NULL DEFAULT 'MANUAL',
                          -- MANUAL / SCHEDULED_JOB / COLLECTION_BOT / API

    is_active             BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_cliente_credit_snap_day
    ON clientes.cliente_credit_snapshot (cliente_id, snapshot_date)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS ix_credit_snap_cliente    ON clientes.cliente_credit_snapshot(cliente_id);
CREATE INDEX IF NOT EXISTS ix_credit_snap_date       ON clientes.cliente_credit_snapshot(snapshot_date DESC);
CREATE INDEX IF NOT EXISTS ix_credit_snap_semaforo   ON clientes.cliente_credit_snapshot(estado_semaforo);
CREATE INDEX IF NOT EXISTS ix_credit_snap_source     ON clientes.cliente_credit_snapshot(source);

DROP TRIGGER IF EXISTS trg_credit_snap_updated_at ON clientes.cliente_credit_snapshot;
CREATE TRIGGER trg_credit_snap_updated_at
BEFORE UPDATE ON clientes.cliente_credit_snapshot
FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- ============================================================
