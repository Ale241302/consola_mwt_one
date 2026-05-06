-- ============================================================
-- MWT.ONE · C0_expedientes_operating_company.sql
-- Sprint 2026-05-06 — Operador del expediente (MWT vs Cliente).
--
-- Agrega:
--   · expedientes.expediente.operating_company_id UUID
--       Identifica qué empresa OPERA el expediente. Si es MWT,
--       el crédito impacta a Muito Work Limitada (no al cliente final).
--       Backfill: NULL → operating_company_id := client_id (compat).
--   · expedientes.linea.unit_price_mwt   NUMERIC(14,4)
--   · expedientes.linea.unit_price_client NUMERIC(14,4)
--       "Snapshot dual": precio que ve cada audiencia. unit_price
--       (legacy) queda como alias del precio del operador.
-- ============================================================
SET search_path = expedientes, public;

ALTER TABLE expedientes.expediente
  ADD COLUMN IF NOT EXISTS operating_company_id UUID NULL;

UPDATE expedientes.expediente
   SET operating_company_id = client_id
 WHERE operating_company_id IS NULL;

CREATE INDEX IF NOT EXISTS expediente_operating_company_idx
  ON expedientes.expediente (operating_company_id);

ALTER TABLE expedientes.linea
  ADD COLUMN IF NOT EXISTS unit_price_mwt    NUMERIC(14,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_price_client NUMERIC(14,4) DEFAULT 0;

UPDATE expedientes.linea
   SET unit_price_mwt    = COALESCE(unit_price_mwt, unit_price, 0),
       unit_price_client = COALESCE(unit_price_client, unit_price, 0)
 WHERE (unit_price_mwt IS NULL OR unit_price_mwt = 0)
    OR (unit_price_client IS NULL OR unit_price_client = 0);

COMMENT ON COLUMN expedientes.expediente.operating_company_id IS
  'Empresa que opera el expediente. Si == client_id, expediente directo del cliente. Si == MWT_OPERATING_CLIENT_ID, lo opera MWT y el crédito afecta a MWT.';
COMMENT ON COLUMN expedientes.linea.unit_price_mwt IS
  'Precio congelado al crear, perspectiva Muito Work Limitada (visible a Admin / usuarios MWT).';
COMMENT ON COLUMN expedientes.linea.unit_price_client IS
  'Precio congelado al crear, perspectiva del cliente final (visible a usuarios CLIENT_*).';
