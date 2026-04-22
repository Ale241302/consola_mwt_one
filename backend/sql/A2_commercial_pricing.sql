-- =====================================================================
-- MWT.ONE · A2_commercial_pricing.sql
-- Agente responsable: [AG-DATABASE]
--
-- Capa comercial del Módulo de Marcas — Sprint 22 + Sprint 23.
--
-- Schema `pricing`      → listas de precios activas por marca + items grade
-- Schema `commercial`   → políticas financieras (pronto pago) + comisiones
--
-- 6 tablas:
--   1. pricing.pricelist_version         (múltiples listas activas por marca)
--   2. pricing.grade_item                (SKU + price + grade MOQ + size_multipliers)
--   3. commercial.early_payment_policy   (contado / créditos)
--   4. commercial.early_payment_tier     (payment_days + discount_pct)
--   5. commercial.commission_rule        (CEO-ONLY · commission_base enum)
--   6. pricing.client_assignment         (CPA — Catálogo Personalizado Asignado)
--
-- Convenciones MWT:
--   · CERO Foreign Keys (vínculos por UUID lógico).
--   · Idempotente (IF NOT EXISTS, ON CONFLICT DO NOTHING).
--   · UUID PK, is_active, created_at, updated_at en cada fila.
--   · Partial unique indexes WHERE is_active = TRUE.
--   · JSONB size_multipliers con GIN index.
--   · Triggers touch_updated_at compartidos por schema.
--
-- Sufijo "A2" para que el entrypoint lo aplique DESPUÉS de A0_ai_module.sql
-- (ASCII '0' < '2'), garantizando que las marcas/clientes ya existen vía 99_seed.sql.
-- =====================================================================
SET client_min_messages = warning;

CREATE SCHEMA IF NOT EXISTS pricing;
CREATE SCHEMA IF NOT EXISTS commercial;

-- ────────────────────────────────────────────────────────────
-- Trigger genérico touch_updated_at (pricing)
-- ────────────────────────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'pricing' AND p.proname = 'touch_updated_at'
    ) THEN
        EXECUTE $f$
            CREATE OR REPLACE FUNCTION pricing.touch_updated_at()
            RETURNS trigger LANGUAGE plpgsql AS $body$
            BEGIN
                NEW.updated_at = CURRENT_TIMESTAMP;
                RETURN NEW;
            END;
            $body$;
        $f$;
    END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- Trigger genérico touch_updated_at (commercial)
-- ────────────────────────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'commercial' AND p.proname = 'touch_updated_at'
    ) THEN
        EXECUTE $f$
            CREATE OR REPLACE FUNCTION commercial.touch_updated_at()
            RETURNS trigger LANGUAGE plpgsql AS $body$
            BEGIN
                NEW.updated_at = CURRENT_TIMESTAMP;
                RETURN NEW;
            END;
            $body$;
        $f$;
    END IF;
END $$;

-- =====================================================================
-- SCHEMA pricing
-- =====================================================================
SET search_path = pricing, public;

-- ============================================================
-- 1. pricing.pricelist_version
--    Múltiples listas activas por marca (cada Excel subido = versión).
--    La resolución del precio hace MIN(unit_price_usd) sobre todas
--    las versiones activas para un mismo (brand_id, product_sku).
-- ============================================================
CREATE TABLE IF NOT EXISTS pricing.pricelist_version (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id            UUID         NOT NULL,
    -- vínculo lógico a brands.marca.id (SIN FK)
    codigo              VARCHAR(64)  NOT NULL,
    -- código/alias legible: "SS26-MAYORISTA", "FW26-OUTLET", etc.
    nombre              VARCHAR(160) NOT NULL,
    descripcion         TEXT,
    currency            CHAR(3)      NOT NULL DEFAULT 'USD',
    -- currency ∈ { USD, EUR, MXN, PEN, COP, ... } (ISO 4217)
    valid_from          DATE         NOT NULL DEFAULT CURRENT_DATE,
    valid_to            DATE,
    -- valid_to NULL → vigente indefinidamente
    storage_key         VARCHAR(512),
    -- key MinIO/S3 del Excel original (para audit / re-import)
    source              VARCHAR(24)  NOT NULL DEFAULT 'UPLOAD',
    -- source ∈ { UPLOAD, MANUAL, API, MIGRATION }
    uploaded_by_id      UUID,
    metadata            JSONB        NOT NULL DEFAULT '{}'::jsonb,
    is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pricing_pricelist_brand_codigo_active
    ON pricing.pricelist_version (brand_id, codigo) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_pricing_pricelist_brand
    ON pricing.pricelist_version (brand_id);
CREATE INDEX IF NOT EXISTS idx_pricing_pricelist_active
    ON pricing.pricelist_version (is_active);
CREATE INDEX IF NOT EXISTS idx_pricing_pricelist_valid_range
    ON pricing.pricelist_version (valid_from, valid_to) WHERE is_active = TRUE;

DROP TRIGGER IF EXISTS tg_pricing_pricelist_upd ON pricing.pricelist_version;
CREATE TRIGGER tg_pricing_pricelist_upd
    BEFORE UPDATE ON pricing.pricelist_version
    FOR EACH ROW EXECUTE FUNCTION pricing.touch_updated_at();

-- ============================================================
-- 2. pricing.grade_item
--    Ítem de una pricelist_version. Contiene el SKU padre,
--    precio unitario y la curva de tallas (size_multipliers JSONB).
--
--    size_multipliers: { "37": 5, "38": 10, "39": 12, ... }
--      → clave = talla (string), valor = cantidad mínima del grade.
--    grade_moq_total = SUM(size_multipliers.values) — denormalizado
--    para evitar recálculos en cada consulta.
-- ============================================================
CREATE TABLE IF NOT EXISTS pricing.grade_item (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pricelist_version_id UUID        NOT NULL,
    -- vínculo lógico a pricing.pricelist_version.id
    brand_id            UUID         NOT NULL,
    -- denormalizado para queries rápidas (MIN por brand_id + product_sku)
    product_sku         VARCHAR(64)  NOT NULL,
    -- SKU padre (marca-modelo-color), NO incluye talla
    product_name        VARCHAR(240),
    unit_price_usd      NUMERIC(14,4) NOT NULL,
    -- precio base por unidad en la moneda de la pricelist
    cost_usd            NUMERIC(14,4),
    -- CEO-ONLY — costo unitario (para cálculo de margen)
    grade_moq_total     INTEGER      NOT NULL DEFAULT 0,
    -- suma de los valores en size_multipliers (MOQ total del grade)
    size_multipliers    JSONB        NOT NULL DEFAULT '{}'::jsonb,
    -- curva de tallas: { "37": 5, "38": 10, ... }
    tags                JSONB        NOT NULL DEFAULT '[]'::jsonb,
    metadata            JSONB        NOT NULL DEFAULT '{}'::jsonb,
    is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pricing_grade_item_version_sku_active
    ON pricing.grade_item (pricelist_version_id, product_sku) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_pricing_grade_item_brand_sku
    ON pricing.grade_item (brand_id, product_sku) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_pricing_grade_item_version
    ON pricing.grade_item (pricelist_version_id);
CREATE INDEX IF NOT EXISTS idx_pricing_grade_item_active
    ON pricing.grade_item (is_active);
CREATE INDEX IF NOT EXISTS idx_pricing_grade_item_size_gin
    ON pricing.grade_item USING gin (size_multipliers);
CREATE INDEX IF NOT EXISTS idx_pricing_grade_item_tags_gin
    ON pricing.grade_item USING gin (tags);

DROP TRIGGER IF EXISTS tg_pricing_grade_item_upd ON pricing.grade_item;
CREATE TRIGGER tg_pricing_grade_item_upd
    BEFORE UPDATE ON pricing.grade_item
    FOR EACH ROW EXECUTE FUNCTION pricing.touch_updated_at();

-- =====================================================================
-- SCHEMA commercial
-- =====================================================================
SET search_path = commercial, public;

-- ============================================================
-- 3. commercial.early_payment_policy
--    Política de pronto pago por (client_id, brand_id).
--    Define "qué cliente, sobre qué marca, tiene qué esquema de pronto pago".
--    Cada policy tiene N tiers (ver tabla 4).
-- ============================================================
CREATE TABLE IF NOT EXISTS commercial.early_payment_policy (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id           UUID         NOT NULL,
    -- vínculo lógico a clientes.cliente.id
    brand_id            UUID         NOT NULL,
    -- vínculo lógico a brands.marca.id
    codigo              VARCHAR(64)  NOT NULL,
    -- alias legible: "EPP-ACME-NIKE-2026"
    nombre              VARCHAR(160) NOT NULL,
    descripcion         TEXT,
    valid_from          DATE         NOT NULL DEFAULT CURRENT_DATE,
    valid_to            DATE,
    approved_by_id      UUID,
    approved_at         TIMESTAMPTZ,
    metadata            JSONB        NOT NULL DEFAULT '{}'::jsonb,
    is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_commercial_epp_client_brand_active
    ON commercial.early_payment_policy (client_id, brand_id) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_commercial_epp_client
    ON commercial.early_payment_policy (client_id);
CREATE INDEX IF NOT EXISTS idx_commercial_epp_brand
    ON commercial.early_payment_policy (brand_id);
CREATE INDEX IF NOT EXISTS idx_commercial_epp_active
    ON commercial.early_payment_policy (is_active);

DROP TRIGGER IF EXISTS tg_commercial_epp_upd ON commercial.early_payment_policy;
CREATE TRIGGER tg_commercial_epp_upd
    BEFORE UPDATE ON commercial.early_payment_policy
    FOR EACH ROW EXECUTE FUNCTION commercial.touch_updated_at();

-- ============================================================
-- 4. commercial.early_payment_tier
--    Cada tier: payment_days INT (0 = contado, 30, 60, 90, ...)
--               + discount_pct DECIMAL (% de descuento aplicable).
--
--    Resolución del tier en resolve_client_price:
--      SELECT * FROM early_payment_tier
--       WHERE policy_id = ?
--         AND payment_days >= requested_payment_days
--       ORDER BY payment_days ASC LIMIT 1;
--    (se elige el tier MÁS CERCANO por arriba al plazo solicitado)
-- ============================================================
CREATE TABLE IF NOT EXISTS commercial.early_payment_tier (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_id           UUID         NOT NULL,
    -- vínculo lógico a commercial.early_payment_policy.id
    payment_days        INTEGER      NOT NULL,
    -- 0 = contado, 30 = 30 días, 60 = 60 días, etc.
    discount_pct        NUMERIC(6,3) NOT NULL DEFAULT 0,
    -- descuento porcentual aplicable (0.000 → 100.000)
    tier_label          VARCHAR(64),
    -- "Contado", "30 días", "Crédito 60 días"
    orden               INTEGER      NOT NULL DEFAULT 0,
    metadata            JSONB        NOT NULL DEFAULT '{}'::jsonb,
    is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_commercial_tier_payment_days_nonneg
        CHECK (payment_days >= 0),
    CONSTRAINT ck_commercial_tier_discount_range
        CHECK (discount_pct >= 0 AND discount_pct <= 100)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_commercial_tier_policy_days_active
    ON commercial.early_payment_tier (policy_id, payment_days) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_commercial_tier_policy
    ON commercial.early_payment_tier (policy_id);
CREATE INDEX IF NOT EXISTS idx_commercial_tier_days
    ON commercial.early_payment_tier (payment_days);
CREATE INDEX IF NOT EXISTS idx_commercial_tier_active
    ON commercial.early_payment_tier (is_active);

DROP TRIGGER IF EXISTS tg_commercial_tier_upd ON commercial.early_payment_tier;
CREATE TRIGGER tg_commercial_tier_upd
    BEFORE UPDATE ON commercial.early_payment_tier
    FOR EACH ROW EXECUTE FUNCTION commercial.touch_updated_at();

-- ============================================================
-- 5. commercial.commission_rule            [CEO-ONLY]
--    Regla de comisión por (brand_id, client_id).
--    commission_base ∈ { sale_price, gross_margin }:
--      · sale_price  → comisión = sale_price * commission_pct
--      · gross_margin→ comisión = (sale_price - cost) * commission_pct
--
--    NOTA DE SEGURIDAD:
--    Esta tabla contiene información estratégica (márgenes objetivo
--    por marca/cliente). El endpoint /api/commercial/resolve_client_price/
--    NUNCA debe retornar campos de esta tabla a usuarios CLIENT.
--    Solo ADMIN/CEO puede leer commission_rule vía ViewSet.
-- ============================================================
CREATE TABLE IF NOT EXISTS commercial.commission_rule (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id            UUID         NOT NULL,
    -- vínculo lógico a brands.marca.id
    client_id           UUID,
    -- vínculo lógico a clientes.cliente.id; NULL = aplica a toda la marca
    codigo              VARCHAR(64)  NOT NULL,
    -- "COM-NIKE-GLOBAL", "COM-NIKE-ACME-2026"
    nombre              VARCHAR(160) NOT NULL,
    descripcion         TEXT,
    commission_pct      NUMERIC(6,3) NOT NULL,
    -- % de comisión (0.000 → 100.000)
    commission_base     VARCHAR(24)  NOT NULL DEFAULT 'sale_price',
    -- commission_base ∈ { sale_price, gross_margin }
    min_sale_amount     NUMERIC(14,4),
    -- opcional: monto mínimo de venta para que aplique la comisión
    valid_from          DATE         NOT NULL DEFAULT CURRENT_DATE,
    valid_to            DATE,
    approved_by_id      UUID,
    approved_at         TIMESTAMPTZ,
    metadata            JSONB        NOT NULL DEFAULT '{}'::jsonb,
    is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_commercial_commission_pct_range
        CHECK (commission_pct >= 0 AND commission_pct <= 100),
    CONSTRAINT ck_commercial_commission_base_valid
        CHECK (commission_base IN ('sale_price', 'gross_margin'))
);

-- Unicidad: (brand_id, client_id, codigo) — client_id puede ser NULL
-- (no forma parte del index único cuando es NULL; PostgreSQL trata NULLs
--  como distintos, así que usamos COALESCE a UUID sentinel para unicidad).
CREATE UNIQUE INDEX IF NOT EXISTS uq_commercial_commission_codigo_active
    ON commercial.commission_rule (brand_id, COALESCE(client_id, '00000000-0000-0000-0000-000000000000'::uuid), codigo)
    WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_commercial_commission_brand
    ON commercial.commission_rule (brand_id);
CREATE INDEX IF NOT EXISTS idx_commercial_commission_client
    ON commercial.commission_rule (client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_commercial_commission_base
    ON commercial.commission_rule (commission_base);
CREATE INDEX IF NOT EXISTS idx_commercial_commission_active
    ON commercial.commission_rule (is_active);

DROP TRIGGER IF EXISTS tg_commercial_commission_upd ON commercial.commission_rule;
CREATE TRIGGER tg_commercial_commission_upd
    BEFORE UPDATE ON commercial.commission_rule
    FOR EACH ROW EXECUTE FUNCTION commercial.touch_updated_at();

-- =====================================================================
-- SCHEMA pricing (continuación)
-- =====================================================================
SET search_path = pricing, public;

-- ============================================================
-- 6. pricing.client_assignment  (CPA — Catálogo Personalizado Asignado)
--    Override de precio por (client_id, brand_sku).
--    Tiene prioridad MÁXIMA en el waterfall de resolve_client_price.
--
--    Waterfall en resolve_client_price:
--      1. CPA (si existe para (client_id, sku)) → usa cached_client_price
--      2. MIN(unit_price_usd) sobre pricelist_version ACTIVE para brand+sku
--      3. Aplica early_payment_tier.discount_pct donde payment_days >= X
-- ============================================================
CREATE TABLE IF NOT EXISTS pricing.client_assignment (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id           UUID         NOT NULL,
    -- vínculo lógico a clientes.cliente.id
    brand_id            UUID         NOT NULL,
    -- vínculo lógico a brands.marca.id
    brand_sku           VARCHAR(64)  NOT NULL,
    -- SKU padre tal como aparece en pricing.grade_item.product_sku
    cached_client_price NUMERIC(14,4) NOT NULL,
    -- precio override (congelado) pactado con este cliente para este SKU
    currency            CHAR(3)      NOT NULL DEFAULT 'USD',
    source_pricelist_id UUID,
    -- de qué pricelist_version salió originalmente (audit trail)
    notes               TEXT,
    valid_from          DATE         NOT NULL DEFAULT CURRENT_DATE,
    valid_to            DATE,
    approved_by_id      UUID,
    approved_at         TIMESTAMPTZ,
    metadata            JSONB        NOT NULL DEFAULT '{}'::jsonb,
    is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_pricing_cpa_price_nonneg
        CHECK (cached_client_price >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pricing_cpa_client_brandsku_active
    ON pricing.client_assignment (client_id, brand_id, brand_sku) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_pricing_cpa_client
    ON pricing.client_assignment (client_id);
CREATE INDEX IF NOT EXISTS idx_pricing_cpa_brand
    ON pricing.client_assignment (brand_id);
CREATE INDEX IF NOT EXISTS idx_pricing_cpa_sku
    ON pricing.client_assignment (brand_sku);
CREATE INDEX IF NOT EXISTS idx_pricing_cpa_active
    ON pricing.client_assignment (is_active);

DROP TRIGGER IF EXISTS tg_pricing_cpa_upd ON pricing.client_assignment;
CREATE TRIGGER tg_pricing_cpa_upd
    BEFORE UPDATE ON pricing.client_assignment
    FOR EACH ROW EXECUTE FUNCTION pricing.touch_updated_at();

-- =====================================================================
-- CATÁLOGOS SEED
-- (sin datos de negocio — solo catálogos de referencia)
-- =====================================================================

-- Catálogo commission_base (enum como tabla de referencia para dropdowns)
CREATE TABLE IF NOT EXISTS commercial.commission_base_cat (
    codigo              VARCHAR(24)  PRIMARY KEY,
    nombre              VARCHAR(80)  NOT NULL,
    descripcion         TEXT,
    orden               INTEGER      NOT NULL DEFAULT 0,
    is_active           BOOLEAN      NOT NULL DEFAULT TRUE
);

INSERT INTO commercial.commission_base_cat (codigo, nombre, descripcion, orden) VALUES
    ('sale_price',   'Sobre precio de venta', 'Comisión = precio_venta × commission_pct',                 10),
    ('gross_margin', 'Sobre margen bruto',    'Comisión = (precio_venta − costo) × commission_pct · CEO',  20)
ON CONFLICT (codigo) DO NOTHING;

-- Catálogo currency (ISO 4217) — para dropdowns del frontend
CREATE TABLE IF NOT EXISTS pricing.currency_cat (
    codigo              CHAR(3)      PRIMARY KEY,
    nombre              VARCHAR(80)  NOT NULL,
    symbol              VARCHAR(8),
    is_active           BOOLEAN      NOT NULL DEFAULT TRUE
);

INSERT INTO pricing.currency_cat (codigo, nombre, symbol) VALUES
    ('USD', 'US Dollar',          '$'),
    ('EUR', 'Euro',               '€'),
    ('MXN', 'Peso Mexicano',      '$'),
    ('PEN', 'Sol Peruano',        'S/'),
    ('COP', 'Peso Colombiano',    '$'),
    ('CLP', 'Peso Chileno',       '$'),
    ('ARS', 'Peso Argentino',     '$'),
    ('BRL', 'Real Brasileño',     'R$'),
    ('GBP', 'Libra Esterlina',    '£')
ON CONFLICT (codigo) DO NOTHING;

-- Catálogo source de pricelist_version
CREATE TABLE IF NOT EXISTS pricing.pricelist_source_cat (
    codigo              VARCHAR(24)  PRIMARY KEY,
    nombre              VARCHAR(80)  NOT NULL,
    orden               INTEGER      NOT NULL DEFAULT 0,
    is_active           BOOLEAN      NOT NULL DEFAULT TRUE
);

INSERT INTO pricing.pricelist_source_cat (codigo, nombre, orden) VALUES
    ('UPLOAD',    'Subida Excel',      10),
    ('MANUAL',    'Carga manual',      20),
    ('API',       'API externa',       30),
    ('MIGRATION', 'Migración legacy',  40)
ON CONFLICT (codigo) DO NOTHING;

-- =====================================================================
-- FIN de A2_commercial_pricing.sql
-- =====================================================================
