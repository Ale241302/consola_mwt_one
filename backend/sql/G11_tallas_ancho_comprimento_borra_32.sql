-- =====================================================================
-- G11 · Motor de Tallas — ancho/comprimento como columnas + borra 32
-- Sprint 2026-07-21
--
-- 1) BORRADO de la talla 32 (id ec2e56c3-cee6-4a4b-8622-a5d212d30c5e):
--    no existe en la tabla oficial Marluvas (33–47/50). Referencias
--    verificadas = 0 el 2026-07-21 (productos.sizes/tallas, inventario
--    expediente_nodo_assignment + recepcion_linea, nodos
--    builder_artifact_line, productos.talla_matriz, productos.variante).
--
-- 2) COLUMNAS NUEVAS en ops.tallas (decisión CEO: el ancho/comprimento
--    del PDF "Sepa la talla" dejan de vivir sólo en `descripcion`):
--      · ancho_mm        NUMERIC(5,1)  — ancho interno (mm)
--      · comprimento_mm  NUMERIC(6,2)  — comprimento/largo interno (mm)
--    Se poblan para las 5 corridas G8 con los valores oficiales del PDF.
--    `descripcion` conserva el texto (no se toca).
--
-- Idempotente: ALTER IF NOT EXISTS + UPDATEs deterministas; el DELETE
-- es por id puntual. Manual: psql -U mwt -d mwt_one -f <este archivo>
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1 · Borrar la talla 32 (sin referencias — verificado arriba)
-- ─────────────────────────────────────────────────────────────────────
DELETE FROM ops.tallas
 WHERE id = 'ec2e56c3-cee6-4a4b-8622-a5d212d30c5e';

-- ─────────────────────────────────────────────────────────────────────
-- 2 · Columnas nuevas
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE ops.tallas
    ADD COLUMN IF NOT EXISTS ancho_mm       NUMERIC(5,1) NULL,
    ADD COLUMN IF NOT EXISTS comprimento_mm NUMERIC(6,2) NULL;

COMMENT ON COLUMN ops.tallas.ancho_mm IS
  'Ancho interno del calzado (mm) — PDF Marluvas "Sepa la talla".';
COMMENT ON COLUMN ops.tallas.comprimento_mm IS
  'Comprimento/largo interno del calzado (mm) — CM (Mondopoint) = comprimento_mm ÷ 10.';

-- ─────────────────────────────────────────────────────────────────────
-- 3 · Poblar por corrida (mismos datos del PDF usados en G8)
-- ─────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS _g11_medidas;
CREATE TEMP TABLE _g11_medidas (
    grupo  text,
    talla  text,
    ancho  numeric(5,1),
    compr  numeric(6,2),
    PRIMARY KEY (grupo, talla)
);
INSERT INTO _g11_medidas VALUES
    ('plas_acero','33',83.1,223.38),('plas_acero','34',84.8,230.04),
    ('plas_acero','35',86.5,236.70),('plas_acero','36',88.2,243.36),
    ('plas_acero','37',89.9,250.02),('plas_acero','38',91.6,256.68),
    ('plas_acero','39',93.3,263.34),('plas_acero','40',95.0,270.00),
    ('plas_acero','41',96.7,276.66),('plas_acero','42',98.4,283.32),
    ('plas_acero','43',100.1,289.98),('plas_acero','44',101.8,296.64),
    ('plas_acero','45',103.5,303.30),('plas_acero','46',105.2,309.96),
    ('plas_acero','47',106.9,316.62),('plas_acero','48',NULL,323.28),
    ('plas_acero','49',NULL,329.94),('plas_acero','50',NULL,336.60),
    ('composite','33',83.1,226.38),('composite','34',84.8,233.04),
    ('composite','35',86.5,239.70),('composite','36',88.2,246.36),
    ('composite','37',89.9,253.02),('composite','38',91.6,259.68),
    ('composite','39',93.3,266.34),('composite','40',95.0,273.00),
    ('composite','41',96.7,279.66),('composite','42',98.4,286.32),
    ('composite','43',100.1,292.98),('composite','44',101.8,299.64),
    ('composite','45',103.5,306.30),('composite','46',105.2,312.96),
    ('composite','47',106.9,319.62),('composite','48',NULL,326.28),
    ('composite','49',NULL,332.94),('composite','50',NULL,339.60),
    ('sin_puntera','33',83.1,NULL),('sin_puntera','34',84.8,244.28),
    ('sin_puntera','35',86.5,250.87),('sin_puntera','36',88.2,257.46),
    ('sin_puntera','37',89.9,264.06),('sin_puntera','38',91.6,270.65),
    ('sin_puntera','39',93.3,277.25),('sin_puntera','40',95.0,283.84),
    ('sin_puntera','41',96.7,290.44),('sin_puntera','42',98.4,297.03),
    ('sin_puntera','43',100.1,303.63),('sin_puntera','44',101.8,310.26),
    ('sin_puntera','45',103.5,316.85),('sin_puntera','46',105.2,323.45),
    ('sin_puntera','47',106.9,330.04),
    ('eva','33',83.1,219.20),('eva','34',84.8,225.81),
    ('eva','35',86.5,232.04),('eva','36',88.2,238.64),
    ('eva','37',89.9,245.27),('eva','38',91.6,251.78),
    ('eva','39',93.3,258.36),('eva','40',95.0,265.32),
    ('eva','41',96.7,272.25),('eva','42',98.4,278.53),
    ('eva','43',100.1,285.00),('eva','44',101.8,294.33),
    ('eva','45',103.5,294.33),('eva','46',105.2,308.46),
    ('eva','47',106.9,308.46),
    ('pvc','33',83.1,228.50),('pvc','34',84.8,228.50),
    ('pvc','35',86.5,241.50),('pvc','36',88.2,241.50),
    ('pvc','37',89.9,251.50),('pvc','38',91.6,258.00),
    ('pvc','39',93.3,264.50),('pvc','40',95.0,271.00),
    ('pvc','41',96.7,277.50),('pvc','42',98.4,284.00),
    ('pvc','43',100.1,290.50),('pvc','44',101.8,297.00),
    ('pvc','45',103.5,307.00),('pvc','46',105.2,307.00),
    ('pvc','47',106.9,320.00),('pvc','48',NULL,320.00);

-- Cuero × Composite 200J
UPDATE ops.tallas t
   SET ancho_mm = m.ancho, comprimento_mm = m.compr, updated_at = NOW()
  FROM _g11_medidas m
 WHERE t.is_active
   AND t.tipos    = '["Anti-llamas","Cuero Carnaza","Cuero Liso Fuego","Cuero Liso HIDRO","Cuero Nobuck","Cuero Nobuck Hidrofugado","Cuero Plena Flor","Cuero Plena Flor HIDRO","Cuero Rodock","Cuero Vaqueta HIDRO","Cuero Vaqueta Lisa","Microfibra","Mmicro"]'::jsonb
   AND t.familias = '["Composite 200J"]'::jsonb
   AND m.grupo = 'composite'
   AND trim(t.talla_base) = m.talla;

-- Cuero × Plástico / Acero 200J / Citoplástico 200C
UPDATE ops.tallas t
   SET ancho_mm = m.ancho, comprimento_mm = m.compr, updated_at = NOW()
  FROM _g11_medidas m
 WHERE t.is_active
   AND t.tipos    = '["Anti-llamas","Cuero Carnaza","Cuero Liso Fuego","Cuero Liso HIDRO","Cuero Nobuck","Cuero Nobuck Hidrofugado","Cuero Plena Flor","Cuero Plena Flor HIDRO","Cuero Rodock","Cuero Vaqueta HIDRO","Cuero Vaqueta Lisa","Microfibra","Mmicro"]'::jsonb
   AND t.familias = '["Plástico","Acero 200J","Citoplástico 200C"]'::jsonb
   AND m.grupo = 'plas_acero'
   AND trim(t.talla_base) = m.talla;

-- Cuero × No tiene
UPDATE ops.tallas t
   SET ancho_mm = m.ancho, comprimento_mm = m.compr, updated_at = NOW()
  FROM _g11_medidas m
 WHERE t.is_active
   AND t.tipos    = '["Anti-llamas","Cuero Carnaza","Cuero Liso Fuego","Cuero Liso HIDRO","Cuero Nobuck","Cuero Nobuck Hidrofugado","Cuero Plena Flor","Cuero Plena Flor HIDRO","Cuero Rodock","Cuero Vaqueta HIDRO","Cuero Vaqueta Lisa","Microfibra","Mmicro"]'::jsonb
   AND t.familias = '["No tiene"]'::jsonb
   AND m.grupo = 'sin_puntera'
   AND trim(t.talla_base) = m.talla;

-- EVA × No tiene
UPDATE ops.tallas t
   SET ancho_mm = m.ancho, comprimento_mm = m.compr, updated_at = NOW()
  FROM _g11_medidas m
 WHERE t.is_active
   AND t.tipos    = '["EVA"]'::jsonb
   AND t.familias = '["No tiene"]'::jsonb
   AND m.grupo = 'eva'
   AND trim(t.talla_base) = m.talla;

-- PVC × Acero 200J / No tiene
UPDATE ops.tallas t
   SET ancho_mm = m.ancho, comprimento_mm = m.compr, updated_at = NOW()
  FROM _g11_medidas m
 WHERE t.is_active
   AND t.tipos    = '["PVC"]'::jsonb
   AND t.familias = '["Acero 200J","No tiene"]'::jsonb
   AND m.grupo = 'pvc'
   AND trim(t.talla_base) = m.talla;

-- Verificación esperada:
--   0 filas con talla_base='32' · 82 activas · ancho/comprimento
--   poblados según la tabla del PDF (talla 33 sin_puntera compr NULL).
-- =====================================================================
