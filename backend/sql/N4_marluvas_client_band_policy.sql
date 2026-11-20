-- =====================================================================
-- MWT.ONE — backend/sql/N4_marluvas_client_band_policy.sql
--
-- Banda vigente POR CLIENTE (motor de precios).
--
-- Hasta ahora la banda vigente se derivaba siempre del tipo de cambio
-- USD/BRL del día (misma para todos los clientes). Comercialmente cada
-- cliente puede tener otra banda pactada (por ejemplo techo 4,00–4,20 o
-- piso 6,20–6,40). Esta tabla guarda esa decisión por (marca, cliente):
--
--   · banda_vigente → la banda con la que se cotiza al cliente.
--                     NULL = automática (la del TC del día).
--   · banda_techo   → banda de referencia superior (default 1).
--   · banda_piso    → banda de referencia inferior (default 12).
--   · plazo_dias    → plazo por defecto para ese cliente (default 90).
--
-- La usan:
--   · la gobernanza de precios al crear un producto,
--   · el refresh de precios,
--   · la matriz y el simulador de la página del cliente.
--
-- Idempotente: la aplica docker-entrypoint.sh una sola vez
-- (rastreado en public._applied_sql).
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS pricing;

CREATE TABLE IF NOT EXISTS pricing.marluvas_client_band_policy (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id       uuid        NOT NULL,
    cliente_id     uuid        NOT NULL,
    banda_vigente  smallint,
    banda_techo    smallint    NOT NULL DEFAULT 1,
    banda_piso     smallint    NOT NULL DEFAULT 12,
    plazo_dias     smallint    NOT NULL DEFAULT 90,
    updated_by     uuid,
    is_active      boolean     NOT NULL DEFAULT TRUE,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT marluvas_band_policy_techo_ck
        CHECK (banda_techo BETWEEN 1 AND 12),
    CONSTRAINT marluvas_band_policy_piso_ck
        CHECK (banda_piso BETWEEN 1 AND 12),
    CONSTRAINT marluvas_band_policy_vigente_ck
        CHECK (banda_vigente IS NULL OR banda_vigente BETWEEN 1 AND 12),
    CONSTRAINT marluvas_band_policy_plazo_ck
        CHECK (plazo_dias BETWEEN 1 AND 3650)
);

-- Una sola política vigente por (marca, cliente).
CREATE UNIQUE INDEX IF NOT EXISTS ux_marluvas_band_policy_brand_cliente
    ON pricing.marluvas_client_band_policy (brand_id, cliente_id)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_marluvas_band_policy_cliente
    ON pricing.marluvas_client_band_policy (cliente_id)
    WHERE is_active = TRUE;
