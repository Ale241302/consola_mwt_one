-- ============================================================
-- MWT.ONE · 50_proveedores.sql
-- Agente responsable: [AG-DATABASE]
--
-- Catálogo de proveedores (fabricantes / importadores / distribuidores).
-- Sin FKs gestionadas. Idempotente.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS proveedores;

SET search_path = proveedores, public;

-- ────────────────────────────────────────────────────────────
-- CATÁLOGOS
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS proveedores.tipo_cat (
    codigo     VARCHAR(24)  PRIMARY KEY,
    label      VARCHAR(48)  NOT NULL,
    color      VARCHAR(16),
    orden      INTEGER      NOT NULL DEFAULT 100,
    is_active  BOOLEAN      NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS proveedores.estado_cat (
    codigo     VARCHAR(16)  PRIMARY KEY,
    label      VARCHAR(48)  NOT NULL,
    color      VARCHAR(16),
    orden      INTEGER      NOT NULL DEFAULT 100,
    is_active  BOOLEAN      NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS proveedores.incoterm_cat (
    codigo     VARCHAR(8)   PRIMARY KEY,
    label      VARCHAR(64)  NOT NULL,
    descripcion TEXT,
    orden      INTEGER      NOT NULL DEFAULT 100,
    is_active  BOOLEAN      NOT NULL DEFAULT TRUE
);

INSERT INTO proveedores.tipo_cat(codigo, label, color, orden) VALUES
    ('FABRICANTE',   'Fabricante',   '#481EE3', 10),
    ('IMPORTADOR',   'Importador',   '#3083FE', 20),
    ('DISTRIBUIDOR', 'Distribuidor', '#1EE3D7', 30),
    ('LOCAL',        'Proveedor local', '#00B286', 40)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO proveedores.estado_cat(codigo, label, color, orden) VALUES
    ('ACTIVO',     'Activo',     '#00B286', 10),
    ('PROSPECTO',  'Prospecto',  '#3083FE', 20),
    ('PAUSADO',    'Pausado',    '#F59E0B', 30),
    ('INACTIVO',   'Inactivo',   '#6B7280', 40),
    ('BLOQUEADO',  'Bloqueado',  '#EF4444', 50)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO proveedores.incoterm_cat(codigo, label, descripcion, orden) VALUES
    ('EXW', 'EXW · Ex Works',                'Comprador asume todo desde la fábrica', 10),
    ('FCA', 'FCA · Free Carrier',            'Vendedor entrega al transportista designado', 20),
    ('FOB', 'FOB · Free On Board',           'Vendedor entrega a bordo del buque',     30),
    ('CIF', 'CIF · Cost Insurance Freight',  'Vendedor cubre costo + seguro + flete',  40),
    ('CIP', 'CIP · Carriage Insurance Paid', 'Como CIF para cualquier modo de transporte', 50),
    ('DAP', 'DAP · Delivered At Place',      'Vendedor entrega en lugar acordado',     60),
    ('DDP', 'DDP · Delivered Duty Paid',     'Vendedor cubre todo, incluso aduana',    70)
ON CONFLICT (codigo) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- TABLA PRINCIPAL
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS proveedores.proveedor (
    id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo               VARCHAR(32)  UNIQUE,
    razon_social         VARCHAR(192) NOT NULL,
    nombre_comercial     VARCHAR(160),
    tax_id               VARCHAR(48),
    tipo                 VARCHAR(24)  NOT NULL DEFAULT 'FABRICANTE',
    estado               VARCHAR(16)  NOT NULL DEFAULT 'PROSPECTO',

    pais_iso2            CHAR(2),
    ciudad               VARCHAR(96),
    direccion            TEXT,
    zona_horaria         VARCHAR(64),

    contacto_nombre      VARCHAR(96),
    contacto_email       CITEXT,
    contacto_tel         VARCHAR(32),
    web                  VARCHAR(160),

    moneda_default       CHAR(3)      NOT NULL DEFAULT 'USD',
    incoterm_default     VARCHAR(8)   NOT NULL DEFAULT 'EXW',
    lead_time_dias       INTEGER      NOT NULL DEFAULT 0,
    moq                  NUMERIC(14,3) NOT NULL DEFAULT 0,
    condiciones_pago     VARCHAR(96),
    dias_credito         INTEGER      NOT NULL DEFAULT 0,

    rating               NUMERIC(3,2) NOT NULL DEFAULT 0,    -- 0..5
    nps                  INTEGER,                            -- -100..100
    notas_internas       TEXT,
    categorias           JSONB        NOT NULL DEFAULT '[]'::jsonb,
    certificaciones      JSONB        NOT NULL DEFAULT '[]'::jsonb,

    responsable_id       UUID,                               -- ⛔ sin FK
    visibility_tier      VARCHAR(16)  NOT NULL DEFAULT 'INTERNAL',

    is_active            BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    UNIQUE (tax_id, pais_iso2)
);

CREATE INDEX IF NOT EXISTS ix_prov_estado ON proveedores.proveedor(estado);
CREATE INDEX IF NOT EXISTS ix_prov_tipo   ON proveedores.proveedor(tipo);
CREATE INDEX IF NOT EXISTS ix_prov_pais   ON proveedores.proveedor(pais_iso2);
CREATE INDEX IF NOT EXISTS ix_prov_responsable ON proveedores.proveedor(responsable_id);
CREATE INDEX IF NOT EXISTS ix_prov_razon_trgm
    ON proveedores.proveedor USING gin (razon_social gin_trgm_ops);

DROP TRIGGER IF EXISTS tg_proveedor_updated ON proveedores.proveedor;
CREATE TRIGGER tg_proveedor_updated
    BEFORE UPDATE ON proveedores.proveedor
    FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
