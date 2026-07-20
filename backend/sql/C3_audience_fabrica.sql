-- ============================================================
-- MWT.ONE · C3_audience_fabrica.sql
-- Sprint 2026-07-20 — Cuarto nivel de audiencia: FABRICA.
--
-- Caso de uso: cuando el expediente es operado por Muito Work
-- Limitada, generate-proforma crea TRES documentos en una sola
-- llamada: Proforma Cliente (CLIENT), Proforma MWT (MWT_INTERNAL,
-- vista CEO triangular) y Proforma Fábrica (FABRICA — la vista
-- Marluvas del template: compra MWT al proveedor, FOB, NCM,
-- tallas BRA). FABRICA es interna: NO visible para CLIENT_*.
--
-- Cambio: expedientes.documento · CHECK extendido para aceptar
--   'CLIENT' | 'MWT_INTERNAL' | 'ADMIN_ONLY' | 'FABRICA'.
--
-- Idempotente. Asume C2_audience_admin_only.sql ya corrió.
-- ============================================================
SET search_path = expedientes, public;

DO $$ BEGIN
  ALTER TABLE expedientes.documento
    DROP CONSTRAINT IF EXISTS documento_audience_chk;
EXCEPTION WHEN undefined_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE expedientes.documento
    ADD CONSTRAINT documento_audience_chk
    CHECK (audience IN ('CLIENT','MWT_INTERNAL','ADMIN_ONLY','FABRICA'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN expedientes.documento.audience IS
  'CLIENT: visible a clientes finales, MWT y Admin. MWT_INTERNAL: solo MWT staff y Admin. ADMIN_ONLY: SOLO rol Admin/CEO/superuser. FABRICA: proforma de fábrica (compra MWT al proveedor) — interna, no visible al cliente.';
