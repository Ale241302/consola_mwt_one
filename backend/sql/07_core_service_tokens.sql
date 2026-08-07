-- =====================================================================
-- MWT.ONE · 07_core_service_tokens.sql
-- Ola 1 — F3: ServiceToken con scope, expiración y revocación.
--
-- Tablas:
--   - core.service_token          : token opaco de servicio (hash).
--   - core.service_token_scope    : scopes + client_ids permitidos.
--
-- El token real (64 hex) vive solo en el .env del consumidor; en la BD se
-- guarda su SHA-256. Revocar no requiere rotar DJANGO_SECRET_KEY.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS core;

-- ─────────────────────────────────────────────────────────────────────
-- core.service_token
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS core.service_token (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,                    -- ej. "mcp-gateway-prod"
    token_hash      TEXT NOT NULL UNIQUE,             -- SHA-256 del token secreto
    role_slug       TEXT NOT NULL DEFAULT 'service',   -- nunca admin/superadmin
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    last_used_at    TIMESTAMPTZ,
    created_by_id   UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_service_token_hash_active
    ON core.service_token (token_hash)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_service_token_expires
    ON core.service_token (expires_at);

CREATE INDEX IF NOT EXISTS idx_service_token_created_by
    ON core.service_token (created_by_id);

-- Trigger updated_at: reusa la función global tg_set_updated_at() si existe.
-- Si no existe, se define una local mínima.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'tg_set_updated_at'
    ) THEN
        CREATE OR REPLACE FUNCTION core.tg_set_updated_at_local()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            NEW.updated_at = now();
            RETURN NEW;
        END;
        $$;
        CREATE TRIGGER tg_service_token_upd
            BEFORE UPDATE ON core.service_token
            FOR EACH ROW EXECUTE FUNCTION core.tg_set_updated_at_local();
    ELSE
        DROP TRIGGER IF EXISTS tg_service_token_upd ON core.service_token;
        CREATE TRIGGER tg_service_token_upd
            BEFORE UPDATE ON core.service_token
            FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();
    END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- core.service_token_scope
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS core.service_token_scope (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_token_id  UUID NOT NULL REFERENCES core.service_token(id) ON DELETE CASCADE,
    scope             TEXT NOT NULL,   -- ej. 'mcp:read', 'mcp:write', 'mcp:token_exchange'
    client_id         UUID,             -- NULL = todos los clientes permitidos
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_service_token_scope_unique
    ON core.service_token_scope (service_token_id, scope, COALESCE(client_id, '00000000-0000-0000-0000-000000000000'));

CREATE INDEX IF NOT EXISTS idx_service_token_scope_token
    ON core.service_token_scope (service_token_id);

-- ─────────────────────────────────────────────────────────────────────
-- Vista de conveniencia: token + scopes + clientes en una fila
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW core.service_token_flat AS
SELECT
    t.id,
    t.name,
    t.role_slug,
    t.is_active,
    t.expires_at,
    t.revoked_at,
    t.last_used_at,
    t.created_by_id,
    t.created_at,
    t.updated_at,
    array_agg(DISTINCT s.scope) FILTER (WHERE s.scope IS NOT NULL) AS scopes,
    array_agg(DISTINCT s.client_id) FILTER (WHERE s.client_id IS NOT NULL) AS client_ids
FROM core.service_token t
LEFT JOIN core.service_token_scope s ON s.service_token_id = t.id
GROUP BY t.id;
