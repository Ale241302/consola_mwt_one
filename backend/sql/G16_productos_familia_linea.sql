-- =====================================================================
-- G16 · Productos — asigna la familia de línea (decisión CEO)
-- Sprint 2026-07-22
--
-- Con el nuevo modelo, las tallas se filtran en el form de producto por
-- `especificaciones.familia` (select Familia junto a Marca) + marca.
-- Se asigna la familia a los productos existentes según sus atributos:
--
--   · Cuero/microfibra × puntera Composite 200J (los 10 SKUs de la
--     línea composite: 9 del COMEX v9 + 701956) → 'Composite'.
--   · 700412 (102FCLEAN-BR, capellada EVA)                    → 'EVA'.
--   · 801048 (PALMILHA SOFTBED) queda SIN familia: es plantilla, no
--     calzado de línea; el CEO la asigna a mano si la quiere.
--
-- Idempotente: jsonb_set determinista. Manual:
--   psql -U mwt -d mwt_one -f <este archivo>
-- =====================================================================

UPDATE productos.producto
   SET especificaciones = jsonb_set(especificaciones, '{familia}', '"Composite"'),
       updated_at = NOW()
 WHERE is_active
   AND sku IN ('700211','700282','700294','700406','700728',
               '700844','701266','701340','701809','701956');

UPDATE productos.producto
   SET especificaciones = jsonb_set(especificaciones, '{familia}', '"EVA"'),
       updated_at = NOW()
 WHERE is_active
   AND sku = '700412';

-- Verificación esperada:
--   SELECT sku, especificaciones->>'familia' FROM productos.producto
--    WHERE is_active ORDER BY 1;
--   10 'Composite' · 1 'EVA' · 1 NULL (801048)
-- =====================================================================
