-- ============================================================
-- MWT.ONE · C4_backfill_art04_admin_only.sql
-- Sprint 2026-05-08 — Backfill: ART-04 docs siempre ADMIN_ONLY.
--
-- Documentos kind='ART-04' (Confirmación SAP) creados antes del
-- sprint 2026-05-06 quedaron con audience='CLIENT' (default) lo que
-- los expone al cliente — bug de seguridad / privacidad.
--
-- Este script fuerza audience='ADMIN_ONLY' para TODOS los ART-04
-- activos. Idempotente: las filas ya marcadas no se tocan (NO_OP).
-- ============================================================
SET search_path = expedientes, public;

UPDATE expedientes.documento
   SET audience = 'ADMIN_ONLY',
       updated_at = NOW()
 WHERE kind = 'ART-04'
   AND is_active = TRUE
   AND COALESCE(audience, 'CLIENT') <> 'ADMIN_ONLY';

-- También aplicar el mismo backfill a artifact_instances (la tabla
-- que persiste el flujo wizard ART-04). Audience ahí también debe
-- ser ADMIN_ONLY.
UPDATE expedientes.artifact_instances
   SET audience = 'ADMIN_ONLY'
 WHERE artifact_code = 'ART-04'
   AND is_active = TRUE
   AND COALESCE(audience, 'CLIENT') <> 'ADMIN_ONLY';
