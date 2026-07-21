-- =====================================================================
-- G9 · Productos Marluvas — asignación de tallas por corrida
-- Sprint 2026-07-21
--
-- Tras G8 (corridas por capellada × tipo puntera), cada producto debe
-- apuntar a las tallas de SU corrida en `especificaciones.sizes`:
--
--   · Cuero/microfibra × Composite 200J → corrida B · BR 33–50
--     (rango oficial del PDF "Sepa la talla" · puntera composite).
--   · EVA × No tiene (102FCLEAN)        → corrida D · BR 33–47.
--   · Cuero × No tiene (PALMILHA)       → corrida C · BR 33–47.
--
-- Alcance: SÓLO los productos presentes en la "Tabela de preços COMEX
-- 2026 v9" (decisión CEO): 11 SKUs. 701956 (50B26V…) NO está en el
-- Excel y queda intacto. Bico del Excel validado contra
-- especificaciones.tipo_puntera (COMPOSITE ↔ Composite 200J,
-- SEM BICO ↔ No tiene).
--
-- La talla 32 (fuera de la tabla oficial 33–47) no se asigna.
-- Idempotente: re-asignación determinista. Manual:
--   psql -U mwt -d mwt_one -f <este archivo>
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1 · Cuero/microfibra × Composite 200J → BR 33–50 (9 SKUs)
-- ─────────────────────────────────────────────────────────────────────
UPDATE productos.producto p
   SET especificaciones = jsonb_set(
         p.especificaciones, '{sizes}',
         (SELECT jsonb_agg(t.id::text ORDER BY t.talla_base::int)
            FROM ops.tallas t
           WHERE t.is_active
             AND t.talla_base ~ '^\d+$'
             AND t.talla_base::int BETWEEN 33 AND 50
             AND t.tipos    = '["Anti-llamas","Cuero Carnaza","Cuero Liso Fuego","Cuero Liso HIDRO","Cuero Nobuck","Cuero Nobuck Hidrofugado","Cuero Plena Flor","Cuero Plena Flor HIDRO","Cuero Rodock","Cuero Vaqueta HIDRO","Cuero Vaqueta Lisa","Microfibra","Mmicro"]'::jsonb
             AND t.familias = '["Composite 200J"]'::jsonb),
         true),
       updated_at = NOW()
 WHERE p.is_active
   AND p.sku IN ('700211','700282','700294','700406','700728',
                 '700844','701266','701340','701809');

-- ─────────────────────────────────────────────────────────────────────
-- 2 · 102FCLEAN-BR (EVA · sin bico) → corrida EVA × No tiene · BR 33–47
-- ─────────────────────────────────────────────────────────────────────
UPDATE productos.producto p
   SET especificaciones = jsonb_set(
         p.especificaciones, '{sizes}',
         (SELECT jsonb_agg(t.id::text ORDER BY t.talla_base::int)
            FROM ops.tallas t
           WHERE t.is_active
             AND t.talla_base ~ '^\d+$'
             AND t.talla_base::int BETWEEN 33 AND 47
             AND t.tipos    = '["EVA"]'::jsonb
             AND t.familias = '["No tiene"]'::jsonb),
         true),
       updated_at = NOW()
 WHERE p.is_active
   AND p.sku = '700412';

-- ─────────────────────────────────────────────────────────────────────
-- 3 · PALMILHA MARLUVAS SOFTBED (capellada cuero carnaza · sin bico)
--     → corrida cuero × No tiene · BR 33–47
-- ─────────────────────────────────────────────────────────────────────
UPDATE productos.producto p
   SET especificaciones = jsonb_set(
         p.especificaciones, '{sizes}',
         (SELECT jsonb_agg(t.id::text ORDER BY t.talla_base::int)
            FROM ops.tallas t
           WHERE t.is_active
             AND t.talla_base ~ '^\d+$'
             AND t.talla_base::int BETWEEN 33 AND 47
             AND t.tipos    = '["Anti-llamas","Cuero Carnaza","Cuero Liso Fuego","Cuero Liso HIDRO","Cuero Nobuck","Cuero Nobuck Hidrofugado","Cuero Plena Flor","Cuero Plena Flor HIDRO","Cuero Rodock","Cuero Vaqueta HIDRO","Cuero Vaqueta Lisa","Microfibra","Mmicro"]'::jsonb
             AND t.familias = '["No tiene"]'::jsonb),
         true),
       updated_at = NOW()
 WHERE p.is_active
   AND p.sku = '801048';

-- ─────────────────────────────────────────────────────────────────────
-- 4 · Verificación esperada:
--   9 productos con 18 tallas (33–50) · 700412 y 801048 con 15 (33–47)
--   701956 intacto (16 tallas viejas)
--   SELECT p.sku, jsonb_array_length(p.especificaciones->'sizes')
--     FROM productos.producto p WHERE p.is_active ORDER BY 1;
-- =====================================================================
