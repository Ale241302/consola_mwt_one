-- =====================================================================
-- MWT.ONE · I2_mcp_device_grant_device_id.sql
-- Credencial MCP por dispositivo (Fase 3 · revisión 2).
--
-- Cambia el vínculo del grant: la IP deja de identificar al equipo y pasa a
-- ser un dato de la última conexión. El equipo se identifica con `device_id`,
-- un identificador estable que el cliente MCP envía en `X-MWT-Device-Id`
-- (el escritorio lo genera una vez y lo conserva).
--
--   · Un usuario puede tener VARIOS grants activos de la misma empresa: uno
--     por dispositivo (escritorio, portátil, otro cliente MCP).
--   · Emitir un grant nuevo para un dispositivo revoca solo el de ese
--     dispositivo. Los grants sin dispositivo (paquete emitido por correo,
--     todavía sin primer uso) conservan la regla anterior: uno activo por
--     (usuario, empresa).
--   · Cambiar de red no invalida la credencial: la IP solo se registra.
-- =====================================================================

ALTER TABLE core.mcp_device_grant
    ADD COLUMN IF NOT EXISTS device_id TEXT;

COMMENT ON COLUMN core.mcp_device_grant.device_id IS
    'Identificador estable del equipo (X-MWT-Device-Id). NULL hasta el primer uso de un grant emitido sin dispositivo.';

-- La regla "un solo grant activo por (usuario, empresa)" ya no aplica a los
-- grants ligados a un dispositivo.
DROP INDEX IF EXISTS core.uq_mcp_grant_single_active;

-- Un activo por (usuario, empresa, dispositivo).
CREATE UNIQUE INDEX IF NOT EXISTS uq_mcp_grant_device_active
    ON core.mcp_device_grant (user_uuid, cliente_id, device_id)
    WHERE estado IN ('ISSUED', 'ACTIVE') AND device_id IS NOT NULL;

-- Los grants todavía sin dispositivo siguen siendo uno activo por par: es el
-- paquete emitido por correo antes de su primer uso.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mcp_grant_legacy_active
    ON core.mcp_device_grant (user_uuid, cliente_id)
    WHERE estado IN ('ISSUED', 'ACTIVE') AND device_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_mcp_grant_device
    ON core.mcp_device_grant (device_id);
