-- =====================================================================
-- G22 · Calzado: reemplazar unidad BR por unidades LATAM CR/GT/COP
-- Sprint 2026-07-23
--
-- 1) Crea/actualiza las unidades de medida:
--      cr  → Costa Rica  (BRA + 1)
--      gt  → Guatemala   (BRA + 1)
--      cop → Colombia    (BRA + 1)
-- 2) En el tipo de producto "calzado" reemplaza "br" por "cr","gt","cop"
--    en la lista de sistemas de la matriz (la talla base sigue siendo BRA,
--    pero ya no se muestra como columna de equivalencias editable).
-- 3) Backfill: todas las tallas de calzado existentes reciben las nuevas
--    equivalencias cr/gt/cop = talla_base + 1.
--
-- Idempotente. Manual: psql -U mwt -d mwt_one -f <este_archivo>
-- =====================================================================

BEGIN;

-- ─── 1) Catálogo de unidades ───────────────────────────────────────
INSERT INTO ops.medida_sistema_cat
    (codigo, label, region, descripcion, grupo, orden, is_active)
VALUES
    ('cr',  'Costa Rica',  'LATAM', 'Equivalencia Costa Rica: BRA + 1.', 'numerica', 115, TRUE),
    ('gt',  'Guatemala',   'LATAM', 'Equivalencia Guatemala: BRA + 1.',  'numerica', 116, TRUE),
    ('cop', 'Colombia',    'LATAM', 'Equivalencia Colombia: BRA + 1.',   'numerica', 117, TRUE)
ON CONFLICT (codigo) DO UPDATE
   SET label       = EXCLUDED.label,
       region      = EXCLUDED.region,
       descripcion = EXCLUDED.descripcion,
       grupo       = EXCLUDED.grupo,
       orden       = EXCLUDED.orden,
       is_active   = EXCLUDED.is_active,
       updated_at  = NOW();

-- ─── 2) Matriz del tipo "calzado" ──────────────────────────────────
-- Orden: numérica (EU, US, UK, LATAM incluidas CR/GT/COP), longitud_cm,
-- longitud_in, alfa legacy.
UPDATE ops.tipo_producto_cat
   SET sistemas = '["eu","us_men","us_women","us_youth",
                    "uk_men","uk_women","uk_youth",
                    "mx","ar","cr","gt","cop",
                    "jp","cn","kr","cm","inch","alfa"]'::jsonb,
       updated_at = NOW()
 WHERE codigo = 'calzado';

-- ─── 3) Backfill de tallas calzado con cr/gt/cop = BRA + 1 ─────────
UPDATE ops.tallas
   SET equivalencias = jsonb_strip_nulls(
         COALESCE(equivalencias, '{}'::jsonb)
         || jsonb_build_object(
              'cr',  (COALESCE(NULLIF(trim(talla_base), ''), '0')::int + 1)::text,
              'gt',  (COALESCE(NULLIF(trim(talla_base), ''), '0')::int + 1)::text,
              'cop', (COALESCE(NULLIF(trim(talla_base), ''), '0')::int + 1)::text
            )
       ),
       updated_at = NOW()
 WHERE tipo_producto = 'calzado'
   AND talla_base ~ '^[0-9]+$';

COMMIT;

-- Verificación esperada:
--   SELECT codigo, sistemas FROM ops.tipo_producto_cat WHERE codigo='calzado';
--   SELECT talla_base, equivalencias->>'br' AS br,
--          equivalencias->>'cr' AS cr,
--          equivalencias->>'gt' AS gt,
--          equivalencias->>'cop' AS cop
--     FROM ops.tallas WHERE tipo_producto='calzado' ORDER BY talla_base;
-- =====================================================================
