-- =====================================================================
-- G17 · Productos Composite — asigna la corrida Composite (33–50)
-- Sprint 2026-07-22
--
-- Con el modelo familia+marca (G15/G16), los 10 productos de la línea
-- Composite reciben las 18 tallas de la corrida `metadata.familia =
-- 'Composite'` en especificaciones.sizes y en la columna `tallas`
-- (ambas fuentes, como G9+G10). Así el portal (/portal/nueva-oc)
-- vuelve a ofrecer la matriz completa sin abrir/guardar cada producto.
--
--   · 700412 (EVA) y 801048 (PALMILHA) quedan intactos: sus corridas
--     aún no existen en el catálogo.
--
-- Idempotente: re-asignación determinista. Manual:
--   psql -U mwt -d mwt_one -f <este archivo>
-- =====================================================================

WITH corrida AS (
  SELECT jsonb_agg(t.id::text ORDER BY t.talla_base::int) AS ids
    FROM ops.tallas t
   WHERE t.is_active
     AND t.metadata->>'familia' = 'Composite'
     AND t.talla_base ~ '^\d+$'
)
UPDATE productos.producto p
   SET especificaciones = jsonb_set(p.especificaciones, '{sizes}',
                                    (SELECT ids FROM corrida), true),
       tallas = (SELECT ids FROM corrida),
       updated_at = NOW()
 WHERE p.is_active
   AND p.especificaciones->>'familia' = 'Composite'
   AND (SELECT ids FROM corrida) IS NOT NULL;

-- Verificación esperada: 10 productos con 18 tallas (33–50).
--   SELECT sku, jsonb_array_length(tallas) FROM productos.producto
--    WHERE especificaciones->>'familia' = 'Composite' ORDER BY 1;
-- =====================================================================
