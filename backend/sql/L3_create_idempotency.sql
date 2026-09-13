-- =====================================================================
-- L3 · Etapa 1/backlog B7 - idempotencia del alta interna de expedientes.
-- token (del cliente) -> expediente creado. Reintentos no duplican.
-- =====================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS expedientes.create_idempotency (
    token         TEXT PRIMARY KEY,
    expediente_id UUID NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
