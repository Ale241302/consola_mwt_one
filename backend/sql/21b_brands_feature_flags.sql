-- =====================================================================
-- MWT.ONE · 21b_brands_feature_flags.sql · Agrega feature_flags JSONB
--          a `brands.marca` para que el toggle de capacidades del FE
--          (Storefront / B2B / Expedientes / Scanner) persista en BD.
-- Agente responsable: [AG-DATABASE]
--
-- Idempotente — usa IF NOT EXISTS.
--
-- Ejecutar:
--   psql -U mwt -d mwt_one -f backend/sql/21b_brands_feature_flags.sql
-- =====================================================================

ALTER TABLE brands.marca
    ADD COLUMN IF NOT EXISTS feature_flags JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$ BEGIN
    RAISE NOTICE '[21b_brands_feature_flags] columna feature_flags lista en brands.marca';
END $$;
