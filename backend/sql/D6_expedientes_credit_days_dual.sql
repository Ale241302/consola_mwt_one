-- =====================================================================
-- MWT.ONE · D6_expedientes_credit_days_dual.sql
-- Sprint: 2026-05-24 · Decision CEO (Alejandro)
-- Agente responsable: [AG-DATABASE]
--
-- PROPOSITO:
--   Soportar dos plazos de credito independientes por expediente cuando
--   hay operador intermedio (operating_company_id != client_id):
--   uno para el cliente final (lo que el cliente paga a MWT) y otro
--   para MWT (lo que MWT paga al proveedor). El campo legacy credit_days
--   se preserva para retro-compatibilidad y queda como "espejo" del
--   credit_days_cliente cuando ambos son iguales (caso sin operador).
--
-- DISENO:
--   credit_days_mwt     -- plazo que aplica al snapshot MWT (ADMIN-only)
--   credit_days_cliente -- plazo que aplica al snapshot cliente
--   credit_days         -- LEGACY: se mantiene como derivado/espejo.
--                          Si quieres deprecarlo en futuro, primero
--                          migrar TODOS los consumidores a leer
--                          credit_days_cliente.
--
-- REGLAS DE NEGOCIO:
--   · Cuando operating_company_id == client_id (sin operador intermedio),
--     se espera credit_days_mwt == credit_days_cliente. La UI los
--     fusiona en un solo selector.
--   · Cuando operating_company_id != client_id, los dos pueden ser
--     distintos (cliente puede elegir 8 dias y MWT 90 dias). No hay
--     constraint de orden entre ellos (decision CEO 2026-05-24).
--   · Los CLIENT_* roles NO ven credit_days_mwt (POL_VISIBILIDAD R3).
--
-- IDEMPOTENCIA:
--   IF NOT EXISTS en el ALTER; el backfill condiciona en IS NULL.
--   Re-ejecutable sin riesgo.
-- =====================================================================

BEGIN;

ALTER TABLE expedientes.expediente
  ADD COLUMN IF NOT EXISTS credit_days_mwt     INTEGER,
  ADD COLUMN IF NOT EXISTS credit_days_cliente INTEGER;

-- Backfill: para todos los expedientes existentes, ambos plazos = legacy.
-- Esto preserva la semantica de los expedientes ya creados.
UPDATE expedientes.expediente
   SET credit_days_mwt     = COALESCE(credit_days_mwt,     credit_days),
       credit_days_cliente = COALESCE(credit_days_cliente, credit_days)
 WHERE credit_days_mwt IS NULL OR credit_days_cliente IS NULL;

-- Indices ligeros para reportes financieros (planeacion de flujo de caja
-- a futuro). Sin WHERE clause -- la cardinalidad esperada es baja.
CREATE INDEX IF NOT EXISTS idx_expediente_credit_days_mwt
  ON expedientes.expediente (credit_days_mwt);
CREATE INDEX IF NOT EXISTS idx_expediente_credit_days_cliente
  ON expedientes.expediente (credit_days_cliente);

-- Comentarios de catalogo para que cualquier auditor entienda el modelo
-- sin abrir este SQL.
COMMENT ON COLUMN expedientes.expediente.credit_days_mwt IS
  'Plazo de credito que MWT (operating_company) acepta del proveedor. '
  'CEO-ONLY: no exponer a CLIENT_*. Backfill desde credit_days en D6.';
COMMENT ON COLUMN expedientes.expediente.credit_days_cliente IS
  'Plazo de credito que el cliente final acepta de MWT. '
  'Visible a CLIENT_* y ADMIN. Backfill desde credit_days en D6.';

COMMIT;

-- =====================================================================
-- VERIFICACION POST-MIGRACION (corre FUERA de la transaccion)
-- =====================================================================
\echo '═══ D6: Verificacion ═══'
SELECT
    COUNT(*)                                  AS total_expedientes,
    COUNT(credit_days_mwt)                    AS con_credit_days_mwt,
    COUNT(credit_days_cliente)                AS con_credit_days_cliente,
    COUNT(CASE WHEN credit_days_mwt = credit_days_cliente THEN 1 END) AS espejados,
    COUNT(CASE WHEN credit_days_mwt <> credit_days_cliente THEN 1 END) AS divergentes
  FROM expedientes.expediente;

-- FIN D6_expedientes_credit_days_dual.sql
