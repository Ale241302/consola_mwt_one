-- =====================================================================
-- MWT.ONE · 62_inventario_inbound.sql
-- Agente responsable: [AG-DATABASE]
--
-- Sprint Inbound Engine v1 · 2026-04-29
-- Motor de Recepción de Inventario · CERO FK física.
--
-- Tres tablas:
--   1. inventario.recepcion         (cabecera del inbound)
--   2. inventario.recepcion_linea   (detalle por SKU+lote)
--   3. inventario.recepcion_excepcion (ART-17 — gap auto-generado)
--
-- POL_VISIBILIDAD: unit_cost_usd es CEO-ONLY. Defensa en dos capas:
--   · Backend serializer enmascara para no-admin.
--   · Vista para reportes BI ya filtra por rol.
--
-- Idempotente. Soft-delete vía is_active.
-- =====================================================================

-- ────────────────────────────────────────────────────────────
-- 1. Catálogo: tipo de origen del inbound (source_type)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventario.source_type_cat (
    codigo      VARCHAR(32)  PRIMARY KEY,
    label       VARCHAR(96)  NOT NULL,
    descripcion TEXT,
    color       VARCHAR(16),
    orden       INTEGER      NOT NULL DEFAULT 100,
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE
);

INSERT INTO inventario.source_type_cat (codigo, label, descripcion, color, orden) VALUES
    ('SUPPLIER_PO',  'Orden de compra', 'Recepción contra OC de proveedor',          '#3083FE', 10),
    ('TRANSFER_IN',  'Transferencia',    'Recepción de transferencia inter-nodo',     '#481EE3', 20),
    ('BLIND_RECEIPT','Ajuste ciego',     'Ingreso sin documento previo (ajuste manual)','#B45309', 30),
    ('RETURN',       'Devolución',       'Devolución de cliente / RMA',                '#10B981', 40),
    ('OTHER',        'Otro',             'Otro origen no clasificado',                 '#64748B', 90)
ON CONFLICT (codigo) DO NOTHING;


-- ────────────────────────────────────────────────────────────
-- 2. Catálogo: estado de la recepción
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventario.recepcion_estado_cat (
    codigo      VARCHAR(32)  PRIMARY KEY,
    label       VARCHAR(64)  NOT NULL,
    color       VARCHAR(16),
    orden       INTEGER      NOT NULL DEFAULT 100,
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE
);

INSERT INTO inventario.recepcion_estado_cat (codigo, label, color, orden) VALUES
    ('DRAFT',     'Borrador',     '#64748B', 10),
    ('OCR_DONE',  'OCR completo', '#0EA5E9', 20),
    ('PENDING',   'Pendiente',    '#F59E0B', 30),
    ('RECEIVED',  'Recibida',     '#00B286', 40),
    ('RECONCILED','Reconciliada', '#1DE394', 50),
    ('CANCELLED', 'Cancelada',    '#EF4444', 60)
ON CONFLICT (codigo) DO NOTHING;


-- ────────────────────────────────────────────────────────────
-- 3. Cabecera: inventario.recepcion
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventario.recepcion (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo                   VARCHAR(32) UNIQUE NOT NULL,    -- REC-2026-0001

    destination_node_id      UUID         NOT NULL,           -- ⛔ sin FK
    destination_node_label   VARCHAR(128),                    -- snapshot

    source_type              VARCHAR(32)  NOT NULL DEFAULT 'BLIND_RECEIPT',
    -- → recepcion.source_type_cat.codigo

    reference_id             UUID,                            -- ⛔ sin FK · transfer_id u oc_id
    reference_label          VARCHAR(160),                    -- snapshot ("OC-2026-1023" / "TRF-…")

    estado                   VARCHAR(32)  NOT NULL DEFAULT 'DRAFT',
    -- → inventario.recepcion_estado_cat.codigo

    document_artifact_id     UUID,                            -- ⛔ sin FK · packing list / factura

    -- Audit / OCR
    ocr_processed_at         TIMESTAMPTZ,
    ocr_payload_json         JSONB,
    ocr_confidence_avg       NUMERIC(5,2),

    -- Audit recepción
    received_by_id           UUID,
    received_by_name         VARCHAR(128),
    received_at              TIMESTAMPTZ,

    -- Reconciliación
    has_discrepancy          BOOLEAN      NOT NULL DEFAULT FALSE,
    discrepancy_count        INTEGER      NOT NULL DEFAULT 0,
    exception_document_id    UUID,                            -- ⛔ sin FK · ART-17

    -- Total computado (cache, recalculable)
    total_units              INTEGER      NOT NULL DEFAULT 0,
    total_value_usd          NUMERIC(14,2) NOT NULL DEFAULT 0, -- CEO-ONLY en UI

    notes                    TEXT,

    is_active                BOOLEAN      NOT NULL DEFAULT TRUE,
    created_by_id            UUID,
    created_by_name          VARCHAR(128),
    created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recepcion_dest      ON inventario.recepcion(destination_node_id);
CREATE INDEX IF NOT EXISTS idx_recepcion_estado    ON inventario.recepcion(estado);
CREATE INDEX IF NOT EXISTS idx_recepcion_source    ON inventario.recepcion(source_type);
CREATE INDEX IF NOT EXISTS idx_recepcion_reference ON inventario.recepcion(reference_id) WHERE reference_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_recepcion_codigo    ON inventario.recepcion(codigo);
CREATE INDEX IF NOT EXISTS idx_recepcion_active    ON inventario.recepcion(is_active);
CREATE INDEX IF NOT EXISTS idx_recepcion_disc      ON inventario.recepcion(has_discrepancy)
    WHERE has_discrepancy = TRUE;


-- ────────────────────────────────────────────────────────────
-- 4. Detalle: inventario.recepcion_linea
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventario.recepcion_linea (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recepcion_id        UUID         NOT NULL,         -- ⛔ sin FK

    -- Identificación del producto
    producto_id         UUID,                          -- ⛔ sin FK
    product_sku         VARCHAR(64)  NOT NULL,
    product_label       VARCHAR(255),                  -- snapshot
    talla               VARCHAR(16),

    -- Lote y vencimiento
    lote_code           VARCHAR(64)  NOT NULL DEFAULT '',
    expiration_date     DATE,

    -- Cantidades
    expected_qty        INTEGER      NOT NULL DEFAULT 0,
    received_qty        INTEGER,                       -- NULL = no contada aún
    delta_qty           INTEGER GENERATED ALWAYS AS
        (COALESCE(received_qty, 0) - expected_qty) STORED,

    -- Costo (CEO-ONLY en UI)
    unit_cost_usd       NUMERIC(14,4),
    line_value_usd      NUMERIC(14,2) GENERATED ALWAYS AS
        (ROUND(COALESCE(received_qty, expected_qty) * COALESCE(unit_cost_usd, 0), 2)) STORED,

    -- Justificación de faltante (R6 reconciliación)
    gap_justification   TEXT,

    -- Trazabilidad OCR
    source              VARCHAR(16)  NOT NULL DEFAULT 'MANUAL',
    -- MANUAL | OCR_PL | OCR_INVOICE | SYSTEM
    ocr_confidence      NUMERIC(5,2),

    notes               TEXT,
    is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT ck_rec_linea_qty_nn  CHECK (expected_qty >= 0),
    CONSTRAINT ck_rec_linea_recv_nn CHECK (received_qty IS NULL OR received_qty >= 0),
    CONSTRAINT ck_rec_linea_source  CHECK (source IN ('MANUAL','OCR_PL','OCR_INVOICE','SYSTEM'))
);

CREATE INDEX IF NOT EXISTS idx_rec_linea_recepcion ON inventario.recepcion_linea(recepcion_id);
CREATE INDEX IF NOT EXISTS idx_rec_linea_sku       ON inventario.recepcion_linea(product_sku);
CREATE INDEX IF NOT EXISTS idx_rec_linea_producto  ON inventario.recepcion_linea(producto_id) WHERE producto_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rec_linea_active    ON inventario.recepcion_linea(is_active);


-- ────────────────────────────────────────────────────────────
-- 5. Excepción auto-generada (ART-17 inbound)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventario.recepcion_excepcion (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recepcion_id        UUID         NOT NULL,           -- ⛔ sin FK
    linea_id            UUID,                            -- ⛔ sin FK · NULL si es a nivel cabecera
    tipo                VARCHAR(32)  NOT NULL DEFAULT 'GAP',
    -- GAP | OVER | DAMAGED | EXPIRED | OCR_LOW_CONFIDENCE | OTHER

    expected_qty        INTEGER,
    received_qty        INTEGER,
    delta_qty           INTEGER,

    justification       TEXT,
    auto_generated      BOOLEAN      NOT NULL DEFAULT TRUE,
    requires_action     BOOLEAN      NOT NULL DEFAULT TRUE,

    resolved_at         TIMESTAMPTZ,
    resolved_by_id      UUID,
    resolved_by_name    VARCHAR(128),
    resolution_note     TEXT,

    is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT ck_excep_tipo CHECK (tipo IN
        ('GAP','OVER','DAMAGED','EXPIRED','OCR_LOW_CONFIDENCE','OTHER'))
);

CREATE INDEX IF NOT EXISTS idx_excep_recepcion ON inventario.recepcion_excepcion(recepcion_id);
CREATE INDEX IF NOT EXISTS idx_excep_linea     ON inventario.recepcion_excepcion(linea_id) WHERE linea_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_excep_tipo      ON inventario.recepcion_excepcion(tipo);
CREATE INDEX IF NOT EXISTS idx_excep_pendiente ON inventario.recepcion_excepcion(requires_action)
    WHERE requires_action = TRUE AND resolved_at IS NULL;


-- ────────────────────────────────────────────────────────────
-- 6. Triggers updated_at + auto-discrepancy en cabecera
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION inventario.touch_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_recepcion_upd ON inventario.recepcion;
CREATE TRIGGER tg_recepcion_upd
    BEFORE UPDATE ON inventario.recepcion
    FOR EACH ROW EXECUTE FUNCTION inventario.touch_updated_at();

DROP TRIGGER IF EXISTS tg_rec_linea_upd ON inventario.recepcion_linea;
CREATE TRIGGER tg_rec_linea_upd
    BEFORE UPDATE ON inventario.recepcion_linea
    FOR EACH ROW EXECUTE FUNCTION inventario.touch_updated_at();

DROP TRIGGER IF EXISTS tg_excep_upd ON inventario.recepcion_excepcion;
CREATE TRIGGER tg_excep_upd
    BEFORE UPDATE ON inventario.recepcion_excepcion
    FOR EACH ROW EXECUTE FUNCTION inventario.touch_updated_at();


-- Función helper: recalcular has_discrepancy/discrepancy_count/totales en cabecera.
CREATE OR REPLACE FUNCTION inventario.recompute_recepcion_totals(p_recepcion_id UUID)
RETURNS VOID AS $$
DECLARE
    v_has_disc   BOOLEAN;
    v_disc_count INTEGER;
    v_units      INTEGER;
    v_value      NUMERIC(14,2);
BEGIN
    SELECT
        COUNT(*) FILTER (WHERE COALESCE(received_qty, expected_qty) <> expected_qty) > 0,
        COUNT(*) FILTER (WHERE COALESCE(received_qty, expected_qty) <> expected_qty),
        COALESCE(SUM(COALESCE(received_qty, expected_qty)), 0),
        COALESCE(SUM(COALESCE(line_value_usd, 0)), 0)
    INTO v_has_disc, v_disc_count, v_units, v_value
    FROM inventario.recepcion_linea
    WHERE recepcion_id = p_recepcion_id AND is_active;

    UPDATE inventario.recepcion
    SET    has_discrepancy   = v_has_disc,
           discrepancy_count = v_disc_count,
           total_units       = v_units,
           total_value_usd   = v_value,
           updated_at        = NOW()
    WHERE  id = p_recepcion_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION inventario.tg_rec_linea_recompute() RETURNS TRIGGER AS $$
DECLARE target_id UUID;
BEGIN
    target_id := COALESCE(NEW.recepcion_id, OLD.recepcion_id);
    PERFORM inventario.recompute_recepcion_totals(target_id);
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_rec_linea_recompute ON inventario.recepcion_linea;
CREATE TRIGGER tg_rec_linea_recompute
    AFTER INSERT OR UPDATE OR DELETE ON inventario.recepcion_linea
    FOR EACH ROW EXECUTE FUNCTION inventario.tg_rec_linea_recompute();


-- =====================================================================
-- FIN 62_inventario_inbound.sql
-- =====================================================================
