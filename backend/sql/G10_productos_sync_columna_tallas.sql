-- =====================================================================
-- G10 · Productos — sincroniza la columna `tallas` con la corrida
-- Sprint 2026-07-21
--
-- `productos.producto` tiene DOS representaciones de las tallas
-- asignadas:
--   · `especificaciones->'sizes'`  (actualizada por G9)
--   · la columna `tallas` (JSONB)  ← la que lee el detalle de producto,
--     el wizard del portal (/portal/nueva-oc) y el form de producto.
--
-- G9 actualizó sólo `sizes`; esta migración copia el mismo contenido a
-- la columna `tallas` para los 11 SKUs del COMEX v9, dejando ambas
-- fuentes idénticas (18 tallas 33–50 composite · 15 tallas 33–47 EVA /
-- palmilha). 701956 sigue intacto.
--
-- Idempotente: `IS DISTINCT FROM` sólo re-escribe cuando difieren.
-- Manual: psql -U mwt -d mwt_one -f <este archivo>
-- =====================================================================

UPDATE productos.producto p
   SET tallas = p.especificaciones->'sizes',
       updated_at = NOW()
 WHERE p.is_active
   AND p.sku IN ('700211','700282','700294','700406','700412','700728',
                 '700844','701266','701340','701809','801048')
   AND p.tallas IS DISTINCT FROM (p.especificaciones->'sizes');

-- Verificación esperada: las 11 filas con tallas == sizes.
--   SELECT sku, jsonb_array_length(tallas),
--          tallas = especificaciones->'sizes' AS sincronizado
--     FROM productos.producto WHERE is_active ORDER BY 1;
-- =====================================================================
