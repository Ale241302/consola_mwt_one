-- =====================================================================
-- MWT.ONE · 71_oc_proveedor.sql · Agrega proveedor_id a expedientes.oc
-- Agente responsable: [AG-DATABASE]
--
-- Razón: la tabla original 70_expedientes.sql modela la OC desde la
-- óptica del CLIENTE (client_id, brand_id) — no contemplaba el lado
-- proveedor. Para asignar OCs a un proveedor desde su detalle hace
-- falta esta columna (UUID lógico, sin FK gestionada — patrón MWT).
--
-- Idempotente: ADD COLUMN IF NOT EXISTS + DROP INDEX IF EXISTS.
--
-- Ejecutar:
--   psql -U mwt -d mwt_one -f backend/sql/71_oc_proveedor.sql
-- =====================================================================

ALTER TABLE expedientes.oc
    ADD COLUMN IF NOT EXISTS proveedor_id UUID;     -- ⛔ sin FK (patrón MWT)

CREATE INDEX IF NOT EXISTS oc_proveedor_idx
    ON expedientes.oc (proveedor_id);

DO $$ BEGIN
    RAISE NOTICE '[71_oc_proveedor] expedientes.oc.proveedor_id agregado (nullable + index)';
END $$;
