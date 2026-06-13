-- =====================================================================
-- MWT.ONE · E8_oc_codigo_allow_duplicates.sql
-- Agente responsable: [AG-DATABASE]
-- Sprint 2026-06-13 · Directiva CEO: PERMITIR OCs duplicadas por número
-- de PO. Reemplaza la política de E7 (único parcial) por NINGUNA unicidad
-- en expedientes.oc.codigo.
--
-- Se aplica AUTOMÁTICAMENTE en el deploy (entrypoint corre backend/sql/*.sql
-- una sola vez, rastreado en public._applied_sql). Corre DESPUÉS de E7.
--
-- CONTEXTO
--   El cliente B2B re-sube el mismo PO (ej. 504960) y debe poder registrarlo
--   aunque ya exista una OC activa con ese número. Se quita toda unicidad de
--   oc.codigo y se deja un índice NO único para lookups/orden.
--
--   NOTA: expedientes.expediente.codigo SIGUE siendo único; el wizard
--   (views_wizard.create_from_oc) desambigua el codigo del expediente con
--   sufijo -2/-3… El número de OC/PO se conserva duplicado tal cual.
-- =====================================================================

BEGIN;

-- Quitar la unicidad original (constraint auto-nombrada) ...
ALTER TABLE expedientes.oc DROP CONSTRAINT IF EXISTS oc_codigo_key;
DROP INDEX IF EXISTS expedientes.oc_codigo_key;

-- ... y la política parcial de E7.
DROP INDEX IF EXISTS expedientes.oc_codigo_active_uniq;

-- Índice NO único para búsquedas / ORDER BY por codigo (PO).
CREATE INDEX IF NOT EXISTS oc_codigo_idx ON expedientes.oc (codigo);

COMMIT;

-- FIN E8_oc_codigo_allow_duplicates.sql
