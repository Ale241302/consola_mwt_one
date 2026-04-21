-- ============================================================
-- MWT.ONE · 94b_portal_analytics_audit.sql
-- Agente responsable: [AG-DATABASE]
--
-- Correcciones derivadas de la auditoría cross-stack de dos
-- módulos gemelos:
--
--   · Portal B2B (Login.jsx, PortalLayout, PortalDashboard,
--                 PortalExpedienteDetail, PortalSettings)
--   · Dashboard (Dashboard.jsx, widgets KPI, preferences tab)
--
-- Ambos comparten la necesidad de auditar quién ve qué y cuándo,
-- y garantizar idempotencia de snapshots programados.
--
-- Cubre cinco gaps entre el frontend y el schema persistido:
--
--   1. portal.portal_session_log   · log de login/logout/refresh
--      de mwt_user (JWT session audit).
--
--   2. portal.portal_audit_log     · trail de acciones (cada fetch
--      a recurso protegido: expediente, documento, pago, etc.).
--
--   3. portal.mwt_user.idempotence_token  · columna + unique partial
--      index para que un flujo de invite/accept no duplique usuarios.
--
--   4. portal.mwt_user.preferences · JSONB para almacenar locale,
--      timezone, theme, widgets_fav, etc. (hoy en metadata mezclado).
--
--   5. dashboard.snapshot.idempotence_token + scope_hash · evitar
--      que el cron nocturno cree snapshots duplicados para el mismo
--      (user, period, scope).
--
-- Arquitectura: CERO migraciones, CERO FKs, aditivo, idempotente.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 0. Pre-requisito: funciones touch_updated_at por schema
--    (creadas en 94_pipeline_financiero_portal.sql). Re-creadas
--    defensivamente.
-- ────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.proname = 'touch_updated_at' AND n.nspname = 'portal'
  ) THEN
    CREATE OR REPLACE FUNCTION portal.touch_updated_at() RETURNS trigger AS $fn$
    BEGIN NEW.updated_at := CURRENT_TIMESTAMP; RETURN NEW; END; $fn$ LANGUAGE plpgsql;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.proname = 'touch_updated_at' AND n.nspname = 'dashboard'
  ) THEN
    CREATE OR REPLACE FUNCTION dashboard.touch_updated_at() RETURNS trigger AS $fn$
    BEGIN NEW.updated_at := CURRENT_TIMESTAMP; RETURN NEW; END; $fn$ LANGUAGE plpgsql;
  END IF;
END $$;

-- ============================================================
-- PORTAL
-- ============================================================
SET search_path = portal, public;

-- ────────────────────────────────────────────────────────────
-- 1. portal.mwt_user  — idempotence + preferences + invite token
-- ────────────────────────────────────────────────────────────
ALTER TABLE portal.mwt_user
    ADD COLUMN IF NOT EXISTS idempotence_token    VARCHAR(64),
    ADD COLUMN IF NOT EXISTS preferences          JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS invite_token         VARCHAR(128),
    ADD COLUMN IF NOT EXISTS invite_expires_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS password_hash        VARCHAR(255),
    ADD COLUMN IF NOT EXISTS password_changed_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS failed_login_count   INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS locked_until         TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS scope_ids            JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mwtuser_idempotence_active
    ON portal.mwt_user (idempotence_token)
    WHERE idempotence_token IS NOT NULL AND is_active = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mwtuser_invite_token
    ON portal.mwt_user (invite_token)
    WHERE invite_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mwtuser_locked
    ON portal.mwt_user (locked_until)
    WHERE locked_until IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 2. portal.portal_session_log
--
--    Log de sesiones JWT: login, logout, refresh, invalidación.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS portal.portal_session_log (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mwt_user_id       UUID          NOT NULL,
    email             CITEXT,
    event_type        VARCHAR(16)   NOT NULL,
    -- event_type ∈ { LOGIN, LOGOUT, REFRESH, LOGIN_FAILED, LOCKED, PWD_RESET }
    session_token_id  VARCHAR(128),
    ip_address        INET,
    user_agent        TEXT,
    locale            VARCHAR(8),
    timezone          VARCHAR(48),
    success           BOOLEAN       NOT NULL DEFAULT TRUE,
    error_code        VARCHAR(64),
    error_message     TEXT,
    is_active         BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_psl_user      ON portal.portal_session_log(mwt_user_id);
CREATE INDEX IF NOT EXISTS idx_psl_event     ON portal.portal_session_log(event_type);
CREATE INDEX IF NOT EXISTS idx_psl_created   ON portal.portal_session_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_psl_success   ON portal.portal_session_log(success);

DROP TRIGGER IF EXISTS tg_psl_upd ON portal.portal_session_log;
CREATE TRIGGER tg_psl_upd
    BEFORE UPDATE ON portal.portal_session_log
    FOR EACH ROW EXECUTE FUNCTION portal.touch_updated_at();

-- ────────────────────────────────────────────────────────────
-- 3. portal.portal_audit_log
--
--    Audit trail de acciones del portal B2B — cada fetch a un
--    recurso protegido (expediente, documento, pago, usuario).
--    Satisface compliance "quién vio qué y cuándo".
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS portal.portal_audit_log (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mwt_user_id       UUID          NOT NULL,
    email             CITEXT,
    action            VARCHAR(32)   NOT NULL,
    -- action ∈ { VIEW, DOWNLOAD, EXPORT, CREATE, UPDATE, DELETE, UPLOAD }
    resource_type     VARCHAR(32)   NOT NULL,
    -- resource_type ∈ { expediente, documento, pago, proforma, cliente, perfil }
    resource_id       UUID,
    resource_label    VARCHAR(255),
    ip_address        INET,
    user_agent        TEXT,
    status_code       INTEGER,
    duration_ms       INTEGER,
    payload           JSONB         NOT NULL DEFAULT '{}'::jsonb,
    is_active         BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pal_user         ON portal.portal_audit_log(mwt_user_id);
CREATE INDEX IF NOT EXISTS idx_pal_action       ON portal.portal_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_pal_resource     ON portal.portal_audit_log(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_pal_created      ON portal.portal_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pal_payload_gin  ON portal.portal_audit_log USING gin (payload);

DROP TRIGGER IF EXISTS tg_pal_upd ON portal.portal_audit_log;
CREATE TRIGGER tg_pal_upd
    BEFORE UPDATE ON portal.portal_audit_log
    FOR EACH ROW EXECUTE FUNCTION portal.touch_updated_at();

-- ============================================================
-- DASHBOARD
-- ============================================================
SET search_path = dashboard, public;

-- ────────────────────────────────────────────────────────────
-- 4. dashboard.snapshot  — idempotence + scope_hash + generated_by
-- ────────────────────────────────────────────────────────────
ALTER TABLE dashboard.snapshot
    ADD COLUMN IF NOT EXISTS idempotence_token   VARCHAR(64),
    ADD COLUMN IF NOT EXISTS scope_hash          VARCHAR(64),
    ADD COLUMN IF NOT EXISTS generated_by        VARCHAR(16) NOT NULL DEFAULT 'user',
    -- generated_by ∈ { user, cron, system, api }
    ADD COLUMN IF NOT EXISTS generated_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS expires_at          TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uq_dashsnap_idempotence_active
    ON dashboard.snapshot (idempotence_token)
    WHERE idempotence_token IS NOT NULL AND is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_dashsnap_scope_hash
    ON dashboard.snapshot (scope_hash)
    WHERE scope_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dashsnap_generated_by
    ON dashboard.snapshot (generated_by);

CREATE INDEX IF NOT EXISTS idx_dashsnap_expires
    ON dashboard.snapshot (expires_at)
    WHERE expires_at IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 5. dashboard.widget_cat
--
--    Catálogo cerrado de widgets disponibles para el dashboard.
--    Permite feature-flagging por rol y persistir el layout del
--    usuario referenciando códigos en vez de strings libres.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dashboard.widget_cat (
    codigo          VARCHAR(32)  PRIMARY KEY,
    label           VARCHAR(96)  NOT NULL,
    category        VARCHAR(32),
    min_role        VARCHAR(32)  NOT NULL DEFAULT 'ops',
    default_layout  JSONB        NOT NULL DEFAULT '{}'::jsonb,
    orden           INTEGER      NOT NULL DEFAULT 100,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE
);

INSERT INTO dashboard.widget_cat (codigo, label, category, min_role, orden) VALUES
    ('ventas_mes',           'Ventas del mes',             'finance',    'ops',     10),
    ('expedientes_open',     'Expedientes abiertos',       'ops',        'ops',     20),
    ('stock_critico',        'Stock bajo mínimo',          'inventario', 'ops',     30),
    ('cobranza_vencida',     'Cobranza vencida',           'finance',    'finance', 40),
    ('pipeline_signal',      'Semáforo pipeline',          'ops',        'ops',     50),
    ('marketing_funnel',     'Funnel marketing',           'marketing',  'ops',     60),
    ('fx_tracker',           'Tipo de cambio',             'finance',    'finance', 70),
    ('notifications_failure','Notificaciones fallidas',    'ops',        'ops',     80),
    ('top_clientes',         'Top clientes 30d',           'finance',    'ops',     90),
    ('transferencias_disc',  'Discrepancias transferencia','logistics',  'ops',    100)
ON CONFLICT (codigo) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- Fin 94b_portal_analytics_audit.sql
-- ============================================================
