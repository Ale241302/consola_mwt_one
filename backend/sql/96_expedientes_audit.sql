-- ============================================================
-- MWT.ONE · 96_expedientes_audit.sql
-- Agente responsable: [AG-DATABASE]
--
-- Correcciones derivadas de la auditoría cross-stack del Módulo
-- 2 (Expedientes). Cubre tres gaps identificados entre el
-- frontend (Expedientes.jsx, expediente detail, wizard, tab
-- de líneas, OCR panel) y el schema persistido:
--
--   1. expedientes.estado_linea_cat     · catálogo de estados
--      discretos para líneas de expediente (PENDIENTE / RESOLVED
--      / PARCIAL / OBSERVACION). Antes vivían como string libre
--      en linea.estado — ahora tienen dropdown oficial.
--
--   2. expedientes.ocr_parsing_log      · log auditable de cada
--      corrida de OCR (Paperless-ngx + Tika) sobre artefactos
--      del expediente (OC, proforma, BL, factura, packing list).
--
--   3. Índice para expedientes.expediente.phase_signal          ·
--      búsqueda rápida del último "signal" del motor de fases
--      (ON_TRACK / AT_RISK / DELAYED / BLOCKED).
--
-- Arquitectura: CERO migraciones (solo SQL idempotente),
-- CERO foreign keys (solo UUIDs con índices), aditivo.
-- Se puede correr N veces sin romper (IF NOT EXISTS everywhere).
-- ============================================================

SET search_path = expedientes, public;

-- ────────────────────────────────────────────────────────────
-- 0. Pre-requisito: función tg_set_updated_at() ya existe
--    (creada en 70_expedientes.sql). Re-creada defensivamente
--    por si el apply-order cambia.
-- ────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'tg_set_updated_at') THEN
    CREATE OR REPLACE FUNCTION tg_set_updated_at() RETURNS trigger AS $fn$
    BEGIN NEW.updated_at := now(); RETURN NEW; END; $fn$ LANGUAGE plpgsql;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 1. expedientes.estado_linea_cat
--
--    Catálogo cerrado de estados para cada línea de expediente.
--    Se seedea con los 4 valores canónicos que hoy usa el
--    frontend como string libre:
--      · PENDIENTE   · esperando asignación SAP o confirmación OCR
--      · RESOLVED    · línea confirmada + stampada en SAP
--      · PARCIAL     · resuelta para parte de la cantidad
--      · OBSERVACION · marcada con un issue que bloquea el cierre
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expedientes.estado_linea_cat (
    codigo         VARCHAR(16)   PRIMARY KEY,
    label          VARCHAR(64)   NOT NULL,
    color          VARCHAR(16),
    orden          INTEGER       NOT NULL DEFAULT 100,
    bloquea_cierre BOOLEAN       NOT NULL DEFAULT FALSE,
    is_active      BOOLEAN       NOT NULL DEFAULT TRUE
);

INSERT INTO expedientes.estado_linea_cat(codigo, label, color, orden, bloquea_cierre) VALUES
    ('PENDIENTE',    'Pendiente',            '#64748B', 10, FALSE),
    ('RESOLVED',     'Resuelta',             '#00B286', 20, FALSE),
    ('PARCIAL',      'Resuelta parcial',     '#F59E0B', 30, FALSE),
    ('OBSERVACION',  'Con observación',      '#EF4444', 40, TRUE)
ON CONFLICT (codigo) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 2. expedientes.ocr_parsing_log
--
--    Log de corridas de OCR (Paperless-ngx + Tika) contra
--    artefactos del expediente. Cada corrida persiste:
--      · referencia lógica al artefacto (artifact_id, UUID sin FK)
--      · referencia al expediente padre
--      · status del pipeline (QUEUED / RUNNING / DONE / FAILED)
--      · el texto crudo extraído + el payload estructurado
--        (líneas candidatas, totales, proveedor detectado)
--      · score de confianza + flags de revisión
--
--    Esto permite re-procesar un artefacto sin perder el historial
--    previo y sirve de backing para el panel "Comparar vs OC" del
--    wizard de expedientes.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expedientes.ocr_parsing_log (
    id                    UUID PRIMARY KEY,
    expediente_id         UUID           NOT NULL,               -- ⛔ sin FK
    artifact_id           UUID           NOT NULL,               -- ⛔ sin FK (artifact_instance.id)
    artifact_tipo         VARCHAR(32)    NOT NULL,
                          -- OC / PROFORMA / BL / FACTURA / PACKING_LIST / OTRO

    engine                VARCHAR(32)    NOT NULL DEFAULT 'PAPERLESS_TIKA',
    engine_version        VARCHAR(32),
    source_url            TEXT,                                  -- signed URL del archivo escaneado

    status                VARCHAR(16)    NOT NULL DEFAULT 'QUEUED',
                          -- QUEUED / RUNNING / DONE / FAILED / NEEDS_REVIEW
    started_at            TIMESTAMPTZ,
    finished_at           TIMESTAMPTZ,
    duration_ms           INTEGER,

    raw_text              TEXT,                                  -- output crudo del OCR
    parsed_payload        JSONB          NOT NULL DEFAULT '{}'::jsonb,
                          -- {lines: [...], totals: {...}, supplier_detected: "..."}
    confidence_score      NUMERIC(5,2),                          -- 0..100
    needs_human_review    BOOLEAN        NOT NULL DEFAULT FALSE,

    error_code            VARCHAR(64),
    error_message         TEXT,

    triggered_by          UUID,                                  -- ⛔ sin FK
    reviewed_by           UUID,                                  -- ⛔ sin FK
    reviewed_at           TIMESTAMPTZ,

    is_active             BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_ocr_log_expediente    ON expedientes.ocr_parsing_log(expediente_id);
CREATE INDEX IF NOT EXISTS ix_ocr_log_artifact      ON expedientes.ocr_parsing_log(artifact_id);
CREATE INDEX IF NOT EXISTS ix_ocr_log_status        ON expedientes.ocr_parsing_log(status);
CREATE INDEX IF NOT EXISTS ix_ocr_log_created_at    ON expedientes.ocr_parsing_log(created_at DESC);

DROP TRIGGER IF EXISTS trg_ocr_parsing_log_updated_at ON expedientes.ocr_parsing_log;
CREATE TRIGGER trg_ocr_parsing_log_updated_at
BEFORE UPDATE ON expedientes.ocr_parsing_log
FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- ────────────────────────────────────────────────────────────
-- 3. expedientes.expediente.phase_signal
--
--    Columna + índice para el "semáforo" del motor de fases. El
--    frontend (ExpedienteKanban, ExpedienteList, widgets del
--    Dashboard) necesita filtrar rápido por semáforo, y este
--    índice soporta la query:
--
--        SELECT * FROM expedientes.expediente
--         WHERE phase_signal IN ('AT_RISK','DELAYED','BLOCKED');
--
--    Valores canónicos:
--      · ON_TRACK · dentro del baseline de la fase actual
--      · AT_RISK  · consumió >80% del baseline, no cerró aún
--      · DELAYED  · superó el baseline
--      · BLOCKED  · marcado manualmente por ops (issue abierto)
-- ────────────────────────────────────────────────────────────
ALTER TABLE expedientes.expediente
    ADD COLUMN IF NOT EXISTS phase_signal VARCHAR(16);

CREATE INDEX IF NOT EXISTS exp_phase_signal_idx
    ON expedientes.expediente (phase_signal)
    WHERE phase_signal IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- Fin 96_expedientes_audit.sql
-- ============================================================
