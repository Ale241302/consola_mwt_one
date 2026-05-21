-- =====================================================================
-- MWT.ONE · D3_amazon_ads_schema.sql
-- Agente responsable: [AG-BACKEND]
-- Sprint Dashboard KPIs · 2026-05-21
--
-- Propósito:
--   Crear el esqueleto de datos para la KPI "TACoS Amazon · FBA-US".
--   El frontend ya tiene cableado el card; el backend ya tiene endpoint
--   /api/analytics/tacos_fba_us/. Lo único que falta es la fuente: este
--   schema deja las tablas listas para ingestar datos de Amazon Ads
--   (manual, CSV, o vía conector futuro).
--
-- TACoS = Total Advertising Cost of Sales =
--           ad_spend  /  total_sales  (incluye ventas orgánicas)
--   · Ventana típica para FBA-US: 30 días móviles.
--   · Para Amazon Vendor / Seller Central, marketplace == 'US'.
--
-- Tablas creadas:
--   amazon_ads.account               · cuentas Amazon Ads (1 por
--                                       marketplace × profile)
--   amazon_ads.spend_daily           · gasto publicitario por día y
--                                       cuenta (de Sponsored Products /
--                                       Brands / Display agregado)
--   amazon_ads.attributed_sales_daily · ventas totales por día (atribuidas
--                                       a ads + orgánicas), denominador
--                                       del TACoS
--
-- Diseño:
--   · UUID PK con gen_random_uuid() (mismo patrón que A0_ai_module.sql)
--   · UNIQUE compuesto (account_id, date) para idempotencia de ingesta
--   · NUMERIC(14,2) en montos USD — alineado con cobros.cobro
--   · is_active TRUE por defecto — mismo soft-delete pattern del repo
--
-- No se toca:
--   · Catálogo de productos (`productos.producto`). La atribución
--     ad↔SKU se modela en un futuro D4 cuando exista necesidad real.
--
-- Idempotente. Si las tablas ya existen, no hace nada.
-- Forward-only: las inserciones manuales/CSV no necesitan migración
-- adicional; el endpoint TACoS las lee directamente.
--
-- Ejecutar:
--   psql -U mwt -d mwt_one -f backend/sql/D3_amazon_ads_schema.sql
-- =====================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS amazon_ads;

-- ---------------------------------------------------------------------
-- 1. amazon_ads.account
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS amazon_ads.account (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    marketplace   VARCHAR(8)   NOT NULL DEFAULT 'US',
    profile_id    VARCHAR(64)  NOT NULL,
    account_name  VARCHAR(255) NULL,
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
    CONSTRAINT amazon_ads_account_marketplace_chk
        CHECK (marketplace IN ('US','MX','BR','CA','UK','DE','ES','FR','IT','JP')),
    CONSTRAINT amazon_ads_account_profile_unique
        UNIQUE (marketplace, profile_id)
);

COMMENT ON TABLE  amazon_ads.account     IS 'Cuentas Amazon Ads conectadas a la consola MWT.';
COMMENT ON COLUMN amazon_ads.account.marketplace IS 'Código marketplace ISO (US, MX, BR, …).';
COMMENT ON COLUMN amazon_ads.account.profile_id  IS 'profileId expuesto por la API de Amazon Ads.';

-- ---------------------------------------------------------------------
-- 2. amazon_ads.spend_daily
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS amazon_ads.spend_daily (
    id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id   UUID          NOT NULL REFERENCES amazon_ads.account(id) ON DELETE CASCADE,
    date         DATE          NOT NULL,
    spend_usd    NUMERIC(14,2) NOT NULL DEFAULT 0,
    impressions  BIGINT        NOT NULL DEFAULT 0,
    clicks       BIGINT        NOT NULL DEFAULT 0,
    is_active    BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMP     NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMP     NOT NULL DEFAULT NOW(),
    CONSTRAINT amazon_ads_spend_daily_unique
        UNIQUE (account_id, date)
);

COMMENT ON TABLE amazon_ads.spend_daily IS 'Gasto publicitario diario agregado (Sponsored Products + Brands + Display).';

CREATE INDEX IF NOT EXISTS amazon_ads_spend_daily_date_idx
    ON amazon_ads.spend_daily (date);

-- ---------------------------------------------------------------------
-- 3. amazon_ads.attributed_sales_daily
-- ---------------------------------------------------------------------
-- Importante: para TACoS necesitamos VENTAS TOTALES (no solo
-- atribuidas a ads). Las atribuidas son útiles para ACoS pero TACoS
-- divide spend entre ventas totales (orgánicas + ads).
CREATE TABLE IF NOT EXISTS amazon_ads.attributed_sales_daily (
    id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id           UUID          NOT NULL REFERENCES amazon_ads.account(id) ON DELETE CASCADE,
    date                 DATE          NOT NULL,
    attributed_sales_usd NUMERIC(14,2) NOT NULL DEFAULT 0,   -- ventas atribuidas a ads
    total_sales_usd      NUMERIC(14,2) NOT NULL DEFAULT 0,   -- denominador de TACoS
    units_sold           INTEGER       NOT NULL DEFAULT 0,
    is_active            BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at           TIMESTAMP     NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMP     NOT NULL DEFAULT NOW(),
    CONSTRAINT amazon_ads_sales_daily_unique
        UNIQUE (account_id, date)
);

COMMENT ON TABLE  amazon_ads.attributed_sales_daily IS 'Ventas diarias (atribuidas + totales) para cálculo TACoS y ACoS.';
COMMENT ON COLUMN amazon_ads.attributed_sales_daily.total_sales_usd IS 'Denominador de TACoS · ventas totales (orgánicas + ad-attributed).';

CREATE INDEX IF NOT EXISTS amazon_ads_sales_daily_date_idx
    ON amazon_ads.attributed_sales_daily (date);

COMMIT;
