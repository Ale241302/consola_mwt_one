-- =====================================================================
-- MWT.ONE · H1_mcp_app_por_cliente.sql
-- Ola 1 · 1.5 — tabla de aplicaciones MCP por cliente.
--
-- Guarda la relación Cliente → App MCP (Authentik) para exponer en la
-- consola: URL del servidor MCP remoto, OAuth Client ID/Secret, y el
-- ServiceToken del cliente. Cada cliente (legal entity) puede tener una
-- (y solo una) app MCP.
--
-- Nota: los client_secret NUNCA deben leerse en listados; solo en
-- acciones explícitas de la UI (Ola 4).
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS core;

CREATE TABLE IF NOT EXISTS core.mcp_app (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id                  UUID NOT NULL UNIQUE,       -- clientes.cliente.id
    slug                        TEXT NOT NULL UNIQUE,       -- ej. "mcp-sondel"
    nombre                      TEXT NOT NULL DEFAULT '',   -- ej. "Sondel S.A."
    -- UIDs de Authentik (para kill-switch / deprovision)
    authentik_application_uid   UUID,
    authentik_provider_pk       INTEGER,
    -- Credenciales OAuth de la app en Authentik
    oauth_client_id             TEXT,
    oauth_client_secret         TEXT,
    -- URL pública del virtual server de ContextForge (Ola 5)
    mcp_url                     TEXT,
    -- ServiceToken scopeado a este cliente (core.service_token)
    service_token_id            UUID,
    -- estado de la app: PROVISIONED | DEPROVISIONED | ERROR
    estado                      TEXT NOT NULL DEFAULT 'PROVISIONED',
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mcp_app_cliente
    ON core.mcp_app (cliente_id);

CREATE INDEX IF NOT EXISTS idx_mcp_app_slug
    ON core.mcp_app (slug);

-- Trigger updated_at: reusa la función global tg_set_updated_at() si existe.
DO $DO$
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
        CREATE TRIGGER tg_mcp_app_upd
            BEFORE UPDATE ON core.mcp_app
            FOR EACH ROW EXECUTE FUNCTION core.tg_set_updated_at_local();
    ELSE
        DROP TRIGGER IF EXISTS tg_mcp_app_upd ON core.mcp_app;
        CREATE TRIGGER tg_mcp_app_upd
            BEFORE UPDATE ON core.mcp_app
            FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();
    END IF;
END $DO$;
