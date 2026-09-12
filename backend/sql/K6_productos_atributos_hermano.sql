-- =====================================================================
-- K6 - Backfill de ficha tecnica de productos huerfanos
-- Los productos importados sin ficha (sin tipo_producto/familia_id ni
-- disipativo/normativa/riesgo/segmento) copian el bloque tecnico de su
-- hermano mas cercano ya completo (mismo modelo Marluvas).
--
-- Se copia solo el bloque de clasificacion/seguridad; NO se tocan
-- ncm, color, sizes, gallery, fichas, client_prices, visibility ni nodes.
--
-- Idempotente: solo actua sobre productos que aun no tienen `tipo_producto`.
-- Sin hermano disponible (701414) queda fuera para revision manual.
-- =====================================================================
WITH mapa(sku, src) AS (
  VALUES
    -- familia B19 (fuente 70B19 ya completo)
    ('700010', '700209'),  -- 50B19-MEX-CPAP-PAD
    ('700028', '700209'),  -- 50B19-MIN-A-PA-CP
    ('701935', '700209'),  -- 60B19M-CPAP-MIN-CP
    ('702064', '700209'),  -- 60B19M-CPAP-MIN-CP
    ('700518', '700209'),  -- 60B19-MIN-A-PA-CP-EXP
    ('700644', '700294'),  -- 65B19-E-CPAP-EXP
    ('700239', '700294'),  -- 70T19-E-C-PAD
    -- familia B22 (fuente 50B22M / 70B22 ya completos)
    ('701276', '700844'),  -- 30B22-CPAP-PAD
    ('701654', '700844'),  -- 50B22V-CPAP-HIDRO
    ('700198', '700211'),  -- 70B22-BP-HIDRO
    ('700190', '700406'),  -- 70B22-E-CPAP-PAD (gemelo exacto)
    -- familia B29
    ('700215', '700059'),  -- 70B29-E-CPAP-PAD
    ('701393', '700059'),  -- 60B29-MEX-CPAP-SRV
    -- familia B26V / C32
    ('701927', '701956'),  -- 50B26V-C-PAD-NT
    ('700487', '700282'),  -- 50C32-FRI-A-CP-HIDRO
    -- familia BPR29
    ('701306', '701340'),  -- 75BPR29-CLI-MP-E-CPAP
    ('701909', '700728'),  -- 75BPR29-MSC-CPAP-EXP
    ('700427', '700728'),  -- 75BPR29-MSMC-CPAPPAD
    ('700590', '700728')   -- 75BPR29-MSMC-CPAPPAD
),
claves(key) AS (
  VALUES ('tipo_producto'),('familia'),('familia_id'),('capellada'),('suela'),
         ('cierre'),('tipo_puntera'),('tipo_calzado'),('antiperforante'),
         ('plantilla_interna'),('cubrepuntera'),('protector_metatarsal'),
         ('materiales_circulares'),('disipativo_energia'),('normativa'),
         ('riesgo'),('segmento')
),
bloque AS (
  SELECT m.sku, jsonb_object_agg(k.key, s.especificaciones -> k.key) AS patch
    FROM mapa m
    JOIN productos.producto s ON s.sku = m.src AND s.is_active
    CROSS JOIN claves k
   WHERE s.especificaciones ? k.key
   GROUP BY m.sku
)
UPDATE productos.producto t
   SET especificaciones = t.especificaciones || b.patch,
       updated_at = now()
  FROM bloque b
 WHERE t.sku = b.sku
   AND t.is_active
   AND NOT (t.especificaciones ? 'tipo_producto');

-- Productos sin puntera (EVA / PVC / palmilha): no tienen hermano; su grupo
-- de tallas es "No tiene" (familia_id creada en K5). Solo se fija el FK.
UPDATE productos.producto t
   SET especificaciones = t.especificaciones
                          || jsonb_build_object('familia_id', '522e9121-b1b2-41a5-a11b-8476403e8c76'),
       updated_at = now()
 WHERE t.sku IN ('700412', '801048', '701414')
   AND t.is_active
   AND NOT (t.especificaciones ? 'familia_id');

-- 701414 (PVC sin puntera) sin tipo de producto: es calzado (igual que 700412).
UPDATE productos.producto t
   SET especificaciones = t.especificaciones
                          || jsonb_build_object('tipo_producto', 'calzado'),
       updated_at = now()
 WHERE t.sku = '701414'
   AND t.is_active
   AND NOT (t.especificaciones ? 'tipo_producto');

-- 701414 / 801048: sin disipativo ni normativa aplicable -> ["No"] (igual 700412).
UPDATE productos.producto t
   SET especificaciones = t.especificaciones
                          || jsonb_build_object('disipativo_energia', '["No"]'::jsonb)
                          || jsonb_build_object('normativa', '["No"]'::jsonb),
       updated_at = now()
 WHERE t.sku IN ('701414', '801048')
   AND t.is_active
   AND COALESCE(t.especificaciones -> 'disipativo_energia', '[]'::jsonb) = '[]'::jsonb
   AND COALESCE(t.especificaciones -> 'normativa', '[]'::jsonb) = '[]'::jsonb;
