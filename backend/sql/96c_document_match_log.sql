-- =====================================================================
-- MWT.ONE · 96c_document_match_log.sql
-- Agente responsable: [AG-DATABASE]
--
-- Sprint Document Matchmaker · 2026-04-29
-- Log inmutable de auditorías documentales (cruce IA vs expediente).
--
-- Una sola tabla: expedientes.document_match_log
--   · Append-only (no se updatea el payload, solo `is_resolved` y los
--     campos de auditoría de resolución).
--   · JSONB para que el shape evolucione sin migraciones.
--   · Sin FK física (R6).
--
-- Tipos canónicos de document_type:
--   · ART-01_OC          → Orden de Compra del cliente
--   · ART-02_PROFORMA    → Proforma MWT (interna)
--   · ART-04_SAP         → Confirmación SAP del proveedor
--   · ART-XX (otros futuros) → libre, mientras siga el prefijo ART-
-- =====================================================================

CREATE TABLE IF NOT EXISTS expedientes.document_match_log (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Vínculos sin FK
    expediente_id          UUID         NOT NULL,         -- ⛔ sin FK
    artifact_instance_id   UUID,                          -- ⛔ sin FK · documento en MinIO
    documento_id           UUID,                          -- ⛔ sin FK · expedientes.documento.id
    oc_id                  UUID,                          -- ⛔ sin FK · auxiliar (si aplica)

    document_type          VARCHAR(48)  NOT NULL,
    document_filename      VARCHAR(255),
    document_size_bytes    BIGINT,
    document_content_type  VARCHAR(64),

    -- Resultado IA (gpt-5-nano)
    ai_model               VARCHAR(48),
    ai_raw_payload         JSONB,                         -- payload bruto devuelto por la IA
    mismatch_payload       JSONB        NOT NULL DEFAULT '{}'::jsonb,
    -- Shape canónico de mismatch_payload (siempre estos top-level keys):
    --   {
    --     "summary": {
    --       "perfect_match":          true|false,
    --       "coverage_pct":           0..100,
    --       "lines_in_doc":           N,
    --       "lines_in_expediente":    M,
    --       "lines_matched":          K,
    --       "discrepancies_count":    Z
    --     },
    --     "discrepancies": [
    --       {
    --         "kind":         "MISSING_IN_EXPEDIENTE" | "MISSING_IN_DOC" | "QTY_DIFF" |
    --                         "SAP_MISMATCH" | "SIZE_MISMATCH" | "OTHER",
    --         "sku":          "...",
    --         "talla":        "...",
    --         "qty_doc":      0,
    --         "qty_exp":      0,
    --         "sap_doc":      "...",
    --         "sap_exp":      "...",
    --         "severity":     "ERROR" | "WARN" | "INFO",
    --         "suggested_action": "ADD_LINE" | "UPDATE_QTY" | "ATTACH_SAP" |
    --                             "DELETE_LINE" | "MANUAL"
    --       },
    --       ...
    --     ],
    --     "groups": [   // SOLO Proforma / SAP — agrupación por número SAP
    --       {
    --         "sap_number":      "SAP-1234",
    --         "discrepancies":   [ ...subset... ]
    --       }, ...
    --     ]
    --   }

    -- Métricas
    coverage_pct           NUMERIC(5,2),
    discrepancies_count    INTEGER      NOT NULL DEFAULT 0,
    is_perfect_match       BOOLEAN      NOT NULL DEFAULT FALSE,

    -- Resolución (mutable)
    is_resolved            BOOLEAN      NOT NULL DEFAULT FALSE,
    resolved_at            TIMESTAMPTZ,
    resolved_by_id         UUID,                          -- ⛔ sin FK
    resolved_by_name       VARCHAR(128),
    resolution_payload     JSONB,                         -- shape: lista de acciones aplicadas
    resolution_note        TEXT,

    -- Audit
    created_by_id          UUID,                          -- ⛔ sin FK
    created_by_name        VARCHAR(128),
    is_active              BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    -- CHECK suaves
    CONSTRAINT ck_dml_doctype CHECK (document_type ~ '^ART-[0-9]+_[A-Z]+$' OR document_type IN
        ('ART-01_OC','ART-02_PROFORMA','ART-04_SAP','ART-OTHER'))
);

CREATE INDEX IF NOT EXISTS idx_dml_expediente   ON expedientes.document_match_log(expediente_id);
CREATE INDEX IF NOT EXISTS idx_dml_doctype      ON expedientes.document_match_log(document_type);
CREATE INDEX IF NOT EXISTS idx_dml_unresolved   ON expedientes.document_match_log(is_active, is_resolved)
    WHERE is_active = TRUE AND is_resolved = FALSE;
CREATE INDEX IF NOT EXISTS idx_dml_perfect      ON expedientes.document_match_log(is_perfect_match);
CREATE INDEX IF NOT EXISTS idx_dml_artifact     ON expedientes.document_match_log(artifact_instance_id)
    WHERE artifact_instance_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dml_documento    ON expedientes.document_match_log(documento_id)
    WHERE documento_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dml_mismatch_gin ON expedientes.document_match_log USING gin (mismatch_payload);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION expedientes.tg_dml_touch() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_dml_upd ON expedientes.document_match_log;
CREATE TRIGGER tg_dml_upd
    BEFORE UPDATE ON expedientes.document_match_log
    FOR EACH ROW EXECUTE FUNCTION expedientes.tg_dml_touch();

COMMENT ON TABLE expedientes.document_match_log IS
    'Append-only audit log del Document Matchmaker (sprint 2026-04-29). '
    'Cada upload de OC/Proforma/SAP genera un registro con el cruce IA→DB. '
    'is_resolved se actualiza vía /resolve-match/. mismatch_payload sigue '
    'el shape canónico documentado en el header del SQL.';

-- =====================================================================
-- FIN 96c_document_match_log.sql
-- =====================================================================
