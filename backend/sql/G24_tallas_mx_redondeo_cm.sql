-- =====================================================================
-- G24 · Corrección de equivalencia MX (México) en calzado
-- Sprint 2026-07-27
--
-- La equivalencia MX debe coincidir con CM (Mondopoint) redondeado al
-- 0.5 más cercano.  Los scripts G2 y G21 la estaban generando con un
-- desfase sistemático; este script corrige el dato ya aplicado en BD.
--
-- Regla:  mx = round(cm * 2) / 2,  ej. 26.63 → 26.5, 23.00 → 23.
--
-- Idempotente: re-ejecutable; solo toca filas donde el valor actual
-- difiere del cálculo.  Actualiza tanto la columna legacy `mx` como la
-- matriz dinámica `equivalencias` (G19).
--
-- Manual: psql -U mwt -d mwt_one -f backend/sql/G24_tallas_mx_redondeo_cm.sql
-- =====================================================================

BEGIN;

-- CTE con el valor correcto por fila; solo filas activas de calzado
-- cuyo cm sea un número y cuyo mx (legacy o JSON) esté desactualizado.
WITH fix AS (
    SELECT id,
           regexp_replace((round(cm::numeric * 2) / 2)::text, '\.0$', '') AS mx_new
      FROM ops.tallas
     WHERE tipo_producto = 'calzado'
       AND is_active = TRUE
       AND cm IS NOT NULL
       AND cm <> ''
       AND (   mx IS DISTINCT FROM regexp_replace((round(cm::numeric * 2) / 2)::text, '\.0$', '')
            OR equivalencias ->> 'mx' IS DISTINCT FROM regexp_replace((round(cm::numeric * 2) / 2)::text, '\.0$', '')
           )
)
UPDATE ops.tallas t
   SET mx = f.mx_new,
       equivalencias = jsonb_set(
           COALESCE(t.equivalencias, '{}'::jsonb),
           '{mx}',
           to_jsonb(f.mx_new)
       ),
       updated_at = NOW()
  FROM fix f
 WHERE t.id = f.id;

COMMIT;

-- Verificación esperada:
--   SELECT talla_base, familia_id, cm, mx, equivalencias->>'mx' AS eq_mx
--     FROM ops.tallas
--    WHERE tipo_producto = 'calzado' AND is_active
--    ORDER BY familia_id, talla_base;
-- =====================================================================
