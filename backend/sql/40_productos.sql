-- ============================================================
-- MWT.ONE · 40_productos.sql
-- Agente responsable: [AG-DATABASE]
--
-- Catálogo SKU-level. Cero FKs gestionadas por Postgres — los
-- vínculos (marca_id, proveedor_principal_id) se manejan en
-- el ORM por UUID plano.
-- Idempotente: se puede correr múltiples veces sin romper.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS productos;

SET search_path = productos, public;

-- ────────────────────────────────────────────────────────────
-- CATÁLOGOS (alimentan dropdowns del FE)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS productos.categoria_cat (
    codigo     VARCHAR(32)  PRIMARY KEY,
    label      VARCHAR(96)  NOT NULL,
    color      VARCHAR(16),
    orden      INTEGER      NOT NULL DEFAULT 100,
    is_active  BOOLEAN      NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS productos.subcategoria_cat (
    codigo          VARCHAR(48) PRIMARY KEY,
    categoria_code  VARCHAR(32) NOT NULL,
    label           VARCHAR(96) NOT NULL,
    orden           INTEGER     NOT NULL DEFAULT 100,
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS ix_subcategoria_cat_cat ON productos.subcategoria_cat(categoria_code);

CREATE TABLE IF NOT EXISTS productos.unidad_cat (
    codigo     VARCHAR(8)   PRIMARY KEY,
    label      VARCHAR(32)  NOT NULL,
    factor     NUMERIC(10,4) NOT NULL DEFAULT 1,
    orden      INTEGER      NOT NULL DEFAULT 100,
    is_active  BOOLEAN      NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS productos.estado_cat (
    codigo     VARCHAR(16)  PRIMARY KEY,
    label      VARCHAR(48)  NOT NULL,
    color      VARCHAR(16),
    orden      INTEGER      NOT NULL DEFAULT 100,
    is_active  BOOLEAN      NOT NULL DEFAULT TRUE
);

-- Semillas ---------------------------------------------------
INSERT INTO productos.categoria_cat(codigo, label, color, orden) VALUES
    ('CALZADO',     'Calzado',           '#481EE3', 10),
    ('ROPA',        'Ropa',              '#3083FE', 20),
    ('ACCESORIOS',  'Accesorios',        '#00B286', 30),
    ('EQUIPO',      'Equipo deportivo',  '#1EE3D7', 40),
    ('HOGAR',       'Hogar',             '#1DE394', 50),
    ('OTROS',       'Otros',             '#6B7280', 99)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO productos.subcategoria_cat(codigo, categoria_code, label, orden) VALUES
    ('CALZADO_SEGURIDAD',  'CALZADO',    'Seguridad industrial', 10),
    ('CALZADO_DEPORTIVO',  'CALZADO',    'Deportivo',            20),
    ('CALZADO_CASUAL',     'CALZADO',    'Casual',               30),
    ('ROPA_TECNICA',       'ROPA',       'Técnica',              10),
    ('ROPA_CASUAL',        'ROPA',       'Casual',               20),
    ('ACC_EPP',            'ACCESORIOS', 'EPP',                  10),
    ('ACC_GENERAL',        'ACCESORIOS', 'General',              20),
    ('EQ_FITNESS',         'EQUIPO',     'Fitness',              10),
    ('EQ_OUTDOOR',         'EQUIPO',     'Outdoor',              20)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO productos.unidad_cat(codigo, label, factor, orden) VALUES
    ('PZA', 'Pieza',         1,     10),
    ('PAR', 'Par',           1,     15),
    ('CAJ', 'Caja',          12,    20),
    ('KG',  'Kilogramo',     1,     30),
    ('L',   'Litro',         1,     40),
    ('M',   'Metro',         1,     50),
    ('M2',  'Metro cuadrado',1,     60)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO productos.estado_cat(codigo, label, color, orden) VALUES
    ('ACTIVO',         'Activo',         '#00B286', 10),
    ('INACTIVO',       'Inactivo',       '#6B7280', 20),
    ('DESCONTINUADO',  'Descontinuado',  '#EF4444', 30),
    ('PROXIMAMENTE',   'Próximamente',   '#3083FE', 40)
ON CONFLICT (codigo) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- TABLA PRINCIPAL
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS productos.producto (
    id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    sku                       VARCHAR(64) NOT NULL UNIQUE,
    nombre                    VARCHAR(160) NOT NULL,
    descripcion               TEXT,

    marca_id                  UUID,                              -- ⛔ sin FK
    categoria                 VARCHAR(32) NOT NULL DEFAULT 'OTROS',
    subcategoria              VARCHAR(48),
    unidad                    VARCHAR(8)  NOT NULL DEFAULT 'PZA',

    moneda                    CHAR(3)     NOT NULL DEFAULT 'USD',
    costo_estandar            NUMERIC(14,2) NOT NULL DEFAULT 0,
    precio_lista              NUMERIC(14,2) NOT NULL DEFAULT 0,
    precio_distribuidor       NUMERIC(14,2) NOT NULL DEFAULT 0,

    peso_kg                   NUMERIC(10,3),
    volumen_m3                NUMERIC(10,4),

    imagen_url                TEXT,
    ficha_url                 TEXT,
    tallas                    JSONB       NOT NULL DEFAULT '[]'::jsonb,
    colores                   JSONB       NOT NULL DEFAULT '[]'::jsonb,

    estado                    VARCHAR(16) NOT NULL DEFAULT 'ACTIVO',
    proveedor_principal_id    UUID,                              -- ⛔ sin FK
    pais_origen_iso2          CHAR(2),
    hs_code                   VARCHAR(16),
    stock_minimo              NUMERIC(14,3) NOT NULL DEFAULT 0,
    stock_maximo              NUMERIC(14,3) NOT NULL DEFAULT 0,

    visibility_tier           VARCHAR(16) NOT NULL DEFAULT 'INTERNAL',
    is_active                 BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_producto_marca      ON productos.producto(marca_id);
CREATE INDEX IF NOT EXISTS ix_producto_estado     ON productos.producto(estado);
CREATE INDEX IF NOT EXISTS ix_producto_categoria  ON productos.producto(categoria);
CREATE INDEX IF NOT EXISTS ix_producto_proveedor  ON productos.producto(proveedor_principal_id);
CREATE INDEX IF NOT EXISTS ix_producto_nombre_trgm
    ON productos.producto USING gin (nombre gin_trgm_ops);

-- Trigger updated_at
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'tg_set_updated_at'
    ) THEN
        CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
        RETURNS TRIGGER AS $f$
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        $f$ LANGUAGE plpgsql;
    END IF;
END $$;

DROP TRIGGER IF EXISTS tg_producto_updated ON productos.producto;
CREATE TRIGGER tg_producto_updated
    BEFORE UPDATE ON productos.producto
    FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
