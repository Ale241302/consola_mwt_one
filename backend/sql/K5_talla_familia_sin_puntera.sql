-- =====================================================================
-- K5 · Familia de tallas "No tiene" (sin puntera) para EVA y PALMILHA
-- Crea la familia (familia_id fijo) copiando las tallas Composite 33–47
-- y asigna esas tallas a 700412 (EVA) y 801048 (PALMILHA).
-- Idempotente.
-- =====================================================================
INSERT INTO ops.tallas (
    id, is_active, created_at, updated_at, tipo_producto, talla_base, nombre, descripcion,
    eu, us_men, us_women, us_youth, uk_men, uk_women, uk_youth,
    br, mx, ar, jp, cn, kr, cm, alfa, inch,
    grosor_antepie_mm, grosor_talon_mm, drop_mm, peso_g,
    metadata, marca_ids, tipos, familias, ancho_mm, comprimento_mm, marca_id, familia_id, equivalencias
)
SELECT gen_random_uuid(), true, now(), now(), t.tipo_producto, t.talla_base, t.nombre,
       'Medidas internas Marluvas (familia Sin puntera): ' || t.descripcion,
       t.eu, t.us_men, t.us_women, t.us_youth, t.uk_men, t.uk_women, t.uk_youth,
       t.br, t.mx, t.ar, t.jp, t.cn, t.kr, t.cm, t.alfa, t.inch,
       t.grosor_antepie_mm, t.grosor_talon_mm, t.drop_mm, t.peso_g,
       jsonb_set(t.metadata, '{familia}', '"No tiene"'::jsonb),
       t.marca_ids, t.tipos, t.familias,
       t.ancho_mm, t.comprimento_mm, t.marca_id,
       '522e9121-b1b2-41a5-a11b-8476403e8c76'::uuid, t.equivalencias
  FROM ops.tallas t
 WHERE t.is_active
   AND t.familia_id = 'c696fe4f-a287-4099-920a-c9534d28ded4'::uuid
   AND t.talla_base ~ '^\d+$'
   AND t.talla_base::int BETWEEN 33 AND 47
   AND NOT EXISTS (
        SELECT 1 FROM ops.tallas x
         WHERE x.familia_id = '522e9121-b1b2-41a5-a11b-8476403e8c76'::uuid
           AND x.talla_base = t.talla_base
   );

UPDATE productos.producto p
   SET especificaciones = jsonb_set(
         p.especificaciones, '{sizes}',
         (SELECT jsonb_agg(t.id::text ORDER BY t.talla_base::int)
            FROM ops.tallas t
           WHERE t.is_active
             AND t.familia_id = '522e9121-b1b2-41a5-a11b-8476403e8c76'::uuid
             AND t.talla_base ~ '^\d+$'
             AND t.talla_base::int BETWEEN 33 AND 47)),
       updated_at = now()
 WHERE p.is_active
   AND p.sku IN ('700412', '801048');

