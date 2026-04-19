-- =====================================================================
-- MWT.ONE · init.sql
-- Agente responsable: [AG-DATABASE]
-- Reglas de arquitectura:
--   - CERO migrations de Django (makemigrations / migrate PROHIBIDOS)
--   - CERO FOREIGN KEYs. Los vínculos se guardan como UUID plano.
--   - Cada módulo es una "isla" distribuida.
--   - Se preparan extensiones para pgvector (embeddings / RAG futuro).
-- Ejecutar manualmente:  psql -U mwt -d mwt_one -f init.sql
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Extensiones
-- ---------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "vector";      -- pgvector para embeddings
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- ---------------------------------------------------------------------
-- 2. Schemas por módulo (aislamiento lógico, sin FKs entre ellos)
-- ---------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS core;          -- usuarios, roles, auditoría
CREATE SCHEMA IF NOT EXISTS expedientes;   -- casos / dossiers
CREATE SCHEMA IF NOT EXISTS clientes;      -- cuentas B2B
CREATE SCHEMA IF NOT EXISTS pipeline;
CREATE SCHEMA IF NOT EXISTS financiero;
CREATE SCHEMA IF NOT EXISTS transfers;
CREATE SCHEMA IF NOT EXISTS nodos;
CREATE SCHEMA IF NOT EXISTS brands;
CREATE SCHEMA IF NOT EXISTS productos;
CREATE SCHEMA IF NOT EXISTS proveedores;
CREATE SCHEMA IF NOT EXISTS inventario;
CREATE SCHEMA IF NOT EXISTS portal;
CREATE SCHEMA IF NOT EXISTS templates;     -- email templates
CREATE SCHEMA IF NOT EXISTS notificaciones;
CREATE SCHEMA IF NOT EXISTS cobros;

-- =====================================================================
-- MÓDULO: core.users  (Usuarios y Roles)
-- =====================================================================
CREATE TABLE IF NOT EXISTS core.users (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email             CITEXT UNIQUE,  -- si CITEXT no está, usar TEXT + lower(index)
    email_plain       VARCHAR(255) UNIQUE NOT NULL,
    password_hash     VARCHAR(255) NOT NULL,
    full_name         VARCHAR(180) NOT NULL,
    avatar_url        TEXT,
    role              VARCHAR(40)  NOT NULL DEFAULT 'viewer',
    --  role ∈ {superadmin, admin, manager, operator, finance, viewer, client_b2b}
    is_active         BOOLEAN      NOT NULL DEFAULT TRUE,
    is_staff          BOOLEAN      NOT NULL DEFAULT FALSE,
    last_login_at     TIMESTAMPTZ,
    mfa_enabled       BOOLEAN      NOT NULL DEFAULT FALSE,
    mfa_secret        VARCHAR(64),
    preferences       JSONB        NOT NULL DEFAULT '{}'::jsonb,
    tenant_uuid       UUID,  -- vínculo lógico a clientes.accounts (sin FK)
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    deleted_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_users_role        ON core.users(role);
CREATE INDEX IF NOT EXISTS idx_users_tenant      ON core.users(tenant_uuid);
CREATE INDEX IF NOT EXISTS idx_users_active      ON core.users(is_active) WHERE deleted_at IS NULL;

-- Sesiones / tokens (no FK, referencia por UUID)
CREATE TABLE IF NOT EXISTS core.user_sessions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_uuid       UUID NOT NULL,      -- referencia lógica a core.users.id
    token_hash      VARCHAR(255) NOT NULL,
    ip_address      INET,
    user_agent      TEXT,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sessions_user     ON core.user_sessions(user_uuid);
CREATE INDEX IF NOT EXISTS idx_sessions_token    ON core.user_sessions(token_hash);

-- =====================================================================
-- MÓDULO: clientes.accounts  (Cuentas B2B)
-- =====================================================================
CREATE TABLE IF NOT EXISTS clientes.accounts (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    legal_name        VARCHAR(255) NOT NULL,
    trade_name        VARCHAR(255),
    tax_id            VARCHAR(60),
    country_code      CHAR(2),
    industry          VARCHAR(80),
    website           TEXT,
    primary_email     VARCHAR(255),
    primary_phone     VARCHAR(40),
    status            VARCHAR(30) NOT NULL DEFAULT 'active',
    --  status ∈ {prospect, active, on_hold, churned}
    owner_user_uuid   UUID,       -- referencia lógica a core.users.id (sin FK)
    brand_uuid        UUID,       -- referencia lógica a brands.brands.id
    tags              TEXT[]      NOT NULL DEFAULT '{}',
    metadata          JSONB       NOT NULL DEFAULT '{}'::jsonb,
    embedding         VECTOR(1536),   -- para similarity search
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_accounts_status    ON clientes.accounts(status);
CREATE INDEX IF NOT EXISTS idx_accounts_owner     ON clientes.accounts(owner_user_uuid);
CREATE INDEX IF NOT EXISTS idx_accounts_trgm      ON clientes.accounts USING GIN (legal_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_accounts_embedding ON clientes.accounts USING ivfflat (embedding vector_cosine_ops);

-- Contactos de la cuenta (sin FK; se referencia account por UUID)
CREATE TABLE IF NOT EXISTS clientes.contacts (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_uuid   UUID NOT NULL,    -- clientes.accounts.id
    full_name      VARCHAR(180) NOT NULL,
    role_title     VARCHAR(120),
    email          VARCHAR(255),
    phone          VARCHAR(40),
    is_primary     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contacts_account ON clientes.contacts(account_uuid);

-- =====================================================================
-- MÓDULO: expedientes.files  (Expedientes / Dossiers)
-- =====================================================================
CREATE TABLE IF NOT EXISTS expedientes.files (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code                 VARCHAR(40) UNIQUE NOT NULL,   -- ej. EXP-2026-00042
    title                VARCHAR(255) NOT NULL,
    description          TEXT,
    status               VARCHAR(30) NOT NULL DEFAULT 'open',
    --  status ∈ {draft, open, in_review, blocked, closed, archived}
    priority             VARCHAR(10) NOT NULL DEFAULT 'normal',
    --  priority ∈ {low, normal, high, urgent}
    client_account_uuid  UUID,       -- clientes.accounts.id
    assigned_user_uuid   UUID,       -- core.users.id
    brand_uuid           UUID,       -- brands.brands.id
    pipeline_stage_uuid  UUID,       -- pipeline.stages.id
    opened_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    due_at               TIMESTAMPTZ,
    closed_at            TIMESTAMPTZ,
    amount_total         NUMERIC(14,2),
    currency             CHAR(3) DEFAULT 'USD',
    tags                 TEXT[]  NOT NULL DEFAULT '{}',
    metadata             JSONB   NOT NULL DEFAULT '{}'::jsonb,
    embedding            VECTOR(1536),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at           TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_exp_status        ON expedientes.files(status);
CREATE INDEX IF NOT EXISTS idx_exp_client        ON expedientes.files(client_account_uuid);
CREATE INDEX IF NOT EXISTS idx_exp_assigned      ON expedientes.files(assigned_user_uuid);
CREATE INDEX IF NOT EXISTS idx_exp_pipeline      ON expedientes.files(pipeline_stage_uuid);
CREATE INDEX IF NOT EXISTS idx_exp_title_trgm    ON expedientes.files USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_exp_embedding     ON expedientes.files USING ivfflat (embedding vector_cosine_ops);

-- Eventos / historial del expediente (audit log propio, sin FK)
CREATE TABLE IF NOT EXISTS expedientes.events (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    file_uuid      UUID NOT NULL,       -- expedientes.files.id
    actor_uuid     UUID,                -- core.users.id
    event_type     VARCHAR(40) NOT NULL,  -- created, status_change, comment, attachment, ...
    payload        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_exp_events_file ON expedientes.events(file_uuid);
CREATE INDEX IF NOT EXISTS idx_exp_events_time ON expedientes.events(created_at DESC);

-- =====================================================================
-- Trigger genérico: updated_at
-- =====================================================================
CREATE OR REPLACE FUNCTION core.tg_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END; $$;

DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN
        SELECT n.nspname AS sch, c.relname AS tbl
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid
        WHERE c.relkind = 'r'
          AND a.attname = 'updated_at'
          AND n.nspname IN ('core','clientes','expedientes')
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS touch_updated_at ON %I.%I;
             CREATE TRIGGER touch_updated_at BEFORE UPDATE ON %I.%I
             FOR EACH ROW EXECUTE FUNCTION core.tg_touch_updated_at();',
             r.sch, r.tbl, r.sch, r.tbl);
    END LOOP;
END $$;

-- =====================================================================
-- Seed mínimo (usuario admin por defecto). Hash placeholder — rotar.
-- =====================================================================
INSERT INTO core.users (email_plain, password_hash, full_name, role, is_staff)
VALUES ('admin@mwt.one',
        '$2b$12$REEMPLAZAR_POR_HASH_REAL_EN_SETUP',
        'MWT Admin',
        'superadmin',
        TRUE)
ON CONFLICT (email_plain) DO NOTHING;

-- FIN init.sql
