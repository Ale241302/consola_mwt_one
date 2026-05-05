-- =====================================================================
-- MWT.ONE · B3_product_client_alias.sql
-- Agente responsable: [AG-DATABASE]
--
-- Nueva tabla: productos.product_client_alias
--
-- Contexto: el CEO solicitó que en la tab "Gobernanza y Precios" del
-- detalle de producto se pueda fijar un ALIAS por cliente. El alias es
-- el "nombre comercial" con el que ese cliente conoce el producto en
-- sus catálogos / órdenes de compra. Esto NO reemplaza el `nombre`
-- canónico del producto — el campo canónico sigue siendo único de MWT.
--
-- Reglas MWT respetadas:
--   · CERO FKs físicas — producto_id + cliente_id son UUID planos
--     (mismo patrón que productos.producto y commercial.brand_client_*).
--   · Soft-delete (is_active).
--   · UNA sola fila vigente por (producto, cliente) — unique index
--     parcial sobre (producto_id, cliente_id) WHERE is_active=TRUE.
--   · Trigger updated_at reutiliza tg_set_updated_at() compartido.
--   · CHECKs NOT VALID para no romper legacy data si alguna vez se hace
--     restore desde dump pre-existente.
-- =====================================================================


-- ────────────────────────────────────────────────────────────
-- 1. productos.product_client_alias
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS productos.product_client_alias (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),

    -- FKs lógicas (sin constraint). UUIDs en texto plano.
    producto_id     UUID         NOT NULL,    -- productos.producto.id
    cliente_id      UUID         NOT NULL,    -- clientes.cliente.id

    -- ── Alias comercial del producto para este cliente ──
    -- Es el "nombre con el que este cliente conoce el producto" (ej. en
    -- sus OCs, sus catálogos internos, sus packing slips, etc.).
    -- Puede coincidir con el nombre canónico o ser muy distinto.
    alias           VARCHAR(255) NOT NULL,

    -- ── Meta opcional ──
    -- Algunos clientes B2B exigen que sus OCs incluyan también un código
    -- propio (ERP / SKU del cliente). Lo guardamos aparte para que
    -- aparezca en proformas/facturas dirigidas a ese cliente.
    cliente_sku     VARCHAR(64),
    notas           TEXT,

    -- ── Soft-delete + auditoría liviana ──
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_by_id   UUID,                       -- core.users.id
    updated_by_id   UUID,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);


-- ── Índices ────────────────────────────────────────────────
-- Lookups típicos: "dame todos los aliases de este producto" y
-- "dame los aliases del cliente X". Ambos parciales WHERE is_active.
CREATE INDEX IF NOT EXISTS pca_producto_idx
    ON productos.product_client_alias (producto_id)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS pca_cliente_idx
    ON productos.product_client_alias (cliente_id)
    WHERE is_active = TRUE;

-- Invariante: UNA sola fila vigente por (producto, cliente).
-- Si existe un registro is_active=TRUE se reescribe (UPSERT lógico
-- vía backend) en lugar de crear duplicados.
CREATE UNIQUE INDEX IF NOT EXISTS pca_one_active_per_pair
    ON productos.product_client_alias (producto_id, cliente_id)
    WHERE is_active = TRUE;


-- ── Trigger updated_at ─────────────────────────────────────
-- Reutilizamos tg_set_updated_at() compartido (creado por A2 / A2c).
-- Si por algún motivo no existe en este entorno, lo creamos.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'tg_set_updated_at') THEN
        CREATE OR REPLACE FUNCTION tg_set_updated_at() RETURNS trigger AS $fn$
        BEGIN NEW.updated_at := now(); RETURN NEW; END; $fn$ LANGUAGE plpgsql;
    END IF;
END $$;

DROP TRIGGER IF EXISTS tg_pca_updated_at ON productos.product_client_alias;
CREATE TRIGGER tg_pca_updated_at
    BEFORE UPDATE ON productos.product_client_alias
    FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();


-- ── CHECKs (NOT VALID para no romper legacy) ──────────────
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'ck_pca_alias_not_blank'
                     AND conrelid = 'productos.product_client_alias'::regclass) THEN
        ALTER TABLE productos.product_client_alias
            ADD CONSTRAINT ck_pca_alias_not_blank
            CHECK (length(btrim(alias)) > 0)
            NOT VALID;
    END IF;
END $$;


COMMENT ON TABLE productos.product_client_alias IS
    'Alias comercial del producto por cliente B2B. UNA fila activa por (producto, cliente). El nombre canónico del producto vive en productos.producto.nombre — este alias es el "nombre que ese cliente usa" en sus OCs / catálogos.';

COMMENT ON COLUMN productos.product_client_alias.alias IS
    'Cómo conoce el cliente este producto (puede diferir del nombre canónico MWT).';

COMMENT ON COLUMN productos.product_client_alias.cliente_sku IS
    'Código/SKU del producto en el ERP del cliente (opcional; aparece en proformas dirigidas).';


-- =====================================================================
-- FIN B3_product_client_alias.sql
-- =====================================================================
