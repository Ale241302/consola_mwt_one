-- ============================================================
-- MWT.ONE · 70_expedientes.sql
-- Agente responsable: [AG-DATABASE]
--
-- OC (orden de compra cliente) + Expediente (viaje logístico) +
-- Línea (SKU asignado a expediente) + Documento (artefacto).
-- Cero FKs gestionadas por Postgres — vínculos por UUID en ORM.
-- Idempotente.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS expedientes;

SET search_path = expedientes, public;

-- ────────────────────────────────────────────────────────────
-- CATÁLOGOS
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expedientes.estado_oc_cat (
    codigo     VARCHAR(32)  PRIMARY KEY,
    label      VARCHAR(64)  NOT NULL,
    color      VARCHAR(16),
    orden      INTEGER      NOT NULL DEFAULT 100,
    is_active  BOOLEAN      NOT NULL DEFAULT TRUE
);

INSERT INTO expedientes.estado_oc_cat(codigo, label, color, orden) VALUES
    ('BORRADOR',            'Borrador',                '#64748B', 10),
    ('EMITIDA',             'Emitida',                 '#3083FE', 20),
    ('ASIGNACION_PARCIAL',  'Asignación parcial SAP',  '#F59E0B', 30),
    ('EN_EJECUCION',        'En ejecución',            '#00B286', 40),
    ('CERRADO',             'Cerrada',                 '#1DE394', 50),
    ('CANCELADA',           'Cancelada',               '#EF4444', 60)
ON CONFLICT (codigo) DO NOTHING;

CREATE TABLE IF NOT EXISTS expedientes.estado_expediente_cat (
    codigo     VARCHAR(32)  PRIMARY KEY,
    label      VARCHAR(64)  NOT NULL,
    color      VARCHAR(16),
    orden      INTEGER      NOT NULL DEFAULT 100,
    baseline_dias INTEGER   NOT NULL DEFAULT 10,
    is_active  BOOLEAN      NOT NULL DEFAULT TRUE
);

INSERT INTO expedientes.estado_expediente_cat(codigo, label, color, orden, baseline_dias) VALUES
    ('REGISTRO',     'Registro',       '#64748B', 10,  3),
    ('PRODUCCION',   'Producción',     '#481EE3', 20, 32),
    ('PREPARACION',  'Preparación',    '#F59E0B', 30,  8),
    ('DESPACHO',     'Despacho',       '#3083FE', 40,  5),
    ('TRANSITO',     'En tránsito',    '#0EA5E9', 50, 28),
    ('EN_DESTINO',   'En destino',     '#06B6D4', 60,  7),
    ('CERRADO',      'Cerrado',        '#1DE394', 70,  1)
ON CONFLICT (codigo) DO NOTHING;

CREATE TABLE IF NOT EXISTS expedientes.modo_operacion_cat (
    codigo     VARCHAR(16)  PRIMARY KEY,
    label      VARCHAR(64)  NOT NULL,
    descripcion TEXT,
    is_active  BOOLEAN      NOT NULL DEFAULT TRUE
);

INSERT INTO expedientes.modo_operacion_cat(codigo, label, descripcion) VALUES
    ('COMISION', 'Comisión (Modo B)', 'MWT actúa como agente — cobra comisión'),
    ('FULL',     'Full (Modo C)',     'MWT compra e importa por su cuenta')
ON CONFLICT (codigo) DO NOTHING;

CREATE TABLE IF NOT EXISTS expedientes.incoterm_cat (
    codigo     VARCHAR(8)   PRIMARY KEY,
    label      VARCHAR(64)  NOT NULL,
    descripcion TEXT,
    orden      INTEGER      NOT NULL DEFAULT 100,
    is_active  BOOLEAN      NOT NULL DEFAULT TRUE
);

INSERT INTO expedientes.incoterm_cat(codigo, label, orden) VALUES
    ('EXW', 'Ex Works',                 10),
    ('FCA', 'Free Carrier',              20),
    ('FOB', 'Free On Board',             30),
    ('CIF', 'Cost Insurance Freight',    40),
    ('CIP', 'Carriage Insurance Paid',   50),
    ('DAP', 'Delivered At Place',        60),
    ('DDP', 'Delivered Duty Paid',       70)
ON CONFLICT (codigo) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- OC (Orden de Compra Cliente)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expedientes.oc (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo              VARCHAR(32)  UNIQUE NOT NULL,                   -- PO-2026-04100
    client_id           UUID,                                            -- FK lógico → clientes.cliente
    brand_id            UUID,                                            -- FK lógico → brands.marca
    proforma            VARCHAR(32),                                     -- PF-0942
    sap                 VARCHAR(32),                                     -- SAP-502147 (principal)
    estado              VARCHAR(32)  NOT NULL DEFAULT 'EMITIDA',
    moneda              CHAR(3)      NOT NULL DEFAULT 'USD',
    issued_at           DATE,
    total_value         NUMERIC(14,2) DEFAULT 0,
    total_invoiced      NUMERIC(14,2) DEFAULT 0,
    total_paid          NUMERIC(14,2) DEFAULT 0,
    balance             NUMERIC(14,2) DEFAULT 0,
    coverage_pct        NUMERIC(5,4)  DEFAULT 0,                         -- % líneas con SAP
    lines_count         INTEGER       DEFAULT 0,
    lines_with_sap      INTEGER       DEFAULT 0,
    air_pct             NUMERIC(5,4)  DEFAULT 0,
    sea_pct             NUMERIC(5,4)  DEFAULT 0,
    credit_days_max     INTEGER       DEFAULT 0,
    credit_band         VARCHAR(16),                                     -- GREEN / AMBER / RED
    notas               TEXT,
    visibility_tier     VARCHAR(16)   NOT NULL DEFAULT 'INTERNAL',
    is_active           BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS oc_client_idx     ON expedientes.oc (client_id);
CREATE INDEX IF NOT EXISTS oc_brand_idx      ON expedientes.oc (brand_id);
CREATE INDEX IF NOT EXISTS oc_estado_idx     ON expedientes.oc (estado);
CREATE INDEX IF NOT EXISTS oc_codigo_trgm    ON expedientes.oc USING gin (codigo gin_trgm_ops);

-- ────────────────────────────────────────────────────────────
-- Expediente (viaje logístico)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expedientes.expediente (
    id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo              VARCHAR(32)   UNIQUE NOT NULL,                  -- EXP-1027
    oc_id               UUID,                                            -- FK lógico → expedientes.oc
    client_id           UUID,
    brand_id            UUID,
    sap                 VARCHAR(32),
    estado              VARCHAR(32)   NOT NULL DEFAULT 'REGISTRO',
    modo_operacion      VARCHAR(16)   NOT NULL DEFAULT 'FULL',           -- COMISION / FULL
    incoterm            VARCHAR(8),
    freight_mode        VARCHAR(8),                                      -- SEA / AIR
    dispatch_mode       VARCHAR(8),                                      -- FCL / LCL
    origin              VARCHAR(128),
    destination         VARCHAR(128),
    origin_country      CHAR(2),
    destination_country CHAR(2),
    shipment_date       DATE,
    eta                 DATE,
    container_count     INTEGER       DEFAULT 0,
    product_count       INTEGER       DEFAULT 0,

    -- Finanzas
    moneda              CHAR(3)       NOT NULL DEFAULT 'USD',
    total_cost          NUMERIC(14,2) DEFAULT 0,
    total_invoiced      NUMERIC(14,2) DEFAULT 0,
    total_paid          NUMERIC(14,2) DEFAULT 0,
    balance             NUMERIC(14,2) DEFAULT 0,
    commission_pct      NUMERIC(5,4),                                    -- solo COMISION
    dai_pct             NUMERIC(5,4),
    iva_pct             NUMERIC(5,4),
    dai_amount          NUMERIC(14,2) DEFAULT 0,
    iva_amount          NUMERIC(14,2) DEFAULT 0,
    logistic_cost       NUMERIC(14,2) DEFAULT 0,
    base_price          NUMERIC(14,2) DEFAULT 0,
    deferred_total_price NUMERIC(14,2) DEFAULT 0,
    show_deferred_to_client BOOLEAN   DEFAULT FALSE,
    projected_margin    NUMERIC(6,4),                                    -- 0.0000 – 1.0000
    real_margin         NUMERIC(6,4),
    margin_drift        NUMERIC(6,4),

    -- Pagos breakdown (snapshot)
    pg_verified         NUMERIC(14,2) DEFAULT 0,
    pg_released         NUMERIC(14,2) DEFAULT 0,
    pg_pending          NUMERIC(14,2) DEFAULT 0,
    pg_rejected         NUMERIC(14,2) DEFAULT 0,

    -- Crédito / bloqueos
    credit_days         INTEGER       DEFAULT 0,
    credit_band         VARCHAR(16),
    is_blocked          BOOLEAN       NOT NULL DEFAULT FALSE,
    block_reason        VARCHAR(128),
    block_cause         VARCHAR(32),                                     -- docs / credit_75 / …
    factory_delay       BOOLEAN       NOT NULL DEFAULT FALSE,
    artifacts_done      INTEGER       DEFAULT 0,
    artifacts_total     INTEGER       DEFAULT 6,

    -- Timing / fase
    baseline_days       INTEGER       DEFAULT 10,
    time_in_phase       INTEGER       DEFAULT 0,
    phase_ratio         NUMERIC(6,3)  DEFAULT 0,
    phase_signal        VARCHAR(16),                                     -- green / amber / red
    last_event_at       TIMESTAMPTZ,

    -- Misc
    cost_corrections    BOOLEAN       NOT NULL DEFAULT FALSE,
    proforma_reviewed   BOOLEAN       NOT NULL DEFAULT FALSE,
    notas               TEXT,
    visibility_tier     VARCHAR(16)   NOT NULL DEFAULT 'INTERNAL',
    is_active           BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS exp_oc_idx        ON expedientes.expediente (oc_id);
CREATE INDEX IF NOT EXISTS exp_client_idx    ON expedientes.expediente (client_id);
CREATE INDEX IF NOT EXISTS exp_brand_idx     ON expedientes.expediente (brand_id);
CREATE INDEX IF NOT EXISTS exp_estado_idx    ON expedientes.expediente (estado);
CREATE INDEX IF NOT EXISTS exp_blocked_idx   ON expedientes.expediente (is_blocked);
CREATE INDEX IF NOT EXISTS exp_codigo_trgm   ON expedientes.expediente USING gin (codigo gin_trgm_ops);

-- ────────────────────────────────────────────────────────────
-- Línea de OC (producto · talla · cantidad asignada a expediente/SAP)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expedientes.linea (
    id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    oc_id               UUID          NOT NULL,                          -- FK lógico → oc
    expediente_id       UUID,                                             -- FK lógico → expediente (NULL = huérfana)
    producto_id         UUID,                                             -- FK lógico → productos.producto
    sku                 VARCHAR(64),
    size                VARCHAR(16),
    qty                 NUMERIC(14,2) NOT NULL DEFAULT 0,
    unit_cost           NUMERIC(14,4) DEFAULT 0,
    unit_price          NUMERIC(14,4) DEFAULT 0,
    total_price         NUMERIC(14,2) DEFAULT 0,
    sap                 VARCHAR(32),                                     -- NULL = huérfana, sin SAP asignado
    transport_mode      VARCHAR(16),                                     -- MARITIMO / AEREO
    production_date     DATE,
    estado              VARCHAR(32)   NOT NULL DEFAULT 'PENDIENTE_SAP',
    deferred_qty        NUMERIC(14,2) DEFAULT 0,
    deferred_unit_price NUMERIC(14,4) DEFAULT 0,
    show_deferred_to_client BOOLEAN   DEFAULT FALSE,
    notas               TEXT,
    is_active           BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS linea_oc_idx       ON expedientes.linea (oc_id);
CREATE INDEX IF NOT EXISTS linea_exp_idx      ON expedientes.linea (expediente_id);
CREATE INDEX IF NOT EXISTS linea_producto_idx ON expedientes.linea (producto_id);
CREATE INDEX IF NOT EXISTS linea_sap_idx      ON expedientes.linea (sap);

-- ────────────────────────────────────────────────────────────
-- Documento (artefacto asociado a OC o Expediente)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expedientes.documento (
    id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    oc_id            UUID,                                                -- FK lógico
    expediente_id    UUID,                                                -- FK lógico
    kind             VARCHAR(64)  NOT NULL,                               -- 'OC Cliente', 'Proforma', 'BL', etc.
    codigo           VARCHAR(96),                                         -- 'ART-01 / PO-…'
    file_ext         VARCHAR(16),
    file_size_bytes  BIGINT       DEFAULT 0,
    storage_url      TEXT,                                                -- S3 / signed URL
    author           VARCHAR(128),
    fecha            DATE,
    is_active        BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS doc_oc_idx   ON expedientes.documento (oc_id);
CREATE INDEX IF NOT EXISTS doc_exp_idx  ON expedientes.documento (expediente_id);
CREATE INDEX IF NOT EXISTS doc_kind_idx ON expedientes.documento (kind);

-- ────────────────────────────────────────────────────────────
-- Triggers updated_at
-- ────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'tg_set_updated_at') THEN
    CREATE OR REPLACE FUNCTION tg_set_updated_at() RETURNS trigger AS $fn$
    BEGIN NEW.updated_at := now(); RETURN NEW; END; $fn$ LANGUAGE plpgsql;
  END IF;
END $$;

DROP TRIGGER IF EXISTS tg_oc_upd         ON expedientes.oc;
DROP TRIGGER IF EXISTS tg_exp_upd        ON expedientes.expediente;
DROP TRIGGER IF EXISTS tg_linea_upd      ON expedientes.linea;
DROP TRIGGER IF EXISTS tg_doc_upd        ON expedientes.documento;

CREATE TRIGGER tg_oc_upd    BEFORE UPDATE ON expedientes.oc         FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();
CREATE TRIGGER tg_exp_upd   BEFORE UPDATE ON expedientes.expediente FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();
CREATE TRIGGER tg_linea_upd BEFORE UPDATE ON expedientes.linea      FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();
CREATE TRIGGER tg_doc_upd   BEFORE UPDATE ON expedientes.documento  FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();
