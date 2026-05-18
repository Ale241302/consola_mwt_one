-- =====================================================================
-- MWT.ONE · A2d_marluvas_client_sku_pricing.sql
-- Agente responsable: [AG-DATABASE]
--
-- Nueva tabla: pricing.marluvas_client_sku_pricing
--
-- Contexto: override de precio por (brand, cliente, SKU) específico
-- para la marca Marluvas. Una fila representa el contrato puntual de
-- precio de un SKU dentro de una BCPA (brand_client_pricing_assignment)
-- ya existente. `bcpa_id` es opcional para permitir overrides huérfanos
-- antes de que se materialice la BCPA padre.
--
-- Fuente del dato: carga manual desde el panel BrandPricingConsole
-- (sección Marluvas) — el operador define override BRL, comisión,
-- ajuste USD y sobreprecio por SKU.
--
-- Reglas MWT respetadas:
--   · CERO FKs físicas — brand_id / cliente_id / bcpa_id son UUID planos.
--   · Soft-delete (is_active).
--   · Idempotente (IF NOT EXISTS).
--   · Una sola fila VIGENTE por (brand, cliente, sku) — unique parcial.
-- =====================================================================
SET client_min_messages = warning;

CREATE SCHEMA IF NOT EXISTS pricing;

-- ────────────────────────────────────────────────────────────
-- 1. pricing.marluvas_client_sku_pricing
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pricing.marluvas_client_sku_pricing (
    id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),

    -- FKs lógicas (sin constraint física)
    brand_id          UUID            NOT NULL,    -- brands.brand.id
    cliente_id        UUID            NOT NULL,    -- clientes.cliente.id
    sku               VARCHAR(64)     NOT NULL,

    -- Override de precio en BRL (NULL = no se override, se usa el
    -- precio base de la pricelist activa)
    brl_override      NUMERIC(14,4),

    -- Modificadores aplicados por SKU
    com_pct           NUMERIC(6,2)    NOT NULL DEFAULT 0,
    ajuste_usd        NUMERIC(14,4)   NOT NULL DEFAULT 0,
    sobreprecio_pct   NUMERIC(8,6)    NOT NULL DEFAULT 0,

    -- Matriz 12 bandas × 4 plazos de precios USD ya calculados.
    -- Se persiste para CONGELAR los precios como contrato — si en el
    -- futuro cambia un divisor de banda o un factor de plazo, los precios
    -- previos NO se recalculan (auditoría comercial / disputas).
    -- Shape esperado:
    --   { "1": {"90": 25.25, "60": 24.99, "30": 24.80, "8": 24.55},
    --     "2": {"90": 24.06, ...},
    --     ...
    --     "12": {...} }
    -- Claves: banda_id (1..12) → plazo_dias (90|60|30|8) → precio USD.
    prices_matrix     JSONB           NOT NULL DEFAULT '{}'::jsonb,

    -- Relación lógica con la BCPA padre (opcional)
    bcpa_id           UUID,                         -- commercial.brand_client_pricing_assignment.id

    -- Vigencia (opcional · NULL = hereda de la BCPA padre)
    fecha_inicio      DATE,
    fecha_fin         DATE,

    -- Meta
    is_active         BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- ── Índices ────────────────────────────────────────────────
-- Invariante: UNA sola fila vigente por (brand, cliente, sku).
CREATE UNIQUE INDEX IF NOT EXISTS mcsp_one_active_per_triple
    ON pricing.marluvas_client_sku_pricing (brand_id, cliente_id, sku)
    WHERE is_active = TRUE;

-- Índice secundario para lookup por cliente dentro de marca.
CREATE INDEX IF NOT EXISTS mcsp_cliente_brand_idx
    ON pricing.marluvas_client_sku_pricing (cliente_id, brand_id)
    WHERE is_active = TRUE;

-- ── Trigger updated_at ─────────────────────────────────────
-- Reutilizamos pricing.touch_updated_at() creada por A2.
-- Si por alguna razón no existe (orden de aplicación SQL), la creamos.
DO $outer$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'pricing' AND p.proname = 'touch_updated_at'
    ) THEN
        CREATE OR REPLACE FUNCTION pricing.touch_updated_at()
        RETURNS trigger LANGUAGE plpgsql AS $body$
        BEGIN
            NEW.updated_at = CURRENT_TIMESTAMP;
            RETURN NEW;
        END;
        $body$;
    END IF;
END
$outer$;

DROP TRIGGER IF EXISTS tg_mcsp_updated_at ON pricing.marluvas_client_sku_pricing;
CREATE TRIGGER tg_mcsp_updated_at
    BEFORE UPDATE ON pricing.marluvas_client_sku_pricing
    FOR EACH ROW EXECUTE FUNCTION pricing.touch_updated_at();

COMMENT ON TABLE pricing.marluvas_client_sku_pricing IS
    'Override de precio por (brand, cliente, SKU) para Marluvas. Relacionada logicamente con commercial.brand_client_pricing_assignment via bcpa_id (NULL permitido).';

COMMENT ON COLUMN pricing.marluvas_client_sku_pricing.bcpa_id IS
    'UUID logico hacia commercial.brand_client_pricing_assignment.id (sin FK fisica). NULL = override huerfano sin BCPA padre todavia.';

COMMENT ON COLUMN pricing.marluvas_client_sku_pricing.brl_override IS
    'Precio override en BRL. NULL = no override (se usa precio base de la pricelist activa).';

-- =====================================================================
-- ROLLBACK (manual · ejecutar a mano si se necesita revertir)
-- ---------------------------------------------------------------------
-- DROP TRIGGER IF EXISTS tg_mcsp_updated_at ON pricing.marluvas_client_sku_pricing;
-- DROP INDEX  IF EXISTS pricing.mcsp_cliente_brand_idx;
-- DROP INDEX  IF EXISTS pricing.mcsp_one_active_per_triple;
-- DROP TABLE  IF EXISTS pricing.marluvas_client_sku_pricing;
-- =====================================================================
-- FIN A2d_marluvas_client_sku_pricing.sql
-- =====================================================================
