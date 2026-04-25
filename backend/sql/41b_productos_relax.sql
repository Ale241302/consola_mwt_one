-- =====================================================================
-- MWT.ONE · 41b_productos_relax.sql · Hace opcionales los campos
--          NOT NULL sin DEFAULT de productos.producto.
-- Agente responsable: [AG-DATABASE]
--
-- Filosofía MWT (mismo principio aplicado a nodos/clientes):
--   "Si el form no se lo pide al humano, BD/API no lo exigen."
--
-- Campos relajados:
--   · sku    → permite borradores sin SKU asignado todavía
--   · nombre → permite borradores
--
-- NO se tocan los NOT NULL con DEFAULT (categoria, unidad, moneda,
-- costos, precios, tallas, colores, estado, etc.).
--
-- Idempotente: DROP NOT NULL es no-op si ya es NULLABLE.
--
-- Ejecutar:
--   psql -U mwt -d mwt_one -f backend/sql/41b_productos_relax.sql
-- =====================================================================

ALTER TABLE productos.producto ALTER COLUMN sku    DROP NOT NULL;
ALTER TABLE productos.producto ALTER COLUMN nombre DROP NOT NULL;

DO $$ BEGIN
    RAISE NOTICE '[41b_productos_relax] sku & nombre ahora son nullable en productos.producto';
END $$;
