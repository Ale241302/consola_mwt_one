-- =====================================================================
-- MWT.ONE · 53_suppliers_product_assignments.sql
-- Agente responsable: [AG-DATABASE]
--
-- Tabla puente proveedor ↔ producto MWT con datos OPERATIVOS de la
-- relación (que NO viven en el catálogo de producto ni en el inventario
-- por nodo). Aquí va el costo FOB de fábrica, el código que la fábrica
-- usa para el SKU, el MOQ que la fábrica exige y el lead time típico.
--
-- Decisiones:
--   · CERO foreign keys (patrón MWT) — supplier_id y product_sku son
--     UUID/VARCHAR sueltos, validados a nivel app.
--   · base_cost_usd es CEO-ONLY → la columna existe siempre, pero el
--     serializer la oculta para roles no-admin (defensa en serializer +
--     defensa en frontend).
--   · UNIQUE parcial (supplier, sku, is_active) — un mismo SKU puede
--     re-asignarse después de un soft-delete sin choque.
--
-- Idempotente.
--
-- Ejecutar:
--   psql -U mwt -d mwt_one -f backend/sql/53_suppliers_product_assignments.sql
-- =====================================================================

SET search_path = proveedores, public;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'tg_set_updated_at') THEN
    CREATE OR REPLACE FUNCTION tg_set_updated_at() RETURNS trigger AS $fn$
    BEGIN NEW.updated_at := now(); RETURN NEW; END; $fn$ LANGUAGE plpgsql;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS proveedores.suppliers_product_assignments (
    id                          UUID         PRIMARY KEY,
    supplier_id                 UUID         NOT NULL,                -- ⛔ sin FK
    product_sku                 VARCHAR(64)  NOT NULL,                -- SKU canónico MWT (string)

    -- Datos operativos del proveedor (no viven en productos.producto)
    supplier_sku_code           VARCHAR(64),                          -- Ej. PN-MARLU-A102 (fábrica)
    moq                         INTEGER      NOT NULL DEFAULT 0,      -- mínimo de pedido
    base_cost_usd               NUMERIC(14,4),                        -- ⚠ CEO-ONLY (gate en serializer)
    production_lead_time_days   INTEGER      NOT NULL DEFAULT 0,      -- días promedio de fabricación

    -- Auditoría
    notas                       TEXT,
    is_active                   BOOLEAN      NOT NULL DEFAULT TRUE,
    created_by                  UUID,                                 -- ⛔ sin FK
    created_at                  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Sólo una asignación activa por (proveedor, SKU)
CREATE UNIQUE INDEX IF NOT EXISTS ux_supp_prod_assign_active
    ON proveedores.suppliers_product_assignments (supplier_id, product_sku)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS ix_supp_prod_assign_supplier
    ON proveedores.suppliers_product_assignments (supplier_id);

CREATE INDEX IF NOT EXISTS ix_supp_prod_assign_sku
    ON proveedores.suppliers_product_assignments (product_sku);

CREATE INDEX IF NOT EXISTS ix_supp_prod_assign_codigo_fab
    ON proveedores.suppliers_product_assignments (supplier_sku_code);

DROP TRIGGER IF EXISTS trg_supp_prod_assign_updated_at
    ON proveedores.suppliers_product_assignments;
CREATE TRIGGER trg_supp_prod_assign_updated_at
    BEFORE UPDATE ON proveedores.suppliers_product_assignments
    FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

DO $$ BEGIN
    RAISE NOTICE '[53_suppliers_product_assignments] tabla creada / verificada';
END $$;
