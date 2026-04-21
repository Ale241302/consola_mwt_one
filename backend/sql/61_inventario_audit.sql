-- =====================================================================
-- MWT.ONE · 61_inventario_audit.sql
-- Extensiones del schema inventario · BLOQUE 3 (auditoría + carga masiva).
--
-- Añade:
--   §1. Columnas nuevas en inventario.stock (mínimos, máximos, costo actual).
--   §2. Catálogos auxiliares (contexto_movimiento_cat).
--   §3. inventario.stock_snapshot (histórico diario valuado).
--   §4. inventario.stock_ubicacion (multi-bin por stock).
--   §5. inventario.inventory_import_log (2-step preview/commit).
--   §6. Índices adicionales en inventario.movimiento.
--   §7. Trigger updated_at en movimiento (defensivo) + reforzar en stock.
--
-- Regla MWT: CERO FKs — relaciones por UUID plano. Idempotente: IF NOT EXISTS,
-- ON CONFLICT DO NOTHING. Triggers re-creables.
-- =====================================================================

-- Trigger function defensivo (re-crea si no existe).
CREATE SCHEMA IF NOT EXISTS inventario;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'tg_set_updated_at'
    ) THEN
        CREATE FUNCTION tg_set_updated_at() RETURNS trigger AS $f$
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        $f$ LANGUAGE plpgsql;
    END IF;
END $$;

-- =====================================================================
-- §1. Extensiones en inventario.stock
-- =====================================================================
ALTER TABLE inventario.stock
    ADD COLUMN IF NOT EXISTS cantidad_minima       NUMERIC(14,3) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS cantidad_maxima       NUMERIC(14,3),
    ADD COLUMN IF NOT EXISTS dias_stock_minimo     SMALLINT      DEFAULT 14,
    ADD COLUMN IF NOT EXISTS costo_actual_usd      NUMERIC(14,4),
    ADD COLUMN IF NOT EXISTS dias_para_vencimiento SMALLINT,
    ADD COLUMN IF NOT EXISTS rotacion_dias         SMALLINT;

COMMENT ON COLUMN inventario.stock.cantidad_minima   IS 'Umbral inferior — si queda por debajo, alerta reposición.';
COMMENT ON COLUMN inventario.stock.cantidad_maxima   IS 'Capacidad máxima en nodo — bloquea recepción al exceder.';
COMMENT ON COLUMN inventario.stock.dias_stock_minimo IS 'Días de cobertura mínima; reglas de stock de seguridad.';
COMMENT ON COLUMN inventario.stock.costo_actual_usd  IS 'Costo corriente (última valuación); se congelan en snapshot.';

-- =====================================================================
-- §2. Catálogo de contexto legal del movimiento (INTERNAL / NATIONALIZATION / EXPORT / CONSIGNMENT).
-- =====================================================================
CREATE TABLE IF NOT EXISTS inventario.contexto_movimiento_cat (
    codigo    VARCHAR(32) PRIMARY KEY,
    label     VARCHAR(96) NOT NULL,
    descripcion TEXT,
    needs_approval BOOLEAN DEFAULT FALSE,
    color     VARCHAR(16),
    orden     INT DEFAULT 100,
    is_active BOOLEAN DEFAULT TRUE
);

INSERT INTO inventario.contexto_movimiento_cat (codigo, label, descripcion, needs_approval, color, orden) VALUES
    ('INTERNAL',        'Movimiento interno',            'Entre nodos propios — sin impacto legal.',           FALSE, '#1EE3D7', 10),
    ('NATIONALIZATION', 'Nacionalización',               'Ingreso al país con DUA / aduana.',                   TRUE,  '#481EE3', 20),
    ('REEXPORT',        'Re-exportación',                'Salida con régimen de devolución de impuestos.',      TRUE,  '#3083FE', 30),
    ('DISTRIBUTION',    'Distribución comercial',        'Entrega a distribuidor / retailer.',                  FALSE, '#00B286', 40),
    ('CONSIGNMENT',     'Consignación',                  'Stock en custodia de terceros — requiere aprobación.', TRUE,  '#E3A21E', 50),
    ('EXPORT',          'Exportación',                   'Salida al exterior con BL / factura comercial.',      TRUE,  '#E3461E', 60)
ON CONFLICT (codigo) DO NOTHING;

-- Asociar contexto al movimiento (sin FK — por diseño MWT).
ALTER TABLE inventario.movimiento
    ADD COLUMN IF NOT EXISTS contexto_legal VARCHAR(32),
    ADD COLUMN IF NOT EXISTS idempotence_token VARCHAR(64),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

COMMENT ON COLUMN inventario.movimiento.idempotence_token IS
    'Token anti-replay; cliente reintenta con mismo token y no se duplica.';

-- Unique parcial sobre idempotence_token activo.
CREATE UNIQUE INDEX IF NOT EXISTS idx_uq_mov_idemp
    ON inventario.movimiento (idempotence_token)
    WHERE idempotence_token IS NOT NULL AND is_active = TRUE;

-- =====================================================================
-- §3. Snapshot histórico diario valuado (fuente de reportes).
-- =====================================================================
CREATE TABLE IF NOT EXISTS inventario.stock_snapshot (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_date      DATE NOT NULL,
    nodo_id            UUID NOT NULL,                           -- ⛔ sin FK
    producto_id        UUID NOT NULL,                           -- ⛔ sin FK
    lote               VARCHAR(64) DEFAULT '',

    cantidad_disponible  NUMERIC(14,3) DEFAULT 0,
    cantidad_reservada   NUMERIC(14,3) DEFAULT 0,
    cantidad_en_transito NUMERIC(14,3) DEFAULT 0,
    costo_unitario_usd   NUMERIC(14,4) DEFAULT 0,
    valor_total_usd      NUMERIC(14,2) DEFAULT 0,
    dias_para_vencimiento SMALLINT,
    source             VARCHAR(32) DEFAULT 'EOD_JOB',

    is_active          BOOLEAN DEFAULT TRUE,
    created_at         TIMESTAMPTZ DEFAULT NOW(),
    updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- Un snapshot por (nodo, producto, lote, fecha) activo.
CREATE UNIQUE INDEX IF NOT EXISTS idx_uq_stock_snapshot_daily
    ON inventario.stock_snapshot (nodo_id, producto_id, lote, snapshot_date)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_stock_snapshot_date
    ON inventario.stock_snapshot (snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_stock_snapshot_nodo
    ON inventario.stock_snapshot (nodo_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_stock_snapshot_producto
    ON inventario.stock_snapshot (producto_id, snapshot_date DESC);

DROP TRIGGER IF EXISTS tr_stock_snapshot_updated_at ON inventario.stock_snapshot;
CREATE TRIGGER tr_stock_snapshot_updated_at
    BEFORE UPDATE ON inventario.stock_snapshot
    FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- =====================================================================
-- §4. Ubicaciones físicas multi-bin por stock.
-- =====================================================================
CREATE TABLE IF NOT EXISTS inventario.stock_ubicacion (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stock_id        UUID NOT NULL,                              -- ⛔ sin FK
    zona            VARCHAR(32),                                -- ZONA_A / ZONA_B
    pasillo         VARCHAR(16),
    estante         VARCHAR(16),
    bin             VARCHAR(16),
    cantidad        NUMERIC(14,3) DEFAULT 0,
    is_default      BOOLEAN DEFAULT FALSE,

    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_ubicacion_stock
    ON inventario.stock_ubicacion (stock_id) WHERE is_active = TRUE;

-- Una sola default por stock activo.
CREATE UNIQUE INDEX IF NOT EXISTS idx_uq_stock_ubicacion_default
    ON inventario.stock_ubicacion (stock_id)
    WHERE is_default = TRUE AND is_active = TRUE;

DROP TRIGGER IF EXISTS tr_stock_ubicacion_updated_at ON inventario.stock_ubicacion;
CREATE TRIGGER tr_stock_ubicacion_updated_at
    BEFORE UPDATE ON inventario.stock_ubicacion
    FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- =====================================================================
-- §5. Import log de stock (2-step preview → commit).
-- =====================================================================
CREATE TABLE IF NOT EXISTS inventario.inventory_import_log (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nodo_id           UUID,                                     -- nodo destino (si global, NULL)
    filename          VARCHAR(255),
    total_rows        INT DEFAULT 0,
    valid_rows        INT DEFAULT 0,
    invalid_rows      INT DEFAULT 0,

    mapping_json      JSONB DEFAULT '{}'::jsonb,
    preview_json      JSONB DEFAULT '[]'::jsonb,
    errors_json       JSONB DEFAULT '[]'::jsonb,

    status            VARCHAR(16) DEFAULT 'VALIDATING',
                      -- VALIDATING / VALID / PARTIAL / COMMITTED / REJECTED / FAILED
    committed_rows    INT DEFAULT 0,
    idempotence_token VARCHAR(64),

    started_by        UUID,
    committed_at      TIMESTAMPTZ,
    is_active         BOOLEAN DEFAULT TRUE,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inv_import_status
    ON inventario.inventory_import_log (status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_uq_inv_import_idemp
    ON inventario.inventory_import_log (idempotence_token)
    WHERE idempotence_token IS NOT NULL AND is_active = TRUE;

DROP TRIGGER IF EXISTS tr_inv_import_updated_at ON inventario.inventory_import_log;
CREATE TRIGGER tr_inv_import_updated_at
    BEFORE UPDATE ON inventario.inventory_import_log
    FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- =====================================================================
-- §6. Índices adicionales en movimiento (rotación por nodo + FIFO).
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_mov_producto_destino_fecha
    ON inventario.movimiento (producto_id, nodo_destino_id, created_at DESC)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_mov_origen_cant
    ON inventario.movimiento (nodo_origen_id, cantidad)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_mov_contexto
    ON inventario.movimiento (contexto_legal)
    WHERE contexto_legal IS NOT NULL AND is_active = TRUE;

-- =====================================================================
-- §7. Trigger updated_at en movimiento (si alguien edita motivo/notas).
-- =====================================================================
DROP TRIGGER IF EXISTS tr_movimiento_updated_at ON inventario.movimiento;
CREATE TRIGGER tr_movimiento_updated_at
    BEFORE UPDATE ON inventario.movimiento
    FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- =====================================================================
-- Fin 61_inventario_audit.sql
-- =====================================================================
