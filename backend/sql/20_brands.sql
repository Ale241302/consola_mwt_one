-- =====================================================================
-- MWT.ONE · 20_brands.sql · MÓDULO MARCAS (portafolio comercial)
-- Agente responsable: [AG-DATABASE]
-- Schema: brands
-- =====================================================================

CREATE TABLE IF NOT EXISTS brands.marca (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre              VARCHAR(128) NOT NULL,
    slug                VARCHAR(64)  NOT NULL UNIQUE,
    pais_origen_iso2    CHAR(2)      NOT NULL,     -- core.pais_cat (lógico)
    categoria_principal VARCHAR(32)  NOT NULL,     -- MODA · CALZADO · ...
    descripcion         TEXT,
    logo_url            VARCHAR(500),
    website             VARCHAR(200),
    estado_comercial    VARCHAR(16)  NOT NULL DEFAULT 'PROSPECTO',
    fecha_firma         DATE,
    responsable_id      UUID,                       -- core.users (lógico, sin FK)
    territorios         JSONB        NOT NULL DEFAULT '[]'::jsonb,
    markup_default      NUMERIC(5,2) NOT NULL DEFAULT 2.50,
    dias_pago_default   SMALLINT     NOT NULL DEFAULT 30,
    moneda_default      CHAR(3)      NOT NULL DEFAULT 'USD',
    visibility_tier     VARCHAR(16)  NOT NULL DEFAULT 'INTERNAL',
    is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marca_estado    ON brands.marca(estado_comercial)    WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_marca_cat       ON brands.marca(categoria_principal) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_marca_pais      ON brands.marca(pais_origen_iso2);
CREATE INDEX IF NOT EXISTS idx_marca_resp      ON brands.marca(responsable_id);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION brands.tg_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_marca_updated_at ON brands.marca;
CREATE TRIGGER tg_marca_updated_at
    BEFORE UPDATE ON brands.marca
    FOR EACH ROW EXECUTE FUNCTION brands.tg_set_updated_at();

-- ── Catálogo: categoría principal ──
CREATE TABLE IF NOT EXISTS brands.categoria_cat (
    codigo VARCHAR(32) PRIMARY KEY,
    label  VARCHAR(64) NOT NULL,
    orden  SMALLINT    NOT NULL DEFAULT 0
);
INSERT INTO brands.categoria_cat (codigo, label, orden) VALUES
    ('MODA',        'Moda',           1),
    ('CALZADO',     'Calzado',        2),
    ('ACCESORIOS',  'Accesorios',     3),
    ('HOME',        'Home & Living',  4),
    ('BELLEZA',     'Belleza',        5),
    ('DEPORTE',     'Deporte',        6),
    ('INFANTIL',    'Infantil',       7)
ON CONFLICT (codigo) DO NOTHING;

-- ── Catálogo: estado comercial ──
CREATE TABLE IF NOT EXISTS brands.estado_cat (
    codigo VARCHAR(16) PRIMARY KEY,
    label  VARCHAR(64) NOT NULL,
    color  VARCHAR(16),
    orden  SMALLINT    NOT NULL DEFAULT 0
);
INSERT INTO brands.estado_cat (codigo, label, color, orden) VALUES
    ('PROSPECTO', 'Prospecto', '#3083FE', 1),
    ('ACTIVO',    'Activa',    '#00B286', 2),
    ('PAUSADO',   'Pausada',   '#B45309', 3),
    ('CERRADO',   'Cerrada',   '#64748B', 4)
ON CONFLICT (codigo) DO NOTHING;
