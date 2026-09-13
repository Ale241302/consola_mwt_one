-- =====================================================================
-- L10 · Etapa 6 - Objetivos y evolución de clientes.
--   finanzas.meta_cliente: metas por cliente × dimensión × periodo.
--   Dimensiones: COMPRAS, PEDIDOS, MARGEN, COMISIONES, PAGOS, ENTREGAS.
--   Periodos: MES (YYYY-MM), TRIMESTRE (YYYY-Qn), ANIO (YYYY).
--   El semáforo SOLO se muestra cuando existe una meta (no se inventan metas).
--   Idempotente.
-- =====================================================================
BEGIN;

CREATE SCHEMA IF NOT EXISTS finanzas;

CREATE TABLE IF NOT EXISTS finanzas.meta_cliente (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id     UUID NOT NULL,
    dimension     VARCHAR(16) NOT NULL,
    periodo_tipo  VARCHAR(10) NOT NULL,
    periodo       VARCHAR(10) NOT NULL,
    monto         NUMERIC(16,2) NOT NULL DEFAULT 0,
    notas         TEXT,
    created_by_id UUID,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT meta_cliente_dim_chk
        CHECK (dimension IN ('COMPRAS','PEDIDOS','MARGEN','COMISIONES','PAGOS','ENTREGAS')),
    CONSTRAINT meta_cliente_ptipo_chk
        CHECK (periodo_tipo IN ('MES','TRIMESTRE','ANIO'))
);

CREATE UNIQUE INDEX IF NOT EXISTS meta_cliente_uniq
    ON finanzas.meta_cliente (client_id, dimension, periodo_tipo, periodo)
    WHERE is_active;

COMMENT ON TABLE finanzas.meta_cliente IS
    'Etapa 6: metas del CEO por cliente y dimensión; base del seguimiento de objetivos.';

COMMIT;
