-- ============================================================
-- MWT.ONE · 95c_wizard_multirole.sql
-- Agente responsable: [AG-DATABASE]
--
-- Extensiones del schema expedientes.* para habilitar el flujo
-- multi-rol del Wizard de Creación de Expedientes:
--
--   · ADMIN (CEO) sube OC internamente → completa logística + comercial
--     en el wizard → expediente nace con mode, freight_mode y
--     transport_mode ya definidos.
--
--   · CLIENT (Portal B2B) sube OC desde su portal → el cliente
--     NUNCA ve ni elige mode/freight/transport. El expediente nace
--     con esos campos NULL + phase_signal='PENDING_CEO_REVIEW' y
--     espera a que el CEO los complete en el backoffice.
--
-- Arquitectura MWT:
--   · Idempotente (IF NOT EXISTS + guards)
--   · CERO FOREIGN KEYS — solo UUIDs con índices
--   · 100% aditivo (no rompe 70_expedientes.sql ni 93_schema_extensions.sql)
--
-- Orden de aplicación: DESPUÉS de
--   70_expedientes.sql, 93_schema_extensions.sql, 95_expediente_wizard.sql
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. expedientes.expediente · relajar NOT NULL en modo_operacion
--
--    Actual (70_expedientes.sql L131):
--        modo_operacion  VARCHAR(16) NOT NULL DEFAULT 'FULL'
--
--    Problema: cuando un CLIENT B2B sube su OC, el backend NO
--    debe asumir 'FULL' porque eso es una DECISIÓN COMERCIAL del
--    CEO (Modo Comisión vs. Modo Full cambia la estructura de
--    márgenes y la cobertura de crédito). Con DEFAULT 'FULL' se
--    metería ruido contractual.
--
--    Solución: DROP NOT NULL. El default se mantiene para INSERTs
--    directos legacy pero ahora se puede pasar NULL explícito.
--    El Backend force a NULL cuando detecta request.user.role=CLIENT.
-- ────────────────────────────────────────────────────────────
ALTER TABLE expedientes.expediente
    ALTER COLUMN modo_operacion DROP NOT NULL;

COMMENT ON COLUMN expedientes.expediente.modo_operacion IS
    'COMISION / FULL. NULL hasta que el CEO revise un expediente subido desde Portal B2B.';


-- ────────────────────────────────────────────────────────────
-- 2. expedientes.expediente · columnas de auditoría del origen
--
--    Registran QUIÉN y CÓMO subió la OC. Crítico para:
--      · Filtrar el inbox CEO "Expedientes pendientes de revisión
--        de cliente" (submitted_via_portal = TRUE).
--      · Trazabilidad C11 (quién disparó el comando de creación).
--      · RBAC retroactivo (si un cliente se dio de baja, sus
--        expedientes quedan flaggeados).
-- ────────────────────────────────────────────────────────────
ALTER TABLE expedientes.expediente
    ADD COLUMN IF NOT EXISTS submitted_by_role     VARCHAR(16),          -- 'ADMIN' | 'CLIENT'
    ADD COLUMN IF NOT EXISTS submitted_by_user_id  UUID,                  -- core.users.id (lógico, sin FK)
    ADD COLUMN IF NOT EXISTS submitted_via_portal  BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS submitted_at          TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS exp_submitted_role_idx
    ON expedientes.expediente (submitted_by_role);

CREATE INDEX IF NOT EXISTS exp_submitted_portal_idx
    ON expedientes.expediente (submitted_via_portal)
    WHERE submitted_via_portal = TRUE;

-- Índice compuesto para el inbox CEO: "pendientes de revisión"
CREATE INDEX IF NOT EXISTS exp_pending_ceo_review_idx
    ON expedientes.expediente (submitted_via_portal, phase_signal, last_event_at DESC)
    WHERE submitted_via_portal = TRUE
      AND is_active = TRUE
      AND modo_operacion IS NULL;


-- ────────────────────────────────────────────────────────────
-- 3. expedientes.expediente · extender phase_signal con
--    'PENDING_CEO_REVIEW' como valor válido (soft, no CHECK)
--
--    phase_signal es VARCHAR libre en 70_expedientes.sql. Agregar
--    semántica nueva no requiere ALTER — solo documentar. Sin
--    embargo dejamos un comentario para que el siguiente lector
--    sepa que el valor existe y qué significa.
-- ────────────────────────────────────────────────────────────
COMMENT ON COLUMN expedientes.expediente.phase_signal IS
    'ON_TRACK | AT_RISK | DELAYED | PENDING_CEO_REVIEW. El último solo
     aparece en expedientes subidos desde Portal B2B que aún no tienen
     modo_operacion definido por el CEO.';


-- ────────────────────────────────────────────────────────────
-- 4. expedientes.artifact_code_cat · asegurar ART-01 (OC Cliente)
--
--    El wizard registra siempre el archivo subido como ART-01.
--    Si el catálogo no existe todavía, esta inserción es un no-op
--    seguro (ON CONFLICT DO NOTHING).
-- ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'expedientes' AND table_name = 'artifact_code_cat'
  ) THEN
    INSERT INTO expedientes.artifact_code_cat
        (codigo, nombre, descripcion, kind, comando_source, orden, is_active)
    VALUES
        ('ART-01', 'OC Cliente',
         'Orden de compra del cliente subida al wizard (PDF o XLSX).',
         'OC', 'C1', 10, TRUE),
        ('ART-02', 'Proforma MWT',
         'Proforma emitida por MWT y firmada por el cliente.',
         'PROFORMA', 'C2', 20, TRUE),
        ('ART-03', 'Decisión Modo B/C',
         'Registro de decisión comercial (COMISION vs FULL).',
         'DECISION', 'C3', 30, TRUE),
        ('ART-04', 'Confirmación SAP',
         'Confirmación de producción SAP emitida por la fábrica.',
         'SAP', 'C5', 40, TRUE)
    ON CONFLICT (codigo) DO NOTHING;
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────
-- 5. expedientes.artifact_instances · índice para ART-01 lookup
--
--    Permite consultas del tipo "dame la OC original de este
--    expediente" sin escanear toda la tabla.
-- ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'expedientes' AND table_name = 'artifact_instances'
  ) THEN
    CREATE INDEX IF NOT EXISTS art_inst_art01_idx
        ON expedientes.artifact_instances (expediente_id, artifact_code)
        WHERE artifact_code = 'ART-01'
          AND is_active = TRUE;
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────
-- 6. expedientes.wizard_submission_log  (opcional · auditoría)
--
--    Log append-only de cada submission del wizard. Útil para
--    investigar "¿por qué este expediente nació sin proveedor?"
--    o "¿cuántas OC rechazadas por el OCR subió el cliente X
--    este mes?" (funnel del portal B2B).
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expedientes.wizard_submission_log (
    id                 UUID           PRIMARY KEY DEFAULT gen_random_uuid(),

    expediente_id      UUID,                                    -- NULL si la submission falló antes de crear el expediente
    oc_id              UUID,                                    -- NULL idem
    client_id          UUID           NOT NULL,                 -- siempre se conoce (del JWT o del payload)
    brand_id           UUID,

    submitted_by_role  VARCHAR(16)    NOT NULL,                 -- 'ADMIN' | 'CLIENT'
    submitted_by_id    UUID,
    submitted_by_email VARCHAR(255),
    submitted_via      VARCHAR(32)    NOT NULL DEFAULT 'portal',  -- 'portal' | 'backoffice' | 'api'

    file_name          VARCHAR(512),
    file_ext           VARCHAR(16),                             -- 'pdf' | 'xlsx'
    file_size_bytes    BIGINT,
    file_sha256        VARCHAR(64),                             -- dedup / tamper check

    ocr_confidence     NUMERIC(5, 4),                           -- 0..1
    lines_extracted    INTEGER        NOT NULL DEFAULT 0,
    lines_accepted     INTEGER        NOT NULL DEFAULT 0,

    status             VARCHAR(16)    NOT NULL DEFAULT 'PENDING', -- PENDING|SUCCESS|REJECTED|CRASHED
    rejection_reason   VARCHAR(255),                            -- sólo si status=REJECTED

    idempotence_token  VARCHAR(64)    UNIQUE,
    correlation_id     UUID,

    payload            JSONB          NOT NULL DEFAULT '{}'::jsonb,

    created_at         TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ    NOT NULL DEFAULT now(),
    is_active          BOOLEAN        NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS wiz_log_client_idx       ON expedientes.wizard_submission_log (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS wiz_log_role_idx         ON expedientes.wizard_submission_log (submitted_by_role);
CREATE INDEX IF NOT EXISTS wiz_log_status_idx       ON expedientes.wizard_submission_log (status);
CREATE INDEX IF NOT EXISTS wiz_log_expediente_idx   ON expedientes.wizard_submission_log (expediente_id);
CREATE INDEX IF NOT EXISTS wiz_log_correlation_idx  ON expedientes.wizard_submission_log (correlation_id);

-- Trigger updated_at (reutiliza tg_set_updated_at creado en 70_*.sql)
DROP TRIGGER IF EXISTS tg_wiz_log_updated_at ON expedientes.wizard_submission_log;
CREATE TRIGGER tg_wiz_log_updated_at
    BEFORE UPDATE ON expedientes.wizard_submission_log
    FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

COMMENT ON TABLE expedientes.wizard_submission_log IS
    'Auditoría append-only de cada submission del Wizard de Creación (PDF/XLSX). Incluye deduplication por file_sha256 e idempotencia por idempotence_token.';


-- ============================================================
-- FIN 95c_wizard_multirole.sql
-- ============================================================
