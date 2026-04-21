-- =====================================================================
-- MWT.ONE · 91_transfers_audit.sql
-- Extensiones del schema transfers · BLOQUE 3 (state machine + auditoría).
--
-- Añade:
--   §1. Estados CLOSED / DISCREPANCY en estado_transfer_cat.
--   §2. Tabla de transiciones legales (state machine explícita).
--   §3. Columnas de discrepancia + tolerancia + snapshot de costo en linea.
--   §4. Columnas de responsable de conciliación y snapshot timestamp en transferencia.
--   §5. transferencia_documentos (remisiones, BLs, DUAs, actas).
--   §6. Índices adicionales para KPIs (discrepancias activas).
--   §7. Unique parcial idempotente en evento.
--
-- Regla MWT: CERO FKs. Idempotente: IF NOT EXISTS + ON CONFLICT DO NOTHING.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS transfers;

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
-- §1. Estados faltantes en el catálogo.
-- =====================================================================
INSERT INTO transfers.estado_transfer_cat (codigo, label, color, orden) VALUES
    ('DISCREPANCY', 'Con discrepancia', '#E3461E', 45),
    ('CLOSED',      'Cerrada',          '#0B1E3A', 70)
ON CONFLICT (codigo) DO NOTHING;

-- =====================================================================
-- §2. State machine explícita (transiciones legales).
-- =====================================================================
CREATE TABLE IF NOT EXISTS transfers.transicion_cat (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estado_from   VARCHAR(32) NOT NULL,
    estado_to     VARCHAR(32) NOT NULL,
    needs_approval BOOLEAN   DEFAULT FALSE,
    legal_context VARCHAR(32),   -- NULL = cualquier contexto
    descripcion   TEXT,
    orden         INT DEFAULT 100,
    is_active     BOOLEAN DEFAULT TRUE,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_uq_transicion
    ON transfers.transicion_cat (estado_from, estado_to, COALESCE(legal_context, ''))
    WHERE is_active = TRUE;

INSERT INTO transfers.transicion_cat (estado_from, estado_to, needs_approval, legal_context, descripcion, orden) VALUES
    ('PLANNED',     'APPROVED',    TRUE,  NULL,               'Aprobación antes de despachar.',                  10),
    ('PLANNED',     'CANCELLED',   FALSE, NULL,               'Cancelación antes de aprobar.',                   20),
    ('APPROVED',    'IN_TRANSIT',  FALSE, NULL,               'Despacho efectivo.',                              30),
    ('APPROVED',    'CANCELLED',   TRUE,  NULL,               'Cancelación post-aprobación.',                    40),
    ('IN_TRANSIT',  'RECEIVED',    FALSE, NULL,               'Llegada confirmada en destino.',                  50),
    ('RECEIVED',    'RECONCILED',  FALSE, NULL,               'Sin discrepancias — auto-cierre posible.',        60),
    ('RECEIVED',    'DISCREPANCY', FALSE, NULL,               'Delta líneas > tolerancia — requiere ajuste.',    70),
    ('DISCREPANCY', 'RECONCILED',  TRUE,  NULL,               'Firma de acta + ajustes contabilizados.',         80),
    ('RECONCILED',  'CLOSED',      FALSE, NULL,               'Cierre definitivo — read-only.',                  90)
ON CONFLICT DO NOTHING;

-- =====================================================================
-- §3. Discrepancia + tolerancia + snapshot de costo en línea.
-- =====================================================================
ALTER TABLE transfers.linea
    ADD COLUMN IF NOT EXISTS tolerancia_pct      NUMERIC(5,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS estado_discrepancia VARCHAR(32),
                             -- OK / WITHIN_TOLERANCE / OVER / UNDER / PENDING_REVIEW
    ADD COLUMN IF NOT EXISTS snapshot_unit_cost  NUMERIC(14,4),
    ADD COLUMN IF NOT EXISTS snapshot_created_at TIMESTAMPTZ;

COMMENT ON COLUMN transfers.linea.tolerancia_pct IS
    'Tolerancia absoluta (%) antes de marcar discrepancia. 0 = match exacto.';
COMMENT ON COLUMN transfers.linea.snapshot_unit_cost IS
    'Costo congelado al momento de crear la transferencia.';

CREATE INDEX IF NOT EXISTS idx_linea_discrepancia
    ON transfers.linea (estado_discrepancia)
    WHERE estado_discrepancia IS NOT NULL AND is_active = TRUE;

-- =====================================================================
-- §4. Responsable de conciliación + snapshot_created_at en transferencia.
-- =====================================================================
ALTER TABLE transfers.transferencia
    ADD COLUMN IF NOT EXISTS reconciled_by_id   UUID,
    ADD COLUMN IF NOT EXISTS reconciled_by_name VARCHAR(128),
    ADD COLUMN IF NOT EXISTS reconciled_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reconciled_note    TEXT,
    ADD COLUMN IF NOT EXISTS snapshot_created_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS discrepancy_count   INT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS has_discrepancy     BOOLEAN GENERATED ALWAYS
                             AS (discrepancy_count > 0) STORED;

COMMENT ON COLUMN transfers.transferencia.reconciled_by_id IS
    'Usuario que firma la conciliación (debe ser required si hay discrepancias).';

CREATE INDEX IF NOT EXISTS idx_transfer_has_discrepancy
    ON transfers.transferencia (has_discrepancy)
    WHERE has_discrepancy = TRUE AND is_active = TRUE;

-- =====================================================================
-- §5. Documentos de transporte (remisiones, BLs, DUAs, actas).
-- =====================================================================
CREATE TABLE IF NOT EXISTS transfers.transferencia_documento (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transferencia_id    UUID NOT NULL,                         -- ⛔ sin FK
    tipo                VARCHAR(32) NOT NULL,
                        -- REMISION / BL / DUA / FACTURA / ACTA_RECEPCION / FOTO / OTRO
    titulo              VARCHAR(255),
    url                 TEXT,
    bucket              VARCHAR(64),
    object_key          VARCHAR(512),
    content_type        VARCHAR(64),
    size_bytes          BIGINT,

    numero_ref          VARCHAR(64),
    fecha_emision       DATE,
    descripcion         TEXT,

    uploaded_by         UUID,                                  -- ⛔ sin FK
    uploaded_by_name    VARCHAR(128),

    is_active           BOOLEAN DEFAULT TRUE,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transfer_doc_transferencia
    ON transfers.transferencia_documento (transferencia_id)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_transfer_doc_tipo
    ON transfers.transferencia_documento (transferencia_id, tipo)
    WHERE is_active = TRUE;

DROP TRIGGER IF EXISTS tr_transfer_doc_updated_at ON transfers.transferencia_documento;
CREATE TRIGGER tr_transfer_doc_updated_at
    BEFORE UPDATE ON transfers.transferencia_documento
    FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- =====================================================================
-- §6. Idempotencia en evento (prevenir transiciones duplicadas).
-- =====================================================================
ALTER TABLE transfers.evento
    ADD COLUMN IF NOT EXISTS idempotence_token VARCHAR(64);

-- transfers.evento es append-only — sin columna is_active.
CREATE UNIQUE INDEX IF NOT EXISTS idx_uq_transfer_evento_idemp
    ON transfers.evento (idempotence_token)
    WHERE idempotence_token IS NOT NULL;

-- =====================================================================
-- Fin 91_transfers_audit.sql
-- =====================================================================
