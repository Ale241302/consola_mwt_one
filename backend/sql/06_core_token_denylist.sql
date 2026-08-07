-- ====================================================================
-- MWT.ONE · backend/sql/06_core_token_denylist.sql
-- Agente responsable: [AG-BACKEND]
-- Ola 0 — P0.8: Logout real con denylist de JWT.
--
-- Tabla de tokens revocados (denylist). Se almacena el claim `jti` del
-- access/refresh token. `MwtJWTAuthentication` valida aquí antes de
-- aceptar un access token. Los refresh tokens se revocan en logout.
--
-- Idempotente: puede correrse varias veces sin efectos secundarios.
-- ====================================================================

CREATE TABLE IF NOT EXISTS core.token_denylist (
    jti            TEXT PRIMARY KEY,
    token_type     TEXT NOT NULL DEFAULT 'access',
    user_uuid      UUID,
    expires_at     TIMESTAMPTZ NOT NULL,
    revoked_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_by     UUID
);

CREATE INDEX IF NOT EXISTS idx_token_denylist_expires
    ON core.token_denylist (expires_at);

CREATE INDEX IF NOT EXISTS idx_token_denylist_user
    ON core.token_denylist (user_uuid, revoked_at);

-- Función de limpieza periódica: elimina entradas cuyo expires_at ya pasó.
-- Puede llamarse desde un job Celery o manualmente.
CREATE OR REPLACE FUNCTION core.token_denylist_cleanup()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM core.token_denylist
     WHERE expires_at < NOW();
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;
