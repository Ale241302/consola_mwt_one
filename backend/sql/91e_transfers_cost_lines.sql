-- =====================================================================
-- MWT.ONE · 91e_transfers_cost_lines.sql
-- Agente responsable: [AG-DATABASE]
--
-- Sprint Transfer Engine v2 (2026-04-29) · Costos incrementales
-- + Documento aduanal (DUA) asociado a la transferencia.
--
-- Estado previo:
--   · 90_transfers.sql              → tabla transferencia, linea, evento
--   · 91_transfers_audit.sql        → catálogos extra, BLOQUE 3
--   · 91c_transfers_has_disc...     → has_discrepancy GENERATED→column
--   · 91d_evento_is_active.sql      → fix is_active en evento
--
-- Este script AGREGA:
--
--   1. transfers.cost_kind_cat       — catálogo (DAI, IVA, ALMACENAJE,
--                                      FLETE, SEGURO, AGENCIAMIENTO,
--                                      OTRO).
--
--   2. transfers.cost_line           — línea de costo asociada a una
--                                      transferencia. Source: MANUAL |
--                                      OCR_DUA | SYSTEM. Cero FK física.
--
--   3. ALTER transferencia ADD:
--      · document_artifact_id  UUID  — apunta al DUA / soporte aduanal
--                                      en transferencia_documento.id
--                                      (sin FK, integridad app-layer).
--      · total_cost_usd        NUMERIC(14,2)  — cache; recalculable
--                                      via SELECT SUM(amount_usd) FROM
--                                      cost_line WHERE transfer_id=…
--                                      AND is_active.
--
--   4. ALTER transferencia_documento ADD:
--      · ocr_processed_at      TIMESTAMPTZ  — marca cuándo se corrió
--                                            el OCR (gpt-5-nano).
--      · ocr_payload_json      JSONB        — copia del JSON crudo
--                                            devuelto por la IA, para
--                                            auditoría / re-corrida.
--
-- Reglas MWT respetadas:
--   · CERO FKs (R6).
--   · Idempotente (IF NOT EXISTS / ON CONFLICT).
--   · Soft-delete vía is_active.
-- =====================================================================

-- ────────────────────────────────────────────────────────────
-- 1. cost_kind_cat
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transfers.cost_kind_cat (
    codigo      VARCHAR(32)  PRIMARY KEY,
    label       VARCHAR(64)  NOT NULL,
    descripcion TEXT,
    is_fiscal   BOOLEAN      NOT NULL DEFAULT FALSE,  -- Aranceles/IVA = TRUE
    color       VARCHAR(16),
    orden       INTEGER      NOT NULL DEFAULT 100,
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE
);

INSERT INTO transfers.cost_kind_cat (codigo, label, descripcion, is_fiscal, color, orden) VALUES
    ('DAI',           'Aranceles (DAI)',     'Derechos arancelarios a la importación',                 TRUE,  '#481EE3', 10),
    ('IVA',           'Impuestos (IVA)',     'IVA / impuesto al valor agregado en aduana',             TRUE,  '#7C3AED', 20),
    ('ALMACENAJE',    'Almacenaje aduanal',  'Bodegaje en zona primaria / depósito fiscal',            FALSE, '#0891B2', 30),
    ('AGENCIAMIENTO', 'Agenciamiento',       'Honorarios del agente de aduanas',                       FALSE, '#0EA5E9', 40),
    ('MANIPULEO',     'Manipuleo / handling','Carga, descarga, paletizado, fumigación',                FALSE, '#06B6D4', 50),
    ('FLETE',         'Flete',               'Flete internacional / nacional',                          FALSE, '#3083FE', 60),
    ('SEGURO',        'Seguro',              'Cobertura de transporte',                                 FALSE, '#10B981', 70),
    ('CONSOLIDACION', 'Consolidación',       'Consolidación de carga (LCL / LTL)',                      FALSE, '#22C55E', 80),
    ('OTRO',          'Otro',                'Costo genérico no clasificado',                           FALSE, '#64748B', 90)
ON CONFLICT (codigo) DO NOTHING;


-- ────────────────────────────────────────────────────────────
-- 2. cost_line  (líneas de costo de una transferencia)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transfers.cost_line (
    id                 UUID PRIMARY KEY,
    transferencia_id   UUID NOT NULL,                  -- ⛔ sin FK
    kind               VARCHAR(32) NOT NULL,           -- → cost_kind_cat.codigo
    label              VARCHAR(160),                   -- texto libre (ej. "DAI subpartida 6403.99")
    amount             NUMERIC(14,2) NOT NULL DEFAULT 0,
    currency           CHAR(3)  NOT NULL DEFAULT 'USD',
    fx_to_usd          NUMERIC(14,6) NOT NULL DEFAULT 1,    -- 1 si la moneda es USD
    amount_usd         NUMERIC(14,2) GENERATED ALWAYS AS (ROUND(amount * fx_to_usd, 2)) STORED,

    -- Trazabilidad de origen del dato
    source             VARCHAR(16) NOT NULL DEFAULT 'MANUAL',
    -- MANUAL | OCR_DUA | SYSTEM
    document_id        UUID,                            -- transferencia_documento.id (DUA/factura origen)
    ocr_confidence     NUMERIC(5,2),                    -- 0..100, NULL si MANUAL

    notes              TEXT,

    is_active          BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Validación inline
    CONSTRAINT ck_cost_line_amount    CHECK (amount >= 0),
    CONSTRAINT ck_cost_line_fx        CHECK (fx_to_usd > 0),
    CONSTRAINT ck_cost_line_source    CHECK (source IN ('MANUAL','OCR_DUA','SYSTEM'))
);

CREATE INDEX IF NOT EXISTS idx_cost_line_trf      ON transfers.cost_line(transferencia_id);
CREATE INDEX IF NOT EXISTS idx_cost_line_kind     ON transfers.cost_line(kind);
CREATE INDEX IF NOT EXISTS idx_cost_line_source   ON transfers.cost_line(source);
CREATE INDEX IF NOT EXISTS idx_cost_line_active   ON transfers.cost_line(is_active);

COMMENT ON TABLE  transfers.cost_line IS
    'Línea de costo incremental asociada a una transferencia. La suma '
    'de amount_usd activos == transferencia.total_cost_usd (cache).';
COMMENT ON COLUMN transfers.cost_line.source IS
    'MANUAL=tipeado, OCR_DUA=extraído por gpt-5-nano del DUA, SYSTEM=auto.';

-- Trigger updated_at
DROP TRIGGER IF EXISTS tg_costline_upd ON transfers.cost_line;
CREATE TRIGGER tg_costline_upd
    BEFORE UPDATE ON transfers.cost_line
    FOR EACH ROW EXECUTE FUNCTION transfers.touch_updated_at();


-- ────────────────────────────────────────────────────────────
-- 3. ALTER transferencia: document_artifact_id + total_cost_usd
-- ────────────────────────────────────────────────────────────
ALTER TABLE transfers.transferencia
    ADD COLUMN IF NOT EXISTS document_artifact_id  UUID,
    ADD COLUMN IF NOT EXISTS total_cost_usd        NUMERIC(14,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN transfers.transferencia.document_artifact_id IS
    'UUID del documento aduanal primario (DUA) en transferencia_documento. '
    'Cero FK; se valida en app layer al hacer JOIN.';
COMMENT ON COLUMN transfers.transferencia.total_cost_usd IS
    'Cache · SUM(amount_usd) de cost_line activas. Recalculable.';

CREATE INDEX IF NOT EXISTS idx_trf_doc_artifact
    ON transfers.transferencia(document_artifact_id)
    WHERE document_artifact_id IS NOT NULL;


-- ────────────────────────────────────────────────────────────
-- 4. ALTER transferencia_documento: ocr_processed_at + payload
-- ────────────────────────────────────────────────────────────
ALTER TABLE transfers.transferencia_documento
    ADD COLUMN IF NOT EXISTS ocr_processed_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS ocr_payload_json  JSONB;

COMMENT ON COLUMN transfers.transferencia_documento.ocr_processed_at IS
    'Timestamp del último OCR (gpt-5-nano). NULL = nunca procesado.';
COMMENT ON COLUMN transfers.transferencia_documento.ocr_payload_json IS
    'Copia del JSON crudo devuelto por la IA. Auditoría + re-corrida.';


-- ────────────────────────────────────────────────────────────
-- 5. Función helper: recalcular total_cost_usd de una transferencia.
--    Útil para dispararla desde la app o vía trigger en el futuro.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION transfers.recompute_transfer_total_cost(p_trf_id UUID)
RETURNS NUMERIC(14,2) AS $$
DECLARE
    total NUMERIC(14,2);
BEGIN
    SELECT COALESCE(SUM(amount_usd), 0) INTO total
    FROM transfers.cost_line
    WHERE transferencia_id = p_trf_id AND is_active;

    UPDATE transfers.transferencia
    SET    total_cost_usd = total,
           updated_at     = NOW()
    WHERE  id = p_trf_id;

    RETURN total;
END;
$$ LANGUAGE plpgsql;


-- ────────────────────────────────────────────────────────────
-- 6. Trigger: cuando cambia cost_line, recalcular total en transferencia.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION transfers.tg_costline_recompute() RETURNS TRIGGER AS $$
DECLARE
    target_id UUID;
BEGIN
    IF (TG_OP = 'DELETE') THEN
        target_id := OLD.transferencia_id;
    ELSE
        target_id := NEW.transferencia_id;
    END IF;
    PERFORM transfers.recompute_transfer_total_cost(target_id);
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_costline_recompute ON transfers.cost_line;
CREATE TRIGGER tg_costline_recompute
    AFTER INSERT OR UPDATE OR DELETE ON transfers.cost_line
    FOR EACH ROW EXECUTE FUNCTION transfers.tg_costline_recompute();


-- =====================================================================
-- FIN 91e_transfers_cost_lines.sql
-- =====================================================================
