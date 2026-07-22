-- =====================================================================
-- G13 · Borra TODAS las tallas del catálogo (decisión CEO 2026-07-22)
--
-- El catálogo (82 tallas en 5 corridas G8) se elimina completo para
-- reconstruirlo desde cero con el nuevo esquema del drawer
-- (Tipo de producto · Talla base BRA · Familia de línea).
--
-- Referencias verificadas antes de borrar (2026-07-22):
--   · productos (especificaciones.sizes / columna tallas): 11 SKUs →
--     se limpian a [] en esta misma transacción.
--   · inventario.expediente_nodo_assignment, inventario.recepcion_linea,
--     nodos.builder_artifact_line, productos.talla_matriz,
--     productos.variante: 0 referencias.
--
-- Idempotente: la segunda corrida no toca nada (arrays ya vacíos y
-- tabla ya vacía). Manual: psql -U mwt -d mwt_one -f <este archivo>
-- =====================================================================

-- 1 · Limpiar asignaciones en productos (los ids quedarían colgados)
UPDATE productos.producto
   SET especificaciones = jsonb_set(especificaciones, '{sizes}', '[]'::jsonb, true),
       tallas = '[]'::jsonb,
       updated_at = NOW()
 WHERE jsonb_array_length(COALESCE(especificaciones->'sizes', '[]'::jsonb)) > 0
    OR jsonb_array_length(COALESCE(tallas, '[]'::jsonb)) > 0;

-- 2 · Borrar TODO el catálogo de tallas
DELETE FROM ops.tallas;

-- Verificación esperada:
--   ops.tallas = 0 filas · productos con sizes/tallas = []
-- =====================================================================
