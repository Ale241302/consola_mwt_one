-- ============================================================
-- MWT.ONE · 21_brands_audit.sql
-- Agente responsable: [AG-DATABASE]
--
-- Correcciones derivadas de la auditoría Bloque 2 del Módulo 9
-- (Marcas). Cubre el catálogo de tipo de marca (PROPIA/TERCEROS/
-- EXCLUSIVA) + códigos de descuento + log de importaciones masivas.
--
-- Reglas: PK UUID, CERO FK, is_active, created_at + updated_at
-- + trigger, IF NOT EXISTS.
-- ============================================================

SET search_path = brands, public;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'tg_set_updated_at') THEN
    CREATE OR REPLACE FUNCTION tg_set_updated_at() RETURNS trigger AS $fn$
    BEGIN NEW.updated_at := now(); RETURN NEW; END; $fn$ LANGUAGE plpgsql;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 1. brands.tipo_marca_cat  ·  catálogo PROPIA/TERCEROS/EXCLUSIVA
--    (93_schema_extensions.sql §3 introduce la columna `tipo`,
--    este catálogo la soporta como source-of-truth para selects).
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS brands.tipo_marca_cat (
    codigo      VARCHAR(16)   PRIMARY KEY,
    label       VARCHAR(64)   NOT NULL,
    descripcion TEXT,
    color       VARCHAR(16),
    orden       INTEGER       NOT NULL DEFAULT 100,
    is_active   BOOLEAN       NOT NULL DEFAULT TRUE
);

INSERT INTO brands.tipo_marca_cat (codigo, label, descripcion, color, orden) VALUES
    ('PROPIA',    'Marca propia',     'Marca registrada y operada por MWT',          '#00B286', 10),
    ('EXCLUSIVA', 'Exclusiva',        'Representación exclusiva en territorios MWT', '#3083FE', 20),
    ('TERCEROS',  'Terceros',         'Distribución de marcas de terceros',          '#6B7280', 30)
ON CONFLICT (codigo) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 2. brands.brand_discount_code  ·  códigos de descuento por marca.
--    Backing del futuro tab "Códigos de descuento" en BrandDetail
--    (FE todavía no lo implementa; este schema deja todo listo).
--    Vigencia por fechas + tope de usos + status soft-deletable.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS brands.brand_discount_code (
    id                UUID PRIMARY KEY,
    marca_id          UUID           NOT NULL,                   -- ⛔ sin FK
    codigo            VARCHAR(32)    NOT NULL,
    descripcion       VARCHAR(255),

    tipo_descuento    VARCHAR(16)    NOT NULL DEFAULT 'PCT',
                      -- PCT (porcentaje) / FIXED (monto fijo) / COMBO (regla compleja en reglas_json)
    descuento_pct     NUMERIC(5,2),                              -- null si tipo != PCT
    descuento_monto   NUMERIC(14,2),                             -- null si tipo != FIXED
    moneda            VARCHAR(3)     NOT NULL DEFAULT 'USD',

    vigencia_inicio   DATE           NOT NULL,
    vigencia_fin      DATE,
    max_usos          INTEGER,                                   -- null = ilimitado
    usos_actuales     INTEGER        NOT NULL DEFAULT 0,

    scope             VARCHAR(16)    NOT NULL DEFAULT 'GLOBAL',
                      -- GLOBAL / CANAL / CLIENTE / PRODUCTO
    scope_ids         JSONB          NOT NULL DEFAULT '[]'::jsonb,  -- UUIDs planos por scope
    reglas_json       JSONB          NOT NULL DEFAULT '{}'::jsonb,  -- reglas complejas (min_monto, combos…)

    created_by        UUID,                                      -- ⛔ sin FK
    is_active         BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_brand_discount_code
    ON brands.brand_discount_code (codigo)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS ix_brand_disc_marca        ON brands.brand_discount_code(marca_id);
CREATE INDEX IF NOT EXISTS ix_brand_disc_vigencia     ON brands.brand_discount_code(vigencia_inicio, vigencia_fin);
CREATE INDEX IF NOT EXISTS ix_brand_disc_scope        ON brands.brand_discount_code(scope);
CREATE INDEX IF NOT EXISTS ix_brand_disc_scope_ids_gin
    ON brands.brand_discount_code USING gin (scope_ids);

DROP TRIGGER IF EXISTS trg_brand_discount_code_updated_at ON brands.brand_discount_code;
CREATE TRIGGER trg_brand_discount_code_updated_at
BEFORE UPDATE ON brands.brand_discount_code
FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- ────────────────────────────────────────────────────────────
-- 3. brands.brand_import_log  ·  trazabilidad de uploads masivos
--    de productos por marca. Misma semántica que productos.imports_log
--    pero scoped a la marca (el FE abre el uploader desde BrandDetail).
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS brands.brand_import_log (
    id              UUID PRIMARY KEY,
    marca_id        UUID           NOT NULL,                     -- ⛔ sin FK
    user_id         UUID,                                        -- ⛔ sin FK
    filename        VARCHAR(256)   NOT NULL,
    content_type    VARCHAR(96),
    source_url      TEXT,

    rows_total      INTEGER        NOT NULL DEFAULT 0,
    rows_valid      INTEGER        NOT NULL DEFAULT 0,
    rows_invalid    INTEGER        NOT NULL DEFAULT 0,
    rows_inserted   INTEGER        NOT NULL DEFAULT 0,
    rows_updated    INTEGER        NOT NULL DEFAULT 0,

    status          VARCHAR(16)    NOT NULL DEFAULT 'VALIDATING',
                    -- VALIDATING / VALID / PARTIAL / COMMITTED / REJECTED / FAILED
    mapping_json    JSONB          NOT NULL DEFAULT '{}'::jsonb, -- { excel_col: canonical_key }
    preview_json    JSONB          NOT NULL DEFAULT '[]'::jsonb,
    errors_json     JSONB          NOT NULL DEFAULT '[]'::jsonb,
    summary_json    JSONB          NOT NULL DEFAULT '{}'::jsonb,

    committed_at    TIMESTAMPTZ,
    committed_by    UUID,
    is_active       BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_brand_import_marca        ON brands.brand_import_log(marca_id);
CREATE INDEX IF NOT EXISTS ix_brand_import_user         ON brands.brand_import_log(user_id);
CREATE INDEX IF NOT EXISTS ix_brand_import_status       ON brands.brand_import_log(status);
CREATE INDEX IF NOT EXISTS ix_brand_import_created      ON brands.brand_import_log(created_at DESC);
CREATE INDEX IF NOT EXISTS ix_brand_import_errors_gin
    ON brands.brand_import_log USING gin (errors_json);

DROP TRIGGER IF EXISTS trg_brand_import_log_updated_at ON brands.brand_import_log;
CREATE TRIGGER trg_brand_import_log_updated_at
BEFORE UPDATE ON brands.brand_import_log
FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- ============================================================
