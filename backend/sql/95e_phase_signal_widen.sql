-- =====================================================================
-- MWT.ONE · 95e_phase_signal_widen.sql
-- Agente responsable: [AG-DATABASE]
--
-- FIX Sprint 2026-06-12 · El wizard multirole (95c) documentó
-- 'PENDING_CEO_REVIEW' (18 chars) como valor válido de
-- expedientes.expediente.phase_signal, pero la columna quedó en
-- VARCHAR(16) (70_expedientes.sql) → el INSERT del Portal B2B
-- (create-from-oc, rol CLIENT) moría con "value too long for type
-- character varying(16)" y el expediente nunca se creaba.
--
-- Widening de VARCHAR es backward-compatible y zero-downtime (no
-- reescribe la tabla en PostgreSQL). Idempotente: re-aplicar es no-op.
-- =====================================================================
SET client_min_messages = warning;

ALTER TABLE expedientes.expediente
    ALTER COLUMN phase_signal TYPE VARCHAR(32);

COMMENT ON COLUMN expedientes.expediente.phase_signal IS
    'ON_TRACK | AT_RISK | DELAYED | PENDING_CEO_REVIEW. El último solo
     aparece en expedientes subidos desde Portal B2B que aún no tienen
     modo_operacion definido por el CEO.';

-- =====================================================================
-- FIN 95e_phase_signal_widen.sql
-- =====================================================================
