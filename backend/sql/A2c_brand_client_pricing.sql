-- =====================================================================
-- MWT.ONE · A2c_brand_client_pricing.sql
-- Agente responsable: [AG-DATABASE]
--
-- Nueva tabla: commercial.brand_client_pricing_assignment
--
-- Contexto: el Motor de Precios por marca (BrandPricingConsole) se
-- rediseña a modo "cards por cliente". Al entrar a un cliente, el
-- operador comercial sube un Excel de precios y fija parámetros
-- adicionales (sobre-precio, descuentos pronto-pago, volumen, etc.).
-- Todos esos parámetros quedan persistidos aquí, junto con un
-- snapshot inmutable de los términos financieros del cliente al
-- momento de la asignación (comision_pct, credito_dias, credito_limit)
-- — porque esos campos pueden cambiar después y la factura histórica
-- debe reflejar los valores que se usaron cuando se pactó.
--
-- Reglas MWT respetadas:
--   · CERO FKs físicas — brand_id + cliente_id son UUID planos.
--   · Soft-delete (is_active).
--   · Una sola asignación VIGENTE por (brand, cliente) — unique index
--     parcial sobre (brand_id, cliente_id) WHERE is_active=TRUE.
--   · Archivo subido se referencia por `file_object_key` (MinIO /
--     Paperless) — el contenido NO se guarda en Postgres.
-- =====================================================================


-- ────────────────────────────────────────────────────────────
-- 1. brand_client_pricing_assignment
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS commercial.brand_client_pricing_assignment (
    id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

    -- FKs lógicas (sin constraint). UUIDs en texto plano.
    brand_id          UUID          NOT NULL,    -- brands.brand.id
    cliente_id        UUID          NOT NULL,    -- clientes.cliente.id

    -- ── Archivo de precios subido por el operador ──
    file_object_key   TEXT,                      -- key en MinIO / paperless
    file_name         VARCHAR(255),              -- nombre original
    file_size_bytes   INTEGER,
    file_mime         VARCHAR(64),
    file_uploaded_at  TIMESTAMPTZ,
    file_uploaded_by  UUID,                      -- core.users.id

    -- ── Vigencia ──
    -- fecha_fin NULL = vigencia indefinida
    fecha_inicio      DATE          NOT NULL DEFAULT CURRENT_DATE,
    fecha_fin         DATE,

    -- ── Modificadores de precio (todos opcionales · 0..1 decimal) ──
    sobre_precio_pct     NUMERIC(6,4),     -- ej. 0.0500 = +5% sobre base
    pronto_pago_dias     INTEGER,           -- ej. 10 días para aplicar pronto pago
    pronto_pago_pct      NUMERIC(6,4),     -- ej. 0.0300 = 3% de descuento
    volumen_pct          NUMERIC(6,4),     -- ej. 0.0400 = 4% de descuento por volumen
    volumen_min_units    INTEGER,           -- unidades mínimas para activar volumen

    -- ── Snapshot de términos financieros del cliente ──
    --    (copia inmutable tomada en el momento de crear/actualizar la
    --    asignación — sobrevive a cambios posteriores en clientes.cliente)
    comision_pct_snapshot   NUMERIC(6,4),
    credito_dias_snapshot   SMALLINT,
    credito_limit_snapshot  NUMERIC(14,2),

    -- ── Meta ──
    notas             TEXT,
    is_active         BOOLEAN       NOT NULL DEFAULT TRUE,
    created_by_id     UUID,
    updated_by_id     UUID,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ── Índices ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS bcpa_brand_idx
    ON commercial.brand_client_pricing_assignment (brand_id)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS bcpa_cliente_idx
    ON commercial.brand_client_pricing_assignment (cliente_id)
    WHERE is_active = TRUE;

-- Invariante: UNA sola asignación vigente por (brand, cliente).
-- Si existe un registro is_active=TRUE se marca inactivo antes de
-- crear el reemplazo (lo maneja el backend con transaction.atomic).
CREATE UNIQUE INDEX IF NOT EXISTS bcpa_one_active_per_pair
    ON commercial.brand_client_pricing_assignment (brand_id, cliente_id)
    WHERE is_active = TRUE;


-- ── Trigger updated_at ─────────────────────────────────────
-- Reutilizamos tg_set_updated_at() que ya existe (creada por A2).
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'tg_set_updated_at') THEN
        CREATE OR REPLACE FUNCTION tg_set_updated_at() RETURNS trigger AS $fn$
        BEGIN NEW.updated_at := now(); RETURN NEW; END; $fn$ LANGUAGE plpgsql;
    END IF;
END $$;

DROP TRIGGER IF EXISTS tg_bcpa_updated_at ON commercial.brand_client_pricing_assignment;
CREATE TRIGGER tg_bcpa_updated_at
    BEFORE UPDATE ON commercial.brand_client_pricing_assignment
    FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();


-- ── CHECKs (NOT VALID para no romper legacy) ──────────────
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'ck_bcpa_sobre_precio_rng'
                     AND conrelid = 'commercial.brand_client_pricing_assignment'::regclass) THEN
        ALTER TABLE commercial.brand_client_pricing_assignment
            ADD CONSTRAINT ck_bcpa_sobre_precio_rng
            CHECK (sobre_precio_pct IS NULL OR (sobre_precio_pct >= -0.9999 AND sobre_precio_pct <= 1.0000))
            NOT VALID;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'ck_bcpa_pronto_pago_pct_rng'
                     AND conrelid = 'commercial.brand_client_pricing_assignment'::regclass) THEN
        ALTER TABLE commercial.brand_client_pricing_assignment
            ADD CONSTRAINT ck_bcpa_pronto_pago_pct_rng
            CHECK (pronto_pago_pct IS NULL OR (pronto_pago_pct >= 0 AND pronto_pago_pct <= 0.9999))
            NOT VALID;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'ck_bcpa_volumen_pct_rng'
                     AND conrelid = 'commercial.brand_client_pricing_assignment'::regclass) THEN
        ALTER TABLE commercial.brand_client_pricing_assignment
            ADD CONSTRAINT ck_bcpa_volumen_pct_rng
            CHECK (volumen_pct IS NULL OR (volumen_pct >= 0 AND volumen_pct <= 0.9999))
            NOT VALID;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'ck_bcpa_fechas'
                     AND conrelid = 'commercial.brand_client_pricing_assignment'::regclass) THEN
        ALTER TABLE commercial.brand_client_pricing_assignment
            ADD CONSTRAINT ck_bcpa_fechas
            CHECK (fecha_fin IS NULL OR fecha_fin >= fecha_inicio)
            NOT VALID;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'ck_bcpa_pronto_pago_dias'
                     AND conrelid = 'commercial.brand_client_pricing_assignment'::regclass) THEN
        ALTER TABLE commercial.brand_client_pricing_assignment
            ADD CONSTRAINT ck_bcpa_pronto_pago_dias
            CHECK (pronto_pago_dias IS NULL OR (pronto_pago_dias >= 0 AND pronto_pago_dias <= 180))
            NOT VALID;
    END IF;
END $$;


COMMENT ON TABLE commercial.brand_client_pricing_assignment IS
    'Asignación cliente-marca de precios: archivo Excel + vigencia + modificadores (sobre_precio, pronto_pago, volumen) + snapshot inmutable de términos financieros del cliente.';

COMMENT ON COLUMN commercial.brand_client_pricing_assignment.file_object_key IS
    'Key en MinIO/Paperless del Excel de precios subido. NULL si solo se fijaron modificadores sin archivo.';

COMMENT ON COLUMN commercial.brand_client_pricing_assignment.comision_pct_snapshot IS
    'Snapshot inmutable de la comisión del cliente en el momento de crear la asignación (SNAPSHOT INVARIANT).';


-- =====================================================================
-- FIN A2c_brand_client_pricing.sql
-- =====================================================================
