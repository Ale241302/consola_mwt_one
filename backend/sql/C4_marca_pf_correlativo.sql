-- ============================================================
-- MWT.ONE · C4_marca_pf_correlativo.sql
-- Sprint 2026-07-20 — Correlativo de proformas por marca.
--
-- brands.marca.pf_correlativo: PRÓXIMO número de proforma de la
-- marca (ej. 2489 → la próxima PF generada es "PF 2489-<año>").
-- El año NO se guarda: se toma del año actual al generar.
-- generate-proforma consume el número e incrementa el contador
-- atómicamente (UPDATE ... RETURNING). NULL → sin correlativo
-- configurado: el backend cae al secuencial automático global.
--
-- Idempotente.
-- ============================================================
SET search_path = brands, public;

ALTER TABLE brands.marca
  ADD COLUMN IF NOT EXISTS pf_correlativo INTEGER;

COMMENT ON COLUMN brands.marca.pf_correlativo IS
  'Próximo número de proforma de la marca (PF <n>-<año actual>). Se incrementa al generar. NULL = secuencial global.';
