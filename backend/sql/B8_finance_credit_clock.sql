-- ============================================================
-- MWT.ONE · B8_finance_credit_clock.sql
-- Agente responsable: [AG-DATABASE]
--
-- Fase 5A — Credit Clock por cliente.
--
-- Crea dos tablas en el schema `clientes`:
--   · credit_config — configuración por cliente (tope/umbrales/bloqueo).
--   · credit_clock  — cache derivada (días consumidos, expedientes en
--                     amarillo/rojo, bloqueado, last_recalc_at).
--
-- La recomputación la hace CreditClockProjector cuando un Payment pasa
-- a CONFIRMADO_AI / CONFIRMADO_HUMANO (tasks.recompute_credit_clock_task).
--
-- NOTA: el FX history ya existe como `cobros.fx_rate_history` (creado
-- en 81_cobros_audit.sql). Este archivo NO la duplica; el FXService
-- lee/escribe ahí mismo.
--
-- Idempotente. Asume B6/B7 ya corrieron.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS clientes;

SET search_path = clientes, public;

-- ────────────────────────────────────────────────────────────
-- credit_config · configuración (1:1 con cliente)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clientes.credit_config (
    cliente_id            UUID          PRIMARY KEY,                  -- FK lógico → clientes.cliente
    tope_dias             INTEGER       NOT NULL DEFAULT 90 CHECK (tope_dias > 0),
    umbral_amarillo_dias  INTEGER       NOT NULL DEFAULT 60 CHECK (umbral_amarillo_dias > 0),
    umbral_rojo_dias      INTEGER       NOT NULL DEFAULT 75 CHECK (umbral_rojo_dias > 0),
    bloqueo_automatico    BOOLEAN       NOT NULL DEFAULT TRUE,
    -- Coherencia: amarillo < rojo < tope
    CONSTRAINT cc_thresholds_order CHECK (
        umbral_amarillo_dias < umbral_rojo_dias
        AND umbral_rojo_dias <= tope_dias
    ),
    notas                 TEXT,
    updated_by            UUID,                                       -- FK lógico → core.users (quién editó por última vez)
    created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credit_config_bloqueo_idx
    ON clientes.credit_config (bloqueo_automatico);

-- ────────────────────────────────────────────────────────────
-- credit_clock · cache derivada (1:1 con cliente)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clientes.credit_clock (
    cliente_id                     UUID          PRIMARY KEY,         -- FK lógico → clientes.cliente
    dias_credito_consumidos        INTEGER       NOT NULL DEFAULT 0 CHECK (dias_credito_consumidos >= 0),
    expedientes_abiertos_total     INTEGER       NOT NULL DEFAULT 0,
    expedientes_abiertos_amarillo  INTEGER       NOT NULL DEFAULT 0,
    expedientes_abiertos_rojo      INTEGER       NOT NULL DEFAULT 0,
    monto_pendiente_usd            NUMERIC(14,2) NOT NULL DEFAULT 0,
    bloqueado                      BOOLEAN       NOT NULL DEFAULT FALSE,
    bloqueo_reason                 VARCHAR(64),                       -- 'TOPE_EXCEDIDO' / 'MANUAL' / null
    last_recalc_at                 TIMESTAMPTZ   NOT NULL DEFAULT now(),
    last_payment_id                UUID,                              -- traza del pago que disparó el último recompute
    updated_at                     TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credit_clock_bloqueado_idx
    ON clientes.credit_clock (bloqueado) WHERE bloqueado = TRUE;
CREATE INDEX IF NOT EXISTS credit_clock_recalc_idx
    ON clientes.credit_clock (last_recalc_at DESC);

-- ────────────────────────────────────────────────────────────
-- Triggers updated_at (reusa la función global ya creada en 80_cobros)
-- ────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'tg_set_updated_at') THEN
    CREATE OR REPLACE FUNCTION tg_set_updated_at() RETURNS trigger AS $fn$
    BEGIN NEW.updated_at := now(); RETURN NEW; END; $fn$ LANGUAGE plpgsql;
  END IF;
END $$;

DROP TRIGGER IF EXISTS tg_credit_config_upd ON clientes.credit_config;
CREATE TRIGGER tg_credit_config_upd BEFORE UPDATE ON clientes.credit_config
    FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

DROP TRIGGER IF EXISTS tg_credit_clock_upd ON clientes.credit_clock;
CREATE TRIGGER tg_credit_clock_upd BEFORE UPDATE ON clientes.credit_clock
    FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- ────────────────────────────────────────────────────────────
-- Backfill: poblar credit_config con defaults (90/60/75) para
-- todos los clientes existentes que aún no tengan config.
-- Idempotente: ON CONFLICT DO NOTHING.
-- ────────────────────────────────────────────────────────────
INSERT INTO clientes.credit_config (cliente_id, tope_dias, umbral_amarillo_dias, umbral_rojo_dias, bloqueo_automatico)
SELECT c.id, 90, 60, 75, TRUE
  FROM clientes.cliente c
 WHERE NOT EXISTS (
    SELECT 1 FROM clientes.credit_config cc WHERE cc.cliente_id = c.id
 )
ON CONFLICT (cliente_id) DO NOTHING;

-- Backfill credit_clock con valores zero para todos los clientes
INSERT INTO clientes.credit_clock (cliente_id)
SELECT c.id
  FROM clientes.cliente c
 WHERE NOT EXISTS (
    SELECT 1 FROM clientes.credit_clock cc WHERE cc.cliente_id = c.id
 )
ON CONFLICT (cliente_id) DO NOTHING;

-- ============================================================
-- FIN B8_finance_credit_clock.sql
-- ============================================================
