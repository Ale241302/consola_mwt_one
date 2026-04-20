-- =====================================================================
-- MWT.ONE · 30_clientes.sql · MÓDULO CLIENTES (cuentas B2B y retail)
-- Agente responsable: [AG-DATABASE]
-- Schema: clientes
-- =====================================================================

CREATE TABLE IF NOT EXISTS clientes.cliente (
    id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    razon_social       VARCHAR(200)  NOT NULL,
    nombre_comercial   VARCHAR(160),
    tax_id             VARCHAR(32)   NOT NULL,   -- RUC · RFC · CIF · DNI
    tipo               VARCHAR(16)   NOT NULL,   -- B2B · CONSUMIDOR · DISTRIBUIDOR
    segmento           CHAR(1)       NOT NULL DEFAULT 'C',     -- A · B · C
    pais_iso2          CHAR(2)       NOT NULL,  -- core.pais_cat (lógico)
    ciudad             VARCHAR(96),
    direccion          TEXT,
    moneda             CHAR(3)       NOT NULL DEFAULT 'USD',
    credito_aprobado   NUMERIC(14,2) NOT NULL DEFAULT 0,
    credito_usado      NUMERIC(14,2) NOT NULL DEFAULT 0,
    dias_credito       SMALLINT      NOT NULL DEFAULT 0,
    contacto_nombre    VARCHAR(160),
    contacto_email     VARCHAR(160),
    contacto_tel       VARCHAR(32),
    estado             VARCHAR(16)   NOT NULL DEFAULT 'ACTIVO', -- ACTIVO · INACTIVO · BLOQUEADO
    nodo_asignado_id   UUID,    -- nodos.nodo.id (lógico, sin FK)
    responsable_id     UUID,    -- core.users.id (lógico, sin FK)
    visibility_tier    VARCHAR(16)   NOT NULL DEFAULT 'INTERNAL',
    is_active          BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    -- Un mismo tax_id puede repetirse si es de otro país
    CONSTRAINT uq_cliente_tax UNIQUE (tax_id, pais_iso2)
);

CREATE INDEX IF NOT EXISTS idx_cliente_estado     ON clientes.cliente(estado)   WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_cliente_segmento   ON clientes.cliente(segmento) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_cliente_pais       ON clientes.cliente(pais_iso2);
CREATE INDEX IF NOT EXISTS idx_cliente_nodo       ON clientes.cliente(nodo_asignado_id);
CREATE INDEX IF NOT EXISTS idx_cliente_resp       ON clientes.cliente(responsable_id);
CREATE INDEX IF NOT EXISTS idx_cliente_trgm_razon ON clientes.cliente USING gin (razon_social gin_trgm_ops);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION clientes.tg_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_cliente_updated_at ON clientes.cliente;
CREATE TRIGGER tg_cliente_updated_at
    BEFORE UPDATE ON clientes.cliente
    FOR EACH ROW EXECUTE FUNCTION clientes.tg_set_updated_at();

-- ── Catálogo: tipo ──
CREATE TABLE IF NOT EXISTS clientes.tipo_cat (
    codigo VARCHAR(16) PRIMARY KEY,
    label  VARCHAR(64) NOT NULL,
    orden  SMALLINT    NOT NULL DEFAULT 0
);
INSERT INTO clientes.tipo_cat (codigo, label, orden) VALUES
    ('B2B',         'Empresa B2B',       1),
    ('CONSUMIDOR',  'Consumidor final',  2),
    ('DISTRIBUIDOR','Distribuidor',      3)
ON CONFLICT (codigo) DO NOTHING;

-- ── Catálogo: estado ──
CREATE TABLE IF NOT EXISTS clientes.estado_cat (
    codigo VARCHAR(16) PRIMARY KEY,
    label  VARCHAR(64) NOT NULL,
    color  VARCHAR(16)
);
INSERT INTO clientes.estado_cat (codigo, label, color) VALUES
    ('ACTIVO',    'Activo',    '#00B286'),
    ('INACTIVO',  'Inactivo',  '#64748B'),
    ('BLOQUEADO', 'Bloqueado', '#DC2626')
ON CONFLICT (codigo) DO NOTHING;

-- ── Catálogo: segmento ──
CREATE TABLE IF NOT EXISTS clientes.segmento_cat (
    codigo CHAR(1)     PRIMARY KEY,
    label  VARCHAR(64) NOT NULL,
    color  VARCHAR(16)
);
INSERT INTO clientes.segmento_cat (codigo, label, color) VALUES
    ('A', 'Premium',  '#481EE3'),
    ('B', 'Medio',    '#3083FE'),
    ('C', 'Estándar', '#64748B')
ON CONFLICT (codigo) DO NOTHING;
