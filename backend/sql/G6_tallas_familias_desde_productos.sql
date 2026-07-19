-- =====================================================================
-- G6 · Motor de Tallas — familias por talla desde los productos de la DB
-- Sprint 2026-07-18
--
-- Corrección de G5: las familias de una talla NO salen del Excel de
-- fábrica, sino de los productos REALES de la consola (/productos):
--
--   familias(talla) = { familia(p) | p ∈ productos.producto activos,
--                                  talla ∈ p.especificaciones->'sizes' }
--
-- La familia del producto se deriva del prefijo del nombre (mismo patrón
-- de G1: dígitos+letras+dígitos al inicio, ej. 50B22M-… → 50B22).
-- Productos sin prefijo válido (102FCLEAN, PALMILHA) no aportan familia.
--
-- Resultado con las asignaciones actuales:
--   32        → []     (ningún producto la tiene asignada)
--   33–47     → [50B22, 50B26, 60B22, 70B19, 70B22, 70C32, 75BPR29]
--   48        → [50B22, 60B22, 70B19, 70B22, 70C32, 75BPR29]
--
-- Idempotente (UPDATE determinista).
-- =====================================================================
WITH prod_fams AS (
  SELECT p.id,
         upper(substring(p.nombre FROM '^[0-9]+[A-Za-z]+[0-9]+')) AS fam,
         p.especificaciones -> 'sizes' AS sizes
    FROM productos.producto p
   WHERE p.is_active
),
prod_sizes AS (
  SELECT pf.fam, s.tid
    FROM prod_fams pf
    CROSS JOIN LATERAL jsonb_array_elements_text(pf.sizes) AS s(tid)
   WHERE pf.fam IS NOT NULL
)
UPDATE ops.tallas t
   SET familias = COALESCE((
         SELECT jsonb_agg(DISTINCT ps.fam ORDER BY ps.fam)
           FROM prod_sizes ps
          WHERE ps.tid = t.id::text
       ), '[]'::jsonb),
       updated_at = NOW()
 WHERE t.is_active
   AND t.tipo_producto = 'calzado';
