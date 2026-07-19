-- =====================================================================
-- G4 · Motor de Tallas — talla base pasa a BR (realidad de fábrica)
-- Sprint 2026-07-18
--
-- La verdad de fábrica (Excel COMEX, hoja Calculadora fila 17, columnas
-- M–X) es la talla BR: 33/34, 35/36, 37 … 45/46, 47/48. El catálogo
-- estaba en base EU (34–49). Esta migración:
--
--   A) Re-key in place: talla_base y nombre pasan a BR (los UUIDs NO
--      cambian → las asignaciones de productos y cualquier referencia
--      quedan válidas). Las 15 columnas de equivalencias NO se tocan:
--      la matriz de G2 (2026-07-16) ya es correcta por fila.
--   B) Crea la talla BR 48 (EU 50) — la corrida COMEX llega a 47/48 y
--      la matriz actual termina en EU 49. Extrapolada con las reglas
--      documentadas en G2.
--   C) Asignación real por SKU desde la grilla del Excel: los 12 SKUs
--      de calzado con grilla completa (BR 33–48) reciben las tallas
--      EU 35–50. Se quita EU 34 de 700412/701340 (fuera de la corrida).
--      NO se tocan 701956 (no existe en el Excel) ni 801048 (palmilla,
--      sin grilla) — decisión manual pendiente del usuario.
--
-- Idempotente (UPDATEs deterministas + guard NOT EXISTS).
-- El entrypoint lo aplica una vez (public._applied_sql).
--
-- ROLLBACK (manual, si hiciera falta):
--   UPDATE ops.tallas SET talla_base = eu, nombre = eu, updated_at = NOW()
--    WHERE tipo_producto = 'calzado' AND eu ~ '^[0-9]+$';
--   UPDATE ops.tallas SET is_active = FALSE WHERE talla_base = '48';
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- A · Re-key: base BR preservando UUIDs
-- ─────────────────────────────────────────────────────────────────────
UPDATE ops.tallas
   SET talla_base = br,
       nombre     = br,
       updated_at = NOW()
 WHERE is_active
   AND tipo_producto = 'calzado'
   AND br ~ '^[0-9]+$';

-- ─────────────────────────────────────────────────────────────────────
-- B · Talla BR 48 (EU 50) — extrapolación con las reglas de G2:
--     BR = EU−2 · paso CM ≈ 0.67 (31.96→32.63) · mx/jp = 31.5 · ar = EU
--     cn ≈ 2×cm−10 (53) · kr = mm (315) · us_men/women +0.5–1 · uk 15
--     youth NULL (fuera de rango junior) · alfa: banda tras XXL → 3XL
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO ops.tallas (
  tipo_producto, talla_base, nombre, descripcion,
  eu, us_men, us_women, us_youth, uk_men, uk_women, uk_youth,
  br, mx, ar, jp, cn, kr, cm, alfa,
  marca_ids, tipos, familias, is_active
)
SELECT
  'calzado', '48', '48',
  'Corrida alta COMEX (EU 50) — extrapolada con las reglas de G2',
  '50', '15.5-16', '17.5-18', NULL, '15', '15', NULL,
  '48', '31.5', '50', '31.5', '53', '315', '32.63', '3XL',
  (SELECT jsonb_build_array(id::text) FROM brands.marca
    WHERE lower(nombre) = 'marluvas' LIMIT 1),
  '["Bota Alta","Bota al Tobillo","Plantilla","Tenis","Zapato tipo crocs"]'::jsonb,
  '["50B22","50B26","60B22","70B19","70B22","70C32","75BPR29"]'::jsonb,
  TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM ops.tallas
   WHERE tipo_producto = 'calzado' AND talla_base = '48'
);

-- ─────────────────────────────────────────────────────────────────────
-- C · Asignación real por SKU: corrida COMEX BR 33–48 = EU 35–50
-- ─────────────────────────────────────────────────────────────────────
WITH run AS (
  SELECT t.id::text AS tid, t.eu::int AS eu_int
    FROM ops.tallas t
   WHERE t.is_active
     AND t.tipo_producto = 'calzado'
     AND t.eu ~ '^[0-9]+$'
     AND t.eu::int BETWEEN 35 AND 50
)
UPDATE productos.producto p
   SET especificaciones = jsonb_set(
         p.especificaciones, '{sizes}',
         COALESCE(
           (SELECT jsonb_agg(run.tid ORDER BY run.eu_int) FROM run),
           '[]'::jsonb),
         true),
       updated_at = NOW()
 WHERE p.is_active
   AND p.sku IN ('700412','700844','701809','701266','700294','700211',
                 '700406','700282','701340','700427','700728');
