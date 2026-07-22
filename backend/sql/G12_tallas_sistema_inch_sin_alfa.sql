-- =====================================================================
-- G12 · Motor de Tallas — sistema IN (pulgadas) + retira ALFA
-- Sprint 2026-07-21 (decisión CEO)
--
-- 1) NUEVO sistema de equivalencia `inch` (IN · pulgadas), ubicado en
--    la matriz justo al lado de CM (orden 145, tras cm=140):
--      inch = comprimento_mm ÷ 25.4  (largo interno en pulgadas)
--    Se crea la columna `inch` en ops.tallas y se puebla para todas
--    las corridas que tienen comprimento_mm (G11).
--
-- 2) ALFA (S/M/L) se desactiva del catálogo de sistemas: deja de
--    aparecer en la Matriz de Equivalencias del drawer y en /options/.
--    La columna `alfa` y sus datos se conservan (sólo visibilidad).
--
-- Idempotente. Manual: psql -U mwt -d mwt_one -f <este archivo>
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1 · Catálogo: alta de `inch` (junto a CM) + baja de `alfa`
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO ops.medida_sistema_cat
    (codigo, label, region, descripcion, grupo, orden, is_active)
VALUES
    ('inch', 'IN (pulgadas)', 'US',
     'Pulgadas: comprimento_mm ÷ 25.4 (largo interno del calzado).',
     'longitud_in', 145, TRUE)
ON CONFLICT (codigo) DO UPDATE
   SET label       = EXCLUDED.label,
       region      = EXCLUDED.region,
       descripcion = EXCLUDED.descripcion,
       grupo       = EXCLUDED.grupo,
       orden       = EXCLUDED.orden,
       is_active   = TRUE,
       updated_at  = NOW();

UPDATE ops.medida_sistema_cat
   SET is_active = FALSE, updated_at = NOW()
 WHERE codigo = 'alfa';

-- ─────────────────────────────────────────────────────────────────────
-- 2 · Columna + población: inch = comprimento_mm ÷ 25.4 (2 decimales)
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE ops.tallas
    ADD COLUMN IF NOT EXISTS inch VARCHAR(20) NULL;

COMMENT ON COLUMN ops.tallas.inch IS
  'Largo interno en pulgadas = comprimento_mm ÷ 25.4 (sistema IN).';

UPDATE ops.tallas
   SET inch = trim(to_char(ROUND(comprimento_mm / 25.4, 2), 'FM999990.00')),
       updated_at = NOW()
 WHERE is_active
   AND comprimento_mm IS NOT NULL;

-- Verificación esperada:
--   medida_sistema_cat activos = 15 (alfa fuera, inch orden 145)
--   tallas activas con inch = 81 (todas menos la 33 sin puntera)
--   talla 33 composite → inch 8.91
-- =====================================================================
