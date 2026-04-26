-- =====================================================================
-- MWT.ONE · 51b_proveedores_relax.sql · Hace opcional razon_social en
--          proveedores.proveedor (consistencia con clientes/productos).
-- Agente responsable: [AG-DATABASE]
--
-- Filosofía MWT: ningún campo del form es obligatorio para guardar
-- borradores. razon_social era el único NOT NULL sin DEFAULT.
--
-- Idempotente: DROP NOT NULL es no-op si ya es NULLABLE.
--
-- Ejecutar:
--   psql -U mwt -d mwt_one -f backend/sql/51b_proveedores_relax.sql
-- =====================================================================

ALTER TABLE proveedores.proveedor ALTER COLUMN razon_social DROP NOT NULL;

DO $$ BEGIN
    RAISE NOTICE '[51b_proveedores_relax] razon_social ahora es nullable';
END $$;
