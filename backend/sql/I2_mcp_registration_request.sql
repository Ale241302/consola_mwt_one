-- =====================================================================
-- MWT.ONE · I2_mcp_registration_request.sql
-- Onboarding MCP por correo/registro (Fase 2) · solicitudes de alta.
--
-- Registro público /registro-mcp: el solicitante llena email, nombre,
-- teléfono, contraseña y empresa (MCP-provisionada). NO queda habilitado:
-- la fila vive PENDIENTE hasta que un admin (role admin/ceo/superadmin)
-- la APRUEBA. Al aprobar se crea el usuario activo y se envía email con
-- credenciales MCP (.json/.md). Al rechazar se notifica (opcional).
--
-- Se guardan los DOS hashes del password elegido (el pbkdf2 que persiste
-- users.mwtuser y el SHA-256 que persiste core.users) para que la
-- activación pueda crear el usuario SIN guardar el password en claro.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS users;

CREATE TABLE IF NOT EXISTS users.registration_request (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email                 TEXT NOT NULL,
    email_low             TEXT NOT NULL,           -- búsqueda case-insensitive
    full_name             TEXT NOT NULL DEFAULT '',
    contact_email         TEXT,
    phone                 TEXT,
    password_pbkdf2       TEXT NOT NULL,           -- users.mwtuser.password_hash
    password_core_sha256  TEXT NOT NULL,           -- core.users.password_hash
    cliente_id            UUID NOT NULL,           -- empresa elegida (padre o subsidiaria)
    cliente_razon         TEXT NOT NULL DEFAULT '',-- snapshot legible
    legal_entity_ids      TEXT[] NOT NULL DEFAULT '{}',
    role_default          TEXT NOT NULL DEFAULT 'client_b2b',
    addresses             JSONB NOT NULL DEFAULT '[]'::jsonb,
    estado                TEXT NOT NULL DEFAULT 'PENDIENTE',  -- PENDIENTE|APROBADO|RECHAZADO
    motivo_rechazo        TEXT,
    ip_origen             INET,
    user_agent            TEXT,
    aprobado_por          UUID,                    -- users.mwtuser.id del admin
    aprobado_at           TIMESTAMPTZ,
    activado_user_uuid    UUID,                    -- id del usuario creado al aprobar
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reg_req_email
    ON users.registration_request (email_low);

CREATE INDEX IF NOT EXISTS idx_reg_req_estado
    ON users.registration_request (estado);

CREATE INDEX IF NOT EXISTS idx_reg_req_cliente
    ON users.registration_request (cliente_id);

-- Trigger updated_at (convención del repo).
DO $DO$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'tg_set_updated_at'
    ) THEN
        CREATE OR REPLACE FUNCTION users.tg_set_updated_at_local()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            NEW.updated_at = now();
            RETURN NEW;
        END;
        $$;
        CREATE TRIGGER tg_registration_request_upd
            BEFORE UPDATE ON users.registration_request
            FOR EACH ROW EXECUTE FUNCTION users.tg_set_updated_at_local();
    ELSE
        DROP TRIGGER IF EXISTS tg_registration_request_upd ON users.registration_request;
        CREATE TRIGGER tg_registration_request_upd
            BEFORE UPDATE ON users.registration_request
            FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();
    END IF;
END $DO$;

COMMENT ON TABLE users.registration_request IS
  'Solicitudes de alta MCP pendientes de aprobación admin (Fase 2).';
