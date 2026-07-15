-- =====================================================================
-- MWT.ONE · F4_clear_all_product_prices.sql
-- Propósito: Poner a cero todos los precios de los productos y sus
--            overrides/asignaciones de clientes en la base de datos.
-- =====================================================================

-- 1. Poner a cero precios base en catálogo maestro
UPDATE productos.producto
   SET precio_lista = 0.00,
       precio_distribuidor = 0.00,
       precio_mwt = 0.00;

-- 2. Limpiar overrides en variantes de productos
UPDATE productos.variante
   SET precio_override = NULL;

-- 3. Poner a cero precios base en pricelists (GradeItems)
UPDATE pricing.grade_item
   SET unit_price_usd = 0.0000;

-- 4. Poner a cero precios en catálogos personalizados (ClientAssignments)
UPDATE pricing.client_assignment
   SET cached_client_price = 0.0000;

-- 5. Limpiar overrides específicos de Marluvas
UPDATE pricing.marluvas_client_sku_pricing
   SET brl_override = NULL,
       ajuste_usd = 0.0000,
       prices_matrix = '{}'::jsonb,
       sizes_pricing = '{}'::jsonb;
