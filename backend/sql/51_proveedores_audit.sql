-- ============================================================
-- MWT.ONE · 51_proveedores_audit.sql
-- Agente responsable: [AG-DATABASE]
--
-- Correcciones derivadas de la auditoría Bloque 2 del Módulo 11
-- (Proveedores). Cubre 6 tablas satélite:
--
--   1. clase_cat            · catálogo (CRITICO/NORMAL/EVENTUAL)
--   2. score_iso_cat        · catálogo de scores ISO 0..5
--   3. supplier_promo_code  · códigos de promoción persistentes
--   4. supplier_audit_event · append-only log de cambios
--   5. supplier_import_log  · trazabilidad de uploads de catálogo
--   6. supplier_certificacion · certificaciones ISO con vencimiento
--
-- Reglas: PK UUID, CERO FK, is_active, created_at + updated_at
-- + trigger, IF NOT EXISTS.
-- ============================================================

SET search_path = proveedores, public;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'tg_set_updated_at') THEN
    CREATE OR REPLACE FUNCTION tg_set_updated_at() RETURNS trigger AS $fn$
    BEGIN NEW.updated_at := now(); RETURN NEW; END; $fn$ LANGUAGE plpgsql;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 1. proveedores.clase_cat  ·  (93_schema_extensions.sql §6 trae
--    la columna `clase`, este catálogo es la fuente del select).
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS proveedores.clase_cat (
    codigo      VARCHAR(16)   PRIMARY KEY,
    label       VARCHAR(64)   NOT NULL,
    descripcion TEXT,
    color       VARCHAR(16),
    orden       INTEGER       NOT NULL DEFAULT 100,
    is_active   BOOLEAN       NOT NULL DEFAULT TRUE
);

INSERT INTO proveedores.clase_cat (codigo, label, descripcion, color, orden) VALUES
    ('CRITICO',  'Crítico',  'Proveedor estratégico — reemplazo difícil',  '#EF4444', 10),
    ('NORMAL',   'Normal',   'Proveedor recurrente de operación regular',  '#00B286', 20),
    ('EVENTUAL', 'Eventual', 'Proveedor puntual — compras spot',           '#64748B', 30)
ON CONFLICT (codigo) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 2. proveedores.score_iso_cat  ·  tabla de scores 0..5 con label.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS proveedores.score_iso_cat (
    codigo      NUMERIC(3,2)  PRIMARY KEY,
    label       VARCHAR(64)   NOT NULL,
    descripcion TEXT,
    color       VARCHAR(16),
    is_active   BOOLEAN       NOT NULL DEFAULT TRUE
);

INSERT INTO proveedores.score_iso_cat (codigo, label, color) VALUES
    (0.0, 'No certificado',              '#64748B'),
    (1.0, 'En proceso',                  '#F59E0B'),
    (2.0, 'Certificado básico',          '#3083FE'),
    (3.0, 'Certificado completo',        '#00B286'),
    (4.0, 'Certificado avanzado',        '#1DE394'),
    (5.0, 'Certificado premium',         '#1EE3D7')
ON CONFLICT (codigo) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 3. proveedores.supplier_promo_code  ·  códigos del PromoEngine
--    que hoy viven solo en memoria (`sessionCodes[]`). Cada código
--    persiste con vigencia + scope + reglas.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS proveedores.supplier_promo_code (
    id                UUID PRIMARY KEY,
    proveedor_id      UUID           NOT NULL,                   -- ⛔ sin FK
    codigo            VARCHAR(32)    NOT NULL,
    descripcion       VARCHAR(255),

    tipo_descuento    VARCHAR(16)    NOT NULL DEFAULT 'PCT',
                      -- PCT / FIXED / VOLUMEN / COMBO
    descuento_pct     NUMERIC(5,2),
    descuento_monto   NUMERIC(14,2),
    moneda            VARCHAR(3)     NOT NULL DEFAULT 'USD',

    min_volumen       NUMERIC(14,3),                             -- null si tipo != VOLUMEN
    max_volumen       NUMERIC(14,3),

    vigencia_inicio   DATE           NOT NULL,
    vigencia_fin      DATE,
    max_usos          INTEGER,
    usos_actuales     INTEGER        NOT NULL DEFAULT 0,

    scope             VARCHAR(16)    NOT NULL DEFAULT 'GLOBAL',
                      -- GLOBAL / CATEGORIA / SKU / CLIENTE
    scope_ids         JSONB          NOT NULL DEFAULT '[]'::jsonb,
    reglas_json       JSONB          NOT NULL DEFAULT '{}'::jsonb,

    created_by        UUID,                                      -- ⛔ sin FK
    is_active         BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_promo_code
    ON proveedores.supplier_promo_code (codigo)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS ix_supp_promo_proveedor   ON proveedores.supplier_promo_code(proveedor_id);
CREATE INDEX IF NOT EXISTS ix_supp_promo_vigencia    ON proveedores.supplier_promo_code(vigencia_inicio, vigencia_fin);
CREATE INDEX IF NOT EXISTS ix_supp_promo_scope       ON proveedores.supplier_promo_code(scope);
CREATE INDEX IF NOT EXISTS ix_supp_promo_scope_gin
    ON proveedores.supplier_promo_code USING gin (scope_ids);

DROP TRIGGER IF EXISTS trg_supplier_promo_code_updated_at ON proveedores.supplier_promo_code;
CREATE TRIGGER trg_supplier_promo_code_updated_at
BEFORE UPDATE ON proveedores.supplier_promo_code
FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- ────────────────────────────────────────────────────────────
-- 4. proveedores.supplier_audit_event  ·  log append-only del
--    SupplierAuditTab. Cualquier cambio sensible (precio, leadtime,
--    certificación, status, condiciones de pago) deja una fila
--    inmutable (el is_active=FALSE solo oculta, no borra).
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS proveedores.supplier_audit_event (
    id               UUID PRIMARY KEY,
    proveedor_id     UUID           NOT NULL,                    -- ⛔ sin FK
    evento_tipo      VARCHAR(32)    NOT NULL,
                     -- PRICE_CHANGE / LEADTIME_CHANGE / STATUS_CHANGE /
                     -- CERT_UPDATE / PROMO_CREATED / IMPORT_RUN / NOTE
    entidad_afectada VARCHAR(64),                                -- "proveedor" / "supplier_promo_code" / "supplier_certificacion"
    entidad_id       UUID,                                       -- ID de la entidad afectada
    campo            VARCHAR(64),
    valor_anterior   JSONB,
    valor_nuevo      JSONB,
    delta_resumen    TEXT,
    contexto_json    JSONB          NOT NULL DEFAULT '{}'::jsonb,

    actor_id         UUID,                                       -- ⛔ sin FK
    actor_type       VARCHAR(16)    NOT NULL DEFAULT 'USER',
                     -- USER / SYSTEM / API / SCHEDULED_JOB
    ip_address       VARCHAR(64),

    is_active        BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_supp_audit_proveedor    ON proveedores.supplier_audit_event(proveedor_id);
CREATE INDEX IF NOT EXISTS ix_supp_audit_tipo         ON proveedores.supplier_audit_event(evento_tipo);
CREATE INDEX IF NOT EXISTS ix_supp_audit_entidad      ON proveedores.supplier_audit_event(entidad_afectada, entidad_id);
CREATE INDEX IF NOT EXISTS ix_supp_audit_created      ON proveedores.supplier_audit_event(created_at DESC);
CREATE INDEX IF NOT EXISTS ix_supp_audit_actor        ON proveedores.supplier_audit_event(actor_id);

DROP TRIGGER IF EXISTS trg_supplier_audit_event_updated_at ON proveedores.supplier_audit_event;
CREATE TRIGGER trg_supplier_audit_event_updated_at
BEFORE UPDATE ON proveedores.supplier_audit_event
FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- ────────────────────────────────────────────────────────────
-- 5. proveedores.supplier_import_log  ·  trazabilidad de uploads
--    de catálogo del proveedor (2 pasos: preview → commit).
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS proveedores.supplier_import_log (
    id              UUID PRIMARY KEY,
    proveedor_id    UUID           NOT NULL,                     -- ⛔ sin FK
    user_id         UUID,                                        -- ⛔ sin FK
    filename        VARCHAR(256)   NOT NULL,
    content_type    VARCHAR(96),
    source_url      TEXT,

    rows_total      INTEGER        NOT NULL DEFAULT 0,
    rows_valid      INTEGER        NOT NULL DEFAULT 0,
    rows_invalid    INTEGER        NOT NULL DEFAULT 0,
    rows_inserted   INTEGER        NOT NULL DEFAULT 0,
    rows_updated    INTEGER        NOT NULL DEFAULT 0,

    status          VARCHAR(16)    NOT NULL DEFAULT 'VALIDATING',
                    -- VALIDATING / VALID / PARTIAL / COMMITTED / REJECTED / FAILED
    mapping_json    JSONB          NOT NULL DEFAULT '{}'::jsonb,
    preview_json    JSONB          NOT NULL DEFAULT '[]'::jsonb,
    errors_json     JSONB          NOT NULL DEFAULT '[]'::jsonb,
    summary_json    JSONB          NOT NULL DEFAULT '{}'::jsonb,

    committed_at    TIMESTAMPTZ,
    committed_by    UUID,
    is_active       BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_supp_import_proveedor   ON proveedores.supplier_import_log(proveedor_id);
CREATE INDEX IF NOT EXISTS ix_supp_import_user        ON proveedores.supplier_import_log(user_id);
CREATE INDEX IF NOT EXISTS ix_supp_import_status      ON proveedores.supplier_import_log(status);
CREATE INDEX IF NOT EXISTS ix_supp_import_created     ON proveedores.supplier_import_log(created_at DESC);
CREATE INDEX IF NOT EXISTS ix_supp_import_errors_gin
    ON proveedores.supplier_import_log USING gin (errors_json);

DROP TRIGGER IF EXISTS trg_supplier_import_log_updated_at ON proveedores.supplier_import_log;
CREATE TRIGGER trg_supplier_import_log_updated_at
BEFORE UPDATE ON proveedores.supplier_import_log
FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- ────────────────────────────────────────────────────────────
-- 6. proveedores.supplier_certificacion  ·  certificaciones ISO
--    con fecha de emisión, vencimiento y archivo asociado. Es el
--    backing "duro" del array JSONB `certificaciones` que el
--    proveedor tiene hoy — permite alertar por vencimiento próximo.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS proveedores.supplier_certificacion (
    id                     UUID PRIMARY KEY,
    proveedor_id           UUID           NOT NULL,              -- ⛔ sin FK
    tipo_certificacion     VARCHAR(32)    NOT NULL,
                           -- ISO_9001 / ISO_14001 / ISO_45001 / ISO_20345 / OTRO
    numero_certificado     VARCHAR(64),
    fecha_emision          DATE           NOT NULL,
    fecha_vencimiento      DATE,
    organismo_certificador VARCHAR(128),
    alcance                TEXT,
    archivo_url            TEXT,
    alert_dias_antes       INTEGER        NOT NULL DEFAULT 60,   -- ventana de alerta pre-vencimiento

    score                  NUMERIC(3,2),                         -- score individual asociado (0..5)
    notas                  TEXT,

    is_active              BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at             TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_supp_cert_proveedor    ON proveedores.supplier_certificacion(proveedor_id);
CREATE INDEX IF NOT EXISTS ix_supp_cert_tipo         ON proveedores.supplier_certificacion(tipo_certificacion);
CREATE INDEX IF NOT EXISTS ix_supp_cert_vencimiento  ON proveedores.supplier_certificacion(fecha_vencimiento);

DROP TRIGGER IF EXISTS trg_supplier_certificacion_updated_at ON proveedores.supplier_certificacion;
CREATE TRIGGER trg_supplier_certificacion_updated_at
BEFORE UPDATE ON proveedores.supplier_certificacion
FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- ============================================================
