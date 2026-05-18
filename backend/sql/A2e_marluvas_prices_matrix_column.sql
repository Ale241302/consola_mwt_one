-- =====================================================================
-- MWT.ONE · A2e_marluvas_prices_matrix_column.sql
-- Agente responsable: [AG-DATABASE]
--
-- Propósito: agregar la columna `prices_matrix` (JSONB) a la tabla
-- pricing.marluvas_client_sku_pricing si todavía no existe.
--
-- Necesidad: A2d incluye la columna en el CREATE TABLE, pero si en
-- algún entorno (local/staging/VPS) A2d ya fue aplicado SIN la columna
-- (por una versión previa del archivo), este SQL la agrega de forma
-- idempotente. En entornos nuevos donde A2d ya trae la columna, el
-- ALTER es no-op gracias a IF NOT EXISTS.
--
-- Por qué congelar la matriz como JSON:
--   Una vez que un cliente recibe una lista de precios, esos 48 valores
--   son contractuales. Si mañana se cambia un divisor de banda o un
--   factor de plazo, los precios ya cotizados NO deben recalcularse.
--   Persistirlos como JSON congelado es la garantía más simple.
-- =====================================================================
SET client_min_messages = warning;

ALTER TABLE pricing.marluvas_client_sku_pricing
    ADD COLUMN IF NOT EXISTS prices_matrix JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN pricing.marluvas_client_sku_pricing.prices_matrix IS
    'Matriz 12 bandas x 4 plazos de precios USD ya calculados. Shape: { "<banda_id>": {"<plazo_dias>": <precio>} }. Congelada como contrato — no se recalcula si cambian constantes downstream.';

-- =====================================================================
-- FIN A2e_marluvas_prices_matrix_column.sql
-- =====================================================================
