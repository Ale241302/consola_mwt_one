-- =====================================================================
-- L12 · Marca única (Marluvas): completar brand_id faltante.
--   Hallazgo: todos los productos y expedientes son de Marluvas, pero 17
--   expedientes/OC tenían brand_id NULL → aparecían como "(sin marca)".
--   Idempotente: solo rellena NULL.
-- =====================================================================
BEGIN;

UPDATE expedientes.expediente
   SET brand_id = (SELECT id FROM brands.marca WHERE nombre ILIKE 'marluvas' LIMIT 1),
       updated_at = NOW()
 WHERE is_active = TRUE AND brand_id IS NULL
   AND EXISTS (SELECT 1 FROM brands.marca WHERE nombre ILIKE 'marluvas');

UPDATE expedientes.oc
   SET brand_id = (SELECT id FROM brands.marca WHERE nombre ILIKE 'marluvas' LIMIT 1)
 WHERE is_active = TRUE AND brand_id IS NULL
   AND EXISTS (SELECT 1 FROM brands.marca WHERE nombre ILIKE 'marluvas');

COMMIT;
