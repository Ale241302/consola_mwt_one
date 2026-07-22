-- =====================================================================
-- G15 · Corrida Composite — corrección de la familia (decisión CEO)
-- Sprint 2026-07-22
--
-- 1) La familia NO es "Composite Prime": las opciones son Composite y
--    Prime POR SEPARADO. metadata.familia pasa a 'Composite'.
--    (Las opciones del select se actualizan en backend/apps/sizing/
--    views.py → familias_linea: Composite · Prime · EVA · Social ·
--    PVC All Work · PVC Vulcaflex.)
--
-- 2) Las tallas se clasifican SÓLO por FAMILIA + MARCA: se vacían los
--    clasificadores heredados `tipos` (capellada) y `familias`
--    (puntera "Composite 200J") — esos chips ya no van en las tarjetas.
--    La descripción conserva las medidas internas del PDF.
--
-- Idempotente. Manual: psql -U mwt -d mwt_one -f <este archivo>
-- =====================================================================

UPDATE ops.tallas
   SET tipos    = '[]'::jsonb,
       familias = '[]'::jsonb,
       metadata = jsonb_set(metadata, '{familia}', '"Composite"'),
       descripcion = replace(descripcion,
                        'Composite Prime · puntera Composite 200J',
                        'familia Composite · puntera composite'),
       updated_at = NOW()
 WHERE metadata->>'familia' = 'Composite Prime';

-- Verificación esperada: 18 tallas con metadata->>'familia'='Composite',
-- tipos=[] y familias=[] (las tarjetas sólo muestran el chip Marluvas).
-- =====================================================================
