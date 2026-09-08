-- =====================================================================
-- MWT.ONE · I1_mcp_device_grant.sql
-- Onboarding MCP por correo (Fase 1) · credenciales device-bound.
--
-- Tabla core.mcp_device_grant: paquete de credenciales .json/.md que se
-- entrega por email a un usuario para conectar su IA directo al MCP de la
-- empresa (sin OAuth interactivo). Reglas:
--   · estado ISSUED → ACTIVE (1ª conexión) → REVOKED / EXPIRED.
--   · Un solo grant ACTIVO por (user_uuid, cliente_id): emitir uno nuevo
--     revoca el anterior (REVOKED, motivo 'replaced') → "equipo 1 muere".
--   · El secret viaja UNA sola vez en el paquete; aquí solo su SHA-256.
--   · Vínculo a dispositivo por IP (primera conexión) + user_agent/MAC
--     informativos (la MAC no es verificable server-side sobre HTTP).
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS core;

CREATE TABLE IF NOT EXISTS core.mcp_device_grant (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_uuid             UUID NOT NULL,          -- core.users.id (target)
    email                 TEXT NOT NULL,          -- snapshot del target
    cliente_id            UUID NOT NULL,          -- clientes.cliente.id / core.mcp_app.cliente_id
    secret_hash           TEXT NOT NULL UNIQUE,   -- sha256 hex del secret (nunca en claro)
    secret_prefix         TEXT NOT NULL DEFAULT '',  -- primeros 8 chars (soporte/UI)
    estado                TEXT NOT NULL DEFAULT 'ISSUED',  -- ISSUED|ACTIVE|REVOKED|EXPIRED
    ip_vinculada          INET,
    mac_reportado         TEXT,
    user_agent            TEXT,
    primera_conexion_at   TIMESTAMPTZ,
    ultima_conexion_at    TIMESTAMPTZ,
    creado_via            TEXT NOT NULL DEFAULT 'email',  -- email | registro
    expira_at             TIMESTAMPTZ,
    revocado_at           TIMESTAMPTZ,
    revoke_reason         TEXT,                   -- replaced | device_mismatch | revoked | expired
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mcp_grant_user
    ON core.mcp_device_grant (user_uuid);

CREATE INDEX IF NOT EXISTS idx_mcp_grant_cliente
    ON core.mcp_device_grant (cliente_id);

CREATE INDEX IF NOT EXISTS idx_mcp_grant_estado
    ON core.mcp_device_grant (estado);

-- Enforce "un solo grant activo por (usuario, cliente)": el alta revoca el
-- anterior en la misma transacción; este índice es la red de seguridad.
DO $DO$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'core' AND tablename = 'mcp_device_grant'
          AND indexname = 'uq_mcp_grant_single_active'
    ) THEN
        CREATE UNIQUE INDEX uq_mcp_grant_single_active
            ON core.mcp_device_grant (user_uuid, cliente_id)
            WHERE estado IN ('ISSUED', 'ACTIVE');
    END IF;
END $DO$;

-- Trigger updated_at (reusa la convención del repo).
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
        CREATE TRIGGER tg_mcp_device_grant_upd
            BEFORE UPDATE ON core.mcp_device_grant
            FOR EACH ROW EXECUTE FUNCTION core.tg_set_updated_at_local();
    ELSE
        DROP TRIGGER IF EXISTS tg_mcp_device_grant_upd ON core.mcp_device_grant;
        CREATE TRIGGER tg_mcp_device_grant_upd
            BEFORE UPDATE ON core.mcp_device_grant
            FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();
    END IF;
END $DO$;
