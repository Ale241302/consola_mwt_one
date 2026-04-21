-- ============================================================
-- MWT.ONE · 91b_email_templates_audit.sql
-- Agente responsable: [AG-DATABASE]
--
-- Correcciones derivadas de la auditoría cross-stack del módulo
-- Plantillas (EmailTemplates.jsx + TemplateEditor + preview panel).
--
-- Cubre cuatro gaps entre el frontend y el schema persistido:
--
--   1. email_templates.template_status_cat  · catálogo cerrado
--      de estados de plantilla (DRAFT / PUBLISHED / ARCHIVED).
--      Antes la plantilla solo tenía is_active (bool) — ahora hay
--      ciclo de vida de 3 estados con semántica clara.
--
--   2. email_templates.template.status       · columna que referencia
--      al catálogo; PUBLISHED = la que Celery usa para enviar.
--
--   3. email_templates.template.idempotence_token · para evitar
--      que un import/seed re-cree la misma plantilla.
--
--   4. email_templates.render_preview_log    · log append-only de
--      renders de preview (Jinja2 sobre payload sintético). Se usa
--      para debuggear plantillas rotas sin tocar envíos reales.
--
-- Arquitectura: CERO migraciones, CERO FKs, aditivo, idempotente.
-- ============================================================

SET search_path = email_templates, public;

-- ────────────────────────────────────────────────────────────
-- 0. Pre-requisito: función email_templates.touch_updated_at()
--    ya existe (creada en 91_email_templates.sql). Re-creada
--    defensivamente por si el apply-order cambia.
-- ────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.proname = 'touch_updated_at' AND n.nspname = 'email_templates'
  ) THEN
    CREATE OR REPLACE FUNCTION email_templates.touch_updated_at() RETURNS trigger AS $fn$
    BEGIN NEW.updated_at := CURRENT_TIMESTAMP; RETURN NEW; END; $fn$ LANGUAGE plpgsql;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 1. email_templates.template_status_cat
--
--    Catálogo cerrado de estados de ciclo de vida:
--      · DRAFT      · edición libre, NO se usa para enviar
--      · PUBLISHED  · plantilla viva usada por Celery / workflow
--      · ARCHIVED   · congelada (versión histórica) — read-only
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_templates.template_status_cat (
    codigo         VARCHAR(16)  PRIMARY KEY,
    label          VARCHAR(64)  NOT NULL,
    color          VARCHAR(16),
    orden          INTEGER      NOT NULL DEFAULT 100,
    permite_envio  BOOLEAN      NOT NULL DEFAULT FALSE,
    permite_edicion BOOLEAN     NOT NULL DEFAULT TRUE,
    is_active      BOOLEAN      NOT NULL DEFAULT TRUE
);

INSERT INTO email_templates.template_status_cat
    (codigo, label, color, orden, permite_envio, permite_edicion) VALUES
    ('DRAFT',     'Borrador',  '#64748B', 10, FALSE, TRUE),
    ('PUBLISHED', 'Publicada', '#00B286', 20, TRUE,  TRUE),
    ('ARCHIVED',  'Archivada', '#94A3B8', 30, FALSE, FALSE)
ON CONFLICT (codigo) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 2. email_templates.template  — status + idempotence_token + last_test_send
-- ────────────────────────────────────────────────────────────
ALTER TABLE email_templates.template
    ADD COLUMN IF NOT EXISTS status             VARCHAR(16)  NOT NULL DEFAULT 'DRAFT',
    ADD COLUMN IF NOT EXISTS idempotence_token  VARCHAR(64),
    ADD COLUMN IF NOT EXISTS last_test_send_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS published_at       TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS published_by_id    UUID,
    ADD COLUMN IF NOT EXISTS archived_at        TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS archived_by_id     UUID;

CREATE INDEX IF NOT EXISTS idx_tpl_status
    ON email_templates.template(status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tpl_idempotence_active
    ON email_templates.template (idempotence_token)
    WHERE idempotence_token IS NOT NULL AND is_active = TRUE;

-- ────────────────────────────────────────────────────────────
-- 3. email_templates.render_preview_log
--
--    Log append-only de renders de preview. Se usa cuando el
--    usuario hace click en "Preview" en el template editor; guarda
--    el payload sintético usado, el output renderizado y eventuales
--    errores de Jinja2. NO genera envío real.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_templates.render_preview_log (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id         UUID         NOT NULL,
    template_key        VARCHAR(64)  NOT NULL,
    language            VARCHAR(8)   NOT NULL,
    brand               VARCHAR(32)  NOT NULL DEFAULT 'GLOBAL',
    payload_sample      JSONB        NOT NULL DEFAULT '{}'::jsonb,
    rendered_subject    VARCHAR(512),
    rendered_body       TEXT,
    render_ok           BOOLEAN      NOT NULL DEFAULT TRUE,
    error_code          VARCHAR(64),
    error_message       TEXT,
    duration_ms         INTEGER,
    triggered_by_id     UUID,
    triggered_by_name   VARCHAR(128),
    is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rpl_template    ON email_templates.render_preview_log(template_id);
CREATE INDEX IF NOT EXISTS idx_rpl_key_lang    ON email_templates.render_preview_log(template_key, language);
CREATE INDEX IF NOT EXISTS idx_rpl_ok          ON email_templates.render_preview_log(render_ok);
CREATE INDEX IF NOT EXISTS idx_rpl_created     ON email_templates.render_preview_log(created_at DESC);

DROP TRIGGER IF EXISTS tg_rpl_upd ON email_templates.render_preview_log;
CREATE TRIGGER tg_rpl_upd
    BEFORE UPDATE ON email_templates.render_preview_log
    FOR EACH ROW EXECUTE FUNCTION email_templates.touch_updated_at();

-- ────────────────────────────────────────────────────────────
-- Fin 91b_email_templates_audit.sql
-- ============================================================
