-- ============================================================
-- MWT.ONE · 91_email_templates.sql
-- Agente responsable: [AG-DATABASE]
--
-- Catálogo de plantillas Jinja2 usadas por Celery al disparar
-- notificaciones (proforma, despacho, cobranza C1/C2/C3, etc.).
-- Soporte multi-idioma (ES/EN) y multi-marca (GLOBAL + scoped).
-- Idempotente.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS email_templates;

SET search_path = email_templates, public;

-- ────────────────────────────────────────────────────────────
-- CATÁLOGOS
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_templates.language_cat (
    codigo     VARCHAR(8)  PRIMARY KEY,
    label      VARCHAR(32) NOT NULL,
    orden      INTEGER     NOT NULL DEFAULT 100,
    is_active  BOOLEAN     NOT NULL DEFAULT TRUE
);

INSERT INTO email_templates.language_cat(codigo, label, orden) VALUES
    ('ES', 'Español', 10),
    ('EN', 'English', 20),
    ('PT', 'Português', 30)
ON CONFLICT (codigo) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- Plantilla
--   (template_key, language, brand) identifica unívocamente
--   la plantilla que Jinja2 renderizará.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_templates.template (
    id                UUID PRIMARY KEY,
    name              VARCHAR(128) NOT NULL,
    template_key      VARCHAR(64)  NOT NULL,
    language          VARCHAR(8)   NOT NULL DEFAULT 'ES',
    brand             VARCHAR(32)  NOT NULL DEFAULT 'GLOBAL',
    brand_id          UUID,                            -- opcional: si apunta a una marca específica
    subject_template  VARCHAR(512) NOT NULL,
    body_template     TEXT         NOT NULL,           -- Jinja2 source
    variables_meta    JSONB        NOT NULL DEFAULT '[]'::jsonb, -- [{name, kind, required}]
    sent_count_30d    INTEGER      NOT NULL DEFAULT 0,
    is_active         BOOLEAN      NOT NULL DEFAULT TRUE,  -- FALSE = kill switch
    created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_template_key_lang_brand UNIQUE (template_key, language, brand)
);

CREATE INDEX IF NOT EXISTS idx_tpl_key     ON email_templates.template(template_key);
CREATE INDEX IF NOT EXISTS idx_tpl_lang    ON email_templates.template(language);
CREATE INDEX IF NOT EXISTS idx_tpl_brand   ON email_templates.template(brand);
CREATE INDEX IF NOT EXISTS idx_tpl_active  ON email_templates.template(is_active);

-- ────────────────────────────────────────────────────────────
-- Versiones (auditoría append-only)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_templates.version (
    id                UUID PRIMARY KEY,
    template_id       UUID NOT NULL,
    subject_template  VARCHAR(512),
    body_template     TEXT,
    changed_by_id     UUID,
    changed_by_name   VARCHAR(128),
    change_note       VARCHAR(512),
    created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tplver_tpl ON email_templates.version(template_id);

-- ────────────────────────────────────────────────────────────
-- Triggers de updated_at
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION email_templates.touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_tpl_upd ON email_templates.template;

CREATE TRIGGER tg_tpl_upd
    BEFORE UPDATE ON email_templates.template
    FOR EACH ROW EXECUTE FUNCTION email_templates.touch_updated_at();
