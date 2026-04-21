-- ============================================================
-- MWT.ONE · 95_expediente_wizard.sql
-- Agente responsable: [AG-DATABASE]
--
-- Wizard de Creación de Expediente (OC → Expediente):
--   1. ALTER expedientes.expediente  ·  añade credit_clock_start_rule
--      (otras columnas del wizard — price_basis, transport_mode,
--       dispatch_mode — ya existen vía 70_*.sql y 93_*.sql).
--   2. CREATE expedientes.expediente_product_lines  ·  líneas
--      extraídas por OCR + resueltas contra resolve_client_price().
--   3. CREATE expedientes.artifact_instances  ·  instancias del
--      catálogo de artefactos (ART-01 OC, ART-02 Proforma,
--      ART-03 Decisión Modo B/C, …). Guarda el payload OCR + URL
--      de Paperless-ngx + correlation con el comando C1..C11.
--
-- Arquitectura: CERO migraciones (solo SQL idempotente),
-- CERO foreign keys (solo UUIDs con índices), aditivo.
-- Se puede correr N veces sin romper (IF NOT EXISTS everywhere).
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 0. Pre-requisito: función tg_set_updated_at() ya existe
--    (creada en 70_expedientes.sql). Si el apply-order cambia,
--    este bloque la re-crea defensivamente.
-- ────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'tg_set_updated_at') THEN
    CREATE OR REPLACE FUNCTION tg_set_updated_at() RETURNS trigger AS $fn$
    BEGIN NEW.updated_at := now(); RETURN NEW; END; $fn$ LANGUAGE plpgsql;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 1. expedientes.expediente  ·  credit_clock_start_rule
--
--    Regla que define QUÉ evento arranca el reloj de crédito del
--    cliente para este expediente. Capturado en el Step 2 del
--    wizard (CEO-ONLY). Valores canónicos:
--      'ON_BL'       · desde la emisión del Bill of Lading
--      'ON_ETA'      · desde la llegada estimada al puerto destino
--      'ON_ARRIVAL'  · desde la llegada real al warehouse del cliente
--      'ON_INVOICE'  · desde la emisión de factura fiscal
--      'ON_PROFORMA' · desde la emisión de proforma MWT (default Modo C)
-- ────────────────────────────────────────────────────────────
ALTER TABLE expedientes.expediente
    ADD COLUMN IF NOT EXISTS credit_clock_start_rule VARCHAR(16);

CREATE INDEX IF NOT EXISTS exp_credit_clock_rule_idx
    ON expedientes.expediente (credit_clock_start_rule);

-- ────────────────────────────────────────────────────────────
-- 2. expedientes.expediente_product_lines
--
--    Líneas de producto generadas en Step 3 del wizard (post-OCR).
--    Separado de expedientes.linea (que es la línea canónica
--    ligada a OC + SAP) porque estas líneas representan el output
--    crudo del OCR + resolución de precio DEL WIZARD y pueden
--    divergir de la línea oficial hasta que el CEO apruebe el
--    Step 4 (Review). Una vez aprobado, el worker C2/C3 copia
--    estas filas a expedientes.linea con el SAP correspondiente.
--
--    Cada fila trae el veredicto del resolver de precio:
--       price_verdict: OK / WARN_BELOW_SYSTEM / WARN_MOQ / ERROR
--       price_delta_pct: (ocr_price - system_price) / system_price
--       moq_violated: TRUE si qty < MOQ del cliente
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expedientes.expediente_product_lines (
    id                   UUID           PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Vínculos lógicos (sin FK por política)
    expediente_id        UUID           NOT NULL,
    proforma_id          UUID,                                        -- ART-02 (si ya emitida)
    oc_id                UUID,                                         -- OC origen (ART-01)
    producto_id          UUID,                                         -- productos.producto
    client_id            UUID,                                         -- cliente dueño del precio

    -- Datos comerciales
    sku                  VARCHAR(64),
    descripcion          VARCHAR(255),
    size                 VARCHAR(16),
    qty                  NUMERIC(14,2)  NOT NULL DEFAULT 0,
    unit_price           NUMERIC(14,4)  NOT NULL DEFAULT 0,            -- precio OCR (el que puso el cliente)
    total_price          NUMERIC(14,2)  NOT NULL DEFAULT 0,
    currency             CHAR(3)        NOT NULL DEFAULT 'USD',

    -- Validación vía resolve_client_price()
    system_unit_price    NUMERIC(14,4),                                -- precio canónico MWT para ese client+SKU
    price_delta_pct      NUMERIC(7,4),                                 -- (unit_price - system_unit_price) / system_unit_price
    price_verdict        VARCHAR(24)    NOT NULL DEFAULT 'PENDING',    -- OK / WARN_BELOW_SYSTEM / WARN_ABOVE_SYSTEM / WARN_MOQ / ERROR / PENDING
    moq_client           NUMERIC(14,2),                                -- MOQ vigente del cliente para ese SKU
    moq_violated         BOOLEAN        NOT NULL DEFAULT FALSE,
    validation_notes     TEXT,

    -- OCR traceability
    ocr_confidence       NUMERIC(5,4),                                 -- 0.0000 — 1.0000
    ocr_raw_line         TEXT,                                         -- línea cruda escaneada
    ocr_bounding_box     JSONB,                                        -- {x,y,w,h} en la página del PDF

    -- Ciclo de vida
    estado               VARCHAR(32)    NOT NULL DEFAULT 'DRAFT',      -- DRAFT / APPROVED / REJECTED / PROMOTED
    promoted_linea_id    UUID,                                         -- cuando C2 copia a expedientes.linea
    notas                TEXT,
    is_active            BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at           TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS epl_exp_idx       ON expedientes.expediente_product_lines (expediente_id);
CREATE INDEX IF NOT EXISTS epl_proforma_idx  ON expedientes.expediente_product_lines (proforma_id);
CREATE INDEX IF NOT EXISTS epl_oc_idx        ON expedientes.expediente_product_lines (oc_id);
CREATE INDEX IF NOT EXISTS epl_producto_idx  ON expedientes.expediente_product_lines (producto_id);
CREATE INDEX IF NOT EXISTS epl_client_idx    ON expedientes.expediente_product_lines (client_id);
CREATE INDEX IF NOT EXISTS epl_sku_idx       ON expedientes.expediente_product_lines (sku);
CREATE INDEX IF NOT EXISTS epl_estado_idx    ON expedientes.expediente_product_lines (estado);
CREATE INDEX IF NOT EXISTS epl_verdict_idx   ON expedientes.expediente_product_lines (price_verdict);

-- ────────────────────────────────────────────────────────────
-- 3. expedientes.artifact_instances
--
--    Instancia concreta de un artefacto del catálogo MWT para un
--    expediente dado. Amplía/reemplaza funcionalmente a
--    expedientes.documento cuando la instancia viene del wizard
--    OCR: guarda el payload estructurado extraído, la URL en
--    Paperless-ngx, y correlaciona con el comando del pipeline
--    (C1..C11) que la disparó.
--
--    Catálogo de artifact_code:
--       ART-01  OC Cliente (PDF original)
--       ART-02  Proforma MWT
--       ART-03  Decisión Modo B/C (CEO-ONLY)
--       ART-04  Confirmación SAP
--       ART-05  Pago anticipo
--       ART-06  Bill of Lading
--       ART-07  Packing list
--       ART-08  Factura fiscal
--       ART-09  Shipping update
--       ART-10  Liberación de crédito
--       ART-11  Cierre de expediente
--
--    El wizard crea, en el mismo transaction.atomic():
--       ART-01 (uploaded)  →  ART-02 (derived)  →  ART-03 (decision)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expedientes.artifact_instances (
    id                   UUID           PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Vínculo
    expediente_id        UUID           NOT NULL,
    oc_id                UUID,                                         -- útil cuando artifact_code='ART-01'

    -- Clasificación en el catálogo MWT
    artifact_code        VARCHAR(16)    NOT NULL,                       -- 'ART-01', 'ART-02', ...
    kind                 VARCHAR(64)    NOT NULL,                       -- humano: 'OC Cliente', 'Proforma MWT', 'Decisión Modo', 'Bill of Lading'
    codigo               VARCHAR(96),                                   -- nº externo: 'PO-2026-00123', 'PROF-1045', …

    -- Almacenamiento físico (Paperless-ngx / S3)
    file_ext             VARCHAR(16),
    file_size_bytes      BIGINT         DEFAULT 0,
    storage_url          TEXT,                                          -- signed URL
    paperless_doc_id     VARCHAR(64),                                   -- ID en Paperless-ngx
    content_hash         VARCHAR(64),                                   -- SHA-256 del archivo (idempotencia)

    -- OCR / payload estructurado
    ocr_status           VARCHAR(16)    NOT NULL DEFAULT 'PENDING',     -- PENDING / PROCESSING / DONE / FAILED / SKIPPED
    ocr_engine           VARCHAR(32),                                    -- 'paperless-ngx+tika' / 'azure-form-recognizer'
    ocr_confidence       NUMERIC(5,4),
    ocr_payload          JSONB          NOT NULL DEFAULT '{}'::jsonb,   -- {client_name, po_number, po_date, currency, total, lines:[...]}
    ocr_error            TEXT,

    -- Correlación con el state machine (pipeline.event_log.action_source)
    action_source        VARCHAR(16),                                    -- 'C1' / 'C2' / 'C3' / 'C4' …
    correlation_id       UUID,                                           -- vincula los eventos del mismo workflow
    event_log_id         UUID,                                           -- pipeline.event_log.id (si ya existe evento)

    -- Metadata
    author               VARCHAR(128),                                   -- humano (CEO) o bot ('CollectionBot', 'OCRBot')
    fecha                DATE,
    visibility_tier      VARCHAR(16)    NOT NULL DEFAULT 'INTERNAL',    -- PUBLIC / PARTNER_B2B / INTERNAL / CEO-ONLY
    is_active            BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at           TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_exp_idx            ON expedientes.artifact_instances (expediente_id);
CREATE INDEX IF NOT EXISTS ai_oc_idx             ON expedientes.artifact_instances (oc_id);
CREATE INDEX IF NOT EXISTS ai_code_idx           ON expedientes.artifact_instances (artifact_code);
CREATE INDEX IF NOT EXISTS ai_kind_idx           ON expedientes.artifact_instances (kind);
CREATE INDEX IF NOT EXISTS ai_ocr_status_idx     ON expedientes.artifact_instances (ocr_status);
CREATE INDEX IF NOT EXISTS ai_action_source_idx  ON expedientes.artifact_instances (action_source);
CREATE INDEX IF NOT EXISTS ai_correlation_idx    ON expedientes.artifact_instances (correlation_id);
CREATE INDEX IF NOT EXISTS ai_content_hash_idx   ON expedientes.artifact_instances (content_hash);
CREATE INDEX IF NOT EXISTS ai_ocr_payload_gin    ON expedientes.artifact_instances USING gin (ocr_payload);

-- Unicidad lógica: un expediente NO puede tener 2 instancias del
-- mismo artifact_code activas al mismo tiempo (excepto ART-01/07
-- donde puede haber múltiples anexos). Se valida en el ViewSet
-- de Django (no se fuerza a nivel SQL porque queremos permitir
-- versionado de artefactos).
CREATE UNIQUE INDEX IF NOT EXISTS ai_unique_active_artifact
    ON expedientes.artifact_instances (expediente_id, artifact_code)
    WHERE is_active = TRUE
      AND artifact_code IN ('ART-02','ART-03','ART-04','ART-10','ART-11');

-- ────────────────────────────────────────────────────────────
-- Triggers updated_at
-- ────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS tg_epl_upd ON expedientes.expediente_product_lines;
DROP TRIGGER IF EXISTS tg_ai_upd  ON expedientes.artifact_instances;

CREATE TRIGGER tg_epl_upd
    BEFORE UPDATE ON expedientes.expediente_product_lines
    FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

CREATE TRIGGER tg_ai_upd
    BEFORE UPDATE ON expedientes.artifact_instances
    FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- ────────────────────────────────────────────────────────────
-- Verificación rápida (informativa):
--   \d expedientes.expediente_product_lines
--   \d expedientes.artifact_instances
--   SELECT column_name FROM information_schema.columns
--     WHERE table_schema='expedientes' AND table_name='expediente'
--       AND column_name='credit_clock_start_rule';
-- ────────────────────────────────────────────────────────────
