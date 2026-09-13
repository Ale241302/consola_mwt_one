-- =====================================================================
-- L9 · Etapa 5 - Flujo de dinero: saldo inicial por moneda.
--   monedas de trabajo: USD y CRC (colones costarricenses).
--   Idempotente.
-- =====================================================================
BEGIN;

CREATE SCHEMA IF NOT EXISTS finanzas;

CREATE TABLE IF NOT EXISTS finanzas.saldo_inicial (
    moneda      VARCHAR(3) PRIMARY KEY,
    monto       NUMERIC(16,2) NOT NULL DEFAULT 0,
    notas       TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO finanzas.saldo_inicial (moneda, monto) VALUES ('USD', 0), ('CRC', 0)
    ON CONFLICT (moneda) DO NOTHING;

COMMENT ON TABLE finanzas.saldo_inicial IS
    'Etapa 5: saldo/caja inicial por moneda para el flujo neto del CEO.';

COMMIT;
