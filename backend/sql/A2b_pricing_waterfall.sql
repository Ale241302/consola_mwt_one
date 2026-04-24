-- ============================================================
-- MWT.ONE · A2b_pricing_waterfall.sql
-- Agente responsable: [AG-DATABASE]
--
-- Extensión aditiva al schema `commercial` para soportar la
-- CALCULADORA COMEX (Tabela de preços COMEX 2026):
--
--   precio_final = precio_base_USD
--                × (base_commission_rate ^ (100 × comisión_pct))
--                × factor_indice_pago(días, mercado)
--
-- Donde:
--   · precio_base_USD       ← pricing.grade_item.unit_price_usd
--   · base_commission_rate  ← pricing.pricing_constants.value (default 1.0183)
--   · comisión_pct          ← input del usuario (ej. 0.08 = 8%)
--   · factor_indice_pago    ← pricing.payment_index.factor_me / factor_mi
--
-- Contrato MWT:
--   · CERO FKs físicas · UUID strings + índices.
--   · Soft delete (is_active).
--   · Trigger tg_set_updated_at ya existe.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. pricing.pricing_constants · constantes globales de la fórmula
--
-- Una fila por constante. Permite al CEO ajustar la base del
-- exponencial (1.0183 en el Excel v6) sin tocar código.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pricing.pricing_constants (
    slug          VARCHAR(48)    PRIMARY KEY,
    nombre        VARCHAR(128)   NOT NULL,
    descripcion   TEXT,
    value         NUMERIC(16, 6) NOT NULL,
    unit          VARCHAR(16),                -- ej. 'factor', 'pct', 'usd'
    is_active     BOOLEAN        NOT NULL DEFAULT TRUE,
    updated_by_id UUID,
    created_at    TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ    NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS tg_pricing_constants_updated_at ON pricing.pricing_constants;
CREATE TRIGGER tg_pricing_constants_updated_at
    BEFORE UPDATE ON pricing.pricing_constants
    FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- Seed canónico de la base 1.0183 del Excel v6.
INSERT INTO pricing.pricing_constants (slug, nombre, descripcion, value, unit) VALUES
    ('base_commission_rate',
     'Base exponencial de comisión',
     'Exponente base del Excel COMEX v6. precio_final *= value ^ (100 * comisión_pct).',
     1.0183, 'factor'),
    ('default_markup_floor',
     'Margen mínimo permitido',
     'Markup mínimo (respecto al cost_base) que el sistema aceptará en un resolve_price. Bajo este valor → warning.',
     1.05, 'factor'),
    ('fx_usd_pen',
     'Tipo de cambio USD→PEN',
     'Fallback si la lista de precios no especifica moneda destino.',
     3.70, 'rate')
ON CONFLICT (slug) DO NOTHING;


-- ────────────────────────────────────────────────────────────
-- 2. pricing.payment_index · Tabela de indices del Excel
--
-- El Excel tiene 34 filas en "Tabela de indices" con las columnas:
--   K = dias    · cantidad de días
--   L = indice_mi · Mercado Interno (Brasil)
--   M = indice_me · Mercado Externo (exportación) ← el que usa COMEX
--
-- Aquí lo guardamos como una tabla normalizada.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pricing.payment_index (
    id           UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    dias         INTEGER        NOT NULL UNIQUE,      -- 0, 10, 14, 15, 20, 21, …
    factor_mi    NUMERIC(10, 6) NOT NULL DEFAULT 1.0, -- Mercado Interno
    factor_me    NUMERIC(10, 6) NOT NULL DEFAULT 1.0, -- Mercado Externo (COMEX)
    descripcion  VARCHAR(255),                         -- ej. "28/42 días"
    orden        INTEGER        NOT NULL DEFAULT 0,
    is_active    BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_index_dias_idx
    ON pricing.payment_index (dias)
    WHERE is_active = TRUE;

DROP TRIGGER IF EXISTS tg_payment_index_updated_at ON pricing.payment_index;
CREATE TRIGGER tg_payment_index_updated_at
    BEFORE UPDATE ON pricing.payment_index
    FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

COMMENT ON TABLE pricing.payment_index IS
    'Índice de pago por plazo en días. Seed con los 34 valores del Excel Tabela de indices de COMEX 2026 v6.';

-- Seed exacto del Excel 'Tabela de indices' (col K, L, M, filas 1-34)
INSERT INTO pricing.payment_index (dias, factor_mi, factor_me, orden) VALUES
    (  0, 1.000, 1.000,  10),
    ( 10, 1.010, 1.003,  20),
    ( 14, 1.014, 1.005,  30),
    ( 15, 1.015, 1.005,  40),
    ( 20, 1.020, 1.007,  50),
    ( 21, 1.021, 1.007,  60),
    ( 27, 1.027, 1.009,  70),
    ( 28, 1.028, 1.009,  80),
    ( 29, 1.029, 1.010,  90),
    ( 30, 1.030, 1.010, 100),
    ( 31, 1.031, 1.013, 110),
    ( 35, 1.035, 1.012, 120),
    ( 36, 1.036, 1.012, 130),
    ( 37, 1.037, 1.013, 140),
    ( 38, 1.038, 1.013, 150),
    ( 40, 1.040, 1.013, 160),
    ( 42, 1.042, 1.014, 170),
    ( 45, 1.045, 1.015, 180),
    ( 46, 1.046, 1.015, 190),
    ( 49, 1.050, 1.017, 200),
    ( 50, 1.051, 1.017, 210),
    ( 52, 1.053, 1.018, 220),
    ( 55, 1.056, 1.018, 230),
    ( 56, 1.057, 1.019, 240),
    ( 59, 1.060, 1.020, 250),
    ( 60, 1.061, 1.020, 260),
    ( 62, 1.063, 1.021, 270),
    ( 70, 1.071, 1.023, 280),
    ( 90, 1.093, 1.030, 290),
    (100, 1.104, 1.033, 300),
    (102, 1.106, 1.034, 310),
    (120, 1.126, 1.040, 320),
    (180, 1.194, 1.060, 330)
ON CONFLICT (dias) DO NOTHING;


-- ────────────────────────────────────────────────────────────
-- 3. Columnas extra en pricing.grade_item para el Excel COMEX
--
-- El Excel trae columnas que no teníamos: NCM (código arancelario),
-- CA (certificado de aprobación MTPS-BR), centro de facturación,
-- material/bico/palmilha. Las agregamos como opcionales JSON para
-- no inflar el schema pero poder importar.
-- ────────────────────────────────────────────────────────────
ALTER TABLE pricing.grade_item
    ADD COLUMN IF NOT EXISTS ncm           VARCHAR(16),
    ADD COLUMN IF NOT EXISTS ca            VARCHAR(16),
    ADD COLUMN IF NOT EXISTS centro_fact   VARCHAR(128),
    ADD COLUMN IF NOT EXISTS atributos_raw JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN pricing.grade_item.atributos_raw IS
    'Campos libres importados del Excel (cabedal, bico, palmilha, modelo_material, etc.).';

CREATE INDEX IF NOT EXISTS pricelist_item_ncm_idx
    ON pricing.grade_item (ncm) WHERE ncm IS NOT NULL;


-- ============================================================
-- FIN A2b_pricing_waterfall.sql
-- ============================================================
