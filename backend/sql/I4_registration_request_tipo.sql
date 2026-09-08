-- =====================================================================
-- MWT.ONE · I4_registration_request_tipo.sql
-- Amplía users.registration_request para distinguir:
--   tipo='registro' (nuevo, por defecto) vs tipo='reactivacion'
--   (un usuario existente pero INACTIVO pide volver a activarse).
--   · tipo     → 'registro' | 'reactivacion'
--   · motivo   → motivo de la reactivación (libre) o rechazo
-- =====================================================================

ALTER TABLE users.registration_request
    ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'registro';

ALTER TABLE users.registration_request
    ADD COLUMN IF NOT EXISTS motivo TEXT;

CREATE INDEX IF NOT EXISTS idx_reg_req_tipo
    ON users.registration_request (tipo);
