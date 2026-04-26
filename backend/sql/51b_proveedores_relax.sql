-- =====================================================================
-- MWT.ONE · 51b_proveedores_relax.sql · Relaja constraints NOT NULL en
--          proveedores.proveedor (consistencia con clientes/productos).
-- Agente responsable: [AG-DATABASE]
--
-- Filosofía MWT: ningún campo del form es obligatorio para guardar
-- borradores. Cualquier columna que el modelo Django marca como
-- null=True debe ser realmente NULLABLE en DB para que el INSERT
-- explícito del ORM no viole NOT NULL.
--
-- Causas del 500 detectadas:
--   1. razon_social  → era NOT NULL sin DEFAULT (relax v1)
--   2. score_iso     → era NOT NULL DEFAULT 0; el modelo no envía
--                      DEFAULT en el INSERT, manda NULL explícito y
--                      truena con IntegrityError sin traceback.
--
-- Idempotente: DROP NOT NULL es no-op si ya es NULLABLE.
--
-- Ejecutar:
--   psql -U mwt -d mwt_one -f backend/sql/51b_proveedores_relax.sql
-- =====================================================================

ALTER TABLE proveedores.proveedor ALTER COLUMN razon_social DROP NOT NULL;
ALTER TABLE proveedores.proveedor ALTER COLUMN score_iso    DROP NOT NULL;

DO $$ BEGIN
    RAISE NOTICE '[51b_proveedores_relax] razon_social + score_iso ahora son nullable';
END $$;
