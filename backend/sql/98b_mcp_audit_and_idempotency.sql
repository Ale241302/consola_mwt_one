-- =========================================================================== #
-- Ola 2 · 2.20 — Idempotencia y auditoría del MCP
--
-- Entregado SQL-first (NO usar `makemigrations`; este repo tiene las migraciones
-- deshabilitadas). Aplica este archivo manualmente o por script de despliegue.
--
-- Contenido:
--   1) tabla de auditoría `mcp_audit`   (trazabilidad por tool-call)
--   2) tabla de deduplicación `idempotency_store` (TTL) para reintentos sin duplicar.
--
-- Convención de este repo: modelos Django `managed=False`, sin FK físicas, UUID.
-- =========================================================================== #

BEGIN;

-- --------------------------------------------------------------------------- #
-- 1) mcp_audit: log JSON por tool-call de escritura
-- Actor trazable (usuario real o servicio firmante), args saneados, resultado.
-- --------------------------------------------------------------------------- #
CREATE TABLE IF NOT EXISTS core.mcp_audit (
    id               BIGSERIAL PRIMARY KEY,
    event            VARCHAR(32)  NOT NULL DEFAULT 'write',   -- write | read | auth
    tool             VARCHAR(64)  NOT NULL,                    -- mwt_* (nombre de la tool)
    identity_sub     VARCHAR(255) DEFAULT NULL,                -- sujeto del JWT firmante
    identity_roles   JSONB        DEFAULT NULL,                -- roles/módulos del firmante
    args_sanitized   JSONB        DEFAULT NULL,                -- argumentos saneados (redacta file_path/keys)
    ok               BOOLEAN      NOT NULL,
    http_status      INTEGER      DEFAULT NULL,                -- status del backend si aplica
    duration_ms      INTEGER      DEFAULT NULL,
    idempotency_key  VARCHAR(128) DEFAULT NULL,                -- clave de dedup (para creaciones)
    at_created       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Consulta frecuente: auditoría por herramienta/caja horaria.
CREATE INDEX IF NOT EXISTS idx_mcp_audit_tool_at   ON core.mcp_audit (tool, at_created DESC);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_at        ON core.mcp_audit (at_created DESC);
-- Localizar una escritura por clave de idempotencia (prob de reintento).
CREATE INDEX IF NOT EXISTS idx_mcp_audit_idemkey   ON core.mcp_audit (idempotency_key)
    WHERE idempotency_key IS NOT NULL;


-- --------------------------------------------------------------------------- #
-- 2) idempotency_store: dedup con TTL para reintentos tras timeout
--
-- Un agente que retransmite el mismo `idempotency_key` recibe el resultado que
-- YA se computó la primera vez (evita crear 2 expedientes/pagos/transferencias).
-- La limpieza la hace el propio backend (DELETE WHERE expires_at < now()) antes
-- de consultar; una ranura de barrido periódico mantiene la tabla pequeña.
-- --------------------------------------------------------------------------- #
CREATE TABLE IF NOT EXISTS core.idempotency_store (
    idempotency_key  VARCHAR(128) PRIMARY KEY,                 -- hash del token del agente
    tool             VARCHAR(64)  NOT NULL,
    target_id        VARCHAR(255) DEFAULT NULL,                -- UUID del recurso creado
    response_payload JSONB        NOT NULL,                    -- cuerpo con que responder en el reintento
    status           INTEGER      NOT NULL DEFAULT 200,
    expires_at       TIMESTAMPTZ  NOT NULL DEFAULT (now() + interval '1 day'), -- TTL 24h (configurable)
    at_created       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_idempotency_expires  ON core.idempotency_store (expires_at);

-- Planteo de limpieza periódica (corre en un worker/planificador interno):
--   DELETE FROM core.idempotency_store WHERE expires_at < now();
--   DELETE FROM core.mcp_audit          WHERE at_created < now() - interval '90 days';

COMMIT;
