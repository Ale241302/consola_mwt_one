-- =====================================================================
-- G20 · Productos — backfill de especificaciones.tipo_producto
-- Sprint 2026-07-22
--
-- Con el motor dinámico de tallas (G19), el producto declara su TIPO
-- (código de ops.tipo_producto_cat: calzado / plantilla / lo que el
-- usuario cree desde la UI) en `especificaciones.tipo_producto`. El
-- portal B2B (/portal/nueva-oc) lo lee para armar el toggle dinámico
-- de sistemas de talla (sistemas del tipo × unidades del catálogo).
--
-- Backfill de los productos existentes (heurística, idempotente):
--   · tipo_calzado = 'plantilla'              → 'plantilla'
--   · tiene tipo_calzado o tallas asignadas   → 'calzado'
--   · el resto queda SIN tipo (el operador lo asigna desde la UI —
--     no se adivina donde no hay señal).
--
-- Idempotente: sólo toca filas sin especificaciones.tipo_producto.
-- Manual: psql -U mwt -d mwt_one -f <este archivo>
-- =====================================================================

UPDATE productos.producto
   SET especificaciones = especificaciones
                          || jsonb_build_object('tipo_producto', 'plantilla'),
       updated_at = NOW()
 WHERE especificaciones->>'tipo_producto' IS NULL
   AND lower(COALESCE(especificaciones->>'tipo_calzado', '')) = 'plantilla';

UPDATE productos.producto
   SET especificaciones = especificaciones
                          || jsonb_build_object('tipo_producto', 'calzado'),
       updated_at = NOW()
 WHERE especificaciones->>'tipo_producto' IS NULL
   AND (especificaciones->>'tipo_calzado' IS NOT NULL
        OR jsonb_array_length(COALESCE(tallas, '[]'::jsonb)) > 0);

-- Verificación esperada:
--   SELECT especificaciones->>'tipo_producto' AS tipo, count(*)
--     FROM productos.producto WHERE is_active GROUP BY 1 ORDER BY 1;
--   (plantillas de línea → 'plantilla'; calzado de línea → 'calzado';
--    filas sin señal → NULL)
-- =====================================================================
