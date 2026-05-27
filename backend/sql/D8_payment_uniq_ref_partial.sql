-- =====================================================================
-- MWT.ONE · backend/sql/D8_payment_uniq_ref_partial.sql
-- Sprint 2026-05-26 (CEO) · Agente: AG-DB
--
-- Problema:
--   El indice payment_uniq_ref_idx bloqueaba registrar un nuevo pago
--   con la misma (metodo, referencia, expediente_id) aunque el pago
--   anterior estuviera en estado NEEDS_REVIEW / PENDIENTE_AI (es
--   decir, todavia no liberado credito, en borrador).
--
--   Caso real: el CEO subio un comprobante con ref 714226364, el AI
--   no lo pudo analizar (NEEDS_REVIEW) y al intentar re-registrar
--   con el mismo PDF para corregir, el backend reventaba con
--   IntegrityError 500.
--
-- Fix:
--   Hacer el indice PARTIAL adicionalmente sobre estado: solo aplica
--   a pagos que YA estan confirmados (CONFIRMADO_AI o CONFIRMADO_HUMANO).
--   Asi, los borradores (PENDIENTE_AI, NEEDS_REVIEW) y los descartados
--   (RECHAZADO, REVERTIDO) NO bloquean re-registro con la misma
--   referencia.
--
--   Estados que SI bloquean duplicados (la referencia ya esta atada
--   a un pago real reconocido por contabilidad):
--     - CONFIRMADO_AI       (auto-confirmado por IA con alta confianza)
--     - CONFIRMADO_HUMANO   (revisor humano lo aprobo)
--
--   Estados que NO bloquean (no son contables todavia):
--     - PENDIENTE_AI        (analisis en curso)
--     - NEEDS_REVIEW        (revisor pendiente)
--     - RECHAZADO           (descartado, no aplica)
--     - REVERTIDO           (anulado posteriormente)
--
-- Idempotencia: DROP + CREATE WITH IF NOT EXISTS. Re-correr no
-- duplica, marcado en public._applied_sql automaticamente.
-- =====================================================================
BEGIN;

-- 1) Drop indice viejo (puede no existir en VPS muy recientes,
--    IF EXISTS lo hace tolerante).
DROP INDEX IF EXISTS finance.payment_uniq_ref_idx;

-- 2) Recrear con filtro adicional por estado.
CREATE UNIQUE INDEX IF NOT EXISTS payment_uniq_ref_idx
    ON finance.payment (metodo, referencia, expediente_id)
    WHERE is_active = TRUE
      AND estado IN ('CONFIRMADO_AI', 'CONFIRMADO_HUMANO');

-- 3) Reportar info en logs del entrypoint.
DO $$
DECLARE
    n_total      INTEGER;
    n_confirmed  INTEGER;
    n_drafts     INTEGER;
BEGIN
    SELECT COUNT(*) INTO n_total
      FROM finance.payment
     WHERE is_active = TRUE;
    SELECT COUNT(*) INTO n_confirmed
      FROM finance.payment
     WHERE is_active = TRUE
       AND estado IN ('CONFIRMADO_AI', 'CONFIRMADO_HUMANO');
    SELECT COUNT(*) INTO n_drafts
      FROM finance.payment
     WHERE is_active = TRUE
       AND estado IN ('PENDIENTE_AI', 'NEEDS_REVIEW');
    RAISE NOTICE 'D8 payment_uniq_ref_partial: % pagos activos (% confirmados, % borradores)',
        n_total, n_confirmed, n_drafts;
END$$;

COMMIT;
