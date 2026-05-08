-- ============================================================
-- MWT.ONE · C5_dedupe_sap_documentos.sql
-- Sprint 2026-05-08 — Soft-delete del documento "Confirmación SAP"
-- legacy creado por confirm_sap antes del cleanup.
--
-- El INSERT "sombra" producía un segundo registro en
-- expedientes.documento con kind='Confirmación SAP' (sin audience),
-- causando que el listado mostrara DOS docs por cada SAP confirmado.
--
-- Este script soft-deletea esos registros legacy. El registro
-- canónico es el creado por el upsert idempotente con
-- kind='ART-04', audience='ADMIN_ONLY'.
--
-- Idempotente: la segunda corrida no encuentra filas activas.
-- ============================================================
SET search_path = expedientes, public;

UPDATE expedientes.documento
   SET is_active = FALSE,
       updated_at = NOW()
 WHERE kind = 'Confirmación SAP'
   AND is_active = TRUE;

-- También cubre la variante sin tilde (legacy compat).
UPDATE expedientes.documento
   SET is_active = FALSE,
       updated_at = NOW()
 WHERE kind = 'Confirmacion SAP'
   AND is_active = TRUE;
