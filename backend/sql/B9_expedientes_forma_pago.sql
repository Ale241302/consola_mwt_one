-- ============================================================
-- MWT.ONE · B9_expedientes_forma_pago.sql
-- Agente responsable: [AG-DATABASE]
--
-- Sprint 2026-05-06 — Términos de pago en el wizard de expedientes.
--
-- Agrega a `expedientes.expediente`:
--   · forma_pago VARCHAR(16) — 'CREDITO' | 'CONTADO'
--     CREDITO: el monto del expediente afecta credito_usado del cliente.
--     CONTADO: NO afecta credito_usado (pago al momento, sin crédito).
--
-- El campo `credit_days` (INTEGER) ya existe en la tabla; se reusa
-- como "días de pago" del expediente (override del default del cliente).
--
-- Crea catálogo `expedientes.forma_pago_cat` con la flag
-- `afecta_credito` para que el cálculo dinámico de credito_usado
-- (apps.clientes.views) filtre solo expedientes con afecta_credito=TRUE.
--
-- Idempotente. Asume B6/B7/B8 ya corrieron.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS expedientes;

SET search_path = expedientes, public;

-- ────────────────────────────────────────────────────────────
-- 1. Columna forma_pago
-- ────────────────────────────────────────────────────────────
ALTER TABLE expedientes.expediente
  ADD COLUMN IF NOT EXISTS forma_pago VARCHAR(16) NULL;

-- CHECK constraint (idempotente · DO block para tolerar duplicate)
DO $$ BEGIN
  ALTER TABLE expedientes.expediente
    ADD CONSTRAINT expediente_forma_pago_chk
    CHECK (forma_pago IS NULL OR forma_pago IN ('CREDITO','CONTADO'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Índice para queries del cálculo de credito_usado
CREATE INDEX IF NOT EXISTS expediente_forma_pago_idx
  ON expedientes.expediente (forma_pago);

-- ────────────────────────────────────────────────────────────
-- 2. Catálogo forma_pago_cat
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expedientes.forma_pago_cat (
    codigo          VARCHAR(16)  PRIMARY KEY,
    label           VARCHAR(64)  NOT NULL,
    afecta_credito  BOOLEAN      NOT NULL DEFAULT TRUE,
    color           VARCHAR(16),
    descripcion     TEXT,
    orden           INTEGER      NOT NULL DEFAULT 100,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE
);

INSERT INTO expedientes.forma_pago_cat
    (codigo, label, afecta_credito, color, descripcion, orden)
VALUES
    ('CREDITO', 'Crédito', TRUE,  '#0FB97A',
     'El monto del expediente cuenta contra el límite de crédito del cliente.', 10),
    ('CONTADO', 'Contado', FALSE, '#3083FE',
     'Pago al momento. No afecta el crédito disponible del cliente.',           20)
ON CONFLICT (codigo) DO UPDATE SET
    label          = EXCLUDED.label,
    afecta_credito = EXCLUDED.afecta_credito,
    color          = EXCLUDED.color,
    descripcion    = EXCLUDED.descripcion,
    orden          = EXCLUDED.orden;

-- ────────────────────────────────────────────────────────────
-- 3. Backfill conservador
--    · expedientes con credit_days > 0 → CREDITO (asumimos plazo)
--    · expedientes con credit_days = 0 → CONTADO
--    · solo si forma_pago IS NULL (no piso datos manuales)
-- ────────────────────────────────────────────────────────────
UPDATE expedientes.expediente
   SET forma_pago = CASE
       WHEN COALESCE(credit_days, 0) > 0 THEN 'CREDITO'
       ELSE 'CONTADO'
   END
 WHERE forma_pago IS NULL;

-- ============================================================
-- FIN B9_expedientes_forma_pago.sql
-- ============================================================
