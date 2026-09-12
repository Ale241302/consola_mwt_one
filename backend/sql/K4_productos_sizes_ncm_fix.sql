-- =====================================================================
-- K4 · Fix data productos: tallas faltantes + NCM faltantes
-- Idempotente. Reproduce el fix aplicado en producción:
--   · NCM 6401.10.00 y 6405.90.00 (faltaban en productos.ncm_code).
--   · Tallas de 700412 (EVA) y 801048 (PALMILHA) → familia Composite BR 33–47.
-- =====================================================================

INSERT INTO productos.ncm_code (id, code, descripcion, tarifas, is_active, created_at, updated_at)
SELECT gen_random_uuid(), '6401.10.00', 'Calzado impermeable con puntera de metal',
       '[{"rate_pct":14,"origin_iso2":"BR","destination_iso2":"CR"}]'::jsonb, true, now(), now()
 WHERE NOT EXISTS (SELECT 1 FROM productos.ncm_code WHERE code = '6401.10.00');

INSERT INTO productos.ncm_code (id, code, descripcion, tarifas, is_active, created_at, updated_at)
SELECT gen_random_uuid(), '6405.90.00', 'Los demás calzados',
       '[{"rate_pct":14,"origin_iso2":"BR","destination_iso2":"CR"}]'::jsonb, true, now(), now()
 WHERE NOT EXISTS (SELECT 1 FROM productos.ncm_code WHERE code = '6405.90.00');

UPDATE productos.producto p
   SET especificaciones = jsonb_set(
         p.especificaciones, '{sizes}',
         (SELECT jsonb_agg(t.id::text ORDER BY t.talla_base::int)
            FROM ops.tallas t
           WHERE t.is_active
             AND t.talla_base ~ '^\d+$'
             AND t.talla_base::int BETWEEN 33 AND 47
             AND t.familia_id = 'c696fe4f-a287-4099-920a-c9534d28ded4'::uuid)),
       updated_at = now()
 WHERE p.is_active
   AND p.sku IN ('700412', '801048')
   AND COALESCE(p.especificaciones->'sizes', '[]'::jsonb) = '[]'::jsonb;
