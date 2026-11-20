-- =====================================================================
-- MWT.ONE — backend/sql/N3_marluvas_engine_sku.sql
--
-- Motor de precios · snapshot del Excel COMEX a nivel MARCA.
--
-- Hasta ahora el único lugar donde vivía el precio base BRL de un SKU era
-- `pricing.marluvas_client_sku_pricing.brl_override`, repetido una vez por
-- cliente. Eso hacía imposible responder "¿cuál es el precio base del último
-- Excel del motor para este SKU?" sin elegir un cliente al azar, y por eso
-- un producto creado por una IA quedaba con precio $0 aunque el Excel ya
-- estuviera cargado.
--
-- Esta tabla guarda UNA fila por (brand_id, sku) con el BRL del último Excel
-- importado. Es la fuente de verdad para:
--   · materializar la matriz 12 bandas × plazos por cliente,
--   · aplicar la gobernanza de precios al crear un producto (backend/MCP).
--
-- Idempotente: se aplica una sola vez por docker-entrypoint.sh
-- (rastreado en public._applied_sql).
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS pricing;

CREATE TABLE IF NOT EXISTS pricing.marluvas_engine_sku (
    id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id      uuid         NOT NULL,
    sku           varchar(64)  NOT NULL,
    ref           varchar(240),
    brl           numeric(14,4) NOT NULL,
    source_file   varchar(255),
    anchor_banda  smallint,
    anchor_plazo  smallint,
    uploaded_by   uuid,
    is_active     boolean      NOT NULL DEFAULT TRUE,
    created_at    timestamptz  NOT NULL DEFAULT now(),
    updated_at    timestamptz  NOT NULL DEFAULT now()
);

-- Un solo precio base vigente por marca+SKU (el último Excel gana).
CREATE UNIQUE INDEX IF NOT EXISTS ux_marluvas_engine_sku_brand_sku
    ON pricing.marluvas_engine_sku (brand_id, sku);

CREATE INDEX IF NOT EXISTS idx_marluvas_engine_sku_brand
    ON pricing.marluvas_engine_sku (brand_id)
    WHERE is_active = TRUE;

-- Bitácora de importaciones: permite auditar qué Excel, cuándo y con qué ancla.
CREATE TABLE IF NOT EXISTS pricing.marluvas_engine_import (
    id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id       uuid         NOT NULL,
    file_name      varchar(255),
    skus           integer      NOT NULL DEFAULT 0,
    clientes       integer      NOT NULL DEFAULT 0,
    banda_id       smallint,
    plazo_dias     smallint,
    tc_usd_brl     numeric(14,6),
    source         varchar(24)  NOT NULL DEFAULT 'MANUAL',
    created_by     uuid,
    created_at     timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marluvas_engine_import_brand
    ON pricing.marluvas_engine_import (brand_id, created_at DESC);
